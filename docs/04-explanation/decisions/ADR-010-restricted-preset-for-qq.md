# ADR-010：QQ 场景用「受限 preset」，裁剪而非照抄（修订 ADR-009 的"冻结"结论）

- **状态**：已接受（已实施——`preset-qq` 已落地，见 ADR-011 与 CHANGELOG `[1.11.0]`）
- **日期**：2026-11-01
- **触发**："能用 QQ 不代表能用人格注入等能力；如果用标准 preset，可能导致查到不该查的东西"

## 一、ADR-009 的"冻结"结论被推翻

ADR-009 结论是"TTS/STT 走工具全局注册，preset 这条路冻结"。
这个结论只考虑了**怎么加能力**，没考虑**该不该有这些能力**。

标准 preset 是给"你坐在终端前用"设计的。QQ 场景里**群友能触发 Agent**，
能力面必须收窄——这是最小权限原则，不是可选项。

## 二、决策

**为 QQ 场景建立受限 preset**（`id: qq`，即 `preset-qq`），做法是从标准 22 行里裁剪，而不是照抄。

> 名字当时待定，后来定为 `preset-qq`；`preset-standard` 的完整定义已在 2026-11-01 拿到并据此生成裁剪版
> （9 行，见 `packages/dsh-qq-whale/cordis.patch.yml` 与 `docs/03-reference/preset-qq-contract.md`）。
> 配置键白名单由 `test/preset.test.mjs` 锁住——**DSH 升级后要复查一次**，待办记在 `TODO.md`。

### 建议的能力取舍（⚠️ 基于推断，需实测校正）

| 类别 | 子插件 | 建议 | 理由 |
|---|---|---|:--:|
| 人格 | `persona` | ✅ 保留 | **QQ 场景的核心**：人格注入 |
| 指令 | `agent-instructions` | ✅ 保留 | 项目级指令 |
| 上下文 | `time-context` | ✅ 保留 | 知道现在几点，静默时段要用 |
| 长会话 | `compaction` | ✅ 保留 | 群聊会越聊越长 |
| 交互 | `tool-ask-user` | ✅ 保留 | 反问用户 |
| 工作区 | `tool-fs` | ⚠️ **保留但需验证** | QQ 会话落在 `QQ_msg` 工作区，记忆靠文件；砍掉可能连记忆都没了 |
| Shell | `tool-bash` / `tool-pwsh` | ❌ 移除 | **群友触发跑 shell = 灾难** |
| 文件搜索 | `tool-fs-search` | ❌ 移除 | 同上 |
| 联网 | `tool-web` | ❌ 移除 | `dsh-qq-bot` 自带 `qq_websearch` / `qq_webfetch`，且可被 `webSearch.*` 单独管控 |
| 后台任务 | `tool-jobs` / `tool-schedule` | ❌ 移除 | QQ 场景不需要 Agent 自己起后台任务 |
| 委派 | `delegation` | ❌ 移除 | 子代理放大不可控 |
| 插件管理 | `tool-plugin-manager` / `tool-plugin-market` | ❌ **必须移除** | 让 Agent 能装插件 = 权限彻底失控 |
| 技能 | `skill-filesystem` / `tool-skill` | ⚠️ 待定 | 视是否需要技能系统 |
| 目标/规划 | `planning` / `tool-goal` / `command-goal` | ❌ 移除 | 属于编码/项目场景，QQ 用不到 |
| 待办 | `tool-todo` | ✅ **保留** | 用户确认：**预约主动任务**靠它（"明天提醒我…"），是主动任务需求的天然载体 |
| 追问 | `tool-ask-user` | ✅ **保留** | 用户确认：**真人会反问**，这是活人感来源之一 |

> **`tool-plugin-manager` 与 `tool-plugin-market` 必须移除**：
> 它们是"让 Agent 自己装插件"的能力。在任何人都能 @ 的群里，这等于把安装权限交给群友。

## 三、实测数据（已拿到 `preset-standard` 完整定义）

用 `dsh --profile web --dump-config` 拿到。包名规律清晰：`@deepseek-ai/dsh-<id>`，
例外是三个组（`planning` / `compaction` / `delegation`，`name: cordis:group` 带嵌套 config）
与两个工具（`@deepseek-ai/dsh-plugin-manager/tools`、`@deepseek-ai/dsh-plugin-market/tools`）。

### 两处更正（我上一节的判断有误）

| 我之前的说法 | 实测 |
|---|---|
| "`tool-plugin-manager` / `tool-plugin-market` 必须移除" | ❌ 过度紧张：**官方默认就是 `disabled: true`**。仍显式写一次以防将来默认值变化 |
| 未提及 | ⚠️ **关键**：`persona` 子插件自带 `prefix: You are a coding agent powered by the {{model}} model.`——标准 preset 给 Agent 的人格前缀是"编码助手"，**QQ 场景必须换掉**，否则与 `persona.text` 里的大肥鱼打架 |

### 最终裁剪结果（9 行，含 2 行 disabled）

保留：`persona`（prefix 已改为群成员口吻）、`agent-instructions`、`time-context`、
`tool-fs`、`compaction`（组，含 3 子行）、`tool-ask-user`、`tool-todo`。

移除：`tool-bash` / `tool-pwsh` / `tool-fs-search` / `tool-jobs` / `tool-schedule` /
`skill-filesystem` / `tool-skill` / `command-goal` / `tool-goal` / `planning` /
`delegation` / `tool-web` / `present`。

另注：`tool-bash` / `tool-pwsh` 在标准里靠 `!!js process.platform` 判断平台启停——
裁剪版直接不列，省掉这层平台判断。

### 保留项的分寸（提示词是唯一缰绳）

`tool-ask-user` 的行为完全由模型决定，代码管不了，只能靠人设卡约束。
已在 `persona/whale.md` 第 10 节加「追问的分寸」：

| 该问 | 不该问 |
|---|---|
| 信息缺失导致没法答 | 能自己查到、能猜个大概的 |
| 对方明显在等你确认 | 为了显得认真而重复确认 |
| 涉及对方偏好，猜错很尴尬 | 对方已开始敷衍 |

外加：一次最多问一个、对方敷衍就自己拿主意、群里不追着一个人问。

## 四、使用方式

装插件后手动填：`dsh-qq-bot` 设置页 → 高级 → 会话与排错 →
**① 自定义 agent preset id = `qq`**（只影响新会话）。

## 五、实施前的安全底线

在拿到定义、生成受限 preset 之前：

1. **不要把 `agentPresetCustom` 填成任何自建 id**；
2. 保持 `auth.guestDshTools: false`（访客禁用 DSH 内部工具）；
3. 敏感工具加进 `flowAuth.gatedTools`；
4. 群白名单 `group.allow` 别留空。

## 六、代价

- 裁剪后 Agent 可能变笨（不能跑 shell、不能搜服务器文件）——**这是有意为之**；
- 需要实测确认 `tool-fs` 是否必须保留（否则记忆与工作区会出问题）；
- 每次 DSH 升级，标准 preset 可能新增行，我们的裁剪版要跟着复查。
