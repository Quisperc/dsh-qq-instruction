# 运维手册（OPERATIONS）

> 适用环境：DSH `0.2.2-rc.3` · profile `web` · `@sputnikzaychik/dsh-qq-bot 0.14.0` + `dsh-qq-whale 0.14.0` + `dsh-qq-vault 0.5.0`
> 最后核对：2026-11-14 · 每条结论都可用文中命令复验
> 读者：下一个接手这台机器的 Agent / 运维同学。**先读完第 1 节再动手。**

---

## 1. 环境事实表

| 事实 | 值 | 怎么验 |
|---|---|---|
| DSH 版本 | `0.2.2-rc.3` | `dsh --version` |
| DSH_HOME | `/data/dsh` | 环境变量 / entrypoint |
| profile 目录 | `/data/dsh/profiles/web` | `ls /data/dsh/profiles` |
| 用户配置层 | `/data/dsh/profiles/web/cordis.patch.yml`（权限 600） | `ls -l` |
| profile 清单 | `/data/dsh/profiles/web/package.json` | `node -e "require('/data/dsh/profiles/web/package.json')"` |
| 部署形态 | 1Panel Docker 容器 | `cat /usr/local/bin/docker-entrypoint.sh` |
| 启动方式 | entrypoint 起 `node …/dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080`，然后 `wait` | 同上 |
| **dsh 退出即停容器** | 是（entrypoint 用 `wait -n` 等 dsh/caddy） | 同上 |
| 重启方式 | **只能走 1Panel 面板**，不要在会话里 kill 进程 | — |
| `/tmp` | **容器重启会清空** | 往 `/data/dsh/home` 写持久文件 |
| `python3` | **不存在（只有 node）** | `which python3` → 空 |
| Node | `v24.22.0` | `node -v` |
| QQ 上游 | NapCat 正向 WS `wss://qapi.civer.cn`，selfId `2174357664` | `qqbot` 工具 action=status |
| QQ 工作区 | `/data/dsh/home/Documents/deepseek-harness/QQ_msg` | `ls` |
| 会话日志 | `/data/dsh/sessions/--data-dsh-home-Documents-deepseek-harness-QQ_msg--/` | `ls -t` |
| 文档真源 | `github.com/Quisperc/dsh-qq-instruction`（公开，clone 无需令牌） | — |
| 本机工作副本 | `/data/dsh/home/QQBotV2/dsh-qq-instruction` | `git -C … log -1` |

> 端口/路径只写上面这些。没有写出来的，就是没确认过——**不要猜**。

---

## 2. 改配置的三条路

### 2.1 设置页（推荐给「调参」）

```
DSH Web UI → 设置 → 插件 → <插件> → 配置区
```

- 写回 `/data/dsh/profiles/web/cordis.patch.yml` 里**该插件自己那一段**，不动别人的。
- 标了 `.volatile()` 的字段**热生效**，不用重启；非 volatile 字段走 Loader 生命周期（可能需要重挂）。
- 权限仍是 600，别改成 644（里面有 token）。

### 2.2 直接改 profile 的 `cordis.patch.yml`（推荐给「加插件 / 改组合」）

```bash
cp -a /data/dsh/profiles/web/cordis.patch.yml \
      /data/dsh/profiles/web/cordis.patch.yml.bak-$(date +%m%d%H%M%S)
$EDITOR /data/dsh/profiles/web/cordis.patch.yml
```

- 它是**所有 bundle 之后**应用的用户覆盖层，按 `id` 定向覆盖。
- HMR 监听 profile patch 变化，会重新组合；**不确定是否生效就做一次 `set_bundle` 关→开**（见 2.4）。
- 校验：`cd /tmp && dsh --profile web --dump-config` 必须 `exit=0`、stderr 为空。

### 2.3 改插件包内的 `cordis.patch.yml`（推荐给「插件作者改自己」）

路径示例：`/data/dsh/home/QQBotV2/dsh-qq-instruction/packages/dsh-qq-whale/cordis.patch.yml`

- 这个文件随包升级会变；出厂默认值应放代码里，**不要**在这里写用户私有配置。
- 改完**必须** `set_bundle` 关→开（HMR 不一定重读包内补丁）；或者重启容器。
- 本机是软链安装，改工作副本里的文件 = 改「已安装」的包，**不需要重装**。

