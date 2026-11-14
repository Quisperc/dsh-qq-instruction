/**
 * dsh-qq-vault —— 核心逻辑（纯函数 + 文件操作），不依赖 DSH 运行时。
 *
 * 逻辑来源：直接搬 `scripts/export-config.mjs` / `scripts/import-config.mjs` 的已验证实现
 * （切 `- id: dsh-qq-bot` 段、整段替换、VACUUM INTO、主次版本闸），改成可被 host 半调用。
 * 那些脚本仍然可以单独跑；这里是它们的功能子集 + 设置页要的 include 过滤。
 *
 * 设计约束：
 *   - 所有写操作默认 dry-run，必须显式 write:true；
 *   - 任何函数都不抛到调用方之外（host 半负责兜住），失败返回 { ok:false, error }；
 *   - 不 import 任何第三方包（只 node: 内置），目标机不需要装依赖。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extractPersonaText, replacePersonaText } from './persona.js';

/** 会写进包里的条目 id（YAML 顶格写法）。 */
export const ENTRY = {
  qqBot: '- id: dsh-qq-bot',
  whale: '- id: dsh-qq-whale',
};

/** 可勾选的数据项。`sessions` 明确不实现（见 SKIPPED）。 */
export const INCLUDE_KEYS = ['config', 'persona', 'memory', 'whaleConfig'];

/**
 * 本次不实现的数据项：在 UI 上**标灰显示**（而不是消失），并说明原因。
 * `supported:false` 是给客户端用的显式标记——0.2.0 之前只有 reason，
 * 客户端只能靠字符串猜，加了这个字段后 UI 才能稳定渲染成"禁用项"。
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
 * 保留 `error` 字段与 `message` 同值，兼容 0.2.0 的客户端。
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
 * 把一段条目合并进目标文本：有同名段则整段替换，无则追加到末尾。
 * 绝不产生两个同名段。
 */
export function mergeEntryBlock(targetText, block, entryId = ENTRY.qqBot) {
  const lines = String(targetText ?? '').split('\n');
  const { startLine, endLine } = findEntryBlock(targetText, entryId);
  if (startLine >= 0) {
    lines.splice(startLine, endLine - startLine, ...String(block).split('\n'));
    return { text: lines.join('\n'), action: 'replaced' };
  }
  const trimmed = String(targetText ?? '').replace(/\s+$/, '');
  return { text: `${trimmed}\n\n${block}\n`, action: 'appended' };
}

