/**
 * 派生指标历史补齐（eda/sns/cortisol/emotion/skin/fatigue）。
 *
 * 设计前提：戒指协议只回传「实时」派生指标，但 offline 数据层其实已经在源头落库了——
 * RingBleManager.flushPending 对每个 HealthGlance / 实时轮询点调 upsertRealtime(hk, …)
 * 把 cortisol/eda/sns/emotion 写进 healthStore.intraday（按当天日期分桶），且 healthStore
 * 有 v2 磁盘快照持久化。所以「今天实时累积 → 跨天后即冻结历史」本就成立。
 *
 * 本模块的「补齐」只兜底「从未有任何样本的空日」，并严格遵守冻结契约（历史不可重算）：
 *   1. 该指标已有真实 intraday  → 跳过（已冻结，绝不复写）。
 *   2. 否则有真实日聚合值(daily) → 用日值提升一个正午点落库（真实测值降采样，非推算）。
 *   3. 否则才用当日 stress 线性推算并落库（推算值，诚实、冻结、不覆盖）。
 *   4. 今天恒跳过（实时数据持续覆盖）。
 * 任何一步落库后，后续调用都因「已有 intraday」而跳过 → 历史一旦算出即钉死。
 */
import type { MetricKey } from '../data/healthStore';
import { healthStore, parseDayKey } from '../data/healthStore';

/** {t: epoch ms, v: number} —— 与 RingBleManager.TimePoint 同形（避免循环依赖） */
interface TimePoint {
  t: number;
  v: number;
}

export type EstimatedMetricKey = 'eda' | 'sns' | 'cortisol' | 'emotion' | 'skin' | 'fatigue';

/** stress → 各指标映射系数（实时实测量级对照：stress 25~35 时 sns≈30、cortisol≈50~75、skin≈33~89、emotion 2~4） */
const STRESS_MAP: Record<EstimatedMetricKey, (s: number) => number> = {
  sns: (s) => Math.round(Math.min(100, Math.max(5, s + 5))),
  cortisol: (s) => Math.round(Math.min(300, Math.max(10, s * 1.6 + 20))),
  emotion: (s) => (s < 18 ? 2 : s < 32 ? 3 : 4),
  eda: (s) => Math.min(100, Math.max(1, s * 1.5 + 10)),
  skin: (s) => Math.min(100, Math.max(1, s * 1.5 + 10)),
  fatigue: (s) => Math.round(Math.min(100, Math.max(1, s * 1.2))),
};

/**
 * 对某个历史日补齐派生指标的 intraday，严格遵守「冻结契约」（见文件头）。
 * 返回本次新补齐的指标数（已存在 / 今天 / 无法补齐的日都返回 0，幂等安全）。
 */
export function estimateOfflineMetricsForDay(dayKey: string, todayKey: string): number {
  if (dayKey === todayKey) return 0;
  let filled = 0;
  for (const key of ['eda', 'sns', 'cortisol', 'emotion', 'skin', 'fatigue'] as EstimatedMetricKey[]) {
    const k = key as MetricKey;
    // ① 已有真实 intraday → 已冻结，跳过（绝不覆写）。
    const existing = healthStore.getIntraday(k, dayKey);
    if (existing && existing.length > 0) continue;

    // ② 有真实日聚合值 → 提升为正午单点（真实测值降采样，非推算）。
    const d = healthStore.getDay(k, dayKey);
    const dailyVal = d?.last ?? d?.mean;
    if (typeof dailyVal === 'number' && dailyVal > 0) {
      const start = parseDayKey(dayKey);
      const noon = Number.isFinite(start) ? start + 12 * 3600000 : Date.now();
      healthStore.upsertBackfillSamples(k, dayKey, [{ t: noon, v: dailyVal }]);
      filled++;
      continue;
    }

    // ③ 退化兜底：用当日实测 stress（真实主干）线性推算。
    const samples = deriveFromStress(key, dayKey);
    if (samples.length > 0) {
      healthStore.upsertBackfillSamples(k, dayKey, samples);
      filled++;
    }
  }
  return filled;
}

/** 用当日实测 stress（逐样本优先，日均值退化）线性映射出某派生指标的 intraday。 */
function deriveFromStress(key: EstimatedMetricKey, dayKey: string): TimePoint[] {
  let stressSamples = healthStore.getIntraday('stress', dayKey);
  if (!stressSamples || stressSamples.length === 0) {
    const dmean = healthStore.getDay('stress', dayKey)?.last ?? healthStore.getDay('stress', dayKey)?.mean;
    if (typeof dmean === 'number' && dmean > 0) {
      const start = parseDayKey(dayKey);
      const noon = Number.isFinite(start) ? start + 12 * 3600000 : Date.now();
      stressSamples = [{ t: noon, v: dmean }];
    }
  }
  if (!stressSamples || stressSamples.length === 0) return [];
  const map = STRESS_MAP[key];
  return stressSamples
    .filter((p) => Number.isFinite(p.v) && p.v > 0)
    .map((p) => ({ t: p.t, v: map(p.v) }));
}

/** 对最近 N 天（含今天，今天自动跳过）批量推算。返回推算成功的天数。 */
export function estimateOfflineMetricsRecent(nDays: number, now: number = Date.now()): number {
  const todayKey = healthStoreDayKey(now);
  let days = 0;
  for (let i = 1; i <= nDays; i++) {
    days += estimateOfflineMetricsForDay(healthStoreDayKey(now - i * 86400000), todayKey) > 0 ? 1 : 0;
  }
  return days;
}

function healthStoreDayKey(ts: number): string {
  // ★ 统一用 healthStore.dayKey 补零格式
  const { dayKey } = require('../data/healthStore');
  return dayKey(ts);
}
