/**
 * 今日运动建议（周期阶段 × 今日状态 × 皮质醇/激素 × 时段 → 分析 + 一句大概建议 + 可执行方案）
 * ─────────────────────────────────────────────────────────────
 * 结构（v18.93 定为「V2 版式」）：
 *   ① 今日状态（每 30 分钟一个点，随时间变）→ ② 为什么今天这么动（激素 / 皮质醇 / 昨晚）
 *   → ③ 今日运动建议（方案 + 三段动作，无 CTA）→ ④ 注意这几点
 *
 * ★ 口径铁律：这个 0–100 的分数在 App 里叫「今日状态」，不叫电量。
 *
 * ★ 今日状态是**随时间变**的值（curve 模型每 30 分钟累积一次），不是固定的「今天总分」。
 *   所以本模块要吃 `now` + `timeline`（今天的半小时点），给出：
 *     · 当前值、今早对比、最近几个点的小轨迹（给 UI 画迷你条）
 *     · 时段（皮质醇昼夜节律 → 什么时候适合让强度上去）
 *   没有 timeline 时只显示当前值，绝不编「比今早低 X 分」。
 *
 * 内容依据（完整出处见 workoutLibrary.ts 头部）：
 *   · Stanford Lifestyle Medicine —— 皮质醇昼夜节律与训练时段、强度阈值（过了「还能说话」皮质醇跟着上）。
 *   · Balban M.Y. et al., Cell Reports Medicine 2023（Stanford）—— 循环叹气降生理唤醒。
 *   · Oosthuyse & Lisonek, Sports Med 2008 / Cunningham et al., J Physiol 2019 —— 周期阶段与运动表现。
 *
 * 数据边界（不编数据）：
 *  · 戒指没连 / 周期没记录 → intensity = 'unknown'，结论退到保守通用档。
 *  · 每项分析只在对应数据存在时才产出，UI 逐条渲染，没有就不显示。
 *  · 建议一律偏温和：宁可少练一组，也别让人练透支。
 */

import { HEART_ZONES, sportVisualOf, type HeartZone } from './sportVisual';
import {
  pickLibraryPlan,
  planMinutes,
  fillHeartRate,
  WORKOUT_SOURCE_LINE,
  type Caution,
  type WorkoutIntensity,
} from './workoutLibrary';

export type Intensity = 'recovery' | 'moderate' | 'intense' | 'unknown';
export type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** 分段动作（热身 / 主项 / 收尾） */
export interface WorkoutStep {
  /** 段位：热身 · 主项 · 收尾 */
  phase: string;
  /** 具体做什么 */
  name: string;
  /** 秒 */
  seconds: number;
  /** 动作要点（心率上限 / 呼吸 / 幅度） */
  note?: string;
}

/** 分析行的左侧小标签（ hormone / cortisol / state / sleep ... 中文两字最稳 ） */
export interface AnalysisRow {
  tag: string;
  text: string;
}

export interface TodayWorkout {
  intensity: Intensity;
  /** 今天怎么动（温和措辞） */
  modeLabel: string;

  /** 是否已有真实数据支撑（false = 通用保守档，UI 需给说明文案） */
  dataDriven: boolean;

  /* ── 今日状态（半小时一跳，随时间变）── */
  /** 当前状态分（null = 戒指还没给今天的状态） */
  stateScore: number | null;
  /** 状态档位名（元气满满 / 状态良好 / 平平静静 / 需要休息） */
  stateLevel: string | null;
  /** 今天的半小时轨迹（最近若干点，给 UI 画小条） */
  spark: { t: number; value: number }[];
  /** 「现在 15:40 · 每 30 分钟更新一次」 */
  nowLabel: string;
  windowNote: string;
  /** 与今天最早一个点的差值文案（如「比今早低 6 分」），无 timeline 时为 null */
  deltaText: string | null;

  /* ── 时段与皮质醇节律 ── */
  timeSlot: TimeSlot;
  /** 这个时段该怎么练的一句话（依据皮质醇昼夜节律） */
  timeNote: string;

