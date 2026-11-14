import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENTRY,
  SKIPPED,
  collectItems,
  extractEntryBlock,
  findEntryBlock,
  majorMinor,
  parseItemIds,
  planExport,
  resolvePaths,
} from '../lib/bundle.js';
import { readEntryItems, writeItemBlock, findEntryRange, findContainer, scanItems } from '../lib/items.js';

const PATCH = [
  '- id: ui-settings-general',
  '  config:',
  '    welcomeNoticeVersion: 1',
  '- id: dsh-qq-bot',
  '  name: \'@sputnikzaychik/dsh-qq-bot\'',
  '  config:',
  '    onebot:',
  '      wsUrl: wss://example.invalid',
  '      accessToken: \'SECRET\'',
  '    # 这是一条要保住的注释',
  '    reply:',
  '      enabled: true',
  '      chunkMinChars: 10',
  '    persona:',
  '      enabled: true',
  '      text: |',
  '        # 人鱼',
  '        第一行',
  '- id: dsh-qq-whale',
  '  name: \'dsh-qq-whale\'',
  '- id: dsh-github',
  '  name: \'@perrylink/dsh-github\'',
].join('\n');

test('findEntryBlock 切出中间段，且不吞掉上下条目', () => {
  const { block, startLine, endLine } = findEntryBlock(PATCH, ENTRY.qqBot);
  assert.equal(startLine, 3);
  assert.equal(endLine, 18);
  assert.ok(block.startsWith(ENTRY.qqBot));
  assert.ok(block.includes('wsUrl'));
  assert.ok(!block.includes('dsh-qq-whale'), '不能把下一条目带进来');
});

test('extractEntryBlock 找不到时回空串', () => {
  assert.equal(extractEntryBlock(PATCH, '- id: nope'), '');
  assert.equal(extractEntryBlock('', ENTRY.qqBot), '');
});

test('majorMinor 取主次版本（含 rc 后缀）', () => {
  assert.equal(majorMinor('0.2.2-rc.3'), '0.2');
  assert.equal(majorMinor('0.3.0'), '0.3');
  assert.equal(majorMinor('unknown'), undefined);
  assert.equal(majorMinor(undefined), undefined);
});

test('SKIPPED 说明 sessions 不实现且给理由', () => {
  assert.ok(SKIPPED.sessions.reason.length > 20);
  assert.equal(SKIPPED.sessions.supported, false);
});

// ── 块定位（0.5.0 的新核心）──────────────────────────────────────────────
// 说明：0.4.0 的 mergeEntryBlock / normalizeInclude 已随「整段替换」一起删除，
// 对应断言移到下面的 item 级测试（同样的保护意图，粒度更细）。

test('块定位：一级配置键是 config 的直接子键，边界到下一个同级键或段尾', () => {
  const lines = PATCH.split('\n');
  const range = findEntryRange(lines, ENTRY.qqBot);
  const container = findContainer(lines, range);
  assert.equal(container.itemIndent, 4, '一级配置键缩进 4');
  const scanned = scanItems(lines, container.containerLine + 1, range.end, container.itemIndent);
  assert.deepEqual(scanned.map((s) => s.key), ['onebot', 'reply', 'persona']);
});

test('块定位：注释行归属下一项，不会被上一项吞掉', () => {
  const result = readEntryItems(PATCH, ENTRY.qqBot);
  const onebot = result.items.find((item) => item.key === 'onebot');
  assert.ok(!onebot.block.includes('这是一条要保住的注释'), '注释不能算进 onebot 块');
  assert.ok(onebot.block.includes('accessToken'));
});

test('块定位：块标量的内容行（缩进更深）完整落在项内', () => {
  const result = readEntryItems(PATCH, ENTRY.qqBot);
  const persona = result.items.find((item) => item.key === 'persona');
  assert.ok(persona.block.includes('text: |'));
  assert.ok(persona.block.includes('第一行'), '块标量内容属于 persona');
  assert.equal(persona.sensitive, true, '人设卡按敏感处理');
});

test('块定位：嵌套同名键不误伤（onebot 里的键不会变成独立项）', () => {
  const result = readEntryItems(PATCH, ENTRY.qqBot);
  const keys = result.items.map((item) => item.key);
  assert.ok(!keys.includes('wsUrl'), 'wsUrl 在 onebot 里面，不是一级键');
  assert.ok(!keys.includes('enabled'));
});

test('块定位：条目段不存在时 present=false 而不是报错', () => {
  const result = readEntryItems(PATCH, ENTRY.whale);
  assert.equal(result.present, true);
  assert.deepEqual(result.items, [], 'whale 段没有 config，所以没有可选项');
  assert.equal(readEntryItems(PATCH, '- id: nope').present, false);
});

