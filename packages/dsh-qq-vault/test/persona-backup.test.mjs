/**
 * 人格备份的回归测试（对应用户实际反馈：人格卡备份了但导入后不生效）。
 *
 * 0.5.0 之后语义变了：人格不再是单独的 `persona/persona.text` 文件，
 * 而是**配置项 `qqbot.persona`**（就是 `config.persona` 那个块，里面含 persona.text）。
 * 因此「写回配置」不再是特殊路径，而是逐项导入的天然结果——但仍然必须有测试锁住，
 * 因为这是用户真正踩过的坑。
 *
 * 所有用例都在 /tmp 的合成目录里跑，绝不碰真实 profile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execFileSync } from 'node:child_process';
import { previewImport, resolvePaths, runExport, runImport } from '../lib/bundle.js';
import { readItemBlock } from '../lib/items.js';
import { ENTRY } from '../lib/bundle.js';

/** 源机器的配置：人格文本是「配置里的生效值」，与仓库文件故意不同。 */
const SOURCE_PATCH = `- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://source.invalid
      accessToken: TOKEN
    persona:
      enabled: true
      name: 大肥鱼
      text: |
        # 生效人格（来自配置）
        你叫大肥鱼，不是助手。
    group:
      enabled: true
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/** 目标机器的配置：人格是另一份，用来验证「被覆盖」；传输配置不同，用来验证「不被顺手改掉」。 */
const TARGET_PATCH = `- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://target.invalid
      accessToken: OLD
    persona:
      enabled: true
      name: 旧名字
      text: |
        旧人格，应该被覆盖。
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/**
 * 造一套目录树。
 * @param {string} root
 * @param {string} patch 配置内容
 * @param {{repoPersona?: string|null}} [opts] repoPersona 为 null 表示仓库里没有人格文件
 */
function makeTree(root, patch, opts = {}) {
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), patch, 'utf8');
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'DB');
  const repoRoot = path.join(root, 'repo');
  if (opts.repoPersona !== null) {
    fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), opts.repoPersona ?? '# 仓库源文件\n', 'utf8');
  }
  return resolvePaths({ home: root, profile: 'web', workspace, repoRoot });
}