### 2.4 `set_bundle` 关→开（热重载标准动作）

用宿主工具（Web 会话里可调）：

```
plugin_manager(action="set_bundle", target="<bundle 名>", enabled=false)
plugin_manager(action="set_bundle", target="<bundle 名>", enabled=true)
```

- 返回 `application: "applied"` 才算成功；`failed` 会带 diagnostic，**先修再试**，不要连续重试。
- 效果：重读该 bundle 的补丁 + 重新组合；比重启容器安全（不会中断 Web 会话）。

---

## 3. 装一个插件的手工流程（本机**不走** pnpm）

> ⚠️ 为什么不用 `pnpm add` / `dsh plugin add`：profile 的 `node_modules/@deepseek-ai/*` 是**手工软链**到宿主安装目录，pnpm 会把它们当“多余包”清理掉，DSH 直接起不来。

| 步骤 | 命令 / 动作 | 为什么 |
|---|---|---|
| 1. 放包 | `ln -s /abs/path/to/pkg /data/dsh/profiles/web/node_modules/<pkg>` | 让 Loader 能解析到 |
| 2. 登记依赖 | 在 `profiles/web/package.json` 的 `dependencies` 加 `"<pkg>": "file:/abs/path"`（或版本号） | **插件页「已安装」只认 dependencies**（`listBundles` 用 `dependencies` 判定 installed；页面再按 `installed \|\| official \|\| error` 过滤，三者都不满足就整条不显示） |
| 3. 加入组合 | 在 `dsh.profile.bundles` 数组末尾追加 `"<pkg>"` | 不放进 bundles 就不会挂载 |
| 4. 生效 | `plugin_manager set_bundle` 关→开（首次装建议重启容器） | 重读补丁、重新组合 |
| 5. 校验 | `cd /tmp && dsh --profile web --dump-config` → `exit=0`；`plugin_manager(list_plugins)` 里该条目 `fiberPhase: active` | 只看 `status: schema` **不算**装好了（schema 可读 ≠ 激活成功） |

改 `package.json` 前先备份：

```bash
cp -a /data/dsh/profiles/web/package.json \
      /data/dsh/profiles/web/package.json.bak-$(date +%m%d%H%M%S)
```

卸载 = 反向执行 1–4：从 bundles 移除 → 从 dependencies 移除 → 删软链 → `set_bundle`/重启 → 校验。
**注意**：若该插件提供 preset 且 `agentPresetCustom` 正指向它，先改 preset 再卸，否则 QQ 每条消息都会回「内部错误」（见 5.2）。

---

## 4. 验证与回滚清单

### 4.1 配置改动

| 项 | 内容 |
|---|---|
| 验证 | `cd /tmp && dsh --profile web --dump-config > /dev/null; echo $?` → `0`；`qqbot(action=status)` → `connected: true` |
| 回滚 | `cp -a cordis.patch.yml.bak-<时间戳> cordis.patch.yml`，再 `set_bundle` 关→开 |

### 4.2 插件升级

| 项 | 内容 |
|---|---|
| 验证 | `plugin_manager(list_plugins)`：目标条目 `enabled: true`、`fiberPhase: "active"`；`node -e "console.log(require('/data/dsh/profiles/web/node_modules/<pkg>/package.json').version)"` 是新版本 |
| 回滚 | 软链装：`git -C <工作副本> checkout <旧提交>`（版本自动跟随）；包内补丁改动：`git checkout -- packages/<pkg>`；再 `set_bundle` 关→开 |

### 4.3 preset 改动

| 项 | 内容 |
|---|---|
| 验证 | `cd /tmp && dsh --profile web --dump-config \| grep -A20 "^- id: preset-<id>"` 看到预期行；新建一个会话后读 `session.v4.jsonl.zstd` 首行 `agentPreset` 是否为该 id |
| 回滚 | 删掉 `preset-*` 那几行（或注释），`set_bundle` 关→开 |

### 4.4 工具面收窄（`mode` / `allowTools`）改动

