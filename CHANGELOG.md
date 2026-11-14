# 变更记录

> 格式参考 Keep a Changelog，版本遵循 SemVer。
> 每次改动都要记一笔——**半年后你会想知道当时为什么这么改**。
> 版本号是**双轨**的（项目本体 + 插件包），规则见 CONTRIBUTING §6。

## [1.35.0] - 2026-11-15（修 qq_voice 被白名单拦：名单改为现读）

### Fixed — dsh-qq-whale v0.14.1
- **根因**：`installGuard(agent, cfg.allowTools)` 在 **agent 创建时把白名单快照进闭包**。QQ 会话的 agent 长期存活，
  所以 2026-11-15 加入白名单的 `qq_voice` 对老会话永远不可用（用户实际报错：「QQ 场景：工具 qq_voice 不可用」）。
- **修复**：`installGuard` 接受**函数**，每次调用现读配置；现读取值失败时回退出厂名单（拦截照旧，不会因读配置出错而全放开）。
- **另一半症状**：`hideToolsAtFirstStep` 原来「首步隐藏成功即解绑」，名单变化后再也不更新 → 新工具对老会话不可见。
  改为按**名单指纹**去重：名单没变立刻返回，变了才重新 `restrict`。
- 新增 2 项回归测试（现读生效 / 名单变化后重新应用）；whale 测试 59 → **61 项**

## [1.34.0] - 2026-11-15（语音参数全量开放 + 变更手册）

### Added — dsh-qq-voice v0.3.0：官方参数全量可调，模型自决
- 新增工具参数 `rate`（语速 0.5–2.0）、`pitch`（音调 0.5–2.0）、`volume`（0–100），加上既有 `voice`/`seed`/`style`
- 配置新增 `defaultRate`/`defaultPitch`/`defaultVolume`；优先级「工具值 > 配置默认 > 不传」
- 越界**夹到边界并在 `notes` 说明**（服务端对 `rate=3.0` 直接 400，夹取是必须的）
- 模板支持 `{{rate}}`/`{{pitch}}`/`{{volume}}`（数字占位，缺值渲染成官方默认，避免占位符留在 JSON 里）
- 真机实测：`rate=0.5` 时长翻倍、`rate=2.0` 减半；⚠️ `pitch=0.5` 产出约 12 秒异常音频，工具描述建议 0.8–1.2 微调
- 测试 108 → **121 项**

### Added — docs
- `docs/05-handover/CHANGE-PLAYBOOK.md`（190 行）：按**变更类型**索引的 9 类清单（A 新插件 / B 新工具 / C 新配置项 / D 新厂商端点 / E 新 preset 行 / F 敏感能力 / G 文档 / H 发版上架 / I 下线能力），每类含文件级清单 + 必加测试 + 文档同步 + 坑 + 验收命令
- 与 `FEATURE-CHECKLIST`（流程顺序视角）互补，三处交叉指引
- `OPERATIONS §11.5.1`：官方参数全表 + 实测结果 + 「为什么参数放工具描述而非系统提示」的依据

### Changed
- 根 `npm test` 补上 voice 包（原来只聚合 whale + vault）

## [1.33.0] - 2026-11-15（语音参数交给模型 + vault 纳管语音配置 + Pages 修复）

### Added — dsh-qq-voice v0.2.0：参数由模型自决
- 工具新增可选 `voice`（id 或目录里的名字）、`seed`、`style` → `input.instruction`
- 配置新增 `voices`（可选音色目录，**工具描述动态列出**，模型据此挑音色）、`seedMode`（model/fixed/random）、`defaultSeed`
- 模板支持 `{{seed}}` / `{{instruction}}`；音色不在目录里会被拒绝（防模型编 id）
- 测试 81 → **108 项**

### Added — dsh-qq-vault v0.6.0：语音配置纳入逐项备份
- 新增 `voice.*` 分组（真机 17 项），`voice.apiKey` / `voice.accessToken` 标敏感
- 前缀→条目映射改查表：**未知前缀不再兜底写进 qq-bot 段**（原来会静默写错位置）
- 测试 92 项（含 6 项 voice 专项）

### Fixed — GitHub Pages 构建失败
- 根因：`packages/dsh-qq-voice/node_modules`（指向宿主 profile 的**符号链接**）被 `git add -A` 提交，Jekyll 遇到仓库外软链直接失败（连续 3 次 errored）
- 已 `git rm --cached` 并从 `.gitignore` 补不带斜杠的 `packages/*/node_modules`（同时匹配目录与软链）
- 修复后 Pages 构建 `built`，索引三个插件均可访问

## [1.32.0] - 2026-11-15（TTS 接通自定义音色 + voice 插件规范对齐）

### Added — TTS 真机接通（qianwenai 平台）
- 正确非实时端点：`POST https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer`
  （`aigc/multimodal-generation/generation` 对 3.1 系列报 `url error`）
- 可用型号 `qwen-audio-3.0-tts-flash`；请求体 `{model, input:{text, voice, format, sample_rate, seed}}`（**seed 在 input 里**）
- **用 `samples/龙灵安希-样本.wav` 复刻出音色**：`qwen-audio-3.0-tts-flash-longlinx-efc30de0…`
  （复刻接口 `/api/v1/services/audio/tts/customization`，`action:create_voice`，prefix ≤10 位字母数字）
- 端到端实测：合成 → 196KB WAV → 自己那条只发不收的 WS → `messageId` 返回

### Changed — dsh-qq-voice 规范对齐（向 vault 看齐）
- 新增 `test/package-meta.test.mjs`（10 项）锁住元信息/catalog/exports/files/图标/locale/可选 peer/无 lockfile → 测试 71 → **81 项**
- README 重写为 discover 页可读结构（真实用法 / 设置页 ASCII / 型号端点对照表 / 复刻音色两步 / 卸载）
- 图标统一为另两个包同款圆角瓦片风格
- 文档登记：`plugin-inventory`、`tool-surface`（白名单 25 项 + `qq_voice` 行）、`OPERATIONS §11.5`（型号与端点）

## [1.31.0] - 2026-11-15（ADR-013：语音路线与协议评估）

### Added
- `docs/04-explanation/decisions/ADR-013-voice-tts-stt-route.md`：按「先规范后功能」补齐语音决策记录
  - F1 入站丢音频（CQ 串与段数组两条路径的实证行号）
  - F2 出站支持 record 但**无入口**（6 条路由、无 provide、工具只有 text/image）
  - F3 社区插件错位：腾讯官方 `dsh-qqbot`（AppID 协议，有 `sendVoice`）、`dsh-xiaomi-tts`（联动的是官方协议工具）、`dsh-plugin-tts`（浏览器朗读）、`dsh-voice-mode`（麦克风 ASR）
  - D1 自建只发不收的 WS；D2 STT 等上游；D3 暂不切协议（需用户拍板）

### Notes
- 计费阻断记录：`maas.qianwenaiapi.com` 全模型 403 Unpurchased；DashScope `qwen3-tts-flash` 由 200 转 400 Arrearage

## [1.30.0] - 2026-11-15（TTS 真机打通）

### Fixed（真机踩出来的）
- **默认 TTS 模型不对**：`qwen-audio-3.1-tts-flash` 是**实时(WS)型号**，用 HTTP 调会返回 400 `url error`；
  HTTP 可用的是 **`qwen3-tts-flash`**（实测 200，返回 WAV URL）。默认值与文档、设置页提示、测试断言一并改正。
- 响应结构记录：`output.audio.url`（`data` 为空串，要再下载一次）

