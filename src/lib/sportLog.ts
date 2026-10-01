// 运动记录持久化（手动记录）
// ─────────────────────────────────────────────────────────────
// 存储：expo-sqlite `sport_logs` 表（与 food_logs 同一持久化栈）。
// 数据来源分两类：
//   ring  —— 戒指固件识别到的多运动段（RingBle.sportSessions）
//   manual —— 用户在运动工具页「记录运动」里手动选择的运动种类
// 只有 manual 落本地库；ring 侧来自 BLE，不落库（重连即刷新）。
// ─────────────────────────────────────────────────────────────

import * as SQLite from 'expo-sqlite';

export type SportSource = 'ring' | 'manual';

export interface SportLog {
  id: string;
  /** YYYY-MM-DD */
  dateKey: string;
  ts: number;
  source: SportSource;
  /** 固件运动枚举值（ring 侧有，manual 侧为自家 SPORT_KINDS 的 key） */
  type?: number;
  /** 展示名：跑步 / 瑜伽 / 力量训练 … */
  typeName: string;
  /** 时长（秒） */
  totalTime: number;
  /** 消耗（kcal） */
  totalCal: number;
}

/**
 * 运动种类表：type = 固件 VPDeviceRuningMode 枚举值（手动记录与戒指识别口径一致），
 * met = 每分钟强度系数（按 55kg 粗估 kcal）。覆盖女性日常高频场景，与固件枚举前段对齐。
 */
export const SPORT_KINDS = [
  { type: 1, typeName: '跑步', met: 11 },
  { type: 2, typeName: '快走', met: 4.3 },
  { type: 7, typeName: '骑行', met: 8.5 },
  { type: 12, typeName: '游泳', met: 7 },
  { type: 16, typeName: '瑜伽', met: 3 },
  { type: 84, typeName: '力量训练', met: 5 },
  { type: 91, typeName: '拉伸', met: 2.8 },
  { type: 15, typeName: '跳绳', met: 11 },
  { type: 38, typeName: '有氧操', met: 6.5 },
  { type: 23, typeName: '爬楼梯', met: 8 },
  { type: 31, typeName: '舞蹈', met: 5.5 },
  { type: 9, typeName: '椭圆机', met: 7 },
  { type: 89, typeName: '普拉提', met: 4 },
  { type: 32, typeName: 'HIIT', met: 9 },
  { type: 77, typeName: '动感单车', met: 8.5 },
  { type: 97, typeName: '尊巴', met: 6.5 },
  { type: 109, typeName: '太极', met: 3 },
  { type: 83, typeName: '搏击操', met: 8 },
  { type: 10, typeName: '划船机', met: 7 },
  { type: 33, typeName: '攀岩', met: 7.5 },
  { type: 13, typeName: '仰卧起坐', met: 4 },
  { type: 17, typeName: '乒乓球', met: 4 },
  { type: 21, typeName: '羽毛球', met: 5.5 },
  { type: 18, typeName: '篮球', met: 6.5 },
  { type: 63, typeName: '跑步机', met: 10 },
  { type: 86, typeName: '核心训练', met: 4.5 },
] as const;

export const SPORT_KIND_MAP: Record<number, { typeName: string; met: number }> = SPORT_KINDS.reduce(
  (acc, k) => {
    acc[k.type] = { typeName: k.typeName, met: k.met };
    return acc;
  },
  {} as Record<number, { typeName: string; met: number }>,
);

/** 时长（分钟）→ 估算消耗 kcal（met × 分钟 × 55kg ÷ 60） */
export function estimateKcal(kindKey: number, minutes: number, weightKg = 55): number {
  const met = SPORT_KIND_MAP[kindKey]?.met ?? 5;
  return Math.round((met * Math.max(0, minutes) * weightKg) / 60);
}

let _db: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('mira.db');
    _db.execSync(`
      CREATE TABLE IF NOT EXISTS sport_logs (
        id TEXT PRIMARY KEY NOT NULL,
        date_key TEXT NOT NULL,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        type INTEGER,
        type_name TEXT NOT NULL,
        total_time INTEGER NOT NULL,
        total_cal INTEGER NOT NULL
      )
    `);
  }
  return _db;
}

export function loadSportLogs(): SportLog[] {
  try {
    const rows = db().getAllSync(
      'SELECT id, date_key, ts, source, type, type_name, total_time, total_cal FROM sport_logs ORDER BY ts DESC LIMIT 200',
      [],
    ) as Array<{
      id: string; date_key: string; ts: number; source: string;
      type: number | null; type_name: string; total_time: number; total_cal: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      dateKey: r.date_key,
      ts: r.ts,
      source: (r.source === 'ring' ? 'ring' : 'manual') as SportSource,
      type: r.type ?? undefined,
      typeName: r.type_name,
      totalTime: r.total_time,
      totalCal: r.total_cal,
    }));
  } catch {
    return [];
  }
}

/** 写入一条手动运动记录，返回最新全量列表（与 foodAi 同款返回约定） */
export function saveSportLog(log: {
  id?: string; ts?: number; dateKey: string;
  type: number; typeName: string; totalTime: number; totalCal: number;
}): SportLog[] {
  try {
    const full = {
      id: log.id ?? `sport-${Date.now()}`,
      ts: log.ts ?? Date.now(),
      source: 'manual' as const,
      type: log.type,
      typeName: log.typeName,
      totalTime: Math.round(log.totalTime),
      totalCal: Math.round(log.totalCal),
    };
    db().runSync(
      'INSERT OR REPLACE INTO sport_logs (id, date_key, ts, source, type, type_name, total_time, total_cal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [full.id, log.dateKey, full.ts, full.source, full.type, full.typeName, full.totalTime, full.totalCal],
    );
    return loadSportLogs();
  } catch {
    return loadSportLogs();
  }
}

export function deleteSportLog(id: string): SportLog[] {
  try {
    db().runSync('DELETE FROM sport_logs WHERE id = ?', [id]);
  } catch { /* 忽略 */ }
  return loadSportLogs();
}

/** 今日（dateKey）手动记录 */
export function todaySportLogs(dateKey: string): SportLog[] {
  return loadSportLogs().filter((l) => l.dateKey === dateKey);
}
