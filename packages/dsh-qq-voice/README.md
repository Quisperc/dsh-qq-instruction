# dsh-qq-voice

给 QQBot 加**语音回复**：多一个 `qq_voice` 工具，模型觉得该用语音说话时，把文字交给 TTS 合成音频，
再把音频以 `record` 段发到当前 QQ 会话。

> 版本 **0.1.0** · 81 项测试（含元信息/客户端契约）· 发送链路真机验证过（`retcode 0`）
>
> **一条不能忘的平台事实**：`dsh-qq-bot` 的入站会把 `record` 丢成 `[语音]`（音频 URL 丢失），
> 出站适配器虽然支持 `record` 段，但**没有对外的发送入口**（无路由、无服务、工具只发 text/image）。
> 所以本插件**自己连一条 WS**——见 §四。

---

## 一、它能做什么

装上之后：

1. 注册工具 `qq_voice`（owner-only、带节流）；
2. 设置页多一张卡片，可开关、换模型/音色、调节流；
3. 模型在合适的时候调用它 → 合成 → 发语音。

**它不做**：不接管文字回复、不改人格、不碰 qq-bot 的任何配置。

### 1.1 一次真实用法

```text
（私聊或群里，你是拥有者）
你：  念给我听：今天记得吃饭
鱼：  调 qq_voice(text="今天记得吃饭") → 合成 2 秒 → 发出语音气泡
      同时回一句文字（可选）
```

反例：

```text
（群里，非拥有者 @ 机器人）
你：  发条语音
鱼：  qq_voice 拒绝：「这个工具只给拥有者用」——不烧你的额度，也不替你说话
```

### 1.2 设置页长什么样

插件 →「QQ 语音回复（TTS）」：

```text
┌─ 状态 ─────────────────────────────────────────────┐
│ 已启用 · mode=manual · 本小时已用 0/6              │
├─ 开关 ─────────────────────────────────────────────┤
│ [x] 启用语音回复（enabled）                        │
│     收窄模式  ( off ▾ )   ← off / manual           │
├─ TTS ──────────────────────────────────────────────┤
│ 模型   [qwen3-tts-flash                 ]          │
│ 音色   [                                ] 留空=默认│
│ 端点   [https://dashscope.aliyuncs.com/…]          │
│ API key[••••••••••••••••]  secret：留空=不修改     │
│ 或环境变量名 [DASHSCOPE_API_KEY         ]          │
├─ 发送 ─────────────────────────────────────────────┤
│ WS 地址 [wss://qapi.civer.cn            ]          │
│ NapCat token [••••••••]  secret：留空=不修改       │
├─ 权限与节流 ───────────────────────────────────────┤
│ [x] 仅拥有者（ownerOnly）                          │
│ 允许的群 [                           ] 留空=不额外限制│
│ 每小时条数 [6]   冷却秒数 [10]                     │
├────────────────────────────────────────────────────┤
│ [保存]   已保存（revision 12）                     │
└────────────────────────────────────────────────────┘
```

> `configForms` 不可用时（老版本 DSH），卡片会退化成一段只读说明，并告诉你直接改
> `profiles/web/cordis.patch.yml` 里 `- id: dsh-qq-voice` 那段——不会白屏。

## 二、安装（三条路径，选一条）

### 路径 A：插件市场（推荐，能收到更新）

设置 → 插件市场 → 索引源加 `https://quisperc.github.io/dsh-qq-instruction/market/index.json`
→ 发现页搜 `dsh-qq-voice` → 安装。

### 路径 B：GitHub 直装（不经过市场）

```bash
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-voice'
```

### 路径 C：本地开发（软链，改代码即生效）