### Verified（真机端到端）
- 合成 2.5 秒 → WAV 146 KB → 自己的 WS 发 `record` → `messageId` 返回
- 全链路在拥有者私聊验证通过（不打扰群）

## [1.29.0] - 2026-11-15（新增 dsh-qq-voice：语音回复）

### Added
- **新插件 `dsh-qq-voice` v0.1.0**：给 QQ 会话加语音回复（TTS）。71 项测试全过。
  - 自己连一条 OneBot WS，**只发不收**（qq-bot 出站不支持 record、也不提供任何 Cordis 服务）
  - 实测 `record` + `base64://` **WAV 直发可用**，不需要 silk/ffmpeg
  - DashScope TTS（默认 `qwen-audio-3.1-tts-flash`），走**原生端点**而非 compatible-mode
  - 权限与节流在插件自身：owner 判定（解析消息头「身份:拥有者」）+ 群白名单 + 每小时 6 条 + 10 秒冷却；**解析不到身份就拒绝**
  - 默认关闭（没 key 时开了只会报错）；
- whale 白名单 24 → **25 项**（加 `qq_voice`，否则 hide 模式下模型看不见它）
- 语音引擎选型结论记入 OPERATIONS：DashScope TTS 必须原生端点；`qwen-audio-3.1-flash` 是系列名，合成要用 `-tts-flash`

### Known limitations
- DashScope 请求体字段待在拿到 key 后首次真机校验（插件内置 `requestTemplate` 可覆盖，不改代码）
- `mode: always`（每次回复自动附语音）未实现，当前等同 manual
- STT 未做：qq-bot 把入站 record 丢成 `[语音]`，拿不到音频 URL

## [1.28.0] - 2026-11-15（新增功能规范 + 发现页完善）

### Added
- `docs/05-handover/FEATURE-CHECKLIST.md`：9 章 29 条可勾选清单，覆盖「加一个功能要动哪些地方」
  （ADR 判据 / 放哪个包 / 五类必测坑 / 文档六处同步 / 双轨版本与发版三步 / 配置与权限 / 收尾）
- `market/README.md` §1.6：市场详情页的解析顺序（`locale.meta.detail` → 回退包 README），
  结论「改详情页 = 改包 README，不用重新生成索引」
- `market/README.md` §7：新增插件要做什么（元信息 → 进索引 → 验收 → 上架不好用的四种原因）

### Changed
- 两个包 README 各补「一次真实用法」与「设置页长什么样」（ASCII 示意），面向发现页读者
- `market/README.md` 字段来源表拆细到 category / summary / capabilities / 详情长文，带包内行号
- `docs/README.md` 与 `05-handover/README.md` 登记新文件；`CONTRIBUTING` §3 指向新清单

## [1.27.0] - 2026-11-14（生图打通）

### Added
- 启用 `qq_draw` 生图：火山方舟 Seedream 4.0（`doubao-seedream-4-0-20260415`）
- 真相：DashScope 的 compatible-mode **没有** `/images/generations`（实测 404），不是缺 key 的问题
- 端到端验证：qq-bot 自己的 `generateImage` 代码路径 → 200 / 1024x1024 / 286KB，图内容正确

### Notes
- `qq_draw` 硬编码仅拥有者可用；群友触发会被拒（原厂行为，不打补丁）
- 查可用模型的正确姿势：`GET /api/v3/models` 筛 `api_supported["images/generations"]`；同厂商不同日期的 ID 可能一个存在一个 404

## [1.26.0] - 2026-11-14（撤回补丁方案）

### Removed
- 删除 `scripts/patch-qqbot.mjs` 与 npm 脚本 `patch:qqbot`：用户明确否决「通过补丁调整第三方包」这种方式
- `node_modules/@sputnikzaychik/dsh-qq-bot/lib/gateway/turn-runtime.js` 已完整还原（与打补丁前 diff 一致）

### Findings（记下来免得再查一遍）
- 「（本轮没有产生文字回复：…）」是 `turn-runtime.js:505` 的硬编码字面量，**插件无任何配置项可关闭**
- `settings-core-set.json` 里无相关键；npm 最新版即 0.14.0，无更新版本可升
- 实测该会话 14 个 `turn/end` 全是正常结束（reason 只有 `kind`、无 `error`）→ 该提示只在模型一个字都不说时出现
- 结论：要彻底去掉只能走上游（issue/PR 加开关），本机不做 node_modules 改动

## [1.25.0] - 2026-11-14（按用户意愿调回：少干预、多能力）

> 三条「减少替模型做决定」，两条「把能力放开」。

### Changed — dsh-qq-whale
- **移除 preset 系统提示里的输出硬约束**，prefix 恢复为纯风格锚点：`你是群里的聊天搭子，不是助手。说话简短自然。`
  （上一版为了压「回复里带决策过程」加了「不写思考、选项、字数或自评」，用户要求撤回——尊重模型自己的表达）
- `qq_sticker` 加入默认白名单：23 → **24 项**（表情包要用，模型得先看得见这个工具）

### Added — 补丁脚本 `scripts/patch-qqbot.mjs`
- 把 dsh-qq-bot 的「模型没产出文字 → 发一句（本轮没有产生文字回复：…）」改为**只在 turn/end 带 error 时才发**
- 正常结束但没文字 = 模型选择不说，静默跳过（日志留一行）
- 幂等、可 `--revert`、上游版本变了会因锚点不匹配**明确报错**而不是静默跳过
- **升级 dsh-qq-bot 后必须重打**，已写进 `docs/05-handover/OPERATIONS.md`；npm 脚本 `patch:qqbot`

### Changed — 运行配置（profile，非仓库文件）
- `sticker.enabled: true` + `sticker.collect: true`：表情包**存与偷都开启**
- `history.scopeMessages: 5 → 15`：上下文更多
- 说明：`proactive` 于同日早些时候已改为 `dryRun: false` 真开

### Known limitations
- 表情包图库目录 `QQ_msg/sticker` 目前是空的，`qq_sticker` 要等放了图并建索引后才能真挑到图（`POST /dsh-qq-bot/sticker/rebuild`）
- 撤回输出约束后，「回复里带自查过程」可能复现——这是用户明确选择接受的行为（模型不想回就不回、想怎么说就怎么说）

## [1.24.0] - 2026-11-14（仓库迁到公开 GitHub · 文档对齐）

> 仓库从私有 CNB 迁到**公开 GitHub**，插件索引上 GitHub Pages；同时把文档里所有过时的地址与版本对齐到实况。

### Changed — 仓库与发布
- 真源：`cnb.cool/civer/dsh-qq-instruction`（私有）→ **`github.com/Quisperc/dsh-qq-instruction`（公开，clone 无需令牌）**
- 插件市场索引：`https://quisperc.github.io/dsh-qq-instruction/market/index.json`（GitHub Pages，`main` 分支根目录）
- `docs/05-handover/OPERATIONS.md` 新增 **§11 发布与上架**：地址表、发版三步（**先提交包再生成索引**）、改仓库地址、上架官方目录的材料
- `market/README.md` 从「以后要做的」改成现状：索引 URL、Pages 怎么来的、发版顺序、**索引保留历史版本**

### Changed — 文档事实对齐
- 版本基线统一：`dsh-qq-bot 0.14.0` · `whale 0.14.0` · `vault 0.5.0`（README / docs/README / OPERATIONS / plugin-inventory / tool-surface / tts / config-schema）
- **忆图结论改写**：qq-bot 0.14.0 起 `vision.provider`/`vision.model` 都留空时，图片作为**附件直接进会话**；`read_image` 不再是识图主路径（`tool-surface.md` §5 重写、OPERATIONS 两处更正）
- **vault 语义对齐 v0.5.0**：`migrate.md` 的导出/导入章节从「4 个粗粒度勾选 + 整段替换」改为**逐配置项**（`GET /items` 动态发现、`items/` 目录结构、逐项预览与多选、只有变更行可勾）
- 密钥处置章节（`sync-assets.md` §4）从「私有仓库可接受」改为「**已公开**，真实配置不在库内」，并给出 4 步自查

