/**
 * 只发不收的 WS 发送器测试。
 *
 * 这一组里最重要的是最后两条：
 *   - **收到事件时绝不写出任何东西**（否则群消息会被回两遍）；
 *   - echo 配对与超时（否则调用方会一直挂着）。
 *
 * 全程用假 WebSocket，不联网。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OneBotSender, defaultSocketFactory } from '../lib/sender.js';

/**
 * 假 WebSocket：把「服务端」要发的帧塞进队列，由测试驱动。
 *
 * 记录所有客户端发出的帧（written），用来断言"我们到底发了什么"。
 */
function makeFakeSocket() {
  const listeners = new Map();
  const socket = {
    readyState: 0,
    written: [],
    closeCalls: 0,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() { /* 测试里不需要 */ },
    send(data) { socket.written.push(data); },
    close() { socket.closeCalls += 1; socket.readyState = 3; },
    /** 测试侧：模拟连接建立 */
    open() { socket.readyState = 1; for (const fn of listeners.get('open') ?? []) fn({}); },
    /** 测试侧：模拟收到一帧 */
    receive(payload) {
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
      for (const fn of listeners.get('message') ?? []) fn({ data: raw });
    },
    /** 测试侧：模拟连接出错 */
    error(message) { for (const fn of listeners.get('error') ?? []) fn({ message }); },
  };
  return socket;
}

/** 造一个未连接状态的发送器 + 假 socket。 */
function makeSender(options = {}) {
  const socket = makeFakeSocket();
  const sender = new OneBotSender({
    wsUrl: 'wss://example.test',
    accessToken: 'tok',
    timeoutMs: 200,
    idleCloseMs: 0,
    socketFactory: () => socket,
    logger: {},
    ...options,
  });
  return { sender, socket };
}

test('连接后才发帧，帧里带 action/params/echo', async () => {
  const { sender, socket } = makeSender();
  const pending = sender.sendRecord({ messageType: 'private', targetId: '507678128', audioBase64: 'AAA' });
  // 让 connect 的 promise 落地
  await Promise.resolve();
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(socket.written.length, 1);
  const frame = JSON.parse(socket.written[0]);
  assert.equal(frame.action, 'send_private_msg');
  assert.deepEqual(frame.params.user_id, 507678128);
  assert.equal(frame.params.message[0].type, 'record');
  assert.match(frame.params.message[0].data.file, /^base64:\/\/AAA/);
  assert.equal(typeof frame.echo, 'string');

  // 回执按 echo 配对
  socket.receive({ status: 'ok', retcode: 0, data: { message_id: 42 }, echo: frame.echo });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.messageId, 42);
});

test('群聊走 send_group_msg + group_id', async () => {
  const { sender, socket } = makeSender();
  const pending = sender.sendRecord({ messageType: 'group', targetId: '778916943', audioBase64: 'BBB' });
  await Promise.resolve();
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const frame = JSON.parse(socket.written[0]);
  assert.equal(frame.action, 'send_group_msg');
  assert.deepEqual(frame.params.group_id, 778916943);
  socket.receive({ status: 'ok', retcode: 0, data: { message_id: 7 }, echo: frame.echo });
  await pending;
});

test('★ 收到事件时绝不回应（只发不收的纪律）', async () => {
  const { sender, socket } = makeSender();
  // connect() 里才注册监听器；open 只是模拟握手完成
  const opening = sender.connect();
  socket.open();
  await opening;

  // 模拟 NapCat 推送的各类事件：群消息、私聊消息、通知、心跳
  const events = [
    { post_type: 'message', message_type: 'group', group_id: 1, raw_message: 'hi', sender: { user_id: 2 } },
    { post_type: 'message', message_type: 'private', user_id: 3, raw_message: 'yo' },
    { post_type: 'notice', notice_type: 'group_increase' },
    { post_type: 'meta_event', meta_event_type: 'heartbeat' },
  ];
  for (const event of events) socket.receive(event);

  // 关键断言：一个字节都没写出去
  assert.equal(socket.written.length, 0, '收到事件后不得写出任何数据');
  assert.equal(sender.ignoredEvents, events.length, '事件应被计数后丢弃');

  // 之后再发语音仍然正常（事件不会污染 echo 配对）
  const pending = sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: 'AAA' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const frame = JSON.parse(socket.written[0]);
  socket.receive({ status: 'ok', retcode: 0, data: {}, echo: frame.echo });
  assert.equal((await pending).ok, true);
});

test('非 JSON / 二进制帧被忽略，不抛异常', async () => {
  const { sender, socket } = makeSender();
  const opening = sender.connect();
  socket.open();
  await opening;
  socket.receive('not-json');   // 非 JSON：直接丢，不计数（它不是事件，是垃圾帧）
  socket.receive({ no: 'echo' }); // 合法 JSON 但没有 echo：按事件对待，计数后丢弃
  assert.equal(socket.written.length, 0);
  assert.equal(sender.ignoredEvents, 1);
});

test('retcode 非 0 → 失败并带上服务端说明', async () => {
  const { sender, socket } = makeSender();
  const pending = sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: 'AAA' });
  await Promise.resolve();
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const frame = JSON.parse(socket.written[0]);
  socket.receive({ status: 'failed', retcode: 1400, data: { message: '文件格式不支持' }, echo: frame.echo });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /retcode 1400/);
  assert.match(result.error, /文件格式不支持/);
});

test('回执超时 → 明确报超时，不无限挂住', async () => {
  const { sender, socket } = makeSender({ timeoutMs: 30 });
  const pending = sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: 'AAA' });
  await Promise.resolve();
  socket.open();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /超时/);
});

test('目标不合法 / 音频为空 → 直接拒，不建连接', async () => {
  const { sender, socket } = makeSender();
  const bad = await sender.sendRecord({ messageType: 'private', targetId: 'abc', audioBase64: 'AAA' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /目标/);

  const empty = await sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: '' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /音频数据为空/);

  assert.equal(socket.written.length, 0);
});

test('连接失败时给出可读原因（token 不对/地址不通）', async () => {
  const sender = new OneBotSender({
    wsUrl: 'wss://example.test',
    timeoutMs: 100,
    idleCloseMs: 0,
    socketFactory: () => { throw new Error('boom'); },
  });
  const result = await sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: 'AAA' });
  assert.equal(result.ok, false);
  assert.match(result.error, /建立 WS 失败/);
});

test('连接被关闭时，在等的请求立刻失败而不是等超时', async () => {
  const { sender, socket } = makeSender({ timeoutMs: 5000 });
  const pending = sender.sendRecord({ messageType: 'private', targetId: '1', audioBase64: 'AAA' });
  await Promise.resolve();
  socket.open();
  await new Promise((resolve) => setTimeout(resolve, 5));
  sender.close();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /关闭/);
});

test('默认工厂在没有 WebSocket 的环境下抛可读错误', () => {
  const original = globalThis.WebSocket;
  try {
    // @ts-expect-error 故意删掉
    delete globalThis.WebSocket;
    assert.throws(() => defaultSocketFactory('wss://x', {}), /WebSocket/);
  } finally {
    globalThis.WebSocket = original;
  }
});
