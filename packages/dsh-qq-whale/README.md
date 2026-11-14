

# dsh-qq-whale

给 QQ 会话装一张**受限 Agent preset**（`id: qq`），并守住它的工具面。

两件事，没有第三件。人格、收发消息、记忆都不归它管——那些在 `dsh-qq-bot` 和 `meow-memory` 里。

---

## 一、它做什么

| 做 | 说明 |
|---|---|
| 插一条 `preset-qq` | 通过 `dsh.bundle.patch` 进 profile 组合树；行清单见 `cordis.patch.yml`（人格锚点、指令、时间、工作区读写、压缩、反问、待办） |
| 收窄工具面 | 监听 `agent/created`，对 `qqbot-*` 会话装拦截；名单外的工具调不动，`mode=hide` 时连看都看不见 |

**不做**：不管人格（人设卡在 `dsh-qq-bot.persona.text`）、不提供跨插件服务、不写别人的配置。

为什么需要「收窄」这一半：preset 只决定挂哪些插件行，**不收窄全局工具**。只装 preset 的话，QQ 会话里能看见 80+ 个工具（bash、terminal、子代理、workflow 全在）。收窄是另一件必须显式做的事。

### 1.1 一次真实用法

装完之后的日常是这样的（不需要任何命令）：

1. 群里有人 @ 它说话 → 它照常用人格回复；
2. 你想让它做点「重活」（跑 shell、开子代理、改别的插件配置）→ **做不到，debug 日志里会是「工具不在白名单」**；
3. 你嫌某类工具被挡了 → 打开 **设置 → 插件 → 已安装 → QQ 群聊受限预设（preset-qq）**，在白名单里加一行，**下一条消息就生效**（不用重启）。

### 1.2 设置页长什么样

```text
┌─ QQ 群聊受限预设（preset-qq） ─────────────────────────┐
│ 收窄强度   [ hide ▾ ]     off / guard / hide            │
│ 工具白名单                                              │
│ ┌───────────────────────────────────────────────────┐ │
│ │ qqbot                                             │ │
│ │ qq_history                                        │ │
│ │ read                                              │ │
│ │ …（默认 24 项，一行一个；留空 = 不限制）           │ │
│ └───────────────────────────────────────────────────┘ │
│                              [ 保存 ]  [ 撤销 ]        │
└────────────────────────────────────────────────────────┘
```

三种强度的区别：`off` 完全不收窄；`guard` 只拦执行（模型仍看得见）；`hide` 连看都看不见（默认，省 token）。

## 二、安装（三条路径，选一条）

> 三条路径装完的第 3 步都一样：**让 QQ 会话用上这张 preset**（只影响新会话）——
> `dsh-qq-bot` 设置页 → 高级 → 会话与排错 → 「① 自定义 agent preset id」填 `qq`。
> 不做的话，工具面收窄仍然生效（它挂在 agent 创建事件上，与 preset 无关），但会话不会用这张能力清单。

### 路径 A：插件市场（推荐，能收到更新）

1. 设置 → 插件 → **发现** → 右上角索引菜单 → 「管理索引来源」→ 添加索引 URL：
   `https://quisperc.github.io/dsh-qq-instruction/market/index.json`
   （这个 JSON 由本仓库自己托管，怎么生成/托管见 [`market/README.md`](../../market/README.md)）
2. 搜索 `dsh-qq-whale` → 安装 → 回到插件页**启用**。
3. 设置页配 `mode` / `allowTools`；再去 `dsh-qq-bot` 填 `qq`（见上面「第 3 步」）。

市场安装拿的是**固定在某个 commit 的 git 子包**，所以更新 = 索引里出现新版本后点「更新」。

### 路径 B：GitHub 直装（不经过市场）

```bash
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-whale'
```

- `#<commit>` 必须是**完整 40 位小写 hex**（短 hash 不认）；
- `&path:/packages/dsh-qq-whale` 是单仓库多子包的写法，不能省；
- 装完同样要「启用」，并去 `dsh-qq-bot` 填 `qq`。

### 路径 C：本地开发（软链，改代码即生效）

```bash
# 从真源仓库软链进 profile（不要用 pnpm 装本包：会连带清掉 @deepseek-ai/* 手工软链）
node scripts/install-whale.mjs --write
```

