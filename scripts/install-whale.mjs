#!/usr/bin/env node
/**
 * install-whale.mjs —— 把本仓库的 `packages/dsh-qq-whale` 装进当前 DSH profile。
 *
 * 为什么不用 `dsh plugin add`：
 *   whale 在私有仓库里、没发 npm，`add` 只能装 registry 上的包；而且我们要的是
 *   「改仓库源码 → 立刻生效」的软链开发模式。所以这里手工做 `add` 本来会做的那三件事：
 *
 *     1. 在 <profile>/node_modules/dsh-qq-whale 建**软链**（指向仓库里的包目录）
 *     2. 在 <profile>/package.json 的 `dependencies` 里登记（**不登记插件页就看不到**，
 *        pluginManager.listBundles() 只认 dependencies）
 *     3. 在 `dsh.profile.bundles` 里登记（**不登记就不挂载**，preset-qq 也不会出现）
 *
 * 三个坑都写在 docs/05-handover/CONVENTIONS.md，这里按它执行：
 *   - **绝不调用 pnpm/npm**：profile 里的 `@deepseek-ai/*` 是手工软链到宿主安装目录的，
 *     pnpm install/remove 会把它们当多余包删掉，DSH 直接起不来；
 *   - 两处登记缺一不可；
 *   - 改完要重启（或 set_bundle 关→开）才挂载。
 *
 * 默认 **dry-run**：只打印计划，不改任何文件。要真写必须显式加 `--write`。
 *
 * 用法：
 *   node scripts/install-whale.mjs                  # 看计划
 *   node scripts/install-whale.mjs --write          # 真装
 *   node scripts/install-whale.mjs --write --force  # 覆盖已有的不同软链
 *   node scripts/install-whale.mjs --help
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'dsh-qq-whale';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const HELP = `用法: node scripts/install-whale.mjs [选项]

把仓库里的 packages/dsh-qq-whale 软链进当前 profile（不走 pnpm）。

选项:
  --write                真正落盘（默认 dry-run）
  --home <路径>          DSH_HOME（默认 $DSH_HOME 或 /data/dsh）
  --profile <名字>       profile 名（默认 web）
  --src <路径>           源包目录（默认 <仓库>/packages/dsh-qq-whale）
  --force                目标已存在且指向别处时，替换它
  --help, -h             显示本帮助

做完之后:
  重启 DSH（或 设置 → 插件 → dsh-qq-whale 关→开），
  再确认插件页「已安装插件」里有「QQ 群聊受限预设（preset-qq）」。`;

function parseArgs(argv) {
  const opts = { write: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--write') opts.write = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--home') opts.home = argv[++i];
    else if (arg === '--profile') opts.profile = argv[++i];
    else if (arg === '--src') opts.src = argv[++i];
    else throw new Error(`未知参数: ${arg}（用 --help 看用法）`);
  }
  return opts;
}

function step(opts, message) {
  console.log(`${opts.write ? '[write]' : '[dry-run]'} ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  const home = path.resolve(opts.home ?? process.env.DSH_HOME ?? '/data/dsh');
  const profile = opts.profile ?? 'web';
  const profileDir = path.join(home, 'profiles', profile);
  const srcDir = path.resolve(opts.src ?? path.join(REPO_ROOT, 'packages', PACKAGE_NAME));
  const linkPath = path.join(profileDir, 'node_modules', PACKAGE_NAME);
  const pkgPath = path.join(profileDir, 'package.json');

  console.log('=== 安装 dsh-qq-whale ===');
  console.log(`  源目录   : ${srcDir}`);
  console.log(`  软链目标 : ${linkPath}`);
  console.log(`  profile  : ${pkgPath}`);
  console.log('');

  // 1) 源包必须存在且是 whale
  const srcPkgPath = path.join(srcDir, 'package.json');
  if (!fs.existsSync(srcPkgPath)) throw new Error(`源目录里没有 package.json：${srcPkgPath}（用 --src 指定）`);
  const srcPkg = readJson(srcPkgPath);
  if (srcPkg.name !== PACKAGE_NAME) throw new Error(`源包名是 ${srcPkg.name}，不是 ${PACKAGE_NAME}，拒绝安装`);
  step(opts, `源包：${srcPkg.name}@${srcPkg.version}`);

  if (!fs.existsSync(pkgPath)) throw new Error(`找不到 ${pkgPath}（先装 DSH 并初始化 profile，或用 --home/--profile 指定）`);
  const profilePkg = readJson(pkgPath);

  // 2) 软链现状
  let action = 'create';
  if (fs.existsSync(linkPath) || isBrokenLink(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const resolved = path.resolve(fs.readlinkSync(linkPath));
      if (resolved === srcDir) {
        action = 'keep';
        step(opts, '软链已存在且指向正确，无需改动');
      } else if (opts.force) {
        action = 'replace';
        step(opts, `软链指向别处（${resolved}），--force 将替换`);
      } else {
        throw new Error(`软链已存在但指向 ${resolved}；确认要替换请加 --force`);
      }
    } else if (opts.force) {
      action = 'replace-dir';
      step(opts, `${linkPath} 是真实目录（不是软链），--force 将备份后替换`);
    } else {
      throw new Error(`${linkPath} 已存在且不是软链；确认要替换请加 --force`);
    }
  } else {
    step(opts, `将新建软链 → ${srcDir}`);
  }

  // 3) 两处登记
  const deps = profilePkg.dependencies ?? {};
  const bundles = profilePkg.dsh?.profile?.bundles ?? [];
  const wantedSpec = `file:${srcDir}`;
  const depAction = deps[PACKAGE_NAME] === undefined ? 'add' : (deps[PACKAGE_NAME] === wantedSpec ? 'keep' : 'update');
  const bundleAction = bundles.includes(PACKAGE_NAME) ? 'keep' : 'add';

  step(opts, depAction === 'keep'
    ? `dependencies 已登记：${PACKAGE_NAME} = ${deps[PACKAGE_NAME]}`
    : `dependencies 将写入：${PACKAGE_NAME} = ${wantedSpec}`);
  step(opts, bundleAction === 'keep'
    ? 'dsh.profile.bundles 已包含 dsh-qq-whale'
    : 'dsh.profile.bundles 将追加 dsh-qq-whale');

  if (!opts.write) {
    console.log('');
    step(opts, '将要做的改动（dry-run 不落盘）：');
    if (action === 'keep' && depAction === 'keep' && bundleAction === 'keep') step(opts, '  无 —— 已经是目标状态');
    if (action !== 'keep') step(opts, `  ${action === 'create' ? '创建' : '替换'}软链 ${linkPath} → ${srcDir}`);
    if (depAction !== 'keep') step(opts, `  更新 ${pkgPath} 的 dependencies`);
    if (bundleAction !== 'keep') step(opts, `  更新 ${pkgPath} 的 dsh.profile.bundles`);
    console.log('');
    console.log('真正安装请加 --write。');
    return;
  }

  // 4) 真写
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

  if (action !== 'keep') {
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    if (action === 'replace' || action === 'replace-dir') {
      const backup = `${linkPath}.bak-install-${stamp}`;
      fs.renameSync(linkPath, backup);
      step(opts, `旧的已改名：${backup}`);
    }
    fs.symlinkSync(srcDir, linkPath, 'dir');
    step(opts, `已建软链：${linkPath} → ${srcDir}`);
  }

  if (depAction !== 'keep' || bundleAction !== 'keep') {
    const backup = `${pkgPath}.bak-install-${stamp}`;
    fs.copyFileSync(pkgPath, backup);
    step(opts, `已备份 package.json：${backup}`);
  }

  if (depAction !== 'keep') profilePkg.dependencies[PACKAGE_NAME] = wantedSpec;
  if (bundleAction !== 'keep') {
    profilePkg.dsh = profilePkg.dsh ?? {};
    profilePkg.dsh.profile = profilePkg.dsh.profile ?? {};
    profilePkg.dsh.profile.bundles = bundles.concat(PACKAGE_NAME);
  }
  if (depAction !== 'keep' || bundleAction !== 'keep') {
    fs.writeFileSync(pkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`, 'utf8');
    step(opts, 'package.json 已更新（dependencies + dsh.profile.bundles）');
  }

  console.log('');
  console.log('=== 接下来 ===');
  console.log('1. 重启 DSH（或 设置 → 插件 → dsh-qq-whale 关→开）');
  console.log('2. 插件页「已安装插件」应出现「QQ 群聊受限预设（preset-qq）」');
  console.log('3. 校验组合树：cd /tmp && dsh --profile web --dump-config | grep -E "^- id: (dsh-qq-whale|preset-qq)"');
  console.log('');
  console.log('注意：本脚本没有、也不要调用 pnpm/npm —— profile 里的 @deepseek-ai/* 是手工软链，');
  console.log('      pnpm 会把它们当多余包删掉，导致 DSH 起不来。');
}

function isBrokenLink(file) {
  try { return fs.lstatSync(file).isSymbolicLink() && !fs.existsSync(file); } catch { return false; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`安装失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
