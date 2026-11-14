/**
 * dsh-qq-voice 的配置项也要能被逐项备份（2026-11-15）。
 *
 * 用户的诉求：「vault 为导入导出也需要支持等」——新插件的配置同样要能备份/迁移。
 *
 * 这一组测试专门盯住语音段的三个「容易写错」的地方：
 *   1. **折行块标量**（`apiKey: >-` / `requestTemplate: >-`）：块扫描必须吃到折行后的
 *      全部续行，只取第一行就会把 key 截断成 `>-`——那是最坏的情况（导入后 key 变成字面量 `>-`）；
 *   2. **空值**（`ttsVoice: ''`）：空串也要能原样往返，不能被当成「没有这一项」；
 *   3. **敏感标记**：`apiKey` / `accessToken` 必须与 qq-bot 的 token 同级处理。
 *
 * 全程 /tmp 合成目录，不碰真实 profile。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectItems, previewImport, resolvePaths, runExport, runImport } from '../lib/bundle.js';
import { readEntryItems, scanItems, findContainer, findEntryRange } from '../lib/items.js';

/** 折行块 + 空值 + 敏感项，刻意写成真实 profile 的样子（含注释）。 */
const VOICE_SECTION = `# ── 语音回复（dsh-qq-voice）── 这一段注释也要保留 ──
- id: dsh-qq-voice
  config:
    enabled: true
    mode: manual
    wsUrl: wss://qapi.example
    accessToken: >-
      NAPCAT-TOKEN-LINE
    # TTS 端点与型号
    ttsBaseUrl: https://maas.example/api/v1/services/audio/tts/SpeechSynthesizer
    ttsModel: qwen-audio-3.0-tts-flash
    ttsVoice: ""
    apiKey: >-
      sk-test-line-one
      sk-test-line-two
    format: wav
    requestTemplate: >-
      {"model":"{{model}}","input":{"text":"{{text}}","seed":2024}}
    ownerOnly: true
`;

/** 目标机器的完整 patch：语音段 + 另一个条目（用于验证不会串段）。 */
const TARGET_PATCH = `# 顶部注释
- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://target.example
  ${''}
${VOICE_SECTION}
- id: dsh-github
  name: '@perrylink/dsh-github'
`;

/** 源机器：只让 ttsVoice / ttsModel 与目标不同，其余保持一致。 */
const SOURCE_PATCH = TARGET_PATCH
  .replace('ttsModel: qwen-audio-3.0-tts-flash', 'ttsModel: qwen-audio-3.1-tts-plus')
  .replace('ttsVoice: ""', 'ttsVoice: qwen-audio-3.0-tts-flash-longlinx-abc123');

/** 造一对源/目标目录树。 */
function makePair() {
  const make = (patch) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-voice-'));
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), patch, 'utf8');
    const workspace = path.join(root, 'QQ_msg');
    fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'DB');
    const repoRoot = path.join(root, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 人格\n', 'utf8');
    return { root, paths: resolvePaths({ home: root, profile: 'web', workspace, repoRoot }) };
  };
  return { src: make(SOURCE_PATCH), dst: make(TARGET_PATCH) };
}

