/**
 * dsh-qq-vault —— 核心逻辑（纯函数 + 文件操作），不依赖 DSH 运行时。
 *
 * 0.5.0 起改成**逐配置项**（item）为单位：
 *   导出时按项打包（`items/qqbot.onebot.yml` …），导入时逐项对比、只应用用户勾选的那些。
 *   0.4.0 及以前是「整个 `- id: dsh-qq-bot` 段整段替换」——用户勾一项也会把没勾的配置
 *   一起覆盖，连注释都被换掉，这就是用户说的「侵入式」。
 *
 * 设计约束：
 *   - 所有写操作默认 dry-run，必须显式 write:true；
 *   - 任何函数都不抛到调用方之外（host 半负责兜住），失败返回 { ok:false, error }；
 *   - 不 import 任何第三方包（只 node: 内置），目标机不需要装依赖；
 *   - 配置项**动态发现**（见 items.js），不硬编码键名清单。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ENTRY, ENTRY_GROUP } from './constants.js';
import { readEntryItems, readItemBlock, writeItemBlock, labelOf } from './items.js';

export { ENTRY };

/**
 * 本次不实现的数据项：在 UI 上**标灰显示**（而不是消失），并说明原因。
 */
export const SKIPPED = {
  sessions: {
    label: '会话历史',
    supported: false,
    reason: '会话日志是 DSH 私有格式（zstd JSONL + 投影缓存），跨机器恢复会连同 preset 锁、工作区账本一起搬，风险高于收益；需要历史就单独用 tar 备份 sessions 目录。',
  },
};

/** 结构化错误码：客户端按 code 显示中文提示，不依赖 message 文案。 */
export const ERROR_CODES = {
  badRequest: 'bad-request',
  notFound: 'not-found',
  badBundle: 'bad-bundle',
  versionMismatch: 'version-mismatch',
  integrityFailed: 'integrity-failed',
  nothingToImport: 'nothing-to-import',
  tokenMissing: 'token-missing',
  tokenInvalid: 'token-invalid',
  tokenExpired: 'token-expired',
  tokenUsed: 'token-used',
  tokenMismatch: 'token-mismatch',
  writeRequired: 'write-required',
};

/**
 * 造一个结构化错误对象（host 半直接 JSON 返回）。
 * 保留 `error` 字段与 `message` 同值，兼容早先的客户端。
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export function failure(code, message, extra = {}) {
  return { ok: false, code, message, error: message, ...extra };
}

const require_ = createRequire(import.meta.url);

/** 时间戳：20261114-064500 这种，文件名友好。 */
export function ts(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/** 主次版本（0.2.2-rc.3 → "0.2"）。 */
export function majorMinor(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  return match ? `${match[1]}.${match[2]}` : undefined;
}

/** 当前 DSH 版本：先看环境变量，再问 CLI，最后读安装目录。全程不抛。 */
export function detectDshVersion() {
  const fromEnv = process.env.DSH_VERSION;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  try {
    const out = execFileSync('dsh', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (out !== '') return out;
  } catch { /* 回退 */ }
  const pkg = readJsonSafe('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');
  return pkg?.version ?? 'unknown';
}

// ── 条目段（保留给旧调用方；新逻辑走 items.js 的块扫描）────────────────────

/**
 * 在 YAML 文本里找 `- id: xxx` 段（到下一个顶格 `- id:` 或文件尾）。
 * @param {string} text YAML 全文
 * @param {string} entryId 形如 `- id: dsh-qq-bot`
 * @returns {{ block: string, startLine: number, endLine: number }} 行号 0 基，end 不含
 */
export function findEntryBlock(text, entryId = ENTRY.qqBot) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === entryId);
  if (start < 0) return { block: '', startLine: -1, endLine: -1 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i])) { end = i; break; }
  }
  const block = lines.slice(start, end);
  while (block.length > 0 && block[block.length - 1].trim() === '') block.pop();
  return { block: block.join('\n'), startLine: start, endLine: start + block.length };
}

/** 只取段文本（找不到回空串）。 */
export function extractEntryBlock(text, entryId = ENTRY.qqBot) {
  return findEntryBlock(text, entryId).block;
}

/**
 * 解析本机路径。全部可覆盖，便于测试与换机。
 * @param {{home?:string, profile?:string, workspace?:string, repoRoot?:string}} [opts]
 */
