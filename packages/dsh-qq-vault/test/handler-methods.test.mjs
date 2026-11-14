import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 回归护栏：**webServer 路由只能是 GET**，POST 只允许走 Connection 的 exact 路由表。
 *
 * 背景（两次真机事故）：
 *  1. 0.1.0 用 `method:'POST'` 打 webServer 路由 → DSH 的 HTTP 层在匹配前就 405
 *     （`dsh-host-webserver/lib/index.js:428`、`:600`，`RESOURCE_METHODS = "GET, HEAD"`），
 *     上传永远不可能工作。
 *  2. 0.2.0 因此把上传整个删掉，只留"把文件放服务器再选"。
 *  3. 0.4.0 找到正规通路：Connection 的 fetch registry 支持 POST + streaming
 *     （`dsh-client-connection/lib/types/rpc.d.ts:119` 的 ConnectionFetchRoute，
 *     path 是「/api 下的绝对路径」，`requestBody` 可 `streaming`），
 *     官方 `dsh-client-file-upload` 的 `/api/session/uploadFileBinary` 同样写法。
 *
 * 于是规则变成两条，都必须锁住：
 *   - webServer 路由：仍然只许 GET（`route()` 包装里也再兜一次 405）；
 *   - 唯一的 POST 上传：必须挂在 `connection.fetch.register` 上，且 handler 里
 *     有 method / content-type / 大小上限三道校验，不能裸奔。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(here, '..', 'lib');

/** 读源码并去掉注释，避免把说明文字里的 POST 当成实现。 */
function readCodeWithoutComments(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const read = (rel) => readCodeWithoutComments(path.join(libDir, rel));

test('webServer 路由只用 GET：客户端与 host 都不许给 webServer 发 POST', () => {
  const host = read('index.js');
  // 允许 connection.fetch 那条 POST，所以只检查 webServer.register 的入参里没有 method 字段
  const webServerRegistrations = host.match(/webServer\.register\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(webServerRegistrations.length > 0, '应当能找到 webServer.register 调用');
  for (const call of webServerRegistrations) {
    assert.equal(/method\s*:/.test(call), false, `webServer.register 不接受 method 指定：${call.slice(0, 80)}`);
  }

  // 客户端：只有上传那一处可以 POST，且必须指向 /api 下的上传路由
  const client = read(path.join('client', 'vault.js'));
  const posts = client.match(/method:\s*['"]POST['"]/gi) ?? [];
  assert.equal(posts.length, 1, `客户端只应有一处 POST（上传），实际 ${posts.length} 处`);
  assert.match(client, /UPLOAD_PATH\s*=\s*['"]\/api\/dsh-qq-vault\/upload['"]/, '上传必须打到 /api 下的 Connection 路由');
});

test('上传 handler 有三道校验：method / content-type / 大小上限', () => {
  const host = read('index.js');
  const start = host.indexOf('export async function handleUploadRequest');
  assert.ok(start >= 0, '应有 handleUploadRequest');
  const body = host.slice(start, start + 4000);

  assert.match(body, /method|req\.method/i, '必须校验 HTTP 方法');
  assert.match(body, /content-type/i, '必须校验 content-type');
  assert.match(body, /MAX_BYTES/, '必须有大小上限常量');
  assert.match(body, /0x1f|0x8b/, '必须校验 gzip 魔数（别让任意文件进备份目录）');
  assert.match(body, /0o600/, '落盘权限必须是 0600（备份含 token）');
});

test('上传路由注册在 connection.fetch 上，且用 ctx.effect 注销', () => {
  const host = read('index.js');
  assert.match(host, /connection\.fetch/, '上传必须走 Connection 的 fetch registry');
  assert.match(host, /methods:\s*\[\s*['"]POST['"]\s*\]/, '该路由应显式声明 POST');
  assert.match(host, /requestBody:\s*['"]streaming['"]/, '应声明流式 body（备份包可能几十 MB）');
  assert.match(host, /ctx\.effect\(\(\)\s*=>\s*registry\.register|ctx\.effect\(\(\)\s*=>\s*\{[^}]*registry\.register/s, '注册必须包在 ctx.effect 里（否则关插件后 handler 残留）');
});

test('上传路由的 path 必须带 /api 前缀（真机 404 的教训）', () => {
  const host = read('index.js');
  const start = host.indexOf('registry.register');
  assert.ok(start >= 0, '应有 registry.register');
  const body = host.slice(start, start + 400);
  // 官方 file-upload 注册的是 `/api/session/uploadFileBinary` 全路径；
  // 只写 `/dsh-qq-vault/upload` 时真机 POST 会 404（路由不在 /api 表里）。
  assert.ok(body.includes('/api${ROUTE_PREFIX}/upload'), 'path 必须带 /api 前缀');
  assert.equal(body.includes('path: `${ROUTE_PREFIX}/upload`'), false, '不要再用没有 /api 的短路径');
});

test('GET 路由集合仍是既有那批（没有偷偷变成 POST）', () => {
  const host = read('index.js');
  const paths = [...host.matchAll(/\[['"]exact['"],\s*`\$\{ROUTE_PREFIX\}\/([a-z-]+)`/g)].map((m) => m[1]);
  for (const expected of ['capabilities', 'list-bundles', 'cleanup', 'plan', 'export', 'preview-import', 'import']) {
    assert.ok(paths.includes(expected), `缺少 GET 路由 ${expected}（实际：${paths.join(',')}）`);
  }
});

test('客户端确实用到了 list-bundles / cleanup / upload', () => {
  const client = read(path.join('client', 'vault.js'));
  assert.match(client, /\/list-bundles/, '客户端应使用 list-bundles');
  assert.match(client, /\/cleanup/, '客户端应使用 cleanup');
  assert.match(client, /UPLOAD_PATH/, '客户端应引用上传路径');
  assert.match(client, /doUpload/, '客户端应有上传流程');
});

test('客户端是逐项交互：/items 拉清单、/preview-import 逐项对比、import 带 items', () => {
  const client = read(path.join('client', 'vault.js'));
  assert.match(client, /'\/items'/, '应从 /items 拉配置项清单（不再写死四项）');
  assert.match(client, /incoming/, '预览要用逐项的 incoming 侧数据');
  assert.match(client, /全选变更/, '应能一键全选变更项');
  assert.match(client, /items: ids\.join/, '导入时必须把选中的 item 集合传给 host');
});
