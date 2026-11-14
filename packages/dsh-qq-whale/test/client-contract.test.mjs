import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, '..', 'lib', 'client', 'settings.js');

/** 极简 React 替身：只要 createElement / useState / useEffect 能被调用即可。 */
function fakeReact() {
  const hooks = [];
  let index = 0;
  return {
    __hooks: hooks,
    __reset() { index = 0; },
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat().filter((c) => c !== null && c !== undefined) };
    },
    useState(initial) {
      const slot = index++;
      if (hooks[slot] === undefined) hooks[slot] = [typeof initial === 'function' ? initial() : initial, () => {}];
      return hooks[slot];
    },
    useEffect(fn) {
      const slot = index++;
      hooks[slot] = fn;
      return undefined;
    },
  };
}

/** 在假的 window.__ModuleLoader__ 环境里加载客户端 bundle，返回 { captured, exports }。 */
function loadClient() {
  const source = readFileSync(clientPath, 'utf8');
  const calls = [];
  const win = {
    __ModuleLoader__: {
      load(registration) { calls.push(registration); },
    },
  };
  const react = fakeReact();
  const requireStub = (name) => {
    if (name === 'react') return react;
    throw new Error(`unexpected require: ${name}`);
  };
  // 客户端 bundle 是浏览器格式（无 import/export），在函数作用域里执行即可
  const factory = new Function('window', 'require', `${source}\n;return undefined;`);
  factory(win, requireStub);
  assert.equal(calls.length, 1, 'load 必须恰好被调用一次');
  const registration = calls[0];
  const exports = registration.factory(requireStub);
  return { registration, exports, react };
}

test('load 被调用一次，id 等于 npm 包名', () => {
  const { registration } = loadClient();
  assert.equal(registration.id, 'dsh-qq-whale');
});

test('factory 返回 apply / inject', () => {
  const { exports } = loadClient();
  assert.equal(typeof exports.apply, 'function');
  assert.ok(Array.isArray(exports.inject));
  assert.ok(exports.inject.includes('slots'), 'inject 必须包含 slots');
});

test('apply 把组件注入 plugins.bundle.config，key = 包名', () => {
  const { exports } = loadClient();
  const injected = [];
  const registered = [];
  const ctx = {
    configForms: { get: () => null },
    slots: {
      inject(name, factory) { injected.push(name); factory(); },
      register(spec, component) { registered.push({ spec, component }); return () => {}; },
    },
    logger: { warn: () => {} },
  };
  exports.apply(ctx);
  assert.deepEqual(injected, ['plugins.bundle.config']);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].spec.name, 'plugins.bundle.config');
  assert.equal(registered[0].spec.key, 'dsh-qq-whale');
  assert.equal(typeof registered[0].component, 'function');
});

test('apply 在缺少 slots / configForms 时不抛异常', () => {
  const { exports } = loadClient();
  assert.doesNotThrow(() => exports.apply(undefined));
  assert.doesNotThrow(() => exports.apply({}));
  assert.doesNotThrow(() => exports.apply({ slots: null }));
  assert.doesNotThrow(() => exports.apply({ slots: { inject() { throw new Error('boom'); } } }));
});

test('slot 的 inject() 把 ctx 交给组件', () => {
  const { exports } = loadClient();
  let captured = null;
  const ctx = {
    marker: 42,
    configForms: { get: () => null },
    slots: {
      inject(name, factory) { factory(); },
      register(spec, component) { captured = { spec, component }; return () => {}; },
    },
  };
  exports.apply(ctx);
  assert.notEqual(captured, null);
  assert.equal(captured.spec.inject().ctx, ctx);
});

test('无 configForms 时渲染只读卡片（组件不抛）', () => {
  const { exports, react } = loadClient();
  let captured = null;
  const ctx = {
    slots: {
      inject(name, factory) { factory(); },
      register(spec, component) { captured = { spec, component }; return () => {}; },
    },
  };
  exports.apply(ctx);
  react.__reset();
  const tree = captured.component(captured.spec.inject());
  assert.ok(tree !== undefined && tree !== null);
  const text = JSON.stringify(tree);
  assert.match(text, /cordis\.patch\.yml/);
});