function cleanup(...roots) {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

test('语音段被逐项发现：id 前缀 voice、分组 dsh-qq-voice 之外的短前缀、敏感标记正确', () => {
  const { dst } = makePair();
  try {
    const scanned = collectItems(dst.paths);
    const voice = scanned.items.filter((item) => item.id.startsWith('voice.'));
    const keys = voice.map((item) => item.key);

    // 全部子键都要被发现（含折行块里的 requestTemplate）
    for (const key of ['enabled', 'mode', 'wsUrl', 'accessToken', 'ttsBaseUrl', 'ttsModel',
      'ttsVoice', 'apiKey', 'format', 'requestTemplate', 'ownerOnly']) {
      assert.ok(keys.includes(key), `缺少配置项：${key}`);
    }
    // item id 形状：voice.<子键>
    for (const item of voice) {
      assert.equal(item.id, `voice.${item.key}`);
      assert.equal(item.group, 'voice');
      assert.equal(item.entryId, '- id: dsh-qq-voice');
    }
    // 敏感项：apiKey / accessToken 与 qq-bot 的 token 同级
    assert.equal(voice.find((item) => item.key === 'apiKey')?.sensitive, true, 'apiKey 必须标敏感');
    assert.equal(voice.find((item) => item.key === 'accessToken')?.sensitive, true, 'accessToken 必须标敏感');
    // 非敏感项不能误标
    assert.equal(voice.find((item) => item.key === 'ttsModel')?.sensitive, false);
    assert.equal(voice.find((item) => item.key === 'enabled')?.sensitive, false);

    // 分组信息：label 指向插件名，present=true
    const group = scanned.groups.find((entry) => entry.group === 'voice');
    assert.ok(group, 'voice 分组要出现在 groups 里');
    assert.equal(group.present, true);
    assert.match(group.label, /dsh-qq-voice/);
    assert.equal(group.entryId, '- id: dsh-qq-voice');
  } finally {
    cleanup(dst.root);
  }
});

test('折行块标量必须整块取到（不能只剩 >-）', () => {
  const { dst } = makePair();
  try {
    const scanned = readEntryItems(fs.readFileSync(dst.paths.patchPath, 'utf8'), '- id: dsh-qq-voice');
    const apiKey = scanned.items.find((item) => item.key === 'apiKey');
    assert.ok(apiKey, 'apiKey 要能被读到');
    assert.ok(apiKey.block.startsWith('apiKey: >-'), `块应以键行开头，实际：${apiKey.block.slice(0, 30)}`);
    // 折行后的两行都在块里
    assert.ok(apiKey.block.includes('sk-test-line-one'), '折行第一行丢了');
    assert.ok(apiKey.block.includes('sk-test-line-two'), '折行续行丢了');

    const tpl = scanned.items.find((item) => item.key === 'requestTemplate');
    assert.ok(tpl.block.includes('{{model}}'), '模板内容不能被截断');

    // 空值项也要在（ttsVoice: ""）
    const voice = scanned.items.find((item) => item.key === 'ttsVoice');
    assert.ok(voice, '空值项 ttsVoice 不能被漏掉');
    assert.equal(voice.block.trim(), 'ttsVoice: ""');
  } finally {
    cleanup(dst.root);
  }
});

test('导出 2 项 → 预览只报这 2 项 → 只应用 1 项时其余字节不变（含注释）', () => {
  const { src, dst } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-voice-out-'));
  try {
    // 1) 导出两项
    const exported = runExport({ items: ['voice.ttsModel', 'voice.ttsVoice'], paths: src.paths, outDir });
    assert.equal(exported.ok, true, exported.error);
    assert.deepEqual(
      exported.files.map((file) => file.id).sort(),
      ['voice.ttsModel', 'voice.ttsVoice'],
    );
    assert.deepEqual(
      exported.files.map((file) => file.path).sort(),
      ['items/voice.ttsModel.yml', 'items/voice.ttsVoice.yml'],
    );
    // 没勾的项不能进包
    assert.ok(!exported.files.some((file) => file.id === 'voice.apiKey'), '没勾的 apiKey 不该被打包');

    // 2) 预览只报这两项，且都 changed
    const preview = previewImport({ bundlePath: exported.path, paths: dst.paths });
    assert.equal(preview.ok, true, preview.error);
    assert.deepEqual(preview.items.map((item) => item.id).sort(), ['voice.ttsModel', 'voice.ttsVoice']);
    assert.deepEqual(preview.items.map((item) => item.action), ['replace', 'replace']);
    // 敏感项被正确带出来（ttsVoice 不敏感）
    assert.equal(preview.items.find((item) => item.id === 'voice.ttsVoice').sensitive, false);

    // 3) 只应用 ttsVoice：ttsModel 必须原样不动
    const before = fs.readFileSync(dst.paths.patchPath, 'utf8');
    const applied = runImport({
      bundlePath: exported.path,
      paths: dst.paths,
      write: true,
      items: ['voice.ttsVoice'],
      token: preview.token,
    });
    assert.equal(applied.ok, true, applied.error);
    const after = fs.readFileSync(dst.paths.patchPath, 'utf8');

    assert.ok(after.includes('ttsVoice: qwen-audio-3.0-tts-flash-longlinx-abc123'), '勾选项要写进去');
    assert.ok(after.includes('ttsModel: qwen-audio-3.0-tts-flash'), '没勾的 ttsModel 必须保持目标机原值');

    // 逐行比对：允许变化的行只能落在 ttsVoice 那一行
    const a = before.split('\n');
    const b = after.split('\n');
    assert.equal(a.length, b.length, '行数不该变（说明只替换了一行）');
    const changedLines = [];
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) changedLines.push(i);
    assert.equal(changedLines.length, 1, `只应有一行变化，实际：${JSON.stringify(changedLines.map((i) => a[i]))}`);
    assert.match(a[changedLines[0]], /^\s*ttsVoice:/, '变化的必须是 ttsVoice 行');

    // 注释与其它条目仍在
    assert.ok(after.includes('── 语音回复（dsh-qq-voice）──'), '段前注释被吃掉了');
    assert.ok(after.includes('- id: dsh-github'), '后面的条目不能丢');
    assert.ok(after.includes('- id: dsh-qq-bot'), '前面的条目不能丢');
  } finally {
    cleanup(src.root, dst.root, outDir);
  }
});

