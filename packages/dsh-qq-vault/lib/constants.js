/**
 * 共享常量 —— 单独一个文件是为了避免 `items.js` 与 `bundle.js` 互相 import 形成环。
 */

/** 会写进包里的条目 id（YAML 顶格写法）。 */
export const ENTRY = {
  qqBot: '- id: dsh-qq-bot',
  whale: '- id: dsh-qq-whale',
  voice: '- id: dsh-qq-voice',
};

export const ENTRY_IDS = [ENTRY.qqBot, ENTRY.whale, ENTRY.voice];

/**
 * item id 前缀 → 条目 id。
 *
 * 前缀保持短名（`qqbot` / `whale` / `voice`），与 item id 的第一段一致：
 * `voice.apiKey` 的前缀就是 `voice`，解析时无需再查表。
 */
export const GROUP_ENTRY = {
  'qqbot': ENTRY.qqBot,
  'whale': ENTRY.whale,
  'voice': ENTRY.voice,
};

/**
 * 条目 id → item id 前缀。
 *
 * 注意：这里只给「前缀」，UI 上的分组名另有 label（见 bundle.js 的 ENTRY_LABEL）；
 * 之所以不让 group 直接等于插件包名，是因为 `item.id` 的第一段就是前缀，
 * 两处不一致会让「包里出现本机没有的 item」时的兜底分组（`item.id.split('.')[0]`）对不上。
 */
export const ENTRY_GROUP = {
  [ENTRY.qqBot]: 'qqbot',
  [ENTRY.whale]: 'whale',
  [ENTRY.voice]: 'voice',
};

/** 分组在 UI 上的显示名（`group` 字段仍然是短前缀）。 */
export const ENTRY_LABEL = {
  [ENTRY.qqBot]: 'dsh-qq-bot（QQ 机器人）',
  [ENTRY.whale]: 'dsh-qq-whale（工具面收窄）',
  [ENTRY.voice]: 'dsh-qq-voice（语音回复）',
};