  /* ── 激素 / 皮质醇分析 ── */
  /** 激素分析行（周期阶段 + 雌/孕激素走向），来自建议库 rationale */
  hormoneNote: string;
  /** 皮质醇分析行（有数据才给） */
  cortisolNote: string | null;
  /** 周期第几天（顶部 chip 用） */
  dayInCycle: number | null;

  /* ── 「为什么今天这么动」三枚圆 chip 的文案 ──
   * 之前是 UI 里写死「卵泡期 / 第 8 天 / 皮质醇 正常」，实际数据一变就对不上；
   * 这里统一由数据产出，UI 只负责渲染。 */
  /** 周期 chip 主副行，如「卵泡期 / 第 8 天」；没记录周期就只给「周期」 */
  chipHormone: [string, string];
  /** 皮质醇 chip 主副行，如「皮质醇 / 偏高」；没样本就副位写「待同步」 */
  chipCortisol: [string, string];

  /* ── 方案 ── */
  /** 主运动：固件枚举 type */
  primaryType: number;
  primaryName: string;
  emoji: string;
  color: string;

  /** 建议总时长（分钟） */
  totalMinutes: number;
  /** 一句话目标（主项 + 强度 + 心率） */
  headline: string;
  /** 目标心率区间文案 */
  hrTarget: string;
  targetZone: HeartZone;

  /** 分段动作 */
  steps: WorkoutStep[];
  /** 数据驱动的分析行（逐条来自真实字段，带 tag，UI 直接渲染不靠下标猜） */
  analysis: AnalysisRow[];
  /** 结论：大概建议（一句，温和） */
  conclusion: string;
  /** 注意事项（跟当前方案联动） */
  cautions: Caution[];
  /** UI 脚注：依据 */
  sourceLine: string;
  /** 无数据时给用户的引导语 */
  fallbackNote?: string;
}

export interface WorkoutInput {
  /** 周期阶段（经期 / 卵泡期 / 排卵期 / 黄体期 / 未记录） */
  phase?: string | null;
  /** 今日状态（curveStatus.value，0–100） */
  value?: number | null;
  /** 最近几天均值（对比用） */
  statusAvg?: number | null;
  /** 昨晚睡眠得分 */
  sleepScore?: number | null;
  /** 昨晚睡眠总时长（分钟） */
  sleepTotalMin?: number | null;
  /** 昨晚深睡（分钟） */
  sleepDeepMin?: number | null;
  /** 当日晨间 HRV（ms） */
  hrv?: number | null;
  /** 最近几天 HRV 均值 */
  hrvAvg?: number | null;
  /** 今日步数 */
  steps?: number | null;
  /** 周期第几天（顶部 chip 用） */
  dayInCycle?: number | null;
  /** 当前时刻（默认 now）。今日状态每 30 分钟跳一次，UI 要按这个点算时段与轨迹 */
  now?: number | null;
  /** 今天的今日状态时间线（每 30 分钟一个点，来自 ring.statusTimeline） */
  timeline?: { t: number; value: number }[] | null;
  /** 皮质醇文字标签（正常 / 偏高 / 节律紊乱），来自 hormoneNutrition */
  cortisolLabel?: string | null;
}

/** 今日状态档位（与 DailyStatusCard 刻度同源：26 / 51 / 76） */
const STATE_LEVELS = ['元气满满', '状态良好', '平平静静', '需要休息'] as const;

function stateLevelOf(v: number): string {
  if (v >= 76) return STATE_LEVELS[0];
  if (v >= 51) return STATE_LEVELS[1];
  if (v >= 26) return STATE_LEVELS[2];
  return STATE_LEVELS[3];
}

/** 分钟 → 「1 小时 20 分」 */
function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h <= 0) return `${m} 分钟`;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/** 心率区间文案（避免把 255 这种哨兵值显示成「极限 ≥150」那档） */
function hrLabel(zone: HeartZone): string {
  return zone.min === 0 ? `< ${zone.max} bpm` : `${zone.min}–${zone.max} bpm`;
}

