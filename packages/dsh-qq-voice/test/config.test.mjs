/**
 * 配置契约测试：默认值、热改（volatile）、非法值回落。
 *
 * 重点不是「字段能读」，而是「读错了也不会把 undefined 当成关闭/不限」——
 * 这类静默降级在语音场景里会直接变成"往群里发语音"，代价太高。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Config, DEFAULT_CONFIG, MODES, readConfig, resolveApiKey, toolsEnabled } from '../lib/config.js';

test('出厂默认值：默认关闭、manual、ownerOnly、每小时 6 条', () => {
  const cfg = readConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.mode, 'manual');
  assert.equal(cfg.ownerOnly, true);
  assert.equal(cfg.maxPerHour, 6);
  assert.equal(cfg.cooldownSec, 10);
  assert.equal(cfg.maxChars, 300);
  assert.equal(cfg.format, 'wav');
  assert.deepEqual(cfg.allowGroups, []);
  assert.equal(cfg.wsUrl, DEFAULT_CONFIG.wsUrl);
});

test('全部字段标了 volatile（设置页改完要即时生效）', () => {
  // schemastery 把 volatile 放在 meta 上；序列化后每个字段的 meta.volatile 必须是 true。
  // 漏标一个字段的后果很具体：设置页改完不生效，用户以为坏了。
  const json = JSON.stringify(Config.toJSON());
  const volatileCount = (json.match(/\"volatile\":true/g) ?? []).length;
  const keys = Object.keys(DEFAULT_CONFIG);
  assert.ok(
    volatileCount >= keys.length,
    `volatile 标记只有 ${volatileCount} 个，字段有 ${keys.length} 个——有字段漏标了`,
  );
});

test('非法 mode 回落 manual（错字不该让插件装不上）', () => {
  assert.equal(readConfig({ mode: 'disable' }).mode, 'manual');
  assert.equal(readConfig({ mode: 42 }).mode, 'manual');
  assert.equal(readConfig({ mode: 'off' }).mode, 'off');
  for (const mode of MODES) assert.equal(readConfig({ mode }).mode, mode);
});

test('maxChars 下限 1、maxPerHour 允许 0（0 = 不限）', () => {
  assert.equal(readConfig({ maxChars: 0 }).maxChars, 1);
  assert.equal(readConfig({ maxChars: -5 }).maxChars, 1);
  assert.equal(readConfig({ maxChars: 12.9 }).maxChars, 12);
  assert.equal(readConfig({ maxPerHour: 0 }).maxPerHour, 0);
  assert.equal(readConfig({ maxPerHour: -3 }).maxPerHour, 0);
});

test('超范围数值被夹到边界而不是丢弃', () => {
  assert.equal(readConfig({ maxPerHour: 99999 }).maxPerHour, 1000);
  assert.equal(readConfig({ cooldownSec: -1 }).cooldownSec, 0);
  assert.equal(readConfig({ timeoutMs: 10 }).timeoutMs, 1000);
  assert.equal(readConfig({ idleCloseMs: -1 }).idleCloseMs, 0);
});

test('allowGroups：过滤空串与非字符串，非法整体回落空数组', () => {
  assert.deepEqual(readConfig({ allowGroups: [' 123 ', '', 456, '789'] }).allowGroups, ['123', '789']);
  assert.deepEqual(readConfig({ allowGroups: 'not-an-array' }).allowGroups, []);
});

test('volatile 引用对象能被解引用（否则设置页改完不生效）', () => {
  const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');
  const ref = {
    [VOLATILE_WRITE]: true,
    get() { return 'off'; },
  };
  // 直接读 config.mode 会拿到引用对象；readConfig 必须先解引用
  assert.equal(readConfig({ mode: ref }).mode, 'off');
});

test('resolveApiKey：显式字段优先，其次环境变量，都没有返回空串', () => {
  assert.equal(resolveApiKey({ apiKey: 'sk-a', apiKeyEnv: 'X' }, { X: 'sk-env' }), 'sk-a');
  assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: 'X' }, { X: 'sk-env' }), 'sk-env');
  assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: 'X' }, {}), '');
  assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: '' }, { '': 'nope' }), '');
});

test('toolsEnabled：enabled=false 或 mode=off 时不注册工具', () => {
  assert.equal(toolsEnabled(readConfig({ enabled: false })), false);
  assert.equal(toolsEnabled(readConfig({ enabled: true, mode: 'off' })), false);
  assert.equal(toolsEnabled(readConfig({ enabled: true, mode: 'manual' })), true);
  assert.equal(toolsEnabled(readConfig({ enabled: true, mode: 'always' })), true);
});
