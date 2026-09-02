/**
 * cycleMath —— 女性周期推算（纯函数，无副作用、可单测）
 *
 * 设计原则：戒指硬件只能测皮肤体温（随激素波动、排卵后双相升高）；
 * 雌激素/孕激素/LH、排卵期、经期预测本身不是戒指直测，需要「用户记录上次经期」
 * + 「基于体温趋势与标准周期模型的算法」推算。本模块只做算法，不编任何数据。
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
}

const PHASE_LABEL: Record<CyclePhase, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
};

export function computeCycle(log: CycleLog | null, today: Date = new Date()): CycleInfo {
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

  const cycleLength = Math.max(20, Math.min(45, log.cycleLength || 28));
  const luteal = Math.max(9, Math.min(20, log.lutealLength || 14));
  const periodLen = Math.max(2, Math.min(10, log.periodLength || 5));

  let offset = daysBetween(log.lastPeriodStart, tKey);
  // 若上次经期在未来（误输入），回退到一个周期内
  if (offset < 0) offset = ((offset % cycleLength) + cycleLength) % cycleLength;

  const dayInCycle = (offset % cycleLength) + 1;
  const ovulationOffset = cycleLength - luteal; // 排卵日 = 周期第 (cycleLength-luteal) 天
  const ovulationDate = addDays(log.lastPeriodStart, ovulationOffset);
  const fertilityStart = addDays(ovulationDate, -5);
  const fertilityEnd = addDays(ovulationDate, 1);

  // 阶段判定（优先级：经期 > 排卵期窗口 > 黄体期 > 卵泡期）
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
  };
}