/** 时刻 → 「15:40」 */
function clockLabel(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 时段划分（依据 Stanford Lifestyle Medicine 的皮质醇昼夜节律）：
 *   morning 05–10   皮质醇自然峰 → 只做低到中等强度，别空腹冲大重量
 *   noon    10–14   皮质醇开始回落、精力高 → 训练性价比最高的一段
 *   afternoon 14–18 皮质醇低、力量/耐力/柔韧体感最好 → 想垫强度就选这个点
 *   evening 18–20   还能动，但强度要收，再往上会压睡眠
 *   night   20–05   心率与体温要很久才落得下来 → 只留拉伸与慢走
 */
function slotOf(hour: number): TimeSlot {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 20) return 'evening';
  return 'night';
}

const TIME_NOTE: Record<TimeSlot, string> = {
  morning: '现在是皮质醇的晨峰时段——早上只做低到中等强度，别空腹冲大重量',
  noon: '上午晚些到下午早些，皮质醇正在自然回落，这是今天训练性价比最高的一段',
  afternoon: '傍晚皮质醇本来就低，力量和耐力的体感是这天的峰值，要垫强度就选这个点',
  evening: '离睡觉还差一点，强度收着来：这个点之后再上高强度会压睡眠',
  night: '20 点后心率和体温要很久才落得下来，这个点不做高强度，只剩拉伸和慢走',
};

