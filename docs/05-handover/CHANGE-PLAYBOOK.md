# 变更手册（按变更类型查）

> **定位**：本文按「**这次加的是什么**」索引——新插件？新工具？新配置项？接了个新厂商？要发版？
>
> 流程顺序视角（动手前 → ADR → 代码 → 测试 → 文档 → 发版）在 [`FEATURE-CHECKLIST.md`](./FEATURE-CHECKLIST.md)。
> 「走哪条路线」的决策在 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §3。三份互补，不要合并成一篇。

---

## 0. 30 秒用法

1. 在 §1 找到你的变更类型（可多选，一个改动常跨两类，例如「新工具 + 新配置项」）
2. 跳到对应小节，照着表格勾：**改哪个文件 → 加什么测试 → 文档哪几处 → 注意什么 → 怎么验收**
3. 拿不准的三个判断题看 §3 附录一；新加东西前先查 §4 附录二，避免重复造

---

## 1. 变更类型总表

| 类型 | 典型触发 | 关键风险（踩过） |
|---|---|---|
| **A 新开一个插件** | 「这个能力单独做成插件」 | 元信息缺项、包目录没建依赖软链 → 工具静默不注册 |
| **B 给现有插件加工具** | 「让它会发语音/会查天气」 | 白名单没加 → 模型根本看不见这个工具 |
| **C 加一个配置项** | 「这个值想让用户能改」 | client 半没同步 → 设置页看不到；没回落 → 非法值崩 |
| **D 接新厂商/新端点** | 「换成 XX 平台的模型」 | 端点选错、型号猜错 → 404/400 却看起来像 key 无效 |
| **E 加一个 preset 行** | 「QQ 会话要多挂一个插件」 | 越界改别家配置；行清单被测试严格断言 |
| **F 新增敏感能力** | 密钥 / 外发 / 烧钱 | 没有 owner 闸或节流 → 任何人都能花你的钱 |
| **G 文档类变更** | 结论变了 / 新决策 | 六处不同步 → 文档自相矛盾 |
| **H 发版与上架** | 「发个新版」 | 顺序错 → 索引钉到不含该版本的提交 |
| **I 下线一个能力** | 「这个不要了」 | 漏引用面 → 文档继续教一个不存在的东西 |

---

## 2. 各类型清单

### A. 新开一个插件

| 文件 | 改什么 |
|---|---|
| `packages/<name>/package.json` | `name` `version` `description` `license`(MIT) `author` `repository{url,directory}` `homepage` `bugs` `engines.node`(≥22.6) `engines.dsh` `type:"module"` `main` |
| 同上 `exports` | `.`（主入口）、`./package.json`、`./locale/*.json`；有设置页再加 `./client` |
| 同上 `dsh` | `bundle.patch`（指向 `./cordis.patch.yml`）、`catalog{category, summary{en,zh}, capabilities[]}`；有 client 半再加 `client:{platform:'web', inject:[...]}` |
| 同上 `files` | 必须含 `lib`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`LICENSE`、`icon.svg`、`locale`；**建议**再加 `docs`（plugin 面板详情页资源） |
| `cordis.patch.yml` | `- insert: [{ id: <name>, name: <name> }]`；只插自己，别动别人段 |
| `lib/index.js` | `export const name` / `inject`（**用到的服务必须声明**）/ `Config` / `apply`；资源注册一律 `ctx.effect(() => …)` |
| `lib/client/settings.js` | 有设置页时：注入 `plugins.bundle.config`（key = 包名），用 `ctx.configForms.get(entryId)` |
| `locale/{en,zh}.json` | `meta.title` + `meta.description`（**中英都要**）；详情页缺 `meta.detail` 时回退包 README |
| `docs/DETAIL.md`（**建议项**） | 想要带图详情页时加：`meta.detail` 指 `docs/DETAIL.md`（zh 指 `docs/DETAIL.zh.md`），文档**恰好一行** `![alt](preview.svg)`，图 `640×300` 且不含文字；规格与合规判定见 [PLUGIN-SPEC-COMPLIANCE](../03-reference/PLUGIN-SPEC-COMPLIANCE.md) |
| `icon.svg` | 矢量、≤256 KiB、含 `viewBox`；顶层 `icon` 字段优先于 `./icon` 导出 |
| `test/package-meta.test.mjs` | 锁元信息完整性、exports 指向真实文件、files 清单、图标、locale、无 lockfile |
| 装到 profile | 软链 + `dependencies` + `dsh.profile.bundles` **三步**，且**包目录里建 `node_modules` 软链**指向 profile（软链挂载按真实路径解析，缺了工具不注册） |
| 市场 | 放到 `packages/` 下即被 `scripts/make-market-index.mjs` **自动扫描**；新 `category` 要先在 `CATEGORY_DECLARATIONS`（`scripts/make-market-index.mjs:43`）声明 |
| 文档 | `docs/03-reference/plugin-inventory.md` 加行；`docs/05-handover/ARCHITECTURE.md` 部件表加行；根 `README.md` 状态表 |

