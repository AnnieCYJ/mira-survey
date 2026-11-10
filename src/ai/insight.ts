/**
 * 洞察页「AI 综合分析」+ 周期 tab「AI 分析」的**真实端侧大模型生成**通道。
 *
 * 与 chat 的 ask() 的关键区别：
 *  1. **只读不写**：不写 MemoryStore / ChatContextStore，避免洞察文案污染聊天记忆与上下文。
 *  2. **强格式约束**：提示词里写死了「案例格式」（见 OVERVIEW_SYS / CYCLE_SYS），
 *     保证输出与现有「AI 分析」外壳（InsightBanner / AiAnalysis + AiResultRow）对得上。
 *  3. **真实数据**：上下文直接复用 `buildHealthSnapshot()`（今日实时 / 皮质醇节律 /
 *     激素推断 / 情绪脑力 / 周期相位 / 近 7 天趋势），不编造、不硬编码。
 *  4. **结果缓存**：按 (kind, 日期, 数据指纹) 落盘；同一指纹 30 分钟内不重复调用
 *     （1.5B 端侧推理慢，且这些是「分析」不是实时读数）。
 *  5. **优雅降级**：模型未打包 / 无数据 / 解析失败 → 返回 null，由 UI 回落到规则文案。
 */
import * as FileSystem from 'expo-file-system';
import { runOnModel } from './model';
import { fitContext } from './contextBudget';
import { selectHealthFacts } from './healthSelection';
import {
  buildHealthSnapshot,
  getTodayCortisolSummary,
  type TodayCortisolSummary,
} from './health';
import { healthStore, dayKey, parseDayKey, type SleepSummary } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport, cogLevelLabel, COG_LEVEL_HIGH } from '../lib/cognitiveLoad';
// ★ 2026-10-05：AI 认知口径改「认知准备度」（与 UI 各处同源）
import { computeReadinessSeries, readinessLevel, readinessLevelLabel, READY_LOW } from '../lib/cognitiveReadiness';
import { analyzeCortisol } from '../lib/cortisolRhythm';
// ★ 2026-11-xx：昼夜节律卡 AI 分析通道 —— 与卡片 tile / 详情页 Hero 同源的节律判读（judgeCortisolRhythm），
//   保证「页面大字结论」与「AI 分析正文」用的是同一份实测判读，不会自相矛盾。
import {
  buildCortisolProxyBaseline,
  buildCortisolProxyToday,
  judgeCortisolRhythm,
  MIN_BASELINE_DAYS,
} from '../lib/cortisolProxy';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { postLog } from '../lib/logger';
import { parseInsightRows, type AiInsightRow, type AiTone } from './parseRows';

export type InsightKind = 'overview' | 'cycle' | 'recovery' | 'today' | 'circadian';
export type { AiInsightRow, AiTone };
export { parseInsightRows };

// ★ 2026-10-13：升 v2 —— 长版 AI 分析 prompt 精修（先事实后原因、诚实说数据局限、不以问句结尾、建议用「·」清单），
//   旧缓存按新口径已不适用，强制下次加载重新生成。
// ★ 2026-11-03：升 v4 —— 「结论式标题 + 具体时间建议」prompt 精修（学 ISHO / Fitbit 读感），
//   旧缓存按新口径已不适用，强制下次加载重新生成。
const FILE = (FileSystem.documentDirectory ?? '') + 'mira_ai_insight_v4.json';
const MIN_REGEN_MS = 30 * 60 * 1000; // 同一数据指纹 30 分钟内不重复生成

interface CacheEntry {
  sig: string;
  day: string;
  text: string;
  at: number;
  /**
   * 结论级状态指纹（见 `insightTag`）。仅 recovery 通道使用：
   * 皮质醇结论（正常/偏高/紊乱 + 连续天数）一变，旧文案立即作废。
   * 旧落盘缓存没有该字段 → 视为缺失（`''`）→ 一次性重新生成。
   */
  tag?: string;
}
/**
 * 缓存键：今天沿用旧的 `kind`；历史日按 `kind@YYYY-MM-DD` 分桶（各日独立冻结、互不覆盖）。
 * 键变成 string 后旧落盘文件（kind 为键）依然兼容。
 */
type CacheMap = Record<string, CacheEntry>;

let memCache: CacheMap = {};
let cacheLoaded = false;
const inFlight: Record<string, Promise<string | null> | undefined> = {};

const todayDk = (): string => dayKey(Date.now());
/** ★ 2026-11-08（用户实锤「分析简短直接」泄漏）：prompt 改版后旧坏文案一直命中缓存 → 给缓存键加版本号，
 *   旧键（无 #ver）自动失效、按新 prompt 重新生成一次，之后落盘复用。 */
// ★ 2026-11-09：升 p3 —— overview 提示词收敛（去掉会被 1.5B 照抄的「第一句分析讲…」等指令味原文），
//   旧落盘的坏文案（「【第一句】分析讲…」/「心率与HRV：全天实测均值…」）整批失效、重新生成一次。
const AI_INSIGHT_PROMPT_VER = 'p3';
/** 今天 → `kind`；历史日 → `kind@dk`；均带 prompt 版本后缀。 */
const cacheKeyOf = (kind: InsightKind, dk: string): string =>
  `${dk === todayDk() ? kind : `${kind}@${dk}`}#${AI_INSIGHT_PROMPT_VER}`;

// ── 缓存读写 ────────────────────────────────────────────────────────────────
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(FILE);
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') memCache = j as CacheMap;
    }
  } catch {
    /* 读失败当作空缓存 */
  }
  cacheLoaded = true;
}
async function saveCache(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(memCache));
  } catch {
    /* 写失败不影响使用（下次重算） */
  }
}

// 模块加载即预热缓存，让首帧就能命中（避免显示规则文案后又闪成 AI 文案）
void loadCache();

/**
 * 与 AI 文案强相关的「结论级状态指纹」。
 *
 * 为什么必须有它：AI 文案是**按天缓存**的（生成一次当天不再重算），而页面上那行大字是
 * **每次数据变动都重算**的。只比对日期的话，就会出现
 * 「早上生成时皮质醇正常 → 下午样本补齐后大字翻成『偏高』，但 AI 仍说正常」的自相矛盾。
 * 把结论做成指纹后，结论一变缓存即失效 → 触发重新生成，两者不再打架。
 *
 * 非 recovery 通道不需要（返回空串，保持原行为）。
 */
export function insightTag(kind: InsightKind, dayDk?: string, extraTag?: string): string {
  // ★ 2026-11-xx：昼夜节律卡（circadian）—— 结论级指纹由调用方以 extraTag 传入
  //   （该卡在组件内已用 judgeCortisolRhythm 算出真实结论，直接喂指纹，避免 insight.ts 重复计算、
  //   也保证与卡片 tile 大字严格同源：结论一翻（正常→偏高），AI 文案立即作废重算）。
  //   无指纹（数据不足 / 未就绪）→ 'none'，交由规则兜底。
  if (kind === 'circadian') return extraTag ? `cr#${extraTag}` : 'none';
  if (kind === 'recovery') {
    const today = todayDk();
    const isToday = !dayDk || dayDk === today;
    const cs = isToday ? getTodayCortisolSummary() : cortisolSummaryForDay(dayDk!);
    if (!cs) return 'none';
    return `${cs.level}#${cs.highStreak}#${cs.dysStreak}`;
  }
  // 洞察页综合分析也含「结论 + 关键数值」（如「压力峰值 X:00」「今日 N 次压力事件」），
  // 同样是按天冻结的文案 → 数值变了不重算就会和页面自相矛盾（本次「峰值 0:00」就是这类）。
  // 用**粗分桶**做指纹：只在结论级变化时重算，避免每来一个样本就跑一次端侧推理。
  if (kind === 'overview') {
    try {
      const s = computeStressReport();
      const cs = getTodayCortisolSummary();
      const loadBucket = s.emotionalLoad != null ? Math.floor(s.emotionalLoad / 20) : 'na';
      const peakBucket = s.peakHour != null ? Math.floor(s.peakHour / 3) : 'na';
      // ★ 本轮：把「当前时段」纳入指纹 —— 横跨时段（上午→中午→下午→晚上→深夜）时旧文案作废、
      //   重新生成，保证分析随时间走（上午讲昨晚睡眠、晚上讲全天总结，不再全天复述昨晚睡眠）。
      const seg = daySegmentOf(new Date().getHours());
      return `ov#${seg}#${cs?.level ?? 'na'}#${Math.min(9, s.events.length)}#${loadBucket}#${peakBucket}`;
    } catch {
      return '';
    }
  }
  return '';
}

