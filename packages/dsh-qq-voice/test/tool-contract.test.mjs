/**
 * 工具契约测试：走完整的 execute 路径，但把 TTS / 下载 / WS 全部替换成假的。
 *
 * 覆盖的每一条都是"用户会真的遇到"的分支：
 *   未启用 / mode=off / text 为空 / 非 QQ 会话 / 访客 / 群不在白名单 /
 *   没 key / 被节流 / 合成失败 / 发送失败 / 成功（含截断）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createThrottle } from '../lib/guard.js';
import { createVoiceTool, lastUserText } from '../lib/index.js';
import { readConfig } from '../lib/config.js';

/** 贴近真机的 profile 片段。 */
const PROFILE = [
  '- id: dsh-qq-bot',
  '  config:',
  '    group:',
  '      allow:',
  '        - "778916943"',
  '    auth:',
  '      owners:',
  '        - "507678128"',
].join('\n');

const OWNER_TEXT = '[QQ群 778916943 · Quisper(507678128) · 身份:拥有者｜拥有者+本群群主] 说句话';
const GUEST_TEXT = '[QQ群 778916943 · 路人(50671596) · 身份:访客] 说句话';

/** 造一个 agent，其最近一条 user/message 是指定文本。 */
function agentWith(text) {
  return {
    session: {
      snapshotEvents: () => [
        { type: 'turn/start' },
        { type: 'user/message', data: { content: [{ type: 'text', text }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好' }] } } },
      ],
    },
  };
}

/**
 * 造被测工具。
 * @param {{config?: any, audio?: any, send?: any, synth?: any}} [options]
 */
function makeTool(options = {}) {
  const sent = [];
  const tool = createVoiceTool({
    getConfig: () => readConfig({
      enabled: true,
      mode: 'manual',
      apiKey: 'sk-test',
      maxChars: 300,
      maxPerHour: 6,
      cooldownSec: 0,
      ...options.config,
    }),
    throttle: options.throttle ?? createThrottle({ maxPerHour: 6, cooldownSec: 0 }),
    senderFor: () => ({
      sendRecord: async (payload) => {
        sent.push(payload);
        return options.send ? options.send(payload) : { ok: true, messageId: 1, bytes: 4 };
      },
    }),
    readProfile: () => PROFILE,
    synthesizeImpl: options.synth ?? (async () => ({ ok: true, kind: 'b64', data: Buffer.from('wav!').toString('base64') })),
    loadAudioImpl: options.loadAudio ?? (async () => ({ ok: true, bytes: Buffer.from('wav!') })),
  });
  return { tool, sent };
}

test('工具 schema：名字、必填参数、描述里带触发场景', () => {
  const { tool } = makeTool();
  assert.equal(tool.name, 'qq_voice');
  assert.equal(tool.parameters.text.required, true);
  assert.equal(tool.parameters.message_type.type, 'string');
  assert.equal(tool.parameters.target_id.type, 'string');
  assert.match(tool.description, /语音/);
  assert.match(tool.description, /拥有者/);
  assert.equal(typeof tool.execute, 'function');
  assert.equal(typeof tool.output.render, 'function');
});

test('拒绝：未启用 / mode=off / text 为空', async () => {
  const disabled = makeTool({ config: { enabled: false } });
  const r1 = await disabled.tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /未启用/);

  const off = makeTool({ config: { mode: 'off' } });
  const r2 = await off.tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /off/);

  const empty = makeTool();
  const r3 = await empty.tool.execute({ text: '   ' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r3.ok, false);
  assert.match(r3.error, /text 不能为空/);
});

test('拒绝：非 QQ 会话（解析不到发言人）', async () => {
  const { tool, sent } = makeTool();
  const r = await tool.execute({ text: 'hi' }, { agent: agentWith('Web UI 里的一句话') });
  assert.equal(r.ok, false);
  assert.match(r.error, /不是 QQ 会话|无法确认/);
  assert.equal(sent.length, 0);
});

test('拒绝：访客用不了（ownerOnly 默认 true）', async () => {
  const { tool, sent } = makeTool();
  const r = await tool.execute({ text: 'hi' }, { agent: agentWith(GUEST_TEXT) });
  assert.equal(r.ok, false);
  assert.match(r.error, /拥有者/);
  assert.equal(sent.length, 0);
});

test('拒绝：群不在 qq-bot 的 group.allow 里', async () => {
  const { tool, sent } = makeTool();
  const r = await tool.execute({ text: 'hi', target_id: '123456' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r.ok, false);
  assert.match(r.error, /group\.allow/);
  assert.equal(sent.length, 0);
});

test('拒绝：没 key 时报可读错误（不崩）', async () => {
  const { tool } = makeTool({
    config: { apiKey: '' },
    synth: async () => ({ ok: false, error: '没有 DashScope API key：到「插件 → QQ 语音回复」填 key，或设环境变量后再启用' }),
  });
  const r = await tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r.ok, false);
  assert.match(r.error, /API key/);
});

test('拒绝：被节流时给出剩余秒数，且不调用 TTS', async () => {
  let clock = 1_000_000;
  const throttle = createThrottle({ maxPerHour: 1, cooldownSec: 0, now: () => clock });
  throttle.record(); // 用掉唯一额度

  let synthCalls = 0;
  const { tool, sent } = makeTool({
    throttle,
    synth: async () => { synthCalls += 1; return { ok: true, kind: 'b64', data: 'AAAA' }; },
  });
  const r = await tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r.ok, false);
  assert.match(r.error, /每小时上限/);
  assert.equal(synthCalls, 0, '被限流时不该先花掉一次 TTS 调用');
  assert.equal(sent.length, 0);
  void clock;
});

test('失败：合成失败 / 发送失败，都转成可读错误', async () => {
  const badSynth = makeTool({ synth: async () => ({ ok: false, error: 'DashScope 限流或额度不足' }) });
  const r1 = await badSynth.tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /限流|额度/);

  const badSend = makeTool({ send: async () => ({ ok: false, error: 'NapCat 拒绝发送（retcode 1400）' }) });
  const r2 = await badSend.tool.execute({ text: 'hi' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /retcode 1400/);
});

test('成功：默认发到当前群，参数与字节数如实返回', async () => {
  const { tool, sent } = makeTool();
  const r = await tool.execute({ text: '你好呀' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r.ok, true);
  assert.equal(r.sent, true);
  assert.deepEqual(r.target, { type: 'group', id: '778916943' });
  assert.equal(r.chars, 3);
  assert.equal(r.truncated, false);
  // 刚发成功一条，6 条额度剩 5
  assert.equal(r.remaining, 5);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageType, 'group');
  assert.equal(sent[0].targetId, '778916943');
  // 音频必须以 base64 交给 WS 层（OneBot 的 base64:// 由 sender 拼）
  assert.equal(Buffer.from(sent[0].audioBase64, 'base64').toString(), 'wav!');
});

test('成功：私聊显式指定目标（发给拥有者自己）', async () => {
  const { tool, sent } = makeTool();
  const r = await tool.execute(
    { text: '悄悄话', message_type: 'private', target_id: '507678128' },
    { agent: agentWith(OWNER_TEXT) },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.target, { type: 'private', id: '507678128' });
  assert.equal(sent[0].messageType, 'private');
});

test('成功：超长文本被截断，并如实告知模型', async () => {
  let synthText = '';
  const { tool } = makeTool({
    config: { maxChars: 5 },
    synth: async (opts) => { synthText = opts.text; return { ok: true, kind: 'b64', data: 'AAAA' }; },
  });
  const r = await tool.execute({ text: '一二三四五六七八九十' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.chars, 5);
  assert.match(r.note, /已截断到 5 字/);
  assert.equal(synthText, '一二三四五');
});

test('成功：节流额度被记一次（连发第二条会被冷却/上限挡住）', async () => {
  const throttle = createThrottle({ maxPerHour: 1, cooldownSec: 0 });
  const { tool } = makeTool({ throttle });
  const first = await tool.execute({ text: '第一条' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(first.ok, true);
  const second = await tool.execute({ text: '第二条' }, { agent: agentWith(OWNER_TEXT) });
  assert.equal(second.ok, false);
  assert.match(second.error, /每小时上限/);
});

test('lastUserText：从事件里取最后一条 user/message 的文本；取不到返回空串', () => {
  assert.equal(lastUserText(agentWith(OWNER_TEXT)), OWNER_TEXT);
  assert.equal(lastUserText({ session: { snapshotEvents: () => [] } }), '');
  assert.equal(lastUserText(undefined), '');
  assert.equal(lastUserText({ session: null }), '');
  // 事件里没有 content 数组时也不炸
  assert.equal(lastUserText({ session: { snapshotEvents: () => [{ type: 'user/message', data: {} }] } }), '');
});