| 项 | 内容 |
|---|---|
| 验证 | 发一条 QQ 消息后读会话头（见下）：`bash` / `terminal_*` / `subagent` / `workflow` / `gh_*` / `pr_*` 应**不在**列表里，工具数降到与白名单同量级（约 20±5；收窄前实测为 82，数字随 DSH/插件版本变化，以名单为准） |
| 回滚 | 设置页把 `mode` 改成 `off`（即时生效），或改 `allowTools` → 无需重启；要彻底停用按 `packages/dsh-qq-whale/README.md` §五 的顺序 |

读会话工具面的命令：

```bash
cd /data/dsh/sessions/--data-dsh-home-Documents-deepseek-harness-QQ_msg-- && ls -t | head -3
node -e '
const fs=require("fs"),z=require("node:zlib");const d=process.argv[1];
const s=z.zstdDecompressSync(fs.readFileSync(d+"/session.v4.jsonl.zstd")).toString();
const n=new Set();
for(const l of s.split("\n")){if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
 if(e.type==="request/header"||e.type==="request/context")
  for(const m of (JSON.stringify(e).match(/"name":"([a-z0-9_]+)"/g)||[]))n.add(m.slice(8,-1));}
console.log("tools:",n.size);console.log([...n].sort().join(" "));' <会话目录名>
```

---

## 5. 故障速查表

### 5.1 QQ 不回话

| 先查什么 | 命令 / 位置 | 处理 |
|---|---|---|
| 连接 | `qqbot(action=status)` → `connected` | `false` 见 5.6 |
| 有没有收到消息 | 同上 `stats.inbound` 是否增长 | 不增长 = 上游没上报，查 NapCat 事件上报开关 |
| 准入是否拦掉 | `policy.groups.allow` 是否含该群、`requireAt` 是否为 true | 群里必须 @；私聊看 `private.allow` |
| 会话是否建起来了 | `conversations` 数组 | 空 = 没建会话，看 5.2 |
| 适配器 | `adapter.pid`、`restarts` | 反复重启看启动日志 |

### 5.2 回「内部错误（无法创建对话会话）」

**最常见原因：`agentPresetCustom` 指向了一个不存在的 preset。**

```bash
grep -n "agentPresetCustom" /data/dsh/profiles/web/cordis.patch.yml
cd /tmp && dsh --profile web --dump-config | grep -n "^- id: preset-"   # 看该 id 是否存在
```

| 处理 | 动作 |
|---|---|
| preset 被卸了/改名了 | 把 `agentPresetCustom` 清空（回落默认 `standard`），或改回存在的 id → `set_bundle` 关→开 |
| 想彻底摘掉 preset | **先**清空 `agentPresetCustom`，**再**卸提供它的插件（顺序反了会静默打断全部新会话） |

### 5.3 插件列表看不到

| 检查 | 依据 |
|---|---|
| `profiles/web/package.json` 的 `dependencies` 里有没有它 | 页面过滤条件是 `!BUILTIN && (installed \|\| official \|\| error)`；只有 bundles 没有 dependencies 会被过滤掉 |
| 显示名是不是包名 | 列表显示 `meta.title`（如「QQ 群聊受限预设（preset-qq）」），**按包名搜不到** |
| 页面缓存 | 重启后旧快照还在：点「刷新」或硬刷新标签页 |

### 5.4 工具面没被收窄

| 检查 | 说明 |
|---|---|
| 收窄是否生效 | 看会话 jsonl 的 request/header 工具数（应≈白名单条数），或设置页看 `enabled` / `allowTools` |
| 是否旧会话 | preset 在**建会话时**写进 `session.v4.jsonl.zstd` 首行，跑过回合的旧会话沿用旧配置；**新建会话**才是新工具面 |
| 收窄是否被静默跳过 | 该实现异常只 warn 不阻断（宁可不限制也不能让机器人回不了话）：查启动日志里 `[dsh-qq-whale]` 开头的行 |
| 名字被过滤 | `restrict` 遇到未知工具名会抛错，实现会先按 `tools.definitions()` 过滤；名单配错会表现为“什么都没收窄” |

### 5.5 页面白屏

