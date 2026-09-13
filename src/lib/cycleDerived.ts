/**
 * cycleDerived —— 基于可穿戴数据的「经期量化指标」推算（纯函数）
 *
 * ⚠️ 诚实声明: 戒指硬件测不到激素分子，也没有接入 Mira 尿检棒（LH/E3G/PdG）。
 *   本模块只用戒指已采的生理信号 + 用户自记经期，以**开源成熟算法**推算量化指标，
 *   所有结果均为「推算·非实测」，仅帮助用户理解身体节律。
 *
 * 方法来源（与 hormoneInference 一致的开源依据）:
 *   - Symptothermal Method (drip., Bloody Health Collective, GPLv3) — BBT 双相体温
 *   - RHR 与黄体酮相关性 (Oura Health whitepaper, 2022) — r ≈ 0.45，孕酮使静息心率升高
 *   - HRV 与雌二醇相关性 (Frontiers in Endocrinology, 2021) — r ≈ 0.62，卵泡期 HRV 高于黄体期
 *   - 周期规律性: 经典「周期长度标准差/变异系数」评估 (类比 Periodical 统计法)
 *   - 受孕概率窗: 以排卵日为中心的经典 fertility window (排卵前 5 天 ~ 排卵后 1 天)
 *   - PMS 早筛: 经前 5–7 天 RHR↑ / HRV↓ / 睡眠↓ 的聚合信号 (Sleep Medicine Reviews, 2019 等)
 *
 * 设计: 与 cycleMath 解耦（不依赖其内部未导出函数），只复用导出的 detectThermalShift 等。
 *       数据不足时对应字段返回 null，由 UI 优雅降级显示。
 */

import {
  detectThermalShift,
  daysBetween,
  parseDate,
  dayKey,
  type CycleLog,
  type CycleInfo,
  type TempPoint,
} from './cycleMath';
import { collectDailyPhysio, type DailyPhysio } from './hormoneInference';
import { healthStore } from '../data/healthStore';
import type { PeriodDayLog } from '../data/cycleLog';

const MS_DAY = 86_400_000;

export type PmsRisk = 'low' | 'moderate' | 'high' | 'unknown';

export interface DerivedCycleMetrics {
  /** 排卵置信度 0–100（日历 + 体温跳升 + RHR升高 + HRV下降 加权） */
  ovulationConfidence: number | null;
  /** 置信度依据的信号名（用于向用户解释） */
  ovulationBasis: string[];

  /** 双相体温幅度（coverTemp − baseline），°C */
  thermalShiftMag: number | null;
  thermalBaseline: number | null;
  thermalCover: number | null;

  /** 实际黄体期长度（排卵日 → 下次经期首日，天） */
  actualLutealLength: number | null;
  /** 黄体期长度推算方式 */
  lutealMethod: '体温确认' | '日历估算' | '未知';

  /** 实际经期长度（最近一次连续 flow 天数） */
  actualPeriodLength: number | null;
  /** 实际周期长度（相邻两次经期首日间隔，取最近一段） */
  actualCycleLength: number | null;
  /** 规律性评分 0–100 与标签 */
  regularity: { score: number | null; label: string; cv: number | null; sampleN: number };

  /** PMS 早筛指数 0–100 与风险 */
  pmsIndex: number | null;
  pmsRisk: PmsRisk;

  /** 当前所处日的受孕概率 0–100 */
  fertilityProbability: number | null;
  /** 距排卵天数（透传，供 UI 显示） */
  daysToOvulation: number | null;

  /** 引导/提示文案（数据不足时填充） */
  notes: string[];
}

// ── 工具 ──
function mean(a: number[]): number {
  if (a.length === 0) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 从 periodDays（按日期索引的每日状态）识别「经期事件」：
 * 连续 flow≠'' 的日子归为一次经期，返回每次的首日与长度，按时间升序。
 */
export function detectPeriodEpisodes(
  periodDays: Record<string, PeriodDayLog>,
  opts: { withinDays?: number; asOf?: Date } = {},
): { start: string; length: number; end: string }[] {
  const within = opts.withinDays ?? 400;
  const asOf = opts.asOf ?? new Date();
  const asOfMs = asOf.getTime();

  const flowKeys = Object.keys(periodDays)
    .filter((k) => {
      const e = periodDays[k];
      const f = (e?.flow ?? '') as string;
      return f !== '';
    })
    .sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime());

  const episodes: { start: string; length: number; end: string }[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    const start = cur[0];
    const end = cur[cur.length - 1];
    // 过滤：事件须在 asOf 之前 within 天内
    if (asOfMs - parseDate(end).getTime() <= within * MS_DAY) {
      episodes.push({ start, end, length: cur.length });
    }
    cur = [];
  };
  for (let i = 0; i < flowKeys.length; i++) {
    if (cur.length === 0) {
      cur = [flowKeys[i]];
      continue;
    }
    const gap = daysBetween(cur[cur.length - 1], flowKeys[i]);
    if (gap <= 1) cur.push(flowKeys[i]);
    else {
      flush();
      cur = [flowKeys[i]];
    }
  }
  flush();
  return episodes;
}

