/**
 * hormoneInference — 戒指可穿戴数据 → 激素状态推断
 *
 * ⚠️ 诚实声明: 戒指硬件测不到激素分子 (分子太大, 皮肤电导/温度传感器够不到)。
 *    本模块基于已发表的"激素-生理信号相关性研究" + 开源成熟算法:
 *
 * 方法来源:
 *   1. Symptothermal Method (drip., Bloody Health Collective, GPLv3) — BBT 双相体温
 *   2. HRV 与雌二醇相关性 (Frontiers in Endocrinology, 2021) — r ≈ 0.62
 *   3. RHR 与黄体酮相关性 (Oura Health whitepaper, 2022) — r ≈ 0.45
 *   4. 睡眠-黄体酮负相关 (Sleep Medicine Reviews, 2019)
 *
 * 戒指真实数据输入:
 *   - tempDaily    每日皮肤体温均值 (healthStore / ring.tempDaily)
 *   - hrvDaily     每日 HRV RMSSD (healthStore / ring.history.hrv 聚合)
 *   - rhrDaily     每日静息心率 (healthStore / ring.history.hr 夜间最低)
 *   - sleepDaily   每日睡眠摘要 (healthStore.getSleep)
 *   - edaDaily     每日 EDA 平均水平 (healthStore / ring.history.eda 聚合)
 */
import { estrogenForDate } from './cycleMath';

import { detectThermalShift, tempDailyToSeries, dayKey, daysBetween, parseDate, addDays } from './cycleMath';

// ────────────────────────────────────────────
// 输入: 每日生理时间序列 (最近 ≥28 天)
// ────────────────────────────────────────────

export interface DailyPhysio {
  /** YYYY-M-D 格式的日期 key */
  date: string;
  /** 日均皮肤体温 (°C), 戒指真测 */
  temp?: number | null;
  /** 日均 HRV RMSSD (ms), 戒指真测 */
  hrv?: number | null;
  /** 静息心率 RHR (bpm), 戒指真测 */
  rhr?: number | null;
  /** 睡眠时长 (分钟), 戒指真测 */
  sleepMin?: number | null;
  /** EDA 平均 (μS/cm²), 戒指真测 */
  eda?: number | null;
}

export interface CycleLogRef {
  lastPeriodStart: string;
  cycleLength: number;
  lutealLength: number;
  periodLength: number;
  dayInCycle: number | null;
  phase: 'period' | 'follicular' | 'ovulation' | 'luteal' | 'unknown';
  ovulationDate: string | null;
}

// ────────────────────────────────────────────
// 输出: 激素推断 + 周期健康度
// ────────────────────────────────────────────

export type HormoneStatus = 'high' | 'normal' | 'low' | 'inconclusive' | 'insufficient';

export interface HormoneInference {
  /** 黄体酮 (Progesterone) 状态 */
  progesterone: {
    status: HormoneStatus;
    score: number | null;          // 0-100 相对个人基线
    level: 'follicular' | 'luteal' | 'unknown';  // 是否进入黄体期高位
    bbtConfirmed: boolean;        // BBT 双相跳升确认
    delta: number | null;          // cover temp - baseline (°C)
  };

  /** 雌二醇 (Estradiol) 状态 */
  estradiol: {
    status: HormoneStatus;
    score: number | null;          // 0-100 相对卵泡期峰值
    hrvDipDetected: boolean;      // 排卵前 HRV dip (经典 E2 峰信号)
    trend: 'rising' | 'falling' | 'flat' | 'unknown';
  };

  /** 周期健康度 */
  regularity: {
    /** 是否有规律的 BBT 双相 (排卵正常) */
    hasBiphasicBBT: boolean;
    /** HRV 跨相位差异是否正常 (卵泡→黄体应有显著下降) */
    hrvPhaseDiffNormal: boolean;
    /** RHR 黄体期是否升高 (孕酮正常反应) */
    rhrLutealElevated: boolean;
    /** 综合判定: 周期是否有紊乱迹象 */
    irregularity: 'normal' | 'possible' | 'likely' | 'insufficient';
    flags: string[];               // 具体异常项
  };

  /** 戒指数据置信度 */
  dataQuality: {
    daysWithTemp: number;
    daysWithHRV: number;
    daysWithRHR: number;
    daysTotal: number;
  };
}

