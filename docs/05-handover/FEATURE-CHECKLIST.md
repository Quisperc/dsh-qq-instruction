# 新增功能检查清单

> **定位**：「走哪条路线」的**决策**在 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §3（决策树 A–E）；
> 本文是**执行**清单——决定要做之后，照着从上到下勾，勾完就发。
>
> **用法**：整段复制进 issue / PR 描述里打勾。勾不动的项，说明你还没想清楚。
>
> 为什么要有这一份：以前每次加功能都靠记忆去翻「该改哪几处」，漏过白名单（工具加了但模型看不见）、
> 漏过索引顺序（索引钉到旧提交）、漏过包 version（市场里还显示旧版）。

---

## 0. 动手前（10 分钟，能省一天）

- [ ] 查 [`../04-explanation/architecture.md`](../04-explanation/architecture.md) §6「设计→实现落点对照表」：**目标能力是否已由插件配置提供？是就别写代码**
- [ ] 查 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §3.1 决策树，选定路线（A 配置 / B 新工具插件 / C 人格卡 / D 上游 PR / E 本地私有）
- [ ] 全仓库 `grep` 该关键词，确认**没有半成品**或已废弃的旧实现（本仓库踩过：`qq-restrict` 行删了但文档还在教）
- [ ] 确认改动是否会碰到**正在用的会话/配置**；会的话先在不重要的会话验证（踩过：改会话头导致机器人全线不可用）

---

## 1. 决策：要不要写 ADR

| 情况 | 写 ADR |
|---|---|
| 引入/移除依赖、改架构分层、否决过其他方案 | ✅ |
| 定了一条以后一定会被问「为什么这样」的规则 | ✅ |
| 纯 bug 修复、文案、版本号、格式 | ❌ |

- [ ] 按上表判定；要写就放 [`../04-explanation/decisions/`](../04-explanation/decisions/)，编号**递增且只增不改**（现 001–012）
- [ ] 写完在 [`../04-explanation/decisions/README.md`](../04-explanation/decisions/README.md) 索引里登记，并填**状态列**（有效 / 被取代 / 被扩展）
- [ ] 若本条 ADR **取代或扩展**了旧决策，只改索引里的状态，**不改旧 ADR 正文**

---

## 2. 代码：放哪里、怎么放

| 要加的东西 | 放哪 | 依据 |
|---|---|---|
| 会话能力、预设行、工具面收窄 | `packages/dsh-qq-whale` | 它负责「QQ 会话长什么样」 |
| 设置页 UI、备份/导入类 | `packages/dsh-qq-vault` | 它负责「把配置搬来搬去」 |
| 与 QQ 无关、别处也能用 | **新建包** | 需同时写 ADR |
| 上游插件已提供 | **不加** | 原则：上游有就不重做 |

包内布局（照抄现有两个包）：

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 入口：`name` / `inject` / `Config` / `apply(ctx, config)` |
| `lib/config.js` | schemastery `Config` + `DEFAULT_*`（可选） |
| `lib/client/*.js` | Web 半（要出设置页 UI 时） |
| `cordis.patch.yml` | 插件行 / preset 定义 |
| `test/*.test.mjs` | `node --test`，文件名 `*.test.mjs` |
| `icon.svg` / `locale/{en,zh}.json` | 市场与设置页展示 |
| `README.md` / `CHANGELOG.md` / `LICENSE` | 交付面（`files` 里别漏） |

**四条硬规则（都是真机踩出来的）**：

- [ ] `apply` 里用到的服务必须写进 `inject`，否则 `apply` 早于服务就绪、`ctx.get()` 得 undefined 并**静默降级**（vault v0.1 因此一条路由都没注册）
- [ ] HTTP 端点**只能 GET**（DSH 的 HTTP 层只放行 `GET`/`HEAD`，非 GET 在路由匹配前就 405）；确需 POST 只能挂 connection 的 `/api` 路由
- [ ] 路由注册必须用 `ctx.effect(() => webServer.register(...))`——用 `ctx.on('dispose')` 不触发，关插件后 handler 残留
- [ ] 配置项默认 `.volatile()`（热生效），除非确实需要重启

---

## 3. 测试：必须覆盖这五类坑

| 坑 | 该写的断言 |
|---|---|
| 路由/监听没注销 | effect 数 = 路由数；执行 disposer 后表清空 |
| 不幂等 | 同一输入跑两次结果一致；写操作第二次不产生额外改动 |
| 锚点失配静默跳过 | 上游文件变了要**报错**而不是假装成功（脚本类） |
| 逐项写入误伤邻居 | 只改一项时，其余字节**完全不变**（含注释、缩进、顺序） |
| 缺服务/类型不对 | 缺服务不抛异常、非法值回落默认、卸载后行为可预期 |

