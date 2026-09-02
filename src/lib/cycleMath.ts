/**
 * cycleMath —— 女性周期推算（纯函数，无副作用、可单测）
 *
 * 算法选型（参考成熟开源实现，非自创）：
 * - 基线：Ogino-Knaus 日历法（Periodical，github.com/arnowelzel/periodical，GPLv3，
 *   F-Droid，485 commits；其 README 明确"更准的方法如测基础体温"）。仅用上次经期 + 周期长度推算。
 * - 排卵期确认：symptothermal 症状体温法的 BBT 双相体温跳升检测（drip.，
 *   com.drip，Bloody Health collective，GPLv3，F-Droid；"用 symptothermal method 检测生育力"）。
 *   戒指测的是皮肤体温（非核心体温），方差更大、双相幅度更小，故阈值与最少天数按皮肤体温放宽。
 * - 周期长度统计：Periodical 式历史均值 ± 标准差（当本地累积 ≥3 次经期记录时启用）。
 *
 * 设计原则：戒指硬件测不了雌激素/LH/相位，只能测皮肤体温（随孕酮波动、排卵后双相升高）。
 * 故相位 = 日历法基线 + 体温跳升确认（若数据充足且可信）。本模块只做算法，不编任何数据。
 */

export interface CycleLog {
  /** 上次经期开始日，格式 'YYYY-M-D'（与 RingBleManager.dayKeyOf 对齐，无前导零） */
  lastPeriodStart: string;
  /** 月经周期长度（天），默认 28 */
  cycleLength: number;
  /** 黄体期长度（排卵→下次经期，天），默认 14 */
  lutealLength: number;
  /** 经期天数，默认 5 */
  periodLength: number;
  /** 历史经期开始日（旧→新），由 cycleLog 累积；≥3 段时用于统计预测（Periodical 均值法） */
  history?: string[];
}

export type CyclePhase = 'period' | 'follicular' | 'ovulation' | 'luteal';

const MS_DAY = 86_400_000;

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 生成与 RingBleManager.dayKeyOf 同款的 key：'YYYY-M-D'（无前导零） */
export function dayKey(d: Date | number): string {
  const dt = typeof d === 'number' ? new Date(d) : d;
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_DAY);
}

/** 单日体温点（date 为 'YYYY-M-D'） */
export interface TempPoint {
  date: string;
  temp: number;
}

/** BBT 双相体温跳升检测结果 */
export interface ThermalShift {
  /** 推断排卵日 ≈ 跳升首日前 1 天（孕酮在排卵后 ~1 天起升高体温） */
  ovulationDate: string;
  /** 卵泡期基线体温（低温相均值） */
  baseline: number;
  /** 黄体期高位体温 */
  coverTemp: number;
  /** 跳升首日在 series 中的下标 */
  shiftIndex: number;
}

export interface CycleInfo {
  hasLog: boolean;
  /** 当前周期第几天（1..cycleLength），无记录为 null */
  dayInCycle: number | null;
  phase: CyclePhase | 'unknown';
  phaseLabel: string;
  /** 排卵日（'YYYY-M-D'） */
  ovulationDate: string | null;
  /** 易孕期窗口起止（排卵前 5 天 ~ 排卵后 1 天） */
  fertilityStart: string | null;
  fertilityEnd: string | null;
  /** 预测的下次经期开始日 */
  nextPeriodDate: string | null;
  daysToNextPeriod: number | null;
  daysToOvulation: number | null;
  /** 体温跳升已确认排卵（symptothermal），覆盖日历法估计 */
  tempConfirmed?: boolean;
  /** 卵泡期基线体温 */
  baselineTemp?: number;
  /** 统计周期长度均值（Periodical 式，history 充足时） */
  cycleLengthMean?: number;
  /** 统计周期长度标准差 */
  cycleLengthStd?: number;
  /** 下次经期置信窗 [早, 晚]（基于均值 ± 标准差） */
  nextPeriodRange?: [string, string] | null;
}

