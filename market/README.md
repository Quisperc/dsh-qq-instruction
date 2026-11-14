# 插件市场索引（自托管）

这个目录只放**一个东西**：`index.json` —— DSH「插件市场」读的索引文件（format 1）。

**当前状态（2026-11-14 已上线）**：

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/Quisperc/dsh-qq-instruction`（公开） |
| 索引 URL | `https://quisperc.github.io/dsh-qq-instruction/market/index.json` |
| 托管方式 | GitHub Pages（从 `main` 分支的 `/market` 目录发布） |
| 已收录 | `dsh-qq-whale 0.14.0` · `dsh-qq-vault 0.5.0` |

用户把索引 URL 加进 DSH 之后，才能在「设置 → 插件 → 发现」里搜到本仓库的两个插件：

| 插件 | 一句话 |
|---|---|
| `dsh-qq-whale` | 给 QQ 会话提供受限 Agent preset（`id: qq`）+ 工具面收窄 |
| `dsh-qq-vault` | 设置页「QQBot 备份」：**逐配置项**多选导出/导入（配置、人设、记忆） |

---

## 1. 索引长什么样（不用手写）

由脚本生成，规则由官方校验器把关：

```bash
# 预览（dry-run，只打印 + 校验，不落盘）
node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction

# 真写到 market/index.json
node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction --write
```

脚本做的事：

1. 取当前 `git rev-parse HEAD`（40 位 hex）——**索引里每个版本都钉死在 commit 上**，用户装到的就是你发布的那一刻；
2. 读 `packages/*/package.json` 的 `name` / `version` / `description` / `keywords` / `dsh.catalog` / `icon`；
3. 组装 format 1 JSON（`source: { type: 'git', url, commit, path: 'packages/x' }`）；
4. **用 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 自校验**，不通过就非零退出；
5. 打印每个插件实际装出来的 pnpm spec，方便肉眼核对。

固定参数（需要可复现时用）：

```bash
node scripts/make-market-index.mjs --repo … --commit <sha> --timestamp 1763000000 --write
```

> **仓库里那份索引是「可复现」的**：`publishTimestamp` 取的是**该 commit 的时间**（`git log -1 --format=%ct`），
> 不是生成时刻。所以用同样的 `--repo`、`--commit`、`--timestamp` 重新生成会得到**字节一致**的 `index.json`，
> 不会因为「谁什么时候跑了一次脚本」而制造无意义 diff。发版时按下面第 4 节走即可。

---

## 1.5 索引里的信息从哪来（字段来源）

| 索引字段 | 来源 | 说明 |
|---|---|---|
| `name` / `version` | `package.json` | — |
| `title` / `description` | **`locale/{en,zh}.json` 的 `meta.*`** | 与 DSH 设置页显示名同源；缺失时回退 `package.json` 的 `meta` / `description` |
| `icon` | `package.json.icon` 指向的包根文件 | 生成器把它写成**相对索引文件**的路径（例如 `../packages/dsh-qq-whale/icon.svg`） |
| `author` / `homepage` / `repository` | `author` 取 `package.json`；后两者**由 `--repo` 推导** | 不混用 `package.json` 里的旧地址，否则详情页会出现两个不同仓库 |
| `metadata.category` | 包内 `package.json` 的 `dsh.catalog.category`（whale 第 43 行 `"qq"`；vault 第 49 行 `"qq"`） | 必须在 `scripts/make-market-index.mjs` 的 `CATEGORY_DECLARATIONS` 里声明过，否则生成器直接报错 |
| `metadata.summary`（索引 description） | 包内 `dsh.catalog.summary{en,zh}`（whale 44–47 行；vault 50–53 行） | 详情页顶部那句简介；与 `locale/*.json` 的 `meta.description` **是两套文案**，前者给市场、后者给设置页 |
| `metadata.capabilities` | 包内 `dsh.catalog.capabilities`（whale 48 行起；vault 54 行起） | 仅作展示/检索标签，不参与安装决策 |
| 插件详情长文 | **包 README.md**（见 §1.6） | 不是索引字段：市场自己去包里读 |

> ⚠️ **`dsh.catalog` 是本仓库自有的扩展字段**，官方包没有它（官方用生成好的 catalog 文件 + `meta`）。
> 校验器会忽略未知字段，所以留着无害；缺失时该插件就没有分类，`summary` 回退到 `locale` 的 description。
| `versions[].source` | `--repo` + `git rev-parse HEAD` + `packages/<dir>` | 每个版本钉死到 commit |
| `versions[].engines.dsh` | `dsh.compatibility.dsh`（回退 `engines.dsh`） | 必须是 SemVer range |

> 想让某个插件在市场里**有分类**，就在 `scripts/make-market-index.mjs` 的 `CATEGORY_DECLARATIONS` 里声明这个 id，
> 再在包的 `dsh.catalog.category` 里引用它 —— 校验器会拒绝「引用未声明的 id」。


