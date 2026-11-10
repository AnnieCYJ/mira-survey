/**
 * patternHealthMeaning —— 「数字变化，对身体意味着什么」纯规则引擎（2026-11-11）
 *
 * 用户原话：
 *   「规律观察不只是数据上的……不是光给一个数字的变化，数字变化得说明这个
 *     数字变化带来的健康的意义是什么，这个比较关键。比方说我发现你经常午休，
 *     而午休之后的今日状态恢复很好，这说明午休对你的整个精力恢复非常有效。」
 *
 * 真机上被点名的那条：
 *   「日均心率低的那 6 天，心率变异性平均更高一点——两件事是反着走的。」
 *   ← 只有数字关系，没说这对身体意味着什么。本模块补的正是后半句。
 *
 * ══ 设计铁律 ══
 *  ① 零 RN / 零 IO / 零单例，纯函数 → 可离线单测；
 *  ② **规则定事实，AI 不参与生成**（用户一贯口径）；
 *  ③ 用「通常 / 看起来 / 一般 / 往往」软化，不诊断、不评分、不说教、不用「我们」；
 *  ④ 不新增具体数字、不新增原观察里没有的事实；意义句只解释已有数字关系；
 *  ⑤ 观察不到足够样本就不出因果型观察（宁可少说，不编）。
 */

/** 规律观察的最小结构（不 import patternStore，避免把 RN 依赖带进纯模块） */
export interface PatternLike {
  id?: string;
  kind?: string;
  title?: string;
  text?: string;
  evidence?: { n?: number; r?: number; detail?: string } | null;
}

/**
 * 把一条「数字/相关关系」观察翻译成健康意义。
 * 优先按稳定 id 命中（端侧 ai/patterns.ts 的 8 个 id 全覆盖），
 * 云端观察 id 不同 → 按 text 关键词兜底；都不命中 → 按 kind 给通则。
 * 返回 null 表示这条不适合讲意义（如 coverage 数据覆盖说明）。
 */
