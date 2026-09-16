/**
 * 睡眠负载（Sleep Load，0–100，**越高越"欠账"**）——纯函数、零依赖。
 *
 * 参考成熟算法（不照抄，取其公认维度）：
 *  · **WHOOP**：Sleep Need = 基线(7–9h，个性化) + 应变 + **睡眠债（近 14 天累计缺口）** − 小睡；
 *    Sleep Performance = 实际 / 需求；官方口径「债 > 5h 明显拖累恢复」。
 *  · **Apple Watch（watchOS 26，权重公开）**：Duration ≤50 + **就寝一致性 ≤30（近 13 晚）** + 中断 ≤20。
 *  · **Oura**：Total Sleep / Efficiency / Restfulness / REM / Deep / Latency / **Timing（昼夜对齐）**。
 *  · **Fitbit**：Duration ≤50 + 深睡&REM 质量 ≤25 + Restoration ≤25。
 *  · **Garmin(Firstbeat)**：Duration（相对个性化目标）+ Quality（阶段/清醒/躁动）+ Restoration。
 *  · 学术：Sleep Regularity Index / social jetlag —— 就寝时刻的周内漂移。
 *
 * 四个「缺口」加权为 0–100 负载：
 *   ① 时长缺口（累计）W 0.35 —— 相对**个人睡眠需求**（近 14 天中位，夹在 7~8.5h；
 *      WHOOP 基线均值 7.6h），近 14 天逐日 `max(0, need − 实际)` 按 0.9 衰减累计；
 *      5h 折算满分（WHOOP：债 >5h 明显拖累恢复）。
 *   ② 时机负载        W 0.30 —— **晚睡**（相对 23:00，越晚越高，凌晨 1:00 起取 1）
 *      + **就寝不规律**（近 7 晚就寝时刻标准差 → social jetlag，1.5h 取 1）。0.6/0.4 混合。
 *   ③ 碎片化负载      W 0.20 —— 起夜次数（3 次取 1）+ 夜间清醒占比（15% 取 1，WHOOP 口径）。
 *   ④ 结构负载        W 0.15 —— 深睡% 偏离 WHOOP 目标带 13–23%、REM% 偏离 20–25%。
 *
 * ★ 某维缺数据（如没有入睡时刻）时该项剔除、其余权重**重新归一**，不会因「缺数据」被扣分。
 */
import { bedtimeHour } from './sleepTime';

export interface SleepLoadDay {
  /** 总睡眠分钟 */
  total: number;
  /** 深睡分钟 */
  deep: number;
  /** REM 分钟 */
  rem: number;
  /** 夜间清醒分钟（可选） */
  awake?: number | null;
  /** 起夜次数 */
  getUp: number;
  /** 入睡时刻 "HH:mm"（可选） */
  sleepTime?: string | null;
}

export type SleepLoadLevel = 'low' | 'moderate' | 'high' | 'severe';

export interface SleepLoadResult {
  /** 0–100，越高越"欠账" */
  load: number;
  /** 累计时长缺口（小时，已按 0.9 衰减） */
  debtH: number;
  level: SleepLoadLevel;
  /** 各维 0–1 负载（便于 UI 归因） */
  parts: {
    duration: number | null;
    timing: number | null;
    fragmentation: number | null;
    architecture: number | null;
  };
}

const W = { duration: 0.35, timing: 0.3, fragmentation: 0.2, architecture: 0.15 };

/** 个人睡眠需求（小时）：近 14 天中位，夹在 7~8.5h（WHOOP 基线均值约 7.6h） */
const NEED_MIN_H = 7;
const NEED_MAX_H = 8.5;
const NEED_FALLBACK_H = 7.6;
/** 累计缺口 5h = 满分负载（WHOOP：>5h 明显拖累恢复） */
const DEBT_FULL_H = 5;
/** 缺口衰减：越久远权重越低（偿还睡眠债需连续几天） */
const DEBT_DECAY = 0.9;
/** 晚睡：23:00 前为 0；凌晨 1:00 起为 1 */
const BED_GOOD_HOUR = 23;
const BED_BAD_HOUR = 25;
/** 就寝不规律：近 7 晚标准差 1.5h = 满分（social jetlag） */
const BED_SD_FULL_H = 1.5;
/** 起夜 3 次 = 满分 */
const GETUP_FULL = 3;
/** 清醒占比 15% = 满分（WHOOP：>15% 拖累效率） */
const AWAKE_RATIO_FULL = 0.15;
/** 阶段目标带（WHOOP）：深睡 13–23% / REM 20–25% */
const DEEP_BAND = [13, 23] as const;
const REM_BAND = [20, 25] as const;