test('有 configForms 时按 snapshot 渲染两项（mode + allowTools）', () => {
  const { exports, react } = factoryWithForm({
    status: 'ready',
    writable: true,
    revision: 7,
    value: { mode: 'hide', allowTools: ['qq_history', 'read'] },
  });
  react.__reset();
  const tree = exports.__render();
  const text = JSON.stringify(tree);
  assert.match(text, /白名单 2 项/);
  assert.match(text, /hide/);
  assert.match(text, /qq_history/);
  // 收窄强度用下拉，不是两个布尔复选框
  const selects = collect(tree, (n) => n.type === 'select');
  assert.equal(selects.length, 1, '应当有一个收窄强度下拉');
  // preset id 不再出现在表单里（改名要改三处，见 README）
  assert.equal(collect(tree, (n) => n.type === 'input').length, 0, '不应再有复选框/输入框');
  assert.equal(/presetId/.test(text), false, 'presetId 不该再出现在界面上');
});

test('保存只提交 mode 与 allowTools 两个字段', async () => {
  const ops = [];
  const handle = {
    getSnapshot: () => ({ status: 'ready', writable: true, revision: 3, value: { mode: 'hide', allowTools: ['read'] } }),
    subscribe: () => () => {},
    mutate: (list) => { ops.push(list); return Promise.resolve(true); },
  };
  const { exports: mod, react } = loadClient();
  let captured = null;
  mod.apply({
    configForms: { get: () => handle },
    slots: {
      inject(name, factory) { factory(); },
      register(spec, component) { captured = { spec, component }; return () => {}; },
    },
  });
  react.__reset();
  const tree = captured.component(captured.spec.inject());
  const button = findByText(tree, '保存');
  assert.ok(button !== null, '应当有保存按钮');
  const textarea = findFirst(tree, (n) => n.type === 'textarea');
  assert.ok(textarea !== null);
  // 先改一下内容，让 dirty=true（保存按钮才会启用）
  textarea.props.onChange({ target: { value: 'read\nqq_history' } });
  button.props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ops.length, 1);
  const paths = ops[0].map((op) => op.path.join('.')).sort();
  assert.deepEqual(paths, ['allowTools', 'mode'], '写入列表只允许这两项');
});

test('allowTools 被改成非数组时给出警告而不是静默覆盖', () => {
  const { exports, react } = factoryWithForm({
    status: 'ready',
    writable: true,
    revision: 1,
    value: { mode: 'guard', allowTools: 'oops-not-an-array' },
  });
  react.__reset();
  const text = JSON.stringify(exports.__render());
  assert.match(text, /不是数组/);
});

test('纯函数：listOf / linesOf 行为正确', () => {
  const { exports } = loadClient();
  const { listOf, linesOf } = exports.__internals;
  assert.deepEqual(listOf('qq_history\n\n read \n'), ['qq_history', 'read']);
  assert.deepEqual(listOf(''), []);
  assert.deepEqual(listOf(undefined), []);
  assert.equal(linesOf(['a', 'b']), 'a\nb');
  assert.equal(linesOf(undefined), '', '非数组（含 null/对象）一律当空，绝不抛');
  assert.equal(linesOf({ length: 2 }), '');
});

/** 深度遍历渲染树，收集满足谓词的节点。 */
function collect(node, predicate) {
  const out = [];
  walk(node, (n) => { if (n && predicate(n)) out.push(n); });
  return out;
}

/** 深度遍历渲染树，找出所有 type 为 input 的节点。 */
function collectInputs(node) {
  const out = [];
  walk(node, (n) => { if (n && n.type === 'input') out.push(n); });
  return out;
}

function findFirst(node, predicate) {
  let found = null;
  walk(node, (n) => { if (found === null && predicate(n)) found = n; });
  return found;
}

function findByText(node, text) {
  return findFirst(node, (n) => n && Array.isArray(n.children) && n.children.some((c) => c === text));
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (typeof node !== 'object') return;
  visit(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit);
}

/** 用给定 snapshot 造一个能渲染的组件树（复用 loadClient 的 loader 环境）。 */
function factoryWithForm(snapshot) {
  const { exports: mod, react } = loadClient();
  let captured = null;
  const handle = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: () => Promise.resolve(true),
    set: () => Promise.resolve(true),
  };
  const ctx = {
    configForms: { get: () => handle },
    slots: {
      inject(name, factory) { factory(); },
      register(spec, component) { captured = { spec, component }; return () => {}; },
    },
  };
  mod.apply(ctx);
  mod.__render = () => captured.component(captured.spec.inject());
  return { exports: mod, react };
}
