/**
 * cortisolRhythm.ts —— 皮质醇昼夜节律分析（开源算法，纯前端 TS）
 *
 * 算法来源（均已发表 / 开源，本模块为独立 TS 实现，可直接在 App 端运行）：
 *  - Cosinor 余弦节律拟合：https://github.com/Mathias-Fuchs/CosinorPy
 *  - CortSineScore (CSS)：Anza et al. 2025, https://github.com/simone-anza/CortSineScore
 *  - 个人基线：14 天滚动 P25 / P75（相对追踪，因输入为压力代理而非化验级皮质醇）
 *
 * 输入：戒指皮质醇代理值 { t: epochMs, v: μg/L }（调用方负责剔除 GSR 零值）。
 * 输出：MESOR / 振幅 / 峰值时刻(acrophase) / CSS / 个人基线 / 状态（持续偏高 / 紊乱 / 正常）。
 *
 * 说明（与前面结论一致）：戒指给的皮质醇是 Veepoo 固件用「交感 + 昼夜模板」合成的代理值，
 * 不是化验级激素读数。本模块在代理值上做节律分析，呈现趋势/偏高/紊乱，并在 UI 标注「压力代理」。
 */
export interface CortisolSample { t: number; v: number }
export interface CosinorResult { mesor: number; amplitude: number; acrophaseH: number; r2: number; n: number }
export type RhythmLevel = 'normal' | 'sustained_high' | 'dysregulated';
export interface RhythmStatus { level: RhythmLevel; flags: string[] }
export interface CortisolRhythmResult {
  cosinor: CosinorResult;
  css: number;
  baseline: { p25: number; p75: number; n: number };
  hourlyMean: (number | null)[];
  /** 哪些小时是用 cosinor 拟合填补的 (true=原本无数据, 模型预测) */
  hourlyPredicted: boolean[];
  dailyMesors: { date: string; mesor: number }[];
  status: RhythmStatus;
  sustainedHighStreak: number;
}

const PERIOD_H = 24;
const TWO_PI = Math.PI * 2;

/** 本地小时（含分钟小数），用于昼夜节律相位，对齐用户所在时区。 */
function localHour(t: number): number {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
}
function dayKeyOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = (sorted.length - 1) * p, f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

/**
 * 单频 cosinor 最小二乘回归：y = MESOR + β·cos(wt) + γ·sin(wt)
 *  - MESOR：节律中值（≈ 全天平均线，反映整体水平）
 *  - amplitude：振幅（昼夜波动幅度，过低=节律扁平）
 *  - acrophaseH：峰值时刻（小时，正常约 06–10 点）
 */
export function fitCosinor(samples: CortisolSample[]): CosinorResult {
  const valid = samples.filter((s) => Number.isFinite(s.v) && s.v > 0);
  const n = valid.length;
  if (n < 4) return { mesor: NaN, amplitude: NaN, acrophaseH: NaN, r2: 0, n };
  const hours = valid.map((s) => localHour(s.t));
  const w = TWO_PI / PERIOD_H;
  const cosT = hours.map((h) => Math.cos(w * h));
  const sinT = hours.map((h) => Math.sin(w * h));
  const y = valid.map((s) => s.v);
  const mean = (a: number[]) => a.reduce((x, y2) => x + y2, 0) / a.length;
  const my = mean(y), mc = mean(cosT), ms = mean(sinT);
  let sCC = 0, sSS = 0, sCS = 0, sYC = 0, sYS = 0;
  for (let i = 0; i < n; i++) {
    const dc = cosT[i] - mc, ds = sinT[i] - ms, dy = y[i] - my;
    sCC += dc * dc; sSS += ds * ds; sCS += dc * ds; sYC += dc * dy; sYS += ds * dy;
  }
  const det = sCC * sSS - sCS * sCS;
  if (det === 0) return { mesor: my, amplitude: 0, acrophaseH: NaN, r2: 0, n };
  const beta = (sSS * sYC - sCS * sYS) / det;
  const gamma = (sCC * sYS - sCS * sYC) / det;
  const mesor = my;
  const amplitude = Math.sqrt(beta * beta + gamma * gamma);
  let acro = Math.atan2(gamma, beta) / w;
  if (acro < 0) acro += PERIOD_H;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = mesor + beta * cosT[i] + gamma * sinT[i];
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  return { mesor, amplitude, acrophaseH: acro, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, n };
}

/**
 * CortSineScore：Σ yᵢ·sin(2π·tᵢ/24)
 *  正 = 晨型正常（晨高夜低）；负 = 晚间偏移 / 倒置；≈0 = 节律扁平（无昼夜差异）。
 */
export function cortisolSineScore(samples: CortisolSample[]): number {
  const valid = samples.filter((s) => Number.isFinite(s.v) && s.v > 0);
  if (valid.length < 4) return NaN;
  let sum = 0;
  for (const s of valid) sum += s.v * Math.sin(TWO_PI * localHour(s.t) / PERIOD_H);
  return sum;
}

