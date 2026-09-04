import type { TaskType } from './tasks';
import type { RingState } from '../ble/RingBleManager';

export const SUGGESTIONS = [
  '为什么最近总是很累？',
  '我的压力峰值在什么时段？',
  '这周适合高强度训练吗？',
  '我的周期规律吗？',
];

export const QUICK_ACTIONS: { label: string; icon: 'pen' | 'image' | 'sparkle' | 'breath' | 'focus' | 'mind' }[] = [
  { label: '重新表达', icon: 'pen' },
  { label: '生成图片', icon: 'image' },
  { label: '睡眠分析', icon: 'breath' },
];

/** 生成 Mira AI 首页建议问题。基于真实健康数据 + 时间 + 趣味互动。 */
export function generateQuestions(state: RingState | null): string[][] {
  const now = new Date();
  const hour = now.getHours();
  const health: string[] = [];
  const fun: string[] = [];

  // —— 经期阶段（优先，用「计算出的真实相位」而非戒指 female.state）——
  // 戒指硬件不测经期相位，相位是按你记录的末次经期 + 标准周期模型算出来的；
  // female 当前由原生回传（原生尚未实现 readFemale，恒为 null），故以 curveStatus 的计算相位为准。
  const cs = state?.curveStatus;
  const cycleDay = cs?.dayInCycle ?? 0;
  const phaseLabel = cs?.phaseLabel ?? '';
  if (cs?.hasLog && phaseLabel === '经期') {
    health.push(`经期第${Math.max(1, cycleDay)}天做什么运动`);
    health.push('经期睡不好怎么调');
  } else if (cs?.hasLog && phaseLabel === '排卵期') {
    health.push('排卵期注意什么');
    health.push('排卵期有啥信号');
  } else if (cs?.hasLog) {
    health.push(`${phaseLabel}适合啥强度`);
    health.push(`${phaseLabel}要注意啥`);
  } else {
    health.push('我现在啥阶段');
    health.push('这阶段适合啥强度');
  }

  // —— 睡眠 ——
  const sleep = state?.sleepSummary;
  if (sleep) {
    const totalH = sleep.total / 60;
    if (totalH < 6) {
      health.push(`只睡${totalH.toFixed(1)}h怎么补`);
    } else if (sleep.score <= 2) {
      health.push('睡眠差怎么改善');
    } else {
      health.push('昨晚睡得咋样');
    }
    if (sleep.deep < 60) {
      health.push('深睡不足影响');
    }
  } else {
    health.push('最近为啥难入睡');
  }

  // —— HRV / 压力 ——
  const hrv = state?.metrics.hrv ?? state?.daily.hrv ?? null;
  if (hrv !== null) {
    if (hrv < 40) {
      health.push('HRV低今天歇歇？');
      health.push('最近压力太大？');
    } else if (hrv > 70) {
      health.push('HRV不错能上强度？');
    } else {
      health.push('恢复状态咋样');
    }
  }

  // —— 活动 / 步数 ——
  const steps = state?.daily?.steps ?? null;
  if (steps !== null) {
    if (steps < 3000) {
      health.push('活动少出去走走？');
    } else if (steps > 10000) {
      health.push('走很多路睡前注意');
    } else {
      health.push('今天活动达标没');
    }
  }

  // —— 时间场景 ——
  if (hour < 11) {
    health.push('早上状态咋样');
  } else if (hour < 17) {
    health.push('下午犯困咋办');
  } else {
    health.push('今晚怎么睡更好');
  }

  // —— 趣味互动（每次随机选 3 个，避免重复）——
  const pool = [
    '今日塔罗牌',
    '解梦：奔跑',
    '今天穿啥色',
    '来句正念语录',
    '本周星座运势',
    '今日幸运数字',
    '用天气形容今天',
    '讲个助眠小故事',
  ];
  // 简单伪随机：按日期+小时取种子，保证同小时内稳定，跨小时变化
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate() + hour;
  const shuffled = pool
    .map((q, i) => ({ q, s: Math.sin(seed * (i + 1) * 9999) }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.q);
  fun.push(...shuffled.slice(0, 3));

  // 组合：优先健康，补满 6 个；每排 2 个
  const picked = health.slice(0, 3);
  picked.push(...fun.slice(0, 6 - picked.length));
  if (picked.length < 6) {
    const fallback = [
      '最近健康趋势',
      '压力峰值时段',
      '本周能高强度？',
      '周期规律吗',
      '白天怎么专注',
      '晚上刷手机咋办',
    ];
    picked.push(...fallback.slice(0, 6 - picked.length));
  }

  return [picked.slice(0, 2), picked.slice(2, 4), picked.slice(4, 6)];
}

/** @deprecated 静态 QUESTIONS 已废弃，改用 generateQuestions(state) */
export const QUESTIONS: string[][] = [
  ['昨晚睡得怎么样？', '我现在处于周期哪个阶段？'],
  ['今天适合什么强度训练？', '下午容易犯困怎么办？'],
  ['帮我抽一张今日塔罗牌', '解梦：梦见自己在奔跑'],
];

export interface AiTask {
  type: TaskType;
  title: string;
  desc: string;
}

export interface Reply {
  lines: string[];
  task?: AiTask;
}

export const REPLIES: { kw: string[]; lines: string[]; task?: AiTask }[] = [
  {
    kw: ['累', '疲劳', 'tired', 'fatigue', 'sleep', '睡眠'],
    lines: [
      '你这周的入睡时间比上周整体后移了约 40 分钟，深睡集中在 01:20–03:40。',
      '这本身不是问题。但深睡窗口和皮质醇最低点出现了错位，这种情况下午后犯困很常见。',
      '目前不需要调整什么。如果你想进一步看，我们可以分辨偏移是来自晚间作息，还是训练负荷。',
    ],
    task: {
      type: 0,
      title: '睡前 10 分钟呼吸冥想',
      desc: '在入睡前一小时做一次，有助于把深睡窗口前移。',
    },
  },
  {
    kw: ['压力', '焦虑', 'stress', 'anxious', '紧张'],
    lines: [
      '你自报的压力这周出现两次峰值，都在 14:00–16:00，而且都落在会议密集的日子。',
      '生理上它表现为晚间 HRV 恢复窗口变短。',
      '你现在是周期第 14 天，雌激素处于峰值，通常会缓冲压力反应。峰值依然出现，说明是负荷本身偏高，不是你的恢复力变差了。',
    ],
    task: {
      type: 0,
      title: '午后 5 分钟呼吸练习',
      desc: '在压力峰值前做一次，有助于拉长晚间的恢复窗口。',
    },
  },
  {
    kw: ['周期', '排卵', '经期', 'cycle', 'period', 'ovulation'],
    lines: [
      '你现在是第 14 天，接近排卵期，雌激素处于峰值。',
      '这个阶段通常带来更好的胰岛素敏感度和疼痛耐受度，适合安排强度较高的训练。',
      '排卵后孕激素开始上升，很多人会在这个阶段感到睡眠变浅，那是正常变化，不是退步。',
    ],
    task: {
      type: 3,
      title: '读完《黄体期身体变化》',
      desc: '了解接下来两周身体会怎么变，提前安排训练与作息。',
    },
  },
  {
    kw: ['训练', '运动', 'workout', 'training', '恢复'],
    lines: [
      'HRV 58ms 高于你的基线，训练耐受度目前是够的。',
      '雌激素峰值期适合安排强度，但把高强度放在午后之前——你最近的压力峰值也在那个时段。',
      '练完之后留意当晚 HRV，如果掉超过 15%，下一轮降一档强度。',
    ],
    task: {
      type: 2,
      title: '训练后 10 分钟放松专注',
      desc: '帮助副交感神经回位，加速当晚恢复。',
    },
  },
  {
    kw: ['入睡', '睡', '深睡', '失眠'],
    lines: [
      '你的深睡窗口稳定，问题在入睡时间——比基线晚了 18 分钟。',
      '深睡占比 24%，还没回到你的常态水平，主要就是被这 18 分钟挤掉的。',
      '先只调这一件事：把入睡时间往前挪 20 分钟，其他都不动，看两周。',
    ],
    task: {
      type: 0,
      title: '睡前 10 分钟呼吸冥想',
      desc: '在入睡前一小时做一次，有助于把深睡窗口前移。',
    },
  },
];

export const FALLBACK: Reply = {
  lines: [
    '我可以结合你的周期阶段、睡眠和自报记录来看这些变化。',
    '目前不对你做任何评分或判断——只把数据和你的感受放在一起，找出能解释的部分。',
    '你想先看睡眠、压力，还是训练安排？',
  ],
};

export const ANALYSIS_QA = {
  q: '把这几天的整体分析展开讲讲。',
  a: [
    '过去 7 天你的 HRV 基线 58ms，比上周高 6%，恢复能力确实在往上走。',
    '雌激素进入峰值区间，这个阶段体感通常更好，今明两天是安排中等强度训练的窗口期。',
    '需要注意的是入睡时间比基线晚了 18 分钟，深睡占比 24%，还没回到你的常态水平。',
    '顺序别反：先把入睡时间提前 20 分钟稳住睡眠，再上强度。睡眠没稳住时加练，HRV 很容易掉下来。',
  ],
};

export function pickReply(text: string): Reply {
  const t = text.toLowerCase();
  for (const r of REPLIES) {
    if (r.kw.some((k) => t.includes(k.toLowerCase()))) return r;
  }
  return FALLBACK;
}
