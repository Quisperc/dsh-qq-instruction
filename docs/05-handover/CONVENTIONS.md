# 开发规范（CONVENTIONS）

> 适用：`github.com/Quisperc/dsh-qq-instruction`（公开）及其本机工作副本 · 插件范本 `packages/dsh-qq-whale`（v0.14.0）
> 最后核对：2026-11-14 · 与仓库根 `CONTRIBUTING.md` 冲突时，以仓库为准并在本节记录差异
> 读者：下一个改这个仓库的 Agent。**改任何东西之前先读第 1、2 节。**

---

## 1. 真源与同步流程

**唯一真源**：`github.com/Quisperc/dsh-qq-instruction`（**已公开，clone 不需要令牌**）。
**本机工作副本**：`/data/dsh/home/QQBotV2/dsh-qq-instruction`（软链安装的插件就指向这里，改文件 = 改线上）。

### 1.1 标准顺序（每次改动都走这条）

| # | 动作 | 命令 / 说明 |
|---|---|---|
| 1 | 拉取 | `git -C <工作副本> fetch origin main` |
| 2 | 读 diff | `git diff --stat <旧HEAD> FETCH_HEAD`，再 `git diff <旧HEAD> FETCH_HEAD -- <关键文件>` |
| 3 | 对齐 | `git reset --hard FETCH_HEAD`（**先做第 2 节检查**） |
| 4 | 改 | 在工作副本里改；改插件包 = 改线上（软链自动跟随） |
| 5 | 测试 | 见第 4 节，必须跑 |
| 6 | 提交 | 本地 `git commit`（本机无全局身份，见 2.3） |
| 7 | 生效 | `plugin_manager set_bundle` 关→开；需要冷启动验证才重启容器 |
| 8 | 验证 | `cd /tmp && dsh --profile web --dump-config > /dev/null; echo $?` → `0` |
| 9 | 推送 | `git push origin main`（公开仓库，无需凭据；历史若被重写过需 `--force-with-lease`） |

### 1.2 分支与提交

- 分支：`main` 为真源；实验性改动先开分支（如 `feat/whale-slim`），合并回 `main`。
- 提交信息：`<type>(<scope>): <中文摘要>`，type 取 `feat|fix|docs|refactor|chore|test`。
- **一次提交只做一件事**；破坏性改动在标题里写明 `(破坏性)` 或 `fix(P0)`。

---

## 2. 同步前的强制检查

### 2.1 先看 `git status`

```bash
cd /data/dsh/home/QQBotV2/dsh-qq-instruction && git status --short
```

- 有 dirty **不代表是你的**：这台机器的同一个工作区可能被别的窗口（或用户本人）改过。
- **禁止**直接 `git reset --hard` 覆盖——会静默丢掉别人的未提交内容。

### 2.2 正确的“清场”方式

```bash
# 方式 A：先 stash（可恢复）
git stash push -m "local edit before sync @$(date +%F)" -- <文件>

# 方式 B：先复制到持久目录（保险）
cp -a <文件> /data/dsh/home/QQBot2-backup-$(date +%m%d%H%M%S).md
```

清场后再 `git reset --hard FETCH_HEAD`。收尾时确认 stash 里有东西没处理：

```bash
git stash list
```

### 2.3 本机没有 git 身份

`git config user.name` / `user.email` 都是空的，直接 `git commit` 会失败或用错身份。用一次性覆盖：

```bash
git -c user.name="QQBot Agent" -c user.email="agent@local" commit -am "feat(whale): …"
```

> 曾经的上游提交作者是 `WorkBuddy <workbuddy@agent.local>`；沿用哪个身份由你决定，但**不要**把身份写进仓库配置文件。

### 2.4 其它前置检查

| 检查 | 为什么 |
|---|---|
| `cd /tmp && dsh --profile web --dump-config; echo $?` 是否为 0 | 基线坏了先修基线，别叠加改动 |
| 是否在 `/tmp` 里做持久工作 | 容器重启清空 `/tmp`，克隆/产物一律放 `/data/dsh/home` |
| 是否要动 `profiles/web/cordis.patch.yml` | 先 `cp -a` 一份 `.bak-<时间戳>` |

---

## 3. 插件开发约定（范本：`packages/dsh-qq-whale`）

### 3.1 包清单

