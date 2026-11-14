/**
 * homeNarrative —— 首页「今日状态」下那三行分析的**规则引擎**（2026-11-11）
 *
 * 用户口径（原话要点）：
 *   · 「你基本没分析，就是在罗列数据」「今天都晚上了又把睡眠恢复拿出来了」；
 *   · Oura 那样「讲人话」：每半小时落一个状态点，基于这个点和之前的表现给综合解读；
 *   · 变差了说可能因为什么，变好了说可能做了什么；再基于同一件事给一条建议；
 *   · 「一定是有时间的顺序的，不可以今天晚上讲昨天晚上的睡眠情况」；
 *   · 规则为主，AI 只能做润色；分析三行、建议一行，字数控制住。
 *   · ★ 2026-11-11 追加（用户点名「晚上这会儿比先前轻快了些，说不好是松下来了，别再塞心事」、
 *     「把灯调暗慢慢收下来」很奇怪）：「看一下 Oura App 怎么讲这些话，更清晰一些，就是说人话的」。
 *   · ★ 2026-11-11 第五次修正（用户：「小时状态往上走，你就夸一下用户呗」「这半小时状态往上走，
 *     说明很放松，可以今天睡个好觉」「建议可以睡前做个护肤啦之类的，洗个热水澡，因为她状态好嘛」）：
 *     **状态回升时不能只报冷事实** —— 允许紧跟一句轻肯定（「这会儿挺放松」「说明身体放松下来了」）
 *     和一句正向展望（「今晚睡个踏实觉」）；建议改成「给自己做点喜欢的事」的**加法**动作
 *     （睡前护肤 / 洗个热水澡），不再是「别再…」「只留一件轻的事」这类减法管教。
 *     边界：轻轻一句就好，不打分、不喊「很棒 / 做得好 / 收得不错」、不诊断；
 *     状态往下时不夸，仍给照顾动作。旧句「说不好是松下来了」的问题是**含糊猜测 + 否定式指令**，
 *     不是「放松」这个词本身 —— 笃定的轻解读可以用。
 *
 * 为什么必须是规则定事实：
 *   旧链路 `useAiInsight('overview')` 按**天**缓存，早上生成的睡眠叙事到深夜还在显示；
 *   本地兜底又把「今天的 77 分，睡眠恢复 89，日间身心压力 47」直接铺上去 —— 两处都被用户点名。
 *   端侧 1.5B 还会把提示词原文、字段名当正文吐出来。故本模块承担「说什么」，
 *   AI 只在 `ai/homePolish.ts` 里承担「换个说法」，且必须过 `isSafePolish()` 同事实闸门。
 *
 * ★ 文案口径（对齐 Oura App，2026-11-11 全网核对后定稿）：
 *   Oura 应用内原句（Lifehacker / Oura 官方 Bedtime Guidance）：
 *     · "Your ideal bedtime is between 10:45 p.m.-11:45 p.m. Last night you went to bed at 11:42 p.m."
 *     · "Your resting heart rate shows that you might not be fully recovered. Take it easy today."
 *     · "Seems like you didn't sleep that well last night... try to do something relaxing today."
 *     · 官方补充："Bedtime Guidance is just a recommendation" —— 是建议，不是规定。
 *   提炼成四条，本文件所有文案逐条遵守：
 *     ① 先说**可核对的事实**：时段 + 状态比之前高/低/没变化；不编原因、不用「说不好是」猜；
 *        ★ 回升时允许紧跟一句轻肯定与正向展望（「这会儿挺放松」「今晚睡个踏实觉」），
 *          但不评分、不写「很棒 / 做得好 / 收得不错 / 安心」这类评语、不诊断；
 *     ② 归因只挂**真实存在的信号**（心率、活动、压力、已发生的动作），一律用「可能和…有关」；
 *        **没有信号就不提原因**（用户：没找到也不用说出来），直接给事实 + 动作；
 *     ③ 后半句只给**一个当下能做的具体动作**（时长 / 对象 / 顺序明确），与建议胶囊同源但不同句；
 *        ★ **睡前**状态好时优先给「加法」——照顾自己、做点喜欢的事（护肤、洗个热水澡）；
 *        不写「慢慢收下来」「别再塞事」这类无操作指向或否定式管教；
 *        （白天时段仍按原有节奏给「趁状态好做费脑的事」，不硬塞睡前动作；傍晚沿用收尾留白。）
 *     ④ 建议行动词开头、≤18 字；不替用户判断今天过得好不好，
 *        ★ 但状态回升时可以是轻的小奖励式动作（睡前护肤 / 洗个热水澡），不是硬性任务。
 *
 * 设计铁律（与 Mira 品牌口径一致）：
 *   · 不用「我们」，不居高临下；不评分、不诊断、不疗愈、不激励口号；
 *   · 归因一律软化（「可能 / 大概」），不宣称因果；
 *   · 只用真实数据：今天、且时刻 ≤ now 的 30 分钟状态点与事件；fill 补齐点不算真实点；
 *   · **睡眠/昨晚只在早晨（06:00–10:00）允许出现**，其余时段连「睡得」都禁；
 *   · 分析与建议共用同一个 reasonKey 与同一个 dayPhase，保证「说的」和「让做的」是同一件事；
 *   · 分析 ≤45 字（三行装得下、完整说完），建议 ≤18 字（胶囊一行）。
 *
 * 纯函数：零 RN / 零 IO，可离线单测。
 */