### Fixed
- `README.md` 顶部安全提示：旧文案说「仓库里有真实 token、私有可接受」——已改为「不含任何凭据，模板在 `config/cordis.patch.example.yml`」
- 安装三条路径全部换成 GitHub 地址（市场索引 / `git+…&path:/packages/…` 直装 / 软链开发）

## [1.23.0] - 2026-11-14（vault v0.5.0 逐项备份 · 适配 qq-bot 0.14.0）

> 两件事：备份不再"整段替换"（改成逐配置项对比 + 多选）；跟随 qq-bot 0.14.0 的识图变化删掉过时规则。

### Changed — dsh-qq-vault v0.5.0
- **整段替换 → 逐配置项**：配置项 = `config:` 下的一级子键，**动态发现**（真机 20 项，含 0.14.0 新增的 `reply.bubbleGapMinMs`、`sticker.*`），不硬编码清单
- 新增 `GET /items`；`/plan`、`/export`、`/import` 从 `include=` 改为 **`items=`**，只处理勾选项
- `/preview-import` 逐项返回 `{action: same|replace|create, changed, current, incoming, sensitive}`
- 客户端：导出按组多选（敏感项标红），导入显示逐项差异表，**只有变更行可勾**
- 确认码绑定「路径 + 预览时的 item 集合」：换包拒绝、应用未预览过的项拒绝、应用子集允许
- 旧格式包（≤0.4.0）拒绝猜测，提示用新版重新导出
- 新增 `lib/items.js` + `lib/constants.js`；删掉 `lib/persona.js`（能力已并入 items.js，不留重复实现）
- 测试 86 项（80 通过 / 6 skip）；真机自导入验证：**只应用 1 项时目标配置只有 1 行变化**，注释/缩进/未选中键逐字保留

### Fixed — 逐项写入的两个真 bug
- `previewImport` 漏返回 `key`/`entryId` → 导入时把已有块当新增插入，**同一项被写两遍**
- 行内流式 `config: {…}` 会被插入重复 `config:` 键（YAML 直接坏掉）→ 改为明确报错拒绝写坏配置
- 新增写后自检：写入后回读逐字比对，不一致则该项失败并跳过

### Changed — dsh-qq-whale
- 删除 preset 里「收到图片先用 read_image 打开原图」的规则：`@sputnikzaychik/dsh-qq-bot` **0.14.0** 起，`vision.provider`/`vision.model` 都留空时图片作为**附件随 user 消息直接提交**，会话模型自己看图，不再需要绕路

### Changed — 其它
- `scripts/verify-live.mjs` 跟随 `items=` 语义调整断言（仍 15 项全过）
- 市场索引重新生成（vault 0.5.0）

## [1.22.0] - 2026-11-14（whale v0.14.0 · vault v0.4.0 · 仓库与配置瘦身）

> 主题：**减法**。砍掉重复实现与调试产物，两个插件各自只保留不可替代的那部分；配置目录只留运行时需要的东西。

### Removed — dsh-qq-whale v0.14.0（4 字段 → 2 字段）
- 删 `lib/restrict.js` 与 `exports["./restrict"]`：无调用方，且与 `agent-guard` 的隐藏逻辑重复
- 删 `presetId` 字段：改了必然坏（preset id 由 `cordis.patch.yml` 决定）
- 删 `ctx.provide('whale')` 与 `api`：全仓库无调用方，`apply` 现在只挂一个 `agent/created` 监听
- 白名单去掉 `web_search` / `web_fetch`（与 qq-bot 自带的 `qq_websearch` / `qq_webfetch` 重复），25 → **23 项**
- `cordis.patch.yml` 注释 111 行 → 36 行

### Changed — dsh-qq-whale
- `enabled` + `hideFromModel` **合并为 `mode: off | guard | hide`**：两个布尔能拼出 4 种状态，其中一种自相矛盾
- README 重写为用户手册，含「preset id 能改吗（能，但要同时改三处）」与「卸载顺序（先清 `agentPresetCustom`）」

### Added — dsh-qq-vault v0.4.0
- **人格备份改为「生效值优先」**：导出 `cordis.patch.yml` 里的 `persona.text`（4473 字符），导入时**写回配置**而不只是落文件；新增 `lib/persona.js`（零依赖的 YAML 块标量读写，幂等性已用真实配置验证字节一致）
- **支持直接上传备份包**：走 DSH Connection 的 `/api` POST 通路（webServer 仍只放行 GET），三道校验 + 64MB 上限 + 0600；真机 `curl` 实测 200 落盘
- `capabilities` 新增 `upload` 与 `effective` 字段，说明每项数据的生效位置

### Removed — 仓库
- 删 `scripts/export-config.mjs`、`scripts/import-config.mjs`（功能已被 vault 插件覆盖，且带完整性校验与 UI）
- 删 `patches/`（识图补丁已撤销，结论并入 `03-reference/tool-surface.md`）
- `01-tutorial/migrate.md` 改写为「设置页导出/导入」流程

### Changed — 配置整洁
- `profiles/web/cordis.patch.yml` 头部注释 12 行 → 3 行（删掉 2026-10-31 的迁移期描述）
- 8 个历史备份文件移出 profile 目录 → `QQBotV2/backups/profile-baks/`；profile 目录现在只剩 6 个文件 + node_modules

### Known limitations
- whale 的 `mode` 改动需要重启或 `set_bundle` 才在旧会话生效
- vault 上传的浏览器点击路径未真机验证（handler 单测 + curl 已通过）

## [1.21.0] - 2026-11-14（whale v0.13.0 · vault v0.3.0 · 文档整理）

> 两个自有插件朝「成熟」推进一步；文档从 33 篇整理到 35 篇并加状态标记。

### Changed — dsh-qq-whale v0.13.0
- `presetId` 改为**废弃字段**（`hidden + disabled`，恒返回常量 `qq`）：它可改但 patch 里的 `id: qq` 不会跟着变，改了只会让 QQ 每条消息内部错误
- `restrict.js` 标注为「兼容入口，本包不再使用，不要与 agent-guard 同时启用」
- 包元信息补全（`files` 加 CHANGELOG、`meta.description` 更新），新增 `test/package-meta.test.mjs` 锁死元信息与 exports 指向
- 新增包级 `CHANGELOG.md`（v0.7 → v0.13.0）
- client 半补五种降级：configForms 缺失 / value 为 null / allowTools 非数组 / 保存失败 / revision 冲突
- README 重写，新增「停用与卸载的正确顺序」（先清 `agentPresetCustom`，否则每条消息内部错误）
- 测试 63 项（62 pass / 1 skip）

### Changed — dsh-qq-vault v0.3.0
- 新增 `GET /list-bundles`（列出 `qqbot-vault-*.tar.gz`）与 `GET /cleanup`（默认 dry-run，启动清理 7 天前）
- 导入前做 **sha256 完整性校验**（不一致拒绝，`force=1` 可强制）
- token 错误码细分：`token-missing/invalid/expired/used/mismatch`；路径不匹配不消费 token
- `sessions` 在 `capabilities` 里以 `supported:false` 呈现，UI 显示为禁用行
- 错误响应统一 `{ok,code,message}`，客户端按 code 映射中文
- **修复路由注销从未生效**：改用 `ctx.effect(() => webServer.register(...))`，关插件后 handler 真正移除（否则重启用时同名路径注册失败、旧 handler 继续生效）
- 测试 50 项全过 + 6 项 live（`VAULT_LIVE=1` 时才跑）

