import { theme } from '../theme/theme';
import type { IconName } from '../components/Icon';

export type TaskType = 0 | 1 | 2 | 3;

export const TASK_COLORS: string[] = [
  theme.colors.accent1,
  theme.colors.accent2,
  theme.colors.stateCalm,
  theme.colors.stateTense,
];

export const TASK_ICONS: Record<TaskType, IconName> = {
  0: 'breath',
  1: 'mind',
  2: 'focus',
  3: 'learn',
};

export const TASK_LABELS = ['呼吸冥想', '认知提升', '专注力提升', '知识学习'];

export interface TaskItem {
  id: string;
  type: TaskType;
  badge: string;
  title: string;
  desc: string;
  action: string;
  done: boolean;
}

export const DEFAULT_TOOLS: TaskItem[] = [
  {
    id: 'breath-morning',
    type: 0,
    badge: '今日推荐任务',
    title: '10 分钟晨间呼吸',
    desc: '你的 HRV 处于高位，适合安排一次舒缓的呼吸练习稳定节律。',
    action: '开始 · 10 min',
    done: false,
  },
];

export const TOOL_GRID: { icon: IconName; name: string; sub: string }[] = [
  { icon: 'breath', name: '呼吸冥想', sub: '12 个练习' },
  { icon: 'mind', name: '认知提升', sub: '8 个训练' },
  { icon: 'focus', name: '专注力提升', sub: '6 个课程' },
  { icon: 'learn', name: '知识学习', sub: '24 篇文章' },
];

export const INITIAL_TASKS: Record<number, TaskType[]> = {
  1: [0],
  2: [1, 2],
  4: [0],
  5: [3],
  7: [0, 1],
  9: [2],
  11: [0],
  12: [1],
  13: [0, 2, 3],
  15: [1],
  17: [0],
  18: [2],
  19: [0, 1],
  21: [3],
  22: [0],
  24: [1, 2],
  25: [0],
  26: [3],
  27: [0],
  28: [1, 2],
  29: [3],
};

export const CAL_YEAR = 2026;
export const CAL_MONTH = 7; // 0-based → 8 月
export const TODAY_DAY = 29;
export const PLAN_PER_DAY = 2;