import { dayPhase, type DayPhase } from './timePhase';

const HALF_MS = 30 * 60 * 1000;
const THREE_H_MS = 3 * 60 * 60 * 1000;

export type Direction = 'up' | 'down' | 'flat' | 'unknown';
export type ReasonKey = 'action' | 'sport' | 'stress' | 'phase' | 'sleep' | 'hr' | 'exercise' | 'none';

export interface NarrativePoint {
  /** 状态点时刻（墙钟 :00 / :30 对齐） */
  t: number;
  /** 状态值 0–100 */
  value: number;
  /** true = 由历史反推补齐的点，不是戒指真实采样 → 叙事不采信 */
  fill?: boolean;
}

export interface NarrativeEvent {
  at: number;
  /** 已发生过的事实短语，如「缓一缓」「动一动」「走了一段」 */
  label: string;
  kind: 'action' | 'sport';
}

export interface HomeNarrativeInput {
  now: number;
  /** 今日 30 分钟状态序列（旧 → 新） */
  points: NarrativePoint[];
  /** 圆环当前档位词（元气满满 / 状态良好 / 平平静静 / 休息一下） */
  mood: string;
  /** 日间身心压力 0–100，无则 null */
  stress: number | null;
  /** 今天真实发生过的事件（干预动作 / 运动段），调用方负责过滤成今天 */
  events: NarrativeEvent[];
  /** 周期相位（黄体期等），无则 null */
  phaseLabel: string | null;
  /** ★ 关系链驱动信号：近 90 分钟心率比静息高出的比例 (hrMean−hrRest)/hrRest，0–1.5+。
   *   用于把状态下滑归因到「心率升高」这个元素（与 dailyStatus.accumulateWindow 的 K_DR_HR 同源）。null = 无数据。 */
  hrElev?: number | null;
  /** ★ 关系链驱动信号：近 90 分钟步数强度 steps/stepBaseline，0–1.5+。
   *   用于归因到「运动 / 活动多」这个元素（与 K_DR_STEP 同源）。null = 无数据。 */
  activity?: number | null;
  /** 睡眠恢复分 —— 仅早晨可能进入叙事，其余时段一律不看 */
  recoveryScore: number | null;
  hasStatusData: boolean;
  /** 状态来自一键体检（曲线无值时） */
  statusFromCheck?: boolean;
}

export interface HomeCta {
  label: string;
  screen: string;
  params?: Record<string, unknown>;
}

export interface HomeSuggestion {
  /** 一行人话，≤18 字；带 cta 时调用方补箭头 */
  text: string;
  cta?: HomeCta;
}