```bash
# 1) 软链
ln -s /path/to/dsh-qq-instruction/packages/dsh-qq-voice <profile>/node_modules/dsh-qq-voice

# 2) profile package.json 里登记两处（缺一不可）
#    - dependencies："dsh-qq-voice": "file:/abs/path/packages/dsh-qq-voice"
#    - dsh.profile.bundles：追加 "dsh-qq-voice"

# 3) 包目录里再建一个 node_modules 软链（关键，别漏）
ln -s <profile>/node_modules /path/to/dsh-qq-instruction/packages/dsh-qq-voice/node_modules
```

> **第 3 步为什么必须**：包是通过软链挂进 profile 的，Node 按**真实路径**解析依赖。
> 少了这个软链，`@deepseek-ai/dsh-tools` 导入失败 → `qq_voice` **静默不注册**（不报错、界面上也没有）。
> 这个坑真踩过。

**不要在本机跑 pnpm / npm install**：会删掉 `@deepseek-ai/*` 的手工软链，DSH 起不来。

## 三、配置

设置页 →「QQ 语音回复（TTS）」。全部字段 volatile，改完**即时生效**，不用重载插件。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | **false** | 总开关。默认关：没填 key 时开着只会每次报错 |
| `mode` | `manual` | `off` 不注册工具 / `manual` 模型显式调用才发 / `always` 预留（当前等同 manual） |
| `ttsModel` | `qwen3-tts-flash` | 见 §3.1 的型号坑 |
| `ttsVoice` | 空 | 音色名；留空=不传，用模型默认 |
| `apiKey` | 空（secret） | TTS key；留空则读下面的环境变量 |
| `apiKeyEnv` | `DASHSCOPE_API_KEY` | key 的环境变量名 |
| `ttsBaseUrl` | DashScope 原生端点 | **不是 compatible-mode**（那里只有 chat/embeddings） |
| `format` | `wav` | 期望格式；拿到什么就发什么（WAV 可直发，无需 silk/ffmpeg） |
| `requestTemplate` | 空 | 可选：覆盖请求体模板（JSON），支持 `{{text}}`/`{{model}}`/`{{voice}}`/`{{format}}` |
| `wsUrl` | `wss://qapi.civer.cn` | NapCat 的 OneBot v11 正向 WS |
| `accessToken` | 空（secret） | NapCat token；作为 `Authorization: Bearer` 头发送 |
| `idleCloseMs` | 120000 | 空闲多久自动断开（0=不断） |
| `ownerOnly` | **true** | 仅拥有者可用 |
| `allowGroups` | `[]` | 允许语音的群；留空=不额外限制（但仍须在 qq-bot 的 `group.allow` 里） |
| `maxChars` | 300 | 单条语音字数上限，超出截断并如实告知模型 |
| `maxPerHour` | 6 | 每小时条数（0=不限） |
| `cooldownSec` | 10 | 两条之间的最小间隔 |
| `timeoutMs` | 60000 | 合成+下载+发送的总超时 |
| `profilePath` | `/data/dsh/profiles/web/cordis.patch.yml` | 只读，用于校验群白名单与 owners |

### 3.1 型号与端点：三种都叫「qwen tts」，行为完全不同

2026-11-15 真机实测（同一个 key、同一个账号）：

| 型号 | 端点 | 结果 |
|---|---|---|
| `qwen3-tts-flash` | DashScope 原生 `aigc/multimodal-generation/generation` | ✅ 200，返回 `output.audio.url`（WAV，需再下载） |
| `qwen-audio-3.1-tts-flash` / `-tts-plus` | 同上 | ❌ 400 `url error`——它们其实是**实时（WS）型号** |
| `qwen-audio-3.1-tts-*` | qianwenai 的 `audio/tts/SpeechSynthesizer` | ❌ 仍 `url error`（换对端点也不行） |
| `qwen-audio-3.0-tts-flash` | qianwenai `audio/tts/SpeechSynthesizer` | ✅ 可用（并且支持复刻音色） |

**结论**：`400 url error` 不是 key 错（key 错会先 401），是**端点与型号不匹配**。

### 3.2 想用复刻音色（例如 longlinganxi）