**验收**：`npm --prefix packages/<name> test` 全过 → `node scripts/make-market-index.mjs --repo …`（dry-run 自校验）→ `node scripts/verify-live.mjs` 15 项。

> ⚠️ 根 `npm test` 目前只聚合 `test:whale` + `test:vault`（`package.json` 的 `scripts.test`）；**新包要自己跑 `npm --prefix packages/<name> test`**，或顺手把新包加进聚合脚本。

**坑**：`.gitignore` 要用 `packages/*/node_modules`（**不带斜杠**），否则软链会被提交、GitHub Pages 构建直接失败。

---

### B. 给现有插件加一个工具

| 文件 | 改什么 |
|---|---|
| 插件 `lib/index.js` | `defineTool`：名字全局唯一（`qq_`/`voice_` 前缀）；**描述写「什么时候该用」**而不是「能做什么」 |
| `packages/dsh-qq-whale/lib/config.js` | 加进 `DEFAULT_ALLOW`（现 **25 项**），否则 `mode: hide` 下模型看不见 |
| `packages/dsh-qq-whale/test/config.test.mjs` | 断言条数与包含关系跟着改（改了必改测试） |
| 权限 | owner-only？参考 `packages/dsh-qq-voice/lib/guard.js` 的 `parseSpeaker`（解析消息头「身份:拥有者」，解析不到就**拒绝**） |
| 节流 | 烧钱类必须：每小时上限 + 冷却；**先过节流再花钱** |
| 测试 | `test/tool-contract.test.mjs`：schema 形状、缺参报错、未配置时报可读错误 |
| 文档 | `docs/03-reference/tool-surface.md` 加行（可见 ≠ 可执行要说清） |

**验收**：`curl 127.0.0.1:3080/...` 或 `cordis_inspect_query` 的 `Tool.listTools` 能看到工具；`verify-live` 不退化。

---

### C. 加一个配置项

| 步骤 | 要点 |
|---|---|
| 字段 | 加在插件 `lib/config.js` 的 `Config` |
| **要不要 `.volatile()`** | 改了要**立刻**生效 → 加；会改变结构/需重新挂载 → 不加 |
| 默认值与回落 | `readConfig` 对缺失/非法值必须回落默认（写进 `test/config.test.mjs`） |
| 密钥类 | `secretString` + `role:'secret'`；空串归一为 undefined；支持 `xxxEnv` 环境变量回落 |
| client 半 | `lib/client/settings.js` 同步加控件（否则设置页看不到） |
| locale | 有 label 就补 `locale/{en,zh}.json` |
| 测试 | 默认值、volatile 标记、非法值回落 |

**坑**：行内 YAML 写法（`config: { … }`）在逐项写回时会被插重复键写坏配置——vault 已改为**明确报错**而非硬写。

---

### D. 接一个新厂商 / 新端点

| 步骤 | 做法 |
|---|---|
| ① 端点是否存在 | **用假 key 发一次请求看状态码**：401/403 = 存在缺鉴权；404 = 根本没有这个路径；400 = 参数/型号不对但端点通 |
| ② 型号别猜 | 有 `/models` 就查（如方舟 `GET /api/v3/models` 筛 `api_supported`）；同厂商不同日期后缀可能一个存在一个 404 |
| ③ 端点能力边界 | DashScope 的 `compatible-mode/v1` **只有** chat/embeddings；生图与 TTS/ASR 必须走 `api/v1/services/…` 原生路径 |
| ④ 真机连通 | 用插件自己的代码路径（而非 curl）跑一次，确认解析器认得返回形状 |
| ⑤ 记录 | 插件 README 的「型号/端点对照表」+ `docs/05-handover/OPERATIONS.md` 对应节 |
| ⑥ 密钥 | 只进 profile（600 权限、已 gitignore），**不进仓库**；`git log -S <key>` 应为 0 |

**坑**：`400 url error` 极易被误读成 key 无效——先怀疑「端点与型号不匹配」。

