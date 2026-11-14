/**
 * dsh-qq-vault —— Host 半：把「导出 / 预览导入 / 确认导入」暴露成受鉴权的 HTTP 路由。
 *
 * ⚠️ **只能 GET**（0.2.0 起的硬约束，真机踩过）：
 *   DSH 的 HTTP 服务在路由匹配**之前**就把非 GET/HEAD 请求挡成 405
 *   （`dsh-host-webserver/lib/index.js:428` 与 `:600`，`RESOURCE_METHODS` 只有 GET/HEAD）。
 *   所以 0.1.0 里那些 `method:'POST'` + JSON body 的路由**永远不可能工作**。
 *   现在所有参数走 query string；上传端点直接删掉（GET 带不了 body），
 *   导入只接受「服务器上已有文件的路径」，先由 preview 换一次性 token，再凭 token 执行。
 *
 * 安全（照抄 dsh-qq-bot 的结论，见它 lib/gateway/route-auth.js 的注释）：
 *   插件具名路由在 DSH 鉴权层**之前**被处理 —— `/api/*` 回 401 而 `/dsh-qq-vault/*` 回 200。
 *   所以这里自己加两道闸：同源校验 + `connection.browserAuth.isAuthenticated()`。
 *   拿不到 browserAuth 时只做同源校验并告警一次（老版本 DSH / 桌面端没有鉴权层）。
 *
 * 降级：拿不到 webServer 就只打印一句 warn —— 核心逻辑仍在 `lib/bundle.js`。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  ERROR_CODES,
  SPECIAL_ITEMS,
  SKIPPED,
  cleanupBundles,
  collectItems,
  failure,
  listBundles,
  parseItemIds,
  planExport,
  previewImport,
  resolvePaths,
  runExport,
  runImport,
} from './bundle.js';

export const name = 'dsh-qq-vault';

/**
 * 必须声明 `webServer`：`inject` 为空时 `apply()` 会在服务就绪**之前**执行，
 * `ctx.get('webServer')` 拿到 undefined → 走进降级分支 return → **一条路由都没注册**
 * （真机现象：GET /dsh-qq-vault/plan 404、POST 同路径 405，看着像方法问题，其实是没挂上）。
 *
 * 不声明 `connection`：`createGuard` 是**请求期惰性**取 browserAuth 的
 * （桌面端/老版本没有鉴权层时要能降级），声明成 inject 会让这类宿主永远不激活本插件。
 */
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dsh-qq-vault';
/** 一次性确认码有效期：5 分钟。 */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/** 统一的 JSON 响应（永不抛）。 */
function json(res, status, payload) {
  try {
    const body = `${JSON.stringify(payload)}\n`;
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch { /* 响应已发出 */ }
}

function text(res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  } catch { /* 响应已发出 */ }
}

/** 同源校验：带了 Origin/Referer 就必须与 Host 一致。 */
function sameOrigin(req) {
  const headers = req?.headers ?? {};
  const host = String(headers.host ?? '');
  if (host === '') return false;
  const check = (raw) => {
    if (raw === undefined || raw === null || raw === '') return true;
    const value = String(raw);
    if (value === 'null') return false;
    try { return new URL(value).host === host; } catch { return false; }
  };
  return check(headers.origin) === true && check(headers.referer) === true;
}

/** 造鉴权闸门：返回 (req,res) => boolean。 */
function createGuard(ctx, log) {
  let warned = false;
  const browserAuthOf = () => {
    for (const serviceName of ['connection', 'client-connection']) {
      try {
        const connection = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined;
        const auth = connection?.browserAuth;
        if (auth !== null && auth !== undefined && typeof auth.isAuthenticated === 'function') return auth;
      } catch { /* 试下一个名字 */ }
    }
    return null;
  };
  const isSecure = () => {
    try {
      const server = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
      return server?.protocol === 'https:';
    } catch { return false; }
  };

  return (req, res) => {
    if (sameOrigin(req) !== true) {
      text(res, 401, 'cross-origin request rejected\n');
      return false;
    }
    const auth = browserAuthOf();
    if (auth === null) {
      if (warned !== true) {
        warned = true;
        log('拿不到 connection.browserAuth：HTTP 路由只做同源校验');
      }
      return true;
    }
    let authed = false;
    try { authed = auth.isAuthenticated(req, isSecure()) === true; } catch { authed = false; }
    if (authed !== true) {
      text(res, 401, 'dsh web authentication required; reopen the URL printed by dsh web.\n');
      return false;
    }
    return true;
  };
}

