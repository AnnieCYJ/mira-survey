/**
 * suggestionEngine —— 首页悬浮「好习惯确认」卡的候选生成（2026-10-07）
 *
 * 诚实口径（硬约束）：
 *   · 动作 = 用户**真实做过**的行为（interventionLog 的 8 类情绪干预），不编造「4-7-8 呼吸」这类没记录的动作；
 *   · 指标 = **真实信号确实在改善**（HRV / 深睡 / 睡眠恢复分），全部由本机 healthStore 实算；
 *   · 两者缺一 → 返回 null（不打扰用户）。
 *
 * 频控（★ 2026-10-08 十三改，用户反馈「20:00 前后一分钟内换了两张卡，不合理」）：
 *   · 旧逻辑按「半小时槽」换卡 —— 20:00 一到槽位翻转，哪怕状态档没变也硬换，观感就是「突然跳卡」。
 *   · 新逻辑按「**状态签名**」换卡：sig = `${level}|${phaseLabel}`。签名没变 → 一律保留当前卡片
 *     （30s 轮询 / 圆环状态点刷新都只会空转），卡片只在三种时机更换：
 *       ① 状态真变了（状态档 / 周期相位跨档）→ 自动换新；
 *       ② 用户点「不感兴趣」→ 调用方带 force 重取一条（被否的进 30 天冷却不会立刻回来）；
 *       ③ 用户点了 CTA 去做 → 返回后由气泡自己接手「有没有帮助」回访卡。
 *   · 被否（不感兴趣）的建议走 habitSuggestions 的 dismissed，30 天冷却，**三类候选统一过滤**；
 *   · 已留存的不再打扰 —— store 里已有该习惯则跳过。
 */
import * as FileSystem from 'expo-file-system';
import { healthStore, dayKey } from '../data/healthStore';
import { isCoolingDown, peekHabits, loadHabits, HABIT_QUESTION } from '../data/habitSuggestions';
import {
  ensureInterventionLogLoaded,
  allInterventionEntries,
  type InterventionKind,
} from '../data/interventionLog';
import { dayPhase } from './timePhase';
import { peekAnalysisFeedback } from '../data/analysisFeedback';
import { showCycleContent, containsCycleCopy, GENERAL_ARTICLE_ID } from '../data/cycleScope';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_suggestion_float.json';
const DAY_MS = 86400000; // 睡眠/HRV 等「近 N 天」窗口计算用
// ★ 2026-10-08：频控从「一天一条」→「跟随圆环状态点的半小时节拍」。
//   圆环状态点落在墙钟 :00 / :30（RingBleManager.alignBoundaryTs），建议用同一套半小时槽位，
//   于是「状态一更新（更新于 16:30）→ 建议同步换一条」，不再出现「状态更新了但没有建议」。
const HALF_MS = 30 * 60 * 1000;

// ★ 十三改：轮换判据从「半小时槽位」换成「状态签名」。
//   lastSig = 发当前这张卡时的 `${level}|${phaseLabel}`；lastId = 当时那张卡的 id（force 换新时避开它）。
let lastSig: string | null = null;
let lastId: string | null = null;
let loaded = false;

/** 半小时槽位号：仅作候选池轮换的「页码」，不再决定换卡时机 */
function halfSlot(ts: number): number {
  return Math.floor(ts / HALF_MS);
}

/**
 * 建议节拍锚点：优先跟随首页圆环的状态点时刻（curveStatus.lastPointAt）；
 * 拿不到时退回墙钟 —— 只影响轮换页码，不影响换卡时机（换卡只看状态签名）。
 */
function anchorTs(cs?: any): number {
  const t = cs?.lastPointAt;
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t;
  return Date.now();
}

/**
 * ★ 2026-10-13：时段锚点统一改用 `dayPhase`（lib/timePhase）。
 *   旧 `sceneBucket` 只分 饭前/睡前/白天 三档，颗粒度太粗——白天一整天都归「daytime」，
 *   导致建议几乎不随真实作息轮转。现在直接复用与「圆环叙事」同一套 6 时段，
 *   保证**叙事与气泡建议在同一时段讲同一件事**。
 *   原函数保留为向后兼容的薄封装（仍返回 coarse 三档，供外部仅关心饭前/睡前的调用）。
 */
