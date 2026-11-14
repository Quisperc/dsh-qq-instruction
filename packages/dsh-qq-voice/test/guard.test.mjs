/**
 * 权限与节流测试。
 *
 * 这里最要紧的是 **owner 解析**：它决定"谁能让它往群里发语音"。
 * 解析不到的默认行为必须是**拒绝**，不能是放行。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkTarget,
  createThrottle,
  parseSpeaker,
  readKeyPathList,
  readPolicyFromText,
  sliceQqBotSection,
} from '../lib/guard.js';

/** 一段贴近真机的 profile 片段（缩进、引号、行内空数组都按现状写）。 */
const PROFILE = `# 头部注释
- id: ui-settings-general
  config:
    mode: auto

- id: dsh-qq-bot
  name: '@sputnikzaychik/dsh-qq-bot'
  config:
    onebot:
      wsUrl: wss://qapi.civer.cn
    group:
      enabled: true
      allow:
        - "778916943"
        - "999999999"
      requireAt: false
    private:
      enabled: true
      allow: []
    auth:
      owners:
        - "507678128"
      superAdmins: []
      guestToolAllow:
        - qq_history

- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    group:
      allow:
        - "111111111"
`;

test('parseSpeaker：群聊头部（拥有者）', () => {
  const s = parseSpeaker('[QQ群 778916943 · Quisper(507678128) · 身份:拥有者｜拥有者+本群群主] 画个图');
  assert.equal(s.ok, true);
  assert.equal(s.scope, 'group');
  assert.equal(s.groupId, '778916943');
  assert.equal(s.userId, '507678128');
  assert.equal(s.displayName, 'Quisper');
  assert.equal(s.isOwner, true);
});

test('parseSpeaker：群聊里访客不是拥有者', () => {
  const s = parseSpeaker('[QQ群 778916943 · 神马都S浮云、(50671596) · 身份:访客] @2174357664 这是你画的？');
  assert.equal(s.ok, true);
  assert.equal(s.isOwner, false);
  assert.equal(s.userId, '50671596');
});

test('parseSpeaker：私聊头部', () => {
  const s = parseSpeaker('[QQ私聊 · Quisper(507678128) · 身份:拥有者｜拥有者] Hi');
  assert.equal(s.ok, true);
  assert.equal(s.scope, 'private');
  assert.equal(s.groupId, '');
  assert.equal(s.userId, '507678128');
  assert.equal(s.isOwner, true);
});

test('parseSpeaker：昵称里带括号、带数字，也要取到正确的 QQ 号', () => {
  // 靠「 · 身份:」锚点吃掉歧义：只有紧邻身份标记的那个 (数字) 才是 QQ 号
  const s = parseSpeaker('[QQ群 123456 · 某人(小号)(507678128) · 身份:拥有者] hi');
  assert.equal(s.ok, true);
  assert.equal(s.groupId, '123456');
  assert.equal(s.userId, '507678128');
  assert.equal(s.displayName, '某人(小号)');
});

test('parseSpeaker：没有头部（Web 会话/子代理）→ 拒绝，不是放行', () => {
  assert.equal(parseSpeaker('直接一句话，没有 QQ 头').ok, false);
  assert.equal(parseSpeaker('').ok, false);
  assert.equal(parseSpeaker(null).ok, false);
  assert.match(parseSpeaker('随便什么').error, /不是 QQ 会话|无法确认/);
});

test('sliceQqBotSection：只切 dsh-qq-bot 那一段，别的条目里的同名键不算', () => {
  const section = sliceQqBotSection(PROFILE);
  assert.ok(section !== null);
  assert.match(section, /dsh-qq-bot/);
  assert.match(section, /778916943/);
  // 最后那个 llm-pi-ai 段里的 group.allow 不能被吞进来
  assert.doesNotMatch(section, /111111111/);
  assert.equal(sliceQqBotSection('没有这个条目'), null);
});

test('readKeyPathList：块列表 / 行内空数组 / 行内列表 / 找不到', () => {
  const lines = PROFILE.split('\n');
  const allow = readKeyPathList(lines, 'group.allow');
  assert.deepEqual(allow, ['778916943', '999999999']);
  assert.deepEqual(readKeyPathList(lines, 'private.allow'), []);
  assert.deepEqual(readKeyPathList(lines, 'auth.owners'), ['507678128']);
  assert.deepEqual(readKeyPathList(lines, 'auth.superAdmins'), []);
  assert.equal(readKeyPathList(lines, 'nope.nope'), null);

  // 行内列表
  const inline = ['group:', '  allow: ["1", "2"]'].join('\n').split('\n');
  assert.deepEqual(readKeyPathList(inline, 'group.allow'), ['1', '2']);
});

test('readPolicyFromText：读得到 groups/owners；缺段就报错', () => {
  const policy = readPolicyFromText(PROFILE);
  assert.equal(policy.ok, true);
  assert.deepEqual(policy.groups, ['778916943', '999999999']);
  assert.deepEqual(policy.owners, ['507678128']);
  assert.deepEqual(policy.privateAllow, []);

  const missing = readPolicyFromText('- id: something-else\n  config: {}\n');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /dsh-qq-bot/);
});

