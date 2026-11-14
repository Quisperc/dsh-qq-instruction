# dsh-qq-whale 变更记录

> 只记本包。仓库级变更见仓库根 [`CHANGELOG.md`](../../CHANGELOG.md)。
> 格式参考 Keep a Changelog；版本遵循 SemVer。

## [0.14.0] - 2026-11-14

做减法。这一版删掉的东西比加的多——目标是「只剩两件事：插 preset、守工具面」。

### Removed（破坏性）

- **`lib/restrict.js` 与 `exports["./restrict"]`**：v0.13 已标注为「兼容入口」，本包不再使用，
  与 `agent-guard.js` 的隐藏逻辑重复；留着只会让人误挂成 preset 行走回"白名单缩水"的老路。
  同步删除 `test/restrict.test.mjs`。
- **`presetId` 配置字段**：v0.13 已标 `hidden + disabled`，本质是死字段。直接移除字段、
  `readConfiguredPresetId()` 与启动告警。`PRESET_ID` 常量保留（代码里的字符串，不是配置）。
- **`ctx.provide('whale')` 与 `api` 对象**：全仓库没有任何调用方（`grep ctx.whale` 只命中文档与测试），
  服务注册没有收益却带来「必须 provide 否则激活失败」的坑。`apply` 现在只做一件事：挂 `agent/created` 监听。
- **通用 `web_search` / `web_fetch` 出白名单**：`dsh-qq-bot` 自带的 `qq_websearch` / `qq_webfetch`
  是同一件事的完成版（带多引擎与代理）。两个等价工具同时在场，只会让模型每次联网都犹豫一下。
  联网能力仍由 `qq_*` 提供；`read_image` 保留（识图唯一通路）。

### Changed

- **`enabled` + `hideFromModel` 合并为 `mode`**：`off` / `guard` / `hide` 三档。
  两个布尔能拼出 4 种状态，其中 `enabled=false + hideFromModel=true` 自相矛盾——
  枚举之后面板上不会再出现"配了也不生效"的组合。
- `agent-guard.js` 去掉「没有 guard 就退回 restrict」的兼容分支（只服务 0.2+），
  `restrictAgent` 更名 `installGuard`，语义与实现对齐。
- `cordis.patch.yml` 注释从 111 行压到 36 行（删掉 0.5.x 历史细枝末节，
  保留"为什么不用 standard""人格两条通道""为什么收窄不在这张清单里"）。
- README 重写为**用户手册**：安装、两项配置、**preset id 能不能改（能，但要同时改三处）**、
  卸载顺序（先清 `agentPresetCustom`，否则每条消息内部错误）、已知限制。
- 包元信息收窄：`description` 一句话、`keywords` 5 个、去掉未使用的 `js-yaml` devDependency。

### 白名单变化

25 → **23 项**：去掉 `web_search` / `web_fetch`，其余不变。

## [0.13.0] - 2026-11-14

成熟度收尾：把一个"能用"的插件变成"不会被误用"的插件。

### Changed（破坏性：`presetId` 冻结）

- **`presetId` 不再可配置**。preset 的真实 id 由包内 `cordis.patch.yml` 的条目 id 决定，恒为 `qq`。
  - schema 里保留该字段但 `.hidden() + .disabled()`：只为让旧配置里的 `presetId` 不被当成未知字段清理；
  - `readConfig()` 一律返回常量 `PRESET_ID`，配置里的值**不参与任何行为**；
  - 启动时若发现配置里残留了不同的值，打一条 warn 说明"已被忽略，要改名得同时改 patch 与 `agentPresetCustom`"。
  - 理由：面板能改但改了必坏（QQ 每条消息回「内部错误」，宿主不报错）= 假旋钮，不如没有。

### Added

- `lib/config.js` 导出 `PRESET_ID`；`index.js` 改为从 config 引入（不再两处各写一份）。
- 设置页把 preset id 从输入框改成**只读展示**，并说明它由 patch 决定。
- `allowTools` 被手工改坏成非数组时，界面给出明确警告，而不是把它当成"空 = 不限制"静默覆盖。
- 包级 `CHANGELOG.md`（本文件）。
- 测试：
  - `package-meta.test.mjs`（6 项）：包元信息、`exports` 指向真实文件、`files` 清单、catalog、**patch 里不再挂 restrict 行**、preset-qq 关键行仍在；
  - `config.test.mjs` 增 2 项：`presetId` 冻结语义 + 字段 hidden/disabled；
  - `client-contract.test.mjs` 增 3 项：只读展示、保存只写三个字段、非数组警告。
