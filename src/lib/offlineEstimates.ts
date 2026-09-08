/**
 * 离线指标推算：皮电(eda)/交感(sns)/皮质醇(cortisol)/情绪(emotion)/皮肤含水量(skin)/疲劳(fatigue)
 * 这些指标协议无历史存储 API（仅实时测量），但戒指离线存有实测 stress（origData 压力值）。
 * 用 stress 作主干代理做线性映射（系数来自实时 HealthGlance/GSR 实测值的量级对照），
 * 只用于「无真实样本的历史日」补曲线——诚实标注为推算，不与实时实测混写。
 */
import type { MetricKey } from '../data/healthStore';
import { healthStore } from '../data/healthStore';

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
 * 对某个历史日：若目标指标该日无任何真实样本，用当日实测 stress 样本推算并落库。
 * 跳过今天（实时数据会覆盖）；stress 本身没有样本的日无法推算。
 */
export function estimateOfflineMetricsForDay(dayKey: string, todayKey: string): number {
  if (dayKey === todayKey) return 0;
  const stressArr = healthStore.getIntraday('stress', dayKey);
  if (!stressArr || stressArr.length === 0) return 0;
  let filled = 0;
  for (const key of ['eda', 'sns', 'cortisol', 'emotion', 'skin', 'fatigue'] as EstimatedMetricKey[]) {
    const existing = healthStore.getIntraday(key as MetricKey, dayKey);
    if (existing && existing.length > 0) continue; // 有真实样本不覆盖
    const map = STRESS_MAP[key];
    const samples: TimePoint[] = stressArr
      .filter((p) => Number.isFinite(p.v) && p.v > 0)
      .map((p) => ({ t: p.t, v: map(p.v) }));
    if (samples.length > 0) {
      healthStore.upsertBackfillSamples(key as MetricKey, dayKey, samples);
      filled++;
    }
  }
  return filled;
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
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
