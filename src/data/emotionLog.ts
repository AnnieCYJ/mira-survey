/**
 * emotionLog.ts —— 用户自报情绪记录（Mooda 式「选心情球」）存储层
 *
 * 设计口径：
 *  - Mira 铁律：情绪以「用户自报」为主数据源，不做情绪推断/评分。本存储与 EDA 推断的
 *    情绪负荷（lib/stressAlgorithm）完全独立，仅在 UI 上并排展示（情绪负荷图 + 情绪记录卡）。
 *  - 5 档情绪与情绪负荷点阵（EmotionInsightView.StressEventStems）同 key 语义：
 *    兴奋/愉悦/平静/压力/焦虑；emoji 属于内容，颜色由 UI 层按 theme token 映射。
 *  - 持久化：documentDirectory/emotionLog.json（expo-file-system），写入 debounce 600ms。
 *  - 事件总线：写入后 emitEmotionLog()，卡片/记录页订阅即时刷新（与 aiRecordBus 同款模式）。
 *  - 同一天允许多条记录；日历取当天最新一条着色。
 */
import * as FileSystem from 'expo-file-system';
import { dayKey } from './healthStore';

export type MoodKey = 'excited' | 'pleasant' | 'calm' | 'stressed' | 'anxious';

export interface EmotionEntry {
  id: string;
  /** 本地日 YYYY-MM-DD */
  dk: string;
  /** 记录时刻 epoch ms */
  t: number;
  mood: MoodKey;
  note?: string;
}

/** 记录页选择顺序：愉悦 → 平静 → 低落（Mooda 式从亮到沉） */
export const MOOD_ORDER: MoodKey[] = ['excited', 'pleasant', 'calm', 'stressed', 'anxious'];

export const MOOD_LABEL: Record<MoodKey, string> = {
  excited: '兴奋',
  pleasant: '愉悦',
  calm: '平静',
  stressed: '压力',
  anxious: '焦虑',
};

export const MOOD_EMOJI: Record<MoodKey, string> = {
  excited: '🤩',
  pleasant: '😊',
  calm: '😌',
  stressed: '😕',
  anxious: '😰',
};

// ── 事件总线 ──────────────────────────────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

/** 订阅情绪记录变更，返回取消订阅函数 */
export function onEmotionLog(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function emit(): void {
  listeners.forEach((l) => {
    try { l(); } catch (e) { console.warn('[emotionLog] listener failed:', e); }
  });
}

// ── 存储本体 ──────────────────────────────────────────────────────────────
const FILE_URI = `${FileSystem.documentDirectory ?? ''}emotionLog.json`;
let entries: EmotionEntry[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadOnce(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(FILE_URI);
      const json = JSON.parse(raw);
      if (Array.isArray(json?.entries)) {
        entries = json.entries.filter(
          (e: any) => e && typeof e.dk === 'string' && typeof e.t === 'number' && typeof e.mood === 'string',
        );
      }
    } catch {
      // 首次无文件 → 空表
      entries = [];
    }
    loaded = true;
  })();
  return loadPromise;
}

function persist(): void {
  if (saveTimer != null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    FileSystem.writeAsStringAsync(FILE_URI, JSON.stringify({ v: 1, savedAt: Date.now(), entries }))
      .catch((e) => console.warn('[emotionLog] persist failed:', e));
  }, 600);
}

/** 确保历史记录已从磁盘载入（页面 useEffect 里 await） */
export async function ensureEmotionLogLoaded(): Promise<void> {
  await loadOnce();
}

/** 某天的全部记录（按时间倒序：最新在前） */
export function getEntriesForDay(dk: string): EmotionEntry[] {
  return entries.filter((e) => e.dk === dk).sort((a, b) => b.t - a.t);
}

/** 某天最新一条（无则 null） */
export function getLatestForDay(dk: string): EmotionEntry | null {
  const list = getEntriesForDay(dk);
  return list.length > 0 ? list[0] : null;
}

/** 日历着色用：某月（0-11）每天最新 mood 映射 dk→MoodKey */
export function monthMoodMap(year: number, month: number): Record<string, MoodKey> {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const out: Record<string, MoodKey> = {};
  for (const e of entries) {
    if (!e.dk.startsWith(prefix)) continue;
    const cur = out[e.dk];
    if (cur == null) out[e.dk] = e.mood;
    else {
      // 同日多条取最新：entries 追加序近似时间序，比较 t
      const prev = getLatestForDay(e.dk);
      if (prev) out[e.dk] = prev.mood;
    }
  }
  return out;
}

/** 当月有记录的天数（卡片统计用） */
export function monthRecordCount(year: number, month: number): number {
  return Object.keys(monthMoodMap(year, month)).length;
}

/** 新增一条记录（dk=今天本地日） */
export function addEmotionEntry(mood: MoodKey, note?: string): EmotionEntry {
  const entry: EmotionEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dk: dayKey(Date.now()),
    t: Date.now(),
    mood,
    note: note && note.trim() ? note.trim() : undefined,
  };
  entries.push(entry);
  persist();
  emit();
  return entry;
}

/** 删除一条记录（记录页长按/滑动删入口，暂留 API） */
export function deleteEmotionEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  persist();
  emit();
}
