import { theme } from '../theme/theme';
import type { IconName } from '../components/Icon';

export type TaskType = 0 | 1 | 2 | 3 | 4 | 5;

export const TASK_COLORS: string[] = [
  theme.colors.accent1,       // 0 呼吸冥想
  theme.colors.accent2,       // 1 认知提升
  theme.colors.stateCalm,     // 2 专注力提升
  theme.colors.stateTense,    // 3 知识学习
  '#F59E6B',                  // 4 吃得好 暖橙
  '#22C55E',                  // 5 运动 嫩绿
];

export const TASK_ICONS: Record<TaskType, IconName> = {
  0: 'breath',
  1: 'mind',
  2: 'focus',
  3: 'learn',
  4: 'food',
  5: 'run',
};

export const TASK_LABELS = ['呼吸冥想', '认知提升', '专注力提升', '知识学习', '吃得好', '运动'];

/** 每个习惯类型的日历事件元信息（emoji + 短名 + 默认时间） */
export const TASK_EVENTS: Record<TaskType, { emoji: string; short: string; time: string }> = {
  0: { emoji: '🧘', short: '冥想',   time: '07:30' },
  1: { emoji: '🧠', short: '认知',   time: '09:00' },
  2: { emoji: '🎯', short: '专注',   time: '14:00' },
  3: { emoji: '📖', short: '学习',   time: '20:00' },
  4: { emoji: '🍱', short: '吃得好', time: '12:30' },
  5: { emoji: '🚴', short: '运动',   time: '18:00' },
};

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
  {
    id: 'mind-training',
    type: 1,
    badge: 'AI · 脑力提升',
    title: '认知灵活性训练',
    desc: '昨晚深睡恢复良好，大脑可塑性窗口已打开，15 分钟效果最佳。',
    action: '开始 · 15 min',
    done: false,
  },
  {
    id: 'focus-deep',
    type: 2,
    badge: '专注课程',
    title: '25 分钟深度专注',
    desc: '皮质醇节律平稳，适合进入心流状态，专注效率比平时高 32%。',
    action: '开始 · 25 min',
    done: false,
  },
  {
    id: 'learn-article',
    type: 3,
    badge: '知识推荐',
    title: '《压力下的大脑》',
    desc: '基于你近期情绪日志精选，5 分钟读完，帮助你更好地理解压力反应。',
    action: '开始 · 5 min',
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
  13: [0, 2, 3, 4],
  15: [1],
  17: [0],
  18: [2],
  19: [0, 1, 5],
  21: [3],
  22: [0],
  24: [1, 2, 4, 5],
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
