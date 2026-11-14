/**
 * dsh-qq-voice —— 客户端半边（浏览器）：在「插件 → QQ 语音回复」的配置区渲染设置。
 *
 * 格式由 DSH 的客户端模块加载器决定（照抄 dsh-qq-whale / dsh-qq-bot 的契约）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => module.exports })
 *   - `id` **必须等于 npm 包名**，否则报 "loaded without registering"，客户端半整块失败；
 *   - 只有 `react` 是外部依赖。
 *
 * 为什么必须有这个文件：插件详情页的配置区是 slot `plugins.bundle.config`，
 * 只导出 `Config` schema **不会**自动出现表单（上游按
 * `ctx.slots.inject('plugins.bundle.config', …, { entryKey: pkg.name })` 派发）。
 *
 * 读写走 `ctx.configForms.get(<profile 条目 id>)`：
 *   snapshot = { status, value, revision, writable }；写入 `form.mutate(ops)`。
 *
 * 防御要求（违反会让整站白屏）：注册与渲染都 try/catch；拿不到服务就渲染只读说明。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qq-voice',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    /** 插槽 key 必须等于 npm 包名；设置命名空间等于 profile 条目 id。 */
    var PKG_NAME = 'dsh-qq-voice';
    var NS = 'dsh-qq-voice';

    var FALLBACK_TEXT = '此版本 DSH 不支持内嵌表单（configForms 不可用），请直接编辑 profile 的 cordis.patch.yml 里 `- id: dsh-qq-voice` 那段。';

    var styles = {
      card: { display: 'block', padding: '12px 0' },
      group: { margin: '14px 0 6px', fontWeight: 700, fontSize: '13px', opacity: 0.85 },
      row: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' },
      label: { minWidth: '170px', fontWeight: 600 },
      hint: { opacity: 0.65, fontSize: '12px', marginLeft: '4px' },
      input: { flex: 1, minWidth: '220px', padding: '4px 6px' },
      area: { width: '100%', minHeight: '70px', fontFamily: 'monospace', fontSize: '12px' },
      note: { opacity: 0.75, fontSize: '12px', marginTop: '4px' },
      error: { color: 'var(--dsh-color-danger, #d33)', marginTop: '6px', fontSize: '12px' },
      ok: { color: 'var(--dsh-color-success, #2a2)', marginTop: '6px', fontSize: '12px' },
      button: { padding: '5px 14px', marginRight: '8px' },
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

    function linesOf(list) {
      try {
        return Array.isArray(list) ? list.join('\n') : '';
      } catch (error) {
        return '';
      }
    }

    function listOf(text) {
      return String(text === undefined || text === null ? '' : text)
        .split(/[\n,]/)
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line !== ''; });
    }

    function ReadOnly(props) {
      return h('div', { style: styles.card }, h('div', { style: styles.note }, props.reason || FALLBACK_TEXT));
    }

    /**
     * 字段清单：全部是「真的会生效」的字段。
     * `secret: true` 表示只写字段——留空 = 不修改（避免一保存就把 key 清掉）。
     */
    var FIELDS = [
      { group: '开关与模式' },
      { key: 'enabled', label: '启用', type: 'bool', hint: '默认关；没填 API key 时开着只会每次报错' },
      { key: 'mode', label: '模式', type: 'select', options: [['manual', 'manual —— 模型显式调用才发'], ['off', 'off —— 不注册工具'], ['always', 'always —— 预留（当前等同 manual）']] },

      { group: 'TTS（DashScope）' },
      { key: 'ttsModel', label: '模型', type: 'text', hint: '如 qwen-audio-3.1-tts-flash' },
      { key: 'ttsVoice', label: '音色', type: 'text', hint: '留空 = 用模型默认；可选值见 DashScope 文档' },
      { key: 'apiKey', label: 'API key', type: 'secret', hint: '留空 = 不修改；也可只配下面的环境变量名' },
      { key: 'apiKeyEnv', label: 'key 环境变量', type: 'text', hint: '默认 DASHSCOPE_API_KEY' },
      { key: 'ttsBaseUrl', label: '端点', type: 'text', hint: '原生端点，不是 compatible-mode' },
      { key: 'format', label: '格式', type: 'text', hint: 'wav / mp3；拿到什么发什么' },
      { key: 'requestTemplate', label: '请求体模板', type: 'area', hint: '可选。留空 = 内置形状；支持 {{text}}/{{model}}/{{voice}}/{{format}}' },

      { group: 'NapCat 连接（本插件自己连一条，只发不收）' },
      { key: 'wsUrl', label: 'WS 地址', type: 'text', hint: '与 qq-bot 同一个即可；NapCat 允许多客户端' },
      { key: 'accessToken', label: 'NapCat token', type: 'secret', hint: '留空 = 不修改' },
      { key: 'idleCloseMs', label: '空闲断开（毫秒）', type: 'number', hint: '0 = 不断开' },

      { group: '限制' },
      { key: 'ownerOnly', label: '仅拥有者', type: 'bool', hint: '从 QQ 消息头的「身份:拥有者」判断；解析不到就拒' },
      { key: 'allowGroups', label: '允许的群', type: 'area', hint: '每行一个群号；留空 = 不限（但仍须在 qq-bot 的 group.allow 里）' },
      { key: 'maxChars', label: '字数上限', type: 'number' },
      { key: 'maxPerHour', label: '每小时条数', type: 'number', hint: '0 = 不限' },
      { key: 'cooldownSec', label: '冷却（秒）', type: 'number' },
      { key: 'timeoutMs', label: '总超时（毫秒）', type: 'number' },
      { key: 'profilePath', label: 'qq-bot 配置文件', type: 'text', hint: '只读，用于校验群白名单与 owners' },
    ];

    function VoiceSection(props) {
      var ctx = props !== null && props !== undefined ? props.ctx : undefined;
      var handle = formOf(ctx);
      var initial = readSnapshot(handle);

      var snapState = useState(initial);
      var snap = snapState[0];
      var setSnap = snapState[1];
      var draftState = useState({});
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
      if (snap.status === 'unavailable') return h(ReadOnly, { reason: '没找到 `dsh-qq-voice` 命名空间（条目可能被改名或未启用）。' });
      if (snap.status === 'loading' || snap.value === undefined) {
        return h('div', { style: styles.card }, h('div', { style: styles.note }, '正在读取配置…'));
      }

      var value = snap.value || {};
      var writable = snap.writable !== false;
      var dirty = Object.keys(draft).length > 0;

      /** 当前该显示什么值：草稿优先，其次配置。 */
      function shown(field) {
        if (Object.prototype.hasOwnProperty.call(draft, field.key)) return draft[field.key];
        var raw = value[field.key];
        if (field.type === 'bool') return raw === true;
        if (field.type === 'area' && field.key === 'allowGroups') return linesOf(raw);
        if (raw === undefined || raw === null) return '';
        return String(raw);
      }

      function patch(key, next) {
        var merged = {};
        Object.keys(draft).forEach(function (k) { merged[k] = draft[k]; });
        merged[key] = next;
        setDraft(merged);
        setMsg(null);
      }

      function save() {
        if (busy) return;
        setBusy(true);
        setMsg(null);
        var ops = [];
        Object.keys(draft).forEach(function (key) {
          var field = null;
          for (var i = 0; i < FIELDS.length; i += 1) if (FIELDS[i].key === key) field = FIELDS[i];
          if (field === null) return;
          var next = draft[key];
          if (field.type === 'secret' && (next === '' || next === undefined)) return; // 留空 = 不修改
          if (field.key === 'allowGroups') { ops.push({ op: 'set', path: [key], value: listOf(next) }); return; }
          if (field.type === 'number') { ops.push({ op: 'set', path: [key], value: Number(next) }); return; }
          ops.push({ op: 'set', path: [key], value: next });
        });
        if (ops.length === 0) {
          setBusy(false);
          setMsg({ kind: 'ok', text: '没有需要保存的改动（密钥留空表示不修改）。' });
          return;
        }
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
            setDraft({});
            setSnap(readSnapshot(handle));
            return;
          }
          setDraft({});
          var latest = readSnapshot(handle);
          setSnap(latest);
          setMsg({ kind: 'ok', text: '已保存' + (latest !== null && latest.revision !== undefined ? '（revision ' + String(latest.revision) + '）' : '') });
        }, function (error) {
          setBusy(false);
          setMsg({ kind: 'error', text: '保存失败：' + (error && error.message ? error.message : String(error)) });
        });
      }

      var children = [];
      children.push(h('div', { key: 'summary', style: styles.note },
        '当前：' + (value.enabled === true ? '已启用' : '未启用') +
        '；模式 ' + String(value.mode || 'manual') +
        '；模型 ' + String(value.ttsModel || '(未填)') +
        '；每小时 ' + String(value.maxPerHour === undefined ? 6 : value.maxPerHour) + ' 条。'));

      FIELDS.forEach(function (field, index) {
        if (field.group !== undefined) {
          children.push(h('div', { key: 'g' + String(index), style: styles.group }, field.group));
          return;
        }
        var current = shown(field);
        var disabled = !writable || busy;
        var control;
        if (field.type === 'bool') {
          control = h('input', {
            type: 'checkbox',
            checked: current === true,
            disabled: disabled,
            onChange: function (event) { patch(field.key, event.target.checked === true); },
          });
        } else if (field.type === 'select') {
          control = h('select', {
            value: current === '' ? field.options[0][0] : current,
            disabled: disabled,
            onChange: function (event) { patch(field.key, event.target.value); },
          }, field.options.map(function (pair) {
            return h('option', { key: pair[0], value: pair[0] }, pair[1]);
          }));
        } else if (field.type === 'area') {
          control = h('textarea', {
            style: styles.area,
            value: current,
            disabled: disabled,
            placeholder: field.hint || '',
            onChange: function (event) { patch(field.key, event.target.value); },
          });
        } else {
          control = h('input', {
            style: styles.input,
            type: field.type === 'secret' ? 'password' : (field.type === 'number' ? 'number' : 'text'),
            value: current,
            disabled: disabled,
            placeholder: field.type === 'secret'
              ? (value[field.key] !== undefined ? '(已设置，留空不改)' : '(未设置)')
              : (field.hint || ''),
            onChange: function (event) { patch(field.key, event.target.value); },
          });
        }
        children.push(h('div', { key: 'f' + String(index), style: styles.row },
          h('span', { style: styles.label }, field.label),
          control,
          field.hint !== undefined && field.type !== 'area'
            ? h('span', { style: styles.hint }, field.hint)
            : null));
      });

      children.push(h('div', { key: 'actions', style: styles.row },
        h('button', { style: styles.button, disabled: !writable || busy || !dirty, onClick: save },
          busy ? '保存中…' : (dirty ? '保存改动' : '没有改动')),
        h('button', {
          style: styles.button,
          disabled: !writable || busy || !dirty,
          onClick: function () { setDraft({}); setMsg(null); },
        }, '撤销'),
        h('span', { style: styles.note }, '密钥字段留空表示不修改；改完即时生效，不用重载插件。')));

      if (msg !== null) {
        children.push(h('div', { key: 'msg', style: msg.kind === 'error' ? styles.error : styles.ok }, msg.text));
      }
      return h('div', { style: styles.card }, children);
    }

    /** 装配：注入 slot；任何异常都只影响本卡片，不影响整站。 */
    function apply(ctx, config) {
      try {
        if (ctx === undefined || ctx === null || ctx.slots === undefined || ctx.slots === null) return;
        ctx.slots.inject('plugins.bundle.config', function () {
          try {
            return ctx.slots.register(
              { name: 'plugins.bundle.config', key: PKG_NAME, inject: function () { return { ctx: ctx, config: config }; } },
              VoiceSection,
            );
          } catch (error) {
            return null;
          }
        });
      } catch (error) {
        // 静默：卡片没了总比整站白屏好
      }
    }

    module.exports = {
      apply: apply,
      inject: ['slots', 'configForms'],
      VoiceSection: VoiceSection,
      FIELDS: FIELDS,
    };
    return module.exports;
  },
});
