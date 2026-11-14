# 变更记录 · dsh-qq-vault

> 只记这个包自己的变化。仓库级变化看根目录 `CHANGELOG.md`。

## [Unreleased]

> 用户诉求：「vault 为导入导出也需要支持等」——新插件的配置也要能备份/迁移。

### Added — 语音插件（dsh-qq-voice）纳入逐项备份

- `- id: dsh-qq-voice` 段进入动态发现：item id 形如 `voice.ttsVoice`、`voice.apiKey`，
  分组为 `voice`（UI 显示名 `dsh-qq-voice（语音回复）`），按本机实际配置动态列出（当前 14 项）
- 敏感标记：`voice.apiKey`、`voice.accessToken` 与 qq-bot 的 token 同级
  （`SENSITIVE_PATTERN` 增补 `apiKey:`，顺带让 qq-bot 的 `imageGen.apiKey` 也正确标敏感）
- 段不存在时分组 `present:false` 且 0 项，不报错——一眼能看出「这台机器没有语音配置可备份」

### Fixed — 前缀映射从 if 链改为查表（防写错段）

- 以前 `previewImport` 按 `id.startsWith('qqbot.')` / `'whale.'` 判断归属，
  `entryIdOf` 又兜底成 qq-bot：新插件的键会被**静默写进 qq-bot 段**（写坏配置且不报错）
- 改为 `lib/constants.js` 的 `ENTRY_GROUP` → `PREFIX_ENTRY` 查表；未知前缀在写回时
  **判该项失败并跳过**，不再猜归属。新增插件只需在条目表登记一行

### Tests

- 新增 `test/voice-item.test.mjs`（6 项）：逐项发现与敏感标记、折行块整块取到（`>-` 不能只剩首行）、
  只应用 1 项时其余字节不变（含注释）、同内容往返零差异、段缺失不报错、不跨条目边界


## [0.5.0] - 2026-11-14

> 用户诉求：「改成每一个导入的配置项都进行对比，由用户进行多选确认再导入；
> 导出也更新为根据每一个配置项，由用户多选后确认导出。」
> 导火索是 0.4.0 的**侵入式**行为：导入时把整个 `- id: dsh-qq-bot` 段整段替换，
> 用户只勾了一项，没勾的那些项连同注释一起被覆盖。

### Breaking — 从「整段替换」改为「逐配置项」

- 配置项 = `config:` 下的一级子键（`onebot` / `persona` / `group` / `reply` / …），
  **动态发现**，不再硬编码清单：qq-bot 0.14 新增的 `reply.bubbleGapMinMs`、
  `sticker.*` 会自动出现在清单里。
- 导出按项打包：`items/<item id>.yml`（如 `items/qqbot.onebot.yml`），
  `manifest.items` 逐项带 `{id, group, label, kind, path, bytes, sha256}`。
- 导入逐项对比：`/preview-import` 返回每项的
  `{action: same|replace|create, changed, current{}, incoming{}, sensitive}`，
  客户端只允许勾选 changed 的行。
- `/import?items=a,b,c` **只应用勾选的项**；未勾选的一律不动。
  逐项执行，任一项失败不回滚其它项，如实返回 `applied[]` 与 `failed[]`。
- 一次性确认码绑定「路径 + 预览时的 item 集合」：换包拒绝（token-mismatch），
  应用一个没预览过的项也拒绝；应用**子集**允许（比预览更少永远更安全）。

### Added

- `GET /items`：列出本机可导出的全部配置项（含 `present` / `bytes` / `sensitive`）。
- `capabilities` 增加 `granular: true`、`itemsEndpoint`、`groups`。
- 写后自检：写入后重新扫描该项，回读内容与预期不一致就判该项失败并跳过，
  绝不把破损的块（缩进坏了的手工包）落进配置。
- `test/granular.test.mjs`（6 项）：导出 3 项 → 预览只报 3 项 → 只应用 1 项 →
  **其余字节与注释逐字不变**；动态发现 0.14 新键；缺段时 create；未勾项绝不写。