### Docs
- 新增 `03-reference/tool-surface.md`（工具面：白名单、可见≠可执行、guard/restrict 分工）
- 新增 `04-explanation/decisions/README.md`（ADR 索引 + 状态列，标注 ADR-012 已被 v0.11+ 扩展）
- `02-how-to/operate.md` 改为跳转页，内容并入 `05-handover/OPERATIONS.md`（§8–§10）
- `docs/README.md` 重写为带状态标记的索引；根 README 状态表按实况重写
- 修正多处过期描述：`plugin-inventory`、`add-feature`、`CONVENTIONS §3.5`、`architecture.md`、`installation.md`、`sync-assets`、`design-rationale`
- 修正 `05-handover` 里已不存在的 `qq-restrict` 行描述（改为 agent-guard 两层）

### Known limitations
- vault 的路由注销修复需要**重启容器**才彻底生效（当前进程里仍是旧 handler，`capabilities` 缺 `backupDir`）
- 真实浏览器下载/上传、`plugins.bundle.config` slot 渲染位置、真实 WAL 的 `VACUUM INTO` 均未真机验证

## [1.20.0] - 2026-11-14（新插件 dsh-qq-vault v0.1.0）

> 把「导出/导入」从命令行脚本搬进设置页：勾选数据项 → 导出 tar.gz；上传 → 预览 → 确认导入。

### Added
- **`packages/dsh-qq-vault/`**：host 半提供 `planExport` / `runExport` / `previewImport` / `runImport` 四个动作，
  逻辑搬自 `scripts/{export,import}-config.mjs`（整段替换、`VACUUM INTO`、主次版本闸）
- client 半：设置页「QQBot 备份」卡片，四个复选框（`config` / `persona` / `memory` / `whaleConfig`），
  token 项红字警告，`sessions` 标灰不实现
- 7 条 `/dsh-qq-vault/*` 路由，自带同源 + `connection.browserAuth` 双闸；拿不到 webServer 只 warn
- 测试 24 项（bundle 12 / roundtrip 5 / routes 7）全过，含「导出→预览→导入」全链路

### Changed
- `preset-qq` 的 `persona.prefix` 增加一句：收到图片时用 `read_image` 打开原图再回答

### Known limitations
- 真实浏览器下载/上传、keyed slot 渲染位置、真实 WAL 库的 `VACUUM INTO`（测试走 raw-copy 回退）均未真机验证

## [1.19.0] - 2026-11-14（插件 v0.11.0）

> whale 加了设置页配置：四项全 volatile，改完下一条消息即生效。

### Added
- `lib/config.js`：`Config` 四项——`enabled` / `allowTools`（25 项默认白名单）/ `hideFromModel` / `presetId`
- DSH 会为导出 Config 的插件自动渲染设置页表单（`configForms.get(entryId)` → `settings.describe` → `schema.rehydrate`），不需要自写 React
- `test/config.test.mjs` 8 项；测试合计 46 项（45 pass / 1 skip）

### Changed
- `apply(ctx, rawConfig)` 每次现读配置（volatile 用 `.get()` 解引用），不再启动时缓存
- `installAgentGuard(ctx, { readConfig })` 新签名，热改后新 agent 立即按新值走
- 依赖 `@deepseek-ai/schemastery`（CJS 包，ESM 侧要取 `.default`）

## [1.18.0] - 2026-11-14（插件 v0.10.0）

> 两件事：给 QQ 会话开联网；把「隐藏工具」从创建时改到首个 pre-step（创建时全局工具没注册完）。

### Added
- 白名单新增 `web_search` / `web_fetch`：让 QQ 侧也能自己查资料（原本只有 qq_websearch/qq_webfetch）

### Fixed
- `lib/agent-guard.js`：新增 `hideTools()` + `hideToolsAtFirstStep()`——收窄可见名单推迟到首次 `agent/pre-step`，
  此时工具已注册齐全；仍然先校验「白名单全部已知」，缺一项就跳过（防 2026-11-14 的缩表事故复发）
- guard 与 hide 分工：guard 保执行期安全（立刻生效），hide 让模型根本看不见（首个 pre-step 生效）

## [1.17.0] - 2026-11-14（插件 v0.9.1）

> 修 1.16.0 的真机故障：`agent/created` 里用 `tools.restrict()` 会因为「全局工具还没注册完」
> 把白名单过滤成 8 个（只剩 memory_*），qq_* 与 read/write 全被挡。改用 `tools.guard()` 按次拦截。

### Fixed
- `lib/agent-guard.js`：收窄手段从 restrict 改为 guard（不依赖注册顺序、不缩表）；
  guard 不可用才退回 restrict，且**白名单未注册齐全时直接跳过**，绝不拿缩水名单去限制
- `cordis.patch.yml`：去掉 preset-qq 里的 `qq-restrict` 行（重复且会缩表）
- `test/agent-guard.test.mjs`：8 项，含「未注册齐全就不 restrict」回归用例

## [1.16.0] - 2026-11-14（插件 v0.9.0）

> 真机发现：已经跑过回合的会话 **preset 是锁死的**，`qq-restrict` 那行永远挂不上，
> 老会话工具面一直是全量（实测 82~88 个工具）。本版加全局兜底，让限制与「会话用哪张 preset 建的」解耦。

### Added
- `lib/agent-guard.js`（导出 `./agent-guard`）：监听 `agent/created`，对 id 以 `qqbot-` 开头的 agent
  在它自己的 ctx 里调 `tools.restrict({ allow })`
  - 老会话、新会话一视同仁；不依赖 preset 是否挂载
  - `agent/created` 是串行 awaited 事件，监听器**抛错会让 agent 创建失败**：全程 try/catch、只做同步内存操作
  - 名字先按 `tools.definitions()` 过滤（restrict 遇未知名字会抛）
- `test/agent-guard.test.mjs`：6 项契约测试（QQ id 判定、收窄、缺服务降级、异常不外泄、畸形 payload）

### Known limitation（写清楚，避免下次再踩）
- 若会话已经跑过多轮，`preset-qq` 不会追溯生效：`agents.resume` 沿用会话头里的 `agentPreset`，
  `presets.select` 只接受空白会话。本次用「改会话头 + 清投影缓存」一次性纠正了两个 QQ 会话（已备份），
  以后的正确做法是**开新会话**；不要指望改配置能让老会话换 preset。
- 另外 `createSession` 对非空会话会 minted 一个新会话（qq-bot 的 `create` 走了这条路），
  所以日志里可能看到一条只有 4 个事件的「幽灵会话」，属正常现象。

## [1.15.0] - 2026-11-14（插件 v0.8.0）

> 这一版把「受限 preset」**做实**：preset 本身不收窄全局工具，加一行 `dsh-qq-whale/restrict` 显式收窄。
> 回滚：删掉 `cordis.patch.yml` 里 `qq-restrict` 那两行即可（插件其余功能不受影响）。

### Added
- `lib/restrict.js`（导出 `./restrict`）：在 agent scope 调 `ctx.tools.restrict({ allow })` 白名单收窄工具面
  - 默认白名单 23 项：QQ 自有工具（qqbot/qqconfig/qqgroup/qqauth/qq_*）+ read/write/edit/read_image + ask_user_question/todo_write + memory_*
  - 白名单而非黑名单：DSH 将来新增的工具默认被挡，而不是默认放行
  - 名字先对 `tools.definitions()` 过滤（restrict 遇未知名字会抛错，会把整个会话建不起来）
  - 任何异常只 warn 不阻断：宁可不限制，也不能让机器人回不了话
