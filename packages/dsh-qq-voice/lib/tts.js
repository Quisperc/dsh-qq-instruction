/**
 * DashScope TTS 客户端：把文字合成成一段音频。
 *
 * 设计要点（都是踩过之后定的）：
 *   1. **不写死请求体**。DashScope 的 TTS 参数随模型演进（qwen-tts / qwen-audio-tts /
 *      cosyvoice 的字段并不完全一样），所以默认形状 + `requestTemplate` 覆盖两条路都留着：
 *       - 默认：`{ model, input: { text, voice? } }`（Qwen 系列多模态生成端点的形状）
 *       - 覆盖：配置里给一段带 `{{text}}`/`{{model}}`/`{{voice}}`/`{{format}}` 的 JSON，
 *         占位符替换后直接用。这样换模型/换端点不需要改代码、更不需要打补丁。
 *   2. **返回形状也兼容多种**：实测既可能给音频 URL（要再下载），也可能直接给 base64。
 *      解析顺序固定，命中即返回；都不命中就报「响应里没有音频」，不猜。
 *   3. **fetch 可注入**：单测不碰网络。
 */

/** 默认 TTS 端点（DashScope 原生，不是 compatible-mode）。 */
export const DEFAULT_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/**
 * 按字数上限截断文本。
 *
 * 为什么要截：TTS 按字符计费、且长文本合成慢，一不小心就把 300 字念成一分钟。
 * 截断时**如实返回**是否截断，让调用方能告诉模型「我说多了，只说了一半」。
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text: string, truncated: boolean, originalChars: number }}
 */
export function truncateText(text, maxChars) {
  const raw = typeof text === 'string' ? text : '';
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : raw.length;
  if (raw.length <= limit) return { text: raw, truncated: false, originalChars: raw.length };
  return { text: raw.slice(0, limit), truncated: true, originalChars: raw.length };
}

/**
 * 用模板拼请求体。
 *
 * 模板里只支持整值替换（`{{text}}` 等），不做表达式——少一个能力，少一类注入风险。
 * 替换用字符串化后的值，所以文本里的引号/换行会由 JSON.parse 负责还原。
 *
 * @param {string} template JSON 字符串模板
 * @param {{text: string, model: string, voice: string, format: string}} vars
 * @returns {Record<string, unknown>}
 * @throws {Error} 模板不是合法 JSON 对象时抛（调用方转成可读错误）
 */
export function renderTemplate(template, vars) {
  const replaced = String(template)
    // 用函数形式避免 `$&` 这类替换模式被当成特殊指令
    .replace(/\{\{text\}\}/g, () => JSON.stringify(vars.text).slice(1, -1))
    .replace(/\{\{model\}\}/g, () => JSON.stringify(vars.model).slice(1, -1))
    .replace(/\{\{voice\}\}/g, () => JSON.stringify(vars.voice).slice(1, -1))
    .replace(/\{\{format\}\}/g, () => JSON.stringify(vars.format).slice(1, -1));
  const parsed = JSON.parse(replaced);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体模板必须是一个 JSON 对象');
  }
  return parsed;
}

/**
 * 构造请求体：有模板用模板，没有就用内置形状。
 *
 * @param {{text: string, model: string, voice?: string, format?: string, template?: string}} opts
 * @returns {Record<string, unknown>}
 */
export function buildTtsBody(opts) {
  const model = typeof opts.model === 'string' ? opts.model : '';
  const voice = typeof opts.voice === 'string' ? opts.voice : '';
  const format = typeof opts.format === 'string' ? opts.format : '';
  if (typeof opts.template === 'string' && opts.template.trim() !== '') {
    return renderTemplate(opts.template, { text: opts.text, model, voice, format });
  }
  /** @type {Record<string, unknown>} */
  const input = { text: opts.text };
  // 空音色不传：传空串有些模型会当成"有一个叫空的音色"然后 400。
  if (voice !== '') input.voice = voice;
  /** @type {Record<string, unknown>} */
  const body = { model, input };
  if (format !== '') body.parameters = { format };
  return body;
}

