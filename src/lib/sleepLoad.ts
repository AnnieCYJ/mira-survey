/**
 * 睡眠负载（Sleep Load，0–100，**越高越"欠账"**）——纯函数、零依赖。
 *
 * v2 改进（vs 旧版）：
 *  ── Debt 算法 ────────────────────────────────────────────────────────
 *   ① needH 用**稳健基线**：优先全部历史睡眠时长的 trimmed median（去极值），
 *      回退窗口内 median；夹到 7–9h（WHOOP 基线范围）。
 *      → 修掉"连续熬夜 → 窗口 median 被拉低 → debt 被低估"的经典 bug。
 *   ② Borbély Process S 指数衰减：gap 按 exp(-days_ago / τ) 连续衰减（τ=5d，
 *      半衰期 ≈3.5d），替代旧版离散 0.9^i。更贴近腺苷清除的生理模型。
 *   ③ **超睡眠递减还债**（v1 完全不支持）：
 *      surplus = max(0, effectiveH − needH) 按分段效率偿还 debt：
 *        前 0.5h  100%   — 最有效的补觉（Borbély：深睡早期清腺苷最快）
 *        0.5–1.5h 70%
 *        1.5–3h   40%
 *        >3h      20%   — 过度补觉反而扰乱节律（social jetlag ↑）
 *   ④ **质量加权有效睡眠**：每天的 effectiveH = total × efficiency，
 *      efficiency = total / (total + awake)，且下限 0.65（WHOOP 口径 <65% 算碎片化）。
 *      同样 6h，醒了 2h → effectiveH ≈ 4.5h → gap 更大，debt 更准确。
 *  ── 其他维度（时机/碎片化/结构）保持 v1 不变 ─────────────────────────
 *
 * 参考成熟算法（不照抄，取其公认维度）：
 *  · **WHOOP**：Sleep Need = 基线(7–9h，个性化) + 应变 + **睡眠债（近 14 天累计缺口）** − 小睡；
 *    Sleep Performance = 实际 / 需求；官方口径「债 > 5h 明显拖累恢复」。
 *  · **Apple Watch（watchOS 26，权重公开）**：Duration ≤50 + **就寝一致性 ≤30（近 13 晚）** + 中断 ≤20。
 *  · **Oura**：Total Sleep / Efficiency / Restfulness / REM / Deep / Latency / **Timing（昼夜对齐）**。
 *  · **Fitbit**：Duration ≤50 + 深睡&REM 质量 ≤25 + Restoration ≤25。
 *  · **Garmin(Firstbeat)**：Duration（相对个性化目标）+ Quality（阶段/清醒/躁动）+ Restoration。
 *  · 学术：Borbély Two-Process Model (1982) — Process S 指数积累/清除；
 *         Sleep Regularity Index / social jetlag —— 就寝时刻的周内漂移。
 *
 * 四个「缺口」加权为 0–100 负载：
 *   ① 时长缺口（累计）W 0.35 —— 稳健基线 + 指数衰减 + 超睡眠还债 + 质量加权
 *   ② 时机负载        W 0.30 —— 晚睡 + 就寝不规律（social jetlag）
 *   ③ 碎片化负载      W 0.20 —— 起夜 + 夜间清醒占比
 *   ④ 结构负载        W 0.15 —— 深睡% / REM% 偏离 WHOOP 目标带
 *
 * ★ 某维缺数据时该项剔除、其余权重**重新归一**，不会因「缺数据」被扣分。
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
  /** 累计睡眠债（小时，Borbély 指数衰减 + 超睡眠还债后净缺口；可能为负表示信用） */
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

// ── 权重 ─────────────────────────────────────────────────────────────────
const W = { duration: 0.35, timing: 0.3, fragmentation: 0.2, architecture: 0.15 };

// ── 常量（对齐 WHOOP / 学术参数）─────────────────────────────────────────
/** 个人睡眠需求夹取范围（WHOOP 基线 7–9h，中位 7.6h） */
const NEED_MIN_H = 7;
const NEED_MAX_H = 9;          // ↑ v1 是 8.5h，放宽到 WHOOP 上限
const NEED_FALLBACK_H = 7.6;

/** debt 归一化上限（6h = 满分负载）——因为超睡眠还债现在会抵消一部分，
 *  纯缺口 6h 的恢复拖累程度 ≈ v1 纯缺口 5h，保持体感一致 */