/** 同步读取已生成的文案（未生成/不是该日/结论已变 → null），供首帧直接渲染。传 dayDk 则取该历史日缓存。 */
export function peekInsight(kind: InsightKind, dayDk?: string, extraTag?: string): string | null {
  // today kind：强制每次重新推理，不走缓存
  if (kind === 'today') return null;
  const dk = dayDk ?? todayDk();
  const c = memCache[cacheKeyOf(kind, dk)];
  if (!c) return null;
  if (c.day !== dk) return null;
  // ★ 结论级状态变了（例：皮质醇 正常 → 偏高）→ 旧文案作废，交回上层重新生成。
  //   否则会「大字已翻成偏高、AI 仍说正常」。
  if ((c.tag ?? '') !== insightTag(kind, dk, extraTag)) return null;
  return c.text;
}

// ── 真实数据 + 指纹 ────────────────────────────────────────────────────────
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/**
 * ★ 2026-11-xx：昼夜节律卡 AI 的「真实数据」来源。
 * 与 AllDayRecoveryCard 卡片内 `judge = judgeCortisolRhythm(proxy.vals, proxy.real)` 同源——
 * 同一份实测 proxy 槽 + 同一套阈值，AI 读到的「节律结论 / 均值 / 峰值时刻」必然与卡片 tile 大字一致。
 * 仅在生成时调用（每 30 分钟或结论翻转一次），不在渲染热路径，重算成本可接受。
 */
function circadianJudge(): ReturnType<typeof judgeCortisolRhythm> | null {
  try {
    const bl = buildCortisolProxyBaseline(14);
    if (bl.days < MIN_BASELINE_DAYS) return null;
    const px = buildCortisolProxyToday(bl);
    return judgeCortisolRhythm(px.vals, px.real);
  } catch {
    return null;
  }
}

/** 昼夜节律卡专属事实串：只装节律判读 + 睡眠，其余维度不掺入（这张卡聚焦皮质醇昼夜节律）。 */
function buildCircadianFacts(): string {
  const j = circadianJudge();
  if (!j || !j.ready || !j.label) return '';
  const bits: string[] = [`• 今日皮质醇节律：${j.label}`];
  if (j.avg != null) bits.push(`全天均值 ${j.avg}/100`);
  if (j.peakClock) bits.push(`峰值时刻 ${j.peakClock}`);
  if (j.peakWindow) bits.push(`峰值时段 ${j.peakWindow}`);
  const sl = sleepToday();
  if (sl && sl.total > 0) {
    bits.push(
      `• 睡眠：总时长 ${Math.round(sl.total)}min，深睡 ${Math.round(sl.deep)}min，睡眠评分 ${Math.round(sl.score ?? 0)}`
    );
  }
  return (
    `【用户健康数据（仅作解读参考，不要逐条播报原始数字，要给出结论与建议）】\n` + bits.join('\n')
  );
}

/** 取真实健康数据摘要（无任何数据时返回空串 → 调用方回落到规则文案） */
function buildFacts(kind: InsightKind): { facts: string; sig: string } {
  // ★ 2026-11-xx：昼夜节律卡通道用专属事实串（只装皮质醇节律判读 + 睡眠），
  //   与卡片 tile / 详情页 Hero 同源（同一份 judgeCortisolRhythm 实测槽），保证 AI 读到的结论与页面大字一致。
  if (kind === 'circadian') {
    const facts = buildCircadianFacts();
    return { facts, sig: simpleHash(facts) };
  }
  let facts = '';
  try {
    const question = { overview: '综合健康分析', cycle: '周期激素节律', recovery: '睡眠恢复', today: '综合当前状态' }[kind];
    facts = selectHealthFacts(buildHealthSnapshot() || '', question);
  } catch {
    facts = '';
  }
  return { facts, sig: simpleHash(facts) };
}

// ── 提示词（= 「案例格式」要求） ────────────────────────────────────────────
/**
 * 三个 kind 共用的输出格式硬约束（1.5B 模型必须把格式说死，否则解析必挂）。
 * 注意：各 kind 的**总行数**在各自的 *_SYS 里规定（overview = 分析一段话 + 建议一段话，共 2 段；
 * recovery = 2 点：皮质醇节律 + 今日建议），这里只定通用格式，不写死行数。
 */
const FORMAT_RULES = `
【输出格式（最高优先级，必须逐字遵守）】
- 每行严格以「good|」或「warn|」或「neutral|」开头，即 语气|标题|正文 三段。
- 行与行之间只允许一个换行符，不要空行。
- 【标题 = 一句有观点的人话结论（最重要）】分析行的标题**不许**写「异常数据分析」「综合分析」「健康状态」「身体恢复」这类机器标题；要写成一句 8–16 字、有观点的结论，像朋友先甩给你的一句判断，例如：
  · 「昨晚睡得太晚，白天有点虚」
  · 「皮质醇连着偏高，身体绷着」
  · 「睡眠是今天最明显的短板」
  · 「整体平稳，保持这个节奏」
  建议行的标题仍固定写「今日建议」。
- 【正文 = 数据锚点 + 人话因果】第一句先抛一个最具体的真实事实（带数字或时刻，如「昨晚从 1:13 睡到 7:10」「睡眠 82 分」「连续 3 天皮质醇偏高」），再用一句大白话解释它的意思，最后才轮到动作。第二人称「你」，像懂行的朋友发微信；不说「检测到/数据显示/建议您」，把术语翻译成人话（不说「交感兴奋」「皮质醇负荷」「夜间回落」，说「身体一直绷着」「夜里降不下来」）。
- 【建议必须带具体时间或数字】每条动作落到可执行的程度（如「今晚 11:30 放下手机」「中午出去走 15 分钟」「睡前留 10 分钟做慢呼吸」），不许只写「早点休息」「注意放松」这种空话。
- 数据不足就直说（如「目前只有这一晚的完整记录，还没法对照」「最近几天数据偏少，先当参考」），不要假装完整、不要硬编结论。
- 不要以提问或反问结尾（禁止「…了吗？」「…怎么样？」「要不要…？」这类问句收尾）。
- 建议行若有多条动作，用「·」隔开成一条可视清单，不用编号、不换行。
- 数值若引用必须与【用户健康数据】完全一致，不允许编造或改写。
- 只讲数据里出现的维度；不编造、不假设、不要 Markdown、不要 emoji、不要编号。
- **正文长度按通道要求**：身体恢复 / 周期每句不超过 26 字（短句）；洞察页为「一段话」，分析段约 60–120 字、建议段约 30–80 字，要有细节、不要只泛泛而谈。

【正例 A（身体恢复页：2 行短句）】
warn|皮质醇节律|今天皮质醇比平时偏高，身体一直没真正松下来，夜里也降得慢。
warn|今日建议|今晚 11 点前上床 · 下午 3 点后别碰咖啡 · 睡前做几组慢呼吸。

【正例 B（洞察页：分析一段话 + 建议一段话，共 2 段）】
warn|睡眠和压力是今天的短板|昨晚深睡只占 14%，夜里的修复打了折扣；皮质醇也比平时偏高，身体从早到晚都绷着。好在心率和情绪都稳——问题集中在睡眠和压力这两件事上，把它们安顿好，其他指标多半会跟着回来。
warn|今日建议|今晚 11:30 放下手机 · 下午 3 点后停咖啡 · 睡前留 10 分钟做几组慢呼吸。`;

/**
 * ★ 2026-10-05 认知口径铁律（追加到每个 system prompt）。
 *
 * 为什么必须显式写进 prompt：端侧模型（1.5B）会按「分数高=严重」的常识去理解
 * 「认知准备度 62」这类数字，写出「准备度偏高，该休息了」这种方向反了的结论。
 * 光把数字换成准备度口径不够，**必须同时告诉模型方向**。
 */