```jsonc
{
  "name": "dsh-qq-whale",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./package.json": "./package.json",
    "./agent-guard": "./lib/agent-guard.js"   // 子路径导出 = 可被单独 import / 挂成独立行
  },
  "dsh": {
    "runtime": "host",
    "bundle": { "patch": "./cordis.patch.yml" },   // ★ 自带插入行：装上即注入
    "compatibility": { "dsh": ">=0.2.0-rc.2 <0.3.0" }
  },
  "meta": {                                        // ★ 决定插件页显示名与描述
    "title": "QQ 群聊受限预设（preset-qq）",
    "description": "装上即在 profile 组合树里多一张 preset-qq；…"
  }
}
```

- `dsh.bundle.patch` 指向包内补丁：里面用 `- insert:` 插入自己的条目（以及它负责的 preset 行）。
- **`meta.title` 是插件页显示的文字**，列表里按它搜索；按包名搜不到，写文档时要说清。
- `files` 必须包含 `lib`、`cordis.patch.yml`、`README.md`；漏了会在打包后缺文件。

### 3.2 宿主半（host）契约

```js
export const name = 'dsh-qq-whale';
export const inject = [];              // 需要什么服务就列什么，如 ['tools']
export function apply(ctx, rawConfig) { /* … */ }
```

- **需要对外提供服务时，先 `ctx.provide()` 再赋值**：

```js
ctx.provide('whale', api);   // ✅
ctx.whale = api;             // ❌ Error: cannot set property "whale" without provide
```

- 取其它服务一律走 `ctx.get('tools')` 并在 `try/catch` 里退让（0.2 起直接点属性可能抛）。
- `apply` 里所有“可能失败但不应影响主流程”的动作都要 `try/catch` + `logger.warn`：**宁可不提供能力，也不能让会话建不起来**。

### 3.3 client 半（若声明了）

- `package.json` 里 `dsh.client.platform = "web"` + `exports["./client"]` 指向**真实存在**的文件。
- 文件格式：`window.__ModuleLoader__.load({ id, factory: (require) => module.exports })`，**`id` 必须等于包名**（否则 `loaded without registering`，该插件客户端整块失败）。
- 只有 `react` 是外部依赖；注册与渲染都要 `try/catch`——客户端 compose 失败会放大成**全站白屏**。
- 装的是“诊断探针”就先别声明 client；声明了就必须有文件。

### 3.4 preset 行（本仓库的核心手法）

`preset-qq` 是官方 `@deepseek-ai/dsh-agent-preset` 的一行配置，`plugins` 列表里每个 `- id/name` 都是挂进 agent scope 的插件行：

```yaml
- id: preset-qq
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: qq
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config: { prefix: '你不是助手也不是工具，是群里一起聊天的家伙。' }
      - id: my-plugin/feature
        name: 'my-plugin/feature'    # 子路径导出当插件行用
```

- **preset 只决定“挂哪些插件”，不收窄全局工具**；要收窄必须有一行调 `ctx.tools.restrict({allow|deny})`（见第 6 节）。
- 行 id 是配置键：**改包名不改 id**，老配置才不会失效。
- `plugins: []` 不等于“继承默认”——本机 `preset-standard` 是显式列出二十多行的（0.2.2-rc.3 上实测 23 行，随版本变），空列表等于什么都没有。

### 3.5 配置 schema

- 要出设置页：**导出 `Config`（schemastery）+ 写 client 半注入 slot `plugins.bundle.config`**。
  两者缺一不可——只导出 Config 在运行时能看到 `status: schema`，但页面上什么都不会出现（ADR-004，2026-11-14 又踩了一次）。
- 常用字段加 `.volatile()` 才能热改；密钥类加 `.role('secret')`。
- 出厂默认值写在代码里，**不要**写进包内 `cordis.patch.yml`（升级会覆盖）。

---

## 4. 测试规范

```bash
cd /data/dsh/home/QQBotV2/dsh-qq-instruction/packages/dsh-qq-whale
for t in test/*.mjs; do node --test "$t"; done
```

约定：

