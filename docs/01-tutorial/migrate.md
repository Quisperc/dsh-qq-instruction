# 迁移到另一台机器（换机教程）

> 适用：把现在这台机器上的 QQBot 整体搬到新机器（或新容器）。
> 目标：新机器上能复现「同一个 Bot、同一个人格、同一份记忆、同一套能力边界」。
> 全程命令可直接复制；每步都写清「怎么知道成功了」。
>
> 导出/导入走**设置页的「QQBot 备份」卡片**（`dsh-qq-vault` 插件）；
> 装自有插件用 `scripts/install-whale.mjs`（只认 `dsh-qq-whale`，vault 要手工三步，见第 4 节）
> 相关文档：[`../05-handover/OPERATIONS.md`](../05-handover/OPERATIONS.md)（运维）、[`../05-handover/CONVENTIONS.md`](../05-handover/CONVENTIONS.md)（规范）

---

## 0. 先理解要搬什么

| 类别 | 内容 | 为什么必须搬 |
|---|---|---|
| **配置** | `$DSH_HOME/profiles/web/cordis.patch.yml` 里 `- id: dsh-qq-bot` 那一段（含 NapCat token、QQ 号、4.5k 人设卡） | 这是整条链路的核心；缺它机器人连不上也无人格 |
| **人格** | 同一段里的 `persona.text`（**生效值**，约 4473 字符） | 仓库 `persona/whale.md` 只是真源副本；只搬 md 不写回配置 = 人格没恢复 |
| **自有插件** | `packages/dsh-qq-whale`（preset + 工具收窄）、`packages/dsh-qq-vault`（备份 UI） | 前者提供 `preset-qq` 与 `allowTools`；后者是导入的入口，**不装就没法导入** |
| **记忆库** | `<QQ 工作区>/.dsh-meow/memory.db` | 工作区级记忆，群聊私聊共用一份 |
| 会话历史（可选） | `$DSH_HOME/sessions/--data-...-QQ_msg--/` | 想保留聊天上下文才需要 |

**不用搬**：`node_modules`（重装+软链）、`/tmp`、旧的 `mk/`、`mk-hub/`（旧方案数据）。

> ⚠️ **迁移包不包含**这三样，必须手动处理：
> 1. `package.json` 的 `dependencies` + `dsh.profile.bundles`（决定装什么、挂什么）
> 2. `llm-pi-ai` 的 provider 配置与 **API key**（模型凭据不随包走）
> 3. 会话历史（默认不导出）

---

## 1. 在旧机器上打包

打开 **设置 → 插件 → QQBot 备份**。卡片会把可导出的东西**逐项列出**（按组：`dsh-qq-bot` 的每个一级配置块 / 人格源文件 / 记忆库），默认**全不选**，由你勾：

| 建议勾 | 项 | 说明 |
|---|---|---|
| ✅ | `onebot` | NapCat 地址与 token —— **含凭据，包要当机密文件对待** |
| ✅ | `persona` | 人格的**生效值**（`config.persona.text`，约 4.5k 字） |
| ✅ | `group` / `private` / `auth` | 准入策略：谁能触发、谁能私聊 |
| ⬜ | `vision` / `reply` / `proactive` / `session` / … | 只有你手调过才需要；不勾就用包内默认值 |
| ⬜ | `memory.db` | 记忆库，含群友隐私；用 `VACUUM INTO` 导出，不会丢 WAL 里已提交的数据 |
| ⬜ | `persona.source` | 仓库里 `persona/whale.md` 的副本（仅供对照） |

配置项是**动态发现**的：qq-bot 升级后新增的字段（例如 0.14.0 的 `reply.bubbleGapMinMs`、`sticker.*`）会自动出现在列表里，不用改插件。

点「导出选中项（N 项）」→ 浏览器直接下载 `qqbot-vault-<时间戳>.tar.gz`。

包里是（**按项**组织，不再是整段配置）：

```
items/qqbot.onebot.yml        ← 每个勾选的配置块单独一个文件
items/qqbot.persona.yml
persona/persona.text          ← 人格生效值（勾了 persona 才有）
memory/memory.db              ← SQLite VACUUM INTO 快照（勾了记忆才有）
manifest.json                 ← DSH/插件版本、导出时间、**逐项** sha256
```

