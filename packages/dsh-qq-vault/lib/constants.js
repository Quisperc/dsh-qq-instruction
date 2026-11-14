/**
 * 共享常量 —— 单独一个文件是为了避免 `items.js` 与 `bundle.js` 互相 import 形成环。
 */

/** 会写进包里的条目 id（YAML 顶格写法）。 */
export const ENTRY = {
  qqBot: '- id: dsh-qq-bot',
  whale: '- id: dsh-qq-whale',
};

export const ENTRY_IDS = [ENTRY.qqBot, ENTRY.whale];

/** item id 前缀 → 条目 id。 */
export const GROUP_ENTRY = {
  'qqbot': ENTRY.qqBot,
  'whale': ENTRY.whale,
};

/** 条目 id → item id 前缀。 */
export const ENTRY_GROUP = {
  [ENTRY.qqBot]: 'qqbot',
  [ENTRY.whale]: 'whale',
};
