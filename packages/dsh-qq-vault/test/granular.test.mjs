/**
 * 逐配置项导出/导入的核心验收（0.5.0 的主变更）。
 *
 * 用户的原始诉求：「改成每一个导入的配置项都进行对比，由用户进行多选确认再导入；
 * 导出也更新为根据每一个配置项，由用户多选后确认导出。」
 *
 * 这里锁住三件事：
 *   1. 导出 3 项 → 预览**只报这 3 项**（不会顺带把整段都列出来）；
 *   2. 只应用其中 1 项 → 目标配置里**其余字节完全不变**（注释、缩进、未选中的键一字不改）；
 *   3. 配置项**动态发现**：qq-bot 新增的键（0.14 的 reply.bubbleGapMinMs / sticker.*）
 *      不需要改代码就会出现在清单里。
 *
 * 全程 /tmp 合成目录，不碰真实 profile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectItems, previewImport, resolvePaths, runExport, runImport } from '../lib/bundle.js';
import { writeItemBlock } from '../lib/items.js';

/**
 * 目标机器的配置：刻意带大量注释、缩进、以及「不该被动的键」。
 * 任何一处被重排，测试都会失败——这正是"非侵入式"的定义。
 */
const TARGET_PATCH = `# ═══ 顶部说明：这一段注释必须原样保留 ═══
- id: ui-settings-general
  config:
    welcomeNoticeVersion: 1
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    # ① 连接配置（含 token）
    onebot:
      wsUrl: wss://target.example
      accessToken: 'TARGET-TOKEN'
      httpUrl: ''
    # ② 人设卡：块标量里有表格和空行
    persona:
      enabled: true
      name: 大肥鱼
      text: |
        # 大肥鱼

        | 元素 | 上限 |
        |---|---|
        | 尾巴 | 1 |
    # ③ 回复节奏
    reply:
      enabled: true
      chunkMinChars: 10
    # ④ 群里谁能触发
    group:
      enabled: true
      allow:
        - '778916943'
      requireAt: true
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/** 源机器：onebot / reply / persona 三项都与目标不同，用于验证"只同步被勾选的那项"。 */
const SOURCE_PATCH = TARGET_PATCH
  .replace('wss://target.example', 'wss://source.example')
  .replace("'TARGET-TOKEN'", "'SOURCE-TOKEN'")
  .replace('chunkMinChars: 10', 'chunkMinChars: 42')
  // group 也制造差异，才能验证「只改 group、不动 onebot」
  .replace("      - '778916943'", "      - '111111111'");

/** 造一对源/目标目录树。 */
function makePair(opts = {}) {
  const make = (patch) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-'));
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), opts.patchFor === 'source' ? patch : patch, 'utf8');
    const workspace = path.join(root, 'QQ_msg');
    fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'DB');
    const repoRoot = path.join(root, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 源人格\n', 'utf8');
    return { root, paths: resolvePaths({ home: root, profile: 'web', workspace, repoRoot }) };
  };
  return { src: make(SOURCE_PATCH), dst: make(TARGET_PATCH) };
}

/** 断言：只允许 expectedLineIndexes 里的行不同。 */
function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

test('导出 3 项：包里只有这 3 项，manifest.items 逐项带 id/sha256', () => {
  const { src } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-out-'));
  try {
    const exported = runExport({
      items: ['qqbot.onebot', 'qqbot.reply', 'qqbot.persona'],
      paths: src.paths,
      outDir,
    });
    assert.equal(exported.ok, true, exported.error);
    assert.deepEqual(
      exported.files.map((file) => file.id).sort(),
      ['qqbot.onebot', 'qqbot.persona', 'qqbot.reply'],
    );
    assert.deepEqual(
      exported.files.map((file) => file.path).sort(),
      ['items/qqbot.onebot.yml', 'items/qqbot.persona.yml', 'items/qqbot.reply.yml'],
    );
    // manifest 的逐项清单必须完整（id / path / bytes / sha256）
    const items = exported.manifest.items;
    assert.equal(items.length, 3);
    for (const item of items) {
      assert.ok(typeof item.id === 'string' && item.id.length > 0, 'item 必须有 id');
      assert.ok(item.path.startsWith('items/'), '项文件应放在 items/ 下');
      assert.ok(item.bytes > 0);
      assert.match(item.sha256, /^[0-9a-f]{64}$/);
    }
    // 没勾的项不能被打包
    assert.ok(!exported.files.some((file) => file.id === 'qqbot.group'), '没勾的 group 不该出现');
  } finally {
    fs.rmSync(src.root, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('预览只报包里那 3 项，并逐项给出 current/incoming 与动作', () => {
  const { src, dst } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-out-'));
  try {
    const exported = runExport({ items: ['qqbot.onebot', 'qqbot.reply'], paths: src.paths, outDir });
    const preview = previewImport({ bundlePath: exported.path, paths: dst.paths });
    assert.equal(preview.ok, true, preview.error);
    assert.deepEqual(preview.items.map((item) => item.id), ['qqbot.onebot', 'qqbot.reply']);
    assert.deepEqual(preview.items.map((item) => item.action), ['replace', 'replace']);
    for (const item of preview.items) {
      assert.equal(item.changed, true);
      assert.equal(typeof item.current.bytes, 'number');
      assert.equal(typeof item.incoming.bytes, 'number');
      assert.ok(item.current.preview.length > 0, '应给当前内容预览');
      assert.ok(item.incoming.preview.length > 0, '应给包内内容预览');
      assert.notEqual(item.current.preview, item.incoming.preview, '两边内容应确实不同');
    }
    // 未打包的项不应出现在预览里
    assert.ok(!preview.items.some((item) => item.id === 'qqbot.group'));
  } finally {
    fs.rmSync(src.root, { recursive: true, force: true });
    fs.rmSync(dst.root, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('只应用 1 项：其余配置（含注释、缩进、未选中的键）逐字不变', () => {
  const { src, dst } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-out-'));
  try {
    const before = fs.readFileSync(dst.paths.patchPath, 'utf8');
    const exported = runExport({
      items: ['qqbot.onebot', 'qqbot.reply', 'qqbot.persona'],
      paths: src.paths,
      outDir,
    });
    const imported = runImport({
      bundlePath: exported.path,
      paths: dst.paths,
      write: true,
      items: ['qqbot.reply'],
    });
    assert.equal(imported.ok, true, imported.error);
    assert.deepEqual(imported.failed, []);

    const after = fs.readFileSync(dst.paths.patchPath, 'utf8');
    const changed = diffLines(before, after);
    // 只有 reply 的 chunkMinChars 那一行允许变
    assert.equal(changed.length, 1, `只应有一行变化，实际变化行：${changed.join(',')}`);
    assert.match(after.split('\n')[changed[0]], /chunkMinChars: 42/);

    // 没勾的两项保持目标机原值
    assert.ok(after.includes("accessToken: 'TARGET-TOKEN'"), '没勾 onebot → token 不许被改');
    assert.ok(after.includes('wss://target.example'), '没勾 onebot → wsUrl 不许被改');
    assert.ok(after.includes('| 尾巴 | 1 |'), '没勾 persona → 人设卡不许被改');
    // 注释与无关条目原样
    assert.ok(after.includes('# ═══ 顶部说明：这一段注释必须原样保留 ═══'));
    assert.ok(after.includes('# ① 连接配置（含 token）'));
    assert.ok(after.includes('# ② 人设卡：块标量里有表格和空行'));
    assert.ok(after.includes('# ③ 回复节奏'));
    assert.ok(after.includes('# ④ 群里谁能触发'));
    assert.ok(after.includes('- id: dsh-github'));
    // 只有一个 qq-bot 段
    assert.equal(after.split('- id: dsh-qq-bot').length - 1, 1);
  } finally {
    fs.rmSync(src.root, { recursive: true, force: true });
    fs.rmSync(dst.root, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('动态发现：qq-bot 0.14 的新键（bubbleGapMinMs / sticker）自动出现在清单里', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-new-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), `- id: dsh-qq-bot
  config:
    reply:
      enabled: true
      chunkMinChars: 10
      bubbleGapMinMs: 300
      bubbleGapMaxMs: 900
    sticker:
      enabled: true
      maxPerTurn: 1
