# dsh-qq-vault

在 DSH 设置页**按配置项**导出/导入 QQBot 的配置、人设与记忆：导哪项、导给谁，全部由你逐项勾选；导入前逐项对比，只应用你确认的那些——没勾的项与注释一字不改。

> 版本 **0.5.0** · 86 项测试（**80 通过 + 6 项真机检查默认 skip**）· 仓库真机自检 15 项（`node scripts/verify-live.mjs`）
>
> **两条不能忘的平台事实**（0.2.0 踩过）：
> 1. HTTP 层**只放行 `GET`/`HEAD`**，非 GET 在路由匹配前就 405 → 所有端点只能是 GET + query；
> 2. `apply` 里用到的服务必须在 `inject` 声明，否则 `apply` 早于服务就绪、`ctx.get('webServer')` 得 undefined，
>    **一条路由都不会注册**（表现为 404，而不是 405）。

---

## 一、它能做什么

| 动作 | 说明 | 默认 |
|---|---|---|
| 预览导出 | 列出将打包的文件、大小、敏感项警告 | 只读 |
| 导出 tar.gz | 生成到 `$DSH_HOME/backups/qqbot-vault/qqbot-vault-<时间戳>.tar.gz`，直接下载 | 只在点按钮时写 |
| 列出备份包 | 把备份目录里的包列进下拉框（含大小、时间） | 只读 |
| **上传备份包** | 选本地文件 → POST 到 `/api/dsh-qq-vault/upload` → 自动填入路径 | 只在选文件时写 |
| 预览导入 | 选/填包路径 → 完整性校验 → 版本闸 → 列出将改动的条目，并发一次性确认码 | 只读 |
| 确认导入 | 凭确认码写入：先备份配置与记忆库，再整段替换配置、恢复记忆、**写回人格** | 必须勾选确认 + 确认码有效 |
| 清理旧备份 | 只看 / 真删，只删本插件产出的包，保留最近 10 个 | dry-run |

四个数据项（**默认全不选**）：

| key | 内容 | 敏感 |
|---|---|---|
| `config` | `cordis.patch.yml` 里的 `- id: dsh-qq-bot` 段（含 NapCat token、QQ 号、`persona.text`） | ⚠ 是 |
| `persona` | **生效人格**：`dsh-qq-bot.config.persona.text`（写回配置）；附带 `persona/whale.md` 源文件副本 | 否 |
| `memory` | `QQ_msg/.dsh-meow/memory.db` | ⚠ 是（含他人聊天内容） |
| `whaleConfig` | `cordis.patch.yml` 里的 `- id: dsh-qq-whale` 段（通常不存在） | 否 |

**`sessions`（会话历史）不实现**：会话日志是 DSH 私有格式（zstd JSONL + 投影缓存），跨机器恢复会连带
preset 锁与工作区账本一起搬，风险高于收益。UI 上渲染为**禁用行并写明原因**（`capabilities` 里 `supported:false`）。

---

### 1.1 一次真实用法

**换机器 / 备份**（最常见的用法）：

1. 旧机：**设置 → 插件 → 已安装 → QQBot 备份** → 勾选「配置（含 token）」「人格卡」「记忆库」→ 点「导出」→ 浏览器直接下载 `qqbot-vault-<时间戳>.tar.gz`；
2. 把包传到新机（或本机先上传到 `$DSH_HOME/backups/qqbot-vault/`）；
3. 新机同一张卡片 → 选包 → 点「预览差异」→ 看到**逐项**的「未变 / 将替换 / 将新增」→ 只勾你要的那几项 → 点「执行导入」（凭一次性确认码）。

关键点：**没勾的配置项与注释一字不改**。只想恢复人设，就只勾 `qqbot.persona`。

### 1.2 设置页长什么样

```text
┌─ QQBot 备份 ────────────────────────────────────────────────┐
│ 备份目录  /data/dsh/backups/qqbot-vault                     │
│                                                             │
│ ▼ 导出（默认全不选）                                        │
│   [ ] qqbot.onebot      NapCat 连接   ⚠ 含 token     412 B  │
│   [x] qqbot.persona     人格（生效值）             10.6 KB  │
│   [ ] qqbot.group      群白名单                        46 B  │
│   [ ] memory.db         记忆库        ⚠ 含聊天内容  100 KB  │
│                        [ 预览将导出什么 ]  [ 导出 tar.gz ]  │
│                                                             │
│ ▼ 导入（先预览，再确认）                                    │
│   包：[ qqbot-vault-20261114-071002.tar.gz ▾ ] 或上传[选择] │
│   ┌───────────────────────────────────────────────────────┐ │
│   │ 项              动作     当前    包内     勾选        │ │
│   │ qqbot.persona   将替换   4473    4473   [x] 展开对比  │ │
│   │ qqbot.onebot    未变      412     412   [ ]           │ │
│   └───────────────────────────────────────────────────────┘ │
│   确认码：a1b2c3d4（5 分钟内有效，一次性）                  │
│                                   [ 应用选中项（1 项） ]    │
└─────────────────────────────────────────────────────────────┘
```

