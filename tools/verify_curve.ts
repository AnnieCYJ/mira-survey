/**
 * verify_curve.ts —— v2 累积能量模型验收
 *
 * 直跑（node --experimental-strip-types tools/verify_curve.ts）：
 *   - 验证 S0 锁死 + 曲线非水平 + 充放电方向正确
 *   - 验证"久坐焦虑不回血"漏洞已修复
 *
 * 纯算法验收，不依赖 RN / 真实戒指。
 */
import {
  computeSeed,
  accumulateWindow,
  deriveDaytimeBaseline,
  CURVE_DEFAULTS,
  type DaytimeBaseline,
  type WindowSignals,
  type ComputeOpts,
} from '../src/lib/dailyStatus';
import { computeCycle } from '../src/lib/cycleMath';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name} ${extra}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// ── 基线（手动构造，隔离 v2 机制，不依赖历史）──
const dt: DaytimeBaseline = { hrRest: 58, hrvExpected: 50, stepBaseline: 600 };
const c = CURVE_DEFAULTS;

// ── 1. computeSeed 在有数据时应返回 0–100 的电量 ──
const cycle = computeCycle(null);
const seedOpts: ComputeOpts = {
  input: { hrv: 55, rhr: 58, sleep: { sleepTotal: 450, sleepDeep: 100, getUp: 1 } },
  history: [],
  cycle,
};
const seed = computeSeed(seedOpts);
check('computeSeed 返回非空电量', seed.value != null);
check('S0 落在 [0,100]', seed.value != null && seed.value >= 0 && seed.value <= 100, `S0=${seed.value?.toFixed(1)}`);
check('冷启动 wakeNorm 为 null（校准中）', seed.wakeNorm === null && seed.recoveryLabel === '校准中');

// ── 2. 模拟典型一天：醒→忙→休→忙→晚休→睡 ──
console.log('\n— 模拟一天（每 30min 一窗，S0 锁死不重算）—');
let s = seed.value ?? 65;
const S0 = s;
const timeline: { h: string; s: number; tag: string }[] = [];

function sig(hour: number, opts: Partial<WindowSignals> = {}): WindowSignals {
  const asleep = hour >= 23 || hour < 7;
  const isNap = hour >= 13 && hour < 13.5;
  return {
    hrMean: null, stepsDelta: null, edaEvents: null, hrv: null,
    asleep, isNap, ...opts,
  };
}

for (let i = 0; i < 34; i++) {
  const hour = 7 + i * 0.5;
  const hLabel = `${String(Math.floor(hour)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  let sg: WindowSignals;
  let tag = '';
  if (hour >= 23 || hour < 7) {
    sg = sig(hour, { hrMean: 52, stepsDelta: 0, edaEvents: 0, hrv: 55 });
    tag = '睡眠(强充电)';
  } else if (hour < 9) {
    sg = sig(hour, { hrMean: 54, stepsDelta: 2, edaEvents: 0, hrv: 52 });
    tag = '晨起静息';
  } else if ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) {
    sg = sig(hour, { hrMean: 80, stepsDelta: 300, edaEvents: 2, hrv: 44 });
    tag = '工作忙碌';
  } else if (hour >= 12 && hour < 13) {
    sg = sig(hour, { hrMean: 64, stepsDelta: 80, edaEvents: 1, hrv: 48 });
    tag = '午休活动';
  } else if (hour >= 13 && hour < 13.5) {
    sg = sig(hour, { hrMean: 56, stepsDelta: 0, edaEvents: 0, hrv: 51 });
    tag = '小睡';
  } else {
    sg = sig(hour, { hrMean: 60, stepsDelta: 25, edaEvents: 1, hrv: 50 });
    tag = '晚间放松';
  }
  const r = accumulateWindow(s, sg, dt, c);
  s = r.next;
  timeline.push({ h: hLabel, s: Math.round(s), tag });
}

console.log('  时间    电量  状态');
for (const p of timeline) console.log(`  ${p.h}   ${String(p.s).padStart(3)}   ${p.tag}`);

const vals = timeline.map((p) => p.s);
const min = Math.min(...vals), max = Math.max(...vals);
check('曲线非水平（有波动）', max - min > 8, `幅度=${max - min}`);
check('电量全程在 [0,100]', timeline.every((p) => p.s >= 0 && p.s <= 100));
check('睡眠段后电量回升（末点 > 入睡附近低点）', timeline[timeline.length - 1].s > timeline[18].s, `末=${timeline[timeline.length-1].s} 午后低=${timeline[18].s}`);

// ── 3. 充放电方向：同样的 prev，忙碌应比静息恢复后更低 ──
const prev = 70;
const busy = accumulateWindow(prev, sig(10, { hrMean: 80, stepsDelta: 300, edaEvents: 2, hrv: 44 }), dt, c);
const rest = accumulateWindow(prev, sig(8, { hrMean: 54, stepsDelta: 2, edaEvents: 0, hrv: 52 }), dt, c);
console.log(`\n  同起点 70：忙碌窗→${busy.next.toFixed(1)}（drain=${busy.drain.toFixed(1)}）  静息恢复窗→${rest.next.toFixed(1)}（rec=${rest.recovery.toFixed(1)}）`);
check('忙碌窗净下降', busy.next < prev);
check('静息恢复窗净上升', rest.next > prev && rest.isRecovering);

// ── 4. 🔴 修复验证：久坐但高应激 → 不得回血 ──
const sedentaryStressed = accumulateWindow(
  70,
  { hrMean: 54, stepsDelta: 0, edaEvents: 6, hrv: null, asleep: false, isNap: false },
  dt, c,
);
const sedentaryRelaxed = accumulateWindow(
  70,
  { hrMean: 54, stepsDelta: 0, edaEvents: 0, hrv: null, asleep: false, isNap: false },
  dt, c,
);
console.log(`\n  久坐焦虑(eda=6)→${sedentaryStressed.next.toFixed(1)} isRecovering=${sedentaryStressed.isRecovering} eq=${sedentaryStressed.equilibrium}`);
console.log(`  久坐放松(eda=0)→${sedentaryRelaxed.next.toFixed(1)} isRecovering=${sedentaryRelaxed.isRecovering} eq=${sedentaryRelaxed.equilibrium}`);
check('久坐焦虑 不判为恢复', sedentaryStressed.isRecovering === false);
check('久坐焦虑 电量不上升（不回血）', sedentaryStressed.next <= 70 + 0.5, `=${sedentaryStressed.next.toFixed(1)}`);
check('久坐放松 判为恢复并回血', sedentaryRelaxed.isRecovering === true && sedentaryRelaxed.next > 70);

// ── 5. 睡眠态强充电 ──
const sleeping = accumulateWindow(50, sig(0, { hrMean: 52, stepsDelta: 0, edaEvents: 0, hrv: 55 }), dt, c);
check('睡眠态强充电（next > prev）', sleeping.next > 50 && sleeping.recovery > 0, `next=${sleeping.next.toFixed(1)} rec=${sleeping.recovery.toFixed(1)}`);

console.log(`\n═════ 结果：${pass} 通过 / ${fail} 失败 ═════`);
process.exit(fail === 0 ? 0 : 1);
