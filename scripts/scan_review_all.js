/**
 * 全组合扫描 + 真机数据预演：回顾日维度 / 规律观察健康意义（2026-11-11）
 * 运行：node scripts/scan_review_all.js
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');
function loadPure(rel) {
  const file = path.resolve(__dirname, '..', rel);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }, fileName: file,
  }).outputText;
  const m = new Module(file, module); m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(js, file);
  return m.exports;
}
const { composeDimensionGroups, countGoalMetByDimension } = loadPure('src/lib/reviewDimensions.ts');
const { healthMeaningOf, composeMonthDimensionInsights, composeRecoveryObservations } = loadPure('src/lib/patternHealthMeaning.ts');

const BANNED = /诊断|疗愈|治愈|治疗|患病|我们应该|你应当|你应该|必须|激励|认知反馈|评分说教/;
const DIGITS_IN_MEANING = /\d/; // 健康意义句不该塞新数字

let combos = 0, violations = 0;
const phases = [undefined, '经期', '卵泡期', '排卵期', '黄体期'];
const sleepScores = [undefined, 45, 70, 85, 93, 100];
const steps = [undefined, 0, 379, 9999, 10000, 15000];
const stateMeans = [undefined, 20, 50, 68.7, 89];
const stressMeans = [undefined, 5, 35, 62, 95];
const vitalsSet = [undefined, [{ label: '血压', value: '118/76' }]];
const taskSet = [undefined, [{ label: '呼吸练习', count: 1 }]];
const moodSet = [undefined, ['平静'], ['开心', '疲惫']];

for (const phase of phases) for (const ss of sleepScores) for (const st of steps)
for (const sm of stateMeans) for (const stress of stressMeans)
for (const vit of vitalsSet) for (const task of taskSet) for (const mood of moodSet) {
  combos++;
  const groups = composeDimensionGroups({
    dayKey: '2026-11-10', isToday: true, stepGoal: 10000,
    cyclePhaseLabel: phase, dayInCycle: 7,
    sleepScore: ss, sleepTotalMin: ss ? 480 : undefined, sleepDeepMin: ss ? 150 : undefined,
    steps: st, stateMean: sm, stateLevel: sm != null ? '平稳' : undefined,
    statePointCount: sm != null ? 48 : 0,
    stressMean: stress, vitals: vit, completedTasks: task, moodReports: mood,
  });
  const cards = groups.flatMap(g => g.cards);
  for (const c of cards) {
    // ① 有分数必须同时有 scoreMax 与 label
    if (typeof c.score === 'number' && (!c.scoreMax || !c.scoreLabel)) { violations++; console.log(' ✗ 进度条字段不全', c.id); }
    // ② score 不能越界
    if (typeof c.score === 'number' && (c.score < 0 || c.score > c.scoreMax)) { violations++; console.log(' ✗ 分数越界', c.id, c.score, c.scoreMax); }
    // ③ goalMet 必须是真达标
    if (c.goalMet && c.id === 'sleep' && !(ss >= 85)) { violations++; console.log(' ✗ 睡眠误判达标'); }
    if (c.goalMet && c.id === 'activity' && !(st >= 10000)) { violations++; console.log(' ✗ 步数误判达标'); }
    // ④ 完成任务 / 纯数值型绝不画进度条
    if ((c.id === 'task' || c.id === 'vitals' || c.id === 'cycle') && typeof c.score === 'number') {
      violations++; console.log(' ✗ 不该画进度条', c.id);
    }
    // ⑤ 每张卡必须有健康意义，且不触犯品牌铁律 / 不塞新数字
    if (!c.meaning) { violations++; console.log(' ✗ 缺健康意义', c.id); }
    else {
      if (BANNED.test(c.meaning)) { violations++; console.log(' ✗ 品牌铁律', c.id, c.meaning); }
      if (DIGITS_IN_MEANING.test(c.meaning)) { violations++; console.log(' ✗ 意义句含数字', c.id, c.meaning); }
    }
    // ⑥ 文案长度（日视图小卡别太长）
    if (c.meaning && c.meaning.length > 60) { violations++; console.log(' ✗ 意义句过长', c.id, c.meaning.length); }
    if (c.sub && c.sub.length > 90) { violations++; console.log(' ✗ sub 过长', c.id, c.sub.length); }
  }
  // ⑦ 太阳来源必须与 goalMet 一致
  const sun = countGoalMetByDimension(groups);
  const expectSleep = ss != null && ss >= 85 ? 1 : 0;
  const expectActivity = st != null && st >= 10000 ? 1 : 0;
  if ((sun.sleep ?? 0) !== expectSleep || (sun.activity ?? 0) !== expectActivity) {
    violations++; console.log(' ✗ 太阳来源不一致', { ss, st, sun });
  }
}
console.log(`══ 维度卡全组合扫描：${combos} 组合，${violations} 违规 ══`);

// ── 规律观察健康意义：所有 id × 所有 text 形态 ──
let pv = 0, pc = 0;
const ids = ['sleep_nextday_hrv', 'deep_sleep_hrv', 'resting_hr_hrv', 'bedtime_regularity',
  'weekday_vs_weekend', 'steps_nextday_hr', 'stress_nextday_hrv', 'data_coverage', 'cloud_unknown'];
const texts = ['', '日均心率低的那 6 天，心率变异性平均更高一点——两件事是反着走的。',
  '最近 6 天入睡时间波动大约 90 分钟，早晚差得比较多。',
  '对比 5 个工作日和 3 个周末：日均心率平均多 4.3 bpm。',
  '深睡占比和当天心率变异性是同向的。', '前一天步数和第二天的日均心率是反向的。',
  '当天皮电活跃度和第二天的心率变异性是反向的。'];
const kinds = ['correlation', 'group_diff', 'rhythm', 'coverage', ''];
for (const id of ids) for (const text of texts) for (const kind of kinds) {
  pc++;
  const m = healthMeaningOf({ id, kind, text });
  if (kind === 'coverage' || id === 'data_coverage') { if (m !== null) { pv++; console.log(' ✗ coverage 不该有意义'); } continue; }
  // 完全无信息（未知 id + 空 text + 空 kind）→ 诚实地返回 null，不硬编一句通则
  if (id === 'cloud_unknown' && !text && !kind) { if (m !== null) { pv++; console.log(' ✗ 无信息时不该硬编意义'); } continue; }
  if (!m || m.length < 12) { pv++; console.log(' ✗ 意义句缺失/过短', id, kind, text.slice(0, 20)); continue; }
  if (BANNED.test(m)) { pv++; console.log(' ✗ 品牌铁律', m); }
  if (/\d/.test(m)) { pv++; console.log(' ✗ 意义句含数字', m); }
  if (m.length > 80) { pv++; console.log(' ✗ 意义句过长', m.length, m); }
}
console.log(`══ 健康意义全组合扫描：${pc} 组合，${pv} 违规 ══`);

// ── 月度维度统计 + 因果观察全组合 ──
let mv = 0, mc = 0;
for (const sleepSuns of [0, 1, 6, 12]) for (const actSuns of [0, 2, 6])
for (const sleepCov of [0, 2, 6]) for (const actCov of [0, 2, 6])
for (const dwd of [0, 2, 6]) {
  mc++;
  const total = sleepSuns + actSuns;
  const ins = composeMonthDimensionInsights({
    sunByDim: { sleep: sleepSuns, activity: actSuns },
    coverageByDim: { sleep: sleepCov, activity: actCov },
    totalSuns: total, daysWithData: dwd,
  });
  for (const x of ins) {
    if (!x.text || !x.meaning) { mv++; console.log(' ✗ 缺 text/meaning', x.id); }
    else {
      if (BANNED.test(x.text + x.meaning)) { mv++; console.log(' ✗ 品牌铁律', x.id); }
      if (x.meaning.length > 80) { mv++; console.log(' ✗ 意义句过长', x.id); }
    }
  }
  // 无太阳不得编来源
  if (total === 0 && ins.some(x => x.id === 'sun_source')) { mv++; console.log(' ✗ 无太阳编来源'); }
  // 来源句数字必须与总数一致
  if (total > 0) {
    const src = ins.find(x => x.id === 'sun_source');
    if (!src || !src.text.includes(String(total))) { mv++; console.log(' ✗ 来源数字不符', total, src?.text); }
  }
}
for (const days of [0, 2, 3, 6, 30]) for (const lifted of [0, 1, 3, 6, 30])
for (const lift of [0, 1.9, 2, 8]) for (const real of [true, false]) {
  mc++;
  const obs = composeRecoveryObservations([{ label: '中午缓一缓', days, liftedDays: Math.min(lifted, days), avgLift: lift, hasRealLog: real }]);
  for (const o of obs) {
    if (!o.text || !o.meaning) { mv++; console.log(' ✗ 因果观察缺字段'); }
    else if (BANNED.test(o.text + o.meaning)) { mv++; console.log(' ✗ 因果观察品牌铁律'); }
  }
}
console.log(`══ 月度统计/因果观察扫描：${mc} 组合，${mv} 违规 ══`);

/* ── 真机数据预演（11 月 10 日 + 6 枚太阳全来自睡眠） ── */
console.log('\n══ 真机预演：2026-11-10 回顾日维度卡 ══');
const realGroups = composeDimensionGroups({
  dayKey: '2026-11-10', isToday: true,
  cyclePhaseLabel: '卵泡期', dayInCycle: 7,
  sleepScore: 92, sleepTotalMin: 573, sleepDeepMin: 210, wakeTime: '10:22',
  steps: 1327, stepGoal: 10000,
  stateMean: 68.7, stateLevel: '平稳', statePointCount: 48,
  stressMean: 47,
  vitals: [
    { label: '血压', value: '118/76' }, { label: '心率', value: '69 bpm' },
    { label: 'HRV', value: '54 ms' }, { label: '血氧', value: '97%' },
  ],
  completedTasks: [{ label: '呼吸练习', count: 1 }],
});
for (const g of realGroups) {
  console.log(` 【${g.title}】`);
  for (const c of g.cards) {
    console.log(`   ${c.emoji} ${c.title}${c.value ? ' · ' + c.value : ''}${c.goalMet ? ' ☀️达标' : ''}`);
    if (c.sub) console.log(`      ${c.sub}`);
    console.log(`      进度条: ${typeof c.score === 'number' ? `${c.scoreLabel} (${Math.round(c.score / c.scoreMax * 100)}%)` : '无（符合预期）'}`);
    console.log(`      意义: ${c.meaning}`);
  }
}
console.log('\n══ 真机预演：月视图规律观察 ══');
const realIns = composeMonthDimensionInsights({
  sunByDim: { sleep: 6 }, coverageByDim: { sleep: 6, activity: 6 },
  totalSuns: 6, daysWithData: 6,
});
for (const x of realIns) console.log(` [${x.label}] ${x.text}\n    → ${x.meaning}`);
const criticised = healthMeaningOf({
  id: 'resting_hr_hrv', kind: 'correlation',
  text: '日均心率低的那 6 天，心率变异性平均更高一点——两件事是反着走的。',
});
console.log(`\n [用户点名那条] 原文：日均心率低的那 6 天，心率变异性平均更高一点——两件事是反着走的。`);
console.log(`    → 补的健康意义：${criticised}`);

const totalV = violations + pv + mv;
console.log(`\n══ 总计：${combos + pc + mc} 组合，${totalV} 违规 ══`);
process.exit(totalV > 0 ? 1 : 0);
