/**
 * 工具面守门：让 QQ 会话只能用它该用的工具。
 *
 * 为什么这件事必须由本插件做（而不是 preset）：
 *   preset 只决定「把哪些插件行挂进 agent scope」，**不收窄**全局注册的工具。
 *   工具可见性 = 全局 + 祖先 scope − restrict。实测：只写 preset 时，QQ 会话的
 *   request/header 里能看到 80+ 个工具，含 bash / terminal_* / subagent / workflow。
 *
 * 为什么挂在 `agent/created` 而不是预设行里：
 *   已经跑过回合的会话 preset 是锁死的（`agents.resume` 沿用会话记录里的 agentPreset），
 *   挂进预设的行对老会话永远不生效。监听 agent 创建则与「用哪张 preset 建的」解耦。
 *
 * 两层手段，各有各的必要性：
 *   1. `tools.guard()`：**执行期**拦截。装上即生效、不依赖注册顺序，但模型仍看得见
 *      schema。安全底线靠它。
 *   2. `tools.restrict()`：**改可见名单**。模型连 schema 都看不到，省 token、少干扰。
 *      但它要求名字全部已注册（未知名字会抛），而 agent 刚创建时工具还没注册完——
 *      所以推到首个 `agent/pre-step` 再调，并先校验「白名单全部已知，缺一项就跳过」。
 *      （2026-11-14 事故：创建时直接 restrict，白名单缩水成 8 个，qq_* 全被挡。）
 *
 * 安全约束：`agent/created` 是**串行 awaited** 的，监听器抛错会让 agent 创建失败。
 *   所以全程 try/catch、只做同步内存操作、日志本身也包在 try 里。
 */

import { DEFAULT_ALLOW, isRestrictionActive, readConfig, wantsHide } from './config.js';

// 便于测试与外部复用：白名单只此一份，不另抄。
export { DEFAULT_ALLOW };

/** QQ 会话的 id 前缀（`dsh-qq-bot` 用 `qqbot-<scope>`；会话被删后重建会带 `-r<hash>`）。 */
const QQ_SESSION_PATTERN = /^qqbot-/;

/**
 * 判断一个 agent 是否属于 QQ 通道。
 * @param {any} agent `agent/created` 里给的 agent
 * @returns {boolean}
 */
export function isQqAgent(agent) {
  if (agent === null || agent === undefined) return false;
  const ids = [agent.id, agent.session !== null && agent.session !== undefined ? agent.session.id : undefined];
  return ids.some((id) => typeof id === 'string' && QQ_SESSION_PATTERN.test(id));
}

/**
 * 取 agent scope 里的 tools 服务（0.2 起必须经 ctx.get）。
 * @param {any} agent 目标 agent
 * @returns {any} tools 服务，取不到时 undefined
 */
function toolsOf(agent) {
  const agentCtx = agent !== null && agent !== undefined ? agent.ctx : undefined;
  if (agentCtx === undefined || agentCtx === null) return undefined;
  try {
    return typeof agentCtx.get === 'function' ? agentCtx.get('tools') : agentCtx.tools;
  } catch {
    return undefined;
  }
}

/**
 * 装执行期拦截：名单外的工具调用直接被拒，并回一句可读的中文。
 *
 * @param {any} agent 目标 agent
 * @param {string[]} allow 白名单
 * @returns {{ ok: boolean, reason?: string }}
 */
