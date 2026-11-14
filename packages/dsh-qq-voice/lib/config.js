/**
 * dsh-qq-voice 的配置契约与读取。
 *
 * 两条贯穿全包的规矩：
 *   1. **全部字段 volatile**：设置页改完立刻生效，不用重载插件。所以调用方必须
 *      「每次用时现读」，不能把 readConfig 的结果缓存到模块作用域。
 *   2. **读到的值一律做类型校验、越界回落默认**：一个错字不该让插件装不上，
 *      也不该把 `undefined` 当成"关闭"或"不限"。宁可退回安全默认。
 */

import SchemaModule from '@deepseek-ai/schemastery';

// schemastery 是 CJS 包：ESM 侧只有 default 导出，直接 `import { Schema }` 拿到的是
// undefined（踩过）。这里两种形态都兼容。
const Schema = SchemaModule?.default ?? SchemaModule;

/** 三种工作模式。字符串常量集中在导出，避免各处字面量漂移。 */
export const MODES = ['off', 'manual', 'always'];
export const DEFAULT_MODE = 'manual';

/** 出厂默认值：readConfig 在字段缺失/类型不对时回落到这里。 */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: false, // 默认关：没填 key 时开着只会每次报错
  mode: DEFAULT_MODE,
  wsUrl: 'wss://qapi.civer.cn',
  accessToken: '',
  ttsBaseUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  ttsModel: 'qwen-audio-3.1-tts-flash',
  ttsVoice: '',
  apiKey: '',
  apiKeyEnv: 'DASHSCOPE_API_KEY',
  format: 'wav',
  maxChars: 300,
  maxPerHour: 6,
  cooldownSec: 10,
  ownerOnly: true,
  allowGroups: [],
  timeoutMs: 60000,
  requestTemplate: '',
  profilePath: '/data/dsh/profiles/web/cordis.patch.yml',
  idleCloseMs: 120000,
});

/**
 * 只写字段。
 *
 * 为什么不写 `.default('')`：写了默认值，求值结果里「一定有这个键」，设置页会把
 * **没填过**的 key 显示成「已设置」。空串直接归一成 undefined。
 *
 * @param {string} description 设置页上的说明
 * @returns {any} schemastery 字段
 */
const secretString = (description) => Schema.transform(Schema.string(), (value) => (
  typeof value === 'string' && value.trim() === '' ? undefined : value
)).role('secret').volatile().description(description);

/** 配置契约。字段顺序即设置页里的呈现顺序。 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled).volatile()
    .description('总开关。默认关：没填 API key 时开着只会每次报错'),
  mode: Schema.string().default(DEFAULT_MODE).volatile()
    .description('off=不注册工具 / manual=模型显式调用 qq_voice 才发 / always=每次文字回复后自动附一条语音（暂未实现，等同 manual）'),
  wsUrl: Schema.string().default(DEFAULT_CONFIG.wsUrl).volatile()
    .description('NapCat 的 OneBot v11 正向 WS 地址（本插件自己连一条，只发不收）'),
  accessToken: secretString('NapCat access_token（只写字段；留空 = 不带头）'),
  ttsBaseUrl: Schema.string().default(DEFAULT_CONFIG.ttsBaseUrl).volatile()
    .description('DashScope TTS 端点。注意是原生端点，不是 compatible-mode（那里只有 chat/embeddings）'),
  ttsModel: Schema.string().default(DEFAULT_CONFIG.ttsModel).volatile()
    .description('TTS 模型 id，如 qwen-audio-3.1-tts-flash'),
  ttsVoice: Schema.string().default(DEFAULT_CONFIG.ttsVoice).volatile()
    .description('音色名（留空 = 不传，用模型默认；可选值见 DashScope 文档）'),
  apiKey: secretString('DashScope API key（只写字段；留空 = 读环境变量）'),
  apiKeyEnv: Schema.string().default(DEFAULT_CONFIG.apiKeyEnv).volatile()
    .description('API key 的环境变量名（apiKey 留空时才读它）'),
  format: Schema.string().default(DEFAULT_CONFIG.format).volatile()
    .description('期望音频格式（wav/mp3）。拿到什么就发什么，实测 WAV 可直接发'),
  maxChars: Schema.number().default(DEFAULT_CONFIG.maxChars).volatile()
    .description('单条语音最多多少字，超过截断（并如实告知模型）'),
  maxPerHour: Schema.number().default(DEFAULT_CONFIG.maxPerHour).volatile()
    .description('每小时最多发几条语音（0 = 不限）'),
  cooldownSec: Schema.number().default(DEFAULT_CONFIG.cooldownSec).volatile()
    .description('两条语音之间的最小间隔（秒）'),
  ownerOnly: Schema.boolean().default(DEFAULT_CONFIG.ownerOnly).volatile()
    .description('仅拥有者可用（从 QQ 消息头的「身份:拥有者」判断；解析不到就拒绝）'),
  allowGroups: Schema.array(Schema.string()).default(DEFAULT_CONFIG.allowGroups).volatile()
    .description('允许语音的群号；留空 = 不额外限制（但必须仍在 dsh-qq-bot 的 group.allow 里）'),
  timeoutMs: Schema.number().default(DEFAULT_CONFIG.timeoutMs).volatile()
    .description('单次「合成 + 下载 + 发送」的总超时（毫秒）'),
  requestTemplate: Schema.string().default(DEFAULT_CONFIG.requestTemplate).volatile()
    .description('可选：覆盖 TTS 请求体模板（JSON 字符串，支持 {{text}}/{{model}}/{{voice}}/{{format}}）。留空 = 用内置形状'),
  profilePath: Schema.string().default(DEFAULT_CONFIG.profilePath).volatile()
    .description('dsh-qq-bot 的配置所在文件（只读，用于校验群白名单与拥有者名单）'),
  idleCloseMs: Schema.number().default(DEFAULT_CONFIG.idleCloseMs).volatile()
    .description('WS 空闲多久自动断开（毫秒，0 = 不自动断）'),
});

/** cosmokit 的 volatile 引用标记（跨模块共享 symbol）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** @param {unknown} value */
const isVolatileRef = (value) => typeof value === 'object' && value !== null && VOLATILE_WRITE in value;