export interface CycleComputeOpts {
  /** 按日期升序的每日体温序列（戒指皮肤体温，°C） */
  tempSeries?: TempPoint[];
  /** 历史经期开始日（旧→新），用于 Periodical 式统计预测 */
  periodHistory?: string[];
}

const PHASE_LABEL: Record<CyclePhase, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
};

/**
 * BBT 双相体温跳升检测（symptothermal method，参考 drip.）。
 * 输入：按日期升序的每日体温序列（°C，戒指皮肤体温）。
 * 规则（稳健版，适配皮肤体温）：
 *  1) 基线 = 序列前 6 个有效低温日的均值（卵泡期为低温相）。
 *  2) 跳升 = 连续 ≥3 天，每日均 ≥ 基线 + THRESHOLD，且第 3 天 ≥ 基线 + 0.10，
 *     且跳升前 1 天低于 基线 + 0.10（形成清晰台阶，抑制单日噪声）。
 *  3) 排卵日 ≈ 跳升首日 − 1 天。
 * 最少数据：≥12 个有效点且跨度 ≥16 天，否则返回 null（不强行结论）。
 */
export function detectThermalShift(
  series: TempPoint[],
  opts: { threshold?: number; minPoints?: number; minSpan?: number } = {},
): ThermalShift | null {
  const TH = opts.threshold ?? 0.15;
  const MIN_POINTS = opts.minPoints ?? 12;
  const MIN_SPAN = opts.minSpan ?? 16;

  const valid = series
    .filter((p) => typeof p.temp === 'number' && Number.isFinite(p.temp) && p.temp > 30 && p.temp < 42)
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  if (valid.length < MIN_POINTS) return null;
  const span = daysBetween(valid[0].date, valid[valid.length - 1].date);
  if (span < MIN_SPAN) return null;

  // 基线：前 6 个有效点均值（卵泡期低温相）
  const baselinePts = valid.slice(0, Math.min(6, valid.length));
  const baseline = baselinePts.reduce((s, p) => s + p.temp, 0) / baselinePts.length;

  // 找跳升：连续 3 天达标，且前一日明显低于基线（清晰台阶）
  for (let i = 1; i < valid.length - 2; i++) {
    const prev = valid[i - 1];
    const a = valid[i];
    const b = valid[i + 1];
    const c = valid[i + 2];
    const stepUp = prev.temp < baseline + 0.1;
    const sustained =
      a.temp >= baseline + TH && b.temp >= baseline + TH && c.temp >= baseline + TH && c.temp >= baseline + 0.1;
    if (stepUp && sustained) {
      return {
        ovulationDate: addDays(a.date, -1),
        baseline,
        coverTemp: (b.temp + c.temp) / 2,
        shiftIndex: i,
      };
    }
  }
  return null;
}

/** 把 tempDaily（Record<'YYYY-M-D', 日均体温>）规整为升序体温序列 */
export function tempDailyToSeries(tempDaily: Record<string, number>): TempPoint[] {
  return Object.keys(tempDaily)
    .map((d) => ({ date: d, temp: tempDaily[d] }))
    .filter((p) => typeof p.temp === 'number' && Number.isFinite(p.temp));
}

