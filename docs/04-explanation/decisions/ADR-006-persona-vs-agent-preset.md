# ADR-006：人格继续走 `persona.*`，preset 留给"挂插件"而不是"存人格"

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：提问"能否通过 Agent 预设控制人格？这样不涉及跨插件改配置了吧？"

## 一、先说结论

**方向对，但预期要修正**：preset 能"控制人格"，但**它不存人格文本**——它组合的是插件。
所以"完全不碰 dsh-qq-bot 的配置"做不到，能做到的是**不再往它的配置里塞一大段人格文本**。

## 二、源码事实

`@deepseek-ai/dsh-agent-preset` 的官方定义：

> 在普通 Cordis YAML 中定义 Agent 的**子插件列表**。可同时声明多个 preset，由会话选择。

字段只有：`id`（必填）、`plugins`（必填）、`name`、`description`、`order`——**没有人格/系统提示词字段**。

`dsh-qq-bot` 侧三个引用点：

```js
agentPreset:       'standard'   // 内置四个：standard / ptc / minimal / cordis
agentPresetCustom: ''           // 自定义 id，非空时优先（设置页「高级 → 会话与排错」）
auth.ownerPreset / auth.guestPreset   // 拥有者与访客可分用不同 preset
```

其 `DEVELOPMENT.md` 的原话：

> 两条路互不冲突：**自定义人格**（`persona.*`，每个新会话第一轮附一次设定，**零额外 token**）
> 与**整档 preset**（换的不只是人格还有工具面）……三个 preset 字段只决定人格与工具面偏好，
> **不是安全边界**。

自定义 preset 的写法（官方示例）：

```yaml
- id: preset-qq
  name: "@deepseek-ai/dsh-agent-preset"
  config:
    id: qq
    plugins:
      - id: tool-session-query
        name: "@deepseek-ai/dsh-tool-session-query"
```

## 三、决策

**人格文本继续走 `dsh-qq-bot.persona.text`**，理由：

1. 已验证可用（volatile，设置页可改），零额外 token；
2. preset 放不了文本，硬塞会被忽略；
3. 换成 preset 需要先有一个"提供人格的插件"——而那个插件恰恰是我们还没写的东西
   （`dsh-soul-md` 已被 ADR-005 否决：无法群级分片）。

**同时新增 `buildPresetPatch()`**，输出 preset 骨架，为将来做准备：

- 把记忆、声音、跨群检索等插件挂进 `plugins`；
- 把 `dsh-qq-bot.agentPresetCustom` 填成 preset 的 `config.id`；
- 届时人格由挂上去的插件提供，`persona.text` 退化为"补充设定"。

### 对"不涉及跨插件改配置"的修正

| 方案 | 要改 dsh-qq-bot 的什么 | 人格内容放哪 |
|---|---|---|
| 现状 `persona.*` | `persona.name` + `persona.text`（**一大段文本**） | 塞在它的配置行里 |
| preset 方案 | `agentPresetCustom`（**一个 id**） | 自己的 preset 条目 / 挂上去的插件 |

所以你的判断**基本成立**：人格内容搬出去了，只留一个 id。但那一个 id 仍然要写进它的配置行——
除非将来 `dsh-qq-bot` 支持从别处读 preset 选择。

## 四、什么时候切到 preset

满足任一即可：

1. 我们写出了自己的**记忆插件**（带群级分片），需要挂进 preset 才能生效；
2. 需要给拥有者和访客不同的人设（`auth.ownerPreset` / `auth.guestPreset`）；
3. 需要给 QQ 会话挂专属工具（如 `tool-session-query` 做跨会话检索）。

## 五、代价

- 现状下人格文本仍然写在 `dsh-qq-bot` 的配置行里，`sync-persona.mjs` 这一步跨插件写入依然存在；
- preset 骨架目前只是输出，没人消费——属于提前铺路，别误以为已经生效。