- `test/restrict.test.mjs`：7 项契约测试（白名单收窄、未知名字过滤、缺服务降级、异常不冒泡、config 覆盖）

### Fixed（认知与实现对齐）
- 此前 `preset-qq` 砍掉的只是「挂进 agent scope 的插件行」，**全局注册的工具照样可见**：
  实测会话 request/header 里 82 个工具全在，含 bash / terminal_* / subagent / workflow / gh_* / pr_*
- 依据：`dsh-tools/lib/index.js:427-479`（可见性 = 全局 + 祖先 scope − restrict）、`:456`（restrict 是唯一收窄手段）

## [1.14.0] - 2026-11-01（插件 v0.7.0）

> 这一版把 `dsh-qq-whale` **砍到只剩一件事**：提供那张 `preset-qq`（`id: qq`）。依据 ADR-012。
> 回滚：`git revert` 本次提交；插件侧降级回 v0.6.0 即可（人格若已填进 `persona.text` 不受影响）。

### Changed（破坏性：设置页与导出下线）
- **删除人格配置面**：`Config` schema（32 字段）、设置页 client（`settings.js` 699 行 + `probe.js` 161 行）、
  `lib/persona.js`、`lib/bot-catalog.js`、`scripts/sync-persona.mjs`、`/dsh-qq-whale/preview` 路由，
  以及 `schema.test.mjs` / `catalog.test.mjs`。代码约 3000 → 300 行，测试 42 → 15 项
- **为什么删而不是修**（ADR-012）：面板改的是 whale 自己的配置，**不进会话**（孤儿，要再跑一次同步才写进
  `persona.text`）；导出依赖的 preview 路由对照 `dsh-qq-bot@0.12.8` 源码已**证伪**——
  `inject = []` 且同步读 `ctx.webServer`（服务那时还没 provide），注册签名也不是官方的
  `register({ kind: 'exact', path, handler })`，所以路由从来没挂上过。人格本质是文本，
  改 `persona/whale.md` + Git 更直接、可评审、可回滚
- `lib/index.js` 只剩 `provide('whale')` 与 `PRESET_ID = 'qq'`；启动时日志会打印这张 preset 怎么用

### Added
- **「应用预设」这一步**（此前教程里完全没有）：`installation.md` 新增「第 4 步：应用 Agent 预设」，
  含两个前提检查（`plugin list` 看 phase、`--dump-config | grep preset-qq`）与验收方法；
  原第 4/5 步顺延为第 5/6 步
- `config/cordis.patch.yml` 与 `example.yml` 写入 `agentPresetCustom: 'qq'`（含"查不到就留空"的注释）
- `preset-qq-contract.md` §五补：preset 条目可绕开插件直接手写进 profile patch（及为什么不推荐）
- ADR-012《`dsh-qq-whale` 收窄为「只提供 preset」》

### Fixed
- **preset id 三处不一致**：`buildPresetPatch` 与 `sync-persona --preset` 默认 `whale`、patch 里却是 `qq`
  ——这是「会话应用预设失败」的诱因之一。现在只有 `PRESET_ID = 'qq'` 一个常量，
  并由 `preset.test.mjs` 与 patch 的 `config.id` **双向锁死**
- `plugin-inventory.md` 仍写 `id: whale`、版本 `0.2.0`（实际 `qq` / `0.7.0`）
- 两处 profile 配置的 `persona.name` 是「小鲸鱼」、`text` 的注释指向已不存在的 `roles/小鲸鱼.md`
- **「灌人格」三条教程给了三个答案**：`quick-start` 让人填**系统提示词** / `AGENTS.md`，
  `installation` 方式 B 同样——都会与人设卡**重复注入两份**。统一为唯一入口 `dsh-qq-bot.persona.text`，
  并写明系统提示那段已由 preset 的 `persona.prefix` 占住

### Changed（其它）
- 人格名字统一为**大肥鱼**：`persona/whale.md` 标题与正文、两处 profile 配置的 `persona.name`
- ADR-003 状态改为「已接受（部分被 ADR-004、ADR-012 修订）」；ADR-008 结论仍成立，状态不变
- `CONTRIBUTING.md` §7 举的 `/dsh-qq-whale/preview` 例子随接口删除改为泛化表述
- `sync-assets.md` 日常流程里的测试项数 42 → 15

## [1.13.0] - 2026-11-01（插件 v0.6.0）

> 这一版不动代码，改的是**规范本身**：本项目会由不同的人 / 不同的模型在不同的会话里跟进，
> 规范里任何一处歧义，都会被不同模型解读成不同的操作。本次把这些歧义逐个钉死。

### Added
- **`scripts/check-conventions.py`：规范自检脚本**——能被机械判定的规范就不再靠自觉。
  （不同模型读同一段规范，也会漏掉不同的条。）覆盖：动了 `packages/*/lib/` 没 bump 包版本、
  CHANGELOG 登记的插件版本与 `package.json` 不符、文档没注册进索引、
  ADR 编号不连续 / 状态词造了新的 / 字段没加粗、缺 `TODO.md`。只读不写，报出条款让你改
- **`CONTRIBUTING.md` §0「开工前必读」**：五分钟接手清单（读什么、按什么顺序）、
  三条不变量（Git 是真源 / 本文是唯一规范来源 / 不确定就标「⚠️ 未验证」）、收尾清单。
  换人、换模型、换机器开工都从这里开始
- **`CONTRIBUTING.md` §1.1「`packages/`」**：结构图此前压根没列这个目录，插件代码一直无章可循。
  补齐版本号、测试、文档、client 半的归属规则
- **`CONTRIBUTING.md` §10 + 顶层 `TODO.md`**：待办的唯一位置。此前待办散在顶层 README、
  ADR-011 正文、sync-assets §4 三处，多模型跟进必然漏读
- **`CONTRIBUTING.md` §6 版本号「双轨」规则**：项目本体（`CHANGELOG.md`）与插件包
  （`package.json`）各自走 SemVer，改哪个 bump 哪个，条目标题带上插件版本

### Fixed（一处硬冲突 + 三处一致性）
- **「改配置改哪个文件」三份文档给了三个答案**——这是本次最危险的一处：
  `CONTRIBUTING.md` §3.2 说改仓库 `config/cordis.patch.yml`，而 `add-feature.md` 与
  `config-schema.md` 说改 `$DSH_HOME/profiles/web/cordis.patch.yml` 且**明确不要碰 `config/`**。
  按前者走的模型会改了不生效，按后者走的会让两份配置静默漂移。
  **裁定：Git 那份是真源，两份都要改**（改仓库 → 同步到运行时 → 重启 → 验证），
  三处文档表述统一
- `quick-start.md` 的「不要用包内的 `config/cordis.patch.yml`」措辞含糊，容易被读成
  「不要改本仓库的 `config/`」（原意指 npm 包内那份）。已澄清，并补上初次安装与后续维护的区别
- **ADR 状态字段不统一**：001/002 写「已采纳」且不加粗，003–011 写「已接受」且加粗，
  而模板写的是「已采纳」。规范只认「已接受」，存量两篇已对齐
- **ADR-010 状态过期**：仍写「待拿到 `preset-standard` 完整定义后实施」，
  但 `preset-qq` 早在 `[1.11.0]` 就落地了。改为「已实施」，并在正文标注名字已定为 `preset-qq`
  （顺便定下规则：**结论只增不改，但状态必须跟着现实走**）

