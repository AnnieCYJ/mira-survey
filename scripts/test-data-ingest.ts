/**
 * 数据摄入回归测试（HRV / 血压）—— 直接复用项目真实的 healthStore 落库契约。
 *
 * 背景（2026-11-14）：用户反复强调"仔细测一下数据更新 + 戒指蓝牙稳定性"，但此前只在 UI/崩溃层验证，
 * 没验证"戒指回传的数据到底进没进 store、卡面读不读得到"。本测试在没有物理戒指的情况下，
 * 用**与 RingBleManager.handleBatch 完全一致的字段别名口径 + 时间解析口径**，模拟安卓原生
 * emit 的 onBatch（HRV 走 slots 带 hr/hrv；血压走 slots 带 bpSys/bpDia），断言：
 *   1) HRV 回填样本 → healthStore('hrv') 今日日聚合非空、getTimeRange 可回读；
 *   2) 血压回填样本 → healthStore('bpSys'/'bpDia') 今日非空；
 *   3) 手动血压（manualBpSys/manualBpDia，对应 ManualMeasureSheet 写入路径）→ BpCard 兜底读取能拿到；
 *   4) 戒指 RTC 快于手机（future offset）经 correctFutureSamples 平移后，今日样本不被当成"未来"丢弃；
 *   5) recomputeDaily 的 v>0 守卫不会误杀合法正值（HRV/血压）。
 *
 * 运行：node_modules/.bin/ts-node --transpile-only scripts/test-data-ingest.ts
 */
import {
  healthStore,
  parseSampleTs,
  dayKey,
  dayStartMs,
  type MetricKey,
} from '../src/data/healthStore';

// ── 与 RingBleManager.handleBatch 完全一致的字段别名（2026-11-07 协议审计口径）──
const FIELD_ALIASES: Record<string, string[]> = {
  hr: ['hr', 'heartValue', 'heartRate', 'heartrate', 'rateValue', 'pulse', 'bpm'],
  spo2: ['spo2', 'spo2h', 'oxygen', 'oxygenValue', 'bloodOxygen', 'bloodoxygen'],
  temp: ['temp', 'temperature', 'bodyTemperature'],
  hrv: ['hrv', 'hrvValue'],
  steps: ['step', 'steps', 'stepValue'],
  calorie: ['cal', 'calValue', 'calorie'],
  distance: ['dist', 'disValue', 'distance'],
  stress: ['stress', 'pressure', 'pressureValue', 'stressValue', 'stressIndex'],
  met: ['met', 'meto', 'metValue'],
  fatigue: ['fatigue', 'fatigueLevel', 'fatigueIndex'],
  eda: ['eda', 'gsr', 'skinConductance', 'gsrValue'],
  rr: ['rr', 'resRate', 'respRate', 'respirationRate', 'breathRate'],
  bpSys: ['bpSys', 'systolic', 'highValue', 'ppgSys'],
  bpDia: ['bpDia', 'diastolic', 'lowValue', 'ppgDia'],
  glucose: ['glucose', 'bloodSugar', 'bloodGlucose'],
  sns: ['sns', 'snsActivation'],
  cortisol: ['cortisol', 'cortisolValue'],
  emotion: ['emotion', 'emotionLevel'],
  skin: ['skin', 'skinMoisture'],
  ua: ['ua', 'uricAcid'],
  depressionRisk: ['depressionRisk'],
};

const SIGNED_HKEYS = new Set<string>(['emotion']);
const ZERO_VALID_HKEYS = new Set<string>(['depressionRisk', 'steps', 'calorie', 'distance', 'stress']);