export function resolvePaths(opts = {}) {
  const home = path.resolve(opts.home ?? process.env.DSH_HOME ?? '/data/dsh');
  const profile = opts.profile ?? 'web';
  const profileDir = path.join(home, 'profiles', profile);
  const workspace = path.resolve(
    opts.workspace ?? path.join(os.homedir(), 'Documents', 'deepseek-harness', 'QQ_msg'),
  );
  // 仓库根的回退顺序：显式配置 → 环境变量 → cwd → $DSH_HOME/QQBotV2。
  // 为什么要回退：插件跑在宿主进程里，cwd 通常不是仓库根，直接 cwd 会让人格源文件
  // （persona/whale.md）静默漏备份。
  const repoCandidates = [
    opts.repoRoot,
    process.env.DSH_QQ_REPO,
    path.join(process.cwd(), 'dsh-qq-instruction'),
    path.join(home, 'home', 'QQBotV2', 'dsh-qq-instruction'),
    path.join(home, 'QQBotV2', 'dsh-qq-instruction'),
  ].filter((value) => typeof value === 'string' && value !== '');
  const repoRoot = path.resolve(
    repoCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'persona', 'whale.md')))
    ?? repoCandidates[0]
    ?? path.join(process.cwd(), 'dsh-qq-instruction'),
  );
  return {
    home,
    profile,
    profileDir,
    patchPath: path.join(profileDir, 'cordis.patch.yml'),
    manifestPath: path.join(profileDir, 'package.json'),
    workspace,
    dbPath: path.join(workspace, '.dsh-meow', 'memory.db'),
    personaPath: path.join(repoRoot, 'persona', 'whale.md'),
    backupDir: path.join(home, 'backups', 'qqbot-vault'),
    repoRoot,
  };
}

/** 记忆库一致性快照：VACUUM INTO 优先，失败退回 db+wal+shm 整组复制。 */
export function exportMemoryDb(dbPath, outPath) {
  if (!fs.existsSync(dbPath)) return { ok: false, error: `记忆库不存在：${dbPath}` };
  try {
    const { DatabaseSync } = require_('node:sqlite');
    if (fs.existsSync(outPath)) fs.rmSync(outPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    return { ok: true, mode: 'vacuum-into' };
  } catch (error) {
    const copied = [];
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbPath + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, outPath + suffix);
        copied.push(path.basename(src));
      }
    }
    if (copied.length === 0) return { ok: false, error: String(error?.message ?? error) };
    return {
      ok: true,
      mode: 'raw-copy',
      warning: `VACUUM INTO 失败（${String(error?.message ?? error)}），已整组复制 ${copied.join(', ')}；导入端需同时放置 db/wal/shm`,
    };
  }
}

/** 逐层列出目录下的文件（相对路径 + 字节 + sha256）。 */
function walkFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else {
        const buf = fs.readFileSync(full);
        out.push({ path: path.relative(root, full).split(path.sep).join('/'), bytes: stat.size, sha256: sha256(buf) });
      }
    }
  };
  walk(root);
  return out;
}

// ── item 模型 ────────────────────────────────────────────────────────────────

/** 特殊 item 的 id（不是配置项，但也参与勾选）。 */
export const SPECIAL_ITEMS = {
  personaSource: 'persona.source',
  memoryDb: 'memory.db',
};

/** 特殊 item 的展示信息。 */
const SPECIAL_META = {
  [SPECIAL_ITEMS.personaSource]: {
    group: 'persona',
    label: '人格源文件（仓库 persona/whale.md，仅作编辑真源）',
    kind: 'file',
    sensitive: true,
  },
  [SPECIAL_ITEMS.memoryDb]: {
    group: 'memory',
    label: '记忆库（QQ_msg/.dsh-meow/memory.db）',
    kind: 'db',
    sensitive: true,
  },
};

/**
 * 清点**本机**可导出的全部 item。
 *
 * 配置项动态发现：扫 `- id: dsh-qq-bot` 与 `- id: dsh-qq-whale` 的 config 一级子键，
 * 所以 qq-bot 以后再加键（0.14 的 reply.bubbleGapMinMs / sticker.*）也会自动出现。
 *
 * @param {ReturnType<typeof resolvePaths>} paths
 * @returns {{ ok:true, items:object[], groups:object[], warnings:string[] }}
 */