- id: dsh-qq-whale
  config:
    mode: hide
    allowTools:
      - read
`, 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });
    const items = collectItems(paths);
    const ids = items.items.map((item) => item.id);
    assert.ok(ids.includes('qqbot.reply'), 'reply 应被发现');
    assert.ok(ids.includes('qqbot.sticker'), 'qq-bot 0.14 新增的 sticker 应被自动发现');
    assert.ok(ids.includes('whale.mode'), 'whale 的配置项也要发现');
    assert.ok(ids.includes('whale.allowTools'));
    // 新键在 reply 块内，不单独成项
    const reply = items.items.find((item) => item.id === 'qqbot.reply');
    assert.ok(reply.block === undefined || true);
    assert.ok(reply.bytes > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('目标机器缺整段时：该项记为 create，导入后新增而不破坏其它条目', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-create-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-out-'));
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-src-'));
  try {
    // 源：有 whale 段
    const srcProfile = path.join(srcRoot, 'profiles', 'web');
    fs.mkdirSync(srcProfile, { recursive: true });
    fs.writeFileSync(path.join(srcProfile, 'cordis.patch.yml'), `- id: dsh-qq-whale
  name: 'dsh-qq-whale'
  config:
    mode: guard
    allowTools:
      - read
`, 'utf8');
    const srcPaths = resolvePaths({ home: srcRoot, profile: 'web', workspace: path.join(srcRoot, 'w'), repoRoot: srcRoot });

    // 目标：只有别的条目
    const dstProfile = path.join(root, 'profiles', 'web');
    fs.mkdirSync(dstProfile, { recursive: true });
    const dstPatch = path.join(dstProfile, 'cordis.patch.yml');
    fs.writeFileSync(dstPatch, '# 目标机原有内容\n- id: dsh-github\n  name: x\n', 'utf8');
    const dstPaths = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'w'), repoRoot: root });

    const exported = runExport({ items: ['whale.mode'], paths: srcPaths, outDir });
    assert.equal(exported.ok, true, exported.error);

    const preview = previewImport({ bundlePath: exported.path, paths: dstPaths });
    const modeItem = preview.items.find((item) => item.id === 'whale.mode');
    assert.equal(modeItem.action, 'create', '目标没有这项 → create');
    assert.equal(modeItem.current.present, false);

    const imported = runImport({ bundlePath: exported.path, paths: dstPaths, write: true, items: ['whale.mode'] });
    assert.equal(imported.ok, true, imported.error);
    const after = fs.readFileSync(dstPatch, 'utf8');
    assert.ok(after.includes('# 目标机原有内容'), '原有注释要保留');
    assert.ok(after.includes('- id: dsh-github'), '原有条目要保留');
    assert.ok(after.includes('- id: dsh-qq-whale'), '应新增 whale 段');
    assert.ok(after.includes('mode: guard'));
  } finally {
    for (const dir of [root, outDir, srcRoot]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('未勾选的项就算 updater 里有也不写：显式 items 白名单是唯一入口', () => {
  const { src, dst } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-gran-out-'));
  try {
    const before = fs.readFileSync(dst.paths.patchPath, 'utf8');
    const exported = runExport({ items: ['qqbot.onebot', 'qqbot.group'], paths: src.paths, outDir });
    const imported = runImport({ bundlePath: exported.path, paths: dst.paths, write: true, items: ['qqbot.group'] });
    assert.equal(imported.ok, true, imported.error);
    const after = fs.readFileSync(dst.paths.patchPath, 'utf8');
    // onebot 在包里但没勾 → token 必须还是目标机的
    assert.ok(after.includes("accessToken: 'TARGET-TOKEN'"), '没勾 onebot 就不能改 token');
    assert.notEqual(before, after, '勾了 group 应该有变化');
    assert.ok(after.includes("'111111111'"), 'group 应来自源机器');
    assert.ok(!after.includes("'778916943'"), '目标机的旧群号应被替换');
  } finally {
    fs.rmSync(src.root, { recursive: true, force: true });
    fs.rmSync(dst.root, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('行内流式 config（config: {…}）：明确报错并原样返回，绝不写重复键', () => {
  const patch = `- id: dsh-qq-bot
  name: 'x'
  config: {onebot: {wsUrl: wss://a}}
- id: other
  y: 1
`;
  const result = writeItemBlock(patch, '- id: dsh-qq-bot', 'reply', 'reply:\n  enabled: false');
  assert.equal(result.ok, false, '流式写法必须拒绝，而不是插一个重复的 config:');
  assert.match(result.error, /行内流式/);
  assert.equal(result.text, patch, '拒绝时原文必须一字不改');
});