/** 解析 query（只支持 GET，所以只看 URL）。 */
function queryOf(req) {
  try {
    return new URL(String(req?.url ?? ''), 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * `?items=qqbot.onebot,qqbot.group` → 数组；空值返回 undefined（= 全部）。
 * 0.5.0 起用 item id 取代原来的 include 键（config/persona/memory/whaleConfig）。
 */
function itemsOf(params) {
  const raw = params.get('items');
  if (raw === null || raw === '') return undefined;
  return parseItemIds(raw);
}

/** 把 `?path=` 解析成绝对路径：纯文件名落到 backups/qqbot-vault 下。 */
function resolveBundlePath(rawPath, paths) {
  const raw = String(rawPath ?? '').trim();
  if (raw === '') return undefined;
  if (raw.includes('/') || raw.includes('\\')) return path.resolve(raw);
  return path.join(paths.backupDir, path.basename(raw));
}

/** 流式下载一个文件（GET 专用；非流式 res 退回整块写）。 */
function sendFile(res, filePath, fileName) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-length': String(stat.size),
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'no-store',
  });
  const stream = fs.createReadStream(filePath);
  const streamable = typeof res.write === 'function' && typeof res.on === 'function' && typeof stream.pipe === 'function';
  if (streamable) {
    stream.on('error', () => { try { res.end(); } catch { /* 已结束 */ } });
    stream.pipe(res);
  } else {
    res.end(fs.readFileSync(filePath));
  }
}

/**
 * 一次性确认码：preview-import 发放，import 消费。
 * 内存 Map，5 分钟过期，只能用一次；进程重启即失效（导入本就该人工在场）。
 *
 * 0.5.0 起额外绑定**预览时的 item 集合**：
 *   - 换包 → path 不匹配，拒绝；
 *   - 要应用一个没预览过的项 → 集合校验拒绝（不许"预览 3 项、实际写第 4 项"）；
 *   - 应用**子集**是允许的（比预览更少永远更安全，也符合"只勾我要的"这个用法）。
 *
 * 为什么要记 `used`：0.2.0 把「不存在」和「已用过」混成同一句提示，
 * 用户按提示重新预览却不知道之前那次其实已经执行过。分开记之后
 * 错误码能准确区分 expired / used / mismatch / invalid。
 */
