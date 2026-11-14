/**
 * dsh-qq-whale 的配置契约 —— 设置页表单就是这个文件。
 *
 * 只有**两个**字段：`mode`（收到什么程度）与 `allowTools`（留下哪些工具）。
 * 为什么不做成「启用 / 隐藏」两个布尔：`enabled=false` + `hideFromModel=true` 是个
 * 自相矛盾的组合（关了还要隐藏？），两个布尔能拼出 4 种状态、其中 1 种没意义。
 * 改成一个三值枚举后，面板上不会出现"配了也不生效"的组合。
 *
 * DSH 的机制（读 dsh-qq-bot@0.12.8 源码核对过）：
 *   - 插件导出 `Config`（schemastery schema），DSH 拿它当设置表单的数据源；
 *   - 标 `.volatile()` 的字段可以**热改**：写回 profile 的 `cordis.patch.yml`，
 *     不重挂插件，下一回合读到的就是新值；
 *   - 嵌套 volatile 不允许，所以这里保持扁平。
 *
 * ⚠️ import 写法：本机 `@deepseek-ai/schemastery` 是 CJS 包，ESM 命名空间里
 *   只有 default（`import { Schema }` 会拿到 undefined）。
 */

import SchemaModule from '@deepseek-ai/schemastery';

/** schemastery 的构造函数（CJS 互操作：有时在 default 上，有时是命名空间本身）。 */
const Schema = SchemaModule?.default ?? SchemaModule;

/**
 * 收窄强度。三档而不是两个布尔，见文件头。
 *
 * - `off`   ：完全不碰工具面（不装 guard、不改可见名单）；
 * - `guard` ：执行期拦截——模型仍看得见全部工具，调用时被拒并给出理由；
 * - `hide`  ：guard + 首个 pre-step 用 restrict 把名单外的工具从可见列表摘掉（默认）。
 */
export const MODES = Object.freeze(['off', 'guard', 'hide']);

/** 默认档位。默认取最严格的一档：不配就是收窄。 */
export const DEFAULT_MODE = 'hide';

/**
 * 出厂白名单：人格聊天需要的最小集（23 项）。
 *
 * 刻意**不含** `web_search` / `web_fetch`：`dsh-qq-bot` 自带的 `qq_websearch` /
 * `qq_webfetch` 是同一件事的完成版（带多引擎与代理配置）。两个等价工具同时在场，
 * 只会让模型每次联网都犹豫一下，还多占 token。
 *
 * `read_image` 必须留：识图唯一可用通路就是让 agent 打开落盘原图
 * （qq-bot 自带的「描述注入」实测空返回，见仓库 patches/ 的记录）。
 *
 * 改之前先想清楚「群友能不能借它搞事」：QQ 自有工具在插件内部还有拥有者/管理员二次鉴权，
 * 而 shell、子代理、后台任务这类根本不在名单里。
 */
export const DEFAULT_ALLOW = [
  // QQ 自有能力
  'qqbot', 'qqconfig', 'qqgroup', 'qqauth',
  'qq_history', 'qq_imgsearch', 'qq_websearch', 'qq_webfetch', 'qq_draw', 'qq_sticker', 'qq_voice',
  // 工作区读写（QQ_msg 里的记忆与临时文件依赖它们）
  'read', 'write', 'edit', 'read_image',
  // 与人交互
  'ask_user_question', 'todo_write',
  // 记忆（QQ 工作区自带独立记忆库）
  'memory_search', 'memory_read', 'memory_remember', 'memory_update',
  'memory_project', 'memory_find_similar', 'memory_dream', 'memory_home',
];

/**
 * preset 的 id —— **由包内 `cordis.patch.yml` 的条目 id 决定**，不是配置项。
 *
 * 想改名是可以的，但要同时改三处（见 README）：patch 的条目 id、preset 的 `config.id`、
 * 以及 `dsh-qq-bot` 的 `agentPresetCustom`。做成面板字段就变成"改了必然坏"的假旋钮：
 * `agentPresetCustom` 是拿字符串去 registry 查的，指不到就是每条 QQ 消息内部错误。
 */
