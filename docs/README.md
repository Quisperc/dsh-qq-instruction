# 文档索引

> 按 **Diátaxis 四象限**组织。找东西前先判断你在干什么。
> **操作类问题只有一个真源：`05-handover/`。** 其它地方的运维细节都是历史残留，读到冲突以 05 为准。

| 你在… | 去哪 | 真源？ |
|---|---|---|
| 第一次接手 / 换人 / 换 Agent | [`05-handover/`](./05-handover/) | ✅ **唯一操作真源** |
| 准备装一台新机器 | [`01-tutorial/migrate.md`](./01-tutorial/migrate.md) + `scripts/` 三件套 | ✅ |
| 干活中，要解决一个具体问题 | `02-how-to/` | ⚠️ 多数已并入 05，见下表标记 |
| 查字段、查参数、查结论 | `03-reference/` | ⚠️ 部分结论已被真机推翻，见标记 |
| 想知道为什么这么设计 | `04-explanation/` | ✅（解释层，不含操作步骤） |

**当前版本基线（2026-11-14）**：DSH `0.2.2-rc.3` · `@sputnikzaychik/dsh-qq-bot` `0.14.0` · `dsh-qq-whale` `0.14.0` · `dsh-qq-vault` `0.5.0`。
读到与这行不符的版本号，以这行为准。

---

## 05-handover —— 接手（先读这里）

| 文档 | 什么时候读 | 状态 |
|---|---|---|
| [`ARCHITECTURE.md`](./05-handover/ARCHITECTURE.md) | **纯小白先读这篇**：六个角色、一条消息的 10 步旅程、preset≠沙箱、人格两条通道、目录索引、ASCII 图 | ✅ 现行 |
| [`OPERATIONS.md`](./05-handover/OPERATIONS.md) | 改配置 / 装插件 / 热重载 / 验证 / 回滚 / 故障速查 / 紧急静音 / 成本 / 能力线现状 / 平台限制 / **发布与上架（§11）** | ✅ **操作唯一真源** |
| [`CONVENTIONS.md`](./05-handover/CONVENTIONS.md) | 真源与同步流程、插件开发约定、测试规范、已知坑清单 | ✅ 现行 |
| [`README.md`](./05-handover/README.md) | 三份文档的分工与阅读顺序 | ✅ 现行 |

---

## 01-tutorial —— 教程（跟着做能完成一件事）

| 文档 | 内容 | 状态 |
|---|---|---|
| [`migrate.md`](./01-tutorial/migrate.md) | **换机迁移**：装 DSH → 装公开插件 → clone 真源 → 装 whale → 导入配置/人设/记忆 → 验证。含 9 条 FAQ 与回滚 | ✅ **推荐入口** |
| [`installation.md`](./01-tutorial/installation.md) | 最早的安装流程（复制 `config/cordis.patch.yml`、手动灌人格） | ⚠️ **部分过期**：不含 whale / vault / preset-qq；命令仍可参考，但以 `migrate.md` + `05-handover/OPERATIONS.md` 为准 |
| [`quick-start.md`](./01-tutorial/quick-start.md) | 精简版 5 步 + 最小可用配置 | ⚠️ **部分过期**，同上 |

## 02-how-to —— 指南（解决一个具体问题）

| 文档 | 什么时候看 | 状态 |
|---|---|---|
| [`configure-napcat.md`](./02-how-to/configure-napcat.md) | 配 WSS、对参数、过安全清单（**协议端那一侧**，与 DSH 无关） | ✅ 有效 |
| [`add-feature.md`](./02-how-to/add-feature.md) | 要加新功能：决策树 + 工具骨架 + 上线顺序 | ✅ 有效（有一处旧注释已修正） |
| [`sync-assets.md`](./02-how-to/sync-assets.md) | Git ↔ 本地 ↔ 网盘三层同步、密钥风险与脱敏处置 | ✅ 有效（与 `05-handover/CONVENTIONS.md` §1–2 重叠，以 05 为准） |
| [`operate.md`](./02-how-to/operate.md) | 旧的运维与排障页 | 🚚 **已迁移** → 只剩跳转页，内容并入 `05-handover/OPERATIONS.md` §2–§6、§8 |

## 03-reference —— 参考（查事实）

