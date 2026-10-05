/**
 * cognitiveReadiness.ts —— 认知准备度（全天趋势 / 区间聚合）
 *
 * 定位（对齐 2026-10-05 认知锚定重建）：**准备度**，不是疲劳。
 *  - 语义：晨起高、傍晚低（用户明确要求）。分数 = 「此刻还剩多少脑力可用」。
 *  - 与 `computeMorningReadiness` 同源同口径：base=40+60·rec、睡眠债 −5/h、节律相位 ±8。
 *  - 与「认知疲劳度」的关键差别：疲劳是**累积量**（越用越低，单调下降）；
 *    准备度是**状态量**（清醒着就在回血，平稳的一天应是一条平缓的波浪）。
 *
 * 判定输入全部真实：HRV 相对个人基线的偏离、SNS（交感唤醒）、睡眠恢复、7 天睡眠债、
 * 个体化皮质醇峰值时刻（acrophase）。任一项缺失 → `hasData=false`，UI 显「—」，
 * 绝不插值或拿演示数据顶替。
 */
import { computeCognitiveLoadReport, type CognitiveLoadReport } from './cognitiveLoad';

/** 准备度分档（★ 与疲劳档位方向相反：分数高 = 状态好） */
export type ReadinessLevel = 'high' | 'mid' | 'low';
/** 分档阈值（对齐 App 内 cogLevel 的 40 / 70 一档，方便复用同一套视觉语言） */
export const READY_HIGH = 70;
export const READY_LOW = 40;

export function readinessLevel(v: number | null | undefined): ReadinessLevel {
  if (v == null || !Number.isFinite(v)) return 'low';
  return v >= READY_HIGH ? 'high' : v >= READY_LOW ? 'mid' : 'low';
}
export function readinessLevelLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= READY_HIGH ? '状态充足' : v >= READY_LOW ? '状态中等' : '需要休息';
}

/** 单点（全天曲线上的一个小时） */
export interface ReadinessPoint {
  /** 钟点 0–23 */
  hour: number;
  /** 准备度 0–100；hasData=false 时为 0（仅占位，不可解读） */
  score: number;
  hasData: boolean;
}

export interface ReadinessSeries {
  /** 24 个整点（0–23） */
  points: ReadinessPoint[];
  /** 全天均值（仅统计有数据小时）；无数据 → null */
  avg: number | null;
  /** 当前时刻的准备度；无数据 → null */
  now: number | null;
  /** 晨起准备度（起床后 1h 内均值）；无数据 → null */
  morning: number | null;
  /** 夜间/睡前最低段均值（20–23 点 + 0–6 点）；无数据 → null */
  nightLow: number | null;
  /** 最高点所在钟点；无数据 → null */
  peakHour: number | null;
  /** 最低点所在钟点；无数据 → null */
  troughHour: number | null;
  /** 起床时刻（小时，浮点）；用于标注晨起段 */
  wakeHour: number | null;
  /** 睡眠恢复因子 0–1（无昨晚睡眠 → null） */
  sleepRec: number | null;
}

/** 24 点的节律权重：晨高晚低的钟点形态（0–23 → 0.62–1.0）。
 *  峰约在 09–10，谷约在 21–22。用于在没有该小时实测值时给出「节律预期」，
 *  但**只有在有数据的小时才叠加**，不用于凭空造点。 */
const CIRCADIAN_BY_HOUR: number[] = [
  0.72, 0.66, 0.63, 0.62, 0.63, 0.68, 0.76, 0.86, 0.94, 1.00,
  0.99, 0.96, 0.92, 0.90, 0.89, 0.88, 0.87, 0.86, 0.83, 0.80,
  0.75, 0.70, 0.70, 0.71,
];

