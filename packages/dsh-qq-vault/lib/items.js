/**
 * 配置项的「块级」读写 —— 逐项导出/导入的基础。
 *
 * 为什么不用 YAML 库：
 *   - `yaml`（eemeli，能保注释）只存在于 DSH 自己的 node_modules 里，插件运行时解析不到；
 *   - `js-yaml` 会把整份文档重新序列化：注释全丢、行宽与引号风格全变。
 *   用户配置里那些「为什么这么写」的注释是资产，不能因为导入一次备份就被抹掉。
 *   所以这里只做**行扫描**：按缩进与键名定位一级配置块，整块替换，其余字节原样保留。
 *
 * 块的结构（以 dsh-qq-bot 为例，缩进是实测值）：
 *   - id: dsh-qq-bot        ← 条目，顶格
 *     name: '...'           ← 缩进 2
 *     config:               ← 缩进 2（容器）
 *       onebot:             ← 缩进 4 ← 这就是一个「配置项」
 *         wsUrl: ...
 *       persona:            ← 缩进 4 ← 另一个配置项
 *         text: |
 *           ...
 *   配置项 = 容器（config:）下的**直接子键**，动态发现，不硬编码清单
 *   （qq-bot 0.14 新增了 reply.bubbleGapMinMs / sticker.* 等，写死清单必然过期）。
 */

import { ENTRY_IDS } from './constants.js';

/** 容器键名：qq-bot 与 whale 的设置都挂在 `config:` 下。 */
const CONTAINER_KEY = 'config';

/** 配置项的中文标签；未列出的键直接显示原键名（动态发现，不要求穷举）。 */
const LABELS = {
  agentPresetCustom: 'agentPresetCustom（自定义 preset id）',
  onebot: 'onebot（NapCat 连接：wsUrl / token）',
  persona: 'persona（人设卡，含生效人格文本）',
  group: 'group（群准入与 @ 要求）',
  private: 'private（私聊策略）',
  auth: 'auth（拥有者 / 管理员 / 访客工具）',
  admin: 'admin（管理指令开关）',
  reply: 'reply（回复分段与节奏）',
  session: 'session（会话与并发）',
  vision: 'vision（识图模型）',
  history: 'history（群历史注入）',
  imageGen: 'imageGen（生图）',
  proactive: 'proactive（主动发言）',
  restart: 'restart（自重启）',
  protocol: 'protocol（OneBot 协议版本）',
  mode: 'mode（工具面收窄强度）',
  allowTools: 'allowTools（QQ 会话工具白名单）',
  perChatSession: 'perChatSession（按会话隔离）',
  logAdapterFrames: 'logAdapterFrames（适配器帧日志）',
  // dsh-qq-voice（语音回复）
  enabled: 'enabled（语音总开关）',
  wsUrl: 'wsUrl（NapCat WS 地址）',
  accessToken: 'accessToken（NapCat 令牌，敏感）',
  ttsBaseUrl: 'ttsBaseUrl（TTS 端点）',
  ttsModel: 'ttsModel（TTS 型号）',
  ttsVoice: 'ttsVoice（音色 id）',
  apiKey: 'apiKey（TTS API key，敏感）',
  apiKeyEnv: 'apiKeyEnv（key 的环境变量名）',
  format: 'format（音频格式）',
  maxChars: 'maxChars（单条最多字数）',
  maxPerHour: 'maxPerHour（每小时上限）',
  cooldownSec: 'cooldownSec（两条之间的冷却秒数）',
  ownerOnly: 'ownerOnly（仅拥有者可用）',
  allowGroups: 'allowGroups（允许语音的群）',
  timeoutMs: 'timeoutMs（合成+发送总超时）',
  requestTemplate: 'requestTemplate（自定义请求体模板）',
  profilePath: 'profilePath（读策略用的配置路径）',
  idleCloseMs: 'idleCloseMs（WS 空闲断开）',
};

/**
 * 这些键名出现在块内 → 该块算敏感（token / QQ 号 / 群号 / 拥有者）。
 * 用内容判断而不是按 item id 写死：以后新增键也能自动识别。
 */
const SENSITIVE_PATTERN = /accessToken:|apiKey:|owners:|superAdmins:|allow:|token|secret/i;

/** 按行算缩进（空格数；tab 记 1）。 */
function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match === null ? 0 : match[0].length;
}

/** 空行或整行注释：计算块边界时要跳过（注释属于谁由缩进决定，这里只用来找边界）。 */
function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/**
 * 找 `- id: xxx` 条目的行区间。
 * @param {string[]} lines
 * @param {string} entryId 形如 `- id: dsh-qq-bot`
 * @returns {{ start:number, end:number } | null} end 不含
 */