export function buildTodayWorkout(inp: WorkoutInput): TodayWorkout {
  const nowTs = Number.isFinite(inp.now as number) ? (inp.now as number) : Date.now();
  const phase = inp.phase ?? '未记录';
  const value = Number.isFinite(inp.value as number) ? (inp.value as number) : null;
  const sleepScore = Number.isFinite(inp.sleepScore as number) ? (inp.sleepScore as number) : null;
  const sleepTotalMin = Number.isFinite(inp.sleepTotalMin as number) ? (inp.sleepTotalMin as number) : null;
  const sleepDeepMin = Number.isFinite(inp.sleepDeepMin as number) ? (inp.sleepDeepMin as number) : null;
  const hrv = Number.isFinite(inp.hrv as number) ? (inp.hrv as number) : null;
  const statusAvg = Number.isFinite(inp.statusAvg as number) ? (inp.statusAvg as number) : null;
  const hrvAvg = Number.isFinite(inp.hrvAvg as number) ? (inp.hrvAvg as number) : null;
  const steps = Number.isFinite(inp.steps as number) ? (inp.steps as number) : null;
  const cortisolLabel = inp.cortisolLabel?.trim() ? inp.cortisolLabel.trim() : null;
  const dayInCycle = Number.isFinite(inp.dayInCycle as number) ? (inp.dayInCycle as number) : null;

  const hour = new Date(nowTs).getHours();
  const slot = slotOf(hour);
  const nowLabel = clockLabel(nowTs);

  /* ── 今日状态轨迹（今天半小时一个点，最多取最近 8 个）──
   * timeline 缺 → spark 为空数组、deltaText 为 null，UI 就不画小条、也不编「比今早低 X」 */
  const sparkRaw = Array.isArray(inp.timeline)
    ? inp.timeline.filter((p) => p && Number.isFinite(p.value) && (p.value as number) > 0).slice(-8)
    : [];
  const spark = sparkRaw.map((p) => ({ t: p.t, value: Math.round(p.value as number) }));

  // 当前值优先用最新时间线的点（比 curveStatus 更新鲜、也跟小条末端一致）
  const latest = spark.length ? spark[spark.length - 1] : null;
  const current = value ?? (latest ? latest.value : null);
  const first = spark.length ? spark[0] : null;
  let deltaText: string | null = null;
  if (current != null && first != null) {
    // ★ 必须取整再比：curve 累积值是浮点（7.5333599900150629 之类），
    //   不 round 会直接漏到 UI 上，用户看到一长串小数。
    const cur = Math.round(current);
    const fir = Math.round(first.value);
    if (Math.abs(cur - fir) >= 3) {
      const d = cur - fir;
      deltaText = `比今早 ${clockLabel(first.t)} ${d > 0 ? '高' : '低'} ${Math.abs(d)} 分`;
    }
  }

  // 距上次累积超过 1 小时 → 明确告诉用户「在等下一次刷新」，别让人以为卡住了
  const lastPointGapMs = latest ? nowTs - latest.t : 0;
  const windowNote =
    latest && lastPointGapMs > 60 * 60 * 1000
      ? `现在 ${nowLabel} · 等下一次 30 分钟刷新`
      : `现在 ${nowLabel} · 每 30 分钟更新一次`;

  const isMenstrual = phase === '经期';
  // 经期无条件走恢复档；其余按今日状态分档，睡眠差一档就降（不叠加惩罚，避免过于保守）
  let intensity: Intensity;
  if (isMenstrual) intensity = 'recovery';
  else if (current == null && sleepScore == null) intensity = 'unknown';
  else if (current == null) intensity = sleepScore != null && sleepScore >= 75 ? 'moderate' : 'recovery';
  else if (current >= 65) intensity = sleepScore != null && sleepScore < 60 ? 'moderate' : 'intense';
  else if (current >= 30) intensity = 'moderate';
  else intensity = 'recovery';

  /* ── 时段闸门（皮质醇昼夜节律）：晚上砍到恢复档，早上别冲大强度 ── */
  let timeLimited = false;
  if (slot === 'night' && intensity !== 'recovery') {
    intensity = 'recovery';
    timeLimited = true;
  } else if (slot === 'morning' && intensity === 'intense') {
    intensity = 'moderate';
    timeLimited = true;
  }

  /* ── 从建议库取方案（内容挪到 workoutLibrary，这里只做选择与组装）──
   * 库按「周期阶段 × 强度 × 时段」给 14 套（经期 2 / 卵泡 3 / 排卵 3 / 黄体 3 / 通用 3），
   * 无数据时 intensity 归一成 recovery 查，查不到会自动降档而不是跑去给通用力量训练。 */
  const lib = pickLibraryPlan(phase, (intensity === 'unknown' ? 'recovery' : intensity) as WorkoutIntensity);
  const { headline, hrTarget: libHr } = fillHeartRate(lib);
  const targetZone = HEART_ZONES[lib.hrZone] ?? HEART_ZONES[0];
  const steps3: WorkoutStep[] = lib.steps;
  const cautions: Caution[] = lib.cautions;
  const primaryType = lib.sportType;

  // ── 分析行：只放真实存在的字段，一句一个事实 ──
  const analysis: AnalysisRow[] = [];
  const fact = (tag: string, s: string) => {
    if (!s) return;
    if (analysis.some((r) => r.text === s)) return;
    analysis.push({ tag, text: s });
  };

  // ① 激素行（来自库 rationale，说明这阶段为什么这么定）
  fact('激素', lib.rationale);

  // ② 皮质醇（有数据才说；节律紊乱时不再拼「自然回落/性价比最高」的通用时段句，避免自相矛盾）
  let cortisolNote: string | null = null;
  if (cortisolLabel) {
    cortisolNote = cortisolLabel === '节律紊乱'
      ? '皮质醇节律紊乱，今天强度按保守档来，先顺着身体把节律养回来'
      : `皮质醇${cortisolLabel}，${TIME_NOTE[slot]}`;
    fact('皮质醇', cortisolNote);
  }

  // ③ 今日状态 + 时间轨迹：分数和变化一句话说完，不再堆「（状态良好），比今早…」
  if (current != null) {
    fact('状态', deltaText ? `今日状态 ${Math.round(current)} 分，${deltaText}` : `今日状态 ${Math.round(current)} 分`);
  }
  if (sleepTotalMin != null && sleepTotalMin > 0) {
    let s = `昨晚睡了 ${hm(sleepTotalMin)}`;
    if (sleepDeepMin != null && sleepDeepMin > 0) {
      const pct = Math.round((sleepDeepMin / sleepTotalMin) * 100);
      s += `，深睡 ${hm(sleepDeepMin)}（占 ${pct}%）`;
    }
    if (sleepScore != null) s += `，睡眠得分 ${Math.round(sleepScore)}`;
    fact('昨晚', s);
  }
  if (hrv != null && hrv > 0) {
    if (hrvAvg != null && hrvAvg > 0 && Math.abs(hrv - hrvAvg) >= 2) {
      const d = hrv - hrvAvg;
      fact('HRV', `晨间 HRV ${Math.round(hrv)} ms，比最近几天${d > 0 ? '高' : '低'} ${Math.abs(Math.round(d))} ms`);
    } else {
      fact('HRV', `晨间 HRV ${Math.round(hrv)} ms`);
    }
  }
  if (steps != null && steps > 0) fact('步数', `今天已经走了 ${steps.toLocaleString('en-US')} 步`);

  // 时段本身也说一句（没有皮质醇数据时，这句话交代「为什么是这个强度」）
  if (!cortisolLabel) fact('时段', TIME_NOTE[slot]);

  // 一项数据都没有时，至少解释「为什么看到的不是定制版」
  if (current == null && sleepTotalMin == null && hrv == null) {
    fact('说明', '戒指还没读到今天的睡眠和状态数据，下面是通用保守方案');
  }

  // ── 结论：一句大概建议（温和、女性向、带时段）──
  const totalMinutes = planMinutes(lib);
  const nm2 = lib.sportName;
  let conclusion = '';
  if (slot === 'night') {
    conclusion = `${TIME_NOTE.night.split('，')[0]}：${nm2} ${totalMinutes} 分钟收个尾就够，别再上强度。`;
  } else if (intensity === 'recovery' || intensity === 'unknown') {
    conclusion = isMenstrual
      ? `所以今天动一动就好：${nm2} ${totalMinutes} 分钟，心率压在 ${libHr}，别做大重量和倒立。`
      : `所以今天别硬扛：${nm2} ${totalMinutes} 分钟，走到微微出汗、还能说话的程度就够了，做完应该觉得松而不是累。`;
  } else if (intensity === 'moderate') {
    conclusion = `所以今天正常动就行：${totalMinutes} 分钟 Zone 2 有氧，全程能说话最为准；中途累了随时降一档。`;
  } else if (phase === '黄体期') {
    // 黄体期即便状态分高，也不说「比昨天多垫一点」——跟激素行的「留着余力」保持同一个口径
    conclusion = `所以今天按这个量来就好：${totalMinutes} 分钟轻量循环，中等次数、留两组余力，做完觉得稳就算到位。`;
  } else {
    conclusion = `所以今天可以比昨天多垫一点：${totalMinutes} 分钟轻量循环，中等次数、留两组余力——练完第二天不酸才是对的。`;
  }
  if (timeLimited && slot === 'night') {
    conclusion = `${conclusion.slice(0, -1)}（这个钟点本来就只留轻活动）`;
  }

  const visual = sportVisualOf(primaryType);

  return {
    intensity,
    modeLabel:
      intensity === 'intense' ? '稍加一点强度'
        : intensity === 'moderate' ? '稳着来（Zone 2）'
          : intensity === 'recovery' ? '慢慢来（恢复档）'
            : '保守通用档',
    dataDriven: intensity !== 'unknown',
    stateScore: current == null ? null : Math.round(current),
    stateLevel: current == null ? null : stateLevelOf(current),
    spark,
    nowLabel,
    windowNote,
    deltaText,
    timeSlot: slot,
    timeNote: TIME_NOTE[slot],
    hormoneNote: lib.rationale,
    cortisolNote,
    dayInCycle,
    chipHormone: [
      phase === '未记录' ? '周期' : phase,
      dayInCycle != null ? `第 ${dayInCycle} 天` : '',
    ],
    chipCortisol: ['皮质醇', cortisolLabel ?? '待同步'],
    primaryType,
    primaryName: nm2,
    emoji: visual.emoji,
    color: visual.color,
    totalMinutes: Math.round(totalMinutes),
    headline,
    hrTarget: hrLabel(targetZone),
    targetZone,
    steps: steps3,
    analysis: analysis.slice(0, 4),
    conclusion,
    cautions,
    sourceLine: WORKOUT_SOURCE_LINE,
    fallbackNote: intensity === 'unknown'
      ? '戴上戒指同步一次，这里会按你的今日状态、皮质醇和周期阶段换成定制版本。'
      : undefined,
  };
}

