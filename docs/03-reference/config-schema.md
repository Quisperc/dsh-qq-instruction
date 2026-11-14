# 配置字段参考（插件 v0.14.0）

> 字段来源：插件包内 `docs/DEVELOPMENT.md` 的真实 schema，非推测。
> **可直接用的版本**：[`../../config/cordis.patch.yml`](../../config/cordis.patch.yml)（已按真实环境填好）。
>
> 改配置：**先改仓库 `../../config/cordis.patch.yml`（真源），再同步到 `$DSH_HOME/profiles/web/cordis.patch.yml`**，
> 两份都要改。**不要改 npm 包内的文件**（升级会覆盖）。
> 完整规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §3.2。

---

## 连接

| 字段 | 默认值 | 说明 |
|---|---|---|
| `protocol` | `onebot11` | 可选 `onebot11` / `onebot12` / `satori` / `milky` / `qqOfficial` |
| `mode` | `forward` | `forward` = DSH 连 NapCat；`reverse` = NapCat 连 DSH |
| `onebot.wsUrl` | `ws://127.0.0.1:3001` | 正向模式目标地址。公网必须 `wss://` |
| `onebot.httpUrl` | `http://127.0.0.1:3000` | **留空**则发送动作也走同一条 WS（单连接双工，推荐） |
| `onebot.accessToken` | `''` | 建议 `openssl rand -hex 32`。`role('secret')`：只写、不下发到浏览器 |
| `onebot.listen` | `0.0.0.0:6199` | 反向模式监听地址。**无 token 时强制退回 127.0.0.1** |

## 人格

| 字段 | 默认值 | 说明 |
|---|---|---|
| `persona.enabled` | `false` | 开启后每个新会话第一轮附一次人格文本 |
| `persona.name` | `''` | 名字 |
| `persona.text` | `''` | 人格全文（放 [`../../persona/whale.md`](../../persona/whale.md) 的内容） |

## 准入

| 字段 | 默认值 | 说明 |
|---|---|---|
| `group.enabled` | `true` | 是否响应群聊 |
| `group.requireAt` | `true` | 群里必须 @ 才回 |
| `group.allow` | `[]` | 群号白名单。**空 = 不额外限制**，生产环境别留空 |
| `private.enabled` | `true` | 是否响应私聊 |
| `private.allow` | `[]` | 用户号白名单 |
| `auth.owners` | `[]` | **必填**。留空则插件不驱动任何会话（fail-closed） |
| `auth.superAdmins` | `[]` | 高级管理员：群管理权限，但不能永久授权 |
| `auth.guestDshTools` | `false` | 访客能否用 DSH 内部工具 |
| `auth.guestToolAllow` | `[]` | 访客可用工具的例外名单 |

## 群管理

| 字段 | 默认值 | 说明 |
|---|---|---|
| `admin.enabled` | `true` | — |
| `admin.manageGroups` | `[]` | 可管理的群；空 = 回退用 `group.allow` |
| `admin.requireGroupAdmin` | `true` | 要求操作者是该群管理员 |
| `admin.prefix` | `/` | 指令前缀 |
| `admin.dryRun` | `false` | **建议先开 true**：只回复将执行什么 |
| `admin.allowConsole` | `false` | 允许 Web UI 会话调用管理工具 |

## 回复与会话

| 字段 | 默认值 | 说明 |
|---|---|---|
| `reply.maxChars` | `1200` | 单条回复上限 |
| `reply.interim` | `true` | 中间发言（长任务先说一句） |
| `perChatSession` | `true` | 每个 QQ 会话一条 DSH 会话 |
| `session.fixedName` | `true` | 会话名固定为 `群聊_<群号>` / `私聊_<QQ号>` |
| `agentPreset` | `''` | 留空 = 部署默认；可选 standard / ptc / minimal / cordis |
| `agentPresetCustom` | `''` | 非空时优先于 `agentPreset`。QQ 场景填 **`qq`**（`dsh-qq-whale` 提供的 `preset-qq`）。⚠️ 两个前提：① 组合树里真有这条 preset（`dsh --profile web --dump-config \| grep preset-qq`），否则新会话会失败；② **只影响新会话**。查不到就留空 |

## 视觉

| 字段 | 默认值 | 说明 |
|---|---|---|
| `vision.enabled` | `true` | — |
| `vision.provider` | `''` | 留空 = 跟随会话模型 |
| `vision.model` | `''` | 独立视觉模型（如 `qwen3-vl-plus`），须声明 `input: [text, image]` |
| `vision.maxImages` | `3` | 单条消息最多送几张图 |
| `vision.downloadTimeoutMs` | `10000` | 图片下载超时 |
| `history.scopeMessages` | `5` | 识图窗口：触发消息往前多少条 |
| `history.imageLimit` | `3` | 窗口内最多识别几张图 |

