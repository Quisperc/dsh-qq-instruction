# dsh-qq-voice —— 给 QQBot 加语音回复（TTS）

> 版本 **0.1.0** · 工具 `qq_voice` · 默认**关闭** · 需要 DashScope API key

把一个工具塞进 DSH：`qq_voice`。模型觉得该用语音说话时，它把文字交给 DashScope 合成音频，
再把音频以 `record` 段发到当前 QQ 会话。

---

## 一、为什么不用 dsh-qq-bot 发语音

两个硬原因，都不是"懒得改"：

| 原因 | 说明 |
|---|---|
| **它不提供服务** | `dsh-qq-bot` 不通过 Cordis 暴露任何服务，拿不到它已经建好的 WS 连接 |
| **它的出站没有 record** | 它的出站消息只支持 `text` / `image`；语音段根本发不出去 |

所以本插件**自己连一条 NapCat 的 WS**（同一个 `wss://`，NapCat 允许多客户端）。

## 二、为什么不会双回复

这是自己连 WS 必须付的代价，也是本插件最关键的一条纪律：

> **只发不收。** 我们只处理带 `echo` 的响应（自己请求的回执）；NapCat 推来的任何事件
> （群消息、私聊、通知、心跳）一律**丢弃**，不回复、不写入。

`lib/sender.js` 有专门的单测盯着这条：喂四个事件进去，断言**写出的字节数必须是 0**。

## 三、安装

三条路，任选：

**1）插件市场**（推荐）
设置 → 插件市场 → 加索引 `https://quisperc.github.io/dsh-qq-instruction/market/index.json`
→ 发现页搜 `dsh-qq-voice` → 安装。

**2）GitHub 直装**
```bash
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-voice'
```

**3）本地开发**（clone 后软链 + 两处登记，本机用这个）
```bash
ln -s /path/to/dsh-qq-instruction/packages/dsh-qq-voice <profile>/node_modules/dsh-qq-voice
# package.json 的 dependencies 写 "dsh-qq-voice": "file:<绝对路径>"
# dsh.profile.bundles 里追加 "dsh-qq-voice"
```
**不要在本机跑 pnpm / npm install**：会删掉 `@deepseek-ai/*` 的手工软链，DSH 起不来。

## 四、配置（设置页 →「QQ 语音回复」）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | **false** | 总开关。默认关：没填 key 时开着只会每次报错 |
| `mode` | `manual` | `off` 不注册工具 / `manual` 模型显式调用才发 / `always` 预留（当前等同 manual） |
| `ttsModel` | `qwen3-tts-flash` | TTS 模型。**注意**：`qwen-audio-3.1-tts-flash` 是实时(WS)型号，HTTP 端点会返回 400 `url error`；HTTP 可用的是 `qwen3-tts-flash`（实测 200 返回 WAV URL） |
| `ttsVoice` | 空 | 音色名；留空=不传，用模型默认（可选值见 DashScope 文档） |
| `apiKey` | 空（secret） | DashScope key；留空则读下面的环境变量 |
| `apiKeyEnv` | `DASHSCOPE_API_KEY` | key 的环境变量名 |
| `ttsBaseUrl` | DashScope 原生端点 | **不是 compatible-mode**（那里只有 chat/embeddings） |
| `format` | `wav` | 期望格式；拿到什么就发什么（实测 WAV 可直接发，无需 silk/ffmpeg） |
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

改完**即时生效**（全部字段 volatile），不用重载插件。

## 五、权限模型（为什么不复用 qq-bot 的判断）

本插件不经过 `dsh-qq-bot`，它的准入逻辑管不到我们；而一旦连上 NapCat，就等于能往任意
群/人发语音。所以这一层是**自己守**的，三层全过才发：

1. **发言人**：从当前会话最近一条 user 消息的头部解析，例如
   `[QQ群 778916943 · 昵称(507678128) · 身份:拥有者｜…]`。
   解析不到（Web 会话、子代理）→ **拒绝**，不做宽松猜测。
2. **目标**：群必须同时在 qq-bot 的 `group.allow` 与本插件的 `allowGroups` 里；
   私聊只允许发给 `auth.owners` 里的人。
   读不到 profile（或读不到那两个键）→ 退化为「只允许拥有者给自己发私聊」。
3. **节流**：每小时条数 + 冷却；被拒时返回还要等多少秒。

## 六、和 whale 的关系（要让模型真能用，得多做一步）

`qq_voice` 注册在全局工具注册表里，但 QQ 会话的工具面被 `dsh-qq-whale` 收窄着。
**必须在 whale 的白名单里加上 `qq_voice`**，否则模型看不见这个工具：

```yaml
# profiles/web/cordis.patch.yml 的 - id: dsh-qq-whale 段
config:
  mode: hide
  allowTools:
    - qq_voice      # ← 加这一行
    # …其余照旧
```

或者设置页 →「QQ 群聊受限预设」→ 工具白名单末尾加一行 `qq_voice`。

## 七、已知限制

| 限制 | 说明 |
|---|---|
| 需要 DashScope key | 没 key 时工具会返回「没有 API key」，不会崩 |
| 音色取值未内联 | `ttsVoice` 的可选值随模型变，本包不猜；留空用模型默认 |
| `always` 模式未实现 | 目前等同 `manual`（代码里留了 TODO：文字回复后自动附语音） |
| 音频不落盘 | 合成结果直接在内存里转 base64 发出，不留临时文件（也不需要图床/公网 URL） |
| 第二条 WS 连接 | 与 qq-bot 各一条；NapCat 支持，但两边都掉线时要分别重连 |

## 八、测试

```bash
cd packages/dsh-qq-voice
node --test test/*.test.mjs
```

| 文件 | 覆盖 |
|---|---|
| `config.test.mjs` | 默认值、volatile 标记齐全、非法值回落、key 解析优先级 |
| `tts.test.mjs` | 请求体（含模板覆盖）、响应解析（url/b64）、401/403/404/429/超时/空响应文案、下载与超限 |
| `sender.test.mjs` | echo 配对、超时、retcode、**事件绝不回应**、连接失败转可读错误、关闭时结算在等请求 |
| `guard.test.mjs` | owner 解析边界（昵称带括号/数字）、策略块扫描、目标校验、节流与热改限额 |
| `tool-contract.test.mjs` | 完整 execute 路径：9 类拒绝 + 成功/截断/额度 |
| `client-contract.test.mjs` | 客户端 id、exports、slot 注入、缺服务不抛 |

> 先决条件：`@deepseek-ai/*` 未发布到公开 npm，干净克隆里跑测试前需要先在本目录建
> `node_modules` 软链指向宿主 profile 的 `node_modules`（或宿主已装同版本）。