## 二、安装（三条路径，选一条）

本包与 `dsh-qq-whale` **互相独立**：只做备份的话，装本包就够了。

### 路径 A：插件市场（推荐，能收到更新）

1. 设置 → 插件 → **发现** → 右上角索引菜单 → 「管理索引来源」→ 添加索引 URL：
   `https://quisperc.github.io/dsh-qq-instruction/market/index.json`
   （索引由本仓库自己托管，生成与托管方式见 [`market/README.md`](../../market/README.md)）
2. 搜索 `dsh-qq-vault` → 安装 → 回到插件页**启用**。
3. 侧栏插件 → dsh-qq-vault → 配置区，勾选数据项 → 导出。

### 路径 B：GitHub 直装（不经过市场）

```bash
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-vault'
```

`#<commit>` 要完整 40 位小写 hex，`&path:/packages/dsh-qq-vault` 不能省。

### 路径 C：本地开发（软链，改代码即生效）

`scripts/install-whale.mjs` 只认 whale 包名，装不了本包；照下面三步手工做：

```bash
PROFILE="${DSH_HOME:-/data/dsh}/profiles/web"
PKG=/data/dsh/home/QQBotV2/dsh-qq-instruction/packages/dsh-qq-vault

# 1) 软链
ln -sfn "$PKG" "$PROFILE/node_modules/dsh-qq-vault"

# 2) profile package.json 里登记两处（缺一不可）
#    - dependencies："dsh-qq-vault": "file:/abs/path/packages/dsh-qq-vault"
#      （只加 bundles 的话插件页「已安装」看不到：listBundles 只认 dependencies）
#    - dsh.profile.bundles：追加 "dsh-qq-vault"
```

然后重启 DSH 或 `plugin_manager set_bundle` 关→开。装好后：**侧栏插件 → dsh-qq-vault → 配置区**。

> ⚠️ 不要在这个 profile 里跑 `pnpm install/remove`：`node_modules/@deepseek-ai/*` 是手工软链到宿主安装目录的，
> pnpm 会把它们当多余包删掉，DSH 就起不来了（见 `docs/05-handover/CONVENTIONS.md`）。

---

## 三、端点表

前缀 `/dsh-qq-vault`（GET 部分）。唯一的 POST 是上传，单独列在后面。

| 方法 | 路径 | 参数 | 作用 |
|---|---|---|---|
| GET | `/capabilities` | — | `granular:true`、`itemsEndpoint`、分组、未实现项（`supported:false`）、`effective`、`backupDir`、`upload`、`tokenTtlSeconds` |
| GET | `/items` | — | **本机可导出的全部配置项**（`id`/`group`/`label`/`kind`/`sensitive`/`present`/`bytes`）；配置项是动态发现的 |
| GET | `/list-bundles` | — | 备份目录里本插件的包（`name`/`path`/`bytes`/`mtime`，倒序） |
| GET | `/cleanup` | `keep=10` `maxAgeDays=` `write=1` | dry-run 或真删；只删本插件命名模式 |
| GET | `/plan` | `items=a,b,c` | 只统计勾选项的清单/大小/警告（**只读**；空=全部） |
| GET | `/export` | `items=a,b,c` | 按项生成 tar.gz 并**流式下载**（`Content-Disposition: attachment`） |
| GET | `/preview-import` | `path=<文件名或绝对路径>` `force=1` | 完整性 + 版本闸 + **逐项**差异（`action`/`changed`/`current`/`incoming`）；成功返回 `token` |
| GET | `/import` | `path=...&items=a,b,c&write=1&token=...` | 只应用 `items` 里那些项；逐项执行，返回 `applied[]`/`failed[]` |
| **POST** | **`/api/dsh-qq-vault/upload`** | body=原始字节，`content-type: application/octet-stream` | 上传备份包到 `<backupDir>/uploads/`，返回 `{uploadId, path, bytes}` |

### 为什么不用 YAML 库改配置（重要）

