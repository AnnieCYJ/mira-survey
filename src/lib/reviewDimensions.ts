/**
 * reviewDimensions —— 回顾·日「按维度拆解」的**纯规则引擎**（2026-11-11）
 *
 * 用户原话（摘要）：
 *   「回顾日里面其实可以分几个维度，比方说他处于哪个生理周期阶段、早上睡眠怎么样、
 *     这一天运动怎么样、整体状态/平均状态怎么样，还有血压呀各方面，从可以监测的
 *     数据维度里面挖掘睡眠/运动/情绪/压力/整体状态，以及他完成的一些任务……
 *     有的比方说睡眠分数有这种打分的，可以在日的每一个小卡里面加一个进度条，
 *     没有分数就不用说了，完成任务型的就可能没有。」
 *
 * ══ 设计铁律 ══
 *  ① 本文件**零 RN / 零 IO / 零单例**，纯函数 → 可离线单测（与 homeNarrative.ts 同纪律）；
 *     真实取数在 `reviewDayDimensions.ts`，那边只负责把数据装进 DayDimensionInput。
 *  ② **有分数才画进度条**：score/scoreMax 只给「0–100 的评分」或「有明确目标的量」；
 *     完成任务型、纯数值型（血压 / 心率 / 血氧）一律不给 score → UI 不渲染进度条。
 *  ③ **goalMet 只有两个来源**（睡眠评分 ≥85、步数 ≥ 目标），与回顾日卡片 / 月历格子 /
 *     水晶球金币完全同源；本引擎不得自造第三个达标口径，否则太阳币会多出来。
 *  ④ 文案讲「这个数字/达标对身体意味着什么」，用「看起来 / 通常 / 一般」软化；
 *     不诊断、不评分说教、不用「我们」居高临下、不出现监测/疗愈/激励类词。
 *  ⑤ 没有数据的维度**整卡不出**（空态铁律），绝不填「—」硬凑一张卡。
 */
import type { TimelineDimension } from '../components/TodayTimelineCard';

export type { TimelineDimension };

/** 睡眠评分达标线（与 buildTodayTimeline 的 goalMet 同源） */
export const SLEEP_GOAL = 85;

export interface DayDimensionInput {
  dayKey: string;
  isToday: boolean;
  // ── 生理周期 ──
  cyclePhaseLabel?: string | null;
  dayInCycle?: number | null;
  // ── 睡眠 ──
  sleepScore?: number | null;
  sleepTotalMin?: number | null;
  sleepDeepMin?: number | null;
  wakeTime?: string | null;
  /** 今天戒指断流时，睡眠细节不可信 → 只出「还没同步」的诚实卡 */
  sleepDataStale?: boolean;
  // ── 运动 ──
  steps?: number | null;
  stepGoal: number;
  sportNames?: string[];
  // ── 整体状态 ──
  stateMean?: number | null;
  stateLevel?: string | null;
  statePointCount?: number;
  // ── 情绪 / 压力 ──
  moodReports?: string[];
  stressMean?: number | null;
  // ── 可监测的身体指标（只展示数值，不打分、不画进度条） ──
  vitals?: { label: string; value: string }[];
  // ── 完成的任务（无分数） ──
  completedTasks?: { label: string; count: number }[];
}

export interface DimensionCard {
  id: string;
  dimension: TimelineDimension;
  title: string;
  emoji: string;
  /** 主数值（如 "93 分" / "1,327 步" / "118/76"） */
  value?: string;
  /** 一行平实补充 */
  sub?: string;
  /** ★ 有分数才有 → 进度条；undefined = 不渲染进度条 */
  score?: number;
  scoreMax?: number;
  scoreLabel?: string;
  /** 与太阳币同源的达标标记 */
  goalMet?: boolean;
  /** 「这对身体意味着什么」 */
  meaning?: string;
}

