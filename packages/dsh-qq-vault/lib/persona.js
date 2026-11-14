/**
 * 人格文本在 `cordis.patch.yml` 里的读写。
 *
 * 为什么单独一个模块：
 *   真正生效的人格**不是**仓库里的 `persona/whale.md`，而是
 *   `dsh-qq-bot.config.persona.text`（每个新会话第一轮拼进用户消息）。
 *   早期版本备份了前者、漏了后者，结果导到新机器人格根本没恢复——这是用户实际踩到的坑。
 *
 * 这里只做一件事：在一个 YAML 文本里，精确地**读出**或**写入**某个
 * `- id: xxx` 段里 `persona.text` 的值，支持块标量（`|` / `|-` / `>`）与单行值。
 *
 * 不引入 YAML 库的理由：仓库与目标机都要求零第三方依赖；而且我们只需要动
 * 一个已知结构的字段，手写解析比"整份 YAML 解析再序列化"更安全——
 * 后者会把注释、行宽、引号风格全部重写，用户配置里那些"为什么这么写"的注释就没了。
 */

const ENTRY_QQ_BOT = '- id: dsh-qq-bot';

/**
 * 按行计算缩进宽度（空格数；tab 当 1 处理，YAML 里本来也不该出现 tab）。
 * @param {string} line
 * @returns {number}
 */
function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match === null ? 0 : match[0].length;
}

/**
 * 在给定行区间里找 `persona:` 段与它下面的 `text:` 键。
 *
 * @param {string[]} lines 全文按行切分
 * @param {number} start 条目段起始行（含）
 * @param {number} end 条目段结束行（不含）
 * @returns {{personaLine:number, textLine:number, keyIndent:number} | null}
 */
function locatePersonaKey(lines, start, end) {
  let personaLine = -1;
  let personaIndent = 0;
  for (let i = start; i < end; i += 1) {
    if (/^\s*persona:\s*$/.test(lines[i])) {
      personaLine = i;
      personaIndent = indentOf(lines[i]);
      break;
    }
  }
  if (personaLine < 0) return null;

  for (let i = personaLine + 1; i < end; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    // 回到同级或更外层 → persona 段结束
    if (indent <= personaIndent) break;
    const match = /^(\s+)text:(\s*)(.*)$/.exec(line);
    if (match !== null) return { personaLine, textLine: i, keyIndent: indent };
  }
  return null;
}

/**
 * 从块标量起始行往下收集内容行，返回内容区间与去掉公共缩进后的文本。
 *
 * @param {string[]} lines
 * @param {number} from 第一行内容（textLine + 1）
 * @param {number} end 上限（不含）
 * @param {number} keyIndent `text:` 键的缩进
 * @returns {{to:number, text:string}}
 */
function readBlockScalar(lines, from, end, keyIndent) {
  let to = from;
  while (to < end) {
    const line = lines[to];
    if (line.trim() === '') { to += 1; continue; }
    if (indentOf(line) <= keyIndent) break;
    to += 1;
  }
  // 去掉尾部空行（YAML 块标量里它们通常只是排版）
  let last = to;
  while (last > from && lines[last - 1].trim() === '') last -= 1;
  const body = lines.slice(from, last);
  const nonEmpty = body.filter((line) => line.trim() !== '');
  const minIndent = nonEmpty.length === 0 ? 0 : Math.min(...nonEmpty.map(indentOf));
  const text = body.map((line) => (line.trim() === '' ? '' : line.slice(minIndent))).join('\n');
  return { to, text };
}

/**
 * 从 profile 的 patch 文本里读出**生效的**人格文本。
 *
 * @param {string} patchText `cordis.patch.yml` 全文
 * @param {string} [entryId] 条目 id 行（默认 `- id: dsh-qq-bot`）
 * @returns {{ok:boolean, text?:string, style?:string, error?:string}}
 */