系统音色（`Cherry` / `Serena` / `Ethan` / `Chelsie`…）只有 `qwen3-tts-flash` 这类原生型号支持，
**且它不支持复刻音色**。要复刻必须用 `qwen-audio-3.0-tts-flash` 那一路，流程分两步：

```text
① 创建音色（一次性）
POST https://maas.qianwenaiapi.com/api/v1/services/audio/tts/customization
{
  "model": "voice-enrollment",
  "input": {
    "action": "create_voice",
    "target_model": "qwen-audio-3.0-tts-flash",
    "prefix": "longlinx",                 // ≤10 位字母数字
    "audio": "data:audio/wav;base64,…",   // 或公网 URL
    "language_hints": ["zh"]
  }
}
→ voice_id：qwen-audio-3.0-tts-flash-longlinx-<hash>

② 合成
POST https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer
{
  "model": "qwen-audio-3.0-tts-flash",
  "input": { "text": "…", "voice": "<voice_id>", "format": "wav", "sample_rate": 24000, "seed": 2024 }
}
```

> 注意 **`seed` 在 `input` 里**，不在 `parameters` 里。

### 3.3 换到 qianwenai 的配置样例

```yaml
- id: dsh-qq-voice
  config:
    enabled: true
    ttsBaseUrl: https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer
    ttsModel: qwen-audio-3.0-tts-flash
    ttsVoice: qwen-audio-3.0-tts-flash-longlinx-efc30de04468458684cda530c7863e63
    format: wav
    requestTemplate: '{"model":"{{model}}","input":{"text":"{{text}}","voice":"{{voice}}","format":"{{format}}","sample_rate":24000,"seed":2024}}'
    apiKey: <qianwenai key>
```

> 内置请求体是 DashScope 形状（`input.text / input.voice / parameters.format`）；
> 换平台时用 `requestTemplate` 覆盖即可，**不用改代码**。

## 四、它是怎么发出去的（为什么不用 dsh-qq-bot）

两个硬原因，都不是"懒得改"：

| 原因 | 证据 |
|---|---|
| **它不提供服务** | `dsh-qq-bot` 全仓无 `ctx.provide`，拿不到它已经建好的 WS 连接 |
| **它的出站没有入口** | 适配器 `case 'send'` 确实原样透传任意段（含 `record`），但：工具只能拼 text/image；只注册 6 条 HTTP 路由（bind/defaults/settings/sticker），**没有发送路由** |

所以本插件**自己连一条 NapCat 的 WS**（同一个 `wss://`，NapCat 允许多客户端）。

### 4.1 为什么不会双回复（最关键的一条纪律）

> **只发不收。** 只处理带 `echo` 的响应（自己请求的回执）；NapCat 推来的任何事件
> （群消息、私聊、通知、心跳）一律**丢弃**，不回复、不写入。

否则 NapCat 会把事件同时推给两条连接，qq-bot 回一次、我们回一次 = 群里两条重复回复。

`lib/sender.test.mjs` 有专门的纪律测试盯着这条：喂四类事件进去，断言**写出的字节数必须是 0**。

## 五、权限模型（为什么不复用 qq-bot 的判断）

本插件不经过 `dsh-qq-bot`，它的准入逻辑管不到我们；而一旦连上 NapCat，就等于能往任意
群/人发语音。所以这一层是**自己守**的，三层全过才发：

1. **发言人**：从当前会话最近一条 user 消息的头部解析，例如
   `[QQ群 778916943 · 昵称(507678128) · 身份:拥有者｜…]`。**只认「拥有者」**（群主/管理员不算）。
   解析不到（Web 会话、子代理）→ **拒绝**，不做宽松猜测。
2. **目标**：群必须同时在 qq-bot 的 `group.allow` 与本插件的 `allowGroups` 里；
   私聊只允许发给 `auth.owners` 里的人。读不到 profile → 退化为「只允许拥有者给自己发私聊」。