// ────────────────────────────────────────────
// 核心算法
// ────────────────────────────────────────────

/**
 * 主入口: 用戒指数据 + 周期日志推断激素状态
 */
export function inferHormones(
  physio: DailyPhysio[],
  cycleRef: CycleLogRef | null,
): HormoneInference {
  const sorted = physio
    .filter(p => p.date && (p.temp != null || p.hrv != null || p.rhr != null))
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());

  const daysTotal = sorted.length;
  const daysWithTemp = sorted.filter(p => p.temp != null).length;
  const daysWithHRV = sorted.filter(p => p.hrv != null).length;
  const daysWithRHR = sorted.filter(p => p.rhr != null).length;

  // ── 1. 黄体酮: 基于 BBT + RHR ──
  const tempSeries = sorted
    .filter(p => p.temp != null)
    .map(p => ({ date: p.date, temp: p.temp! }));

  const shift = detectThermalShift(tempSeries, { threshold: 0.12, minPoints: 10, minSpan: 14 });

  // 计算 cover - baseline 差值
  let deltaTemp = null as number | null;
  let bbtHasShift = false;
  if (shift) {
    bbtHasShift = true;
    deltaTemp = Math.round((shift.coverTemp - shift.baseline) * 100) / 100;
  }

  // RHR: 黄体期 vs 卵泡期对比
  let rhrFollicular: number | null = null;
  let rhrLuteal: number | null = null;
  if (cycleRef && cycleRef.ovulationDate) {
    const ovMs = parseDate(cycleRef.ovulationDate).getTime();
    const follicular = sorted.filter(p => p.rhr != null && parseDate(p.date).getTime() < ovMs);
    const luteal = sorted.filter(p => p.rhr != null && parseDate(p.date).getTime() >= ovMs);
    if (follicular.length >= 3) rhrFollicular = mean(follicular.map(p => p.rhr!));
    if (luteal.length >= 3) rhrLuteal = mean(luteal.map(p => p.rhr!));
  }
  const rhrDelta = (rhrFollicular != null && rhrLuteal != null) ? rhrLuteal - rhrFollicular : null;
  const rhrLutealElevated = rhrDelta != null && rhrDelta >= 2.0;  // 孕酮使 RHR 升高 ≥2 bpm

  // 黄体酮状态判断
  let progStatus: HormoneStatus;
  let progScore: number | null = null;
  let progLevel: 'follicular' | 'luteal' | 'unknown' = 'unknown';

  if (daysWithTemp >= 10 && bbtHasShift && deltaTemp != null) {
    // BBT 双相跳升确认 → 排卵发生
    // 跳升幅度越大, 黄体功能越好 (孕酮分泌越多)
    // 皮肤体温范围 35.5-37.5°C, 典型双相差 0.3-0.5°C
    const normalized = clamp01((deltaTemp - 0.1) / 0.5);
    progScore = Math.round(normalized * 100);
    if (cycleRef && cycleRef.phase === 'luteal') {
      progLevel = 'luteal';
      progStatus = progScore >= 60 ? 'high' : progScore >= 30 ? 'normal' : 'low';
    } else if (cycleRef && cycleRef.phase === 'follicular') {
      progLevel = 'follicular';
      progStatus = progScore >= 50 ? 'normal' : 'low';  // 卵泡期孕酮本应低
    } else {
      progStatus = 'inconclusive';
    }
  } else if (cycleRef && cycleRef.ovulationDate && rhrDelta != null) {
    // 无 BBT, 用 RHR 差代替
    progLevel = cycleRef.phase === 'luteal' ? 'luteal' : 'follicular';
    progScore = Math.round(clamp01(rhrDelta / 5.0) * 100);  // 5 bpm 差 ≈ 100 分
    progStatus = rhrLutealElevated ? 'normal' : 'low';
  } else if (daysWithTemp < 10 && daysWithHRV < 10) {
    // 数据不够 10 天 — 用周期相位给参考值
    const phase = cycleRef?.phase ?? 'follicular';
    if (phase === 'period') { progScore = 15; progStatus = 'reference'; progLevel = 'unknown'; }
    else if (phase === 'follicular') { progScore = 25; progStatus = 'reference'; progLevel = 'follicular'; }
    else if (phase === 'ovulation') { progScore = 20; progStatus = 'reference'; progLevel = 'unknown'; }
    else if (phase === 'luteal') { progScore = 70; progStatus = 'reference'; progLevel = 'luteal'; }
    else { progScore = 35; progStatus = 'reference'; progLevel = 'unknown'; }
  } else {
    progStatus = 'insufficient';
  }

  // ── 2. 雌二醇: 基于 HRV + EDA ──
  let hrvFollicular: number | null = null;
  let hrvLuteal: number | null = null;
  if (cycleRef && cycleRef.ovulationDate) {
    const ovMs = parseDate(cycleRef.ovulationDate).getTime();
    const follicular = sorted.filter(p => p.hrv != null && parseDate(p.date).getTime() < ovMs);
    const luteal = sorted.filter(p => p.hrv != null && parseDate(p.date).getTime() >= ovMs);
    if (follicular.length >= 3) hrvFollicular = mean(follicular.map(p => p.hrv!));
    if (luteal.length >= 3) hrvLuteal = mean(luteal.map(p => p.hrv!));
  }

  // HRV dip 检测: 排卵前雌激素峰值 → HRV 短暂下降
  let hrvDipDetected = false;
  if (cycleRef && cycleRef.ovulationDate && daysWithHRV >= 10) {
    const ovMs = parseDate(cycleRef.ovulationDate).getTime();
    const preOv = sorted.filter(p => p.hrv != null)
      .filter(p => {
        const d = parseDate(p.date).getTime();
        return d >= ovMs - 4 * 86400000 && d <= ovMs + 1 * 86400000;
      })
      .map(p => p.hrv!);
    if (preOv.length >= 3) {
      const preMean = mean(preOv);
      const overallMean = mean(sorted.filter(p => p.hrv != null).map(p => p.hrv!));
      if (preMean < overallMean * 0.85) hrvDipDetected = true;
    }
  }

  // EDA: 卵泡期 vs 黄体期
  let edaFollicular: number | null = null;
  let edaLuteal: number | null = null;
  if (cycleRef && cycleRef.ovulationDate) {
    const ovMs = parseDate(cycleRef.ovulationDate).getTime();
    const f = sorted.filter(p => p.eda != null && parseDate(p.date).getTime() < ovMs);
    const l = sorted.filter(p => p.eda != null && parseDate(p.date).getTime() >= ovMs);
    if (f.length >= 3) edaFollicular = mean(f.map(p => p.eda!));
    if (l.length >= 3) edaLuteal = mean(l.map(p => p.eda!));
  }

  let e2Status: HormoneStatus;
  let e2Score: number | null;

  if (daysWithHRV < 10) {
    // 数据不够 — 用 cycleMath 的双峰模型给参考值
    const e2Ref = estrogenForDate(cycleRef, new Date());
    e2Score = e2Ref != null ? Math.round(e2Ref) : 40;
    e2Status = 'reference';
  } else {
    e2Score = null;
    e2Status = 'insufficient';
  }
  let e2Trend: 'rising' | 'falling' | 'flat' | 'unknown' = 'unknown';

  if (daysWithHRV >= 10 && hrvFollicular != null) {
    // HRV 越高 → 雌激素越高 (卵泡期)
    // 用个人 HRV 作为相对基准
    const allHRV = sorted.filter(p => p.hrv != null).map(p => p.hrv!);
    const currentHRV = allHRV[allHRV.length - 1] ?? null;
    const hrvHigh = quantile(allHRV, 0.75);
    const hrvLow = quantile(allHRV, 0.25);

    if (currentHRV != null) {
      const pctile = (currentHRV - hrvLow) / (hrvHigh - hrvLow || 1);
      e2Score = Math.round(clamp01(pctile) * 100);

      // 趋势: 最近 3 天 vs 前 3 天
      const recent = allHRV.slice(-3);
      const prev = allHRV.slice(-6, -3);
      if (recent.length >= 3 && prev.length >= 3) {
        const diff = mean(recent) - mean(prev);
        const threshold = stddev(allHRV) * 0.3;
        e2Trend = diff > threshold ? 'rising' : diff < -threshold ? 'falling' : 'flat';
      }

      if (cycleRef) {
        if (cycleRef.phase === 'follicular') {
          e2Status = e2Score >= 60 ? 'high' : e2Score >= 35 ? 'normal' : 'low';
        } else if (cycleRef.phase === 'luteal') {
          // 黄体期雌激素本应降低, 异常偏高可能是激素紊乱
          e2Status = e2Score >= 70 ? 'high' : e2Score >= 40 ? 'normal' : 'low';
        } else {
          e2Status = 'inconclusive';
        }
      } else {
        e2Status = 'inconclusive';
      }
    }
  }

  // ── 3. 周期健康度 ──
  const flags: string[] = [];

  if (daysWithTemp >= 14 && !bbtHasShift) {
    flags.push('无明显 BBT 双相体温 — 可能无排卵或激素紊乱');
  }

  if (hrvFollicular != null && hrvLuteal != null) {
    const ratio = hrvLuteal / hrvFollicular;
    if (ratio > 0.95) {
      flags.push(`HRV 跨相位差异过小 (黄体/卵泡 = ${ratio.toFixed(2)}) — 可能黄体功能不足`);
    }
  }

  if (cycleRef && cycleRef.phase === 'luteal' && !rhrLutealElevated) {
    flags.push('黄体期 RHR 未升高 — 孕酮反应不足');
  }

  if (cycleRef && cycleRef.cycleLength === 28 && cycleRef.dayInCycle != null
      && cycleRef.dayInCycle > 22 && cycleRef.dayInCycle < 27) {
    // 临近经期检查体温下降
    if (shift && shift.coverTemp != null) {
      const lastTemp = tempSeries[tempSeries.length - 1];
      if (lastTemp && lastTemp.temp > shift.baseline + 0.2) {
        // 经期前孕酮应下降导致体温下降
        // 经期前 2-3 天体温仍高位 → 孕酮撤退延迟
        // 但也可能是还没到, 保守提示
      }
    }
  }

  let irregularity: 'normal' | 'possible' | 'likely' | 'insufficient';
  if (daysWithTemp < 10 && daysWithHRV < 10) {
    irregularity = 'insufficient';
  } else if (flags.length === 0) {
    irregularity = 'normal';
  } else if (flags.length <= 1) {
    irregularity = 'possible';
  } else {
    irregularity = 'likely';
  }

  return {
    progesterone: {
      status: progStatus,
      score: progScore,
      level: progLevel,
      bbtConfirmed: bbtHasShift,
      delta: deltaTemp,
    },
    estradiol: {
      status: e2Status,
      score: e2Score,
      hrvDipDetected,
      trend: e2Trend,
    },
    regularity: {
      hasBiphasicBBT: bbtHasShift,
      hrvPhaseDiffNormal: hrvFollicular != null && hrvLuteal != null && hrvLuteal / hrvFollicular < 0.92,
      rhrLutealElevated,
      irregularity,
      flags,
    },
    dataQuality: { daysWithTemp, daysWithHRV, daysWithRHR, daysTotal },
  };
}

// ── 工具函数 ──
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
function quantile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}
function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ────────────────────────────────────────────
// 从 healthStore 抽取 DailyPhysio 序列
// ────────────────────────────────────────────

import { healthStore } from '../data/healthStore';

export function collectDailyPhysio(days: number = 60): DailyPhysio[] {
  const today = new Date();
  const result: DailyPhysio[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());  // ★ 补零格式

    const daily: DailyPhysio = { date: key };

    // 体温 (日均)
    const tempDm = healthStore.getDay('temp', key);
    if (tempDm?.mean != null) daily.temp = tempDm.mean;

    // HRV (日均)
    const hrvDm = healthStore.getDay('hrv', key);
    if (hrvDm?.mean != null) daily.hrv = hrvDm.mean;

    // RHR = 当日 HR 最低值 (min 字段)
    const hrDm = healthStore.getDay('hr', key);
    if (hrDm?.min != null) daily.rhr = hrDm.min;

    // EDA 日均
    const edaDm = healthStore.getDay('eda', key);
    if (edaDm?.mean != null) daily.eda = edaDm.mean;

    result.push(daily);
  }

  return result;
}