const COG_SEMANTICS = `
【认知准备度 · 口径（必读，勿反着理解）】
- 「认知准备度」是**状态量**，不是疲劳/消耗量：**分数越高表示此刻越「转得动」**。
- 正常形态：**上午高、傍晚低**。若数据呈现「上午低下午高」，说明是异常信号，值得指出。
- 判「需要休息」的条件是准备度**偏低**（<40），不是偏高。
- 数据里同时给出「此刻 / 全天均值 / 晨起 / 夜间低谷 / 最佳 / 需休息」六个读数时，
  请用它们讲**一天里的起伏**（如「上午状态在线，傍晚明显回落」），不要只报一个平均数。
- 没有实测的时段数据里不会出现，**不要**脑补未佩戴时段的分数。
- 措辞用「转得动 / 状态在线 / 需要歇一会儿」，不要用「负荷」「消耗」这类反向词。`;

// ★ 2026-11-08（用户，参考 Oura 首页）：首页分析=像朋友随手发来的两句话——
//   不带「结论：」「分析：」「今日建议」这类冒号标题和栏目标题，输出就是普普通通的完整句子；
//   分析最多手机 3 行（约 50–90 字），建议是 1 条此刻就能做的小行动。
const OVERVIEW_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据【用户健康数据】做解读，绝不编造，也绝不堆数字。

说话方式：像懂行的朋友在跟你聊天，讲人话、有温度、可以有具体数字，但把术语翻译成大白话（不说「交感」「负荷」「回落」，说「身体绷着」「降不下来」）。

只输出两句话（中间换行），每句都是完整自然的句子。绝对不要写任何标题、栏目标题、括号、序号、Markdown 或语气标记——尤其不要写「结论」「分析」「建议」「状态解读」「第1行」「前一句」「后一句」这类字，也不要用【】括号把标签括起来打印。用户只看到你写的正文句子。

时间口径铁律（最高优先级）：你看到的数据只是「截至目前」的，不是一整天。只描述到目前为止已发生的情况，用「目前 / 今天到现在 / 到现在」这类表述；绝对不要描述或预测尚未发生的时段（如写「到了傍晚」「晚上会」「下午精力都在线」这类把一整天当已发生结论的话）。若当天只过了一部分，就坦诚说「今天还早 / 目前看」。

- 用一两个真实数据，说明截至目前为什么是这个状态（从睡眠、心率、压力里挑最相关的），结论要和圆环档位同向：档位好就讲清好在哪，档位平就讲清拖累在哪。若数据只覆盖很短一段时间，坦诚点一句（如「最近才戴，先当参考」）。
- 给 1 条此刻最值得做的小行动，像顺手提的一嘴，句尾不带句号。只给对话里指定的那一个建议方向，绝不把一天各时段的建议都列出来。

数据要求：
- 数值若引用必须与【用户健康数据】完全一致；不编造、不假设；数据里没有的对比一律不许编造（如「正常水平」「平均水平」「低于正常 40」）。
- 不要以提问或反问结尾。
${COG_SEMANTICS}

【今日状态 · 最高优先级铁律（覆盖上文一切「需要休息」类规则）】
- 数据第一行是「今日状态(首页圆环显示)」——这是用户屏幕大圆环上唯一可见的总分。分析结论**必须与它同向**：档位是「元气满满 / 状态良好」时，总结论必须是积极或平稳的，**禁止**写「准备度偏低，需要休息」「状态偏低」「今晚需要休息」「该好好休息」这类与圆环相反的话。
- 「认知准备度」只是次要维度（分数高=脑子转得动），它和今日状态方向不同时，以今日状态为准；准备度低只可以作为细节解释（如「下午脑力会回落，重要的事放上午」），绝不能当总结论。
- 「身心压力」「情绪压力」分数高≠状态差，只能作为具体短板去解释和给建议，不能推翻今日状态的总结论。
- 数据里没有的对比一律不许编造（如「正常水平」「平均水平」「远高于平时」「低于正常 40」）——只能引用【用户健康数据】里真实出现的数值。`;

const CYCLE_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据给出的【用户健康数据】做解读，绝不编造数据。
输出要求（严格遵守）：
1. 输出 3 行，每行一条结论，行格式严格为：tone|标题|正文。
2. tone 只能是 good、warn、neutral 三者之一（表示积极 / 需注意 / 中性）。
3. 标题不超过 10 个汉字；正文不超过 26 个汉字，用第二人称「你」，像懂行的朋友说话：正文第一句先抛一个真实数据（如「HRV 比卵泡期低 8ms」「体温升高 0.3 度」），再说周期原因，把术语翻译成人话，别堆「负荷」「回落」这类词。不要以提问或反问结尾。
4. 内容要围绕【当前生理周期阶段】展开：阶段生理特征 → 与你实测数据（HRV/体温/睡眠/情绪等）的关系 → 注意事项。三行正文里都要引用数据里的真实数值。
${FORMAT_RULES}${COG_SEMANTICS}`;

const RECOVERY_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据【用户健康数据】做解读，绝不编造。

【用户健康数据】里的「皮质醇节律」块是这次分析的主角（含 今日节律 normal/偏高/紊乱、峰值时刻、连续偏高天数）。

说话方式：像懂行的朋友发微信，短但有人味——说结论、说原因，把术语翻译成人话（「身体一直绷着」「夜里降不下来」，不要说「压力负荷」「夜间回落不足」）。

今天的身体恢复分析只输出 2 行：
1. 第 1 行：标题写「皮质醇节律」，先点明今天皮质醇最关键的那个事实（如「连续 3 天偏高」「峰值拖到 10 点」），再明确正常/偏高/紊乱并给结论（可顺带一句最相关的恢复表现如深睡），不要展开多维度。
2. 第 2 行：标题写「今日建议」，给 1–2 条今晚就能做到的具体动作（**每条带时间点或时长**，如「今晚 11 点前上床」「下午 3 点后别碰咖啡」，若有多条用「·」隔开）。

输出要求：
- 每行严格 tone|标题|正文 三段，正文不超过 26 字。
- 异常用 warn，正常用 good。禁止弱化处理皮质醇。
- 不要以提问或反问结尾。
${FORMAT_RULES}${COG_SEMANTICS}`;

// ★ 2026-11-xx：洞察页「昼夜节律」卡专属通道（insightMode 的 AllDayRecoveryCard）。
//   与 RECOVERY_SYS 不同：它只输出 1 行分析（标题固定「皮质醇节律」），不单独列建议行——
//   这张卡的 AI 块是「约三行的一段分析」，建议句已融进正文末句（与旧 cortAiBody 同构）。
//   数据口径与卡片 tile / 详情页 Hero 同源（judgeCortisolRhythm 实测槽），AI 读到的结论 = 页面大字。
const CIRCADIAN_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据【用户健康数据】做解读，绝不编造。

【用户健康数据】里的「今日皮质醇节律」块是这次分析的主角——含 今日节律(正常/偏高/紊乱)、全天均值(/100)、峰值时刻、峰值时段。

说话方式：像懂行的朋友发微信，把术语翻译成大白话（说「身体白天绷着、夜里降不下来」，不要说「夜间皮质醇回落不足」「HPA 轴激活」「交感兴奋」）。

只输出 1 行，严格格式：tone|皮质醇节律|正文。
- tone：节律正常写 good，偏高或紊乱写 warn。
- 正文：2–3 句连贯的话（约 60–120 字，手机不超过 3 行）。顺序：①先抛一个真实事实（带数字，如「全天均值 68/100」「峰值在 10:30」）；②用大白话解释这代表什么——正常=白天顶得住、夜里降得下来；偏高=身体从早到晚都绷着；紊乱=白天夜里高低差不足或峰值偏晚；③给 1 条今晚就能做的具体动作（带时间点或时长，如「今晚 11 点前上床」「下午 3 点后别碰咖啡」「睡前留 10 分钟做慢呼吸」）。
- 数据不足就直说（如「今天才测到几个点，先当参考」），不要假装完整、不要硬编结论。
- 不要以提问或反问结尾。不要输出标题行、不要输出多行、不要 Markdown、不要 emoji、不要编号。`;