export function findEntryRange(lines, entryId) {
  const start = lines.findIndex((line) => line.trimEnd() === entryId);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/**
 * 找容器（`config:`）行与它的一级子键缩进。
 * @param {string[]} lines
 * @param {{start:number,end:number}} range
 * @returns {{ containerLine:number, containerIndent:number, itemIndent:number } | null}
 */
export function findContainer(lines, range) {
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (isBlankOrComment(lines[i])) continue;
    const match = /^([ ]+)([A-Za-z_][A-Za-z0-9_.-]*):(\s*)$/.exec(lines[i]);
    if (match === null) continue;
    if (match[2] !== CONTAINER_KEY) continue;
    const containerIndent = match[1].length;
    return { containerLine: i, containerIndent, itemIndent: containerIndent + 2 };
  }
  return null;
}

/**
 * 扫出容器下的一级子键（= 可勾选的配置项）。
 *
 * 边界规则：一个 item 从它的键行开始，到**下一个同级或更外层的非空非注释行**为止。
 * 关键点：块标量（`text: |`）的内容行缩进更深，天然落在块内；空行归属于当前块
 * （否则人格卡里的空行会被切到下一项去）。
 *
 * @param {string[]} lines
 * @param {number} from 容器键行 + 1
 * @param {number} to 条目结尾
 * @param {number} itemIndent 一级子键的缩进
 * @returns {{ key:string, start:number, end:number }[]}
 */
export function scanItems(lines, from, to, itemIndent) {
  const out = [];
  let i = from;
  while (i < to) {
    const line = lines[i];
    if (isBlankOrComment(line)) { i += 1; continue; }
    const indent = indentOf(line);
    // 比一级子键更深 → 上一项的内容（不该出现在这里，防御性跳过）
    if (indent > itemIndent) { i += 1; continue; }
    // 回到容器层级或更外层 → 容器结束
    if (indent < itemIndent) break;
    const match = /^[ ]+([A-Za-z_][A-Za-z0-9_.-]*):/.exec(line);
    if (match === null) { i += 1; continue; }
    const start = i;
    let end = i + 1;
    while (end < to) {
      if (isBlankOrComment(lines[end])) { end += 1; continue; }
      if (indentOf(lines[end]) <= itemIndent) break;
      end += 1;
    }
    // 尾部的空行/注释不属于本项：留到下一轮处理，避免把下一项的注释头吃掉
    while (end > start + 1 && isBlankOrComment(lines[end - 1])) end -= 1;
    out.push({ key: match[1], start, end });
    i = end;
  }
  return out;
}

/**
 * 去掉公共缩进：块在包里以「0 缩进」保存，导入时再按目标缩进还原。
 * 这样目标机缩进略有不同也能贴进去。
 * 空行保持空（不补空格），否则块标量的排版会被改变。
 *
 * @param {string[]} blockLines
 * @param {number} indent 要剥掉的缩进
 * @returns {string}
 */
export function deindent(blockLines, indent) {
  return blockLines
    .map((line) => {
      if (line.trim() === '') return '';
      return line.length >= indent ? line.slice(indent) : line.replace(/^[ \t]+/, '');
    })
    .join('\n');
}

/**
 * 给块补缩进（deindent 的逆操作）。
 * @param {string} blockText
 * @param {number} indent
 * @returns {string[]}
 */
export function reindent(blockText, indent) {
  const pad = ' '.repeat(indent);
  return String(blockText ?? '')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `${pad}${line}`));
}

/** 键名 → 中文标签（未列出就原样返回，标注为「未识别的配置项」也能用）。 */
export function labelOf(key) {
  return LABELS[key] ?? `${key}（未登记的配置项）`;
}

/** 判断一个块是否含敏感内容。persona 单独算：人设卡是个人内容，虽然不含 token 也该私密传。 */
export function isSensitiveBlock(blockText, key) {
  if (key === 'persona') return true;
  return SENSITIVE_PATTERN.test(String(blockText ?? ''));
}

/**
 * 从 patch 全文里读出某个条目的全部配置项。
 *
 * @param {string} patchText
 * @param {string} entryId 形如 `- id: dsh-qq-bot`
 * @returns {{ ok:boolean, present:boolean, items:{key:string,block:string,bytes:number,sensitive:boolean}[], error?:string }}
 *   `present:false` 表示**这个条目段整个不存在**（例如目标机没配 whale）。
 */
