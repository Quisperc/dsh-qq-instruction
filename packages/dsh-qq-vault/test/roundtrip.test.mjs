import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENTRY,
  mergeEntryBlock,
  previewImport,
  resolvePaths,
  runExport,
  runImport,
} from '../lib/bundle.js';

const PATCH = `- id: ui-settings-general
  config:
    welcomeNoticeVersion: 1
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://old.invalid
      accessToken: TOKEN-FROM-SOURCE
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/** 造一个「源机器」目录树（配置 + 人格 + 记忆）。 */
function makeSource(root) {
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), PATCH, 'utf8');
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'FAKE-SQLITE');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 源人格卡\n');
  return resolvePaths({ home: root, profile: 'web', workspace, repoRoot });
}

/** 造一个「目标机器」目录树（已有不同的 qq-bot 段）。 */
function makeTarget(root) {
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), `${PATCH.replace('wss://old.invalid', 'wss://target.invalid')}\n`, 'utf8');
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'OLD-TARGET-DB');
  const repoRoot = path.join(root, 'repo');
  return resolvePaths({ home: root, profile: 'web', workspace, repoRoot });
}

test('导出 → 预览 → 导入 全链路（合成数据，不碰真实文件）', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);

    // —— 导出 ——
    const exported = runExport({ include: ['config', 'memory', 'persona'], paths: src, outDir });
    assert.equal(exported.ok, true, exported.error);
    assert.ok(fs.existsSync(exported.path));
    assert.ok(exported.bytes > 0);
    const names = exported.files.map((f) => f.path).sort();
    assert.deepEqual(names, ['cordis-qq-bot.yml', 'memory/memory.db', 'persona/whale.md']);

    // —— 预览（不写）——
    const before = fs.readFileSync(dst.patchPath, 'utf8');
    const preview = previewImport({ bundlePath: exported.path, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(fs.readFileSync(dst.patchPath, 'utf8'), before, '预览必须不改任何文件');
    const configChange = preview.changes.find((c) => c.key === 'config');
    assert.equal(configChange.action, 'replace', '目标已有同名段 → 整段替换');
    assert.equal(preview.changes.find((c) => c.key === 'memory').action, 'replace');

    // —— 导入 ——
    const imported = runImport({ bundlePath: exported.path, paths: dst, write: true });
    assert.equal(imported.ok, true, imported.error);
    assert.equal(imported.written, true);

    const after = fs.readFileSync(dst.patchPath, 'utf8');
    assert.equal(after.split(ENTRY.qqBot).length - 1, 1, '不能出现两段 dsh-qq-bot');
    assert.ok(after.includes('TOKEN-FROM-SOURCE'), '配置应来自源机器');
    assert.ok(!after.includes('wss://target.invalid'), '目标旧值应被替换');
    assert.ok(after.includes('- id: ui-settings-general'), '无关条目保留');
    assert.ok(after.includes('- id: dsh-github'), '无关条目保留');
    assert.equal(fs.readFileSync(dst.dbPath, 'utf8'), 'FAKE-SQLITE', '记忆库应被恢复');

    // 备份必须存在
    const patchBackups = fs.readdirSync(path.dirname(dst.patchPath)).filter((n) => n.includes('.bak-vault-'));
    assert.ok(patchBackups.length >= 1, '必须留下配置备份');
    const dbBackups = fs.readdirSync(path.dirname(dst.dbPath)).filter((n) => n.includes('.bak-vault-'));
    assert.ok(dbBackups.length >= 1, '必须留下记忆库备份');
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runImport 不传 write 只返回计划，不落盘', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);
    const exported = runExport({ include: ['config'], paths: src, outDir });
    const before = fs.readFileSync(dst.patchPath, 'utf8');
    const dry = runImport({ bundlePath: exported.path, paths: dst, include: ['config'] });
    assert.equal(dry.ok, true);
    assert.equal(dry.written, false);
    assert.equal(fs.readFileSync(dst.patchPath, 'utf8'), before);
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('previewImport 对非 tar.gz 返回结构化错误而不是抛', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-bad-'));
  try {
    const bad = path.join(root, 'not-a-bundle.tar.gz');
    fs.writeFileSync(bad, 'this is not gzip');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const result = previewImport({ bundlePath: bad, paths });
    assert.equal(result.ok, false);
    assert.match(result.error, /解包失败|manifest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runExport 没有可导出项时失败但不抛', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-empty-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '- id: other\n  x: 1\n', 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const result = runExport({ include: ['config'], paths, outDir: path.join(root, 'out') });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(root, 'out')), false, '没有内容就不该建目录');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mergeEntryBlock 幂等：导入两次结果一致', () => {
  const block = `${ENTRY.qqBot}\n  config:\n    onebot:\n      wsUrl: wss://x.invalid`;
  const once = mergeEntryBlock(PATCH, block, ENTRY.qqBot).text;
  const twice = mergeEntryBlock(once, block, ENTRY.qqBot).text;
  assert.equal(twice, once);
});