## 1.6 详情页怎么来的（改哪里能让详情页更好看）

市场详情页的长文**不来自索引**，而是 DSH 去包里读 Markdown。解析顺序（源码：`dsh-plugin-manager/lib/index.js:2099-2111`）：

| 顺序 | 读什么 | 说明 |
|---|---|---|
| 1 | 包 `locale/<语言>.json` 里 `meta.detail` 指向的 Markdown 文件 | 想用单独的长文时用它；按语言回退到英文 |
| 2 | 包里没有 `meta.detail` → **读包根 `README.md`** | **本仓库两个包都用这条** |

所以：

- **改进详情页 = 改包 README**（不需要重新生成索引，也不需要发版——但改了要 commit + push，市场读的是仓库里的版本）；
- 详情页里的**图片**由市场自己的接口代理转发（`plugin-manager` 的 detail-file 路由），相对路径以文档所在目录为基准；
- 当前两个包的 `locale/*.json` **没有** `meta.detail`，即详情页 = README。如果要给市场单独写一份「商品页」而与开发文档分开，才需要往 locale 的 `meta` 里加 `"detail": "DETAIL.md"`。

**详情页质量自查**（改 README 时对着看）：

- [ ] 开头 1–2 句说清「这是什么、解决什么问题」，**不要从「安装」开始**
- [ ] 有**一次真实用法**（用户视角的动作序列，不是 API 列表）
- [ ] 有**界面示意**（没有截图就用 ASCII 画设置页长什么样）
- [ ] 有「已知限制」小节（限制比优点更能建立信任）
- [ ] 三条安装路径都能直接复制执行

---

## 2. 怎么托管

索引就是一个静态 JSON，**任何能返回 `application/json` 的地方都行**。三条常见路径：

### 2.1 GitHub Pages（**本项目正在用**）

仓库 Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/ (root)`。
当前索引 URL 就是按这个方式来的：

```
https://quisperc.github.io/dsh-qq-instruction/market/index.json
```

图标的相对路径（`../packages/dsh-qq-whale/icon.svg`）会解析成同源的
`https://<owner>.github.io/<repo>/packages/dsh-qq-whale/icon.svg` —— Pages 服务整个仓库根，所以能拿到。
**这正是索引要求「相对引用必须同源」的原因**，换成别的托管方式时要注意这一点。

### 2.2 仓库 raw 地址（最省事，但更新有缓存）

```
https://github.com/<owner>/<repo>/raw/main/market/index.json
```

raw 的 `Content-Type` 与缓存策略由 GitHub 决定，偶尔会拿到旧内容；自己验证 `curl` 能拿到 JSON 再用。

### 2.3 自己的静态托管

把 **`market/index.json` 与 `packages/*/icon.svg` 一起**放到同一个域名下，并保证相对路径没错位。
索引里图标的解析规则：**必须解析到 https，或者与索引同源**。

---

## 3. 用户怎么加

1. 设置 → 插件 → **发现**
2. 右上角索引菜单 → 「管理索引来源」
3. 粘贴索引 URL → 添加 → 关闭
4. 「发现」里出现本仓库的插件 → 点开 → 选版本 → 安装 → 回到插件页启用

安装时 DSH 会用 `marketInstallTarget(name, version)` 组装 pnpm spec，git 源的形状是：

```
git+<url>.git#<40位commit>&path:/packages/dsh-qq-whale
```

单仓库多子包就是靠末尾的 `path:` 支持的，所以**不要把两个包拆成两个仓库**。

---

## 4. 发布新版本（每次改代码都要走）

索引是**静态快照**，不会自动跟着仓库变。流程：

1. 改代码，跑测试：`npm test`（根目录，两个包一起）+ `node scripts/verify-live.mjs`（真机 15 项）
2. 两个包的 `package.json` **升 version**，并在各自 `CHANGELOG.md` 记一条
3. commit 并推送（**记住这个 commit**——它必须包含新版本的包）
4. `node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction --write`
   —— 校验通过后 `market/index.json` 里就出现了新版本
   （想固定可复现：加 `--commit $(git rev-parse HEAD) --timestamp $(git log -1 --format=%ct)`）
5. commit 索引文件 → 推送（Pages 自动重新发布，约 1 分钟）→ 用户市场里点「更新」

> **顺序很重要：先提交包，再生成索引。** 索引里钉的是生成那一刻的 `HEAD`，
> 如果先提交索引再提交包，索引指向的 commit 里就还没有新版本代码，用户装下来是旧的。
>
> **同一个版本号不能出现两次**（校验器会拒）；升了 version 但忘了重新生成索引，用户就看不到更新。
>
> **索引保留历史版本**：生成器会读旧索引、把往期版本原样保留（同名版本以本次为准）。
> 所以发 0.15.0 之后，0.14.0 仍然可装——用户需要回滚时直接选旧版本。

---

## 5. 上架「官方目录」要准备什么

官方目录（DSH 自带的市场源）不认自托管索引，需要单独提交。准备材料：

