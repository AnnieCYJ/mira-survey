// 回顾页「当日行为流程」（JourneyDayView）的补充数据源：
// 用户在首页胶囊建议里完成的饮食 / 心情记录，集中落一份轻量 recap 日志，
// 供回顾·今日时间轴按时间合并进既有生理时间线，让用户「刚做完的事」立刻在回顾里出现。
//
// 与 foodLog / emotionLog 的关系：那些是各自的细分业务库；本模块只存「回顾要展示的
// 一条摘要卡片所需的最小字段」（标题 / 内容 / 图 / 鼓励句 / 时间 / 配色），互不耦合。
//
// 持久化：走 utils/prefs（expo-file-system 版 KV，因 Expo Go 无 AsyncStorage 原生模块）。
import * as AsyncStorage from '../utils/prefs';

export type SelfReportType = 'food' | 'mood' | 'event';

export interface SelfReportEntry {
  id: string;
  type: SelfReportType;
  createdAt: number; // epoch ms
  dk: string; // 本地日 YYYY-MM-DD
  time: string; // HH:MM
  title: string; // 「记录饮食」/「记录心情」
  sub?: string; // 具体内容（菜名 / 心情备注）
  analysis?: string; // 鼓励 / 分析句（非诊断、非评分）
  imageUri?: string; // 饮食图片（已解析为可读 uri）
  emoji: string;
  color: string; // 时间轴节点 / 图标底色
}

const KEY = 'mira_self_report_log_v1';

let cache: SelfReportEntry[] | null = null;
const listeners = new Set<() => void>();

export function parseTime(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 按 HH:MM 升序排序（稳定；createdAt 缺省按 0，保证 TimelineItem 等非带时间戳项不出现 NaN） */
export function sortByTime<T extends { time: string }>(arr: T[]): T[] {
  const ts = (x: T) => (x as { createdAt?: number }).createdAt ?? 0;
  return [...arr].sort((a, b) => parseTime(a.time) - parseTime(b.time) || ts(a) - ts(b));
}

async function load(): Promise<SelfReportEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as SelfReportEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache ?? [];
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache ?? []));
  } catch {
    /* 忽略写入失败 */
  }
}

export async function ensureSelfReportsLoaded(): Promise<void> {
  await load();
}

export function getSelfReportsForDaySync(dk: string): SelfReportEntry[] {
  if (!cache) return [];
  return sortByTime(cache.filter((e) => e.dk === dk));
}

/** 记录一条回顾摘要（完成饮食 / 心情时调用） */
export async function logSelfReport(
  entry: Omit<SelfReportEntry, 'id' | 'createdAt'> & { createdAt?: number },
): Promise<void> {
  const full: SelfReportEntry = {
    ...entry,
    id: `${entry.dk}-${entry.time}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: entry.createdAt ?? Date.now(),
  };
  const all = await load();
  all.push(full);
  cache = all;
  await persist();
  listeners.forEach((l) => l());
}

/** 订阅变更（回顾页需在新记录产生后即时刷新） */
export function onSelfReport(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
