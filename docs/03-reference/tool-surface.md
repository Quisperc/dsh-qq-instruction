# QQ 会话的工具面（tool surface）

> 截至 2026-11-14，`dsh-qq-whale` v0.14.0 + `dsh-qq-bot` v0.14.0。
> 本文回答一个具体问题：**QQ 群/私聊里，那条鱼到底能用哪些工具？为什么它有时看得见却用不了？**

---

## 1. 一句话结论

**白名单 25 项 = 它能执行的；它「看见」的更多（默认 `mode: hide` 之外的情况）。**
看得见≠能用：模型仍会收到全部工具的 schema，但白名单外的调用会在执行期被拒。

---

## 2. 两层机制（必须分清）

| 机制 | 谁装 | 何时生效 | 效果 |
|---|---|---|---|
| `tools.guard(fn)` | `dsh-qq-whale` 的 `agent/created` 监听 | agent 一创建就装 | **执行期拦截**：白名单外的调用返回一句拒绝文案。**不隐藏 schema** |
| `tools.restrict({allow})` | 同上，但推迟到**首个 `agent/pre-step`** | 第一次真正开始回合时 | **收窄可见名单**：模型根本看不到白名单外的工具 |

为什么要拆成两层：

- `restrict` 能让模型「看不见」，省 token、少干扰，但它要求**所有白名单名字都已注册**；agent 刚创建时全局工具还没注册完，此时过滤白名单会**缩表**——2026-11-14 的真实事故：缩成 8 个（只剩 `memory_*`），`qq_*` 与 `read/write` 全被挡。
- 所以：**guard 兜安全**（立刻生效），**restrict 兜整洁**（等注册齐全、且先校验「白名单全部已知」才执行，缺一项就跳过）。

> 两者都在 `packages/dsh-qq-whale/lib/agent-guard.js`；配置见 `lib/config.js`。

---

## 3. 白名单 25 项（默认值）

| 分组 | 工具 | 说明 |
|---|---|---|
| QQ 自有 | `qqbot` `qqconfig` `qqgroup` `qqauth` | 插件内部还有二次鉴权：`qqbot.send`/`qqconfig` 需拥有者；`qqgroup` 在 `admin.enabled=false` 时全拒 |
| QQ 读 | `qq_history` `qq_imgsearch` | 群历史（默认回看 5 条 / 3 张图）、图片反搜 |
| QQ 联网 | `qq_websearch` `qq_webfetch` | 走插件自己的代理与多引擎配置 |
| QQ 出图 | `qq_draw` | `imageGen.enabled=false` 时会被拒（目前就是关的） |
| QQ 表情包 | `qq_sticker` | 从图库挑图发表情；目录 `QQ_msg/sticker`（子目录=系列），需先跑 `POST /dsh-qq-bot/sticker/rebuild` 建索引才挑得到 |
| **QQ 语音** | `qq_voice` | **仅拥有者**：解析消息头里的「身份:拥有者」，解析不到直接拒；目标须在 `group.allow` 内；每小时 6 条 + 10 秒冷却。**自己连一条只发不收的 WS**（不经过 qq-bot），默认关闭、需 TTS key。见 [ADR-013](../04-explanation/decisions/ADR-013-voice-tts-stt-route.md) |
| 工作区读写 | `read` `write` `edit` `read_image` | `read_image` 用于主动打开工作区图片；QQ 收图走原生附件，不靠它（见 §5） |
| 交互 | `ask_user_question` `todo_write` | 反问与记事；分寸写在人设卡「追问的分寸」 |
| 记忆 | `memory_search` `memory_read` `memory_remember` `memory_update` `memory_project` `memory_find_similar` `memory_dream` `memory_home` | `meow-memory` 按工作区存放，群聊私聊共用一份 |

**刻意不在白名单**：`bash` / `terminal_*` / `glob` / `grep` / `subagent*` / `workflow` / `ralph` / `schedule_*` / `session_*` / `gh_*` / `pr_*` / `issue_*` / `job_*` / `goal` / `plan` / `skill` / `present` / `plugin_manager`。

---

## 4. 怎么改白名单