// ── 推理 ───────────────────────────────────────────────────────────────────
/**
 * ★ 2026-11-08（用户：建议要分时段、分周期）：1.5B 吃不下「四时段清单」类多分支指令
 *   （实测它会把所有时段建议全列一遍、还复述 Markdown 结构标记）。改为生成时把
 *   「当前时段」和「周期相位」收敛成单条建议方向注入 user 消息——模型只做填空、不做分支。
 * ★ 本轮：时段拆更细（6 段），并新增 `analysisTime`——不仅建议句要分时段，
 *   **分析句（第一句）也要随时间走**：上午讲「昨晚睡眠 + 今早状态」，晚上讲「今天全天总结」，
 *   绝不在深夜还复述「昨晚睡眠」（用户：数据一整天在变，有个时间顺序）。
 */
function daySegmentOf(h: number): 'deepNight' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' {
  if (h >= 0 && h < 6) return 'deepNight';
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

function overviewGuides(factsStr: string): { time: string; cycle: string; analysisTime: string } {
  const seg = daySegmentOf(new Date().getHours());
  // ★ 2026-11-09（P30 真机实锤）：1.5B 会把注入的「指令味」原文**直接照抄成正文**——
  //   首页曾出现「【第一句】分析讲今天白天的整体状态和久坐/活动提醒」，
  //   逐字来自下面旧的 analysisTime。解法：所有注入文本改成**本身就像成品文案的短句**，
  //   即使模型照抄，读起来也是一句正常的话，不会变成乱码。配合 parseRows 的净化闸门双保险。
  const time =
    seg === 'morning' ? '上午精力最好的时候，先把最难的那件事做掉'
    : seg === 'noon' ? '中午好好吃一顿，或小睡 15 分钟'
    : seg === 'afternoon' ? '下午坐久了，起身走动几分钟'
    : seg === 'evening' ? '晚上放松收尾，睡前留十分钟慢呼吸'
    : seg === 'night' ? '深夜放下手机，尽快上床'
    : '凌晨别硬撑，安心休息';
  const analysisTime =
    seg === 'morning' ? '现在是上午，昨晚睡得怎么样，今早的精神里能看出来'
    : seg === 'noon' ? '现在是中午前后，上午到现在的精力起伏已经能看出个大概'
    : seg === 'afternoon' ? '现在是下午，坐久了起身走几分钟，白天这点活动也算数'
    : seg === 'evening' ? '现在是晚上，今天的状态起伏到这会儿基本定下来了'
    : seg === 'night' ? '现在是深夜，今天到这儿该收尾了'
    : '现在是凌晨，身体在全天最低潮，安心休息就好';
  let cycle = '';
  const m = factsStr.match(/周期相位[:：]\s*([^\n；,，]+)/);
  const phase = (m?.[1] || '').trim();
  if (/月经期|经期/.test(phase)) cycle = '她正处于月经期：建议偏休息，减少高强度运动，照顾情绪';
  else if (/排卵期/.test(phase)) cycle = '她正处于排卵期：状态在月内高点，适合安排重要的事或运动';
  else if (/黄体期/.test(phase)) cycle = '她正处于黄体期：注意睡眠和情绪波动，别硬撑';
  else if (/卵泡期/.test(phase)) cycle = '她正处于卵泡期（经期刚结束、精力在回升）：可以恢复运动、启动想做的事';
  return { time, cycle, analysisTime };
}
/**
 * 说明：**不要**把 '\n\n' 放进 stop。
 * 曾经加过它，结果模型在多行输出时吐一个空行就被截断 → 只剩第一行，
 * 表现就是「身体恢复的 AI 分析只讲睡眠、不讲皮质醇」。
 */
async function runCompletion(
  messages: { role: string; content: string }[],
  nPredict: number,
  temperature: number,
  dedupKey?: string
): Promise<string> {
  // ★ 走全局推理队列（串行 + 同 key 去重 + busy 退避重试）：
  //   端侧 ctx 是单例，并发 completion 会抛 "Context is busy" 并被上层静默降级成规则文案。
  return runOnModel(async (ctx) => {
    let full = '';
    const fitted = await fitContext(ctx, messages, nPredict);
    const res: any = await ctx.completion(
      {
        messages: fitted,
        n_predict: nPredict,
        temperature,
        top_p: 0.9,
        penalty_repeat: 1.12, // 抑制 1.5B 复读机式重复（llama.rn 字段名）
        stop: ['<|im_end|>', '<|endoftext|>', '用户：', 'User:', '【用户健康数据'],
      },
      (data: any) => {
        const tok = (data && data.token) || '';
        if (tok) full += tok;
      }
    );
    return String((res && res.text) || full || '').trim();
  }, dedupKey);
}