test('折行块往返：导出 apiKey 再导入回同一文件，内容逐字一致', () => {
  const { src, dst } = makePair();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-voice-out-'));
  try {
    const exported = runExport({ items: ['voice.apiKey'], paths: src.paths, outDir });
    assert.equal(exported.ok, true, exported.error);

    const before = fs.readFileSync(dst.paths.patchPath, 'utf8');
    const preview = previewImport({ bundlePath: exported.path, paths: dst.paths });
    const applied = runImport({
      bundlePath: exported.path,
      paths: dst.paths,
      write: true,
      items: ['voice.apiKey'],
      token: preview.token,
    });
    assert.equal(applied.ok, true, applied.error);
    const after = fs.readFileSync(dst.paths.patchPath, 'utf8');

    // 折行块本身逐字保留（含续行与缩进）
    assert.ok(after.includes('apiKey: >-\n      sk-test-line-one\n      sk-test-line-two'), '折行块往返后形状变了');
    // 其余内容不变（空值项、注释、后面条目都要原样）
    assert.ok(after.includes('ttsVoice: ""'), '空值项不该被改写');
    // 同一个块往回写 = 无变化：整份文件逐字相同，这是最强的「没写坏」断言。
    assert.equal(after, before, '同内容往返不该改动任何字节');
  } finally {
    cleanup(src.root, dst.root, outDir);
  }
});

test('语音段不存在时不报错，且分组标记 present=false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-voice-'));
  try {
    const profileDir = path.join(root, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    // 只有 qq-bot，没有 voice 段
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'),
      "- id: dsh-qq-bot\n  config:\n    onebot:\n      wsUrl: wss://x\n", 'utf8');
    const workspace = path.join(root, 'QQ_msg');
    fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'DB');
    const repoRoot = path.join(root, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 人格\n', 'utf8');
    const paths = resolvePaths({ home: root, profile: 'web', workspace, repoRoot });

    const scanned = collectItems(paths);
    assert.equal(scanned.ok, true);
    assert.equal(scanned.items.filter((item) => item.id.startsWith('voice.')).length, 0, '不该列出不存在的段');
    const group = scanned.groups.find((entry) => entry.group === 'voice');
    assert.ok(group, '分组本身仍要出现（便于 UI 说明为什么是空的）');
    assert.equal(group.present, false);
    assert.equal(group.count, 0);
    assert.match(group.note, /没有.*dsh-qq-voice/);
    // 没有 error 级别的问题（warning 允许：persona/memory 都在）
    assert.equal(scanned.error, undefined);
  } finally {
    cleanup(root);
  }
});

test('scanItems 对语音段的两级结构不误伤（enabled 与 ttsModel 是同级）', () => {
  const lines = TARGET_PATCH.split('\n');
  const range = findEntryRange(lines, '- id: dsh-qq-voice');
  assert.ok(range, '语音段要能被定位');
  const container = findContainer(lines, range);
  assert.ok(container, 'config: 容器要能被定位');
  const items = scanItems(lines, container.containerLine + 1, range.end, container.itemIndent);
  const keys = items.map((item) => item.key);
  // 顺序与出现顺序一致，且没有把下一段的键（name / config）算进来
  assert.deepEqual(keys, ['enabled', 'mode', 'wsUrl', 'accessToken', 'ttsBaseUrl', 'ttsModel',
    'ttsVoice', 'apiKey', 'format', 'requestTemplate', 'ownerOnly']);
  assert.ok(!keys.includes('name'), '不能跨出条目边界');
});
