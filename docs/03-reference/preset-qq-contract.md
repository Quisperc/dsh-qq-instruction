# preset-qq 契约（事实源）

<!-- data-doc-status -->
> 📌 **2026-11-14 更新**：`persona.prefix` 已改为两行（风格锚点 + 「收到图片用 `read_image` 看原图」）。
> 另注意：**工具收窄不靠 preset 行**——preset 只决定挂哪些插件，收窄由 `dsh-qq-whale` 的 guard/restrict 负责，见 [`tool-surface.md`](./tool-surface.md)。

> 用途：`packages/dsh-qq-whale/cordis.patch.yml` 里 `preset-qq` 每一行写什么、能写什么，
> 一律以本文件为准。**改 patch 前先改这里**，`test/preset.test.mjs` 会拿本文件当白名单校验。
>
> 核对方式：从 npm 拉各官方包源码读 `Config` schema，不是猜，也不是只看文档。
> 核对时版本：`0.2.2-alpha.2`（DSH `0.2.0-rc.2` 系列对应的一批包）。

## 一、两条人格通道（最容易搞混的一件事）

| 来源 | 落在哪 | 出现频率 | 会不会互相遮蔽 |
|---|---|---|---|
| `preset-qq` → `persona.prefix` | 系统提示的 `deployment:persona-prefix` 段（order 0） | **每轮** | 会**遮蔽** DSH 部署级（全局）的 `persona-prefix` |
| `dsh-qq-bot` → `persona.text`（人设卡） | **不进系统提示**；拼在**会话第一轮**用户消息末尾：`（身份设定，请始终遵守：你是大肥鱼。…）` | **只一次** | 不会遮蔽任何段，也不会被遮蔽 |

依据：

- `@deepseek-ai/dsh-persona`：`ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: DEPLOYMENT_PERSONA_PREFIX, text: config.prefix })`
- `@deepseek-ai/dsh-system-prompt`：`PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'`（order 0），
  `PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'`（order 10200）；
  `section()` 的语义是「同名 scoped section 遮蔽 global section」
- `@sputnikzaychik/dsh-qq-bot`：`lib/gateway/turn-runtime.js` —— `personaHint` 只在 `entry.turns === 1` 时追加

**因此：**

1. 两者会各说一遍"你是谁" → prefix 只做**风格锚点**（反助手化），身份/性格/雷区全部交给人设卡；
2. 人设卡**只烧一次 token**，不要为了省 token 去裁它（源码注释原话：`只在会话第一轮追加一次：零额外 token`）；
3. preset 里写 `persona` 行会把**部署级 persona-prefix 吃掉**——有意为之，但要记得全局人格对 QQ 会话不再生效；
   `suffix` 我们没写（默认空），同理会把部署级 `persona-suffix` 吃掉。

## 二、每行的合法 config 键

`plugins` 是 `z.array(z.any())`，写错键**不会报错**，而是被静默丢弃——表现为"配了但没生效"。所以下表必须逐条对齐。

| id | name | 合法 config 键 | required | 本 preset 的写法 |
|---|---|---|:--:|---|
| `persona` | `@deepseek-ai/dsh-persona` | `prefix` / `suffix` / `complete` / `includeRuntimeContext` | `prefix` | 只写 `prefix`（一句风格锚点） |
| `agent-instructions` | `@deepseek-ai/dsh-agent-instructions` | `projectRootMarkers` / `maxBytes` / `maxSourceBytes` / `instructionFileCandidates` / `localInstructionFileCandidates` | `maxBytes` | `maxBytes: 65536` |
| `time-context` | `@deepseek-ai/dsh-time-context` | `timeZone` / `refreshIntervalMs`（均无默认） | — | 不写 config |
| `tool-fs` | `@deepseek-ai/dsh-tool-fs` | `read` / `readImage` / `write` / `edit` / `readLimit` / `readMaxLineLength` / `readMaxBytes` / `readStreamMinSize` | — | 不写 config（读写全开，记忆依赖它） |
| `compaction` | `cordis:group` | `group: true` + `isolate`（见下）+ 嵌套 `config` 数组 | — | 见下 |
| `compaction-basic` | `@deepseek-ai/dsh-compaction-basic` | `thresholdRatio` / `headroomTokens` / `retainRatio` / `retainTokens` / `summarizationProvider` / `summarizationModel` / `maxTokens` / `compactionRetries` / `maxOverflowRetries` / `modelPolicies` / `auto` | — | 不写 config；`auto` 在代码里 `?? true`，**不写 = 自动压缩开启** |
| `command-compact` | `@deepseek-ai/dsh-command-compact` | — | — | 不写（斜杠命令 `/compact`，群里没人敲，保留只为与 standard 对齐） |
| `tool-result-pruner` | `@deepseek-ai/dsh-compaction-tool-result-pruner` | `thresholdChars` / `headChars` / `tailChars` | — | 显式写出，值 = 插件默认（8192 / 4096 / 1024），**等价于不写** |
| `tool-ask-user` | `@deepseek-ai/dsh-tool-ask-user` | `mode`（`legacy`｜`timed`，默认 `legacy`）/ `timeout`（默认 120s） | — | 不写 config |
| `tool-todo` | `@deepseek-ai/dsh-tool-todo` | `allowParallelInProgress` | **required** | `true`（不写会缺必填项） |
| `tool-plugin-manager` | `@deepseek-ai/dsh-plugin-manager/tools` | （有 Config，但我们不写） | — | `disabled: true` |
| `tool-plugin-market` | `@deepseek-ai/dsh-plugin-market/tools` | （有 Config，但我们不写） | — | `disabled: true` |