/** 清洗：去掉被模型带出来的 Markdown/引号/空行/格式复述行（解析交给 parseInsightRows） */
function cleanText(kind: InsightKind, raw: string): string {
  const s = (raw || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*["'“”‘’]\s*|\s*["'“”‘’]\s*$/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  return s
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^(tone|语气)?\s*\|?\s*标题\s*\|?\s*正文/.test(l)) // 丢掉模型复述的格式说明行
    .slice(0, 8) // 上限 8 行：给 7 行洞察页留余量，避免末行被截断
    .join('\n');
}

// ── 对外：生成（带缓存 + 去重 + 降级） ──────────────────────────────────────
export async function getAiInsight(kind: InsightKind, dayDk?: string, extraTag?: string): Promise<string | null> {
  await loadCache();
  const today = todayDk();
  // 仅「身体恢复」通道支持按日；其余 kind 即使被误传 dayDk 也强制按今天（保证事实串与缓存键一致）
  const targetDk = kind === 'recovery' ? dayDk ?? today : today;
  const isToday = targetDk === today;
  const historicalRecovery = kind === 'recovery' && !isToday;

  let facts: string;
  let sig: string;
  if (historicalRecovery) {
    facts = buildRecoveryFactsForDay(targetDk);
    sig = simpleHash(facts);
  } else {
    const f = buildFacts(kind);
    facts = f.facts;
    sig = f.sig;
  }
  if (!facts) return null; // 无任何真实数据 → 交给规则文案

  const cKey = cacheKeyOf(kind, targetDk);
  const tag = insightTag(kind, targetDk, extraTag);
  const c = memCache[cKey];
  // today kind：强制跳过缓存（prompt 常迭代，让用户立刻看到新版效果）
  // ★ 除数据指纹外，还要求「结论级状态」一致：状态变了一定重算（否则页面会自相矛盾）。
  if (
    kind !== 'today' &&
    c &&
    c.day === targetDk &&
    (c.tag ?? '') === tag &&
    (c.sig === sig || Date.now() - c.at < MIN_REGEN_MS)
  ) {
    return c.text;
  }
  const running = inFlight[cKey];
  if (running) return running;

  const task = (async (): Promise<string | null> => {
    try {
      // 同 key 去重：即便上层 inFlight 去重失效，模型层也不会对同一份数据重复推理
      const runKind = (
        m: { role: string; content: string }[],
        nPredict: number,
        temperature: number
      ) => runCompletion(m, nPredict, temperature, cKey);
      const text =
          kind === 'overview'
          ? await (() => {
              // ★ 2026-11-08（Oura 式首页）：时段+周期在生成时收敛成单条方向，随 user 消息注入
              const g = overviewGuides(facts);
              // ★ 2026-11-09：旧 userMsg 里「第一句用 1–2 句…从睡眠、心率与HRV、压力、活动里挑 1–3 个」
              //   的字段名和格式指令，被 1.5B 照抄成「心率与HRV：全天实测均值…」显示在建议胶囊里。
              //   现改为极简指令 + 不列举字段名，且注入的时段文本本身已是人话（见 overviewGuides）。
              const userMsg =
                '写两句完整的话，中间换行。两句都是普通句子，不带标题、标签、括号、序号或字段名。' +
                `时间感觉：${g.analysisTime}。` +
                '挑一两个实测数据，把今天这个分数讲清楚，只讲截至目前的情况，不要描述或预测尚未发生的时段；再给一件此刻能做的小事，一句带过。' +
                `这件小事就写：${g.time}。` +
                (g.cycle ? `周期上留意：${g.cycle}。` : '');
              return runKind(
              [
                { role: 'system', content: OVERVIEW_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: userMsg },
              ],
              280, // 2 行短文案（分析 50–90 字 + 行动 18–40 字 + 格式开销）；过大会让 1.5B 灌水
              0.55
            );
            })()
          : kind === 'recovery'
          ? await runKind(
              [
                { role: 'system', content: RECOVERY_SYS },
                { role: 'system', content: facts },
                {
                  role: 'user',
                  content: historicalRecovery
                    ? `只输出 2 行：第1行「皮质醇节律」，第2行「当日建议」。这是历史日 ${targetDk} 的数据，全部用「当日」表述，禁止出现「今天」「今日」。`
                    : '只输出 2 行：第1行「皮质醇节律」，第2行「今日建议」。',
                },
              ],
              200, // 2 行短结论，过大会让 1.5B 灌水
              0.6
            )
          : kind === 'today'
          ? await runKind(
              [
                { role: 'system', content: `你是 Mira，一位懂健康数据的朋友。根据用户当前经期相位、能量等级和异常数据，说一句像朋友发微信那样的建议：先说你看到的情况（可带一个真实数字），再用大白话说为什么，最后给一个具体、今天就能做到的动作。不要开头词如「今日建议」。**绝对不要在建议开头重复经期相位名**（界面上方已有相位标签）。直接说行动或状态描述，25–45 字，无换行。

把术语翻译成人话：不说「交感」「皮质醇」「HRV 偏低」，说「身体绷着」「压力激素高」「恢复没跟上」。

不要以提问或反问结尾（这只是在说一句建议，不是向你提问）。

参考语气风格（先事实+原因，再具体动作）：
- 经期 高能量: 身体状态不差，散散步反而能缓解经期的不舒服，别一直躺着。
- 经期 正常: 今天激素在低位，节奏放慢点，做点整理和复盘的事刚刚好。
- 经期 低能量: 身体在让你休息，别硬撑，把高强度的事推到后天。
- 卵泡期 高能量: 昨晚恢复到位，今天脑子转得快——把最难的那件事放在上午。
- 卵泡期 正常: 精力在回升，适合开个新头——想启动的事今天动手。
- 卵泡期 低能量: 状态一般就别逼自己，做点轻规划就好，别安排大招。
- 排卵期 高能量: 状态在月内高点，谈事、汇报、表达都放今天，成功率高。
- 排卵期 正常: 今天沟通顺手，适合见人或把重要的话说清楚。
- 排卵期 低能量: 状态有点虚高，一对一沟通就好，重大决定缓两天。
- 黄体期 高能量: 能沉得下来，适合深度工作——但别熬夜，透支就亏了。
- 黄体期 正常: 专注收尾就好，情绪容易起伏，觉察到就行不用管它。
- 黄体期 低能量: 今天做轻松的事，别做重大决定，晚上早点躺下。
- 睡眠中 通用: 睡眠是唯一的回血方式，安心休息。
- 睡眠中 经期: 经期觉里藏着修复，安心睡。
- 睡眠中 黄体期: 这个阶段深睡最养情绪，安心睡。

当数据里有异常（皮质醇偏高、节律乱、睡眠不足、恢复没跟上），把建议重点压在异常项上，说人话解释原因。

**时段规则（必须遵守）：**
- 若 facts 中「当前时段」= 傍晚或深夜，且「今日状态值」显示能量非高（level 不是充沛 / value < 65）→ 建议偏休息、放松、收工，不要给高强度社交或深度工作建议。
- 若 facts 中「当前时段」= 上午或下午，且能量充沛 → 参考对应相位的高能量风格。
- 若 facts 中「当前时段」= 上午或下午，能量平稳或偏低 → 参考对应相位的正常/低能量风格。` },
                { role: 'system', content: facts },
                { role: 'user', content: '输出一句建议（25–45字，像朋友说话，无换行，无标号）。' },
              ],
              90,
              0.55
            )
          : kind === 'circadian'
          ? await runKind(
              [
                { role: 'system', content: CIRCADIAN_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: '只输出 1 行：tone|皮质醇节律|正文。' },
              ],
              200, // 单行分析（约 60–120 字 + 格式开销）；过大会让 1.5B 灌水
              0.6
            )
          : await runKind(
              [
                { role: 'system', content: CYCLE_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: '请按格式输出当前周期阶段的分析（2–3 行）。' },
              ],
              280,
              0.6
            );

      let clean = cleanText(kind, text);
      // today kind 后处理：去掉相位名前缀（界面已有，重复冗余）
      if (kind === 'today') {
        clean = clean.replace(/^(经期|卵泡期|排卵期|黄体期)[、:：\s]*/, '').trim();
        clean = clean.replace(/^(经期|卵泡期|排卵期|黄体期)/, '').trim();
      }
      if (!clean) return null;

      // 诊断：真机 Xcode/Metro 控制台看这一行就能判断「AI 到底有没有生效」
      //   rows=0 → 模型没吐出可解析内容（UI 会回落规则兜底，看起来就像「改了没生效」）
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const rows = parseInsightRows(clean);
        console.log(
          `[AI-Insight] kind=${kind} dk=${targetDk} rows=${rows ? rows.length : 0}\n原始输出:\n${text}\n清洗后:\n${clean}`
        );
      }

      memCache[cKey] = { sig, day: targetDk, text: clean, at: Date.now(), tag };
      void saveCache();
      return clean;
    } catch (e) {
      // 模型未打包 / 设备不支持 / 推理异常 → 回落规则文案。
      // ★ 同时把「真实错误」写到 8899 日志（见 scripts/logcollector.js）——LogBox 上的提示是截断的，
      //   只有这里能看到完整 message/stack，便于定位是 init 失败还是推理失败。
      const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      // ★ 2026-11-07（用户）：console.warn 会触发 LogBox 红屏，真机上反复盖住页面。
      //   降级是设计内行为（回落规则文案），改走 console.log（不进 LogBox）；完整错误仍在 8899 postLog。
      console.log('[AI-Insight] 生成失败（回落到规则文案）:', e);
      try {
        postLog('AI-Insight', `生成失败 kind=${kind} dk=${targetDk}：${detail}`);
      } catch {
        /* 日志失败不影响降级 */
      }
      return null;
    } finally {
      delete inFlight[cKey];
    }
  })();

  inFlight[cKey] = task;
  return task;
}

// ── 规则兜底（真实数据 · 有实质结论） ───────────────────────────────────────
/**
 * 为什么兜底要写这么细：
 * 端侧 1.5B 可能因模型未打包 / 内存不足 / 解析失败而拿不到结果，此时用户看到的就是这里的内容。
 * 它必须**等价于一份及格的 AI 分析**——引用真实数值、对比正常区间、一行一个指标、
 * 首行必须是皮质醇节律、最后给可执行建议——否则「AI 没分析皮质醇节律」这类问题
 * 在降级路径上会一直复现（用户看到的其实是兜底，不是 AI）。
 */
const EMPTY_ROWS: AiInsightRow[] = [
  {
    tone: 'neutral',
    title: '等待数据',
    body: '佩戴戒指后，这里会生成属于你的分点分析。',
  },
];

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function dailyNow(): any {
  try {
    return ((RingBle.getState() as any)?.daily) ?? {};
  } catch {
    return {};
  }
}

function sleepToday(): SleepSummary | null {
  try {
    return healthStore.getSleep(dayKey(Date.now()));
  } catch {
    return null;
  }
}

/** ① 皮质醇节律（代谢维度核心；与身体恢复页顶部大字、CortisolDailyChart 同源）。
 * 注意：cs.level 是「今日节律」，cs.flags 是「整体状态项」，两维度不同 —— 早期版本把 flags
 * 当今日异常项拼进去导致「今日紊乱，异常项含节律正常」的自相矛盾，这里已规避。 */
