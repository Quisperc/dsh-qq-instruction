import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { URL } from 'node:url';
import zlib from 'node:zlib';

/**
 * 真机检查：打运行中的 DSH（默认 http://127.0.0.1:3080）。
 *
 * 默认 **skip**，只有 `VAULT_LIVE=1` 才跑——普通单测不该依赖宿主是否活着。
 *   VAULT_LIVE=1 node --test test/live.mjs
 *
 * 存在的理由：单测用的是假 webServer，测不到「宿主里是否真的挂上了」。
 * 2026-11-14 就踩过两次：一次是一条路由都没注册（inject 没声明 webServer），
 * 一次是重载后旧 handler 残留（ctx.on('dispose') 没触发）。
 */

const LIVE = process.env.VAULT_LIVE === '1';
const BASE = process.env.VAULT_BASE ?? 'http://127.0.0.1:3080';

function httpRequest(url, options = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(target, { method: options.method ?? 'GET', headers: options.headers ?? {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

test('真机：capabilities 带 backupDir 与 supported:false（0.3.0 标志）', { skip: !LIVE }, async () => {
  const res = await httpRequest(`${BASE}/dsh-qq-vault/capabilities`);
  assert.equal(res.status, 200, '路由应可访问（401/404 说明没挂上或鉴权拦了）');
  const body = JSON.parse(res.body.toString('utf8'));
  assert.equal(body.ok, true);
  assert.equal(typeof body.backupDir, 'string', '缺少 backupDir：跑的是旧版 handler（需重启清残留路由）');
  const sessions = (body.skipped || []).find((item) => item.key === 'sessions');
  assert.ok(sessions, '缺少 sessions 未实现项');
  assert.equal(sessions.supported, false, 'sessions 必须标记 supported:false');
  assert.equal(typeof body.tokenTtlSeconds, 'number');
});

test('真机：7 条路由都存在且 /list-bundles 结构正确', { skip: !LIVE }, async () => {
  const listed = await httpRequest(`${BASE}/dsh-qq-vault/list-bundles`);
  assert.equal(listed.status, 200);
  const body = JSON.parse(listed.body.toString('utf8'));
  assert.equal(body.ok, true);
  assert.equal(typeof body.dir, 'string');
  assert.ok(Array.isArray(body.files));
  for (const file of body.files) {
    assert.ok(/^qqbot-vault-.+\.tar\.gz$/.test(file.name), `列表里混进了非本插件的文件：${file.name}`);
  }
});

test('真机：cleanup 默认 dry-run（不删）', { skip: !LIVE }, async () => {
  const res = await httpRequest(`${BASE}/dsh-qq-vault/cleanup`);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body.toString('utf8'));
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true, '不带 write=1 时必须 dry-run');
});

test('真机：export 是 gzip 附件', { skip: !LIVE }, async () => {
  const res = await httpRequest(`${BASE}/dsh-qq-vault/export?include=config`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type'] || ''), /gzip/);
  assert.match(String(res.headers['content-disposition'] || ''), /attachment/);
  assert.equal(res.body[0], 0x1f);
  assert.equal(res.body[1], 0x8b);
  // 解出来应包含 manifest
  const tar = zlib.gunzipSync(res.body).toString('latin1');
  assert.ok(tar.includes('manifest.json'));
});

test('真机：非 GET 一律 405（平台护栏）', { skip: !LIVE }, async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await httpRequest(`${BASE}/dsh-qq-vault/plan`, { method });
    assert.equal(res.status, 405, `${method} 应被平台挡成 405，实际 ${res.status}`);
  }
});

test('真机：导入必须带一次性码', { skip: !LIVE }, async () => {
  const res = await httpRequest(`${BASE}/dsh-qq-vault/import?path=x.tar.gz&write=1`);
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body.toString('utf8'));
  assert.equal(body.ok, false);
  assert.equal(body.code, 'token-missing', '无 token 应回 token-missing');
});