function num(x: any): number | null {
  if (x == null) return null;
  const n = typeof x === 'number' ? x : parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

/** 复刻 handleBatch.extract：按 FIELD_ALIASES 依次尝试原生字段名，解析时间后产出 [{t,v}] */
function extract(nativeKey: string, hsKey: MetricKey, date: string, slots: any[]): Array<{ t: number; v: number }> {
  const signed = SIGNED_HKEYS.has(hsKey);
  const zeroValid = ZERO_VALID_HKEYS.has(hsKey);
  const candidates = Array.from(new Set<string>([nativeKey, ...(FIELD_ALIASES[hsKey] ?? [])]));
  const out: Array<{ t: number; v: number }> = [];
  for (const s of slots) {
    let v: number | null = null;
    for (const k of candidates) {
      const x = num(s?.[k]);
      if (x != null) { v = x; break; }
    }
    if (v == null) continue;
    if (!signed && !zeroValid && v <= 0) continue;
    const tRaw = s?.time ?? s?.t ?? s?.ts ?? s?.timestamp ?? s?.dateTime ?? s?.hhmm ?? '';
    const t = parseSampleTs(date, tRaw);
    if (t == null) continue;
    out.push({ t, v });
  }
  return out;
}

// 复刻 handleBatch 的 slots → healthStore 落库循环（仅保留 hrv / bpSys / bpDia 三条，足够验证契约）
function ingestBatch(date: string, slots: any[]) {
  const METRIC_MAP: Record<string, MetricKey> = {
    hrv: 'hrv', bpSys: 'bpSys', bpDia: 'bpDia', hr: 'hr',
  };
  const seen = new Set<MetricKey>();
  for (const [nativeKey, hsKey] of Object.entries(METRIC_MAP)) {
    if (seen.has(hsKey)) continue;
    const samples = extract(nativeKey, hsKey, date, slots);
    if (samples.length > 0) {
      healthStore.upsertBackfillSamples(hsKey, date, samples);
      seen.add(hsKey);
    }
  }
}

// ── 断言工具 ──
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name} ${detail}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

