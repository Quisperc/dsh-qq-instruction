import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ENTRY,
  previewImport,
  resolvePaths,
  runExport,
  runImport,
} from '../lib/bundle.js';

/**
 * 覆盖三条用户真正在意的承诺：
 *   1. 预览不写盘；
 *   2. 只应用勾选的那些项，其余字节（含注释）一字不改；
 *   3. 不会出现两份同名条目段。
 */

const PATCH = `# 顶部注释：迁移时要保住
- id: ui-settings-general
  config:
    welcomeNoticeVersion: 1
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://old.invalid
      accessToken: TOKEN-FROM-SOURCE
    # reply 上面的注释
    reply:
      enabled: true
      chunkMinChars: 10
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/** 造一个「源机器」目录树（配置 + 人格源 + 记忆）。 */
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

/** 造一个「目标机器」目录树（已有不同的值）。 */
function makeTarget(root) {
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'cordis.patch.yml'),
    `${PATCH.replace('wss://old.invalid', 'wss://target.invalid').replace('TOKEN-FROM-SOURCE', 'TOKEN-TARGET')}\n`,
    'utf8',
  );
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'OLD-TARGET-DB');
  return resolvePaths({ home: root, profile: 'web', workspace, repoRoot: path.join(root, 'repo') });
}

test('全链路：导出两项 → 预览逐项 → 只应用其中一项', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);
    const beforeText = fs.readFileSync(dst.patchPath, 'utf8');

    // —— 导出两项：onebot（要应用）+ reply（不应用）——
    const exported = runExport({ items: ['qqbot.onebot', 'qqbot.reply', 'memory.db'], paths: src, outDir });
    assert.equal(exported.ok, true, exported.error);
    assert.deepEqual(
      exported.files.map((file) => file.path).sort(),
      ['items/qqbot.onebot.yml', 'items/qqbot.reply.yml', 'memory/memory.db'],
    );

    // —— 预览：不写盘，逐项给出动作 ——
    const preview = previewImport({ bundlePath: exported.path, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(fs.readFileSync(dst.patchPath, 'utf8'), beforeText, '预览必须不改任何文件');
    assert.deepEqual(
      preview.items.map((item) => `${item.id}:${item.action}`),
      ['qqbot.onebot:replace', 'qqbot.reply:same', 'memory.db:replace'],
    );
    assert.equal(preview.changedCount, 2, 'onebot 与 memory 需要替换，reply 目标已一致');

    // —— 只应用 onebot（不选 reply、不选 memory）——
    const imported = runImport({ bundlePath: exported.path, paths: dst, write: true, items: ['qqbot.onebot'] });
    assert.equal(imported.ok, true, imported.error);
    assert.deepEqual(imported.failed, []);

    const after = fs.readFileSync(dst.patchPath, 'utf8');
    assert.ok(after.includes('TOKEN-FROM-SOURCE'), '勾选的项应被替换');
    assert.ok(!after.includes('TOKEN-TARGET'), '旧值应被替换');
    assert.ok(after.includes('wss://old.invalid'));
    // 没勾的项与注释一字不改
    assert.ok(after.includes('# 顶部注释：迁移时要保住'));
    assert.ok(after.includes('# reply 上面的注释'));
    assert.ok(after.includes('- id: ui-settings-general'));
    assert.ok(after.includes('- id: dsh-github'));
    assert.equal(after.split(ENTRY.qqBot).length - 1, 1, '不能出现两段 dsh-qq-bot');
    // 记忆库没被碰
    assert.equal(fs.readFileSync(dst.dbPath, 'utf8'), 'OLD-TARGET-DB', '没勾 memory 就不该动记忆库');

    // 配置备份必须存在
    const patchBackups = fs.readdirSync(path.dirname(dst.patchPath)).filter((n) => n.includes('.bak-vault-'));
    assert.ok(patchBackups.length >= 1, '必须留下配置备份');
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('只应用 memory：配置一个字节都不改', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src2-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst2-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out2-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);
    const beforeText = fs.readFileSync(dst.patchPath, 'utf8');

    const exported = runExport({ items: ['qqbot.onebot', 'memory.db'], paths: src, outDir });
    const imported = runImport({ bundlePath: exported.path, paths: dst, write: true, items: ['memory.db'] });
    assert.equal(imported.ok, true, imported.error);
    assert.equal(fs.readFileSync(dst.patchPath, 'utf8'), beforeText, '没勾配置项就不该碰配置');
    assert.equal(fs.readFileSync(dst.dbPath, 'utf8'), 'FAKE-SQLITE', '记忆库应被恢复');
    const dbBackups = fs.readdirSync(path.dirname(dst.dbPath)).filter((n) => n.includes('.bak-vault-'));
    assert.ok(dbBackups.length >= 1, '必须留下记忆库备份');
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runImport 不传 write 只返回计划，不落盘', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src3-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst3-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out3-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);
    const exported = runExport({ items: ['qqbot.onebot'], paths: src, outDir });
    const before = fs.readFileSync(dst.patchPath, 'utf8');
    const dry = runImport({ bundlePath: exported.path, paths: dst, items: ['qqbot.onebot'] });
    assert.equal(dry.ok, true);
    assert.equal(dry.written, false);
    assert.deepEqual(dry.wouldWrite, [{ id: 'qqbot.onebot', action: 'replace' }]);
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

test('runExport 没有可导出项时失败但不抛，也不建目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-empty-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '- id: other\n  x: 1\n', 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const result = runExport({ items: ['qqbot.onebot'], paths, outDir: path.join(root, 'out') });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(root, 'out')), false, '没有内容就不该建目录');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('同一项导入两次是幂等的（第二次应为 same，不再产生差异）', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-src4-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dst4-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-out4-'));
  try {
    const src = makeSource(srcRoot);
    const dst = makeTarget(dstRoot);
    const exported = runExport({ items: ['qqbot.onebot'], paths: src, outDir });

    const first = runImport({ bundlePath: exported.path, paths: dst, write: true, items: ['qqbot.onebot'] });
    assert.equal(first.ok, true, first.error);
    const afterFirst = fs.readFileSync(dst.patchPath, 'utf8');

    const preview2 = previewImport({ bundlePath: exported.path, paths: dst });
    assert.equal(preview2.items.find((item) => item.id === 'qqbot.onebot').action, 'same');

    const second = runImport({ bundlePath: exported.path, paths: dst, write: true, items: ['qqbot.onebot'] });
    assert.equal(fs.readFileSync(dst.patchPath, 'utf8'), afterFirst, '第二次导入不该再改变文件');
    // 显式勾选了未变的项：允许（无害重写），但文件必须一字节不变
    assert.equal(second.ok, true, '显式选中未变项应成功而不是报错');
    assert.deepEqual(second.failed, []);
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
