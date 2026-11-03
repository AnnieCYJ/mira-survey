/**
 * quickCheckStore —— 「一键体检」（HealthGlance 健康一览聚合快检）数据层
 * ---------------------------------------------------------------------------
 * 职责：把戒指「一次点测、整套快照」的 HealthGlance 结果，作为一条「体检记录」持久化。
 *   - 上报结构 = 分组指标（核心体征 / 血液健康 / 心理健康 / 压力与疲劳），每组含若干指标，
 *     每条指标带 数值 / 单位 / 状态（正常·偏高·偏低·风险）/ 参考区间 / 描述性说明 / 可选分段刻度。
 *   - 洞察页只展示最新一次的简短概览；「体检记录」页按时间升序列出全部；点单条进「微体检报告」详情。
 *
 * ⚠ 品牌铁律：所有说明文案一律「只描述不诊断、不评分、参考区间仅供参考」，与 Mira 全局口径一致。
 *
 * 持久化：复用 expo-sqlite（与 examStore 同源，原生模块已链接）。
 * 首次启动若库为空，写入 3 条演示记录，便于在模拟器/无戒指环境下审阅完整 UI；
 * 一旦用户产生真实记录（表非空），演示数据不再写入。
 * ---------------------------------------------------------------------------
 */
import * as SQLite from 'expo-sqlite';
import { healthStore, type MetricKey } from './healthStore';

export type QCStatus = 'ok' | 'high' | 'low' | 'risk';

export interface QCMetric {
  key: string;
  name: string;
  /** 展示值（字符串，可承载 "113/82" 这类复合值） */
  value: string;
  unit: string;
  status: QCStatus;
  /** 自定义状态文案（覆盖默认的 正常/偏高/偏低/风险，如 稳定/放松/低风险/轻度疲劳） */
  label?: string;
  /** 参考区间文案（卡片副标题） */
  ref?: string;
  /** 描述性说明（Mira 口径：只描述不诊断） */
  note?: string;
  /** 分段刻度条（血压 / 尿酸 / 压力 / 疲劳等带量纲的指标可用） */
  scale?: { min: number; max: number; v: number };
  /** 等级说明（压力 / 疲劳等分级指标） */
  levels?: string;
}

export interface QCRiskBlock {
  name: string;
  status: QCStatus;
  label: string;
  note?: string;
  sub?: QCMetric[];
}

export interface QCGroup {
  key: string;
  title: string;
  icon?: string;
  metrics?: QCMetric[];
  risk?: QCRiskBlock;
  standalone?: QCMetric[];
}

export interface QuickCheckRecord {
  id: string;
  /** 测量时间戳（ms） */
  createdAt: number;
  groups: QCGroup[];
}

const DB_NAME = 'mira_quickcheck.db';
const TABLE = 'quickcheck_records';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
        `id TEXT PRIMARY KEY, ` +
        `created_at INTEGER NOT NULL, ` +
        `groups TEXT NOT NULL);`
    );
    return db;
  })();
  return dbPromise;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRecord(row: { id: string; created_at: number; groups: string }): QuickCheckRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    groups: JSON.parse(row.groups) as QCGroup[],
  };
}

/** 统计一条记录的总指标数与异常数（含 risk.sub 与 standalone）。 */
export function tallyRecord(rec: QuickCheckRecord): { done: number; abnormal: number } {
  let done = 0;
  let abnormal = 0;
  const walk = (m?: QCMetric[]) => {
    for (const it of m ?? []) {
      done++;
      if (it.status !== 'ok') abnormal++;
    }
  };
  for (const g of rec.groups) {
    walk(g.metrics);
    walk(g.risk?.sub);
    walk(g.standalone);
  }
  return { done, abnormal };
}

