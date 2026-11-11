/**
 * homeNarrative —— 首页「今日状态」下那三行分析的**规则引擎**（2026-11-11）
 *
 * 用户口径（原话要点）：
 *   · 「你基本没分析，就是在罗列数据」「今天都晚上了又把睡眠恢复拿出来了」；
 *   · Oura 那样「讲人话」：每半小时落一个状态点，基于这个点和之前的表现给综合解读；
 *   · 变差了说可能因为什么，变好了说可能做了什么；再基于同一件事给一条建议；
 *   · 「一定是有时间的顺序的，不可以今天晚上讲昨天晚上的睡眠情况」；
 *   · 规则为主，AI 只能做润色；分析三行、建议一行，字数控制住。
 *
 * 为什么必须是规则定事实：
 *   旧链路 `useAiInsight('overview')` 按**天**缓存，早上生成的睡眠叙事到深夜还在显示；
 *   本地兜底又把「今天的 77 分，睡眠恢复 89，日间身心压力 47」直接铺上去 —— 两处都被用户点名。
 *   端侧 1.5B 还会把提示词原文、字段名当正文吐出来。故本模块承担「说什么」，
 *   AI 只在 `ai/homePolish.ts` 里承担「换个说法」，且必须过 `isSafePolish()` 同事实闸门。
 *
 * 设计铁律（与 Mira 品牌口径一致）：
 *   · 不用「我们」，不居高临下；不评分、不诊断、不疗愈、不激励口号；
 *   · 归因一律软化（「大概 / 可能 / 看起来」），不宣称因果；
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
 */
function chainClause(input: HomeNarrativeInput): string {
  const parts: string[] = [];
  const hr = input.hrElev ?? 0;
  const act = input.activity ?? 0;
  const stress = typeof input.stress === 'number' ? input.stress : 0;
  if (hr >= 0.15) parts.push('心率比平时高');
  if (act >= 0.5) parts.push('刚动了一阵');
  else if (act >= 0.25) parts.push('活动比平时多');
  if (stress >= 55) parts.push('压力一直没松开');
  if (!parts.length) return '';
  return '，大概和' + parts.slice(0, 2).join('、') + '有关';
}

