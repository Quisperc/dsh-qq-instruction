# 如何新增功能

> 这篇是你最关心的：**以后想加东西，走哪条路、改哪个文件、怎么不把自己搞死。**

---

## 一、先判断：你这个需求属于哪一类

新增功能只有**三条路**。走错路的代价是：升级时配置被覆盖、逻辑被冲掉、或者污染了公共适配层。

```text
你的需求是什么？
│
├─ 想改「它什么时候说话、说多长、对谁说」
│   └─ 路线 A：改配置（不动代码）
│
├─ 想让它会做一件新的事（查天气、查数据库、控制家里的灯）
│   └─ 路线 B：加一个 DSH 工具插件（独立包）
│
├─ 想改「它是谁」（性格、说话方式、雷区）
│   └─ 路线 C：改人格卡
│
├─ 想支持新的聊天协议 / 新的消息类型
│   └─ 路线 D：给 dsh-qq-bot 提 PR（不要自己分叉）
│
└─ 只在你这台机器上生效的私人规则
    └─ 路线 E：本地策略插件（不发布、不污染上游）
```

---

## 二、路线 A：改配置（90% 的需求走这条）

**改哪里**（两份都要，Git 那一份是真源）：

| 位置 | 角色 |
|---|---|
| `config/cordis.patch.yml`（仓库内） | **真源**，先进 Git |
| `$DSH_HOME/profiles/web/cordis.patch.yml` | 部署副本，DSH 实际读它 |

**不要改**：npm 包内的任何文件（升级会覆盖）。

**流程**：

```bash
# 1. 备份
cp ../../config/cordis.patch.yml{,.bak}

# 2. 改真源
vi ../../config/cordis.patch.yml

# 3. 同步到运行时（不做这步，改了不生效；只做这步，下次部署会被覆盖）
cp ../../config/cordis.patch.yml $DSH_HOME/profiles/web/cordis.patch.yml

# 4. 让改动生效
#    profile 配置改动：HMR 会重新组合；不放心就 set_bundle 关→开
#    插件代码改动：同样 set_bundle 关→开（或重启 dsh web 进程）

# 5. 验证：私聊发 /whoami 或对应指令
# 6. 记 CHANGELOG.md
```

> 完整检查清单见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §3.2。

**常见改法对照表**：

| 我想要 | 改哪个字段 |
|---|---|
| 群里不 @ 它也回 | `group.requireAt: false` |
| 只在指定群生效 | `group.allow: ['群号1','群号2']` |
| 让访客也能用某个工具 | `auth.guestToolAllow: ['qq_history']` |
| 群管理真正生效（不再演练） | `admin.dryRun: false` |
| 回复更长/更短 | `reply.maxChars` |
| 关掉中间发言 | `reply.interim: false` |

**原则**：能用配置解决就不要写代码。配置项会被插件自动做 schema 校验，写错会告诉你；代码写错只会静默出事。

---

## 三、路线 B：加一个新的工具插件（重点）

这是「让它会做新事情」的正路。一个工具 = 一个 npm 包 = 一个 DSH 插件。

### 3.1 工具的四个组成部分

每个工具必须回答四个问题，缺一个就不要上线：

| 组成 | 说明 | 例子 |
|---|---|---|
| **Schema** | 入参类型与约束，让模型不会乱传 | `{ city: string, unit?: 'C'|'F' }` |
| **权限** | 谁能调用 | 拥有者 / 群管理 / 所有人 |
| **副作用** | 会不会改变外部世界 | 查询类 = 无；发消息/禁言 = 有 |
| **失败行为** | 超时、报错时怎么办 | 返回可读错误，不重试风暴 |

### 3.2 最小工具骨架（可直接复制）

