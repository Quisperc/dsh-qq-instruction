/**
 * 只发不收的 OneBot v11 客户端（自己连一条 WS，不经过 dsh-qq-bot）。
 *
 * 为什么不用 dsh-qq-bot 发：
 *   - 它不对外提供任何 Cordis 服务，拿不到它的连接；
 *   - 它的出站只支持 text / image 段，**没有 record**，语音发不出去。
 *
 * 为什么"只发不收"是硬纪律：
 *   NapCat 允许多客户端同时连，但**每个客户端都会收到全部事件**。如果我们也回事件，
 *   群里每条消息都会被回两遍（dsh-qq-bot 一遍、我们一遍）。所以：
 *     - 只处理带 `echo` 的响应（那是我们自己请求的回执）；
 *     - 收到任何事件（没有 echo / post_type 字段）一律**直接丢弃**，不回、不写。
 *   这条纪律有专门单测盯着（断言 written 为空）。
 *
 * 其它约定：
 *   - **懒连接**：第一次真要发语音时才连；
 *   - **按 echo 配对**：超时即失败，不无脑等；
 *   - **串行发送**：一条 WS 上并发写会交错，用队列串起来；
 *   - **空闲自动关**：发完 N 秒没人用就断开，别在 NapCat 侧堆僵尸连接；
 *   - **失败一律转成 {ok:false,error}**：连接期的异常也不例外（工具不能往外抛）。
 */

/**
 * 默认 WebSocket 工厂：Node 22+ 的内置 WebSocket（undici）。
 *
 * 带 token 的写法在版本间有差异（有的只收 protocols），所以两级尝试：
 * 先试 `{ headers }`，抛错再退回裸 URL。真需要 token 却没带上，NapCat 会拒绝握手，
 * 错误会在连接阶段暴露出来，不会被静默吞掉。
 *
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {any}
 */
export function defaultSocketFactory(url, headers) {
  const Ctor = globalThis.WebSocket;
  if (typeof Ctor !== 'function') throw new Error('当前 Node 没有内置 WebSocket（需要 Node 22+）');
  if (Object.keys(headers).length > 0) {
    try {
      return new Ctor(url, { headers });
    } catch { /* 退到不带 headers 的形式 */ }
  }
  return new Ctor(url);
}

/** 生成一个不太可能撞车的 echo。 */
function makeEcho(seq) {
  return `qqvoice-${Date.now().toString(36)}-${seq}`;
}

/**
 * 只发不收的 OneBot 发送器。
 */
export class OneBotSender {
  /**
   * @param {{
   *   wsUrl: string, accessToken?: string, timeoutMs?: number, idleCloseMs?: number,
   *   socketFactory?: (url: string, headers: Record<string, string>) => any,
   *   logger?: { info?: (m: string) => void, warn?: (m: string) => void },
   * }} options
   */
  constructor(options) {
    this.wsUrl = typeof options.wsUrl === 'string' ? options.wsUrl : '';
    this.accessToken = typeof options.accessToken === 'string' ? options.accessToken : '';
    this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Number(options.timeoutMs) : 30000;
    this.idleCloseMs = Number.isFinite(options.idleCloseMs) && options.idleCloseMs >= 0 ? Number(options.idleCloseMs) : 120000;
    this.socketFactory = typeof options.socketFactory === 'function' ? options.socketFactory : defaultSocketFactory;
    this.logger = options.logger ?? {};

    /** @type {any} */
    this.socket = null;
    /** @type {Promise<void> | null} */
    this.opening = null;
    /** @type {Map<string, {resolve: (v: any) => void, timer: any}>} */
    this.pending = new Map();
    this.seq = 0;
    /** 串行队列：一条 WS 上不并发写。 */
    this.queue = Promise.resolve();
    /** @type {any} */
    this.idleTimer = null;
    /** 收到的、被主动丢弃的事件数（排障用：证明我们确实没回）。 */
    this.ignoredEvents = 0;
  }

  /** 连接是否已开。 */
  get connected() {
    return this.socket !== null && this.socket.readyState === 1;
  }

  /**
   * 建立连接（幂等：正在连就复用同一个 promise）。
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) return;
    if (this.opening !== null) return this.opening;
    if (this.wsUrl.trim() === '') throw new Error('没有配置 wsUrl');

    /** @type {Record<string, string>} */
    const headers = {};
    if (this.accessToken.trim() !== '') headers.authorization = `Bearer ${this.accessToken.trim()}`;