三种方式，按推荐度排序：

| 方式 | 怎么做 | 生效时机 |
|---|---|---|
| **设置页**（推荐） | 插件 →「QQ 群聊受限预设（preset-qq）」→ `allowTools`，一行一个 | 改完下一条消息（字段是 `volatile`） |
| profile 配置 | `profiles/web/cordis.patch.yml` 的 `- id: dsh-qq-whale` 下写 `allowTools: [...]` | `set_bundle` 关→开 或重启 |
| 改代码默认值 | `packages/dsh-qq-whale/lib/config.js` 的 `DEFAULT_ALLOW` | 重载插件 |

⚠️ **`allowTools` 留空 = 不限制**（等价于关掉收窄），不是「什么都不许」。
⚠️ 加名字前先确认它确实注册了：在 Web 会话里让它调一次，或在会话日志的 `request/header` 里搜 `"name":"<工具名>"`。

另一个配置项是 `mode`，三选一：

| `mode` | 效果 |
|---|---|
| `off` | 完全不限制（不装 guard、不隐藏） |
| `guard` | 只在执行期拦截，模型仍看得见工具 schema |
| `hide`（默认） | guard + 首个 pre-step 把白名单外的工具从可见列表里摘掉 |

> 这两项都是 `volatile`，改完下一条消息生效。whale 的配置段**不在**你自己的 `cordis.patch.yml` 里（默认值来自包内 schema）；要覆盖才手写 `- id: dsh-qq-whale` 段。

---

## 5. 与识图的关系（常见误区）

**现状（qq-bot 0.14.0）**：识图有两条互斥路径，由 `vision.provider` / `vision.model` 是否留空决定。

| 配置 | 走哪条 | 结果 |
|---|---|---|
| **两项都留空**（本机现状） | **原生附件**：图片作为 `image` 块随 user 消息直接提交进会话 | 会话模型自己看图，零额外调用；**不需要 `read_image`** |
| 至少填一项 | 先让视觉模型识别，再把描述并进消息末尾的 `[图片描述]` 段 | 多一次视觉调用（旧行为） |

- ✅ **本机就是这么配的**，所以识图能用在「原生附件」这条路上。
- ❌ **旧结论作废**：文档曾写「必须靠 agent 调 `read_image` 看落盘图」——那是 0.12.8 时代的绕路（当时描述注入空返回）。0.14.0 起不再需要，相关规则也已从 `preset-qq` 里删掉。
- 落盘目录仍是 `QQ_msg/qq-images/<会话>/`（回合结算整体删除），主要供 `qq_imgsearch` 之类的工具按路径反搜。

`read_image` 现在**不是**识图主路径，但仍在白名单里：它用于 agent 主动打开工作区里的图片文件（例如用户让它看某张本地图），与 QQ 收图无关。删掉它不影响 QQ 识图。

---

## 6. 怎么确认当前实际状态

```bash
# 1) 白名单与开关（运行时）
#    设置页看「QQ 群聊受限预设（preset-qq）」，或 dump 组合配置里的默认值
dsh --profile web --dump-config | grep -A 30 '^- id: dsh-qq-whale'

# 2) 某次会话实际可见的工具（数 "name" 的个数）
#    会话日志：$DSH_HOME/sessions/--data-dsh-home-Documents-deepseek-harness-QQ_msg--/<会话>/session.v4.jsonl.zstd
#    解压后搜 request/header 里的 "tools":[...]
```

判断是否真的收窄了，别看数量（数量随插件增减变化），**看名单里有没有 `bash` / `terminal_open` / `subagent`**：有 = 没收窄，没有 = 已收窄。

---

## 7. 已知边界

- `guard` 的拒绝文案会作为工具结果回到模型；模型可能反复重试同一工具——人设卡里已写「工具被拒就直接放弃或说明原因」。
- `restrict` 生效前的**第一回合**里，模型仍看得见全部工具（只是调不动）。这是有意的稳妥取舍。
- 会话**不重启**时改 `enabled`/`allowTools` 只影响新 agent；已在内存里的 agent 保持旧限制，直到它被重建（换会话或重启容器）。
