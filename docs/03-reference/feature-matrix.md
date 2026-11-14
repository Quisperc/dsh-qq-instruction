# 功能覆盖矩阵

> 逐项对照最初的需求，标明**现在靠什么实现**、**是不是原生**、**还差什么**。
> 目的：看清哪些根本不用做（原生已有）、哪些才是真正要自己写的。
>
> 状态：✅ 可用 · ⚠️ 部分/未启用 · ❌ 需自研 · ❓ 待确认

---

## 一、总览：14 项需求，只有 3 项真的需要自己写

| 需求 | 靠什么实现 | 类型 | 状态 |
|---|---|---|:--:|
| 识图 | `vision.*` | 原生配置 | ✅ |
| 生图 | `imageGen.*` | 原生配置 | ⚠️ |
| 权限管控 | `auth.*` + `guestToolAllow` + `flowAuth.*` | 原生配置 | ✅ |
| 回复多种消息 | 插件按扩展名分流（silk/amr → 语音，图片 → 图片） | 原生能力 | ✅ |
| 人格 | `persona.text` | 原生配置 | ✅ |
| 主动回复 | `proactive.*`（15 个字段） | 原生配置 | ⚠️ 未启用 |
| 群管理 | `admin.*` | 原生配置 | ✅ |
| 联网/抓取 | `webSearch` / `moli` / `imgSearch` | 原生配置 | ✅ |
| **TTS** | **无原生字段** | **需自研工具** | ❌ |
| **STT** | **无原生字段** | **需自研工具** | ❌ |
| **记忆（跨群人物 + 群内）** | 无原生（soul-md 无分片，见 ADR-005） | **需自研** | ❌ |
| 选择性回复 / 聚合回复 | 准入原生；入站聚合待确认 | 原生 + 待确认 | ⚠️ |
| 主动任务 | 非 proactive（那是主动发言） | 需设计 | ❌ |
| 设置页配置 | 插件自带设置页 | 原生能力 | ✅ |

**结论：14 项里 8 项是原生的，改配置就有。真正要写的是 TTS、STT、记忆三项。**

---

## 二、逐项明细

### 2.1 原生可用（改配置即可，不要写代码）

| 需求 | 字段 | 说明 |
|---|---|---|
| 人格 | `persona.enabled/name/text` | 每个新会话第一轮附一次，零额外 token。人设卡内容见 [`persona/whale.md`](../../persona/whale.md) |
| 识图 | `vision.enabled/model/maxImages` | 可指定 `qwen3-vl-plus`；`history.scopeMessages` 控制回看几条 |
| 权限 | `auth.owners`（必填，留空 fail-closed）、`guestDshTools`、`guestToolAllow` | 拥有者/管理员/访客三档 |
| 敏感操作二次确认 | `flowAuth.*` | 动态码授权，`gatedTools` 可加工具名 |
| 群管理 | `admin.manageGroups`、`admin.dryRun` | **先开 dryRun** |
| 主动发言 | `proactive.*` | 见下方"启用清单" |
| 回复长度/中间发言 | `reply.maxChars`、`reply.interim` | 长任务先说一句 |

### 2.2 原生但有坑

| 需求 | 情况 |
|---|---|
| **生图** | `imageGen.*` 走 OpenAI 兼容端点，但 **DashScope 的 `/images/generations` 实测返回空**。要么换个兼容端点，要么写薄工具走 `multimodal-generation` |
| **入站聚合**（连发多条合并成一回合） | 原生确认有的只有**出站**中间发言（`reply.interim`）。入站聚合是否有 `settleMs` 一类字段**待确认**——若没有，表现为"你连发三条它回三次" |
| **主动任务**（定时/后台执行后推回 QQ） | `proactive.*` 是"读群氛围决定接不接话"，**不是**定时任务。定时能力要看 DSH 侧有没有 cron/自动化插件 |

### 2.3 真正需要自己写（原生没有）

| 需求 | 缺口 | 形态 |
|---|---|---|
| **TTS** | 插件无任何 tts 字段 | 工具插件：注册 `qq_tts`，让 Agent 调用 DashScope 合成后落盘为 `.silk` 发送（插件按扩展名自动当语音发） |
| **STT** | 插件无 asr 字段 | 入站 `record` 处理：NapCat `get_record(out_format=wav)` → ASR → 文本进回合 |
| **记忆** | 需要群级分片 + 跨群人物，soul-md 做不到（ADR-005） | 独立记忆方案，分区键由代码强制 |

---

## 三、进度盘点

| 阶段 | 内容 | 状态 |
|---|---|---|
| **0. 链路** | WSS 握手、鉴权、收发消息 | ✅ **已实测打通** |
| **1. 人格内容** | 人设卡（大肥鱼）写成 | ✅ 就绪，待灌入 `persona.text` |
| **2. 节奏** | proactive 参数设计 | ⚠️ 配置就绪，**未启用** |
| **3. 多模态** | TTS/STT/识图/生图 | ⚠️ API 全部验证过；识图原生可用；**TTS/STT 工具未写** |
| **4. 记忆** | 四层记忆模型 + 分区 + 出口检查 | ❌ 设计完成，未实现 |
| **5. 配置界面** | 设置页 | ✅ 原生（dsh-qq-bot 自带） |

---

## 四、主动发言启用清单（原生字段，按顺序开）

```yaml
proactive:
  enabled: true
  groups: ['778916943']      # 留空 = 不启用
  dryRun: true               # ① 先只记日志，看它想说什么
  intervalMinutes: 60        # ② 多久看一次群
  minNewMessages: 6          # ③ 至少新增几条才考虑开口
  maxPerHour: 2
  maxPerDay: 8
  minGapMinutes: 15
  quietHours: ['23:00-08:00']
  maxChars: 120              # 主动发言必须短
  staleMinutes: 15           # 话题凉了就不接
  topicCooldownMinutes: 120
  interests: '好吃的、海的冷知识、朋友遇到麻烦'   # 对应人设卡里的「在乎的话题」
```

**dryRun 跑两天看日志，确认它想说的话都合适，再改 false。** 这比事后被投诉便宜得多。

---

## 五、相关

- 字段全表：[`config-schema.md`](./config-schema.md)
- 实测证据：[`capability-report.md`](./capability-report.md)
- whale 插件的定位重估：[`../04-explanation/decisions/ADR-007-whale-scope.md`](../04-explanation/decisions/ADR-007-whale-scope.md)