const DEBT_FULL_H = 6;

/** Borbély Process S：debt 指数衰减时间常数 τ ≈ 5 天
 *  半衰期 = τ × ln(2) ≈ 3.5 天（3.5 天后债剩一半）
 *  来源：Borbély 1982 + Achermann 2004 拟合实测 SWA 清除曲线 */
const DEBT_TAU_DAYS = 5;

/** 时机：晚睡阈值（WHOOP 23:00 前入睡为佳） */
const BED_GOOD_HOUR = 23;
const BED_BAD_HOUR = 25;       // 凌晨 1:00 取 1

/** 就寝不规律：近 7 晚标准差 1.5h = 满分（social jetlag，Arab 2024 meta） */
const BED_SD_FULL_H = 1.5;

/** 碎片化：起夜 3 次 = 满分；清醒占比 15% = 满分（WHOOP） */
const GETUP_FULL = 3;
const AWAKE_RATIO_FULL = 0.15;

/** 睡眠效率下限（低于 65% 算严重碎片化，effectiveH 被钳死） */
const EFFICIENCY_FLOOR = 0.65;

/** 阶段目标带（WHOOP）：深睡 13–23% / REM 20–25% */
const DEEP_BAND = [13, 23] as const;
const REM_BAND = [20, 25] as const;

// ── 工具函数 ─────────────────────────────────────────────────────────────
const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));

/** Trimmed median：去掉 top/bottom 各 10% 的极值后取 median
 *  → 对异常值（如生病连熬 3 天 / 周末狂睡 12h）更稳健 */
function trimmedMedian(xs: number[], trimPct = 0.1): number | null {
  if (xs.length === 0) return null;
  if (xs.length <= 4) {
    // 样本太少就不 trim
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  const s = [...xs].sort((a, b) => a - b);
  const trimCount = Math.max(1, Math.floor(s.length * trimPct));
  const trimmed = s.slice(trimCount, s.length - trimCount);
  const mid = Math.floor(trimmed.length / 2);
  return trimmed.length % 2 ? trimmed[mid] : (trimmed[mid - 1] + trimmed[mid]) / 2;
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

/** 计算 surplus 实际能还多少债（分段累加递减效率）
 *
 *  分段 ────────┬──────
 *  0 – 0.5h     │ 100%  ← Borbély：深睡早期清腺苷最快
 *  0.5 – 1.5h   │  70%
 *  1.5 – 3h     │  40%
 *  > 3h         │  20%  ← 过补反而扰乱节律
 */
function computeRepaid(surplusH: number): number {
  if (surplusH <= 0) return 0;
  let remaining = surplusH;
  let repaid = 0;
  const tiers = [
    { width: 0.5, eff: 1.0 },   // 0 – 0.5h
    { width: 1.0, eff: 0.7 },   // 0.5 – 1.5h
    { width: 1.5, eff: 0.4 },   // 1.5 – 3h
    { width: Infinity, eff: 0.2 }, // > 3h
  ];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, tier.width);
    repaid += consumed * tier.eff;
    remaining -= consumed;
  }
  return repaid;
}

// ── 核心算法 ─────────────────────────────────────────────────────────────

/**
 * 计算稳健的个人睡眠需求（小时）。
 * 策略：trimmed median → 夹到 [NEED_MIN_H, NEED_MAX_H]
 *
 * @param durationsH 所有可用历史睡眠时长数组（小时）
 */
function estimateNeedH(durationsH: number[]): number {
  if (durationsH.length === 0) return NEED_FALLBACK_H;

  // 至少 7 天数据才用 trimmed median，否则回退简单 median
  const medianVal = durationsH.length >= 7
    ? trimmedMedian(durationsH, 0.1)
    : trimmedMedian(durationsH, 0);

  const raw = medianVal ?? NEED_FALLBACK_H;

  return clamp(raw, NEED_MIN_H, NEED_MAX_H);
}

/**
 * @param records 该日及此前若干天的睡眠，**时间升序**（最后一项 = 目标日）。建议传近 14 天。
 * @param allHistory 可选：全部可用历史睡眠记录，用于计算更稳定的 needH 基线。
 *                   不传则用 records 自身估计 needH。
 */
