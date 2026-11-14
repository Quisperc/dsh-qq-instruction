import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');

test('包元信息完整：装进插件市场需要的字段都在', () => {
  for (const key of ['name', 'version', 'type', 'main', 'exports', 'files', 'engines', 'dsh', 'meta', 'keywords', 'repository', 'license']) {
    assert.ok(pkg[key] !== undefined, `package.json 缺少 ${key}`);
  }
  assert.equal(pkg.name, 'dsh-qq-whale');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.keywords.includes('dsh-plugin'));
  assert.ok(pkg.repository.directory === 'packages/dsh-qq-whale');
});

test('dsh 声明自洽：bundle.patch 与 client 半都指向真实文件', () => {
  assert.equal(pkg.dsh.runtime, 'host');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(Array.isArray(pkg.dsh.client.inject));
  // exports 必须能把每个子路径解析到真实文件（否则 Loader 装不上、client compose 失败）
  for (const [key, value] of Object.entries(pkg.exports)) {
    const rel = typeof value === 'string' ? value : value.default;
    assert.ok(rel, `exports["${key}"] 没有解析路径`);
    if (rel.includes('*')) {
      // 通配导出（例如 ./locale/*.json）：断言目录存在且至少匹配到一个文件
      const dir = join(root, rel.slice(0, rel.indexOf('*')));
      assert.doesNotThrow(() => statSync(dir), `exports["${key}"] 的目录不存在：${dir}`);
      assert.ok(readdirSync(dir).length > 0, `exports["${key}"] 的目录是空的：${dir}`);
      continue;
    }
    assert.doesNotThrow(() => readFileSync(join(root, rel)), `exports["${key}"] 指向的文件不存在：${rel}`);
  }
  assert.equal(pkg.dsh.compatibility.dsh, '>=0.2.0-rc.2 <0.3.0');
});

test('files 清单覆盖所有运行期需要的文件（漏了就会发布出残缺包）', () => {
  const files = pkg.files;
  for (const required of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md', 'icon.svg', 'locale']) {
    assert.ok(files.includes(required), `files 缺少 ${required}`);
  }
  // 入口与客户端半必须在 lib 下（lib 已整目录包含）
  assert.ok(String(pkg.main).startsWith('lib/'));
});

test('catalog 展示信息齐备（中英摘要 + 能力标签）', () => {
  const catalog = pkg.dsh.catalog;
  assert.ok(catalog, '缺少 dsh.catalog');
  // 分类面向市场浏览：两个 QQBot 插件统一为 qq，避免被分到两处
  assert.equal(catalog.category, 'qq');
  assert.ok(typeof catalog.summary.zh === 'string' && catalog.summary.zh.length > 0);
  assert.ok(typeof catalog.summary.en === 'string' && catalog.summary.en.length > 0);
  assert.ok(Array.isArray(catalog.capabilities) && catalog.capabilities.includes('preset'));
});

test('包内 patch 不再挂 restrict 行（防止两套收窄同时生效）', () => {
  // 回归：v0.8 曾在 preset-qq 里挂 `qq-restrict`，与 agent-guard 的执行期 guard 重复，
  // 且在 agent 刚创建时会让白名单缩水。现在只有 agent-guard 一条路径。
  assert.equal(/dsh-qq-whale\/restrict/.test(patch.replace(/^.*#.*$/gm, '')), false, 'patch 里不应再有生效的 restrict 行');
  assert.equal(/^\s*-\s*id:\s*qq-restrict/m.test(patch), false);
});

test('patch 里 preset-qq 的关键行仍在（这道门锁住架构决策）', () => {
  for (const row of ['id: preset-qq', 'id: persona', 'id: tool-fs', 'id: compaction']) {
    assert.ok(patch.includes(row), `preset-qq 缺少 ${row}`);
  }
});

test('exports 里不再有 restrict 子路径（v0.14.0 删除的兼容入口）', () => {
  // 回归：那个入口与 agent-guard 功能重复，且容易让人误挂成 preset 行导致白名单缩水。
  assert.equal(pkg.exports['./restrict'], undefined, './restrict 应已删除');
  assert.equal(pkg.exports['./agent-guard'], './lib/agent-guard.js', '调试入口仍保留');
  assert.equal(pkg.exports['./client'].default, './lib/client/settings.js');
});

test('描述与关键词保持克制（不堆同义词）', () => {
  assert.ok(pkg.description.length <= 60, `description 太长（${pkg.description.length}）`);
  // 上限从 6 放宽到 12：市场「发现」按 keywords 检索，必须覆盖真实实体词
  // （qq / onebot / napcat / agent-preset）。仍然禁止堆同义词与重复。
  assert.ok(pkg.keywords.length <= 12, `keywords 太多（${pkg.keywords.length}）`);
  assert.equal(new Set(pkg.keywords).size, pkg.keywords.length, 'keywords 有重复');
  assert.ok(pkg.keywords.every((keyword) => /^[a-z0-9][a-z0-9-]*$/u.test(keyword)), 'keywords 应是小写、数字、短横线');
  assert.ok(pkg.keywords.includes('preset'));
  // 生态实体词保留（用户在市场里就是按这些词搜的）；只挡纯噪音词
  for (const noise of ['foo', 'bar', 'awesome']) {
    assert.equal(pkg.keywords.includes(noise), false, `${noise} 属于噪音关键词`);
  }
});