改完 `lib/*.js` 后 `set_bundle` 关→开就重载，不需要重新打包；代价是这份代码只在本机生效。

> ⚠️ **卸载/停用前必须先清 `agentPresetCustom`**，顺序见本文 §五。反了的话，QQ 每条消息都会回「（内部错误：无法创建对话会话）」。

## 三、配置（设置页两项）

| 字段 | 默认 | 含义 |
|---|---|---|
| `mode` | `hide` | `off` 不限制 / `guard` 调用时拦（模型仍可见）/ `hide` 收窄 + 隐藏 |
| `allowTools` | 23 项 | 允许的工具；**留空 = 不限制** |

两项都是热配置：改完下一条 QQ 消息即生效，**不用重启**。

默认白名单 23 项：

```
qqbot qqconfig qqgroup qqauth
qq_history qq_imgsearch qq_websearch qq_webfetch qq_draw
read write edit read_image
ask_user_question todo_write
memory_search memory_read memory_remember memory_update
memory_project memory_find_similar memory_dream memory_home
```

几个刻意的取舍：

- **不含 `web_search` / `web_fetch`**：`qq_websearch` / `qq_webfetch` 是同一件事的完成版（带多引擎与代理），两个等价工具同时在场只会让模型犹豫。
- **必须留 `read_image`**：识图唯一可用通路就是让它打开落盘原图（qq-bot 自带的「描述注入」实测返回空）。
- **不含 shell / 子代理 / 后台任务 / 联网通用工具**：群友能触发 Agent，这些放大不可控。

## 四、preset id 能改吗？

能，但要**同时改三处**，漏一处就是每条 QQ 消息回「（内部错误：无法创建对话会话）」：

1. 本包 `cordis.patch.yml` 里 `- id: preset-qq` 的条目 id（比如改成 `preset-qq2`）
2. 同一段里 `config.id` 的值（`qq` → 你想用的名字）
3. `dsh-qq-bot` 的 `agentPresetCustom`（`qq` → 同一个新名字）

三处必须**完全一致**。因此它没有做成设置页字段——一个改了必然坏的旋钮，不如没有。

> 不想改就别动。`qq` 这个名字没有特殊含义，只是个 id。

## 五、卸载 / 停用（顺序很重要）

**直接停用会让 QQ 每条消息都失败**：preset-qq 随插件消失，而 `agentPresetCustom` 还指着 `qq`，解析不到就是「内部错误」，宿主本身不报错。

正确顺序：

1. `dsh-qq-bot` 设置页把「自定义 agent preset id」**清空**（回落到 `standard`）
2. 发一条 QQ 消息，确认能正常回话
3. 再停用/卸载本插件；从 `dsh.profile.bundles` 与 `dependencies` 里删掉条目

卸载后工具面收窄也一起消失（回到全量工具），这是预期行为。

## 六、已知限制

| 限制 | 说明 |
|---|---|
| 老会话的 preset 换不了 | 跑过回合的会话 preset 被锁死，改 `agentPresetCustom` 只影响新会话；要换只能让它成为新会话 |
| `hide` 不会自动恢复 | 已经隐藏过的工具，切回 `guard`/`off` 后不会重新出现，需要重开会话 |
| 收窄失败只 warn | 拿不到 `tools` 服务时按「不限制」继续（宁可少限制，也不能让机器人不吭声）；查启动日志里 `[dsh-qq-whale]` 开头的行 |
| 没有 i18n | 设置页文案写死中文 |

## 七、开发

```bash
npm test          # node --test test/*.test.mjs
```

**依赖从哪来（本包不自带 lockfile）**：`@deepseek-ai/schemastery` 由宿主 DSH profile 提供，
本仓库**故意不提交 `package-lock.json`** —— 开发机的 `node_modules` 是指向 profile 的软链，
据此生成的 lock 只反映本机路径，换台机器 `npm ci` 必然失败。需要跑测试时，
在本目录建 `node_modules` 软链指向宿主依赖即可（`js-yaml` / `cordis` 只在测试里用）。


测试覆盖三层：纯函数（config）、事件契约（agent-guard）、激活与客户端契约（activate / client-contract）、包元信息与 patch 结构（package-meta / preset）。