| 检查 | 说明 |
|---|---|
| 最近装/改的插件是否声明了 `dsh.client` + `exports["./client"]` | 声明了就必须**真有那个文件**；缺文件 → `ClientPackageCompositionError` → 客户端 compose 失败 → 白屏 |
| 回滚 | 把该 bundle `set_bundle` 关掉，或把 `exports["./client"]` 指回一个确定存在的文件 |

### 5.6 `connected: false`

| 检查 | 处理 |
|---|---|
| `onebot.wsUrl` 是否正确、`accessToken` 是否过期 | 改 profile patch → `set_bundle` 关→开 |
| NapCat 侧是否在线、是否限制来源 IP | 去 NapCat 面板看 |
| `adapter.pid` 是否在、`restarts` 是否暴涨 | 暴涨通常是 token/URL 错，不要反复重启容器 |

### 5.7 `agent-preset/not-found`

含义：`agentPresetCustom`（或 `agentPreset`）指向的 preset id 不在 registry 里。
处理同 5.2：清空或改成存在的 id；随后 `set_bundle` 关→开，并**用新会话**验证。

---

## 6. 数据与备份

### 6.1 运行数据

| 数据 | 路径 | 说明 |
|---|---|---|
| QQ 会话日志 | `/data/dsh/sessions/--data-dsh-home-Documents-deepseek-harness-QQ_msg--/<会话>/session.v4.jsonl.zstd` | zstd 压缩 JSONL；首行含 `agentPreset`；`request/header` 含当轮工具面 |
| QQ 工作区 | `/data/dsh/home/Documents/deepseek-harness/QQ_msg` | 含 `qq-images/`；自带独立 `.dsh-meow` 记忆库，与 Web 侧不通 |
| Web 会话 | `/data/dsh/sessions/--data-dsh-home-QQBotV2--/` 等 | 按工作区命名 |
| 宿主状态 | `/data/dsh/storages/` | 含 `workspace.json`、各插件 storage |

### 6.2 备份文件（认名字）

| 文件 | 用途 |
|---|---|
| `profiles/web/cordis.patch.yml.bak-*` | 每次改配置前的用户层快照（`bak-pre-preset-*`、`bak-pre-whale070-*` 等） |
| `profiles/web/package.json.bak-*` | 每次改依赖清单前的快照（`bak-cleanup-20261114-045938`、`bak-pre-whale-*`） |
| `/data/dsh/home/QQBot/archive/qqbot-legacy-instance-data-20261114-045941.tar.gz` | 旧微内核实例数据（`mk`/`mk-hub`/`qq-run`，2.7M，108 个文件）；回滚：`tar xzf … -C /data/dsh/home/QQBot` |
| `/data/dsh/home/QQBot/archive/qqbot-legacy-hub-20261101-010205.tar.gz` | 更早一次架构迁移前的完整快照（2.7M） |

> 备份文件里含 token 与 QQ 号，**不要**上传、不要进公开仓库。文档仓库已用 `.gitignore` 排除 `profiles/*/cordis.patch.yml`。

### 6.3 改动前的最小自检

```bash
cd /data/dsh/home/QQBotV2/dsh-qq-instruction && git status --short   # 工作副本有没有别人的改动
cd /tmp && dsh --profile web --dump-config > /dev/null; echo $?      # 改之前先确认基线是 0
```

两项都为「干净 / 0」再动手；否则先处理基线，别在脏状态下叠加改动。

## 7. 已知平台限制（2026-11-14 真机确认）

| 限制 | 证据 | 正确做法 |
|---|---|---|
| DSH webserver **只放行 GET/HEAD**，其它方法在路由匹配前直接返回 405 | `dsh-host-webserver/lib/index.js:428,600` | 插件路由一律设计成 GET + query；需要 POST body 的需求（上传）要么换途径，要么放弃 |
| `apply` 里用到的服务必须在 `inject` 声明，否则 apply 早于服务就绪，`ctx.get()` 拿到 undefined | vault v0.1.0 的 404/405 事故：`inject = []` → 一条路由都没注册 | 声明 `inject: ['webServer']` 等；拿不到时日志必须写明「路由未注册」而不是「已挂载」 |
| 插件配置表单**不会**因为导出 `Config` 就自动出现 | whale 的配置运行时 `status: schema`，但设置页曾一度看不到 | 必须写 client 半，注入 slot `plugins.bundle.config`（`key` = 包名），内部用 `ctx.configForms.get(entryId)` 读写 |
| 单测全绿 ≠ 真机可用 | 上述两个 bug 单测都过了 | 改完跑 `node scripts/verify-live.mjs`（15 项真机断言，只读、不发消息） |

