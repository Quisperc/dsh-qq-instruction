/**
 * preset-qq 的契约测试 —— 校验 packages/dsh-qq-whale/cordis.patch.yml。
 *
 *   node --test test/
 *
 * 为什么要测 YAML：
 *   preset 的 `plugins` 是 `z.array(z.any())`——**写错键不报错，而是被静默丢弃**，
 *   表现为"配了但没生效"，比报错难查得多（历史上 proactive 字段名写错过一次）。
 *   这里拿 docs/03-reference/preset-qq-contract.md 的核对结果当白名单锁住它。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { PRESET_ID } from '../lib/index.js';

const PATCH = new URL('../cordis.patch.yml', import.meta.url);

/**
 * 各子插件的合法 config 键（事实源：docs/03-reference/preset-qq-contract.md，
 * 由 npm 官方包 0.2.2-alpha.2 的 Config schema 逐个核对而来）。
 */
const ALLOWED_CONFIG_KEYS = {
  persona: ['prefix', 'suffix', 'complete', 'includeRuntimeContext'],
  'agent-instructions': ['projectRootMarkers', 'maxBytes', 'maxSourceBytes', 'instructionFileCandidates', 'localInstructionFileCandidates'],
  'time-context': ['timeZone', 'refreshIntervalMs'],
  'tool-fs': ['read', 'readImage', 'write', 'edit', 'readLimit', 'readMaxLineLength', 'readMaxBytes', 'readStreamMinSize'],
  'compaction-basic': ['thresholdRatio', 'headroomTokens', 'retainRatio', 'retainTokens', 'summarizationProvider', 'summarizationModel', 'maxTokens', 'compactionRetries', 'maxOverflowRetries', 'modelPolicies', 'auto'],
  'command-compact': [],
  'tool-result-pruner': ['thresholdChars', 'headChars', 'tailChars'],
  'tool-ask-user': ['mode', 'timeout'],
  'tool-todo': ['allowParallelInProgress'],
};

/** 必填（schema 标了 required）：缺了会让该行直接失败。 */
const REQUIRED_KEYS = {
  persona: ['prefix'],
  'agent-instructions': ['maxBytes'],
  'tool-todo': ['allowParallelInProgress'],
};

/** 永不启用：群里任何人都能触发，代价不可逆。 */
const HARD_DENY = ['tool-bash', 'tool-pwsh', 'tool-fs-search', 'delegation', 'tool-web', 'present', 'planning'];

/** 有前置条件、暂缓启用（见 ADR-011）。启用了不会让测试红，但会提醒。 */
const PENDING = ['tool-skill', 'skill-filesystem', 'tool-schedule', 'tool-jobs', 'tool-goal', 'command-goal'];

/** 解析 patch：拿到 preset-qq 的条目。 */
function loadPreset() {
  const doc = load(readFileSync(PATCH, 'utf8'));
  const inserted = doc?.[0]?.insert ?? [];
  const preset = inserted.find((x) => x?.id === 'preset-qq');
  assert.ok(preset, 'patch 里必须有 preset-qq 条目');
  return { inserted, preset, plugins: preset.config?.plugins ?? [] };
}

/** 摊平：把 cordis:group 里的子行也展开成一行行。 */
function flatten(plugins) {
  const out = [];
  for (const row of plugins) {
    out.push(row);
    if (Array.isArray(row?.config)) out.push(...row.config);
  }
  return out;
}

test('patch 里有本插件自己 + preset-qq，且 preset 指向官方包', () => {
  const { inserted, preset } = loadPreset();
  assert.ok(inserted.some((x) => x?.id === 'dsh-qq-whale'), '必须插自己的条目');
  assert.equal(preset.name, '@deepseek-ai/dsh-agent-preset');
  assert.equal(preset.config.id, 'qq', 'preset 的 config.id 就是给 agentPresetCustom 填的值');
});