### Changed
- §7 安全规范补浏览器半三条（组件必须 try/catch、secrets 不进 console、不写 localStorage）
- §6 硬规则新增第 3 条：动过 `packages/` 必须跑 `npm test`
- §9 Review 清单新增「全文一致」一项（改后半篇忘了前半篇的自相矛盾）
- §8 自检清单补：接手清单、版本号双轨、跑测试、TODO 归集
- `sync-assets.md` 日常流程补 `npm test`
- 顶层 README 的待办改为指向 `TODO.md`（只留最急的三条），结构图补 `packages/` 与 `TODO.md`

## [1.12.0] - 2026-11-01（插件 v0.6.0）

### Added
- **设置页配置表单上线**（`lib/client/settings.js`，694 行）：`exports["./client"]` 由诊断探针
  切到正式表单。读写走 0.5.1 探针在真机验证过的契约——
  `describe() → { namespaces: [{ ns, value, revision, secrets }] }`、
  `mutate(ns, ops, revision)` 且 **ops 的 `path` 是键名数组**（不是点号字符串）
- 六个分区共 32 个字段（人格 / 人设卡 / 声音 / 记忆 / 群聊节奏 / 导出）按 `path` 逐个渲染；
  保存只提交真正改动的字段；读不到配置时显示**原因**而不是空白
- 每个组件自带 try/catch：渲染失败只坏一张卡片，不放大成全站白屏（ADR-004 的教训）

### Fixed
- `voice.proactiveTts` **不给控件**：代码强制 `false`，面板上勾了也不生效——
  未经请求就发语音侵扰性太强，给控件等于骗人
- README 头部「它不做什么」清单与第四节**自相矛盾**：表单已上线，头部却仍写着
  「当前没有设置表格」「不管人格与节奏」；首行 preset id 也仍写作 `whale`（实际是 `qq`）
- 依赖清单卡片：client 里的静态副本与 `lib/bot-catalog.js` **漂移了**
  （少了 `dsh-soul-md` 与 `dsh-plugin-shop`，`why` 文案也不一致）。
  改为优先取服务端 `/dsh-qq-whale/preview` 下发的 `catalog`，静态副本降级为兜底，
  并在卡片上标出当前用的是哪一份

### Changed
- 插件版本 `0.5.1 → 0.6.0`（新增功能 → MINOR，CONTRIBUTING §6）

## [1.11.3] - 2026-11-01（插件 v0.5.1）

### Fixed
- 探针加「加载留痕」：模块一加载就 `console.info` 并写 `window.__dshQqWhaleClient`
  （`version` / `loaded` / `registered` / `registeredError`），卡片上显示 client 版本与
  「已注册到配置区：是/否」。此前**「模块没被加载」和「加载了但没注册」症状完全一样**
  （都是设置页没变化），但一个属于声明/打包层、一个属于契约层，修法完全不同，无法区分
- 注册写法与 `dsh-qq-bot` 对齐（选项对象 + 组件）

### Added
- README 排查清单：看控制台 → 查全局标记 → 先确认 host 是 active → 完整重启 + 强刷

## [1.11.2] - 2026-11-01（插件 v0.5.1）

### Fixed（P0：host 半从 v0.2.0 起就没激活成功过）
- `ctx.whale = api` → `ctx.provide('whale', api)`。Cordis 服务守卫要求先 provide 再赋值，
  否则抛 `cannot set property "whale" without provide`，插件直接激活失败
  （真机 toggle 重载才暴露：**设置页 schema 照常渲染，只看 Config status 看不出来**）

### Added
- `test/activate.test.mjs`：补上「能激活」这一层——守卫替身（零依赖，复刻 DSH 报错文案）
  + 真 Cordis 断言 scope 进入 active；并配反向断言防止替身本身失效
  （回归验证：把代码改回旧写法，5 条变红）
- `test/preset.test.mjs` + `docs/03-reference/preset-qq-contract.md`：preset 每行的合法
  config 键从 npm 官方包（0.2.2-alpha.2）逐个核对后落成白名单，写错键会被测试挡住
  （`plugins` 是 `z.array(z.any())`，写错不报错、只静默丢弃）

### Changed
- `persona.prefix` 缩成一句风格锚点（不再自我介绍）：两条人格通道确认会双份——
  prefix 进系统提示每轮都在，人设卡只在**会话第一轮**的用户消息里（零额外 token）。
  故裁 prefix 不裁人设卡
- `compaction` 组复核结论：`isolate` 写法与 standard 一致，pruner 三个阈值等于插件默认
  （8192/4096/1024），等价于没改——长会话压缩行为应与 standard 一致

### 已评估、暂不启用（理由记在 ADR-011）
- `tool-skill`（安全但群里收益低）、`tool-schedule`（**唯一能到点提醒**，但绕过 proactive 节流 → 先补节流）
- 不加：`tool-jobs`（没有启动工具，bash 已砍）、`tool-goal` / `command-goal`（自动续接多轮 / 斜杠命令）、`planning`（plan mode 要人批准，群里没通道）

## [1.11.1] - 2026-11-01

### Changed
- 确认保留 `tool-ask-user` 与 `tool-todo`（用户判断：追问 = 活人感，todo = 预约主动任务）
- `persona/whale.md` 第 10 节新增「追问的分寸」：ask-user 行为由模型决定、代码管不了，
  只能靠提示词约束（该问/不该问对照 + 一次一个 + 对方敷衍就自己拿主意 + 不追着人问）

## [1.11.0] - 2026-11-01

### Added
- **`preset-qq` 落地**：拿到 `preset-standard` 完整定义后生成裁剪版（9 行，含 2 行 disabled）。
  保留 persona / agent-instructions / time-context / tool-fs / compaction / tool-ask-user / tool-todo；
  去掉 bash / pwsh / fs-search / jobs / schedule / skill* / goal / planning / delegation / web / present

### Fixed（两处实测更正）
- `tool-plugin-manager` / `tool-plugin-market` **官方默认已是 `disabled: true`**——
  之前判断为"必须移除"过度紧张；仍显式写一次以防将来默认值变化
- **`persona` 子插件自带 `prefix: You are a coding agent...`** —— 标准 preset 给 Agent 的
  人格前缀是"编码助手"，QQ 场景会与大肥鱼打架。裁剪版已换成群成员口吻

### 使用
- 装插件后填 `dsh-qq-bot` 设置页 → 高级 → 会话与排错 → ① 自定义 agent preset id = `qq`

## [1.10.0] - 2026-11-01

### Added
- `docs/04-explanation/decisions/ADR-010-restricted-preset-for-qq.md`：
  QQ 场景采用**受限 preset**（裁剪而非照抄）。标准 preset 是给终端场景设计的，
  群里任何人都能 @，能力面必须收窄

### Changed
- 修订 ADR-009 的「preset 冻结」结论：不是不做，而是**裁剪着做**。
  必须移除 tool-plugin-manager / tool-plugin-market（让 Agent 自己装插件 = 权限失控）、
  tool-bash / tool-pwsh / tool-fs-search / tool-web / delegation；
  保留 persona、agent-instructions、time-context、compaction、tool-ask-user；
  tool-fs 待验证（QQ 文件工作区与记忆依赖它）

### 阻断项
- 需要 `dsh --profile web --dump-config` 输出的 `preset-standard` 完整定义
  （子插件条目的 name 包名无法从 id 推断）

## [1.9.0] - 2026-11-01

