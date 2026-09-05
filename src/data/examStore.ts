/**
 * examStore —— 「一键体检」身体成分数据层
 * ---------------------------------------------------------------------------
 * 职责：
 *  1. computeBodyComposition：基于身高 / 体重 / 年龄 / 性别，用通用公式估算
 *     8 项身体成分（BMI、体脂率、脂肪量、瘦体重、肌肉量、身体水分、骨量、基础代谢率），
 *     并给出每项相对于健康区间的状态（偏低 / 正常 / 偏高）。
 *  2. 持久化：复用项目既有的 expo-sqlite（AI 模块已在用，原生模块已链接），
 *     把每次「体检」作为一条记录存库；洞察页只取最新一条，历史页按时间升序列出全部。
 *
 * 公式说明（均为公开估算公式，结果标注为「参考估算值」，非医学诊断）：
 *  - BMI = 体重(kg) / 身高(m)²
 *  - 体脂率：Deurenberg 公式 bodyFat% = 1.20·BMI + 0.23·age − 10.8·(男?1:0) − 5.4
 *  - 基础代谢率 BMR：Mifflin-St Jeor
 *      男 = 10·kg + 6.25·cm − 5·age + 5
 *      女 = 10·kg + 6.25·cm − 5·age − 161
 *  - 脂肪量 = 体重 · 体脂率%；瘦体重 = 体重 − 脂肪量
 *  - 身体水分%：按瘦体重约 73% 为水估算（waterKg = 0.73·lean，再 / 体重）
 *  - 肌肉量 / 骨量：按体重比例的常用估算值（肌肉≈体重·0.42/0.34，骨≈体重·4.5%）
 * ---------------------------------------------------------------------------
 */
import * as SQLite from 'expo-sqlite';

export type Sex = 'female' | 'male';

export interface ExamInputs {
  weight: number; // kg
  height: number; // cm
  age: number;
  sex: Sex;
}

export type MetricStatus = 'low' | 'normal' | 'high' | 'info';

export interface BodyMetric {
  key: string;
  name: string;
  value: number;
  /** 展示小数位 */
  decimals: number;
  unit: string;
  /** 健康区间文案（用于卡片副标题） */
  range: string;
  status: MetricStatus;
}

export interface ExamRecord {
  id: string;
  /** 测量时间戳（ms） */
  createdAt: number;
  inputs: ExamInputs;
  metrics: BodyMetric[];
}

const DB_NAME = 'mira_exam.db';
const TABLE = 'exam_records';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
        `id TEXT PRIMARY KEY, ` +
        `created_at INTEGER NOT NULL, ` +
        `inputs TEXT NOT NULL, ` +
        `metrics TEXT NOT NULL);`
    );
    return db;
  })();
  return dbPromise;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 单项指标健康状态判定（仅对有明确健康区间的项给 low/normal/high，其余为 info）。 */
function statusFor(
  key: string,
  value: number,
  male: boolean
): MetricStatus {
  switch (key) {
    case 'bmi':
      if (value < 18.5) return 'low';
      if (value <= 23.9) return 'normal';
      return 'high';
    case 'bodyFatPercentage': {
      const lo = male ? 10 : 20;
      const hi = male ? 20 : 30;
      if (value < lo) return 'low';
      if (value > hi) return 'high';
      return 'normal';
    }
    case 'waterContent':
      if (value < 50) return 'low';
      if (value > 65) return 'high';
      return 'normal';
    default:
      return 'info';
  }
}

