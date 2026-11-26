/**
 * 睡眠非佩戴伪影闸门 —— ★ 2026-11-26 v118 判据定稿
 *
 * 【判据演进（真机事实）】
 * - v117：夜间 HRV/SpO2 逐样本全 0 → 判非佩戴。清掉了 11-25（10h04m）。
 * - v118 中途曾误改成「全天 HR/EDA 有值即佩戴」，把 11-25 恢复了 —— 错。
 *   真机 dump 事实：11-25 全天 HR=23 EDA=25，但**夜间 SpO2=0**；这些 HR/EDA
 *   来自白天佩戴，混进了 01:06–11:10 的伪睡眠窗口，不代表那晚戴着。
 * - 定稿：以「真实睡眠窗口内的 SpO2 逐样本数」为主判据。
 *   真睡觉血氧传感器持续出数（对照：11-26 真睡眠夜间 SpO2=313）；
 *   戒指摘下静置则整夜 SpO2=0。HRV 可作补充但基础版上报不稳，不单独依赖。
 *
 * 判定：总睡眠 > 9.5h 且睡眠窗口内 SpO2=0（且 HRV=0）→ 非佩戴伪影。
 * 任一有逐样本一律放行，避免误杀真睡眠。短睡眠（<=570min）不判非佩戴。
 */
import type { SleepSummary } from '../data/healthStore';
import { computeNightPhys } from './nightPhysiology';

/** 超过该时长才进入非佩戴嫌疑区（分钟）—— 短午睡不做非佩戴判定 */
export const NON_WEAR_MAX_TOTAL_MIN = 570;

export interface NonWearCheck {
  nonWear: boolean;
  reason: string;
  counts: { hr: number; hrv: number; spo2: number };
}

/**
 * 判定某一天的睡眠摘要是否为「非佩戴伪影」。
 * @param dk 归档日 key（YYYY-MM-DD，按起床日归档）
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
    // ★ 主判据：睡眠窗口内 SpO2 与 HRV 逐样本。基础版夜间 SpO2 稳定上报（真睡眠 313 点），
    //   摘下静置整夜为 0。用窗口内样本而非全天计数，避免白天佩戴的 HR/EDA 混入窗口误判。
    const nonWear = phys.counts.spo2 === 0 && phys.counts.hrv === 0;
    return {
      nonWear,
      reason: nonWear
        ? `total=${Math.round(total)}min>570 且夜间 SpO2/HRV 逐样本均为 0（HR=${phys.counts.hr}）→ 非佩戴伪影`
        : `total=${Math.round(total)}min>570 但夜间有生理样本（SpO2=${phys.counts.spo2}/HRV=${phys.counts.hrv}/HR=${phys.counts.hr}）→ 真睡眠，放行`,
      counts,
    };
  } catch {
    return { nonWear: false, reason: '夜间生理计算异常，保守放行', counts };
  }
}
