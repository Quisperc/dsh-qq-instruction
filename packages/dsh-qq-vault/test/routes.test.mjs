import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { apply, inject } from '../lib/index.js';

/**
 * 假 webServer：把注册的路由收进 map，并**复刻平台的方法闸**——
 * 非 GET/HEAD 在路由匹配前直接 405（dsh-host-webserver/lib/index.js:428 / :600）。
 * 这样一旦有人又写出依赖 POST 的端点，测试会立刻暴露。
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
        let off = false;
        return () => { off = true; routes.delete(options.path); };
      },
    },
  };
}

/** 模拟平台：非 GET/HEAD 直接 405，不进入我们的 handler。 */
function platformDispatch(routes, req, res) {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('method not allowed\n');
    return true;
  }
  const pathname = String(req.url ?? '/').split('?')[0];
  const handler = routes.get(pathname);
  if (handler === undefined) return false;
  return handler(req, res);
}

/** 造一个能当 req 用的对象（GET：没有 body）。 */
function makeReq({ url = '/', method = 'GET', host = '127.0.0.1:3080', origin } = {}) {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = { host };
  if (origin !== undefined) req.headers.origin = origin;
  req.destroy = () => {};
  return req;
}

/** 造一个收集响应的 res。 */
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
  await new Promise((r) => setTimeout(r, 20));
  return res;
}

/** 造一套合成环境（profile + 人格 + 记忆）。 */
function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-routes-'));
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
  return { root, workspace, repoRoot, profileDir };
}