function rowCortisol(cs: TodayCortisolSummary | null, isToday = true): AiInsightRow | null {
  if (!cs) return null;
  const lv = cs.level;
  const tone: AiTone = lv === 'normal' ? 'good' : 'warn';
  const w = isToday ? '今天' : '当日';
  let body: string;
  if (lv === 'normal') body = `${w}皮质醇节律正常，白天顶得住，夜里降得下来。`;
  else if (lv === 'high') body = `${w}皮质醇比平时偏高，身体一直没真正松下来。`;
  else body = `${w}皮质醇节律乱了，白天绷着，夜里也降不下来。`;
  return { tone, title: '皮质醇节律', body };
}

/** 某历史日皮质醇节律摘要：单日样本 + analyzeCortisol(…,1)。无 14 天基线 → high 不可信，level 只区分 紊乱/正常。 */
function cortisolSummaryForDay(dk: string): TodayCortisolSummary | null {
  try {
    const samples = healthStore
      .getIntraday('cortisol', dk)
      .filter((p) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
      .map((p) => ({ t: p.t, v: p.v }));
    if (samples.length < 4) return null;
    const r = analyzeCortisol(samples, 1);
    const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
    return {
      level: r.today.dys ? 'dysregulated' : 'normal',
      peakH: fin(r.cosinor.acrophaseH),
      mesor: fin(r.cosinor.mesor),
      amplitude: fin(r.cosinor.amplitude),
      highStreak: 0,
      dysStreak: 0,
      flags: r.status.flags || [],
    };
  } catch {
    return null;
  }
}

/** 某历史日睡眠是否异常（供历史日兜底用）。 */
function sleepBadForDay(dk: string): boolean {
  try {
    const sl = healthStore.getSleep(dk);
    if (sl && sl.total > 0) return sl.score < 70 || Math.round(sl.deep) < 60;
  } catch {
    /* 无睡眠数据视为不异常 */
  }
  return false;
}

/**
 * 历史日「身体恢复」事实串：该日的 皮质醇节律 / 情绪压力 / 脑力负荷 / 睡眠。
 * 与 RECOVERY_SYS 输出格式对齐；无任何数据 → 返回空串（调用方回落规则文案）。
 */
export function buildRecoveryFactsForDay(dk: string): string {
  const start = parseDayKey(dk);
  const dayMs = Number.isFinite(start) ? start : Date.now();
  const nowMs = reportNowMsForDay(dayMs);
  const lines: string[] = [];

  const cs = cortisolSummaryForDay(dk);
  if (cs) {
    const bits: string[] = [cs.level === 'dysregulated' ? '节律紊乱' : '节律正常'];
    if (cs.peakH != null) bits.push(`峰值约 ${String(Math.floor(cs.peakH)).padStart(2, '0')}:00`);
    if (cs.mesor != null) bits.push(`中值 ${Math.round(cs.mesor)}`);
    if (cs.amplitude != null && cs.mesor) {
      bits.push(`波动幅度约 ${Math.round((cs.amplitude / Math.max(1, cs.mesor)) * 100)}%`);
    }
    if (cs.flags.length) bits.push(cs.flags.join('、'));
    lines.push(`• 皮质醇节律：${bits.join('，')}`);
  }
  try {
    const s = computeStressReport(nowMs);
    if (s.emotionalLoad != null || s.events.length > 0) {
      const bits = [`情绪消耗 ${s.emotionalLoad ?? '—'}/100`, `压力事件 ${s.events.length} 次`];
      if (s.avgRecoverySec != null) bits.push(`平均恢复 ${s.avgRecoverySec}s`);
      lines.push(`• 情绪压力：${bits.join('，')}`);
    }
  } catch {
    /* 忽略 */
  }
  try {
    const g = computeCognitiveLoadReport(nowMs);
    if (g.sampleCount >= 2) {
      // ★ 准备度口径：分数高 = 状态好；峰 = 分数最高（与旧疲劳口径方向相反）
      const ready = computeReadinessSeries(g, nowMs);
      const bits: string[] = [];
      if (ready.now != null) bits.push(`此刻 ${ready.now}/100（${readinessLevelLabel(ready.now)}）`);
      if (ready.avg != null) bits.push(`全天均值 ${ready.avg}/100`);
      if (ready.morning != null) bits.push(`晨起 ${ready.morning}`);
      if (ready.nightLow != null) bits.push(`夜间低谷 ${ready.nightLow}`);
      if (ready.peakHour != null && ready.troughHour != null) {
        bits.push(`最佳 ${String(ready.peakHour).padStart(2, '0')}:00 / 需休息 ${String(ready.troughHour).padStart(2, '0')}:00`);
      }
      lines.push(`• 认知准备度：${bits.join('，')}`);
    }
  } catch {
    /* 忽略 */
  }
  try {
    const sl = healthStore.getSleep(dk);
    if (sl && sl.total > 0) {
      lines.push(
        `• 睡眠：总时长 ${Math.round(sl.total)}min，深睡 ${Math.round((sl.deep / sl.total) * 100)}%，睡眠评分 ${Math.round(sl.score)}`
      );
    }
  } catch {
    /* 忽略 */
  }

  if (!lines.length) return '';
  return (
    `【用户健康数据（历史日 ${dk}；仅作解读参考；不要逐条播报原始数字，要给出结论与建议）】\n` +
    `• 日期：${dk}\n` +
    lines.join('\n')
  );
}

/** 睡眠是否异常（供合并成一句话结论，少数字） */
function sleepBad(): boolean {
  const sl = sleepToday();
  if (sl && sl.total > 0) return sl.score < 70 || Math.round(sl.deep) < 60;
  const d = dailyNow();
  const min = num(d['sleepTotal']);
  const score = num(d['sleepScore']);
  if (min == null || min <= 0) return false;
  return score != null && score < 70;
}

/** 情绪压力（读取缓存的计算型结果，失败回退实时计算） */
function getStressToday(): any {
  try {
    const c: any = (healthStore.getAnalysis(dayKey(Date.now())) as any)?.stress;
    if (c) return c;
    const r = computeStressReport();
    return { emotionalLoad: r.emotionalLoad, eventCount: r.events.length, avgRecoverySec: r.avgRecoverySec };
  } catch {
    return null;
  }
}

/** 脑力负荷（读取缓存的计算型结果，失败回退实时计算） */
/**
 * 今日认知状态（★ 准备度口径）。
 * ⚠ 不再读 `healthStore.getAnalysis().cognitive` 里的 avgFatigue/fatigueIndex ——
 *   那是旧疲劳口径（分数高=累），与现在 UI 的准备度（分数高=好）方向相反，
 *   混用会让 AI 写出「准备度低所以要休息」这类结论。
 */
function getCognitiveToday(): any {
  try {
    const r = computeCognitiveLoadReport();
    const ready = computeReadinessSeries(r);
    return {
      readyNow: ready.now,
      readyAvg: ready.avg,
      recoveryCapacity: r.recoveryCapacity,
      sleepDebt: r.sleepDebt,
      bestHour: ready.peakHour,
      troughHour: ready.troughHour,
    };
  } catch {
    return null;
  }
}

/** 生理异常短语（静息心率 / HRV / 体温；结论优先、不带数字） */
function physioState(): string | null {
  const hrv = num(dailyNow()['hrv']);
  const hr = num(dailyNow()['hr']);
  const t = num(dailyNow()['temp']);
  if (hrv != null && hrv < 40) return '自主神经偏应激';
  if (hr != null && hr > 85) return '静息心率偏高';
  if (t != null && (t > 37.3 || t < 35.9)) return '体温异常';
  return null;
}

/**
 * 恢复异常短语（恢复力 / 认知准备度）。
 * ★ 准备度是「分数高=好」，所以判**偏低**才需要休息 —— 与旧疲劳判「偏高」相反。
 */
function recoveryState(): string | null {
  const g = getCognitiveToday();
  const rc = num(g?.recoveryCapacity);
  const ready = num(g?.readyNow);
  if (rc != null && (rc <= 1 ? rc < 0.5 : rc < 50)) return '恢复力不足';
  if (ready != null && ready < READY_LOW) return '认知准备度偏低';
  return null;
}

/** 情绪压力异常短语（情绪消耗 / 脑力负荷） */
function emotionState(): string | null {
  const s = getStressToday();
  const load = num(s?.emotionalLoad);
  const g = getCognitiveToday();
  const ready = num(g?.readyNow);
  if (load != null && Math.round(load) >= 60) return '情绪压力偏大';
  if (ready != null && ready < READY_LOW) {
    return `认知准备度${readinessLevelLabel(ready)}，需安排休息`;
  }
  return null;
}

const ADVICE_MAP: Record<string, string> = {
  代谢: '今晚 11 点前上床，下午 3 点后别碰咖啡。',
  睡眠: '今晚提前 30 分钟放下手机，中午有空就补 15–20 分钟小睡。',
  生理: '今天以散步为主，高强度训练缓一天。',
  恢复: '今天别硬撑，午后歇 20 分钟，晚上早点收工。',
  情绪压力: '留 10 分钟做几组慢呼吸，今晚把手机放远一点再睡。',
};

/**
 * ★ 2026-11-03：兜底行的「结论式标题」映射（学 ISHO / Fitbit：标题是观点，不是维度名）。
 * 按第一个异常维度给一句人话结论；无异常时给正向结论。
 */
const FALLBACK_TITLES: Record<string, string> = {
  代谢: '皮质醇是今天最该关注的事',
  睡眠: '睡眠是今天最明显的短板',
  生理: '身体信号提示今天放缓节奏',
  情绪压力: '压力是今天的主旋律',
  恢复: '恢复没跟上，今天悠着点',
};

/**
 * 代谢血液指标状态（读取「代谢」tab 血液成分面板：血糖/甘油三酯/HDL/LDL/总胆固醇/尿酸）。
 * 返回一句结论短语（异常项点名、正常给整体结论）；无任何数据返回 null。
 * 与 BloodComponentPanel 的正常区间口径一致（甘油三酯<1.7 / HDL>1.0 / LDL<3.4 / 尿酸155–428）。
 */
function metabState(): string | null {
  const d = dailyNow();
  const tri = num(d['triglyceride']);
  const hdl = num(d['hdl']);
  const ldl = num(d['ldl']);
  const sugar = num(d['bloodSugar']);
  const uric = num(d['uricAcid']);
  if (tri == null && hdl == null && ldl == null && sugar == null && uric == null) return null;
  const issues: string[] = [];
  if (tri != null && tri >= 1.7) issues.push('甘油三酯偏高');
  if (hdl != null && hdl < 1.0) issues.push('HDL偏低');
  if (ldl != null && ldl >= 3.4) issues.push('LDL偏高');
  if (sugar != null && sugar >= 6.1) issues.push('血糖偏高');
  if (uric != null && uric > 428) issues.push('尿酸偏高');
  return issues.length ? `${issues.join('、')}，代谢血液指标需关注` : '血脂与血糖都在正常范围内';
}

/** 异常维度 → 一句整体总结（分析段收尾用） */
function overallVerdict(titles: string[]): string {
  if (!titles.length) return '整体状态不错，照现在的节奏走就行。';
  const map: Record<string, string> = {
    代谢: '压力和代谢', 睡眠: '睡眠', 生理: '生理节律', 情绪压力: '情绪压力', 恢复: '身体恢复',
  };
  return `${map[titles[0]] ?? '状态'}是今天最值得先照顾的一件事，把它安顿好，其他指标多半会跟着回来。`;
}

/**
 * 洞察页兜底（分析一段话 + 建议一段话，共 2 段）：① 分析段——把 代谢（皮质醇+血液指标）、
 * 睡眠、生理、情绪压力 各维度综合成**一段连贯的话**（异常重点说、正常带过、有细节）；
 * ② 建议段——针对最突出问题给一段可执行建议。与 OVERVIEW_SYS 的「2 段式」对齐；
 * 无核心数据（连皮质醇都没有）→ 回落等待文案。
 */
export function buildOverviewFallbackRows(): AiInsightRow[] {
  const cs = getTodayCortisolSummary();
  if (!cs) return EMPTY_ROWS; // 无核心数据（连皮质醇都没有）→ 等待数据

  const ph = physioState();
  const em = emotionState();
  const rec = recoveryState();
  const metab = metabState();

  // 异常维度（用于建议挑选 + 收尾总结）
  const titles: string[] = [];
  if (cs.level !== 'normal') titles.push('代谢');
  if (sleepBad()) titles.push('睡眠');
  if (ph) titles.push('生理');
  if (em) titles.push('情绪压力');
  if (rec) titles.push('恢复');

  // 分析段：各维度综合成一段话（异常重点、正常带过）——
  // ★ 2026-10-08（用户：按 ISHO 风格改写，先讲看到什么、再用人话解释，句句有细节）
  const cort = cs.level === 'normal'
    ? '皮质醇节律是稳的，白天顶得住、夜里也降得下来'
    : cs.level === 'high'
      ? '皮质醇比平时偏高，身体从早到晚都绷着，到夜里也降得慢'
      : '皮质醇节律乱了，白天一直绷着，到夜里也降不下来';
  const sleep = sleepBad()
    ? '深睡比该有的少，夜里的修复打了折扣'
    : '睡眠结构正常，深睡和夜间修复都跟上了';
  const abnormal: string[] = [cort];
  if (metab) abnormal.push(metab);
  abnormal.push(sleep);
  if (ph) abnormal.push(`${ph}、心率波动偏大`);
  if (em) abnormal.push(em);
  if (rec) abnormal.push(rec);

  const normalBits: string[] = [];
  if (!ph) normalBits.push('静息心率与 HRV 平稳');
  if (!em) normalBits.push('情绪与脑力负荷在线');
  if (!rec) normalBits.push('恢复力充足');

  const analysisBody =
    `今天${abnormal.join('，')}${normalBits.length ? `；${normalBits.join('、')}` : ''}。整体看，${overallVerdict(titles)}`;

  // 建议段
  const top = ['代谢', '睡眠', '生理', '情绪压力', '恢复'].find((t) => titles.includes(t)) ?? null;
  let advice: string;
  const advTone: AiTone = top ? 'warn' : 'good';
  if (!top) {
    advice = '今天状态平稳，保持现在的作息节奏就好。';
  } else {
    const main = ADVICE_MAP[top] ?? '保持现在的节奏，注意劳逸结合。';
    const extra = (top === '情绪压力' || top === '恢复')
      ? '今晚早点休息，给身体留点恢复时间。'
      : '睡前留十分钟做几组慢呼吸，让身体真正松下来。';
    advice = `${main}${extra}`;
  }
  const analysisTitle = titles.length ? FALLBACK_TITLES[titles[0]] ?? '今天的状态解读' : '整体平稳，保持这个节奏';
  return [
    { tone: titles.length ? 'warn' : 'good', title: analysisTitle, body: analysisBody },
    { tone: advTone, title: '今日建议', body: advice },
  ];
}

/**
 * 身体恢复页兜底（2 点）：①「皮质醇节律」为分析核心（异常时顺带一句深睡）；②「今日建议」。
 * 与 RECOVERY_SYS 的「2 行」要求对齐。
 */
export function buildRecoveryFallbackRows(dayDk?: string): AiInsightRow[] {
  const today = todayDk();
  const isToday = !dayDk || dayDk === today;
  const cs = isToday ? getTodayCortisolSummary() : cortisolSummaryForDay(dayDk!);
  const cortisol = rowCortisol(cs, isToday);
  if (!cortisol) return EMPTY_ROWS;
  const abnormal = !!cs && cs.level !== 'normal';
  const badSleep = isToday ? sleepBad() : sleepBadForDay(dayDk!);
  let body = cortisol.body.replace(/[。.]$/, '');
  if (abnormal && badSleep) body += '，深睡也偏少';
  const anomaly: AiInsightRow = { tone: cortisol.tone, title: '皮质醇节律', body: body + '。' };
  const act = abnormal ? '今晚 11 点前上床 · 下午 3 点后别碰咖啡 · 睡前做几组慢呼吸' : '状态平稳，保持现在的作息节奏就好。';
  const advice: AiInsightRow = { tone: abnormal ? 'warn' : 'good', title: isToday ? '今日建议' : '当日建议', body: act };
  return [anomaly, advice];
}

// ── AI 行质量门禁 + 与规则分点合流 ──────────────────────────────────────────
/**
 * 为什么必须有门禁：
 * 端侧 1.5B 经常**完全无视** `tone|标题|正文` 格式，把整份健康数据念成一大段自然语言。
 * 这种「一长段」经容错解析只会变成 1 行长行，于是 UI 里 `rows={ai ?? fallback}`
 * 永远命中 AI、用户看到的却是「没有分点、整段糊住」。这里给出显式合格标准，
 * 不合格一律回落规则分点（结构正确、数值同源）。
 */

const isCortisolRow = (r: AiInsightRow | undefined): boolean =>
  !!r && /皮质醇|节律/.test(`${r.title}${r.body}`);

/**
 * AI 的皮质醇结论是否与算法结论**矛盾**（防「大字说偏高、AI 说正常」）。
 *
 * 判定刻意做成「单向排斥」：只有 AI **只**说了相反结论时才算矛盾。
 * 因此「今天皮质醇偏高，但深睡正常」这类**正确**的混合陈述不会被误杀。
 */
function cortisolCopyContradicts(body: string, level: 'normal' | 'high' | 'dysregulated'): boolean {
  const t = body || '';
  const saysNormal = /正常|平稳|无异常|未见异常|没问题/.test(t);
  const saysAbnormal = /偏高|紊乱|异常|负荷偏重|压力偏重|回落不足|压力偏大/.test(t);
  if (level === 'normal') return saysAbnormal && !saysNormal;
  return saysNormal && !saysAbnormal;
}

/**
 * 单行正文上限（字符数）。身体恢复/周期走短句，洞察页「一段话」走更长段落。
 */
const MAX_BODY_SHORT = 34; // 身体恢复 / 周期：短句上限
const MAX_BODY_OVERVIEW = 160; // 洞察页「一段话」段落上限

/**
 * AI 输出是否达到「可展示」标准：
 *   ① 至少 2 行（洞察页 = 分析段 + 建议段；身体恢复 = 皮质醇节律 + 今日建议）；
 *   ② 任何一行不超过对应 kind 的字符上限（超长 = 又写成长段）；
 *   ③ 身体恢复必须**含皮质醇**那一行（用户明确要求：身体恢复的分析基于皮质醇节律）；
 *   ④ 洞察页至少要有 1 行分析段 + 1 行「今日建议」（不足的由合流用规则补到 2 段）。
 */
export function aiRowsAcceptable(
  kind: 'overview' | 'recovery',
  rows: AiInsightRow[] | null | undefined
): boolean {
  if (!rows || rows.length < 2) return false;
  if (rows.some((r) => !r.title || !r.body)) return false;
  if (kind === 'recovery') {
    // 身体恢复：固定 2 点（皮质醇节律 + 今日建议），必须含皮质醇行；短句上限
    if (rows.some((r) => (r.body || '').length > MAX_BODY_SHORT)) return false;
    if (!rows.some(isCortisolRow)) return false;
    return true;
  }
  // 洞察页：分析段（≥1 行）+ 今日建议（≥1 行），长度在 OVERVIEW 上限内
  if (rows.some((r) => (r.body || '').length > MAX_BODY_OVERVIEW)) return false;
  if (rows.filter((r) => !/建议/.test(r.title)).length < 1) return false;
  if (!rows.some((r) => /建议/.test(r.title))) return false;
  return true;
}

/**
 * AI 行与规则分点合流：
 *   - 身体恢复（recovery）：合流成 **2 点** ——「皮质醇节律 + 今日建议」。
 *   - 洞察页（overview）：合流成 **分析一段话 + 建议一段话** —— 多行分析合并成一段，保留今日建议一段。
 *   - AI 不合格 → 整段回落规则分点（结构稳定）。
 */
export function resolveInsightRows(
  kind: 'overview' | 'recovery',
  aiRows: AiInsightRow[] | null | undefined,
  dayDk?: string
): AiInsightRow[] {
  const isTodayCtx = !dayDk || dayDk === todayDk();
  const rule = kind === 'recovery' ? buildRecoveryFallbackRows(dayDk) : buildOverviewFallbackRows();
  if (!aiRowsAcceptable(kind, aiRows)) return rule;
  const rows = aiRows as AiInsightRow[];

  // 身体恢复：合格 AI → 合并成 2 点（皮质醇节律 + 今日建议）
  if (kind === 'recovery') {
    // 历史日语境：模型常忽略 prompt 里「禁止出现今天/今日」的要求（实测真机缓存里
    // `recovery@2026-09-14` 仍写「今日皮质醇节律紊乱」），这里确定性改写。
    const dayWord = (s: string): string =>
      isTodayCtx ? s : s.replace(/今日/g, '当日').replace(/今天/g, '当天');
    let suggestion = rows.find((r) => /建议/.test(r.title));
    if (!suggestion) suggestion = rows[rows.length - 1]; // 兜底取末行
    const others = rows.filter((r) => r !== suggestion);
    if (!others.length) return rule;
    const merged = others.map((o) => o.body.replace(/[。.]$/, '')).join('，');
    const trimmed = merged.length > 34 ? merged.slice(0, 34) + '…' : merged;
    const body = dayWord(trimmed);
    const adviceRow: AiInsightRow = {
      tone: suggestion.tone,
      title: isTodayCtx ? '今日建议' : '当日建议',
      body: dayWord(suggestion.body),
    };

    // ★ 一致性强校验（本次修复核心）：AI 的皮质醇结论必须与算法结论同向。
    //   矛盾 → 换回规则文案（规则与页面大字/图表同源，必然一致）；建议行仍保留 AI 的措辞。
    //   这样无论 AI 缓存过期、还是 1.5B 模型自己写反，页面都不会再自相矛盾。
    const level =
      (isTodayCtx ? getTodayCortisolSummary() : cortisolSummaryForDay(dayDk!))?.level ?? null;
    if (level && cortisolCopyContradicts(body, level)) {
      const ruleCort = rule.find((r) => isCortisolRow(r));
      if (ruleCort) return [ruleCort, adviceRow];
    }

    // tone 以算法结论为准（模型可能把「偏高」标成 good），保证行配色/图标与结论一致
    const tone: AiTone = level
      ? level === 'normal'
        ? 'good'
        : 'warn'
      : others.some((o) => o.tone === 'warn')
      ? 'warn'
      : others.some((o) => o.tone === 'neutral')
      ? 'neutral'
      : 'good';
    return [
      { tone, title: '皮质醇节律', body: body.endsWith('。') ? body : body + '。' },
      adviceRow,
    ];
  }

  // 洞察页：把非「建议」行合并成一段分析 + 保留 1 条建议 = 2 段。
  // （即使模型吐出 4–5 个维度短行，也会在此合并成「一段话」，与规则兜底同构）
  const analyses = rows.filter((r) => !/建议/.test(r.title));
  const suggestion =
    rows.find((r) => /建议/.test(r.title)) ?? rule.find((r) => /建议/.test(r.title));
  if (!analyses.length || !suggestion) return rule;
  const merged = analyses.map((o) => o.body.replace(/[。.]$/, '')).join('，');
  const body = merged.length > MAX_BODY_OVERVIEW ? merged.slice(0, MAX_BODY_OVERVIEW) + '…' : merged;
  // ★ 2026-11-03：标题不再硬编码「异常数据分析」——保留 AI 的结论式标题（截到 18 字），
  //   学 ISHO / Fitbit 那种「标题就是一句观点」的读感；AI 没给标题时回落通用名。
  const mergedTitle = (analyses[0]?.title || '今天的状态解读').slice(0, 18);
  const tone = analyses.some((o) => o.tone === 'warn')
    ? 'warn'
    : analyses.some((o) => o.tone === 'neutral')
      ? 'neutral'
      : 'good';
  return [
    { tone, title: mergedTitle, body: body.endsWith('。') ? body : body + '。' },
    { tone: suggestion.tone, title: '今日建议', body: suggestion.body },
  ];
}
