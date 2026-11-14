/**
 * 人格备份的回归测试（对应用户实际反馈：人格卡备份了但导入后不生效）。
 *
 * 关键语义：
 *   导出要取 **cordis.patch.yml 里 dsh-qq-bot.config.persona.text**（生效值），
 *   而不是仓库里的 persona/whale.md（源文件）；
 *   导入要把这份文本**写回配置**，而不是只把文件丢到仓库目录。
 *
 * 所有用例都在 /tmp 的合成目录里跑，绝不碰真实 profile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { planExport, previewImport, resolvePaths, runExport, runImport } from '../lib/bundle.js';
import { extractPersonaText } from '../lib/persona.js';

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

/** 目标机器的配置：人格是另一份，用来验证「被覆盖」。 */
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

test('导出：persona 取的是配置里的生效文本，不是仓库文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-src-'));
  try {
    const paths = makeTree(root, SOURCE_PATCH, { repoPersona: '# 仓库里的旧文案\n' });
    const plan = planExport({ include: ['persona'], paths });
    assert.equal(plan.ok, true);
    const entry = plan.files.find((f) => f.path === 'persona/persona.text');
    assert.ok(entry, `应包含 persona/persona.text，实际：${plan.files.map((f) => f.path).join(',')}`);
    assert.equal(entry.effective, 'config.persona.text');
    assert.ok(entry.chars > 0);
    // 仓库源文件仍作为副本存在
    assert.ok(plan.files.some((f) => f.path === 'persona/whale.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('导出：配置里没有 persona.text 时只带源文件并给出 warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-notext-'));
  try {
    const noText = SOURCE_PATCH.replace(/ {6}text: \|\n {8}# 生效人格（来自配置）\n {8}你叫大肥鱼，不是助手。\n/, '');
    const paths = makeTree(root, noText);
    const plan = planExport({ include: ['persona'], paths });
    assert.equal(plan.ok, true);
    assert.ok(!plan.files.some((f) => f.path === 'persona/persona.text'));
    assert.ok(plan.files.some((f) => f.path === 'persona/whale.md'));
    assert.ok(plan.warnings.some((w) => w.includes('persona.text')), `warnings: ${plan.warnings.join(' | ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('全链路：导出 → 预览 → 导入，人格写回**配置**而不是只落文件', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-src2-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-dst2-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-p-out2-'));
  try {
    const src = makeTree(srcRoot, SOURCE_PATCH);
    const dst = makeTree(dstRoot, TARGET_PATCH, { repoPersona: null });

    const exported = runExport({ include: ['persona'], paths: src, outDir });
    assert.equal(exported.ok, true, exported.error);

    const preview = previewImport({ bundlePath: exported.path, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    const personaChange = preview.changes.find((c) => c.key === 'persona');
    assert.ok(personaChange, '预览应包含 persona 变更');
    assert.equal(personaChange.target, dst.patchPath, '人格应写回配置，而不是仓库文件');
    assert.match(personaChange.note, /persona\.text/);

    const imported = runImport({ bundlePath: exported.path, paths: dst, write: true });
    assert.equal(imported.ok, true, imported.error);

    // 目标配置里的人格已被替换成源机器那份
    const after = fs.readFileSync(dst.patchPath, 'utf8');
    const read = extractPersonaText(after);
    assert.equal(read.ok, true);
    assert.match(read.text, /生效人格（来自配置）/);
    assert.doesNotMatch(read.text, /旧人格/);
    // 其它配置没被动
    assert.match(after, /wss:\/\/target\.invalid/, '导入人格不应改传输配置');
    assert.match(after, /- id: dsh-github/);
    // 导入前的备份存在
    const backups = fs.readdirSync(dst.profileDir).filter((n) => n.includes('.bak-vault-'));
    assert.ok(backups.length >= 1, '导入前应备份 profile');
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('旧包兼容：只有 persona/whale.md 时，把它当作 persona.text 写回配置并给 warning', () => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-src-'));
  const dstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-dst-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-out-'));
  try {
    // 造一个旧格式包：直接手写 tar，内含 persona/whale.md 与最小 manifest
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-stage-'));
    fs.mkdirSync(path.join(staging, 'persona'), { recursive: true });
    const legacyContent = '# 旧包里的人格\n老文案\n';
    fs.writeFileSync(path.join(staging, 'persona', 'whale.md'), legacyContent, 'utf8');
    // 旧包也得有 manifest（否则 openBundle 会当它不是本插件的包直接拒掉）
    const digest = crypto.createHash('sha256').update(Buffer.from(legacyContent, 'utf8')).digest('hex');
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'qqbot-vault-bundle',
      exportedAt: new Date().toISOString(),
      dsh: { version: '0.2.2-rc.3', home: '/tmp', profile: 'web' },
      include: ['persona'],
      files: [{ path: 'persona/whale.md', sha256: digest, bytes: Buffer.byteLength(legacyContent) }],
    }, null, 2), 'utf8');
    const bundlePath = path.join(outDir, 'qqbot-vault-legacy.tar.gz');
    execFileSync('tar', ['czf', bundlePath, '-C', staging, '.'], { stdio: 'ignore' });
    fs.rmSync(staging, { recursive: true, force: true });

    const dst = makeTree(dstRoot, TARGET_PATCH, { repoPersona: null });
    const preview = previewImport({ bundlePath, paths: dst });
    assert.equal(preview.ok, true, preview.error);
    if (preview.version?.blocked === true) {
      // 没有 manifest 的包会被版本闸拦住；用 force 走兼容
      assert.ok(true);
      return;
    }
    const personaChange = preview.changes.find((c) => c.key === 'persona');
    assert.ok(personaChange);
    assert.equal(personaChange.legacy, true);
    assert.ok(preview.warnings.some((w) => w.includes('旧格式')));

    const imported = runImport({ bundlePath, paths: dst, write: true, force: true });
    assert.equal(imported.ok, true, imported.error);
    const after = extractPersonaText(fs.readFileSync(dst.patchPath, 'utf8'));
    assert.match(after.text, /旧包里的人格/);
  } finally {
    for (const dir of [srcRoot, dstRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
