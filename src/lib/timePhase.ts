/**
 * timePhase —— 首页「一天叙事弧」的统一时段定义（2026-10-13）
 *
 * 用户定稿的诉求：首页圆环下方的 AI 分析、以及底部气泡建议，必须**跟当前时间对得上**——
 * 晚上不能讲早晨的事、早晨不能讲睡前的事。并且整条叙事要沿着一天的自然节奏走：
 *
 *  · 早晨（醒来后）     → 昨晚睡眠恢复得怎么样 + 今天一整天的能量状态
 *  · 上午（尾段）       → 现在的脑力准备度 + 预测的高峰时段，把难任务放高峰做
 *  · 临近中午 / 午饭    → 这顿饭的营养，结合周期阶段给一句饮食小提示
 *  · 午后（午休后）     → 当前状态，若有压力/消耗偏大就说一下，以及雌激素/孕激素的变化
 *  · 傍晚（收工）       → 收工放松、轻量休息，别把事都堆到晚上
 *  · 睡前               → 护肤休息、怎么睡好，睡好明天能量才稳
 *
 * 该模块同时被「圆环下叙事」（aiNarrative）与「气泡建议」（aiSuggestion / suggestionEngine）
 * 复用 —— 两者都吃同一个 dayPhase，保证**叙事与建议在同一时段讲同一件事**。
 *
 * 注意：dayPhase 只认墙钟（与用户真实作息对齐）。睡眠窗口（isAsleep/isNap）由调用方单独判断，
 * 不在这里混进。
 */
export type DayPhase = 'morning' | 'lateMorning' | 'preNoon' | 'afternoon' | 'evening' | 'bedtime';

export interface DayPhaseMeta {
  /** 中文短标签（喂给 prompt） */
  label: string;
  /** 该时段叙事/建议应聚焦的主题（喂给 prompt，约束模型不要跑题） */
  focus: string;
}

export const DAY_PHASE_META: Record<DayPhase, DayPhaseMeta> = {
  morning: {
    label: '早晨',
    focus: '昨晚睡眠恢复得怎么样，以及今天一整天的能量状态',
  },
  lateMorning: {
    label: '上午',
    focus: '现在的脑力准备度，预测的高峰时段，把难的任务放到高峰去做',
  },
  preNoon: {
    label: '临近中午',
    focus: '这顿饭的营养，结合她的周期阶段给一句饮食小提示',
  },
  afternoon: {
    label: '午后',
    focus: '当前状态，若近期压力或消耗偏大就说一下，以及雌激素/孕激素的变化',
  },
  evening: {
    label: '傍晚',
    focus: '收工放松、轻量休息，别把事情都堆到晚上',
  },
  bedtime: {
    label: '睡前',
    focus: '护肤休息、怎么睡好，睡好明天能量才稳',
  },
};

/**
 * 当前时段（墙钟，24h）。边界（尽量贴合上班族作息，可按需微调）：
 *   06:00–10:00  早晨
 *   10:00–11:30  上午（尾段，脑力高峰临近）
 *   11:30–13:30  临近中午 / 午饭
 *   13:30–18:00  午后
 *   18:00–21:30  傍晚
 *   21:30–06:00  睡前
 */
export function dayPhase(now: Date = new Date()): DayPhase {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 6 && h < 10) return 'morning';
  if (h >= 10 && h < 11.5) return 'lateMorning';
  if (h >= 11.5 && h < 13.5) return 'preNoon';
  if (h >= 13.5 && h < 18) return 'afternoon';
  if (h >= 18 && h < 21.5) return 'evening';
  return 'bedtime';
}

/** 把小时数格式化成 HH:00（预测高峰展示用） */
export function padHour(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}