export interface HomeNarrative {
  analysis: string;
  suggestion: HomeSuggestion;
  /** 状态签名：半小时状态点 / 方向 / 时段 / 归因 / 事件一变即换叙事，AI 润色也按它缓存 */
  signature: string;
  reasonKey: ReasonKey;
  direction: Direction;
  phase: DayPhase;
  /** 供 AI 润色校验用：当前允许/禁止的语义上下文 */
  polishCtx: { phase: DayPhase; direction: Direction; reasonKey: ReasonKey };
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function cleanPoints(input: HomeNarrativeInput): NarrativePoint[] {
  const { now, points } = input;
  return (points ?? [])
    .filter(
      (p) =>
        p &&
        typeof p.t === 'number' && Number.isFinite(p.t) &&
        p.t <= now && sameDay(p.t, now) &&
        p.fill !== true &&
        typeof p.value === 'number' && Number.isFinite(p.value) && p.value > 0,
    )
    .sort((a, b) => a.t - b.t)
    .slice(-6);
}

/** 方向：拿最近 1.5 小时的真实点做基线，和最新点比。点数不足 → unknown（不编造变化）。 */
function directionOf(pts: NarrativePoint[]): Direction {
  if (pts.length < 2) return 'unknown';
  const last = pts[pts.length - 1].value;
  const base = pts.slice(0, -1).reduce((a, p) => a + p.value, 0) / (pts.length - 1);
  const d = last - base;
  if (d >= 6) return 'up';
  if (d <= -6) return 'down';
  return 'flat';
}

/** 事件只认「今天、且已发生、且 3 小时内」，取最近一条。绝不拿昨天的行为解释今晚。 */
function recentEvent(input: HomeNarrativeInput): NarrativeEvent | null {
  const { now, events } = input;
  const valid = (events ?? [])
    .filter((e) => e && typeof e.at === 'number' && e.at <= now && e.at >= now - THREE_H_MS && sameDay(e.at, now) && !!e.label)
    .sort((a, b) => a.at - b.at);
  return valid.length ? valid[valid.length - 1] : null;
}

const PHASE_WORD: Record<DayPhase, string> = {
  morning: '早上',
  lateMorning: '上午',
  preNoon: '快到饭点',
  afternoon: '下午',
  evening: '傍晚',
  bedtime: '晚上',
};

/** 归因选择：先看近 3 小时真实发生的事，再看持续信号（心率升高 / 运动 / 压力），最后才用相位；早晨才允许睡眠。
 *  ★ 2026-11-11（用户：状态变差要能挖到「心率升高 / 去运动」这些元素）：新增 hr / exercise 两个数据驱动归因。
 *    它们直接对应 dailyStatus.accumulateWindow 的消耗项 K_DR_HR / K_DR_STEP —— 状态算法本就挂钩这些真实量，
 *    首页分析只是把「是哪些元素在拉低状态」讲出来，形成关系链。 */
function pickReason(
  input: HomeNarrativeInput,
  phase: DayPhase,
  direction: Direction,
  ev: NarrativeEvent | null,
): ReasonKey {
  if (ev) return ev.kind === 'sport' ? 'sport' : 'action';
  // ★ 关系链归因只在「状态确实往下」时成立：把下滑挂到 心率升高 / 运动 / 压力 这些实际在拉低状态的元素。
  // 用 direction==='down'（而非 !=='up'）是为了不让 flat（平稳）也被算成「是运动/压力害的」——
  // 平稳时给「歇十分钟/放松呼吸」会和「状态没什么起伏」自相矛盾。
  if (direction === 'down') {
    const hr = input.hrElev ?? 0;
    const act = input.activity ?? 0;
    const stress = typeof input.stress === 'number' ? input.stress : 0;
    const cands: [ReasonKey, number][] = [];
    if (hr >= 0.15) cands.push(['hr', hr]);
    if (act >= 0.5) cands.push(['exercise', act * 1.1]);
    if (stress >= 55) cands.push(['stress', (stress - 50) / 50]);
    if (cands.length) return cands.sort((a, b) => b[1] - a[1])[0][0];
  }
  if (typeof input.stress === 'number' && input.stress >= 55 && direction === 'down') return 'stress';
  if (phase === 'afternoon' && direction === 'down' && input.phaseLabel === '黄体期') return 'phase';
  if (phase === 'morning' && input.recoveryScore != null) return 'sleep';
  return 'none';
}

/**
 * ★ 关系链从句：状态变差时，把真正在动的驱动元素串成一句（心率升高 / 运动 / 压力），软化表达。
 * 与 pickReason 的「单一主因」互补 —— 这里把同时活跃的元素都列出来（最多 2 个），呈现你要的「关系链」。
 * 睡眠/昨晚只在早晨单独出现，绝不进这里（避免夜里讲昨晚）。
 * ★ 2026-11-11：措辞改「可能和…有关」（Oura 口径），压力用可核对的「还偏高」，不再写「没松开」这种感受词。
 */
function chainClause(input: HomeNarrativeInput): string {
  const parts: string[] = [];
  const hr = input.hrElev ?? 0;
  const act = input.activity ?? 0;
  const stress = typeof input.stress === 'number' ? input.stress : 0;
  if (hr >= 0.15) parts.push('心率比平时高');
  if (act >= 0.5) parts.push('刚动了一阵');
  else if (act >= 0.25) parts.push('活动比平时多');
  if (stress >= 55) parts.push('压力还偏高');
  if (!parts.length) return '';
  return '，可能和' + parts.slice(0, 2).join('、') + '有关';
}

/** 每个组合给两个说法，按半小时槽轮换 —— 状态点一更新，话术也跟着换，不会一整天挂着同一句。
 *  ★ 2026-11-11 全表重写：Oura 口径「可核对的事实 + 可能的原因 + 一个具体动作」。
 *    删除全部「说不好是 / 轻快些 / 松下来了 / 收得不错 / 安心 / 别再塞事 / 慢慢收下来」。 */
function variants(key: string): [string, string] | null {
  const V: Record<string, [string, string]> = {
    // ── 早晨：唯一允许提昨晚睡眠的时段 ──
    'morning|up|sleep': [
      '昨晚睡得比较稳，早上状态比刚起时高了些，这会儿挺舒展。先把最要紧的一件排前面。',
      '这一觉睡得平稳，早上状态在往上走，人也放松了些。今天先做最要紧的那件事。',
    ],
    'morning|down|sleep': [
      '昨晚睡得浅一些，早上状态还没提起来。先挑轻松的事做。',
      '昨晚睡得不太踏实，早上状态比平时低。上午先留一点余量。',
    ],
    'morning|flat|sleep': [
      '昨晚睡眠节奏平稳，早上状态没什么起伏。按平常顺序做今天的事。',
      '昨晚这一觉没大变化，早上状态和刚起时差不多。先定下最要紧的一件。',
    ],
    'morning|up|action': [
      '刚做完那一小段，早上状态比之前高了些，挺放松的。趁现在做费脑的事。',
      '刚才缓了一缓，状态往上走了一点，这会儿挺舒展。把最难的一件放这会儿。',
    ],
    'morning|flat|none': [
      '早上状态没什么起伏，和刚起时差不多。按自己的顺序开局。',
      '今天开局平稳，早上的状态点没大变化。先定下最要紧的一件。',
    ],
    'morning|unknown|none': [
      '今天的状态点还在攒，现在不下判断。先按平常顺序过完早上。',
      '早上的记录还不多，看不出状态变化。按平常节奏起个头。',
    ],
    'morning|down|none': [
      '早上状态比刚起时低了些。先挑轻松的事做。',
      '这会儿状态往下走了些。上午先留一点余量。',
    ],
    'morning|up|none': [
      '早上状态比之前高了些，这会儿挺舒展。先把最要紧的一件做了。',
      '状态在往上走，人也放松了些。费脑的事可以放这会儿。',
    ],
    'morning|down|stress': [
      '早上状态比之前低了些，压力还偏高。先挑轻松的事做。',
      '这会儿状态往下走，压力还偏高。上午先留十分钟空档。',
    ],
    // ── 上午 ──
    'lateMorning|up|action': [
      '刚才缓了一缓，上午状态比之前高了些，挺放松的。费脑的事可以放这会儿。',
      '做完那一小段，状态往上走了一点，这会儿挺舒展。把最难的一件挪到上午。',
    ],
    'lateMorning|down|stress': [
      '上午状态比之前低了些，压力还偏高。先找个地方坐十分钟。',
      '这会儿状态往下走，压力一直没降下来。先做一段放松呼吸。',
    ],
    'lateMorning|flat|none': [
      '一上午状态没什么起伏，和刚开工时差不多。手上的事照顺序做。',
      '上午到现在都是一个节奏，状态没大变化。按现在的步子走。',
    ],
    // ── 临近中午 / 饭点：用户点名「吃点好的吧」+ 拍张照记饮食 ──
    'preNoon|up|action': [
      '刚才缓了一缓，状态比之前高了些，挺放松的。到饭点这顿好好吃一口。',
      '做完那一小段，状态往上走了一点，这会儿挺舒展。这顿留够时间，吃点好的吧。',
    ],
    'preNoon|down|stress': [
      '快到饭点了，状态比上午低了些，压力还偏高。先把饭吃踏实。',
      '这会儿状态往下走，压力没降下来。饭点先放下手上的事。',
    ],
    'preNoon|flat|none': [
      '一上午状态没什么起伏，快到饭点了。这顿别太赶，吃点好的吧。',
      '到饭点这会儿状态没大变化。先把饭吃踏实，下午再说。',
    ],
    // ── 午后 ──
    'afternoon|up|sport': [
      '刚才动了一阵，下午状态比之前高了些，挺舒展的。趁这会儿把收尾做掉。',
      '走动过之后状态往上走了一点，身体也放松了些。费脑的事可以挪到下午。',
    ],
    'afternoon|down|stress': [
      '下午状态比之前低了些，压力还偏高。中间留十分钟空档。',
      '午后状态比上午低了些，压力一直没降下来。先留十分钟空档。',
    ],
    'afternoon|down|phase': [
      '黄体期的下午容易累，这会儿状态比之前低了些。中间留十分钟空档。',
      '下午状态慢慢往下走，可能和当前周期阶段有关。今天少排一件事。',
    ],
    'afternoon|up|action': [
      '刚才缓了一缓，下午状态比之前高了些，挺放松的。趁这会儿把收尾做掉。',
      '做完那一小段，状态往上走了一点，这会儿挺舒展。难的事可以挪到这会儿。',
    ],
    'afternoon|flat|none': [
      '下午到现在都是一个节奏，状态没什么起伏。手上的事照常推进。',
      '午后状态稳着，和上午差不多。按现在的步子走。',
    ],
    // ── 傍晚 ──
    'evening|down|stress': [
      '傍晚状态比下午低了些，压力还偏高。今天到这儿收个工。',
      '到这会儿状态往下走，压力没降下来。剩下的事挪到明天。',
    ],
    'evening|flat|none': [
      '傍晚状态和下午差不多，没大变化。今天到这儿收个工。',
      '这会儿状态没什么起伏，和下午接近。剩下的事挪到明天。',
    ],
    'evening|up|sport': [
      '傍晚动了一阵，状态比下午高了些，挺舒展的。剩下的事挪到明天。',
      '刚才走动过，状态往上走了一点，人也放松了些。今晚留一件轻的事。',
    ],
    // ── 睡前：绝不讲昨晚 / 睡眠恢复 ──
    'bedtime|down|stress': [
      '晚上状态比之前低了些，压力还偏高。做一段放松呼吸再休息。',
      '临睡前状态往下走了些，压力没降下来。先做一段放松呼吸。',
    ],
    'bedtime|flat|none': [
      '晚上状态没什么起伏，和一小时前差不多。给自己留点舒服的时间。',
      '临睡前状态没大变化，和一小时前接近。洗漱完就休息。',
    ],
    'bedtime|up|action': [
      '刚才缓了一缓，状态往上走了，说明身体放松下来了。今晚睡个踏实觉。',
      '做完那一小段，晚上状态比之前高了些，挺放松的。今晚好好歇一歇。',
    ],
    // ── 无明确事件时的方向组合 ──
    // 不硬找由头：只讲「这段时间在变好 / 变差」，找不到信号就**不提原因**，
    // 有信号才写「可能和…有关」；与 Oura 的「可能关联，不是因果证明」同口径。
    // 绝不把昨晚睡眠拿到晚上来解释，也绝不用「说不好是」编一个原因。
    'lateMorning|up|none': [
      '上午状态比之前高了些，节奏挺顺的。费脑的事可以放这会儿。',
      '这会儿状态在往上走，人也放松了些。把最难的一件挪到上午。',
    ],
    'lateMorning|down|none': [
      '上午状态比之前低了些。先挑轻松的事做。',
      '这会儿状态往下走。手上的事挑轻的先做。',
    ],
    'lateMorning|unknown|none': [
      '上午的状态点还在攒，现在不下判断。手上的事照顺序做。',
      '这会儿记录还不多，看不出状态变化。按平常节奏走。',
    ],
    'preNoon|up|none': [
      '快到饭点状态比之前高了些，这会儿挺放松。这顿好好吃一口。',
      '一上午收尾时状态往上走，人也松了些。饭点先把饭吃踏实。',
    ],
    'preNoon|down|none': [
      '快到饭点了，状态比上午低了些。先把饭吃踏实。',
      '这会儿状态往下走。饭点先把饭吃踏实。',
    ],
    'afternoon|up|none': [
      '下午状态比之前高了些，这会儿挺舒展。趁这会儿把收尾做掉。',
      '午后状态在往上走，身体也放松了些。难的事可以挪到这会儿。',
    ],
    'afternoon|down|none': [
      '下午状态比之前低了些。中间留十分钟空档。',
      '午后比上午低了点。下午先留十分钟空档。',
    ],
    'evening|up|none': [
      '傍晚状态比下午高了些，这会儿挺放松。剩下的事挪到明天。',
      '这会儿状态在往上走，身体也松了些。今晚留一件轻的事。',
    ],
    'evening|down|none': [
      '傍晚状态比下午低了些。今天到这儿收个工。',
      '到这会儿状态往下走。剩下的事挪到明天。',
    ],
    'bedtime|up|none': [
      '这半小时状态在往上走，说明身体放松下来了。今晚睡个踏实觉。',
      '晚上状态比之前高了些，这会儿挺放松。今晚好好歇一歇。',
    ],
    'bedtime|down|none': [
      '晚上状态比之前低了些。做段呼吸再休息。',
      '临睡前状态往下走了些。先做一段放松呼吸。',
    ],
    'bedtime|unknown|none': [
      '晚上状态点还不多，现在不下判断。给自己留点舒服的时间。',
      '今天的记录到这儿，状态变化还看不出来。洗漱完就休息。',
    ],
  };
  return V[key] ?? null;
}

/**
 * 组合键回退：① 精确组合（方向 + 归因）→ ② 同方向的通用组合 → ③ 模板拼句。
 * ★ 关键：**绝不回退到别的方向的文案**。旧写法在「回落但无精确组合」时会落到
 *   「状态稳住了」，等于把变差说成没变 —— 正是用户批评的「随便说」。
 *   模板拼句也只吃当前 phase / direction / reason，因此时段与方向天然不可能错。
 */
function analysisText(
  phase: DayPhase,
  direction: Direction,
  reason: ReasonKey,
  slot: number,
  mood: string,
  chain: string,
  useChain: boolean,
): string {
  const pick = Math.abs(slot) % 2;
  // ★ 关系链优先：状态变差且驱动元素明确（心率升高 / 运动 / 多元素同现）时，用紧凑链句，
  //   方向永远正确（专打 down）、≤45 字、软化表达。 lone-stress 仍走下方原有好文案不退化。
  if (useChain && direction === 'down') {
    const OPEN: Record<DayPhase, string> = {
      morning: '早上这会儿', lateMorning: '上午这会儿', preNoon: '快到饭点这会儿',
      afternoon: '下午这会儿', evening: '傍晚这会儿', bedtime: '晚上这会儿',
    };
    const lead = pick ? '状态比刚才低了些' : '状态往下走了些';
    // ★ 2026-11-11：Oura 口径第③条 —— 说完事实与可能的原因，再落一个能立刻做的具体动作。
    const LAND: Record<DayPhase, string> = {
      morning: '先挑轻松的事做', lateMorning: '先挑轻松的事做', preNoon: '先把饭吃踏实',
      afternoon: '中间留十分钟空档', evening: '今天到这儿收个工', bedtime: '做段呼吸再休息',
    };
    return `${OPEN[phase]}${lead}${chain}，${LAND[phase]}。`;
  }
  if (direction !== 'unknown' && reason !== 'none') {
    const v = variants(`${phase}|${direction}|${reason}`);
    if (v) return v[pick];
  }
  const dKey = direction === 'unknown' ? 'flat' : direction;
  const v2 = variants(`${phase}|${dKey}|none`);
  if (v2) return v2[pick];

  const OPEN: Record<DayPhase, string> = {
    morning: '早上这会儿', lateMorning: '上午这会儿', preNoon: '快到饭点这会儿',
    afternoon: '下午这会儿', evening: '傍晚这会儿', bedtime: '晚上这会儿',
  };
  const CHANGE: Record<Direction, string> = {
    // ★ 回升兜底同样带一句轻肯定（变体表未命中时也不会退回冷事实）
    up: '状态比之前高了些，人也放松了些', down: '状态比之前低了些', flat: '状态没什么变化', unknown: '还在攒状态点',
  };
  // sleep 只有早晨允许，但早晨的 sleep 组合已在表里命中；这里留空防止任何时段被拼进睡眠词
  const REASON: Record<ReasonKey, string> = {
    action: '刚缓了一缓，', sport: '刚才动了一阵，', stress: '压力还偏高，',
    phase: '这个阶段容易累，', sleep: '', hr: '心率比平时高，', exercise: '刚动了一阵，', none: '',
  };
  // ★ 2026-11-11：落地句一律是「一个能立刻做的动作」，不再用「慢慢收下来就好 / 别再往脑子里塞事」。
  const LAND: Record<DayPhase, [string, string]> = {
    morning: ['先把最要紧的一件定下来', '按自己的顺序开局'],
    lateMorning: ['费脑的事可以放这会儿', '手上的事照顺序做'],
    preNoon: ['这顿留够时间，吃点好的吧', '先把饭吃踏实'],
    afternoon: ['中间留十分钟空档', '按现在的步子走'],
    evening: ['今天到这儿收个工', '剩下的事挪到明天'],
    bedtime: ['今晚睡个踏实觉', '今晚好好歇一歇'],
  };
  const low = /休息一下|平平静静/.test(mood);
  const land = LAND[phase][pick];
  return `${REASON[reason]}${OPEN[phase]}${CHANGE[direction]}，${low ? '今天先挑轻松的事做' : land}。`;
}

/** 建议与分析同源：同一个 phase + reasonKey + direction 决定，且优先满足用户点名的「中午拍照记饮食」。
 *  ★ 2026-11-11：全部改成动词开头、一个具体动作；删掉「把灯调暗，慢慢收下来」这类无操作指向的散文。
 *  ★ 2026-11-13（v2 自然口语版）：按「时段 × 状态」给更贴近当天生活节奏的建议，
 *    新增 午后久坐（站起来 / 喝水 / 摸个鱼）、傍晚下班（收工 / 运动）、睡前冥想 等场景；
 *    CTA 只接真实落地页：FoodScan(记饮食) / Breathing(呼吸·助眠) / EmotionIntervene(冥想) / ToolTopic(运动)。 */
function suggestionOf(phase: DayPhase, direction: Direction, reason: ReasonKey, slot: number): HomeSuggestion {
  const p2 = Math.abs(slot) % 2;

  // ★ 午后：久坐高发时段 → 站起来 / 喝水 / 摸个鱼（真有心率升高或压力才给呼吸，避免硬塞）
  if (phase === 'afternoon') {
    if (direction === 'up') {
      return { text: p2 ? '把难的那件挪到下午' : '趁这会儿把收尾做掉' };
    }
    if (reason === 'hr' || reason === 'stress') {
      return {
        text: p2 ? '先做一段放松呼吸' : '做个 4-2-6 放松呼吸',
        cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
      };
    }
    if (direction === 'down') {
      return { text: p2 ? '起来走走，下楼透口气' : '喝口水提提神，别硬撑' };
    }
    return { text: p2 ? '摸个鱼缓一缓，喝口水' : '站起来伸个懒腰' };
  }

  // ★ 傍晚下班：收工 / 解压；状态好可顺势动一动
  if (phase === 'evening') {
    if (direction === 'up') {
      return {
        text: p2 ? '精力还够，动一动吧' : '走路回家，顺带松一松',
        cta: { label: '运动建议', screen: 'ToolTopic', params: { topic: 'sport' } },
      };
    }
    if (direction === 'down' || reason === 'stress') {
      return {
        text: p2 ? '今天到这儿，剩下的挪明天' : '收个工，别带回家',
        cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
      };
    }
    return { text: p2 ? '活留明天，别带回家' : '按时收工，路上放空' };
  }

  // ① 用户点名：中午「吃点好的吧」→ 胶囊「拍一张照片记下这餐」
  if (phase === 'preNoon') {
    return {
      text: ['拍张照，记下这顿吃了什么', '顺手拍一张，把这餐记下来'][Math.abs(slot) % 2],
      cta: { label: '去记录', screen: 'FoodScan' },
    };
  }
  // ② 睡前 → 具体动作。
  //    ★ 2026-11-11（用户：状态好就建议「睡前做个护肤」「洗个热水澡」）：回升时给一个
  //      **照顾自己的小奖励**（加法动作），而不是「留十分钟不看屏幕」这种减法。
  //      往下仍给可点的睡前呼吸；平稳给中性的具体动作。都不编造入睡时刻。
  if (phase === 'bedtime') {
    if (direction === 'down') {
      return {
        text: '做个 4-7-8 睡前呼吸',
        cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'sleep' } },
      };
    }
    if (direction === 'up') {
      return { text: p2 ? '洗个热水澡再休息' : '睡前给自己做个护肤' };
    }
    return {
      text: '睡前做个五分钟冥想',
      cta: { label: '去冥想', screen: 'EmotionIntervene' },
    };
  }
  // ③ 状态往下 / 压力堆着 → 放松呼吸（对应分析里的「先做一段放松呼吸」）
  if (direction === 'down' || reason === 'stress') {
    return {
      text: ['做个 4-2-6 放松呼吸', '先做一段放松呼吸'][Math.abs(slot) % 2],
      cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
    };
  }
  // ③a ★ 心率升高导致状态下滑 → 放松呼吸（与「心率比平时高」同源）
  if (reason === 'hr') {
    return {
      text: ['做个 4-2-6 放松呼吸', '先做一段放松呼吸'][Math.abs(slot) % 2],
      cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
    };
  }
  // ③b ★ 运动 / 活动多导致下滑 → 歇一歇（对应「刚动了一阵」）
  if (reason === 'exercise') {
    return {
      text: ['歇十分钟再坐下', '歇十分钟，先喝口水'][Math.abs(slot) % 2],
    };
  }
  // ④ 相位带来的发沉 → 留空档，不给跳跃式 CTA
  if (reason === 'phase') {
    return { text: '下午少排一件事' };
  }
  // ⑤ 刚做过某件事且状态回升 → 顺着这股劲儿
  if (reason === 'action' && direction === 'up') {
    return { text: '趁这会儿，把难的那件做了' };
  }
  if (reason === 'sport' && direction === 'up') {
    return { text: '歇十分钟再坐下' };
  }
  // ⑥ 早上 / 上午 按时段 × 状态 收尾（无 CTA，纯观察型）
  const BY_PHASE: Record<DayPhase, [string, string]> = {
    morning:
      direction === 'up'
        ? ['先把最要紧的一件做了', '趁精神把费脑事排前面']
        : ['先喝杯水，见见光再开工', '按自己的顺序开局'],
    lateMorning:
      direction === 'up'
        ? ['把费脑的事放这会儿', '手上的事照顺序做']
        : ['手上的事照顺序做', '挑轻的先做'],
    preNoon: ['这顿别太赶，好好吃一口', '先把饭吃踏实'],
    afternoon: direction === 'up' ? ['把难的那件挪到下午', '趁这会儿把收尾做掉'] : ['下午留十分钟空档', '按现在的步子走'],
    evening: ['今晚只留一件轻的事', '剩下的事挪到明天'],
    bedtime: ['今晚睡个踏实觉', '今晚好好歇一歇'],
  };
  return { text: BY_PHASE[phase][p2] };
}