- `yaml`（eemeli，能保注释）只存在于 DSH 自己的 `node_modules` 里，插件运行时**解析不到**；
- `js-yaml` 会把整份文档重新序列化：注释全丢、行宽与引号风格全变。
  用户配置里那些「为什么这么写」的注释是资产，不能因为导入一次备份就没了。

所以走**行扫描**（`lib/items.js`，复用 `lib/persona.js` 的思路）：
按缩进与键名定位 `config:` 下的**一级子键**，整块替换或插入，其余字节原样保留。
配置项**动态发现**，不硬编码清单——qq-bot 0.14 新增的 `reply.bubbleGapMinMs`、`sticker.*`
不用改代码就会出现在 `/items` 里。

写入还有一道**写后自检**：写完立刻把该项读回来，与预期块逐字比对；
不一致（例如手工改包导致缩进坏了）就判该项失败并跳过，绝不把坏 YAML 落进配置。

### 一次性确认码怎么绑（0.5.0 起）

确认码绑定「**路径 + 预览时的 item 集合**」：

- 换包 → `token-mismatch`；
- 要应用一个**没预览过**的项 → 拒绝（不许"预览 3 项、实际写第 4 项"）；
- 应用**子集** → 允许（比预览更少永远更安全，也符合"只勾我要的"）。

### 为什么 GET 与 POST 挂在两套路由上（别再改回去）

```
dsh-host-webserver/lib/index.js:428   if (request.method !== "GET" && request.method !== "HEAD") → 405
dsh-host-webserver/lib/index.js:244   const RESOURCE_METHODS = "GET, HEAD";
```

**webServer 的具名路由**在匹配之前就把非 GET/HEAD 挡成 405，所以那 7 条只能是 GET。

**上传只能挂在 Connection 的 exact 路由表**：它明确支持 POST 与流式 body
（`dsh-client-connection/lib/types/rpc.d.ts:119` 的 `ConnectionFetchRoute`：`path` 是「`/api` 下的绝对路径」、
`methods` 可含 `POST`、`requestBody` 可 `streaming`）。官方 `dsh-client-file-upload` 的
`/api/session/uploadFileBinary` 就是同一写法——那条路由要 `sessionId` 是因为它把回执绑到某个 Agent 的
scope；我们只是把字节落到备份目录，属于部署级操作，用 owner Peer 鉴权就够，**不需要 sessionId**。

上传 handler 有三道校验，缺一不可：

1. 必须是 `POST`；
2. `content-type` 必须是 `application/octet-stream`（避免表单/JSON 混进来）；
3. gzip 魔数必须是 `1f 8b`（否则拒绝并**删掉半截文件**），另有 64MB 上限与 0600 权限。

### 人格：就是 `qqbot.persona` 这一个配置项

人格不再是单独的 `persona/persona.text` 文件，而是**配置项 `qqbot.persona`**——
也就是 `config.persona` 那个块，里面含 `enabled` / `name` / `text`。
`text` 就是机器人每个新会话第一轮真正拼进用户消息的那份文本（**生效值**）。

好处：导入人格＝逐项导入的一项，天然「写回配置」，不存在「备份了文件却没生效」这种错位。
仓库里的 `persona/whale.md` 是独立的一项（`persona.source`，kind=file），只作编辑真源，不直接进会话。

### 导入的前置条件

1. 备份包已放在服务器上。两条路：
   - **直接上传**（推荐）：设置页选本地文件 → 自动 POST 到上表那条路由 → 自动填入路径；
   - 或放到 `$DSH_HOME/backups/qqbot-vault/`（设置页会列出来点选），或填任意绝对路径。
2. 先在页面上「预览」：做完整性校验与版本闸，并发放一次性确认码。
3. 勾选「我确认写入」→ 执行。写入前会自动把现有配置/记忆库改名备份成 `.bak-vault-<时间戳>`。

### 一次性确认码

- `preview-import` 成功时发放 `token`（UUID），存在**内存 Map**：**5 分钟过期、只能用一次、与目标路径绑定**；
- `import` 必须带同一个 `token`；失败原因分开报告：`token-missing` / `token-invalid` / `token-expired` /
  `token-used` / `token-mismatch`；
- **路径不匹配时不消费** token（把路径改回来还能继续用）；
- 进程重启即失效——导入本就该有人在场，这是有意的设计。

### 完整性校验

导出时 `manifest.json` 记录每个文件的 `sha256`。导入预览会重新计算并比对：

- 一致 → `integrity: { ok:true, checked:N }`，显示 ✅；
- 缺失/不一致 → `ok:false` 且 `blocked:true`，**导入被拒**（包多半在传输中损坏）；
- 确认无误可用 `force=1` 强制，但结果仍会如实显示 `ok:false`；
- 旧版本包（manifest 没有 `sha256`）只提示、不拦。