export interface DimensionGroup {
  id: string;
  title: string;
  cards: DimensionCard[];
}

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmtMin(min: number | null | undefined): string {
  if (!fin(min) || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} 小时${m > 0 ? ` ${m} 分` : ''}` : `${m} 分`;
}

function comma(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 只按真实数据组卡；没有任何数据的维度不进返回数组
 *  @param showCycle 是否展示生理周期维度（男性=false → 不出「生理周期」卡，也不出现周期相位措辞） */
export function composeDimensionGroups(input: DayDimensionInput, showCycle = true): DimensionGroup[] {
  const groups: DimensionGroup[] = [];
  const push = (id: string, title: string, cards: (DimensionCard | null)[]) => {
    const real = cards.filter((c): c is DimensionCard => c !== null);
    if (real.length) groups.push({ id, title, cards: real });
  };

  /* ── ① 身体节律：生理周期 + 早上睡眠 ───────────────────────────── */
  const rhythm: (DimensionCard | null)[] = [];

  if (showCycle && input.cyclePhaseLabel && input.cyclePhaseLabel !== '未记录') {
    const phase = input.cyclePhaseLabel;
    rhythm.push({
      id: 'cycle',
      dimension: 'cycle',
      title: '生理周期',
      emoji: '🌸',
      value: phase,
      sub: fin(input.dayInCycle) ? `周期第 ${input.dayInCycle} 天` : undefined,
      meaning:
        phase === '经期' ? '经期里体力容易偏低，节奏放缓一点，身体会舒服些。'
        : phase === '卵泡期' ? '新周期刚开始，精力通常一天比一天容易提起来。'
        : phase === '排卵期' ? '这段时间状态和心情往往比较足，做事更容易进入状态。'
        : phase === '黄体期' ? '激素在回落，体力和情绪起伏会比前半程明显一些。'
        : undefined,
    });
  }

  if (input.sleepDataStale) {
    rhythm.push({
      id: 'sleep', dimension: 'sleep', title: '早上睡眠', emoji: '☀️',
      sub: '这一夜的睡眠还没同步过来，细节稍后能看到',
    });
  } else if (fin(input.sleepScore) && input.sleepScore > 0) {
    const s = Math.round(input.sleepScore);
    const total = fmtMin(input.sleepTotalMin);
    const deep = fmtMin(input.sleepDeepMin);
    rhythm.push({
      id: 'sleep',
      dimension: 'sleep',
      title: '睡眠恢复',
      emoji: '☀️',
      value: `${s} 分`,
      sub: [total ? `睡了 ${total}` : '', deep ? `深睡 ${deep}` : '', input.wakeTime ? `${input.wakeTime} 起床` : '']
        .filter(Boolean).join(' · ') || undefined,
      score: s,
      scoreMax: 100,
      scoreLabel: `睡眠评分 ${s} / 100`,
      // 未达标时字段缺席（而非 false），让「goalMet 存在 = 真有一枚太阳」
      goalMet: s >= SLEEP_GOAL ? true : undefined,
      meaning: s >= SLEEP_GOAL
        ? '睡得够沉，身体夜里修复得比较完整，白天的精力底子通常更稳。'
        : s >= 70
        ? '恢复中等，身体补回了一部分，白天的余量会比睡足时少一些。'
        : '这一夜偏浅，身体修复的时间不太够，白天容易觉得没缓过来。',
    });
  }
  push('rhythm', '身体节律', rhythm);

  /* ── ② 活动与状态：当天运动 + 整体/平均状态 ─────────────────────── */
  const active: (DimensionCard | null)[] = [];

  if (fin(input.steps) && input.steps > 0) {
    const st = Math.round(input.steps);
    const goal = fin(input.stepGoal) && input.stepGoal > 0 ? input.stepGoal : 10000;
    active.push({
      id: 'activity',
      dimension: 'activity',
      title: '当天运动',
      emoji: '🏃‍♀️',
      value: `${comma(st)} 步`,
      sub: input.sportNames?.length ? `记下的运动：${input.sportNames.slice(0, 3).join('、')}` : undefined,
      score: Math.min(st, goal),
      scoreMax: goal,
      scoreLabel: `${comma(st)} / ${comma(goal)} 步`,
      goalMet: st >= goal ? true : undefined,
      meaning: st >= goal
        ? '走动达标，白天身体一直在活动，循环和代谢都跟着转起来了。'
        : '走动量还在累积中，日常多起身，身体的循环会更容易保持顺畅。',
    });
  } else if (input.sportNames?.length) {
    // 有运动打卡但没有步数（手动记录的运动）→ 无分数，不画进度条
    active.push({
      id: 'activity', dimension: 'activity', title: '当天运动', emoji: '🏃‍♀️',
      sub: `记下的运动：${input.sportNames.slice(0, 3).join('、')}`,
      meaning: '动过这一阵，身体从静止里缓过来，后面更容易保持轻快。',
    });
  }

  if (fin(input.stateMean) && input.stateMean > 0 && (input.statePointCount ?? 1) > 0) {
    const v = Math.round(input.stateMean);
    active.push({
      id: 'state',
      dimension: 'state',
      title: '整体状态',
      emoji: '〰️',
      value: `${v} 分`,
      sub: input.stateLevel ? `全天平均 · ${input.stateLevel}` : '全天平均',
      score: v,
      scoreMax: 100,
      scoreLabel: `平均状态 ${v} / 100`,
      meaning: v >= 80
        ? '一整天状态大多在高位，身体应对事情的余量看起来比较足。'
        : v >= 65
        ? '状态在平稳区间，没大起大落，身体按自己的节奏走。'
        : '这天状态偏低，身体多半把力气花在应付上，缓过来的时间会需要更久。',
    });
  }
  push('active', '活动与状态', active);

  /* ── ③ 情绪与压力 ──────────────────────────────────────────────── */
  const mind: (DimensionCard | null)[] = [];

  if (input.moodReports?.length) {
    mind.push({
      id: 'mood', dimension: 'mood', title: '这一天的心情', emoji: '💗',
      sub: input.moodReports.slice(0, 3).join(' · '),
      meaning: '自己记下的心情，比数字更能说明这一天过得怎么样。',
    });
  }
  if (fin(input.stressMean) && input.stressMean > 0) {
    const v = Math.round(input.stressMean);
    mind.push({
      id: 'stress', dimension: 'stress', title: '身心压力', emoji: '🌊',
      value: `${v}`,
      sub: '全天平均',
      score: Math.min(v, 100),
      scoreMax: 100,
      scoreLabel: `压力均值 ${v} / 100`,
      meaning: v >= 60
        ? '这天身体绷得比较久，紧的感觉不太容易自己散开。'
        : v >= 35
        ? '压力有起伏，但大多时候还在能松下来的范围里。'
        : '这天整体比较松弛，身体不太需要一直紧着应对。',
    });
  }
  push('mind', '情绪与压力', mind);

  /* ── ④ 可监测的身体指标：只给数值，不打分、不画进度条 ───────────── */
  if (input.vitals?.length) {
    push('vitals', '身体指标', [{
      id: 'vitals',
      dimension: 'vitals',
      title: '可看到的数据',
      emoji: '🩺',
      sub: input.vitals.map((v) => `${v.label} ${v.value}`).join(' · '),
      meaning: '这些是当天读到的一组数值，放在一起看，更容易对上那天的身体感觉。',
    }]);
  }

  /* ── ⑤ 完成的事：完成任务型，一律无分数、不画进度条 ─────────────── */
  if (input.completedTasks?.length) {
    const total = input.completedTasks.reduce((s, t) => s + (t.count > 0 ? t.count : 0), 0);
    push('task', '完成的事', [{
      id: 'task',
      dimension: 'task',
      title: total > 0 ? `做成了 ${total} 件小事` : '这一天做的事',
      emoji: '✅',
      sub: input.completedTasks
        .slice(0, 5)
        .map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label))
        .join(' · '),
      meaning: '建议了就去做，这些小事会一点点把状态往回拉。',
    }]);
  }

  return groups;
}

/** 当日达标来源（只数 goalMet，按维度分桶）—— 月视图「太阳币主要来自哪方面」用 */
export function countGoalMetByDimension(groups: DimensionGroup[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of groups) {
    for (const c of g.cards) {
      if (c.goalMet) out[c.dimension] = (out[c.dimension] ?? 0) + 1;
    }
  }
  return out;
}