### Why 不用 YAML 库（重要设计说明）

- `yaml`（eemeli，能保注释）只在 DSH 自己的 `node_modules` 里，插件运行时**解析不到**；
- `js-yaml` 会把整份文档重新序列化：注释全丢、行宽与引号风格全变。
  用户配置里那些「为什么这么写」的注释是资产，不能因为导入一次备份就没。
- 所以走**行扫描**：按缩进与键名定位一级配置块，整块替换/插入，
  其余字节原样保留（`lib/items.js`，行扫描思路沿自早期 `persona.js`，该模块已在本次删除）。

### Changed

- `/plan`、`/export` 参数从 `include=` 改为 `items=`（`include` 那套键已删除）。
- `verifyBundleIntegrity` 优先读 `manifest.items`（旧包回落 `manifest.files`）。
- 0.4.0 及以前的旧格式包（只有 `files` 没有 `items`）：**拒绝猜测**，
  预览给出「这是旧格式，请用新版重新导出」的提示，不再按整段替换冒险写入。

### Removed

- `mergeEntryBlock` / `normalizeInclude` / `INCLUDE_KEYS`（整段替换的遗留 API）。
  对应测试断言一并删除，理由：语义已被 item 级操作取代，留着会诱导后来者再走回整段替换。
- `lib/persona.js` 与其 10 项测试：人格变成配置项 `qqbot.persona` 之后，
  那个模块在运行路径上**已无人引用**（只剩测试自娱自乐）。块标量读写能力由 `lib/items.js` 覆盖，
  留着是重复实现，删。

## [0.4.0] - 2026-11-14

> 修用户实际反馈的两件事：**人格备份导了不生效**、**想直接上传备份包**。

### Fixed — 人格备份改为「生效值优先」

- 真因：`persona` 这一项此前只复制仓库里的 `persona/whale.md`，
  但机器人真正用的是 `cordis.patch.yml` 里 `dsh-qq-bot.config.persona.text`
  （每个新会话第一轮拼进用户消息）。于是导到新机器人格根本没恢复。
- 导出：从配置里抽出生效文本，存成 `persona/persona.text`；
  仓库源文件仍作为附带副本（`persona/whale.md`）一起打包，方便以后编辑。
- 导入：把 `persona/persona.text` **写回配置**的 `persona.text`（字面块标量，保留缩进与空行），
  不再只是把文件丢回仓库目录。写回发生在配置段合并**之后**，避免被整段替换覆盖。
- 兼容旧包（只有 `persona/whale.md`）：把它当成人格文本写回配置，并在 warnings 里说明「这是旧格式」。
- 预览如实显示「将覆盖 persona.text（N 字符，当前 M 字符）」。
- `capabilities` 增加 `effective` 映射：`persona → config.persona.text`，避免下次又搞错。

### Added — 直接上传备份包（走 Connection 的 POST 路由）

- 上一版因为「webServer 只放行 GET/HEAD」删掉了上传。这次找到正规通路：
  **Connection 的 exact 路由表支持 POST 与 streaming body**
  （`dsh-client-connection/lib/types/rpc.d.ts:119` 的 `ConnectionFetchRoute`；
  官方 `dsh-client-file-upload` 的 `/api/session/uploadFileBinary` 同样写法）。
- host：新增 `POST /api/dsh-qq-vault/upload`
  - 用 `ctx.effect(() => connection.fetch.register(...))` 注册（不残留 handler）
  - 三道校验：必须是 POST、`content-type: application/octet-stream`、gzip 魔数 `1f 8b`
  - 流式落盘（不整块读进内存），上限 64MB，权限 0600，空文件/超限/非 gzip 都不留垃圾
  - 返回 `{ ok, uploadId, bytes, name, path }`，`path` 可直接喂给预览