/** 生成首页叙事。纯函数，可离线单测。 */
export function buildHomeNarrative(input: HomeNarrativeInput): HomeNarrative {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const phase = dayPhase(new Date(now));
  const slot = Math.floor(now / HALF_MS);
  const pts = cleanPoints({ ...input, now });
  const direction = directionOf(pts);
  const ev = recentEvent({ ...input, now });
  const reasonKey = pickReason({ ...input, now }, phase, direction, ev);

  // 事件短语不直接塞进模板（字数会爆），只用于签名与归因选择；
  // 变体文案里用「刚缓了一缓 / 刚才动了一阵」这类已发生的泛化说法，绝不编造具体动作名。
  // ★ 关系链：状态变差时把「心率升高 / 运动 / 压力」这些实际在拉低状态的元素串成一句。
  const chain = chainClause(input);
  // 仅在「心率升高 / 运动 / 多元素同现」时走链句；lone-stress 仍用下方原有好文案（不退化）。
  const useChain =
    !!chain &&
    direction === 'down' &&
    ((input.hrElev ?? 0) >= 0.15 || (input.activity ?? 0) >= 0.25 || chain.split('、').length >= 2);
  const analysis = analysisText(phase, direction, reasonKey, slot, input.mood || '', chain, useChain);
  const suggestion = suggestionOf(phase, direction, reasonKey, slot);

  const lastPointAt = pts.length ? pts[pts.length - 1].t : 0;
  const signature = [
    lastPointAt, slot, direction, phase, reasonKey,
    ev ? `${ev.kind}@${ev.at}` : 'noevent',
    `hr${input.hrElev != null ? input.hrElev.toFixed(2) : '-'}`,
    `ac${input.activity != null ? input.activity.toFixed(2) : '-'}`,
  ].join('|');

  return {
    analysis,
    suggestion,
    signature,
    reasonKey,
    direction,
    phase,
    polishCtx: { phase, direction, reasonKey },
  };
}