/**
 * 从一个 JSON 响应里找出音频。
 *
 * 覆盖已知的几种形状：
 *   output.audio.url / output.audio.data / output.audio（字符串）
 *   output.url / output.data
 *   data[0].url / data[0].data / data[0].audio.url
 *   audio.url
 *
 * @param {unknown} payload
 * @returns {{kind: 'url', url: string} | {kind: 'b64', data: string} | null}
 */
export function extractAudio(payload) {
  if (payload === null || typeof payload !== 'object') return null;
  /** @param {unknown} value */
  const asAudio = (value) => {
    if (typeof value === 'string' && value.trim() !== '') {
      // 裸字符串：可能是 URL，也可能是 base64。按前缀判断，别猜。
      return /^https?:\/\//i.test(value) ? { kind: 'url', url: value } : { kind: 'b64', data: value };
    }
    if (value === null || typeof value !== 'object') return null;
    const obj = /** @type {Record<string, unknown>} */ (value);
    if (typeof obj.url === 'string' && obj.url.trim() !== '') return { kind: 'url', url: obj.url };
    if (typeof obj.data === 'string' && obj.data.trim() !== '') return { kind: 'b64', data: obj.data };
    if (typeof obj.audio_url === 'string' && obj.audio_url.trim() !== '') return { kind: 'url', url: obj.audio_url };
    return null;
  };

  const out = /** @type {Record<string, unknown>} */ (payload);
  const output = out.output !== null && typeof out.output === 'object'
    ? /** @type {Record<string, unknown>} */ (out.output)
    : undefined;

  // 最外层 / output 下的 audio 字段最可信，先看它。
  const candidates = [];
  if (output !== undefined) {
    candidates.push(output.audio, output.url, output.data);
  }
  candidates.push(out.audio, out.url);
  if (Array.isArray(out.data) && out.data.length > 0) {
    const first = out.data[0];
    if (first !== null && typeof first === 'object') {
      const item = /** @type {Record<string, unknown>} */ (first);
      candidates.push(item.audio, item.url, item.data);
    } else {
      candidates.push(first);
    }
  }
  for (const candidate of candidates) {
    const found = asAudio(candidate);
    if (found !== null) return found;
  }
  return null;
}

/**
 * 从错误响应里取一句能看懂的话。
 *
 * @param {unknown} payload
 * @returns {string}
 */
export function extractErrorMessage(payload) {
  if (payload === null || typeof payload !== 'object') return '';
  const obj = /** @type {Record<string, unknown>} */ (payload);
  if (typeof obj.message === 'string' && obj.message.trim() !== '') return obj.message.trim();
  if (typeof obj.code === 'string' && obj.code.trim() !== '') return obj.code.trim();
  if (obj.error !== undefined && obj.error !== null) {
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.error === 'object') {
      const err = /** @type {Record<string, unknown>} */ (obj.error);
      if (typeof err.message === 'string') return err.message;
      if (typeof err.code === 'string') return err.code;
    }
  }
  return '';
}

/**
 * 把各种失败翻译成**能直接给人看的中文**。
 *
 * 为什么要分类：全是「请求失败」时，用户根本不知道该改 key、改模型、还是等额度。
 *
 * @param {number} status HTTP 状态码（0 表示网络层失败）
 * @param {string} detail 服务端给的原始说明
 * @param {string} model 模型 id（写进文案，便于核对是不是写错了）
 * @returns {string}
 */
export function describeHttpFailure(status, detail, model) {
  const tail = detail !== '' ? `（服务端：${detail.slice(0, 200)}）` : '';
  if (status === 0) return `连不上 TTS 服务：${detail || '网络错误或域名不可达'}`;
  if (status === 401) return `DashScope 鉴权失败：API key 无效或已过期${tail}`;
  if (status === 403) return `DashScope 拒绝访问：key 没有该模型的权限，或未开通服务${tail}`;
  if (status === 404) return `TTS 端点或模型不存在：检查 ttsBaseUrl 与 ttsModel（当前 ${model || '未填'}）${tail}`;
  if (status === 429) return `DashScope 限流或额度不足：稍后再试或检查配额${tail}`;
  if (status === 400) return `请求被拒（参数不合法）：检查 ttsModel / ttsVoice / 文本长度${tail}`;
  if (status >= 500) return `DashScope 服务端错误（HTTP ${status}）：稍后重试${tail}`;
  return `TTS 请求失败（HTTP ${status}）${tail}`;
}