---

### E. 加一个 preset 行

| 项 | 约束 |
|---|---|
| 改哪里 | `packages/dsh-qq-whale/cordis.patch.yml` 的 `preset-qq.plugins` |
| 边界 | **只加自己需要的行，绝不改写别家插件的 config**（ADR-010 / ADR-012） |
| 前置 | 该行对应的包必须已装且在 `bundles` 里，否则装配失败 |
| 测试 | `packages/dsh-qq-whale/test/preset.test.mjs` 对行清单有严格断言，改了就同步改 |
| 文档 | `docs/03-reference/preset-qq-contract.md` |

**注意**：preset **不收窄工具面**；收窄在 `lib/agent-guard.js`（guard 执行期 + 首个 pre-step 隐藏）。

---

### F. 新增敏感能力（密钥 / 外发 / 烧钱）

| 类别 | 必须有的闸 |
|---|---|
| 密钥类 | `role:'secret'` 字段；不落仓库；日志与错误消息里**不回显**；读不到时给可读中文错误而不是崩 |
| 外发类（发到 QQ、访问网络） | owner 判定（解析不到身份就拒绝）+ 目标校验（群必须在白名单）+ 可整体 `enabled:false` |
| 烧钱类（生图/TTS/打标） | 每小时上限 + 冷却秒数 + 文本/尺寸上限；**节流失败时不调用上游** |
| 通用 | 默认 **关闭**（没 key 时开着只会每次报错）；错误文案写清「去哪配」 |

**验收**：非拥有者触发被拒、超限被拒且文案含剩余额度、关闭后工具返回「未启用」而不是崩。

---

### G. 文档类变更

| 何时写 ADR | 判据：**不可逆的取舍**、**否决了明显更简单的方案**、**踩过事故后定的红线**。现 ADR 001–013 |
| 编号 | 只增不改；旧结论保留并标注被谁取代（`docs/04-explanation/decisions/README.md` 的状态列） |
| 六处同步 | `docs/README.md` 索引、`docs/05-handover/*`、`docs/03-reference/*`、包 README、根 README 状态表、`CHANGELOG.md` |
| 状态标记 | ✅现行 / ⚠️部分过期 / 🕰️已过期 / 📖未来参考 / 🚚已迁移 |
| 链接校验 | 改完自己扫一遍相对链接（临时 node 脚本放 `/tmp`，不入库），0 断链才算完 |

---

### H. 发版与上架

| 步骤 | 命令 / 文件 | 顺序为什么不能换 |
|---|---|---|
| 1 升版本 | 包 `package.json` 的 `version` + 包 `CHANGELOG.md` + 仓库 `CHANGELOG.md` | — |
| 2 提交包 | `git commit` | 索引要钉**包含该版本**的提交 |
| 3 生成索引 | `node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction --write` | 生成器把当前 HEAD 的 commit 写进 `source`，且会**自校验** + 打印 install spec |
| 4 提交索引并双推 | `GitHub_TOKEN=… CNB_TOKEN=… npm run push:all` | 索引随仓库发布才生效 |

**要点**：索引**保留历史版本**（生成器合并旧条目），用户可回退；GitHub Pages 从 `main` 根目录构建，**仓库里不能有符号链接**。

---

### I. 下线一个能力

| 面 | 要查什么 |
|---|---|
| 代码引用 | `grep -rn "<能力名>" packages/ scripts/` |
| 白名单 | 从 `packages/dsh-qq-whale/lib/config.js` 的 `DEFAULT_ALLOW` 移除 + 改 `test/config.test.mjs` 条数 |
| 文档 | `docs/03-reference/tool-surface.md`、`plugin-inventory.md`、`preset-qq-contract.md`、README 状态表 |
| 市场 | 版本升 + 重建索引（旧版本条目保留，便于回退） |
| **危险面** | 若涉及 preset id / `agentPresetCustom`：**先让用户把 `agentPresetCustom` 清空**，再卸插件，否则每条 QQ 消息回「内部错误」 |
| 标记 | 文档里标 `🕰️已过期` 或 `stale`，不要静默删除（历史结论有价值） |

### 通用坑：装到长生命周期对象上的钩子

