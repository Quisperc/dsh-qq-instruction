# ADR 索引（架构决策记录）

> **ADR 只增不改。** 每篇正文保持写下时的原貌，后续变化用「被谁修订/取代」表达，不回头改历史。
> 本文是导航：一句话结论 + 当前状态。**读 ADR 时先看状态**，别把已被取代的方案当成现行设计。

| 编号 | 一句话 | 状态 |
|---|---|---|
| [ADR-001](./ADR-001-adopt-dsh-qq-bot.md) | 采用社区插件 `dsh-qq-bot` 接 OneBot，不自研桥接层 | ✅ 有效（现行架构基石） |
| [ADR-002](./ADR-002-tts-realtime-websocket.md) | TTS 走实时 WebSocket，不走 HTTP 接口 | 📖 有效但**未实施**：qq-bot v0.14.0 无 TTS 实现，本文是选型结论 |
| [ADR-003](./ADR-003-whale-plugin.md) | 把人格/配置做成独立插件，而不是继续堆 YAML | ⚠️ **部分被修订**：方向成立，但「DSH 会自动渲染表单因此不必写 client 半」被 ADR-004 证伪 |
| [ADR-004](./ADR-004-client-half-required.md) | 插件配置区必须由 client 半注入 slot `plugins.bundle.config` | ✅ 有效（2026-11-14 真机再次验证） |
| [ADR-005](./ADR-005-soul-md-evaluation.md) | 不采用 `dsh-soul-md`，记忆改用 `meow-memory` | ✅ 有效（现行记忆体系） |
| [ADR-006](./ADR-006-persona-vs-agent-preset.md) | 人格走 `persona.*`，preset 只管「挂哪些插件」 | ✅ 有效 |
| [ADR-007](./ADR-007-whale-scope.md) | whale 降级为「内容 + 生成器」，不装为插件 | ❌ **已被 ADR-008 取代** |
| [ADR-008](./ADR-008-whale-as-preset-provider.md) | whale 改做「preset 提供者」 | ⚠️ **被 ADR-009、ADR-012 修订**：结论方向对，`plugins: []` 的语义写错了 |
| [ADR-009](./ADR-009-preset-plugins-no-inherit.md) | `plugins: []` 不是继承默认，是「什么都没有」 | ✅ 有效（决定必须显式裁剪） |
| [ADR-010](./ADR-010-restricted-preset-for-qq.md) | QQ 场景用受限 preset，从标准 22 行**裁剪**而非照抄 | ✅ 有效（`preset-qq` 即此产物） |
| [ADR-011](./ADR-011-host-provide-and-activation-tests.md) | host 半必须 `ctx.provide` 注册服务；「能激活」要进测试 | ✅ 有效 |
| [ADR-012](./ADR-012-whale-preset-only.md) | whale 收窄为「只提供 preset」，删掉人格配置面/设置页/导出 | ⚠️ **被 v0.11+ 扩展**：现在除了 preset，还负责**工具收窄**（guard/restrict）与**设置页配置**（现为两项：`mode` / `allowTools`）；「不碰别人配置」「不改人格」这两条边界仍有效 |

---

## 读 ADR 的两个提醒

1. **过期结论仍留着是故意的**：ADR-007 被取代、ADR-003 的自动渲染论断被推翻，正文都没改——它们的价值在于「为什么当时会这么判断、后来怎么被证伪」。要现行结论，看状态列。
2. **ADR 不是操作手册**：怎么改配置、怎么验证、怎么回滚，一律看 [`../../05-handover/OPERATIONS.md`](../../05-handover/OPERATIONS.md)。

## 还缺的 ADR（已知）

- **未记录**：`dsh-qq-vault` 的诞生决策（为什么单独一个插件而不是并进 whale）。
- **未记录**：工具收窄为什么从 `restrict` 改成 guard 优先 + 首个 pre-step 隐藏（2026-11-14 的缩表事故）。
- **未记录**：平台限制（webserver 仅 GET/HEAD、`inject` 必须声明服务）——目前只写在 `05-handover/OPERATIONS.md` §7。

需要时再补，不必为了凑数造 ADR。
