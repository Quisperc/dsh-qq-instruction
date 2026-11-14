/**
 * TTS 客户端测试：请求体构造、响应解析、各类失败的**可读中文文案**。
 *
 * 全程注入假 fetch，不联网——这个包的任何测试都不该依赖外部服务。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TTS_BASE_URL,
  buildTtsBody,
  describeHttpFailure,
  extractAudio,
  extractErrorMessage,
  loadAudio,
  renderTemplate,
  synthesize,
  truncateText,
} from '../lib/tts.js';

/** 造一个只返回一次的假 fetch。 */
function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  impl.calls = calls;
  return impl;
}

/** 造一个 JSON 响应。 */
function jsonResponse(status, payload) {
  return () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

test('truncateText：不超限原样返回，超限截断并如实标记', () => {
  assert.deepEqual(truncateText('你好', 10), { text: '你好', truncated: false, originalChars: 2 });
  const cut = truncateText('一二三四五', 3);
  assert.equal(cut.text, '一二三');
  assert.equal(cut.truncated, true);
  assert.equal(cut.originalChars, 5);
  // 上限非法时按原长度处理，不截成空
  assert.equal(truncateText('abc', 0).text, 'abc');
});

test('buildTtsBody：默认形状是 { model, input: { text, voice? }, parameters }', () => {
  const body = buildTtsBody({ text: '你好', model: 'qwen3-tts-flash', voice: 'Cherry', format: 'wav' });
  assert.equal(body.model, 'qwen3-tts-flash');
  assert.deepEqual(body.input, { text: '你好', voice: 'Cherry' });
  assert.deepEqual(body.parameters, { format: 'wav' });
});

test('buildTtsBody：空音色不传（传空串有些模型会 400）', () => {
  const body = buildTtsBody({ text: 'x', model: 'm', voice: '', format: '' });
  assert.deepEqual(body.input, { text: 'x' });
  assert.equal(body.parameters, undefined);
});

test('buildTtsBody：模板覆盖内置形状', () => {
  const template = '{"model":"{{model}}","input":{"text":"{{text}}","voice":"{{voice}}"},"custom":{"f":"{{format}}"}}';
  const body = buildTtsBody({ text: '带"引号"的文本', model: 'm1', voice: 'v1', format: 'mp3', template });
  assert.equal(body.model, 'm1');
  assert.equal(body.input.text, '带"引号"的文本'); // 模板替换不能破坏 JSON 转义
  assert.equal(body.input.voice, 'v1');
  assert.equal(body.custom.f, 'mp3');
});

test('renderTemplate：非法 JSON 抛错（调用方转成可读错误）', () => {
  assert.throws(() => renderTemplate('{ not json }', { text: 'a', model: 'b', voice: 'c', format: 'd' }), /JSON/i);
  assert.throws(() => renderTemplate('[1,2]', { text: 'a', model: 'b', voice: 'c', format: 'd' }), /JSON 对象/);
});

test('extractAudio：认 output.audio.url / output.audio.data / data[0].url / 裸字符串', () => {
  assert.deepEqual(extractAudio({ output: { audio: { url: 'https://x/a.wav' } } }), { kind: 'url', url: 'https://x/a.wav' });
  assert.deepEqual(extractAudio({ output: { audio: { data: 'AAA' } } }), { kind: 'b64', data: 'AAA' });
  assert.deepEqual(extractAudio({ data: [{ url: 'https://x/b.mp3' }] }), { kind: 'url', url: 'https://x/b.mp3' });
  assert.deepEqual(extractAudio({ output: { audio: 'https://x/c.wav' } }), { kind: 'url', url: 'https://x/c.wav' });
  // base64 裸串（不含 http 前缀）按 b64 处理
  assert.deepEqual(extractAudio({ audio: 'UklGRg==' }), { kind: 'b64', data: 'UklGRg==' });
  assert.equal(extractAudio({ output: { text: 'no audio' } }), null);
  assert.equal(extractAudio(null), null);
});

test('extractErrorMessage：能翻出 message / code / error.message', () => {
  assert.equal(extractErrorMessage({ message: 'bad' }), 'bad');
  assert.equal(extractErrorMessage({ code: 'InvalidApiKey' }), 'InvalidApiKey');
  assert.equal(extractErrorMessage({ error: { message: 'nested' } }), 'nested');
  assert.equal(extractErrorMessage({ error: 'raw' }), 'raw');
  assert.equal(extractErrorMessage(null), '');
});

test('describeHttpFailure：每种状态都有能指导下一步的中文', () => {
  assert.match(describeHttpFailure(401, '', 'm'), /API key 无效/);
  assert.match(describeHttpFailure(403, '', 'm'), /权限|未开通/);
  assert.match(describeHttpFailure(404, '', 'qwen-x'), /端点或模型不存在/);
  assert.match(describeHttpFailure(404, '', 'qwen-x'), /qwen-x/);
  assert.match(describeHttpFailure(429, 'quota', 'm'), /限流|额度/);
  assert.match(describeHttpFailure(400, '', 'm'), /参数/);
  assert.match(describeHttpFailure(503, '', 'm'), /服务端错误/);
  assert.match(describeHttpFailure(0, 'ECONNREFUSED', 'm'), /连不上/);
});

test('synthesize：成功返回 url', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { output: { audio: { url: 'https://x/a.wav' } } }));
  const result = await synthesize({
    baseUrl: DEFAULT_TTS_BASE_URL, apiKey: 'sk-test', text: '你好', model: 'm', fetchImpl,
  });
  assert.deepEqual(result, { ok: true, kind: 'url', url: 'https://x/a.wav' });
  // 请求细节：Bearer + JSON
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer sk-test');
  assert.match(String(fetchImpl.calls[0].init.headers['content-type']), /json/);
});