- 文件名 `*.test.mjs`，放包的 `test/` 下；基线（2026-11-14 实跑，whale v0.14.0）：`activate` 5 + `agent-guard` 13 + `client-contract` 10 + `config` 13 + `package-meta` 8 + `preset` 10 = 59 通过；新增测试同样必须全绿，以实际运行为准。
- **改动必须新增或更新契约测试**；只改文档可豁免。
- 测“激活态”要用**复刻宿主守卫的假 ctx**（见 `test/activate.test.mjs`），纯函数测试测不到 `provide` / `restrict` 这类宿主契约。
- 沙箱里跑测试前，先给包目录建依赖软链（Node ESM **不认** `NODE_PATH`）：

```bash
mkdir -p node_modules/@deepseek-ai
ln -sfn /data/dsh/profiles/web/node_modules/@deepseek-ai/schemastery node_modules/@deepseek-ai/schemastery
ln -sfn /data/dsh/profiles/web/node_modules/js-yaml node_modules/js-yaml
```

缺依赖会报 `ERR_MODULE_NOT_FOUND`。

---

## 5. CHANGELOG 与版本

- **双轨版本**：项目本体（`CHANGELOG.md`，如 `1.15.0`）+ 插件包（`package.json` 的 `version`，如 `0.8.0`）。
- 每次改动都要记一笔，格式：

```markdown
## [1.15.0] - 2026-11-14（插件 v0.8.0）

> 一句话说清这版做了什么；**回滚方法**写在这里。

### Added / Changed / Fixed
- 具体改动 + 依据（文件:行 或 实测结论）
```

- 破坏性改动单开 `### Changed（破坏性：…）`，并写清“回滚后哪些数据会丢/不会丢”。

---

## 6. 已知坑清单

| # | 坑 | 依据 / 处理 |
|---|---|---|
| 1 | **preset 不收窄全局工具**：工具可见性 = 全局 + 祖先 scope − restrict | `dsh-tools/lib/index.js:427-479`；收窄唯一手段是 `tools.restrict()`（`:456`）。收窄前实测：QQ 会话头里 82 个工具，含 bash/terminal_*/subagent/workflow（该数字随版本变化，判断标准是“名单里有没有这些名字”） |
| 2 | **`restrict` 遇到未知工具名会抛错**，会把整个会话建不起来 | `dsh-tools` 的 `restrict()` 先校验 `restrictableNames`，未知即 throw；实现必须先校验「白名单全部已注册」，缺一项就跳过（见 `lib/agent-guard.js` 的 `hideTools`） |
| 3 | **preset 在建会话时锁定**：跑过回合的会话沿用旧配置 | `session.v4.jsonl.zstd` 首行 `agentPreset` 在创建时写入；切换 preset 只对**新建会话**生效 |
| 4 | 容器重启**清空 `/tmp`** | 持久工作副本一律放 `/data/dsh/home` 下；曾在 `/tmp/qqinstr` 丢过一次克隆 |
| 5 | 本机**无 python3** | 仓库 `scripts/check-conventions.py`、`tools/probe-capabilities.py` 跑不了；要么本地跑，要么改写成 node |
| 6 | **pnpm 会删手工软链** | profile 的 `node_modules/@deepseek-ai/*` 是手工软链到宿主安装目录；`pnpm install/remove` 会把它们当多余包清理 → DSH 起不来。加/卸插件走「软链 + dependencies + bundles」手工流程 |
| 7 | 插件页按 `meta.title` 显示、只认 `dependencies` | 只在 bundles 里、没进 dependencies 的包在插件页不显示（过滤条件 `installed \|\| official \|\| error`） |
| 8 | `ctx.x = v` 直接赋值服务会报错 | 必须先 `ctx.provide('x', v)`；且判断插件是否真跑起来要看 `fiberPhase: active`，`status: schema` 不算 |
| 9 | 只导出 `Config` 不会生成设置页 | 配置区是 slot `plugins.bundle.config`，必须由插件自己的 client 半注入 |

---

## 7. 文档写作约定（写给人看，也写给下一个 Agent）

- 中文；命令、路径、日志保持原文；**不编造没验证过的端口/路径**。
- 每个结论尽量带「文件路径 / 命令 / 行号」，让下一个人能当场复验。
- 长内容写进文件（如本目录），回复只给摘要与路径。
- 改动完在 `CHANGELOG` 记一笔；涉及运维动作的，同步更新 `docs/05-handover/OPERATIONS.md` 对应小节。
