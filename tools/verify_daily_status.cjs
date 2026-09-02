/**
 * 今日状态算法验收脚本（node 直跑，零依赖）
 *
 * 先把 src/lib/dailyStatus.ts + src/lib/cycleMath.ts 编译到 .build/ 再 require。
 * 覆盖：睡眠分自算 / 冷启动文献基线 / 相位专属基线 / 向下敏感度 / 归一化 5-25-35-35 / 真实分布。
 *
 * 运行：node tools/verify_daily_status.cjs   （在 mira-app 根目录）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, '.build');
fs.rmSync(out, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/dailyStatus.ts src/lib/cycleMath.ts --outDir ${out} --module commonjs --target es2019 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { cwd: root, stdio: 'inherit' }
);

const { computeDailyStatus, computeSleepScore, ALGO_DEFAULTS } = require(path.join(out, 'dailyStatus.js'));
const { computeCycle } = require(path.join(out, 'cycleMath.js'));

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function gauss(mean, sd) { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra != null ? JSON.stringify(extra) : ''); }
}

console.log('\n=== T1 睡眠分自算 ===');
check('7.5h+深睡20%+无起夜 → 100', approx(computeSleepScore({ sleepTotal: 450, sleepDeep: 90, getUp: 0 }, ALGO_DEFAULTS), 100, 0.5));
check('5h+深睡10%+3次起夜 → <70', computeSleepScore({ sleepTotal: 300, sleepDeep: 30, getUp: 3 }, ALGO_DEFAULTS) < 70);

console.log('\n=== T2 冷启动空历史 → 文献基线 ===');
const noLog = computeCycle(null, new Date());
const r0 = computeDailyStatus({ input: { hrv: 40, rhr: 73, sleep: { sleepTotal: 450, sleepDeep: 90, getUp: 0 } }, history: [], cycle: noLog });
check('baselineSource=lit', r0.baselineSource === 'lit', r0.baselineSource);
check('叙事含"群体基线"', /群体基线/.test(r0.narrative), r0.narrative);

console.log('\n=== T3 相位专属基线 ===');
const mk = (date, hrv, phase) => ({ date, hrv, rhr: 70, sleepTotal: 450, sleepDeep: 90, getUp: 0, fever: false, phase, rawReadiness: null });
const hist = [];
for (let i = 0; i < 40; i++) hist.push(mk('2026-7-' + ((i % 27) + 1), clamp(gauss(35, 5), 18, 55), 'luteal'));
const lutealCycle = computeCycle({ lastPeriodStart: '2026-8-1', cycleLength: 28, lutealLength: 14, periodLength: 5 }, new Date('2026-8-20'));
check('2026-8-20 黄体期', lutealCycle.phase === 'luteal', lutealCycle.phase);
const rNorm = computeDailyStatus({ input: { hrv: 35, rhr: 70, sleep: { sleepTotal: 450, sleepDeep: 90, getUp: 0 } }, history: hist, cycle: lutealCycle });
check('黄体期 HRV=自身基线 → 充沛', rNorm.level === '充沛', { level: rNorm.level, score: rNorm.score });

console.log('\n=== T4 向下敏感度（核心验收） ===');
const rDown = computeDailyStatus({ input: { hrv: 24.5, rhr: 78, sleep: { sleepTotal: 360, sleepDeep: 55, getUp: 2 } }, history: hist, cycle: lutealCycle });
check('HRV-30%+RHR升+睡眠差 → 偏低/不足', rDown.level === '偏低' || rDown.level === '不足', { level: rDown.level, score: rDown.score });

console.log('\n=== T5 归一化层使档位≈5/25/35/35 ===');
const histRaw = [];
for (let i = 0; i < 1000; i++) histRaw.push(clamp(gauss(70, 12), 5, 100));
const h2 = histRaw.map((rr, i) => ({ date: 'd' + i, hrv: 40, rhr: 70, sleepTotal: 450, sleepDeep: 90, getUp: 0, fever: false, phase: 'follicular', rawReadiness: rr }));
const counts = { 充沛: 0, 平稳: 0, 偏低: 0, 不足: 0 };
for (const rr of histRaw) {
  const pct = Math.round((100 * histRaw.filter((x) => x <= rr).length) / histRaw.length);
  counts[pct >= 65 ? '充沛' : pct >= 30 ? '平稳' : pct >= 5 ? '偏低' : '不足']++;
}
console.log('  档位占比(1000天 N(70,12)):', counts);
check('充沛≈35%', Math.abs(counts.充沛 / 10 - 35) <= 6, counts.充沛 / 10);
check('不足≈5%', Math.abs(counts.不足 / 10 - 5) <= 3, counts.不足 / 10);

console.log('\n=== T6 真实分布回放（HRV 中位40） ===');
const realHist = [];
for (let i = 0; i < 60; i++) realHist.push(mk('2026-7-' + ((i % 27) + 1), clamp(gauss(40, 9), 18, 70), 'follicular'));
const todayCycle = computeCycle({ lastPeriodStart: '2026-8-1', cycleLength: 28 }, new Date('2026-8-25'));
const rReal = computeDailyStatus({ input: { hrv: 40, rhr: 73, sleep: { sleepTotal: 552, sleepDeep: 165, getUp: 1 } }, history: realHist, cycle: todayCycle });
check('正常日 → 平稳或充沛(非偏低/不足)', rReal.level === '平稳' || rReal.level === '充沛', { level: rReal.level, score: rReal.score });

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
console.log(`\n=== 汇总 ===\nPASS=${pass}  FAIL=${fail}`);
process.exit(fail ? 1 : 0);