export function computeSleepLoad(
  records: SleepLoadDay[],
  allHistory?: { total: number }[],
): SleepLoadResult {
  const valid = records.filter((r) => r && r.total > 0);
  const target = valid.length ? valid[valid.length - 1] : null;

  // ════════════════════════════════════════════════════════════════
  // ① 时长缺口 — Borbély Process S 指数衰减 + 质量加权 + 超睡眠还债
  // ════════════════════════════════════════════════════════════════
  let durationLoad: number | null = null;
  let debtH = 0;
  if (valid.length) {
    // ── 稳健基线 ──
    const allDurations = (allHistory ?? valid)
      .filter(r => r.total > 0)
      .map(r => r.total / 60);
    const needH = estimateNeedH(allDurations);

    // ── 逐日计算 gap / surplus，带 Borbély 指数衰减 ──
    for (let i = 0; i < valid.length; i++) {
      const r = valid[valid.length - 1 - i]; // i=0 为最新
      const daysAgo = i;

      // 质量加权有效睡眠
      const awakeMin = r.awake ?? 0;
      const efficiency = Math.max(
        EFFICIENCY_FLOOR,
        r.total / Math.max(r.total + awakeMin, 1)
      );
      const effectiveH = (r.total / 60) * efficiency;

      // 缺口 or 盈余
      const rawGap = needH - effectiveH;

      // Borbély 指数衰减权重：exp(-daysAgo / τ)
      const decay = Math.exp(-daysAgo / DEBT_TAU_DAYS);

      if (rawGap > 0) {
        debtH += rawGap * decay;
      } else {
        const surplusH = -rawGap;
        const repaid = computeRepaid(surplusH);
        debtH -= repaid * decay;
      }
    }

    // durationLoad 作为 0-1 负载分数（clamp 到 0，因为 UI 只显示正负载）
    // debtH 保留完整值（允许负值）
    durationLoad = clamp(debtH / DEBT_FULL_H);
  }

  // ════════════════════════════════════════════════════════════════
  // ② 时机：晚睡 + 就寝不规律（与 v1 完全一致）
  // ════════════════════════════════════════════════════════════════
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

  // ════════════════════════════════════════════════════════════════
  // ③ 碎片化：起夜 + 夜间清醒占比（与 v1 完全一致）
  // ════════════════════════════════════════════════════════════════
  let fragLoad: number | null = null;
  if (target) {
    const getUpLoad = clamp((target.getUp ?? 0) / GETUP_FULL);
    const awakeRatio = (target.awake ?? 0) / target.total;
    const awakeLoad = clamp(awakeRatio / AWAKE_RATIO_FULL);
    fragLoad = Math.max(getUpLoad, awakeLoad);
  }

  // ════════════════════════════════════════════════════════════════
  // ④ 结构：深睡 / REM 偏离目标带（与 v1 完全一致）
  // ════════════════════════════════════════════════════════════════
  let archLoad: number | null = null;
  if (target) {
    const deepPct = (target.deep / target.total) * 100;
    const remPct = target.rem > 0 ? (target.rem / target.total) * 100 : null;
    const devs = [bandDeviation(deepPct, DEEP_BAND)];
    if (remPct != null) devs.push(bandDeviation(remPct, REM_BAND));
    archLoad = clamp(Math.max(...devs));
  }

  // ════════════════════════════════════════════════════════════════
  // 加权合成（缺项重归一，与 v1 完全一致）
  // ════════════════════════════════════════════════════════════════
  const parts: { w: number; v: number }[] = [];
  if (durationLoad != null) parts.push({ w: W.duration, v: durationLoad });
  if (timingLoad != null) parts.push({ w: W.timing, v: timingLoad });
  if (fragLoad != null) parts.push({ w: W.fragmentation, v: fragLoad });
  if (archLoad != null) parts.push({ w: W.architecture, v: archLoad });

  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const load = wsum > 0
    ? Math.round(clamp(parts.reduce((a, p) => a + p.w * p.v, 0) / wsum) * 100)
    : 0;
  const level: SleepLoadLevel = load < 25 ? 'low' : load < 50 ? 'moderate' : load < 75 ? 'high' : 'severe';

  return {
    load,
    debtH: Math.round(debtH * 10) / 10,
    level,
    parts: {
      duration: durationLoad,
      timing: timingLoad,
      fragmentation: fragLoad,
      architecture: archLoad,
    },
  };
}

export const SLEEP_LOAD_LABEL: Record<SleepLoadLevel, string> = {
  low: '负载低',
  moderate: '负载中',
  high: '负载偏高',
  severe: '负载高',
};
