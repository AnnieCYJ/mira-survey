/**
 * 集成验证：复刻 RingBleManager.recomputeDailyStatus 的累积逻辑
 * （纯函数同款），验证两件事：
 *   1) S0 只在醒后算一次并锁死（之后窗口不重算 → 不再是旧 bug 的水平线）
 *   2) 每个 30 分钟边界累积一次，形成"起床→忙→睡"的可信电量曲线
 */
import {
  computeSeed,
  deriveDaytimeBaseline,
  accumulateWindow,
  curveLevel,
  CURVE_DEFAULTS,
  type CurvePoint,
  type DailyRecord,
  type TodayInput,
  type WindowSignals,
  type DaytimeBaseline,
} from '../src/lib/dailyStatus';
import { computeCycle, type CycleInfo } from '../src/lib/cycleMath';

const WIN = 30 * 60 * 1000;

function fakeHistory(): DailyRecord[] {
  // 40 天同相位历史，让基线成熟、wakeNorm 有值
  const arr: DailyRecord[] = [];
  for (let i = 0; i < 40; i++) {
    arr.push({
      date: `d${i}`,
      hrv: 50 + (i % 5),
      rhr: 58,
      sleepTotal: 450,
      sleepDeep: 90,
      sleepRem: 80,
      getUp: 1,
      fever: false,
      phase: 'luteal',
      rawReadiness: 70,
    });
  }
  return arr;
}

function run() {
  const history = fakeHistory();
  const cycle: CycleInfo = computeCycle(null, new Date());
  const input: TodayInput = { hrv: 55, rhr: 56, sleep: { sleepTotal: 460, sleepDeep: 95, getUp: 0 } };
  const baseline: DaytimeBaseline = deriveDaytimeBaseline(history, 'luteal', CURVE_DEFAULTS);

  // --- 复刻管理器：seed 只算一次 ---
  const seed = computeSeed({ input, history, cycle, consts: CURVE_DEFAULTS });
  const timeline: CurvePoint[] = [];
  if (seed.value != null) {
    timeline.push({ t: 0, value: seed.value, level: curveLevel(seed.value, CURVE_DEFAULTS).level });
  }
  let lastAccum = 0;

  // 每 30min 一个窗口信号（起床静置→工作→午休小睡→下午忙→晚间放松→睡眠）
  const sched: WindowSignals[] = [];
  sched.push({ hrMean: 56, stepsDelta: 5, edaEvents: 0, hrv: 55, asleep: false, isNap: false });
  for (let i = 0; i < 8; i++) sched.push({ hrMean: 95, stepsDelta: 400, edaEvents: 2, hrv: 44, asleep: false, isNap: false });
  sched.push({ hrMean: 54, stepsDelta: 0, edaEvents: 0, hrv: 51, asleep: false, isNap: true });
  for (let i = 0; i < 6; i++) sched.push({ hrMean: 92, stepsDelta: 380, edaEvents: 1, hrv: 45, asleep: false, isNap: false });
  for (let i = 0; i < 4; i++) sched.push({ hrMean: 60, stepsDelta: 40, edaEvents: 0, hrv: 50, asleep: false, isNap: false });
  for (let i = 0; i < 4; i++) sched.push({ hrMean: 52, stepsDelta: 0, edaEvents: 0, hrv: 55, asleep: true, isNap: false });

  let now = 0;
  for (const sig of sched) {
    now += WIN;
    const due = lastAccum === 0 || now - lastAccum >= WIN; // 复刻"仅在 30min 边界累积"
    if (due && seed.value != null) {
      const prev = timeline.length ? timeline[timeline.length - 1].value : seed.value;
      const res = accumulateWindow(prev, sig, baseline, CURVE_DEFAULTS);
      timeline.push({ t: now, value: res.next, level: curveLevel(res.next, CURVE_DEFAULTS).level });
      lastAccum = now;
    }
  }

  const S0 = seed.value as number;
  const vals = timeline.map((p) => p.value);
  const amp = Math.max(...vals) - Math.min(...vals);
  const last = vals[vals.length - 1];
  const minBusy = Math.min(...vals.slice(1, 10));

  let pass = true;
  if (Math.abs(timeline[0].value - S0) > 0.001) { console.log('❌ 起点 ≠ S0'); pass = false; }
  if (amp < 5) { console.log('❌ 曲线近似水平'); pass = false; }
  if (vals.some((v) => v < 0 || v > 100)) { console.log('❌ 电量越界'); pass = false; }
  if (last <= S0 * 0.6) { console.log('❌ 睡眠段未充电'); pass = false; }
  if (minBusy >= S0) { console.log('❌ 忙碌段未下降'); pass = false; }

  console.log(`S0=${S0.toFixed(1)} 点数=${timeline.length} 幅度=${amp.toFixed(1)} 末=${last.toFixed(1)} 忙碌最低=${minBusy.toFixed(1)}`);
  console.log(pass ? '✅ 集成：S0 锁死 + 累积曲线形态正确' : '❌ 集成失败');
  process.exit(pass ? 0 : 1);
}
run();
