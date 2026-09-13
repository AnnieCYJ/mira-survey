/**
 * hormoneTrend.ts —— 周期激素趋势的「真实数据推算」构建器（纯函数，可复用）
 *
 * 被两个地方共用：
 *   · 周期日历页（CycleCalendarScreen）：雌激素 / 孕激素 各自独立趋势卡
 *   · 洞察页（HormoneDualTrend）：雌激素 + 孕激素「合在一起」的双相趋势图
 *
 * 重要说明：戒指**不直接测量**雌激素 / 孕酮。以下均为「戒指可测信号 → 趋势」的推算，非直接测量：
 *   · 雌激素 —— 戒指实测 HRV（卵泡期较高）+ EDA 皮肤电导（排卵期升高），各自归一化后加权合成；
 *   · 孕激素 —— 戒指实测体温（BBT 双相，排卵后抬升）+ 静息心率（排卵后升高），加权合成。
 * 组合权重与 0–100 归一化是自研启发式；信号基座来自成熟方法/已发表研究（见周期日历页「方法与依据」）。
 */
import {
  computeCycle,
  parseDate,
  tempDailyToSeries,
  detectThermalShift,
  type CycleLog,
  type CyclePhase,
  type CycleInfo,
} from './cycleMath';
import { collectDailyPhysio } from './hormoneInference';
import type { RingState } from '../ble/RingBleManager';

/** 趋势卡的时间跨度（周 / 月 / 季）——比全局 RangeKey 多一个「季」用于多月对比 */
export type TrendRange = 'week' | 'month' | 'quarter';
export const trendDays = (r: TrendRange): number => (r === 'week' ? 7 : r === 'quarter' ? 90 : 30);
export const trendMinPts = (r: TrendRange): number => (r === 'week' ? 3 : r === 'quarter' ? 10 : 5);

/** 取某日期的相位（带体温确认覆盖的 computeCycle） */
export function phaseOfDay(log: CycleLog | null, date: Date, ring: RingState): CyclePhase | 'unknown' {
  if (!log || !log.lastPeriodStart) return 'unknown';
  const info = computeCycle(log, date, {
    tempSeries: Object.keys(ring.tempDaily ?? {}).length
      ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] }))
      : undefined,
    periodHistory: log.history,
  });
  return info.phase;
}

/**
 * 雌激素波动（真实数据版）——基于戒指实测 HRV + EDA（皮肤电导）推算。
 * 依据：① HRV 随周期变化——meta 分析（1,004 名自然月经女性）证实卵泡期→黄体期 HRV 显著下降；
 *      ② EDA 在**排卵期显著升高**（Gómez-Amor 1990, Biol Psychol），与雌激素峰同相。
 *   两者方向一致（卵泡期 / 排卵期偏高），共同反映雌激素主导相位。
 * 戒指不直接测量激素；把所选窗口的 HRV、EDA 各自归一化到 0–100，按 0.6 / 0.4 加权合成趋势。
 */
export function buildEstrogenData(
  ring: RingState,
  range: TrendRange,
): { real: { date: string; value: number }[] | null } {
  const days = trendDays(range); // 周 7 / 月 30 / 季 90
  const minPts = trendMinPts(range);
  const physio = collectDailyPhysio(days);

  const hrvDays = physio.filter((p) => p.hrv != null) as { date: string; hrv: number }[];
  const edaDays = physio.filter((p) => p.eda != null) as { date: string; eda: number }[];
  const rng = (v: number[]) => ({ lo: Math.min(...v), span: Math.max(...v) - Math.min(...v) });
  const hrvN = hrvDays.length >= 2 ? rng(hrvDays.map((p) => p.hrv)) : null;
  const edaN = edaDays.length >= 2 ? rng(edaDays.map((p) => p.eda)) : null;
  if (!hrvN && !edaN) return { real: null };

  const withData = physio.filter((p) => p.hrv != null || p.eda != null);
  if (withData.length < minPts) return { real: null };

  const hrvArr = hrvDays.map((p) => ({ date: p.date, v: p.hrv }));
  const edaArr = edaDays.map((p) => ({ date: p.date, v: p.eda }));
  const smoothAt = (arr: { date: string; v: number }[], date: string) => {
    const i = arr.findIndex((q) => q.date === date);
    if (i < 0) return null;
    const win = arr.slice(Math.max(0, i - 1), i + 2).map((q) => q.v); // 3 日平滑，突出趋势
    return win.reduce((s, x) => s + x, 0) / win.length;
  };

  const real: { date: string; value: number }[] = [];
  for (const p of withData) {
    const parts: { w: number; v: number }[] = [];
    if (p.hrv != null && hrvN && hrvN.span > 0.5) {
      const v = smoothAt(hrvArr, p.date);
      if (v != null) parts.push({ w: 0.6, v: Math.max(0, Math.min(1, (v - hrvN.lo) / hrvN.span)) });
    }
    if (p.eda != null && edaN && edaN.span > 1e-6) {
      const v = smoothAt(edaArr, p.date);
      if (v != null) parts.push({ w: 0.4, v: Math.max(0, Math.min(1, (v - edaN.lo) / edaN.span)) });
    }
    if (parts.length === 0) continue;
    const wsum = parts.reduce((s, x) => s + x.w, 0);
    const value = Math.round((parts.reduce((s, x) => s + x.v * x.w, 0) / wsum) * 100);
    real.push({ date: p.date, value });
  }
  if (real.length < minPts) return { real: null };
  return { real };
}

