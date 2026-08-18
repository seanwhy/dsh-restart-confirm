/**
 * dsh-restart-confirm — client half (vanilla, no React).
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }).
 *
 * Instead of the sidebar.footer.action slot, this half injects a compact
 * icon button into the sidebar shell by DOM placement, pinned next to the
 * fold toggle:
 *   - sidebar expanded: the button sits immediately LEFT of the collapse
 *     toggle ("收起侧边栏") inside the top logo row;
 *   - sidebar collapsed (56px rail): the button sits ABOVE the expand
 *     toggle ("打开侧边栏").
 * A MutationObserver re-pins it whenever the sidebar re-renders or toggles,
 * and the sidebar elements are located by their stable aria-labels plus
 * CSS-module class suffixes (_root/_collapsed), so no hashed class is
 * hard-coded.
 *
 * A click opens a TWO-STEP confirmation dialog — the user must explicitly
 * confirm twice before anything is sent — then POSTs /restart-dsh. A status
 * dot on the button polls GET /dsh-health every 5s (green = online, red =
 * offline/restarting). All styling uses DSH's --dsw-alias-* tokens with
 * neutral fallbacks so it follows the active theme.
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
      '.zrc-dot{position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1c1c1e))}',
      '.zrc-dot--ok{background:var(--dsw-alias-state-success-primary)}',
      '.zrc-dot--down{background:var(--dsw-alias-state-error-primary)}',
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
    var TOGGLE_LABELS = ['收起侧边栏', '打开侧边栏', 'Collapse sidebar', 'Open sidebar'];

    function hasClassSuffix(el, suffix) {
      for (var i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf(suffix) !== -1) return true;
      }
      return false;
    }

    function findSidebar() {
      var buttons = document.querySelectorAll('button');
      var toggle = null;
      for (var i = 0; i < buttons.length; i++) {
        var label = buttons[i].getAttribute('aria-label');
        if (label && TOGGLE_LABELS.indexOf(label) !== -1) { toggle = buttons[i]; break; }
      }
      if (!toggle) return null;
      var root = toggle;
      while (root && !hasClassSuffix(root, '_root')) root = root.parentElement;
      if (!root) return null;
      var logoRow = toggle;
      while (logoRow && logoRow.parentElement !== root) logoRow = logoRow.parentElement;
      return { toggle: toggle, logoRow: logoRow, root: root };
    }

    function isRail(root) {
      return hasClassSuffix(root, '_collapsed');
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
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
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
      var phase = 'idle';      // idle | confirm1 | confirm2 | sending | done | error
      var errorMsg = '';
      var health = 'checking'; // checking | ok | down
      var healthTimer = null;
      var observer = null;
      var rafPending = false;

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
        var armed = phase === 'confirm1' || phase === 'confirm2' || phase === 'sending' || phase === 'done';
        if (armed) btn.classList.add('zrc-btn--armed');
        else btn.classList.remove('zrc-btn--armed');
        btn.disabled = phase === 'sending' || phase === 'done';
        btn.title = phase === 'done' ? '重启已触发，页面即将断开…'
          : phase === 'error' ? errorMsg
          : '重启 DeepSeek Harness（WebUI 与后台），需要两次确认';

        var dotCls = 'zrc-dot';
        if (health === 'ok') dotCls += ' zrc-dot--ok';
        else if (health === 'down') dotCls += ' zrc-dot--down';
        dot.className = dotCls;
        dot.title = health === 'ok' ? 'DSH 在线' : health === 'down' ? 'DSH 离线' : '检测中…';

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
            body.appendChild(el('b', '', '连接会中断约 15–20 秒'));
            body.appendChild(document.createTextNode('，之后页面自动恢复。'));
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
        } else if (phase === 'sending' || phase === 'done') {
          var root2 = el('div', 'zrc-modal-root');
          var ov2 = el('div', 'zrc-restarting');
          ov2.appendChild(el('div', 'zrc-spinner'));
          ov2.appendChild(el('div', '', phase === 'done' ? '重启已触发，页面即将断开，约 15–20 秒后自动恢复…' : '正在重启 DSH…'));
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
        var rail = isRail(s.root);
        if (rail) {
          holder.classList.add('zrc-holder--rail');
          if (holder.parentElement !== s.root) s.root.insertBefore(holder, s.logoRow);
          else if (holder.nextSibling !== s.logoRow) s.root.insertBefore(holder, s.logoRow);
        } else {
          holder.classList.remove('zrc-holder--rail');
          if (holder.parentElement !== s.logoRow) s.logoRow.insertBefore(holder, s.toggle);
          else if (holder.nextSibling !== s.toggle) s.logoRow.insertBefore(holder, s.toggle);
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

      function checkHealth() {
        fetch('/dsh-health', { method: 'GET' })
          .then(function (res) { return res.ok ? setHealth('ok') : setHealth('down'); })
          .catch(function () { setHealth('down'); });
      }
      function setHealth(h) {
        health = h;
        if (dot) render();
      }

      function send() {
        setPhase('sending');
        fetch('/restart-dsh', { method: 'POST' })
          .then(function (res) { return res.json().catch(function () { return null; }); })
          .then(function (data) {
            if (data && data.ok === false) setPhase('error', data.message || 'restart rejected');
            else setPhase('done');
          })
          .catch(function (err) {
            setPhase('error', String((err && err.message) || err));
          });
      }

      function teardown() {
        if (observer) observer.disconnect();
        if (healthTimer) clearInterval(healthTimer);
        if (holder && holder.parentElement) holder.parentElement.removeChild(holder);
        var oldModal = document.querySelector('.zrc-modal-root');
        if (oldModal) oldModal.remove();
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
        build();
        position();
        observer = new MutationObserver(requestPosition);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class']
        });
        setTimeout(position, 500);
        setTimeout(position, 2000);
        checkHealth();
        healthTimer = setInterval(checkHealth, 5000);
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