export function collectItems(paths) {
  const warnings = [];
  let patchText = '';
  if (fs.existsSync(paths.patchPath)) patchText = fs.readFileSync(paths.patchPath, 'utf8');
  else warnings.push(`找不到 profile 配置：${paths.patchPath}`);

  const items = [];
  const groups = [];

  for (const [entryId, prefix] of Object.entries(ENTRY_GROUP)) {
    const scanned = readEntryItems(patchText, entryId);
    const groupItems = [];
    for (const entry of scanned.items) {
      groupItems.push({
        id: `${prefix}.${entry.key}`,
        group: prefix,
        label: labelOf(entry.key),
        kind: 'section',
        key: entry.key,
        entryId,
        sensitive: entry.sensitive,
        present: true,
        bytes: entry.bytes,
        block: entry.block,
      });
    }
    groups.push({
      group: prefix,
      entryId,
      present: scanned.present === true,
      label: prefix === 'qqbot' ? 'dsh-qq-bot（QQ 机器人）' : 'dsh-qq-whale（工具面收窄）',
      count: groupItems.length,
      note: scanned.present === true
        ? undefined
        : `配置里没有 \`${entryId}\` 段（该插件可能没装，或还没在设置页改过任何项）`,
    });
    items.push(...groupItems);
  }

  if (fs.existsSync(paths.personaPath)) {
    const meta = SPECIAL_META[SPECIAL_ITEMS.personaSource];
    items.push({
      id: SPECIAL_ITEMS.personaSource,
      group: meta.group,
      label: meta.label,
      kind: meta.kind,
      sensitive: meta.sensitive,
      present: true,
      bytes: fs.statSync(paths.personaPath).size,
      source: paths.personaPath,
    });
  } else {
    warnings.push(`找不到人格源文件：${paths.personaPath}`);
  }

  if (fs.existsSync(paths.dbPath)) {
    const meta = SPECIAL_META[SPECIAL_ITEMS.memoryDb];
    items.push({
      id: SPECIAL_ITEMS.memoryDb,
      group: meta.group,
      label: meta.label,
      kind: meta.kind,
      sensitive: meta.sensitive,
      present: true,
      bytes: fs.statSync(paths.dbPath).size,
      source: paths.dbPath,
    });
  } else {
    warnings.push(`找不到记忆库：${paths.dbPath}`);
  }

  // 特殊组也列进 groups，UI 才能分组渲染
  for (const group of ['persona', 'memory']) {
    const list = items.filter((item) => item.group === group);
    if (list.length === 0) continue;
    groups.push({
      group,
      label: group === 'persona' ? '人格源文件' : '记忆库',
      present: true,
      count: list.length,
    });
  }

  return { ok: true, items, groups, warnings };
}

