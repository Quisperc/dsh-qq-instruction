/**
 * 锁住「插件市场可安装形态」：元信息、图标、本地化、exports 与 files。
 *
 * 为什么值得单独测：这些字段错了不会让代码崩，只会让包在市场里显示错、
 * 装不上（exports 指向不存在的文件）或发布成残缺包（files 漏项）。
 * 每一次都靠人肉 review package.json 迟早会漏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('元信息齐备：市场与官方目录需要的字段都在', () => {
  for (const key of ['name', 'version', 'description', 'icon', 'author', 'exports', 'files', 'engines', 'license']) {
    assert.ok(pkg[key] !== undefined, `package.json 缺少 ${key}`);
  }
  assert.equal(pkg.name, 'dsh-qq-vault');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.author === 'civer', `author 应为 civer，实际 ${String(pkg.author)}`);
  assert.ok(pkg.repository?.directory === 'packages/dsh-qq-vault', 'repository.directory 必须指向子包');
  assert.ok(pkg.homepage?.startsWith('http'), 'homepage 必须是绝对 URL');
});

test('engines.dsh 是合法 SemVer range（不能是 workspace: 写法）', () => {
  const range = pkg.dsh?.compatibility?.dsh ?? pkg.engines?.dsh;
  assert.ok(typeof range === 'string' && range.length > 0, '缺少 dsh 兼容范围');
  assert.equal(range.startsWith('workspace:'), false, '不能写 workspace: 范围');
  // 允许比较符、版本号、预发布标识（如 0.2.0-rc.2）与范围连接符
  assert.match(range, /^[0-9A-Za-z.+\-<>=~^|,\s]+$/u, `范围含非法字符：${range}`);
  // 必须至少有一个可解析的版本片段
  assert.match(range, /\d+\.\d+\.\d+/u, `范围里没有版本号：${range}`);
});

test('exports 的每个目标都真实存在（通配项断言目录非空）', () => {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const rel = typeof value === 'string' ? value : value.default;
    assert.ok(rel, `exports["${key}"] 没有解析路径`);
    if (rel.includes('*')) {
      const dir = join(root, rel.slice(0, rel.indexOf('*')));
      assert.doesNotThrow(() => statSync(dir), `exports["${key}"] 的目录不存在：${dir}`);
      assert.ok(readdirSync(dir).length > 0, `exports["${key}"] 的目录是空的：${dir}`);
      continue;
    }
    assert.doesNotThrow(() => readFileSync(join(root, rel)), `exports["${key}"] 指向的文件不存在：${rel}`);
  }
});

test('files 清单覆盖发布所需（漏了就会发布出残缺包）', () => {
  for (const required of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md', 'icon.svg', 'locale']) {
    assert.ok(pkg.files.includes(required), `files 缺少 ${required}`);
  }
});

test('图标是包根内的 SVG，并且 <256 KiB（manifest 的硬限制）', () => {
  assert.equal(pkg.icon, 'icon.svg');
  const file = join(root, pkg.icon);
  const stats = statSync(file);
  assert.ok(stats.isFile(), 'icon 必须是文件');
  assert.ok(stats.size <= 256 * 1024, `icon 超过 256 KiB（${stats.size}）`);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^<svg[\s>]/u, 'icon 应是 SVG');
  assert.match(text, /viewBox=/u, 'SVG 应有 viewBox，否则缩放会变形');
});

test('本地化显示名中英齐备（设置页与市场读的是它）', () => {
  for (const language of ['en', 'zh']) {
    const file = join(root, 'locale', `${language}.json`);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(typeof parsed.meta?.title, 'string', `${language}.json 缺 meta.title`);
    assert.ok(parsed.meta.title.trim() !== '', `${language}.json 的 meta.title 是空的`);
  }
});

test('keywords 面向检索且不重复', () => {
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length <= 14, `keywords 数量异常：${pkg.keywords?.length}`);
  assert.equal(new Set(pkg.keywords).size, pkg.keywords.length, 'keywords 有重复');
  assert.ok(pkg.keywords.every((keyword) => /^[a-z0-9][a-z0-9-]*$/u.test(keyword)), 'keywords 应是小写、数字、短横线');
  for (const keyword of ['qq', 'backup']) {
    assert.ok(pkg.keywords.includes(keyword), `keywords 缺少 ${keyword}`);
  }
});

test('detail 文档：locale 声明与文件都在，且文档恰好一行图片（官方规格）', () => {
  for (const [lang, doc] of [['en', 'docs/DETAIL.md'], ['zh', 'docs/DETAIL.zh.md']]) {
    const locale = JSON.parse(readFileSync(join(root, `locale/${lang}.json`), 'utf8'));
    assert.equal(locale.meta.detail, doc, `${lang} 的 meta.detail 应指向 ${doc}`);
    const lines = readFileSync(join(root, doc), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, '官方规格：DETAIL 文档恰好一行图片');
    assert.match(lines[0], /^!\[[^\]]+\]\(preview\.svg\)$/, '必须是单图引用且 alt 非空');
  }
  const img = join(root, 'docs/preview.svg');
  const svg = readFileSync(img, 'utf8');
  assert.match(svg, /viewBox="0 0 640 300"/, '特性图规格：640×300 viewBox');
  assert.ok(!/<text|<foreignObject|<script/i.test(svg), '特性图不得含文字/脚本/foreignObject');
  assert.ok(statSync(img).size < 1024 * 1024, '特性图应 ≤1 MiB');
  assert.ok(pkg.files.includes('docs'), 'files 必须包含 docs（否则发布包缺详情页资源）');
});
