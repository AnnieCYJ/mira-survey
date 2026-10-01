/**
 * cycleNutrition —— 基于周期阶段的「热量 / 宏量 / 营养重点」参考目标
 *
 * ⚠️ 诚实口径：以下数值为**通用参考值**（女性日常摄入的常用区间），
 *   并非按你的身高/体重/活动量个性化计算，也非医学处方。
 *   仅用于「把饮食建议和当前周期阶段关联起来」，帮助你理解身体节律。
 *
 * 阶段划分来自 cycleMath 的日历/体温推算（phaseOfDay），与全 App 同源。
 * 数值依据（常见营养学共识，非本 App 实测）：
 *   · 黄体期孕酮升高 → BMR/TDEE 上行（大样本研究见 cycleDerived 注释），热量目标略增；
 *   · 经期失血 → 铁流失，重点补铁 + 维C；活动量常偏低，目标略降；
 *   · 排卵期雌激素达峰、代谢活跃 → 目标略增、注意补水与抗氧化；
 *   · 卵泡期代谢平稳 → 维持平时基准。
 */

import { PHASE_LABEL } from './phaseColors';
import type { PhaseKey } from './phaseColors';

export interface PhaseNutritionTarget {
  phase: PhaseKey;
  label: string;
  /** 阶段热量目标（kcal，通用参考值） */
  kcal: number;
  /** 阶段宏量目标（克，通用参考值） */
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** 相对「平时基准 1800」的偏差说明 */
  kcalNote: string;
  /** 本阶段建议重点补充的营养（中文短语） */
  focus: string[];
  /** 本阶段建议少碰 / 注意 */
  avoid: string[];
  /** 一句话阶段说明 */
  note: string;
}

const BASE = 1800;

export const PHASE_NUTRITION: Record<PhaseKey, PhaseNutritionTarget> = {
  period: {
    phase: 'period', label: PHASE_LABEL.period,
    kcal: 1750, proteinG: 60, carbsG: 205, fatG: 58,
    kcalNote: '经期活动量通常偏低，目标比平时少约 50 kcal',
    focus: ['铁（红肉 / 动物血 / 深绿菜）', '维C（柑橘 · 猕猴桃 · 青椒）', '温润软食（粥 · 汤面 · 蒸菜）'],
    avoid: ['过量咖啡因（咖啡 · 浓茶）', '生冷刺激（冰饮 · 生鱼片）'],
    note: '经期失血带来铁流失，优先把铁补上；食欲若下降不必硬凑热量。',
  },
  follicular: {
    phase: 'follicular', label: PHASE_LABEL.follicular,
    kcal: 1800, proteinG: 60, carbsG: 210, fatG: 60,
    kcalNote: '雌激素回升、代谢平稳，维持平时目标即可',
    focus: ['均衡三餐（谷薯 · 蛋奶 · 蔬果）', '优质蛋白（鱼 · 蛋 · 豆制品）', '膳食纤维（燕麦 · 菌菇 · 绿叶菜）'],
    avoid: [],
    note: '卵泡期身体状态较稳，按计划吃、保持均衡饮食就好。',
  },
  ovulation: {
    phase: 'ovulation', label: PHASE_LABEL.ovulation,
    kcal: 1850, proteinG: 64, carbsG: 218, fatG: 62,
    kcalNote: '排卵前后能量与活动偏高，目标比平时多约 50 kcal',
    focus: ['叶酸（深绿菜 · 豆类 · 肝）', '抗氧化物（莓果 / 番茄）', '充足饮水（每天约 1.5–2L）'],
    avoid: ['高盐（腌制品 · 酱菜 · 加工肉）'],
    note: '排卵期雌激素达峰、代谢活跃，注意补水与抗氧化。',
  },
  luteal: {
    phase: 'luteal', label: PHASE_LABEL.luteal,
    kcal: 1980, proteinG: 72, carbsG: 232, fatG: 66,
    kcalNote: '黄体期孕酮升高使代谢略升，目标比平时多约 180 kcal',
    focus: ['镁（坚果 / 深绿菜）', '维B6（鸡肉 · 香蕉 · 土豆）', '钙（奶 · 豆腐 · 小鱼干）', '复合碳水（燕麦 · 红薯 · 糙米）'],
    avoid: ['高盐高糖（甜点 · 含糖饮料 · 腌制品）', '过量咖啡因（咖啡 · 浓茶 · 可乐）'],
    note: '黄体期代谢上行、碳水渴望增强，用复合碳水 + 蛋白质顶住饱腹，少碰甜食。',
  },
  unknown: {
    phase: 'unknown', label: PHASE_LABEL.unknown,
    kcal: BASE, proteinG: 60, carbsG: 210, fatG: 60,
    kcalNote: '未记录经期，按通用参考目标',
    focus: ['均衡饮食（谷薯 · 蛋奶 · 蔬果 · 肉鱼）'],
    avoid: [],
    note: '记录经期后可按周期阶段给出更贴合的热量与营养建议。',
  },
};

export function cycleNutritionTarget(phase: PhaseKey): PhaseNutritionTarget {
  return PHASE_NUTRITION[phase] ?? PHASE_NUTRITION.unknown;
}

export interface TodayIntake {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * 基于周期阶段，对今日摄入做一段简短评估（人话、≤3 行）。
 * 不诊断、不评分，只给对照与阶段提醒。
 */
export function evaluateAgainstPhase(target: PhaseNutritionTarget, intake: TodayIntake): string[] {
  const out: string[] = [];
  if (intake.kcal <= 0) {
    out.push(`本阶段建议目标约 ${target.kcal} kcal，记录餐食后会自动对比。`);
    return out;
  }
  const remain = target.kcal - intake.kcal;
  if (remain > 0) {
    out.push(`距本阶段目标还差约 ${remain} kcal（已摄入 ${intake.kcal}/${target.kcal}）。`);
  } else {
    out.push(`已接近本阶段热量目标（${intake.kcal}/${target.kcal} kcal），注意别超太多。`);
  }
  const pGap = Math.round(target.proteinG - intake.proteinG);
  if (pGap > 8) out.push(`蛋白质还差约 ${pGap}g（本阶段建议 ${target.proteinG}g）。`);
  if (target.phase === 'period') {
    out.push('经期重点补铁：今天可安排红肉、动物血或深绿菜，配维C更好吸收。');
  } else if (target.phase === 'luteal') {
    out.push('黄体期碳水渴望强，优先选燕麦 / 薯类 / 全麦等复合碳水，少碰甜食。');
  } else if (target.phase === 'ovulation') {
    out.push('排卵期多喝水、补叶酸和抗氧化物，状态会更稳。');
  }
  return out.slice(0, 3);
}
