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

/** 单点（半小时槽上的准备度） */
export interface ReadinessPoint {
  /** ★ 半小时槽号 0–47（0=00:00, 1=00:30, …, 47=23:30）。★ 2026-10-06 由「钟点 0–23」改为槽号，与心理压力图粒度统一 */
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

  // 睡眠恢复因子（无昨晚睡眠 → null，UI 诚实显「—」）
  const rec = rep.sleepRecovery ?? null;

  // ═══════════════════════════════════════════════════════════════════════
  // ★ 2026-10-06（用户：圆环 61、详情页 36 打架 → 口径必须唯一）：
  //   旧实现 = `100 − fatigueInstant + 节律偏移`，是**从疲劳反推**的另一套公式，
  //   与圆环/首页 chip 用的 `brainRemaining`（能量线当前值）完全是两把尺，
  //   同一天能差 20~30 分。现在**直接用能量线本身**（`energyHalfHourly`）。
  // ★ 粒度也统一为**每 30 分钟一个点**（48 槽），与心理压力图一致。
  // ═══════════════════════════════════════════════════════════════════════
  const half = (rep as any).energyHalfHourly as { slot: number; value: number; hasData: boolean }[] | undefined;

  const points: ReadinessPoint[] = [];
  if (half && half.length > 0) {
    const bySlot = new Map<number, { value: number; hasData: boolean }>();
    for (const p of half) bySlot.set(p.slot, { value: p.value, hasData: p.hasData });
    for (let s = 0; s < 48; s++) {
      const p = bySlot.get(s);
      if (!p || !p.hasData) {
        points.push({ hour: s, score: 0, hasData: false });
      } else {
        points.push({ hour: s, score: Math.max(0, Math.min(100, Math.round(p.value))), hasData: true });
      }
    }
  } else {
    // 兜底：报告未带能量线时退回整点换算（保证不崩、不空）
    for (let h = 0; h < 24; h++) {
      const raw = rep.hourlyInstant?.[h];
      if (!raw?.hasData) {
        points.push({ hour: h * 2, score: 0, hasData: false });
        continue;
      }
      const shape = (CIRCADIAN_BY_HOUR[h] - 1) * 24;
      points.push({ hour: h * 2, score: Math.max(0, Math.min(100, Math.round(100 - raw.score + shape))), hasData: true });
    }
  }