test('导出：qqbot.persona 带的是配置里的生效人格，不是仓库文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-src-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-out-'));
  try {
    const paths = makeTree(root, SOURCE_PATCH, { repoPersona: '# 仓库里的旧文案\n' });
    const exported = runExport({ items: ['qqbot.persona'], paths, outDir });
    assert.equal(exported.ok, true, exported.error);

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-x-'));
    try {
      execFileSync('tar', ['xzf', exported.path, '-C', staging], { stdio: 'ignore' });
      const block = fs.readFileSync(path.join(staging, 'items', 'qqbot.persona.yml'), 'utf8');
      assert.match(block, /生效人格（来自配置）/, '必须是配置里的生效文本');
      assert.doesNotMatch(block, /仓库里的旧文案/, '不能拿仓库源文件冒充生效人格');
      assert.match(block, /^persona:/m, '块从 persona: 开始');
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  } finally {
    for (const dir of [root, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('导出：人格源文件是独立 item（persona.source），与配置项互不替代', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-src3-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-out3-'));
  try {
    const paths = makeTree(root, SOURCE_PATCH, { repoPersona: '# 仓库源\n' });
    const exported = runExport({ items: ['persona.source'], paths, outDir });
    assert.equal(exported.ok, true, exported.error);
    assert.deepEqual(exported.files.map((file) => file.path), ['persona/whale.md']);
  } finally {
    for (const dir of [root, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('导出：仓库没有人格源文件时，只是少一个可选项（不报错）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-nosrc-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-out4-'));
  try {
    const paths = makeTree(root, SOURCE_PATCH, { repoPersona: null });
    const exported = runExport({ items: ['qqbot.persona'], paths, outDir });
    assert.equal(exported.ok, true, exported.error);
    assert.deepEqual(exported.files.map((file) => file.id), ['qqbot.persona']);
  } finally {
    for (const dir of [root, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('全链路：只导入 qqbot.persona → 人格写回配置，传输配置与其它条目一字不改', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-src2-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-dst2-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-out2-'));
  try {
    const src = makeTree(srcRoot, SOURCE_PATCH);
    const dst = makeTree(dstRoot, TARGET_PATCH, { repoPersona: null });

    const exported = runExport({ items: ['qqbot.persona'], paths: src, outDir });
    assert.equal(exported.ok, true, exported.error);

    const preview = previewImport({ bundlePath: exported.path, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    const personaItem = preview.items.find((item) => item.id === 'qqbot.persona');
    assert.ok(personaItem, `预览应包含 qqbot.persona，实际：${preview.items.map((i) => i.id).join(',')}`);
    assert.equal(personaItem.action, 'replace');
    assert.equal(personaItem.changed, true);

    const imported = runImport({ bundlePath: exported.path, paths: dst, write: true, items: ['qqbot.persona'] });
    assert.equal(imported.ok, true, imported.error);
    assert.equal(imported.failed.length, 0, JSON.stringify(imported.failed));

    // 目标配置里的人格已被替换成源机器那份
    const after = fs.readFileSync(dst.patchPath, 'utf8');
    const personaBlock = readItemBlock(after, ENTRY.qqBot, 'persona');
    assert.ok(personaBlock !== undefined, '配置里应能读回 persona 块');
    assert.match(personaBlock, /生效人格（来自配置）/);
    assert.doesNotMatch(personaBlock, /旧人格/);
    // 其它配置没被动（这是「逐项」的核心承诺）
    assert.match(after, /wss:\/\/target\.invalid/, '导入人格不应改传输配置');
    assert.match(after, /accessToken: OLD/, 'token 不该被顺手改掉');
    assert.match(after, /- id: dsh-github/);
    // 导入前的备份存在
    const backups = fs.readdirSync(dst.profileDir).filter((n) => n.includes('.bak-vault-'));
    assert.ok(backups.length >= 1, '导入前应备份 profile');
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('旧格式包（0.4.0 及以前，只有 files 没有 items）：拒绝猜测，给出明确提示', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-src-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-dst-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-out-'));
  try {
    // 造一个旧格式包：persona/persona.text + persona/whale.md + 最小 manifest（无 items）
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-stage-'));
    fs.mkdirSync(path.join(staging, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(staging, 'persona', 'persona.text'), '# 旧包里的人格\n老文案\n', 'utf8');
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'qqbot-vault-bundle',
      exportedAt: new Date().toISOString(),
      dsh: { version: '0.2.2-rc.3', home: '/tmp', profile: 'web' },
      include: ['persona'],
      files: [{ path: 'persona/persona.text', bytes: 12 }],
    }, null, 2), 'utf8');
    const bundlePath = path.join(outDir, 'qqbot-vault-legacy.tar.gz');
    execFileSync('tar', ['czf', bundlePath, '-C', staging, '.'], { stdio: 'ignore' });
    fs.rmSync(staging, { recursive: true, force: true });

    const dst = makeTree(dstRoot, TARGET_PATCH, { repoPersona: null });
    const preview = previewImport({ bundlePath, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    assert.ok(
      preview.warnings.some((w) => w.includes('0.4.0')),
      `应提示这是旧格式，实际警告：${preview.warnings.join(' | ')}`,
    );
    assert.equal(preview.items.length, 0, '旧格式不猜结构，因此没有可应用项');

    const imported = runImport({ bundlePath, paths: dst, write: true, force: true });
    assert.equal(imported.ok, false, '没有可应用项时应当失败而不是假装成功');
    // 配置没被动
    assert.match(fs.readFileSync(dst.patchPath, 'utf8'), /旧人格，应该被覆盖/);
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
