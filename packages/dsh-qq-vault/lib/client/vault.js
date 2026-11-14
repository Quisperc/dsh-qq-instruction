/**
 * dsh-qq-vault —— 客户端半（浏览器）：设置页里的「QQBot 备份」卡片。
 *
 * 契约（照抄 dsh-qq-bot@0.12.8 的 client 半，v0.6 真机验证过）：
 *   window.__ModuleLoader__.load({ id, factory }) —— **id 必须等于 npm 包名**，
 *   否则报 "loaded without registering ..." 并导致本插件客户端整块失败。
 *   只有 `react` 是外部依赖；其余全靠 fetch 调 host 半挂的 /dsh-qq-vault/* 路由。
 *
 * ⚠️ **只能用 GET**：DSH 的 HTTP 层在路由匹配前就把非 GET/HEAD 挡成 405
 *   （dsh-host-webserver/lib/index.js:428 与 :600，RESOURCE_METHODS = "GET, HEAD"）。
 *   所以参数一律走 query string；**没有上传控件**——导入要求文件已在服务器上，
 *   把包放到 `$DSH_HOME/backups/qqbot-vault/` 后填文件名（或填任意绝对路径）。
 *
 * 防御要求（违反会导致全站故障）：
 *   1. 注册动作整体 try/catch，失败就什么都不注册；
 *   2. 渲染再包一层 try/catch，异常时渲染提示卡片，绝不让 React 树崩；
 *   3. 没有 fetch / 没有宿主路由时降级成只读说明。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qq-vault',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    var PKG_NAME = 'dsh-qq-vault';
    var API = '/dsh-qq-vault';
    // 上传走 Connection 的 exact 路由（在 /api 下，允许 POST），不是 webServer 的 GET-only 路由
    var UPLOAD_PATH = '/api/dsh-qq-vault/upload';

    /**
     * 错误码 → 中文提示。host 半从 0.3.0 起返回结构化 `{code, message}`，
     * 客户端优先用 code 映射（文案可改），拿不到 code 才回落到 message，
     * 再拿不到就用 HTTP 状态，保证永远有话说。
     */
    var CODE_TEXT = {
      'bad-request': '参数不对，检查一下勾选项或路径',
      'not-found': '找不到这个文件，确认它还在备份目录里',
      'bad-bundle': '这不是本插件导出的备份包（缺 manifest 或已损坏）',
      'version-mismatch': 'DSH 主次版本不一致，需要显式强制才能导入',
      'integrity-failed': '完整性校验失败：包内容与 manifest 不符，可能传输损坏',
      'nothing-to-import': '这个包里没有可导入的内容',
      'token-missing': '缺少确认码，先点「预览」',
      'token-invalid': '确认码无效（可能来自重启前），请重新预览',
      'token-expired': '确认码已过期，请重新预览',
      'token-used': '确认码已用过，请重新预览',
      'token-mismatch': '确认码与文件不匹配，请对着同一个文件重新预览',
      'write-required': '导入必须显式确认（write=1）',
    };

    /** 把 host 返回的失败转成一句人话。 */
    function failureText(data, status) {
      if (data !== null && typeof data === 'object') {
        var byCode = data.code !== undefined ? CODE_TEXT[data.code] : undefined;
        if (byCode !== undefined) return byCode + (data.message ? '（' + data.message + '）' : '');
        if (typeof data.message === 'string' && data.message !== '') return data.message;
        if (typeof data.error === 'string' && data.error !== '') return data.error;
      }
      return 'HTTP ' + status;
    }

    /** 四个可勾选项；`sensitive` 的会在 UI 上标红。 */
    var ITEMS = [
      { key: 'config', label: 'QQBot 配置', hint: 'cordis.patch.yml 里的 dsh-qq-bot 段（含 NapCat token、QQ 号、人设卡）', sensitive: true },
      { key: 'persona', label: '人格（生效值）', hint: '备份 cordis.patch.yml 里 dsh-qq-bot.config.persona.text——这才是机器人真正用的人格；仓库 persona/whale.md 仅作附带副本', sensitive: false },
      { key: 'memory', label: '记忆库', hint: 'QQ_msg/.dsh-meow/memory.db（群聊与私聊共用，可能含他人隐私）', sensitive: true },
      { key: 'whaleConfig', label: 'whale 配置段', hint: 'cordis.patch.yml 里的 dsh-qq-whale 段（含工具白名单等四项）', sensitive: false },
    ];

    function messageOf(error) {
      if (error === null || error === undefined) return '未知错误';
      return typeof error.message === 'string' ? error.message : String(error);
    }

    /** GET + query；非 2xx 也解析成 JSON，便于 UI 显示原因。 */
    function getJson(path, params) {
      var query = [];
      var source = params || {};
      for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        var value = source[key];
        if (value === undefined || value === null || value === '') continue;
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
      }
      var url = API + path + (query.length > 0 ? '?' + query.join('&') : '');
      return fetch(url, { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(function (res) {
          return res.json()
            .then(function (data) { return { data: data, status: res.status }; })
            .catch(function () { return { data: { ok: false }, status: res.status }; });
        });
    }

    /** 拼下载 URL（浏览器直连，带 cookie 过 browserAuth）。 */
    function exportUrl(keys) {
      return API + '/export' + (keys.length > 0 ? '?include=' + encodeURIComponent(keys.join(',')) : '');
    }

    function formatBytes(bytes) {
      var n = Number(bytes) || 0;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    var box = { border: '1px solid var(--dsh-border, #d6d6d6)', borderRadius: 8, padding: 12, marginBottom: 12 };
    var muted = { opacity: 0.72, fontSize: 12, lineHeight: 1.5 };
    var danger = { color: 'var(--dsh-danger, #c0392b)', fontSize: 12 };
    var button = { padding: '6px 14px', borderRadius: 6, cursor: 'pointer' };
    var input = { fontSize: 12, padding: '4px 8px', width: '100%', boxSizing: 'border-box' };

    /** 主卡片。 */
    function VaultSection() {
      var includeHook = useState({ config: false, persona: false, memory: false, whaleConfig: false });
      var include = includeHook[0];
      var setInclude = includeHook[1];

      var planHook = useState(null);
      var plan = planHook[0];
      var setPlan = planHook[1];

      var busyHook = useState('');
      var busy = busyHook[0];
      var setBusy = busyHook[1];

      var errorHook = useState('');
      var error = errorHook[0];
      var setError = errorHook[1];

      var pathHook = useState('');
      var bundlePath = pathHook[0];
      var setBundlePath = pathHook[1];

      var previewHook = useState(null);
      var preview = previewHook[0];
      var setPreview = previewHook[1];

      var confirmHook = useState(false);
      var confirmed = confirmHook[0];
      var setConfirmed = confirmHook[1];

      var importHook = useState(null);
      var imported = importHook[0];
      var setImported = importHook[1];

      var bundlesHook = useState([]);
      var bundles = bundlesHook[0];
      var setBundles = bundlesHook[1];

      var capsHook = useState(null);
      var caps = capsHook[0];
      var setCaps = capsHook[1];

      var uploadNoteHook = useState('');
      var uploadNote = uploadNoteHook[0];
      var setUploadNote = uploadNoteHook[1];

      var cleanupHook = useState(null);
      var cleanup = cleanupHook[0];
      var setCleanup = cleanupHook[1];

      var cleanupConfirmHook = useState(false);
      var cleanupConfirm = cleanupConfirmHook[0];
      var setCleanupConfirm = cleanupConfirmHook[1];

      /** 刷新备份目录列表（导出后、清理后都调一次）。 */
      function refreshBundles() {
        return getJson('/list-bundles', {})
          .then(function (res) {
            if (res.data !== null && res.data.ok === true) setBundles(res.data.files || []);
          })
          .catch(function () { /* 列表拿不到不影响手动填路径 */ });
      }

      // 首次挂载：拉能力清单（拿 backupDir 与"未实现项"）与备份包列表
      useEffect(function () {
        getJson('/capabilities', {})
          .then(function (res) { if (res.data !== null && res.data.ok === true) setCaps(res.data); })
          .catch(function () { /* 忽略 */ });
        refreshBundles();
      }, []);

      function selectedKeys() {
        var keys = [];
        for (var i = 0; i < ITEMS.length; i += 1) {
          if (include[ITEMS[i].key] === true) keys.push(ITEMS[i].key);
        }
        return keys;
      }

      function onToggle(itemKey) {
        setInclude(function (prev) {
          var next = { config: prev.config, persona: prev.persona, memory: prev.memory, whaleConfig: prev.whaleConfig };
          next[itemKey] = prev[itemKey] !== true;
          return next;
        });
        setPlan(null);
      }

      function doPlan() {
        setBusy('plan');
        setError('');
        getJson('/plan', { include: selectedKeys().join(',') })
          .then(function (res) {
            var data = res.data;
            if (data === null || data.ok !== true) { setError(failureText(data, res.status)); return; }
            setPlan(data);
          })
          .catch(function (err) { setError(messageOf(err)); })
          .then(function () { setBusy(''); });
      }

      /** 导出走浏览器直连下载（GET，Content-Disposition: attachment）。 */
      function doExport() {
        setError('');
        try {
          var url = exportUrl(selectedKeys());
          var link = document.createElement('a');
          link.href = url;
          link.download = '';
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          // 下载是异步的，稍等再刷新列表，让新包出现在下拉里
          setTimeout(function () { refreshBundles(); }, 1200);
        } catch (err) {
          setError(messageOf(err));
        }
      }

      /**
       * 上传本地文件到 host（POST /api/dsh-qq-vault/upload）。
       * 为什么不是 webServer 路由：它只放行 GET/HEAD；上传走 Connection 的 exact 路由表。
       * 失败时不假装成功——把原因显示出来，让用户回退到从列表选/填路径。
       */
      function doUpload(file) {
        if (!file) return;
        setBusy('upload');
        setError('');
        // Content-Length 由浏览器自动带；这里只需 application/octet-stream
        fetch(UPLOAD_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        })
          .then(function (res) {
            return res.text().then(function (text) {
              var data = null;
              try { data = JSON.parse(text); } catch (_) { /* 非 JSON */ }
              if (res.status !== 200 || data === null || data.ok !== true) {
                throw new Error(failureText(data, res.status));
              }
              setBundlePath(data.path || '');
              setPreview(null);
              setImported(null);
              setConfirmed(false);
              setUploadNote('已上传 ' + (data.bytes !== undefined ? data.bytes : 0) + ' 字节，点「预览将导入什么」继续');
            });
          })
          .catch(function (err) {
            setUploadNote('');
            setError('上传失败：' + messageOf(err) + '（可改用下方列表选择或直接填服务器路径）');
          })
          .then(function () { setBusy(''); });
      }

      function doPreview() {
        setBusy('preview');
        setError('');
        setPreview(null);
        setImported(null);
        setConfirmed(false);
        getJson('/preview-import', { path: bundlePath })
          .then(function (res) {
            var data = res.data;
            if (data === null || data.ok !== true) { setError(failureText(data, res.status)); return; }
            setPreview(data);
          })
          .catch(function (err) { setError(messageOf(err)); })
          .then(function () { setBusy(''); });
      }

      function doImport() {
        if (preview === null || preview.token === undefined) return;
        setBusy('import');
        setError('');
        getJson('/import', { path: preview.path, write: '1', token: preview.token })
          .then(function (res) {
            var data = res.data;
            if (data === null || data.ok !== true) { setError(failureText(data, res.status)); return; }
            setImported(data);
            setPreview(null);
          })
          .catch(function (err) { setError(messageOf(err)); })
          .then(function () { setBusy(''); });
      }

      /** 清理旧备份：先 dry-run 看一眼，再勾确认才真删。 */
      function doCleanup(write) {
        setBusy('cleanup');
        setError('');
        getJson('/cleanup', { keep: 10, write: write === true ? '1' : '' })
          .then(function (res) {
            var data = res.data;
            if (data === null || data.ok !== true) { setError(failureText(data, res.status)); return; }
            setCleanup(data);
            if (write === true) { setCleanupConfirm(false); refreshBundles(); }
          })
          .catch(function (err) { setError(messageOf(err)); })
          .then(function () { setBusy(''); });
      }

      var children = [];

      children.push(h('div', { key: 'title', style: { fontWeight: 600, marginBottom: 4 } }, 'QQBot 备份'));
      children.push(h('div', { key: 'desc', style: muted },
        '导出/导入 QQBot 的配置、人设与记忆。导出为只读；导入会先备份再写入，且需要一次性确认码。'));

      // —— 勾选区 ——
      var itemNodes = ITEMS.map(function (item) {
        return h('label', {
          key: item.key,
          style: { display: 'block', margin: '6px 0', cursor: 'pointer' },
        }, [
          h('input', {
            key: 'cb',
            type: 'checkbox',
            checked: include[item.key] === true,
            onChange: function () { onToggle(item.key); },
            style: { marginRight: 8, verticalAlign: 'middle' },
          }),
          h('span', { key: 'lb', style: { fontSize: 13 } }, item.label),
          h('div', { key: 'ht', style: muted }, item.hint),
          item.sensitive ? h('div', { key: 'warn', style: danger }, '⚠ 含敏感信息（token / 隐私），只走私密通道') : null,
        ]);
      });
      /**
       * 未实现项：**显示为禁用行**而不是消失。
       * 用图形上"灰掉"的 checkbox，让用户明确知道"这是没做，不是没找到"。
       */
      var skippedItems = caps !== null && caps.skipped !== undefined && caps.skipped !== null
        ? caps.skipped
        : [{ key: 'sessions', label: '会话历史', reason: '暂不支持（见文档）' }];
      var sessionsNode = h('label', {
        key: 'skipped-items',
        style: { display: 'block', margin: '6px 0', cursor: 'not-allowed', opacity: 0.55 },
      }, [
        h('div', { key: 'hd', style: { fontSize: 12, marginBottom: 4 } }, '以下数据项暂不支持（显示为禁用）'),
        skippedItems.map(function (item) {
          return h('div', { key: 'sk' + item.key, style: { marginBottom: 4 } }, [
            h('input', {
              key: 'cb',
              type: 'checkbox',
              checked: false,
              disabled: true,
              style: { marginRight: 8, verticalAlign: 'middle' },
            }),
            h('span', { key: 'lb', style: { fontSize: 13 } }, item.label || item.key),
            h('div', { key: 'rs', style: muted }, item.reason || ''),
          ]);
        }),
      ]);

      children.push(h('div', { key: 'items', style: box }, itemNodes.concat([sessionsNode])));

      // —— 导出区 ——
      var backupDirHint = caps !== null && caps.backupDir !== undefined && caps.backupDir !== null
        ? '包会落在 ' + caps.backupDir
        : '';
      children.push(h('div', { key: 'exp', style: Object.assign({}, box, { marginTop: 12 }) }, [
        h('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, '① 导出'),
        h('div', { key: 'b' }, [
          h('button', { key: 'plan', onClick: doPlan, disabled: busy !== '', style: button }, busy === 'plan' ? '计算中…' : '预览将导出什么'),
          h('button', { key: 'go', onClick: doExport, disabled: busy !== '', style: Object.assign({}, button, { marginLeft: 8 }) }, '导出并下载 tar.gz'),
        ]),
        h('div', { key: 'h', style: muted },
          '导出会在服务器生成备份包并直接下载；未勾选任何项时导出全部可导出项。' + backupDirHint),
      ]));

      if (plan !== null && plan.ok === true) {
        var fileNodes = (plan.files || []).map(function (file, index) {
          return h('li', { key: 'f' + index, style: { fontSize: 12 } },
            file.path + ' — ' + formatBytes(file.bytes) + (file.sensitive ? '（敏感）' : ''));
        });
        children.push(h('div', { key: 'plan', style: box }, [
          h('div', { key: 't', style: { fontSize: 13, marginBottom: 6 } },
            '将导出 ' + (plan.files || []).length + ' 项，合计 ' + formatBytes(plan.totalBytes)),
          h('ul', { key: 'l', style: { margin: '4px 0 4px 18px', padding: 0 } }, fileNodes),
          (plan.warnings || []).length > 0 ? h('div', { key: 'w', style: danger }, plan.warnings.join('；')) : null,
        ]));
      }

      // —— 导入区（两步：预览拿 token → 确认执行）——
      var bundleOptions = bundles.map(function (file) {
        return h('option', { key: file.name, value: file.path },
          file.name + '  (' + formatBytes(file.bytes) + ' · ' + String(file.mtime || '').slice(0, 16).replace('T', ' ') + ')');
      });
      children.push(h('div', { key: 'imp', style: Object.assign({}, box, { marginTop: 12 }) }, [
        h('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, '② 导入（先预览，再确认）'),
        h('div', { key: 'h', style: muted },
          '浏览器不能上传文件（HTTP 层只放行 GET）。备份包需先在服务器上：'
          + (caps !== null && caps.backupDir ? caps.backupDir : '$DSH_HOME/backups/qqbot-vault/')
          + '。可以从下面选一个，也可以直接填绝对路径。'),
        h('div', { key: 'pick', style: { marginTop: 8 } }, [
          h('select', {
            key: 'sel',
            value: '',
            disabled: busy !== '' || bundles.length === 0,
            onChange: function (event) { if (event.target.value !== '') setBundlePath(event.target.value); },
            style: Object.assign({}, input, { marginBottom: 6 }),
          }, [
            h('option', { key: 'none', value: '' }, bundles.length === 0 ? '（备份目录里没有包）' : '选择已有备份包…'),
          ].concat(bundleOptions)),
          h('button', {
            key: 'ref',
            onClick: function () { setError(''); refreshBundles(); },
            disabled: busy !== '',
            style: Object.assign({}, button, { fontSize: 12 }),
          }, '刷新列表'),
        ]),
        // 上传：只有 host 报 supported 时才显示（Connection 的 POST 路由不可用时自动隐藏）
        caps !== null && caps.upload !== undefined && caps.upload.supported === true
          ? h('div', { key: 'up', style: { marginTop: 8 } }, [
              h('label', { key: 'l', style: { display: 'block', fontSize: 12, color: muted } }, '或直接上传本地文件（放到备份目录的 uploads/ 下）：'),
              h('input', {
                key: 'f',
                type: 'file',
                accept: '.gz,.tgz,.tar.gz,application/gzip',
                disabled: busy !== '',
                onChange: function (event) {
                  var file = event.target.files && event.target.files[0];
                  doUpload(file);
                  event.target.value = '';
                },
                style: Object.assign({}, input, { paddingTop: 6 }),
              }),
              busy === 'upload' ? h('div', { key: 'b', style: { fontSize: 12, color: muted } }, '上传中…') : null,
              uploadNote !== '' ? h('div', { key: 'n', style: { fontSize: 12, color: 'var(--dsh-success, #2d7d46)', marginTop: 4 } }, uploadNote) : null,
            ])
          : h('div', { key: 'up-no', style: { marginTop: 8, fontSize: 12, color: muted } },
              '此部署不支持直接上传（Connection 路由不可用）：请把包放到服务器备份目录，再用上面的列表选择。'),
        h('input', {
          key: 'path',
          type: 'text',
          value: bundlePath,
          placeholder: 'qqbot-vault-20261114-070000.tar.gz 或 /abs/path/pkg.tar.gz',
          onChange: function (event) { setBundlePath(event.target.value); },
          disabled: busy !== '',
          style: Object.assign({}, input, { marginTop: 8 }),
        }),
        h('button', {
          key: 'pv',
          onClick: doPreview,
          disabled: busy !== '' || String(bundlePath).trim() === '',
          style: Object.assign({}, button, { marginTop: 8 }),
        }, busy === 'preview' ? '解析中…' : '预览将导入什么'),
      ]));

      if (preview !== null && preview.ok === true) {
        var changeNodes = (preview.changes || []).map(function (change, index) {
          var actionText = change.action === 'append' ? '追加' : change.action === 'create' ? '新建' : '替换';
          return h('li', { key: 'c' + index, style: { fontSize: 12 } },
            change.key + ' → ' + actionText + ' ' + change.target + (change.sensitive ? '（敏感）' : ''));
        });
        children.push(h('div', { key: 'pv', style: box }, [
          h('div', { key: 'v', style: { fontSize: 13, marginBottom: 6 } }, preview.version ? preview.version.message : ''),
          preview.integrity !== undefined && preview.integrity !== null
            ? h('div', {
              key: 'ig',
              style: preview.integrity.ok === true ? Object.assign({}, muted, { color: 'var(--dsh-success, #2d7d46)' }) : danger,
            }, (preview.integrity.ok === true ? '✅ ' : '⚠ ') + (preview.integrity.message || '')
              + (preview.integrity.mismatched !== undefined && preview.integrity.mismatched.length > 0
                ? '（不一致：' + preview.integrity.mismatched.map(function (m) { return m.path; }).join(', ') + '）'
                : '')
              + (preview.integrity.missing !== undefined && preview.integrity.missing.length > 0
                ? '（缺失：' + preview.integrity.missing.join(', ') + '）'
                : ''))
            : null,
          h('ul', { key: 'l', style: { margin: '4px 0 4px 18px', padding: 0 } }, changeNodes),
          (preview.warnings || []).length > 0 ? h('div', { key: 'w', style: danger }, preview.warnings.join('；')) : null,
          h('div', { key: 'src', style: muted }, '来源文件：' + (preview.path || '')),
          h('label', { key: 'ok', style: { display: 'block', margin: '8px 0', cursor: 'pointer' } }, [
            h('input', {
              key: 'cb',
              type: 'checkbox',
              checked: confirmed === true,
              onChange: function () { setConfirmed(confirmed !== true); },
              style: { marginRight: 8, verticalAlign: 'middle' },
            }),
            h('span', { key: 'lb', style: { fontSize: 12 } }, '我确认写入（会先自动备份现有配置）'),
          ]),
          h('button', {
            key: 'go',
            onClick: doImport,
            disabled: busy !== '' || confirmed !== true || (preview.version && preview.version.blocked === true),
            style: button,
          }, busy === 'import' ? '导入中…' : '执行导入'),
          h('div', { key: 'ttl', style: muted },
            '确认码 ' + (preview.tokenTtlSeconds || 300) + ' 秒内有效，只能用一次；过期请重新预览。'),
        ]));
      }

      if (imported !== null && imported.ok === true) {
        var stepNodes = (imported.nextSteps || []).map(function (line, index) {
          return h('li', { key: 's' + index, style: { fontSize: 12 } }, line);
        });
        children.push(h('div', { key: 'done', style: box }, [
          h('div', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, '导入完成'),
          h('ul', { key: 'l', style: { margin: '4px 0 4px 18px', padding: 0 } }, stepNodes),
        ]));
      }

      // —— 清理区：只删本插件产出的包，先 dry-run 再确认 ——
      children.push(h('div', { key: 'cln', style: Object.assign({}, box, { marginTop: 12 }) }, [
        h('div', { key: 't', style: { fontWeight: 600, marginBottom: 8 } }, '③ 清理旧备份'),
        h('div', { key: 'h', style: muted },
          '只删备份目录里本插件生成的 qqbot-vault-*.tar.gz，保留最近 10 个；其他文件一律不动。'),
        h('div', { key: 'b', style: { marginTop: 6 } }, [
          h('button', {
            key: 'dry',
            onClick: function () { doCleanup(false); },
            disabled: busy !== '',
            style: button,
          }, busy === 'cleanup' ? '检查中…' : '看看能删什么'),
          cleanup !== null && cleanup.ok === true && cleanup.dryRun === true && cleanup.deleted.length > 0
            ? h('label', { key: 'cf', style: { display: 'inline-block', marginLeft: 12, cursor: 'pointer' } }, [
              h('input', {
                key: 'cb',
                type: 'checkbox',
                checked: cleanupConfirm === true,
                onChange: function () { setCleanupConfirm(cleanupConfirm !== true); },
                style: { marginRight: 6, verticalAlign: 'middle' },
              }),
              h('span', { key: 'lb', style: { fontSize: 12 } }, '确认删除这 ' + cleanup.deleted.length + ' 个'),
            ])
            : null,
          cleanup !== null && cleanup.ok === true && cleanup.dryRun === true && cleanupConfirm === true
            ? h('button', {
              key: 'go',
              onClick: function () { doCleanup(true); },
              disabled: busy !== '',
              style: Object.assign({}, button, { marginLeft: 8, borderColor: 'var(--dsh-danger, #c0392b)' }),
            }, '执行删除')
            : null,
        ]),
      ]));

      if (cleanup !== null && cleanup.ok === true) {
        var delNodes = (cleanup.deleted || []).map(function (file, index) {
          return h('li', { key: 'd' + index, style: { fontSize: 12 } },
            file.name + ' — ' + formatBytes(file.bytes) + (file.action === 'deleted' ? '（已删除）' : '（将删除）'));
        });
        children.push(h('div', { key: 'clnr', style: box }, [
          h('div', { key: 's', style: { fontSize: 13, marginBottom: 6 } },
            cleanup.dryRun === true ? '预览：将删除 ' + cleanup.deleted.length + ' 个，保留 ' + cleanup.kept + ' 个'
              : '已删除 ' + cleanup.deleted.length + ' 个，保留 ' + cleanup.kept + ' 个'),
          h('ul', { key: 'l', style: { margin: '4px 0 4px 18px', padding: 0 } }, delNodes),
          (cleanup.failed || []).length > 0 ? h('div', { key: 'f', style: danger }, '删除失败：' + cleanup.failed.length + ' 个') : null,
        ]));
      }

      if (error !== '') children.push(h('div', { key: 'err', style: danger }, error));

      return h('div', { style: { padding: 4 } }, children);
    }

    /** 渲染兜底：任何异常都只显示一句提示，不让 React 树崩。 */
    function SafeSection(props) {
      try {
        return VaultSection(props);
      } catch (error) {
        return h('div', { style: { padding: 8, fontSize: 12, color: 'var(--dsh-danger, #c0392b)' } },
          '[dsh-qq-vault] 界面渲染失败：' + messageOf(error));
      }
    }

    function apply(ctx) {
      try {
        if (ctx === undefined || ctx === null || typeof fetch !== 'function') return;
        if (ctx.slots === undefined || ctx.slots === null || typeof ctx.slots.inject !== 'function') return;
        // keyed slot：key = bundle 条目 id，出现在「插件 → 本插件 → 配置区」
        ctx.slots.inject('plugins.bundle.config', function () {
          return ctx.slots.register({
            name: 'plugins.bundle.config',
            key: PKG_NAME,
            inject: function () { return {}; },
          }, SafeSection);
        });
      } catch (error) {
        // 注册失败就什么都不做：宁可没有卡片，也不能拖垮别人
        try { console.warn('[dsh-qq-vault] 注册设置卡片失败：', messageOf(error)); } catch { /* 忽略 */ }
      }
    }

    exports.name = PKG_NAME;
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
