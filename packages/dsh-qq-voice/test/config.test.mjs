/**
 * 配置契约测试：默认值、热改（volatile）、非法值回落。
 *
 * 重点不是「字段能读」，而是「读错了也不会把 undefined 当成关闭/不限」——
 * 这类静默降级在语音场景里会直接变成"往群里发语音"，代价太高。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Config, DEFAULT_CONFIG, MODES, normalizeSeed, normalizeVoices, readConfig, resolveApiKey, resolveSeed, resolveVoice, SEED_LIMIT, toolsEnabled, resolveTone, RATE_RANGE, PITCH_RANGE, VOLUME_RANGE } from '../lib/config.js';

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

// ---------------------------------------------------------------- 音色目录 / seed 策略

test('出厂默认：seedMode=model、defaultSeed=2024、音色目录为空', () => {
  const cfg = readConfig({});
  assert.equal(cfg.seedMode, 'model');
  assert.equal(cfg.defaultSeed, 2024);
  assert.deepEqual(cfg.voices, []);
});

test('normalizeVoices：过滤无 id 的条目、补 label、按 id 去重', () => {
  const list = normalizeVoices([
    { id: 'a', label: '甲', note: '慢' },
    { id: ' a ', label: '重复的甲' }, // 去空格后与第一条同 id → 覆盖
    { label: '没有 id' },
    null,
    'junk',
    { id: 'b', note: 42 },
  ]);
  assert.deepEqual(list.map((v) => v.id), ['a', 'b']);
  assert.equal(list[0].label, '重复的甲', '后来的同 id 条目覆盖前面的');
  assert.equal(list[1].label, 'b', 'label 缺失时回落成 id');
  assert.equal(list[1].note, '', '非字符串 note 归一成空串');
  assert.deepEqual(normalizeVoices('not-an-array'), []);
});

test('resolveVoice：空目录时透传任意 id；非空目录时只认 id 或名字', () => {
  const open = readConfig({ ttsVoice: '' });
  assert.deepEqual(resolveVoice(open, 'whatever'), { ok: true, voice: 'whatever', source: 'passthrough' });

  const cfg = readConfig({ ttsVoice: 'default-v', voices: [{ id: 'v1', label: '龙灵安希' }, { id: 'v2', label: 'Cherry' }] });
  assert.deepEqual(resolveVoice(cfg, 'v1'), { ok: true, voice: 'v1', source: 'requested' });
  assert.deepEqual(resolveVoice(cfg, '龙灵安希'), { ok: true, voice: 'v1', source: 'alias' }, '名字也要认，模型看到的是名字');
  const bad = resolveVoice(cfg, '编造的');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不在可选目录/);
  assert.match(bad.error, /龙灵安希（v1）/, '拒绝时要把可选项列出来，模型才知道下次传什么');
});

test('resolveVoice：模型没传时用配置默认；默认也为空才算不指定', () => {
  const cfg = readConfig({ ttsVoice: 'default-v', voices: [{ id: 'v1', label: '甲' }] });
  assert.deepEqual(resolveVoice(cfg, ''), { ok: true, voice: 'default-v', source: 'default' });
  const empty = readConfig({ ttsVoice: '', voices: [{ id: 'v1', label: '甲' }] });
  assert.deepEqual(resolveVoice(empty, '   '), { ok: true, voice: '', source: 'passthrough' });
});

test('resolveSeed：三态矩阵（model 用模型值、fixed 永远固定、random 永远随机）', () => {
  const half = () => 0.5;

  const model = readConfig({ seedMode: 'model', defaultSeed: 2024 });
  assert.deepEqual(resolveSeed(model, 7, half), { seed: 7, source: 'model' });
  assert.equal(resolveSeed(model, undefined, half).source, 'random', '没传就随机，别固定成一个值');

  const fixed = readConfig({ seedMode: 'fixed', defaultSeed: 2024 });
  assert.deepEqual(resolveSeed(fixed, 7, half), { seed: 2024, source: 'fixed' }, 'fixed 下模型传值要被忽略');
  assert.deepEqual(resolveSeed(fixed, undefined, half), { seed: 2024, source: 'fixed' });

  const random = readConfig({ seedMode: 'random', defaultSeed: 2024 });
  assert.deepEqual(
    resolveSeed(random, 7, half),
    { seed: Math.floor(0.5 * SEED_LIMIT), source: 'random' },
    'random 下也要忽略模型传值',
  );
  assert.equal(resolveSeed(random, 7, () => 0.999999).seed, Math.floor(0.999999 * SEED_LIMIT));
  // 回归：random() 是 [0,1) 的小数，若误用「取模」会永远得到 0（曾经真的写错过）
  assert.notEqual(resolveSeed(random, 7, () => 0.999999).seed, 0);
});

test('resolveSeed：越界/非整数的模型值一律不当真', () => {
  const cfg = readConfig({ seedMode: 'model' });
  for (const bad of [-1, 1.5, SEED_LIMIT, 1e12, 'abc', NaN, null]) {
    const r = resolveSeed(cfg, bad, () => 0.25);
    assert.equal(r.source, 'random', `seed=${String(bad)} 应该回落到随机`);
    assert.ok(Number.isInteger(r.seed) && r.seed >= 0 && r.seed < SEED_LIMIT);
  }
  // 边界：0 与 SEED_LIMIT-1 合法
  assert.equal(resolveSeed(cfg, 0, () => 0.5).seed, 0);
  assert.equal(resolveSeed(cfg, SEED_LIMIT - 1, () => 0.5).seed, SEED_LIMIT - 1);
});

test('normalizeSeed / defaultSeed：非法配置回落 2024，越界也回落', () => {
  assert.equal(normalizeSeed(undefined), 2024);
  assert.equal(normalizeSeed(-5), 2024);
  assert.equal(normalizeSeed(2.5), 2024);
  assert.equal(normalizeSeed(SEED_LIMIT), 2024);
  assert.equal(normalizeSeed(0), 0);
  assert.equal(readConfig({ defaultSeed: -1 }).defaultSeed, 2024);
  assert.equal(readConfig({ defaultSeed: 1e12 }).defaultSeed, 2024);
  assert.equal(readConfig({ defaultSeed: 99 }).defaultSeed, 99);
});

test('非法 seedMode 回落 model', () => {
  assert.equal(readConfig({ seedMode: 'fixed' }).seedMode, 'fixed');
  assert.equal(readConfig({ seedMode: 'random' }).seedMode, 'random');
  assert.equal(readConfig({ seedMode: 'nonsense' }).seedMode, 'model');
  assert.equal(readConfig({ seedMode: 42 }).seedMode, 'model');
});

test('resolveTone 三态：模型值 > 配置默认 > 不传', () => {
  // 模型给了合法值
  assert.deepEqual(resolveTone('rate', 1.4, 1.0, RATE_RANGE), { value: 1.4, source: 'model' });
  // 模型没给 → 配置默认
  assert.deepEqual(resolveTone('rate', undefined, 0.8, RATE_RANGE), { value: 0.8, source: 'default' });
  // 都没有 → 不传（value=null）
  assert.deepEqual(resolveTone('rate', undefined, null, RATE_RANGE), { value: null, source: 'none' });
  // 空串/NaN 视作没给
  assert.equal(resolveTone('pitch', '', 1.2, PITCH_RANGE).source, 'default');
  assert.equal(resolveTone('pitch', 'abc', null, PITCH_RANGE).value, null);
});

test('resolveTone 越界夹到边界，并写明被夹过', () => {
  const hi = resolveTone('rate', 3, null, RATE_RANGE);
  assert.equal(hi.value, 2);
  assert.equal(hi.source, 'model');
  assert.match(hi.note, /rate 3 已夹到 2/);

  const lo = resolveTone('pitch', 0.1, null, PITCH_RANGE);
  assert.equal(lo.value, 0.5);
  assert.match(lo.note, /pitch 0.1 已夹到 0.5/);

  const vol = resolveTone('volume', 200, null, VOLUME_RANGE);
  assert.equal(vol.value, 100);
  assert.match(vol.note, /volume 200 已夹到 100/);

  // 配置里的值越界也要夹，并且 note 说明是配置的问题
  const cfgClamp = resolveTone('volume', undefined, 999, VOLUME_RANGE);
  assert.equal(cfgClamp.value, 100);
  assert.match(cfgClamp.note, /配置里的 volume 999 已夹到 100/);
});

test('readConfig：语气三参数归一，非法值变 null（= 不传）', () => {
  const cfg = readConfig({ defaultRate: '1.5', defaultPitch: 'abc', defaultVolume: 0 });
  assert.equal(cfg.defaultRate, 1.5, '数字字符串要能读成数字');
  assert.equal(cfg.defaultPitch, null, '非数字回落 null');
  assert.equal(cfg.defaultVolume, 0, '0 是合法音量，不能当缺失');

  const empty = readConfig({});
  assert.equal(empty.defaultRate, 1.0);
  assert.equal(empty.defaultPitch, 1.0);
  assert.equal(empty.defaultVolume, 50);
});

test('语气三参数哨兵：rate/pitch 的 0 与 volume 的负数都表示「不传」', () => {
  // rate/pitch 合法区间从 0.5 起，写 0 只可能是「不要传」
  assert.equal(readConfig({ defaultRate: 0 }).defaultRate, null);
  assert.equal(readConfig({ defaultPitch: 0 }).defaultPitch, null);
  // volume 的 0 是合法音量（静音），不能当哨兵
  assert.equal(readConfig({ defaultVolume: 0 }).defaultVolume, 0);
  assert.equal(readConfig({ defaultVolume: -1 }).defaultVolume, null);
  // 显式 null 也是不传
  assert.equal(readConfig({ defaultRate: null }).defaultRate, null);
  // 键缺失才回落到出厂默认
  assert.equal(readConfig({}).defaultRate, 1.0);
  assert.equal(readConfig({}).defaultVolume, 50);
});