// ── AI 润色的「同事实」闸门（ai/homePolish.ts 使用；纯函数，可单测） ──────────

/** 任何时段都不能出现：机器腔、字段名、栏目词、评分词、结构性残留 */
const ALWAYS_BAN = /[|｜\[\]【】（）()<>：:]|数据显示|检测到|建议如下|评分|得分|分值|\/100|准备度|占比|均值|实测|环比|提示词|第一句|第二句|输出|栏目标题|HRV|SpO2|心率变异|[0-9０-９]/;

/** 睡眠/昨晚：**只有早晨**可以出现 */
const SLEEP_BAN = /昨晚|昨夜|睡眠恢复|睡眠分|深睡|今早|早起|晨间|一觉|睡得|睡了/;
/** 睡前语义：只有睡前/傍晚可以出现 */
const BEDTIME_BAN = /睡前|早点睡|早点躺|护肤|躺下|把灯调暗/;
/** 早晨语义：只有早晨/上午可以出现 */
const MORNING_BAN = /早上|今早|早起|晨间|刚醒/;
/** 饭点语义：只有临近中午可以出现 */
const MEAL_BAN = /饭点|这顿|午饭|吃点好的|好好吃/;
/** 日间语义：睡前不该出现 */
const DAY_BAN = /上午|下午|午后|傍晚|收工|上班|工作|早上|饭点/;
/** 夜间语义：白天不该出现 */
const NIGHT_BAN = /晚上|今晚|临睡|今晚|夜里|睡前|躺下/;

