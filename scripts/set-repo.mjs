#!/usr/bin/env node
/**
 * 把「占位符仓库地址」一次性替换成真实地址。
 *
 * 为什么需要它：仓库现在还没有确定的托管地址。如果直接把 `OWNER/REPO` 写成
 * 看起来像真的地址（例如 example.com），用户复制安装命令时会得到 404 且不知道原因；
 * 但如果 package.json 里留空，`repository`/`homepage`/`bugs` 又会缺字段。
 *
 * 折中：仓库里统一写显眼的占位符 `https://github.com/OWNER/REPO`，
 * 确定地址后跑一次本脚本的 `--write`，把
 *   - 两个包的 package.json：repository / homepage / bugs
 *   - 根 README 与两个包 README：占位符文本
 * 全部替换掉。默认 dry-run，只打印将要发生的改动。
 *
 * 用法：
 *   node scripts/set-repo.mjs --repo https://github.com/OWNER/REPO          # 预览
 *   node scripts/set-repo.mjs --repo https://github.com/acme/qq --write      # 落盘
 *   node scripts/set-repo.mjs --repo … --branch main --write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** 仓库里统一的占位符（README 中用它写安装命令）。 */
const PLACEHOLDER = 'https://github.com/OWNER/REPO';

/** 需要改 package.json 的子包。 */
const PACKAGES = ['dsh-qq-whale', 'dsh-qq-vault'];

/** 需要替换占位符的文本文件（README 与已生成的索引）。 */
const TEXT_FILES = ['README.md', 'packages/dsh-qq-whale/README.md', 'packages/dsh-qq-vault/README.md', 'market/index.json'];

/**
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
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

/**
 * 归一化仓库地址：去 git+ 前缀、去 .git、去尾斜杠、去凭据与查询串。
 * @param {string} raw
 * @returns {string}
 */
function normalizeRepo(raw) {
  let text = raw.trim();
  if (text.startsWith('git+')) text = text.slice(4);
  const scp = /^git@([^:]+):(.+)$/u.exec(text);
  if (scp !== null) text = `https://${scp[1]}/${scp[2]}`;
  if (!URL.canParse(text)) fail(`--repo 不是合法 URL：${raw}`);
  const url = new URL(text);
  if (url.protocol !== 'https:') fail('--repo 必须是 https 地址');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/u, '');
  if (pathname.endsWith('.git')) pathname = pathname.slice(0, -4);
  if (pathname.split('/').filter(Boolean).length < 2) fail(`--repo 必须含 owner/repo：${raw}`);
  return `${url.origin}${pathname}`;
}

const args = parseArgs(process.argv.slice(2));
if (typeof args.repo !== 'string') {
  fail('必须用 --repo 指定真实仓库地址，例如 --repo https://github.com/acme/qqbot');
}
const repo = normalizeRepo(args.repo);
if (repo === PLACEHOLDER) fail('--repo 仍然是占位符，请填真实地址');
const branch = typeof args.branch === 'string' ? args.branch : 'main';
const write = args.write === true;

/** @type {{file: string, detail: string}[]} */
const changes = [];

// 1) package.json：repository / homepage / bugs
for (const dir of PACKAGES) {
  const file = path.join(REPO_ROOT, 'packages', dir, 'package.json');
  if (!fs.existsSync(file)) {
    process.stderr.write(`! 跳过（不存在）：${path.relative(REPO_ROOT, file)}\n`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = {
    ...pkg,
    repository: { type: 'git', url: `git+${repo}.git`, directory: `packages/${dir}` },
    homepage: `${repo}/tree/${branch}/packages/${dir}`,
    bugs: { url: `${repo}/issues` },
  };
  const before = JSON.stringify(pkg.repository ?? null) + JSON.stringify(pkg.homepage ?? null) + JSON.stringify(pkg.bugs ?? null);
  const after = JSON.stringify(next.repository) + JSON.stringify(next.homepage) + JSON.stringify(next.bugs);
  if (before !== after) {
    changes.push({ file, detail: `repository/homepage/bugs → ${repo}` });
    if (write) fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
}

// 2) README 与已生成的索引：占位符 → 真实地址
for (const relative of TEXT_FILES) {
  const file = path.join(REPO_ROOT, relative);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(PLACEHOLDER)) continue;
  const count = text.split(PLACEHOLDER).length - 1;
  changes.push({ file, detail: `占位符 ×${String(count)} → ${repo}` });
  if (write) fs.writeFileSync(file, text.split(PLACEHOLDER).join(repo));
}

if (changes.length === 0) {
  process.stdout.write(`没有需要改的地方（仓库地址已经是 ${repo}，或 README 里没有占位符）。\n`);
  process.exit(0);
}

process.stdout.write(`${write ? '已修改' : '将要修改'}（仓库 ${repo}，分支 ${branch}）：\n\n`);
for (const change of changes) {
  process.stdout.write(`• ${path.relative(REPO_ROOT, change.file)}\n    ${change.detail}\n`);
}
process.stdout.write(`\n共 ${String(changes.length)} 个文件。${write ? '' : '\n（dry-run：加 --write 才会落盘）'}\n`);
