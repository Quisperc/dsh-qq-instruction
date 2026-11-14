# Git 仓库 ↔ 本地 ↔ 项目资产同步

> 目的：三处存放同一份内容，**各司其职、不互相覆盖**。
>
> **一句话规则**：Git 是真源，本地是工作区，网盘是只读分发副本。

---

## 一、三处分别是什么

| 侧 | 位置 | 角色 | 特点 |
|---|---|---|---|
| **Git（真源）** | `cnb.cool/civer/dsh-qq-instruction` | **唯一权威** | 有完整历史、可回滚、可开 PR 评审 |
| 本地 / 服务器 | `/workspace/qqbot/`（或你 clone 的任何位置） | 工作区 | 能跑脚本、能实测、改完直接验证 |
| 项目资产（网盘） | 项目资产根目录 `qqbot/` | 只读副本 | 成员可见、可在线预览、方便下载 |

**优先级冲突时以 Git 为准。** 网盘那份是镜像，不是协作面——防止两边同时改导致分歧。

---

## 二、日常流程（就这三步）

```bash
# 1. 开工前先拉最新（避免覆盖别人的改动）
git pull --rebase

# 2. 改文件，然后本地验证
python3 scripts/check-conventions.py        # 规范自检，每次都跑（见 CONTRIBUTING §6.1）
python3 scripts/check-links.py              # 动过文档就跑
cd packages/dsh-qq-whale && npm test        # 动过 packages/ 就跑（15 项）
node tools/ws-check.mjs --url wss://<你的端点> --token <token>   # 脚本改动时跑

# 3. 提交 + 推送
git add -A
git commit -m "docs(how-to): 补充 xxx 步骤"
git push
```

提交信息规范见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §6（Conventional Commits）。

**改完要同步网盘时**：只在 Git 推送成功后，把变动的文件用覆盖策略传到网盘同名位置。不要反过来——网盘改了不会自动回 Git。

---

## 三、什么该进 Git，什么不该

| 内容 | Git | 网盘 | 理由 |
|---|---|---|---|
| 所有 `.md` 文档 | ✅ | ✅ | 核心交付物 |
| `tools/*.mjs`、`tools/*.py` | ✅ | ✅ | 团队复用 |
| `scripts/*.py` | ✅ | ✅ | 同上 |
| `persona/*` | ✅ | ✅ | 人格卡 |
| `samples/*.wav` | ✅ | ✅ | 音色样本，本地难重现 |
| `config/cordis.patch.example.yml` | ✅ | ✅ | 脱敏模板，可公开 |
| `config/cordis.patch.yml`（真实值） | ⚠️ 已在库 | ⚠️ 已上传 | 见下节 |
| `QQ_msg/`（含 `.dsh-meow/` 记忆库、`qq-images/`）、`sessions/` | ❌ **绝不进公开仓库** | ✅ **应该**（加密或私有备份） | 含他人聊天信息与隐私；记忆库是资产 |
| `.env`、`*.key`、`*.pem` | ❌ | ❌ | 见 `.gitignore` |

---

## 四、密钥风险与处置

`config/cordis.patch.yml` 目前包含真实值：NapCat token、BotQQ、owner QQ 号、群号。

- **Git 仓库是私有**的 → 当前可接受，且方便一键部署；
- **网盘对项目资产可见成员全部可见** → 风险更高；
- **Git 历史永久保留** → 一旦转公开，删文件也抹不掉历史。

### 转公开 / 外发之前必做

```bash
# 1. 生成脱敏模板
python3 scripts/scrub-secrets.py

# 2. 把真实配置从版本库移除（保留本地副本）
cp config/cordis.patch.yml /tmp/cordis.real.yml
git rm --cached config/cordis.patch.yml
echo "config/cordis.patch.yml" >> .gitignore

# 3. 提交并检查历史里是否还有残留
git log -S "<你的旧 token 前 8 位>" --oneline   # 有输出说明历史里仍有，需要改历史或轮换 token

# 4. 轮换 token（既然明文出现过，就当它泄露了处理）
openssl rand -hex 32
```

脱敏版字段对照：

| 真实值 | 占位符 |
|---|---|
| NapCat token | `YOUR_NAPCAT_TOKEN` |
| WSS 域名 | `your.napcat.host` |
| BotQQ | `BOT_QQ` |
| owner QQ | `YOUR_QQ` |
| 群号 | `GROUP_ID` |

---

## 五、网盘侧的已知差异

- `.gitignore` 在网盘里叫 **`gitignore`**（网盘不接受点开头的文件名），下载后 `mv gitignore .gitignore`；
- 网盘是**逐文件覆盖**，没有增量同步：改文件名或移动位置时先删旧的再传新的，否则两边各留一份；
- 网盘那份是副本，**不接受从网盘反向回写 Git**。

---

## 六、相关

- 文件该放哪个目录、文档怎么写：[`CONTRIBUTING.md`](../../CONTRIBUTING.md) §1–§2
- 加功能的完整流程：[`add-feature.md`](./add-feature.md)
- 安装部署：[`../01-tutorial/installation.md`](../01-tutorial/installation.md)
- 运维与备份：[`operate.md`](./operate.md)