/**
 * 孕激素波动（真实数据版）——基于戒指实测体温（BBT 双相）+ 静息心率推算。
 * 依据：排卵后孕酮升高 → 基础体温抬升 0.3–0.5°C（symptothermal method）+ 静息心率升高。
 *   大样本研究（Oura 48,720 个周期）证实黄体期体温（ηp²>0.9）与心率（ηp²>0.7）均显著升高，
 *   二者均为孕酮驱动的实测信号（是戒指能测到的最可靠的激素代理）。
 * 戒指不直接测量孕酮；以「体温相对卵泡期基线的抬升（主，权重 0.65）+ 心率抬升（辅，0.35）」
 *   合成 0–100 指数：卵泡期≈低位、排卵后升至高位的黄体相。
 */
export function buildProgesteroneData(
  ring: RingState,
  cycleInfo: CycleInfo | null,
  range: TrendRange,
): { real: { date: string; value: number }[] | null } {
  const days = trendDays(range); // 周 7 / 月 30 / 季 90
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const winEndMs = today0.getTime();
  const winStartMs = winEndMs - (days - 1) * 86_400_000;

  // 体温双相：取基线/高位（真实）
  const allTemp = tempDailyToSeries(ring.tempDaily ?? {})
    .filter((p) => typeof p.temp === 'number' && Number.isFinite(p.temp) && p.temp > 30 && p.temp < 42)
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  const shift = detectThermalShift(allTemp, { threshold: 0.15, minPoints: 12, minSpan: 16 });
  const ovDate = shift?.ovulationDate ?? cycleInfo?.ovulationDate ?? null;
  // 基线：优先用 BBT 双相检测出的卵泡期基线；否则回退到近期体温低位（15 分位）作近似，
  // 使「尚未检测到双相」时也能出趋势线（排卵前应呈低位），而不是整卡空白。
  const tempVals = allTemp.map((p) => p.temp);
  const lowPct = tempVals.length
    ? [...tempVals].sort((a, b) => a - b)[Math.floor(0.15 * (tempVals.length - 1))]
    : null;
  const baseT = shift ? shift.baseline : lowPct;
  const coverT = shift ? shift.coverTemp : baseT != null ? baseT + 0.3 : null;
  const tempUsable = baseT != null && coverT != null && coverT - baseT > 0.05;

  // 静息心率：卵泡期 / 黄体期均值（真实）
  const physio = collectDailyPhysio(days);
  const ovMs = ovDate ? parseDate(ovDate).getTime() : null;
  let rhrFol: number | null = null;
  let rhrLut: number | null = null;
  if (ovMs != null) {
    const fol = physio.filter((p) => p.rhr != null && parseDate(p.date).getTime() < ovMs).map((p) => p.rhr!);
    const lut = physio.filter((p) => p.rhr != null && parseDate(p.date).getTime() >= ovMs).map((p) => p.rhr!);
    if (fol.length >= 3) rhrFol = fol.reduce((a, b) => a + b, 0) / fol.length;
    if (lut.length >= 3) rhrLut = lut.reduce((a, b) => a + b, 0) / lut.length;
  }
  const rhrUsable = rhrFol != null && rhrLut != null && rhrLut - rhrFol > 0.5;

  if (!tempUsable && !rhrUsable) return { real: null };

  // 以本地零点 ms 为 canonical key 合并同一天
  const tempByMs = new Map<number, number>();
  for (const p of allTemp) {
    const ms = parseDate(p.date).getTime();
    if (ms >= winStartMs && ms <= winEndMs) tempByMs.set(ms, p.temp);
  }
  const rhrByMs = new Map<number, number>();
  for (const p of physio) {
    if (p.rhr == null) continue;
    const ms = parseDate(p.date).getTime();
    if (ms >= winStartMs && ms <= winEndMs) rhrByMs.set(ms, p.rhr);
  }

  const keys = Array.from(new Set([...tempByMs.keys(), ...rhrByMs.keys()])).sort((a, b) => a - b);
  const real: { date: string; value: number }[] = [];
  for (const ms of keys) {
    const parts: { w: number; v: number }[] = [];
    const t = tempByMs.get(ms);
    if (t != null && tempUsable) {
      parts.push({ w: 0.65, v: Math.max(0, Math.min(1, (t - baseT!) / (coverT! - baseT!))) });
    }
    const r = rhrByMs.get(ms);
    if (r != null && rhrUsable) {
      parts.push({ w: 0.35, v: Math.max(0, Math.min(1, (r - rhrFol!) / (rhrLut! - rhrFol!))) });
    }
    if (parts.length === 0) continue;
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    const value = Math.round((parts.reduce((s, p) => s + p.v * p.w, 0) / wsum) * 100);
    const dt = new Date(ms);
    real.push({ date: `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`, value });
  }

  if (real.length < trendMinPts(range)) return { real: null };
  return { real };
}
