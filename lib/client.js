/**
 * dsh-restart-confirm — client half (vanilla, no React).
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }).
 *
 * Instead of the sidebar.footer.action slot, this half injects only the
 * client runtime and places a compact icon button into the sidebar shell by
 * DOM placement, pinned next to the
 * fold toggle:
 *   - sidebar expanded: the button sits immediately LEFT of the collapse
 *     toggle ("收起侧边栏") inside the top logo row;
 *   - sidebar collapsed (56px rail): the button sits ABOVE the expand
 *     toggle ("打开侧边栏").
 * A MutationObserver re-pins it whenever the sidebar re-renders or toggles.
 * The sidebar elements are located by stable aria-labels, with the official
 * toggle/data-slot hooks and CSS-module class suffixes (_toggle/_root/
 * _collapsed) as fallbacks, so no hashed class is hard-coded.
 *
 * A click opens a TWO-STEP confirmation dialog — the user must explicitly
 * confirm twice before anything is sent — then POSTs /restart-dsh. The green
 * dot is hidden by default and appears only when the marketplace reports a
 * plugin in pending-install/update/removal state (meaning a DSH restart is
 * required). All styling uses DSH's --dsw-alias-* tokens with neutral
 * fallbacks so it follows the active theme.
 */
window.__ModuleLoader__.load({
  id: 'dsh-restart-confirm',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var inject = [];

    /* ── styling (package-owned <style>, removed on teardown) ── */
    var CSS = [
      '.zrc-holder{flex:none;display:flex;align-items:center;justify-content:center}',
      '.zrc-holder--rail{height:36px;width:100%;margin-bottom:12px}',
      '.zrc-btn{position:relative;width:28px;height:28px;border-radius:50%;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex:none;font-family:inherit}',
      '.zrc-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.zrc-holder--rail .zrc-btn{width:36px;height:36px;color:var(--dsw-alias-label-primary)}',
      '.zrc-btn--armed{color:var(--dsw-alias-state-error-primary)}',
      '.zrc-btn--armed:hover{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.zrc-btn[disabled]{opacity:.7;cursor:default}',
      '.zrc-btn svg{display:block;width:16px;height:16px}',
      '.zrc-holder--rail .zrc-btn svg{width:18px;height:18px}',
      '.zrc-dot{display:none;position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;border:1px solid var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1c1c1e))}',
      '.zrc-dot--pending{display:block;background:var(--dsw-alias-state-success-primary)}',
      '.zrc-holder--rail .zrc-dot{top:4px;right:4px}',
      '.zrc-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.55));padding:24px}',
      '.zrc-modal{width:380px;max-width:100%;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1c1c1e));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:14px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary);font-family:inherit}',
      '.zrc-modal__title{font-size:15px;font-weight:600;margin:0 0 8px;display:flex;align-items:center;gap:8px}',
      '.zrc-modal__body{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0 0 18px}',
      '.zrc-modal__body b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.zrc-modal__actions{display:flex;gap:10px;justify-content:flex-end}',
      '.zrc-modal__btn{appearance:none;border:1px solid transparent;border-radius:8px;padding:7px 14px;font-size:13px;font-family:inherit;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill,transparent)}',
      '.zrc-modal__btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.zrc-modal__btn--primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted,#fff)}',
      '.zrc-modal__btn--primary:hover{background:var(--dsw-alias-button-primary-hover)}',
      '.zrc-modal__btn--danger{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.zrc-modal__btn--danger:hover{background:var(--dsw-alias-state-error-secondary)}',
      '.zrc-restarting{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.7));color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px}',
      '.zrc-spinner{width:32px;height:32px;border:3px solid var(--dsw-alias-border-l2,rgba(255,255,255,.15));border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:zrc-spin 1s linear infinite}',
      '@keyframes zrc-spin{to{transform:rotate(360deg)}}'
    ].join('\n');

    /* Stable identity of the sidebar fold toggle, all locales. */
    var TOGGLE_LABELS = [
      '收起侧边栏', '打开侧边栏', '折叠侧边栏', '展开侧边栏',
      'Collapse sidebar', 'Open sidebar', 'Expand sidebar'
    ];

    function hasClassSuffix(el, suffix) {
      if (!el || !el.classList) return false;
      for (var i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf(suffix) !== -1) return true;
      }
      return false;
    }

    function findSidebarSlot(node) {
      var current = node;
      while (current) {
        if (current.getAttribute && current.getAttribute('data-slot') === 'sidebar') return current;
        current = current.parentElement;
      }
      return null;
    }

    function findSidebarRoot(node) {
      var root = node;
      while (root) {
        if (hasClassSuffix(root, '_root')) return root;
        root = root.parentElement;
      }

      // Keep working if the CSS-module root class is renamed but the public
      // sidebar slot remains available.
      var slot = findSidebarSlot(node);
      if (!slot) return null;
      if (slot.getAttribute('data-collapsed') !== null
          || slot.getAttribute('data-sidebar-state') !== null) return slot;
      var child = slot.firstElementChild;
      while (child) {
        if (hasClassSuffix(child, '_root')) return child;
        child = child.nextElementSibling;
      }
      return slot.firstElementChild;
    }

    function findSidebar() {
      var buttons = document.querySelectorAll('button');
      var toggle = null;
      for (var i = 0; i < buttons.length; i++) {
        var label = buttons[i].getAttribute('aria-label');
        if (label && TOGGLE_LABELS.indexOf(label) !== -1) { toggle = buttons[i]; break; }
      }
      if (!toggle) {
        for (var j = 0; j < buttons.length; j++) {
          var candidate = buttons[j];
          var slot = candidate.getAttribute('data-slot');
          if ((slot === 'sidebar.toggle' || hasClassSuffix(candidate, '_toggle'))
              && findSidebarRoot(candidate)) {
            toggle = candidate;
            break;
          }
        }
      }
      if (!toggle) return null;
      var root = findSidebarRoot(toggle);
      if (!root) return null;
      var logoRow = toggle;
      while (logoRow && logoRow.parentElement !== root) logoRow = logoRow.parentElement;
      if (!logoRow) logoRow = root;
      return { toggle: toggle, logoRow: logoRow, root: root };
    }

    function isRail(root, toggle) {
      return hasClassSuffix(root, '_collapsed')
        || (root && root.getAttribute('data-collapsed') === 'true')
        || (root && root.getAttribute('data-sidebar-state') === 'collapsed')
        || (toggle && toggle.getAttribute('aria-expanded') === 'false');
    }

    /* ── tiny DOM helpers ── */
    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function icon() {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      var p1 = document.createElementNS(ns, 'path');
      p1.setAttribute('d', 'M23 4v6h-6');
      var p2 = document.createElementNS(ns, 'path');
      p2.setAttribute('d', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10');
      svg.appendChild(p1);
      svg.appendChild(p2);
      return svg;
    }

    function apply(ctx) {
      var holder = null;
      var btn = null;
      var dot = null;
      var phase = 'idle';      // idle | confirm1 | confirm2 | sending | recovering | done | error
      var errorMsg = '';
      var pendingRestart = false;
      var pendingTimer = null;
      var recoveryTimer = null;
      var recoverySawOffline = false;
      var observer = null;
      var rafPending = false;
      var bodyTimer = null;
      var positionTimers = [];
      var mounted = false;

      function setPhase(p, msg) {
        phase = p;
        if (msg !== undefined) errorMsg = msg;
        render();
      }

      function build() {
        holder = el('div', 'zrc-holder');
        btn = el('button', 'zrc-btn');
        btn.type = 'button';
        btn.setAttribute('aria-label', '重启 DSH');
        btn.title = '重启 DeepSeek Harness（WebUI 与后台），需要两次确认';
        btn.appendChild(icon());
        dot = el('span', 'zrc-dot');
        btn.appendChild(dot);
        holder.appendChild(btn);
        btn.addEventListener('click', function () {
          if (phase === 'idle') setPhase('confirm1');
        });
      }

      function render() {
        if (!btn) return;
        var armed = phase === 'confirm1' || phase === 'confirm2' || phase === 'sending' || phase === 'recovering' || phase === 'done';
        if (armed) btn.classList.add('zrc-btn--armed');
        else btn.classList.remove('zrc-btn--armed');
        btn.disabled = phase === 'sending' || phase === 'recovering' || phase === 'done';
        btn.title = phase === 'done' ? '后台已恢复，正在刷新页面…'
          : phase === 'recovering' ? '正在等待后台恢复…'
          : phase === 'error' ? errorMsg
          : '重启 DeepSeek Harness（WebUI 与后台），需要两次确认';

        var dotCls = 'zrc-dot';
        if (pendingRestart) dotCls += ' zrc-dot--pending';
        dot.className = dotCls;
        dot.title = pendingRestart ? '有插件待重启' : '';

        // modal / overlay
        var oldModal = document.querySelector('.zrc-modal-root');
        if (oldModal) oldModal.remove();
        if (phase === 'confirm1' || phase === 'confirm2') {
          var root = el('div', 'zrc-modal-root');
          var overlay = el('div', 'zrc-overlay');
          var modal = el('div', 'zrc-modal');
          modal.setAttribute('role', 'dialog');
          modal.setAttribute('aria-modal', 'true');
          var title = el('div', 'zrc-modal__title');
          if (phase === 'confirm2') title.appendChild(el('span', '', '⚠'));
          title.appendChild(document.createTextNode(phase === 'confirm1' ? '重启 DeepSeek Harness？' : '最后确认：真的重启吗？'));
          var body = el('div', 'zrc-modal__body');
          if (phase === 'confirm1') {
            body.appendChild(el('span', '', '即将重启 '));
            body.appendChild(el('b', '', 'WebUI 与后台'));
            body.appendChild(document.createTextNode('（同一 dsh web 进程）。当前会话与任务会保留在磁盘上，重启后自动恢复。'));
          } else {
            body.appendChild(document.createTextNode('这是第二步确认。点击下方按钮将立即重启，'));
            body.appendChild(el('b', '', '后台连接会短暂中断'));
            body.appendChild(document.createTextNode('，后台恢复后页面会立即自动刷新。'));
          }
          var actions = el('div', 'zrc-modal__actions');
          var cancel = el('button', 'zrc-modal__btn', phase === 'confirm1' ? '取消' : '返回');
          cancel.type = 'button';
          cancel.addEventListener('click', function () {
            setPhase(phase === 'confirm1' ? 'idle' : 'confirm1');
          });
          var ok = el('button', 'zrc-modal__btn' + (phase === 'confirm2' ? ' zrc-modal__btn--danger' : ' zrc-modal__btn--primary'), phase === 'confirm1' ? '继续' : '确认重启');
          ok.type = 'button';
          ok.addEventListener('click', function () {
            if (phase === 'confirm1') setPhase('confirm2');
            else send();
          });
          actions.appendChild(cancel);
          actions.appendChild(ok);
          modal.appendChild(title);
          modal.appendChild(body);
          modal.appendChild(actions);
          overlay.appendChild(modal);
          root.appendChild(overlay);
          document.body.appendChild(root);
          ok.focus();
        } else if (phase === 'sending' || phase === 'recovering' || phase === 'done') {
          var root2 = el('div', 'zrc-modal-root');
          var ov2 = el('div', 'zrc-restarting');
          ov2.appendChild(el('div', 'zrc-spinner'));
          var restartText = phase === 'sending'
            ? '正在触发 DSH 重启…'
            : phase === 'recovering'
              ? '正在等待后台恢复，恢复后立即刷新…'
              : '后台已恢复，正在刷新页面…';
          ov2.appendChild(el('div', '', restartText));
          root2.appendChild(ov2);
          document.body.appendChild(root2);
        } else if (phase === 'error') {
          var root3 = el('div', 'zrc-modal-root');
          var ov3 = el('div', 'zrc-overlay');
          var m3 = el('div', 'zrc-modal');
          m3.appendChild(el('div', 'zrc-modal__title', '重启失败'));
          m3.appendChild(el('div', 'zrc-modal__body', errorMsg || '未知错误'));
          var a3 = el('div', 'zrc-modal__actions');
          var close = el('button', 'zrc-modal__btn', '关闭');
          close.type = 'button';
          close.addEventListener('click', function () { setPhase('idle'); });
          a3.appendChild(close);
          m3.appendChild(a3);
          ov3.appendChild(m3);
          root3.appendChild(ov3);
          document.body.appendChild(root3);
        }
      }

      function position() {
        if (!holder) return;
        var s = findSidebar();
        if (!s) return;
        var rail = isRail(s.root, s.toggle);
        if (rail) {
          holder.classList.add('zrc-holder--rail');
          var railAnchor = s.logoRow && s.logoRow !== s.root ? s.logoRow : s.root.firstElementChild;
          if (railAnchor === holder) railAnchor = holder.nextElementSibling;
          if (railAnchor && railAnchor !== holder) {
            if (holder.parentElement !== s.root || holder.nextSibling !== railAnchor) {
              s.root.insertBefore(holder, railAnchor);
            }
          } else if (holder.parentElement !== s.root) {
            s.root.appendChild(holder);
          }
        } else {
          holder.classList.remove('zrc-holder--rail');
          var row = s.logoRow || s.root;
          var anchor = s.toggle && s.toggle.parentElement === row ? s.toggle : null;
          if (anchor) {
            if (holder.parentElement !== row || holder.nextSibling !== anchor) {
              row.insertBefore(holder, anchor);
            }
          } else if (holder.parentElement !== row) {
            row.appendChild(holder);
          }
        }
      }

      function requestPosition() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          position();
        });
      }

      function readHealth() {
        return fetch('/dsh-health', { method: 'GET', cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('health ' + res.status);
            return res.json();
          });
      }

      function checkPendingRestart() {
        // The marketplace is optional. If it is absent or unreachable, keep
        // the indicator hidden rather than turning an online check into noise.
        fetch('/api/plugin-marketplace', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'operationSnapshot' })
        })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (data) {
            var plugins = data && data.ok && data.value && Array.isArray(data.value.plugins)
              ? data.value.plugins : [];
            var next = plugins.some(function (plugin) {
              if (!plugin || plugin.packageName === 'dsh-restart-confirm') return false;
              return plugin.state === 'pending-install'
                || plugin.state === 'pending-update'
                || plugin.state === 'pending-removal';
            });
            if (pendingRestart !== next) {
              pendingRestart = next;
              render();
            }
          })
          .catch(function () {
            if (pendingRestart) {
              pendingRestart = false;
              render();
            }
          });
      }

      function scheduleRecovery(previousBootId) {
        if (recoveryTimer) clearTimeout(recoveryTimer);
        recoveryTimer = setTimeout(function () { waitForRestart(previousBootId); }, 250);
      }

      function waitForRestart(previousBootId) {
        readHealth()
          .then(function (data) {
            var nextBootId = data && typeof data.bootId === 'string' ? data.bootId : null;
            var newProcess = previousBootId && nextBootId && nextBootId !== previousBootId;
            // Fallback for older host builds without bootId: only accept a
            // successful probe after we observed the old process go offline.
            var recoveredWithoutIdentity = !previousBootId && recoverySawOffline;
            if (newProcess || recoveredWithoutIdentity) {
              setPhase('done');
              window.setTimeout(function () { window.location.reload(); }, 0);
              return;
            }
            scheduleRecovery(previousBootId);
          })
          .catch(function () {
            recoverySawOffline = true;
            if (phase !== 'recovering') setPhase('recovering');
            scheduleRecovery(previousBootId);
          });
      }

      function send() {
        setPhase('sending');
        recoverySawOffline = false;
        // Capture the current process identity before scheduling the restart.
        // This avoids reloading immediately against the still-running process.
        readHealth().catch(function () { return null; }).then(function (before) {
          var previousBootId = before && typeof before.bootId === 'string' ? before.bootId : null;
          return fetch('/restart-dsh', { method: 'POST', cache: 'no-store' })
            .then(function (res) { return res.json().catch(function () { return null; }); })
            .then(function (data) {
              if (data && data.ok === false) throw new Error(data.message || 'restart rejected');
              setPhase('recovering');
              waitForRestart(previousBootId);
            });
        }).catch(function (err) {
          setPhase('error', String((err && err.message) || err));
        });
      }

      function teardown() {
        mounted = false;
        if (bodyTimer) {
          clearInterval(bodyTimer);
          bodyTimer = null;
        }
        if (observer) observer.disconnect();
        if (pendingTimer) clearInterval(pendingTimer);
        if (recoveryTimer) clearTimeout(recoveryTimer);
        for (var i = 0; i < positionTimers.length; i++) clearTimeout(positionTimers[i]);
        positionTimers = [];
        if (holder && holder.parentElement) holder.parentElement.removeChild(holder);
        var oldModal = document.querySelector('.zrc-modal-root');
        if (oldModal) oldModal.remove();
        holder = null;
        btn = null;
        dot = null;
      }

      // ── stylesheet ──
      var disposeStyle = ctx.effect(function () {
        if (typeof document === 'undefined') return function () {};
        var tag = document.createElement('style');
        tag.dataset.zrcCss = '1';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, 'dsh-restart-confirm: stylesheet');

      // ── mount + keep pinned ──
      var disposeSetup = ctx.effect(function () {
        if (typeof document === 'undefined') return function () {};
        function deferPosition(delay) {
          var timer = setTimeout(function () {
            var index = positionTimers.indexOf(timer);
            if (index !== -1) positionTimers.splice(index, 1);
            position();
          }, delay);
          positionTimers.push(timer);
        }
        function mount() {
          if (mounted || !document.body) return;
          mounted = true;
          build();
          position();
          if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(requestPosition);
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['class', 'data-collapsed', 'data-sidebar-state', 'aria-label']
            });
          }
          deferPosition(500);
          deferPosition(2000);
          checkPendingRestart();
          pendingTimer = setInterval(checkPendingRestart, 5000);
        }
        if (document.body) {
          mount();
        } else {
          bodyTimer = setInterval(function () {
            if (!document.body) return;
            clearInterval(bodyTimer);
            bodyTimer = null;
            mount();
          }, 50);
        }
        return teardown;
      }, 'dsh-restart-confirm: mount');

      return function () {
        if (typeof disposeSetup === 'function') disposeSetup();
        if (typeof disposeStyle === 'function') disposeStyle();
      };
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
