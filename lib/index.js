/**
 * dsh-restart-confirm — host half.
 *
 * Registers two exact routes on the webServer:
 *   GET  /dsh-health   — liveness probe plus a per-process boot identity used
 *                        to detect the new process without a fixed sleep.
 *   POST /restart-dsh  — restarts THIS dsh web process (WebUI + harness
 *                        backend are the same process), after a configurable
 *                        delay, using an independent detached helper so the
 *                        kill/relaunch survives the harness dying.
 *
 * Restart mechanics
 * -----------------
 * The handler replies FIRST (so the browser can render the "restarting"
 * state), then launches a detached helper:
 *   - Unix (macOS/Linux): a temp sh script run through
 *     `nohup sh <script> >/dev/null 2>&1 &` — reparented to launchd/init, it
 *     survives the harness exit.
 *   - Windows: `Start-Process powershell -WindowStyle Hidden ...` — the same
 *     detach trick the PowerShell world uses.
 *
 * The helper sleeps `delaySeconds`, sends SIGTERM to the current process
 * (SIGKILL if it lingers), sleeps `relaunchDelaySeconds`, then re-runs the
 * exact command that started dsh web — reconstructed from
 * `process.execPath + process.argv.slice(1)` and `process.cwd()` — so no
 * path is ever hardcoded and all original flags (`--host`, `--port`,
 * `--trusted-host`, profile) are preserved. `customRestartCommand`
 * overrides the relaunch; `killOnly: true` skips the relaunch (external
 * supervisor).
 *
 * Note on timers: a webServer handler is a plain Node HTTP callback outside
 * any Cordis fiber, so `ctx.effect`-backed timers are silently dropped. We
 * therefore avoid host timers entirely — the helper script carries every
 * delay — and launch it synchronously right after the response is sent.
 */

import z from '@deepseek-ai/schemastery'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-restart-confirm'
export const inject = ['webServer', 'shell']

export const Config = z.object({
  /** Seconds to wait after the response before killing the process. */
  delaySeconds: z.number().min(0).max(60).default(3),
  /** Seconds to wait after the kill before relaunching dsh web. */
  relaunchDelaySeconds: z.number().min(0).max(60).default(2),
  /**
   * Custom command used to relaunch dsh web after the kill. Empty = rebuilt
   * automatically from this process's own argv (works for any launcher).
   */
  customRestartCommand: z.string().default(''),
  /** Only kill the process, never relaunch (an external supervisor restarts it). */
  killOnly: z.boolean().default(false)
})

function posixQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function winQuote(value) {
  return '"' + String(value).replace(/"/g, '""') + '"'
}

/** Rebuild the dsh web launch command from the running process itself. */
function buildRestartCommand(config, quote) {
  if (config.customRestartCommand) return config.customRestartCommand
  const argv = [process.execPath, ...process.argv.slice(1)]
  return argv.map(quote).join(' ')
}

function isLoopback(remoteAddress) {
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1'
}

/**
 * Unix helper: sleep -> TERM -> sleep -> (KILL if alive) -> sleep -> exec relaunch.
 * Deletes its own script file right before exec.
 */
function unixHelperScript({ scriptPath, pid, cwd, relaunch, config, logPath }) {
  const lines = [
    '#!/bin/sh',
    'sleep ' + config.delaySeconds,
    'kill -TERM ' + pid + ' 2>/dev/null || true',
    'sleep ' + config.relaunchDelaySeconds,
    'if kill -0 ' + pid + ' 2>/dev/null; then',
    '  kill -KILL ' + pid + ' 2>/dev/null || true',
    '  sleep 1',
    'fi'
  ]
  if (!config.killOnly) {
    lines.push('cd ' + posixQuote(cwd))
    lines.push('rm -f -- ' + posixQuote(scriptPath))
    lines.push('exec ' + relaunch + ' >> ' + posixQuote(logPath) + ' 2>&1')
  } else {
    lines.push('rm -f -- ' + posixQuote(scriptPath))
  }
  lines.push('')
  return lines.join('\n')
}

/** Windows helper via hidden PowerShell: sleep -> Stop-Process -> Start-Process relaunch. */
function windowsHelperCommand({ pid, cwd, relaunch, config }) {
  // (relaunch is built by the caller with winQuote on win32)
  const parts = [
    'Start-Sleep -Seconds ' + config.delaySeconds,
    'Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue',
    'Start-Sleep -Seconds ' + config.relaunchDelaySeconds
  ]
  if (!config.killOnly) {
    // relaunch holds a fully quoted shell command (built by buildRestartCommand).
    // Run it through a detached powershell child with cwd restored.
    parts.push('Set-Location -LiteralPath ' + winQuote(cwd))
    parts.push('Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",' + winQuote(relaunch))
  }
  const body = parts.join('; ')
  return (
    'Start-Process powershell -WindowStyle Hidden ' +
    '-ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command",' +
    winQuote(body)
  )
}

export function apply(ctx, config) {
  let restarting = false
  const bootId = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)

  const disposeHealth = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-health',
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, ts: Date.now(), pid: process.pid, bootId }))
    }
  })

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/restart-dsh',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      if (!isLoopback(req.socket.remoteAddress)) {
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'restart is only allowed from loopback' }))
        return
      }
      if (restarting) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'restart already in progress' }))
        return
      }
      restarting = true

      const pid = process.pid
      const cwd = process.cwd()
      const relaunch = buildRestartCommand(config, process.platform === 'win32' ? winQuote : posixQuote)
      const logPath = join(tmpdir(), 'dsh-restart-confirm.log')

      try {
        let command
        if (process.platform === 'win32') {
          command = windowsHelperCommand({ pid, cwd, relaunch, config })
        } else {
          const scriptPath = join(tmpdir(), 'dsh-restart-confirm-' + pid + '.sh')
          writeFileSync(scriptPath, unixHelperScript({ scriptPath, pid, cwd, relaunch, config, logPath }), 'utf8')
          command = 'nohup sh ' + posixQuote(scriptPath) + ' >/dev/null 2>&1 &'
        }
        // Reply first — the helper sleeps delaySeconds before killing, giving
        // the browser time to render the "restarting" state.
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          message: 'restart scheduled: the page will disconnect, then come back on its own'
        }))

        const spec = ctx.shell.resolve({
          command,
          // rc.8 carries the workspace root as part of the policy shape even
          // when danger-full-access makes the confinement boundary moot.
          sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: cwd }
        })
        ctx.shell.start(spec)
        console.log('[dsh-restart-confirm] restart helper launched (pid ' + pid + ')')
      } catch (error) {
        restarting = false
        console.error('[dsh-restart-confirm] failed to launch restart helper:', error)
        // If we already ended the response, nothing more to send.
        if (!res.writableEnded) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: String((error && error.message) || error) }))
        }
      }
    }
  })

  return () => { disposeHealth(); disposeRoute() }
}
