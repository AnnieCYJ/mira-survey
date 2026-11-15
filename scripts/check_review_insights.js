/**
 * 离线自检：回顾日维度卡 + 规律观察健康意义（2026-11-11）
 * 纯规则模块零 RN / 零 IO，可直接用 ts-node transpile-only 载入跑断言。
 * 运行：node scripts/check_review_insights.js
 */
// 直接用 TypeScript 编译器 API 转译**纯规则模块**（只有 type-only import，运行时零依赖），
// 绕开项目 tsconfig 的 moduleResolution:bundler（ts-node 会报 TS5095）。
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

function loadPure(rel) {
  const file = path.resolve(__dirname, '..', rel);
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: file,
  }).outputText;
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(js, file);
  return m.exports;
}

const {
  composeDimensionGroups,
  countGoalMetByDimension,
  SLEEP_GOAL,
} = loadPure('src/lib/reviewDimensions.ts');
const {
  healthMeaningOf,
  composeRecoveryObservations,
  composeMonthDimensionInsights,
} = loadPure('src/lib/patternHealthMeaning.ts');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ FAIL:', name, extra); }
};
// ★ 2026-11-15（上线测试 REG-01）：v1.4.4 起维度引擎重构，部分卡（vitals/task）
//   改为条件产出，旧 hasScore 直接读 undefined.score 会 TypeError 崩掉整个脚本。
const hasScore = (c) => !!c && typeof c.score === 'number' && Number.isFinite(c.score);
const flat = (groups) => groups.flatMap((g) => g.cards);
const card = (groups, id) => flat(groups).find((c) => c.id === id);

