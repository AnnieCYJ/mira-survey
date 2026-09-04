/**
 * phaseColors —— 周期四相的统一配色（与 realSeries.TempBiphasicChart / CyclePhaseCard 视觉一致）
 *
 * 周期预测阶段纯日历/体温推算，非硬件实测；配色仅用于「帮助用户理解当前阶段」，
 * 不暗示任何医学结论。
 */
import type { CyclePhase } from './cycleMath';

export type PhaseKey = CyclePhase | 'unknown';

export const PHASE_COLOR: Record<PhaseKey, string> = {
  period: '#e07b6b', // 经期：暖橙红
  follicular: '#7c6ae0', // 卵泡期：主紫
  ovulation: '#6fcfb4', // 排卵期：青绿
  luteal: '#9d8af0', // 黄体期：浅紫
  unknown: '#8a8aa8', // 未记录：灰
};

export const PHASE_LABEL: Record<PhaseKey, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
  unknown: '未记录',
};

/** 半透明背景（日历格子着色用） */
export function phaseBg(phase: PhaseKey, alpha = 0.18): string {
  const hex = PHASE_COLOR[phase];
  // 把 #rrggbb 转 rgba
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
