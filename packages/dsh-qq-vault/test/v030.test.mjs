import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { apply } from '../lib/index.js';
import { cleanupBundles, listBundles, resolvePaths, verifyBundleIntegrity } from '../lib/bundle.js';

/**
 * v0.3.0 新增能力的测试：完整性校验 / 备份列表 / 清理 / 结构化错误码 / 未实现项标记。
 *
 * 这一层刻意复用 routes.test.mjs 的「假 webServer + 平台方法闸」思路：
 * 平台只放行 GET，所以测试替身也必须这样，否则测出来的行为跟真机不一致。
 */

function fakeServer({ origin } = {}) {
  const routes = new Map();
  return {
    routes,
    server: {
      protocol: 'http:',
      ...(origin === undefined ? {} : { getOrigin: () => origin }),
      register(options) {
        routes.set(options.path, options.handler);
        return () => { routes.delete(options.path); };
      },
    },
  };
}

function makeReq({ url = '/', method = 'GET', host = '127.0.0.1:3080' } = {}) {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = { host };
  req.destroy = () => {};
  return req;
}

function makeRes() {
  return {
    status: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {}; },
    write(chunk) { if (chunk !== undefined) this.chunks.push(Buffer.from(chunk)); },
    end(chunk) { if (chunk !== undefined) this.chunks.push(Buffer.from(chunk)); this.done = true; },
    get buf() { return Buffer.concat(this.chunks); },
    get text() { return this.buf.toString('utf8'); },
    get json() { try { return JSON.parse(this.text); } catch { return undefined; } },
  };
}

async function call(handler, req) {
  const res = makeRes();
  await handler(req, res);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

/** 合成环境：profile + 人格 + 记忆库 + 干净的备份目录。 */
function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-v030-'));
  const profileDir = path.join(root, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
    '- id: ui-settings-general',
    '  config:',
    '    a: 1',
    '- id: dsh-qq-bot',
    "  name: '@sputnikzaychik/dsh-qq-bot'",
    '  config:',
    '    onebot:',
    '      wsUrl: wss://old.invalid',
    '- id: dsh-github',
    '  name: perrylink',
    '',
  ].join('\n'), 'utf8');
  const workspace = path.join(root, 'QQ_msg');
  fs.mkdirSync(path.join(workspace, '.dsh-meow'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.dsh-meow', 'memory.db'), 'FAKE-DB');
  const repoRoot = path.join(root, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'persona'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'persona', 'whale.md'), '# 卡\n');
  const backupDir = path.join(root, 'backups', 'qqbot-vault');
  fs.mkdirSync(backupDir, { recursive: true });
  return { root, workspace, repoRoot, profileDir, backupDir };
}