/**
 * 把（可能含 volatile 引用的）已解析配置还原成普通对象。
 *
 * volatile 字段运行时是**引用对象**（`.get()` 才是当前值），直接读拿到的是引用。
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
 * @param {unknown} value
 * @param {number} fallback
 * @param {{min?: number, max?: number}} [range]
 * @returns {number}
 */
function num(value, fallback, range = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const min = range.min ?? Number.NEGATIVE_INFINITY;
  const max = range.max ?? Number.POSITIVE_INFINITY;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** @param {unknown} value @param {string} fallback @returns {string} */
const str = (value, fallback) => (typeof value === 'string' ? value : fallback);

/** @param {unknown} value @param {boolean} fallback @returns {boolean} */
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/**
 * 读出**当前**配置（每次调用一次，天然拿到热改后的值）。
 *
 * @param {unknown} rawConfig 插件收到的原始配置（volatile 字段可能是引用）
 * @returns {typeof DEFAULT_CONFIG}
 */
export function readConfig(rawConfig) {
  const plain = plainConfig(rawConfig) ?? {};
  const groups = Array.isArray(plain.allowGroups)
    ? plain.allowGroups.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())
    : DEFAULT_CONFIG.allowGroups;

  return {
    enabled: bool(plain.enabled, DEFAULT_CONFIG.enabled),
    mode: MODES.includes(plain.mode) ? plain.mode : DEFAULT_CONFIG.mode,
    wsUrl: str(plain.wsUrl, DEFAULT_CONFIG.wsUrl),
    accessToken: str(plain.accessToken, DEFAULT_CONFIG.accessToken),
    ttsBaseUrl: str(plain.ttsBaseUrl, DEFAULT_CONFIG.ttsBaseUrl),
    ttsModel: str(plain.ttsModel, DEFAULT_CONFIG.ttsModel),
    ttsVoice: str(plain.ttsVoice, DEFAULT_CONFIG.ttsVoice),
    apiKey: str(plain.apiKey, DEFAULT_CONFIG.apiKey),
    apiKeyEnv: str(plain.apiKeyEnv, DEFAULT_CONFIG.apiKeyEnv),
    format: str(plain.format, DEFAULT_CONFIG.format),
    // 下限 1：0 字的语音没有意义，配置写 0 时按默认走
    maxChars: Math.max(1, Math.floor(num(plain.maxChars, DEFAULT_CONFIG.maxChars, { min: 1, max: 5000 }))),
    // 0 在这里有语义（不限），所以单独处理，不能和 maxChars 共用下限
    maxPerHour: Math.max(0, Math.floor(num(plain.maxPerHour, DEFAULT_CONFIG.maxPerHour, { min: 0, max: 1000 }))),
    cooldownSec: Math.max(0, num(plain.cooldownSec, DEFAULT_CONFIG.cooldownSec, { min: 0, max: 3600 })),
    ownerOnly: bool(plain.ownerOnly, DEFAULT_CONFIG.ownerOnly),
    allowGroups: groups,
    timeoutMs: Math.max(1000, Math.floor(num(plain.timeoutMs, DEFAULT_CONFIG.timeoutMs, { min: 1000, max: 600000 }))),
    requestTemplate: str(plain.requestTemplate, DEFAULT_CONFIG.requestTemplate),
    profilePath: str(plain.profilePath, DEFAULT_CONFIG.profilePath),
    idleCloseMs: Math.max(0, Math.floor(num(plain.idleCloseMs, DEFAULT_CONFIG.idleCloseMs, { min: 0, max: 3600000 }))),
  };
}

/**
 * 工具是否应该被注册。
 *
 * `enabled=false` 或 `mode=off` 时**不注册工具**：模型看不见它，也就不会浪费一次
 * 调用去撞"未启用"。这比注册后每次返回错误更省 token、也更少困惑。
 *
 * @param {ReturnType<typeof readConfig>} cfg
 * @returns {boolean}
 */
export function toolsEnabled(cfg) {
  return cfg.enabled === true && cfg.mode !== 'off';
}

/**
 * 取有效的 API key：显式字段优先，其次环境变量。
 *
 * @param {ReturnType<typeof readConfig>} cfg
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function resolveApiKey(cfg, env = process.env) {
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim() !== '') return cfg.apiKey.trim();
  const name = typeof cfg.apiKeyEnv === 'string' ? cfg.apiKeyEnv.trim() : '';
  if (name === '') return '';
  const fromEnv = env[name];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}
