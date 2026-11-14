# ADR-013 语音能力（TTS/STT）的实现路线与协议评估

- 状态：**已定（2026-11-15）**，其中 TTS 受账户计费阻断、STT 待上游
- 相关：ADR-010（受限 preset）、ADR-012（whale 只做 preset）、`packages/dsh-qq-voice`

## 背景

用户要求给 QQBot 加 TTS 与 STT，并明确两条约束：

1. 「不要重复造轮子，确认在符合本 Bot 架构下是否有合适的插件，没有才自建插件」
2. 「移除补丁，我不希望通过补丁去调整，观察是否可以通过插件本身配置来关闭」

因此必须先回答：**现有生态里有没有能直接用的？** 再看字节码层面到底卡在哪。

## 关键事实（全部实测/读码，不是推测）

### F1. qq-bot 入站把音频丢了

| 路径 | 行为 | 证据 |
|---|---|---|
| CQ 字符串 | `[CQ:record,…]` → 文本 `'[语音]'`，`url`/`file` 丢弃 | `lib/transport/adapters/onebot11.mjs` 的 `cqToText`：`case 'record': return '[语音]'` |
| 段数组 | `summarizeSegments()` 只产出 `text/images/imageUrls/imageMeta/replyTo/mentions` | `lib/message/segments.mjs:161-170` |

**结论：归一化后的事件里没有任何音频字段**，模型与工具（含 `qq_history`）都拿不到音频 URL/文件。
→ STT 在「不改 qq-bot」的前提下**无法拿到输入**。

### F2. qq-bot 出站支持 record，但没有入口

| 事实 | 证据 |
|---|---|
| 适配器**原样透传** `command.message` 给 `send_group_msg` / `send_private_msg`，不校验段类型 | `onebot11.mjs` `case 'send'` 分支 |
| 桥接契约的段类型含 `record` | `lib/transport/bridge/CONTRACT.md` |
| 其它适配器都有 record 实现（milky/onebot12/satori/qq-official） | 各适配器 `case 'record'` |
| **但** `qqbot` 工具只能拼 text/image（image 还限 `QQ_msg/qq-images`） | `lib/tools/index.js` |
| **且** qq-bot 只注册 6 条 HTTP 路由（bind / bind-refresh / defaults / settings / sticker / sticker-rebuild），**没有发送路由** | `lib/gateway/routes-*.js` 的路径常量 |
| **且** 全仓无 `ctx.provide`，不暴露任何 Cordis 服务 | `grep -r ctx.provide` 0 命中 |

→ TTS 在「不改 qq-bot」的前提下**无法借用它的连接发送**。

### F3. 社区插件存在，但都错位

| 插件 | 能力 | 为什么不能用 |
|---|---|---|
| `tencent-connect/dsh-qqbot`（**腾讯官方**，589★） | 有 `sendVoice()`（支持 mp3/wav/ogg/aac/silk/amr）与 `qqbot_send_file` 工具 | 走 **QQ 官方开放平台协议**（`AppID`/`AppSecret` + QQ WebSocket），与本机 **NapCat / OneBot 11** 链路不兼容；切换等于换协议与机器人身份 |
| `ppy-web/dsh-plugin-xiaomi-mimo-tts`（npm `dsh-xiaomi-tts`） | 浏览器朗读 + MiMo/豆包/Breeze 音色；有「QQ Bot 联动」 | 它的联动调的是 `qqbot_send_file` —— 即上面那个**官方协议插件**的工具，本机没有该工具 |
| `1624318455/dsh-plugin-tts` | Edge TTS / 本地 RVC / CosyVoice / GPT-SoVITS 朗读 | 服务对象是 DSH Web 界面朗读，不含 QQ 出站 |
| `qishuilalala/dsh-voice-mode`、`haoku123/dsh-voice` | 麦克风 → ASR（本地 SenseVoice） | 输入源是浏览器麦克风，不是 QQ 语音消息 |

**结论：NapCat + OneBot 这条路，社区没有现成的「QQ 语音收发」插件。**

### F4. 官方 DSH 有 STT 服务，缺的是上游喂数据

`@deepseek-ai/dsh-experimental-speech-to-text`（服务）+ `-sensevoice`（本地 SenseVoiceSmall ONNX，**不需要 Python**，模型约 1 GB）已在本机挂载；接口是 `resolve({audio: Uint8Array}) → transcribe(spec)`，**要求 16 kHz 单声道 PCM16 WAV**。

## 决策

### D1. TTS 自建独立插件 `dsh-qq-voice`（已实现，真机验证过发送）
- 自己连**第二条 WS**（`wss://qapi.civer.cn`）发 `record` 段
- **只发不收**：绝不响应任何事件，否则 NapCat 事件广播会与 qq-bot 形成双回复（已写成纪律测试）
- 实测：`WAV` 可直发，**不需要 silk/ffmpeg**
- 权限与节流在插件自身（owner 判定 + 群白名单 + 每小时 6 条 + 10 秒冷却）；解析不到发言人身份就拒绝

### D2. STT 暂缓，等上游
不自行实现「第二条 WS 收事件 + 自己转写 + 注入 qq-bot 会话」——那会与 qq-bot 同时处理同一条语音，产生双回复，且注入通道拿不到。**正解是上游把 record 的 url 传下来（约 10 行），或在 NapCat 侧做转写。**

### D3. 不切换协议（暂）
「换到腾讯官方插件」能一次拿到 `sendVoice` / 文件发送 / 官方协议 ASR 文本，但代价是更换机器人身份与部署方式，属于产品级决策，**需用户拍板后再评估**，不在本 ADR 内决定。

## 后果

- 语音发送**零补丁**可达，但**每个部署多一条 WS 连接**（有双回复风险，靠「只发不收」纪律规避）
- STT 不可用，`[语音]` 仍是占位文本
- 账户计费成为 TTS 的唯一外部依赖（见下）

## 遗留

- 2026-11-15 实测：`maas.qianwenaiapi.com` 对所有模型（含普通 chat）返回 `403 AccessDenied.Unpurchased`；`dashscope.aliyuncs.com` 的 `qwen3-tts-flash` 由 200 变为 `400 Arrearage`。**两处都需用户侧开通/充值**，与代码无关。