export const PRESET_ID = 'qq';

/** 出厂默认值（readConfig 在字段缺失/类型不对时回落用）。 */
export const DEFAULT_CONFIG = Object.freeze({
  mode: DEFAULT_MODE,
  allowTools: DEFAULT_ALLOW,
});

/**
 * 配置契约。
 *
 * `mode` 用 union-of-const + `.loose()`：YAML 里写错值（比如 `mode: disable`）时
 * 回落到默认档而不是让整个条目校验失败——一个错字不该让插件装不上。
 */
export const Config = Schema.object({
  // 用 string 而不是 union-of-const：union 在 JSON Schema 投影里会退化成 anyOf:[{}]，
  // 枚举值丢失、还会带一条 loose 限制告警；合法值由 readConfig 兜（越界即回落默认）。
  mode: Schema.string().default(DEFAULT_MODE).volatile()
    .description('收窄强度，三选一：off=不限制 / guard=调用时拦（模型仍可见）/ hide=同时隐藏（默认）'),
  allowTools: Schema.array(Schema.string()).default(DEFAULT_ALLOW).volatile()
    .description('允许 QQ 会话使用的工具白名单；留空 = 不限制'),
});

/** cosmokit 的 volatile 引用标记（跨模块共享 symbol，用 Symbol.for 取同一份）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** 是否是 volatile 引用对象。 */
const isVolatileRef = (value) => typeof value === 'object' && value !== null && VOLATILE_WRITE in value;

/**
 * 把（可能含 volatile 引用的）已解析配置还原成普通对象。
 *
 * volatile 字段在运行时是**引用对象**（`.get()` 才是当前值），
 * 直接读 `config.mode` 拿到的是引用而不是字符串。
 *
 * @param {unknown} value 任意配置值
 * @returns {any} 纯普通对象 / 数组 / 标量
 */
export function plainConfig(value) {
  if (isVolatileRef(value)) {
    try {
      return plainConfig(value.get());
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) return value.map(plainConfig);
  if (value !== null && typeof value === 'object') {
    // 兜底：个别运行时把引用暴露成带 get() 的普通对象，但没有那个 symbol。
    if (typeof value.get === 'function' && !(value instanceof Map) && !(value instanceof Set)) {
      try {
        return plainConfig(value.get());
      } catch { /* 不是引用，按普通对象继续 */ }
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = plainConfig(value[key]);
    return out;
  }
  return value;
}

/**
 * 读出**当前**配置（每次事件调用一次，天然拿到热改后的值）。
 *
 * 逐字段做类型校验：缺失、类型不对、枚举外的值，一律回落出厂默认——
 * 宁可退回安全默认，也不要让 `{}` 被当成"关闭收窄"。
 *
 * @param {unknown} rawConfig 插件收到的原始配置（volatile 字段可能是引用）
 * @returns {{ mode: 'off'|'guard'|'hide', allowTools: string[] }}
 */
export function readConfig(rawConfig) {
  const plain = plainConfig(rawConfig) ?? {};
  const mode = MODES.includes(plain.mode) ? plain.mode : DEFAULT_CONFIG.mode;
  const allowTools = Array.isArray(plain.allowTools) && plain.allowTools.every((n) => typeof n === 'string')
    ? plain.allowTools
    : DEFAULT_CONFIG.allowTools;
  return { mode, allowTools };
}

/**
 * 是否真的要做收窄。
 *
 * `allowTools` 为空数组的语义是**不限制**（不是"什么都不允许"），
 * 这条语义必须由这里统一兜住，调用方不要自己判断。
 *
 * @param {{ mode: string, allowTools: string[] }} cfg readConfig 的结果
 * @returns {boolean}
 */
export function isRestrictionActive(cfg) {
  return cfg.mode !== 'off' && Array.isArray(cfg.allowTools) && cfg.allowTools.length > 0;
}

/**
 * 是否连"看不见"也要做（mode=hide）。
 * @param {{ mode: string }} cfg readConfig 的结果
 * @returns {boolean}
 */
export function wantsHide(cfg) {
  return cfg.mode === 'hide';
}