- README 重写：现状（preset + 工具收窄 + 三项设置）、preset≠权限限制、**停用/卸载顺序警告**、排障表、测试分层、已知限制。

### Fixed

- README 与代码不一致：README 还停在 v0.7「只提供 preset、没有设置页」的描述。

### 未做（附理由）

- **i18n**：第三方客户端 bundle 不会自动加载 `locale/*.json`，文案内联中文（与 `dsh-qq-bot` 一致）。等平台提供客户端字典入口再做。
- **删除 `lib/restrict.js`**：它已不被 preset 使用，但仍是可独立挂载的兼容入口（第三方可复用）。保留并在文件头与 README 明确标注"不要与 guard 同时用"，同时用测试锁住"我们自己的 patch 里没有它"。

## [0.12.0] - 2026-11-14

### Added

- 客户端半 `lib/client/settings.js`：注入 slot `plugins.bundle.config`（key = 包名），用 `ctx.configForms.get('dsh-qq-whale')` 渲染配置。
  - 为什么必须写：只导出 `Config` **不会**自动出现表单——插件详情页按 `ctx.slots.inject('plugins.bundle.config', ..., { entryKey })` 派发。
- `test/client-contract.test.mjs`（8 项）：在假 `window.__ModuleLoader__` 里加载 bundle，锁住 id / slot / 渲染 / 降级。

## [0.11.0] - 2026-11-14

### Added

- `Config` 四项（`enabled` / `allowTools` / `hideFromModel` / `presetId`），全部 `.volatile()`：设置页可改、改完下一条消息生效。
- `lib/config.js`：`readConfig()` 每次现读 + 逐字段类型回落；`isRestrictionActive()` 统一"空名单 = 不限制"的语义。
- `test/config.test.mjs`（8 项）。

### Changed

- `installAgentGuard(ctx, { readConfig })` 新签名：热配置每事件现读，不再启动时缓存。

## [0.10.0] - 2026-11-14

### Added

- 白名单加入通用 `web_search` / `web_fetch`（原来只有 `qq_websearch` / `qq_webfetch`）。
- `hideTools()` + `hideToolsAtFirstStep()`：把"隐藏工具"从 agent 创建时推迟到首个 `agent/pre-step`（那时工具已注册齐全）。

## [0.9.1] - 2026-11-14

### Fixed

- **收窄手段从 `restrict` 改为 `guard`**。原实现按"已知名字"过滤白名单后调 `restrict`，
  而 agent 刚创建时全局工具还没注册完 → 白名单缩水成 8 个（只剩 `memory_*`），`qq_*` 与 `read/write` 全被挡。
  - guard 按次拦截、不依赖注册顺序；
  - restrict 退为兜底，且**白名单未注册齐全时直接跳过**，绝不拿缩水名单去限制。
- 去掉 `preset-qq` 里的 `qq-restrict` 行（与 guard 重复，且同样会缩表）。

## [0.9.0] - 2026-11-14

### Added

- `lib/agent-guard.js`：监听 `agent/created`，对 `qqbot-*` agent 在它自己的 ctx 里收窄工具面。
  - 解决"已经跑过回合的会话 preset 被锁死、拿不到 preset 里的 restrict 行"的问题——限制与 preset 解耦。
  - `agent/created` 是串行 awaited 事件，监听器抛错会让 agent 创建失败：全程 try/catch、只做同步内存操作。

## [0.8.0] - 2026-11-14

### Added

- `lib/restrict.js`（导出 `./restrict`）：在 agent scope 调 `ctx.tools.restrict({ allow })`，白名单 23 项。
- `preset-qq` 增加 `qq-restrict` 行。

### Fixed

- 认知纠正：此前以为"preset 砍掉插件行就等于收窄工具"，实测 QQ 会话里 82 个工具全在。

## [0.7.0] - 2026-11-01

### Changed（破坏性）

- 收窄为**只提供 preset**：删除人格配置面（`lib/config.js` 旧版、`lib/persona.js`）、设置页（`lib/client/settings.js` 旧版）、
  导出脚本（`scripts/sync-persona.mjs`）与 bot 依赖清单卡（`lib/bot-catalog.js`）。依据 ADR-012。
- 理由：那些能力在真机上都不真的可用（表单改的是插件自己的配置、不进会话；导出路由必然挂不上），
  而"提供 preset"这一件事才是不可替代的。