function createTokenStore() {
  /** @type {Map<string, { path: string, items: string[], expiresAt: number }>} */
  const tokens = new Map();
  /** @type {Map<string, { path: string, usedAt: number }>} */
  const used = new Map();
  /** @type {Map<string, { path: string, expiredAt: number }>} */
  const expired = new Map();

  const sweep = (now) => {
    // 过期不等于忘记：挪进 expired 存 10 分钟，才能对用户说清"过期"而不是"无效"
    for (const [key, value] of tokens) {
      if (value.expiresAt <= now) {
        tokens.delete(key);
        expired.set(key, { path: value.path, expiredAt: value.expiresAt });
      }
    }
    for (const [key, value] of used) if (now - value.usedAt > 10 * 60 * 1000) used.delete(key);
    for (const [key, value] of expired) if (now - value.expiredAt > 10 * 60 * 1000) expired.delete(key);
  };

  return {
    issue(bundlePath, items, now = Date.now()) {
      sweep(now);
      const token = crypto.randomUUID();
      tokens.set(token, {
        path: bundlePath,
        items: Array.isArray(items) ? [...items].sort() : [],
        expiresAt: now + TOKEN_TTL_MS,
      });
      return token;
    },
    /**
     * 校验并消费。
     * @param {string} token
     * @param {string} bundlePath
     * @param {string[]} [items] 本次要应用的项（undefined = 预览时的全部）
     * @returns {{ code?: string, message?: string }}
     */
    consume(token, bundlePath, items, now = Date.now()) {
      if (token === undefined || token === null || token === '') {
        return { code: ERROR_CODES.tokenMissing, message: '缺少一次性确认码（先点「预览」获取）' };
      }
      const entry = tokens.get(token);
      if (entry === undefined) {
        sweep(now);
        const record = used.get(token);
        if (record !== undefined) {
          return {
            code: ERROR_CODES.tokenUsed,
            message: `这个确认码已经用过了（${new Date(record.usedAt).toLocaleTimeString()}）；请重新预览换取新码`,
          };
        }
        if (expired.has(token)) {
          return {
            code: ERROR_CODES.tokenExpired,
            message: `确认码已过期（有效期 ${Math.floor(TOKEN_TTL_MS / 60000)} 分钟）；请重新预览`,
          };
        }
        return { code: ERROR_CODES.tokenInvalid, message: '确认码无效（可能来自重启前的会话）；请重新预览' };
      }
      if (entry.expiresAt <= now) {
        tokens.delete(token);
        expired.set(token, { path: entry.path, expiredAt: entry.expiresAt });
        return {
          code: ERROR_CODES.tokenExpired,
          message: `确认码已过期（有效期 ${Math.floor(TOKEN_TTL_MS / 60000)} 分钟）；请重新预览`,
        };
      }
      if (entry.path !== bundlePath) {
        // 不消费：用户可能只是把路径填错了，改回来还能继续用
        return { code: ERROR_CODES.tokenMismatch, message: '确认码与目标文件不匹配；请对着同一个文件重新预览' };
      }
      if (Array.isArray(items) && items.length > 0) {
        const allowed = new Set(entry.items);
        const extra = items.filter((id) => !allowed.has(id));
        if (extra.length > 0) {
          // 不消费：补一次预览就能拿到覆盖这些项的新码
          return {
            code: ERROR_CODES.tokenMismatch,
            message: `这些项没有在预览里出现过：${extra.join(', ')}；请重新预览后再导入`,
          };
        }
      }
      tokens.delete(token);
      used.set(token, { path: bundlePath, usedAt: now });
      return {};
    },
  };
}

/**
 * 处理一次上传：把请求体流式落盘到 `<backupDir>/uploads/`，返回 uploadId。
 *
 * 为什么流式：备份包可能几十 MB，整块读进内存会把宿主进程顶爆；Connection 的
 * `requestBody: 'streaming'` 正是为这种场景准备的。
 * 为什么限流限大小：这是浏览器可以直接打的端点，不能让它变成"往磁盘无限写"。
 *
 * @param {Request} request Fetch 风格请求（已过 trust + browserAuth，只有 owner Peer 能到）
 * @param {ReturnType<typeof resolvePaths>} paths
 * @param {(message:string)=>void} log
 * @returns {Promise<Response>}
 */