export function abnormalMetrics(rec: QuickCheckRecord): QCMetric[] {
  const out: QCMetric[] = [];
  const walk = (m?: QCMetric[]) => {
    for (const it of m ?? []) if (it.status !== 'ok') out.push(it);
  };
  for (const g of rec.groups) {
    walk(g.metrics);
    walk(g.risk?.sub);
    walk(g.standalone);
  }
  return out;
}

/** 保存一次体检记录。record.groups 直接序列化入库。 */
export async function saveQuickCheck(rec: QuickCheckRecord): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO ${TABLE} (id, created_at, groups) VALUES (?, ?, ?)`,
    [rec.id, rec.createdAt, JSON.stringify(rec.groups)]
  );
}

/** 真实测量后落库：从外部传入已组装好的 groups。 */
export async function addQuickCheck(groups: QCGroup[]): Promise<QuickCheckRecord> {
  const rec: QuickCheckRecord = { id: genId(), createdAt: Date.now(), groups };
  await saveQuickCheck(rec);
  return rec;
}

/** 最新一条（洞察页概览卡用）。无记录返回 null。 */
export async function getLatestQuickCheck(): Promise<QuickCheckRecord | null> {
  try {
    const db = await openDb();
    const row = await db.getFirstAsync<{ id: string; created_at: number; groups: string }>(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`
    );
    return row ? parseRecord(row) : null;
  } catch (e) {
    console.warn('[quickCheckStore] getLatestQuickCheck failed:', e);
    return null;
  }
}

/** 全部记录，按时间升序（记录列表页）。 */
export async function getAllQuickChecks(): Promise<QuickCheckRecord[]> {
  try {
    const db = await openDb();
    const rows = await db.getAllAsync<{ id: string; created_at: number; groups: string }>(
      `SELECT * FROM ${TABLE} ORDER BY created_at ASC`
    );
    return rows.map(parseRecord);
  } catch (e) {
    console.warn('[quickCheckStore] getAllQuickChecks failed:', e);
    return [];
  }
}

/** 按 id 取单条记录（报告详情页）。 */
export async function getQuickCheckById(id: string): Promise<QuickCheckRecord | null> {
  try {
    const db = await openDb();
    const row = await db.getFirstAsync<{ id: string; created_at: number; groups: string }>(
      `SELECT * FROM ${TABLE} WHERE id = ?`,
      [id]
    );
    return row ? parseRecord(row) : null;
  } catch (e) {
    console.warn('[quickCheckStore] getQuickCheckById failed:', e);
    return null;
  }
}