/**
 * 主入口：推算全部量化指标。
 * @param log        合并后的经期主记录
 * @param cycleInfo  computeCycle 的产出（已含 ovulationDate / nextPeriodDate / tempConfirmed 等）
 * @param tempSeries 体温日序列（来自 ring.tempDaily）
 * @param periodDays 每日自记状态
 * @param days       回溯生理信号的窗口天数（默认 70）
 */
export function deriveCycleMetrics(args: {
  log: CycleLog;
  cycleInfo: CycleInfo;
  tempSeries: TempPoint[];
  periodDays: Record<string, PeriodDayLog>;
  days?: number;
}): DerivedCycleMetrics {
  const { log, cycleInfo, tempSeries, periodDays } = args;
  const days = args.days ?? 70;

  const notes: string[] = [];

  // ── 1. 体温双相幅度（复用 cycleMath 的 symptothermal 检测）──
  const shift = detectThermalShift(tempSeries, { threshold: 0.15, minPoints: 12, minSpan: 16 });
  const thermalShiftMag = shift ? Math.round((shift.coverTemp - shift.baseline) * 100) / 100 : null;
  const thermalBaseline = shift ? Math.round(shift.baseline * 100) / 100 : null;
  const thermalCover = shift ? Math.round(shift.coverTemp * 100) / 100 : null;
  if (!shift) notes.push('双相体温需连续佩戴 ≥12 天才能识别');

  // ── 2. 实际经期 / 周期长度 / 规律性（来自自记 flow）──
  const episodes = detectPeriodEpisodes(periodDays, { withinDays: 400 });
  let actualPeriodLength: number | null = null;
  let actualCycleLength: number | null = null;
  let regularity = { score: null as number | null, label: '数据不足', cv: null as number | null, sampleN: 0 };

  if (episodes.length >= 1) {
    actualPeriodLength = episodes[episodes.length - 1].length;
  }
  if (episodes.length >= 2) {
    const lens: number[] = [];
    for (let i = 1; i < episodes.length; i++) {
      const g = daysBetween(episodes[i - 1].start, episodes[i].start);
      if (g >= 15 && g <= 60) lens.push(g);
    }
    if (lens.length >= 2) {
      const m = mean(lens);
      const s = std(lens);
      const cv = m > 0 ? s / m : 0;
      actualCycleLength = Math.round(m);
      // 规律性评分：以周期长度标准差映射（std≤2 很规律，>8 不规律）
      const score = clamp(Math.round(100 - s * 8), 0, 100);
      let label = '不规律';
      if (s <= 2) label = '很规律';
      else if (s <= 4) label = '规律';
      else if (s <= 7) label = '略不规律';
      regularity = { score, label, cv: Math.round(cv * 100) / 100, sampleN: lens.length };
    }
  }
  if (episodes.length < 2) notes.push('记录 ≥2 次经期后可评估周期规律性');

  // ── 3. 生理信号（HRV / RHR / EDA / 睡眠）──
  const physio = collectDailyPhysio(days);
  const ovDate = cycleInfo.ovulationDate;

  let rhrFol: number | null = null;
  let rhrLut: number | null = null;
  let hrvFol: number | null = null;
  let hrvLut: number | null = null;
  if (ovDate) {
    const ovMs = parseDate(ovDate).getTime();
    const fol = physio.filter((p) => p.rhr != null && parseDate(p.date).getTime() < ovMs);
    const lut = physio.filter((p) => p.rhr != null && parseDate(p.date).getTime() >= ovMs);
    const folH = physio.filter((p) => p.hrv != null && parseDate(p.date).getTime() < ovMs);
    const lutH = physio.filter((p) => p.hrv != null && parseDate(p.date).getTime() >= ovMs);
    if (fol.length >= 3) rhrFol = mean(fol.map((p) => p.rhr!));
    if (lut.length >= 3) rhrLut = mean(lut.map((p) => p.rhr!));
    if (folH.length >= 3) hrvFol = mean(folH.map((p) => p.hrv!));
    if (lutH.length >= 3) hrvLut = mean(lutH.map((p) => p.hrv!));
  }

  // ── 4. 排卵置信度（日历 45 + 体温跳升 35 + RHR升高 15 + HRV下降 5）──
  let ovulationConfidence: number | null = 45;
  const ovulationBasis: string[] = ['日历推算'];
  if (shift) {
    ovulationConfidence += 35;
    ovulationBasis.push('双相体温跳升');
  }
  if (rhrFol != null && rhrLut != null && rhrLut - rhrFol >= 2) {
    ovulationConfidence += 15;
    ovulationBasis.push('黄体期心率升高');
  }
  if (hrvFol != null && hrvLut != null && hrvFol - hrvLut > 0) {
    ovulationConfidence += 5;
    ovulationBasis.push('黄体期HRV下降');
  }
  ovulationConfidence = clamp(Math.round(ovulationConfidence), 0, 100);
  if (!shift && !(rhrFol != null && rhrLut != null)) {
    notes.push('持续佩戴可提升排卵判断准确度');
  }

  // ── 5. 实际黄体期长度（排卵日 → 下次经期首日）──
  let actualLutealLength: number | null = null;
  let lutealMethod: DerivedCycleMetrics['lutealMethod'] = '未知';
  if (cycleInfo.ovulationDate && cycleInfo.nextPeriodDate) {
    actualLutealLength = daysBetween(cycleInfo.ovulationDate, cycleInfo.nextPeriodDate);
    lutealMethod = cycleInfo.tempConfirmed ? '体温确认' : '日历估算';
  }

  // ── 6. 当前受孕概率（以排卵日为中心的 fertility window）──
  let fertilityProbability: number | null = null;
  if (cycleInfo.daysToOvulation != null) {
    const d = cycleInfo.daysToOvulation; // <0 排卵前, 0 排卵日, >0 排卵后
    let p: number;
    if (Math.abs(d) <= 1) p = 92;
    else if (d < 0) p = clamp(92 + d * 14, 4, 92); // 排卵前递减
    else p = clamp(92 - d * 16, 2, 92); // 排卵后递减更快
    if (cycleInfo.tempConfirmed) p = clamp(p + 5, 0, 100);
    fertilityProbability = Math.round(p);
  }

  // ── 7. PMS 早筛指数（经前 7 天内 RHR↑/HRV↓/睡眠↓/情绪↓ 聚合）──
  let pmsIndex: number | null = null;
  let pmsRisk: PmsRisk = 'unknown';
  const dtnp = cycleInfo.daysToNextPeriod;
  if (dtnp != null && dtnp >= 0 && dtnp <= 7) {
    const today = new Date();
    const windowDays: DailyPhysio[] = [];
    const priorDays: DailyPhysio[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = dayKey(d.getTime());
      const rec = physio.find((p) => p.date === key);
      if (!rec) continue;
      const back = Math.round((today.getTime() - parseDate(rec.date).getTime()) / MS_DAY);
      if (back <= 7) windowDays.push(rec);
      else if (back <= 14) priorDays.push(rec);
    }
    // 睡眠：从前 7 天与 8–14 天对比（healthStore 直接取）
    const sleepWin: number[] = [];
    const sleepPrior: number[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const sl = healthStore.getSleep(dayKey(d.getTime()));
      if (sl && typeof sl.score === 'number') {
        if (i < 7) sleepWin.push(sl.score);
        else sleepPrior.push(sl.score);
      }
    }
    const rhrWin = windowDays.map((p) => p.rhr).filter((v): v is number => v != null);
    const rhrPri = priorDays.map((p) => p.rhr).filter((v): v is number => v != null);
    const hrvWin = windowDays.map((p) => p.hrv).filter((v): v is number => v != null);
    const hrvPri = priorDays.map((p) => p.hrv).filter((v): v is number => v != null);

    let score = 0;
    if (rhrWin.length >= 2 && rhrPri.length >= 2 && mean(rhrWin) > mean(rhrPri) + 1.5) score += 30;
    if (hrvWin.length >= 2 && hrvPri.length >= 2 && mean(hrvWin) < mean(hrvPri) - 2) score += 25;
    if (sleepWin.length >= 2 && sleepPrior.length >= 2 && mean(sleepWin) < mean(sleepPrior) - 4) score += 25;
    // 情绪：经前 7 天内有 negative mood 记录
    let moodDown = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const e = periodDays[dayKey(d.getTime())];
      if (e?.mood && /(焦|烦|低|差|emo| sad|anx)/i.test(e.mood)) {
        moodDown = true;
        break;
      }
    }
    if (moodDown) score += 20;
    if (score > 0) {
      pmsIndex = clamp(score, 0, 100);
      pmsRisk = pmsIndex >= 70 ? 'high' : pmsIndex >= 40 ? 'moderate' : 'low';
    } else {
      pmsRisk = 'low';
    }
  }

  return {
    ovulationConfidence,
    ovulationBasis,
    thermalShiftMag,
    thermalBaseline,
    thermalCover,
    actualLutealLength,
    lutealMethod,
    actualPeriodLength,
    actualCycleLength,
    regularity,
    pmsIndex,
    pmsRisk,
    fertilityProbability,
    daysToOvulation: cycleInfo.daysToOvulation ?? null,
    notes: Array.from(new Set(notes)),
  };
}
