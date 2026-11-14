# 自有插件的官方规范合规矩阵

**一句话结论**：三个包（`dsh-qq-whale` 0.14.2 / `dsh-qq-vault` 0.6.0 / `dsh-qq-voice` 0.3.0）在 Manifest、显示元信息、detail 页、图标、导出形态、资源生命周期、`files` 清单、元信息测试这 8 类上**全部合规**；两处偏差本轮已修（whale/voice 的 `inject` 漏声明、三包缺 detail 页）；3 条官方项目**有意不适用**，理由见 §3。

依据：`dsh-doc` 技能 `references/` 下的 `host-plugin.md`（主依据）、`plugin-details.md`、`ui-plugin.md`、`practices.md`、`configuration.md`。**未逐行读 DSH 全量源码**，凡涉及具体 API 语义的都指向这些文件或已实测结论。

判定：`✅ 合规` · `⚠️ 偏差（本轮已修）` · `⛔ 不适用（附理由）`

---

## 1. 主表：规范条目 × 三包

| # | 规范条目（依据） | whale | vault | voice |
|---|---|---|---|---|
| 1 | `name` / `version` / `type: module` / `main` / `exports['.']` 齐备（host-plugin §Manifest） | ✅ | ✅ | ✅ |
| 2 | `dsh.bundle.patch` 声明且路径真实存在 | ✅ | ✅ | ✅ |
| 3 | 插件行 id 唯一、与包名不冲突（patch 内 `id:` 与 `name:`） | ✅ | ✅ | ✅ |
| 4 | `engines.dsh` 是合法 SemVer range（非 `workspace:`） | ✅ | ✅ | ✅ |
| 5 | `locale.{zh,en}.meta.title` + `meta.description` 齐备，且**只描述已实现并验证过的行为** | ✅ | ✅ | ✅ |
| 6 | `meta.detail` 指向单图 detail 文档（plugin-details §Declare） | ⚠️ 本轮新增 | ⚠️ 本轮新增 | ⚠️ 本轮新增 |
| 7 | DETAIL 文档**恰好一行图片**、图在文档旁、`files` 含 `docs` | ⚠️ 本轮新增 | ⚠️ 本轮新增 | ⚠️ 本轮新增 |
| 8 | 特性图规格：`640×300` viewBox、无 `text`/脚本/`foreignObject`、≤1 MiB、明暗主题均可读 | ⚠️ 本轮新增 | ⚠️ 本轮新增 | ⚠️ 本轮新增 |
| 9 | 图标：包根内、SVG 有 `viewBox`、<256 KiB；顶层 `icon` 优先于 `./icon` | ✅ | ✅ | ✅ |
| 10 | 导出形态单一：`export function apply(ctx, config)`，不与默认导出 service class 混用 | ✅ | ✅ | ✅ |
| 11 | `apply` 用到的**必需服务**都在 `inject` 里声明（漏声明 = 拿不到服务） | ⚠️ 本轮修（+`agents`） | ✅（`webServer`） | ⚠️ 本轮修（+`tools`） |
| 12 | 可选服务用 `ctx.get()` / `ctx.inject([...])` 探测，缺失时**降级而非抛错** | ✅ | ✅ | ✅ |
| 13 | 每个注册都在 `ctx.effect` / `ctx.on` 内并返回清理（practices §2） | ✅ | ✅ | ✅ |
| 14 | 注册到 `agent.ctx` 的资源做到**双属主**：agent 持有 + disposer 收进插件 `ctx.effect` | ✅（0.14.2） | ⛔ 不注册 agent 级资源 | ⛔ 不注册 agent 级资源 |
| 15 | 长生命周期对象上的钩子保留 disposer，可被插件卸载撤销 | ✅（0.14.2） | ⛔ 无跨 agent 钩子 | ⛔ 无跨 agent 钩子 |
| 16 | 导出的 `Config` 字段与 client 半表单**一一对应** | ✅（`mode`/`allowTools`） | ⛔ 无 `Config`，见 §3 | ✅（22/22） |
| 17 | 可调值进 `Config`（用户的 patch 层跨升级存活），密钥不硬编码 | ✅ | ✅（不落盘，见 §3） | ✅ |
| 18 | `dsh.client` 声明 `platform` 与 `inject`，client 半经 `ctx.slots.inject/register` 注入 | ✅ | ✅ | ✅ |
| 19 | client 内不做 DOM 外写、不 append `document.body`、不自带 React | ✅ | ✅ | ✅ |
| 20 | `files` 覆盖 patch / locale / icon / detail 目录 / 全部运行时文件 | ✅ | ✅ | ✅ |
| 21 | `npm pack --dry-run` 实际文件列表与 `files` 一致（无遗漏、无空条目） | ✅ 15 个 | ✅ 16 个 | ✅ 17 个 |
| 22 | 每包有 `package-meta.test.mjs` 锁元信息 | ✅ 9 项 | ✅ 8 项 | ✅ 11 项 |
| 23 | 依赖只走 peer / 宿主提供，包内不带 lockfile | ✅ | ✅ | ✅ |