/** 具体事实词：AI 里出现的，必须在规则句里也出现 —— 从机制上禁止润色偷偷加事实。
 *  只收「具体名词/动作」；「状态 / 这会儿 / 节奏」这类泛词由时段禁词表管，不在这里卡，
 *  否则任何润色都过不了闸门，AI 通道会变成摆设。 */
const FACT_WORDS = [
  '睡眠', '昨晚', '饭', '吃', '呼吸', '缓了一缓', '动了一阵', '走动', '压力',
  '黄体', '节律', '收工', '躺下', '放空', '拍', '照', '灯', '空档', '要紧的一件',
  '心率', '活动',
  // ★ 睡前「小奖励」动作词：防止润色凭空塞进规则句里没出现过的具体动作
  '护肤', '热水澡',
];

/**
 * 校验 AI 润色是否只是「换个说法」：
 *  · 不许新增任何数字 / 具体事实词 / 时段词 / 睡眠词；
 *  · 不许改变状态变化方向；
 *  · 不许出现机器腔、栏目词、括号、冒号；
 *  · 长度 12–45 字、单行。
 * 任何一条不满足 → false，调用方回落规则原文（首页永远显示确定正确的一句）。
 */
export function isSafePolish(
  rule: string,
  ai: string | null | undefined,
  ctx: { phase: DayPhase; direction: Direction; reasonKey: ReasonKey },
): ai is string {
  if (!ai) return false;
  const s = String(ai).replace(/\s+/g, ' ').trim();
  if (s.length < 12 || s.length > 45) return false;
  // ★ 润色只能「换个说法」，不能悄悄扩写：最多比规则句多 6 个字，
  //   否则端侧模型会借润色之名塞进新事实（用户要求字数控制住）。
  if (s.length > String(rule).length + 6) return false;
  if (/\n/.test(String(ai))) return false;
  if (ALWAYS_BAN.test(s)) return false;

  const { phase, direction } = ctx;
  if (phase !== 'morning' && SLEEP_BAN.test(s)) return false;
  if (phase !== 'bedtime' && phase !== 'evening' && BEDTIME_BAN.test(s)) return false;
  if (phase !== 'morning' && phase !== 'lateMorning' && MORNING_BAN.test(s)) return false;
  if (phase !== 'preNoon' && MEAL_BAN.test(s)) return false;
  if (phase === 'bedtime' && DAY_BAN.test(s)) return false;
  if (phase === 'morning' || phase === 'lateMorning' || phase === 'preNoon' || phase === 'afternoon') {
    if (NIGHT_BAN.test(s)) return false;
  }

  // 方向一致：回升不能说成发沉，回落不能说成在线
  if (direction === 'up' && /往下|走低|变累|下滑|回落|发沉|提不起来|低了|沉下来/.test(s)) return false;
  if (direction === 'down' && /回升|往上走|变好|轻快了|松快了|状态在线|满格/.test(s)) return false;

  // 不新增具体事实词
  for (const w of FACT_WORDS) {
    if (s.includes(w) && !rule.includes(w)) return false;
  }
  return true;
}

export default buildHomeNarrative;