test('preset 只有 id/name/description/plugins（官方 Config 就这五个字段）', () => {
  const { preset } = loadPreset();
  for (const key of Object.keys(preset.config)) {
    assert.ok(
      ['id', 'name', 'description', 'order', 'plugins'].includes(key),
      `preset.config.${key} 不在官方字段里（会被丢弃）`,
    );
  }
});

test('每个子行的 config 键都在官方 schema 里（写错会被静默丢弃）', () => {
  const { plugins } = loadPreset();
  for (const row of flatten(plugins)) {
    const allowed = ALLOWED_CONFIG_KEYS[row.id];
    if (!allowed || typeof row.config !== 'object' || Array.isArray(row.config)) continue;
    for (const key of Object.keys(row.config)) {
      assert.ok(allowed.includes(key), `${row.id}.${key} 不在官方 schema 里（会被静默丢弃）`);
    }
  }
});

test('required 的 config 键都写了', () => {
  const { plugins } = loadPreset();
  const byId = new Map(flatten(plugins).map((x) => [x.id, x]));
  for (const [id, keys] of Object.entries(REQUIRED_KEYS)) {
    const row = byId.get(id);
    assert.ok(row, `缺少子行 ${id}`);
    for (const key of keys) {
      assert.ok(row.config && key in row.config, `${id}.${key} 是 required，不写这行会失败`);
    }
  }
});

test('persona.prefix 只做风格锚点，不塞人设卡', () => {
  const { plugins } = loadPreset();
  const persona = plugins.find((x) => x.id === 'persona');
  const prefix = persona?.config?.prefix ?? '';
  assert.ok(prefix.length > 0, 'prefix 不能为空');
  assert.ok(prefix.length <= 60, `prefix 长到 ${prefix.length} 字了——那是人设卡的活，不是锚点`);
  for (const word of ['雷区', '口头禅', '大肥鱼', '# ', '## ']) {
    assert.ok(!prefix.includes(word), `prefix 里出现了"${word}"：人设卡内容不该进 prefix`);
  }
});

test('tool-result-pruner 的阈值等于插件默认（改动要有理由）', () => {
  const { plugins } = loadPreset();
  const pruner = flatten(plugins).find((x) => x.id === 'tool-result-pruner');
  assert.deepEqual(
    { ...pruner?.config },
    { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    '与 preset-standard 对齐的写法是"等于默认"；要改请在 ADR 里写理由',
  );
});

test('危险能力没有回到能力集里', () => {
  const { plugins } = loadPreset();
  for (const row of flatten(plugins)) {
    if (!HARD_DENY.includes(row.id)) continue;
    assert.equal(row.disabled, true, `${row.id} 不允许出现在 QQ preset 里（除非显式 disabled）`);
  }
});

test('暂缓项若被启用，提醒补齐前置条件', (t) => {
  const { plugins } = loadPreset();
  const enabled = flatten(plugins).filter((x) => PENDING.includes(x.id) && x.disabled !== true);
  for (const row of enabled) {
    t.diagnostic(`⚠️ ${row.id} 已启用：请确认 ADR-011 里列的前置条件已满足（节流 / 审批 / 技能来源）`);
  }
  assert.ok(true);
});

test('compaction 组的 isolate 键合法（Dict<true|string>）', () => {  const { plugins } = loadPreset();
  const group = plugins.find((x) => x.id === 'compaction');
  assert.equal(group.name, 'cordis:group');
  assert.equal(group.group, true);
  for (const [key, value] of Object.entries(group.isolate ?? {})) {
    assert.ok(value === true || typeof value === 'string', `isolate.${key} 只能是 true 或字符串`);
  }
  assert.ok(group.isolate?.compaction === true, 'compaction 服务需要组内隔离');
});

test('preset 的 config.id 与代码常量 PRESET_ID 一致', () => {
  const { preset } = loadPreset();
  assert.equal(
    preset.config.id,
    PRESET_ID,
    `patch 里写 '${preset.config.id}'，lib/index.js 的 PRESET_ID 是 '${PRESET_ID}'——` +
    '历史上代码里一直叫 whale、patch 里却是 qq，填错就「应用预设失败」。改只能两边一起改。',
  );
});
