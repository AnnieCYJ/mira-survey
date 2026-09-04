/**
 * cycleLog —— 经期记录本地持久化
 *
 * 用项目已引入的 expo-file-system 写 JSON（不引新原生依赖，不影响 ⌘R）。
 * 仅存用户手动输入的「上次经期开始日 / 周期长度」，属隐私数据，仅存本机沙盒。
 *
 * 另累积 history（历史经期开始日，旧→新）用于 Periodical 式统计预测：
 * 当累积 ≥3 次记录时，computeCycle 用历史周期长度的 均值±标准差 预测下次经期。
 */
import * as FileSystem from 'expo-file-system';
import { parseDate, type CycleLog } from '../lib/cycleMath';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_cycle_log.json';

export async function loadCycleLog(): Promise<CycleLog | null> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const j = JSON.parse(raw) as any;
    if (!j || !j.lastPeriodStart) return null;
    return {
      lastPeriodStart: String(j.lastPeriodStart),
      cycleLength: Number(j.cycleLength) || 28,
      lutealLength: Number(j.lutealLength) || 14,
      periodLength: Number(j.periodLength) || 5,
      history: Array.isArray(j.history) ? j.history.map(String) : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveCycleLog(log: CycleLog): Promise<void> {
  try {
    // 累积历史经期开始日：读取现有 history → 追加本次（去重）→ 升序 → 截断 24 条
    let history: string[] = [];
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const j = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as any;
        if (Array.isArray(j.history)) history = j.history.map(String);
      }
    } catch {
      /* 读旧 history 失败不阻塞 */
    }
    if (!history.includes(log.lastPeriodStart)) {
      history = [...history, log.lastPeriodStart]
        .sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime())
        .slice(-24);
    }
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ ...log, history }));
  } catch {
    /* 写盘失败静默：绝不阻塞 App */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 每日经期状态记录（经量 / 疼痛程度 / 心情 / 备注）
//
// 与 cycleLog（经期「开始日 + 周期长度」主记录）分离存储，按日期索引，
// 用于周期日历上标记真实经期日、并在详情里展示用户自感状态。属隐私，仅本机沙盒。
// ─────────────────────────────────────────────────────────────────────────────

export type FlowLevel = '' | 'spotting' | 'light' | 'normal' | 'heavy';
export type PainLevel = '' | 'none' | 'mild' | 'moderate' | 'severe';

export const FLOW_LABEL: Record<FlowLevel, string> = {
  '': '未记录',
  spotting: '点滴',
  light: '量少',
  normal: '正常',
  heavy: '量多',
};
export const PAIN_LABEL: Record<PainLevel, string> = {
  '': '未记录',
  none: '无痛',
  mild: '轻微',
  moderate: '中度',
  severe: '严重',
};

export interface PeriodDayLog {
  /** 日期 'YYYY-M-D'（与 dayKey 对齐） */
  date: string;
  flow: FlowLevel;
  pain: PainLevel;
  mood?: string;
  note?: string;
  /** 记录时间戳（epoch ms），用于显示「最近编辑」 */
  updatedAt?: number;
}

const PD_PATH = (FileSystem.documentDirectory ?? '') + 'mira_period_log.json';

/** 读取全部每日经期状态，按 date 索引。 */
export async function loadPeriodDays(): Promise<Record<string, PeriodDayLog>> {
  try {
    const info = await FileSystem.getInfoAsync(PD_PATH);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(PD_PATH);
    const j = JSON.parse(raw) as any;
    if (!j || typeof j !== 'object') return {};
    const out: Record<string, PeriodDayLog> = {};
    for (const [k, v] of Object.entries(j)) {
      const e = v as any;
      if (!e || typeof e.date !== 'string') continue;
      out[k] = {
        date: e.date,
        flow: (e.flow as FlowLevel) ?? '',
        pain: (e.pain as PainLevel) ?? '',
        mood: typeof e.mood === 'string' ? e.mood : undefined,
        note: typeof e.note === 'string' ? e.note : undefined,
        updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入/更新某一天的经期状态（同日期覆盖）。 */
export async function savePeriodDay(entry: PeriodDayLog): Promise<void> {
  try {
    const all = await loadPeriodDays();
    all[entry.date] = { ...entry, updatedAt: Date.now() };
    await FileSystem.writeAsStringAsync(PD_PATH, JSON.stringify(all));
  } catch {
    /* 写盘失败静默 */
  }
}

/** 读取某一天的状态（无则 null）。 */
export async function loadPeriodDay(date: string): Promise<PeriodDayLog | null> {
  const all = await loadPeriodDays();
  return all[date] ?? null;
}

