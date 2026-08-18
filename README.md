# dsh-restart-confirm

Sidebar **one-click restart button** for the **DeepSeek Harness Web UI** — with a mandatory **two-step confirmation** before anything happens.

| | |
|---|---|
| Button | A compact restart icon (↻) pinned to the sidebar fold toggle — left of "收起侧边栏" when expanded, above "打开侧边栏" in the 56px rail |
| Safety | You must confirm **twice** before the restart is triggered |
| Scope | Restarts the `dsh web` process — the WebUI **and** the harness backend are the same process, so both come back together |
| Relaunch | Automatically re-runs the **exact command** that started DSH (`process.execPath + process.argv`) — no hardcoded paths, all flags (`--host`, `--port`, `--trusted-host`, profile) preserved |
| Platform | macOS · Linux · Windows (detached helper survives the kill) |
| Status dot | Polls `GET /dsh-health` every 5s — green online / red offline or restarting |

## Features

- **Two-step confirmation** — clicking the button opens a first dialog ("restart?"), then a final warning dialog ("really restart? connection will drop for ~15–20 s"). Only the second confirm sends the request. Both dialogs can be cancelled.
- **Adaptive placement** — the button is pinned next to the sidebar fold toggle via DOM placement: left of the collapse toggle when the sidebar is expanded, above the expand toggle in the 56px rail. A MutationObserver keeps it pinned through re-renders and collapse/expand transitions.
- **Auto-relaunch** — after killing the process, the plugin re-launches DSH with the same argv from the same working directory, so sessions/tasks (persisted on disk) recover and the page reconnects by itself.
- **Cross-platform, zero hardcoded paths** — the relaunch command is reconstructed from the running process itself. Works with any launcher (CLI, PWA, supervisor script).
- **Graceful kill** — SIGTERM first, SIGKILL only if the process lingers.
- **Configurable** — delay before kill, delay before relaunch, optional custom restart command, optional kill-only mode (external supervisor).
- **Re-entry guard** — a second request while a restart is in flight is rejected.
- **Loopback-only** — the restart endpoint refuses non-loopback callers.
- **Theme-aware UI** — uses DSH's own `--dsw-alias-*` tokens, so the button and dialogs follow light/dark theme.

## Install

### Option A — GitHub (recommended)

```bash
dsh plugin --profile web add github:seanwhy/dsh-restart-confirm
```

Then restart `dsh web` once so the bundle layer loads.

### Option B — DSH Plugin Marketplace

The repo carries the `dsh-plugin` topic, so it is indexed by the [DSH Plugin Marketplace](https://github.com/w2112515/dsh-plugin-marketplace). Open **Settings → Plugins → Plugin Marketplace**, search **dsh-restart-confirm**, and install with one click.

### Option C — Manual

1. Add the dependency to `~/.dsh/profiles/web/package.json`:
   ```jsonc
   {
     "dependencies": {
       "dsh-restart-confirm": "github:seanwhy/dsh-restart-confirm"
     }
   }
   ```
2. Add the loader row to `~/.dsh/profiles/web/cordis.patch.yml` (or install via the `dsh plugin` command which does it for you):
   ```yaml
   - insert:
       - id: dsh-restart-confirm
         name: dsh-restart-confirm
   ```
3. `pnpm install` in the profile, then restart `dsh web`.

## Configuration

Plugin config (Settings → Plugins → dsh-restart-confirm → config, or the profile manifest):

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `delaySeconds` | number | `3` | Seconds after the response before the process is killed (gives the browser time to show the "restarting" state) |
| `relaunchDelaySeconds` | number | `2` | Seconds after the kill before DSH is relaunched |
| `customRestartCommand` | string | `''` | Custom shell command used to relaunch instead of the auto-reconstructed argv |
| `killOnly` | boolean | `false` | Only kill the process; never relaunch (use when an external supervisor restarts DSH) |

## How it works

| Layer | File | What it does |
| --- | --- | --- |
| Host | `lib/index.js` | Registers `GET /dsh-health` + `POST /restart-dsh` on the webServer; launches a detached helper that sleeps → SIGTERM → (SIGKILL) → relaunches with the original argv |
| Client | `lib/client.js` | Vanilla (no React) client that pins a compact icon button next to the sidebar fold toggle by DOM placement; two-step confirm dialog; polls `GET /dsh-health` for the status dot |
| Bundle | `cordis.patch.yml` | The loader row that mounts both halves |

The handler replies **before** the kill happens; the helper script carries all the delays, so no host timer (which would be dropped outside a Cordis fiber) is needed.

### Why an independent helper process?

If the plugin killed DSH from inside its own process, nothing would be left to relaunch it. The helper is detached (`nohup sh … &` on Unix, `Start-Process -WindowStyle Hidden` on Windows), so it survives the harness exit and brings DSH back up.

## Security notes

- `POST /restart-dsh` only accepts loopback callers (`127.0.0.1` / `::1`) and only `POST`.
- The webServer binds to the loopback address by default in the shipped web profile.
- The plugin never sends data anywhere; `/dsh-health` is a local-only liveness probe.

## Development

The client bundle is hand-written in the exact wire format (`window.__ModuleLoader__.load({ id, factory })`) with no build step. It is dependency-free (no React), locating the sidebar fold toggle by its stable aria-labels and CSS-module class suffixes so no hashed class is hard-coded:

```bash
node --check lib/index.js
node --check lib/client.js
```

## License

MIT
