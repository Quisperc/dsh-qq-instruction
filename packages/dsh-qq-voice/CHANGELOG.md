# 变更记录 · dsh-qq-voice

本文件只记**这个包**的变化。仓库级变更见根目录 `CHANGELOG.md`。

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