## 8. 紧急静音 / 成本 / 指令速查

> 本节由 `docs/02-how-to/operate.md` 的独有内容并入（2026-11-14），并按当前实现校正。

### 8.1 紧急静音（按生效速度排序）

| 顺序 | 手段 | 说明 |
|---|---|---|
| 1 | 把群从 `group.allow` 移除 | 最干净：它不再处理该群任何消息 |
| 2 | 关掉主动发言 | 2026-11-14 起**已真开**（`enabled=true` + `dryRun=false`）。要停就把 `enabled` 改 false；只想观察就改回 `dryRun: true`（注意：那样每轮仍会调模型，白烧 token） |
| 3 | 停止驱动 | 停容器（面板）或断开 NapCat；**注意同一 QQ 号不能同时挂两个 WS 客户端** |
| 4 | `/静音` 类群管理指令 | **当前不可用**：`admin.enabled=false`，插件对该分组的查询与动作一律拒绝（`lib/tools/index.js:441`）。要用先开 admin |

事后复盘看 `qqbot status` 的 `stats`：`errors` / `guestBlocked` / `flowBlocked` 异常升高说明闸门在拦东西。

### 8.2 成本控制（当前配置下的真实杠杆）

| 杠杆 | 现状与做法 |
|---|---|
| 模型 | 走 `leaflow/deepseek-v4.1-flash-1017`；要换在 `llm-pi-ai` 的 providers 里加模型再切 |
| 识图 | qq-bot **0.14.0 原生附件**：`vision.provider`/`vision.model` 都留空 → 图片作为附件随消息进会话，会话模型直接看，**不再多调一次视觉模型**，也不需要 `read_image` 绕路 |
| 主动发言 | 2026-11-14 起真开（`dryRun=false`），闸门：60 分钟判断一次、每小时≤2、每日≤8、23:00-08:00 静默、间隔≥15 分钟、≥6 条新消息才判断、`eventGuard` 开、120 字上限 |
| 频率闸 | `maxPerHour: 2` / `maxPerDay: 8` / `minGapMinutes: 15`（`proactive` 分组） |
| 预算闸 | 给 API Key 设月度上限（服务商控制台），这是唯一硬上限 |
| TTS | **已实现**（插件 `dsh-qq-voice`，非 qq-bot 自带）：按字数计费，插件自身限每小时 6 条 |
| STT | 未实现（qq-bot 入站丢 record，见 ADR-013），不产生成本 |

### 8.3 常用指令（群里直接发）

| 指令 | 作用 | 前提 |
|---|---|---|
| `/help` | 指令表 | `commandPrefix`（默认 `/`） |
| `/whoami` | 身份与权限来源 | 无 |
| `/perms [@某人]` | 权限来源 | 无 |
| `/grant @某人 权限 [分钟\|forever]` | 临时/永久授权 | 拥有者 |
| `/mute` `/unmute` `/kick` `/recall` `/banall` | 群管理 | **`admin.enabled=true` 且 `dryRun=false`**；当前两者都不满足，故全部拒绝 |

## 9. 能力线现状与下一步（2026-11-14 盘点）

| 能力 | 状态 | 落地还要什么 |
|---|---|---|
| 收发/分段/引用、人格、准入、记忆 | ✅ 可用 | — |
| 联网（`qq_websearch` / `qq_webfetch` / `web_search` / `web_fetch`） | ✅ 可用 | — |
| 群历史、图片反搜 | ✅ 可用 | — |
| **识图** | ✅ 可用（qq-bot 0.14.0 原生附件；两项留空即走这条路） | 若把 `vision.provider/model` 任填一项，会退回「先描述再并入」，反而多一次调用 |
| **生图** | ✅ 已打通（2026-11-14 深夜） | 火山方舟 Seedream 4.0。参数：`baseUrl=https://ark.cn-beijing.volces.com/api/v3`、`model=doubao-seedream-4-0-20260415`、`size=1024x1024`、`enabled=true`，key 存在 `imageGen.apiKey`（600 权限 profile，已 gitignore） |
| **TTS（语音回复）** | ✅ 发送链路已实测（2026-11-15） | 独立插件 `dsh-qq-voice`：自己连一条**只发不收**的 WS，发 `record` 段。实测 `WAV` 直发可用（**不需要 silk/ffmpeg**）。默认关闭，需 TTS key。型号/端点见 §11.5 |
| **STT（听语音）** | ⛔ 卡在 qq-bot | 官方 `speech-to-text` + SenseVoice 服务已在本机可用，但 qq-bot 把入站 `record` 丢成 `[语音]`、拿不到音频 URL。要么上游改约 10 行，要么 NapCat 侧做 |