- [ ] 每条新逻辑至少有 1 个断言；删掉的断言要能说出**为什么可以删**
- [ ] 跑根聚合测试：`npm test`（= whale + vault 两包）
- [ ] 动过 HTTP / 配置面 / 设置页 → 追加 `node scripts/verify-live.mjs`（真机 15 项，只读）

---

## 4. 文档：六处必须同步（漏一处就会出现自相矛盾）

| 改了什么 | 必须更新 |
|---|---|
| 任何功能 | [`../README.md`](../README.md) 索引（如需新文档）+ [`../../CHANGELOG.md`](../../CHANGELOG.md) |
| 架构/角色/链路 | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| 配置键、操作步骤、排障 | [`OPERATIONS.md`](./OPERATIONS.md) |
| 代码/测试/提交约定 | [`CONVENTIONS.md`](./CONVENTIONS.md) |
| 配置字段、工具面、能力矩阵 | [`../03-reference/`](../03-reference/)（`config-schema` / `tool-surface` / `plugin-inventory`） |
| 插件对外行为 | 该包的 `README.md`（**市场详情页读的就是它**，见 [`../../market/README.md`](../../market/README.md) §1.6） |
| 版本/状态变化 | 根 [`../../README.md`](../../README.md) 状态表 + [`../../market/README.md`](../../market/README.md) 状态表 |

- [ ] 会过期的数字（工具数、版本号、行号）一律写「截至 YYYY-MM-DD」
- [ ] 用户能看到的界面变了 → 包 README 的「设置页长什么样」也要跟着改

---

## 5. 版本与发版（顺序**不能**换）

本仓库**双轨版本号**，别混：

| 版本 | 管什么 | 当前值 |
|---|---|---|
| 根 `CHANGELOG.md` 的 `1.x` | 仓库级：文档、脚本、规范 | `1.27.0` |
| 各包 `package.json` 的 `0.x` | 插件级：市场按它排序、按它装 | whale `0.14.0` / vault `0.5.0` |

发版三步：

- [ ] **① 改包 `version` + 包 `CHANGELOG.md`，先提交**（包代码必须先落库）
- [ ] **② `node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction --write`**
- [ ] **③ 提交索引，然后 `npm run push:all`（GitHub + CNB）**

> **为什么是这个顺序**：索引会把每个版本钉死到当前 `HEAD` 的 commit。先生成索引、后提交包，索引就钉到了**不含新代码**的旧提交，用户装下去是旧版。
>
> **另外**：生成器会保留历史版本条目；**同一版本号重发会覆盖该版本条目**（不会变成两条）。

---

## 6. 配置与权限

- [ ] 新配置项：加了 `.volatile()`？默认值写进 `DEFAULT_CONFIG`？非法值回落行为写了吗？
- [ ] **新工具必须进 whale 的 `DEFAULT_ALLOW`**（`packages/dsh-qq-whale/lib/config.js`）——不进的话，`mode=hide` 下模型**根本看不见**这个工具，功能等于没做
- [ ] 权限最小化：默认 owner-only？有频率闸（`maxPerHour`/`chance`）？默认 dryRun？← 对比：`sticker` 有概率+每小时上限，`imageGen` **没有**，别照抄后者
- [ ] 卸载影响：会不会让 `agentPresetCustom` 指向不存在的 preset（会 → 包 README 必须写「卸载顺序」）

---

## 7. 收尾（缺一项就不算完成）

- [ ] `npm test` 全过
- [ ] 动过真机面 → `node scripts/verify-live.mjs` 15/15
- [ ] 根 `CHANGELOG.md` 记一笔（Added / Changed / Fixed / Known limitations）
- [ ] 新增待办或复查项 → 写进 [`../../TODO.md`](../../TODO.md)
- [ ] 双推：`GITHUB_TOKEN=… CNB_TOKEN=… npm run push:all`
- [ ] 自查：**这次有没有靠打补丁解决？** 本仓库不允许改 `node_modules`（用户明确否决），有问题只走上游或配置

---

## 附：与 `CONTRIBUTING.md` §3 的关系

| 内容 | 以哪份为准 |
|---|---|
| 走哪条路线（A–E）、路线 A/B 各自的细项 | `CONTRIBUTING.md` §3 |
| 决定做之后**按什么顺序执行、要动哪些文件** | **本文** |
| 提交信息格式、Git 工作流 | `CONTRIBUTING.md` §6 |
| 安全红线 | `CONTRIBUTING.md` §7 |

**已过期的说法**：`CONTRIBUTING.md` §0.3 收尾清单里让你跑 `check-links.py` / `check-conventions.py`——
本机**没有 python3**，那两个脚本跑不了。以本文 §7 的命令为准。