```js
// src/index.js  —— 一个「天气查询」工具的骨架
import { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tool-weather'
export const inject = []          // 依赖的其他服务

export function apply(ctx) {
  // 1) 注册配置 schema（注意：DSH 不会自动渲染设置面板——
  //    只导出 Config 只是让 settings 命名空间有 schema；要出 UI 必须写 client 半
  //    注入 slot `plugins.bundle.config`，见 ADR-004）
  ctx.schema?.('dsh-tool-weather', {
    apiKey: { type: 'string', default: '', description: '天气 API Key', secret: true },
    timeoutMs: { type: 'number', default: 8000 },
  })

  // 2) 注册工具：名字要带前缀，避免和别人的工具撞车
  ctx.agent?.tool?.register({
    name: 'weather_query',
    description: '查询指定城市当前天气。只在用户明确问天气时使用。',
    // 3) 参数 schema：模型只能按这个传
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如「杭州」' },
      },
      required: ['city'],
      additionalProperties: false,
    },
    // 4) 权限声明：谁可以调
    permissions: { level: 'guest' },     // guest | admin | owner
    // 5) 有副作用吗？有就必须可被审批拦截
    mutating: false,
    // 6) 真正干活
    async execute(args, ctx2) {
      const cfg = ctx2.config?.['dsh-tool-weather'] ?? {}
      const r = await fetch(`https://api.example.com/weather?city=${encodeURIComponent(args.city)}`, {
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 8000),
      })
      if (!r.ok) return { error: `天气服务返回 ${r.status}` }
      const d = await r.json()
      // 7) 返回结构化结果，别返回一大坨原始 JSON
      return { city: args.city, temp: d.temp, desc: d.desc }
    },
  })
}
```

### 3.3 上线前自检清单

- [ ] 工具名有前缀（`weather_` 而不是 `query`），不会撞车
- [ ] `parameters` 写了 `additionalProperties: false`
- [ ] 有超时（`AbortSignal.timeout`），不会挂死
- [ ] 失败时返回**人能读懂**的错误，不是堆栈
- [ ] 有副作用的工具标了 `mutating: true`
- [ ] 返回结果是精简的结构化数据，不是原始大 JSON
- [ ] 不读环境变量以外的密钥来源
- [ ] 有测试（用假数据，不依赖真实外部服务）
- [ ] **新增的模型可见工具已加进 `dsh-qq-whale` 的 `allowTools`**：QQ 会话默认 `mode: hide`，
      白名单外的工具模型**根本看不到**，加了工具却忘了登记白名单，表现就是「装了但没用」

### 3.4 安装

**公开包**（已发布到 npm）可以直接用官方安装器：

```bash
dsh plugin --profile web add dsh-tool-weather
```

**自有/私有包不要用 pnpm 安装**：本机 profile 的 `node_modules/@deepseek-ai/*` 是手工软链到宿主安装目录的，
`pnpm install/remove` 会把它们当多余包删掉，DSH 直接起不来。改为三步：

```bash
# 1) 软链进 profile
ln -sfn /path/to/dsh-tool-weather $DSH_HOME/profiles/web/node_modules/dsh-tool-weather
# 2) 在 package.json 的 dependencies 登记（否则插件页「已安装」不显示）
# 3) 在 package.json 的 dsh.profile.bundles 登记（否则不挂载）
```

参考 `scripts/install-whale.mjs`（它把这三步做全了，但只认 `dsh-qq-whale` 这个包名）。

---

## 四、路线 C：改人格卡

**改哪里**：`../../persona/whale.md`

**三条硬规则**：

1. **音色（`persona.voice`）不允许 LLM 运行时修改**。改了就是换了个人。
2. **用频率代替「偶尔」**。「偶尔用颜文字」≈「经常用颜文字」。写成「十条里最多一条」。
3. **点名禁用句式时必须给替代方案**。只说「不要套话」，它会换个同样模板的说法。

**改完后验证**：把改动前后各跑同样 20 条消息，对比输出。凭感觉改人格是玄学，对比才有效。

---

## 五、路线 D：协议层改动 → 提上游 PR

**不要自己分叉 `dsh-qq-bot`。**分叉的代价是以后每次上游更新你都要手动合并，而协议适配层恰恰是最容易出安全问题的地方。

| 你的需求 | 应该去哪 |
|---|---|
| 支持新的聊天协议（微信、Telegram） | 给 `dsh-qq-bot` 提 PR，新增 Transport Adapter |
| 新的 QQ 消息段类型 | 同上 |
| 新的群管理动作 | 同上 |
| 通用安全/审批/审计能力 | 优先提给 DSH 核心或桥接插件 |

**提 PR 前必须做**：

1. 先开 Issue 描述场景，确认 maintainer 认可方向（避免白做）
2. 用**模拟协议端**写测试，不要依赖真实 QQ
3. 配置变更要有 schema + 安全默认值（fail-closed）
4. 补 CHANGELOG，遵循 SemVer

---

## 六、路线 E：只属于你机器的规则

比如「我们公司群里禁止提竞品名」「这个群每周五要发周报提醒」。

写成**本地私有插件**，不发布、不提交上游：

```bash
mkdir -p $DSH_HOME/plugins/dsh-house-rules
# 里面放你的策略代码
dsh plugin --profile web add file:$DSH_HOME/plugins/dsh-house-rules
```

**判断标准**：这条规则离开了你的环境还有意义吗？有 → 走路线 B/D 贡献出去；没有 → 路线 E。

---

## 七、加多模态能力的正确顺序

如果你要加的是 TTS / STT / 识图 / 生图中的某一个，按这个顺序，不要跳步：

| 序 | 做什么 | 验收 |
|---|---|---|
| 1 | 先用现成脚本单独验证 API 通（TTS 用 `tools/probe-tts.mjs`；能力自检是 `tools/probe-capabilities.py`，**本机无 python3 跑不了**） | 脚本输出 OK |
| 2 | 包成工具，权限设为 `owner` | 只有你能调用 |
| 3 | 自己在私聊里调 20 次，观察失败模式 | 知道它什么时候会出错 |
| 4 | 加**代码层钳制**（长度、频率、时段） | 越界行为被拦住 |
| 5 | 才放开权限给访客/群 | 日志里没有异常 |
| 6 | 最后才接进决策契约让 LLM 自主决定 | 统计触发率是否合理 |

**关键**：第 4 步不能省。LLM 决定「用愤怒的语气」是决策，「把 `speech_rate` 钳在 0.85–1.2」是授权。前者给它，后者不给。

---

## 八、一个反直觉但很重要的经验

> **规则离生成位置越远，约束力越弱。**

把硬规则写进代码层还不够，**必须在提示词末尾再重复一遍**。实测数据显示：规则只放在 system 段时，正确跳过率从 9/9 掉到 1/6；在 user 末尾补一句短提醒后又回到 9/9。

所以每加一条硬规则，做两件事：

1. 代码层实现它（真正的拦截）
2. 提示词末尾加一句短提醒（让模型少犯错，减少拦截次数）

只做第 1 件，机器人会频繁「被拦截而沉默」，表现为反应迟钝。

---

## 九、决策速查表

| 场景 | 路线 | 改哪个文件 |
|---|---|---|
| 换个群、改白名单 | A | `../../config/cordis.patch.yml` |
| 让它能查快递 | B | 新 npm 包 + `dsh plugin add` |
| 让它说话更毒舌 | C | `../../persona/whale.md` |
| 让它支持发视频 | D | 给 `dsh-qq-bot` 提 PR |
| 加公司内部的黑话过滤 | E | `$DSH_HOME/plugins/` 下私有包 |
| 调 TTS 语气池 | C + A | `../../persona/whale.md` + `../03-reference/tts.md` |
