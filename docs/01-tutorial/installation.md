# 安装与配置（照抄命令即可）

<!-- data-doc-status -->
> ⚠️ **部分过期**：本文不含 `dsh-qq-whale`（preset/工具收窄/设置页）与 `dsh-qq-vault`（导出导入），也不含会话 preset 的坑。
> 新装请优先看 [`migrate.md`](./migrate.md) 与 [`../05-handover/OPERATIONS.md`](../05-handover/OPERATIONS.md)。

> 全程 4 步，约 10 分钟。每一段都是可以直接复制粘贴的命令块。
>
> 想理解原理：`../04-explanation/design-rationale.md`（架构）、`../03-reference/capability-report.md`（实测结论）。

---

## 第 0 步：确认你的 DSH 目录

在 DSH 所在的云服务器上执行，把输出的路径记下来，后面都用它。

```bash
for d in ~/Documents/deepseek-harness ~/.deepseek-harness ~/.local/share/deepseek-harness; do
  [ -d "$d" ] && echo "找到：$d"
done
```

如果都没输出，就查一下 DSH 进程的工作目录：

```bash
ps aux | grep -i dsh | grep -v grep | head -3
```

记下这个路径后，设成变量方便后面复制：

```bash
export DSH_HOME=<上面找到的路径>
export DSH_PROFILE=$DSH_HOME/profiles/web     # 网页版一般是 web
mkdir -p $DSH_PROFILE
```

---

## 第 1 步：装插件

```bash
dsh plugin --profile web add @sputnikzaychik/dsh-qq-bot
```

**装完必须重启**才生效：

```bash
dsh web
```

> 验证：Web UI → 插件 → 已安装，能看到 `dsh-qq-bot`。

### 如果 `dsh plugin` 命令不存在（老版本 DSH）

```bash
cd $DSH_PROFILE
npm i @sputnikzaychik/dsh-qq-bot      # 或 pnpm add
# 然后把这一行追加进配置补丁文件
cat >> $DSH_HOME/profiles/web/cordis.patch.yml <<'EOF'
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
EOF
```

> ⚠️ 包名必须是完整的 `@sputnikzaychik/dsh-qq-bot`；`id` 保持 `dsh-qq-bot`，以后升级才不会丢配置。

---

## 第 2 步：放配置

配置文件已经按你的环境填好并**实测验证过**了（`wss://qapi.civer.cn` 握手+鉴权通过，群 778916943 在列表内）。

```bash
# 复制过去
cp ../../config/cordis.patch.yml $DSH_HOME/profiles/web/cordis.patch.yml

# 里面含 token，收紧权限
chmod 600 $DSH_HOME/profiles/web/cordis.patch.yml
```

如果你的 `$DSH_HOME/profiles/web/cordis.patch.yml` **已经存在**（里面可能已有别的插件配置），不要覆盖——把 `../../config/cordis.patch.yml` 的内容**追加**到文件末尾：

```bash
cat ../../config/cordis.patch.yml >> $DSH_HOME/profiles/web/cordis.patch.yml
```

**确认关键几项**（打开看一眼，应该已经是这些值）：

```bash
grep -E "wsUrl|accessToken|owners|allow" $DSH_HOME/profiles/web/cordis.patch.yml
```

期望看到：

```
wsUrl: 'wss://qapi.civer.cn'
accessToken: 'YOUR_NAPCAT_TOKEN'
owners: ['507678128']
allow: ['778916943']
```

---

## 第 3 步：灌人格

把 `../../persona/whale.md` 的**全文**填进人格字段。两种方式任选：

### 方式 A：写进配置文件（推荐，跟着备份走）

```bash
python3 - <<'PY'
import re, os
profile = os.environ["DSH_PROFILE"]
persona = open("../../persona/whale.md", encoding="utf-8").read()
# 用 YAML 块标量包起来，避免特殊字符破坏结构
block = "|\n" + "\n".join("      " + l for l in persona.splitlines())
p = os.path.join(profile, "../../config/cordis.patch.yml")
s = open(p, encoding="utf-8").read()
s = re.sub(r"(\n      text: )''(\n)", lambda m: m.group(1) + block + m.group(2), s, count=1)
open(p, "w", encoding="utf-8").write(s)
print("已写入 persona.text，长度", len(persona))
PY
```

### 方式 B：Web UI 里填

Agent 预设 → 系统提示词 → 粘贴 `../../persona/whale.md` 全文 → 保存。

> 二选一即可。两个都填了会重复注入，浪费 token。

---

## 第 4 步：应用 Agent 预设（装了 `dsh-qq-whale` 才做）

`dsh-qq-whale` 装好后，profile 的组合树里会多一张 `preset-qq`——QQ 场景的受限能力集
（去掉 shell、联网、子代理，保留人格 / 工作区 / 压缩）。**它不会自动生效**，要你指给 `dsh-qq-bot`：

**1. 先确认组合树里真有它**（没装成功就别填，填了新会话会直接失败）：

```bash
dsh plugin --profile web list                     # dsh-qq-whale 的 phase 应为 active
dsh --profile web --dump-config | grep preset-qq   # 应看到 id: preset-qq、config.id: qq
```