/**
 * 合成一段语音。
 *
 * @param {{
 *   baseUrl: string, apiKey: string, text: string, model: string, voice?: string,
 *   format?: string, template?: string, timeoutMs?: number,
 *   fetchImpl?: typeof fetch, signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ok: true, kind: 'url', url: string} | {ok: true, kind: 'b64', data: string} | {ok: false, error: string, status?: number}>}
 */
export async function synthesize(opts) {
  const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
  if (apiKey === '') {
    return { ok: false, error: '没有 DashScope API key：到「插件 → QQ 语音回复」填 key，或设环境变量后再启用' };
  }
  if (typeof opts.text !== 'string' || opts.text.trim() === '') {
    return { ok: false, error: '要合成的文本是空的' };
  }
  const baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl.trim() : '';
  if (baseUrl === '') return { ok: false, error: '没有配置 TTS 端点（ttsBaseUrl 为空）' };

  /** @type {Record<string, unknown>} */
  let body;
  try {
    body = buildTtsBody({
      text: opts.text,
      model: opts.model,
      voice: opts.voice,
      format: opts.format,
      template: opts.template,
    });
  } catch (error) {
    return { ok: false, error: `请求体模板不合法：${error instanceof Error ? error.message : String(error)}` };
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Number(opts.timeoutMs) : 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  // 外部取消（回合被中断）要一起生效：两个信号任一触发都停。
  const outer = opts.signal;
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer !== undefined && outer !== null) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const response = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    /** @type {any} */
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok !== true) {
      return {
        ok: false,
        status: response.status,
        error: describeHttpFailure(response.status, extractErrorMessage(payload), opts.model),
      };
    }

    const audio = extractAudio(payload);
    if (audio === null) {
      const detail = extractErrorMessage(payload);
      return {
        ok: false,
        error: `TTS 响应里没有音频数据${detail !== '' ? `（${detail.slice(0, 200)}）` : '：可能是模型/端点不匹配，或该模型只支持流式返回'}`,
      };
    }
    return audio.kind === 'url' ? { ok: true, kind: 'url', url: audio.url } : { ok: true, kind: 'b64', data: audio.data };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'AbortError' || /abort|timeout/i.test(message)) {
      return { ok: false, error: `TTS 超时或已取消（超过 ${Math.round(timeoutMs / 1000)} 秒）` };
    }
    return { ok: false, error: `TTS 请求出错：${message}` };
  } finally {
    clearTimeout(timer);
    if (outer !== undefined && outer !== null) outer.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * 把合成结果变成音频字节。
 *
 * url 分支要再下载一次——这一步也注入 fetch，单测才能不联网。
 *
 * @param {{kind: 'url', url: string} | {kind: 'b64', data: string}} audio
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, bytes: Uint8Array} | {ok: false, error: string}>}
 */
export async function loadAudio(audio, opts = {}) {
  const maxBytes = Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? Number(opts.maxBytes) : 8 * 1024 * 1024;
  if (audio.kind === 'b64') {
    try {
      // 有的接口给的是 data URL 前缀，剥掉再用 base64 解码。
      const raw = audio.data.includes(',') ? audio.data.slice(audio.data.indexOf(',') + 1) : audio.data;
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 0) return { ok: false, error: '音频 base64 解码后是空的' };
      if (buf.length > maxBytes) return { ok: false, error: `音频太大（${buf.length} 字节，上限 ${maxBytes}）` };
      return { ok: true, bytes: buf };
    } catch (error) {
      return { ok: false, error: `音频 base64 解码失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? Number(opts.timeoutMs) : 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetchImpl(audio.url, { signal: controller.signal });
    if (response.ok !== true) {
      return { ok: false, error: `下载音频失败（HTTP ${response.status}）：链接可能已过期` };
    }
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length === 0) return { ok: false, error: '下载到的音频是空的' };
    if (buf.length > maxBytes) return { ok: false, error: `音频太大（${buf.length} 字节，上限 ${maxBytes}）` };
    return { ok: true, bytes: buf };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /abort|timeout/i.test(message) ? '下载音频超时' : `下载音频出错：${message}` };
  } finally {
    clearTimeout(timer);
  }
}