test('动态发现：qq-bot 新增的键（reply.bubbleGapMinMs / sticker）会被自动扫出来', () => {
  const withNewKeys = PATCH.replace(
    '      chunkMinChars: 10',
    '      chunkMinChars: 10\n      bubbleGapMinMs: 300\n      bubbleGapMaxMs: 900',
  ).replace("  name: 'dsh-qq-whale'", "  name: 'dsh-qq-whale'\n  config:\n    sticker:\n      enabled: true");
  const qq = readEntryItems(withNewKeys, ENTRY.qqBot);
  assert.ok(qq.items.some((item) => item.key === 'reply'));
  const whale = readEntryItems(withNewKeys, ENTRY.whale);
  assert.deepEqual(whale.items.map((item) => item.key), ['sticker'], 'whale 的配置项也是动态发现的');
});

// ── planExport（逐项）────────────────────────────────────────────────────

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), `${PATCH}\n`, 'utf8');
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'fake-db');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 人格卡\n');
  const paths = resolvePaths({ home: root, profile: 'web', workspace, repoRoot });
  return { root, paths };
}

test('collectItems：发现有敏感标记的项，并按组返回', () => {
  const { root, paths } = makeSandbox();
  try {
    const all = collectItems(paths);
    const ids = all.items.map((item) => item.id);
    assert.ok(ids.includes('qqbot.onebot'));
    assert.ok(ids.includes('qqbot.persona'));
    assert.ok(ids.includes('persona.source'));
    assert.ok(ids.includes('memory.db'));
    const onebot = all.items.find((item) => item.id === 'qqbot.onebot');
    assert.equal(onebot.sensitive, true, '含 accessToken → 敏感');
    assert.ok(onebot.bytes > 0);
    assert.ok(all.groups.some((group) => group.group === 'qqbot' && group.present === true));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('planExport：只统计勾选项，不写任何文件', () => {
  const { root, paths } = makeSandbox();
  try {
    const plan = planExport({ items: ['qqbot.onebot', 'memory.db'], paths });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.files.map((file) => file.id), ['qqbot.onebot', 'memory.db']);
    assert.equal(plan.files[0].path, 'items/qqbot.onebot.yml');
    assert.equal(plan.files[1].path, 'memory/memory.db');
    assert.ok(plan.totalBytes > 0);
    assert.equal(fs.existsSync(paths.backupDir), false, '只算不写：备份目录不该被创建');
    assert.ok(plan.skipped.some((entry) => entry.key === 'sessions' && entry.notImplemented === true));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('planExport：勾了本机不存在的项 → 列入 warning 并跳过，不报错', () => {
  const { root, paths } = makeSandbox();
  try {
    const plan = planExport({ items: ['qqbot.onebot', 'whale.mode'], paths });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.files.map((file) => file.id), ['qqbot.onebot']);
    assert.ok(plan.warnings.some((w) => w.includes('whale.mode')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('parseItemIds：去空去重；空输入 = 全部（undefined）', () => {
  assert.deepEqual(parseItemIds('qqbot.onebot, qqbot.reply ,qqbot.onebot'), ['qqbot.onebot', 'qqbot.reply']);
  assert.equal(parseItemIds(''), undefined);
  assert.equal(parseItemIds([]), undefined);
  assert.equal(parseItemIds(undefined), undefined);
});

// ── 写回：只动一项 ───────────────────────────────────────────────────────

test('writeItemBlock：替换一项，其余行（含注释）逐字不变', () => {
  const result = writeItemBlock(PATCH, ENTRY.qqBot, 'onebot', "onebot:\n  wsUrl: wss://NEW\n  accessToken: 'SECRET'");
  assert.equal(result.action, 'replace');
  const before = PATCH.split('\n');
  const after = result.text.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    if (before[i] !== after[i]) diff.push(i);
  }
  assert.equal(diff.length, 1, '只有被替换的那一行不同，其余逐字不变');
  assert.ok(after[diff[0]].includes('wss://NEW'));
  assert.ok(result.text.includes('wss://NEW'));
  assert.ok(result.text.includes('# 这是一条要保住的注释'));
  assert.ok(result.text.includes('第一行'), 'persona 不受影响');
});

test('writeItemBlock：目标没有该项时插入到容器末尾，不覆盖别人的键', () => {
  const result = writeItemBlock(PATCH, ENTRY.qqBot, 'sticker', 'sticker:\n  enabled: true');
  assert.equal(result.action, 'insert');
  const after = readEntryItems(result.text, ENTRY.qqBot);
  assert.ok(after.items.some((item) => item.key === 'sticker'));
  assert.deepEqual(after.items.map((item) => item.key), ['onebot', 'reply', 'persona', 'sticker']);
  assert.ok(result.text.includes('- id: dsh-qq-whale'), '后面的条目要原样保留');
});

test('writeItemBlock：条目段不存在时创建最小段', () => {
  const result = writeItemBlock('- id: other\n  x: 1\n', ENTRY.qqBot, 'onebot', 'onebot:\n  wsUrl: wss://x');
  assert.equal(result.action, 'create-section');
  assert.ok(result.text.includes(ENTRY.qqBot));
  const scanned = readEntryItems(result.text, ENTRY.qqBot);
  assert.deepEqual(scanned.items.map((item) => item.key), ['onebot']);
  assert.ok(result.text.startsWith('- id: other'), '原有内容保留');
});