### 结构化错误

所有失败响应：`{ ok:false, code, message, error }`（`error` 与 `message` 同值，兼容 0.2.0 客户端）。

| code | 含义 |
|---|---|
| `bad-request` | 参数不对（缺 path、导出无可导出项等） |
| `not-found` | 找不到文件 |
| `bad-bundle` | 不是本插件的包 / 解包失败 |
| `version-mismatch` | DSH 主次版本不同，需要 force |
| `integrity-failed` | 完整性校验失败 |
| `nothing-to-import` | 没有要应用的项（没勾任何项，或所选项目与目标完全一致） |
| `token-*` | 确认码的四种失败 |
| `write-required` | 没带 `write=1` |

### 鉴权

插件具名路由在 DSH 鉴权层**之前**被处理（`/api/*` 回 401，而 `/dsh-qq-vault/*` 回 200），所以自带两道闸：

1. 同源校验（`Origin`/`Referer` 与 `Host` 必须一致）；
2. `ctx.get('connection').browserAuth.isAuthenticated(req, secure)` —— **请求期惰性取**，
   所以 `inject` 不声明 `connection`（桌面端/老版本没有鉴权层时要能降级）。

拿不到 `browserAuth` 时只做同源校验并告警一次。

> 本机 `ONEPANEL_DSH_AUTH_PROXY=1` 时，`browserAuth.isAuthenticated` 直接返回 true——
> 鉴权由前面的 Caddy 负责，这是环境行为，不是本插件放水。

### 启动自检与启动清理

注册完路由后：取 `webServer.getOrigin()` 发一次 `GET /capabilities`，把状态码写进日志
（`401` 属正常：自检无会话凭据，说明路由已挂上；`404` 才是"没注册"）。

同时清理备份目录里超过 7 天的包（只认 `qqbot-vault-*.tar.gz`，永远保留最新一个）。

---

## 四、Client 半

`lib/client/vault.js`，遵守 DSH 客户端模块契约：

```js
window.__ModuleLoader__.load({ id: 'dsh-qq-vault', factory: (require) => module.exports })
```

- `id` 必须等于 npm 包名（否则 `loaded without registering ...`，本插件客户端整块失败）；
- 只有 `react` 是外部依赖；
- 注册与渲染各包一层 try/catch：注册失败就什么也不挂，渲染异常只显示一行提示，
  **绝不让 React 树崩**（compose 失败会放大成全站白屏）；
- 数据走 `fetch('/dsh-qq-vault/*')`，GET + query，`credentials: 'same-origin'`；
- 「导出」用 `<a download>` 直连 `/export?...`（浏览器带 cookie，能过 browserAuth）；
- 「上传」用 `fetch('/api/dsh-qq-vault/upload', {method:'POST', body: File})`，
  `content-type: application/octet-stream`；成功后把返回的绝对路径填进输入框；
  **只有 `capabilities.upload.supported === true` 才渲染这个控件**，
  否则显示「此部署不支持直接上传，请把包放到服务器再用列表选择」——不假装支持；
- 「导入」两步：选择/填写/上传路径 → 预览（显示版本、完整性、changes、warnings）→ 勾选确认 → 执行；
- 「清理」两步：先 dry-run 看清单 → 勾选确认 → 真删。

---

## 五、测试

```bash
cd packages/dsh-qq-vault
node --test test/*.mjs      # 86 项（80 通过 + 6 项 live 默认 skip）
```

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `bundle.test.mjs` | 17 | 段定位、**块定位（一级键边界/嵌套同名键/块标量）**、动态发现、plan 只算不写、写回只动一项 |
| `granular.test.mjs` | 7 | **逐项核心验收**：导出 3 项只报 3 项、只应用 1 项其余逐字不变、0.14 新键自动发现、缺段 create、未勾项绝不写 |
| `routes.test.mjs` | 13 | 8 条 GET 路由、鉴权、405 护栏、export 头与魔数、token 全路径、全链路导入 |
| `roundtrip.test.mjs` | 6 | 导出→预览→只应用其中一项、只应用 memory 时配置零改动、幂等 |
| `persona-backup.test.mjs` | 5 | **人格项带的是配置里的生效文本**、源文件独立成项、只导入人格时传输配置不变、旧格式包被拒 |
| `upload.test.mjs` | 6 | 上传成功落盘/0600、方法闸、类型闸、空文件、非 gzip 无残留、声明超限 |
| `handler-methods.test.mjs` | 7 | 静态护栏：webServer 路由只许 GET、唯一 POST 必须挂 connection 且有三道校验、`ctx.effect` 注销、客户端逐项交互 |
| `v030.test.mjs` | 12 | 完整性（正常/篡改/缺文件/旧包）、list-bundles、cleanup、token 五种失败、错误码、启动清理 |
| `live.mjs` | 6（默认 skip） | 真机检查：capabilities 新字段、8 条路由、cleanup dry-run、export gzip、405、无 token 导入 |