console.log('══ A. 维度卡：有分数才画进度条 ══');
{
  const g = composeDimensionGroups({
    dayKey: '2026-11-10', isToday: true,
    cyclePhaseLabel: '卵泡期', dayInCycle: 7,
    sleepScore: 92, sleepTotalMin: 573, sleepDeepMin: 210, wakeTime: '10:22',
    steps: 1327, stepGoal: 10000,
    stateMean: 68.7, stateLevel: '平稳', statePointCount: 48,
    stressMean: 47,
    vitals: [{ label: '血压', value: '118/76' }, { label: '血氧', value: '98%' }],
    completedTasks: [{ label: '呼吸练习', count: 1 }, { label: '记了饮食', count: 2 }],
  });
  // ★ 2026-11-15：当前引擎 = 3 个固定主题组（身体节律/活动与状态/情绪与压力）
  //   + 最多 1 个条件组（身体指标合看，需 vitalsDetail 且有跨指标信号）；task 组已删除。
  ok('组数 = 3（最多 4，旧 5 组断言已过时）', g.length >= 3 && g.length <= 4,
    `实际 ${g.length}: ${g.map(x => x.title).join('/')}`);
  ok('睡眠有分数→进度条', hasScore(card(g, 'sleep')));
  ok('睡眠 92≥85 → goalMet', card(g, 'sleep').goalMet === true);
  ok('睡眠进度条 label 正确', card(g, 'sleep').scoreLabel === '睡眠评分 92 / 100');
  ok('步数有目标→进度条', hasScore(card(g, 'activity')));
  ok('步数未达标→无 goalMet', !card(g, 'activity').goalMet);
  ok('整体状态有分数→进度条', hasScore(card(g, 'state')));
  ok('身心压力有 0-100 值→进度条', hasScore(card(g, 'stress')));
  ok('生理周期无分数→不画进度条', !hasScore(card(g, 'cycle')));
  ok('身体指标无分数→不画进度条', !hasScore(card(g, 'vitals')));
  ok('完成任务型无分数→不画进度条', !hasScore(card(g, 'task')));
  ok('每张卡都带健康意义', flat(g).every((c) => !!c.meaning),
    flat(g).filter(c => !c.meaning).map(c => c.id).join(','));
  const suns = countGoalMetByDimension(g);
  ok('太阳来源只数 goalMet 且按维度', suns.sleep === 1 && suns.activity === undefined,
    JSON.stringify(suns));
  ok('达标线 85 与 buildTodayTimeline 同源', SLEEP_GOAL === 85);
}
{
  const g = composeDimensionGroups({
    dayKey: '2026-11-10', isToday: true, stepGoal: 10000,
    sleepScore: 70, steps: 10000,
  });
  ok('睡眠 70<85 → 无 goalMet', card(g, 'sleep').goalMet === undefined);
  ok('步数 10000 达标 → goalMet', card(g, 'activity').goalMet === true);
  const suns = countGoalMetByDimension(g);
  ok('步数达标计入 activity 来源', suns.activity === 1, JSON.stringify(suns));
}
console.log('══ B. 空态铁律：无数据整组不出 ══');
{
  const empty = composeDimensionGroups({ dayKey: '2026-01-01', isToday: false, stepGoal: 10000 });
  ok('全空 → 0 组', empty.length === 0, JSON.stringify(empty.map(g => g.title)));
  const onlySleep = composeDimensionGroups({ dayKey: 'x', isToday: false, stepGoal: 10000, sleepScore: 93 });
  ok('只有睡眠 → 只出身体节律一组', onlySleep.length === 1 && onlySleep[0].cards.length === 1);
  const stale = composeDimensionGroups({ dayKey: 'x', isToday: true, stepGoal: 10000, sleepScore: 93, sleepDataStale: true });
  ok('今天断流 → 睡眠卡无分数（不画进度条）', !hasScore(card(stale, 'sleep')));
  ok('今天断流 → 诚实文案', /还没同步/.test(card(stale, 'sleep').sub ?? ''));
  ok('今天断流 → 不计太阳', countGoalMetByDimension(stale).sleep === undefined);
}
console.log('══ C. 健康意义：用户点名的「反着走」 ══');
{
  const criticised = {
    id: 'resting_hr_hrv', kind: 'correlation',
    text: '日均心率低的那 6 天，心率变异性平均更高一点——两件事是反着走的。',
  };
  const m = healthMeaningOf(criticised);
  ok('「反着走」有健康意义', !!m && m.length > 20, m);
  ok('讲的是身体意义（恢复/精力）', /恢复|精力|余量/.test(m), m);
  ok('软化措辞，不诊断', /通常|往往|一般|看起来/.test(m) && !/诊断|患病|治疗|应该/.test(m), m);
  ok('不新增具体数字', !/\d/.test(m), m);
  ok('data_coverage 不讲意义', healthMeaningOf({ id: 'data_coverage', kind: 'coverage' }) === null);
}
console.log('══ D. 端侧 8 个 pattern id 全覆盖 ══');
{
  const ids = [
    'sleep_nextday_hrv', 'deep_sleep_hrv', 'resting_hr_hrv', 'bedtime_regularity',
    'weekday_vs_weekend', 'steps_nextday_hr', 'stress_nextday_hrv',
  ];
  for (const id of ids) {
    const m = healthMeaningOf({ id, kind: 'correlation', text: '某两个数字一起动' });
    ok(`${id} 有健康意义`, !!m && m.length >= 15, m);
    ok(`${id} 用软化措辞`, /通常|看起来|一般|往往|多半|关系|连着/.test(m), m);
  }
  const unsteady = healthMeaningOf({ id: 'bedtime_regularity', text: '入睡时间波动大约 90 分钟，早晚差得比较多。' });
  ok('作息飘→讲节律不齐', /忽高忽低|不容易对齐/.test(unsteady), unsteady);
  const cloud = healthMeaningOf({ id: 'cloud_x', kind: 'correlation', text: '日均心率低的那几天，心率变异性平均更高。' });
  ok('未知 id 走关键词兜底', !!cloud && /心率变异性/.test(cloud), cloud);
  const generic = healthMeaningOf({ id: 'unknown', kind: 'group_diff', text: '' });
  ok('兜底通则不写数字', !!generic && !/\d/.test(generic), generic);
}
console.log('══ E. 因果观察：午休→状态恢复（样本门槛） ══');
{
  ok('样本 <3 天不出（不编）', composeRecoveryObservations([
    { label: '中午缓一缓', days: 2, liftedDays: 2, avgLift: 9, hasRealLog: true },
  ]).length === 0);
  ok('回升比例不足不出', composeRecoveryObservations([
    { label: '中午缓一缓', days: 5, liftedDays: 2, avgLift: 9, hasRealLog: true },
  ]).length === 0);
  ok('平均回升太小不出', composeRecoveryObservations([
    { label: '中午缓一缓', days: 5, liftedDays: 5, avgLift: 0.5, hasRealLog: true },
  ]).length === 0);
  const logged = composeRecoveryObservations([
    { label: '中午缓一缓', days: 6, liftedDays: 5, avgLift: 6.2, hasRealLog: true },
  ]);
  ok('样本够且真有记录 → 出观察', logged.length === 1, JSON.stringify(logged));
  ok('措辞是「做过」', /做过/.test(logged[0]?.text ?? ''), logged[0]?.text);
  ok('带健康意义（精力恢复有效）', /精力恢复/.test(logged[0]?.meaning ?? ''), logged[0]?.meaning);
  const curveOnly = composeRecoveryObservations([
    { label: '中午缓一缓', days: 6, liftedDays: 5, avgLift: 6.2, hasRealLog: false },
  ]);
  ok('只有曲线时措辞更软（不说「做过」）', curveOnly.length === 1 && !/做过/.test(curveOnly[0].text), curveOnly[0]?.text);
  ok('最多 2 条', composeRecoveryObservations([
    { label: 'A', days: 6, liftedDays: 6, avgLift: 5, hasRealLog: true },
    { label: 'B', days: 6, liftedDays: 6, avgLift: 5, hasRealLog: true },
    { label: 'C', days: 6, liftedDays: 6, avgLift: 5, hasRealLog: true },
  ]).length === 2);
}
console.log('══ F. 月度维度统计：真机 6 枚太阳全来自睡眠 ══');
{
  const ins = composeMonthDimensionInsights({
    sunByDim: { sleep: 6 },
    coverageByDim: { sleep: 6, activity: 6 },
    totalSuns: 6, daysWithData: 6,
  });
  const byId = Object.fromEntries(ins.map((x) => [x.id, x]));
  ok('太阳来源句', /6 枚太阳，都来自睡眠恢复/.test(byId.sun_source?.text ?? ''), byId.sun_source?.text);
  ok('太阳来源带健康意义', /夜里修复|精力底子/.test(byId.sun_source?.meaning ?? ''), byId.sun_source?.meaning);
  ok('做得比较稳的 = 睡眠', /睡眠恢复/.test(byId.best_dim?.text ?? ''), byId.best_dim?.text);
  ok('还缺一点的不指责', /先记着就好/.test(byId.missing_dim?.text ?? ''), byId.missing_dim?.text);
  ok('有记录但没达标 → 讲活动量低位的健康意义',
    /活动量还在低位|循环/.test(byId.missing_dim?.meaning ?? ''), byId.missing_dim?.meaning);
  const noRecord = composeMonthDimensionInsights({
    sunByDim: { sleep: 6 }, coverageByDim: { sleep: 6 }, totalSuns: 6, daysWithData: 6,
  });
  ok('连记录都没有 → 老实说样本不够不编',
    /看不出稳定规律|等日子多一点/.test(noRecord.find(x => x.id === 'missing_dim')?.meaning ?? ''),
    noRecord.find(x => x.id === 'missing_dim')?.meaning);
  const none = composeMonthDimensionInsights({ sunByDim: {}, coverageByDim: {}, totalSuns: 0, daysWithData: 0 });
  ok('无太阳 → 不编来源', none.length === 0, JSON.stringify(none));
  const mixed = composeMonthDimensionInsights({
    sunByDim: { sleep: 4, activity: 2 }, coverageByDim: { sleep: 6, activity: 6 },
    totalSuns: 6, daysWithData: 6,
  });
  ok('多渠道 → 说占得最多', /占得最多/.test(mixed[0]?.text ?? ''), mixed[0]?.text);
  ok('多渠道 → 不错误说「都来自」', !/都来自/.test(mixed[0]?.text ?? ''));
}
console.log('══ G. 文案口径：不诊断/不评分/不居高临下 ══');
{
  const banned = /诊断|疗愈|治愈|治疗|患病|你应当|你应该|必须|我们建议|激励|打卡任务得分|认知反馈/;
  const probe = composeDimensionGroups({
    dayKey: 'x', isToday: true, stepGoal: 10000,
    cyclePhaseLabel: '黄体期', dayInCycle: 22,
    sleepScore: 100, sleepTotalMin: 515, sleepDeepMin: 180,
    steps: 12000, stateMean: 89, stateLevel: '充沛', statePointCount: 48,
    stressMean: 20, moodReports: ['平静'],
    vitals: [{ label: '血压', value: '119/84' }],
    completedTasks: [{ label: '运动打卡', count: 1 }],
  });
  const allText = flat(probe).map((c) => `${c.sub ?? ''} ${c.meaning ?? ''}`).join(' ');
  ok('维度卡文案不触犯品牌铁律', !banned.test(allText), allText);
  const meanings = [
    healthMeaningOf({ id: 'resting_hr_hrv' }),
    ...composeRecoveryObservations([{ label: '中午缓一缓', days: 5, liftedDays: 5, avgLift: 5, hasRealLog: true }]).map(x => x.meaning),
    ...composeMonthDimensionInsights({ sunByDim: { sleep: 6 }, coverageByDim: { sleep: 6, activity: 6 }, totalSuns: 6, daysWithData: 6 }).map(x => x.meaning),
  ];
  ok('所有健康意义句不触犯品牌铁律', meanings.every(m => !banned.test(m)), meanings.join(' | '));
  ok('所有健康意义句非空', meanings.every(m => typeof m === 'string' && m.length > 10));
}

console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail > 0 ? 1 : 0);
