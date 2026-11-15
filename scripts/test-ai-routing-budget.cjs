// Run with: node scripts/test-ai-routing-budget.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
// ★ 2026-11-15（上线测试 REG-01）：load() 用裸 Node require 装不了 .ts 相对 import，
//   healthSelection.ts 新增 `../data/cycleScope` 后直接 MODULE_NOT_FOUND。
//   给 load 增加可选 mocks，脚本只关心路由/预算逻辑，把周期能力开关 stub 掉即可。
function load(name, mocks = {}) {
  const filename = path.resolve(__dirname, '../src/ai', name + '.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = new Module(filename, module);
  const origRequire = mod.require.bind(mod);
  mod.require = id => (id in mocks ? mocks[id] : origRequire(id));
  mod._compile(output, filename);
  return mod.exports;
}
const { shouldRouteToCloud } = load('questionRouting');
const { fitContext, ContextBudgetError, MODEL_CONTEXT_TOKENS } = load('contextBudget');
// ★ 2026-11-15（上线测试 REG-01）：MODEL_CONTEXT_TOKENS 已于 2026-11-08 从 2048
//   调到 4096（真机 nPredict=540 + 健康事实超窗），脚本里的 2000/1834/1835
//   这些硬编码长度是按旧 2048 窗口写的，属断言过时而非预算逻辑退化。
const SAFETY_TOKENS = 64;
const budgetFor = (outputTokens) => MODEL_CONTEXT_TOKENS - outputTokens - SAFETY_TOKENS;
const { selectHealthFacts, needsHealthFacts } = load('healthSelection', {
  '../data/cycleScope': { showCycleContent: () => true },
});
async function main() {
  for (const [question, expected] of [
    ['最近周期和焦虑有什么关系', true],
    ['最近血糖和睡眠有什么关系', true],
    ['这周hrv趋势怎么样', true],
    ['我好焦虑，陪陪我', false],
    ['不要分析，我最近压力大', false],
    ['最近情绪变化有什么建议', true],
    ['今天开心', false],
    ['最近状态怎么样', false],
    ['我不需要分析睡眠原因', false],
    ['经期为什么难过', true],
  ]) assert.equal(shouldRouteToCloud(question), expected, question);
  const snapshot = [
    '【用户健康数据】',
    '• 解读规则：推算不等于实测',
    '• 当前时段：上午',
    '• 基础指标：HRV=42（2026-10-26；设备记录；5个样本）',
    '• 睡眠事实：7小时；用户记录',
    '• 激素推断：指数60；推算；仅3天体温',
    '• 周期相位：黄体期',
    '• 情绪脑力：压力40',
    '• 代谢血液指标：血糖5.2',
    '• 新增证据说明：质量较低',
    '【用户已确认的个人规律（参考）】\n- 散步后放松',
  ].join('\n');
  const sleep = selectHealthFacts(snapshot, '昨晚睡得怎么样', { omitPatternContext: true });
  assert.ok(sleep.includes('7小时；用户记录'));
  assert.ok(sleep.includes('2026-10-26；设备记录；5个样本'));
  assert.ok(sleep.includes('推算不等于实测') && sleep.includes('新增证据说明'));
  assert.ok(sleep.includes('黄体期'));
  assert.ok(!sleep.includes('血糖5.2') && !sleep.includes('散步后放松'));
  const mixed = selectHealthFacts(snapshot, '经期睡眠和血糖关系');
  assert.ok(mixed.includes('指数60；推算；仅3天体温') && mixed.includes('血糖5.2') && mixed.includes('7小时'));
  assert.equal(selectHealthFacts(snapshot, '综合健康分析'), snapshot);
  assert.equal(selectHealthFacts('', '睡眠'), '');
  for (const q of ['血糖', '血压', 'hrv', '孕酮', '焦虑']) assert.equal(needsHealthFacts(q), true, q);
  assert.equal(needsHealthFacts('你好'), false);
  // Deterministic tokenizer tests budgeting mechanics, not native model tokenization.
  const ctx = {
    getFormattedChat: async messages => ({ prompt: messages.map(m => m.content).join(' ') }),
    tokenize: async text => ({ tokens: Array(text.length).fill(1) }),
  };
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'assistant', content: 'a'.repeat(budgetFor(150) + 50) },
    { role: 'user', content: 'question' },
  ];
  const original = JSON.stringify(messages);
  assert.deepEqual(await fitContext(ctx, messages, 150, [1]), [messages[0], messages[2]]);
  assert.equal(JSON.stringify(messages), original);
  await assert.rejects(fitContext(ctx, messages, 150), ContextBudgetError);
  const boundary = [{ role: 'user', content: 'a'.repeat(budgetFor(150)) }];
  assert.deepEqual(await fitContext(ctx, boundary, 150), boundary);
  await assert.rejects(fitContext(ctx, [{ role: 'user', content: 'a'.repeat(budgetFor(150) + 1) }], 150), ContextBudgetError);
  await assert.rejects(fitContext(ctx, messages, 2048), ContextBudgetError);
  console.log('PASS: routing, complete fact selection and context budget checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