### Fixed（P0，差点把机器人搞废）
- **撤下 `preset-whale` 条目**。真机实测：`@deepseek-ai/dsh-agent-preset` 的
  `plugins: []` **不是继承默认，是"什么都没有"**——官方 preset-standard 明确列了 22 行子插件
  （persona / agent-instructions / tool-bash / tool-fs / tool-web / planning / compaction …），
  该包没有 base 继承机制。空 plugins 的 preset 一旦被 `agentPresetCustom` 引用，
  新会话会失去整层能力，而 qqbot 的收发工具还在（消息仍能回）→ **静默降级成"只会聊天的空壳"**。
  详见 ADR-009；bundle patch 里已写明不要加回去
- 探针渲染路径补 try/catch（原来只有 apply 有），异步回调补 alive 标志——
  修掉"组件运行异常"

### Changed
- README 三处误导文案修正：preset 改为"已撤下"；装上不等于增加能力；
  手动软链安装必须同时登记 `dependencies` + `dsh.profile.bundles` 两处

### Added
- `docs/04-explanation/decisions/ADR-009-preset-plugins-no-inherit.md`

### 需要你提供
- `preset-standard` 的完整子插件 YAML（含每行的 name 包名）——
  有了它才能安全地生成"标准能力 + 大肥鱼扩展"的 preset

## [1.8.1] - 2026-11-01

### Changed
- **撤掉 whale 的 client 声明**（文件保留在 `lib/client/settings.js`）：
  当前没有需要可视化的配置，而客户端 compose 失败会放大成全站白屏（P0 教训）。
  将来要调参数时把两行声明加回即可，README 已写明

### 澄清（写给下一个读的人）
- **人设卡不在 Agent preset 里**：preset 字段只有 id/plugins/name/description/order，无文本字段。
  人设卡走 `dsh-qq-bot.persona.text`（原生设置页），工具走 `preset.plugins`，引用走 `agentPresetCustom`
- 「像 qqbot 那样有设置表格」= 必须自带 client 半，不是导出 schema 就自动有

## [1.8.0] - 2026-11-01

### Changed（重要）
- **`dsh-qq-whale` 改做「preset 提供者」**（[ADR-008](./docs/04-explanation/decisions/ADR-008-whale-as-preset-provider.md)，修订 ADR-007）：
  bundle patch 新增 `- id: preset-whale`（name 指向官方 `@deepseek-ai/dsh-agent-preset`，`plugins: []`），
  用户手动把 `agentPresetCustom` 填为 `whale` 即可。
  **新增条目 ≠ 改别人的条目**，因此彻底免除了跨插件写配置
- 关键澄清：设置页 hint 里「②③ 全被忽略」指的是**另外两个 preset 字段**
  （`auth.ownerPreset/guestPreset` 与兜底 `agentPreset`），**不是 `persona.*`**，人格不受影响
- preset **不是安全边界**：`auth.*` / `guestToolAllow` / `flowAuth.*` 照常生效

### Added
- `docs/04-explanation/decisions/ADR-008-whale-as-preset-provider.md`
- 将来 TTS / STT 插件挂进 `preset-whale.plugins` —— 官方推荐的加扩展方式

### 待验证
- preset 条目能否被加载 / 填了 preset 后 `persona.text` 是否仍生效 / 留空 `plugins` 是否丢工具

## [1.7.0] - 2026-11-01

### Added
- `docs/03-reference/feature-matrix.md`：**功能覆盖矩阵**——14 项需求逐项标明靠什么实现、
  是不是原生、还差什么。结论：**8 项原生，真正要自己写的只有 TTS / STT / 记忆三项**

### Changed（重要）
- **`dsh-qq-whale` 降级：不再作为插件安装**（[ADR-007](./docs/04-explanation/decisions/ADR-007-whale-scope.md)）。
  评估发现它管的字段 `dsh-qq-bot` 原生就有且 UI 更成熟（`persona.*` / `proactive.*`），
  它独有的能力一项未兑现，唯一写入动作还是跨插件改配置（无官方 API 支持）。
  保留为人设卡内容 + CLI 生成器（`--print-card`），**不再 `--write`**
- 人格与节奏回归原生：直接填 `dsh-qq-bot.persona.text` 与 `proactive.*`，设置页原生 UI

### 教训
- 做插件前先盘原生能力：这次是先写了插件，才发现上游原生就有且更好。
  顺序应该是 **feature-matrix → 再决定要不要写**

## [1.6.0] - 2026-11-01 🎉 全链路打通

### Changed
- **入站消息上报：⏳ 待验证 → ✅ 已实测**。环境所有者在群里发消息，机器人能收到并正常回复。
  最后一块拼图落下：QQ → NapCat → 单条 WSS → dsh-qq-bot → DSH Agent → 回复回 QQ
- `docs/03-reference/capability-report.md` 新增「1.1 QQ 链路」记录四项证据
- README 状态表与 quick-start 第 7 节的「未验证」标记同步更新

### Closed
- CNB Issue #1「待验证：入站消息上报链路」——已带结论评论并关闭（completed）

### 下一步（性质变了）
从「能不能跑」转为「跑得好不好」：
1. 灌人格（`sync-persona.mjs`）→ 2. 纯文本跑几天调节奏 → 3. 再开 TTS/STT/识图

## [1.5.0] - 2026-11-01

### Fixed
- **节奏参数导出后不生效**：`buildQqBotPatch()` 导出的是 `proactive.perHour / perDay / cooldownMinutes`，
  而 dsh-qq-bot 真实字段是 **`maxPerHour / maxPerDay / minGapMinutes`**；`quietHours` 也应是数组。
  错的键会被静默丢弃（bot 只认自己那一行，残留键自动清理并打进日志），表现为"导出了但没效果"。
  **已按 `docs/03-reference/config-schema.md` 修正，并新增 5 项防漂移测试**
  （直接解析该文档作事实源，导出文档里没有的键就红）
- **文档路径模板残留**：批量替换时误伤了 `$DSH_HOME/profiles/web/cordis.patch.yml`，
  变成 `$../../config/cordis.patch.yml`（installation / quick-start / add-feature / operate / config-schema 共 5 个文件）。已全库修正

### Added
- `buildPresetPatch()`：输出 Agent preset 骨架（`--preset whale`），为将来把记忆/声音插件挂进 preset 做准备
- `docs/04-explanation/decisions/ADR-006-persona-vs-agent-preset.md`：
  回答"能否用 Agent 预设控制人格"——preset 只组合插件（字段仅 id/plugins/name/description/order），
  **不存人格文本**；所以人格继续走 `persona.*`，preset 留给挂插件

### Changed
- 明确区分两个"大肥鱼"：`dsh-qq-whale`（QQ 群聊人格）vs `dsh-bigfish`（桌面宠物），
  在仓库 README、插件 README 与插件清单三处加防装错提示

## [1.4.1] - 2026-11-01

### Added
- `docs/04-explanation/decisions/ADR-005-soul-md-evaluation.md`：评估 `dsh-soul-md`，
  **不采用**（记忆是单一全局目录、工具无 scope 参数，无法做群级分片），
  但抄其字段设计：分层开关、关键词召回、indexMode、压缩后补偿、注入预算、skipSubagents

### Changed
- 依赖清单里 soul-md 由「待评估」改为「已评估不采用」，并写明原因

## [1.4.0] - 2026-11-01

### Added
- **`lib/client/settings.js`**：client 半（React bundle），注入 `plugins.bundle.config`，
  配置区终于真的出现。防御式三重保护：注册 try/catch、渲染 try/catch、服务三级回退——
  客户端 compose 失败会放大成全站故障，所以任何异常都只降级为提示卡片