export function computeCycle(
  log: CycleLog | null,
  today: Date = new Date(),
  opts: CycleComputeOpts = {},
): CycleInfo {
  const tKey = dayKey(today);
  if (!log || !log.lastPeriodStart) {
    return {
      hasLog: false,
      dayInCycle: null,
      phase: 'unknown',
      phaseLabel: '未记录',
      ovulationDate: null,
      fertilityStart: null,
      fertilityEnd: null,
      nextPeriodDate: null,
      daysToNextPeriod: null,
      daysToOvulation: null,
    };
  }

  // 1) 有效周期长度：统计历史均值（Periodical 法）优先，否则用记录值
  let cycleLength = Math.max(20, Math.min(45, Math.round(log.cycleLength || 28)));
  let cycleLengthMean: number | undefined;
  let cycleLengthStd: number | undefined;
  let nextPeriodRange: [string, string] | null = null;

  const hist =
    opts.periodHistory && opts.periodHistory.length >= 3
      ? opts.periodHistory.slice().sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime())
      : null;
  if (hist) {
    const lens: number[] = [];
    for (let i = 1; i < hist.length; i++) lens.push(Math.abs(daysBetween(hist[i - 1], hist[i])));
    const validLens = lens.filter((l) => l >= 15 && l <= 60);
    if (validLens.length >= 2) {
      const mean = validLens.reduce((s, l) => s + l, 0) / validLens.length;
      const variance = validLens.reduce((s, l) => s + (l - mean) ** 2, 0) / validLens.length;
      const std = Math.sqrt(variance);
      cycleLengthMean = Math.round(mean);
      cycleLengthStd = Math.round(std);
      cycleLength = Math.max(20, Math.min(45, cycleLengthMean));
      const last = hist[hist.length - 1];
      nextPeriodRange = [
        addDays(last, Math.max(20, Math.round(mean - std))),
        addDays(last, Math.min(45, Math.round(mean + std))),
      ];
    }
  }

  const luteal = Math.max(9, Math.min(20, Math.round(log.lutealLength || 14)));
  const periodLen = Math.max(2, Math.min(10, Math.round(log.periodLength || 5)));

  let offset = daysBetween(log.lastPeriodStart, tKey);
  // 若上次经期在未来（误输入），回退到一个周期内
  if (offset < 0) offset = ((offset % cycleLength) + cycleLength) % cycleLength;

  const dayInCycle = (offset % cycleLength) + 1;

  // 2) 日历法排卵日（基线）
  const calOvulationDate = addDays(log.lastPeriodStart, cycleLength - luteal);

  // 3) 体温跳升确认排卵（symptothermal），仅在可信时覆盖
  let ovulationDate = calOvulationDate;
  let tempConfirmed = false;
  let baselineTemp: number | undefined;
  if (opts.tempSeries && opts.tempSeries.length) {
    const shift = detectThermalShift(opts.tempSeries);
    if (shift) {
      const calOff = daysBetween(shift.ovulationDate, calOvulationDate);
      const shiftInPast = daysBetween(shift.ovulationDate, tKey) >= 0;
      // 信任条件：跳升排卵在日历估计 ±9 天内（抑制皮肤体温噪声误判），且已发生（≤今天）
      if (shiftInPast && Math.abs(calOff) <= 9) {
        ovulationDate = shift.ovulationDate;
        tempConfirmed = true;
        baselineTemp = shift.baseline;
      }
    }
  }

  const fertilityStart = addDays(ovulationDate, -5);
  const fertilityEnd = addDays(ovulationDate, 1);

  // 阶段判定（优先级：经期 > 排卵期窗口 > 黄体期 > 卵泡期），用最终 ovulationDate
  let phase: CyclePhase;
  if (offset >= 0 && offset < periodLen) phase = 'period';
  else if (Math.abs(daysBetween(ovulationDate, tKey)) <= 2) phase = 'ovulation';
  else if (daysBetween(ovulationDate, tKey) > 0) phase = 'luteal';
  else phase = 'follicular';

  // 下次经期：从 lastPeriodStart 累加 cycleLength 直到落在今天之后
  let next = log.lastPeriodStart;
  while (daysBetween(next, tKey) >= 0) next = addDays(next, cycleLength);
  const daysToNextPeriod = daysBetween(tKey, next);
  const daysToOvulation = daysBetween(tKey, ovulationDate);

  return {
    hasLog: true,
    dayInCycle,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    ovulationDate,
    fertilityStart,
    fertilityEnd,
    nextPeriodDate: next,
    daysToNextPeriod,
    daysToOvulation,
    tempConfirmed,
    baselineTemp,
    cycleLengthMean,
    cycleLengthStd,
    nextPeriodRange,
  };
}