  const valid = points.filter((p) => p.hasData);
  const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b.score, 0) / valid.length) : null;

  // ══ 以下全部按 48 个半小时槽计算（points[i].hour 现在是槽号，不是钟点）══

  // 当前时刻：优先用 nowMs 所在半小时槽；该槽无数据则退回最近的有数据槽
  const nowDate = new Date(nowMs);
  const curSlot = Math.floor((nowDate.getHours() * 60 + nowDate.getMinutes()) / 30);
  let now: number | null = points[curSlot]?.hasData ? points[curSlot].score : null;
  if (now == null) {
    for (let d = 1; d <= 12 && now == null; d++) {
      const cand = points[(curSlot - d + 48) % 48];
      if (cand?.hasData) now = cand.score;
    }
  }

  // 晨起段：起床后 1 小时（起床时刻未知时用 07–09 点近似）—— 槽 = 钟点 × 2
  const wakeHour = rep.sleepWindow?.wakeHour ?? null;
  const mStart = (wakeHour != null ? Math.round(wakeHour) : 7) * 2;
  const morningVals = [0, 1, 2].map((k) => points[(mStart + k) % 48]).filter((p) => p?.hasData).map((p) => p.score);

  // 夜间低谷段：20–23 点 + 0–6 点 → 槽 40..47 + 0..13
  const nightSlots = [40, 41, 42, 43, 44, 45, 46, 47, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const nightVals = nightSlots.map((s) => points[s]).filter((p) => p?.hasData).map((p) => p.score);

  // ★ 2026-11-16（用户）：脑力峰值/低谷时段只看**非睡眠时间**——凌晨 1–4 点人都睡着了，
  //   那是「睡眠时段」不是「脑力时段」，不能参与评选。
  //   有睡眠窗（sleepWindow.bedHour/wakeHour，钟点浮点）时把窗内半小时槽剔除，再取峰谷；
  //   剔完一份都没剩（极端：全天数据都在睡眠窗内）→ 回退全天口径，UI 不至于空「—」。
  const sleepSlots = new Set<number>();
  const bedH = (rep as any).sleepWindow?.bedHour;
  const wakeH = (rep as any).sleepWindow?.wakeHour;
  if (bedH != null && wakeH != null && Number.isFinite(bedH) && Number.isFinite(wakeH)) {
    const bs = Math.max(0, Math.min(47, Math.round(bedH * 2)));
    const ws = Math.max(0, Math.min(47, Math.round(wakeH * 2)));
    let s = bs;
    let guard = 0;
    while (s !== ws && guard < 48) {
      sleepSlots.add(s);
      s = (s + 1) % 48;
      guard++;
    }
  }
  const awakeValid = valid.filter((p) => !sleepSlots.has(p.hour));
  const peakPool = awakeValid.length ? awakeValid : valid;
  const troughPool = awakeValid.length ? awakeValid : valid;
  const peak = peakPool.length ? peakPool.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const trough = troughPool.length ? troughPool.reduce((a, b) => (b.score < a.score ? b : a)) : null;

  return {
    points,
    avg,
    now,
    morning: morningVals.length ? Math.round(morningVals.reduce((a, b) => a + b, 0) / morningVals.length) : null,
    nightLow: nightVals.length ? Math.round(nightVals.reduce((a, b) => a + b, 0) / nightVals.length) : null,
    // 峰谷对外仍以「钟点」表达（UI 写"脑力峰值 H时"），槽号 ÷2 还原
    peakHour: peak != null ? Math.floor(peak.hour / 2) : null,
    troughHour: trough != null ? Math.floor(trough.hour / 2) : null,
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

/**
 * ★ 2026-10-06（用户否决"准备度均值"）：一天准备度是早高晚低的波形，**均值 ≈ 中段水平**，
 *   既不代表早上能干活的状态、也不代表晚上还剩多少，且**被睡眠时长污染**（睡 9h vs 6h 能差 10+ 分）。
 *   用户真正要的是「今天用了多少脑」= 晨起起点 − 当日终值。
 *
 * 每日消耗量 = 起点（当日 00:00 能量线首值 / 晨起准备度）− 当日最后一个实测槽的能量。
 * 无实测槽 → null（不猜）。**不受睡眠时长影响**（起点与终值同源）。
 */
export function dailyBrainConsumption(rep: CognitiveLoadReport | null | undefined): number | null {
  if (!rep) return null;
  const half = (rep as any).energyHalfHourly as { slot: number; value: number; hasData: boolean }[] | undefined;
  if (!half || half.length === 0) return null;
  const pts = half.filter((p) => p.hasData);
  if (pts.length < 2) return null;
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  // 起点用晨起准备度（当日 00:00 的能量）更准；无则退回首个实测槽
  const start = rep.brainReserve != null && Number.isFinite(rep.brainReserve) ? rep.brainReserve : first;
  return Math.max(0, Math.round(start - last));
}

/* ═════════════════════════════════════════════════════════════════════════
 * ★ 每日「真正用了多少脑」= 晨起准备度 − 睡前准备度（2026-10-07 用户定口径）
 *
 * 为什么不是别的：
 *  - 全天均值 ≈ 中段水平，既不代表早上能干活、也不代表晚上剩多少，还被睡眠时长污染；
 *  - 「疲劳度」单调递减不代表当天耗了多少；
 *  - 只有「起点 − 终点」才是当天真实用掉的量。
 * 单位是**点数**（0–100 刻度上的差值），不是百分比——这样不同日期之间可直接比较。
 *
 * 无昨天睡眠归档（拿不到起床/入睡时刻）→ 回退「当日峰 − 当日谷」，
 * 并把 basis 标出来给 UI 诚实说明（不把估算伪装成实测）。
 * ═══════════════════════════════════════════════════════════════════════ */
export type DailyUsedBasis = 'sleep' | 'peakvalley';

export interface DailyUsed {
  /** 当天用掉的脑力（点数）；无数据 → null */
  used: number | null;
  /**
   * ★ 2026-10-07（用户口径）：当天用掉的脑力占晨起储备的**百分比** —— UI 唯一主数字。
   *   有睡眠 = (晨起 − 睡前) / 晨起 × 100；无睡眠 = (当日峰 − 当日谷) / 峰 × 100。
   *   与首页「脑力消耗」卡片同一个算式（TodayScreen 的 cogConsumptionPct），两处必然一致。
   */
  usedPct: number | null;
  /** 取数方式：sleep=有睡眠归档（最准）/ peakvalley=无睡眠，峰谷估算 */
  basis: DailyUsedBasis | null;
  /** 晨起准备度（起床后 1h 均值） */
  morning: number | null;
  /** 睡前准备度（入睡时刻前 1h 均值） */
  preSleep: number | null;
  /** 无睡眠回退时的峰 / 谷 */
  peak: number | null;
  valley: number | null;
}

/** 消耗百分比：(起点 − 终点) / 起点 × 100。起点 ≤ 0 时无意义 → null */
function pctFrom(hi: number | null | undefined, lo: number | null | undefined): number | null {
  if (hi == null || lo == null || !Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  if (hi <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((hi - lo) / hi) * 100)));
}

export function dailyBrainUsed(rep?: CognitiveLoadReport, nowMs: number = Date.now()): DailyUsed {
  const EMPTY: DailyUsed = { used: null, usedPct: null, basis: null, morning: null, preSleep: null, peak: null, valley: null };
  const r = rep ?? computeCognitiveLoadReport(nowMs);
  if (!r) return EMPTY;
  const series = computeReadinessSeries(r, nowMs);
  const pts = series.points;                       // 48 槽，hour = 槽号 0–47
  const sleep = (r as any).sleepWindow as { bedHour: number; wakeHour: number } | null | undefined;

  const meanAt = (slots: number[]): number | null => {
    const vals = slots
      .map((s) => pts[((s % 48) + 48) % 48])
      .filter((p) => p && p.hasData)
      .map((p) => p.score);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  // ① 有睡眠归档：起床后 1h 均值 → 入睡时刻前 1h 均值
  if (sleep && Number.isFinite(sleep.wakeHour) && Number.isFinite(sleep.bedHour)) {
    const ws = Math.max(0, Math.min(47, Math.round(sleep.wakeHour * 2)));
    const bs = Math.max(0, Math.min(47, Math.round(sleep.bedHour * 2)));
    const morning = meanAt([ws, ws + 1, ws + 2]);
    const preSleep = meanAt([bs - 2, bs - 1, bs]);
    if (morning != null && preSleep != null) {
      return {
        used: Math.max(0, morning - preSleep),
        usedPct: pctFrom(morning, preSleep),
        basis: 'sleep', morning, preSleep, peak: null, valley: null,
      };
    }
  }

  // ② 无睡眠归档：回退当日峰 − 当日谷（用户决策），不猜、不补睡眠窗
  const valid = pts.filter((p) => p.hasData).map((p) => p.score);
  if (valid.length >= 2) {
    const peak = Math.max(...valid);
    const valley = Math.min(...valid);
    return {
      used: Math.max(0, peak - valley),
      usedPct: pctFrom(peak, valley),
      basis: 'peakvalley', morning: null, preSleep: null, peak, valley,
    };
  }
  return EMPTY;
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
