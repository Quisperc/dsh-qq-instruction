# ADR-002：TTS 走实时 WebSocket，不走 HTTP 接口

- **日期**：2026-10-31
- **状态**：已接受（实测修正了初始假设）

## 背景

人格需要固定的声音（龙灵安希音色）。初始假设是可以用 HTTP 同步接口 `qwen-audio-3.1-tts-flash`。

## 决策

使用 `qwen-audio-3.1-realtime-flash`，通过 **WebSocket 实时接口**合成，音色 `longanlingxi`。

## 理由

实测（2026-10-31，用真实 Key 调用）结论：

| 尝试 | 结果 |
|---|---|
| `qwen-audio-3.1-tts-flash` | ❌ 该模型名在网关下不存在（报 url error） |
| `qwen3-tts-flash`（HTTP）+ `longanlingxi` | ❌ 音色不存在（该模型音色表为 Cherry / Ethan / Chelsie / Serena / Dylan / Jada / Sunny / Kiki / Bella / Momo / Peter） |
| `qwen-audio-3.1-realtime-flash` + `longanlingxi` | ✅ 合成成功，产出 2.2MB PCM 音频 |

**音色不能跨模型混用。** 要龙灵安希就必须走实时接口——这不是偏好，是硬约束。

另外两个必须遵守的调用细节（都踩过坑）：

- `modalities` 必须写 `["text","audio"]`，只写 `["audio"]` 报 *Must include 'text'*
- 必须用 `conversation.item.create` 提交文本；用 `input_text_buffer.append` 会报 *conversation has no messages*

## 被否决的备选

- **HTTP 的 `qwen3-tts-flash`**：接口更简单（同步返回 URL），但**没有龙灵安希音色**，而音色是人格的一部分（换音色等于换声带）。
- **改用 HTTP 模型支持的音色**（如 Cherry）：放弃人格锚定，不可接受。

## 后果

**好处**：拿到想要的音色；且实时接口支持 `instruction`（自然语言语气指令）与细粒度标签，这正是「让 LLM 决定这句话怎么说」所需要的能力。

**必须接受的代价**：

- 实时接口是长连接，需要管理连接生命周期、超时、失败重试。参考实现见 `../../../tools/probe-tts.mjs`。
- 输出是 PCM 流，需要自己拼装 wav 头（脚本已实现）。
- 实时接口与 HTTP 的计费/限流模型不同，并发上限需实测确定。