/** 每个组合给两个说法，按半小时槽轮换 —— 状态点一更新，话术也跟着换，不会一整天挂着同一句。 */
function variants(key: string): [string, string] | null {
  const V: Record<string, [string, string]> = {
    // ── 早晨：唯一允许提昨晚睡眠的时段 ──
    'morning|up|sleep': [
      '昨晚睡得还算稳，早上状态慢慢起来了，先把要紧的一件排前面。',
      '这一觉歇过来了，早上比刚醒时轻快些，趁这会儿定下今天的节奏。',
    ],
    'morning|down|sleep': [
      '昨晚这一觉偏浅，早上还没太提起来，先挑轻松的事慢慢上手。',
      '睡得不太踏实，早上状态还沉，别一上来就排满，给自己留点余量。',
    ],
    'morning|flat|sleep': [
      '昨晚睡得平稳，早上状态没大起伏，按平常的步子走就好。',
      '昨晚这一觉没大起伏，早上不急，先把今天最要紧的一件定了。',
    ],
    'morning|up|action': [
      '早上缓了一缓，状态比刚起时松快些，这件小事看来帮上忙了。',
      '刚做完那件事，早上状态往上走了一点，顺着这个节奏来就好。',
    ],
    'morning|flat|none': [
      '早上这会儿状态挺稳，没有大起大落，先按自己的节奏开局。',
      '今天开局平平稳稳的，早上不必赶，把要紧的一件先定下来。',
    ],
    'morning|unknown|none': [
      '今天刚开始，状态点还在攒，先按自己的节奏把早上过完。',
      '早上的数据还不多，先不急着下判断，慢慢起个头就好。',
    ],
    'morning|down|none': [
      '早上状态还没太提起来，先挑轻松的事慢慢上手。',
      '这会儿状态有点沉，早上别一上来就排满，给自己留点余量。',
    ],
    'morning|up|none': [
      '早上状态慢慢起来了，先把要紧的一件排前面。',
      '比刚起时轻快了些，早上趁这会儿定下今天的节奏。',
    ],
    'morning|down|stress': [
      '早上状态还没提起来，绷着的感觉没散，先挑轻松的慢慢上手。',
      '这会儿状态有点沉，压力还挂着，早上别一上来就排满。',
    ],
    // ── 上午 ──
    'lateMorning|up|action': [
      '刚缓过一口气，上午状态往上走了些，费脑的事可以趁现在。',
      '做完那一小段，状态这半小时轻快了些，难啃的活放上午正合适。',
    ],
    'lateMorning|down|stress': [
      '上午状态往下走了一点，压力一直没怎么松开，先喘口气再继续。',
      '这阵子绷得有点久，上午状态略沉，把节奏放慢半拍看看。',
    ],
    'lateMorning|flat|none': [
      '一上午状态都挺稳，没怎么起伏，手上的事照着做就行。',
      '上午到现在都是一个节奏，状态没大变化，别急着加码。',
    ],
    // ── 临近中午 / 饭点：用户点名「吃点好的吧」+ 拍张照记饮食 ──
    'preNoon|up|action': [
      '刚缓了一缓，这会儿状态往上走，饭点别凑合，吃点好的吧。',
      '做完那一小段，状态松快了些，快到饭点，这顿好好吃一口。',
    ],
    'preNoon|down|stress': [
      '快到饭点了，状态比上午低一点，压力堆着没散，先好好吃顿饭。',
      '这会儿状态有些往下，绷了一上午，饭点先放下手上的事。',
    ],
    'preNoon|flat|none': [
      '一上午状态都挺稳，快到饭点了，这顿别太赶，吃点好的吧。',
      '到饭点这会儿状态没什么起伏，先把饭吃踏实，下午再说。',
    ],
    // ── 午后 ──
    'afternoon|up|sport': [
      '刚才动了一阵，下午状态这半小时回升了，这股劲儿够收个尾。',
      '走动过之后状态往上走了些，看来这一动确实帮上了忙。',
    ],
    'afternoon|down|stress': [
      '下午这会儿状态往下走了些，压力一直没松开，先喘口气再继续。',
      '午后比上午沉了点，绷着的时间有点长，中间给自己留个空档。',
    ],
    'afternoon|down|phase': [
      '黄体期的下午容易发沉，这会儿状态低了些，大概和节律有关。',
      '下午状态慢慢往下走，这个阶段本来就容易累，先别把事排满。',
    ],
    'afternoon|up|action': [
      '刚缓了一缓，下午状态回升了一点，趁这股劲儿把收尾做掉。',
      '做完那一小段，这半小时状态轻快了些，难的事可以挪到这会儿。',
    ],
    'afternoon|flat|none': [
      '下午到现在都是一个节奏，状态没什么起伏，按现在的步子走就好。',
      '午后这会儿状态稳着，没大起也没大落，手上的事照常推进。',
    ],
    // ── 傍晚 ──
    'evening|down|stress': [
      '傍晚状态比下午低了些，绷了一天没怎么松，收个工别再往上堆。',
      '到这会儿状态慢慢下来了，一天的消耗攒着，晚上留轻一点的事。',
    ],
    'evening|flat|none': [
      '傍晚状态稳住了，今天到这儿差不多，剩下的事留到明天吧。',
      '这会儿状态和下午差不多，没再往下走，收个工就先歇着。',
    ],
    'evening|up|sport': [
      '傍晚动了一阵，状态反倒回来了些，今晚留点轻的就好。',
      '刚才走动过，这半小时状态轻快了，收工之后别再排满。',
    ],
    // ── 睡前：绝不讲昨晚 / 睡眠恢复 ──
    'bedtime|down|stress': [
      '晚上这会儿比先前低了一点，绷了一天，收拾收拾早点躺下。',
      '临睡前这会儿状态沉下来了，一天攒的紧还没散，慢慢收个尾。',
    ],
    'bedtime|flat|none': [
      '晚上这会儿状态还稳着，今天到这儿就好，别再往脑子里塞事。',
      '临睡前状态没大起伏，把灯调暗一点，慢慢收下来。',
    ],
    'bedtime|up|action': [
      '刚缓了一缓，临睡前反倒松下来了，今天收得不错。',
      '这半小时状态轻快了些，看来刚才那一小段没白做，安心收尾。',
    ],
    // ── 无明确事件时的方向组合 ──
    // 不硬找由头：只讲「这段时间在变好 / 变差」，可能的原因一律用「说不好 / 大概」软化，
    // 与 Oura 的「可能关联，不是因果证明」同口径；绝不把昨晚睡眠拿到晚上来解释。
    'lateMorning|up|none': [
      '上午状态慢慢上来了，没见什么特别由头，费脑的事趁现在做。',
      '这会儿比刚开工时轻快些，说不好是节奏顺了，难的事放上午。',
    ],
    'lateMorning|down|none': [
      '上午状态往下走了一点，说不好是哪段绷着，先把节奏放慢半拍。',
      '这会儿比早上沉些，没找到明确由头，手上的事挑轻的先做。',
    ],
    'lateMorning|unknown|none': [
      '上午的状态点还在攒，先不下判断，手上的事照着做就行。',
      '这会儿数据还不多，上午按平常的步子走就好。',
    ],
    'preNoon|up|none': [
      '快到饭点状态反倒往上走了些，这顿别凑合，吃点好的吧。',
      '一上午收尾时状态轻快了点，饭点先把饭吃踏实。',
    ],
    'preNoon|down|none': [
      '快到饭点了，状态比上午低一点，先把饭吃踏实，下午再说。',
      '这会儿状态有些往下，说不好是饿了，饭点别赶，吃点好的吧。',
    ],
    'afternoon|up|none': [
      '下午状态慢慢回来了些，没见什么特别由头，趁这股劲儿收个尾。',
      '午后这会儿比先前轻快，说不好是缓过来了，难的事可以挪过来。',
    ],
    'afternoon|down|none': [
      '下午状态慢慢往下走，说不好是这阵子累了，中间留个空档。',
      '午后比上午沉了点，没找到明确由头，先放慢半拍看看。',
    ],
    'evening|up|none': [
      '傍晚状态反倒回来了些，今天收得不错，剩下的事留到明天。',
      '这会儿比下午轻快一点，说不好是松下来了，晚上别再排满。',
    ],
    'evening|down|none': [
      '傍晚状态比下午低了些，一天的消耗攒着，收个工别再往上堆。',
      '到这会儿状态慢慢下来了，说不好是累了，晚上留轻一点的事。',
    ],
    'bedtime|up|none': [
      '临睡前反倒松下来了，今天收得不错，慢慢收个尾就好。',
      '晚上这会儿比先前轻快了些，说不好是松下来了，别再塞新事。',
    ],
    'bedtime|down|none': [
      '晚上这会儿比先前低了一点，一天攒的紧还没散，慢慢收个尾。',
      '临睡前这会儿沉下来了，说不好是绷久了，收拾收拾早点躺下。',
    ],
    'bedtime|unknown|none': [
      '晚上这会儿状态点还不多，先不下判断，慢慢收个尾就好。',
      '今天的记录到这儿，临睡前不急着下判断，把节奏放慢。',
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
    return `${OPEN[phase]}${lead}${chain}。`;
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
    up: '状态往上走了些', down: '状态往下走了些', flat: '状态挺稳', unknown: '还在攒状态点',
  };
  // sleep 只有早晨允许，但早晨的 sleep 组合已在表里命中；这里留空防止任何时段被拼进睡眠词
  const REASON: Record<ReasonKey, string> = {
    action: '刚缓了一缓，', sport: '刚才动了一阵，', stress: '压力一直没松开，',
    phase: '这个阶段容易发沉，', sleep: '', hr: '心率比平时高，', exercise: '刚动了一阵，', none: '',
  };
  const LAND: Record<DayPhase, [string, string]> = {
    morning: ['先把要紧的一件排前面', '先按自己的节奏开局'],
    lateMorning: ['费脑的事可以趁现在', '手上的事照着做就行'],
    preNoon: ['这顿别太赶，吃点好的吧', '先把饭吃踏实'],
    afternoon: ['中间给自己留个空档', '按现在的步子走就好'],
    evening: ['收个工，别把事堆到晚上', '剩下的事留到明天'],
    bedtime: ['慢慢收下来就好', '别再往脑子里塞事'],
  };
  const low = /休息一下|平平静静/.test(mood);
  const land = LAND[phase][pick];
  return `${REASON[reason]}${OPEN[phase]}${CHANGE[direction]}，${low ? '慢一点也没关系' : land}。`;
}

/** 建议与分析同源：同一个 phase + reasonKey + direction 决定，且优先满足用户点名的「中午拍照记饮食」。 */
function suggestionOf(phase: DayPhase, direction: Direction, reason: ReasonKey, slot: number): HomeSuggestion {
  // ① 用户点名：中午「吃点好的吧」→ 胶囊「拍一张照片记下这餐」
  if (phase === 'preNoon') {
    return {
      text: ['拍张照，记下这顿吃了什么', '顺手拍一张，把这餐记下来'][Math.abs(slot) % 2],
      cta: { label: '去记录', screen: 'FoodScan' },
    };
  }
  // ② 睡前 → 具体节奏的睡前呼吸
  if (phase === 'bedtime') {
    return {
      text: direction === 'down' ? '做个 4-7-8 睡前呼吸' : '把灯调暗，慢慢收下来',
      ...(direction === 'down'
        ? { cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'sleep' } } }
        : {}),
    };
  }
  // ③ 状态往下 / 压力堆着 → 放松呼吸（对应分析里的「先喘口气」）
  if (direction === 'down' || reason === 'stress') {
    return {
      text: ['做个 4-2-6 放松呼吸', '先喘口气，做一段放松呼吸'][Math.abs(slot) % 2],
      cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
    };
  }
  // ③a ★ 心率升高导致状态下滑 → 放松呼吸（与「心率比平时高」同源）
  if (reason === 'hr') {
    return {
      text: ['做个 4-2-6 放松呼吸', '先缓一缓，做段放松呼吸'][Math.abs(slot) % 2],
      cta: { label: '去呼吸', screen: 'Breathing', params: { breath: 'calm' } },
    };
  }
  // ③b ★ 运动 / 活动多导致下滑 → 歇一歇（对应「刚动了一阵」）
  if (reason === 'exercise') {
    return {
      text: ['歇十分钟，别马上坐着', '动得不少了，喝口水缓缓'][Math.abs(slot) % 2],
    };
  }
  // ④ 相位带来的发沉 → 留空档，不给跳跃式 CTA
  if (reason === 'phase') {
    return { text: '给自己留十分钟放空' };
  }
  // ⑤ 刚做过某件事且状态回升 → 顺着这股劲儿
  if (reason === 'action' && direction === 'up') {
    return { text: '趁这会儿，把难的那件做了' };
  }
  if (reason === 'sport' && direction === 'up') {
    return { text: '歇十分钟，别马上坐着' };
  }
  // ⑥ 按时段收尾（无 CTA，纯观察型，不画箭头）
  const BY_PHASE: Record<DayPhase, string> = {
    morning: '先把今天要紧的一件定下来',
    lateMorning: '把费脑的事放这会儿',
    afternoon: '中间给自己留个空档',
    evening: '收个工，别把事堆到晚上',
    bedtime: '把灯调暗，慢慢收下来',
    preNoon: '这顿别太赶，好好吃一口',
  };
  return { text: BY_PHASE[phase] };
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