| 文档 | 查什么 | 状态 |
|---|---|---|
| [`tool-surface.md`](./03-reference/tool-surface.md) | **QQ 会话到底能用哪些工具**：25 项白名单、可见≠可执行、guard 与 restrict 分工、怎么改 | ✅ 新增（2026-11-14） |
| [`config-schema.md`](./03-reference/config-schema.md) | `dsh-qq-bot` v0.14.0 的完整配置字段 | ✅ 有效（**没有** tts/stt 组，别找了） |
| [`preset-qq-contract.md`](./03-reference/preset-qq-contract.md) | `preset-qq` 每行能写什么（官方包核对版）、两条人格通道 | ✅ 有效（`persona.prefix` 文案 2026-11-14 已改，见文内注） |
| [`plugin-inventory.md`](./03-reference/plugin-inventory.md) | 相关插件清单（含别装错的 `dsh-bigfish`） | ✅ 有效（whale 行 2026-11-14 已更新到 0.12） |
| [`feature-matrix.md`](./03-reference/feature-matrix.md) | 需求能力 vs 原生/自研对照 | 📖 参考（结论性质，不随版本变） |
| [`tts.md`](./03-reference/tts.md) | TTS 参数全景、语气池、标签白名单、钳制规则 | 📖 **未来规划参考**：qq-bot v0.14.0 **没有** TTS 实现，本文是选型与实测资料，不是当前能力 |
| [`capability-report.md`](./03-reference/capability-report.md) | 2026-10-31/11-01 的 API 实测记录（哪些端点通、音色 ID、踩过的坑） | 🕰️ **部分过期**：识图结论已被推翻（见文内注）；生图/ASR 结论仍可参考 |

## 04-explanation —— 解释（为什么）

| 文档 | 讲什么 | 状态 |
|---|---|---|
| [`architecture.md`](./04-explanation/architecture.md) | 部署拓扑、模块边界、数据流、层间契约、失败路径、架构不变量 | ✅ 现行（**解释层**：操作细节一律指向 `05-handover/`） |
| [`design-rationale.md`](./04-explanation/design-rationale.md) | 分层取舍、决策契约、治理参数、第一周清单 | 📖 参考 |
| [`memory-model.md`](./04-explanation/memory-model.md) | 旧的 `dsh-soul-md` 四层记忆模型 | 🕰️ **已过期**：ADR-005 否决了 soul-md，现用 `meow-memory`（工作区级 `QQ_msg/.dsh-meow/`）。仅作历史参考 |
| [`decisions/`](./04-explanation/decisions/) | ADR 架构决策记录（只增不改） | 📚 历史档案，索引见 [`decisions/README.md`](./04-explanation/decisions/README.md) |
| [`05-handover/FEATURE-CHECKLIST.md`](./05-handover/FEATURE-CHECKLIST.md) | **要加新功能 / 发新版本 / 上架插件时** | ✅ 现行：可勾选的执行清单——动手前查重、ADR 判据、放哪个包、测试要覆盖哪五类坑、文档六处同步、双轨版本与发版三步顺序、配置与权限、收尾命令 |

---

## 其它目录

| 目录 | 内容 |
|---|---|
| [`../packages/`](../packages/) | 自研插件：`dsh-qq-whale`（preset + 工具收窄 + 设置页）、`dsh-qq-vault`（设置页**逐项**备份/导入） |
| [`../market/`](../market/) | 插件市场索引：`index.json`（format 1）+ 托管/发版手册。索引地址 `https://quisperc.github.io/dsh-qq-instruction/market/index.json` |
| [`../scripts/`](../scripts/) | 2 个 Node 脚本：`install-whale`（装自有插件）、**`verify-live`**（真机 15 项自检）；3 个 Python 脚本：`check-conventions` / `check-links` / `scrub-secrets`（**本机无 python3，跑不了**） |
| [`../persona/`](../persona/) | 人格卡真源 `whale.md`（大肥鱼） |
| [`../config/`](../config/) | 配置模板与真源副本（**实际生效**的是 `$DSH_HOME/profiles/web/cordis.patch.yml`） |
| [`../TODO.md`](../TODO.md) | 待办清单（未做 / 复查 / 安全处置） |

---

## 写新文档前

1. 先读 [`../CONTRIBUTING.md`](../CONTRIBUTING.md) §0–2（接手清单、放对目录、命名、象限判定、模板）；
2. 判断它属于**操作**还是**解释**：操作 → 并入 `05-handover/`；解释 → `04-explanation/`；
3. 写完在本文注册，并记一笔 `../CHANGELOG.md`；
4. 会过期的数字（工具数、版本号、行号）一律加「截至 2026-11-14」；
5. 改完**全局搜一遍关键词**再提交——只盯光标那一处，会留下自相矛盾的文档。