> **语音插件三条要点**：① 它**不经过 qq-bot**（qq-bot 出站不支持 record，也不提供服务）；② 第二条 WS **只发不收**，绝不响应事件，所以不会双回复；③ 权限（owner 判定 + 群白名单 + 每小时 6 条节流）都在插件自身，解析不到发言人身份就**保守拒绝**。

**生图要点（换厂商/换模型时看这里）**

| 项 | 事实 |
|---|---|
| 端点形状 | 插件写死 `POST <baseUrl>/images/generations`（`lib/tools/imagegen.js:17`） |
| **DashScope 不可用** | 它的 compatible-mode **没有这个路径，实测 404**——不是缺 key，是端点根本没有 |
| 模型 ID 必须准确 | 本账号可用的是 `doubao-seedream-4-0-20260415`；`doubao-seedream-4-0-250828` 在这里是 404 |
| 查可用模型 | `GET https://ark.cn-beijing.volces.com/api/v3/models`（带 Bearer），筛 `api_supported['images/generations']` |
| 返回格式 | 同步 200，`data[0].url` + `size`；图是 JPEG，但发送走 `base64://`，**扩展名不影响** |
| 权限 | `qq_draw` **硬编码仅拥有者可用**（`lib/tools/index.js:1019`），群友让它画会被拒 |
| 耗时 | 单张 7–12 秒；`timeoutMs` 180 秒足够，失败会自动重试 |
| **TTS** | ❌ 未实现 | 需新写工具（100–200 行）+ 出站 record 段 + 音频需公网可访问 URL（NapCat 在远端读不到本地文件） |
| **STT** | ❌ 未实现 | 需 `get_record` 取音频 → VAD → ASR → 注入；工作量大于 TTS |
| 表情包 | ✅ 2026-11-14 开启 `sticker.enabled` + `sticker.collect`（存与偷）；`qq_sticker` / `qq_voice` 已进 whale 白名单（25 项） |
| 上下文深度 | ✅ `history.scopeMessages` 5 → 15 |
| 主动发言 | ✅ 已真开 |
| 气泡拆分 | ✅ 默认开（≤80 字/段、最多 3 段）；2026-11-14 调成 0.6–2.2 秒间隔（原默认 0–5 秒，第二句可能隔 5 秒才来） | 想静音：`enabled: false`；想只观察：把 `dryRun` 改回 true（会持续烧 token） |
| 群管理 | ❌ 整体关 | `admin.enabled=false` |

**建议顺序**：生图已打通 → 下一步 TTS（先趟音频托管）→ 最后 STT。

## 10. 依赖与可卸载性

### 10.1 依赖方向

```
dsh-qq-bot ──(字符串耦合)──> preset id "qq"      # agentPresetCustom 非空即覆盖 agentPreset
dsh-qq-whale ──insert──> [dsh-qq-whale, preset-qq]
preset-qq ──> 官方包：persona / agent-instructions / time-context / tool-fs /
              compaction-basic / command-compact / tool-result-pruner /
              tool-ask-user / tool-todo / plugin-manager(tools) / plugin-market(tools)
dsh-qq-vault ──> 独立（读写 profile 配置、记忆库；不依赖 whale）
```

### 10.2 卸载矩阵