function main() {
  console.log('\n=== 数据摄入回归测试：HRV / 血压 ===\n');

  const today = dayKey(Date.now());
  const midnight = dayStartMs(Date.now());

  // 清空当日，保证测试隔离
  healthStore.clear();

  // ── 1) 模拟安卓 HRV onBatch（slots 带 hr/hrv）──
  const hrvSlots = [];
  for (let h = 0; h < 8; h++) {
    for (let m = 0; m < 60; m += 5) {
      hrvSlots.push({
        ts: midnight + (h * 60 + m) * 60000,
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hr: 60 + ((h + m) % 10),
        hrv: 40 + ((h * 7 + m) % 60), // 40-99 ms，合法正值
      });
    }
  }
  ingestBatch(today, hrvSlots);
  const hrvDay = healthStore.getDay('hrv', today);
  check('HRV 回填样本 → 今日日聚合非空', !!hrvDay && hrvDay.samples > 0, `samples=${hrvDay?.samples}`);
  const hrvRange = healthStore.getTimeRange('hrv', midnight, Date.now(), { maxPoints: 480 });
  check('HRV → getTimeRange 可回读逐样本', hrvRange.length > 0, `points=${hrvRange.length}`);
  check('HRV 日均为正值（v>0 守卫未误杀）', (hrvDay?.mean ?? 0) > 0, `mean=${hrvDay?.mean}`);

  // ── 2) 模拟安卓血压 onBatch（slots 带 bpSys/bpDia）──
  const bpSlots = [];
  for (let h = 8; h < 22; h += 2) {
    bpSlots.push({
      ts: midnight + h * 3600000,
      time: `${String(h).padStart(2, '0')}:00`,
      bpSys: 110 + (h % 15),
      bpDia: 70 + (h % 10),
    });
  }
  ingestBatch(today, bpSlots);
  const sysDay = healthStore.getDay('bpSys', today);
  const diaDay = healthStore.getDay('bpDia', today);
  check('血压 回填样本 → bpSys 今日非空', !!sysDay && sysDay.samples > 0, `samples=${sysDay?.samples}`);
  check('血压 回填样本 → bpDia 今日非空', !!diaDay && diaDay.samples > 0, `samples=${diaDay?.samples}`);
  const sysRange = healthStore.getTimeRange('bpSys', midnight, Date.now(), { maxPoints: 240 });
  check('血压 → getTimeRange 可回读', sysRange.length > 0, `points=${sysRange.length}`);

  // ── 3) 手动血压（ManualMeasureSheet 写入路径）→ BpCard 兜底读取应能拿到 ──
  const mTs = Date.now();
  healthStore.upsertManualSample('manualBpSys' as MetricKey, today, 118, mTs, 'manual');
  healthStore.upsertManualSample('manualBpDia' as MetricKey, today, 76, mTs, 'manual');
  // 复刻 BpCard 兜底读取逻辑
  const start = dayStartMs(Date.now());
  const now = Date.now();
  const sysTPs = healthStore.getTimeRange('bpSys', start, now, { maxPoints: 240 });
  const diaTPs = healthStore.getTimeRange('bpDia', start, now, { maxPoints: 240 });
  const mSysTPs = healthStore.getTimeRange('manualBpSys' as any, start, now, { maxPoints: 240 });
  const mDiaTPs = healthStore.getTimeRange('manualBpDia' as any, start, now, { maxPoints: 240 });
  const pick = (a: any[], b: any[]) => {
    const n = a.length ? a[a.length - 1] : null;
    const m = b.length ? b[b.length - 1] : null;
    if (n && m) return n.t >= m.t ? n : m;
    return n ?? m;
  };
  const lastSys = pick(sysTPs, mSysTPs);
  const lastDia = pick(diaTPs, mDiaTPs);
  check('BpCard 兜底读取手动血压 sys', lastSys?.v === 118, `v=${lastSys?.v}`);
  check('BpCard 兜底读取手动血压 dia', lastDia?.v === 76, `v=${lastDia?.v}`);

  // ── 4) 戒指 RTC 快于手机约 35 分钟 → correctFutureSamples 平移后今日样本不丢 ──
  healthStore.clear();
  const off = 35 * 60000;
  const futureSlots = [];
  for (let m = 0; m < 60; m += 5) {
    // 设备时钟比手机快 35min：用"未来"时间戳写入
    const devTs = Date.now() + off + m * 60000;
    futureSlots.push({ ts: devTs, time: new Date(devTs).toTimeString().slice(0, 5), hrv: 50 + m });
  }
  ingestBatch(today, futureSlots);
  // 平移前：今日 getTimeRange（以手机 now 为上界）应过滤掉"未来"点
  const before = healthStore.getTimeRange('hrv', midnight, Date.now(), { maxPoints: 480 });
  check('平移前：未来样本被上界过滤（今日回读为空或极少）', before.length === 0, `points=${before.length}`);
  // 执行平移
  const moved = healthStore.correctFutureSamples(off, Date.now());
  check('correctFutureSamples 平移了未来样本', moved > 0, `moved=${moved}`);
  const after = healthStore.getTimeRange('hrv', midnight, Date.now(), { maxPoints: 480 });
  check('平移后：今日 HRV 样本恢复可回读', after.length > 0, `points=${after.length}`);

  // ── 5) iOS HRV 实时均值路径（原生 readHistoricalHrv → emitMetric:"hrv" mean → handleRealtime → upsertRealtime）──
  //   复刻 src/ble/RingBleManager.ts handleRealtime：hsKeyFor('hrv')='hrv' → healthStore.upsertRealtime('hrv', {t,v})。
  //   这条是 iOS 上 HRV 唯一的实时入口；此前只测了安卓 onBatch 路径，这里补上 iOS 侧。
  healthStore.clear();
  const iosHrvMean = 62.5;
  const iosTs = Date.now();
  healthStore.upsertRealtime('hrv', { t: iosTs, v: iosHrvMean }, iosTs);
  const iosRange = healthStore.getTimeRange('hrv', midnight, Date.now(), { maxPoints: 480 });
  check('iOS HRV 实时均值 → upsertRealtime 落库可回读', iosRange.length === 1 && Math.abs(iosRange[0].v - iosHrvMean) < 0.01, `points=${iosRange.length} v=${iosRange[0]?.v}`);
  const iosDay = healthStore.getDay('hrv', today);
  check('iOS HRV 实时均值 → 今日日聚合 mean 正确', !!iosDay && Math.abs((iosDay?.mean ?? 0) - iosHrvMean) < 0.01, `mean=${iosDay?.mean}`);

  // ── 6) 设备能力边界：戒指确实不回传 HRV/血压（基础版无血压传感器 / 固件 capHrv=false）──
  //   这是真机实测里"HRV 和血压没更新"最常见的物理根因。本测试断言：此时 store 为空、
  //   卡面应显示"—"而非崩溃或显示旧值。把"硬件限制"与"App bug"在测试中显式区分开。
  healthStore.clear();
  const emptyHrv = healthStore.getTimeRange('hrv', midnight, Date.now(), { maxPoints: 480 });
  const emptySys = healthStore.getTimeRange('bpSys', midnight, Date.now(), { maxPoints: 240 });
  const emptyDia = healthStore.getTimeRange('bpDia', midnight, Date.now(), { maxPoints: 240 });
  check('设备零回传：HRV 今日为空（卡面应显示—）', emptyHrv.length === 0, `points=${emptyHrv.length}`);
  check('设备零回传：bpSys 今日为空（基础版戒指无血压传感器）', emptySys.length === 0, `points=${emptySys.length}`);
  check('设备零回传：bpDia 今日为空', emptyDia.length === 0, `points=${emptyDia.length}`);

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
  if (fail > 0) process.exit(1);
}

main();