- client：设置页出现「或直接上传本地文件」，上传成功自动填入路径；
  **拿不到 Connection 路由时如实显示"此部署不支持直接上传"并回退到列表选择**（不假装支持）。
- `capabilities.upload = { supported, path }`，UI 据此决定是否渲染上传控件。
- 新增测试 `test/upload.test.mjs`（6 项：成功落盘/方法闸/类型闸/空文件/非 gzip 无残留/声明超限）。
- 重写 `test/handler-methods.test.mjs`：规则从「一律禁止 POST」改成
  「webServer 路由仍只许 GET；唯一的 POST 必须挂在 connection 且有三道校验」。

### Changed

- `persona` 在 UI 上的文案改为「人格（生效值）」，并说明仓库文件只是副本。
- 测试合计 68 项（bundle 12 / handler-methods 6 / persona 10 / persona-backup 4 / roundtrip 5 / routes 13 / upload 6 / v030 12），
  另有 6 项 live 需 `VAULT_LIVE=1`。


### Fixed（真机联调中发现的另外两处）

- **上传路由路径必须带 `/api` 前缀**：首次注册成 `/dsh-qq-vault/upload`，
  真机 POST 返回 404（不在 `/api` 路由表里）。改为 `/api/dsh-qq-vault/upload`
  后真机返回 200 并落盘到 `<backupDir>/uploads/`，随后 `preview-import` 能读到该文件
  （用假包验证 → 正确报 `bad-bundle`）。已加静态护栏测试锁住这个前缀。
- **仓库根解析回退**：插件跑在宿主进程里，`process.cwd()` 通常不是仓库根，
  导致 `persona/whale.md` 静默漏备份（真机 plan 里只有 persona.text）。
  现在按「显式配置 → `$DSH_QQ_REPO` → cwd → `$DSH_HOME/home/QQBotV2/dsh-qq-instruction`」
  依次探测，命中即用。真机验证 plan 恢复为两个文件（persona.text 4473 + whale.md 10595）。

### Known limitations

- 真实浏览器里的上传（含大文件与网络中断）、`browserAuth` 实际调用、
  `plugins.bundle.config` slot 的渲染位置、真实 WAL 库的 `VACUUM INTO` 仍未真机验证。
- 若宿主没有 `connection` 服务（桌面端/老版本），上传控件自动隐藏，只能用列表或路径。

## [0.3.0] - 2026-11-14

> 「骨架 → 能长期用的插件」：完整性校验、备份列表下拉、清理、结构化错误码、未实现项显式标记。

### Added
- **完整性校验**：`verifyBundleIntegrity()` 按 `manifest.files[].sha256` 逐个比对解包内容。
  预览会给出 `integrity: { ok, checked, missing, mismatched, skipped, blocked, message }`；
  不一致时导入被拦（`force=1` 可强制，但仍如实报告 `ok:false`）。
  旧包（manifest 无 sha256）只提示、不拦。
- **`GET /list-bundles`**：列出备份目录里本插件产出的 `qqbot-vault-*.tar.gz`（含大小与 mtime，倒序）。
  设置页因此可以下拉选择，而不是让用户手打路径。
- **`GET /cleanup`**：清理旧备份。默认 dry-run；`write=1` 才删；只删本插件命名模式、只在本插件备份目录内、
  永远保留最新一个、`keep` 最小为 1。
- **启动清理**：插件启动时删掉备份目录里超过 7 天的包（同样只认本插件命名模式）。
- **结构化错误码**：失败响应统一为 `{ ok:false, code, message, error }`（`error` 与 `message` 同值，兼容 0.2.0 客户端）。
  错误码：`bad-request` / `not-found` / `bad-bundle` / `version-mismatch` / `integrity-failed` /
  `nothing-to-import` / `token-missing` / `token-invalid` / `token-expired` / `token-used` /
  `token-mismatch` / `write-required`。
