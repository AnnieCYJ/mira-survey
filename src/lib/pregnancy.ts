/**
 * pregnancy.ts —— 孕期推算（P1-1，2026-10-28）
 *
 * ★ 权威性（遵循产科通用约定，不另造轮子）：
 *   · 孕周以「末次经期（LMP）」为基准（国际产科惯例，所有孕周/预产期均从 LMP 起算）。
 *   · 预产期：Naegele 规则 = LMP + 280 天（40 周）。
 *   · 孕三七分：第一孕期 1–13 周、第二孕期 14–27 周、第三孕期 28–40 周（可延至 42）。
 *   · 参考：ACOG / WHO 孕周与 trilabel 划分；与 Oura 孕期叙事同口径（Oura 也是 LMP 起算 + 三孕期）。
 *
 * ★ 与 Oura 对标：Oura 孕期洞察 = 受孕窗 + 孕期周数 + 各孕期健康提示；本模块覆盖「孕周 / 三孕期 / 预产期」。
 *
 * ★ 诚实闸门：未开启孕期或没填 LMP → enough=false，不展示。结果不构成医学诊断。
 */
import { parseDate } from './cycleMath';

export interface PregnancyInfo {
  /** 受孕/孕周（整周） */
  weeks: number;
  /** 当周第几天（0-6） */
  days: number;
  /** 距 LMP 总天数 */
  totalDays: number;
  /** 三孕期：first / second / third */
  trimester: 'first' | 'second' | 'third' | null;
  /** 预产期（可读日期） */
  dueDate: string | null;
  /** 进度（totalDays / 280，0–1） */
  progressPct: number | null;
  enough: boolean;
}

const MS_DAY = 86_400_000;
const GESTATION_DAYS = 280; // 40 周

export function computePregnancy(lmpDate?: string, pregnant?: boolean, nowMs: number = Date.now()): PregnancyInfo {
  const base: PregnancyInfo = {
    weeks: 0, days: 0, totalDays: 0, trimester: null, dueDate: null, progressPct: null, enough: false,
  };
  if (!pregnant || !lmpDate) return base;
  let lmp: Date;
  try {
    lmp = parseDate(lmpDate);
  } catch {
    return base;
  }
  const totalDays = Math.max(0, Math.floor((nowMs - lmp.getTime()) / MS_DAY));
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  const trimester: PregnancyInfo['trimester'] =
    weeks <= 13 ? 'first' : weeks <= 27 ? 'second' : 'third';
  const dueMs = lmp.getTime() + GESTATION_DAYS * MS_DAY;
  const due = new Date(dueMs);
  const dueDate = `${due.getFullYear()}-${due.getMonth() + 1}-${due.getDate()}`;
  const progressPct = Math.min(1, totalDays / GESTATION_DAYS);
  return { weeks, days, totalDays, trimester, dueDate, progressPct, enough: true };
}

export const TRIMESTER_LABEL: Record<NonNullable<PregnancyInfo['trimester']>, string> = {
  first: '第一孕期（1–13 周）',
  second: '第二孕期（14–27 周）',
  third: '第三孕期（28 周+）',
};

/** 各孕期健康提示（权威孕期保健常识，参考 ACOG 各孕期重点） */
export const TRIMESTER_TIPS: Record<NonNullable<PregnancyInfo['trimester']>, string[]> = {
  first: [
    '补充叶酸（400–800 μg/日），避免烟酒与高汞鱼类',
    '孕早期易疲劳、恶心，保证休息与少量多餐',
    '如出现剧烈腹痛或出血，及时就医',
  ],
  second: [
    '孕中期相对舒适，可适度低强度运动（散步 / 孕妇瑜伽）',
    '关注胎动规律，按时完成唐筛 / 大排畸等产检',
    '注意铁与钙的摄入，预防贫血',
  ],
  third: [
    '数胎动、监测血压，警惕妊娠高血压信号',
    '准备待产包，了解临产征兆',
    '睡眠侧卧、控制体重增速，规律产检',
  ],
};
