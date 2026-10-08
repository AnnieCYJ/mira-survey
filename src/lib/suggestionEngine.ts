/**
 * suggestionEngine —— 首页悬浮「好习惯确认」卡的候选生成（2026-10-07）
 *
 * 诚实口径（硬约束）：
 *   · 动作 = 用户**真实做过**的行为（interventionLog 的 8 类情绪干预），不编造「4-7-8 呼吸」这类没记录的动作；
 *   · 指标 = **真实信号确实在改善**（HRV / 深睡 / 睡眠恢复分），全部由本机 healthStore 实算；
 *   · 两者缺一 → 返回 null（不打扰用户）。
 *
 * 频控：
 *   · 一天最多一张 —— 命中后当天落盘标记，重复调用返回 null；
 *   · 同类 30 天冷却 —— 被否（没啥感觉 / ✕）的建议走 habitSuggestions 的 dismissed；
 *   · 已留存的不再打扰 —— store 里已有该习惯则跳过。
 */
import * as FileSystem from 'expo-file-system';
import { healthStore, dayKey } from '../data/healthStore';
import { isCoolingDown, peekHabits, loadHabits } from '../data/habitSuggestions';
import {
  ensureInterventionLogLoaded,
  allInterventionEntries,
  type InterventionKind,
} from '../data/interventionLog';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_suggestion_float.json';
const DAY_MS = 86400000;

let shownDk: string | null = null;
let loaded = false;

async function loadShown(): Promise<void> {
  if (loaded) return;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const j = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as any;
      shownDk = typeof j?.dk === 'string' ? j.dk : null;
    }
  } catch {
    /* 读失败当作没展示过 */
  }
  loaded = true;
}

async function markShown(): Promise<void> {
  shownDk = dayKey(Date.now());
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ dk: shownDk }));
  } catch {
    /* 写失败不影响本次展示 */
  }
}

export interface SuggestionCandidate {
  /** 动作稳定 key（去重 / 冷却判定） */
  id: string;
  /** 动作名，如 '睡前 4-7-8 呼吸' */
  action: string;
  /** 证据指标短语（真实信号改善） */
  metric: string;
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
};

/** 「习惯」门槛：做过 ≥2 次才算真实习惯，避免一次性的误报 */
const MIN_BEHAVIOR_COUNT = 2;

/** 用户真实做过、且达到习惯门槛的行为（取次数最多的一类）。 */
function dominantBehavior(): { kind: InterventionKind; action: string } | null {
  const counts = new Map<string, number>();
  for (const e of allInterventionEntries()) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  let bestKind: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestKind = k;
      bestN = n;
    }
  }
  if (!bestKind || bestN < MIN_BEHAVIOR_COUNT) return null;
  const kind = bestKind as InterventionKind;
  return { kind, action: ACTION_NAMES[kind] ?? kind };
}

function computeCandidates(): SuggestionCandidate[] {
  const now = Date.now();

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
    const series = nums(
      healthStore.getSeries('hrv', dayKey(now - 13 * DAY_MS), dayKey(now))
    );
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
  if (!bits.length) return [];

  // ④ 动作必须来自用户真实做过的行为（不做没记录的动作）；做够门槛才算「习惯」
  const beh = dominantBehavior();
  if (!beh) return [];

  return [{ id: `iv-${beh.kind}`, action: beh.action, metric: bits.join('，') }];
}

/**
 * 取「今天这一张」候选：无真实改善 / 当天已出过 / 冷却中 / 已留存 → 返回 null。
 * 返回非 null 时同时落盘标记「今天已出」。
 */
export async function pickDailySuggestion(): Promise<SuggestionCandidate | null> {
  await loadShown();
  await loadHabits();
  await ensureInterventionLogLoaded(); // 真实行为记录
  if (shownDk === dayKey(Date.now())) return null; // 一天最多一张

  for (const c of computeCandidates()) {
    if (isCoolingDown(c.id)) continue; // 30 天冷却
    if (peekHabits().habits.some((h) => h.id === c.id)) continue; // 已留存不再打扰
    await markShown();
    return c;
  }
  return null;
}