- [x] 公开仓库（已迁到 GitHub 公开：`github.com/Quisperc/dsh-qq-instruction`，可匿名 clone）
- [ ] 每个包：`license`（MIT）+ `LICENSE` 文件、`author`、`repository`（含 `directory`）、`homepage`、`bugs`
- [ ] 每个包根有 `icon.svg`（≤256 KiB，SVG/PNG/JPEG/WebP）或 `<包名>/icon` 导出
- [ ] `engines.dsh` 是**合法 SemVer range**（现在是 `>=0.2.0-rc.2 <0.3.0`），不能写 `workspace:`
- [ ] 设置页显示名：`locale/{en,zh}.json` 的 `meta.title` / `meta.description`（中英都要）
- [ ] `dsh.catalog`（category / summary / capabilities）—— 市场详情页与分类筛选读它
- [ ] 能通过 `npm pack --dry-run`：`files` 里要有 `lib`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`LICENSE`、`icon.svg`、`locale`
- [ ] 一份 3 行以内的安装说明（官方目录详情页会拉 README）

提交前自查：

```bash
node scripts/make-market-index.mjs --repo <真实地址>     # 校验 + 打印 spec
node --check scripts/make-market-index.mjs
npm test
```

---

## 6. 常见坑

| 现象 | 原因 |
|---|---|
| 市场里图标裂开 | 图标用了相对路径但索引没和图标同源（或托管只服务了 `market/` 目录） |
| 安装报 `cannot resolve profile bundle` | 装上了但 profile 的 `dsh.profile.bundles` 没同步；市场装包不会帮你写 bundles |
| 装了却没更新 | 索引是快照，且 commit 钉死；改了代码没重新生成索引 |
| 校验报 `must be a lowercase 40-hex-digit commit SHA` | 用了短 hash 或大写 |
| 校验报 `references undeclared id` | 插件 `dsh.catalog.category` 没在 `scripts/make-market-index.mjs` 的 `CATEGORY_DECLARATIONS` 里声明 |
---

## 7. 新增一个插件要做什么（上架视角）

> 与 [`../docs/05-handover/FEATURE-CHECKLIST.md`](../docs/05-handover/FEATURE-CHECKLIST.md) 呼应：那边从「写代码」出发，这里从「让它出现在市场里」出发。

### 7.1 包本身（缺一项市场就会显示得残缺）

- [ ] `package.json`：`name` / `version` / `description` / `license`（MIT）/ `author` / `repository`（含 `directory`）/ `homepage` / `bugs` / `engines.node`
- [ ] `dsh.bundle.patch` 指向包内 `cordis.patch.yml`（否则装上也进不了组合树）
- [ ] `files` 至少含 `lib`、`cordis.patch.yml`、`README.md`、`CHANGELOG.md`、`LICENSE`、`icon.svg`、`locale`
- [ ] `icon.svg`（矢量，≤256 KiB）+ `locale/{en,zh}.json` 的 `meta.title` / `meta.description`
- [ ] `dsh.catalog`：`category`（必须在生成器的 `CATEGORY_DECLARATIONS` 里声明过）+ `summary{en,zh}` + `capabilities[]`
- [ ] `README.md` 按 §1.6 的自查表写（它是详情页）

### 7.2 进索引

- [ ] 把包放到 `packages/<包名>/` 下即可——生成器**自动扫描** `packages/`（`make-market-index.mjs:150-152`），没有手工清单要改
- [ ] 若用了新分类：先在 `CATEGORY_DECLARATIONS` 里声明（`{ title: { en, zh } }`），再在包 `dsh.catalog.category` 引用
- [ ] `node scripts/make-market-index.mjs --repo https://github.com/Quisperc/dsh-qq-instruction` 先看 dry-run 输出（会自校验 + 打印每条的 install spec）
- [ ] 加 `--write` 落盘，**然后提交索引**（顺序见 §4）

### 7.3 验收（装一次才算完成）

- [ ] 在**另一台干净机器**（或临时 profile）从市场装一次：`设置 → 插件 → 发现` 能搜到、能装、装完 `fiberPhase: active`
- [ ] 装完的设置页卡片能打开（有 client 半的插件）
- [ ] 卸载一次，确认没有残留副作用（例如 `agentPresetCustom` 指向已消失的 preset）
- [ ] 详情页在浏览器里打开看一遍：图标不裂、安装命令可复制、限制写清楚

### 7.4 常见「上架了但不好用」的原因

| 现象 | 原因 |
|---|---|
| 市场里能搜到，装完设置页没有卡片 | 只写了 host 半，缺 client 半（注入 `plugins.bundle.config`） |
| 详情页内容很单薄 | README 只有安装步骤，没有「这是什么 / 用法 / 限制」 |
| 版本显示对了但装的还是旧代码 | 索引钉的 commit 早于代码提交（顺序反了） |
| 分类为空 / 被分到奇怪的位置 | `dsh.catalog.category` 缺失或未声明 |
