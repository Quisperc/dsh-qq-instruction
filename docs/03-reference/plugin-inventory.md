# 插件清单

> 本方案用到哪些插件、在哪能看到已装了什么、还差什么。
> 状态标记沿用仓库规范：✅ 已实测 · 📖 官方文档/源码所得 · ⚠️ 未验证。

---

## 一、怎么看「我现在装了什么」

三种方法，按可靠度排序：

| 方法 | 命令 / 位置 | 状态 |
|---|---|---|
| **看 profile 的包清单** | `$DSH_HOME/profiles/<profile>/package.json` 里的 `dsh.profile.bundles` 字段 | 📖 `dsh-plugin-shop` README 所述 |
| **CLI 列出** | `dsh plugin --profile <profile> list --depth 0` | 📖 同上；**⚠️ 沙箱内 `dsh` 子命令无输出，未能实测** |
| **Web 界面** | 装 `dsh-plugin-shop` 后左侧栏 **Plugin shop** | 📖 README 所述；⚠️ 未实测 |

> `--profile` 是**必填**项，省略会报
> `error: required option '--profile <name>' not specified`。

---

## 二、本方案依赖的插件

### 必装（缺了跑不起来）

| 插件 | 作用 | 版本 | 安装 |
|---|---|---|---|
| `@sputnikzaychik/dsh-qq-bot` | QQ 收发、会话映射、权限、工具注册、主动发言治理 | `0.12.8` | `dsh plugin --profile web add @sputnikzaychik/dsh-qq-bot` ✅ 已装（WSS 实测通过） |

### 自研（本仓库）

> **`dsh-qq-whale` 只做两件事**（ADR-012，收窄 ADR-008）：① 提供一张 QQ 受限 Agent preset（`id: qq`）；② 收窄工具面。
> **不管人格**——人设卡真源是 [`persona/whale.md`](../../persona/whale.md)，填进 `persona.text`；
> 节奏用原生 `proactive.*`。装完后需手动把 `agentPresetCustom` 填为 `qq`（只影响新会话）。

| 插件 | 作用 | 版本 | 位置 |
|---|---|---|---|
| `dsh-qq-vault` | **设置页的「QQBot 备份」**：导出/导入 `dsh-qq-bot` 配置段（含 token）、人格生效值（`persona.text`）、记忆库、whale 配置。端点全 GET + 唯一 POST 上传（`/api/dsh-qq-vault/upload`）；导入默认 dry-run，需一次性确认码，写前自动备份（`.bak-vault-<时间戳>`），并按 manifest 的 sha256 校验完整性。**不搬** `package.json` 依赖清单、`llm-pi-ai` 的 provider/API key、会话历史 | `0.4.0` | [`packages/dsh-qq-vault/`](../../packages/dsh-qq-vault/README.md) |
| `dsh-qq-whale` | **只做两件事**：① 提供 Agent preset（`id: qq`）——保留人格/指令/时间/工作区/压缩/交互，去掉 shell、文件搜索、后台任务、子代理；② 工具面收窄——`guard`（执行期拦截）+ 首个 `pre-step` 的 `restrict`（隐藏），默认挡住 23 项白名单外的工具。设置页只有两项：`mode`（`off`/`guard`/`hide`，默认 `hide`）与 `allowTools`，均 volatile。**不写人格**（人格在 `dsh-qq-bot.persona.text`），也不提供 `presetId`/`enabled`/`hideFromModel`（已删除） | `0.14.0` | [`packages/dsh-qq-whale/`](../../packages/dsh-qq-whale/README.md) · ADR-008/012 · [`../03-reference/tool-surface.md`](./tool-surface.md) |

### 强烈建议装（不是必需，但省很多事）

| 插件 | 作用 | 状态 |
|---|---|---|
| `dsh-plugin-shop` | **插件市场**：浏览、安装、启用/禁用、更新，并做本地依赖检查 | 📖 社区项目（LivXue/dsh-plugin-shop），当前 `0.9.0` |

```bash
dsh plugin --profile web add dsh-plugin-shop@0.9.0
# 重启后左侧栏出现 Plugin shop
```

> 装它之前先确认 `dsh` 与 `pnpm` 都在 PATH 里：`dsh --version` / `pnpm --version`。

### 生态里值得关注（与本方案相关，暂不引入）

