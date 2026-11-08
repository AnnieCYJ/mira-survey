/**
 * nightPhysiology —— 从「逐样本」按真实睡眠窗口算夜间生理三指标
 *
 * ★ 2026-11-07（用户）：睡眠详情页的「静息心率 / 夜间 HRV / 夜间血氧」长期显示「—」。
 *   根因不是戒指没传，而是 SleepDetailScreen 读的是 `ring.hrDaily/hrvDaily/spo2Daily`
 *   ——那三个是**全天日均归档**，且 onBatch.dayData 里根本没有 hr 字段，几乎恒为空。
 *   真机日志实证：同一天 healthStore 里 hrv 有 80–96 个逐样本点、hr 有 23–40 个点，
 *   数据一直在，只是没被按夜间窗口取出来用。
 *
 * 数据纪律：
 *   - 只统计**落在真实睡眠窗口内**的样本，缺口留空（null），不插值、不拿全天值冒充夜间值；
 *   - 拿不到窗口时明确回落到「全天日均」并在 source 标注，调用方可如实告知用户；
 *   - 静息心率用窗口内 HR 的最低 25% 均值（夜间静息近似），不是全天均值。
 */
import { healthStore, dayKey, type MetricKey } from '../data/healthStore';

export type NightPhysSource = 'night' | 'daily' | 'none';

export interface NightPhysResult {
  hr: number | null;
  hrv: number | null;
  spo2: number | null;
  /** 窗口内各指标实际参与计算的样本数，用于如实展示「几个点算出来的」 */
  counts: { hr: number; hrv: number; spo2: number };
  /** night=窗口内逐样本 / daily=全天日均兜底 / none=完全没有数据 */
  source: NightPhysSource;
  /** 人类可读来源说明，供 UI 直接展示 */
  sourceNote: string;
}

type TimePoint = { t: number; v: number };