| 症状 | 根因 | 做法 |
|---|---|---|
| 改了插件逻辑、也重载了 bundle，功能仍按旧规则跑 | 钩子（`tools.guard` / `agent/pre-step`）是装到 **agent 实例**上的，agent 长期存活且被缓存，重载插件不影响存量 agent | ① **保留 disposer**——官方 `tools.guard()` 的返回值就是移除它的 effect disposer（`dsh-tools` 源码注释原文）；② 行为要能「热改」：传 `() => readCfg().xxx` 而不要在安装时快照；③ 改完得靠**重启 DSH 或删会话重建 agent** 才能换掉存量 agent |
| 白名单新增了工具，老会话里模型看不见 / 调用被拒 | 同上，外加「首步隐藏后就解绑」等于放弃热更新 | 隐藏逻辑按**名单指纹**去重：名单没变就跳过，变了才重新 `restrict` |

自检问句：**「这个 agent 会比我这版代码活得久吗？」** 答案是「会」时，就必须留 disposer 且不假设安装即定稿。

#### 官方规范原文（照做即可，别自己发明）

`dsh-doc` → `references/practices.md` 第 8 / 19 条：

> Registrations are effects owned by a context. … A registration on another context, such as `agent.ctx`,
> **has two owners: keep its disposer in your plugin's own effect too**, so either teardown removes it.
>
> Wrap it in one `agent.ctx.effect()` and **also keep that disposer, keyed by agent, in your plugin's own effect**;
> unloading the plugin does not dispose `agent.ctx` registrations by itself.

翻成做法（**双属主 + 补装**）：

| 步骤 | 代码形态 | 为什么 |
|---|---|---|
| ① 注册 | `agent.ctx.effect(() => tools.guard(fn))` 或上面这种 `tools.guard(fn)`（其返回值本身就是 agent.ctx 的 effect disposer） | 让 guard 随 agent 释放而回收 |
| ② 留痕 | 把该 disposer 存进 `Map<agent, dispose>`，并在插件侧 `ctx.effect(() => () => disposeAll())` | 插件卸载也能撤；否则只能重启进程 |
| ③ **补装存量** | `ctx.get('agents').list().filter(isMine).forEach(install)` | 只监听 `xxx/created` 只能覆盖**之后新建**的对象；不做补装就等于「改了必须重启」 |
| ④ 幂等 | `if (disposed.has(agent)) return` | 补装与 created 事件会撞车，重复装会产生双份守卫 |

**副作用要写进 README**：既然卸载会撤守卫，那么「卸载 whale 后 QQ 会话就恢复全量工具面」——这是规范语义（谁装的谁撤），不是 bug。

---

## 3. 附录一：三个判断题

| 问 | 判据 | 结论 |
|---|---|---|
| 这个参数该做成**配置**还是**让模型决定**？ | **稳定性 / 安全 / 费用** → 配置；**表达 / 情绪 / 长度 / 这次想怎么说** → 工具参数（模型自决） | 例：`ttsVoice`/`seed`/`style` 交给模型；`maxPerHour`、`ownerOnly`、端点与 key 留配置 |
| 说明该写进**系统提示**还是**工具描述**？ | **默认工具描述**——schema 每轮随请求下发，零额外上下文，且只在相关时被读到；preset 的 `persona.prefix` 只有 **60 字**预算且是风格锚点，塞说明会污染人格 | 只有「跨所有工具都该遵守的价值观」才进系统提示 |
| 这个改动算不算**侵入式**？ | 会不会动到用户**没勾选、没同意**的数据 | 反例：整段替换 `dsh-qq-bot` 配置（会连 token 一起覆盖）；正例：vault 逐项导入，只写勾选项、其余逐字不动 |

---

## 4. 附录二：已完成能力索引（加东西前先查重）

| 插件 | 版本 | 能力 | ADR |
|---|---|---|---|
| `dsh-qq-whale` | 0.14.0 | 注册 `preset-qq`（9 行）；工具面收窄（`mode: off/guard/hide` + `allowTools` 25 项）；设置页两项 | 003 / 007 / 008 / 009 / 010 / 011 / 012 |
| `dsh-qq-vault` | 0.6.0 | 设置页逐项导出/导入（`qqbot.*` 19 项 + `voice.*` 17 项 + 人格 + 记忆）；sha256 完整性；一次性确认码；上传走 `/api` POST | — |
| `dsh-qq-voice` | 0.2.0 | `qq_voice` 工具：TTS 合成 + 自建只发不收 WS 发 `record`；音色/seed/style 由模型自决；owner + 群白名单 + 6 条/时 | 013 |

**外部依赖**：`@sputnikzaychik/dsh-qq-bot`（NapCat/OneBot 链路，入站丢 record、出站支持但无入口）、DSH 官方 STT（SenseVoice，已挂载未接）。