测试全程只碰 `/tmp` 下的合成目录，**没有读写任何真实配置或记忆库**。

> **先决条件**：本包不锁依赖，运行时依赖由宿主 DSH 提供（`@deepseek-ai/*` 未发布到公开 npm）。
> 在干净克隆里跑测试前，先在本目录建软链指向宿主依赖：
> ```bash
> ln -s /path/to/dsh/profiles/web/node_modules node_modules
> ```
> 直接 `npm install` 装不到 `@deepseek-ai/schemastery` 这类包，会报 `MODULE_NOT_FOUND`。

真机自检（对运行中的服务）：

```bash
node scripts/verify-live.mjs          # 15 项，只读、不发消息
node scripts/verify-live.mjs --json   # 机器可读
VAULT_LIVE=1 node --test test/live.mjs  # 6 项（需重启后跑，见下）
```

## 六、未验证项（如实列出）

| 项 | 状态 | 说明 |
|---|---|---|
| 真实浏览器里点击上传、大文件、网络中断 | ❌ 未验证 | handler 有单测，浏览器端只做了静态契约测试 |
| `connection.fetch.register` 在真实宿主上是否接受本路径 | ⚠️ 待真机 | 路径规则是「`/api` 下绝对路径」，与官方 file-upload 一致 |
| `browserAuth` 实际调用 | ⚠️ 未验证 | 本机 `ONEPANEL_DSH_AUTH_PROXY=1` 时它首行即放行，鉴权由 Caddy 承担 |
| `plugins.bundle.config` slot 的渲染位置 | ⚠️ 未验证 | keyed slot 的实际落点由 DSH 决定 |
| 真实 WAL 库的 `VACUUM INTO` | ⚠️ 未验证 | 测试走的是 raw-copy 回退分支 |
| 过期确认码在浏览器里的文案 | ✅ 有单测 | 错误码区分 expired/used/mismatch/invalid |

## 七、已知限制

- **只能 GET**、**不能从浏览器上传**——都是平台限制（见上）。
- 不改 `dsh-qq-bot` 配置以外的任何东西；导入只写 profile 的 `cordis.patch.yml`、记忆库、人格真源，且必须显式确认 + 有效 token。
- 记忆库导入是**改名为 `.bak-vault-<ts>`** 而非删除；回滚把备份改回原名即可。
- 版本闸按**主次版本**比较（`0.2.2-rc.3 → 0.2`），跨版本需 `force=1`。
- `cleanup` 只删本插件命名模式、只在本插件备份目录内、永远保留最新一个、`keep` 最小为 1。
- 启动自检请求没有会话凭据，`401` 是正常的。

---

## 八、回滚

| 场景 | 动作 |
|---|---|
| 导入后配置不对 | `cp cordis.patch.yml.bak-vault-<ts> cordis.patch.yml`，再 `set_bundle` 关→开 |
| 导入后记忆库不对 | `mv memory.db.bak-vault-<ts> memory.db`（连带 `-wal`/`-shm` 一起恢复） |
| 想撤销整个插件 | 从 `dependencies` 与 `dsh.profile.bundles` 移除 `dsh-qq-vault`、删软链、重启 |
| 误删了备份包 | 本插件只删 `qqbot-vault-*.tar.gz`，且保留最新一个；其它文件它从不碰 |

---

## 九、依赖与测试

**依赖从哪来**：本插件**零运行时依赖**（只用 Node 内置模块）。测试需要 `node --test`（Node ≥ 22.6）。
本仓库**故意不提交 `package-lock.json`**：开发机的 `node_modules` 是指向宿主 DSH profile 的软链，
据它生成的 lock 只反映本机路径，换台机器 `npm ci` 必然失败。

```bash
npm test                                  # node --test test/*.mjs（75 项，live 默认 skip）
VAULT_LIVE=1 node --test test/live.mjs    # 真机 6 项（需要 127.0.0.1:3080 在跑）
```

> 早期版本曾配套 `scripts/export-config.mjs` / `import-config.mjs`（命令行版）；
> 那两个脚本已删除 —— 功能由本插件覆盖，且这里多了完整性校验、一次性确认码与清理。
