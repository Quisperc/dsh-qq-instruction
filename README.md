# QQ 人格机器人

> 在网页版 / 云服务器版 DSH 上，把 NapCat（OneBot 11 / WSS）接入为一个**有人格、能听会说、会看图会画图**的 QQ 群成员。

**仓库**：[`github.com/Quisperc/dsh-qq-instruction`](https://github.com/Quisperc/dsh-qq-instruction)（公开） · **插件市场索引**：[`quisperc.github.io/dsh-qq-instruction/market/index.json`](https://quisperc.github.io/dsh-qq-instruction/market/index.json) · **真源**：Git，所有改动先落这里

> ⚠️ **别装错**：生态里有两个"大肥鱼"——本项目的 `dsh-qq-whale` 是**QQ 群聊的受限 Agent 预设**（`preset-qq`），
> `dsh-bigfish` 是**桌面宠物**。详见 [`docs/03-reference/plugin-inventory.md`](docs/03-reference/plugin-inventory.md)。
**当前状态**：环境与 API 已实测验证，配置已按真实环境填好，可直接安装。

> ⚠️ **本仓库不含任何真实凭据。** 真实配置（含 NapCat Token / QQ 号）在 `profiles/web/cordis.patch.yml`，
> 已被 `.gitignore` 排除、从未提交；仓库里只有模板 `config/cordis.patch.example.yml`。
> 提交前仍建议自查一遍：`git status` 不该出现 `config/cordis.patch.yml`。
> 历史里曾有明文 token，已通过重写历史清除，并**按已泄露处理、需要轮换**。

> **版本基线（2026-11-14）**：DSH `0.2.2-rc.3` · `@sputnikzaychik/dsh-qq-bot` `0.14.0` · `dsh-qq-whale` `0.14.0` · `dsh-qq-vault` `0.5.0`

| 项 | 值 | 状态 |
|---|---|---|
| OneBot 端点 | `wss://qapi.civer.cn` | ✅ 握手 + 鉴权通过 |
| Bot QQ | `2174357664` | ✅ self_id 一致 |
| 群 | `778916943`（Botest，7 人） | ✅ 在群列表内 |
| 入站消息 → 回复 | OneBot 11 事件上报 | ✅ 已实测 |
| 人格（大肥鱼 4.5k 人设卡） | `dsh-qq-bot.persona.text` | ✅ 生效（首轮注入） |
| 会话 preset | `preset-qq`（受限） | ✅ 生效（**注意：老会话 preset 锁死，换只能重建**） |
| 工具面收窄 | `dsh-qq-whale`：guard（执行期）+ 首个 pre-step 的 `restrict`（隐藏） | ✅ 23 项白名单，见 [tool-surface](./docs/03-reference/tool-surface.md) |
| 联网 | `qq_websearch` / `qq_webfetch` | ✅ 可用（通用 `web_*` 已从白名单移除，避免与 qq-bot 自带能力重复） |
| **识图** | qq-bot **原生附件**（`vision.provider`/`vision.model` 都留空） | ✅ 图片作为附件随消息进会话，模型直接看；不再需要 `read_image` 绕路 |
| **生图** | `qq_draw` | ❌ 关着，且缺 key + 端点不兼容 |
| **TTS / STT** | — | ❌ qq-bot v0.14.0 仍无实现，需从零写 |
| 主动发言 | `proactive.enabled=true` | ⚠️ `dryRun=true`，只演练不外发 |
| 群管理 | `admin.enabled=false` | ❌ 全部拒绝 |
| 记忆 | `meow-memory`（工作区级） | ✅ 群聊私聊共用 `QQ_msg/.dsh-meow/memory.db` |

---

## 三件事的快速入口

| 我要… | 去哪 |
|---|---|
| **接手 / 换人换 Agent** | [`./docs/05-handover/README.md`](./docs/05-handover/README.md) —— 三份文档，先读 ARCHITECTURE |
| **改配置 / 装插件 / 排障 / 回滚** | [`./docs/05-handover/OPERATIONS.md`](./docs/05-handover/OPERATIONS.md) —— **操作唯一真源** |
| **换一台机器** | [`./docs/01-tutorial/migrate.md`](./docs/01-tutorial/migrate.md)（设置页「QQBot 备份」导出/导入 + `scripts/install-whale.mjs`） |
| **查工具面 / 配置字段** | [`./docs/03-reference/tool-surface.md`](./docs/03-reference/tool-surface.md) · [`config-schema.md`](./docs/03-reference/config-schema.md) |
| **理解系统（为什么）** | [`./docs/04-explanation/architecture.md`](./docs/04-explanation/architecture.md) |
| **全部文档** | [`./docs/README.md`](./docs/README.md) —— 含「已过期 / 仅供参考」标记 |

完整文档索引：[`docs/README.md`](docs/README.md)
**贡献规范（改任何东西前必读）**：[`./CONTRIBUTING.md`](./CONTRIBUTING.md)

---

## 安装两个插件（三条路径，任选其一）

本仓库提供两个 DSH 插件，**互相独立**，可以只装一个：

| 插件 | 作用 | 不装会怎样 |
|---|---|---|
| `dsh-qq-whale` | 给 QQ 会话提供受限 Agent preset（`id: qq`）+ 工具面收窄（设置页可热调 `mode` / `allowTools`） | QQ 会话能看见 80+ 个工具，包括 bash / terminal / 子代理 |
| `dsh-qq-vault` | 设置页「QQBot 备份」：**逐配置项**多选导出/导入（配置块、人设、记忆），先逐项预览差异，写入要一次性确认码 | 换机器只能手工拷配置 |

### 路径 A：插件市场（推荐，能收到更新）

设置 → 插件 → **发现** → 索引菜单 →「管理索引来源」→ 添加：

```
https://quisperc.github.io/dsh-qq-instruction/market/index.json
```

然后在市场里搜索 `dsh-qq` 安装并启用（`dsh-qq-whale` / `dsh-qq-vault`）。
索引是本仓库自己托管的静态 JSON（GitHub Pages，源文件 `market/index.json`；生成与发布方式见 [`market/README.md`](./market/README.md)）。

### 路径 B：GitHub 直装（不经过市场）

```bash
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-whale'
dsh plugin --profile web add 'git+https://github.com/Quisperc/dsh-qq-instruction.git#<40位commit>&path:/packages/dsh-qq-vault'
```

`#<commit>` 必须是完整 40 位小写 hex；`&path:/…` 是单仓库多子包的写法，不能省。

### 路径 C：本地开发（软链，改代码即生效）

```bash
node scripts/install-whale.mjs --write      # 装 whale（-h 看参数，默认 dry-run）
# vault 没有专用脚本，按 packages/dsh-qq-vault/README.md §二 路径 C 的三步手工装
```

装完都要在插件页**启用**。whale 还要让 QQ 用上这张 preset：
`dsh-qq-bot` 设置页 → 高级 → 会话与排错 → 「① 自定义 agent preset id」填 `qq`。

> ⚠️ **停用/卸载 whale 前必须先清 `agentPresetCustom`**，否则 QQ 每条消息都回「（内部错误：无法创建对话会话）」。
> 正确顺序见 [`packages/dsh-qq-whale/README.md`](./packages/dsh-qq-whale/README.md) §五。

> ⚠️ 任何情况下都不要在 profile 里跑 `pnpm install/remove`：`node_modules/@deepseek-ai/*` 是手工软链，会被当多余包删掉。

---

## 核心设计一句话

> **LLM 是决策者，但不是授权者。**

最终动作 = LLM 决策 ∩ 策略允许 ∩ 执行能力。后两者必须是确定性代码——提示词约束会被越狱、会被长上下文稀释、会在换模型后失效。

---

## 项目结构

```
qqbot/
├── README.md            本文件（只做导航）
├── ./CONTRIBUTING.md      ★ 规范：加文档 / 加功能 / 改配置都按这走
├── ./CHANGELOG.md
├── docs/                文档（Diátaxis 四象限）
│   ├── 01-tutorial/     教程
│   ├── 02-how-to/       指南
│   ├── 03-reference/    参考
│   ├── 04-explanation/  解释 + ADR
│   └── 05-handover/     ★ 接手：架构 / 运维 / 规范（操作唯一真源）
├── config/              配置模板
├── market/              ★ 插件市场索引（index.json + 托管/发布手册）
├── packages/            自研插件源码
│                        ├── dsh-qq-whale  preset-qq + 工具收窄 + 设置页两项
│                        └── dsh-qq-vault  设置页逐项备份/导入（多选 + 一次性确认码 + 上传）
├── persona/             人格卡
├── tools/               验证脚本
├── scripts/             运维脚本（install-whale / verify-live / make-market-index / set-repo + 历史 python 检查脚本）
├── samples/             产物样本
└── TODO.md              ★ 唯一待办清单
```

> **换个模型 / 换个人接手？** 从 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §0「开工前必读」开始，
> 那里写清了先读什么、按什么顺序读。

---

## 不重复造轮子的边界

| 已有现成的（用配置） | 你要写的 |
|---|---|
| OneBot 11 协议适配 | 人格卡 |
| 会话映射、准入、限流 | 记忆分区与召回 |
| 权限三路并集、群管理 | 决策契约 |
| **主动发言全套治理** | 多模态工具（TTS/STT/生图） |
| 视觉识图 | 策略层钳制与出口检查 |

详见 [`./docs/04-explanation/architecture.md`](./docs/04-explanation/architecture.md) §6 的对照表。

---

## 待办

**唯一清单：[`TODO.md`](TODO.md)**（还没做 / 定期复查 / 安全处置三类）。
改完一件事，先记 `CHANGELOG.md`，再回 `TODO.md` 划掉——规范见 `CONTRIBUTING.md` §10。

当前最急的三条：

- [ ] 轮换 NapCat token（曾明文出现在配置文件与对话里，**当作已泄露处理**）
- [ ] 关掉 `napcat.civer.cn` 上暴露的 NapCat WebUI
- [ ] 生图：拿到可用 key + 解决端点不兼容（DashScope `/images/generations` 404）
- [ ] TTS / STT：从零实现（TTS 先于 STT；音频需公网可访问 URL）
- [ ] 主动发言：`dryRun` 跑几天看日志再改 false
- [x] 灌入人格（已在 `persona.text`，首轮注入）

---

## 许可与署名

本项目**双许可**，按内容划界：

| 内容 | 许可 | 文件 |
|---|---|---|
| 代码、脚本、配置、文档（`packages/` `scripts/` `docs/` `market/` 等） | **MIT** | [LICENSE](./LICENSE) |
| 人格形象与人格卡（`persona/`、配置里的 `persona.text`） | **CC BY-NC-SA 4.0**（署名 / 非商业 / 相同方式共享） | [LICENSE-PERSONA](./LICENSE-PERSONA) |

人格形象基于「溟月：上善无形」与 ZipZipPipe 的设计；**商业化使用前必须先取得原作者授权**。对外运行时应声明「AI 自动回复、非官方」。
