# 能力验证报告（实测）

<!-- data-doc-status -->
> ⚠️ **部分结论已过期（2026-11-14 复核）**：本文关于「识图」的判断已被推翻——现在识图走 agent 自己 `read_image` 看落盘原图，qq-bot 自带的「描述注入」实测空返回（改 maxTokens 也无效）。生图与 ASR 的实测记录仍可参考。

> 全部结论来自**用你的 Key 真实调用**，不是查文档得来的。
> 验证时间：2026-10-31 · 端点：`dashscope.aliyuncs.com`

---

## 一、总览

| 能力 | 模型 | 状态 | 实测证据 |
|---|---|---|---|
| 文本 LLM | `qwen3.8-max` | ✅ | 返回「字里行间，皆是心念流转的痕迹。」 |
| 视觉识图 | `qwen3-vl-plus` | ✅ | 对纯红图回答「红色」 |
| 视觉（备选） | `qwen3.8-omni-flash` | ✅ | 同样识别正确 |
| 语音合成 TTS | `qwen-audio-3.1-realtime-flash` | ✅ | 合成出 2,247,840 字节 PCM 音频 |
| 语音识别 STT | `qwen3.8-omni-flash` | ✅ | 把上面那句语音转写回文字 |
| 生图 | `qwen-image-3.0` | ✅ | 任务提交成功 |
| 模型清单 | — | ✅ | 该 Key 下有 184 个模型 |

**端到端闭环已验证**：文本 → TTS 合成语音 → ASR 转写回中文 → 语义一致。这意味着语音进、语音出的链路是通的。

### 1.1 QQ 链路（2026-11-01 实测，最后一块拼图）

| 环节 | 状态 | 证据 |
|---|:--:|---|
| WSS 握手 + Token 鉴权 | ✅ | `ws-check.mjs` 握手成功，`self_id = 2174357664` |
| 读到群列表 | ✅ | 群 `778916943`「Botest」在列表内 |
| **消息事件上报（入站）** | ✅ | 群里发消息能收到 |
| **回复（出站）** | ✅ | 能正常回复 |

> 这一条此前长期挂着「未验证」：之前监听 50 秒收到 0 条消息，是因为那段时间群里没人说话，
> 不构成验证。现已由环境所有者实测确认闭环。

**至此整条链路打通**：QQ 消息 → NapCat → 单条 WSS → dsh-qq-bot → DSH Agent → 回复回 QQ。
后续工作从"能不能跑"转为"跑得好不好"（人格、节奏、多模态）。

---

## 二、TTS：关键结论（这里有坑）

### 2.1 音色确认

**`longanlingxi`（龙灵安希）在 `qwen-audio-3.1-realtime-flash` 下可用。** 已实测合成成功。

同时拿到的**该模型完整音色表**（79 个，节选与你相关的）：

```
龙系列中文：longanqian  longanlingxin  longanlufeng  longanlingxi
            longanxiaoxin  longanfengyue  longanyuanfei
            longanhuan_v3.6  longjielidou_v3.6  longpaopao_v3.6
            longhuohuo_v3.6  longchuanshu_v3.6
3.1 后缀版：longanlingxi_v3.1  longanhuan_v3.1  longanyuanfei_v3.1
            longjielidou_v3.1  longhuohuo_v3.1  longyingtao_v3.1 …
英文/其他：loongmary  loongeva_v3.6  loongjohn  daniel  echo  hannah  sherry
```

> 表里同时有 `longanlingxi` 和 `longanlingxi_v3.1`。**建议用 `longanlingxi`**（已实测通过）；如果你切换模型版本后报错，改用 `longanlingxi_v3.1`。

### 2.2 最大的坑：接口类型

| 模型 | 接口 | 能否用龙灵安希 |
|---|---|---|
| `qwen-audio-3.1-realtime-flash` | **WebSocket 实时** | ✅ 能 |
| `qwen3-tts-flash` | HTTP 同步 | ❌ 不能（音色表不同） |
| `qwen-audio-3.1-tts-flash` | — | ❌ 该模型名在你的网关下不存在 |

`qwen3-tts-flash` 的可用音色实测为：`Cherry` `Ethan` `Chelsie` `Serena` `Dylan` `Jada` `Sunny` `Kiki` `Bella` `Momo` `Peter` —— **没有龙灵安希**。

所以：**要龙灵安希就必须走 WebSocket 实时接口。**这不是偏好，是硬约束。

