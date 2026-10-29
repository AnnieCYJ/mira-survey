// Run with: node scripts/test-ai-routing-budget.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../src/ai', name + '.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = new Module(filename, module);
  mod._compile(output, filename);
  return mod.exports;
}
const { shouldRouteToCloud } = load('questionRouting');
const { fitContext, ContextBudgetError } = load('contextBudget');
const { selectHealthFacts, needsHealthFacts } = load('healthSelection');
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
    { role: 'assistant', content: 'a'.repeat(2000) },
    { role: 'user', content: 'question' },
  ];
  const original = JSON.stringify(messages);
  assert.deepEqual(await fitContext(ctx, messages, 150, [1]), [messages[0], messages[2]]);
  assert.equal(JSON.stringify(messages), original);
  await assert.rejects(fitContext(ctx, messages, 150), ContextBudgetError);
  const boundary = [{ role: 'user', content: 'a'.repeat(1834) }];
  assert.deepEqual(await fitContext(ctx, boundary, 150), boundary);
  await assert.rejects(fitContext(ctx, [{ role: 'user', content: 'a'.repeat(1835) }], 150), ContextBudgetError);
  await assert.rejects(fitContext(ctx, messages, 2048), ContextBudgetError);
  console.log('PASS: routing, complete fact selection and context budget checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