/* ════════════════════════════════════════════════════════════════
 * 运动建议页 V3（mira-design/SPORT-DIET-SPEC-v1.md §2.7）
 * Sims 四阶段文案表：环色 / 档位名 / 副标 / 周期理由 / 推荐池三选二。
 * 全部是静态口径文案（斯坦福 Stacy Sims 周期同步训练法）；
 * 相位、时段、睡眠、皮质醇等数据仍由调用方从真实来源传入，这里不编数据。
 * 口径红线：不宣称改变激素；「燃脂」指供能档位，不是减重承诺。
 */
export interface SportRec {
  name: string;
  minutes: number;
  why: string;
  /** 展示用时间（如「下午 4:30」），与 stat3 时段值同源 */
  timeLabel: string;
}

export interface SportBrief {
  /** 强度环亮段色（当前相位） */
  ringColor: string;
  /** 环中心档位名（恢复 / 黄金窗口 / 巅峰 / 燃脂） */
  gearName: string;
  /** 环中心副标（低 · 温和活动 …） */
  gearSub: string;
  /** 周期理由（adv 第一条） */
  reason: string;
  /** 推荐池（三条） */
  recs: SportRec[];
  /** stat3「时段」值（与推荐第一条时间一致） */
  slotClock: string;
}

/** 时段 → 推荐时间（stat3 与推荐文案必须取同一源） */
const SLOT_TIME = {
  morning: { clock: '08:00', label: '上午 8:00' },
  noon: { clock: '11:00', label: '上午 11:00' },
  afternoon: { clock: '16:30', label: '下午 4:30' },
  evening: { clock: '18:30', label: '傍晚 6:30' },
  night: { clock: '21:30', label: '睡前 9:30' },
} as const satisfies Record<TimeSlot, { clock: string; label: string }>;