## 生图

| 字段 | 默认值 | 说明 |
|---|---|---|
| `imageGen.enabled` | `false` | — |
| `imageGen.baseUrl` | `''` | OpenAI 兼容端点 |
| `imageGen.apiKeyEnv` | `IMAGE_API_KEY` | **只写环境变量名**，不写密钥 |
| `imageGen.model` | `seedream-5.0-lite` | — |
| `imageGen.size` | `1024x1024` | — |
| `imageGen.timeoutMs` | `180000` | — |
| `imageGen.poll` | `true` | 异步轮询 |

> ⚠️ DashScope 的 OpenAI 兼容 `/images/generations` 实测返回空，生图需另做工具走 `multimodal-generation`。

## 主动发言

| 字段 | 默认值 | 说明 |
|---|---|---|
| `proactive.enabled` | `false` | — |
| `proactive.groups` | `[]` | 生效群号；**留空 = 不启用** |
| `proactive.intervalMinutes` | `60` | 多久看一次群 |
| `proactive.windowMessages` | `30` | 观察窗口条数 |
| `proactive.minNewMessages` | `6` | 至少新增几条才考虑开口 |
| `proactive.quietHours` | `["23:00-08:00"]` | 静默时段 |
| `proactive.maxPerHour` | `2` | 每小时上限 |
| `proactive.maxPerDay` | `8` | 每天上限 |
| `proactive.minGapMinutes` | `15` | 两次主动之间最小间隔 |
| `proactive.eventGuard` | `true` | — |
| `proactive.staleMinutes` | `15` | 话题已凉就不接 |
| `proactive.topicCooldownMinutes` | `120` | 同一话题冷却 |
| `proactive.maxChars` | `120` | 主动发言长度上限（要短） |
| `proactive.dryRun` | `false` | **建议先开 true**：只记日志不发送 |
| `proactive.speakModel` | `''` | 填了才启用两段式（判断/发言分用两个模型） |
| `proactive.interests` | `''` | 兴趣/话题偏好 |
| `proactive.persona` | `''` | 主动发言时的人格补充 |

## 联网与抓取

| 字段 | 默认值 | 说明 |
|---|---|---|
| `webSearch.proxy` | `''` | 搜索与抓取都走它 |
| `webSearch.maxUses` | `5` | 单回合最多搜索几次 |
| `webSearch.multiEngine` | `true` | 关则落回官方 DeepSeek web_search |
| `moli.enabled` | `false` | `qq_webfetch` 改用无头浏览器渲染（可抓 SPA） |
| `moli.allowGuest` | `true` | 访客能否触发渲染 |
| `moli.rateLimitPerMin` | `5` | 每会话每分钟渲染上限 |
| `imgSearch.enabled` | `true` | 图片反搜 |

## 流程授权

| 字段 | 默认值 | 说明 |
|---|---|---|
| `flowAuth.enabled` | `false` | 敏感工具需私聊动态码 |
| `flowAuth.gatedTools` | `["subagent","workflow","moli_fetch",…]` | 要过闸门的工具名 |
| `flowAuth.grantTtlSeconds` | `30` | 动态码有效期 |
| `flowAuth.maxAttempts` | `5` | 超过则锁定 |
| `flowAuth.lockoutMinutes` | `15` | 锁定时长 |

## 其它

| 字段 | 默认值 | 说明 |
|---|---|---|
| `logAdapterFrames` | `false` | 排障时临时开 true |
| `restart.baseMs` / `maxMs` | `1000` / `30000` | 重连退避区间 |
| `session.fixedName` | `true` | 会话名固定 |
| `flow.deliver` | `private` | 产物流向：`private` / `group:<群号>` / `none` |

---

## 注意事项

- **volatile 字段**（设置页可编辑的）改动即时生效；**连接类字段**（`protocol` / `mode` / 各协议连接参数）改动会重启适配器。
- `onebot.accessToken`、`flowAuth.totpSecret`、`imageGen.apiKey`、`imgSearch.saucenaoKey` 是 `role('secret')`：**只写**，空值不会覆盖已有值。
- 插件只认自己那一行。配置里的残留键会被自动清理，被清掉的键连同旧值会打进日志。
- 升级前备份 `../../config/cordis.patch.yml`。
