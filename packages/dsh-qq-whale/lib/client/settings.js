/**
 * dsh-qq-whale —— 客户端半边（浏览器）：在「插件 → QQ 群聊受限预设」的配置区渲染两项设置。
 *
 * 只渲染两个真的会生效的字段：`mode`（三档）与 `allowTools`（白名单）。
 * preset id 不在这里出现：它由包内 `cordis.patch.yml` 的条目 id 决定，
 * 做成输入框就是一个"改了必然坏"的假旋钮（改名要同时改三处，见 README）。
 *
 * 格式由 DSH 的客户端模块加载器决定（照抄 dsh-qq-bot 的契约）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => module.exports })
 *   - `id` **必须等于 npm 包名**，否则报 "loaded without registering"，整个客户端半加载失败；
 *   - 只有 `react` 是外部依赖。
 *
 * 为什么必须有这个文件：插件详情页的配置区是 slot `plugins.bundle.config`，
 * 只导出 `Config` schema **不会**自动出现表单——上游 `dsh-client-ui-plugin-manager`
 * 按 `ctx.slots.inject('plugins.bundle.config', ..., { entryKey: pkg.name })` 派发。
 *
 * 读写走现成的 `ctx.configForms.get(<条目 id>)`（ConfigFormController）：
 *   snapshot = { status, value, revision, writable }；写入 `form.mutate(ops)`。
 *
 * 防御要求（违反会让整站白屏）：注册与渲染都 try/catch；拿不到服务就渲染只读说明。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qq-whale',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    /** 插槽 key 必须等于 npm 包名；设置命名空间等于 profile 条目 id。 */
    var PKG_NAME = 'dsh-qq-whale';
    var NS = 'dsh-qq-whale';

    /** 与 host 半的 MODES 保持一致（顺序即下拉顺序）。 */
    var MODE_OPTIONS = [
      ['hide', 'hide —— 收窄 + 隐藏（默认）'],
      ['guard', 'guard —— 只拦调用，模型仍可见'],
      ['off', 'off —— 完全不限制'],
    ];

    var FALLBACK_TEXT = '此版本 DSH 不支持内嵌表单（configForms 不可用），请直接编辑 profile 的 cordis.patch.yml 里 `- id: dsh-qq-whale` 那段。';

    var styles = {
      card: { display: 'block', padding: '12px 0' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' },
      label: { minWidth: '150px', fontWeight: 600 },
      hint: { opacity: 0.7, fontSize: '12px', marginLeft: '4px' },
      area: { width: '100%', minHeight: '120px', fontFamily: 'monospace', fontSize: '12px' },
      note: { opacity: 0.75, fontSize: '12px', marginTop: '4px' },
      error: { color: 'var(--dsh-color-danger, #d33)', marginTop: '6px', fontSize: '12px' },
      ok: { color: 'var(--dsh-color-success, #2a2)', marginTop: '6px', fontSize: '12px' },
    };

    /** 安全地取表单控制器；任何异常都当成「不可用」。 */
    function formOf(ctx) {
      try {
        if (ctx === undefined || ctx === null) return null;
        var forms = ctx.configForms;
        if (forms === undefined || forms === null || typeof forms.get !== 'function') return null;
        var handle = forms.get(NS);
        if (handle === undefined || handle === null || typeof handle.getSnapshot !== 'function') return null;
        return handle;
      } catch (error) {
        return null;
      }
    }

    function readSnapshot(handle) {
      try {
        return handle === null ? null : handle.getSnapshot();
      } catch (error) {
        return null;
      }
    }

    /** 数组 ↔ 多行文本。空行忽略；全空 = 空数组（= 不限制）。 */
    function linesOf(list) {
      try {
        return Array.isArray(list) ? list.join('\n') : '';
      } catch (error) {
        return '';
      }
    }

    function listOf(text) {
      return String(text === undefined || text === null ? '' : text)
        .split('\n')
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line !== ''; });
    }

    function ReadOnly(props) {
      return h('div', { style: styles.card }, h('div', { style: styles.note }, props.reason || FALLBACK_TEXT));
    }

    function WhaleSection(props) {
      var ctx = props !== null && props !== undefined ? props.ctx : undefined;
      var handle = formOf(ctx);
      var initial = readSnapshot(handle);

      var snapState = useState(initial);
      var snap = snapState[0];
      var setSnap = snapState[1];
      var draftState = useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var msgState = useState(null);
      var msg = msgState[0];
      var setMsg = msgState[1];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      useEffect(function () {
        if (handle === null || typeof handle.subscribe !== 'function') return undefined;
        var alive = true;
        function sync() { if (alive) setSnap(readSnapshot(handle)); }
        var off;
        try { off = handle.subscribe(sync); } catch (error) { off = undefined; }
        sync();
        return function () {
          alive = false;
          if (typeof off === 'function') { try { off(); } catch (error) { /* 忽略 */ } }
        };
      }, []);

      if (handle === null) return h(ReadOnly, { reason: FALLBACK_TEXT });
      if (snap === null) return h(ReadOnly, { reason: '配置尚未加载，稍后重试或直接改 cordis.patch.yml。' });
      if (snap.status === 'unavailable') return h(ReadOnly, { reason: '没有找到 `dsh-qq-whale` 命名空间（条目可能被改名或未启用）。' });
      if (snap.status === 'loading' || snap.value === undefined) {
        return h('div', { style: styles.card }, h('div', { style: styles.note }, '正在读取配置…'));
      }

      var value = snap.value || {};
      var allowIsArray = Array.isArray(value.allowTools);
      var allowLines = draft !== null && draft.allowTools !== undefined ? draft.allowTools : linesOf(value.allowTools);
      var mode = draft !== null && draft.mode !== undefined ? draft.mode
        : (typeof value.mode === 'string' ? value.mode : 'hide');
      var allowCount = listOf(allowLines).length;
      var writable = snap.writable !== false;
      var dirty = draft !== null;

      function patch(next) {
        var merged = { mode: mode, allowTools: allowLines };
        if (next !== undefined && next !== null) {
          Object.keys(next).forEach(function (key) { merged[key] = next[key]; });
        }
        setDraft(merged);
        setMsg(null);
      }

      function save() {
        if (busy) return;
        setBusy(true);
        setMsg(null);
        var ops = [
          { op: 'set', path: ['mode'], value: mode },
          { op: 'set', path: ['allowTools'], value: listOf(allowLines) },
        ];
        var pending;
        try {
          pending = handle.mutate(ops);
        } catch (error) {
          setBusy(false);
          setMsg({ kind: 'error', text: '保存失败：' + (error && error.message ? error.message : String(error)) });
          return;
        }
        Promise.resolve(pending).then(function (result) {
          setBusy(false);
          if (result === false) {
            // revision 冲突：宿主已拒绝并重新加载，把界面拉回最新值，别让用户以为保存成功。
            setMsg({ kind: 'error', text: '保存被拒绝（可能有多处同时修改，已重新加载最新值）。' });
            setDraft(null);
            setSnap(readSnapshot(handle));
            return;
          }
          setDraft(null);
          var latest = readSnapshot(handle);
          setSnap(latest);
          setMsg({ kind: 'ok', text: '已保存' + (latest !== null && latest.revision !== undefined ? '（revision ' + String(latest.revision) + '）' : '') });
        }, function (error) {
          setBusy(false);
          setMsg({ kind: 'error', text: '保存失败：' + (error && error.message ? error.message : String(error)) });
        });
      }

      var children = [
        h('div', { key: 'summary', style: styles.note },
          '当前生效：' + mode + '；白名单 ' + allowCount + ' 项。' +
          (mode === 'hide' ? '模型看不见名单外的工具。'
            : mode === 'guard' ? '模型仍看得见，但调用会被拒。'
              : '不限制，全部工具可用。')),
        h('div', { key: 'mode', style: styles.row },
          h('span', { style: styles.label }, '收窄强度'),
          h('select', {
            value: mode,
            disabled: !writable || busy,
            onChange: function (event) { patch({ mode: event.target.value }); },
          }, MODE_OPTIONS.map(function (pair) {
            return h('option', { key: pair[0], value: pair[0] }, pair[1]);
          }))),
        !allowIsArray
          ? h('div', { key: 'allowwarn', style: styles.error },
            '配置里的 allowTools 不是数组（可能被手工改坏），界面按“空”展示；保存会用当前文本覆盖它。')
          : null,
        h('div', { key: 'allow' },
          h('div', { style: styles.label }, '工具白名单（一行一个，留空 = 不限制）'),
          h('textarea', {
            value: allowLines,
            disabled: !writable || busy,
            style: styles.area,
            spellCheck: false,
            onChange: function (event) { patch({ allowTools: event.target.value }); },
          }),
          h('div', { style: styles.note },
            '联网用 qq_websearch / qq_webfetch；识图靠 read_image（删了它就看不了图）。')),
        h('div', { key: 'actions', style: styles.row },
          h('button', {
            type: 'button',
            disabled: !writable || busy || !dirty,
            onClick: save,
          }, busy ? '保存中…' : '保存'),
          h('button', {
            type: 'button',
            disabled: busy || !dirty,
            onClick: function () { setDraft(null); setMsg(null); },
          }, '撤销'),
          !writable ? h('span', { style: styles.hint }, '当前不可写（只读部署）') : null),
      ];

      if (msg !== null) children.push(h('div', { key: 'msg', style: msg.kind === 'ok' ? styles.ok : styles.error }, msg.text));

      return h('div', { style: styles.card }, children);
    }

    var inject = ['slots', 'configForms'];

    function apply(ctx) {
      // 整体 try/catch：注册失败只警告，绝不让异常冒到 compose（那会放大成整站白屏）。
      try {
        if (ctx === undefined || ctx === null || ctx.slots === undefined || ctx.slots === null) return;
        ctx.slots.inject('plugins.bundle.config', function () {
          try {
            return ctx.slots.register({
              name: 'plugins.bundle.config',
              key: PKG_NAME,
              inject: function () { return { ctx: ctx }; },
            }, WhaleSection);
          } catch (error) {
            return undefined;
          }
        });
      } catch (error) {
        try {
          if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') {
            ctx.logger.warn('[dsh-qq-whale] 配置区注册失败（不影响宿主功能）：' + (error && error.message ? error.message : String(error)));
          }
        } catch (ignored) { /* 忽略 */ }
      }
    }

    exports.name = PKG_NAME;
    exports.inject = inject;
    exports.apply = apply;
    // 测试用：暴露纯函数，方便不启浏览器也能测
    exports.__internals = { listOf: listOf, linesOf: linesOf, formOf: formOf };
    return module.exports;
  },
});
