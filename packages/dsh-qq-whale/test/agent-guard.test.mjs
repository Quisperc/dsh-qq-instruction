import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ALLOW, hideTools, hideToolsAtFirstStep, installAgentGuard, installGuard, isQqAgent } from '../lib/agent-guard.js';

/** 造一个 agent，tools 服务可定制。 */
function fakeAgent(id, options = {}) {
  const guards = [];
  const restricts = [];
  const defs = options.defs ?? [];
  const agent = {
    id,
    ctx: {
      get: (key) => {
        if (key !== 'tools' || options.noTools) return undefined;
        return {
          ...(options.noGuard ? {} : { guard: (fn) => guards.push(fn) }),
          ...(options.noRestrict ? {} : { restrict: (filter) => restricts.push(filter) }),
          definitions: () => defs.map((n) => ({ name: n })),
        };
      },
      on: (event, fn) => {
        if (options.onPreStep && event === 'agent/pre-step') options.onPreStep(fn);
        return () => { if (options.onDispose) options.onDispose(); };
      },
    },
  };
  return { agent, guards, restricts };
}

// ---------------------------------------------------------------- isQqAgent
test('isQqAgent：只认 qqbot- 前缀', () => {
  assert.equal(isQqAgent({ id: 'qqbot-private-507678128' }), true);
  assert.equal(isQqAgent({ id: 'qqbot-group-778916943' }), true);
  assert.equal(isQqAgent({ id: 'session-abc' }), false);
  assert.equal(isQqAgent({ id: undefined, session: { id: 'qqbot-x' } }), true);
  assert.equal(isQqAgent(null), false);
  assert.equal(isQqAgent({}), false);
});

// ---------------------------------------------------------------- installGuard
test('installGuard：装执行期拦截，白名单内放行、其余拒绝', () => {
  const { agent, guards } = fakeAgent('qqbot-1');
  assert.deepEqual(installGuard(agent), { ok: true });
  assert.equal(guards.length, 1);
  const guard = guards[0];
  assert.equal(guard({ name: 'qq_history' }), undefined);
  assert.equal(guard({ name: 'read' }), undefined);
  assert.match(guard({ name: 'bash' }), /不可用/);
  assert.match(guard({ name: 'terminal_open' }), /不可用/);
  // 拿不到名字的调用一律拒（宁可误拒，也不放行看不见的东西）
  assert.match(guard({}), /不可用/);
});

test('installGuard：拿不到 tools / guard 不存在时安全返回', () => {
  assert.equal(installGuard(fakeAgent('qqbot-1', { noTools: true }).agent).ok, false);
  assert.equal(installGuard({ id: 'qqbot-1' }).ok, false);
  assert.equal(installGuard(fakeAgent('qqbot-1', { noGuard: true }).agent).ok, false, '0.2 以前的宿主没有 guard');
});

test('installGuard：guard 抛错不外泄', () => {
  const agent = { id: 'qqbot-1', ctx: { get: () => ({ guard: () => { throw new Error('boom'); } }) } };
  const result = installGuard(agent);
  assert.equal(result.ok, false);
  assert.match(result.reason, /boom/);
});

// ---------------------------------------------------------------- hideTools
test('hideTools：白名单齐全时按名单隐藏其它工具', () => {
  const names = [...DEFAULT_ALLOW, 'bash', 'terminal_open', 'gh_repo'];
  let filter = null;
  const agent = {
    id: 'qqbot-1',
    ctx: { get: () => ({ definitions: () => names.map((n) => ({ name: n })), restrict: (f) => { filter = f; } }) },
  };
  const result = hideTools(agent);
  assert.equal(result.ok, true);
  assert.equal(result.hidden, 3);
  assert.deepEqual([...filter.allow].sort(), [...DEFAULT_ALLOW].sort());
});

