/**
 * 权限与节流：决定「这条语音允不允许发」。
 *
 * 为什么要自己判权限：本插件不经过 dsh-qq-bot，它的准入判断（谁能让 bot 说话）
 * 管不到我们。既然我们手里有 NapCat 的连接，就等于能往任意群/人发语音——
 * 所以这一层必须自己守住，宁可误拒也不能误发。
 *
 * 三层判断，任何一层不过就拒：
 *   1. **发言人**：从当前会话最近一条 user 消息的头部解析（`身份:拥有者` + QQ 号）。
 *      解析不到就拒——不做「猜一个」的宽松处理。
 *   2. **目标**：群必须同时命中本插件 allowGroups（空=不限）与 dsh-qq-bot 的 `group.allow`；
 *      私聊只允许发给拥有者。
 *   3. **节流**：每小时条数 + 两条之间的冷却，防止一次对话刷出十条语音。
 */

/** 群聊消息头：`[QQ群 778916943 · 昵称(507678128) · 身份:拥有者｜拥有者+本群群主]` */
const GROUP_HEADER = /^\[QQ群\s+(\d+)\s*·\s*([\s\S]*?)\((\d+)\)\s*·\s*身份:([^\]]*)\]/;
/** 私聊消息头：`[QQ私聊 · 昵称(507678128) · 身份:拥有者｜拥有者]` */
const PRIVATE_HEADER = /^\[QQ私聊\s*·\s*([^\]]*?)\((\d+)\)\s*·\s*身份:([^\]]*)\]/;

/**
 * 解析发言人。
 *
 * 边界都覆盖了：昵称里带括号（靠 `· 身份:` 锚点吃掉贪婪/非贪婪的歧义）、
 * 昵称里带数字、群号与 QQ 号同时出现、没有头部（Web 会话/子代理）等。
 *
 * @param {unknown} text 一条用户消息的文本（可以很长，只看头部的方括号段）
 * @returns {{ok: true, scope: 'group'|'private', groupId: string, userId: string, displayName: string, roleText: string, isOwner: boolean}
 *   | {ok: false, error: string}}
 */
export function parseSpeaker(text) {
  const head = typeof text === 'string' ? text.slice(0, 400) : '';
  if (head.trim() === '') return { ok: false, error: '拿不到当前消息，无法确认发言人' };

  const group = GROUP_HEADER.exec(head);
  if (group !== null) {
    const [, groupId, displayName, userId, roleText] = group;
    return {
      ok: true,
      scope: 'group',
      groupId,
      userId,
      displayName: displayName.trim(),
      roleText: roleText.trim(),
      // 只认「拥有者」这一个标记：群主/管理员不代表是 bot 的主人。
      isOwner: /拥有者/.test(roleText),
    };
  }

  const priv = PRIVATE_HEADER.exec(head);
  if (priv !== null) {
    const [, displayName, userId, roleText] = priv;
    return {
      ok: true,
      scope: 'private',
      groupId: '',
      userId,
      displayName: displayName.trim(),
      roleText: roleText.trim(),
      isOwner: /拥有者/.test(roleText),
    };
  }

  return { ok: false, error: '当前会话不是 QQ 会话（消息头里没有「[QQ群 …]」或「[QQ私聊 …]」）' };
}

/**
 * 从一个 YAML 文本里，读出某个二级键下的列表（例如 `group.allow`、`auth.owners`）。
 *
 * 为什么不用 YAML 库：eemeli 的 `yaml` 只在 DSH 自己的 node_modules 里、插件解析不到；
 * `js-yaml` 会把注释与排版全毁掉——而我们只是**只读**两个列表，块扫描足够且零依赖。
 *
 * 支持两种写法：块列表（`allow:` 换行 `- "1"`）与行内列表（`allow: ["1","2"]` / `[]`）。
 *
 * @param {string[]} lines 全文按行切开
 * @param {string} keyPath 形如 'group.allow'（从外到内）
 * @returns {string[] | null} 找不到返回 null（调用方据此判断"读不到策略"）
 */