/** include 归一化：去重、丢掉未知项，并返回被忽略的名字。 */
export function normalizeInclude(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const include = [];
  const ignored = [];
  for (const raw of list) {
    const name = String(raw ?? '').trim();
    if (name === '') continue;
    if (!INCLUDE_KEYS.includes(name)) { if (!ignored.includes(name)) ignored.push(name); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    include.push(name);
  }
  return { include, ignored };
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
  // （persona/whale.md）静默漏备份。生效人格 persona.text 来自配置、不受影响，
  // 但源文件副本对"以后还想编辑人格"的人有用，值得找一下。
  const repoCandidates = [
    opts.repoRoot,
    process.env.DSH_QQ_REPO,
    path.join(process.cwd(), 'dsh-qq-instruction'),
    // 本机部署的实际位置：$DSH_HOME/home/QQBotV2/dsh-qq-instruction
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
    // 回退：db 与 wal 必须成对，否则会丢已提交数据
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

/**
 * 计划导出：只算不写。
 * @param {{include:string[], paths:ReturnType<typeof resolvePaths>}} input
 */
export function planExport({ include, paths }) {
  const { include: picked, ignored } = normalizeInclude(include);
  const files = [];
  const warnings = [];
  const skipped = [];

  if (picked.length === 0 && ignored.length === 0) {
    warnings.push('没有勾选任何数据项：至少要选一项才会生成包');
  }

  let patchText = '';
  if (picked.includes('config') || picked.includes('whaleConfig') || picked.includes('persona')) {
    if (fs.existsSync(paths.patchPath)) patchText = fs.readFileSync(paths.patchPath, 'utf8');
    else warnings.push(`找不到 profile 配置：${paths.patchPath}`);
  }

  if (picked.includes('config')) {
    const block = extractEntryBlock(patchText, ENTRY.qqBot);
    if (block === '') {
      warnings.push(`配置里没有 \`${ENTRY.qqBot}\` 段，无法导出（先确认 dsh-qq-bot 已装并配置）`);
    } else {
      files.push({
        path: 'cordis-qq-bot.yml',
        source: paths.patchPath,
        lines: block.split('\n').length,
        bytes: Buffer.byteLength(`${block}\n`),
        sensitive: true,
        note: '含 NapCat token 与 QQ 号，请只走私密通道',
      });
    }
  }

  if (picked.includes('whaleConfig')) {
    const block = extractEntryBlock(patchText, ENTRY.whale);
    if (block === '') {
      skipped.push({ key: 'whaleConfig', reason: 'profile 里没有 dsh-qq-whale 段（该插件当前只提供 preset，通常没有配置段）' });
    } else {
      files.push({
        path: 'cordis-qq-whale.yml',
        source: paths.patchPath,
        lines: block.split('\n').length,
        bytes: Buffer.byteLength(`${block}\n`),
        sensitive: false,
      });
    }
  }

  if (picked.includes('persona')) {
    // 真正生效的人格是 cordis.patch.yml 里 dsh-qq-bot.config.persona.text，
    // 不是仓库里的 persona/whale.md（那是源文件）。早期版本只备份了后者，
    // 结果导到新机器人格根本没恢复——所以这里以"生效值"为主，源文件只作附带副本。
    const effective = extractPersonaText(patchText);
    if (effective.ok === true && effective.text !== '') {
      files.push({
        path: 'persona/persona.text',
        source: paths.patchPath,
        chars: effective.text.length,
        bytes: Buffer.byteLength(effective.text, 'utf8'),
        sensitive: false,
        effective: 'config.persona.text',
        note: '生效人格文本（来自 cordis.patch.yml 的 persona.text），导回时会写回配置',
      });
    } else if (effective.ok !== true) {
      warnings.push(`读不到生效人格（${effective.error}）：这次只备份人格源文件`);
    } else {
      warnings.push('配置里的 persona.text 是空的：这次只备份人格源文件');
    }

    if (fs.existsSync(paths.personaPath)) {
      files.push({
        path: 'persona/whale.md',
        source: paths.personaPath,
        bytes: fs.statSync(paths.personaPath).size,
        sensitive: false,
        note: '人格源文件（仅供编辑/回填真源，不直接进会话）',
      });
    } else if (effective.ok !== true || effective.text === '') {
      warnings.push(`找不到人格真源：${paths.personaPath}`);
    }
  }

  if (picked.includes('memory')) {
    if (fs.existsSync(paths.dbPath)) {
      files.push({
        path: 'memory/memory.db',
        source: paths.dbPath,
        bytes: fs.statSync(paths.dbPath).size,
        sensitive: true,
        note: '含聊天记忆（可能涉及他人隐私），导出前想清楚',
      });
    } else {
      warnings.push(`找不到记忆库：${paths.dbPath}`);
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
  return {
    ok: true,
    include: picked,
    ignored,
    files,
    totalBytes,
    warnings,
    skipped: [...skipped, ...Object.entries(SKIPPED).map(([key, meta]) => ({ key, reason: meta.reason, notImplemented: true }))],
    dshVersion: detectDshVersion(),
  };
}

/**
 * 真导出：写 staging → tar czf → 返回路径。
 * @param {{include:string[], paths:ReturnType<typeof resolvePaths>, outDir?:string, now?:Date}} input
 */
export function runExport({ include, paths, outDir, now }) {
  const plan = planExport({ include, paths });
  if (plan.files.length === 0) {
    return { ok: false, error: '没有可导出的数据项', plan };
  }

  const dir = path.resolve(outDir ?? paths.backupDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = ts(now ?? new Date());
  const outPath = path.join(dir, `qqbot-vault-${stamp}.tar.gz`);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-vault-export-'));

  try {
    for (const file of plan.files) {
      const dest = path.join(staging, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (file.path === 'cordis-qq-bot.yml' || file.path === 'cordis-qq-whale.yml') {
        const entryId = file.path === 'cordis-qq-bot.yml' ? ENTRY.qqBot : ENTRY.whale;
        const block = extractEntryBlock(fs.readFileSync(paths.patchPath, 'utf8'), entryId);
        fs.writeFileSync(dest, `${block}\n`, 'utf8');
      } else if (file.path === 'memory/memory.db') {
        const mem = exportMemoryDb(paths.dbPath, dest);
        if (!mem.ok) {
          plan.warnings.push(`记忆库未导出：${mem.error}`);
          continue;
        }
        if (mem.warning) plan.warnings.push(mem.warning);
        // 回退模式下 wal/shm 已就近写在 dest 旁，一并入包
      } else if (file.path === 'persona/persona.text') {
        // 生效人格：从配置里现取一次，避免和 plan 阶段之间被改过
        const effective = extractPersonaText(fs.readFileSync(paths.patchPath, 'utf8'));
        if (effective.ok !== true) {
          plan.warnings.push(`人格未导出：${effective.error}`);
          continue;
        }
        fs.writeFileSync(dest, effective.text, 'utf8');
      } else {
        fs.copyFileSync(file.source, dest);
      }
    }

    const files = walkFiles(staging);
    const manifest = {
      schemaVersion: 1,
      kind: 'qqbot-vault-bundle',
      exportedAt: new Date().toISOString(),
      dsh: { version: plan.dshVersion, home: paths.home, profile: paths.profile },
      plugins: {
        qqBot: readJsonSafe(path.join(paths.profileDir, 'node_modules', '@sputnikzaychik', 'dsh-qq-bot', 'package.json'))?.version ?? 'unknown',
        whale: readJsonSafe(path.join(paths.repoRoot, 'packages', 'dsh-qq-whale', 'package.json'))?.version ?? 'unknown',
        meowMemory: readJsonSafe(path.join(paths.profileDir, 'node_modules', 'meow-memory', 'package.json'))?.version ?? 'unknown',
      },
      include: plan.include.filter((key) => !(key === 'whaleConfig' && !files.some((f) => f.path === 'cordis-qq-whale.yml'))),
      files,
      notes: [
        'cordis-qq-bot.yml 含 NapCat token 与 QQ 号，请务必私密传输',
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
      files,
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
 * 校验包内文件的完整性：按 manifest.files 的 sha256 逐个比对。
 *
 * 为什么必须做：备份包含 NapCat token 与记忆库，传输过程（网盘、IM、剪贴板）
 * 都可能损坏或截断。没有这一步时，损坏的包会「看起来导入成功」，实际写进半截配置。
 *
 * 兼容：0.1/0.2 的包 manifest.files 已带 sha256；若字段缺失则跳过并给出提示，
 * 不因为旧包而拒绝导入（宁可提示，不要把用户锁死）。
 *
 * @param {string} staging 解包目录
 * @param {any} manifest 包内 manifest.json
 * @returns {{ ok:boolean, checked:number, missing:string[], mismatched:{path:string, expected:string, actual:string}[], skipped:string[] }}
 */
export function verifyBundleIntegrity(staging, manifest) {
  const result = { ok: true, checked: 0, missing: [], mismatched: [], skipped: [] };
  const files = Array.isArray(manifest?.files) ? manifest.files : undefined;
  if (files === undefined) {
    result.skipped.push('manifest 里没有 files 清单（旧版本包），跳过完整性校验');
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
 * 目的是让设置页给下拉选择，而不是让用户手打路径。
 *
 * @param {ReturnType<typeof resolvePaths>} paths
 * @returns {{ ok:true, dir:string, files:{name:string,path:string,bytes:number,mtime:string}[] }}
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
 *
 * @param {{paths:ReturnType<typeof resolvePaths>, keep?:number, maxAgeDays?:number, write?:boolean, now?:Date}} input
 */
export function cleanupBundles({ paths, keep = 10, maxAgeDays, write = false, now = new Date() }) {
  const listed = listBundles(paths);
  const safeKeep = Math.max(1, Number.isFinite(keep) ? Math.floor(keep) : 10);
  const cutoff = maxAgeDays === undefined || maxAgeDays === null
    ? undefined
    : now.getTime() - Math.max(0, Number(maxAgeDays)) * 24 * 60 * 60 * 1000;

  // files 已按 mtime 倒序：前 safeKeep 个保留
  const keepSet = new Set(listed.files.slice(0, safeKeep).map((file) => file.path));
  // 永远保住最新的一个：即使它已经超过 maxAgeDays，也不能让目录变空
  const newest = listed.files.length > 0 ? listed.files[0].path : undefined;

  const doomed = listed.files.filter((file) => {
    if (file.path === newest) return false;
    const beyondKeep = keepSet.has(file.path) !== true;
    if (cutoff === undefined) return beyondKeep;
    const tooOld = Date.parse(file.mtime) <= cutoff;
    // 两种都算：超出保留数量的，或超过年龄的（后者用于启动清理）
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

/**
 * 预览导入：解包 → 完整性校验 → 版本闸 → 算出将变动的条目，不写任何文件。
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

    // 完整性：manifest 的 sha256 与实际解包内容比对。缺文件/不一致都算失败，
    // 除非调用方显式 force（例如明知手工改过包内容）。
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

    const changes = [];
    const warnings = [];

    const bundledPath = path.join(staging, 'cordis-qq-bot.yml');
    if (fs.existsSync(bundledPath)) {
      const bundled = fs.readFileSync(bundledPath, 'utf8').replace(/\s+$/, '');
      if (!bundled.startsWith(ENTRY.qqBot)) {
        warnings.push(`包内 cordis-qq-bot.yml 不以 \`${ENTRY.qqBot}\` 开头，将忽略`);
      } else {
        const targetText = fs.existsSync(paths.patchPath) ? fs.readFileSync(paths.patchPath, 'utf8') : '';
        const existing = findEntryBlock(targetText, ENTRY.qqBot);
        changes.push({
          key: 'config',
          target: paths.patchPath,
          action: existing.block === '' ? 'append' : 'replace',
          lines: bundled.split('\n').length,
          existingLines: existing.block === '' ? 0 : existing.block.split('\n').length,
          preview: bundled.split('\n').slice(0, 6),
          sensitive: true,
        });
      }
    }

    const bundledWhale = path.join(staging, 'cordis-qq-whale.yml');
    if (fs.existsSync(bundledWhale)) {
      const bundled = fs.readFileSync(bundledWhale, 'utf8').replace(/\s+$/, '');
      const targetText = fs.existsSync(paths.patchPath) ? fs.readFileSync(paths.patchPath, 'utf8') : '';
      const existing = findEntryBlock(targetText, ENTRY.whale);
      changes.push({
        key: 'whaleConfig',
        target: paths.patchPath,
        action: existing.block === '' ? 'append' : 'replace',
        lines: bundled.split('\n').length,
        existingLines: existing.block === '' ? 0 : existing.block.split('\n').length,
        sensitive: false,
      });
    }

    const bundledDb = path.join(staging, 'memory', 'memory.db');
    if (fs.existsSync(bundledDb)) {
      changes.push({
        key: 'memory',
        target: paths.dbPath,
        action: fs.existsSync(paths.dbPath) ? 'replace' : 'create',
        bytes: fs.statSync(bundledDb).size,
        sensitive: true,
      });
    }

    const bundledPersonaText = path.join(staging, 'persona', 'persona.text');
    const bundledPersona = path.join(staging, 'persona', 'whale.md');
    if (fs.existsSync(bundledPersonaText)) {
      const incoming = fs.readFileSync(bundledPersonaText, 'utf8');
      const currentText = fs.existsSync(paths.patchPath) ? fs.readFileSync(paths.patchPath, 'utf8') : '';
      const current = extractPersonaText(currentText);
      changes.push({
        key: 'persona',
        target: paths.patchPath,
        action: current.ok === true ? 'replace' : 'create',
        chars: incoming.length,
        existingChars: current.ok === true ? current.text.length : 0,
        sensitive: false,
        effective: 'config.persona.text',
        note: `将把人格写回 dsh-qq-bot 配置的 persona.text（${incoming.length} 字符，当前 ${current.ok === true ? current.text.length : 0} 字符）`,
      });
    } else if (fs.existsSync(bundledPersona)) {
      // 旧包：只有源文件。读出来当成人格文本写回去，并说明这是兼容路径。
      const legacy = fs.readFileSync(bundledPersona, 'utf8');
      changes.push({
        key: 'persona',
        target: paths.patchPath,
        action: 'replace',
        chars: legacy.length,
        sensitive: false,
        effective: 'config.persona.text',
        legacy: true,
        note: `旧包（只有 persona/whale.md）：将把该文件内容当作 persona.text 写入配置（${legacy.length} 字符）`,
      });
      warnings.push('这个包是旧格式：人格只带了源文件 whale.md，已按"把它写进配置"处理；源文件本身不会被单独落盘');
    }

    if (changes.length === 0) warnings.push('这个包里没有可识别的内容（配置/记忆/人格都没有）');

    return { ok: true, manifest, version, integrity, changes, warnings };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (opened !== undefined) opened.cleanup();
  }
}

/**
 * 真导入：备份 → 合并配置 → 恢复记忆 → （可选）写人格真源。
 * @param {{bundlePath:string, paths:ReturnType<typeof resolvePaths>, write?:boolean, force?:boolean, include?:string[], now?:Date}} input
 */
export function runImport({ bundlePath, paths, write = false, force = false, include, now }) {
  const picked = include === undefined ? undefined : normalizeInclude(include).include;
  const preview = previewImport({ bundlePath, paths, force });
  if (preview.ok !== true) return preview;
  if (preview.version.blocked) {
    return failure(ERROR_CODES.versionMismatch, preview.version.message, { preview });
  }
  if (preview.integrity !== undefined && preview.integrity.blocked === true) {
    return failure(ERROR_CODES.integrityFailed, preview.integrity.message, { integrity: preview.integrity, preview });
  }

  const wanted = picked === undefined ? preview.changes : preview.changes.filter((c) => picked.includes(c.key));
  if (wanted.length === 0) {
    return failure(ERROR_CODES.nothingToImport, '没有要导入的条目（可能被 include 过滤掉了）', { preview });
  }

  if (write !== true) {
    return { ok: true, written: false, wouldWrite: wanted, preview, message: 'dry-run：没有任何文件被修改' };
  }

  let opened;
  try {
    opened = openBundle(bundlePath);
    const { staging } = opened;
    const stamp = ts(now ?? new Date());
    const written = [];

    // 1) 配置：一次备份，多个段依次合并；人格在配置合并之后写，避免被整段替换覆盖
    const patchChanges = wanted.filter((c) => c.target === paths.patchPath && c.key !== 'persona');
    const personaChange = wanted.find((c) => c.key === 'persona');
    if (patchChanges.length > 0 || personaChange !== undefined) {
      if (!fs.existsSync(paths.patchPath)) throw new Error(`目标配置不存在：${paths.patchPath}`);
      const backupPath = `${paths.patchPath}.bak-vault-${stamp}`;
      fs.copyFileSync(paths.patchPath, backupPath);
      try { fs.chmodSync(backupPath, 0o600); } catch { /* 忽略 */ }

      let text = fs.readFileSync(paths.patchPath, 'utf8');
      for (const change of patchChanges) {
        const file = change.key === 'config' ? 'cordis-qq-bot.yml' : 'cordis-qq-whale.yml';
        const entryId = change.key === 'config' ? ENTRY.qqBot : ENTRY.whale;
        const block = fs.readFileSync(path.join(staging, file), 'utf8').replace(/\s+$/, '');
        const merged = mergeEntryBlock(text, block, entryId);
        text = merged.text;
        written.push({ key: change.key, action: merged.action, target: paths.patchPath });
      }

      if (personaChange !== undefined) {
        const bundledPersonaText = path.join(staging, 'persona', 'persona.text');
        const bundledPersona = path.join(staging, 'persona', 'whale.md');
        const personaText = fs.existsSync(bundledPersonaText)
          ? fs.readFileSync(bundledPersonaText, 'utf8')
          : (fs.existsSync(bundledPersona) ? fs.readFileSync(bundledPersona, 'utf8') : undefined);
        if (personaText === undefined) {
          written.push({ key: 'persona', action: 'skipped', reason: '包里没有 persona/persona.text 或 persona/whale.md' });
        } else {
          const replaced = replacePersonaText(text, personaText);
          if (replaced.ok !== true) throw new Error(`写回人格失败：${replaced.error}`);
          text = replaced.text;
          written.push({ key: 'persona', action: replaced.action, target: paths.patchPath, chars: personaText.length });
        }
      }

      fs.writeFileSync(paths.patchPath, text, 'utf8');
      try { fs.chmodSync(paths.patchPath, 0o600); } catch { /* 忽略 */ }
      written.push({ key: 'backup', path: backupPath });
    }

    // 2) 记忆库
    const memoryChange = wanted.find((c) => c.key === 'memory');
    if (memoryChange !== undefined) {
      const bundledDb = path.join(staging, 'memory', 'memory.db');
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
      fs.copyFileSync(bundledDb, paths.dbPath);
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(bundledDb + suffix)) fs.copyFileSync(bundledDb + suffix, paths.dbPath + suffix);
      }
      written.push({ key: 'memory', action: 'restored', target: paths.dbPath, backups: moved });
    }

    // 3) 人格源文件（可选，仅当包里带了 persona/whale.md）
    //    注意：真正生效的是上面写回配置的 persona.text；这一步只是让仓库里的源文件
    //    跟配置保持一致，方便以后编辑。旧包没有配置写回能力，才会只落到文件。
    if (wanted.some((c) => c.key === 'persona')) {
      const bundledPersona = path.join(staging, 'persona', 'whale.md');
      if (fs.existsSync(bundledPersona)) {
        fs.mkdirSync(path.dirname(paths.personaPath), { recursive: true });
        if (fs.existsSync(paths.personaPath)) {
          const backup = `${paths.personaPath}.bak-vault-${stamp}`;
          fs.copyFileSync(paths.personaPath, backup);
          written.push({ key: 'persona-source-backup', path: backup });
        }
        fs.copyFileSync(bundledPersona, paths.personaPath);
        written.push({ key: 'persona-source', action: 'restored', target: paths.personaPath });
      }
    }

    return {
      ok: true,
      written: true,
      changes: written,
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