/** 基于个人信息估算 8 项身体成分。 */
export function computeBodyComposition(inputs: ExamInputs): BodyMetric[] {
  const { weight, height, age, sex } = inputs;
  const male = sex === 'male';
  const hM = height / 100;
  const bmi = weight / (hM * hM);

  // 基础代谢率（Mifflin-St Jeor）
  const bmr = 10 * weight + 6.25 * height - 5 * age + (male ? 5 : -161);

  // 体脂率（Deurenberg），夹到合理区间
  let bf = 1.2 * bmi + 0.23 * age - (male ? 10.8 : 0) - 5.4;
  bf = clamp(bf, 2, 60);

  const fatMass = (weight * bf) / 100;
  const lean = weight - fatMass;
  const waterPct = clamp((0.73 * lean) / weight * 100, 40, 70);
  const muscle = weight * (male ? 0.42 : 0.34);
  const bone = weight * 0.045;

  const defs: Omit<BodyMetric, 'status'>[] = [
    { key: 'bmi', name: 'BMI', value: bmi, decimals: 1, unit: '', range: '18.5–24 正常' },
    { key: 'bodyFatPercentage', name: '体脂率', value: bf, decimals: 1, unit: '%', range: male ? '10–20% 健康' : '20–30% 健康' },
    { key: 'fatMass', name: '脂肪量', value: fatMass, decimals: 1, unit: 'kg', range: '—' },
    { key: 'leanBodyMass', name: '瘦体重', value: lean, decimals: 1, unit: 'kg', range: '—' },
    { key: 'muscleMass', name: '肌肉量', value: muscle, decimals: 1, unit: 'kg', range: '—' },
    { key: 'waterContent', name: '身体水分', value: waterPct, decimals: 1, unit: '%', range: '50–65% 健康' },
    { key: 'boneMass', name: '骨量', value: bone, decimals: 2, unit: 'kg', range: '—' },
    { key: 'basalMetabolicRate', name: '基础代谢率', value: bmr, decimals: 0, unit: 'kcal', range: '静息最低能耗' },
  ];

  return defs.map((d) => ({
    ...d,
    status: statusFor(d.key, d.value, male),
  }));
}

function parseRecord(row: {
  id: string;
  created_at: number;
  inputs: string;
  metrics: string;
}): ExamRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    inputs: JSON.parse(row.inputs) as ExamInputs,
    metrics: JSON.parse(row.metrics) as BodyMetric[],
  };
}

/** 保存一次体检：计算 → 落库 → 返回完整记录。 */
export async function saveExamRecord(inputs: ExamInputs): Promise<ExamRecord> {
  const record: ExamRecord = {
    id: genId(),
    createdAt: Date.now(),
    inputs,
    metrics: computeBodyComposition(inputs),
  };
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO ${TABLE} (id, created_at, inputs, metrics) VALUES (?, ?, ?, ?)`,
    [record.id, record.createdAt, JSON.stringify(record.inputs), JSON.stringify(record.metrics)]
  );
  return record;
}

/** 最新一条记录（洞察页只展示最新）。无记录返回 null。 */
export async function getLatestExamRecord(): Promise<ExamRecord | null> {
  try {
    const db = await openDb();
    const row = await db.getFirstAsync<{
      id: string;
      created_at: number;
      inputs: string;
      metrics: string;
    }>(`SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`);
    return row ? parseRecord(row) : null;
  } catch (e) {
    console.warn('[examStore] getLatestExamRecord failed:', e);
    return null;
  }
}

/** 全部记录，按时间升序（历史页「按时间先后排列」）。 */
export async function getAllExamRecords(): Promise<ExamRecord[]> {
  try {
    const db = await openDb();
    const rows = await db.getAllAsync<{
      id: string;
      created_at: number;
      inputs: string;
      metrics: string;
    }>(`SELECT * FROM ${TABLE} ORDER BY created_at ASC`);
    return rows.map(parseRecord);
  } catch (e) {
    console.warn('[examStore] getAllExamRecords failed:', e);
    return [];
  }
}

/** 删除一条记录（历史页可删除单次测量）。 */
export async function deleteExamRecord(id: string): Promise<void> {
  try {
    const db = await openDb();
    await db.runAsync(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  } catch (e) {
    console.warn('[examStore] deleteExamRecord failed:', e);
  }
}

/** 记录总数（用于历史页副标题与洞察页「查看 N 次历史」）。 */
export async function countExamRecords(): Promise<number> {
  try {
    const db = await openDb();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE}`
    );
    return row?.n ?? 0;
  } catch (e) {
    console.warn('[examStore] countExamRecords failed:', e);
    return 0;
  }
}