**2. 填 id**（仓库 `config/cordis.patch.yml` 已写好 `agentPresetCustom: 'qq'`，同步到运行时即可）：

```yaml
dsh-qq-bot:
  agentPresetCustom: 'qq'
```

Web UI 路径：插件 → dsh-qq-bot → 高级 → 会话与排错 → ① 自定义 agent preset id 填 `qq`。

> ⚠️ **只影响新会话。** 老会话仍用旧的能力集，别拿旧会话验证。
> 没装 whale（或上面第 1 步查不到 `preset-qq`）就**留空**——回落 `agentPreset` 的默认 `standard`。

**验收**：新开一个会话，让它用一次 `qq_history`。能返回说明预设生效，且没把工具砍光。

---

## 第 5 步：重启并验证

```bash
dsh web
```

然后按这个顺序验证，**任何一步卡住都能定位问题**：

| # | 操作 | 期望结果 | 卡住了看 |
|---|---|---|---|
| 1 | 私聊机器人发 `/whoami` | 回复你的身份与权限来源 | 若回「还没配置拥有者」→ `owners` 没生效 |
| 2 | 群里 @ 它说句话 | 它回复 | 无反应 → 见下方排查 |
| 3 | 私聊发 `/help` | 指令表 | — |

### 群里没反应的排查顺序

```bash
# 1) 确认机器人真的连上了（这是最快的判断）
cd /tmp && npm i ws && node <你的qqbot目录>/../../tools/ws-check.mjs \
  --url wss://qapi.civer.cn --token YOUR_NAPCAT_TOKEN --group 778916943

# 2) 确认消息上报是通的：在群里发一条消息，然后跑
node <你的qqbot目录>/../../tools/listen.mjs \
  --url wss://qapi.civer.cn --token YOUR_NAPCAT_TOKEN --seconds 60
#    看到 📨 就是通的；0 条 → 去 NapCat 检查「事件上报」开关

# 3) 还是不行，开详细日志
#    配置里 logAdapterFrames: true，重启，看日志
```

---

## 第 6 步（可选）：验证多模态

```bash
export DASHSCOPE_API_KEY=你的key

# 能力自检：LLM / 视觉 / 生图 / 模型清单
python3 ../../tools/probe-capabilities.py

# TTS：合成一句龙灵安希的声音，落盘 wav
cd /tmp && npm i ws
node <你的qqbot目录>/../../tools/probe-tts.mjs --text "我才不胖呢" --out /tmp/v.wav

# 查该模型全部音色（88 个）
node <你的qqbot目录>/../../tools/probe-tts.mjs --list-voices
```

---

## 完成后的默认状态（安全默认值，别急着改）

| 项 | 当前值 | 什么时候改 |
|---|---|---|
| 群里必须 @ 才回 | 开 | 跑顺了想让它接话时 |
| 群管理 | `dryRun: true`（只说不做） | 确认行为符合预期后改 `false` |
| 访客用内部工具 | 禁 | 基本不用改 |
| 主动发言 | 关 | 第 6 天节奏调准后 |
| 生图 | 关 | DashScope 兼容端点待确认 |

**先纯文本跑一周，把「什么时候该说话、什么时候该闭嘴」调准，再给它声音和眼睛。** 顺序反过来会得到一个话很多、声音好听、但让人想屏蔽的东西。

---

## 备份

```bash
tar czf qqbot-backup-$(date +%F).tar.gz \
  $DSH_HOME/profiles/web/cordis.patch.yml \
  "$HOME/Documents/deepseek-harness/QQ_msg/.dsh-meow/memory.db" \
  "$HOME/Documents/deepseek-harness/QQ_msg/qq-images" 2>/dev/null || true
```

**记忆是 SQLite（work 区级一份），建议每周备份一次**；有 WAL 时要连同 `-wal`/`-shm` 一起拷，或用 `VACUUM INTO` 导出（vault 插件的导出就是这么做的）。
现在更省事的做法：设置页 →「QQBot 备份」→ 勾选 config/persona/memory → 导出。


---

## 文件和目录都在哪

| 路径 | 是什么 |
|---|---|
| `./installation.md` | 本文 |
| `README.md` | 总览与导航 |
| `../../config/cordis.patch.yml` | 已填好的配置 |
| `./quick-start.md` | 精简版 5 步 |
| `../02-how-to/configure-napcat.md` | NapCat 侧 + 安全清单 |
| `../03-reference/capability-report.md` | API 实测结论 |
| `../02-how-to/add-feature.md` | **要加功能看这篇** |
| `../02-how-to/operate.md` | 症状对照、成本控制、备份 |
| `../../persona/whale.md` | 人格卡 |
| `../../tools/` | 5 个验证脚本：4 个 `.mjs`（`ws-check` / `listen` / `mock-napcat` / `probe-tts`）+ 1 个 `.py`（`probe-capabilities`，**本机无 python3，跑不了**） |
| `../../samples/龙灵安希-样本.wav` | 真实音色样本 |
