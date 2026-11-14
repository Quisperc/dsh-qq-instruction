# ADR-012：`dsh-qq-whale` 收窄为「只提供 preset」（收窄 ADR-008）

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：排查「会话应用预设失败」时发现——插件 v0.6.0 挂着人格配置面、设置页、导出三套东西，
  但**没有一套在真机上真正可用**；而我们要的只是那张 preset。

## 背景

v0.6.0 的 whale 同时承担三件事。2026-11-01 逐项核对源码与 `@sputnikzaychik/dsh-qq-bot@0.12.8`
官方包后，发现三件事的落实情况：

| 承担的事 | 落实情况 |
|---|---|
| 提供 `preset-qq`（`id: qq`） | 写法正确，但**从未生效**：真机 profile 组合树里没有 `dsh-qq-whale` 条目，bundle patch 从未被合并，所以填 `agentPresetCustom: qq` 必然失败 |
| 人格配置面（32 字段设置页） | 表单能渲染、能存，但改的是 **whale 自己的配置**，不进会话；要进会话必须再跑一次 `sync-persona.mjs --write` |
| 人设卡渲染 + 导出到 Git | 导出依赖 `GET /dsh-qq-whale/preview`，而该路由**必然挂不上**：`inject = []` 且同步读 `ctx.webServer`（服务尚未 provide），注册签名也不是官方的 `register({ kind: 'exact', path, handler })` |

同时存在的结构性问题：

- **人格有四条通道**（whale 结构化字段 / whale 的 `card.text` / preset 的 `persona.prefix` / `persona.text`），
  其中两条是孤儿；
- 设置页 699 行 client 代码，按 ADR-004 的结论，compose 失败会放大成**全站白屏**；
- 面板默认值在服务端 schema 与 client 里各存一份，靠注释互相提醒同步——迟早漂移。

## 决策

1. **whale 只做 preset 的载体**：保留 `package.json` 的 `dsh.bundle.patch` 声明与包内
   `cordis.patch.yml`（`dsh-qq-whale` + `preset-qq` 两条条目）+ 一个极简 `lib/index.js`
   （只做 `ctx.provide('whale')`，暴露 `presetId`）。
2. **删除全部人格配置面**：`Config` schema、`lib/client/`（699 + 161 行）、`lib/persona.js`、
   `lib/bot-catalog.js`、`scripts/sync-persona.mjs`、preview 路由，以及对应测试。
   代码量 ~3000 → ~300 行，测试 42 → 15 项。
3. **人格回到单一真源**：`persona/whale.md` → `dsh-qq-bot.persona.text`。
   只保留两条通道：preset 的 `persona.prefix`（每轮，风格锚点）与 `persona.text`（首轮一次，全文）。
4. **preset id 固定为 `qq`**：`lib/index.js` 的 `PRESET_ID` 与 `cordis.patch.yml` 的
   `config.id` 由测试锁死一致（历史上代码里一直叫 `whale`，是「应用预设失败」的诱因之一）。
5. **preset 的生效路径固定为两步**：先装插件（`dsh plugin --profile web add dsh-qq-whale`，
   未发 npm 时按 README 的手动两处登记），再在 `dsh-qq-bot` 设置页把
   「① 自定义 agent preset id」填 `qq`——只影响新会话。
6. 人格名字统一为**大肥鱼**（此前插件默认「大肥鱼」、人设卡标题与真机 `persona.name` 是「小鲸鱼」）。

## 理由

- **preset 是配置条目，不需要宿主逻辑**。它装进来就在；插件的价值是让它能装、能卸、
  将来能进插件市场——这也是保留插件而不是把 preset 直接写进配置的原因（见「被否决的备选」）。
- **人格配置面该删，因为它改的东西不进会话**。面板 → whale 配置 →（需要一次显式同步）→ `persona.text`，
  中间多一层间接，却要维护 schema、client、两份默认值。人设卡本质是文本：改文件 + Git 更直接、
  可评审、可回滚，也更符合「Git 是真源」这条不变量。
- **复杂度本身就是风险来源**：三处「未验证」里，两处是复杂带来的（路由签名、面板同步）；
  删掉之后，剩下要验的只有 preset 本身。

## 被否决的备选

- **A：删掉整个插件，`preset-qq` 直接手写进 `config/cordis.patch.yml`**
  ——能立刻生效、不依赖插件安装。但失去「可安装 / 可卸载 / 可进插件市场」的分发形态，
  也失去 preset 随插件版本演进的载体（将来 TTS / STT 要挂进 `plugins`）。
  **否决**：保留插件作为载体，安装路径写进 README。
- **B：保留设置页，修好它**（修 preview 路由 + 补复制/下载按钮 + 补 `autoWriteTarget` 控件）
  ——界面保住了，但核心矛盾没变：面板改的配置仍需一次显式同步才进会话。
  **否决**：多一层间接，不解决孤儿问题。
- **C：只修 bug，不瘦身**
  ——42 项测试与全部复杂度都留着，三条「未验证」一条都没减少。**否决**。

## 后果

**好处**

- 代码 ~3000 → ~300 行；人格链路 4 条 → 2 条；不再有孤儿配置；client 白屏风险归零；
- preset id 有测试双向锁住，不会再出现「代码叫 whale、patch 叫 qq」；
- 排查面变窄：preset 不生效只可能是「插件没装进 profile」或「没填 `agentPresetCustom`」。

**必须接受的代价**

- **没有设置页了**：调人格 = 改 `persona/whale.md` → 填进 `persona.text`，靠 Git 做版本与回滚；
- **preset 生效依赖插件真的装进 profile**：未发 npm，现阶段要走手动登记
  （`package.json` 的 `dependencies` + `dsh.profile.bundles`），README 有步骤；
- 已装 v0.6.0 的机器升到 v0.7.0 后，profile 里残留的 `dsh-qq-whale.config.*` 会被当作未知键清理
  （人格若已填进 `persona.text` 则不受影响）——⚠️ 未真机验证。

**仍未验证（已登记进 `TODO.md`）**

| 项 | 怎么验 |
|---|---|
| `preset-qq` 能否被 DSH 正常加载 | `dsh plugin --profile web list` 看 phase + `--dump-config` 看条目 |
| 填了 `agentPresetCustom: qq` 后 `persona.text` 是否仍生效 | 群里 @ 一句看口吻 |
| 裁剪后有没有丢掉原有工具 | 让它用一次 `qq_history` |

## 对既有 ADR 的影响

- **ADR-008**（改做 preset 提供者）：结论仍成立，**状态不变**；本 ADR 只收窄它的第 2 条
  （"人设卡内容"不再由插件承载）。
- **ADR-003**（做独立人格插件）：插件保留，"人格"这半不再由它承载 → 状态改为
  `已接受（部分被 ADR-004、ADR-012 修订）`。
- **ADR-004**（必须有 client 半才有配置区）：**机制结论仍然成立**，只是本项目不再需要配置区，
  状态保持 `已接受`。