export async function handleUploadRequest(request, paths, log) {
  const MAX_BYTES = 64 * 1024 * 1024;
  const reply = (status, payload) => new Response(`${JSON.stringify(payload)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

  if (String(request?.method ?? '').toUpperCase() !== 'POST') {
    return new Response('method not allowed\n', { status: 405, headers: { allow: 'POST' } });
  }
  const type = String(request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/octet-stream') {
    return reply(415, { ok: false, code: 'bad-request', message: 'content-type 必须是 application/octet-stream' });
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return reply(413, { ok: false, code: 'bad-request', message: `文件太大（上限 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB）` });
  }

  const dir = path.join(paths.backupDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const uploadId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const target = path.join(dir, `${uploadId}.tar.gz`);

  let written = 0;
  try {
    const handle = await fsPromises.open(target, 'w', 0o600);
    try {
      // WHATWG ReadableStream → 逐块写盘；Node 18+ 的 Request.body 就是这种流
      const reader = request.body?.getReader?.();
      if (reader === undefined) {
        // 某些宿主给的是 async iterable
        for await (const chunk of request.body) {
          written += chunk.length;
          if (written > MAX_BYTES) throw new Error('too-large');
          await handle.write(chunk);
        }
      } else {
        for (;;) {
          const { done, value } = await reader.read();
          if (done === true) break;
          written += value.length;
          if (written > MAX_BYTES) throw new Error('too-large');
          await handle.write(value);
        }
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    try { fs.rmSync(target, { force: true }); } catch { /* 忽略 */ }
    if (String(error?.message).includes('too-large')) {
      return reply(413, { ok: false, code: 'bad-request', message: `文件太大（上限 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB）` });
    }
    log(`上传失败：${String(error?.message ?? error)}`);
    return reply(400, { ok: false, code: 'bad-request', message: '上传失败' });
  }

  if (written === 0) {
    try { fs.rmSync(target, { force: true }); } catch { /* 忽略 */ }
    return reply(400, { ok: false, code: 'bad-request', message: '空文件' });
  }
  // gzip 魔数：不做就会让用户把任意文件塞进来，导到一半才报错
  const head = Buffer.alloc(2);
  const fd = fs.openSync(target, 'r');
  try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
  if (!(head[0] === 0x1f && head[1] === 0x8b)) {
    try { fs.rmSync(target, { force: true }); } catch { /* 忽略 */ }
    return reply(400, { ok: false, code: 'bad-request', message: '不是 tar.gz（gzip 魔数不匹配）' });
  }

  return new Response(`${JSON.stringify({ ok: true, uploadId, bytes: written, name: path.basename(target), path: target })}\n`, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * 插件入口。
 * @param {any} ctx Cordis 上下文
 */
export function apply(ctx, rawConfig) {
  const log = (message) => {
    try { ctx.logger?.warn?.(`[dsh-qq-vault] ${message}`); } catch { /* 忽略 */ }
  };

  const config = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {};
  const resolve = () => resolvePaths({
    home: config.home,
    profile: config.profile,
    workspace: config.workspace,
    repoRoot: config.repoRoot,
  });

  let webServer;
  try {
    webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer;
  } catch {
    webServer = undefined;
  }

  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
    log('拿不到 webServer：路由未注册，设置页不可用（核心逻辑仍可用，见 README「命令行用法」）');
    return;
  }

  const guard = createGuard(ctx, log);
  const tokens = createTokenStore();

  /** 所有路由共用：只处理 GET（平台已挡非 GET，这里再兜一次便于测试与排障）。 */
  const route = (handler) => async (req, res) => {
    if (String(req?.method ?? 'GET').toUpperCase() !== 'GET') {
      try {
        res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed\n');
      } catch { /* 已结束 */ }
      return;
    }
    if (!guard(req, res)) return;
    try {
      await handler(req, res);
    } catch (error) {
      json(res, 500, failure(ERROR_CODES.badRequest, `服务内部错误：${String(error?.message ?? error)}`));
    }
  };

  // 上传能力在 apply 时就确定：connection.fetch 存在且能注册 → 设置页可以拖文件进来
  let uploadSupported = false;
  try {
    const conn = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
    uploadSupported = !!(conn && conn.fetch && typeof conn.fetch.register === 'function');
  } catch { uploadSupported = false; }

  const routes = [
    // 能力清单：UI 用它渲染分组、勾选项与「备份放哪」的绝对路径
    ['exact', `${ROUTE_PREFIX}/capabilities`, route(async (req, res) => {
      const paths = resolve();
      const scanned = collectItems(paths);
      json(res, 200, {
        ok: true,
        granular: true,
        itemsEndpoint: `${ROUTE_PREFIX}/items`,
        groups: scanned.groups,
        skipped: Object.entries(SKIPPED).map(([key, meta]) => ({ key, ...meta })),
        // 说清楚每一项到底备份的是什么，避免再出现「备份了人格卡却没生效」的误解
        effective: {
          persona: 'config 里的 persona 块（含 persona.text，导入时整块写回配置）',
          config: 'dsh-qq-bot 段的各个一级配置项（token / QQ 号 / 群号在各自项里）',
          memory: 'QQ_msg/.dsh-meow/memory.db',
          whaleConfig: 'dsh-qq-whale 段的各个一级配置项',
          voiceConfig: 'dsh-qq-voice 段的各个一级配置项（含 TTS key / NapCat token / 复刻音色 id）',
        },
        backupDir: paths.backupDir,
        upload: { supported: uploadSupported, path: `/api${ROUTE_PREFIX}/upload` },
        tokenTtlSeconds: Math.floor(TOKEN_TTL_MS / 1000),
        specialItems: SPECIAL_ITEMS,
      });
    })],

    // 当前机器上可导出的全部配置项（逐项，动态发现）
    ['exact', `${ROUTE_PREFIX}/items`, route(async (req, res) => {
      const paths = resolve();
      const scanned = collectItems(paths);
      json(res, 200, {
        ok: true,
        items: scanned.items.map(({ block, ...rest }) => rest),
        groups: scanned.groups,
        warnings: scanned.warnings,
      });
    })],

    // 列出备份目录里可导入的包（避免让用户手打路径）
    ['exact', `${ROUTE_PREFIX}/list-bundles`, route(async (req, res) => {
      json(res, 200, listBundles(resolve()));
    })],

    // 清理旧备份：默认 dry-run，只删本插件产出的 qqbot-vault-*.tar.gz
    ['exact', `${ROUTE_PREFIX}/cleanup`, route(async (req, res) => {
      const params = queryOf(req);
      const keepRaw = Number(params.get('keep'));
      const ageRaw = params.get('maxAgeDays');
      const result = cleanupBundles({
        paths: resolve(),
        keep: Number.isFinite(keepRaw) && keepRaw > 0 ? keepRaw : 10,
        maxAgeDays: ageRaw === null || ageRaw === '' ? undefined : Number(ageRaw),
        // 与导入一致：不写就只报告；写必须显式 write=1
        write: params.get('write') === '1',
      });
      json(res, 200, result);
    })],

    // 只算不写
    ['exact', `${ROUTE_PREFIX}/plan`, route(async (req, res) => {
      json(res, 200, planExport({ items: itemsOf(queryOf(req)), paths: resolve() }));
    })],

    // 生成并直接流式下载（浏览器带 cookie，能过 browserAuth）
    ['exact', `${ROUTE_PREFIX}/export`, route(async (req, res) => {
      const params = queryOf(req);
      const result = runExport({ items: itemsOf(params), paths: resolve() });
      if (result.ok !== true) {
        json(res, 400, failure(ERROR_CODES.badRequest, result.error ?? '导出失败', { plan: result.plan }));
        return;
      }
      sendFile(res, result.path, path.basename(result.path));
    })],

    // 预览逐项差异 + 发放一次性确认码（码绑定 path + 本次预览的 item 集合）
    ['exact', `${ROUTE_PREFIX}/preview-import`, route(async (req, res) => {
      const params = queryOf(req);
      const paths = resolve();
      const bundlePath = resolveBundlePath(params.get('path'), paths);
      if (bundlePath === undefined) {
        json(res, 400, failure(ERROR_CODES.badRequest, `缺少 path 参数（${paths.backupDir} 下的文件名，或任意绝对路径）`));
        return;
      }
      if (!fs.existsSync(bundlePath)) {
        json(res, 404, failure(ERROR_CODES.notFound, `找不到文件：${bundlePath}`, { backupDir: paths.backupDir }));
        return;
      }
      const result = previewImport({ bundlePath, paths, force: params.get('force') === '1' });
      if (result.ok !== true) {
        json(res, 400, failure(ERROR_CODES.badBundle, result.error ?? '不是合法的备份包', { detail: result }));
        return;
      }
      json(res, 200, {
        ...result,
        path: bundlePath,
        token: tokens.issue(bundlePath, result.itemIds ?? []),
        tokenTtlSeconds: Math.floor(TOKEN_TTL_MS / 1000),
      });
    })],

    // 凭 token 真正执行；write=1 必须显式给；items= 只应用勾选的项
    ['exact', `${ROUTE_PREFIX}/import`, route(async (req, res) => {
      const params = queryOf(req);
      const paths = resolve();
      const bundlePath = resolveBundlePath(params.get('path'), paths);
      if (bundlePath === undefined) {
        json(res, 400, failure(ERROR_CODES.badRequest, '缺少 path 参数'));
        return;
      }
      if (params.get('write') !== '1') {
        json(res, 400, failure(ERROR_CODES.writeRequired, '导入必须显式 write=1（先预览再确认）'));
        return;
      }
      const wantItems = itemsOf(params);
      const verdict = tokens.consume(params.get('token') ?? '', bundlePath, wantItems);
      if (verdict.code !== undefined) {
        json(res, 400, failure(verdict.code, verdict.message));
        return;
      }
      const result = runImport({
        bundlePath,
        paths,
        write: true,
        force: params.get('force') === '1',
        items: wantItems,
      });
      // 一次性码已消费：无论成败都要重新预览，避免"重试即生效"的误用
      json(res, result.ok === true ? 200 : 400, result);
    })],
  ];

  // 注册路由。
  //
  // ⚠️ 必须用 `ctx.effect()` 登记，不能只靠 `ctx.on('dispose')`（0.3.0 修的真机 bug）：
  //   实测 `set_bundle` 关掉插件后，路由**依然返回 200** —— 说明 dispose 回调没有触发，
  //   handler 还挂在 webServer 的路由表里。后果不只是"没清理"：重新启用时同名路径
  //   `register()` 会抛（同表重复路径是配置错误），旧 handler 继续生效，
  //   于是出现「代码已更新、行为却是旧的」这种最难查的错位。
  //   官方插件（dsh-client-connection / dsh-client-modules）都用 `ctx.effect(() => register(...))`，
  //   由 Cordis 在 fiber 卸载时执行 disposer；这里照抄。
  let registered = 0;
  const manualDisposers = [];
  for (const [kind, routePath, handler] of routes) {
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const off = webServer.register({ kind, path: routePath, handler });
          registered += 1;
          return () => { try { if (typeof off === 'function') off(); } catch { /* 已移除 */ } };
        }, `dsh-qq-vault: route ${routePath}`);
      } else {
        // 极老的 Cordis 没有 effect：退回手动登记 + dispose 兜底（不保证可靠，但聊胜于无）
        const off = webServer.register({ kind, path: routePath, handler });
        registered += 1;
        if (typeof off === 'function') manualDisposers.push(off);
      }
    } catch (error) {
      log(`注册路由 ${routePath} 失败（可能已被上一个实例占用，需重启 DSH 清理）：${String(error?.message ?? error)}`);
    }
  }
  if (manualDisposers.length > 0 && typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const off of manualDisposers) {
        try { off(); } catch { /* 忽略 */ }
      }
    });
  }
  ctx.logger?.info?.(`[dsh-qq-vault] 已挂 ${registered} 条 GET 路由（前缀 ${ROUTE_PREFIX}）`);

  // ── 文件上传（POST，走 Connection 的 exact 路由表）────────────────────────
  //
  // 为什么不用 webServer：它只放行 GET/HEAD，POST 在路由匹配前就 405
  // （dsh-host-webserver/lib/index.js:428,600），所以上传不可能挂在那边。
  // Connection 的 fetch registry 不同——它明确支持 POST 与流式 body
  // （`dsh-client-connection/lib/types/rpc.d.ts:119` 的 ConnectionFetchRoute：
  //  path 是「/api 下的绝对路径」，methods 可含 POST，requestBody 可 'streaming'），
  // 官方 `dsh-client-file-upload` 的 `/api/session/uploadFileBinary` 就是这么做的。
  //
  // 也因此**不需要 sessionId**：那条官方路由要 sessionId 是因为它把回执绑到某个
  // Agent 的 scope；我们只是把字节落到备份目录，属于部署级操作，用 owner Peer 鉴权足够。
  // 物理载体已先行做了 trust + browserAuth，且只有 owner Peer 能到达 exact route。
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
    const registry = connection !== null && connection !== undefined ? connection.fetch : undefined;
    if (registry !== undefined && registry !== null && typeof registry.register === 'function') {
      ctx.effect(() => registry.register({
        // path 要带 /api 前缀：官方 file-upload 注册的就是 `/api/session/uploadFileBinary` 全路径
        path: `/api${ROUTE_PREFIX}/upload`,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: (request) => handleUploadRequest(request, resolve(), log),
      }), 'dsh-qq-vault: upload route');
      ctx.logger?.info?.(`[dsh-qq-vault] 已挂上传路由 POST /api${ROUTE_PREFIX}/upload`);
    } else {
      log('拿不到 connection.fetch：设置页不支持直接上传，只能从列表选择或填路径');
    }
  } catch (error) {
    log(`上传路由未注册（设置页将回退到"从列表选择"）：${String(error?.message ?? error)}`);
  }

  // 启动清理：只删本插件备份目录里、超过 7 天的 qqbot-vault-*.tar.gz。
  // 为什么放在启动而不是定时器：宿主没有稳定的定时服务可依赖，启动时清一次足够，
  // 也避免常驻 timer 在测试环境里制造噪音。
  try {
    const swept = cleanupBundles({ paths: resolve(), keep: 10, maxAgeDays: 7, write: true });
    if (swept.failed.length > 0) log(`启动清理有 ${swept.failed.length} 个文件删除失败`);
    if (swept.deleted.length > 0) {
      ctx.logger?.info?.(`[dsh-qq-vault] 启动清理删除 ${swept.deleted.length} 个 7 天前的备份，保留 ${swept.kept} 个`);
    }
  } catch (error) {
    log(`启动清理跳过：${String(error?.message ?? error)}`);
  }

  // 启动自检：注册完立刻用真实 origin 打一次，把状态码打进日志。
  void selfCheck(webServer, ctx, log);
}

/**
 * 注册后的自检：取 webServer 的 origin 发一次 GET，只记日志、绝不抛。
 * 目的：下次一眼区分「路由没挂上」（404）与「方法不对」（405），不要再靠猜。
 *
 * @param {any} webServer webServer 服务
 * @param {any} ctx Cordis 上下文
 * @param {(message: string) => void} log 日志函数
 * @returns {Promise<void>}
 */
async function selfCheck(webServer, ctx, log) {
  try {
    const origin = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : undefined;
    if (typeof origin !== 'string' || origin === '') {
      ctx.logger?.info?.('[dsh-qq-vault] 拿不到 webServer origin，跳过启动自检');
      return;
    }
    if (typeof fetch !== 'function' || typeof AbortSignal?.timeout !== 'function') return;
    const url = `${origin.replace(/\/+$/, '')}${ROUTE_PREFIX}/capabilities`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    // 自检没有会话凭据，401 反而说明路由已挂上（被 guard 拦下），所以单独标注。
    const note = response.status === 401 ? '（401 属正常：自检无会话凭据，说明路由已挂上）' : '';
    ctx.logger?.info?.(`[dsh-qq-vault] 启动自检 GET /capabilities → ${response.status}${note}`);
  } catch (error) {
    log(`启动自检失败（不影响插件）：${String(error?.message ?? error)}`);
  }
}