**怎么知道成功了**：浏览器收到 `qqbot-vault-*.tar.gz`；
`tar tzf qqbot-vault-*.tar.gz` 能列出你勾的那几项。

> ⚠️ 包里**含 NapCat token 与 QQ 号**。只走私密通道（scp / 加密盘 / 密码管理器），
> 不要放进 Git、网盘公开链接或聊天群。

---

## 2. 在新机器上装 DSH

```bash
dsh --version     # 需要 >=0.2.0-rc.2 且 <0.3.0（本次实测 0.2.2-rc.3）
echo "$DSH_HOME"  # 本次实测 /data/dsh
```

没有 DSH 的话先按 [`installation.md`](./installation.md) 装。

**怎么知道成功了**：`dsh --version` 有输出；`ls $DSH_HOME/profiles` 能看到 `web` 目录。

---

## 3. 装两个公开插件 + 补回 provider 配置

```bash
dsh plugin --profile web add meow-memory
dsh plugin --profile web add @sputnikzaychik/dsh-qq-bot
```

**公开包可以走官方安装器**（它们已发布到 npm）。**自有包不行**，见下一节。

**模型凭据要单独补**：迁移包不含 `llm-pi-ai` 的 provider 与 API key。新机器上要么在
**设置 → 模型**里重新填，要么手工把旧机器 `cordis.patch.yml` 里的
`- id: llm-pi-ai` 整段搬过来（注意 `apiKeyEnv` 指向的环境变量名也要在新环境里存在）。

**怎么知道成功了**：`dsh --profile web --dump-config` 退出码 0，且
`grep -cE "^- id: (meow-memory|dsh-qq-bot|llm-pi-ai)"` 输出 ≥ 2。

> ⚠️ **已知坑**：DSH 镜像里的 `@deepseek-ai/*` 在 profile 的 `node_modules` 下是**手工软链**到宿主安装目录的。
> 在这个 profile 里跑 `pnpm install` / `pnpm remove` 可能把它们当「多余包」删掉 → DSH 起不来。
> 装完若 DSH 无法启动，先检查 `ls profiles/web/node_modules/@deepseek-ai | wc -l` 是否明显变少。

---

## 4. 装两个自有插件（whale + vault）

```bash
git clone <私有仓库地址> dsh-qq-instruction    # 需要仓库鉴权
cd dsh-qq-instruction
node scripts/install-whale.mjs            # 先看计划
node scripts/install-whale.mjs --write    # 真装
```

`install-whale.mjs` 做三件事（**不会调用 pnpm/npm**）：

1. 在 `<profile>/node_modules/dsh-qq-whale` 建**软链**指向仓库里的包目录；
2. 在 `package.json` 的 `dependencies` 登记 `"dsh-qq-whale": "file:<绝对路径>"`；
3. 在 `dsh.profile.bundles` 追加 `dsh-qq-whale`。

**`dsh-qq-vault` 要手工做同样三步**（脚本只认 whale 的包名）：

```bash
# 两个变量后面要传给 node，必须 export
export VAULT=/path/to/dsh-qq-instruction/packages/dsh-qq-vault
export PROFILE="$DSH_HOME/profiles/web"

# 1) 软链
ln -sfn "$VAULT" "$PROFILE/node_modules/dsh-qq-vault"

# 2) + 3) dependencies 与 bundles 一起登记
node -e '
const fs = require("fs");
const p = process.env.PROFILE + "/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.dependencies["dsh-qq-vault"] = "file:" + process.env.VAULT;
if (!j.dsh.profile.bundles.includes("dsh-qq-vault")) j.dsh.profile.bundles.push("dsh-qq-vault");
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("registered");
'
```

**怎么知道成功了**：

```bash
ls -l "$DSH_HOME"/profiles/web/node_modules/dsh-qq-{whale,vault}   # 两个软链
node -e '
const j = require(process.env.DSH_HOME + "/profiles/web/package.json");
for (const n of ["dsh-qq-whale", "dsh-qq-vault"])
  console.log(n, j.dependencies[n], j.dsh.profile.bundles.includes(n));
'
# 期望：两个包都是 file:… 且 true
```

