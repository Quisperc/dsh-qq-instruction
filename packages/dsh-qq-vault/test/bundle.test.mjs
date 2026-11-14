import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENTRY,
  INCLUDE_KEYS,
  SKIPPED,
  extractEntryBlock,
  findEntryBlock,
  majorMinor,
  mergeEntryBlock,
  normalizeInclude,
  planExport,
  resolvePaths,
} from '../lib/bundle.js';

const PATCH = [
  '- id: ui-settings-general',
  '  config:',
  '    welcomeNoticeVersion: 1',
  '- id: dsh-qq-bot',
  '  name: \'@sputnikzaychik/dsh-qq-bot\'',
  '  config:',
  '    onebot:',
  '      wsUrl: wss://example.invalid',
  '- id: dsh-qq-whale',
  '  name: \'dsh-qq-whale\'',
  '- id: dsh-github',
  '  name: \'@perrylink/dsh-github\'',
].join('\n');

test('findEntryBlock 切出中间段，且不吞掉上下条目', () => {
  const { block, startLine, endLine } = findEntryBlock(PATCH, ENTRY.qqBot);
  assert.equal(startLine, 3);
  assert.equal(endLine, 8);
  assert.ok(block.startsWith(ENTRY.qqBot));
  assert.ok(block.includes('wsUrl'));
  assert.ok(!block.includes('dsh-qq-whale'), '不能把下一条目带进来');
});

test('extractEntryBlock 找不到时回空串', () => {
  assert.equal(extractEntryBlock(PATCH, '- id: nope'), '');
  assert.equal(extractEntryBlock('', ENTRY.qqBot), '');
});

test('mergeEntryBlock：已有则整段替换，绝不产生两段', () => {
  const block = `${ENTRY.qqBot}\n  config:\n    onebot:\n      wsUrl: wss://new.invalid`;
  const { text, action } = mergeEntryBlock(PATCH, block, ENTRY.qqBot);
  assert.equal(action, 'replaced');
  assert.equal(text.split(ENTRY.qqBot).length - 1, 1, '只能有一个 dsh-qq-bot 段');
  assert.ok(text.includes('wss://new.invalid'));
  assert.ok(!text.includes('wss://example.invalid'));
  assert.ok(text.includes('- id: ui-settings-general'), '前面条目要原样保留');
  assert.ok(text.includes('- id: dsh-github'), '后面条目要原样保留');
});

test('mergeEntryBlock：没有则追加到末尾', () => {
  const target = '- id: a\n  x: 1';
  const { text, action } = mergeEntryBlock(target, `${ENTRY.qqBot}\n  y: 2`, ENTRY.qqBot);
  assert.equal(action, 'appended');
  assert.ok(text.startsWith('- id: a'));
  assert.ok(text.trimEnd().endsWith('y: 2'));
});

test('mergeEntryBlock 对 whale 段同样按 id 定位', () => {
  const { text, action } = mergeEntryBlock(PATCH, `${ENTRY.whale}\n  name: 'dsh-qq-whale'`, ENTRY.whale);
  assert.equal(action, 'replaced');
  assert.equal(text.split(ENTRY.whale).length - 1, 1);
  assert.ok(text.includes(ENTRY.qqBot), 'qq-bot 段不受影响');
});

test('majorMinor 取主次版本（含 rc 后缀）', () => {
  assert.equal(majorMinor('0.2.2-rc.3'), '0.2');
  assert.equal(majorMinor('0.3.0'), '0.3');
  assert.equal(majorMinor('unknown'), undefined);
  assert.equal(majorMinor(undefined), undefined);
});

test('normalizeInclude：去重、丢未知项、保持顺序', () => {
  const { include, ignored } = normalizeInclude(['memory', 'config', 'memory', 'sessions', 'bogus']);
  assert.deepEqual(include, ['memory', 'config']);
  assert.deepEqual(ignored, ['sessions', 'bogus']);
});

test('normalizeInclude：非数组输入安全', () => {
  assert.deepEqual(normalizeInclude(undefined), { include: [], ignored: [] });
  assert.deepEqual(normalizeInclude('config'), { include: [], ignored: [] });
});

test('SKIPPED 说明 sessions 不实现且给理由', () => {
  assert.deepEqual(INCLUDE_KEYS, ['config', 'persona', 'memory', 'whaleConfig']);
  assert.ok(SKIPPED.sessions.reason.length > 20);
});

test('planExport：只算不写，且 token 项标 sensitive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchPath, `${PATCH}\n`, 'utf8');

    const workspace = path.join(root, 'QQ_msg');
    fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'fake-db');

    const repoRoot = path.join(root, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 人格卡\n');

    const paths = resolvePaths({ home: root, profile: 'web', workspace, repoRoot });
    const plan = planExport({ include: ['config', 'memory', 'persona'], paths });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.include, ['config', 'memory', 'persona']);
    const byPath = Object.fromEntries(plan.files.map((f) => [f.path, f]));
    assert.equal(byPath['cordis-qq-bot.yml'].sensitive, true);
    assert.equal(byPath['memory/memory.db'].sensitive, true);
    assert.equal(byPath['persona/whale.md'].sensitive, false);
    assert.ok(plan.totalBytes > 0);
    // 只算不写：backupDir 不该被创建
    assert.equal(fs.existsSync(paths.backupDir), false);
    assert.ok(plan.skipped.some((s) => s.key === 'sessions' && s.notImplemented === true));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('planExport：缺 config 段时给警告而不是抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchPath, '- id: other\n  x: 1\n', 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const plan = planExport({ include: ['config'], paths });
    assert.equal(plan.ok, true);
    assert.equal(plan.files.length, 0);
    assert.ok(plan.warnings.some((w) => w.includes('dsh-qq-bot')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('planExport：whaleConfig 段不存在时归入 skipped 而不是警告', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '- id: other\n  x: 1\n', 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const plan = planExport({ include: ['whaleConfig'], paths });
    assert.ok(plan.skipped.some((s) => s.key === 'whaleConfig'));
    assert.equal(plan.files.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