test('hideTools：白名单未注册齐全时跳过（绝不缩表）', () => {
  let called = false;
  const agent = {
    id: 'qqbot-1',
    ctx: { get: () => ({ definitions: () => [{ name: 'read' }], restrict: () => { called = true; } }) },
  };
  const result = hideTools(agent);
  assert.equal(result.ok, false);
  assert.match(result.reason, /未注册/);
  assert.equal(called, false, '缺项时不能拿缩水名单去 restrict（2026-11-14 事故）');
});

// ---------------------------------------------------------------- pre-step
test('hideToolsAtFirstStep：名单不变不重复 restrict，名单变了才重新应用', async () => {
  // 回归：QQ agent 长期存活，白名单变了必须能重新生效（2026-11-15 qq_voice 不可用事故）。
  let allowNow = [...DEFAULT_ALLOW];
  let restricted = 0;
  let handler = null;
  const names = () => [...allowNow, 'bash'];
  const agent = {
    id: 'qqbot-1',
    ctx: {
      get: () => ({ definitions: () => names().map((n) => ({ name: n })), restrict: () => { restricted += 1; } }),
      on: (event, fn) => {
        if (event === 'agent/pre-step') handler = fn;
        return () => {};
      },
    },
  };
  const logs = [];
  const ctx = { logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) } };
  const readCfg = () => ({ mode: 'hide', allowTools: allowNow });
  assert.equal(hideToolsAtFirstStep(agent, DEFAULT_ALLOW, ctx, readCfg), true);

  const decision = {};
  assert.equal(await handler({}, async () => decision), decision);
  assert.equal(restricted, 1, '首个 pre-step 应用一次');

  await handler({}, async () => decision);
  assert.equal(restricted, 1, '名单没变时不应重复 restrict');

  // 名单新增一项（模拟用户把新工具加进白名单）→ 应当再次应用
  allowNow = [...DEFAULT_ALLOW, 'qq_voice'];
  await handler({}, async () => decision);
  assert.equal(restricted, 2, '名单变化后应重新应用');
});

test('hideToolsAtFirstStep：热配置切到 guard 后跳过隐藏', async () => {
  let restricted = 0;
  let handler = null;
  const agent = {
    id: 'qqbot-1',
    ctx: {
      get: () => ({ definitions: () => DEFAULT_ALLOW.map((n) => ({ name: n })), restrict: () => { restricted += 1; } }),
      on: (event, fn) => { if (event === 'agent/pre-step') handler = fn; return () => {}; },
    },
  };
  hideToolsAtFirstStep(agent, DEFAULT_ALLOW, { logger: { info: () => {}, warn: () => {} } }, () => ({ mode: 'guard', allowTools: DEFAULT_ALLOW }));
  await handler({}, async () => ({}));
  assert.equal(restricted, 0, 'mode=guard 时不该隐藏');
});

// ---------------------------------------------------------------- installAgentGuard
test('installAgentGuard：只处理 QQ agent；mode=hide 时装 guard 并挂 pre-step', () => {
  let handler = null;
  let preStep = 0;
  const ctx = {
    on: (event, fn) => { if (event === 'agent/created') handler = fn; },
    logger: { info: () => {}, warn: () => {} },
  };
  const readConfig = () => ({ mode: 'hide', allowTools: DEFAULT_ALLOW });
  assert.equal(installAgentGuard(ctx, { readConfig }), true);

  const web = fakeAgent('session-xyz', { onPreStep: () => { preStep += 1; } });
  handler({ agent: web.agent });
  assert.equal(web.guards.length, 0, 'Web 会话不该被碰');

  const qq = fakeAgent('qqbot-group-1', {
    defs: [...DEFAULT_ALLOW, 'bash'],
    onPreStep: () => { preStep += 1; },
  });
  handler({ agent: qq.agent });
  assert.equal(qq.guards.length, 1, 'QQ 会话要装执行期拦截');
  assert.equal(preStep, 1, 'mode=hide 还要挂 pre-step');
});