function bootPlugin(env, options = {}) {
  const { server, routes } = fakeServer(options);
  const logs = [];
  const ctx = {
    get: (name) => (name === 'webServer' ? server : undefined),
    on: () => {},
    logger: { info: (m) => logs.push(`info:${m}`), warn: (m) => logs.push(`warn:${m}`) },
  };
  apply(ctx, { home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
  return { routes, logs, server };
}

test('inject 必须声明 webServer（否则 apply 早于服务就绪，路由一条都挂不上）', () => {
  assert.ok(Array.isArray(inject), 'inject 必须是数组');
  assert.ok(inject.includes('webServer'), `inject 必须包含 webServer，实际：${JSON.stringify(inject)}`);
});

test('注册全部 8 条 GET 路由', () => {
  const env = makeEnv();
  try {
    const { routes, logs } = bootPlugin(env);
    const expected = ['capabilities', 'items', 'list-bundles', 'cleanup', 'plan', 'export', 'preview-import', 'import'];
    for (const name of expected) {
      assert.ok(routes.has(`/dsh-qq-vault/${name}`), `缺少路由 ${name}`);
    }
    assert.equal(routes.size, expected.length, '不应再有 upload/download 端点（0.3.0 新增 list-bundles / cleanup）');
    assert.ok(logs.some((l) => l.includes('已挂 8 条 GET 路由')), `日志应报告路由数：${logs.join(' | ')}`);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('任何非 GET 请求都被平台挡成 405（我们的路由不接非 GET）', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const routePath of ['/dsh-qq-vault/plan', '/dsh-qq-vault/export', '/dsh-qq-vault/import']) {
        const req = makeReq({ url: routePath, method });
        const res = makeRes();
        const handled = platformDispatch(routes, req, res);
        assert.equal(handled, true, `${method} ${routePath} 应被平台拦下`);
        assert.equal(res.status, 405, `${method} ${routePath} 应为 405`);
      }
    }
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('跨源请求被 401 挡下', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(routes.get('/dsh-qq-vault/capabilities'), makeReq({ origin: 'https://evil.example' }));
    assert.equal(res.status, 401);
    assert.match(res.text, /cross-origin/);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('capabilities 返回可勾选项与未实现项', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(routes.get('/dsh-qq-vault/capabilities'), makeReq({ url: '/dsh-qq-vault/capabilities' }));
    assert.equal(res.status, 200);
    const data = res.json;
    assert.equal(data.granular, true, '应声明支持逐项');
    assert.equal(data.itemsEndpoint, '/dsh-qq-vault/items');
    assert.ok(Array.isArray(data.groups) && data.groups.length > 0, '应返回分组');
    assert.ok(data.skipped.some((s) => s.key === 'sessions'));
    // 敏感标记改为逐项返回（/items），capabilities 不再给全局映射
    assert.equal(data.specialItems.memoryDb, 'memory.db');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('plan 只算不写，参数走 query', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(routes.get('/dsh-qq-vault/plan'), makeReq({ url: '/dsh-qq-vault/plan?items=qqbot.onebot' }));
    assert.equal(res.status, 200);
    assert.equal(res.json.files.length, 1);
    assert.equal(fs.existsSync(path.join(env.root, 'backups')), false);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('export 直接流式下载：attachment + gzip 魔数', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const res = await call(routes.get('/dsh-qq-vault/export'), makeReq({
      url: '/dsh-qq-vault/export?items=qqbot.onebot,memory.db',
    }));
    assert.equal(res.status, 200, res.text);
    const disposition = res.headers['content-disposition'] ?? '';
    assert.match(disposition, /^attachment; filename="qqbot-vault-.*\.tar\.gz"$/, `实际：${disposition}`);
    assert.equal(res.headers['content-type'], 'application/gzip');
    const buf = res.buf;
    assert.ok(buf.length > 0, '应有内容');
    assert.equal(buf[0], 0x1f, 'gzip 魔数第 1 字节');
    assert.equal(buf[1], 0x8b, 'gzip 魔数第 2 字节');
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('完整链路：export → preview（拿 token）→ import（凭 token 写入）', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);

    // 1) 导出（下载响应本身就是包，测试里另存一份到 backupDir 供导入使用）
    const exp = await call(routes.get('/dsh-qq-vault/export'), makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot,memory.db' }));
    assert.equal(exp.status, 200, exp.text);
    const fileName = /filename="([^"]+)"/.exec(exp.headers['content-disposition'])[1];
    const backupDir = path.join(env.root, 'backups', 'qqbot-vault');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, fileName), exp.buf);

    // 2) 只给文件名（不含分隔符）应自动落到 backupDir
    const pv = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({
      url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(fileName)}`,
    }));
    assert.equal(pv.status, 200, pv.text);
    assert.ok(Array.isArray(pv.json.items) && pv.json.items.length >= 1, '预览应逐项返回');
    // 自导自入（同机导出再导回）→ 内容一致，应如实报 same（0.4.0 会一律说 replace）
    assert.equal(pv.json.items.find((i) => i.id === 'qqbot.onebot').action, 'same');
    assert.equal(pv.json.changedCount, 0);
    assert.equal(pv.json.granular === undefined || pv.json.granular === true, true);
    assert.match(pv.json.token, /^[0-9a-f-]{36}$/, '应返回 UUID 形式的一次性确认码');
    assert.equal(pv.json.tokenTtlSeconds, 300);

    // 3) 不带 write=1 必须拒绝
    const noWrite = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent(fileName)}&token=${pv.json.token}`,
    }));
    assert.equal(noWrite.status, 400);
    assert.match(noWrite.json.error, /write=1/);

    // 4) 带 write=1 但没有 token 必须拒绝
    const noToken = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent(fileName)}&write=1`,
    }));
    assert.equal(noToken.status, 400);
    assert.match(noToken.json.error, /确认码/);

    // 5) 错误 token 必须拒绝
    const badToken = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent(fileName)}&write=1&token=00000000-0000-0000-0000-000000000000`,
    }));
    assert.equal(badToken.status, 400);

    // 6) 正确 token → 真导入
    const imported = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent(fileName)}&write=1&items=qqbot.onebot&token=${pv.json.token}`,
    }));
    assert.equal(imported.status, 200, imported.text);
    assert.equal(imported.json.written, true);
    const after = fs.readFileSync(path.join(env.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(after.split('- id: dsh-qq-bot').length - 1, 1, '不能出现两段');
    assert.ok(fs.readdirSync(env.profileDir).some((n) => n.includes('.bak-vault-')));

    // 7) 重放同一个 token 必须拒绝（一次性）
    const replay = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent(fileName)}&write=1&token=${pv.json.token}`,
    }));
    assert.equal(replay.status, 400);
    assert.match(replay.json.error, /无效|用过|过期/);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('token 与目标文件绑定：换个路径不认', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const exp = await call(routes.get('/dsh-qq-vault/export'), makeReq({ url: '/dsh-qq-vault/export?items=qqbot.onebot' }));
    const fileName = /filename="([^"]+)"/.exec(exp.headers['content-disposition'])[1];
    const backupDir = path.join(env.root, 'backups', 'qqbot-vault');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, fileName), exp.buf);
    fs.writeFileSync(path.join(backupDir, 'other.tar.gz'), exp.buf);

    const pv = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({
      url: `/dsh-qq-vault/preview-import?path=${encodeURIComponent(fileName)}`,
    }));
    assert.equal(pv.status, 200, pv.text);

    const mismatch = await call(routes.get('/dsh-qq-vault/import'), makeReq({
      url: `/dsh-qq-vault/import?path=${encodeURIComponent('other.tar.gz')}&write=1&token=${pv.json.token}`,
    }));
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.json.error, /不匹配/);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('preview-import 缺 path → 400；文件不存在 → 404', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    const missing = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({ url: '/dsh-qq-vault/preview-import' }));
    assert.equal(missing.status, 400);
    assert.match(missing.json.error, /path/);

    const notFound = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({
      url: '/dsh-qq-vault/preview-import?path=nope.tar.gz',
    }));
    assert.equal(notFound.status, 404);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('路径穿越被挡：用绝对路径指向别处也不会读到 patch 之外的边界问题', async () => {
  const env = makeEnv();
  try {
    const { routes } = bootPlugin(env);
    // 传 .. 的 basename 会被 basename() 收敛到 backupDir 下，随后 404
    const res = await call(routes.get('/dsh-qq-vault/preview-import'), makeReq({
      url: '/dsh-qq-vault/preview-import?path=..%2F..%2Fcordis.patch.yml',
    }));
    assert.ok(res.status === 404 || res.status === 400, `实际 ${res.status}`);
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('拿不到 webServer 时降级为只 warn，并明确说「路由未注册」', () => {
  const logs = [];
  const ctx = { get: () => undefined, on: () => {}, logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) } };
  assert.doesNotThrow(() => apply(ctx, {}));
  assert.ok(logs.some((l) => l.includes('拿不到 webServer')), logs.join(' | '));
  assert.ok(logs.some((l) => l.includes('路由未注册')), `应明确说明未注册：${logs.join(' | ')}`);
});

test('启动自检：能拿到 origin 时打一次 GET 并记录状态码', async () => {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  const seen = [];
  const logs = [];
  try {
    const { server } = fakeServer({ origin: 'http://127.0.0.1:3999' });
    globalThis.fetch = async (url, options) => {
      seen.push({ url: String(url), method: options?.method });
      return { status: 401 };
    };
    const ctx = {
      get: (name) => (name === 'webServer' ? server : undefined),
      on: () => {},
      logger: { info: (m) => logs.push(`info:${m}`), warn: (m) => logs.push(`warn:${m}`) },
    };
    apply(ctx, { home: env.root, profile: 'web', workspace: env.workspace, repoRoot: env.repoRoot });
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(seen.length, 1, '应发一次自检请求');
    assert.equal(seen[0].method, 'GET');
    assert.match(seen[0].url, /^http:\/\/127\.0\.0\.1:3999\/dsh-qq-vault\/capabilities$/);
    assert.ok(logs.some((l) => l.includes('启动自检') && l.includes('401')), logs.join(' | '));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});