export function installGuard(agent, allow = DEFAULT_ALLOW) {
  const tools = toolsOf(agent);
  if (tools === undefined || tools === null) return { ok: false, reason: '拿不到 tools 服务' };
  if (typeof tools.guard !== 'function') return { ok: false, reason: '这个 DSH 版本没有 tools.guard' };

  const allowed = new Set(allow);
  try {
    tools.guard((exec) => {
      const name = exec !== null && exec !== undefined ? exec.name : undefined;
      // 名字都拿不到的调用一律拒：宁可误拒，也不要放行一个看不见的东西。
      if (typeof name !== 'string') return 'QQ 场景：该工具不可用';
      if (allowed.has(name)) return undefined;
      return `QQ 场景：工具 ${name} 不可用（只允许 QQ 工具、读写、提问/待办与记忆）`;
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message ? String(error.message) : String(error) };
  }
}

/**
 * 把名单外的工具从**可见列表**里摘掉。只在白名单全部已注册时执行——
 * 缺一项就返回失败让调用方下个回合再试，绝不用缩水后的名单去限制。
 *
 * @param {any} agent 目标 agent
 * @param {string[]} allow 白名单
 * @returns {{ ok: boolean, hidden?: number, reason?: string }}
 */
export function hideTools(agent, allow = DEFAULT_ALLOW) {
  const tools = toolsOf(agent);
  if (tools === undefined || tools === null || typeof tools.restrict !== 'function') {
    return { ok: false, reason: '没有 restrict 能力' };
  }

  let known;
  try {
    const defs = typeof tools.definitions === 'function' ? tools.definitions() : undefined;
    if (Array.isArray(defs)) known = new Set(defs.map((d) => d && d.name).filter((n) => typeof n === 'string'));
  } catch {
    known = undefined;
  }
  if (known === undefined) return { ok: false, reason: '拿不到可见工具清单' };

  const missing = allow.filter((n) => !known.has(n));
  if (missing.length > 0) {
    return { ok: false, reason: `白名单还有 ${missing.length} 项未注册（${missing.slice(0, 3).join(',')}）` };
  }

  try {
    tools.restrict({ allow });
    return { ok: true, hidden: [...known].filter((n) => !allow.includes(n)).length };
  } catch (error) {
    return { ok: false, reason: error?.message ? String(error.message) : String(error) };
  }
}

/**
 * 在首个 `agent/pre-step` 尝试隐藏，成功后解绑；失败留到下个回合再试。
 *
 * 为什么是 pre-step：那一刻工具已注册齐全，restrict 不会因"名字还没出现"而缩表。
 *
 * @param {any} agent 目标 agent
 * @param {string[]} allow 白名单
 * @param {any} pluginCtx 插件上下文（只用 logger）
 * @param {() => object} [readCfg] 热配置读取器；给了就每步现读
 * @returns {boolean} 是否挂上钩子
 */
export function hideToolsAtFirstStep(agent, allow, pluginCtx, readCfg) {
  const agentCtx = agent !== null && agent !== undefined ? agent.ctx : undefined;
  if (agentCtx === undefined || agentCtx === null || typeof agentCtx.on !== 'function') return false;

  let done = false;
  let dispose;
  try {
    dispose = agentCtx.on('agent/pre-step', async (_payload, next) => {
      if (!done) {
        try {
          const live = typeof readCfg === 'function' ? readCfg() : undefined;
          // 热配置：切回 guard/off 后不再隐藏（已隐藏的不会自动恢复，重开会话才彻底）。
          const shouldHide = live === undefined ? true : (wantsHide(live) && isRestrictionActive(live));
          const allowNow = live !== undefined && Array.isArray(live.allowTools) && live.allowTools.length > 0
            ? live.allowTools
            : allow;
          if (!shouldHide) {
            done = true;
            pluginCtx?.logger?.info?.('[dsh-qq-whale] mode 已不是 hide，跳过隐藏（只保留执行期拦截）');
            if (typeof dispose === 'function') dispose();
            return next();
          }
          const result = hideTools(agent, allowNow);
          if (result.ok) {
            done = true;
            pluginCtx?.logger?.info?.(`[dsh-qq-whale] 工具面已隐藏（${result.hidden} 个不可见）`);
            if (typeof dispose === 'function') dispose();
          }
        } catch (error) {
          pluginCtx?.logger?.warn?.(`[dsh-qq-whale] 隐藏失败（下个回合再试）：${error?.message || error}`);
        }
      }
      return next();
    });
    return true;
  } catch (error) {
    pluginCtx?.logger?.warn?.(`[dsh-qq-whale] 挂 pre-step 钩子失败，只保留执行期拦截：${error?.message || error}`);
    return false;
  }
}

/**
 * 挂 `agent/created` 监听。这是本插件对外的唯一行为入口。
 *
 * @param {any} ctx 插件的（全局）上下文
 * @param {object} [options] 两种形态：
 *   - `{ readConfig: () => cfg }`：每次事件现读（**热生效**走这条，index.js 用这个）；
 *   - 直接给配置对象 `{ mode, allowTools }`：静态值（测试用）。
 * @returns {boolean} 是否挂上
 */
export function installAgentGuard(ctx, options = {}) {
  const hot = typeof options.readConfig === 'function';
  const readCfg = hot ? options.readConfig : () => readConfig(options);

  // 静态配置且一开始就是 off：连监听都不挂。热配置必须挂着，否则改了也收不到。
  if (!hot && !isRestrictionActive(readCfg())) {
    try { ctx.logger?.info?.('[dsh-qq-whale] mode=off，不安装监听'); } catch { /* 忽略 */ }
    return false;
  }

  try {
    if (typeof ctx.on !== 'function') return false;
    ctx.on('agent/created', (payload) => {
      try {
        const agent = payload !== null && payload !== undefined ? payload.agent : undefined;
        if (!isQqAgent(agent)) return;

        const cfg = readCfg();
        if (!isRestrictionActive(cfg)) {
          const why = cfg.mode === 'off' ? 'mode=off' : '白名单为空（视为不限制）';
          ctx.logger?.info?.(`[dsh-qq-whale] 跳过收窄（${why}），agent ${String(agent.id)}`);
          return;
        }

        const installed = installGuard(agent, cfg.allowTools);
        if (installed.ok) ctx.logger?.info?.(`[dsh-qq-whale] 已装执行期拦截（agent ${String(agent.id)}）`);
        else ctx.logger?.warn?.(`[dsh-qq-whale] 拦截安装失败（${installed.reason}），该会话按未限制继续`);

        if (wantsHide(cfg)) hideToolsAtFirstStep(agent, cfg.allowTools, ctx, readCfg);
      } catch (error) {
        // 串行事件里抛错会毁掉 agent 创建，宁可吞掉。
        try { ctx.logger?.warn?.(`[dsh-qq-whale] agent/created 监听异常已忽略：${error?.message || error}`); } catch { /* 忽略 */ }
      }
    });
    return true;
  } catch (error) {
    try { ctx.logger?.warn?.(`[dsh-qq-whale] 挂 agent/created 失败，跳过收窄：${error?.message || error}`); } catch { /* 忽略 */ }
    return false;
  }
}