    const promise = new Promise((resolve, reject) => {
      let socket;
      try {
        socket = this.socketFactory(this.wsUrl, headers);
      } catch (error) {
        reject(new Error(`建立 WS 失败：${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      this.socket = socket;

      /** 连接期的失败：把在等的请求一起判失败，别让调用方挂到超时。 */
      const fail = (message) => {
        try { socket.close?.(); } catch { /* 已经断了 */ }
        this.socket = null;
        reject(new Error(message));
      };

      const onOpen = () => {
        this.logger.info?.('[dsh-qq-voice] WS 已连接（只发不收）');
        resolve();
      };
      const onError = (event) => {
        const message = event?.message ?? event?.error?.message ?? '握手失败（可能是 token 不对或地址不通）';
        fail(`WS 连接失败：${message}`);
      };
      const onClose = () => {
        this.socket = null;
        this.opening = null;
        if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        this.settleAll('WS 连接已断开');
      };
      const onMessage = (event) => this.handleFrame(event?.data ?? event);

      if (typeof socket.addEventListener === 'function') {
        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);
        socket.addEventListener('message', onMessage);
      } else {
        socket.onopen = onOpen;
        socket.onerror = onError;
        socket.onclose = onClose;
        socket.onmessage = onMessage;
      }
    });

    this.opening = promise;
    try {
      await promise;
    } catch (error) {
      // 失败后清掉缓存，下一次调用可以重连（而不是永远拿到同一个 rejected promise）。
      if (this.opening === promise) this.opening = null;
      throw error;
    }
  }

  /**
   * 把正在等的所有请求判失败（连接断开时用）。
   * @param {string} reason
   */
  settleAll(reason) {
    for (const [echo, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: reason });
      this.pending.delete(echo);
    }
  }

  /**
   * 处理一帧入站数据。**只有 echo 响应会被处理，其余一律丢弃。**
   *
   * @param {unknown} data
   */
  handleFrame(data) {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (data instanceof Uint8Array) text = Buffer.from(data).toString('utf8');
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString('utf8');
    else return; // 二进制/未知帧：与我们无关

    let payload;
    try { payload = JSON.parse(text); } catch { return; }

    const echo = payload !== null && typeof payload === 'object' ? payload.echo : undefined;
    if (typeof echo !== 'string') {
      // ★ 纪律所在：事件（post_type/message/notice…）**绝不响应**，只计数。
      this.ignoredEvents += 1;
      return;
    }
    const entry = this.pending.get(echo);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.pending.delete(echo);
    entry.resolve({
      ok: true,
      status: typeof payload.status === 'string' ? payload.status : '',
      retcode: payload.retcode,
      data: payload.data,
    });
  }

  /**
   * 发一帧请求并等它的 echo 回执。
   *
   * @param {string} action
   * @param {Record<string, unknown>} params
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ok: true, retcode?: number, data?: any} | {ok: false, error: string}>}
   */
  async request(action, params, signal) {
    try {
      await this.connect();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const echo = makeEcho(this.seq += 1);
    const frame = JSON.stringify({ action, params, echo });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        resolve({ ok: false, error: `等 ${action} 回执超时（${Math.round(this.timeoutMs / 1000)} 秒）` });
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(echo, { resolve, timer });

      if (signal !== undefined && signal !== null) {
        const onAbort = () => {
          const entry = this.pending.get(echo);
          if (entry === undefined) return;
          clearTimeout(entry.timer);
          this.pending.delete(echo);
          resolve({ ok: false, error: '已取消' });
        };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        this.socket.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        resolve({ ok: false, error: `发送失败：${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      this.touchIdle();
    });
  }

  /**
   * 发一条语音（record 段）。
   *
   * @param {{messageType: 'group'|'private', targetId: string, audioBase64: string, signal?: AbortSignal}} options
   * @returns {Promise<{ok: true, messageId?: unknown, bytes: number} | {ok: false, error: string}>}
   */
  async sendRecord(options) {
    const target = typeof options.targetId === 'string' ? options.targetId.trim() : '';
    if (target === '' || !/^\d+$/.test(target)) return { ok: false, error: `目标不是合法的数字 ID：${target || '(空)'}` };
    const audio = typeof options.audioBase64 === 'string' ? options.audioBase64 : '';
    if (audio === '') return { ok: false, error: '音频数据为空' };

    const record = { type: 'record', data: { file: `base64://${audio}` } };
    const params = options.messageType === 'group'
      ? { group_id: Number(target), message: [record] }
      : { user_id: Number(target), message: [record] };
    const action = options.messageType === 'group' ? 'send_group_msg' : 'send_private_msg';

    // 串行化：前一条的 echo 没回来之前不发下一条，避免交错。
    const run = () => this.request(action, params, options.signal);
    const queued = this.queue.then(run, run);
    // 队列本身不该因为一次失败就断掉
    this.queue = queued.then(() => undefined, () => undefined);

    /** @type {{ok: true, retcode?: number, data?: any} | {ok: false, error: string}} */
    let result;
    try {
      result = await queued;
    } catch (error) {
      // 兜底：request 已经自己把异常转成返回值，走到这里是意料之外的情况。
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok !== true) return { ok: false, error: result.error };
    // OneBot 的失败有时是 retcode 非 0 而不是 HTTP 错。
    if (typeof result.retcode === 'number' && result.retcode !== 0) {
      const detail = result.data !== null && typeof result.data === 'object' && typeof result.data.message === 'string'
        ? result.data.message
        : '';
      return { ok: false, error: `NapCat 拒绝发送（retcode ${result.retcode}）${detail !== '' ? `：${detail}` : ''}` };
    }
    const messageId = result.data !== null && typeof result.data === 'object' ? result.data.message_id : undefined;
    return { ok: true, messageId, bytes: Buffer.from(audio, 'base64').length };
  }

  /** 重置空闲计时器（每次用完都往后推）。 */
  touchIdle() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (this.idleCloseMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.logger.info?.('[dsh-qq-voice] WS 空闲，已自动断开');
      this.close();
    }, this.idleCloseMs);
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref();
  }

  /** 主动断开：先结算在等的请求，再关 socket（不能让调用方挂到超时）。 */
  close() {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const socket = this.socket;
    this.socket = null;
    this.opening = null;
    this.settleAll('WS 连接已关闭');
    if (socket !== null) {
      try { socket.close(); } catch { /* 已断 */ }
    }
  }
}
