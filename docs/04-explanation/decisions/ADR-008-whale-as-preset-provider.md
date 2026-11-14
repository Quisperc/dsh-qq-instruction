# ADR-008：`dsh-qq-whale` 改做「preset 提供者」（修订 ADR-007）

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：提议"whale 改为新增 Agent 预设，再由我手动去 dsh-qq-bot 设置页选这个 preset id"

## 一、这个提议解决了什么

ADR-007 判定 whale"不装为插件"，核心理由是它的唯一动作是**跨插件写配置**（`sync-persona.mjs --write` 往 `dsh-qq-bot.persona.text` 塞文本，无官方 API 支持）。

而"新增 preset 条目"完全不同：

| 动作 | 性质 |
|---|---|
| 往 `dsh-qq-bot` 那一行写 `persona.text` | ❌ 改别人的配置（跨插件） |
| **新增**一个 `- id: preset-whale` 条目 | ✅ 写自己的条目，靠 `dsh.bundle.patch` 官方机制 |
| 用户在设置页填 `agentPresetCustom: whale` | ✅ 一次性、可见、用户主动——就是正常用法 |

**结论：可行，且确实避免了跨插件操作。** 这是官方推荐路径，不是 hack。

## 二、源码依据

### 2.1 preset 是什么

`@deepseek-ai/dsh-agent-preset` 官方定义："在普通 Cordis YAML 中定义 Agent 的**子插件列表**"。
字段：`id`（必填）、`plugins`（必填）、`name`、`description`、`order`。

写法（插件文档示例）：

```yaml
- id: preset-qq
  name: "@deepseek-ai/dsh-agent-preset"
  config:
    id: qq
    plugins:
      - id: tool-session-query
        name: "@deepseek-ai/dsh-tool-session-query"
```

### 2.2 "②③ 全被忽略"到底指什么（关键澄清）

设置页三个字段（来自 `lib/settings-core-set.json` 的 label）：

| 标号 | 字段 | hint 要点 |
|---|---|---|
| **①** | `agentPresetCustom` | 优先级最高；生效时 **②③ 全被忽略** |
| **②** | `auth.ownerPreset` / `auth.guestPreset` | 拥有者/访客分流 |
| **③** | `agentPreset` | 兜底，默认 `standard`；①② 都留空时才用 |

**②③ 是两个 preset 字段本身，不是 `persona.*`。**
所以填了 `agentPresetCustom` **不会**让 `persona.text` 失效——人格注入是 QQ 插件自己的行为
（每个新会话第一轮附一次），与 preset 选择是两条独立路径。

> ⚠️ 但"整档接管人格 + 工具面"这句仍有歧义：**若 preset 里挂了人格类插件，两者如何叠加未经验证**。
> 真机验证方法：填了 preset 之后 @ 它一句，看是否还带着大肥鱼的口吻。

### 2.3 preset 不是安全边界

文档明确：三个 preset 字段"只决定人格与工具面偏好，**不是安全边界**
（边界是访客工具白名单与流程授权）"。

所以自建 preset 不会削弱权限管控——`auth.*` / `guestToolAllow` / `flowAuth.*` 照常生效。

## 三、决策

**whale 重新装为插件，但职责收窄为"preset 提供者 + 人设卡内容"：**

1. `dsh.bundle.patch` 新增一个 preset 条目（`id: whale`，`plugins: []`）；
2. **不再**有任何写入 `dsh-qq-bot` 配置的代码（`sync-persona.mjs --write` 保留但标注不推荐）；
3. 用户手动在设置页把 `agentPresetCustom` 填为 `whale`；
4. 将来 TTS / STT 做成插件后，**挂进这个 preset 的 `plugins`** —— 这正是官方推荐的加扩展方式
   （"加装了第三方扩展插件、又没进任何 preset 的，就在自建 preset 的 plugins 里把插件行加进去"）。

### 为什么 plugins 先留空

官方 `preset-standard` 的 `plugins` 就是 `[]`，说明基础工具面不靠它列举。
先留空 → 验证人格与现有工具都还在 → 再逐个加我们的扩展。渐进、可回退。

## 四、对"是不是原本该有的还有，只是多新工具"的回答

**基本正确，但有一处要当心**：

- ✅ 安全项不受影响（权限、访客白名单、流程授权是边界，preset 不管这些）；
- ✅ 被忽略的只有 ② 分流 preset 与 ③ 兜底 preset；
- ✅ TTS / STT 插件挂进 `plugins` 后 Agent 就能用——这是加扩展的正路；
- ⚠️ **"整档接管工具面"意味着 preset 决定 Agent 有哪些工具**。
  先留空验证，别一次挂太多，否则可能发现某些原有工具不见了。

## 五、待验证

| 项 | 怎么验 |
|---|---|
| preset 条目能否被 DSH 正确加载 | 装后看插件管理页有没有报错 |
| 填了 `agentPresetCustom` 后 `persona.text` 是否仍生效 | 群里 @ 一句，看口吻 |
| 留空 `plugins` 是否丢失原有工具 | 让它用一次 `qq_history` / 联网搜索 |
