# ADR-004：插件的配置区必须由 client 半注入（修订 ADR-003 的错误论断）

- **状态**：已接受
- **日期**：2026-11-01
- **触发**：ADR-003 中"DSH 会根据 `Config` 自动渲染通用表单"这一论断被证伪，且据此做的取舍导致了 P0 事故

## 一、ADR-003 错在哪

ADR-003 写了两句相互矛盾的话，其中第二句是**推断而非源码证据**：

| 论断 | 来源 | 结论 |
|---|---|---|
| 插件导出 `Config`，DSH 把它当作设置表单的来源，改动写回 `cordis.patch.yml` | `dsh-qq-bot/lib/gateway/plugin.js` 头注释 | ✅ 成立 |
| 插件详情页的配置区由 DSH 通用机制自动渲染，因此**可以不写 client 半** | **我的推断** | ❌ **证伪** |

真相（源码事实）：

- 那块配置区是 slot **`plugins.bundle.config`**；
- 往里注入内容的是**插件自己的 client 半**：
  ```js
  ctx.slots.inject('plugins.bundle.config', function () {
    return ctx.slots.register({ name: 'plugins.bundle.config', key: PKG_NAME, inject: ... }, QQBotSection);
  });
  ```
- 管理页只是把 `configForms.get(id)` 交给页面，**真正的填充靠 slot**；
- 因此 **v0.1 没有 client 半 ⇒ 配置区是空的**，"专属分区"这个核心需求并未实现。

## 二、由此引发的 P0 事故

ADR-003 虽然否决了"手写 client"，但 `package.json` 里仍保留了从上游照抄的两处声明：

```json
"exports": { "./client": { "default": "./lib/client/settings.js" } },
"dsh":     { "client": { "platform": "web", "inject": ["..."] } }
```

而 `lib/client/` 目录从未创建。后果链：

```
dsh.client 声明 → 解析 exports["./client"] → 文件不存在（ENOENT）
  → MissingClientBundleError
  → 聚合为 ClientPackageCompositionError（dsh-client-modules/lib/index.js:562）
  → 整个客户端模块图 compose 失败 → Web GUI boot 注入拿不到 → 最坏白屏
```

**这不是"某个插件不显示"，是全站级故障。**

已处理：提交 `7e4ffb4` 移除两处声明止血。

教训（写给下一个读这份仓库的人）：
> **声明与文件必须同生共死。** 从上游 package.json 照抄字段时，
> 每抄一个字段都要问"它指向的文件存在吗"。`exports` 里的路径不是注释，是契约。

## 三、修订后的决策

**要做 client 半**，并且它承担两件事：

1. 注入 `plugins.bundle.config`，让「大肥鱼」配置区真正出现；
2. 显示**依赖目录**：本方案需要哪些插件、哪些已装、哪些缺失、缺失的给出安装命令。

### 为什么必须自己写，没有更薄的路

| 方案 | 结论 |
|---|---|
| 只导出 `Config`，等通用渲染 | ❌ 已证伪：没有这样的实现 |
| 复用 `dsh-qq-bot` 的配置区（把字段塞进它的 `-set.json`） | ❌ 那些 JSON 在它的包内，改了升级就丢；且要 fork 上游 |
| 自己写 client 半 | ✅ 唯一可行。契约明确（`__ModuleLoader__` + `slots.inject`），风险可控 |

### 风险控制：client 必须"永不抛出"

无法在沙箱内验证客户端运行时，因此 client 半必须满足：

1. **compose 阶段**：注册动作整体包在 try/catch 里，注册失败就什么都不注册（不阻断其它插件）；
2. **渲染阶段**：组件内部再包一层 try/catch，异常时渲染一张"这块暂时不可用"的卡片，而不是让 React 树崩掉；
3. **API 探测**：`remote.pluginManager` / `remote.settings` 都按 "ctx.get('…') → ctx['…'] → ctx.remote.…" 三级回退取，
   取不到就降级为"只显示静态说明"，绝不假设 API 一定存在。

这三条是**硬要求**，不是"尽量"。原因见第二节：客户端的失败会放大成全站故障。

## 四、对 ADR-003 的其余部分的影响

- ADR-003 的**决策本身仍然成立**：做独立插件、结构化 + 全文双轨、UI 为真源 + YAML 进 Git；
- 被推翻的只有"v0.1 不做 client"这一条范围裁剪；
- ADR-003 中"已知限制"里关于"设置页实际渲染效果未验证"的描述，应改为
  "**配置区依赖自建 client，未真机验证前不可用**"。