export function extractPersonaText(patchText, entryId = ENTRY_QQ_BOT) {
  const text = String(patchText ?? '');
  if (text.trim() === '') return { ok: false, error: '配置文件为空' };

  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === entryId);
  if (start < 0) return { ok: false, error: `找不到段落 ${entryId}` };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i])) { end = i; break; }
  }

  const located = locatePersonaKey(lines, start, end);
  if (located === null) return { ok: false, error: '该段里没有 persona.text 键（可能人格写的是 persona.enabled 之外的字段）' };

  const rawValue = lines[located.textLine].replace(/^(\s+)text:\s*/, '').trim();

  // 块标量：| |+ |- > >+ >-
  if (/^[|>][+-]?\d*$/.test(rawValue)) {
    const style = rawValue.slice(0, 1) === '|' ? 'literal' : 'folded';
    const { text: body } = readBlockScalar(lines, located.textLine + 1, end, located.keyIndent);
    return { ok: true, text: body, style, keyIndent: located.keyIndent };
  }

  // 单行：'' / "" / 裸值
  if (rawValue === '' || rawValue === "''" || rawValue === '""') return { ok: true, text: '', style: 'inline', keyIndent: located.keyIndent };
  const unquoted = (rawValue.startsWith("'") && rawValue.endsWith("'")) || (rawValue.startsWith('"') && rawValue.endsWith('"'))
    ? rawValue.slice(1, -1).replace(/''/g, "'")
    : rawValue;
  return { ok: true, text: unquoted, style: 'inline', keyIndent: located.keyIndent };
}

/**
 * 把人格文本写回 patch 里的 `persona.text`（块标量形式），**只动这一个键的值**。
 *
 * @param {string} patchText `cordis.patch.yml` 全文
 * @param {string} personaText 新的人格文本（可以是多行）
 * @param {string} [entryId]
 * @returns {{ok:boolean, text?:string, action?:string, chars?:number, error?:string}}
 */
export function replacePersonaText(patchText, personaText, entryId = ENTRY_QQ_BOT) {
  const text = String(patchText ?? '');
  const value = String(personaText ?? '');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === entryId);
  if (start < 0) return { ok: false, error: `找不到段落 ${entryId}（配置里还没有 qq-bot 段，先导入配置再写人格）` };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i])) { end = i; break; }
  }

  const located = locatePersonaKey(lines, start, end);

  // 没有 persona.text：在 persona: 下面补一个（有 persona 段）或在段尾补 persona 段
  if (located === null) {
    const personaLine = lines.findIndex((line, index) => index >= start && index < end && /^\s*persona:\s*$/.test(line));
    const keyIndent = personaLine >= 0 ? indentOf(lines[personaLine]) + 2 : 6;
    const block = buildScalarLines(value, keyIndent);
    if (personaLine >= 0) {
      lines.splice(personaLine + 1, 0, ...block);
      return { ok: true, text: lines.join('\n'), action: 'created', chars: value.length };
    }
    const personaBlock = [`${' '.repeat(keyIndent)}persona:`, `${' '.repeat(keyIndent + 2)}enabled: true`, ...block];
    lines.splice(start + 1, 0, ...personaBlock);
    return { ok: true, text: lines.join('\n'), action: 'created-section', chars: value.length };
  }

  const rawValue = lines[located.textLine].replace(/^(\s+)text:\s*/, '').trim();
  const block = buildScalarLines(value, located.keyIndent);
  if (/^[|>][+-]?\d*$/.test(rawValue)) {
    const { to } = readBlockScalar(lines, located.textLine + 1, end, located.keyIndent);
    lines.splice(located.textLine, to - located.textLine, ...block);
  } else {
    lines.splice(located.textLine, 1, ...block);
  }
  return { ok: true, text: lines.join('\n'), action: 'replaced', chars: value.length };
}

/**
 * 生成 `text: |` + 缩进好的内容行。
 * 用字面块（`|`）而不是折叠块（`>`）：人格卡里有列表、表格与空行，折叠会毁掉排版。
 *
 * @param {string} value
 * @param {number} keyIndent `text:` 自己的缩进
 * @returns {string[]}
 */
function buildScalarLines(value, keyIndent) {
  const pad = ' '.repeat(keyIndent);
  const contentPad = ' '.repeat(keyIndent + 2);
  if (value === '') return [`${pad}text: ''`];
  const body = value.split('\n').map((line) => (line.trim() === '' ? '' : `${contentPad}${line}`));
  // 去掉尾部空行：块标量的结尾空行会变成实际的换行，容易和下一次导出对不上
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return [`${pad}text: |`, ...body];
}