- **Bot 依赖清单卡片**：只列 QQ Bot 需要的插件（不是全量市场），
  用 `remote.pluginManager.listPlugins()` 比对，缺的项给可复制的安装命令，
  「已装未启用」单独标出
- `lib/bot-catalog.js` + `test/catalog.test.mjs`：清单数据与匹配逻辑，10 项测试

### Changed
- 恢复 `exports["./client"]` 与 `dsh.client` 声明——这次文件真的存在了
- 服务端 `/dsh-qq-whale/preview` 增加下发 `catalog`，client 优先用服务端数据，静态副本仅兜底

### Known limitations
- **配置区只做只读展示**：`settings.mutate(ns, ops)` 的 ops 形状无法在沙箱验证，不做写入
- client 半语法已校验，但**真机渲染与 listPlugins 取用均未验证**

### Fixed
- v0.1.0 的 client 声明指向不存在文件（P0，见 1.3.1）——本版随文件一并交付

## [1.3.1] - 2026-11-01

### Fixed
- **P0 全站级故障**：`package.json` 声明了 `exports["./client"]` 与 `dsh.client`，
  但 `lib/client/` 目录从未创建。DSH client-modules 解析该路径 ENOENT
  → `MissingClientBundleError` → `ClientPackageCompositionError`
  → 客户端模块图 compose 失败 → Web GUI 最坏白屏。**已移除两处声明止血。**
- `files` 声明了 `LICENSE` 但文件缺失，已补（MIT，并注明人格形象的 CC BY-NC-SA 约束）

### Added
- `docs/04-explanation/decisions/ADR-004-client-half-required.md`：
  纠正 ADR-003 中"DSH 会自动渲染通用表单"的错误论断，记录配置区必须由 client 半注入，
  以及本次 P0 的根因与"声明与文件必须同生共死"的教训
- `docs/03-reference/plugin-inventory.md`：插件清单——怎么查已装、本方案依赖什么、
  生态里有哪些相关插件、以及被 `dsh-plugin-shop` 收录的条件

### Changed
- `dsh-qq-whale` 可被插件市场发现：补 `keywords[dsh-plugin, deepseek-harness]`、
  `dsh.catalog`（category persona + 中英摘要 + capabilities）、`repository` / `homepage` / `bugs`
- 插件 README 明确标注 v0.1.0 配置区暂不可见的真相与替代配置方式

## [1.3.0] - 2026-11-01

### Added
- **`packages/dsh-qq-whale/`**：大肥鱼人格插件（v0.1.0），配置从 YAML 搬到 DSH 设置页
  - `lib/config.js`：Config 契约 = 设置页表单本身，含人格 / 人设卡全文 / 声音 / 记忆 / 节奏 / 导出六组
  - `lib/persona.js`：结构化字段 → 人设卡文本；`card.mode` 三种组合策略（merge / full / structured）
  - `lib/index.js`：代码级钳制（语速 0.85–1.2、主动发言 TTS 恒为 false）、可选预览路由
  - `scripts/sync-persona.mjs`：面板配置 → `dsh-qq-bot.persona.text`（默认 dry-run，写入前自动备份）
  - `test/schema.test.mjs`：10 项契约测试，全部通过
- `docs/04-explanation/decisions/ADR-003-whale-plugin.md`：为什么做独立插件，以及 v0.1 不写自定义 React 设置页的理由

### Changed
- 配置真源模型澄清：**设置页与 `cordis.patch.yml` 是同一份东西的两面**——
  面板改动会写回 profile 的 YAML，因此"UI 改 + 进 Git"天然成立，无需二选一

### Known limitations
- `dsh plugin add <本地路径>` 的语法、设置页实际渲染效果、预览路由**均未真机验证**（沙箱无 DSH 运行时）
- 面板改动需跑一次 `sync-persona.mjs` 才写入 `dsh-qq-bot.persona.text`——没有官方跨插件写配置 API

## [1.2.0] - 2026-10-31

### Added
- **纳入 Git 版本管理**：真源迁至 `cnb.cool/civer/dsh-qq-instruction`（私有，`main` 分支），
  所有改动先落仓库，网盘降级为只读分发副本
- `scripts/scrub-secrets.py`：配置脱敏脚本，生成 `config/cordis.patch.example.yml`
  （token / 域名 / BotQQ / QQ 号 / 群号 → 占位符），公开仓库前必跑
- `scripts/check-links.py`：全库 Markdown 相对链接自检（提交前跑，防目录重组留下断链）
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) §6「Git 工作流」：分支策略、日常三步、4 条硬规则

### Changed
- [`docs/02-how-to/sync-assets.md`](./docs/02-how-to/sync-assets.md) 重写：从「本地 ↔ 网盘」
  改为「**Git 真源 ↔ 本地工作区 ↔ 网盘只读副本**」三层模型，明确冲突时以 Git 为准
- [`README.md`](./README.md) 顶部加仓库信息与密钥警告（Git 历史永久保留，公开前必须清理）

### Security
- 明确 token 轮换触发条件：明文出现在共享位置即视为泄露
- 明确 `soul-md/`、`QQ_msg/`、`memory/` 三处**绝不进版本库**

## [1.1.0] - 2026-10-31

### Added
- `./CONTRIBUTING.md`：项目唯一规范来源（结构约定、文档规范、加功能流程、ADR、提交规范、安全清单）
- `docs/README.md`：文档索引（Diátaxis 四象限）
- `./docs/04-explanation/architecture.md`：部署拓扑、模块边界、数据流、失败路径、架构不变量
- `docs/04-explanation/decisions/ADR-001`、`ADR-002`：两项关键架构决策
- `./tools/ws-check.mjs`：NapCat 连接体检（握手 → 鉴权 → 只读探活）
- `./tools/listen.mjs`：真实环境消息监听，验证入站链路
- `./tools/mock-napcat.mjs`：模拟 OneBot 服务端，不接真 QQ 联调
- `./tools/probe-tts.mjs`：TTS 合成 + 音色表查询（88 个音色）
- `./tools/probe-capabilities.py`：DashScope 能力自检
- `./samples/龙灵安希-样本.wav`：真实音色样本

### Changed
- **文档结构重组为 Diátaxis 四象限**（tutorial / how-to / reference / explanation）
- 全部文档路径改为英文 kebab-case，标题保持中文
- `roles/` → `persona/`，`./persona/whale.md` → `./persona/whale.md`
- 根目录收敛：只保留 `README.md` / `./CONTRIBUTING.md` / `./CHANGELOG.md` / `LICENSE`

### Fixed
- **TTS 模型名修正**：`qwen-audio-3.1-tts-flash` 在该网关下不存在；龙灵安希仅在 `qwen-audio-3.1-realtime-flash`（WebSocket）下可用，HTTP 的 `qwen3-tts-flash` 音色表不含该音色
- **OneBot 端点修正**：`napcat.civer.cn` 实际是 NapCat WebUI（公网暴露），真正的 WS 端点是 `qapi.civer.cn`

### Security
- 实测发现 `napcat.civer.cn` 将 NapCat 管理面板暴露在公网（301 → /webui），已列入待办
- 提示轮换曾明文出现在对话中的 DashScope API Key 与偏弱的 NapCat token

## [1.0.0] - 2026-10-31

### Added
- 初始方案：分层架构（传输 / 人格 / 决策 / 策略 / 执行）
- 人格卡 `./persona/whale.md`（基于蓝色大肥鱼 / 鲸鱼娘社区底版）
- 记忆四层模型（L0 本体 / L1 人物跨群 / L2 群内隔离 / L3 会话）
- 决策契约（mode / toolCalls / tts 表达对象）
- 配置模板 `./config/cordis.patch.yml`
