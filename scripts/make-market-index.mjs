#!/usr/bin/env node
/**
 * 生成插件市场索引（format 1），并用官方 `parseMarketIndex` 自校验。
 *
 * 为什么要有它：市场索引是「一个静态 JSON 的 URL」，用户把它加进 DSH 后
 * 才会在「发现」里看到插件。手写这个 JSON 极易踩格式规则（图标必须是同源或
 * https、commit 必须 40 位小写 hex、category 必须先在索引里声明……），
 * 所以这里用官方校验器把关，生成即验证。
 *
 * 用法：
 *   node scripts/make-market-index.mjs --repo https://github.com/OWNER/REPO
 *   node scripts/make-market-index.mjs --repo … --write           # 真写 market/index.json
 *   node scripts/make-market-index.mjs --repo … --commit <sha> --timestamp 1763000000
 *   node scripts/make-market-index.mjs --repo … --out /tmp/i.json --json
 *
 * 默认 dry-run：只打印要写入的内容并做校验，不落盘。
 * 退出码：0 通过；1 参数/校验失败。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

/** 相对索引文件计算图标的目录（market/index.json → ../packages/x/icon.svg）。 */
const DEFAULT_OUT = path.join('market', 'index.json');

/** 索引级标题：市场下拉框里显示的名字。 */
const INDEX_TITLE = { en: 'QQBot plugins', zh: 'QQBot 插件' };
const INDEX_DESCRIPTION = {
  en: 'Plugins for running a QQ (OneBot/NapCat) bot on DeepSeek Harness: a restricted agent preset, and settings-page backup.',
  zh: '在 DeepSeek Harness 上跑 QQ（OneBot/NapCat）机器人用的插件：受限 agent preset，以及设置页备份。',
};

/**
 * 分类声明：插件里的 `dsh.catalog.category` 必须在这里登记过。
 * 每个声明必须是 `{ title: LocalizedText }` 的形状（校验器读的是声明对象的 title）。
 */
const CATEGORY_DECLARATIONS = {
  preset: { title: { en: 'Agent preset', zh: 'Agent 预设' } },
  qq: { title: { en: 'QQ / OneBot', zh: 'QQ / OneBot' } },
};

/** 标签声明（可选，这里先留空；加标签时必须先在索引里声明，形状同上）。 */
const LABEL_DECLARATIONS = {};

/**
 * 解析 `--flag value` / `--flag`。
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 退出并报错。
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

/**
 * 把各种写法的仓库地址归一成 `https://host/owner/repo`（无 `.git`、无尾斜杠）。
 * @param {string} raw
 * @returns {string}
 */
function normalizeRepo(raw) {
  let text = raw.trim();
  // 允许 git+https://…、git@host:owner/repo.git 与带 .git 后缀的写法
  if (text.startsWith('git+')) text = text.slice(4);
  const scp = /^git@([^:]+):(.+)$/u.exec(text);
  if (scp !== null) text = `https://${scp[1]}/${scp[2]}`;
  if (!URL.canParse(text)) fail(`--repo 不是合法 URL：${raw}`);
  const url = new URL(text);
  if (url.protocol !== 'https:') fail('--repo 必须是 https 地址（市场安装走 git+https）');
  if (/\.[a-z]+$/iu.test(url.hostname) === false && url.hostname !== 'localhost') {
    // 不是硬错误，但提示一下常见的漏写域名后缀
    process.stderr.write(`! 提醒：仓库域名 "${url.hostname}" 看起来不像有顶级域，确认一下\n`);
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/u, '');
  if (pathname.endsWith('.git')) pathname = pathname.slice(0, -4);
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) fail(`--repo 必须至少含 owner/repo 两段：${raw}`);
  return `${url.origin}${pathname}`;
}

/**
 * 取当前 HEAD 的 40 位小写 commit。
 * @param {string | undefined} override
 * @returns {string}
 */
function resolveCommit(override) {
  const commit = override ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) fail(`commit 必须是 40 位小写 hex，得到：${commit}`);
  return commit;
}

/**
 * 动态加载官方校验器；找不到就明确报错而不是跳过校验。
 * @returns {Promise<{parseMarketIndex: Function, marketInstallTarget: Function}>}
 */