const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

/** 偏离目标带的程度 → 0–1（带内为 0；低于下界 / 高于上界线性上升） */
function bandDeviation(pct: number, band: readonly [number, number]): number {
  const [lo, hi] = band;
  if (pct < lo) return clamp((lo - pct) / Math.max(1, lo));
  if (pct > hi) return clamp((pct - hi) / Math.max(1, hi - lo + 7));
  return 0;
}

/**
 * @param records 该日及此前若干天的睡眠，**时间升序**（最后一项 = 目标日）。建议传近 14 天。
 */
export function computeSleepLoad(records: SleepLoadDay[]): SleepLoadResult {
  const valid = records.filter((r) => r && r.total > 0);
  const target = valid.length ? valid[valid.length - 1] : null;

  // ── ① 时长缺口（累计、带衰减）──
  let durationLoad: number | null = null;
  let debtH = 0;
  if (valid.length) {
    const needH = clamp(
      (median(valid.map((r) => r.total / 60)) ?? NEED_FALLBACK_H),
      NEED_MIN_H,
      NEED_MAX_H
    );
    for (let i = 0; i < valid.length; i++) {
      const r = valid[valid.length - 1 - i]; // i=0 为最新
      const gap = Math.max(0, needH - r.total / 60);
      debtH += gap * DEBT_DECAY ** i;
    }
    durationLoad = clamp(debtH / DEBT_FULL_H);
  }

  // ── ② 时机：晚睡 + 就寝不规律 ──
  let timingLoad: number | null = null;
  const beds = valid.map((r) => bedtimeHour(r.sleepTime)).filter((v): v is number => v != null);
  if (beds.length) {
    const latestBed = beds[beds.length - 1];
    const lateLoad = clamp((latestBed - BED_GOOD_HOUR) / (BED_BAD_HOUR - BED_GOOD_HOUR));
    const recent = beds.slice(-7);
    const sd = stddev(recent);
    const irregularLoad = sd == null ? 0 : clamp(sd / BED_SD_FULL_H);
    timingLoad = clamp(0.6 * lateLoad + 0.4 * irregularLoad);
  }

  // ── ③ 碎片化：起夜 + 夜间清醒占比 ──
  let fragLoad: number | null = null;
  if (target) {
    const getUpLoad = clamp((target.getUp ?? 0) / GETUP_FULL);
    const awakeRatio = (target.awake ?? 0) / target.total;
    const awakeLoad = clamp(awakeRatio / AWAKE_RATIO_FULL);
    fragLoad = Math.max(getUpLoad, awakeLoad);
  }

  // ── ④ 结构：深睡 / REM 偏离目标带 ──
  let archLoad: number | null = null;
  if (target) {
    const deepPct = (target.deep / target.total) * 100;
    const remPct = target.rem > 0 ? (target.rem / target.total) * 100 : null;
    const devs = [bandDeviation(deepPct, DEEP_BAND)];
    if (remPct != null) devs.push(bandDeviation(remPct, REM_BAND));
    archLoad = clamp(Math.max(...devs));
  }

  // ── 加权（缺项重归一）──
  const parts: { w: number; v: number }[] = [];
  if (durationLoad != null) parts.push({ w: W.duration, v: durationLoad });
  if (timingLoad != null) parts.push({ w: W.timing, v: timingLoad });
  if (fragLoad != null) parts.push({ w: W.fragmentation, v: fragLoad });
  if (archLoad != null) parts.push({ w: W.architecture, v: archLoad });

  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const load = wsum > 0 ? Math.round(clamp(parts.reduce((a, p) => a + p.w * p.v, 0) / wsum) * 100) : 0;
  const level: SleepLoadLevel = load < 25 ? 'low' : load < 50 ? 'moderate' : load < 75 ? 'high' : 'severe';

  return {
    load,
    debtH: Math.round(debtH * 10) / 10,
    level,
    parts: { duration: durationLoad, timing: timingLoad, fragmentation: fragLoad, architecture: archLoad },
  };
}

export const SLEEP_LOAD_LABEL: Record<SleepLoadLevel, string> = {
  low: '负载低',
  moderate: '负载中',
  high: '负载偏高',
  severe: '负载高',
};
