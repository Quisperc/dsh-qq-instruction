import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPersonaText, replacePersonaText } from '../lib/persona.js';

/** 造一个最小可用的 patch：两个条目，persona.text 用块标量。 */
const PATCH = [
  '- id: other-plugin',
  '  config:',
  '    foo: 1',
  '- id: dsh-qq-bot',
  '  name: "@sputnikzaychik/dsh-qq-bot"',
  '  config:',
  '    onebot:',
  '      wsUrl: wss://example.invalid',
  '    persona:',
  '      enabled: true',
  '      name: 大肥鱼',
  '      text: |',
  '        # 大肥鱼 · 人格卡',
  '        ',
  '        你叫大肥鱼。',
  '          - 缩进内容也要保留',
  '    group:',
  '      enabled: true',
  '- id: tail-plugin',
  '  config:',
  '    bar: 2',
].join('\n');

test('extractPersonaText：读出块标量内容，保留内部缩进与空行', () => {
  const got = extractPersonaText(PATCH);
  assert.equal(got.ok, true);
  assert.equal(got.style, 'literal');
  assert.equal(got.text, '# 大肥鱼 · 人格卡\n\n你叫大肥鱼。\n  - 缩进内容也要保留');
});

test('extractPersonaText：只认 dsh-qq-bot 段，别段的人参不会被误读', () => {
  const other = PATCH.replace('- id: tail-plugin\n  config:\n    bar: 2', '- id: tail-plugin\n  config:\n    persona:\n      text: |\n        别人的\n');
  assert.equal(extractPersonaText(other).text.includes('别人的'), false);
});

test('extractPersonaText：单行空值 / 引号值都能读', () => {
  const empty = PATCH.replace('      text: |', "      text: ''").split('\n').slice(0, 12).join('\n');
  assert.equal(extractPersonaText(empty).text, '');
  const quoted = PATCH.replace("      text: |", '      text: "一句话人格"').split('\n').slice(0, 12).join('\n');
  assert.equal(extractPersonaText(quoted).text, '一句话人格');
});

test('extractPersonaText：找不到段/键时返回结构化错误而不是抛', () => {
  assert.equal(extractPersonaText('- id: x\n  config: {}\n').ok, false);
  assert.equal(extractPersonaText(PATCH.replace('      text: |', '      enable: true')).ok, false);
  assert.doesNotThrow(() => extractPersonaText(''));
});

test('replacePersonaText：替换块标量后，其它条目与注释原样保留', () => {
  const result = replacePersonaText(PATCH, '新的人格\n第二行');
  assert.equal(result.ok, true);
  assert.equal(result.action, 'replaced');
  const out = result.text;
  assert.ok(out.includes('新的人格'));
  assert.ok(out.includes('第二行'));
  assert.ok(!out.includes('# 大肥鱼 · 人格卡'), '旧内容应被替换掉');
  // 别的段没被动
  assert.ok(out.includes('- id: other-plugin'));
  assert.ok(out.includes('- id: tail-plugin'));
  assert.ok(out.includes('      wsUrl: wss://example.invalid'));
  // 回到写进去再读出来，要能对上（往返一致）
  assert.equal(extractPersonaText(out).text, '新的人格\n第二行');
});

test('replacePersonaText：内联值会被改成块标量', () => {
  const inline = PATCH.replace('      text: |', '      text: ""').split('\n').slice(0, 12).join('\n');
  const result = replacePersonaText(inline, '多行\n人格');
  assert.equal(result.ok, true);
  assert.equal(extractPersonaText(result.text).text, '多行\n人格');
});

test('replacePersonaText：空文本写成 text: \'\'，不是空块', () => {
  const result = replacePersonaText(PATCH, '');
  assert.equal(result.ok, true);
  assert.ok(result.text.includes("text: ''"));
  assert.equal(extractPersonaText(result.text).text, '');
});

test('replacePersonaText：段落不存在时报错（先导配置再写人格）', () => {
  const result = replacePersonaText('- id: other\n  config: {}\n', 'x');
  assert.equal(result.ok, false);
  assert.match(result.error, /找不到段落/);
});

test('replacePersonaText：人格里含 YAML 特殊字符（冒号、井号、引号）不会破坏结构', () => {
  const tricky = '他说：\"别这样\" # 不是注释\n- 列表项：值';
  const result = replacePersonaText(PATCH, tricky);
  assert.equal(result.ok, true);
  assert.equal(extractPersonaText(result.text).text, tricky);
  // 结构仍然完整：条目数不变
  assert.equal((result.text.match(/^- id: /gm) ?? []).length, 3);
});

test('往返：反复替换保持稳定（幂等）', () => {
  const once = replacePersonaText(PATCH, 'A\nB').text;
  const twice = replacePersonaText(once, 'A\nB').text;
  assert.equal(twice, once);
});
