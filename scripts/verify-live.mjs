#!/usr/bin/env node
/**
 * 真机自检：对**运行中**的 DSH Web 服务做一轮端到端检查，只读、不发消息、不改配置。
 *
 * 为什么需要它：
 *   2026-11-14 的两个 bug（vault 路由 404/405、whale 设置页没有表单）都是
 *   「单测全绿但真机不可用」——因为单测没跑真实的 webserver 与客户端装配。
 *   这个脚本补的就是这一层：curl 能看到的，全部自动断言。
 *
 * 用法：
 *   node scripts/verify-live.mjs                       # 默认 http://127.0.0.1:3080
 *   node scripts/verify-live.mjs --base http://host:3080
 *   node scripts/verify-live.mjs --json                # 机器可读输出
 *
 * 退出码：全部通过 0；有任何失败 1。
 */

import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import zlib from 'node:zlib';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base ?? 'http://127.0.0.1:3080';
const JSON_OUT = args.json === true;

/**
 * 解析 `--k v` / `--flag`。
 * @param {string[]} argv
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

/**
 * 发一个 HTTP 请求，返回状态码、头与 body（二进制）。
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>}} [options]
 * @returns {Promise<{status:number, headers:Record<string,string|string[]|undefined>, body:Buffer}>}
 */
function httpRequest(url, options = {}) {
  const target = new URL(url);
  const send = target.protocol === 'https:' ? httpsRequest : request;
  return new Promise((resolve, reject) => {
    const req = send(target, { method: options.method ?? 'GET', headers: options.headers ?? {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** @type {{name:string, ok:boolean, detail:string}[]} */
const results = [];

/**
 * 记录一条断言。
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

/**
 * 跑一条命名的检查；抛错记为失败而不是中断整轮。
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function step(name, fn) {
  try { await fn(); }
  catch (error) { check(name, false, `异常：${error?.message ?? error}`); }
}

await step('首页可访问', async () => {
  const r = await httpRequest(`${BASE}/`);
  check('首页可访问', r.status === 200, `HTTP ${r.status}`);
});

let indexPath = '';
await step('客户端模块清单', async () => {
  const r = await httpRequest(`${BASE}/`);
  indexPath = r.body.toString('utf8');
  for (const pkg of ['dsh-qq-whale/client.js', 'dsh-qq-vault/client.js']) {
    check(`客户端模块已列入 boot：${pkg}`, indexPath.includes(pkg), indexPath.includes(pkg) ? '已列出' : '未列出（插件未启用或 client 半缺失）');
  }
});

await step('vault capabilities', async () => {
  const r = await httpRequest(`${BASE}/dsh-qq-vault/capabilities`);
  check('vault /capabilities', r.status === 200, `HTTP ${r.status}`);
  if (r.status === 200) {
    let parsed = null;
    try { parsed = JSON.parse(r.body.toString('utf8')); } catch { /* 下面按失败处理 */ }
    check('vault capabilities 是合法 JSON', parsed !== null, parsed === null ? '解析失败' : 'ok');
  }
});

await step('vault plan', async () => {
  const r = await httpRequest(`${BASE}/dsh-qq-vault/plan?items=qqbot.onebot,qqbot.persona`);
  check('vault /plan', r.status === 200, `HTTP ${r.status}`);
});

await step('vault export', async () => {
  const r = await httpRequest(`${BASE}/dsh-qq-vault/export?items=qqbot.onebot`);
  check('vault /export 状态码', r.status === 200, `HTTP ${r.status}`);
  const ct = String(r.headers['content-type'] ?? '');
  check('vault /export content-type', ct.includes('gzip'), ct || '(空)');
  const cd = String(r.headers['content-disposition'] ?? '');
  check('vault /export 触发下载', cd.includes('attachment'), cd || '(空)');
  const magic = r.body.subarray(0, 2);
  check('vault /export 是 gzip', magic[0] === 0x1f && magic[1] === 0x8b, `magic=${magic.toString('hex')}`);
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    const tar = zlib.gunzipSync(r.body);
    const text = tar.toString('latin1');
    check('导出包内含 manifest.json', text.includes('manifest.json'), text.includes('manifest.json') ? 'ok' : '缺失');
    check('导出包是逐项布局（items/<id>.yml）', text.includes('items/qqbot.onebot.yml'), text.includes('items/qqbot.onebot.yml') ? 'ok' : '缺 items/qqbot.onebot.yml');
  }
});

await step('vault 非 GET 一律 405', async () => {
  for (const [method, path] of [['POST', '/dsh-qq-vault/plan'], ['PUT', '/dsh-qq-vault/export']]) {
    const r = await httpRequest(`${BASE}${path}`, { method });
    check(`${method} ${path} 必须 405`, r.status === 405, `HTTP ${r.status}`);
  }
});

await step('vault 导入必须带一次性码', async () => {
  const r = await httpRequest(`${BASE}/dsh-qq-vault/import?path=x.tgz&write=1`);
  check('无 token 的导入被拒', r.status === 400, `HTTP ${r.status}`);
});

// 汇总
const failed = results.filter((r) => !r.ok);
if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify({ base: BASE, total: results.length, failed: failed.length, results }, null, 2)}\n`);
} else {
  for (const r of results) {
    process.stdout.write(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` —— ${r.detail}` : ''}\n`);
  }
  process.stdout.write(`\n共 ${results.length} 项：${results.length - failed.length} 通过 / ${failed.length} 失败\n`);
}
process.exit(failed.length === 0 ? 0 : 1);
