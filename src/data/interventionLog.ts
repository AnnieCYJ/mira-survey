/**
 * interventionLog —— 情绪干预完成记录（本地 JSON，只存设备）
 *
 * 持久化：documentDirectory/interventionLog.json（expo-file-system），写入即落盘。
 * 口径：只记「做过什么 + 什么时候」，不评分、不做连续天数、不做勋章（Mira 铁律）。
 */
import * as FileSystem from 'expo-file-system';

export type InterventionKind =
  | 'grounding' | 'reframe' | 'gratitude' | 'activate'
  | 'compliment' | 'savoring' | 'future' | 'outdoor'
  // ★ 二十改：呼吸冥想的完成记录也进来 —— 圆环下叙事的 AI 层需要「最近做过的动作」做事实输入
  | 'breath' | 'meditate';

export interface InterventionEntry {
  kind: InterventionKind;
  /** 完成时间戳(ms) */
  ts: number;
  /** 一句话摘要（如：缓一缓·5 步走完 / 换个说法·「…」→「…」） */
  detail: string;
  // ★ 2026-10-13（呼吸/冥想完成卡 + 周期日历「今日练习」）：记录前后状态，
  //   供完成卡与日历卡展示「状态变化」。诚实口径：只存戒指真实状态，不编、不做评分。
  stateBefore?: string | null;
  stateAfter?: string | null;
  valueBefore?: number | null;
  valueAfter?: number | null;
  /** 练习时长（分钟，box/sleep 等定时模式有值；音频单曲无） */
  minutes?: number | null;
}

interface Store {
  v: 1;
  savedAt: number;
  entries: InterventionEntry[];
}

const FILE_URI = `${FileSystem.documentDirectory ?? ''}interventionLog.json`;

let cache: InterventionEntry[] | null = null;
let loaded = false;

async function persist(): Promise<void> {
  try {
    const payload: Store = { v: 1, savedAt: Date.now(), entries: cache ?? [] };
    await FileSystem.writeAsStringAsync(FILE_URI, JSON.stringify(payload));
  } catch {
    // 写失败静默：干预记录不是关键数据，不阻塞 UI
  }
}

export async function ensureInterventionLogLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await FileSystem.readAsStringAsync(FILE_URI);
    const parsed = JSON.parse(raw) as Store;
    if (parsed && Array.isArray(parsed.entries)) cache = parsed.entries;
  } catch {
    cache = [];
  }
}

/** 追加一条完成记录（内存 + 落盘） */
export function addInterventionEntry(kind: InterventionKind, detail: string): void {
  if (!cache) cache = [];
  cache.push({ kind, ts: Date.now(), detail });
  void persist();
}

/**
 * ★ 2026-10-13：呼吸/冥想完成 —— 除摘要外额外记录前后状态（真实戒指数据），
 * 供完成卡「状态变化」与周期日历「今日练习」卡展示。分钟为定时模式时长。
 */
export function addBreathCompletion(
  kind: 'breath' | 'meditate',
  detail: string,
  meta?: {
    stateBefore?: string | null;
    stateAfter?: string | null;
    valueBefore?: number | null;
    valueAfter?: number | null;
    minutes?: number | null;
  },
): void {
  if (!cache) cache = [];
  cache.push({
    kind,
    ts: Date.now(),
    detail,
    stateBefore: meta?.stateBefore ?? null,
    stateAfter: meta?.stateAfter ?? null,
    valueBefore: meta?.valueBefore ?? null,
    valueAfter: meta?.valueAfter ?? null,
    minutes: meta?.minutes ?? null,
  });
  void persist();
}

/** 全部完成记录（同步快照；未 load 过则返回空）。供建议引擎统计「用户真实做过的行为」。 */
export function allInterventionEntries(): InterventionEntry[] {
  return cache ?? [];
}

/** 某类干预最近一条（无则 null）——用于「上次做到哪」类提示，不参与任何评分 */
export function lastInterventionOf(kind: InterventionKind): InterventionEntry | null {
  if (!cache) return null;
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].kind === kind) return cache[i];
  }
  return null;
}