/** 解析 `items=a,b,c`：去空、去重；空 → undefined（= 全部）。 */
export function parseItemIds(input) {
  const raw = Array.isArray(input) ? input : (typeof input === 'string' && input !== '' ? input.split(',') : []);
  const seen = new Set();
  const ids = [];
  for (const value of raw) {
    const id = String(value ?? '').trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length === 0 ? undefined : ids;
}

/** item id → 导出包内路径。 */
export function itemPath(id) {
  if (id === SPECIAL_ITEMS.personaSource) return 'persona/whale.md';
  if (id === SPECIAL_ITEMS.memoryDb) return 'memory/memory.db';
  return `items/${id}.yml`;
}

/**
 * 计划导出：只算不写。
 * @param {{items?:string[], paths:ReturnType<typeof resolvePaths>}} input
 */
export function planExport({ items, paths }) {
  const all = collectItems(paths);
  const picked = items === undefined ? all.items.map((item) => item.id) : items;
  const warnings = [...all.warnings];
  const unknown = [];
  const files = [];

  const known = new Map(all.items.map((item) => [item.id, item]));
  for (const id of picked) {
    const item = known.get(id);
    if (item === undefined) { unknown.push(id); continue; }
    files.push({
      id: item.id,
      group: item.group,
      label: item.label,
      kind: item.kind,
      path: itemPath(item.id),
      bytes: item.bytes,
      sensitive: item.sensitive,
    });
  }
  if (unknown.length > 0) warnings.push(`这些配置项在当前机器上不存在，已跳过：${unknown.join(', ')}`);
  if (files.length === 0) warnings.push('没有可导出的数据项：至少要选一项');

  return {
    ok: true,
    items: picked,
    files,
    totalBytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
    warnings,
    groups: all.groups,
    skipped: Object.entries(SKIPPED).map(([key, meta]) => ({ key, ...meta, notImplemented: true })),
    dshVersion: detectDshVersion(),
  };
}

/**
 * 真导出：只把选中的项写进 staging → tar czf。
 * @param {{items?:string[], paths:ReturnType<typeof resolvePaths>, outDir?:string, now?:Date}} input
 */
export function runExport({ items, paths, outDir, now }) {
  const plan = planExport({ items, paths });
  if (plan.files.length === 0) {
    return { ok: false, error: '没有可导出的数据项', plan };
  }

  const dir = path.resolve(outDir ?? paths.backupDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = ts(now ?? new Date());
  const outPath = path.join(dir, `qqbot-vault-${stamp}.tar.gz`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-vault-export-'));

  const all = collectItems(paths);
  const known = new Map(all.items.map((item) => [item.id, item]));

  try {
    for (const file of plan.files) {
      const item = known.get(file.id);
      if (item === undefined) continue;
      const dest = path.join(staging, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      if (item.kind === 'section') {
        // 现取一次，避免 plan 与写盘之间被改过
        const block = readItemBlock(fs.readFileSync(paths.patchPath, 'utf8'), item.entryId, item.key);
        if (block === undefined) {
          plan.warnings.push(`${item.id} 在导出瞬间消失了，已跳过`);
          continue;
        }
        fs.writeFileSync(dest, `${block}\n`, 'utf8');
      } else if (item.kind === 'db') {
        const mem = exportMemoryDb(paths.dbPath, dest);
        if (!mem.ok) {
          plan.warnings.push(`记忆库未导出：${mem.error}`);
          continue;
        }
        if (mem.warning) plan.warnings.push(mem.warning);
      } else {
        fs.copyFileSync(item.source, dest);
      }
    }

    const files = walkFiles(staging);
    // 把每条文件记录映射回 item（manifest.items 是权威清单，files 保留给完整性校验）
    const byPath = new Map(plan.files.map((file) => [file.path, file]));
    const manifestItems = files
      .filter((file) => file.path !== 'manifest.json')
      .map((file) => {
        const meta = byPath.get(file.path);
        return {
          id: meta?.id ?? file.path,
          group: meta?.group,
          label: meta?.label,
          kind: meta?.kind,
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          sensitive: meta?.sensitive === true,
        };
      });

    const manifest = {
      schemaVersion: 2,
      kind: 'qqbot-vault-bundle',
      granular: true,
      exportedAt: new Date().toISOString(),
      dsh: { version: plan.dshVersion, home: paths.home, profile: paths.profile },
      plugins: {
        qqBot: readJsonSafe(path.join(paths.profileDir, 'node_modules', '@sputnikzaychik', 'dsh-qq-bot', 'package.json'))?.version ?? 'unknown',
        whale: readJsonSafe(path.join(paths.repoRoot, 'packages', 'dsh-qq-whale', 'package.json'))?.version ?? 'unknown',
        meowMemory: readJsonSafe(path.join(paths.profileDir, 'node_modules', 'meow-memory', 'package.json'))?.version ?? 'unknown',
      },
      items: manifestItems,
      files: manifestItems.map(({ id, ...rest }) => rest),
      notes: [
        '配置项按项打包（items/<item id>.yml），导入时只应用勾选的项',
        '含 token / QQ 号 / 人格的项请私密传输',
        'memory.db 由 SQLite VACUUM INTO 生成；导入前建议先停 DSH（或导入后立即重启）',
      ],
    };
    fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    execFileSync('tar', ['czf', outPath, '-C', staging, '.'], { stdio: 'ignore' });
    try { fs.chmodSync(outPath, 0o600); } catch { /* 非 POSIX 忽略 */ }

    return {
      ok: true,
      path: outPath,
      bytes: fs.statSync(outPath).size,
      files: manifestItems,
      manifest,
      warnings: plan.warnings,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), plan };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** 解包到临时目录并做结构校验；调用方负责 cleanup。 */
function openBundle(bundlePath) {
  if (!fs.existsSync(bundlePath)) throw new Error(`找不到迁移包：${bundlePath}`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-vault-import-'));
  try {
    execFileSync('tar', ['xzf', bundlePath, '-C', staging], { stdio: 'ignore' });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`解包失败（不是合法 tar.gz？）：${String(error?.message ?? error)}`);
  }
  const manifest = readJsonSafe(path.join(staging, 'manifest.json'));
  if (manifest === undefined) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error('包里没有 manifest.json，不像本插件导出的备份');
  }
  return { staging, manifest, cleanup: () => fs.rmSync(staging, { recursive: true, force: true }) };
}

/**
 * 校验包内文件的完整性：按 manifest.items（或旧包的 manifest.files）的 sha256 逐个比对。
 *
 * 为什么必须做：备份包含 NapCat token 与记忆库，传输过程（网盘、IM、剪贴板）
 * 都可能损坏或截断。没有这一步时，损坏的包会「看起来导入成功」，实际写进半截配置。
 *
 * @param {string} staging 解包目录
 * @param {any} manifest 包内 manifest.json
 * @returns {{ ok:boolean, checked:number, missing:string[], mismatched:{path:string, expected:string, actual:string}[], skipped:string[] }}
 */
export function verifyBundleIntegrity(staging, manifest) {
  const result = { ok: true, checked: 0, missing: [], mismatched: [], skipped: [] };
  const files = Array.isArray(manifest?.items) ? manifest.items
    : (Array.isArray(manifest?.files) ? manifest.files : undefined);
  if (files === undefined) {
    result.skipped.push('manifest 里没有 items/files 清单（旧版本包），跳过完整性校验');
    return result;
  }
  for (const entry of files) {
    const rel = typeof entry?.path === 'string' ? entry.path : undefined;
    const expected = typeof entry?.sha256 === 'string' ? entry.sha256 : undefined;
    if (rel === undefined) continue;
    if (expected === undefined) {
      result.skipped.push(`${rel}：manifest 未记录 sha256`);
      continue;
    }
    const full = path.join(staging, rel);
    if (!fs.existsSync(full)) {
      result.missing.push(rel);
      result.ok = false;
      continue;
    }
    const actual = sha256(fs.readFileSync(full));
    result.checked += 1;
    if (actual !== expected) {
      result.mismatched.push({ path: rel, expected, actual });
      result.ok = false;
    }
  }
  return result;
}

/**
 * 列出备份目录里可导入的包（只认本插件产出的 `qqbot-vault-*.tar.gz`）。
 * @param {ReturnType<typeof resolvePaths>} paths
 */
export function listBundles(paths) {
  const dir = paths.backupDir;
  const files = [];
  try {
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!/^qqbot-vault-.+\.tar\.gz$/.test(name)) continue;
        const full = path.join(dir, name);
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;
        files.push({ name, path: full, bytes: stat.size, mtime: stat.mtime.toISOString() });
      }
    }
  } catch { /* 目录不可读就返回空列表，不抛 */ }
  files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { ok: true, dir, files };
}

/**
 * 清理旧备份：只删本插件产出、且在本插件备份目录内的 `qqbot-vault-*.tar.gz`。
 *
 * 安全边界（刻意的）：
 *   - 只匹配文件名模式，**不会**递归、不会跟随符号链接、不会删其它文件；
 *   - 默认 dry-run（write 不为 true 时只报告将删什么）；
 *   - keep 至少为 1，避免"一次清理删光"。
 */
export function cleanupBundles({ paths, keep = 10, maxAgeDays, write = false, now = new Date() }) {
  const listed = listBundles(paths);
  const safeKeep = Math.max(1, Number.isFinite(keep) ? Math.floor(keep) : 10);
  const cutoff = maxAgeDays === undefined || maxAgeDays === null
    ? undefined
    : now.getTime() - Math.max(0, Number(maxAgeDays)) * 24 * 60 * 60 * 1000;

  const keepSet = new Set(listed.files.slice(0, safeKeep).map((file) => file.path));
  const newest = listed.files.length > 0 ? listed.files[0].path : undefined;

  const doomed = listed.files.filter((file) => {
    if (file.path === newest) return false;
    const beyondKeep = keepSet.has(file.path) !== true;
    if (cutoff === undefined) return beyondKeep;
    const tooOld = Date.parse(file.mtime) <= cutoff;
    return beyondKeep || tooOld;
  });

  const deleted = [];
  const failed = [];
  for (const file of doomed) {
    if (write !== true) { deleted.push({ ...file, action: 'would-delete' }); continue; }
    try {
      fs.rmSync(file.path);
      deleted.push({ ...file, action: 'deleted' });
    } catch (error) {
      failed.push({ ...file, error: String(error?.message ?? error) });
    }
  }
  return {
    ok: true,
    dir: listed.dir,
    dryRun: write !== true,
    keep: safeKeep,
    maxAgeDays: maxAgeDays ?? null,
    total: listed.files.length,
    deleted,
    failed,
    kept: listed.files.length - doomed.length,
  };
}

/** 取前 N 个字符做预览（去掉尾部空白，换行保留为字面量便于 UI 显示）。 */
function previewOf(text, limit = 200) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** 当前机器上某一项的「现状」。 */
function currentOf(item, paths, patchText) {
  if (item.kind === 'section') {
    const block = readItemBlock(patchText, item.entryId, item.key);
    return block === undefined
      ? { present: false, bytes: 0, preview: '' }
      : { present: true, bytes: Buffer.byteLength(`${block}\n`, 'utf8'), preview: previewOf(block), block };
  }
  if (item.kind === 'file') {
    if (!fs.existsSync(paths.personaPath)) return { present: false, bytes: 0, preview: '' };
    const text = fs.readFileSync(paths.personaPath, 'utf8');
    return { present: true, bytes: Buffer.byteLength(text, 'utf8'), preview: previewOf(text), text };
  }
  // db
  if (!fs.existsSync(paths.dbPath)) return { present: false, bytes: 0, preview: '' };
  return { present: true, bytes: fs.statSync(paths.dbPath).size, preview: '(SQLite 数据库)' };
}

/**
 * 预览导入：解包 → 完整性校验 → 版本闸 → **逐项**算出将变动的项，不写任何文件。
 *
 * 返回的每一项都带 current / incoming 两侧的字节数与预览，
 * 客户端据此渲染「未变 / 将替换 / 将新增」，并只允许勾选 changed 的行。
 *
 * @param {{bundlePath:string, paths:ReturnType<typeof resolvePaths>, force?:boolean}} input
 */
export function previewImport({ bundlePath, paths, force = false }) {
  let opened;
  try {
    opened = openBundle(bundlePath);
    const { staging, manifest } = opened;

    const current = detectDshVersion();
    const wanted = manifest?.dsh?.version;
    const compatible = majorMinor(current) !== undefined && majorMinor(current) === majorMinor(wanted);
    const version = {
      current,
      wanted,
      compatible,
      blocked: compatible !== true && force !== true,
      message: compatible === true
        ? `DSH 版本兼容：${current}`
        : `DSH 版本不一致：目标 ${current}，导出时 ${wanted}${force ? '（已选择强制）' : '；跨版本导入需确认强制'}`,
    };

    const integrityResult = verifyBundleIntegrity(staging, manifest);
    const integrity = {
      ok: integrityResult.ok,
      checked: integrityResult.checked,
      missing: integrityResult.missing,
      mismatched: integrityResult.mismatched,
      skipped: integrityResult.skipped,
      blocked: integrityResult.ok !== true && force !== true,
      message: integrityResult.ok === true
        ? `完整性校验通过：${integrityResult.checked} 个文件`
        : '完整性校验失败：包内容与 manifest 记录不一致（可能传输损坏），确认无误可用 force 强制导入',
    };

    const patchText = fs.existsSync(paths.patchPath) ? fs.readFileSync(paths.patchPath, 'utf8') : '';
    const warnings = [];

    const declared = Array.isArray(manifest?.items)
      ? manifest.items
      : (Array.isArray(manifest?.files) ? manifest.files : []);
    if (Array.isArray(manifest?.items) !== true) {
      warnings.push('这是 0.4.0 及以前格式的包（没有逐项清单）：只能整体识别，建议用新版重新导出');
    }

    const items = [];
    for (const entry of declared) {
      const id = typeof entry?.id === 'string' ? entry.id : undefined;
      const filePath = typeof entry?.path === 'string' ? entry.path : undefined;
      if (filePath === undefined) continue;
      const full = path.join(staging, filePath);
      if (!fs.existsSync(full)) {
        warnings.push(`包内缺文件：${filePath}（该项跳过）`);
        continue;
      }

      let item;
      if (id !== undefined && id.startsWith('qqbot.')) {
        const key = id.slice('qqbot.'.length);
        item = { id, kind: 'section', key, entryId: ENTRY.qqBot };
      } else if (id !== undefined && id.startsWith('whale.')) {
        const key = id.slice('whale.'.length);
        item = { id, kind: 'section', key, entryId: ENTRY.whale };
      } else if (id === SPECIAL_ITEMS.personaSource) {
        item = { id, kind: 'file' };
      } else if (id === SPECIAL_ITEMS.memoryDb) {
        item = { id, kind: 'db' };
      } else if (filePath.startsWith('items/') && filePath.endsWith('.yml')) {
        // 没有 id 字段的包：从路径反推
        const raw = filePath.slice('items/'.length, -'.yml'.length);
        const dot = raw.indexOf('.');
        const prefix = raw.slice(0, dot);
        const key = raw.slice(dot + 1);
        const entryId = prefix === 'qqbot' ? ENTRY.qqBot : (prefix === 'whale' ? ENTRY.whale : undefined);
        if (entryId === undefined) { warnings.push(`无法识别的配置项：${filePath}`); continue; }
        item = { id: raw, kind: 'section', key, entryId };
      } else {
        warnings.push(`无法识别的包内条目：${filePath}`);
        continue;
      }

      const incomingBuf = fs.readFileSync(full);
      const incomingBlock = item.kind === 'section' ? incomingBuf.toString('utf8').replace(/\s+$/, '') : undefined;
      const currentState = currentOf(item, paths, patchText);

      let action;
      if (item.kind === 'section') {
        action = currentState.present !== true
          ? 'create'
          : (currentState.block === incomingBlock ? 'same' : 'replace');
      } else if (item.kind === 'file') {
        const sameBytes = currentState.present === true
          && fs.readFileSync(paths.personaPath).equals(incomingBuf);
        action = currentState.present !== true ? 'create' : (sameBytes ? 'same' : 'replace');
      } else {
        const sameBytes = currentState.present === true
          && fs.readFileSync(paths.dbPath).equals(incomingBuf);
        action = currentState.present !== true ? 'create' : (sameBytes ? 'same' : 'replace');
      }

      const meta = SPECIAL_META[id];
      items.push({
        id: item.id,
        kind: item.kind,
        // key / entryId 必须带上：runImport 要靠它们定位已有块；
        // 漏了就会退化成「找不到 → 当新增插入」，同一项被写两遍（实测踩到过）。
        key: item.key,
        entryId: item.entryId,
        group: entry?.group ?? meta?.group ?? (item.id.split('.')[0]),
        label: entry?.label ?? meta?.label ?? labelOf(item.key ?? item.id),
        sensitive: entry?.sensitive === true || meta?.sensitive === true,
        action,
        changed: action !== 'same',
        current: { present: currentState.present === true, bytes: currentState.bytes, preview: currentState.preview },
        incoming: {
          present: true,
          bytes: item.kind === 'section' ? Buffer.byteLength(`${incomingBlock}\n`, 'utf8') : incomingBuf.length,
          preview: item.kind === 'section' ? previewOf(incomingBlock) : (item.kind === 'db' ? '(SQLite 数据库)' : previewOf(incomingBuf.toString('utf8'))),
        },
      });
    }

    if (items.length === 0) warnings.push('这个包里没有可识别的内容');
    const changedCount = items.filter((item) => item.changed).length;

    return {
      ok: true,
      manifest,
      version,
      integrity,
      items,
      changedCount,
      itemIds: items.map((item) => item.id),
      warnings,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (opened !== undefined) opened.cleanup();
  }
}

/**
 * 真导入：**只应用选中的项**，逐项执行，任一项失败不回滚其它项。
 *
 * @param {{bundlePath:string, paths:ReturnType<typeof resolvePaths>, write?:boolean, force?:boolean, items?:string[], now?:Date}} input
 *   `items` 为 undefined 时表示"应用预览里所有 changed 项"。
 */
export function runImport({ bundlePath, paths, write = false, force = false, items, now }) {
  const preview = previewImport({ bundlePath, paths, force });
  if (preview.ok !== true) return preview;
  if (preview.version.blocked) {
    return failure(ERROR_CODES.versionMismatch, preview.version.message, { preview });
  }
  if (preview.integrity !== undefined && preview.integrity.blocked === true) {
    return failure(ERROR_CODES.integrityFailed, preview.integrity.message, { integrity: preview.integrity, preview });
  }

  const known = new Set(preview.itemIds);
  const unknown = (items ?? []).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return failure(ERROR_CODES.tokenMismatch, `这些项不在预览清单里：${unknown.join(', ')}；请重新预览`, { unknown, preview });
  }

  const picked = items === undefined
    ? preview.items.filter((item) => item.changed)
    : preview.items.filter((item) => items.includes(item.id));
  if (picked.length === 0) {
    return failure(ERROR_CODES.nothingToImport, '没有要导入的项（未勾选，或所选项目与目标完全一致）', { preview });
  }

  if (write !== true) {
    return { ok: true, written: false, wouldWrite: picked.map((item) => ({ id: item.id, action: item.action })), preview, message: 'dry-run：没有任何文件被修改' };
  }

  let opened;
  try {
    opened = openBundle(bundlePath);
    const { staging } = opened;
    const stamp = ts(now ?? new Date());
    const applied = [];
    const failed = [];

    const sectionItems = picked.filter((item) => item.kind === 'section');
    const fileItems = picked.filter((item) => item.kind === 'file');
    const dbItems = picked.filter((item) => item.kind === 'db');

    // 1) 配置项：一次读、多项写、末尾落盘一次；失败只影响该项
    if (sectionItems.length > 0) {
      if (!fs.existsSync(paths.patchPath)) throw new Error(`目标配置不存在：${paths.patchPath}`);
      const backupPath = `${paths.patchPath}.bak-vault-${stamp}`;
      fs.copyFileSync(paths.patchPath, backupPath);
      try { fs.chmodSync(backupPath, 0o600); } catch { /* 忽略 */ }
      applied.push({ id: 'config-backup', action: 'backup', target: backupPath });

      let text = fs.readFileSync(paths.patchPath, 'utf8');
      for (const item of sectionItems) {
        try {
          const block = fs.readFileSync(path.join(staging, itemPath(item.id)), 'utf8').replace(/\s+$/, '');
          const entryId = item.entryId ?? entryIdOf(item.id);
          const result = writeItemBlock(text, entryId, item.key, block);
          if (result.ok !== true) { failed.push({ id: item.id, error: result.error ?? '写入失败' }); continue; }
          // 写后自检：把这一项再读回来，必须与预期块逐字一致。
          // 为什么需要：如果包里的块缩进坏了（手工改包、跨工具编辑），直接写回会产出
          // 结构错误但"看起来成功"的 YAML；宁可判该项失败，也不要把配置写坏。
          const readBack = readItemBlock(result.text, entryId, item.key);
          if (readBack !== block) {
            failed.push({ id: item.id, error: '写入后回读与预期不一致（包内块缩进可能已损坏），该项已跳过' });
            continue;
          }
          text = result.text;
          applied.push({ id: item.id, action: result.action, target: paths.patchPath });
        } catch (error) {
          failed.push({ id: item.id, error: String(error?.message ?? error) });
        }
      }
      fs.writeFileSync(paths.patchPath, text, 'utf8');
      try { fs.chmodSync(paths.patchPath, 0o600); } catch { /* 忽略 */ }
    }

    // 2) 人格源文件
    for (const item of fileItems) {
      try {
        const src = path.join(staging, itemPath(item.id));
        fs.mkdirSync(path.dirname(paths.personaPath), { recursive: true });
        if (fs.existsSync(paths.personaPath)) {
          const backup = `${paths.personaPath}.bak-vault-${stamp}`;
          fs.copyFileSync(paths.personaPath, backup);
          applied.push({ id: `${item.id}-backup`, action: 'backup', target: backup });
        }
        fs.copyFileSync(src, paths.personaPath);
        applied.push({ id: item.id, action: 'restored', target: paths.personaPath });
      } catch (error) {
        failed.push({ id: item.id, error: String(error?.message ?? error) });
      }
    }

    // 3) 记忆库
    for (const item of dbItems) {
      try {
        const src = path.join(staging, itemPath(item.id));
        fs.mkdirSync(path.dirname(paths.dbPath), { recursive: true });
        const moved = [];
        for (const suffix of ['', '-wal', '-shm']) {
          const target = paths.dbPath + suffix;
          if (fs.existsSync(target)) {
            const backup = `${target}.bak-vault-${stamp}`;
            fs.renameSync(target, backup);
            moved.push(backup);
          }
        }
        fs.copyFileSync(src, paths.dbPath);
        for (const suffix of ['-wal', '-shm']) {
          if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, paths.dbPath + suffix);
        }
        applied.push({ id: item.id, action: 'restored', target: paths.dbPath, backups: moved });
      } catch (error) {
        failed.push({ id: item.id, error: String(error?.message ?? error) });
      }
    }

    return {
      ok: true,
      written: true,
      applied,
      failed,
      preview,
      nextSteps: [
        '确认配置里的 onebot.wsUrl / onebot.accessToken / auth.owners / group.allow 是这台机器的值',
        '让配置生效：DSH 设置 → 插件 → dsh-qq-bot 关闭再打开，或重启容器',
        '验证：QQ 私聊发 /whoami（能回 = 链路通）',
      ],
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (opened !== undefined) opened.cleanup();
  }
}

/** item id → 条目 id（写回配置时用）。 */
function entryIdOf(id) {
  return id.startsWith('whale.') ? ENTRY.whale : ENTRY.qqBot;
}