export function sceneBucket(now = new Date()): 'preMeal' | 'bedtime' | 'daytime' {
  const p = dayPhase(now);
  if (p === 'preNoon') return 'preMeal';
  if (p === 'bedtime') return 'bedtime';
  return 'daytime';
}

/** 状态签名：状态档 + 周期相位 + 当前时段（6 档）。时段边界变化时才重新评估建议。 */
function stateSig(cs?: any): string {
  const level = typeof cs?.level === 'string' ? cs.level : '';
  const phase = typeof cs?.phaseLabel === 'string' ? cs.phaseLabel : '';
  return `${level}|${phase}|${dayPhase()}`;
}

async function loadShown(): Promise<void> {
  if (loaded) return;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const j = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as any;
      if (typeof j?.lastSig === 'string') {
        lastSig = j.lastSig;
        lastId = typeof j?.lastId === 'string' ? j.lastId : null;
      }
      // 旧版本落盘的 lastSlot / lastShownMs：签名体系无法换算，直接作废（重启后多发一张新卡，无害）
    }
  } catch {
    /* 读失败当作没展示过 */
  }
  loaded = true;
}

async function markShown(sig: string, id: string): Promise<void> {
  lastSig = sig;
  lastId = id;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ lastSig, lastId }));
  } catch {
    /* 写失败不影响本次展示 */
  }
}

export interface SuggestionCandidate {
  /** 稳定 key（去重 / 冷却判定 / 30 分钟窗口判定） */
  id: string;
  /**
   * 动作名（习惯确认型必填，如 '缓一缓'）；状态建议型可为空。
   * 存在时主句走 habitHeadline(action) 模板；否则用下方 headline 自定义文案。
   */
  action?: string;
  /** 证据指标短语（习惯确认型：真实信号改善；状态建议型可为空） */
  metric?: string;
  /** 自定义主句（状态建议型 / 行动引导型直接给文案，跳过 habitHeadline 模板） */
  headline?: string;
  /** 自定义反馈问句（默认 HABIT_QUESTION） */
  question?: string;
  /**
   * true = 状态建议型：反馈按钮仅做本地反馈、**不写入「我的习惯」**（避免污染习惯清单）。
   * 习惯确认型为 false（默认），反馈会落入 habitSuggestions 持久化。
   */
  noPersist?: boolean;
  /**
   * 建议种类：
   *  · 'action'    行动引导型 —— 主按钮直接跳转到对应工具页（cta），如呼吸冥想 / 读科普 / 记饮食；
   *  · 'reflection' 观察反馈型 —— 主按钮「留下建议」、次按钮「没啥感觉」（默认，可省略）。
   * 省略时按 'reflection' 处理。
   */
  kind?: 'action' | 'reflection';
  /** 行动引导型的落地页：{ label, screen, params }（如 { label:'去呼吸 ›', screen:'Breathing' }） */
  cta?: { label: string; screen: string; params?: Record<string, any> };
  /**
   * 落库用的稳定 key（与 id 区分）：id 可能带槽位号用于轮换展示，
   * saveId 用于「我的建议」去重与已留存判定（同一建议跨槽只存一张卡片）。
   */
  saveId?: string;
  /**
   * ★ Phase 2：这条建议来自哪条**个人规律**（patternStore 的 id）。
   *   首页点「有用」→ 给这条规律确认次数 +1；点「没啥感觉」→ -1。
   *   为空 = 普通建议，不参与规律加权。
   */
  patternId?: string;
}

const nums = (xs: (number | null)[]): number[] =>
  xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

