# ADR-011：host 半用 `ctx.provide` 注册服务，并把「能激活」纳入测试

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：真机 toggle 重载炸出 `dsh-qq-whale: Error: cannot set property "whale" without provide`

## 一、事故

`lib/index.js` 里有一行：

```js
ctx.whale = api;   // v0.2.0 引入，直到 v0.5.0 都是它
```

Cordis 的服务守卫（`cordis/lib/index.js:702` 的 `set` trap，与 `:785` 的 `reflect.set`）
要求**先 `provide` 再赋值**；插件运行时里（`ctx.fiber.runtime` 存在）给未登记的名字赋值直接抛错。

后果：**插件从 v0.2.0 起 host 半就没激活成功过**。

### 为什么拖到现在才发现

只查了 `Config status: schema`。**schema 能渲染 ≠ 插件能激活**：
配置页读的是 schema（纯数据），不依赖 apply 是否跑成功。
只有看 fiber 激活态（toggle 重载 / `dsh plugin list` 的 phase）才暴露。

> 教训：**验证插件是否装好，必须看激活态，不能只看设置页。**

## 二、决策

### 1. 服务注册一律走 `provide`

```js
ctx.provide('whale', api);
```

拿不到 `provide` 就跳过注册并 warn——人格生成是纯函数，不依赖服务注册，降级不影响主流程。

### 2. 测试补上「能激活」这一层

契约测试跑的是纯函数，测不到运行时。新增 `test/activate.test.mjs`，两条路径：

| 路径 | 依赖 | 断言 |
|---|---|---|
| 守卫替身（Proxy 复刻 DSH 的报错文案） | 零依赖 | `apply` 不抛 + `whale` 确实经 `provide` 登记 |
| 真 Cordis（`devDependency`） | `cordis@3` | scope `isActive === true`、`hasError === false` |

替身那条还配了一条**反向断言**：先证明"未 provide 就赋值"确实会抛——
否则替身与真实守卫不一致，主断言就是假阳性。

回归验证：把代码改回 `ctx.whale = api`，5 条测试变红。

### 3. preset 的行契约从官方包核对，不靠猜

`plugins` 是 `z.array(z.any())`——**写错键不报错，只静默丢弃**。
这次直接 npm 拉包读 `Config` schema（版本 `0.2.2-alpha.2`），结论落在
`docs/03-reference/preset-qq-contract.md`，并由 `test/preset.test.mjs` 当白名单校验。

顺带核掉了三个"以为有差异"的点：

| 担心 | 实测 |
|---|---|
| `compaction` 组的 `isolate` 写法与 standard 不等价 | 写法一致且键合法（`isolate?: Dict<true\|string>`，`true` = entry 本地隔离域）；pruner 三个阈值逐字等于插件默认（8192/4096/1024），**等价于没改** |
| `persona.prefix` 与人设卡双份 | 确认会双份，但两条通道不同：prefix 进系统提示每轮都在，人设卡只在**会话第一轮**的用户消息里（`turn-runtime.js`，源码注释：零额外 token） |
| `tool-todo` 的 `allowParallelInProgress` 是我们加的 | 它是 **required**，不写这行会失败——幸好写了 |

## 三、人格双份的处理

**裁 prefix，不裁人设卡。**

- prefix 缩成一句风格锚点：`你不是助手也不是工具，是群里一起聊天的家伙。说话简短、自然、有自己的态度。`
  ——只做"反助手化"，不再自我介绍（身份/性格/雷区交给人设卡）；
- 人设卡**不动**：它只烧一次 token，裁短纯亏表达力。

一个要记住的副作用：preset 里的 `persona` 行会**遮蔽** DSH 部署级的 `persona-prefix`
（`section()` 语义：同名 scoped section 遮蔽 global）。全局人格对 QQ 会话不再生效——有意为之。

## 四、能力取舍：skill / schedule / jobs / goal / planning

逐个拉官方包看了工具面，结论是**一个都不现在加**：

| 项 | 工具面 | 结论 | 理由 |
|---|---|---|:--:|
| `tool-skill` | `skill(name)`，只加载指令文本 | ⏸ 缓 | 安全，但自带技能是「cordis 插件开发」，群里用不上；等自定义群聊技能再开 |
| `skill-filesystem` | 技能来源 provider（`includeDefaultRoots` 默认 true） | ⏸ 缓 | 会扩大技能搜索根（dshHome / agentsHome） |
| `tool-schedule` | `schedule_create/list/update/delete` | ⏸ 缓 | **唯一能真正"到点提醒"的件**（todo 只是清单，不会自己触发）。但它触发时**不走 `dsh-qq-bot.proactive` 的节流**（maxPerHour/maxPerDay/minGapMinutes），是个节流缺口：群友一句"每十分钟提醒我喝水"就能刷屏。先补节流再开 |
| `tool-jobs` | `job_list/job_output/job_kill` | ❌ | **没有启动工具**（启动在 `tool-bash`），bash 已砍 → 它没有任何任务可管 |
| `tool-goal` | `create_goal/get_goal/update_goal`，驱动自动续接多轮 | ❌ | 群友一句话就能让 Agent 连跑好几轮（`blockedAfterConsecutiveRounds` 默认 3） |
| `command-goal` | 斜杠命令 `/goal` | ❌ | 群里没人敲斜杠命令（同理 `command-compact`，保留只为与 standard 对齐） |
| `planning`（组） | plan mode，进入/退出都要人批准 | ❌ | QQ 群没有批准通道，进了就卡住 |

> 真正让大肥鱼"活"起来的不是这四个，而是**自研的 TTS/STT** 与**群级分片记忆**——
> 它们走全局工具注册（ADR-009），与 preset 无关。

## 五、代价

- `cordis` 进了 `devDependencies`（只在测试用，运行时不加载）；
- 真 Cordis 那条测试的版本（3.18）与 DSH 内嵌的（`4.0.5`）不同，只覆盖"能激活"，
  守卫细节由替身那条负责；
- `preset-qq-contract.md` 需要随 DSH 升级复查一次（官方包改字段就会漂移，测试会挡住）——
  **复查项记在仓库顶层 `TODO.md` §二**，不在本 ADR 里追踪。
