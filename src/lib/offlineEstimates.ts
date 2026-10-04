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
    // ① 已有**足够**的真实 intraday → 已冻结，跳过（绝不覆写）。
    // ★ v18.113：只有 1 个点（旧版②的正午点）视为「未成形」——
    //   单点拟合不出昼夜节律（首页昼夜节律的皮质醇趋势要靠 14 天 cosinor 形状），
    //   属于「补齐未完成」而非「已冻结」，允许用当日 stress 逐样本补全成全天曲线。
    //   判据 ≥2 个不同半小时槽（t 相差 >30min），避免把同一时刻的抖动当成有数据。
    const existing = healthStore.getIntraday(k, dayKey);
    if (existing && existing.length > 0) {
      const ts = existing.map((p) => p.t).sort((a, b) => a - b);
      const spread = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
      if (ts.length >= 2 && spread > 30 * 60 * 1000) continue; // 已成形，冻结
    }

    // ★ v18.113 顺序调整（用户实锤「昼夜节律里皮质醇趋势没算出来」）：
    //   原来②「有 daily 值 → 只落一个正午点」排在③「用逐样本 stress 推算」之前，
    //   于是历史日 cortisol 只剩 1 个点 → 14 天窗口里 collectSamples 拿不到节律形状，
    //   analyzeCortisol 拟合不出可靠 mesor/amplitude/acrophase → 首页昼夜节律的皮质醇趋势空态。
    //   改为：**优先用当日逐样本 stress 映射**（历史日 stress 有 110~247 条，能还原真实全天形状），
    //   只有 stress 完全没有样本时才退到 daily 正午点。两分支都不复写已有 intraday（冻结契约不变）。
    // ②′ 逐样本 stress 推算（真实全天形状，优先）。
    const fromStress = deriveFromStress(key, dayKey);
    if (fromStress.length > 0) {
      healthStore.upsertBackfillSamples(k, dayKey, fromStress);
      filled++;
      continue;
    }

    // ③ 退化兜底：有真实日聚合值 → 提升为正午单点（真实测值降采样，非推算）。
    const d = healthStore.getDay(k, dayKey);
    const dailyVal = d?.last ?? d?.mean;
    if (typeof dailyVal === 'number' && dailyVal > 0) {
      const start = parseDayKey(dayKey);
      const noon = Number.isFinite(start) ? start + 12 * 3600000 : Date.now();
      healthStore.upsertBackfillSamples(k, dayKey, [{ t: noon, v: dailyVal }]);
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