3. **节流**：每小时条数 + 冷却；**先过节流再调 TTS**（别先烧钱再拒绝）；被拒时返回还要等多少秒。

## 六、和 whale 的关系（要让模型真能用，得多做一步）

`qq_voice` 注册在全局工具注册表里，但 QQ 会话的工具面被 `dsh-qq-whale` 收窄着。
**必须在 whale 的白名单里加上 `qq_voice`**（0.1.0 起默认白名单已含它），否则模型看不见这个工具：

```yaml
# profiles/web/cordis.patch.yml 的 - id: dsh-qq-whale 段
config:
  mode: hide
  allowTools:
    - qq_voice      # ← 缺了它，工具注册了也用不上
    # …其余照旧
```

或者设置页 →「QQ 群聊受限预设」→ 工具白名单末尾加一行 `qq_voice`。

## 七、测试

```bash
cd packages/dsh-qq-voice
node --test test/*.test.mjs
```

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `config.test.mjs` | 9 | 默认值、volatile 标记齐全、非法值回落、key 解析优先级 |
| `tts.test.mjs` | 16 | 请求体（含模板覆盖）、响应解析（url/b64）、401/403/404/429/超时/空响应文案、下载与超限 |
| `sender.test.mjs` | 10 | echo 配对、超时、retcode、**事件绝不回应**、连接失败转可读错误、关闭时结算在等请求 |
| `guard.test.mjs` | 17 | owner 解析边界（昵称带括号/数字）、策略块扫描、目标校验、节流与热改限额 |
| `tool-contract.test.mjs` | 13 | 完整 execute 路径：9 类拒绝 + 成功/截断/额度 |
| `client-contract.test.mjs` | 6 | 客户端 id、exports、slot 注入、缺服务不抛 |
| `package-meta.test.mjs` | 10 | 元信息/catalog/exports/files/图标/locale/keywords/peer 依赖/lockfile |

> 先决条件：`@deepseek-ai/*` 未发布到公开 npm，干净克隆里跑测试前需要在本目录建
> `node_modules` 软链指向宿主 profile 的 `node_modules`（见 §二 路径 C 第 3 步）。

## 八、未验证项（如实列出）

- **复刻音色的合成**：`voice_id` 已创建，端到端「用它合成 → 发进群」尚未在真机跑通（受账户计费阻断）
- **`sample_rate: 24000` 的实际输出**：未逐字节核对采样率
- **NapCat 侧对非 WAV 的转码**：只验证过 WAV 直发；mp3/ogg 未测
- **`always` 模式**：未实现

## 九、已知限制

| 限制 | 说明 |
|---|---|
| 需要 TTS key | 没 key 时工具返回「没有 API key」，不会崩 |
| 账户计费是外部依赖 | 2026-11-15 实测：`maas.qianwenaiapi.com` 全模型 403 `Unpurchased`；DashScope `qwen3-tts-flash` 曾由 200 转 `400 Arrearage`（欠费）。**这属于账户侧，不是代码** |
| 音色取值未内联 | `ttsVoice` 的可选值随平台/模型变，本包不猜 |
| `always` 模式未实现 | 目前等同 `manual`（代码里留了 TODO：文字回复后自动附语音） |
| 音频不落盘 | 合成结果直接在内存里转 base64 发出，不留临时文件（也不需要图床/公网 URL） |
| 第二条 WS 连接 | 与 qq-bot 各一条；NapCat 支持，但两边都掉线时要分别重连 |

## 十、卸载

1. 设置页把「启用语音回复」关掉（立即生效，工具变成只返回"未启用"）；
2. 从 `profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 各删掉 `dsh-qq-voice`；
3. 删掉 `node_modules/dsh-qq-voice` 软链；
4. 重启容器。

> 卸载**不影响** qq-bot 与 whale：本插件没改它们的任何配置。whale 白名单里那一行 `qq_voice`
> 留着无害（工具不存在时白名单项会被忽略）。
