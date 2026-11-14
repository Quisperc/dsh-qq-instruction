# 待办

> 本项目的**唯一待办清单**。其它地方（README、ADR 正文、聊天记录）出现的待办，最终都要落到这里。
> 规范见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §10：**改完先记 CHANGELOG，再回来划掉这一条。**

---

## 一、还没做

| # | 事项 | 为什么 | 验证方法 |
|---|---|---|---|
| 1 | **生图**：`imageGen.enabled=false`，且端点不通 | 两处阻塞：插件只会拼 `<baseUrl>/images/generations`，DashScope 该路径 404；`DASHSCOPE_API_KEY` 未注入。要么换 OpenAI 兼容生图商，要么改 30–60 行接原生端点 | 群里说「画个 X」能出图且落盘 |
| 2 | 补上真正缺的能力：**TTS / STT 工具** | `dsh-qq-bot` v0.12.8 **完全没有实现**（无 `tts`/`stt` 配置组，入站语音只渲染成「[语音]」）。见 [`tts.md`](docs/03-reference/tts.md) 末尾的「必须自己写」三条 | 私聊发语音能听、回复能出语音 |
| 3 | 主动发言：`proactive.dryRun: true` 跑两天看日志，再改 `false` | 直接开会在群里刷屏 | 两天后查日志，触发率合理再放开 |
| 4 | 私聊准入：`private.allow: []` 当前 = 所有人可私聊 | 空数组在 OneBot 语义里是「不限制」，群里却有白名单 | 改成只列你/名单内的人，再让陌生人私聊验一次被拒 |
| 5 | 决定两个「已装未启用」的包去留：`dsh-plugin-guard`、`dsh-prompt-lab` | 它们装在 `dependencies` 但不在 `dsh.profile.bundles`，从未激活过，属于调试期遗留 | 要么登记进 bundles 用起来，要么从 deps 与 node_modules 删掉 |
| 6 | 处理 `napcat.civer.cn` 上暴露的 NapCat WebUI | WebUI 暴露公网 = 任何人都能拿 Bot 发消息 | 公网访问不到 WebUI |
| 7 | 按月设 DashScope 额度上限 | 防止异常调用烧钱 | 控制台确认额度已设 |

---

## 二、定期复查

| # | 事项 | 触发时机 | 依据 |
|---|---|---|---|
| 8 | 复查 [`docs/03-reference/preset-qq-contract.md`](docs/03-reference/preset-qq-contract.md) 的 preset 行契约 | **DSH 升级后**（官方包改字段就会漂移） | ADR-011 §五。测试 `test/preset.test.mjs` 会挡住写错的键 |
| 9 | 复查 [`docs/03-reference/config-schema.md`](docs/03-reference/config-schema.md) 的字段表 | `dsh-qq-bot` 插件升级后（当前对的是 v0.12.8） | 字段来源是该版本包内 schema |
| 10 | 复查 ADR-011 §四「暂不启用」的 `tool-schedule` | 给 `dsh-qq-bot.proactive` 补上节流之后 | 它触发时**不走 proactive 节流**，补了节流才安全 |

---

## 三、安全处置（发现即写，按风险排序）

| # | 事项 | 风险 | 处置 |
|---|---|---|---|
| 11 | **轮换 NapCat token** | 高。当前 14 位弱令牌，且**已在 Git 历史里明文出现** | `openssl rand -hex 32` 生成新 token，同步改 NapCat 与两侧 `cordis.patch.yml` |
| 12 | 轮换 DashScope API Key | 高。曾在对话中明文出现 | 控制台换 key，确认只走环境变量 |
| 13 | **清理 Git 历史里的明文密钥** | 高（转公开前必做）。`config/cordis.patch.yml` 含真实 token / BotQQ / owner QQ / 群号 | 见 [`docs/02-how-to/sync-assets.md`](docs/02-how-to/sync-assets.md) §4。**Git 历史永久保留，事后删文件无效**，必须 `filter-repo` |
| 14 | 转公开 / 外发前跑 `scripts/scrub-secrets.py` | 中。当前仓库私有，风险可控 | 生成脱敏版并确认真实值已移除 |

> 第 11–13 条是同一件事的三个阶段：**先轮换（当作已泄露）→ 再清历史 → 才能转公开**。
> 只做第 3 步不做第 1 步，等于把已经泄露的密钥公开出去。

---

## 四、已完成（留痕，下次别再做一遍）

| 事项 | 完成于 | 记录 |
|---|---|---|
| 入站消息事件验证 | 2026-11-01 | 群里发消息能收到并回复 |
| `ctx.whale` 改走 `ctx.provide` | 2026-11-01 | ADR-011。此前从 v0.2.0 起 host 半一直没激活成功 |
| 设置页配置表单上线 | 2026-11-01 | 插件 v0.6.0，CHANGELOG `[1.12.0]` |
| `preset-qq` 落地 | 2026-11-01 | CHANGELOG `[1.11.0]`。ADR-010 当时标注的「待实施」已解除 |
| whale 收窄为只提供 preset | 2026-11-01 | CHANGELOG `[1.14.0]` / 插件 v0.7.0，ADR-012 |
| **灌入人格**（`persona.text` 4473 字符） | 2026-11-01 | 群里问「你是谁」符合大肥鱼设定；vault 已能把它当**生效值**备份/恢复 |
| **`preset-qq` 真机生效** | 2026-11-14 | 新会话系统提示是「你不是助手也不是工具…」，会话头 `agentPreset: qq` |
| 工具面收窄真机生效 | 2026-11-14 | 白名单 23 项；`bash`/`terminal_*`/`subagent`/`workflow` 不可见 |
| 识图可用 | 2026-11-14 | 走 agent 自己 `read_image` 看 `QQ_msg/qq-images/` 落盘图；qq-bot 自带「描述注入」空返回，已放弃 |
| 设置页配置 + 备份/导入插件 | 2026-11-14 | whale v0.14.0（`mode` + `allowTools`）、vault v0.4.0（导出/导入/上传） |
| 旧组件清理 | 2026-11-14 | 卸 `dsh-onebot-hub`/`dsh-qq-extras`，旧实例数据归档到 `QQBot/archive/` |

---

## 五、明确不做（省得反复讨论）

| 事项 | 为什么不做 |
|---|---|
| 把 `web_search` / `web_fetch` 加回白名单 | 与 `dsh-qq-bot` 自带的 `qq_websearch` / `qq_webfetch` 功能重复，只会让模型在两个等价工具间犹豫 |
| 给 whale 加 `presetId` 之类的「可调 preset id」 | 改了必然坏（preset id 由 `cordis.patch.yml` 决定）；真要改 id 就同时改三处，见 whale README §四 |
| 依赖 qq-bot 的「视觉描述注入」 | 实测空返回（`maxTokens` 512→4096 仍空），补丁已撤销；识图走 `read_image` |
| 用 `dsh plugin add` 装自有插件 | 会走 pnpm，可能清掉 `@deepseek-ai/*` 手工软链导致 DSH 起不来；自有包一律软链 + 两处登记 |