| 插件 | 是什么 | 与本方案的关系 |
|---|---|---|
| `@zaofan/dsh-qqbot` `1.11.34` | 另一个 QQ 通道插件，依赖含 **`silk-wasm`**（SILK 编解码）与 `lamejs-fixed` | 版本远高于我们用的 `0.12.8`（1.11 vs 0.12）。**silk-wasm 正好解决语音转码痛点**。当前插件已跑通，暂不切换；若将来 TTS 链路卡在 SILK 转码上，优先评估它 |
| `dsh-bigfish` `0.6.0` | **桌面宠物**：装在 DSH Web 右下角的可拖动大肥鱼，101 类动画 + `.dshpet` 角色包 + 160 句台词 | **同名不同物，勿混淆**——它是桌面陪伴宠物，不是 QQ 群聊人格。想要群里那条鱼请装 `dsh-qq-whale`。形象同源（鲸鱼女仆），台词库与角色包思路值得借鉴 |
| `@xmanrui/dsh-im` | 把微信、飞书、企微、钉钉、QQ、Telegram 等接入 DSH 的多通道插件 | 若将来要把同一个人格搬到别的平台，先看它 |
| `dsh-soul-md` `0.10.5` | **人设卡 + 长期记忆**插件：`memory_read/append/rewrite/search` 工具、`core.md` + `topics/*.md` 分层、关键词召回、压缩后补偿 | ✅ **已评估，不采用**（但抄了它的字段设计）。原因：记忆是单一全局目录 `$DSH_HOME/soul-md/memory/`，**工具签名只有 topic 没有 scope**，无法做群级分片——详见 ADR-005 |
| `dsh-moli` `1.1.20` | 本地 Moli 无头浏览器：渲染抓取、markdown、语义树、截图 | 可选：`qq_webfetch` 抓 JS 渲染页面时才需要 |
| `@deepseek-ai/dsh-plugin-manager` | 官方插件管理服务（CLI / Web / agent tools 共用） | 客户端 `remote.pluginManager.listPlugins()` 就是它提供的——**目录型面板要靠它** |

---

## 三、让自己的插件出现在市场里

`dsh-plugin-shop` 每天自动从 npm（关键词 `dsh-plugin` 或 `deepseek-harness`）和 GitHub topics 发现插件，
不需要申请。收录条件（五道检查）：

| 检查 | 要求 | 我们 |
|---|---|---|
| 可加载 | 有 `dsh.bundle` | ✅ 有 |
| 可审查 | 有 license + 可访问的源仓库 | ⚠️ license ✅ / **源仓库需补 `repository` 字段** |
| 可安装 | npm 未弃用；仓库收录还需无 build scripts | ✅（发布到 npm 后） |
| 信息可信 | 校验完整性与发布时间 | — |
| 有信息可展示 | 有 `dsh.catalog` 或 npm description | ✅ 已有 `dsh.catalog` |

`dsh-qq-whale` 已加 `keywords: [dsh-plugin, deepseek-harness]` 与 `dsh.catalog`
（category `persona`，中英摘要，capabilities `config-ui` / `persona`）。

**还差两件事才能真正被收录**：

1. `package.json` 补 `repository` 字段（指向本仓库）；
2. 发布到 npm（`npm publish --access public`）。

> 注意：`dsh-plugin-shop` 的 README 明确写了——
> **商店不做沙箱隔离**，装插件等于把文件系统、shell、模型请求全权交给它。
> 装别人的插件前先看源码。

---

## 四、相关

- 为什么选 `@sputnikzaychik/dsh-qq-bot` 而不是自研：[`../04-explanation/decisions/ADR-001-adopt-dsh-qq-bot.md`](../04-explanation/decisions/ADR-001-adopt-dsh-qq-bot.md)
- 为什么做 `dsh-qq-whale`：[`../04-explanation/decisions/ADR-003-whale-plugin.md`](../04-explanation/decisions/ADR-003-whale-plugin.md)
- 为什么收窄成只做 preset：[`../04-explanation/decisions/ADR-012-whale-preset-only.md`](../04-explanation/decisions/ADR-012-whale-preset-only.md)
- 为什么（曾经）必须有 client 半：[`../04-explanation/decisions/ADR-004-client-half-required.md`](../04-explanation/decisions/ADR-004-client-half-required.md)
  ——v0.7.0 起配置区已下线、client 半已删；**该 ADR 关于机制的事实结论仍成立**（只导出 `Config` 不会自动生成表单）
- 为什么不采用 `dsh-soul-md`（以及抄了它什么）：[`../04-explanation/decisions/ADR-005-soul-md-evaluation.md`](../04-explanation/decisions/ADR-005-soul-md-evaluation.md)
- 安装步骤：[`../01-tutorial/installation.md`](../01-tutorial/installation.md)
