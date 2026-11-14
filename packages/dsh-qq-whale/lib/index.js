/**
 * dsh-qq-whale —— 两件事，没有第三件。
 *
 *   1. 用 `dsh.bundle.patch` 往 profile 组合树里插一条 `preset-qq` 条目
 *      （条目内容全在包内 `cordis.patch.yml`，本文件不参与拼装）；
 *   2. 守工具面：监听 `agent/created`，给 QQ 会话装执行期拦截，按配置决定是否隐藏。
 *
 * 明确不做的事（做减法时砍掉的，别再长回来）：
 *   - 不提供任何跨插件服务（曾经的 `ctx.provide('whale')` 没有任何调用方，已删）；
 *   - 不管人格（人设卡在 `dsh-qq-bot.persona.text`，本插件不碰）；
 *   - 不做 `presetId` 配置项（id 由 patch 决定，能改就是能改坏）；
 *   - 不导出 `./restrict`（历史兼容入口，与 agent-guard 重复，已删）。
 *
 * 一条不能丢的约定：配置必须**每次现读**。volatile 字段运行时是引用对象，
 * 只在启动时读一次的话，设置页改完不会生效。
 */

import { Config, DEFAULT_ALLOW, DEFAULT_CONFIG, MODES, PRESET_ID, isRestrictionActive, readConfig, wantsHide } from './config.js';
import { installAgentGuard } from './agent-guard.js';

export { Config, DEFAULT_ALLOW, DEFAULT_CONFIG, MODES, PRESET_ID, isRestrictionActive, readConfig, wantsHide };

export const name = 'dsh-qq-whale';
// apply 里要用 agents.list() 补装存量 agent（重载即生效的前提），声明后 Cordis 会等它就绪再跑 apply
export const inject = ['agents'];

/**
 * 插件入口：只做两件事——挂监听、打一行状态日志。
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} rawConfig 插件配置（volatile 字段是引用，运行时会被就地更新）
 */
export function apply(ctx, rawConfig) {
  /** 每次调用都读最新值，绝不缓存。 */
  const current = () => readConfig(rawConfig);

  installAgentGuard(ctx, { readConfig: current });

  const cfg = current();
  const state = !isRestrictionActive(cfg)
    ? (cfg.mode === 'off' ? '收窄关闭（mode=off）' : '收窄关闭（白名单为空）')
    : (wantsHide(cfg) ? `收窄开启（${cfg.allowTools.length} 项，模型不可见）` : `收窄开启（${cfg.allowTools.length} 项，仅执行期拦截）`);
  // 提示语只在这里打一次，排障时不用翻文档找"该填什么"。
  ctx.logger?.info?.(`[dsh-qq-whale] preset '${PRESET_ID}' 已就位；${state}；dsh-qq-bot 的「自定义 agent preset id」填 '${PRESET_ID}'（只影响新会话）`);
}