| 组件 | 挂载 | 卸载影响 | 残留 | 风险 |
|---|---|---|---|---|
| `dsh-qq-bot` | ✅ active | QQ 全停：`qq_*` 工具、设置页、`QQ_msg` 写入都没了 | deps、node_modules、patch 整段（含 token/人设）、`QQ_msg` 会话 | 中 |
| `dsh-qq-whale` | ✅ active | **preset-qq 一起消失** → `agentPresetCustom='qq'` 解析失败 → 每条消息回「内部错误」，宿主不报错；工具收窄也一并失效 | deps、软链、若干 `.bak` | **高（静默）**，顺序见 [whale README §五](../../packages/dsh-qq-whale/README.md) |
| `preset-qq` | ✅ active | 无法单独卸，随 whale | — | 同 whale |
| `dsh-qq-vault` | ✅ active | 只是少一个设置页入口，主链路不受影响 | deps、软链、上传临时包 | 低 |

**正确卸载顺序（whale）**：先把 `agentPresetCustom` 改空（回落 standard）→ 确认 QQ 能回话 → 再卸 whale。

### 10.3 升级耦合

校验器只读 root `engines.dsh`，`dsh.compatibility` **不被读取**（`dsh-app-boot lib/index.js:1101-1155`）。
`dsh-qq-bot` 的 `engines.dsh` 无上界 → 升到 0.3 不会被拦，但很可能坏（深用 `sessionController` / `tools.guard` / `settings.configure` / `webServer.register`）。
升级前：备份 `cordis.patch.yml`。

**当前没有任何 node_modules 补丁。** 2026-11-14 曾给 `turn-runtime.js` 打过「模型不说话时不发占位提示」的补丁，
用户明确否决了打补丁这种方式（「我不希望通过补丁去调整」），已完整还原（与上游 `diff` 一致），补丁脚本一并从仓库删除。

> 空回复提示的现状：那句「（本轮没有产生文字回复：…）」是 `gateway/turn-runtime.js:505` 的**硬编码字面量**，
> 插件没有任何配置项能关掉它（`settings-core-set.json` 里无相关键，npm 上最新版即 0.14.0）。
> 实测 14 个回合的 `turn/end` 全是正常结束（只有 `kind`、无 `error`），所以它只在「模型真的一个字都不说」时才会出现。
> 要彻底去掉只能走上游（提 issue / PR 加一个开关），不要在本机改 node_modules。

---

## 11. 发布与上架（2026-11-14 起）

### 11.1 现在的地址

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/Quisperc/dsh-qq-instruction`（**公开**，clone 不需要令牌） |
| 插件市场索引 | `https://quisperc.github.io/dsh-qq-instruction/market/index.json` |
| 索引托管 | GitHub Pages（`main` 分支 `/` 根目录，Pages 直接服务整个仓库） |
| 已收录版本 | `dsh-qq-whale 0.14.0` · `dsh-qq-vault 0.5.0` |
| 安装 spec 形状 | `git+https://github.com/Quisperc/dsh-qq-instruction.git#<commit>&path:/packages/<包名>` |

> 历史说明：仓库原先托管在私有 CNB（`cnb.cool/civer/…`，需令牌克隆）。**现在已不再需要连 CNB**，
> 文档与脚本里的地址都已换成 GitHub；若在旧记录里看到 CNB，那是迁移前的历史。

**双推送**：GitHub 是主源（市场与 Pages 都读它），CNB 是镜像。一条命令推两边：

```bash
GITHUB_TOKEN=... CNB_TOKEN=... npm run push:all          # 正常推送
GITHUB_TOKEN=... CNB_TOKEN=... npm run push:all -- --force   # 重写历史后
```

凭据只从环境变量读，**不写进 `.git/config`**——踩过的坑：`git push -u <带令牌的 URL>` 会把令牌明文写进
`branch.<name>.remote`，事后要手动改回。

### 11.1.1 许可布局（双许可，按内容划界）

| 内容 | 许可 | 文件 |
|---|---|---|
| 代码、脚本、配置、文档、索引 | **MIT**（纯原文，GitHub 能识别） | `LICENSE` |
| 人格形象与人格卡（`persona/`、配置里的 `persona.text`） | **CC BY-NC-SA 4.0** | `LICENSE-PERSONA` |

> `LICENSE` 必须是**纯 MIT 原文**：一旦在末尾追加任何说明文字，GitHub 的 license 识别会退化成
> `NOASSERTION`（本项目已踩过）。范围说明一律写进 `LICENSE-PERSONA` 与 README。

