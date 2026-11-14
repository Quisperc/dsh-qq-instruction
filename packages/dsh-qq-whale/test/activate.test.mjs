/**
 * 「能激活」测试 —— 锁住 Cordis 运行时这一层。
 *
 * 为什么需要它（历史事故）：纯函数测试全绿**不代表插件能激活**。v0.2.0 曾写
 * `ctx.whale = api`（没有先 provide），Cordis 的服务守卫直接抛
 * `cannot set property "whale" without provide`，插件从那时起一直激活失败，
 * 而配置页 schema 照常渲染——只有看 fiber 激活态才暴露。
 *
 * v0.14.0 起本插件不再注册任何服务（那个服务没有调用方，已删），
 * 所以这里改成锁「apply 只做一件事：挂一个 agent/created 监听」，并且不碰 ctx 的赋值。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, name, PRESET_ID } from '../lib/index.js';

/**
 * 复刻 DSH 内嵌 cordis 的服务守卫：给未经 provide 的名字赋值就抛。
 * @returns {{ctx: any, provided: Map<string, unknown>, listeners: string[]}}
 */
function guardedContext() {
  const provided = new Map();
  const listeners = [];
  const target = {
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    provide(n, v) {
      provided.set(n, v);
      target[n] = v;
      return target;
    },
    on(event) {
      listeners.push(event);
      return () => {};
    },
  };
  const ctx = new Proxy(target, {
    set(t, prop, value) {
      if (typeof prop === 'string' && !provided.has(prop)) {
        throw new Error(`cannot set property "${String(prop)}" without provide`);
      }
      t[prop] = value;
      return true;
    },
  });
  return { ctx, provided, listeners };
}

test('守卫替身有效：未 provide 就赋值会抛（否则下一条断言是假阳性）', () => {
  const { ctx } = guardedContext();
  assert.throws(() => { ctx.whale = {}; }, /cannot set property "whale" without provide/);
});

test('apply 不给 ctx 赋任何服务名，也不注册服务', () => {
  const { ctx, provided } = guardedContext();
  assert.doesNotThrow(() => apply(ctx), 'apply 里出现了未 provide 的赋值——真机上会激活失败');
  assert.equal(provided.size, 0, 'v0.14.0 起不再注册 whale 服务（没有调用方）');
});

test('apply 只做一件事：挂 agent/created 监听', () => {
  const { ctx, listeners } = guardedContext();
  apply(ctx);
  assert.deepEqual(listeners, ['agent/created'], '除了创建监听，不该有别的副作用');
});

test('apply 在缺 on 的上下文里也不抛（降级而不是崩）', () => {
  const bare = { logger: { info() {}, warn() {} } };
  assert.doesNotThrow(() => apply(bare));
});

test('插件名与包名一致（DSH 按 name 挂载）', () => {
  assert.equal(name, 'dsh-qq-whale');
  assert.equal(PRESET_ID, 'qq');
});

test('在真 Cordis 里能激活（装了 cordis 才跑）', async (t) => {
  let Context = null;
  try {
    ({ Context } = await import('cordis'));
  } catch {
    return t.skip('未安装 devDependency cordis（npm i 后本条才会跑）');
  }

  const root = new Context();
  const scope = root.plugin({ apply, name }, {});
  await root.start();

  assert.equal(scope.isActive, true, '插件没能激活（apply 里抛了异常）');
  assert.equal(scope.hasError, false, `激活时报错：${scope.error ?? ''}`);
  assert.equal(scope.status, 2, 'scope.status 应为 ACTIVE(2)');

  await root.stop();
});
