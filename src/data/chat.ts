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

/** 生成 Mira AI 首页建议问题。基于真实健康数据 + 时间 + 趣味互动。
 * 设计约束：
 *   1. 去重：6 条不重复
 *   2. 比例：健康 : 趣味 = 4 : 2（太健康很枯燥，全趣味又不落地）
 *   3. 稳定：按「日期 + 小时 + phaseLabel + sleepTotal」做种子 —— 同一场景下稳定，
 *      只有真实数据变化才换问题，避免 ringState 高频推送导致的滑动跳跃
 */
export function generateQuestions(state: RingState | null): string[][] {
  const now = new Date();
  const hour = now.getHours();
  const seen = new Set<string>();
  const health: string[] = [];
  const fun: string[] = [];
  const pushUniq = (arr: string[], q: string) => {
    if (!seen.has(q) && q.length <= 16) { seen.add(q); arr.push(q); }
  };

  const cs = state?.curveStatus;
  const cycleDay = cs?.dayInCycle ?? 0;
  const phaseLabel = cs?.phaseLabel ?? '';

  // —— 经期阶段 ——
  if (cs?.hasLog && phaseLabel === '经期') {
    pushUniq(health, `经期第${Math.max(1, cycleDay)}天适合做啥运动？`);
    pushUniq(health, '经期睡不好怎么调？');
    pushUniq(health, '经期适合吃啥？');
  } else if (cs?.hasLog && phaseLabel === '排卵期') {
    pushUniq(health, '排卵期要注意啥？');
    pushUniq(health, '排卵期有啥身体信号？');
  } else if (cs?.hasLog) {
    pushUniq(health, `${phaseLabel}适合啥强度运动？`);
    pushUniq(health, `${phaseLabel}要注意啥？`);
  } else {
    pushUniq(health, '我现在处于周期哪个阶段？');
    pushUniq(health, '这阶段适合啥强度运动？');
  }

  // —— 睡眠 ——
  const sleep = state?.sleepSummary;
  if (sleep) {
    const totalH = sleep.total / 60;
    if (totalH < 6)       pushUniq(health, `只睡${totalH.toFixed(1)}h怎么补回来？`);
    else if (sleep.score <= 2) pushUniq(health, '睡眠质量差怎么改善？');
    else                  pushUniq(health, '昨晚睡得怎么样？');
    if (sleep.deep < 60)  pushUniq(health, '深睡不足有啥影响？');
  } else {
    pushUniq(health, '最近为啥总难入睡？');
  }

  // —— HRV / 压力 ——
  const hrv = state?.metrics.hrv ?? state?.daily.hrv ?? null;
  if (hrv !== null) {
    if (hrv < 40)       pushUniq(health, 'HRV低今天要不要歇歇？');
    else if (hrv > 70)  pushUniq(health, 'HRV不错能上强度训练吗？');
    else                pushUniq(health, '我的恢复状态怎么样？');
  }

  // —— 活动 ——
  const steps = state?.daily?.steps ?? null;
  if (steps !== null) {
    if (steps < 3000)       pushUniq(health, '活动量少要出去走走吗？');
    else if (steps > 10000) pushUniq(health, '走了很多路睡前要注意啥？');
    else                    pushUniq(health, '今天活动量达标了吗？');
  }

  // —— 时间场景 ——
  if (hour < 11)       pushUniq(health, '今早状态怎么样？');
  else if (hour < 17)  pushUniq(health, '下午犯困怎么办？');
  else                 pushUniq(health, '今晚怎么睡能更好？');

  // —— 趣味互动（稳定种子：日期+小时+phase+sleepTotal）——
  const funPool = [
    '今日塔罗牌', '解梦：奔跑', '今天穿啥色', '来句正念语录',
    '本周星座运势', '今日幸运数字', '用天气形容今天', '讲个助眠小故事',
    '给我一句鼓励', '未来一周运势',
  ];
  const sleepSeed = sleep ? Math.floor(sleep.total / 30) : 0;
  const phaseSeed = phaseLabel ? phaseLabel.length : 0;
  const seed = now.getDate() + hour * 31 + phaseSeed * 17 + sleepSeed * 7;
  const shuffled = funPool
    .map((q, i) => ({ q, s: Math.sin(seed + i * 12.9898) }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.q);
  shuffled.forEach((q) => pushUniq(fun, q));

  // —— 组合：health 取前 4，fun 补到 6 ——
  const picked: string[] = [];
  for (const q of health) if (picked.length < 4) picked.push(q);
  for (const q of fun)    if (picked.length < 6) picked.push(q);

  // fallback 兜底（极端情况 health+fun 不够 6）
  if (picked.length < 6) {
    const fallback = [
      '最近健康有啥趋势？', '我的压力峰值在哪个时段？', '本周能上高强度训练吗？',
      '我的周期规律吗？', '白天怎么更专注？', '晚上总刷手机怎么办？',
    ];
    for (const q of fallback) if (picked.length < 6 && !seen.has(q)) picked.push(q);
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
