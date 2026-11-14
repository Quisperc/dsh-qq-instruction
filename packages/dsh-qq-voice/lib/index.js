/**
 * dsh-qq-voice —— 给 QQBot 加语音回复（TTS）。
 *
 * 它做三件事：注册一个 `qq_voice` 工具、把文字合成语音、用**自己那条只发不收的
 * OneBot 连接**把 `record` 段发出去。没有第四件。
 *
 * 为什么不复用 dsh-qq-bot：
 *   - 它不对外提供任何 Cordis 服务（拿不到它的连接）；
 *   - 它的出站只有 text / image，**没有 record**。
 *   所以本插件自己连 NapCat。代价是要自己判权限与节流（见 lib/guard.js），
 *   收益是不用等上游、也不用打补丁。
 *
 * 一条不能丢的约定：配置**每次现读**（volatile 字段是引用对象），
 * 只在启动时读一次的话，设置页改完不会生效。
 */

import fs from 'node:fs';

import { Config, readConfig, resolveApiKey, resolveSeed, resolveVoice, toolsEnabled } from './config.js';
import { checkTarget, createThrottle, parseSpeaker, readPolicyFromText } from './guard.js';
import { OneBotSender } from './sender.js';
import { synthesize, loadAudio, truncateText } from './tts.js';

export { Config, readConfig, resolveApiKey, toolsEnabled, resolveVoice, resolveSeed };
export { parseSpeaker, readPolicyFromText, checkTarget, createThrottle };
export { OneBotSender };
export { synthesize, loadAudio, truncateText };

export const name = 'dsh-qq-voice';

// 不声明 inject：本插件对宿主服务是「有就用、没有就降级」。
// tools 服务在 agent 作用域里出现，用 ctx.get 惰性取（见 registerTool）。
export const inject = [];

/** 工具名：与 README、whale 白名单、设置页文案必须一致。 */
export const TOOL_NAME = 'qq_voice';

/**
 * 从会话事件里取最近一条用户消息的文本。
 *
 * 为什么这么取：QQ 会话的每条入站消息都带一行头部
 * （`[QQ群 778916943 · 昵称(507678128) · 身份:拥有者｜…]`），
 * 这是**唯一**不依赖 dsh-qq-bot 内部状态就能拿到的身份来源。
 *
 * @param {any} agent 工具执行时拿到的 agent
 * @returns {string} 取不到就返回空串（调用方据此拒绝，而不是猜）
 */
