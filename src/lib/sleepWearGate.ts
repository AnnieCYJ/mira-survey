/**
 * 睡眠非佩戴伪影闸门 —— ★ 2026-11-26（用户拍板 B 方案）
 *
 * 背景（真机事实）：用户 11-25 夜间没有佩戴基础版戒指，但同步上来一条
 * 「01:06 → 11:10 / 10h04m」的睡眠摘要，睡眠效率 97%（整夜静止 = 无夜醒），
 * 夜间 HRV / 血氧逐样本全缺，夜间 HR 52 也不可信。戒指端把「长时间静置」
 * 误判成睡眠，App 如实显示后污染了睡眠恢复分与 14 天个人基线。
 *
 * 判定纪律（严格双条件，避免误杀真实睡眠）：
 *   ① 总睡眠 > 9.5h（570min）—— 普通夜不会被误判；
 *   ② 真实睡眠窗口内 HRV 逐样本数 = 0 且 SpO2 逐样本数 = 0 —— 真戴着手睡觉必有。
 * 两条同时成立才判为非佩戴伪影；只满足其一（例如真睡 10h 但生理采样齐全）一律放行。
 *
 * 数据来源：computeNightPhys 直接读 healthStore.intraday 的逐样本，不拿全天日均兜底，
 * 因此不会因为白天有 HRV/血氧读数就误判为「已佩戴」。
 */
import type { SleepSummary } from '../data/healthStore';
import { computeNightPhys } from './nightPhysiology';

/** 超过该时长才进入非佩戴嫌疑区（分钟） */
export const NON_WEAR_MAX_TOTAL_MIN = 570;

export interface NonWearCheck {
  /** 是否非佩戴伪影 */
  nonWear: boolean;
  /** 触发检查的原因，供日志/诊断，不直接展示给用户 */
  reason: string;
  counts: { hr: number; hrv: number; spo2: number };
}

/**
 * 判定某一天的睡眠摘要是否为「非佩戴伪影」。
 * @param dk 归档日 key（YYYY-M-D，按起床日归档）
 */
export function checkSleepWear(dk: string, s: SleepSummary | null | undefined): NonWearCheck {
  const total = Number(s?.total ?? 0);
  const counts = { hr: 0, hrv: 0, spo2: 0 };
  if (!Number.isFinite(total) || total <= NON_WEAR_MAX_TOTAL_MIN) {
    return { nonWear: false, reason: 'total<=570min', counts };
  }
  try {
    const phys = computeNightPhys(dk, {
      sleepTime: s?.sleepTime,
      wakeTime: s?.wakeTime,
      totalMin: total,
    });
    counts.hr = phys.counts.hr;
    counts.hrv = phys.counts.hrv;
    counts.spo2 = phys.counts.spo2;
    const nonWear = phys.counts.hrv === 0 && phys.counts.spo2 === 0;
    return {
      nonWear,
      reason: nonWear
        ? `total=${Math.round(total)}min>570 且夜间 HRV/SpO2 逐样本均为 0（HR=${phys.counts.hr}）`
        : `total=${Math.round(total)}min>570 但夜间有生理样本（HR ${phys.counts.hr}/HRV ${phys.counts.hrv}/SpO2 ${phys.counts.spo2}）`,
      counts,
    };
  } catch {
    return { nonWear: false, reason: '夜间生理计算异常，保守放行', counts };
  }
}