/** "HH:mm" / "HH:mm:ss" → 当天 0 点起的分钟数；解析失败返回 null */
function clockToMinutes(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function dayStartMs(dk: string): number | null {
  const t = new Date(dk + 'T00:00:00').getTime();
  return Number.isFinite(t) ? t : null;
}

/** 以 dk 为基准做 ±N 天的 dateKey（不依赖 dateUtils，避免跨模块时区差异） */
function shiftDay(dk: string, delta: number): string {
  const d = new Date(dk + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return dayKey(d.getTime());
}

/**
 * 解析睡眠窗口 [startMs, endMs]。
 * 以「起床时刻」为锚、总睡眠分钟数往回推 —— 这样跨午夜（23:20 睡 → 10:35 起）
 * 自动落在正确的绝对时间轴上，不依赖 sleepTime 的格式或 sleepDayKey 的归属语义。
 */
export function sleepWindowMs(
  dk: string,
  sleepTime: string | null | undefined,
  wakeTime: string | null | undefined,
  totalMin: number | null | undefined,
): { start: number; end: number } | null {
  const base = dayStartMs(dk);
  if (base == null) return null;
  const wakeMin = clockToMinutes(wakeTime);
  const sleepMin = clockToMinutes(sleepTime);
  const MIN = 60_000;

  if (wakeMin != null && totalMin != null && totalMin > 0) {
    const end = base + wakeMin * MIN;
    return { start: end - totalMin * MIN, end };
  }
  // 无总时长：用入睡→起床时长；跨午夜则把入睡挪到前一天
  if (wakeMin != null && sleepMin != null) {
    let start = base + sleepMin * MIN;
    const end = base + wakeMin * MIN;
    if (start >= end) start -= 24 * 60 * MIN;
    return { start, end };
  }
  // 只有入睡时刻：给一个 8 小时的估计窗口（仅用于「取样本」，绝不写入任何指标值）
  if (sleepMin != null) {
    const start = base + sleepMin * MIN;
    return { start, end: start + 8 * 60 * MIN };
  }
  return null;
}

/** 收集 [dk-1, dk, dk+1] 三天的逐样本并按绝对时间窗过滤（跨午夜覆盖） */
function samplesInWindow(key: MetricKey, dk: string, win: { start: number; end: number }): TimePoint[] {
  const out: TimePoint[] = [];
  for (const delta of [-1, 0, 1]) {
    const k = shiftDay(dk, delta);
    const arr = healthStore.getIntraday(key as any, k) ?? [];
    for (const p of arr) {
      if (p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= win.start && p.t <= win.end) {
        out.push(p);
      }
    }
  }
  // 去重（不同日归档里理论上不会有同一时间戳，保险起见）
  out.sort((a, b) => a.t - b.t);
  return out.filter((p, i) => i === 0 || p.t !== out[i - 1].t);
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number.isFinite(s) ? Math.round(s * 10) / 10 : null;
}

/** 静息心率近似：夜间 HR 最低 25% 的均值（至少 1 个点） */
function restingHr(pts: TimePoint[]): number | null {
  if (pts.length === 0) return null;
  const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
  const n = Math.max(1, Math.ceil(sorted.length * 0.25));
  return mean(sorted.slice(0, n));
}

function dailyMean(key: MetricKey, dk: string): number | null {
  try {
    const rec = (healthStore as any).getDay?.(key, dk);
    const v = rec?.mean;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 主入口：算出该睡眠日的夜间生理三指标。
 * @param fallback 调用方已有的全天归档（ring.hrDaily/hrvDaily/spo2Daily），仅在完全无逐样本时使用
 */
export function computeNightPhys(
  dk: string,
  opts: {
    sleepTime?: string | null;
    wakeTime?: string | null;
    totalMin?: number | null;
    fallback?: { hr?: number | null; hrv?: number | null; spo2?: number | null };
  },
): NightPhysResult {
  const { sleepTime, wakeTime, totalMin, fallback } = opts;
  const win = sleepWindowMs(dk, sleepTime, wakeTime, totalMin);

  const hrPts = win ? samplesInWindow('hr', dk, win) : [];
  const hrvPts = win ? samplesInWindow('hrv', dk, win) : [];
  const spo2Pts = win ? samplesInWindow('spo2', dk, win) : [];

  const counts = { hr: hrPts.length, hrv: hrvPts.length, spo2: spo2Pts.length };
  const fromNight = {
    hr: restingHr(hrPts),
    hrv: mean(hrvPts.map((p) => p.v)),
    spo2: mean(spo2Pts.map((p) => p.v)),
  };

  if (counts.hr + counts.hrv + counts.spo2 > 0) {
    // 窗口内有样本 → 逐项补：该指标没有夜间样本时才退到日均/归档，并如实标注
    const fromDaily = {
      hr: dailyMean('hr', dk),
      hrv: dailyMean('hrv', dk),
      spo2: dailyMean('spo2', dk),
    };
    const merged = {
      hr: fromNight.hr ?? fromDaily.hr ?? fallback?.hr ?? null,
      hrv: fromNight.hrv ?? fromDaily.hrv ?? fallback?.hrv ?? null,
      spo2: fromNight.spo2 ?? fromDaily.spo2 ?? fallback?.spo2 ?? null,
    };
    const usedDaily = (merged.hr != null && fromNight.hr == null)
      || (merged.hrv != null && fromNight.hrv == null)
      || (merged.spo2 != null && fromNight.spo2 == null);
    return {
      ...merged,
      counts,
      source: usedDaily ? 'daily' : 'night',
      sourceNote: usedDaily
        ? `夜间逐样本 HR ${counts.hr} / HRV ${counts.hrv} / 血氧 ${counts.spo2} 个点；缺的部分用当天日均值补齐`
        : `按睡眠窗口内逐样本计算（HR ${counts.hr} / HRV ${counts.hrv} / 血氧 ${counts.spo2} 个点）`,
    };
  }

  // 窗口内完全无样本 → 明确降级到全天日均/旧归档，不冒充夜间值
  const daily = {
    hr: dailyMean('hr', dk) ?? fallback?.hr ?? null,
    hrv: dailyMean('hrv', dk) ?? fallback?.hrv ?? null,
    spo2: dailyMean('spo2', dk) ?? fallback?.spo2 ?? null,
  };
  const any = daily.hr != null || daily.hrv != null || daily.spo2 != null;
  return {
    ...daily,
    counts,
    source: any ? 'daily' : 'none',
    sourceNote: any
      ? '戒指未回传该夜的逐样本，当前展示的是全天日均值'
      : '戒指未回传该夜的生理数据',
  };
}
