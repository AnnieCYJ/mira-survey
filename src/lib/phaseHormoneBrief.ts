/**
 * phaseHormoneBrief —— 「生理周期节律」话术的唯一来源
 * ---------------------------------------------------------------------------
 * ★ 2026-11-13（用户）：一键体检报告里雌激素 / 孕激素的分析，要和洞察页
 *   「生理周期节律」卡片底部那段用同一种话术，并且不要写「怎么推算的 / 戒指测不到 /
 *   非化验值 / 与周期日历页同源」这类用户不关心的说明。
 *
 * 话术结构统一为三段（与洞察页 PHASE_BRIEF 完全一致）：
 *   ① 激素现在处于什么情况（低位 / 回升 / 峰值 / 回落 / 主导）
 *   ② 由此带来的身体与情绪状态（分析）
 *   ③ 一条具体可做的建议
 *
 * 两个消费方：
 *   · components/CyclePhaseCard.tsx —— 洞察页卡片底部 AiAnalysis（整段）
 *   · data/quickCheckStore.ts       —— 一键体检报告里雌激素 / 孕激素两条指标的说明
 * 共用同一份相位口径，避免两处各写一套、日后文案漂移。
 */

export interface PhaseBriefItem {
  name: string;
  tone: 'good' | 'warn' | 'neutral';
  body: string;
}

/**
 * 洞察页「生理周期节律」卡片底部的相位解读（三行以内）。
 * 文案原样保留，不改动 —— 这是一键体检报告要对齐的基准话术。
 */
export const PHASE_BRIEF: Record<string, PhaseBriefItem> = {
  period: {
    name: '经期',
    tone: 'warn',
    body: '雌激素与孕酮处于低位，身体进入恢复模式，能量与运动表现偏低，也更容易累。建议降低训练强度、多做拉伸和散步，注意保暖，睡前少看屏幕、把睡眠补足。',
  },
  follicular: {
    name: '卵泡期',
    tone: 'good',
    body: '雌激素逐步回升、HRV 上升，精力与情绪持续变好，恢复能力增强。适合安排高强度训练、重要任务与新的计划，想启动的习惯放在这时候最容易坚持。',
  },
  ovulation: {
    name: '排卵期',
    tone: 'good',
    body: '雌激素达峰值、状态最佳，是运动与决策的黄金窗口，反应和耐力都在线。想冲力量 PR 或处理难任务就选这两天，同时处于易孕期，如有避孕或备孕计划需注意时间安排。',
  },
  luteal: {
    name: '黄体期',
    tone: 'warn',
    body: '孕酮主导、体温升高，能量回落、恢复变慢，PMS 症状较易出现，别用前两周的标准要求自己。建议把高强度换成中等强度有氧，控制糖盐摄入，保证睡眠，重要决定尽量避开经前一周。',
  },
};

export type HormoneKind = 'estrogen' | 'progesterone';

/**
 * 一键体检报告：按当前周期相位，分别描述雌激素 / 孕激素「现在处于什么情况」。
 * 与 PHASE_BRIEF 同源同口径，只是拆成两条指标各自叙述；方向措辞与报告里的
 * 「水平在上升 / 水平在下降 / 水平相对平稳」保持一致，不出现浓度数值。
 */
export const HORMONE_BRIEF: Record<string, Record<HormoneKind, string>> = {
  period: {
    estrogen: '雌激素仍处在低位，身体以休息和恢复为主，精力与运动表现偏低、也更容易累。今天把强度降下来，多做拉伸和散步，把睡眠补足。',
    progesterone: '孕激素也处在低位，体温回落，容易怕冷、觉得沉。注意保暖，睡前少看屏幕，别用平时的标准要求自己。',
  },
  follicular: {
    estrogen: '雌激素逐步回升，精力和情绪跟着变好，恢复能力也在增强。适合把高强度训练、重要任务和想启动的新计划放在这几天。',
    progesterone: '孕激素还在低位，身体轻快、状态一天比一天好。想养成的新习惯趁这时候开始最容易坚持。',
  },
  ovulation: {
    estrogen: '雌激素到达峰值，状态是本月高点，反应和耐力都在线。想冲力量或处理难任务就选这两天。',
    progesterone: '孕激素还没上来，身体仍处在高位窗口，反应和耐力都在线。如有避孕或备孕计划，注意时间安排。',
  },
  luteal: {
    estrogen: '雌激素从峰值回落，状态不像前两周那样顶，恢复也慢一些。把高强度换成中等强度有氧，别硬顶。',
    progesterone: '孕激素主导、体温升高，能量回落，经前更容易闷和嘴馋。控制糖盐、保证睡眠，重要决定尽量避开经前一周。',
  },
};

/** 无相位（未记录经期）时的兜底：仍是「状态 → 分析 → 建议」，不提任何推算方式。 */
export const HORMONE_BRIEF_FALLBACK: Record<HormoneKind, string> = {
  estrogen: '雌激素正处在周期里的变化段，精力和情绪会跟着起伏。顺着当下状态安排强度，连着看几天比盯单次更清楚。',
  progesterone: '孕激素正处在周期里的变化段，体感偏沉、体温略升都常见。把恢复留够，睡前放松，别把日程排太满。',
};

/** 取按相位的激素分析；相位未知时回落兜底文案。 */
export function hormoneBrief(phase: string | null | undefined, kind: HormoneKind): string {
  return HORMONE_BRIEF[phase ?? '']?.[kind] ?? HORMONE_BRIEF_FALLBACK[kind];
}