export function readKeyPathList(lines, keyPath) {
  const [outerKey, innerKey] = String(keyPath).split('.');
  if (outerKey === undefined || innerKey === undefined) return null;

  /** @param {string} line @returns {number} 缩进空格数 */
  const indentOf = (line) => {
    const match = /^(\s*)/.exec(line);
    return match === null ? 0 : match[1].length;
  };
  const isComment = (line) => /^\s*(#|$)/.test(line);

  // 先定位外层的 `group:` / `auth:` 行。
  let outerIndex = -1;
  let outerIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (isComment(lines[i])) continue;
    const match = new RegExp(`^(\\s*)${outerKey}:\\s*(#.*)?$`).exec(lines[i]);
    if (match !== null) {
      outerIndex = i;
      outerIndent = match[1].length;
      break;
    }
  }
  if (outerIndex < 0) return null;

  // 在外层子树里找内层键。
  let innerIndex = -1;
  let innerIndent = 0;
  for (let i = outerIndex + 1; i < lines.length; i += 1) {
    if (isComment(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (indent <= outerIndent) break; // 出了外层子树
    const match = new RegExp(`^(\\s*)${innerKey}:\\s*(.*)$`).exec(lines[i]);
    if (match !== null) {
      innerIndex = i;
      innerIndent = match[1].length;
      const inline = match[2].trim();
      if (inline !== '' && !inline.startsWith('#')) {
        // 行内写法：[] / ["1","2"] / ['1']
        const inner = inline.replace(/\s+#.*$/, '').trim();
        if (inner === '[]') return [];
        const items = inner.replace(/^\[/, '').replace(/\]$/, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter((s) => s !== '');
        return items;
      }
      break;
    }
  }
  if (innerIndex < 0) return null;

  /** @type {string[]} */
  const out = [];
  for (let i = innerIndex + 1; i < lines.length; i += 1) {
    if (isComment(lines[i])) continue;
    const indent = indentOf(lines[i]);
    if (indent <= innerIndent) break; // 列表结束
    const item = /^\s*-\s*(.+?)\s*$/.exec(lines[i]);
    if (item === null) continue;
    out.push(item[1].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim());
  }
  return out;
}

/**
 * `dsh-qq-bot` 那一段的文本（找不到返回 null）。
 *
 * 为什么先切段：`group.allow` / `auth.owners` 只有在 qq-bot 这一段里才是我们要的那份，
 * 别的条目（比如别的插件）也可能有同名键。
 *
 * @param {string} text 整个 cordis.patch.yml
 * @returns {string | null}
 */
export function sliceQqBotSection(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const lines = text.split('\n');
  let start = -1;
  let startIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)-\s+id:\s*['"]?dsh-qq-bot['"]?\s*$/.exec(lines[i]);
    if (match !== null) {
      start = i;
      startIndent = match[1].length;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^(\s*)-\s+id:/.exec(lines[i]);
    if (match !== null && match[1].length <= startIndent) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * 从 cordis.patch.yml 全文读出策略。
 *
 * @param {string} text
 * @returns {{ok: true, groups: string[], owners: string[], privateAllow: string[]} | {ok: false, error: string}}
 */
export function readPolicyFromText(text) {
  const section = sliceQqBotSection(text);
  if (section === null) return { ok: false, error: '没在配置里找到 dsh-qq-bot 段，无法校验目标' };
  const lines = section.split('\n');
  const groups = readKeyPathList(lines, 'group.allow');
  const owners = readKeyPathList(lines, 'auth.owners');
  const privateAllow = readKeyPathList(lines, 'private.allow');
  if (groups === null || owners === null) {
    return { ok: false, error: 'dsh-qq-bot 段里读不到 group.allow 或 auth.owners，无法校验目标' };
  }
  return { ok: true, groups, owners, privateAllow: privateAllow ?? [] };
}

/**
 * 判断「这次能不能发」。
 *
 * @param {{
 *   speaker: {ok: true, scope: string, groupId: string, userId: string, isOwner: boolean} | {ok: false, error: string},
 *   policy: {ok: true, groups: string[], owners: string[]} | {ok: false, error: string},
 *   targetType: 'group'|'private',
 *   targetId: string,
 *   allowGroups: string[],
 *   ownerOnly: boolean,
 * }} opts
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function checkTarget(opts) {
  const { speaker, policy, targetType, targetId, allowGroups, ownerOnly } = opts;

  if (speaker?.ok !== true) return { ok: false, error: speaker?.error ?? '无法确认发言人' };
  if (ownerOnly === true && speaker.isOwner !== true) {
    return { ok: false, error: `语音只给拥有者用（当前发言人是「${speaker.roleText || '未知身份'}」）` };
  }

  const target = String(targetId ?? '').trim();
  if (target === '' || !/^\d+$/.test(target)) return { ok: false, error: `目标不是合法的数字 ID：${target || '(空)'}` };

  if (policy?.ok !== true) {
    // 策略读不到时的退化路径：只允许「拥有者给自己发私聊」，其余全拒。
    if (targetType === 'private' && speaker.isOwner === true && target === speaker.userId) return { ok: true };
    return { ok: false, error: `${policy?.error ?? '无法读取 qq-bot 配置'}；出于安全只允许拥有者给自己发私聊` };
  }

  if (targetType === 'group') {
    if (!policy.groups.includes(target)) {
      return { ok: false, error: `群 ${target} 不在 dsh-qq-bot 的 group.allow 白名单里` };
    }
    const extra = Array.isArray(allowGroups) ? allowGroups.filter((g) => String(g).trim() !== '') : [];
    if (extra.length > 0 && !extra.map((g) => String(g).trim()).includes(target)) {
      return { ok: false, error: `群 ${target} 不在本插件的 allowGroups 里（当前只允许 ${extra.join(', ')}）` };
    }
    return { ok: true };
  }

  // 私聊：只允许发给拥有者本人，避免"给陌生人打语音电话"。
  if (policy.owners.length > 0 && !policy.owners.includes(target)) {
    return { ok: false, error: `私聊目标 ${target} 不是拥有者（owners: ${policy.owners.join(', ')}）` };
  }
  return { ok: true };
}

/**
 * 节流器：内存计数，够用且不落盘（重启清零是可接受的行为——宁可多给一次机会）。
 *
 * @param {{maxPerHour?: number, cooldownSec?: number, now?: () => number}} [options]
 */
export function createThrottle(options = {}) {
  // 限额每次现取：设置页把 maxPerHour 从 6 改成 2 时，不该重建成一个新的节流器
  // （那样等于把已用额度清零，用户会以为自己又有了 2 条）。
  const limits = () => {
    if (typeof options.limits === 'function') {
      const raw = options.limits() ?? {};
      return {
        maxPerHour: Number.isFinite(raw.maxPerHour) ? Number(raw.maxPerHour) : 6,
        cooldownSec: Number.isFinite(raw.cooldownSec) ? Number(raw.cooldownSec) : 10,
      };
    }
    return {
      maxPerHour: Number.isFinite(options.maxPerHour) ? Number(options.maxPerHour) : 6,
      cooldownSec: Number.isFinite(options.cooldownSec) ? Number(options.cooldownSec) : 10,
    };
  };
  const now = typeof options.now === 'function' ? options.now : Date.now;
  /** @type {number[]} */
  let stamps = [];

  /** 丢掉一小时之前的记录。 */
  const prune = () => {
    const cutoff = now() - 60 * 60 * 1000;
    stamps = stamps.filter((t) => t > cutoff);
  };

  return {
    /**
     * @returns {{ok: true} | {ok: false, error: string, retryAfterSec: number}}
     */
    check() {
      prune();
      const { maxPerHour, cooldownSec } = limits();
      if (maxPerHour > 0 && stamps.length >= maxPerHour) {
        const oldest = stamps[0] ?? now();
        const retryAfterSec = Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - now()) / 1000));
        return {
          ok: false,
          retryAfterSec,
          error: `语音发得太频繁：每小时上限 ${maxPerHour} 条，约 ${retryAfterSec} 秒后可再发`,
        };
      }
      if (cooldownSec > 0 && stamps.length > 0) {
        const last = stamps[stamps.length - 1] ?? 0;
        const waitMs = last + cooldownSec * 1000 - now();
        if (waitMs > 0) {
          const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
          return { ok: false, retryAfterSec, error: `语音冷却中：两条之间至少隔 ${cooldownSec} 秒，还要等 ${retryAfterSec} 秒` };
        }
      }
      return { ok: true };
    },
    /** 记一次成功发送。 */
    record() {
      prune();
      stamps.push(now());
    },
    /** 剩余额度（给工具返回值用，让模型知道还能发几条）。 */
    stats() {
      prune();
      const { maxPerHour, cooldownSec } = limits();
      return {
        usedLastHour: stamps.length,
        remaining: maxPerHour > 0 ? Math.max(0, maxPerHour - stamps.length) : Infinity,
        maxPerHour,
        cooldownSec,
      };
    },
    /** 测试用：清空。 */
    reset() {
      stamps = [];
    },
  };
}
