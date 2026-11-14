# QQBot 文档索引

> 面向两类读者：**第一次接手的人**（先读 ARCHITECTURE）与**要动手改东西的人**（先读 OPERATIONS + CONVENTIONS）。
> 三份文档都在本目录，均为 2026-11-14 真机核对后写成。

| 文档 | 什么时候读 | 主要内容 |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 想搞懂「消息怎么变成回复」「每个部件是谁的」 | 一句话总览、六个角色、消息旅程 10 步、preset≠沙箱、人格两条通道、目录索引、ASCII 架构图、7 条常见误解 |
| [OPERATIONS.md](./OPERATIONS.md) | 要改配置、装插件、排障、回滚 | 环境事实表、改配置三条路、手工装插件流程、验证与回滚清单、7 类故障速查、数据与备份 |
| [CONVENTIONS.md](./CONVENTIONS.md) | 要改代码、改仓库、提交 | 真源与同步流程、同步前强制检查、插件开发约定（whale 范本）、测试规范、双轨版本、9 条已知坑 |
| [FEATURE-CHECKLIST.md](./FEATURE-CHECKLIST.md) | **要加功能、发版、上架插件** | 可勾选执行清单：动手前查重 → ADR 判据 → 放哪个包 → 测试五类坑 → 文档六处同步 → 发版三步顺序 → 配置与权限 → 收尾命令 |
| [CHANGE-PLAYBOOK.md](./CHANGE-PLAYBOOK.md) | **要加东西、先查该动哪些文件** | 按变更类型索引的处理手册（9 类）：文件级清单 + 必加测试 + 常见坑 + 验收命令；附录含配置/提示词/侵入性三个判定与已完成能力索引 |

## 一页速查（最容易搞错的三件事）

1. **preset 不是沙箱**：它只决定「挂哪些插件行」，不收窄全局注册的工具；真正收窄靠 `tools.restrict()`，
   本仓库由 `dsh-qq-whale` 的 `lib/agent-guard.js` 实现：`tools.guard()` 执行期拦截 + 首个 pre-step 的 `tools.restrict()` 隐藏。
2. **已经跑过回合的会话，preset 锁死**：`presets.select` 只接受空白会话；
   想让某个聊天换 preset，只能开新会话（或像 2026-11-14 那样做一次会话头纠正，必须备份）。
3. **人格有两条通道**：`preset-qq.persona.prefix` 进系统提示（每轮）；`dsh-qq-bot.persona.text`
   拼在首轮用户消息末尾（只一次）。不要为省 token 裁人设卡。

## 相关但不在本目录

- 文档真源仓库（含 ADR、教程、参考）：`/data/dsh/home/QQBotV2/dsh-qq-instruction`
- 重启前交接单：`/data/dsh/home/QQBotV2/HANDOVER-2026-11-14.md`
- 系统盘点与路线图：`/data/dsh/home/QQBotV2/PM-PLAN-2026-11-14.md`
