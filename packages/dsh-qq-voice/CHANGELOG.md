# 变更记录 · dsh-qq-voice

本文件只记**这个包**的变化。仓库级变更见根目录 `CHANGELOG.md`。

## [Unreleased] - 2026-11-15

把语音参数的**决定权交给模型**：音色与种子不再是配置里钉死的常量。

### Added
- `qq_voice` 新增三个可选参数：
  - `voice`：音色 id **或名字**（别名）；配了目录时只认目录内的
  - `seed`：`0 ≤ seed < 2^31`，换 seed 换语气与节奏
  - `style`：自然语言语气说明，作为 `instruction` 透传给支持它的端点
- 配置新增三项（全部 volatile）：
  - `voices`：可选音色目录 `[{id,label,note}]`，**会渲染进工具描述**，模型才知道能挑什么
  - `seedMode`：`model`（模型决定，没传则随机）/ `fixed`（永远用 `defaultSeed`）/ `random`（每次随机）
  - `defaultSeed`：`fixed` 模式用，兼作非法值兜底

### 补齐官方 Qwen-Audio-TTS 的全部可调参数（0.2.0 内）
- `qq_voice` 再新增三个可选参数：`rate` 语速 0.5~2.0、`pitch` 音调 0.5~2.0、`volume` 音量 0~100
- 配置新增 `defaultRate`(1.0) / `defaultPitch`(1.0) / `defaultVolume`(50)；优先级：工具值 > 配置默认 > 不传
  - 键缺失才回落出厂默认；显式 `null` 表示「别传」；`rate`/`pitch` 写 0、`volume` 写 -1 也视作不传（哨兵）
- 模板新增数字占位 `{{rate}}`/`{{pitch}}`/`{{volume}}`；没给值时渲染成 1.0/1.0/50，不会把占位符留在 JSON 里
- **越界不报错**：夹到边界并在返回的 `notes` 里说明（如 `rate 3 已夹到 2`），避免一次笔误让整条语音失败
- 工具描述补充情绪用法（慵懒调低 rate、低沉调低 pitch）与 `notes` 的存在

#### 真机实测（2026-11-15，qianwenai / qwen-audio-3.0-tts-flash）
同一句、同音色、同 seed，只改一个参数看产出时长：
`rate` 0.5→5.28s / 1.0→2.64~2.80s / 2.0→1.32s（**确证生效**）；
`pitch` 1.5→1.25s、2.0→0.70s，但 **0.5→12.16s**（两次复现，服务端低端行为异常，建议 0.8~1.2 微调）；
`volume` 不改变时长，只能确认被接受。

#### 为什么说明放工具描述而不是系统提示（依据写进 README）
1. 工具 schema 每轮随请求下发，说明贴在决策点旁边，零额外上下文；
2. preset 系统提示只有 60 字预算且是人格锚点，塞参数说明会污染人格；
3. `voices` 是配置态，写进提示词就得随配置重写，而工具描述本就每次注册时生成。

#### 测试
108 → **121 项**
- `renderTemplate` 支持 `{{seed}}`（**数字占位符，不要加引号**）与 `{{instruction}}`
- `buildTtsBody` 把 `seed` / `instruction` 放进 **`input`**（不是 `parameters`）
- 工具描述动态生成：列出目录里的音色（名字 + 说明 + id）与当前 seed 策略
- 成功结果新增 `voice` / `voiceSource` / `seed` / `seedSource` / `style`，让模型知道这次用了什么

### Fixed
- **随机种子恒为 0 的 bug**：`random() % LIMIT` 对 [0,1) 的小数取模还是它自己，`floor` 后永远是 0；
  改成先取小数部分再乘以 `2^31`。由新单测「resolveSeed：三态矩阵」逮到。

### Tests
- 81 → **108** 项：seed 三态矩阵、音色目录校验/别名、seed 越界回落、`{{seed}}` 的 0 值、
  `instruction` 转义、模板屏蔽参数的说明性用例

## [0.1.0] - 2026-11-15

首批功能：让 QQBot 能发语音。

### Added
- `qq_voice` 工具：`text`（必填）、`message_type`、`target_id`；成功返回 `{ok, sent, target, bytes, seconds, chars, truncated, remaining}`
- `lib/tts.js`：DashScope 原生 TTS 端点客户端，纯函数 + 可注入 `fetch`
  - 默认请求体 `{ model, input: { text, voice? }, parameters: { format } }`
  - `requestTemplate` 可覆盖请求体（`{{text}}`/`{{model}}`/`{{voice}}`/`{{format}}`），换模型不用改代码
  - 响应兼容 `output.audio.url` / `output.audio.data` / `data[0].url` / 裸字符串
  - 401/403/404/429/5xx/超时/空响应各有**可指导下一步**的中文文案
- `lib/sender.js`：只发不收的 OneBot v11 客户端
  - 懒连接、按 `echo` 配对、超时、串行发送、空闲自动断开
  - **收到事件一律丢弃**（不回复、不写入），有专门单测断言"写出 0 字节"
  - 连接期异常也转成 `{ok:false,error}`，绝不向工具调用者抛
- `lib/guard.js`：三层权限（发言人 / 目标 / 节流）
  - 从 QQ 消息头解析 `身份:拥有者` 与 QQ 号；解析不到就拒绝
  - 目标校验读 `cordis.patch.yml` 的 `group.allow` / `auth.owners`（**块扫描，零 YAML 依赖**）
  - 策略读不到时退化为「只允许拥有者给自己发私聊」
  - 节流：每小时条数 + 冷却，限额每次现取（热改不清零已用额度）
- `lib/client/settings.js`：设置页表单（注入 `plugins.bundle.config`，走 `configForms.get`）
  - 密钥字段留空=不修改；保存失败/ revision 冲突都有明确提示
- 配置 19 个字段，**全部 volatile**；`enabled` 与 `mode` 决定是否注册工具
- 测试 71 项（config 9 / tts 16 / sender 10 / guard 17 / tool 13 / client 6）

### Notes
- 为什么不用 dsh-qq-bot 发：它不提供服务、出站没有 `record` 段。见 README §一。
- 为什么不会双回复：我们这条连接只发不收。见 README §二。
- 想让 QQ 会话真的用上本工具，还要把 `qq_voice` 加进 `dsh-qq-whale` 的白名单。见 README §六。
- `mode: always`（文字回复后自动附语音）目前等同 `manual`，未实现。

### 规范对齐（同日，与 whale / vault 同一套「插件规范」）
- 补 `test/package-meta.test.mjs`（10 项）：元信息、catalog、`engines.dsh` 合法性、exports 指向真实文件、
  `files` 清单、图标（SVG + viewBox + <256 KiB）、locale 中英、keywords、**可选 peer 依赖**、不得带 lockfile
- README 重写为与 vault 同构：一、它能做什么（含「一次真实用法」与「设置页长什么样」ASCII）/
  二、安装三条路径（补上**包目录 node_modules 软链**这一步与其原因）/ 三、配置（新增 §3.1 型号与端点对照、
  §3.2 复刻音色两步流程、§3.3 qianwenai 配置样例）/ 四、发送原理 / 五、权限 / 六、与 whale 的关系 /
  七、测试 / 八、未验证项 / 九、已知限制 / 十、卸载
- 记录 2026-11-15 真机事实：`qwen-audio-3.1-tts-*` 是实时(WS)型号（HTTP 报 `url error`）、
  `qwen-audio-3.0-tts-flash` 可用且支持复刻音色、`seed` 在 `input` 里
