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
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { dayKey } from './healthStore';

/** 12 档情绪 → theme token 色（唯一映射，UI 层统一引用）：
 *  亮色系=积极（moodEnergy/moodGood/rose/honey/sky），沉色系=低落（state/danger/purple/灰紫） */
export const MOOD_COLOR: Record<MoodKey, string> = {
  excited: theme.colors.moodEnergy,
  happy: theme.colors.moodGood,
  love: mm.colors.roseCore,
  grateful: mm.colors.honeyDeep,
  pleasant: mm.colors.skyCore,
  calm: theme.colors.stateTired,
  tired: mm.colors.limeDeep,
  stressed: theme.colors.stateEnergy,
  anxious: theme.colors.danger,
  sad: mm.colors.purpleDeep,
  angry: theme.colors.stateTense,
  lonely: theme.colors.textNavIdle,
};

export type MoodKey =
  | 'excited' | 'happy' | 'love' | 'grateful' | 'pleasant' | 'calm'
  | 'tired' | 'stressed' | 'anxious' | 'sad' | 'angry' | 'lonely';

export interface EmotionEntry {
  id: string;
  /** 本地日 YYYY-MM-DD */
  dk: string;
  /** 记录时刻 epoch ms */
  t: number;
  mood: MoodKey;
  note?: string;
  /** 触发/伴随的生活事件（可选，多选用） */
  events?: EventKey[];
  /** 用户自建事件（「添加」自由输入，可选，多选用） */
  customEvents?: string[];
}

/** 生活事件 key（记录时「发生了什么」，多选用，纯内容、与 UI 图标解耦） */
export type EventKey =
  | 'work' | 'sport' | 'eat' | 'sleep' | 'social'
  | 'study' | 'relax' | 'health' | 'family' | 'travel';

/** 事件顺序（卡片展示顺序） */
export const EVENT_KEYS: EventKey[] = [
  'work', 'sport', 'eat', 'sleep', 'social',
  'study', 'relax', 'health', 'family', 'travel',
];

/** 事件中文标签 */
export const EVENT_LABEL: Record<EventKey, string> = {
  work: '工作',
  sport: '运动',
  eat: '饮食',
  sleep: '睡眠',
  social: '社交',
  study: '学习',
  relax: '放松',
  health: '健康',
  family: '家人',
  travel: '出行',
};

/** 记录页珠雨中的出现顺序：5 档愉悦度（兴奋→开心→平静→压力→难过，参照视频的 valence 设计）。
 *  v19.00 起从 12 档收敛到 5 档，更轻、更直觉；旧档位 key 仍保留在类型里，历史记录可读。 */
export const MOOD_ORDER: MoodKey[] = [
  'excited', 'happy', 'calm', 'stressed', 'sad',
];

export const MOOD_LABEL: Record<MoodKey, string> = {
  excited: '兴奋',
  happy: '开心',
  love: '心动',
  grateful: '感激',
  pleasant: '愉悦',
  calm: '平静',
  tired: '疲惫',
  stressed: '压力',
  anxious: '焦虑',
  sad: '难过',
  angry: '生气',
  lonely: '孤独',
};

export const MOOD_EMOJI: Record<MoodKey, string> = {
  excited: '🤩',
  happy: '😄',
  love: '🥰',
  grateful: '🤗',
  pleasant: '😊',
  calm: '😌',
  tired: '😴',
  stressed: '😕',
  anxious: '😰',
  sad: '😢',
  angry: '😠',
  lonely: '😔',
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

/**
 * 新增一条记录。
 *
 * ★ atMs：记录时刻（epoch ms）。**不传 = 此刻**。
 *   为什么开放这个参数：情绪往往「回想补记」——下午开会时情绪上来，
 *   晚上才有空点开记录。写死 Date.now() 会把这类记录落到错误的时刻，
 *   点阵图与事件时间线也就跟着指错位置。
 *   ⚠ `dk` 始终由 atMs 推导 ⇒ 补记到昨天会正确写进昨天的日键，
 *     「当天最新心情」等按日聚合的读取方无需改动。
 */
export function addEmotionEntry(
  mood: MoodKey,
  note?: string,
  events?: EventKey[],
  customEvents?: string[],
  atMs?: number,
): EmotionEntry {
  const t = atMs != null && Number.isFinite(atMs) ? atMs : Date.now();
  const entry: EmotionEntry = {
    id: `${t}-${Math.random().toString(36).slice(2, 7)}`,
    dk: dayKey(t),
    t,
    mood,
    note: note && note.trim() ? note.trim() : undefined,
    events: events && events.length > 0 ? events : undefined,
    customEvents: customEvents && customEvents.length > 0 ? customEvents : undefined,
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
