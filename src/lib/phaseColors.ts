/**
 * phaseColors —— 周期四相的统一配色（唯一来源，全 App 同相位同色）
 *
 * 四色明确区分，且色值全部引用 design token（theme.colors），本文件不再出现裸 hex：
 *   经期 = 珊瑚 danger / 卵泡期 = 蓝 accent2 / 排卵期 = 青绿 stateCalm / 黄体期 = 紫 accent1。
 * 体温双相曲线、激素趋势卡、日历网格、月相环共用这一套，避免「卵泡期 / 黄体期」两处两个色。
 *
 * 周期阶段为日历 / 体温推算，非硬件实测；配色仅用于帮助理解阶段，不暗示医学结论。
 */
import { theme } from '../theme/theme';
import type { CyclePhase } from './cycleMath';

export type PhaseKey = CyclePhase | 'unknown';

export const PHASE_COLOR: Record<PhaseKey, string> = {
  period: theme.colors.danger, // 经期：珊瑚
  follicular: theme.colors.accent2, // 卵泡期：蓝
  ovulation: theme.colors.stateCalm, // 排卵期：青绿
  luteal: theme.colors.accent1, // 黄体期：紫
  unknown: theme.colors.textSub, // 未记录：灰
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

/** 图表阶段背景带的透明度（体温双相 / 激素趋势共用；排卵期略深以突出） */
const PHASE_BAND_ALPHA: Record<PhaseKey, number> = {
  period: 0.14,
  follicular: 0.14,
  ovulation: 0.2,
  luteal: 0.16,
  unknown: 0.06,
};

/** 图表阶段背景带颜色（与 phaseBg 同源，按相位调透明度） */
export function phaseBand(phase: PhaseKey): string {
  return phaseBg(phase, PHASE_BAND_ALPHA[phase]);
}

/** 图例顺序：与体温双相 / 趋势卡的色带顺序一致 */
export const PHASE_ORDER: PhaseKey[] = ['period', 'follicular', 'ovulation', 'luteal'];