export function readEntryItems(patchText, entryId) {
  const text = String(patchText ?? '');
  const lines = text.split('\n');
  const range = findEntryRange(lines, entryId);
  if (range === null) return { ok: true, present: false, items: [] };
  const container = findContainer(lines, range);
  if (container === null) return { ok: true, present: true, items: [] };

  const scanned = scanItems(lines, container.containerLine + 1, range.end, container.itemIndent);
  const items = scanned.map((entry) => {
    const blockLines = lines.slice(entry.start, entry.end);
    const block = deindent(blockLines, container.itemIndent);
    return {
      key: entry.key,
      block,
      bytes: Buffer.byteLength(`${block}\n`, 'utf8'),
      sensitive: isSensitiveBlock(block, entry.key),
    };
  });
  return { ok: true, present: true, items, itemIndent: container.itemIndent };
}

/**
 * 只取一个配置项的块文本（de-indented）。不存在返回 undefined。
 * @param {string} patchText
 * @param {string} entryId
 * @param {string} key
 */
export function readItemBlock(patchText, entryId, key) {
  const result = readEntryItems(patchText, entryId);
  if (result.ok !== true) return undefined;
  return result.items.find((item) => item.key === key)?.block;
}

/**
 * 把某个配置项替换成新块（**只动这一项**，其余字节不变）。
 *
 * 三种情形：
 *   1. 目标已有该键 → 原地整块替换；
 *   2. 目标有容器但没有该键 → 插到容器末尾（按容器缩进）；
 *   3. 目标连条目段都没有 → 追加 `- id: xxx` + `config:` + 该项（最小可用段）。
 *
 * 为什么不做「整段替换」：那是 0.4.0 及以前的行为——用户勾一项也会把整段覆盖，
 * 连他没勾的配置一起改，注释也被换掉。这就是用户说的「侵入式」。
 *
 * @param {string} patchText
 * @param {string} entryId
 * @param {string} key
 * @param {string} blockText de-indented 的新块
 * @returns {{ ok:boolean, text:string, action:'replace'|'insert'|'create-section', error?:string }}
 */
export function writeItemBlock(patchText, entryId, key, blockText) {
  const text = String(patchText ?? '');
  const lines = text.split('\n');
  const range = findEntryRange(lines, entryId);

  if (range === null) {
    const block = reindent(blockText, 4);
    const section = [entryId, `  name: '${entryId.replace(/^- id: /, '')}'`, '  config:', ...block];
    const trimmed = text.replace(/\s+$/, '');
    return { ok: true, text: `${trimmed}\n\n${section.join('\n')}\n`, action: 'create-section' };
  }

  const container = findContainer(lines, range);
  if (container === null) {
    // 条目在但没有「块状」config:。要先确认不是**行内流式**写法（`config: {a: 1}`）：
    // 那种情况下再插一个 `config:` 会产生重复键，YAML 语义直接坏掉。
    const inline = lines.findIndex((line, index) => index > range.start && index < range.end
      && /^\s*config\s*:\s*\S/.test(line) && !/^\s*config\s*:\s*$/.test(line));
    if (inline >= 0) {
      return {
        ok: false,
        text: String(patchText ?? ''),
        action: 'replace',
        error: `第 ${inline + 1} 行的 config 是行内流式写法（config: {...}），本插件只支持块状写法；`
          + '请先在设置页或手工把它改成块状，否则写入会产生重复键',
      };
    }
    // 条目在但没有 config: → 在条目名行后插入容器
    const block = reindent(blockText, 4);
    lines.splice(range.start + 1, 0, '  config:', ...block);
    return { ok: true, text: lines.join('\n'), action: 'insert' };
  }

  const scanned = scanItems(lines, container.containerLine + 1, range.end, container.itemIndent);
  const existing = scanned.find((entry) => entry.key === key);
  const block = reindent(blockText, container.itemIndent);

  if (existing !== undefined) {
    lines.splice(existing.start, existing.end - existing.start, ...block);
    return { ok: true, text: lines.join('\n'), action: 'replace' };
  }

  // 没有该键：插到容器最后一个子项之后（没有子项就紧跟容器行）
  const lastEnd = scanned.length > 0 ? scanned[scanned.length - 1].end : container.containerLine + 1;
  lines.splice(lastEnd, 0, ...block);
  return { ok: true, text: lines.join('\n'), action: 'insert' };
}

/** 全部可控条目（qq-bot 与 whale）。 */
export const ENTRY_IDS_ALL = ENTRY_IDS;