### 11.2 发一个新版本（三步，顺序不能换）

```bash
# 1) 改代码 + 升版本号 + 写 CHANGELOG，然后提交并推送
#    （索引里钉的是这一步的 commit，所以包必须先落地）
git add -A && git commit -m "feat(whale): ..." && git push origin main

# 2) 生成索引（校验不过会直接报错，不会写出坏索引）
node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction --write

# 3) 提交索引并推送，Pages 约 1 分钟后生效
git add market/index.json && git commit -m "chore(market): 索引 <版本>" && git push origin main
```

**为什么不能倒过来**：索引里每个版本都钉死一个 commit。先生成索引再提交包，索引指向的那个 commit 里还没有新代码，用户装下来是旧版。

**历史版本会保留**：生成器会读旧索引并把往期版本原样留着（同名版本以本次为准），所以发 0.15.0 之后 0.14.0 仍可安装——用户回滚时直接选旧版本。

### 11.3 仓库地址要是变了

```bash
node scripts/set-repo.mjs --repo https://github.com/<owner>/<repo> --write   # 改 6 个文件里的地址
node scripts/make-market-index.mjs --repo https://github.com/<owner>/<repo> --write
```

`set-repo` 只认占位符 `https://github.com/OWNER/REPO`；如果地址是从**别的真实地址**（例如旧 CNB 地址）迁过来的，它匹配不到，需要手改或先替换成占位符再跑。

### 11.4 上架官方目录

自托管索引只解决「自己/别人加索引就能装」，官方目录（DSH 自带市场源）需要另外提交。材料清单见
[`market/README.md`](../../market/README.md) §5；其中「公开仓库」一项已满足。

### 11.5 TTS 型号与端点（2026-11-15 真机实测）

同一个 key、同一个账号，三种「qwen tts」行为完全不同——**400 `url error` 通常是端点与型号不匹配，不是 key 错**（key 错会先 401）：

| 型号 | 端点 | 结果 |
|---|---|---|
| `qwen3-tts-flash` | DashScope 原生 `api/v1/services/aigc/multimodal-generation/generation` | ✅ 200，返回 `output.audio.url`（WAV，需再下载） |
| `qwen-audio-3.1-tts-flash` / `-tts-plus` | 同上 | ❌ 400 `url error`——它们是**实时（WS）型号** |
| `qwen-audio-3.1-tts-*` | qianwenai `api/v1/services/audio/tts/SpeechSynthesizer` | ❌ 仍 `url error` |
| `qwen-audio-3.0-tts-flash` | qianwenai `api/v1/services/audio/tts/SpeechSynthesizer` | ✅ 可用，且**支持复刻音色** |

**复刻音色**（系统音色只有 `qwen3-tts-flash` 那类支持，且它不支持复刻）：

```text
① POST /api/v1/services/audio/tts/customization
   {"model":"voice-enrollment","input":{"action":"create_voice","target_model":"qwen-audio-3.0-tts-flash",
    "prefix":"<≤10位字母数字>","audio":"data:audio/wav;base64,…","language_hints":["zh"]}}
   → voice_id：qwen-audio-3.0-tts-flash-<prefix>-<hash>

② POST /api/v1/services/audio/tts/SpeechSynthesizer
   {"model":"qwen-audio-3.0-tts-flash",
    "input":{"text":"…","voice":"<voice_id>","format":"wav","sample_rate":24000,"seed":2024}}
```

> **`seed` 在 `input` 里**，不在 `parameters` 里。已创建音色 `longlinx`：
> `qwen-audio-3.0-tts-flash-longlinx-efc30de04468458684cda530c7863e63`（用 `samples/龙灵安希-样本.wav` 复刻）。
> 插件侧用 `requestTemplate` 覆盖请求体即可，不用改代码。

**计费状态（用户侧，非代码）**：2026-11-15 实测 `maas.qianwenaiapi.com` 对所有模型（含普通 chat）返回
`403 AccessDenied.Unpurchased`；DashScope `qwen3-tts-flash` 曾由 200 转 `400 Arrearage`。用 TTS 前先确认账户可用。