/**
 * 逐小时准备度 —— 与 `CognitiveLoadReport.hourlyInstant` **同源**（同一小时是否有戒指采样），
 * 保证与首页/详情页曲线一一对齐，不会出现「柱子有值、线没值」。
 *
 * 公式（对 hourlyInstant 的状态量做「反向映射 + 节律塑形」）：
 *   readiness = clamp( 100 − fatigueInstant + 节律偏移 )
 * 其中节律偏移 = (CIRCADIAN[hour] − 1) × 24，使晨间自然抬升、傍晚自然回落。
 * 睡眠恢复与睡眠债已包含在 hourlyInstant 的 arousalDrive 里，此处不重复扣分。
 */
export function computeReadinessSeries(report?: CognitiveLoadReport, nowMs: number = Date.now()): ReadinessSeries {
  const rep = report ?? computeCognitiveLoadReport(nowMs);
  const instant = rep.hourlyInstant ?? [];

  // 睡眠恢复因子（无昨晚睡眠 → null，UI 诚实显「—」）
  const rec = rep.sleepRecovery ?? null;

  const points: ReadinessPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const raw = instant[h];
    const has = !!raw?.hasData;
    if (!has) {
      points.push({ hour: h, score: 0, hasData: false });
      continue;
    }
    const shape = (CIRCADIAN_BY_HOUR[h] - 1) * 24;      // 晨 +~0 … 晚 −~7
    const score = Math.max(0, Math.min(100, Math.round(100 - raw.score + shape)));
    points.push({ hour: h, score, hasData: true });
  }

  const valid = points.filter((p) => p.hasData);
  const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b.score, 0) / valid.length) : null;

  // 当前时刻：优先用 nowMs 所在小时；该小时无数据则退回最近的有数据小时
  const curHour = new Date(nowMs).getHours();
  let now: number | null = points[curHour]?.hasData ? points[curHour].score : null;
  if (now == null) {
    for (let d = 1; d <= 6 && now == null; d++) {
      const cand = points[(curHour - d + 24) % 24];
      if (cand?.hasData) now = cand.score;
    }
  }

  // 晨起段：起床后 1 小时（起床时刻未知时用 07–09 点近似）
  const wakeHour = rep.sleepWindow?.wakeHour ?? null;
  const mStart = wakeHour != null ? Math.round(wakeHour) : 7;
  const morningVals = [0, 1, 2].map((k) => points[(mStart + k) % 24]).filter((p) => p?.hasData).map((p) => p.score);

  // 夜间低谷段：20–23 + 0–6 点
  const nightHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
  const nightVals = nightHours.map((h) => points[h]).filter((p) => p?.hasData).map((p) => p.score);

  const peak = valid.length ? valid.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const trough = valid.length ? valid.reduce((a, b) => (b.score < a.score ? b : a)) : null;

  return {
    points,
    avg,
    now,
    morning: morningVals.length ? Math.round(morningVals.reduce((a, b) => a + b, 0) / morningVals.length) : null,
    nightLow: nightVals.length ? Math.round(nightVals.reduce((a, b) => a + b, 0) / nightVals.length) : null,
    peakHour: peak?.hour ?? null,
    troughHour: trough?.hour ?? null,
    wakeHour,
    sleepRec: rec,
  };
}

/**
 * 区间聚合（周 / 月 / 年）—— 对每天的「全天均值」再取平均。
 * 返回按时间升序的日序列 + 区间均值，供详情页画区间趋势。
 */
export interface ReadinessRangePoint {
  /** 日键 YYYY-MM-DD */
  key: string;
  /** 短标签（周/月视图用日号；年视图用月号） */
  label: string;
  /** 当天有数据小时的准备度均值；null = 当天无数据 */
  value: number | null;
}

export function aggregateReadinessByDay(
  days: { key: string; date: Date }[],
  loadOf: (key: string) => CognitiveLoadReport | null,
): ReadinessRangePoint[] {
  return days.map(({ key, date }) => {
    const rep = loadOf(key);
    const avg = rep ? computeReadinessSeries(rep, date.getTime()).avg : null;
    return { key, label: String(date.getDate()), value: avg };
  });
}
