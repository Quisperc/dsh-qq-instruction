#!/usr/bin/env node
/**
 * 给 node_modules 里的 `@sputnikzaychik/dsh-qq-bot` 打最小补丁：**模型没说话时不要替它发言**。
 *
 * 为什么需要这个脚本而不是直接改那个文件：
 *   node_modules 里的改动会在每次升级插件时丢掉。写进脚本后，「升级 → 跑一遍」就是一步操作，
 *   而且脚本是幂等的、能 diff、能被测试盯着——比一条只存在于口头记忆里的手工改动可靠。
 *
 * 补丁内容（gateway/turn-runtime.js，`reply === ''` 分支）：
 *   原行为：无论什么原因没产出文字，都往群里发一句「（本轮没有产生文字回复：<原因>）」。
 *   新行为：**只有本回合真的失败（turn/end 带 error）才发这句**；
 *           正常结束但没文字 = 模型选择不说，安静跳过。
 *
 * 用法：
 *   node scripts/patch-qqbot.mjs           # 只看会不会改（dry-run）
 *   node scripts/patch-qqbot.mjs --write   # 真打补丁
 *   node scripts/patch-qqbot.mjs --revert  # 还原成上游原文（需 --write 一起用才落盘）
 */

import fs from 'node:fs';
import path from 'node:path';

/** 默认目标：本机 web profile 里的插件副本。 */
const DEFAULT_TARGET = '/data/dsh/profiles/web/node_modules/@sputnikzaychik/dsh-qq-bot/lib/gateway/turn-runtime.js';

/** 上游原文（逐字匹配，改上游版本后这里要跟着更新——匹配失败会明确报错，不会静默跳过）。 */
const ORIGINAL = `    const reply = extractReply(entry.agent, message.id);
    if (reply === '') {
      // 失败提示总是作为正式回复发出（即使 ack 已发过「正在处理」也不吞掉结论）
      sendReply(frame, '（本轮没有产生文字回复：' + lastTurnReason(entry.agent) + '）');
      // 这一支以前直接 return，跳过了下面的缓存清理：失败的回合一定留图。
      await cleanupImageCache(entry);
      return;
    }`;

/** 打上补丁后的样子。 */
const PATCHED = `    const reply = extractReply(entry.agent, message.id);
    if (reply === '') {
      // [patch:silent-empty-reply] 模型没产出文字 = 它选择不说，尊重模型意愿，不替它发言。
      // 但真正的失败仍要让人看见：只有 turn/end 带 error 时才发提示。
      if (turnFailed(entry.agent)) {
        sendReply(frame, '（本轮没有产生文字回复：' + lastTurnReason(entry.agent) + '）');
      } else {
        console.log(TAG + ' 本回合无文字输出（模型选择不说），已静默跳过');
      }
      // 这一支以前直接 return，跳过了下面的缓存清理：失败的回合一定留图。
      await cleanupImageCache(entry);
      return;
    }`;

/** 配套的小工具函数：插在 lastTurnReason 定义之前。 */
const HELPER_ANCHOR = `  function lastTurnReason(agent) {`;
const HELPER = `  /**
   * [patch:silent-empty-reply] 本回合是否真的失败（turn/end 的 reason 带 error）。
   *
   * 为什么要区分：模型完全可以「看了但不想说话」，那是正常结束、没有 error；
   * 而 400/429/503 这类是真出了事。两者都不说话的话，故障就被藏起来了。
   */
  function turnFailed(agent) {
    try {
      const session = agent.session;
      const events = session.snapshotEvents(0, session.seq);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].type !== 'turn/end') continue;
        const reason = events[index].data?.reason;
        if (reason === null || reason === undefined) return false;
        if (typeof reason === 'object' && reason.error !== null && reason.error !== undefined) return true;
        if (typeof reason === 'string' && /^\\d{3}\\s*:/.test(reason)) return true;
        return false;
      }
      return false;
    } catch {
      // 读不到日志时按「失败」处理：宁可多报一句，也不要静默吞掉真问题
      return true;
    }
  }

  function lastTurnReason(agent) {`;

const args = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const write = args.has('--write');
const revert = args.has('--revert');
const target = process.env.QQBOT_TURN_RUNTIME ?? DEFAULT_TARGET;

if (!fs.existsSync(target)) {
  console.error(`✗ 找不到目标文件：${target}\n  插件没装或路径不同时，用 QQBOT_TURN_RUNTIME 覆盖`);
  process.exit(1);
}

let source = fs.readFileSync(target, 'utf8');
const alreadyPatched = source.includes('[patch:silent-empty-reply]');

if (revert) {
  if (!alreadyPatched) {
    console.log('目标文件是上游原文，无需还原。');
    process.exit(0);
  }
  // 还原：把 PATCHED 段换回 ORIGINAL，并删掉 turnFailed 帮助函数
  let out = source;
  if (out.includes(PATCHED)) out = out.replace(PATCHED, ORIGINAL);
  if (out.includes(HELPER)) out = out.replace(HELPER, HELPER_ANCHOR);
  if (out === source) {
    console.error('✗ 无法精确还原（文件可能被别处改过），请手工处理');
    process.exit(1);
  }
  if (write) {
    fs.writeFileSync(target, out);
    console.log(`✓ 已还原：${target}`);
  } else {
    console.log('（dry-run）会还原成上游原文；加 --write 落盘');
  }
  process.exit(0);
}

if (alreadyPatched) {
  console.log('已经是补丁后的状态，无需重复打补丁。');
  process.exit(0);
}

// 校验锚点：两处都要能精确命中，否则说明上游版本变了，必须人工确认
const canBlock = source.includes(ORIGINAL);
const canHelper = source.includes(HELPER_ANCHOR);

if (!canBlock || !canHelper) {
  console.error('✗ 锚点匹配失败，说明上游版本变了：');
  if (!canBlock) console.error('  · `reply === \'\'` 那段找不到原文（可能已被上游改掉）');
  if (!canHelper) console.error('  · `function lastTurnReason(agent) {` 找不到');
  console.error('  请人工比对后再更新本脚本里的 ORIGINAL / HELPER 常量。');
  process.exit(1);
}

const backup = `${target}.bak-silent-patch-${Date.now()}`;
let out = source.replace(ORIGINAL, PATCHED).replace(HELPER_ANCHOR, HELPER);

if (write) {
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, out);
  console.log(`✓ 已打补丁：${target}`);
  console.log(`  备份：${backup}`);
  console.log('  生效方式：重载插件（plugin_manager set_bundle 关→开）或重启容器');
} else {
  console.log('（dry-run）将修改 2 处：reply 空分支 + 新增 turnFailed 帮助函数');
  console.log('  加 --write 落盘');
}