### 为什么自有插件不用 `dsh plugin add`，而是 clone + 软链？

| 原因 | 说明 |
|---|---|
| **私有仓库需要鉴权** | `dsh plugin add` 走 npm registry；两个自有包都没发 npm |
| **要跟真源同步** | 仓库是唯一真源（`github.com/Quisperc/dsh-qq-instruction`，公开）。软链 = 拉取即生效 |
| **改代码即生效** | 软链指向源码，改 `lib/*.js` 后 `set_bundle` 关→开就重载 |
| **两处登记缺一不可** | 只在 `node_modules` 里放文件不算装：`dependencies` 决定插件页是否列出，`dsh.profile.bundles` 决定是否挂载 |

> 将来发到 npm 之后，可以直接 `dsh plugin --profile web add dsh-qq-whale`，本节可跳过。

---

## 5. 导入配置、人格与记忆

**前提**：vault 插件已装好并激活（上一节），否则设置页里没有「QQBot 备份」卡片。

把导出的 `qqbot-vault-*.tar.gz` 放到 `$DSH_HOME/backups/qqbot-vault/`（想让列表自动发现）
或直接上传：卡片上的「上传本地文件」会把包存到 `$DSH_HOME/backups/qqbot-vault/uploads/`。
然后 **设置 → 插件 → QQBot 备份**：

1. 在文件列表里选中该包，或直接填绝对路径；
2. 点「预览差异」——**逐项**列出每个配置项的动作（未变 / 将替换 / 将新增）、两侧字节数与可展开的前 200 字对比，附带 sha256 完整性校验结果，以及一个**一次性确认码**（5 分钟有效，绑定「包路径 + 你勾选的项」）；
3. **勾选你真正想恢复的项**（只有变更行可勾，可「全选变更」），再点「应用选中项」。

导入时插件会：

1. 校验 `manifest.json` 与 **DSH 版本**（主次版本不一致会拒绝；确实要跨版本用强制导入，风险自负）；
2. **备份**目标 `cordis.patch.yml` → `cordis.patch.yml.bak-vault-<时间戳>`；
3. **只替换你勾选的那些一级配置块**（`onebot` / `persona` / `group` / `vision` …），未勾选的块、注释、缩进、同级其它键一律不动；
4. 每写一项后**回读逐字比对**，不一致则该项失败并跳过（不会写坏配置）；
5. 恢复记忆库：目标已有 `memory.db` 则改名备份，并把 `-wal`/`-shm` 一起挪走（否则旧 WAL 会污染新库）；
6. 返回 `applied[]` 与 `failed[]`，并打印后续必须手动做的事。

> **语义提醒**：v0.5.0 起是**逐项**导入，不再整段覆盖 `dsh-qq-bot`。
> 旧格式包（≤0.4.0）会被拒绝，请用新版重新导出。
> 配置项是**动态发现**的（`GET /dsh-qq-vault/items`，真机 20 项），qq-bot 升级新增字段会自动出现在列表里。

**怎么知道成功了**：

```bash
grep -c "^- id: dsh-qq-bot" $DSH_HOME/profiles/web/cordis.patch.yml   # 输出 1（不是 2！）
ls -l $DSH_HOME/profiles/web/cordis.patch.yml* | head                 # 有 .bak-vault-<时间戳>
```

> 记忆库**不要用 sha256 比对**：SQLite 头部的计数器每次打开都会变。
> 要比就比内容——例如 `sqlite3 ... 'select count(*), max(created_at) from ...'`，或直接在 QQ 里问它旧事。

---

## 6. 改成新机器的值（**必须手动**）

打开 `$DSH_HOME/profiles/web/cordis.patch.yml`，改这几处：

| 字段 | 改成 |
|---|---|
| `onebot.wsUrl` | 新机器能连到的 NapCat 地址（如 `wss://qapi.civer.cn`） |
| `onebot.accessToken` | 新的 NapCat token（顺手轮换，旧 token 应视为已泄露） |
| `auth.owners` | 你的 QQ 号 |
| `group.allow` | 要接的群号 |