interface PhaseSportRow {
  ringColor: string;
  gearName: string;
  gearSub: string;
  reason: string;
  recs: Array<{ name: string; minutes: number; why: string; /** 覆盖默认时段（如睡前拉伸） */ at?: TimeSlot }>;
}

const PHASE_SPORT: Record<string, PhaseSportRow> = {
  经期: {
    ringColor: '#F6B3D0', gearName: '恢复', gearSub: '低 · 温和活动',
    reason: '雌孕激素都在低位，精力偏低——低强度促进循环、缓解不适，猛练反而更累。',
    recs: [
      { name: '散步', minutes: 20, why: '促进循环，缓解腰腹坠胀' },
      { name: '温和瑜伽', minutes: 15, why: '松开腰背，缓和经期不适' },
      { name: '拉伸', minutes: 10, why: '睡前放松，帮入睡', at: 'night' },
    ],
  },
  卵泡期: {
    ringColor: '#C7B9F2', gearName: '黄金窗口', gearSub: '高 · 放开练',
    reason: '雌激素上行，糖原利用好、恢复快——HIIT 和大重量都安排在这几天，收益最高。',
    recs: [
      { name: 'HIIT', minutes: 20, why: '雌激素窗口期，后燃效应最划算' },
      { name: '力量', minutes: 30, why: '恢复快，适合上大重量' },
      { name: '节奏跑', minutes: 25, why: '配速拉一档，体感还不吃力' },
    ],
  },
  排卵期: {
    ringColor: '#D5E384', gearName: '巅峰', gearSub: '高 · 防伤',
    reason: '雌激素到顶、力量最强；但韧带偏松，跳跃和变向前把热身做足。',
    recs: [
      { name: '力量', minutes: 30, why: '力量到顶，可以冲个人最佳' },
      { name: '间歇', minutes: 20, why: '短平快，别拖长' },
      { name: '游泳', minutes: 30, why: '低冲击，护着韧带' },
    ],
  },
  黄体期: {
    ringColor: '#F0C46E', gearName: '燃脂', gearSub: '轻 · 中低强度',
    reason: '孕激素上行，这个阶段身体更偏脂肪供能，中低强度正好烧脂，猛练反而事倍功半。',
    recs: [
      { name: '快走', minutes: 30, why: '体温高峰时段，脂肪动员最顺' },
      { name: '轻力量', minutes: 20, why: '减重量加次数，保肌肉稳代谢' },
      { name: '拉伸', minutes: 10, why: '睡前把压力松掉再睡，别挤掉深睡', at: 'night' },
    ],
  },
};

