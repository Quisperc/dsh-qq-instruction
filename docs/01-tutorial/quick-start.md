# 快速开始：从零到能收消息

<!-- data-doc-status -->
> ⚠️ **部分过期**：同上，新装请优先看 [`migrate.md`](./migrate.md)。

> 全程复制粘贴。每一步都有「怎么知道成功了」。

---

## 0. 前提

- 云服务器上已装 Node.js ≥ 20 和 DSH（网页版）
- NapCat 已跑起来，能提供 WSS
- 有一个 DashScope（阿里百炼）API Key

---

## 1. 放置密钥（只做一次）

```bash
# 写入 shell 配置，永久生效
echo 'export DASHSCOPE_API_KEY="你的key"' >> ~/.bashrc
echo 'export DASHSCOPE_API_KEY="你的key"' >> ~/.profile
source ~/.bashrc

# 验证
echo $DASHSCOPE_API_KEY | head -c 8   # 应输出 sk-xxxx
```

**不要**把 key 写进 `../../config/cordis.patch.yml`、人格卡、记忆文件或 Git 仓库。

### 顺手做一次能力自检

```bash
cd /path/to/qqbot
python3 ../../tools/probe-capabilities.py
```

期望输出：LLM ✅、视觉 ✅、生图 ✅、模型清单 ✅。
TTS 用另一个脚本验证（它是 WebSocket）：

```bash
node ../../tools/probe-tts.mjs --text "我才不胖呢" --voice longanlingxi --out /tmp/voice.wav
# 期望：OK audio=xxxxxB，且 /tmp/voice.wav 可播放
```

---

## 2. 安装桥接插件

```bash
# 网页版 profile 名一般是 web
dsh plugin --profile web add @sputnikzaychik/dsh-qq-bot

# 装完必须重启
dsh web   # 或你原来的启动方式
```

**怎么知道成功了**：Web UI → 插件 → 已安装，能看到 `dsh-qq-bot`。

> 如果 `dsh plugin` 不可用，说明你的 DSH 版本较旧，改用手动方式：见 `../02-how-to/operate.md` §手动安装。

---

## 3. 写配置（复制模板改 3 处）

找到你的 DSH 配置目录：

```bash
# 常见位置二选一，哪个存在用哪个
ls ~/Documents/deepseek-harness 2>/dev/null && echo "DSH_HOME=~/Documents/deepseek-harness"
ls ~/.deepseek-harness         2>/dev/null && echo "DSH_HOME=~/.deepseek-harness"
```

把 `../../config/cordis.patch.yml` 复制到 `$DSH_HOME/profiles/web/cordis.patch.yml`，然后**只改这三处**：

| 字段 | 改成 |
|---|---|
| `onebot.wsUrl` | 你的 NapCat WSS 地址，如 `wss://napcat.example.com/onebot11` |
| `onebot.accessToken` | NapCat 里设的 Token |
| `auth.owners` | 你的 QQ 号（字符串） |

模板已经按**安全默认值**写好：群聊必须 @、访客禁用内部工具、群管理默认 dryRun、主动发言默认关。

> ⚠️ 上面说的是 **npm 包内**（`dsh-qq-bot` 等）自带的配置文件，不是本仓库的 `config/cordis.patch.yml`。
> 包内的那份升级会被覆盖，永远别改。
>
> **初次安装**复制一遍就够了；**之后再改配置，两份都要改**——
> 先改仓库 `config/cordis.patch.yml`（真源），再同步到 `$DSH_HOME/profiles/web/cordis.patch.yml`，
> 然后重启。只改一边必然漂移。规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) §3.2。

---

## 4. 重启并验证连接

```bash
dsh web   # 重启
```

**怎么知道成功了**：

1. 私聊机器人发一句 `/whoami`，它应回复你的身份与权限来源。
2. 如果回「还没配置拥有者」，说明 `auth.owners` 没生效，回去检查缩进和引号。
3. 如果它完全不回，看日志：`../02-how-to/operate.md`。

---

## 5. 灌入人格

人格只有**一个入口**：`dsh-qq-bot` 的 `persona.text`。
把 [`../../persona/whale.md`](../../persona/whale.md) 的**全文**填进去
（脚本见 [`installation.md`](./installation.md) 第 3 步；Web UI：插件 → dsh-qq-bot → 人格）。

> ⚠️ **不要**再往「系统提示词」或 `AGENTS.md` 里填一遍：那会和人设卡**重复注入**两份。
> 系统提示那段由 preset 的 `persona.prefix` 占着（每轮，只有一句风格锚点）；
> 身份 / 性格 / 雷区全在人设卡里——它在会话第一轮附一次，只烧一次 token。

然后私聊它聊十句，问朋友一句：**「它说话像个人吗？」**

---

## 6. 第一周别做的事

- ❌ 别开 TTS（先把节奏调准）
- ❌ 别开主动发言（最容易扰民）
- ❌ 别拉进大群
- ❌ 别给它群管理权限（先保持 `dryRun: true`）

**节奏对了，再给它声音和眼睛。**顺序反过来会得到一个话很多、声音好听、但让人想屏蔽的东西。

---

## 7. 验证入站链路（已实测通过）

API 侧已经实测通过（能查账号、能查群），但**消息上报**要等群里真有人说话才能确认。

```bash
# 在你有 ws 依赖的目录下执行，然后 60 秒内在群里发一条消息
node ../../tools/listen.mjs --url wss://qapi.civer.cn --token YOUR_NAPCAT_TOKEN --seconds 60
```

看到 `📨 [群 778916943 / 昵称(QQ)] 消息内容` 就是通的。

**如果 60 秒后是 0 条**：在 NapCat 的网络配置里检查「上报消息类型 / 事件上报」是否开启，或确认你发的消息机器人有权限收到。

---

## 附 A：最小可用配置（直接抄这个也行）

```yaml
# 已按你的真实环境填好（实测可用）
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    protocol: onebot11
    mode: forward
    onebot:
      wsUrl: 'wss://qapi.civer.cn'
      httpUrl: ''            # 留空 = 发送动作也走同一条 WS（单连接双工）
      accessToken: 'YOUR_NAPCAT_TOKEN'
    group:
      enabled: true
      requireAt: true
      allow: ['778916943']
    private:
      enabled: true
      allow: []
    auth:
      owners: ['507678128']
      guestDshTools: false
    admin:
      enabled: true
      dryRun: true           # 先演练，确认行为后再关
    reply:
      maxChars: 1200
      interim: true
```