- 客户端：错误码 → 中文提示映射；备份包下拉 + 刷新；完整性结果行；清理区（先看再删）；
  「会话历史」渲染为**禁用行**并给出原因（不再是一句干巴巴的说明）。
- `capabilities` 增加 `backupDir` 与 `tokenTtlSeconds`，`skipped[]` 每项带 `supported:false`。

### Changed
- 一次性确认码的失败原因拆开：过期 / 已用过 / 路径不匹配 / 无效，各自独立错误码。
  路径不匹配时**不消费** token（用户改回正确路径还能继续用）。
- 包元信息补全：`engines.dsh`、`repository` / `homepage` / `bugs`、`dsh.catalog`、`LICENSE`。

### Fixed
- `cleanup` 的年龄条件此前只在「超出 keep 数量」时才生效，导致启动清理对少量旧包无效；
  现在「超出 keep」或「超过 maxAgeDays」任一成立即清理（但仍保留最新一个）。
- 路由集合从 5 条增加到 7 条后，`handler-methods` 与 `routes` 的静态断言同步更新。

### 测试
- 新增 `test/v030.test.mjs`（11 项）：完整性（正常/篡改/缺文件/旧包）、list-bundles 过滤与排序、
  cleanup dry-run 与真删与 keep 下限、token 五种失败路径（含用 `Date.now` 替身验证过期）、
  结构化错误字段、启动清理年龄条件、导出包 gzip 头与内容。
- **路由注销改用 `ctx.effect()`**（真机 bug）：实测 `set_bundle` 关掉插件后路由仍返回 200，
  说明 `ctx.on('dispose')` 没有触发、handler 残留。后果不止是没清理：重新启用时同名路径
  `register()` 会抛（同表重复路径），旧 handler 继续生效，出现「代码已更新、行为却是旧的」。
  改成官方写法 `ctx.effect(() => webServer.register(...))`，由 Cordis 在 fiber 卸载时执行 disposer。
- 新增 `test/live.mjs`：真机检查（默认 skip，`VAULT_LIVE=1` 才跑），断言 capabilities 的
  `backupDir`/`supported:false`、7 条路由、cleanup dry-run、export 的 gzip 头、非 GET 405、无 token 导入被拒。
  它就是用来抓「单测全绿但宿主里是旧 handler」这类问题的。

- 合计 50 项（另有 6 项真机检查默认 skip）：bundle 12 · routes 13 · handler-methods 8 · roundtrip 5 · v030 12。

## [0.2.0] - 2026-11-14

### Fixed
- **路由一条都没注册**：`inject` 从 `[]` 改为 `['webServer']`。此前 `apply` 早于服务就绪，
  `ctx.get('webServer')` 得到 undefined 后静默 return（真机表现为 GET 404 / POST 405）。
- **全部端点改 GET**：DSH 的 HTTP 层在路由匹配前就把非 GET/HEAD 挡成 405
  （`dsh-host-webserver/lib/index.js:428,600`）。因此删掉 `upload`/`download`，
  导入改为「服务器上已有文件 + 一次性 token」。
- 降级日志明确写「路由未注册」，并加启动自检（注册后用真实 origin 打一次 `capabilities`，把状态码写进日志）。

### Added
- `capabilities`（能力清单）、`preview-import`（预览 + 发一次性 token，5 分钟、一次性、绑定路径）。
- 全链路测试与真机自检脚本联动（`scripts/verify-live.mjs`）。

## [0.1.0] - 2026-11-14

### Added
- 首版：host 半 4 个动作（`planExport` / `runExport` / `previewImport` / `runImport`）+ 客户端卡片。
- 逻辑搬自 `scripts/export-config.mjs` / `scripts/import-config.mjs`：切 `- id: dsh-qq-bot` 段、
  整段替换（绝不产生两段）、记忆库 `VACUUM INTO`（失败回退 db+wal+shm 整组复制）、DSH 主次版本闸。
- 数据项：`config` / `persona` / `memory` / `whaleConfig`，默认全不选。
