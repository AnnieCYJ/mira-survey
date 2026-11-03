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

/** 生成 Mira AI 建议问题。基于真实健康数据 + 时间 + 趣味互动。
 * 设计约束：
 *   1. 去重：perRow*3 条不重复
 *   2. 比例：健康 : 趣味 ≈ (perRow+2) : (perRow*2-2)（太健康很枯燥，全趣味又不落地）
 *   3. 稳定：按「日期 + 小时 + phaseLabel + sleepTotal」做种子 —— 同一场景下稳定，
 *      只有真实数据变化才换问题，避免 ringState 高频推送导致的滑动跳跃
 * @param perRow 每排问题数。默认 2（ChatSheet 换行平铺）；MiraAI 首页跑马灯传 4
 */
export function generateQuestions(state: RingState | null, perRow = 2): string[][] {
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

  // —— 组合：health 取前 perRow+2，fun 补到 perRow*3 ——
  const total = perRow * 3;
  const healthCap = Math.min(total, perRow + 2);
  const picked: string[] = [];
  for (const q of health) if (picked.length < healthCap) picked.push(q);
  for (const q of fun)    if (picked.length < total) picked.push(q);

  // fallback 兜底（极端情况 health+fun 不够 perRow*3）
  if (picked.length < total) {
    const fallback = [
      '最近健康有啥趋势？', '我的压力峰值在哪个时段？', '本周能上高强度训练吗？',
      '我的周期规律吗？', '白天怎么更专注？', '晚上总刷手机怎么办？',
    ];
    for (const q of fallback) if (picked.length < total && !seen.has(q)) picked.push(q);
  }

  const rows: string[][] = [];
  for (let i = 0; i < 3; i++) rows.push(picked.slice(i * perRow, (i + 1) * perRow));
  return rows;
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
      '这条是离线兜底回复——现在我读不到你最新的戒指数据，就不编具体数字了。',
      '连上网络我再帮你结合真实的睡眠和恢复数据看。',
      '想现在先做点什么的话，睡前 10 分钟呼吸冥想通常不会错。',
    ],
    task: {
      type: 0,
      title: '睡前 10 分钟呼吸冥想',
      desc: '在入睡前一小时做一次，有助于身体回位。',
    },
  },
  {
    kw: ['压力', '焦虑', 'stress', 'anxious', '紧张'],
    lines: [
      '这条是离线兜底回复——我拿不到你此刻的压力与 HRV 读数，就不猜了。',
      '恢复网络后，我可以把你的真实压力峰值时段和恢复窗口摆在一起看。',
      '等不及的话，午后 5 分钟呼吸练习随时可以做。',
    ],
    task: {
      type: 0,
      title: '午后 5 分钟呼吸练习',
      desc: '感觉紧绷的时候做一次，帮助放缓节奏。',
    },
  },
  {
    kw: ['周期', '排卵', '经期', 'cycle', 'period', 'ovulation'],
    lines: [
      '这条是离线兜底回复——我暂时读不到你的经期记录与周期阶段，就不推断当前相位了。',
      '恢复网络后我可以结合你的真实记录来讲。',
      '想先了解阶段知识的话，可以读读《黄体期身体变化》。',
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
      '这条是离线兜底回复——现在我看不到你最新的 HRV 与恢复数据，不替你判断训练耐受度。',
      '恢复网络后，我把真实恢复指标和你的训练安排放在一起看。',
      '练完之后做 10 分钟放松专注，通常有助于当晚恢复。',
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
      '这条是离线兜底回复——我读不到你最近的入睡时间与深睡数据，就不编具体偏移了。',
      '恢复网络后我再帮你对着真实数据看入睡窗口。',
      '可以先只调一件事：今晚把入睡时间往前挪一点，其他都不动。',
    ],
    task: {
      type: 0,
      title: '睡前 10 分钟呼吸冥想',
      desc: '在入睡前一小时做一次，有助于把入睡窗口前移。',
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

export function pickReply(text: string): Reply {
  const t = text.toLowerCase();
  for (const r of REPLIES) {
    if (r.kw.some((k) => t.includes(k.toLowerCase()))) return r;
  }
  return FALLBACK;
}