test('synthesize：成功返回 base64 也能认', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, { output: { audio: { data: 'UklGRg==' } } }));
  const result = await synthesize({ baseUrl: 'https://x', apiKey: 'k', text: 't', model: 'm', fetchImpl });
  assert.deepEqual(result, { ok: true, kind: 'b64', data: 'UklGRg==' });
});

test('synthesize：没 key 直接报可读错误，不发请求', async () => {
  const fetchImpl = fakeFetch(jsonResponse(200, {}));
  const result = await synthesize({ baseUrl: 'https://x', apiKey: '', text: 't', model: 'm', fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /API key/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('synthesize：401 / 429 各自给出对应文案', async () => {
  const a = await synthesize({
    baseUrl: 'https://x', apiKey: 'k', text: 't', model: 'm',
    fetchImpl: fakeFetch(jsonResponse(401, { message: 'InvalidApiKey' })),
  });
  assert.equal(a.ok, false);
  assert.equal(a.status, 401);
  assert.match(a.error, /鉴权失败/);

  const b = await synthesize({
    baseUrl: 'https://x', apiKey: 'k', text: 't', model: 'm',
    fetchImpl: fakeFetch(jsonResponse(429, { message: 'Throttling' })),
  });
  assert.match(b.error, /限流|额度/);
});

test('synthesize：超时被翻译成「超时或已取消」', async () => {
  // 让 fetch 挂住，靠 timeoutMs 触发 abort
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const result = await synthesize({ baseUrl: 'https://x', apiKey: 'k', text: 't', model: 'm', timeoutMs: 30, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /超时或已取消/);
});

test('synthesize：响应里没有音频时明确说清（不猜）', async () => {
  const result = await synthesize({
    baseUrl: 'https://x', apiKey: 'k', text: 't', model: 'm',
    fetchImpl: fakeFetch(jsonResponse(200, { output: { text: 'not audio' } })),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /没有音频/);
});

test('loadAudio：b64 解码、data URL 前缀、空数据', async () => {
  const ok = await loadAudio({ kind: 'b64', data: Buffer.from('hello').toString('base64') });
  assert.equal(ok.ok, true);
  assert.equal(Buffer.from(ok.bytes).toString(), 'hello');

  const withPrefix = await loadAudio({ kind: 'b64', data: `data:audio/wav;base64,${Buffer.from('hi').toString('base64')}` });
  assert.equal(Buffer.from(withPrefix.bytes).toString(), 'hi');

  const empty = await loadAudio({ kind: 'b64', data: '' });
  assert.equal(empty.ok, false);
});

test('loadAudio：url 分支下载成功 / 失败 / 超限', async () => {
  const okFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('wav-bytes') });
  const ok = await loadAudio({ kind: 'url', url: 'https://x/a.wav' }, { fetchImpl: okFetch });
  assert.equal(Buffer.from(ok.bytes).toString(), 'wav-bytes');

  const badFetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) });
  const bad = await loadAudio({ kind: 'url', url: 'https://x/a.wav' }, { fetchImpl: badFetch });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /下载音频失败/);

  const bigFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(10) });
  const big = await loadAudio({ kind: 'url', url: 'https://x/a.wav' }, { fetchImpl: bigFetch, maxBytes: 5 });
  assert.equal(big.ok, false);
  assert.match(big.error, /太大/);
});