改完执行：

```bash
chmod 600 $DSH_HOME/profiles/web/cordis.patch.yml    # 里面是 token
```

**两件与网络有关的事**：

- **同一 QQ 号不能两台机器同时连 NapCat**，否则会出现双回复——切换前先把旧机器的 DSH 停掉。
- **NapCat 侧要放行新机器的出口 IP**（若它做了 IP 白名单/防火墙）；否则表现是 `qqbot status` 里 `connected:false`。

---

## 7. 重启并验证

```bash
dsh web        # 或按你的部署方式重启容器
```

按顺序验，卡在哪一步就知道问题在哪：

| # | 操作 | 期望 | 不对时看 |
|---|---|---|---|
| 1 | `dsh --profile web --dump-config \| grep -E "^- id: dsh-qq-(whale\|vault)\|^- id: preset-qq"` | 三行都在 | 组合树没挂上 → 重跑安装（第 4 节）后重启 |
| 2 | 插件页 → 已安装插件 | 有「QQ 群聊受限预设（preset-qq）」与「QQBot 备份」 | `dependencies` 没登记 → 见第 4 节校验命令 |
| 3 | QQ 私聊机器人发 `/whoami` | 回你的身份与权限来源 | 没回 → token/wsUrl；回「内部错误：无法创建对话会话」→ `agentPresetCustom` 指向了不存在的 preset |
| 4 | 群里 @ 它说句话 | 能回 | 群里不回 → `group.allow` / 是否需要 @ |
| 5 | 随便聊两句问它「记得我之前说过什么吗」 | 能接上旧记忆 | 记忆没恢复 → 见第 5 节 |

---

## 8. 常见问题

**Q：导入后机器人每条消息都回「（内部错误：无法创建对话会话）」？**
A：几乎都是 `agentPresetCustom` 指向了不存在的 preset。要么 whale 没装上（第 4 节），要么 `preset-qq` 没挂载（第 7 节第 1 步）。临时救急：把 `agentPresetCustom` 改成 `''` 回落 `standard`，机器人立刻能回话。

**Q：新会话出现在「未分组」里？**
A：手工动过 `$DSH_HOME/storages/workspace.json` 时会出现。把该会话 id 加回「QQ 消息」工作区的 `sessionIds` 数组，重启即恢复分组。

**Q：群聊和私聊的记忆是同一份吗？**
A：是。记忆库是**工作区级**的（`<QQ 工作区>/.dsh-meow/memory.db`），群聊私聊共用。想隔离只能开 `dsh-qq-bot` 的 `flowAuth`（每会话独占子目录）或改插件。

**Q：能不能只搬配置、不搬记忆？**
A：能。导出时**只勾「配置」和「人格卡」，不勾「记忆库」**即可（勾选项就是唯一开关，没有额外的命令行参数）。

**Q：DSH 版本不一致怎么办？**
A：先用与导出时**相同的次版本**（0.2.x）再试；确实要跨版本时在预览后选择强制导入（`force`），并准备回滚（见下）。

**Q：`dsh plugin add` 之后 DSH 起不来了？**
A：大概率是 `@deepseek-ai/*` 手工软链被 pnpm 清掉。检查 `ls $DSH_HOME/profiles/web/node_modules/@deepseek-ai | wc -l`，变少就说明中招；按 [`../05-handover/OPERATIONS.md`](../05-handover/OPERATIONS.md) 的重建软链步骤恢复。

---

## 9. 回滚

```bash
# 配置回滚
cp $DSH_HOME/profiles/web/cordis.patch.yml.bak-vault-<时间戳> \
   $DSH_HOME/profiles/web/cordis.patch.yml

# 记忆回滚（导入时做过备份才会有）
ls <QQ 工作区>/.dsh-meow/memory.db.bak-vault-*
mv <QQ 工作区>/.dsh-meow/memory.db.bak-vault-<时间戳> <QQ 工作区>/.dsh-meow/memory.db
```

然后重启。配置与记忆是两件事，可以各自独立回滚。