## 三、`compaction` 组的 `isolate` 写法

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config: [ ...三个子行... ]
```

- 类型：`isolate?: Dict<true | string>`（`@deepseek-ai/cordis-plugin-loader` 的 `EntryOptions`）；
- `true` → 为该 entry 建**本地隔离域**（realm 后缀 `#<entry.id>`）：组里 provide 的 `compaction` /
  `toolResultPruner` 服务只在组内可见，不继承也不污染父级同名服务；
- 填字符串 → 变成**同名 realm 共享**的全局隔离域（多个 entry 用同一 label 会共享一套服务），
  QQ 场景不要用。

**"与 preset-standard 是否等价"的结论：**

| 关注点 | 结论 |
|---|---|
| `isolate` 写法 | 与 standard 一致（直接从 `dsh --profile web --dump-config` 抄的），键合法、语义为 entry 本地隔离 |
| `tool-result-pruner` 三个阈值 | 与我们写的值**逐字等于插件默认**（8192/4096/1024），等价于没改 |
| 真正的差异点 | 只剩 `command-compact`（群聊用不上）与 `compaction-basic` 全用默认 |

所以**长会话压缩行为应与 standard 一致**。真出问题，先怀疑 `compaction-basic` 的
`thresholdRatio / headroomTokens` 默认值是否适合群聊（消息短、轮次多），而不是 `isolate`。

## 四、已评估但暂不启用（附真实工具面）

| id | 包名 | 工具面 | 结论 |
|---|---|---|:--:|
| `tool-skill` | `@deepseek-ai/dsh-tool-skill` | `skill(name)` —— 只加载一段指令文本 | ⏸ 安全但群里收益低，等自定义群聊技能 |
| `skill-filesystem` | `@deepseek-ai/dsh-skill-filesystem` | 技能来源 provider（`includeDefaultRoots` 默认 true，扫 dshHome / agentsHome） | ⏸ 会扩大技能搜索根，暂不需要 |
| `tool-schedule` | `@deepseek-ai/dsh-tool-schedule` | `schedule_create` / `list` / `update` / `delete` | ⏸ 唯一能"到点提醒"的件，但**绕过 proactive 节流**，先补节流 |
| `tool-jobs` | `@deepseek-ai/dsh-tool-jobs` | `job_list` / `job_output` / `job_kill` | ❌ 没有启动工具（在 bash 里），bash 已砍 → 无用 |
| `tool-goal` | `@deepseek-ai/dsh-tool-goal` | `create_goal` / `get_goal` / `update_goal`，驱动自动续接多轮 | ❌ 群友一句话就能让 Agent 连跑多轮 |
| `command-goal` | `@deepseek-ai/dsh-command-goal` | 斜杠命令 `/goal` | ❌ 群里没人敲 |
| `planning`（组） | — | plan mode：进入 / 退出都要人批准 | ❌ QQ 群没有批准通道，会卡住 |

⏸ = 有前置条件，条件满足后可启用；❌ = 不打算启用。改动前请更新 ADR-011。

## 五、preset 本身能装什么

`@deepseek-ai/dsh-agent-preset` 的 `Config` 只有五个字段：

```js
{ id: string(required), name?: string, description?: string, order?: number, plugins: array(required) }
```

- **没有人格文本字段** —— 人格必须由挂上去的 `persona` 子插件提供（ADR-006）；
- **不继承** —— `plugins: []` 就是空能力集，不是"继承 standard"（ADR-009）；
- 挂载后要手动把 `dsh-qq-bot` 的 `agentPresetCustom` 填成 `qq`，且**只影响新会话**。

**这条 preset 从哪来**：由 `dsh-qq-whale` 的包内 `cordis.patch.yml` 经 `dsh.bundle.patch` 插入组合树，
所以**插件必须先被装进 profile**（`dsh plugin --profile web add dsh-qq-whale`；未发 npm 时按插件 README 手动两处登记）。
装没装上的检查方式：`dsh --profile web --dump-config | grep preset-qq`。

> 需要绕开插件安装时，`preset-qq` 这条条目也可以**直接手写进** `$DSH_HOME/profiles/web/cordis.patch.yml`
> （profile patch 能凭空建条目，`name` 指向官方 `@deepseek-ai/dsh-agent-preset` 即可）。
> 但那样就失去了「可卸载、可进插件市场」的分发形态，见 ADR-012。
