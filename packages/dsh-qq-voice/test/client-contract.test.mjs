/**
 * 客户端半的契约测试（纯 Node，不起浏览器）。
 *
 * 为什么要有：客户端半边一旦违反契约（id 不等于包名、apply 抛异常、
 * 注入的 slot 名写错），后果是**整站白屏**或"设置页里什么都不显示"，
 * 而这两件事在提交前必须能自动化发现。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'lib', 'client', 'settings.js');
const PKG = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

/** 上一版会把 factory 调两次；这里单独取出 exports。 */
function loadClientExports() {
  const source = fs.readFileSync(CLIENT, 'utf8');
  let result = null;
  const window = {
    __ModuleLoader__: {
      load: (options) => {
        result = options.factory((name) => {
          if (name === 'react') {
            return {
              createElement: () => null,
              useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
              useEffect: () => undefined,
            };
          }
          throw new Error(`unexpected require: ${name}`);
        });
        return result;
      },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', source)(window);
  return result;
}

test('客户端模块：load 被调用一次，id 必须等于包名', () => {
  const source = fs.readFileSync(CLIENT, 'utf8');
  const ids = [...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.includes(PKG.name), `load({ id }) 必须是 '${PKG.name}'，实际出现：${ids.join(', ')}`);
});

test('客户端模块：package.json 真的导出了 ./client，且指向存在的文件', () => {
  const target = PKG.exports['./client'];
  const file = typeof target === 'string' ? target : target?.default;
  assert.equal(file, './lib/client/settings.js');
  assert.ok(fs.existsSync(path.join(here, '..', file)), 'exports["./client"] 指向的文件必须存在');
  assert.equal(PKG.dsh.client.platform, 'web');
});

test('客户端出口：有 apply 与 inject，inject 里含 slots 与 configForms', () => {
  const exported = loadClientExports();
  assert.equal(typeof exported.apply, 'function');
  assert.ok(Array.isArray(exported.inject));
  assert.ok(exported.inject.includes('slots'));
  assert.ok(exported.inject.includes('configForms'));
});

test('装配：注入到 plugins.bundle.config，key 等于包名', () => {
  const exported = loadClientExports();
  /** @type {any[]} */
  const injected = [];
  /** @type {any[]} */
  const registered = [];
  const ctx = {
    slots: {
      inject: (name, factory) => {
        injected.push({ name, factory });
        return () => undefined;
      },
      register: (registration, component) => {
        registered.push({ registration, component });
        return () => undefined;
      },
    },
  };
  exported.apply(ctx, {});
  assert.equal(injected.length, 1);
  assert.equal(injected[0].name, 'plugins.bundle.config');
  // 触发工厂：它应该注册 key = 包名 的卡片
  injected[0].factory({});
  assert.equal(registered.length, 1);
  assert.equal(registered[0].registration.name, 'plugins.bundle.config');
  assert.equal(registered[0].registration.key, PKG.name);
  assert.equal(typeof registered[0].registration.inject, 'function');
  assert.equal(typeof registered[0].component, 'function');
});

test('装配：ctx 缺服务时不抛（卡片消失优于整站白屏）', () => {
  const exported = loadClientExports();
  assert.doesNotThrow(() => exported.apply(undefined, {}));
  assert.doesNotThrow(() => exported.apply({}, {}));
  assert.doesNotThrow(() => exported.apply({ slots: null }, {}));
  // slots.inject 本身抛错也只影响卡片
  assert.doesNotThrow(() => exported.apply({ slots: { inject: () => { throw new Error('boom'); } } }, {}));
});

test('字段清单覆盖了所有会被设置页编辑的键，且密钥字段留空=不修改', () => {
  const exported = loadClientExports();
  const keys = exported.FIELDS.filter((f) => f.key !== undefined).map((f) => f.key);
  for (const required of ['enabled', 'mode', 'ttsModel', 'ttsVoice', 'apiKey', 'wsUrl', 'accessToken', 'maxPerHour', 'cooldownSec', 'ownerOnly', 'allowGroups']) {
    assert.ok(keys.includes(required), `设置页应该能改 ${required}`);
  }
  const secrets = exported.FIELDS.filter((f) => f.type === 'secret').map((f) => f.key);
  assert.deepEqual(secrets.sort(), ['accessToken', 'apiKey']);
});