test('installAgentGuard：mode=guard 只装 guard，不挂 pre-step', () => {
  let handler = null;
  let preStep = 0;
  const ctx = { on: (e, fn) => { if (e === 'agent/created') handler = fn; }, logger: { info: () => {}, warn: () => {} } };
  installAgentGuard(ctx, { readConfig: () => ({ mode: 'guard', allowTools: DEFAULT_ALLOW }) });
  const qq = fakeAgent('qqbot-1', { onPreStep: () => { preStep += 1; } });
  handler({ agent: qq.agent });
  assert.equal(qq.guards.length, 1);
  assert.equal(preStep, 0);
});

test('installAgentGuard：mode=off 与空白名单都不动手', () => {
  let handler = null;
  const logs = [];
  const ctx = { on: (e, fn) => { if (e === 'agent/created') handler = fn; }, logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) } };
  installAgentGuard(ctx, { readConfig: () => ({ mode: 'off', allowTools: DEFAULT_ALLOW }) });
  const off = fakeAgent('qqbot-1');
  handler({ agent: off.agent });
  assert.equal(off.guards.length, 0, 'off 不装 guard');
  assert.ok(logs.some((m) => m.includes('mode=off')));

  installAgentGuard(ctx, { readConfig: () => ({ mode: 'hide', allowTools: [] }) });
  const empty = fakeAgent('qqbot-2');
  handler({ agent: empty.agent });
  assert.equal(empty.guards.length, 0, '空白名单 = 不限制');
});

test('installAgentGuard：静态配置为 off 时连监听都不挂', () => {
  let registered = false;
  const ctx = { on: () => { registered = true; }, logger: { info: () => {}, warn: () => {} } };
  assert.equal(installAgentGuard(ctx, { mode: 'off', allowTools: DEFAULT_ALLOW }), false);
  assert.equal(registered, false);
});

test('installAgentGuard：畸形 payload 与缺服务都不抛（串行事件抛错会毁掉 agent 创建）', () => {
  let handler = null;
  const ctx = { on: (e, fn) => { if (e === 'agent/created') handler = fn; }, logger: { info: () => {}, warn: () => {} } };
  installAgentGuard(ctx, { readConfig: () => ({ mode: 'hide', allowTools: DEFAULT_ALLOW }) });
  assert.doesNotThrow(() => handler(undefined));
  assert.doesNotThrow(() => handler({ agent: { id: 'qqbot-x', ctx: { get: () => ({}) } } }));
  assert.doesNotThrow(() => handler({ agent: { id: 'qqbot-y' } }));
});

test('installGuard：名单每次调用现读，热改后老 agent 立刻生效', async () => {
  // 回归：QQ agent 长期存活，若名单在安装时被快照，新增的白名单项对老会话永远不可用
  // （2026-11-15 用户实际报错：工具 qq_voice 不可用）。
  let guardFn = null;
  const tools = { guard: (fn) => { guardFn = fn; } };
  const agent = { id: 'qqbot-1', ctx: { get: () => tools } };

  let allowNow = [...DEFAULT_ALLOW];
  const readCfg = () => ({ mode: 'hide', allowTools: allowNow });

  assert.equal(installGuard(agent, () => readCfg().allowTools).ok, true);

  // 当前名单里没有 bash → 拒
  assert.equal(typeof guardFn({ name: 'bash' }), 'string');
  assert.equal(guardFn({ name: 'qq_draw' }), undefined, '白名单内的工具应放行');

  // 热改：把 pretend 工具加进名单 → 无需重装守卫即可放行
  allowNow = [...DEFAULT_ALLOW, 'pretend_tool'];
  assert.equal(guardFn({ name: 'pretend_tool' }), undefined, '名单变化后应立刻放行');

  // 老式数组入参仍然可用（向后兼容）
  const tools2 = { guard: (fn) => { guardFn = fn; } };
  const agent2 = { id: 'qqbot-2', ctx: { get: () => tools2 } };
  assert.equal(installGuard(agent2, ['only_this']).ok, true);
  assert.equal(guardFn({ name: 'only_this' }), undefined);
  assert.equal(typeof guardFn({ name: 'anything_else' }), 'string');
});