export function lastUserText(agent) {
  try {
    const session = agent?.session;
    if (session === undefined || session === null) return '';
    const events = typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : (Array.isArray(session.events) ? session.events : []);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type !== 'user/message') continue;
      // user/message 的 data 就是消息本身（其它类型才是 data.message）。
      const content = event.data?.content;
      if (!Array.isArray(content)) return '';
      const text = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
      return text;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 读 profile 里的 qq-bot 配置文本（只读）。
 * @param {string} profilePath
 * @returns {string}
 */
export function readProfileText(profilePath) {
  try {
    return fs.readFileSync(profilePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 造工具描述。
 *
 * 为什么是函数而不是常量：音色目录在配置里（volatile），描述里要把**当前**可选音色列给模型看，
 * 否则模型不知道有得挑，只会一直用默认值。工具注册时求值一次；改完配置重载即刷新。
 *
 * @param {ReturnType<typeof readConfig>} cfg
 * @returns {string}
 */
export function buildToolDescription(cfg) {
  const parts = [
    '把一段文字合成语音并发到当前 QQ 会话（或指定群/人）。',
    '有人说「发条语音」「用语音说」「念给我听」时用它，别用文字假装语音。',
    '**音色与种子由你自己决定**：想换个语气/节奏就传 voice 或 seed；拿不准就都留空用默认，别为了试探反复调用。',
  ];

  const voices = Array.isArray(cfg?.voices) ? cfg.voices : [];
  if (voices.length > 0) {
    const listed = voices
      .map((v) => `${v.label}${v.note === '' ? '' : `（${v.note}）`} = ${v.id}`)
      .join('；');
    parts.push(`可选音色（voice 传 id 或名字都认）：${listed}。`);
  } else if (typeof cfg?.ttsVoice === 'string' && cfg.ttsVoice !== '') {
    parts.push(`当前默认音色：${cfg.ttsVoice}（没有可选目录，你也可以直接传别的 id）。`);
  } else {
    parts.push('当前没有配置音色目录，voice 留空即用服务端默认音色。');
  }

  if (cfg?.seedMode === 'fixed') {
    parts.push('seed 由部署方固定，你传了也会被忽略（想让语气有变化请让部署方改 seedMode）。');
  } else if (cfg?.seedMode === 'random') {
    parts.push('seed 每次随机（你传了会被忽略）：同一个音色每句话的节奏都会略有不同。');
  } else {
    parts.push('seed 是整数（0 ≤ seed < 2^31）：同一个音色换个 seed 会换语气与节奏；留空则随机。');
  }

  parts.push('style 是可选的自然语言语气说明（如「慢一点、压低声音」），仅当端点与请求体模板支持 instruction 时才会生效，否则被忽略。');
  parts.push('文本会被字数上限截断；只给拥有者用；有每小时条数与冷却限制，被拒时会告诉你还差多少秒。');
  return parts.join('');
}

/**
 * 造工具定义（不经过 defineTool，纯对象，便于单测直接调 execute）。
 *
 * @param {{
 *   getConfig: () => ReturnType<typeof readConfig>,
 *   throttle: ReturnType<typeof createThrottle>,
 *   senderFor: (cfg: ReturnType<typeof readConfig>) => OneBotSender,
 *   readProfile?: (path: string) => string,
 *   synthesizeImpl?: typeof synthesize,
 *   loadAudioImpl?: typeof loadAudio,
 *   now?: () => number,
 *   random?: () => number,
 * }} deps
 * @returns {any} 工具定义（name/description/parameters/output/execute）
 */
export function createVoiceTool(deps) {
  const readProfile = deps.readProfile ?? readProfileText;
  const synth = deps.synthesizeImpl ?? synthesize;
  const load = deps.loadAudioImpl ?? loadAudio;
  const random = typeof deps.random === 'function' ? deps.random : Math.random;

  return {
    name: TOOL_NAME,
    // getter：注册时求值拿到最新目录；测试里读 tool.description 也是实时的。
    get description() {
      return buildToolDescription(deps.getConfig());
    },
    parameters: {
      text: { type: 'string', required: true, description: '要念出来的文字（不要带表情符号与 Markdown）' },
      voice: { type: 'string', description: '音色 id 或名字（留空 = 用配置默认；可选值见工具描述）' },
      seed: { type: 'number', description: '随机种子 0 ≤ seed < 2^31，换 seed 会换语气与节奏（留空 = 按部署策略）' },
      style: { type: 'string', description: '可选语气说明，如「慢一点、压低声音」；端点不支持时忽略' },
      message_type: { type: 'string', description: 'group 或 private（默认按当前会话推断）' },
      target_id: { type: 'string', description: '群号或 QQ 号（默认当前会话）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    /**
     * @param {{text?: string, message_type?: string, target_id?: string}} args
     * @param {{agent?: any, signal?: AbortSignal}} exec
     */
    async execute(args, exec) {
      const cfg = deps.getConfig();

      // 1) 开关与模式：关着就明确说关着，别让模型以为是它用错了参数。
      if (cfg.enabled !== true) {
        return { ok: false, error: '语音功能未启用：到「插件 → QQ 语音回复」打开总开关（默认关闭）' };
      }
      if (cfg.mode === 'off') {
        return { ok: false, error: '语音功能当前是 off 模式：把 mode 改成 manual 才能用' };
      }

      const rawText = typeof args?.text === 'string' ? args.text.trim() : '';
      if (rawText === '') return { ok: false, error: 'text 不能为空' };

      // 2) 发言人：解析不到就拒（不做宽松猜测）。
      const speaker = parseSpeaker(lastUserText(exec?.agent));
      if (speaker.ok !== true) return { ok: false, error: speaker.error };

      // 3) 目标：默认按当前会话推断，允许显式指定。
      const explicitType = args?.message_type === 'group' || args?.message_type === 'private' ? args.message_type : '';
      const targetType = explicitType !== '' ? explicitType : speaker.scope;
      const explicitTarget = typeof args?.target_id === 'string' ? args.target_id.trim() : '';
      const targetId = explicitTarget !== '' ? explicitTarget
        : (targetType === 'group' ? speaker.groupId : speaker.userId);

      // 4) 策略与权限：读 qq-bot 的白名单/拥有者名单来兜底。
      const policy = (() => {
        const text = readProfile(cfg.profilePath);
        if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: `读不到 ${cfg.profilePath}` };
        return readPolicyFromText(text);
      })();
      const allowed = checkTarget({
        speaker,
        policy,
        targetType,
        targetId,
        allowGroups: cfg.allowGroups,
        ownerOnly: cfg.ownerOnly,
      });
      if (allowed.ok !== true) return { ok: false, error: allowed.error };

      // 5) 节流：放在合成之前——被限流时不该先花掉一次 TTS 调用。
      const gate = deps.throttle.check();
      if (gate.ok !== true) return { ok: false, error: gate.error, retryAfterSec: gate.retryAfterSec };

      // 6) 文本截断（如实告知，模型才知道自己说多了）。
      const { text, truncated, originalChars } = truncateText(rawText, cfg.maxChars);

      // 6.5) 音色 / 种子 / 语气：这三项**允许模型自己决定**，留空则走配置默认。
      //      音色在目录非空时只认目录里的 id 或名字——模型编 id 会拿到可读拒绝，而不是一次 400。
      const pickedVoice = resolveVoice(cfg, args?.voice);
      if (pickedVoice.ok !== true) return { ok: false, error: pickedVoice.error };
      const pickedSeed = resolveSeed(cfg, args?.seed, random);
      const instruction = typeof args?.style === 'string' ? args.style.trim() : '';

      // 7) 合成 → 下载 → 发送
      const apiKey = resolveApiKey(cfg);
      const audio = await synth({
        baseUrl: cfg.ttsBaseUrl,
        apiKey,
        text,
        model: cfg.ttsModel,
        voice: pickedVoice.voice,
        format: cfg.format,
        template: cfg.requestTemplate,
        seed: pickedSeed.seed,
        instruction,
        timeoutMs: cfg.timeoutMs,
        signal: exec?.signal,
      });
      if (audio.ok !== true) return { ok: false, error: audio.error };

      const loaded = await load(audio, { timeoutMs: Math.min(cfg.timeoutMs, 30000), signal: exec?.signal });
      if (loaded.ok !== true) return { ok: false, error: loaded.error };

      const bytes = Buffer.from(loaded.bytes);
      const sender = deps.senderFor(cfg);
      const sent = await sender.sendRecord({
        messageType: targetType,
        targetId,
        audioBase64: bytes.toString('base64'),
        signal: exec?.signal,
      });
      if (sent.ok !== true) return { ok: false, error: sent.error };

      deps.throttle.record();
      const stats = deps.throttle.stats();
      return {
        ok: true,
        sent: true,
        target: { type: targetType, id: targetId },
        bytes: bytes.length,
        seconds: Math.round((bytes.length / (16000 * 2)) * 10) / 10,
        chars: text.length,
        truncated,
        // 把「这次到底用了什么」告诉模型：它下次才知道换哪个参数会有什么效果。
        voice: pickedVoice.voice === '' ? '(服务端默认)' : pickedVoice.voice,
        voiceSource: pickedVoice.source,
        seed: pickedSeed.seed,
        seedSource: pickedSeed.source,
        ...(instruction === '' ? {} : { style: instruction }),
        ...(truncated ? { note: `原文本 ${originalChars} 字，已截断到 ${cfg.maxChars} 字` } : {}),
        remaining: stats.remaining === Infinity ? '不限' : stats.remaining,
      };
    },
  };
}

/**
 * 注册工具：宿主 tools 服务的取法在 0.2.x 里有两种形态，这里都覆盖
 * （与 dsh-qq-bot 的 registerTool 同一套写法，实测可用）。
 *
 * @param {any} ctx
 * @param {() => any} make 每次调用返回新的工具定义（restrict/registrar 可能重建）
 * @returns {boolean} 是否已同步注册成功
 */
function registerTool(ctx, make) {
  const ready = (typeof ctx.get === 'function') ? ctx.get('tools') : undefined;
  if (ready !== undefined && ready !== null && typeof ready.register === 'function') {
    ctx.effect(() => ready.register(make()));
    return true;
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (child) => {
      child.effect(() => child.get('tools').register(make()));
    });
    return false;
  }
  ctx.effect(() => ctx.tools.register(make()));
  return true;
}

/**
 * 插件入口。
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} rawConfig 插件配置（volatile 字段是引用，运行时会被就地更新）
 */
export function apply(ctx, rawConfig) {
  /** 每次现读，绝不缓存。 */
  const current = () => readConfig(rawConfig);

  // 节流器只造一次（限额每次现取），这样热改配置不会把已用额度清零。
  const throttle = createThrottle({ limits: () => current() });

  /** 连接池：只有一个发送器，按配置重建（wsUrl/token 变了才重建）。 */
  let sender = null;
  let senderKey = '';
  /** @param {ReturnType<typeof readConfig>} cfg */
  const senderFor = (cfg) => {
    const key = `${cfg.wsUrl}\u0000${cfg.accessToken}\u0000${cfg.idleCloseMs}`;
    if (sender !== null && senderKey === key) return sender;
    if (sender !== null) sender.close();
    sender = new OneBotSender({
      wsUrl: cfg.wsUrl,
      accessToken: cfg.accessToken,
      timeoutMs: Math.min(cfg.timeoutMs, 30000),
      idleCloseMs: cfg.idleCloseMs,
      logger: ctx.logger,
    });
    senderKey = key;
    return sender;
  };

  const tool = createVoiceTool({ getConfig: current, throttle, senderFor });

  // 动态 import defineTool：宿主没装 dsh-tools 时本插件不该整个装不上，
  // 但要留下一条能看懂的日志（否则就是"工具不见了"却查不到原因）。
  void (async () => {
    let defineTool;
    try {
      ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-qq-voice] 拿不到 @deepseek-ai/dsh-tools，qq_voice 未注册：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    registerTool(ctx, () => {
      const def = { ...tool, execute: tool.execute };
      return typeof defineTool === 'function' ? defineTool(def) : def;
    });
    const cfg = current();
    ctx.logger?.info?.(cfg.enabled === true
      ? `[dsh-qq-voice] ${TOOL_NAME} 已注册（mode=${cfg.mode}，模型 ${cfg.ttsModel}，每小时 ${cfg.maxPerHour} 条）`
      : `[dsh-qq-voice] 已加载但未启用（enabled=false）；到设置页打开并填 DashScope key 后生效`);
  })();

  // 插件卸载时断开我们那条 WS，别让 NapCat 侧留僵尸连接。
  ctx.effect(() => () => {
    if (sender !== null) { sender.close(); sender = null; }
  });
}