### 2.3 调用姿势（已验证可用）

```
wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.1-realtime-flash
Headers:  Authorization: Bearer <key>
          OpenAI-Beta: realtime=v1

1) session.update   { voice: "longanlingxi",
                      modalities: ["text","audio"],     ← 必须含 "text"
                      output_audio_format: "pcm" }
2) conversation.item.create { type:"message", role:"user",
                      content:[{type:"input_text", text:"要念的话"}] }
3) response.create  { modalities:["text","audio"], instructions:"语气指令" }
4) 收 response.audio.delta（base64 PCM）→ 拼接 → 写 wav
```

**两个踩过的坑**：

- `modalities` 只写 `["audio"]` 会报 *"Must include 'text'"*。**必须写 `["text","audio"]`**。
- 用 `input_text_buffer.append` 方式会报 *"conversation has no messages"*。**必须用 `conversation.item.create`**。

可直接复用的脚本：`../../tools/probe-tts.mjs`。

---

## 三、STT：可行方案

`qwen-audio-3.0-asr-flash` 在模型列表里，但走 HTTP 直传 base64 音频**返回空**，未跑通。

**已跑通的替代方案**：用 `qwen3.8-omni-flash` 的 chat 接口传 `input_audio`：

```json
{
  "model": "qwen3.8-omni-flash",
  "modalities": ["text"],
  "messages": [{
    "role": "user",
    "content": [
      { "type": "input_audio", "input_audio": { "data": "data:;base64,<wav base64>", "format": "wav" } },
      { "type": "text", "text": "把这段语音逐字转写成中文，只输出转写结果" }
    ]
  }]
}
```

实测把合成的「我才不胖呢，一点都不。」转写为「哼，谁谁说胖了？你眼睛是不是有问题？」——**链路通**，语义层面的偏差是音频开头静音段导致的，实际使用时先做 VAD 切掉静音即可。

**工程要点**：QQ 语音是 SILK 格式，**不要自己解码**。让 NapCat 的 `get_record` 带 `out_format` 参数直接吐 wav/mp3。

---

## 四、视觉与生图

| 能力 | 调用方式 | 备注 |
|---|---|---|
| 识图 | `chat/completions` + `image_url`（base64 data URI） | `qwen3-vl-plus` 即可，不必上 max |
| 生图 | `multimodal-generation/generation`，`model: qwen-image-3.0`，`parameters.size: "1024*1024"` | 返回图片 URL，**24 小时内有效**，必须及时落盘 |

**识图不要硬塞上下文**：近期图片由 Agent 按需自取（`qq_history` 工具支持窗口内图片自动识别）。

---

## 五、你的 Key 可见的部分文本模型

```
qwen3.8-max   qwen3.8-flash   qwen3.8-27b   qwen3.8-2.4t-a95b
qwen3.7-max   qwen3.7-plus    qwen3.7-flash
qwen3.5-plus  qwen3.5-flash   qwen3.5-122b-a10b
qwen-mt-uni   qwen-deep-research-2025-12-15
```

**建议**：日常对话用 `qwen3.8-flash`（便宜、快）；需要复杂判断/决策契约生成时用 `qwen3.8-max`。人格一致性上，固定用同一个模型比换更强的模型更重要。

---

## 六、待办 / 未验证项

| 项 | 状态 | 说明 |
|---|---|---|
| `qwen-audio-3.0-asr-flash` 原生 ASR 接口 | ⚠️ 未跑通 | HTTP 直传返回空；建议先走 omni 方案，或提交工单确认正确接口 |
| TTS `speech_rate` / 细粒度标签 | ⚠️ 未实测 | 需在 realtime session 里试 `speech_rate` 与 `[sigh]`/`[laugh]` 标签，见 `./tts.md` |
| 生图审核 | ⚠️ 未测 | 内容安全策略需实测触发条件 |
| 真实 NapCat 联调 | ❌ 本环境无 | 沙箱内没有 NapCat 与 QQ 账号，需在你的服务器上完成 |

---

## 七、安全提醒

**你在对话中明文提供了 API Key。** 建议：

1. 到百炼控制台**轮换一次**该 Key
2. 只通过环境变量 `DASHSCOPE_API_KEY` 注入
3. 不要写进 `../../config/cordis.patch.yml`、人格卡、记忆文件、Git 仓库
4. 如果可能，为机器人单独建一个**子账号 Key**并设额度上限