/** 周期未记录时的通用保守池（不编阶段结论） */
const PHASE_SPORT_FALLBACK: PhaseSportRow = {
  ringColor: '#BCCB62', gearName: '平稳', gearSub: '中低 · 保守档',
  reason: '周期还没记录，先按通用保守档来；记一次经期，这里会换成阶段定制版。',
  recs: [
    { name: '快走', minutes: 20, why: '微微出汗、还能说话的程度就好' },
    { name: '轻力量', minutes: 20, why: '轻重量多次数，留两组余力' },
    { name: '拉伸', minutes: 10, why: '睡前放松肩颈腰背', at: 'night' },
  ],
};

export function buildSportBrief(phase: string, slot: TimeSlot): SportBrief {
  const row = PHASE_SPORT[phase] ?? PHASE_SPORT_FALLBACK;
  const t = SLOT_TIME[slot];
  return {
    ringColor: row.ringColor,
    gearName: row.gearName,
    gearSub: row.gearSub,
    reason: row.reason,
    slotClock: t.clock,
    recs: row.recs.map((r) => ({
      name: r.name,
      minutes: r.minutes,
      why: r.why,
      timeLabel: SLOT_TIME[r.at ?? slot].label,
    })),
  };
}

/** 状态理由（adv 第二条，按优先级取一条；SPEC §2.7 规则列，数据缺失逐级退） */
export function sportStatusReason(inp: {
  sleepTotalMin?: number | null;
  sleepDeepMin?: number | null;
  cortisolLabel?: string | null;
  gearName: string;
  /** ★ v18.96：所选日为今天、但睡眠取自昨天归档时为 true → 文案前缀标注日期，
   *  避免「昨晚睡 7h20m」在隔夜未连戒指时被读成昨夜实测（睡眠可跨天，但日期要写明）。 */
  sleepIsStale?: boolean;
  sleepDateLabel?: string;
}): string {
  const st = inp.sleepTotalMin ?? null;
  const dp = inp.sleepDeepMin ?? null;
  // 睡眠来源标注：正常「昨晚」；跨天沿用昨天数据时改成「昨晚（10/2）」
  const when = inp.sleepIsStale && inp.sleepDateLabel ? `昨晚（${inp.sleepDateLabel}）` : '昨晚';
  if (dp != null && dp < 60) {
    if (st != null) return `${when}睡 ${hm(st)} · 深睡偏短，上强度只会加压，今天把强度收一档。`;
    return `${when}深睡不到 1 小时，上强度只会加压，今天把强度收一档。`;
  }
  if (st != null && st < 390) {
    return `${when}睡 ${hm(st)} · 睡得偏短，上强度只会加压，今天把强度收一档。`;
  }
  if (inp.cortisolLabel === '偏高') {
    return `皮质醇偏高 + 恢复变慢，今天按${inp.gearName}的节奏稳稳来，不靠拼。`;
  }
  return '状态平稳，可以按计划走。';
}