function avg(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 取末尾 n 个非空值（近 n 天） */
function lastN(xs: (number | null)[], n: number): number[] {
  return nums(xs).slice(-n);
}

/** 取除末尾 n 天以外的非空值（基线） */
function beforeN(xs: (number | null)[], n: number): number[] {
  const v = nums(xs);
  return v.slice(0, Math.max(0, v.length - n));
}

/** 近 days 天的睡眠评分（旧→新，缺数据 null） */
function sleepScores(days: number): (number | null)[] {
  const out: (number | null)[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    try {
      const s = healthStore.getSleep(dayKey(now - i * DAY_MS));
      out.push(s && s.total > 0 ? Math.round(s.score) : null);
    } catch {
      out.push(null);
    }
  }
  return out;
}

/** 近 days 天的深睡占比 %（旧→新，缺数据 null） */
function deepRatios(days: number): (number | null)[] {
  const out: (number | null)[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    try {
      const s = healthStore.getSleep(dayKey(now - i * DAY_MS));
      out.push(s && s.total > 0 ? (s.deep / s.total) * 100 : null);
    } catch {
      out.push(null);
    }
  }
  return out;
}

/** 干预类型 → 动作名（与工具页「情绪调节」入口的命名保持一致） */
const ACTION_NAMES: Record<InterventionKind, string> = {
  grounding: '缓一缓',
  reframe: '换个说法',
  activate: '动一动',
  gratitude: '睡前记两笔',
  compliment: '夸一个人',
  savoring: '品味小事',
  future: '给未来写信',
  outdoor: '到户外去',
  // ★ 二十改：呼吸冥想的完成也记录（播放器倒计时走完 / 音频播完时打点）
  breath: '呼吸冥想',
  meditate: '冥想',
};

/** 最近 3 小时内完成的动作（最近一条）；无则 null。
 * ★ 2026-10-09（用户口径）：「HRV 回升 / 深睡变好」这类改善证据，只有刚做过某事、状态确有变化才配说；
 *   不做无中生有的归因。故用「最近做过」，而非「一生累计 ≥2 次」（dominantBehavior 已废弃）。 */
function recentBehavior(): { kind: InterventionKind; action: string } | null {
  const nowMs = Date.now();
  const recent = allInterventionEntries().filter((e) => nowMs - e.ts <= 3 * 3600e3);
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  return { kind: last.kind, action: ACTION_NAMES[last.kind] ?? last.kind };
}

/**
 * 真实证据短语（★ 十五改抽出导出：AI 建议层 aiSuggestion 与引擎共用同一套事实源。
 * AI 的 metric 字段只允许**原样引用**这里返回的短语 —— 从机制上杜绝小模型编造数字）。
 * 返回最多 2 条，如 ['HRV 回升 8%', '深睡连着 3 天变好']；无真实改善 → []。
 */
export function evidenceBits(): string[] {
  const now = Date.now();

  // ★ 2026-10-09（用户口径）：没有近 3 小时做过的动作 → 不给任何「回升 / 变好」改善短语。
  //   避免把自然波动或长期趋势误说成「你做了什么之后的效果」。只有刚做完某事、且确有改善才配说。
  if (!recentBehavior()) return [];

  // ① 睡眠评分 / 深睡：近 3 天 vs 之前基线（14 天窗口）
  const scores = sleepScores(14);
  const deeps = deepRatios(14);
  const sRecent = lastN(scores, 3);
  const sBase = beforeN(scores, 3);
  const dRecent = lastN(deeps, 3);
  const dBase = beforeN(deeps, 3);
  const sleepUp =
    sRecent.length >= 2 && sBase.length >= 2 && (avg(sRecent) as number) - (median(sBase) as number) >= 3;
  const deepUp =
    dRecent.length >= 2 && dBase.length >= 2 && (avg(dRecent) as number) - (median(dBase) as number) >= 3;

  // ② HRV：近 14 天日均（旧→新）
  let hrvUp = false;
  let hrvPct = 0;
  try {
    const series = nums(healthStore.getSeries('hrv', dayKey(now - 13 * DAY_MS), dayKey(now)));
    if (series.length >= 5) {
      const recent = series.slice(-3);
      const base = series.slice(0, -3);
      const b = median(base);
      const r = avg(recent);
      if (b && r && r >= b * 1.05) {
        hrvUp = true;
        hrvPct = Math.max(1, Math.round((r / b - 1) * 100));
      }
    }
  } catch {
    /* 无 HRV 数据则跳过 */
  }

  // ③ 组装证据短语（最多 2 条；优先 HRV + 深睡，其次睡眠恢复分）
  const bits: string[] = [];
  if (hrvUp) bits.push(`HRV 回升 ${hrvPct}%`);
  if (deepUp) bits.push('深睡连着 3 天变好');
  if (!bits.length && sleepUp) bits.push('睡眠恢复分连着 3 天变好');
  return bits;
}

function computeCandidates(): SuggestionCandidate[] {
  const bits = evidenceBits();
  if (!bits.length) return [];

  // ★ 2026-10-09：动作名取「最近 3 小时刚做过的」（与 evidenceBits 同源同一道闸门）；
  //   没做过就不出这张「发现型」卡，避免把没做过的动作和「回升」绑在一起说。
  const beh = recentBehavior();
  if (!beh) return [];

  return [{ id: `iv-${beh.kind}`, action: beh.action, metric: bits.join('，') }];
}

/**
 * 按「今日状态」生成一条建议（状态建议型，noPersist）。
 * 口径：基于 curveStatus.level（★ 实际取值是中文四档：充沛 / 平稳 / 偏低 / 不足，
 * 见 dailyStatus.curveLevel —— 与圆环中央文案「元气满满 / 状态良好 / 平平静静 / 休息一下」同源）+ 相位，
 * 每半小时槽位轮换文案（slot 决定取哪一条），保证测试期频繁、且每槽不同。
 * 无数据（level 为 null）时返回 null —— 不编造状态。
 */
function buildStatusCandidate(cs: any, slot: number): SuggestionCandidate | null {
  const level: string | null | undefined = cs?.level;
  if (!level) return null; // 没采到状态就不出（诚实口径）

  // ★ 2026-10-08 十七改（口径澄清）：4–8 字的限制是给**圆环中央状态词**的
  //   （MOODS：元气满满/状态良好/平平静静/休息一下，本就全是 4 字，无需改）；
  //   **建议卡 headline 仍按 App 内 AI 声线出完整句**（character.ts · ENFP 闺蜜：
  //   短句 + 语气词，每条 ≤ 20 字，气泡固定高、标题最多 2 行）。
  const TIPS: Record<string, string[]> = {
    充沛: [
      '今天状态在线呀～想冲点什么就去冲',
      '能量挺足哦，趁这会儿做件有挑战的事',
    ],
    平稳: [
      '今天节奏挺稳的，保持住就好啦',
      '状态不错呀，记得按时吃饭、多喝水哦',
    ],
    偏低: [
      '今天钝钝的，适合整理和复盘～',
      '状态中规中矩呀，给自己留段放空的时间',
    ],
    不足: [
      '今天有点累呀，别硬撑，出门散会儿步吧',
      '身体在提醒你慢一点哦，今晚早点休息～',
    ],
  };
  const pool = TIPS[level];
  if (!pool || pool.length === 0) return null;
  const pick = Math.abs(slot) % pool.length; // 每半小时槽翻一页
  const headline = pool[pick];

  // 相位轻点缀：偶尔在反馈问句里带一句，不另起一行，避免超框
  let question = HABIT_QUESTION;
  const phase: string | undefined = cs?.phaseLabel;
  if (phase && phase !== '未记录' && pick === 0) {
    question = `${phase}里，可以和我聊聊你的感受吗？`;
  }

  return {
    id: `st-${level}-${slot}`, // id 带槽位：跨槽即换新，同槽不重复
    saveId: `st-${level}`, // 落库稳定 key：同一状态档跨槽只存一张卡片
    headline,
    question,
    kind: 'reflection',
    noPersist: true, // 状态建议：仅反馈，不写入「我的习惯」
  };
}

/**
 * ★ 十八改（用户：「看文章就看具体哪篇文章，呼吸冥想用哪一种，直接跳到那个，不要给聚合页」）：
 * 深链目标选择器 —— 引擎与 AI 层共用同一套事实源，保证「文案说的 = 跳到的」。
 */

/** 按状态档 + 时段挑具体的呼吸练习（不足/睡前 → 4-7-8 睡前呼吸；其余 → 4-2-6 放松呼吸） */
export function pickBreathTarget(level?: string | null): {
  patternKey: 'box' | 'calm' | 'energize' | 'sleep' | 'stress';
  name: string;
  rhythm: string;
} {
  if (level === '不足' || dayPhase() === 'bedtime') return { patternKey: 'sleep', name: '睡前呼吸', rhythm: '4-7-8' };
  return { patternKey: 'calm', name: '放松呼吸', rhythm: '4-2-6' };
}

/** 按周期相位挑一篇具体科普文章（lib/learnArticles.ts 的真实 id；未记录 → 总览篇） */
export function pickReadTarget(phase?: string): { articleId: string; short: string } {
  // ★ 2026-11-14（用户）：男性不推任何周期/激素科普，胶囊只指向通用节律文章。
  if (!showCycleContent()) {
    return { articleId: GENERAL_ARTICLE_ID.learn, short: '皮质醇的晨峰意义' };
  }
  const h = phase ?? '';
  if (h === '经期') return { articleId: 'progesterone', short: '孕激素的镇静与代价' };
  if (h === '卵泡期') return { articleId: 'estrogen', short: '雌激素与大脑敏感性' };
  if (h === '排卵期') return { articleId: 'hormCognition', short: '雌激素上行的那两周，脑子确实更好使' };
  if (h === '黄体期') return { articleId: 'hormSleep', short: '为什么经前一周睡得特别差' };
  return { articleId: 'levers', short: '平衡激素的四根杠杆' };
}

/**
 * 行动引导型建议：基于今日状态给一个温和、可执行的动作，主按钮直接跳转到对应工具页。
 * 口径：不编造数据、不夸功效；只做轻引导。状态偏低/不足优先推呼吸冥想，其余给读科普 / 记饮食。
 * 每条带稳定 saveId（跨槽去重），id 带槽位（用于轮换展示）。
 * ★ 十八改：CTA 全部深链到**具体内容**（指定节奏的呼吸练习 / 指定文章），不落聚合页。
 */
function buildActionCandidates(cs: any, slot: number): SuggestionCandidate[] {
  const level: string | null | undefined = cs?.level;
  const out: SuggestionCandidate[] = [];
  const now = new Date();
  const scene = dayPhase(now);
  const preMeal = scene === 'preNoon';
  const bedtime = scene === 'bedtime';

  // 状态偏低 / 不足 → 指定一种呼吸练习（温和放松，不要求「必须做」）
  if (level === '偏低' || level === '不足') {
    const b = pickBreathTarget(level);
    out.push({
      id: `act-breathing-${slot}`,
      saveId: `act-breathing-${b.patternKey}`,
      kind: 'action',
      // ★ 十八改：文案点名具体练习与节奏，「说的 = 跳到的」
      headline:
        b.patternKey === 'sleep'
          ? `今晚早点休息，做个 ${b.rhythm} 睡前呼吸吧`
          : `有点累呀？做个 ${b.rhythm} 放松呼吸缓一缓`,
      question: '做完跟我说说感觉？',
      cta: { label: '去呼吸 ›', screen: 'Breathing', params: { breath: b.patternKey } },
      noPersist: true,
    });
  }

  // 读一篇科普：按周期相位直达具体文章（LearnRead 详情页，不再经过 ToolTopic 聚合页）
  const r = pickReadTarget(cs?.phaseLabel);
  if (bedtime) out.push({
    id: `act-read-${slot}`,
    saveId: `act-read-${r.articleId}`,
    kind: 'action',
    headline: `睡前读读《${r.short}》呀，几分钟就好`,
    question: '有疑问随时问我',
    cta: { label: '去读 ›', screen: 'LearnRead', params: { articleId: r.articleId, collection: 'learn' } },
    noPersist: true,
  });

  // 记录饮食（any 状态；FoodScan 本身就是直达拍摄页，无需深链）
  if (preMeal) out.push({
    id: `act-diet-${slot}`,
    saveId: 'act-diet',
    kind: 'action',
    headline: '快到饭点了，顺手拍张照记一下这一餐',
    question: '之后我帮你看看饮食和状态的关系',
    cta: { label: '去记录 ›', screen: 'FoodScan' },
    noPersist: true,
  });

  return out;
}

/**
 * 取当前应展示的建议（★ 十三改：按「状态签名」换卡，不再按半小时槽硬换）。
 *  · 签名没变（状态档 + 相位都没跨）→ 返回 null，调用方保留当前卡片 —— 30s 轮询 / 圆环状态点
 *    刷新都会走到这里空转，**修掉「20:00 槽位一翻就突然换卡」的问题**。
 *  · `force`（用户点了「不感兴趣」）→ 无视签名立刻重取一条；被否的那条已进 30 天冷却，
 *    三类候选统一过滤，不会马上回来；若池子空了返回 null（气泡回落到 idle 占位）。
 *
 * 候选池（种类交替，保证不总是同一种）：
 *   ① 习惯确认型（真实改善 + 真实行为）② 状态建议型（按 level/相位）
 *   ③ 行动引导型（呼吸冥想 / 读科普 / 记饮食，带 cta 跳转工具页）。
 */
export async function pickSuggestion(
  cs?: any,
  opts?: { force?: boolean; /** true = 只要带 cta 的行动引导型（首页建议胶囊用：点了要能跳进对应工具） */ requireCta?: boolean },
): Promise<SuggestionCandidate | null> {
  await loadShown();
  await loadHabits();
  await ensureInterventionLogLoaded(); // 真实行为记录（习惯确认型需要）

  const sig = stateSig(cs);
  if (!opts?.force && lastSig !== null && lastSig === sig) return null; // 状态没变 → 保留当前卡片

  const slot = halfSlot(anchorTs(cs));
  const pool: SuggestionCandidate[] = [];
  const alreadyKept = (id: string) => peekHabits().habits.some((h) => h.id === id);
  // ★ 十三改：三类候选统一吃「30 天负反馈冷却」（旧版只过滤了习惯确认型，行动型被否还会回来）
  const cooling = (c: SuggestionCandidate) => isCoolingDown(c.saveId ?? c.id);

  // ① 习惯确认型（真实改善 + 真实行为才出；未冷却 / 未留存）
  for (const c of computeCandidates()) {
    if (cooling(c)) continue;
    if (alreadyKept(c.id)) continue; // 已留存不再打扰
    pool.push({ ...c, kind: 'reflection' });
    break; // 取第一条即可（同档目前只有一种行为）
  }

  // ② 状态建议型（基于今日状态；noPersist，仅反馈）
  const st = buildStatusCandidate(cs, slot);
  if (st && !cooling(st) && !alreadyKept(st.saveId ?? st.id)) pool.push(st);

  // ③ 行动引导型（温和、不编造数据；已留下 / 冷却中的不重复建议）
  for (const a of buildActionCandidates(cs, slot)) {
    if (cooling(a)) continue;
    if (alreadyKept(a.saveId ?? a.id)) continue;
    pool.push(a);
  }

  if (pool.length === 0) {
    await markShown(sig, ''); // 池子空了：记下签名，气泡回落 idle，等状态变化再试
    return null;
  }
  // ★ 2026-11-04（用户「建议要能跳进工具」）：requireCta = 只保留行动引导型；
  //   观察反馈型（要点按钮评价的）不适合胶囊形态，过滤后为空则回落默认。
  const finalPool = opts?.requireCta ? pool.filter((c) => !!c.cta) : pool;
  // ★ 2026-11-14（用户）：男性用户的建议胶囊不能出现周期/激素话术，
  //   也不能深链到周期文章（已缓存的旧建议同样在这里被改写）。
  const safePool = showCycleContent()
    ? finalPool
    : finalPool
        .filter((c) => !containsCycleCopy(
          [c.headline, (c as any).action, c.question, c.cta?.label].filter(Boolean).join(' '),
        ))
        .map((c) => c.cta?.screen === 'LearnRead'
          ? {
              ...c,
              cta: {
                ...c.cta,
                params: { ...(c.cta.params ?? {}), articleId: GENERAL_ARTICLE_ID.learn },
              },
            }
          : c);
  // 过滤后若为空，补一条中性的呼吸建议，避免胶囊直接消失
  const pickPool = safePool.length > 0 ? safePool : [{
    id: `act-breathing-${slot}`,
    saveId: 'act-breathing-general',
    kind: 'action' as const,
    headline: '缓一缓，做个 4-2-6 放松呼吸吧',
    question: '做完跟我说说感觉？',
    cta: { label: '去呼吸 ›', screen: 'Breathing', params: { breath: 'calm' } },
    noPersist: true,
  }];
  if (pickPool.length === 0) {
    await markShown(sig, '');
    return null;
  }
  // 第一阶段个性化：只用用户对同类分析的认可度调整顺序，不改变任何阈值。
  const feedback = peekAnalysisFeedback();
  const feedbackScore = (c: SuggestionCandidate) => {
    const key = c.saveId ?? c.id;
    return feedback
      .filter((f) => f.id === key || f.id === c.id)
      .reduce((sum, f) => sum + (f.value === 'accurate' ? 1 : -1), 0);
  };
  pickPool.sort((a, b) => feedbackScore(b) - feedbackScore(a));
  // 按槽位页码稳定取一条；force 换新时避开刚被否/刚展示过的那条
  let pick = Math.abs(slot) % pickPool.length;
  if (pickPool.length > 1 && pickPool[pick].id === lastId) pick = (pick + 1) % pickPool.length;
  const chosen = pickPool[pick];
  await markShown(sig, chosen.id);
  return chosen;
}