/** 删除一条记录。 */
export async function deleteQuickCheck(id: string): Promise<void> {
  try {
    const db = await openDb();
    await db.runAsync(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  } catch (e) {
    console.warn('[quickCheckStore] deleteQuickCheck failed:', e);
  }
}

export async function countQuickChecks(): Promise<number> {
  try {
    const db = await openDb();
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE}`);
    return row?.n ?? 0;
  } catch (e) {
    console.warn('[quickCheckStore] countQuickChecks failed:', e);
    return 0;
  }
}

/**
 * 真实体检组装：从 healthStore 现有真实测量值（实时体征 + 健康一览血液指标 + 压力/疲劳成分）
 * 聚合一条体检记录并落库。无任何真实数据（从未连过戒指）时返回 { ok:false, reason:'no-data' }。
 * 品牌铁律：只描述不诊断、不评分；参考区间仅供参考。
 */
export async function assembleQuickCheckFromRealtime(): Promise<{ ok: boolean; record?: QuickCheckRecord; reason?: string }> {
  const gl = (k: MetricKey, n = 7) => healthStore.getLatest(k, n);
  const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

  const hr = gl('hr'), hrv = gl('hrv'), spo2 = gl('spo2');
  const bpSys = gl('bpSys'), bpDia = gl('bpDia');
  const glucose = gl('glucose'), ua = gl('ua');
  const tc = gl('cholesterol'), tg = gl('triglyceride'), hdl = gl('hdl'), ldl = gl('ldl');
  const skin = gl('skin'), emotion = gl('emotion'), cortisol = gl('cortisol'), sns = gl('sns');
  const stress = gl('stress'), fatigue = gl('fatigue');

  const present = [hr, hrv, spo2, bpSys, bpDia, glucose, ua, tc, tg, hdl, ldl, skin, emotion, cortisol, sns, stress, fatigue].some((v) => v != null);
  if (!present) return { ok: false, reason: 'no-data' };

  const sb = (key: string, v: number): QCStatus => {
    switch (key) {
      case 'hr': return v > 100 ? 'high' : v < 50 ? 'low' : 'ok';
      case 'spo2': return v < 95 ? 'low' : 'ok';
      case 'bpSys': return v >= 140 ? 'high' : v < 90 ? 'low' : 'ok';
      case 'bpDia': return v >= 90 ? 'high' : v < 60 ? 'low' : 'ok';
      case 'glucose': return v > 6.1 ? 'high' : v < 3.9 ? 'low' : 'ok';
      case 'ua': return v > 428 ? 'high' : v < 155 ? 'low' : 'ok';
      case 'cholesterol': return v > 5.2 ? 'high' : 'ok';
      case 'triglyceride': return v > 1.7 ? 'high' : 'ok';
      case 'hdl': return v < 1.0 ? 'low' : 'ok';
      case 'ldl': return v > 3.4 ? 'high' : 'ok';
      case 'stress': return v >= 60 ? 'high' : 'ok';
      case 'fatigue': return v >= 7 ? 'high' : v >= 4 ? 'low' : 'ok';
      default: return 'ok';
    }
  };

  const bpValue = bpSys != null && bpDia != null ? `${Math.round(bpSys)}/${Math.round(bpDia)}` : null;

  const core: QCMetric[] = [];
  if (hr != null) core.push({ key: 'hr', name: '平均心率', value: String(Math.round(hr)), unit: '次/分', status: sb('hr', hr), ref: '参考 60~100', note: '本次静息平均心率，会随状态波动，建议结合多日观察。' });
  if (hrv != null) core.push({ key: 'hrv', name: 'HRV', value: String(Math.round(hrv)), unit: '毫秒', status: 'ok', note: 'HRV 反映心率变异性，受睡眠与压力影响较大，宜作趋势观察。' });
  if (bpValue) {
    const st = sb('bpSys', bpSys!) !== 'ok' || sb('bpDia', bpDia!) !== 'ok'
      ? (sb('bpSys', bpSys!) === 'high' || sb('bpDia', bpDia!) === 'high' ? 'high' : 'low') : 'ok';
    core.push({ key: 'bp', name: '血压', value: bpValue, unit: 'mmHg', status: st, ref: '参考 <120/80', scale: { min: 80, max: 160, v: Math.round(bpSys!) }, note: '血压会随情绪与活动波动，本结果仅为本次测量快照。' });
  }
  if (spo2 != null) core.push({ key: 'spo2', name: '血氧', value: String(Math.round(spo2)), unit: '%', status: sb('spo2', spo2), ref: '参考 95~100%', note: '血氧饱和度。' });

  const blood: QCMetric[] = [];
  if (glucose != null) blood.push({ key: 'glucose', name: '血糖', value: String(r2(glucose)), unit: 'mmol/L', status: sb('glucose', glucose), ref: '空腹参考 3.9~6.1', note: '空腹血糖，餐后通常更高，本结果反映近期空腹状态。' });
  if (ua != null) blood.push({ key: 'uricAcid', name: '尿酸', value: String(Math.round(ua)), unit: 'μmol/L', status: sb('ua', ua), ref: '常见参考 155~428', scale: { min: 100, max: 500, v: Math.round(ua) }, note: '尿酸。单次偏高可能受饮食饮水影响，建议多次测量并结合专业检查；仅供参考，不构成诊断。' });
  if (tc != null) blood.push({ key: 'tc', name: '总胆固醇', value: String(r2(tc)), unit: 'mmol/L', status: sb('cholesterol', tc), ref: '参考 <5.2', note: '总胆固醇。' });
  if (tg != null) blood.push({ key: 'tg', name: '甘油三酯', value: String(r2(tg)), unit: 'mmol/L', status: sb('triglyceride', tg), ref: '参考 <1.7', note: '甘油三酯。' });
  if (hdl != null) blood.push({ key: 'hdl', name: '高密度脂蛋白', value: String(r2(hdl)), unit: 'mmol/L', status: sb('hdl', hdl), ref: '参考 >1.0', note: '高密度脂蛋白（好胆固醇），偏高通常更友好。' });
  if (ldl != null) blood.push({ key: 'ldl', name: '低密度脂蛋白', value: String(r2(ldl)), unit: 'mmol/L', status: sb('ldl', ldl), ref: '参考 <3.4', note: '低密度脂蛋白（坏胆固醇）。' });

  const mentalSub: QCMetric[] = [];
  if (skin != null) mentalSub.push({ key: 'skin', name: '皮肤含水量', value: String(Math.round(skin)), unit: '%', status: 'ok' });
  if (emotion != null) mentalSub.push({ key: 'mood', name: '情绪', value: String(Math.round(emotion)), unit: '', status: 'ok', label: '已记录' });
  if (cortisol != null) mentalSub.push({ key: 'cortisol', name: '皮质醇', value: String(r2(cortisol)), unit: 'ug/dL', status: 'ok' });
  if (sns != null) mentalSub.push({ key: 'sns', name: '交感神经活跃度', value: String(Math.round(sns)), unit: '', status: 'ok', label: sns >= 60 ? '偏活跃' : sns <= 30 ? '放松' : '适中' });
  // ★ 2026-11-03（用户）：不许有写死的「抑郁症风险 · 低风险」评估结论——
  //   该结论此前不随数据判定、只要有一项信号就固定显示「低风险」，属假分析。
  //   现改为中性的「已记录信号」汇总：只展示真实读数，不做风险结论。
  const mentalRisk: QCRiskBlock = { name: '心理健康 · 本次记录信号', status: 'ok', label: '已记录', note: '以下为本次真实记录到的信号值。Mira 只做描述与参考，不做抑郁等风险评估或诊断性结论。', sub: mentalSub };

  const stressStandalone: QCMetric[] = [];
  if (stress != null) stressStandalone.push({ key: 'stress', name: '压力', value: String(Math.round(stress)), unit: '', status: sb('stress', stress), label: stress >= 60 ? '偏高' : stress >= 30 ? '正常' : '放松', scale: { min: 0, max: 99, v: Math.round(stress) }, levels: '压力等级参考：1-29 放松 / 30-59 正常 / 60-79 中等 / 80-99 压力较大', note: '本次压力值，会随日程波动，可作当日状态观察点。' });
  if (fatigue != null) stressStandalone.push({ key: 'fatigue', name: '疲劳度', value: String(Math.round(fatigue)), unit: '', status: sb('fatigue', fatigue), label: fatigue >= 7 ? '中度疲劳' : fatigue >= 4 ? '轻度疲劳' : '轻松', scale: { min: 0, max: 10, v: Math.round(fatigue) }, levels: '疲劳值 0-10 级，等级越高越疲惫', note: '本次疲劳值。' });

  const groups: QCGroup[] = [];
  if (core.length) groups.push({ key: 'core', title: '核心体征', icon: '❤️', metrics: core });
  if (blood.length) groups.push({ key: 'blood', title: '血液健康检测', icon: '🩸', metrics: blood });
  if (mentalSub.length) groups.push({ key: 'mental', title: '心理健康检测', icon: '🧠', risk: mentalRisk });
  if (stressStandalone.length) groups.push({ key: 'stress', title: '压力与疲劳', icon: '🌿', standalone: stressStandalone });

  const rec = await addQuickCheck(groups);
  return { ok: true, record: rec };
}
