# ADR-009：`plugins: []` 不是继承，是"什么都没有"（修订 ADR-008）

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：真机实测推翻了 ADR-008 里"plugins 留空 = 继承默认"的假设

## 一、ADR-008 错在哪

ADR-008 写：

> 官方 `preset-standard` 的 `plugins` 就是 `[]`，说明基础工具面不靠它列举。
> 先留空 → 验证人格与现有工具都还在 → 再逐个加我们的扩展。

**这个"说明"是推断，不是事实。** 真机部署里的 `preset-standard` **明确列了 22 行子插件**：

```
persona · agent-instructions · time-context · tool-bash · tool-pwsh · tool-fs
tool-fs-search · tool-jobs · tool-schedule · skill-filesystem · tool-skill
command-goal · tool-goal · planning · compaction · delegation
tool-ask-user · tool-todo · tool-web · present · tool-plugin-manager · tool-plugin-market
```

`@deepseek-ai/dsh-agent-preset` 的官方定义是"定义 Agent 的**子插件列表**"——
**没有 base / 继承 / 合并机制**（翻遍该包文档与组合树也没找到）。

## 二、后果：差点把机器人搞成空壳

若按 ADR-008 的做法装上 `preset-whale`（`plugins: []`）并把
`dsh-qq-bot.agentPresetCustom` 填成 `whale`：

| 能力 | 结果 |
|---|---|
| qqbot 自己注册的收发工具 | ✅ 还在（消息仍能回） |
| 人格注入（persona） | ❌ 消失 |
| 项目指令（agent-instructions） | ❌ 消失 |
| 文件 / Shell / Web / 搜索 / skill 工具 | ❌ 全部消失 |
| 规划 / 压缩 / 委派 / 待办 | ❌ 全部消失 |

**结果：Agent 塌成"只会聊天的空壳"**，而且因为消息还能回，短期内不易察觉。

这属于**静默降级**——比报错危险得多。

## 三、决策

1. **从 bundle patch 撤下 `preset-whale` 条目**（立即执行），文件里写明为什么不要加回去；
2. **在拿到 `preset-standard` 的完整 plugins 列表之前，不提供任何 preset**；
3. 将来要提供 preset，只能走"照抄 + 扩展"：
   抄下 `preset-standard` 的全部子插件行，再追加 TTS / STT 等自己的行。

## 四、需要的输入

请把部署里 `preset-standard`（或你 profile 组合树中任一标准 preset）的
**完整 YAML（含每一行的 `name` 包名）** 贴出来。有了它才能安全地生成 `preset-whale`。

在此之前：**不要**把 `agentPresetCustom` 填成任何自建 preset id。

## 四·五、替代方案（更优）：不建 preset，改走工具全局注册

用户反问："如果加入官方标准工具，岂不会导致越界？"——方向对，但结论相反：

**当前 `dsh-qq-bot` 的默认值就是 `agentPreset: 'standard'`**，也就是说现在会话本来就带着
`tool-bash` / `tool-fs` / `tool-web` 这一整套。照抄 22 行自建 preset **不会新增越界风险**。

安全边界从来不是"不装这些工具"，而是：

| 边界 | 字段 |
|---|---|
| 访客禁用 DSH 内部工具 | `auth.guestDshTools: false` |
| 访客例外名单 | `auth.guestToolAllow` |
| 敏感操作动态码 | `flowAuth.gatedTools` |

**由此得出更优路径**：既然工具可以**全局注册**（qqbot 的工具就是插件全局注册的——
切了空 preset 消息仍能回，可证），那么将来的 TTS / STT 也做成"注册工具"的插件即可，
**不需要自建 preset，也不需要抄那 22 行**。

| 方案 | 要抄 22 行 | 越界增量 | 抄错风险 |
|---|:--:|:--:|:--:|
| 自建 preset（照抄 + 扩展） | 是 | 无 | **高**（`name` 包名无法推断） |
| **工具插件全局注册（采用）** | **否** | **无** | **无** |

因此：**preset 这条路冻结**，除非将来实测发现"第三方插件的工具不进会话"，
那时再照抄 22 行 + 追加自己的行。

## 五、教训（这条比前几条更痛）

| 之前的教训 | 这条 |
|---|---|
| 声明与文件必须同生共死（ADR-004） | 同类：凭"看起来合理"下结论 |
| 先盘原生能力再写插件（ADR-007） | 同类：没验证就当事实 |
| — | **"留空"不等于"继承"** |

**空数组的语义要问清楚，不能猜。** `plugins: []` 看着像"不额外加东西"，
实际是"什么都不要"——这两种语义在配置系统里天差地别，且后者通常静默生效。