function bootPlugin(env) {
  const { server, routes } = fakeServer();
  const logs = [];
  const ctx = {
    get: (name) => (name === 'webServer' ? server : undefined),
    on: () => {},
    logger: { info: (m) => logs.push(`info:${m}`), warn: (m) => logs.push(`warn:${m}`) },
  };
  apply(ctx, { home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
  return { routes, logs };
}

/** 解包 → 改一个文件 → 重新打包（模拟"传输损坏"）。 */
function tamperBundle(bundlePath) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-tamper-'));
  execFileSync('tar', ['xzf', bundlePath, '-C', work], { stdio: 'ignore' });
  fs.writeFileSync(path.join(work, 'items', 'qqbot.onebot.yml'), '- id: dsh-qq-bot\n  config:\n    hacked: true\n', 'utf8');
  const out = `${bundlePath}.tampered.tar.gz`;
  execFileSync('tar', ['czf', out, '-C', work, '.'], { stdio: 'ignore' });
  fs.rmSync(work, { recursive: true, force: true });
  return out;
}

test('capabilities：未实现项带 supported:false，且有 backupDir', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(routes.get('/dsh-qq-vault/capabilities'), makeReq({ url: '/dsh-qq-vault/capabilities' }));
    assert.equal(res.status, 200);
    const body = res.json;
    assert.equal(body.ok, true);
    assert.equal(body.backupDir, path.join(env.root, 'backups', 'qqbot-vault'));
    const sessions = body.skipped.find((item) => item.key === 'sessions');
    assert.ok(sessions, 'skipped 里应有 sessions');
    assert.equal(sessions.supported, false, 'sessions 必须显式标记 supported:false');
    assert.ok(String(sessions.reason).length > 10, '未实现项必须带原因');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('listBundles：只认 qqbot-vault-*.tar.gz，按 mtime 倒序，忽略其它文件', () => {
  const env = makeEnv();
  try {
    const paths = resolvePaths({ home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
    fs.writeFileSync(path.join(env.backupDir, 'qqbot-vault-20260101-000000.tar.gz'), 'a');
    fs.writeFileSync(path.join(env.backupDir, 'qqbot-vault-20260102-000000.tar.gz'), 'bb');
    fs.writeFileSync(path.join(env.backupDir, 'something-else.tar.gz'), 'ccc');
    fs.writeFileSync(path.join(env.backupDir, 'notes.txt'), 'ddd');
    // 明确 mtime，避免同秒排序不稳定
    fs.utimesSync(path.join(env.backupDir, 'qqbot-vault-20260101-000000.tar.gz'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(path.join(env.backupDir, 'qqbot-vault-20260102-000000.tar.gz'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    const listed = listBundles(paths);
    assert.equal(listed.ok, true);
    assert.equal(listed.dir, env.backupDir);
    assert.deepEqual(listed.files.map((f) => f.name), [
      'qqbot-vault-20260102-000000.tar.gz',
      'qqbot-vault-20260101-000000.tar.gz',
    ]);
    assert.equal(listed.files[0].bytes, 2);
    assert.ok(listed.files[0].path.startsWith(env.backupDir));
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('cleanup：默认 dry-run 不删；write=1 才删，且绝不碰非本插件文件', () => {
  const env = makeEnv();
  try {
    const paths = resolvePaths({ home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000']) {
      fs.writeFileSync(path.join(env.backupDir, `qqbot-vault-${stamp}.tar.gz`), 'x');
    }
    fs.writeFileSync(path.join(env.backupDir, 'keepme.txt'), 'x');

    const dry = cleanupBundles({ paths, keep: 1, write: false });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.total, 3);
    assert.equal(dry.deleted.length, 2);
    assert.ok(dry.deleted.every((f) => f.action === 'would-delete'));
    assert.equal(fs.readdirSync(env.backupDir).filter((n) => n.endsWith('.tar.gz')).length, 3, 'dry-run 不能删文件');

    const real = cleanupBundles({ paths, keep: 1, write: true });
    assert.equal(real.deleted.length, 2);
    assert.equal(real.kept, 1);
    const left = fs.readdirSync(env.backupDir);
    assert.equal(left.filter((n) => n.endsWith('.tar.gz')).length, 1);
    assert.ok(left.includes('keepme.txt'), '非本插件文件必须保留');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('cleanup：keep 至少为 1，避免一次清理删光', () => {
  const env = makeEnv();
  try {
    const paths = resolvePaths({ home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
    for (const stamp of ['20260101-000000', '20260102-000000']) {
      fs.writeFileSync(path.join(env.backupDir, `qqbot-vault-${stamp}.tar.gz`), 'x');
    }
    const result = cleanupBundles({ paths, keep: 0, write: true });
    assert.equal(result.keep, 1);
    assert.equal(result.kept, 1);
    assert.equal(fs.readdirSync(env.backupDir).filter((n) => n.endsWith('.tar.gz')).length, 1);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('verifyBundleIntegrity：正常包通过；被改过的包报 mismatched', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const exported = await call(
      routes.get('/dsh-qq-vault/export'),
      makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot' }),
    );
    assert.equal(exported.status, 200);
    const bundlePath = path.join(env.backupDir, String(exported.headers['content-disposition']).match(/filename="(.+)"/)[1]);
    assert.ok(fs.existsSync(bundlePath), '导出文件应落在备份目录');

    // 正常包：preview 的 integrity 应为 ok
    const goodPreview = await call(
      routes.get('/dsh-qq-vault/preview-import'),
      makeReq({ url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(bundlePath)}` }),
    );
    assert.equal(goodPreview.status, 200);
    assert.equal(goodPreview.json.integrity.ok, true);
    assert.equal(goodPreview.json.integrity.blocked, false);
    assert.ok(goodPreview.json.integrity.checked >= 1);

    // 篡改包：integrity 失败且 blocked
    const tampered = tamperBundle(bundlePath);
    const badPreview = await call(
      routes.get('/dsh-qq-vault/preview-import'),
      makeReq({ url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(tampered)}` }),
    );
    assert.equal(badPreview.status, 200);
    assert.equal(badPreview.json.integrity.ok, false);
    assert.equal(badPreview.json.integrity.blocked, true);
    assert.ok(badPreview.json.integrity.mismatched.some((m) => m.path === 'items/qqbot.onebot.yml'));

    // force 之后不 blocked（但仍如实报告 ok:false）
    const forced = await call(
      routes.get('/dsh-qq-vault/preview-import'),
      makeReq({ url: `/dsh-qq-vault/preview-import?force=1&path=${encodeURIComponent(tampered)}` }),
    );
    assert.equal(forced.json.integrity.ok, false);
    assert.equal(forced.json.integrity.blocked, false);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('verifyBundleIntegrity：缺文件算失败；旧包无 sha256 只跳过不拦', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-integrity-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    const good = verifyBundleIntegrity(dir, { files: [{ path: 'a.txt', sha256: crypto.createHash('sha256').update('hello').digest('hex') }] });
    assert.equal(good.ok, true);
    assert.equal(good.checked, 1);

    const missing = verifyBundleIntegrity(dir, { files: [{ path: 'nope.txt', sha256: 'x' }] });
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missing, ['nope.txt']);

    const legacy = verifyBundleIntegrity(dir, { files: [{ path: 'a.txt' }] });
    assert.equal(legacy.ok, true, '旧包没有 sha256 时不应拦');
    assert.equal(legacy.skipped.length, 1);
    assert.equal(verifyBundleIntegrity(dir, {}).skipped.length, 1, 'manifest 没有 files 时给提示');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('token 错误码：缺失 / 无效 / 路径不匹配（不消费）/ 已使用', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const exported = await call(routes.get('/dsh-qq-vault/export'), makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot' }));
    const bundlePath = path.join(env.backupDir, String(exported.headers['content-disposition']).match(/filename="(.+)"/)[1]);

    // 缺失
    const missing = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&path=${encodeURIComponent(bundlePath)}` }));
    assert.equal(missing.status, 400);
    assert.equal(missing.json.code, 'token-missing');

    // 无效
    const invalid = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&path=${encodeURIComponent(bundlePath)}&token=nope` }));
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.code, 'token-invalid');

    // 先预览拿真 token
    const preview = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({ url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(bundlePath)}` }));
    const token = preview.json.token;
    assert.ok(token);

    // 路径不匹配：报 mismatch，且**不应消费** token
    const otherPath = path.join(env.backupDir, 'other.tar.gz');
    fs.copyFileSync(bundlePath, otherPath);
    const mismatch = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&path=${encodeURIComponent(otherPath)}&token=${token}` }));
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.code, 'token-mismatch');

    // token 仍可用于原文件
    const ok = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&items=qqbot.onebot&path=${encodeURIComponent(bundlePath)}&token=${token}` }));
    assert.equal(ok.status, 200, `原文件应仍可导入，实际：${ok.text.slice(0, 200)}`);

    // 重放：同 token 再来一次 → token-used
    const replay = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&items=qqbot.onebot&path=${encodeURIComponent(bundlePath)}&token=${token}` }));
    assert.equal(replay.status, 400);
    assert.equal(replay.json.code, 'token-used');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('token 过期：超过 5 分钟后报 token-expired（用 Date.now 替身）', async () => {
  const env = makeEnv();
  const realNow = Date.now;
  try {
    const { routes } = bootPlugin(env);
    const exported = await call(routes.get('/dsh-qq-vault/export'), makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot' }));
    const bundlePath = path.join(env.backupDir, String(exported.headers['content-disposition']).match(/filename="(.+)"/)[1]);
    const preview = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({ url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(bundlePath)}` }));
    const token = preview.json.token;

    const base = Date.now();
    Date.now = () => base + 6 * 60 * 1000; // 往后跳 6 分钟
    const expired = await call(routes.get('/dsh-qq-vault/import'), makeReq({ url: `/dsh-qq-vault/import?write=1&path=${encodeURIComponent(bundlePath)}&token=${token}` }));
    assert.equal(expired.status, 400);
    assert.equal(expired.json.code, 'token-expired');
  } finally {
    Date.now = realNow;
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('结构化错误：失败响应同时带 code / message / error（兼容旧客户端）', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(
      routes.get('/dsh-qq-vault/preview-import'),
      makeReq({ url: '/dsh-qq-vault/preview-import?path=' + encodeURIComponent(path.join(env.backupDir, 'missing.tar.gz')) }),
    );
    assert.equal(res.status, 404);
    assert.equal(res.json.ok, false);
    assert.equal(res.json.code, 'not-found');
    assert.equal(typeof res.json.message, 'string');
    assert.equal(res.json.error, res.json.message, 'error 必须与 message 同值，兼容 0.2.0 客户端');
    assert.ok(Array.isArray([res.json.backupDir]) || typeof res.json.backupDir === 'string');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('启动清理：7 天前的包会被删，新的保留', () => {
  const env = makeEnv();
  try {
    const paths = resolvePaths({ home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
    const oldFile = path.join(env.backupDir, 'qqbot-vault-20260101-000000.tar.gz');
    const newFile = path.join(env.backupDir, 'qqbot-vault-20260105-000000.tar.gz');
    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');
    const now = new Date('2026-01-10T00:00:00Z');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newFile, new Date('2026-01-09T00:00:00Z'), new Date('2026-01-09T00:00:00Z'));
    const swept = cleanupBundles({ paths, keep: 10, maxAgeDays: 7, write: true, now });
    assert.equal(swept.deleted.length, 1);
    assert.equal(swept.deleted[0].name, 'qqbot-vault-20260101-000000.tar.gz');
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(newFile), true);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('导出包里的 gzip 头与 manifest 早于清单（walkFiles 不会把 manifest 算进 sha256）', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const exported = await call(routes.get('/dsh-qq-vault/export'), makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot,qqbot.persona' }));
    const buf = exported.buf;
    assert.equal(buf[0], 0x1f);
    assert.equal(buf[1], 0x8b);
    const tar = zlib.gunzipSync(buf).toString('latin1');
    assert.ok(tar.includes('manifest.json'));
    assert.ok(tar.includes('items/qqbot.onebot.yml'), '逐项后包内是 items/<id>.yml');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('路由注册走 ctx.effect：卸载时 disposer 必须真的把路由摘掉（真机 bug 回归）', () => {
  const env = makeEnv();
  try {
    const { server, routes } = fakeServer();
    const effects = [];
    const ctx = {
      get: (name) => (name === 'webServer' ? server : undefined),
      on: () => { throw new Error('不应走 ctx.on(dispose) 兜底：有 effect 就该用 effect'); },
      effect: (callback, label) => {
        const dispose = callback();
        effects.push({ label, dispose });
        return () => {};
      },
      logger: { info: () => {}, warn: () => {} },
    };
    apply(ctx, { home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });

    assert.equal(routes.size, 8, '应注册 8 条路由（含逐项发现的 /items）');
    assert.equal(effects.length, 8, '每条路由都应登记一个 effect（含 /items）');
    assert.ok(effects.every((entry) => typeof entry.dispose === 'function'), 'effect 回调必须返回 disposer');

    // 模拟插件卸载：执行所有 disposer，路由必须消失
    for (const entry of effects) entry.dispose();
    assert.equal(routes.size, 0, '卸载后不应残留任何路由（否则重载会撞同名路径、旧 handler 继续生效）');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});