/** 按本地小时聚合，返回长度 24 的均值数组（无数据 = null），用于 24h 柱图。 */
export function aggregateByHour(samples: CortisolSample[]): (number | null)[] {
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  for (const s of samples) {
    if (!Number.isFinite(s.v) || s.v <= 0) continue;
    const h = Math.floor(localHour(s.t)) % 24;
    buckets[h].push(s.v);
  }
  return buckets.map((b) => (b.length ? b.reduce((x, y) => x + y, 0) / b.length : null));
}

function dayMean(arr: CortisolSample[]): number {
  const v = arr.filter((s) => Number.isFinite(s.v) && s.v > 0).map((s) => s.v);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
}

/** 主分析：节律拟合 + 个人基线 + 状态判定。 */
export function analyzeCortisol(samples: CortisolSample[], baselineDays = 14): CortisolRhythmResult {
  const raw = samples.filter((s) => Number.isFinite(s.v) && s.v > 0);
  if (raw.length < 4) {
    return {
      cosinor: { mesor: NaN, amplitude: NaN, acrophaseH: NaN, r2: 0, n: raw.length },
      css: NaN,
      baseline: { p25: NaN, p75: NaN, n: 0 },
      hourlyMean: [],
      hourlyPredicted: [],
      dailyMesors: [],
      status: { level: 'normal', flags: ['数据不足，需至少 4 个样本以拟合节律'] },
      sustainedHighStreak: 0,
    };
  }

  const hourly = aggregateByHour(raw);

  // 按天聚合日均值（用于个人基线与「持续偏高」判定，使用原始值）
  const byDay = new Map<string, CortisolSample[]>();
  for (const s of raw) {
    const k = dayKeyOf(s.t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  const dailyMesors = Array.from(byDay.entries())
    .map(([date, arr]) => ({ date, mesor: dayMean(arr) }))
    .filter((d) => Number.isFinite(d.mesor))
    .sort((a, b) => a.date.localeCompare(b.date));
  const mv = dailyMesors.map((d) => d.mesor).sort((a, b) => a - b);
  const p25 = percentile(mv, 0.25);
  const p75 = percentile(mv, 0.75);
  const baseline = { p25, p75, n: mv.length };
  const overallMean = mv.reduce((x, y) => x + y, 0) / mv.length;

  // 直接在原始值上做 cosinor：时间戳为本地 epoch，localHour 取本地小时，
  // 振幅/峰值时刻在本地时区下即正确；多日趋势主要表现为 MESOR 漂移，已被「持续偏高」分支覆盖。
  const cos = fitCosinor(raw);
  const css = cortisolSineScore(raw);

  // ★ 用 cosinor 预测曲线填补缺数时段 (睡眠等) — 这样 24h 柱图是完整的
  // pred(h) = mesor + amplitude·cos(2π·(h - acrophaseH)/24)
  const hourlyPredicted: boolean[] = hourly.map((v) => v == null);  // 先记录哪些原本是空的
  const cosPred = (h: number): number | null => {
    if (!Number.isFinite(cos.mesor) || !Number.isFinite(cos.amplitude) || cos.amplitude <= 0 || !Number.isFinite(cos.acrophaseH)) return null;
    const v = cos.mesor + cos.amplitude * Math.cos(TWO_PI * (h - cos.acrophaseH) / PERIOD_H);
    return Math.max(0, Math.round(v * 10) / 10);  // 不允许负值, 保留 1 位
  };
  for (let h = 0; h < 24; h++) {
    if (hourly[h] == null) {
      const pred = cosPred(h);
      if (pred != null) hourly[h] = pred;
    }
  }

  const flags: string[] = [];
  let level: RhythmLevel = 'normal';
  let streak = 0, maxStreak = 0;
  for (const d of dailyMesors) {
    if (Number.isFinite(p75) && d.mesor > p75) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  if (maxStreak >= 3) {
    level = 'sustained_high';
    flags.push(`连续 ${maxStreak} 天皮质醇（压力）水平持续偏高`);
  }

  // 振幅/相位只看日内形状：扁平 = 振幅 < 15% 日均；错位 = 峰值不在 06–10 点且确有节律
  const ampLow = dailyMesors.length >= 3 && Number.isFinite(cos.amplitude) && cos.amplitude < 0.15 * overallMean;
  const hasRhythm = Number.isFinite(cos.amplitude) && cos.amplitude >= 0.1 * overallMean;
  const phaseOff = hasRhythm && Number.isFinite(cos.acrophaseH) && (cos.acrophaseH < 6 || cos.acrophaseH > 11);
  const cssFlat = Number.isFinite(css) && Math.abs(css) < 1e-6;
  if (ampLow || phaseOff || cssFlat) {
    if (level === 'normal') level = 'dysregulated';
    if (ampLow || cssFlat) flags.push('昼夜节律扁平（振幅过低 / CSS≈0）');
    if (phaseOff) flags.push(`峰值时刻错位（${cos.acrophaseH.toFixed(1)} 点，正常约 06–10 点）`);
  }
  if (level === 'normal' && flags.length === 0) flags.push('节律正常（压力代理，仅供参考）');
  return { cosinor: cos, css, baseline, hourlyMean: hourly, hourlyPredicted, dailyMesors, status: { level, flags }, sustainedHighStreak: maxStreak };
}