async function loadValidator() {
  const candidates = [
    '@deepseek-ai/dsh-plugin-market-index',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith('/') ? pathToFileURL(candidate).href : candidate;
      return await import(specifier);
    } catch (error) {
      errors.push(`${candidate}: ${error?.code ?? error?.message ?? error}`);
    }
  }
  fail(`无法加载 @deepseek-ai/dsh-plugin-market-index（校验是必需的）：\n  ${errors.join('\n  ')}`);
}

/**
 * 只收集真的是「DSH 插件」的子包：必须有 dsh.bundle.patch 或 dsh.client。
 * 普通包（例如纯工具库）不该出现在市场索引里。
 * @returns {{dir: string, pkg: Record<string, any>}[]}
 */
function collectPackages() {
  if (!fs.existsSync(PACKAGES_DIR)) fail(`找不到 packages 目录：${PACKAGES_DIR}`);
  const found = [];
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PACKAGES_DIR, entry.name, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.private === true) continue;
    if (pkg.dsh?.bundle?.patch === undefined && pkg.dsh?.client === undefined) continue;
    found.push({ dir: entry.name, pkg });
  }
  if (found.length === 0) fail('packages/ 下没有找到任何 DSH 插件');
  return found;
}

/**
 * 取 DSH 兼容范围：优先 `dsh.compatibility.dsh`（本仓库用它表达上限），再退回 `engines.dsh`。
 * @param {Record<string, any>} pkg
 * @returns {string | undefined}
 */
function dshRange(pkg) {
  const range = pkg.dsh?.compatibility?.dsh ?? pkg.engines?.dsh;
  if (typeof range !== 'string' || range.trim() === '') return undefined;
  if (range.startsWith('workspace:')) fail(`${pkg.name} 的 dsh 兼容范围不能是 workspace: 写法`);
  return range;
}

/**
 * 读包内 `locale/<lang>.json` 的 `meta.title` / `meta.description`。
 * 这与 DSH 设置页显示名的来源一致——避免索引里中文标题被当成英文。
 * @param {string} packageRoot
 * @param {string} language
 * @returns {{title?: string, description?: string}}
 */
