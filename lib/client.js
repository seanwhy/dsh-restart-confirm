/**
 * dsh-restart-confirm — client half.
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }),
 * with platform modules (react) resolved through the injected require.
 *
 * Registers a "重启 DSH" action in sidebar.footer.action (props: { wide }).
 * A click opens a TWO-STEP confirmation dialog — the user must explicitly
 * confirm twice before anything is sent — then POSTs /restart-dsh. A status
 * dot polls GET /dsh-health every 5s (green = online, red = offline/restarting).
 *
 * All styling lives in a package-owned <style> tag injected via ctx.effect and
 * removed on teardown; colors come from DSH's own --dsw-alias-* tokens with
 * neutral fallbacks, so the button and dialogs follow the active theme.
 */
window.__ModuleLoader__.load({
  id: 'dsh-restart-confirm',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var inject = ['slots'];

    var CSS = [
      /* sidebar footer action button */
      '.zrc-btn{flex:none;align-items:center;width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:none;border-radius:12px;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden;position:relative}',
      '.zrc-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.zrc-btn--armed{color:var(--dsw-alias-state-error-primary)}',
      '.zrc-btn--armed:hover{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}',
      '.zrc-btn--rail{width:36px;height:36px;border-radius:50%;justify-content:center;gap:0;padding:0}',
      '.zrc-btn__label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.zrc-btn__status{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap}',
      '.zrc-btn[disabled]{opacity:.7;cursor:default}',
      /* status dot */
      '.zrc-dot{flex:none;width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--dsw-alias-label-tertiary)}',
      '.zrc-dot--ok{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 4px var(--dsw-alias-state-success-primary)}',
      '.zrc-dot--down{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 4px var(--dsw-alias-state-error-primary)}',
      '.zrc-btn--rail .zrc-dot{position:absolute;top:2px;right:2px;width:7px;height:7px}',
      /* two-step confirm modal */
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
      '.zrc-modal__btn--danger:hover{background:var(--dsw-alias-state-error-secondary)}'
    ].join('\n');

    function apply(ctx) {
      // ── stylesheet (package-owned, cleaned up on teardown) ──
      ctx.effect(function () {
        if (typeof document === 'undefined') return function () {};
        var tag = document.createElement('style');
        tag.dataset.zrcCss = '1';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, 'dsh-restart-confirm: stylesheet');

      // ── sidebar footer action button ──
      ctx.effect(function () {
        var disposeSlot = ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'restart-dsh-confirm',
            order: 10,
            label: function () { return '重启 DSH'; }
          }, function (props) {
            return RestartButton({ wide: props.wide });
          });
        });
        return function () { disposeSlot(); };
      }, 'dsh-restart-confirm: footer action');
    }

    function RestartButton(props) {
      var wide = props.wide;
      var phaseState = React.useState('idle'); // idle|confirm1|confirm2|sending|done|error
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var messageState = React.useState('');
      var message = messageState[0];
      var setMessage = messageState[1];
      var healthState = React.useState('checking'); // checking|ok|down
      var health = healthState[0];
      var setHealth = healthState[1];

      React.useEffect(function () {
        var check = function () {
          fetch('/dsh-health', { method: 'GET' })
            .then(function (res) { return res.ok ? setHealth('ok') : setHealth('down'); })
            .catch(function () { setHealth('down'); });
        };
        check();
        var timer = setInterval(check, 5000);
        return function () { clearInterval(timer); };
      }, []);

      function send() {
        setPhase('sending');
        fetch('/restart-dsh', { method: 'POST' })
          .then(function (res) { return res.json().catch(function () { return null; }); })
          .then(function (data) {
            if (data && data.ok === false) {
              setPhase('error');
              setMessage(data.message || 'restart rejected');
              return;
            }
            setPhase('done');
            setMessage((data && data.message) || 'restart triggered');
          })
          .catch(function (err) {
            setPhase('error');
            setMessage(String((err && err.message) || err));
          });
      }

      var label =
        phase === 'sending' ? '重启中…' :
        phase === 'done' ? '已触发' :
        phase === 'error' ? '失败' :
        '重启 DSH';

      var armed = phase === 'confirm1' || phase === 'confirm2' || phase === 'sending' || phase === 'done';

      var statusText =
        health === 'ok' ? '在线' :
        health === 'down' ? '离线' :
        '检测中…';

      var dotCls = 'zrc-dot' +
        (health === 'ok' ? ' zrc-dot--ok' : health === 'down' ? ' zrc-dot--down' : '');

      var title =
        phase === 'done' ? message :
        phase === 'error' ? message :
        '重启 DeepSeek Harness（WebUI 与后台），需要两次确认';

      var children = [
        React.createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
          key: 'ico'
        }, [
          React.createElement('path', { key: 'a', d: 'M23 4v6h-6' }),
          React.createElement('path', { key: 'b', d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' })
        ]),
        wide ? React.createElement('span', { key: 'label', className: 'zrc-btn__label' }, label) : null,
        wide ? React.createElement('span', { key: 'status', className: 'zrc-btn__status' }, statusText) : null,
        React.createElement('span', { key: 'dot', className: dotCls, title: statusText, 'aria-label': statusText })
      ];

      var modal = null;
      if (phase === 'confirm1') {
        modal = React.createElement(ConfirmModal, {
          key: 'm1',
          title: '重启 DeepSeek Harness？',
          body: React.createElement('span', null,
            '即将重启 ', React.createElement('b', null, 'WebUI 与后台'), '（同一 dsh web 进程）。当前会话与任务会保留在磁盘上，重启后自动恢复。'
          ),
          cancelLabel: '取消',
          confirmLabel: '继续',
          danger: false,
          onCancel: function () { setPhase('idle'); },
          onConfirm: function () { setPhase('confirm2'); }
        });
      } else if (phase === 'confirm2') {
        modal = React.createElement(ConfirmModal, {
          key: 'm2',
          title: '最后确认：真的重启吗？',
          body: React.createElement('span', null,
            '这是第二步确认。点击下方按钮将立即重启，', React.createElement('b', null, '连接会中断约 15–20 秒'), '，之后页面自动恢复。'
          ),
          cancelLabel: '返回',
          confirmLabel: '确认重启',
          danger: true,
          onCancel: function () { setPhase('confirm1'); },
          onConfirm: send
        });
      }

      return React.createElement('div', { style: { display: 'contents' } }, [
        React.createElement('button', {
          key: 'btn',
          type: 'button',
          className: 'zrc-btn' + (wide ? '' : ' zrc-btn--rail') + (armed ? ' zrc-btn--armed' : ''),
          onClick: function () {
            if (phase === 'idle') setPhase('confirm1');
            else if (phase === 'confirm1' || phase === 'confirm2') { /* modal handles it */ }
          },
          title: title,
          'aria-label': '重启 DSH',
          disabled: phase === 'sending' || phase === 'done'
        }, children),
        modal
      ]);
    }

    function ConfirmModal(props) {
      return React.createElement('div', { className: 'zrc-overlay' }, [
        React.createElement('div', {
          key: 'card',
          className: 'zrc-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': props.title
        }, [
          React.createElement('div', { key: 'title', className: 'zrc-modal__title' },
            props.danger
              ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ')
              : null,
            props.title
          ),
          React.createElement('div', { key: 'body', className: 'zrc-modal__body' }, props.body),
          React.createElement('div', { key: 'actions', className: 'zrc-modal__actions' }, [
            React.createElement('button', {
              key: 'cancel',
              type: 'button',
              className: 'zrc-modal__btn',
              onClick: props.onCancel
            }, props.cancelLabel),
            React.createElement('button', {
              key: 'ok',
              type: 'button',
              className: 'zrc-modal__btn' + (props.danger ? ' zrc-modal__btn--danger' : ' zrc-modal__btn--primary'),
              onClick: props.onConfirm,
              autoFocus: true
            }, props.confirmLabel)
          ])
        ])
      ]);
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