export function healthMeaningOf(p: PatternLike): string | null {
  const id = String(p.id ?? '');
  const text = String(p.text ?? '');
  const kind = String(p.kind ?? '');

  if (id === 'data_coverage' || kind === 'coverage') return null;

  /* ── ① 按 id 精确命中 ─────────────────────────────────────────── */
  switch (id) {
    case 'resting_hr_hrv':
      // ★ 用户点名的那条：「两件事是反着走的」→ 补上身体意义
      return '安静时心率偏低、心率变异性偏高，通常说明身体在休息里松得下来、恢复得比较充分；这两件事反着走，往往是白天精力余量更足的样子。';
    case 'sleep_nextday_hrv':
      return '前一晚睡得久一些，第二天心率变异性往往更高 —— 看起来睡眠时长在你的恢复里占了不小分量，睡够的第二天身体更有余量。';
    case 'deep_sleep_hrv':
      return '深睡是身体修复最集中的一段；深睡多的那天心率变异性也更高，看起来这段睡眠对你的恢复确实管用。';
    case 'bedtime_regularity':
      return /波动|早晚差|不太稳|有点飘/.test(text)
        ? '入睡时间忽早忽晚，身体的修复节律不容易对齐，白天状态通常也更容易忽高忽低。'
        : '入睡时间稳，身体的节律更容易对齐，白天的精力和状态一般也少一些忽高忽低。';
    case 'weekday_vs_weekend':
      return '工作日和周末的心率/睡眠差得开，看起来身体在一周里跟着节奏切换；差得不算大时，说明两段时间的负荷比较接近。';
    case 'steps_nextday_hr':
      return '活动多的第二天心率略高，通常是身体还在从走动里缓过来、代谢仍转得比较快；人感觉轻松的话，这种小波动一般不用太在意。';
    case 'stress_nextday_hrv':
      return '压力信号偏高的第二天，心率变异性会低一些 —— 看起来一直绷着会占掉一点夜里修复的余地。';
    default:
      break;
  }

  /* ── ② 云端 / 未知 id：按 text 关键词兜底 ───────────────────────── */
  if (/心率变异性/.test(text) && /日均心率|安静|静息|心率低/.test(text)) {
    return '安静时心率偏低、心率变异性偏高，通常说明身体在休息里松得下来、恢复得比较充分，白天精力余量往往更足。';
  }
  if (/深睡/.test(text)) {
    return '深睡是身体修复最集中的一段，深睡占比的变化，通常连着第二天恢复得够不够扎实。';
  }
  if (/前一晚|睡眠时长|多睡|睡得/.test(text) && /心率变异性|恢复/.test(text)) {
    return '睡够的第二天恢复力往往更好，看起来睡眠时长在你的精力补充里占了不小分量。';
  }
  if (/步数|活动|走动/.test(text) && /心率|状态/.test(text)) {
    return '走动多少会连着第二天的身体负担；活动后心率略有变化，通常是身体在从运动里缓过来。';
  }
  if (/入睡|作息|睡眠时间/.test(text)) {
    return '作息稳不稳，关系到身体能不能把修复安排进固定的时间窗，白天状态一般也跟着更可预期。';
  }
  if (/皮电|压力|紧绷/.test(text)) {
    return '压力信号的变化会连着夜里的恢复；绷得久的那些天，身体可用来修复的余地通常少一点。';
  }
  if (/周末|工作日/.test(text)) {
    return '两段日子的差别，多半是负荷和作息在换挡；身体跟着节奏调整，状态起伏也就不奇怪。';
  }

  /* ── ③ 按 kind 给通则（绝不写具体数字、不新增事实） ───────────── */
  if (kind === 'correlation') {
    return '两个数字一起动，通常说明它们背后连着同一段身体状态；留意这种搭配，比单看某一天的数值更容易看懂自己的节奏。';
  }
  if (kind === 'group_diff') {
    return '两组日子差得开，多半是那阵子的作息或负荷不一样；身体跟着换挡，状态也就有了差别。';
  }
  if (kind === 'rhythm') {
    return '身体的节律稳，修复就有固定的时间窗，白天的状态一般也更容易预期。';
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════
 * 因果型观察：行为 → 状态回升（用户举的「午休 → 精力恢复」例子）
 * ══════════════════════════════════════════════════════════════════ */

export interface RecoveryPair {
  /** 行为名（真实记录得来，如「呼吸练习」「中午缓一缓」） */
  label: string;
  /** 当月出现过这个行为的天数 */
  days: number;
  /** 其中「之后状态回升」的天数 */
  liftedDays: number;
  /** 平均回升点数（今日状态 0–100 尺） */
  avgLift: number;
  /** 行为来自真实记录（true）还是只由曲线形态推得（false，措辞要更软） */
  hasRealLog: boolean;
}

export interface CausalObservation {
  id: string;
  text: string;
  meaning: string;
}

/** 样本门槛：不足就不出观察（品牌铁律「样本不够不编」） */
const MIN_DAYS = 3;
const MIN_LIFT_RATIO = 0.6;
const MIN_AVG_LIFT = 2;

/**
 * 由真实配对统计生成「做了 X → 状态回升」的观察，且**必须带健康意义**。
 * 取数在 MonthDiscoveryView 里做（读 statusTimelineByDay + 干预/自报日志），
 * 这里只做门槛判断与文案，保证可离线单测、措辞统一。
 */
export function composeRecoveryObservations(pairs: RecoveryPair[]): CausalObservation[] {
  const out: CausalObservation[] = [];
  for (const p of pairs) {
    if (!p.label || p.days < MIN_DAYS) continue;
    if (p.liftedDays / p.days < MIN_LIFT_RATIO) continue;
    if (!Number.isFinite(p.avgLift) || p.avgLift < MIN_AVG_LIFT) continue;

    if (p.hasRealLog) {
      out.push({
        id: `recovery_${p.label}`,
        text: `这个月有 ${p.days} 天做过「${p.label}」，之后状态大多会回升一点。`,
        meaning: '做完之后的这段回升，说明中途松一松能把绷着的劲卸掉，看起来对精力恢复挺有效。',
      });
    } else {
      out.push({
        id: `recovery_${p.label}`,
        text: `这个月有 ${p.days} 天，${p.label}之后状态会往上走一段。`,
        meaning: '白天中途能把节奏放缓，身体就不必一直硬撑，看起来精力更容易接得上。',
      });
    }
  }
  // 最多 2 条，避免规律观察区被同类句子占满
  return out.slice(0, 2);
}

/* ══════════════════════════════════════════════════════════════════
 * 月度维度统计：哪方面做得好 / 哪方面还缺 / 太阳币主要来源
 * ══════════════════════════════════════════════════════════════════ */

export interface MonthDimensionInput {
  /** 当月各维度达标（= 太阳币）枚数 */
  sunByDim: Record<string, number>;
  /** 当月各维度「有数据/有记录」的天数 */
  coverageByDim: Record<string, number>;
  /** 当月总太阳币 */
  totalSuns: number;
  /** 当月有记录的天数（用于判断样本是否够） */
  daysWithData: number;
}

export interface MonthDimensionInsight {
  id: string;
  label: string;
  text: string;
  meaning: string;
}

const DIM_LABEL: Record<string, string> = {
  sleep: '睡眠恢复',
  activity: '活动达标',
  state: '整体状态',
  cycle: '生理周期',
  mood: '心情记录',
  stress: '身心压力',
  vitals: '身体指标',
  task: '完成的事',
};
/** 讲「还缺一点」时换个说法，避免出现「活动达标还没攒下达标的日子」这种重复 */
const MISSING_LABEL: Record<string, string> = {
  sleep: '睡眠恢复',
  activity: '走动',
};

/** 太阳币只可能来自睡眠恢复 / 活动达标两个维度（与 buildTodayTimeline 同源） */
const SUN_DIMS = ['sleep', 'activity'];

/** 把维度统计翻成「做得好 / 还缺 / 太阳币来源」三句，每句带健康意义 */
export function composeMonthDimensionInsights(input: MonthDimensionInput): MonthDimensionInsight[] {
  const out: MonthDimensionInsight[] = [];
  const suns = SUN_DIMS
    .map((d) => ({ d, n: input.sunByDim[d] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // ① 太阳币主要来源（有币才说）
  if (input.totalSuns > 0 && suns.length) {
    const top = suns[0];
    const label = DIM_LABEL[top.d] ?? '这一方面';
    const allFromOne = suns.length === 1;
    out.push({
      id: 'sun_source',
      label: '太阳主要从哪来',
      text: allFromOne
        ? `这个月的 ${input.totalSuns} 枚太阳，都来自${label}。`
        : `这个月的 ${input.totalSuns} 枚太阳里，${label}占得最多（${top.n} 枚）。`,
      meaning: top.d === 'sleep'
        ? '睡够的那些天，身体夜里修复得比较完整，白天的精力底子通常更稳，达标也就更常见。'
        : '走动够量的那些天，身体白天一直活动着，循环和代谢跟着转起来，达标也就更常见。',
    });
  }

  // ② 哪方面做得比较好（达标最多，或覆盖天数最多的维度）
  const best = SUN_DIMS
    .map((d) => ({ d, n: input.sunByDim[d] ?? 0, cov: input.coverageByDim[d] ?? 0 }))
    .sort((a, b) => b.n - a.n || b.cov - a.cov)[0];
  if (best && (best.n > 0 || best.cov >= 2) && input.daysWithData >= 2) {
    const label = DIM_LABEL[best.d] ?? '这一方面';
    out.push({
      id: 'best_dim',
      label: '做得比较稳的',
      text: best.n > 0
        ? `${label}这个月达标 ${best.n} 次，是你比较稳的一方面。`
        : `${label}这个月有 ${best.cov} 天留下了记录，节奏保持得比较连。`,
      meaning: best.d === 'sleep'
        ? '睡眠这段稳住，等于每天的修复有个固定底，其他方面的波动通常也会小一些。'
        : '活动能连着来，身体更容易保持在动的状态，白天的精力一般也更好接上。',
    });
  }

  // ③ 哪方面还缺（样本够才指出，措辞平实、不催促、不指责）
  //   「缺」= 当月一次达标都没有。分两种：
  //     · 连记录都没有 → 样本不够，老实说看不出规律；
  //     · 有记录但没达标（真机常见：步数天天有、从没到 1 万）→ 说清「还没攒下达标的日子」，
  //       并给健康意义，不说「你应该多走」。
  const missing = SUN_DIMS.find((d) => (input.sunByDim[d] ?? 0) === 0);
  if (missing && input.totalSuns > 0 && input.daysWithData >= 3) {
    const label = MISSING_LABEL[missing] ?? DIM_LABEL[missing] ?? '这一方面';
    const cov = input.coverageByDim[missing] ?? 0;
    out.push({
      id: 'missing_dim',
      label: '还缺一点的',
      text: cov === 0
        ? `${label}这个月还没留下记录，先记着就好。`
        : `${label}这个月还没到过目标，先记着就好。`,
      meaning: cov === 0
        ? '这方面的记录还不够，看不出稳定规律；等日子多一点，再谈它跟状态的关系更靠得住。'
        : missing === 'activity'
        ? '有走动但没到目标，说明白天的活动量还在低位；身体一直偏静态，循环不太容易被带动起来。'
        : '有记录但没达标，这方面的规律还没成形；等日子多一点，再看它跟状态的关系更靠得住。',
    });
  }

  return out;
}