function readLocaleMeta(packageRoot, language) {
  const file = path.join(packageRoot, 'locale', `${language}.json`);
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} 不是合法 JSON：${error?.message ?? error}`);
  }
  const meta = typeof parsed?.meta === 'object' && parsed.meta !== null ? parsed.meta : {};
  const pick = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
  return {
    ...pick(meta.title) === undefined ? {} : { title: pick(meta.title) },
    ...pick(meta.description) === undefined ? {} : { description: pick(meta.description) },
  };
}

/**
 * 生成一个插件的索引条目。
 * @param {{dir: string, pkg: Record<string, any>}} entry
 * @param {{repo: string, commit: string, timestamp: number, outFile: string}} context
 * @returns {Record<string, unknown>}
 */
function pluginEntry(entry, context) {
  const { dir, pkg } = entry;
  const packageDir = `packages/${dir}`;
  const packageRoot = path.join(PACKAGES_DIR, dir);

  // 图标：索引里的相对路径必须能从索引文件所在目录解析到同一个 origin
  const iconFile = typeof pkg.icon === 'string' ? path.join(packageRoot, pkg.icon) : undefined;
  const icon = iconFile !== undefined && fs.existsSync(iconFile)
    ? path.relative(path.dirname(context.outFile), iconFile).split(path.sep).join('/')
    : undefined;

  // 显示文本优先取 locale/<lang>.json（与设置页显示名同源），再退回 package.json 的 meta/description
  const localeEn = readLocaleMeta(packageRoot, 'en');
  const localeZh = readLocaleMeta(packageRoot, 'zh');
  const summary = pkg.dsh?.catalog?.summary;
  const titleEn = localeEn.title ?? (typeof pkg.meta?.title === 'string' ? pkg.meta.title : undefined);
  const titleZh = localeZh.title ?? (typeof pkg.meta?.title === 'string' ? pkg.meta.title : undefined);
  const descEn = localeEn.description
    ?? summary?.en
    ?? (typeof pkg.description === 'string' ? pkg.description : undefined);
  const descZh = localeZh.description ?? summary?.zh ?? descEn;
  const title = titleEn === undefined ? undefined : { en: titleEn, ...titleZh === undefined ? {} : { zh: titleZh } };
  const description = descEn === undefined ? undefined : { en: descEn, ...descZh === undefined ? {} : { zh: descZh } };

  const category = pkg.dsh?.catalog?.category;
  if (category !== undefined && CATEGORY_DECLARATIONS[category] === undefined) {
    fail(`${pkg.name} 的 dsh.catalog.category="${category}" 未在 make-market-index.mjs 的 CATEGORY_DECLARATIONS 里声明`);
  }

  /** @type {Record<string, unknown>} */
  const version = {
    version: pkg.version,
    publishTimestamp: context.timestamp,
    source: { type: 'git', url: context.repo, commit: context.commit, path: packageDir },
  };
  const range = dshRange(pkg);
  if (range !== undefined) version.engines = { dsh: range };

  /** @type {Record<string, unknown>} */
  const result = {
    name: pkg.name,
    ...title === undefined ? {} : { title },
    ...description === undefined ? {} : { description },
    ...icon === undefined ? {} : { icon },
    ...pkg.author === undefined ? {} : { author: typeof pkg.author === 'string' ? pkg.author : pkg.author.name },
    // homepage / repository 一律由 --repo 推导：索引是「仓库地址」的参数化产物，
    // 不能混进 package.json 里的旧地址（否则市场详情页会给出两个不同仓库）。
    homepage: context.repo,
    repository: { url: context.repo, directory: packageDir },
    metadata: {
      ...category === undefined ? {} : { category },
      keywords: pkg.keywords ?? [],
    },
    versions: [version],
  };
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (args.repo === true || typeof args.repo !== 'string') {
  fail('必须用 --repo 指定仓库地址，例如 --repo https://github.com/OWNER/REPO');
}

const repo = normalizeRepo(args.repo);
const commit = resolveCommit(typeof args.commit === 'string' ? args.commit : undefined);
const timestamp = typeof args.timestamp === 'string'
  ? Number.parseInt(args.timestamp, 10)
  : Math.floor(Date.now() / 1000);
if (!Number.isInteger(timestamp) || timestamp <= 0) fail(`--timestamp 必须是整数 Unix 秒，得到：${args.timestamp}`);

const outFile = path.resolve(REPO_ROOT, typeof args.out === 'string' ? args.out : DEFAULT_OUT);
const packages = collectPackages();

const index = {
  format: 1,
  title: INDEX_TITLE,
  description: INDEX_DESCRIPTION,
  metadata: {
    categories: CATEGORY_DECLARATIONS,
    labels: LABEL_DECLARATIONS,
    sortKeys: {},
  },
  plugins: packages.map((entry) => pluginEntry(entry, { repo, commit, timestamp, outFile })),
};

// 校验时用的索引 URL：真实托管位置无法预知，用一个和图标同源的 https 地址即可
const indexUrl = args['index-url'] ?? `${repo}/raw/HEAD/${path.relative(REPO_ROOT, outFile).split(path.sep).join('/')}`;

const { parseMarketIndex, marketInstallTarget } = await loadValidator();

let parsed;
try {
  parsed = parseMarketIndex(index, indexUrl);
} catch (error) {
  if (error?.name === 'MarketIndexError') fail(`索引校验失败：${error.path} ${error.reason}`);
  throw error;
}

// 打印每条插件装出来的 spec，确认单仓库多子包能被正确组装
const specs = parsed.plugins.map((plugin) => {
  const version = plugin.versions[0];
  return { name: plugin.name, version: version.version, ...marketInstallTarget(plugin.name, version) };
});

if (args.json === true) {
  process.stdout.write(`${JSON.stringify({ indexUrl, commit, index: parsed, specs }, null, 2)}\n`);
} else {
  process.stdout.write(`仓库：${repo}\ncommit：${commit}\n索引 URL（校验用）：${indexUrl}\n输出：${path.relative(REPO_ROOT, outFile)}\n\n`);
  for (const spec of specs) {
    process.stdout.write(`✓ ${spec.name}@${spec.version}\n    ${spec.spec}\n`);
  }
  process.stdout.write(`\n校验：parseMarketIndex 通过（${parsed.plugins.length} 个插件）\n`);
}

if (args.write === true) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
  // --json 时 stdout 必须是纯 JSON，落盘提示改走 stderr
  (args.json === true ? process.stderr : process.stdout).write(`\n已写入 ${path.relative(REPO_ROOT, outFile)}\n`);
} else if (args.json !== true) {
  process.stdout.write('\n（dry-run：加 --write 才会落盘）\n');
}