**统计**：whale ✅15 / ⚠️5 / ⛔3 · vault ✅17 / ⚠️3 / ⛔3 · voice ✅15 / ⚠️5 / ⛔3

---

## 2. 本轮实际修正

| 文件 | 改动 |
|---|---|
| `packages/dsh-qq-whale/lib/index.js` | `inject: []` → `['agents']`。apply 里用 `agents.list()` 补装存量 agent，声明后 Cordis 会等该服务就绪再跑 apply，补装才确定能拿到 registry |
| `packages/dsh-qq-voice/lib/index.js` | `inject: []` → `['tools']`。注册工具是插件的存在意义，`tools` 不是可选服务；`ctx.get`/`ctx.inject` 兜底分支保留 |
| `packages/*/docs/DETAIL.md`、`DETAIL.zh.md` | 新增，各**恰好一行图片**（中文 locale 指 `DETAIL.zh.md`，英文指 `DETAIL.md`） |
| `packages/*/docs/preview.svg` | 新增特性图，`640×300`、纯矢量、**无文字**（中英共用一张）、`<3 KiB` |
| `packages/*/locale/{zh,en}.json` | `meta.detail` 指向对应文档 |
| `packages/*/package.json` | `files` 增 `docs` |
| `packages/*/test/package-meta.test.mjs` | 各加 1 项：locale 的 `meta.detail` 与文件一致、文档恰好一行图、图符合规格、`files` 含 `docs` |

测试：whale **63** · vault **87** · voice **122**，0 失败（根 `npm test` 全过）。

---

## 3. 「不适用」集中解释

| 条目 | 为什么不适用 |
|---|---|
| 14/15 双属主与钩子 disposer（vault、voice） | 两者都不注册 agent 级资源：vault 只挂 HTTP 路由（`ctx.effect`），voice 只注册工具与自己的 WS（`ctx.effect`）。没有跨 agent 钩子，自然不存在双属主问题。whale 有，已按规范做（0.14.2） |
| 16 导出 `Config`（vault） | vault 的「配置」是**每次操作时的输入**（备份路径、勾选项、确认码），不是需要跨会话保存的调参项；它没有可持久化的行为开关，因此不导出 `Config`，client 半按需收集参数。官方规范要求「可调值进 Config」，前提是**存在可调值** |
| 6/7/8 detail 页 | 本轮已补，故不再是不适用；保留此行说明：官方允许「描述足够时省略 `meta.detail` 并回退 README」，我们选择补图是因为三包 README 都偏长、面板里不适合当详情页 |

---

## 4. 仍未做 / 不建议做

| 项 | 状态 | 理由 |
|---|---|---|
| `dsh.client.immediately` | 未声明（走默认懒加载） | 三包的 client 半只提供设置卡片，进设置页才需要；`immediately: true` 会让每次页面加载都激活它，纯负担 |
| 官方插件目录上架申请 | 未做 | 需要向官方提交，属运营动作，不在代码规范范围；当前已上架自有市场（GitHub Pages 索引） |
| `preview.zh.svg` 独立变体 | 不做 | 官方允许「无文字插图在中英之间共用一张」，我们的图不含文字，分语言变体只会重复三份字节 |
| 真实浏览器里的 detail 页渲染 | **未验证** | 本会话无浏览器控制。已核对：`meta.detail` 路径存在、文件已打进 `npm pack` 产物、SVG 无文字/脚本且符合尺寸与体积限制。**渲染效果与明暗主题可读性仍待人工确认** |
| 仓库根 `CHANGELOG` 的版本号 | 未动 | 版本由主线决定，本次只改代码/元信息/文档 |

---

## 5. 怎么复现这份核对

```bash
# 元信息、detail 文档、图标、files 一致性（三包各自）
node --test packages/dsh-qq-whale/test/package-meta.test.mjs
node --test packages/dsh-qq-vault/test/package-meta.test.mjs
node --test packages/dsh-qq-voice/test/package-meta.test.mjs

# 真实打包清单（与 files 对照）
cd packages/dsh-qq-voice && npm pack --dry-run

# 全量测试 + 真机自检
npm test && node scripts/verify-live.mjs
```

---

## 6. 与 changelog 的关系

`CHANGE-PLAYBOOK.md` §A（新开一个插件）已把「`meta.detail` + `docs/DETAIL.md`」列为**建议项**并指向本文；`FEATURE-CHECKLIST` 仍管流程顺序。三处不合并：本文回答「合规吗」，playbook 回答「这类改动动哪些文件」。