/** 造一个 owner 发言人。 */
const owner = { ok: true, scope: 'group', groupId: '778916943', userId: '507678128', displayName: 'Quisper', roleText: '拥有者', isOwner: true };
/** 造一个访客发言人。 */
const guest = { ok: true, scope: 'group', groupId: '778916943', userId: '50671596', displayName: '路人', roleText: '访客', isOwner: false };
const policy = { ok: true, groups: ['778916943'], owners: ['507678128'], privateAllow: [] };

test('checkTarget：拥有者在白名单群里可以发', () => {
  const r = checkTarget({ speaker: owner, policy, targetType: 'group', targetId: '778916943', allowGroups: [], ownerOnly: true });
  assert.equal(r.ok, true);
});

test('checkTarget：ownerOnly 时访客被拒，理由里带身份', () => {
  const r = checkTarget({ speaker: guest, policy, targetType: 'group', targetId: '778916943', allowGroups: [], ownerOnly: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /访客/);
});

test('checkTarget：群不在 qq-bot 白名单 / 不在本插件 allowGroups → 拒', () => {
  const notInQqbot = checkTarget({ speaker: owner, policy, targetType: 'group', targetId: '123456', allowGroups: [], ownerOnly: true });
  assert.equal(notInQqbot.ok, false);
  assert.match(notInQqbot.error, /group\.allow/);

  const notInPlugin = checkTarget({ speaker: owner, policy, targetType: 'group', targetId: '778916943', allowGroups: ['555'], ownerOnly: true });
  assert.equal(notInPlugin.ok, false);
  assert.match(notInPlugin.error, /allowGroups/);
});

test('checkTarget：私聊只允许发给拥有者', () => {
  const toOwner = checkTarget({ speaker: owner, policy, targetType: 'private', targetId: '507678128', allowGroups: [], ownerOnly: true });
  assert.equal(toOwner.ok, true);

  const toStranger = checkTarget({ speaker: owner, policy, targetType: 'private', targetId: '123456', allowGroups: [], ownerOnly: true });
  assert.equal(toStranger.ok, false);
  assert.match(toStranger.error, /不是拥有者/);
});

test('checkTarget：策略读不到时退化为「只允许拥有者给自己发私聊」', () => {
  const broken = { ok: false, error: '读不到 /x/cordis.patch.yml' };
  const selfDm = checkTarget({ speaker: owner, policy: broken, targetType: 'private', targetId: '507678128', allowGroups: [], ownerOnly: true });
  assert.equal(selfDm.ok, true);

  const group = checkTarget({ speaker: owner, policy: broken, targetType: 'group', targetId: '778916943', allowGroups: [], ownerOnly: true });
  assert.equal(group.ok, false);
  assert.match(group.error, /只允许拥有者给自己发私聊/);
});

test('checkTarget：发言人解析失败 / 目标非法 → 拒', () => {
  const noSpeaker = checkTarget({ speaker: { ok: false, error: '拿不到当前消息' }, policy, targetType: 'group', targetId: '1', allowGroups: [], ownerOnly: false });
  assert.equal(noSpeaker.ok, false);

  const badTarget = checkTarget({ speaker: owner, policy, targetType: 'group', targetId: 'abc', allowGroups: [], ownerOnly: false });
  assert.equal(badTarget.ok, false);
  assert.match(badTarget.error, /合法的数字 ID/);
});

test('节流：条数上限、冷却、额度统计', () => {
  let clock = 1_000_000;
  const throttle = createThrottle({ maxPerHour: 2, cooldownSec: 10, now: () => clock });

  assert.equal(throttle.check().ok, true);
  throttle.record();
  assert.equal(throttle.stats().usedLastHour, 1);

  // 冷却期内
  clock += 3_000;
  const cooling = throttle.check();
  assert.equal(cooling.ok, false);
  assert.match(cooling.error, /冷却/);
  assert.ok(cooling.retryAfterSec >= 1);

  // 冷却过后可以再发第二条
  clock += 10_000;
  assert.equal(throttle.check().ok, true);
  throttle.record();
  assert.equal(throttle.stats().remaining, 0);

  // 第三条被小时上限挡住
  clock += 60_000;
  const capped = throttle.check();
  assert.equal(capped.ok, false);
  assert.match(capped.error, /每小时上限 2 条/);

  // 一小时过去后额度恢复
  clock += 60 * 60 * 1000;
  assert.equal(throttle.check().ok, true);
  assert.equal(throttle.stats().usedLastHour, 0);
});

test('节流：限额每次现取，热改配置不清零已用额度', () => {
  let limit = 2;
  const throttle = createThrottle({ limits: () => ({ maxPerHour: limit, cooldownSec: 0 }), now: () => 1 });
  throttle.record();
  throttle.record();
  assert.equal(throttle.stats().remaining, 0);

  // 改成 5：已用 2 条要保留（否则用户会以为自己又有 5 条）
  limit = 5;
  assert.equal(throttle.stats().usedLastHour, 2);
  assert.equal(throttle.stats().remaining, 3);
});

test('节流：maxPerHour=0 表示不限', () => {
  const throttle = createThrottle({ maxPerHour: 0, cooldownSec: 0, now: () => 1 });
  for (let i = 0; i < 20; i += 1) throttle.record();
  assert.equal(throttle.check().ok, true);
  assert.equal(throttle.stats().remaining, Infinity);
});
