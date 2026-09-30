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

export type ArticleCollection = 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition';

/** 牌堆卡翻面科普（v18.88）：背面一句话「为什么」+ 一条出处 + 查看详情跳转目标 */
export interface TaskFlip {
  articleId: string;
  collection?: ArticleCollection;
  /** 科普文章标题（背面大标题，与详情页一致） */
  articleTitle: string;
  /** 背面短科普：只讲原因，1-2 句，不堆字 */
  tip: string;
  /** 一条代表性出处 */
  src: string;
  /** v18.91 背面「去完成」按钮：跳对应实操页；纯科普任务不带（只留查看详情） */
  do?: { route: 'Breathing' | 'EmotionLog' | 'FoodScan'; autoCamera?: boolean };
}

export interface TaskItem {
  id: string;
  type: TaskType;
  badge: string;
  title: string;
  desc: string;
  action: string;
  done: boolean;
  /** 有翻面科普的卡（每日推荐卡）可点击翻面；无则点击无动作 */
  flip?: TaskFlip;
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
    flip: {
      articleId: 'sigh',
      collection: 'emotion',
      articleTitle: '生理性叹息：最快的降温开关',
      tip: '晨起心率偏快、状态发紧的时候，别急着灌咖啡——先用呼吸把节律理顺。想做舒缓的选「放松呼吸」，想快点清醒就选「提神呼吸」（短吸长呼 6-2），配上自然声音频，HRV 几分钟内就能回来。',
      src: 'Balban M.Y. et al., Cell Reports Medicine, 2023',
      do: { route: 'Breathing' },
    },
  },
  {
    id: 'mind-training',
    type: 1,
    badge: 'AI · 脑力提升',
    title: '认知灵活性训练',
    desc: '昨晚深睡恢复良好，大脑可塑性窗口已打开，15 分钟效果最佳。',
    action: '开始 · 15 min',
    done: false,
    flip: {
      articleId: 'levers',
      collection: 'learn',
      articleTitle: '平衡激素的四根杠杆：光 · 睡 · 压 · 动',
      tip: '认知状态不是天生注定的——光、睡眠、压力、运动四根杠杆都在拨动它。昨晚深睡到位，等于今天「睡」这根杠杆已经拨到高位，趁训练把认知红利兑现，同样的 15 分钟收获更多。',
      src: 'Czeisler C.A. et al., Science, 1989',
    },
  },
  {
    id: 'focus-deep',
    type: 2,
    badge: '专注课程',
    title: '25 分钟深度专注',
    desc: '皮质醇节律平稳，适合进入心流状态，专注效率比平时高 32%。',
    action: '开始 · 25 min',
    done: false,
    flip: {
      articleId: 'dopamine',
      collection: 'learn',
      articleTitle: '多巴胺基线：别喂廉价刺激',
      tip: '刷完手机再干正事，会觉得难事更难——不是你懒，是大脑的奖赏系统被廉价刺激抬高了胃口。深度专注反过来也成立：先把最难的事做掉，多巴胺会重新对「值得的努力」敏感。这 25 分钟就从最难的那件开始。',
      src: 'Schultz W., J Neurophysiol, 1998',
    },
  },
  {
    id: 'learn-article',
    type: 3,
    badge: '知识推荐',
    title: '《压力下的大脑》',
    desc: '基于你近期情绪日志精选，5 分钟读完，帮助你更好地理解压力反应。',
    action: '开始 · 5 min',
    done: false,
    flip: {
      articleId: 'cortisol',
      collection: 'learn',
      articleTitle: '皮质醇的晨峰意义',
      tip: '压力大不是矫情，是身体在持续分泌「应战激素」——短期让你清醒，压久了就开始抢睡眠和食欲。5 分钟读懂皮质醇的晨峰节律，下次状态波动就知道是为什么。',
      src: 'Fries E. et al., Psychoneuroendocrinology, 2009',
    },
  },
];

/** 工具页六宫格（v18.39 重构）：情绪调节 / 提升颜值 / 营养搭配 / 运动建议 / 稳定睡眠 / 知识科普
 *  · 营养搭配 = 原饮食识别模块（FoodScan，不改）；稳定睡眠 = 原呼吸冥想模块（Breathing，不改）
 *  · 情绪调节 → 情绪记录页；提升颜值 / 运动建议 / 知识科普 → ToolTopic 通用内容页 */
export const TOOL_GRID: { icon: IconName; name: string; sub: string }[] = [
  { icon: 'mind', name: '情绪调节', sub: '记录与降温' },
  { icon: 'focus', name: '提升颜值', sub: '好气色养成' },
  { icon: 'food', name: '营养搭配', sub: '拍照记热量' },
  { icon: 'run', name: '运动建议', sub: '按状态开方' },
  { icon: 'breath', name: '稳定睡眠', sub: '呼吸与冥想' },
  { icon: 'learn', name: '知识科普', sub: '读懂周期' },
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
