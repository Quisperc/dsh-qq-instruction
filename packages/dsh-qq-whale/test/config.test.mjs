import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, DEFAULT_ALLOW, DEFAULT_CONFIG, MODES, PRESET_ID, isRestrictionActive, plainConfig, readConfig, wantsHide } from '../lib/config.js';

test('Config 只有两个字段：mode 与 allowTools', () => {
  assert.deepEqual(Object.keys(Config.dict).sort(), ['allowTools', 'mode']);
  const cfg = readConfig(Config({}));
  assert.equal(cfg.mode, 'hide');
  assert.deepEqual(cfg.allowTools, DEFAULT_ALLOW);
});

test('两个字段都是 volatile（热改的前提）', () => {
  for (const key of Object.keys(Config.dict)) {
    assert.equal(Config.dict[key].meta.volatile, true, `${key} 必须是 volatile`);
  }
});

test('mode 只接受三档，写错值回落默认（不能让一个错字让插件装不上）', () => {
  assert.deepEqual(MODES, ['off', 'guard', 'hide']);
  for (const mode of MODES) assert.equal(readConfig({ mode }).mode, mode);
  assert.equal(readConfig({ mode: 'disable' }).mode, 'hide', '枚举外的值回落 hide');
  assert.equal(readConfig({}).mode, 'hide');
  // 重要：类型错/缺失时不能变成"关闭"
  assert.equal(readConfig({ mode: null }).mode, 'hide');
  assert.equal(readConfig({ mode: 1 }).mode, 'hide');
});

test('readConfig：类型不对时回落默认值', () => {
  assert.deepEqual(readConfig(undefined), readConfig(Config({})));
  assert.deepEqual(readConfig({ allowTools: 'qq_history' }).allowTools, DEFAULT_ALLOW, '非数组回落默认');
  assert.deepEqual(readConfig({ allowTools: ['ok', 1] }).allowTools, DEFAULT_ALLOW, '含非字符串回落默认');
});

test('readConfig：显式值优先于默认值', () => {
  assert.deepEqual(readConfig({ mode: 'guard', allowTools: ['qq_history', 'read'] }), {
    mode: 'guard',
    allowTools: ['qq_history', 'read'],
  });
});

test('空 allowTools 视为「不限制」而不是「什么都不允许」', () => {
  const cfg = readConfig({ allowTools: [] });
  assert.deepEqual(cfg.allowTools, []);
  assert.equal(isRestrictionActive(cfg), false, '空名单 = 关闭收窄');
});

test('mode=off 等于全关；guard / hide 都算开启', () => {
  assert.equal(isRestrictionActive({ mode: 'off', allowTools: DEFAULT_ALLOW }), false);
  assert.equal(isRestrictionActive({ mode: 'guard', allowTools: DEFAULT_ALLOW }), true);
  assert.equal(isRestrictionActive({ mode: 'hide', allowTools: DEFAULT_ALLOW }), true);
  assert.equal(isRestrictionActive({ mode: 'hide', allowTools: [] }), false, '空名单优先于档位');
});

test('wantsHide 只在 hide 档为真（guard 不隐藏）', () => {
  assert.equal(wantsHide({ mode: 'hide' }), true);
  assert.equal(wantsHide({ mode: 'guard' }), false);
  assert.equal(wantsHide({ mode: 'off' }), false);
});

test('删掉的字段不存在：enabled / hideFromModel / presetId 都不再是配置项', () => {
  // 回归：v0.13.0 及以前有这四个字段，其中 presetId 是个"改了必然坏"的假旋钮。
  for (const gone of ['enabled', 'hideFromModel', 'presetId']) {
    assert.equal(Config.dict[gone], undefined, `${gone} 应从 Config 移除`);
    assert.equal(gone in readConfig({}), false, `readConfig 不应再返回 ${gone}`);
  }
  // 旧配置里残留这些键时，不应影响新语义
  const cfg = readConfig({ enabled: false, hideFromModel: false, presetId: 'qq2' });
  assert.deepEqual(cfg, { mode: 'hide', allowTools: DEFAULT_ALLOW });
});

test('白名单是 25 项，且刻意不含通用的 web_search / web_fetch', () => {
  assert.equal(DEFAULT_ALLOW.length, 25);
  assert.equal(new Set(DEFAULT_ALLOW).size, 25, '不能有重复项');
  // 联网由 qq_websearch / qq_webfetch 负责，通用版重复且更弱
  assert.equal(DEFAULT_ALLOW.includes('web_search'), false);
  assert.equal(DEFAULT_ALLOW.includes('web_fetch'), false);
  assert.ok(DEFAULT_ALLOW.includes('qq_websearch'));
  assert.ok(DEFAULT_ALLOW.includes('qq_webfetch'));
  // 识图唯一通路，不能删
  assert.ok(DEFAULT_ALLOW.includes('read_image'));
  // 表情包：用户 2026-11-14 要求开启存与偷，工具必须可见
  assert.ok(DEFAULT_ALLOW.includes('qq_sticker'));
  // 语音：TTS 工具必须可见（2026-11-15）
  assert.ok(DEFAULT_ALLOW.includes('qq_voice'));
  // 危险能力不该出现
  for (const dangerous of ['bash', 'subagent', 'workflow', 'terminal_open']) {
    assert.equal(DEFAULT_ALLOW.includes(dangerous), false, `${dangerous} 不该在白名单里`);
  }
});

test('PRESET_ID 是常量，不来自配置', () => {
  assert.equal(PRESET_ID, 'qq');
  assert.equal('presetId' in readConfig({ presetId: 'other' }), false, '配置值不参与行为');
});

test('plainConfig：递归还原引用与嵌套结构', () => {
  const volatileLike = { get: () => 'inner' };
  assert.deepEqual(plainConfig({ a: [volatileLike, 1] }), { a: ['inner', 1] });
  assert.deepEqual(plainConfig({ a: { b: volatileLike } }), { a: { b: 'inner' } });
  assert.equal(plainConfig('x'), 'x');
  assert.equal(plainConfig(null), null);
});

test('DEFAULT_CONFIG 是冻结的出厂值', () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), ['allowTools', 'mode']);
  assert.deepEqual(DEFAULT_CONFIG.allowTools, DEFAULT_ALLOW);
  assert.equal(DEFAULT_CONFIG.mode, 'hide');
});
