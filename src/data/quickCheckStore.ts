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
import { RingBle } from '../ble/RingBleManager';
import { userStore } from './userStore';
import { computeBodyComposition } from './examStore';
import { getProfile, getDeviceProfileId, hasCap } from '../config/deviceModel';
import {
  estimateTodayStatus, estimateStress, statusLevel,
  windowMean, baselineFromDaily, type EstimateInput, type QCSource,
} from '../lib/quickCheckEstimate';
import { saveQuickCheckResult, type QuickCheckResultValue } from './quickCheckResult';
import { saneBodyTemp } from './ringDataIsolation';

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
  /** 数据来源：实测回读 / 估算。★ 2026-11-05 用户要求：估算项必须明确标注，不冒充实测 */
  source?: QCSource;
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
  /** 分组级来源说明（如「本组全部为戒指真实回读」/「按身高体重估算」） */
  note?: string;
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
 * 一键体检组装（★ 2026-11-05 重写：按机型能力 + 当前戒指真实回读，杜绝 HK18 遗留数据混显）
 * ---------------------------------------------------------------------------
 * 旧实现无差别读 healthStore 的 bpSys/glucose/ua/cholesterol/skin/emotion/cortisol，
 * 那些是本机历史库里 HK18 时期留下的测量值，与当前基础版 Luna Mira 无关，
 * 却被当成「本次真实测量」展示（用户实锤质疑：「之前不是说没有血压血糖吗？」）。
 *
 * 新口径：
 *  1. 实测项：只从 RingBle 当前状态（BackendRingSource 投影的 auto_data/gsr/hrv_history
 *     真实日值）读取，并按机型能力白名单过滤；Pro 专属项仅在 PRO_UI 下才从 healthStore 读。
 *  2. 估算项：今日状态 / 压力由当前 HRV 短窗 + 心率/血氧/睡眠/交感推算；
 *     身体成分由首次注册录入的身高/体重/年龄/性别推算。全部带 source='estimated'
 *     与来源说明，界面明确标注「估算」，绝不冒充戒指实测。
 *  3. 体检完成后把「今日状态」结果写入 quickCheckResult，首页据此刷新今日状态。
 *
 * 品牌铁律：只描述不诊断、不做风险结论；参考区间仅供参考。
 */
export async function assembleQuickCheckFromRealtime(): Promise<{ ok: boolean; record?: QuickCheckRecord; reason?: string }> {
  const gl = (k: MetricKey, n = 7) => healthStore.getLatest(k, n);
  const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const profileId = await getDeviceProfileId();
  const profile = getProfile(profileId);
  const isPro = profileId === 'PRO_UI';

  const state = RingBle.getState();
  const daily = state?.daily ?? {};
  const d = (k: string): number | null => num(daily[k]);

  // ── 1. 实测回读（基础版白名单：戒指真实上传的日值）───────────────────────
  // ★ 绝不回退到 healthStore：那里的 hr/spo2/hrv 可能是 HK18 时期留下的历史值，
  //   一旦兜底就会把旧数据标成「戒指真实回读」（用户实锤批评的数据混显）。
  //   后端 auto_data 本来就有这三项；没同步到就如实不展示，不编数字。
  const hr = d('hr');
  const spo2 = d('spo2');
  const temp = saneBodyTemp(d('temp')); // 只接受当前戒指的合法日均体温，挡住旧设备遗留 39℃
  const hrv = d('hrv');
  const sns = d('sns');
  const steps = d('steps');
  const sleepMin = d('sleepTotal');
  const tg = d('triglyceride');
  const hdl = d('hdl');
  const ldl = d('ldl');
  const statusMeasured = d('statusScore');   // auto_data.status_score 真实回读
  const hrvDaily = (state as any)?.hrvDaily as Record<string, number> | undefined;
  const hrvPts = (state as any)?.history?.hrv as { t: number; v: number }[] | undefined;

  // Pro 专属：仅 PRO_UI 才允许读 healthStore 的历史测量（基础版一律不碰，避免 HK18 混显）
  const bpSys = isPro && hasCap(profile, 'bp') ? gl('bpSys') : null;
  const bpDia = isPro && hasCap(profile, 'bp') ? gl('bpDia') : null;
  const glucose = isPro && hasCap(profile, 'glucose') ? gl('glucose') : null;
  const ua = isPro && hasCap(profile, 'uricAcid') ? gl('ua') : null;
  const tc = isPro && hasCap(profile, 'cholesterol') ? gl('cholesterol') : null;
  const skin = isPro && hasCap(profile, 'skin') ? gl('skin') : null;
  const emotion = isPro && hasCap(profile, 'emotion') ? gl('emotion') : null;
  const cortisol = isPro && hasCap(profile, 'cortisol') ? gl('cortisol') : null;
  const stressMeasured = isPro && hasCap(profile, 'cortisol') ? gl('stress') : null;
  const fatigue = isPro && hasCap(profile, 'cortisol') ? gl('fatigue') : null;

  // ── 2. 估算输入：HRV 60s / 30s 短窗 + 近 7 天基线 ────────────────────────
  const now = Date.now();
  const estInput: EstimateInput = {
    hrv60: windowMean(hrvPts, 60_000, now) ?? hrv,
    hrv30: windowMean(hrvPts, 30_000, now) ?? hrv,
    hrvBaseline: baselineFromDaily(hrvDaily ?? {}, 7, now),
    hr, spo2, sns, sleepMin, statusMeasured, stressMeasured,
  };
  const todayStatus = estimateTodayStatus(estInput);
  const stressEst = estimateStress(estInput);

  // ── 3. 身体成分：来自首次注册录入的身高 / 体重 / 年龄 / 性别 ─────────────
  let bodyMetrics: ReturnType<typeof computeBodyComposition> | null = null;
  let bodyNote = '';
  try {
    const session = await userStore.loadSession();
    const p = session.profile;
    if (p && typeof p.height === 'number' && typeof p.weight === 'number' && p.height > 0 && p.weight > 0) {
      const age = typeof p.age === 'number' && p.age > 0 ? p.age : 30;
      const sex: 'female' | 'male' = p.gender === 'male' ? 'male' : 'female';
      bodyMetrics = computeBodyComposition({ weight: p.weight, height: p.height, age, sex });
      bodyNote = `按你首次填写的身高 ${p.height}cm / 体重 ${p.weight}kg${typeof p.age !== 'number' ? '（年龄未填，按 30 岁估算）' : ''}推算，非戒指测量。`;
    }
  } catch { /* 档案读取失败 → 不展示身体成分，不编数字 */ }

  const hasAny = [hr, spo2, temp, hrv, sns, steps, sleepMin, tg, hdl, ldl, statusMeasured,
    bpSys, glucose, ua, tc, skin, emotion, cortisol, fatigue].some((v) => v != null)
    || bodyMetrics != null || todayStatus != null || stressEst != null;
  if (!hasAny) return { ok: false, reason: 'no-data' };

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
  const MEASURED = '戒指真实回读';
  const MEASURED_HISTORY = '本机历史测量记录（Pro 机型）';
  const groups: QCGroup[] = [];
  let measuredCount = 0;
  let estimatedCount = 0;
  const measured = (m: QCMetric): QCMetric => { measuredCount++; return { ...m, source: 'measured' as const }; };
  const estimated = (m: QCMetric): QCMetric => { estimatedCount++; return { ...m, source: 'estimated' as const }; };

  // ── 今日状态 / 压力（首页数据来源）───────────────────────────────────────
  const statusItems: QCMetric[] = [];
  if (todayStatus) {
    statusItems.push((todayStatus.source === 'measured' ? measured : estimated)({
      key: 'todayStatus', name: '今日状态', value: String(todayStatus.value), unit: '/100',
      status: 'ok', label: statusLevel(todayStatus.value),
      note: todayStatus.reason, scale: { min: 0, max: 100, v: todayStatus.value },
    }));
  }
  if (stressEst) {
    statusItems.push((stressEst.source === 'measured' ? measured : estimated)({
      key: 'stress', name: '压力', value: String(stressEst.value), unit: '',
      status: sb('stress', stressEst.value),
      label: stressEst.value >= 60 ? '偏高' : stressEst.value >= 30 ? '平稳' : '放松',
      scale: { min: 0, max: 100, v: stressEst.value },
      levels: '压力等级参考：1-29 放松 / 30-59 平稳 / 60-79 中等 / 80-100 压力较大',
      note: stressEst.reason,
    }));
  }
  if (statusItems.length) {
    groups.push({
      key: 'today', title: '今日状态', icon: '✨',
      note: '这一组是本次体检给出的当下状态结果，会同步到首页「今日状态」。带「估算」标记的项不是戒指直接测量。',
      metrics: statusItems,
    });
  }

  // ── 核心体征（全部实测）─────────────────────────────────────────────────
  const core: QCMetric[] = [];
  if (hr != null) core.push(measured({ key: 'hr', name: '心率', value: String(Math.round(hr)), unit: '次/分', status: sb('hr', hr), ref: '参考 60~100', note: MEASURED }));
  if (hrv != null) core.push(measured({ key: 'hrv', name: 'HRV', value: String(Math.round(hrv)), unit: '毫秒', status: 'ok', note: `${MEASURED}；反映心率变异性，受睡眠与状态影响，宜看趋势。` }));
  if (spo2 != null) core.push(measured({ key: 'spo2', name: '血氧', value: String(Math.round(spo2)), unit: '%', status: sb('spo2', spo2), ref: '参考 95~100%', note: MEASURED }));
  if (temp != null) core.push(measured({ key: 'temp', name: '体温', value: String(r2(temp)), unit: '°C', status: 'ok', note: MEASURED }));
  if (sns != null) core.push(measured({ key: 'sns', name: '交感神经活跃度', value: String(Math.round(sns)), unit: '', status: 'ok', label: sns >= 60 ? '偏活跃' : sns <= 30 ? '放松' : '适中', note: `${MEASURED}（gsr 通道）` }));
  if (bpSys != null && bpDia != null) {
    const st = sb('bpSys', bpSys) !== 'ok' || sb('bpDia', bpDia) !== 'ok'
      ? (sb('bpSys', bpSys) === 'high' || sb('bpDia', bpDia) === 'high' ? 'high' : 'low') : 'ok';
    core.push(measured({ key: 'bp', name: '血压', value: `${Math.round(bpSys)}/${Math.round(bpDia)}`, unit: 'mmHg', status: st, ref: '参考 <120/80', scale: { min: 80, max: 160, v: Math.round(bpSys) }, note: MEASURED_HISTORY }));
  }
  if (core.length) groups.push({ key: 'core', title: '核心体征', icon: '❤️', note: '标「实测」的项来自当前戒指回读（Pro 机型血压取本机历史测量记录）。', metrics: core });

  // ── 活动与睡眠（实测）───────────────────────────────────────────────────
  const activity: QCMetric[] = [];
  if (steps != null) activity.push(measured({ key: 'steps', name: '今日步数', value: String(Math.round(steps)), unit: '步', status: 'ok', note: MEASURED }));
  if (sleepMin != null) activity.push(measured({ key: 'sleep', name: '昨夜睡眠', value: `${Math.floor(sleepMin / 60)}小时${Math.round(sleepMin % 60)}分`, unit: '', status: 'ok', note: MEASURED }));
  if (activity.length) groups.push({ key: 'activity', title: '活动与睡眠', icon: '🌙', note: '本组全部为戒指真实回读。', metrics: activity });

  // ── 血脂（基础版也有，实测）─────────────────────────────────────────────
  const blood: QCMetric[] = [];
  if (tg != null) blood.push(measured({ key: 'tg', name: '甘油三酯', value: String(r2(tg)), unit: 'mmol/L', status: sb('triglyceride', tg), ref: '参考 <1.7', note: MEASURED }));
  if (hdl != null) blood.push(measured({ key: 'hdl', name: '高密度脂蛋白', value: String(r2(hdl)), unit: 'mmol/L', status: sb('hdl', hdl), ref: '参考 >1.0', note: MEASURED }));
  if (ldl != null) blood.push(measured({ key: 'ldl', name: '低密度脂蛋白', value: String(r2(ldl)), unit: 'mmol/L', status: sb('ldl', ldl), ref: '参考 <3.4', note: MEASURED }));
  if (glucose != null) blood.push(measured({ key: 'glucose', name: '血糖', value: String(r2(glucose)), unit: 'mmol/L', status: sb('glucose', glucose), ref: '空腹参考 3.9~6.1', note: MEASURED_HISTORY }));
  if (ua != null) blood.push(measured({ key: 'uricAcid', name: '尿酸', value: String(Math.round(ua)), unit: 'μmol/L', status: sb('ua', ua), ref: '常见参考 155~428', scale: { min: 100, max: 500, v: Math.round(ua) }, note: MEASURED_HISTORY }));
  if (tc != null) blood.push(measured({ key: 'tc', name: '总胆固醇', value: String(r2(tc)), unit: 'mmol/L', status: sb('cholesterol', tc), ref: '参考 <5.2', note: MEASURED_HISTORY }));
  if (blood.length) groups.push({ key: 'blood', title: '血液指标', icon: '🩸', note: '标「实测」的项来自当前戒指回读或本机历史测量记录；基础版提供血脂三项。', metrics: blood });

  // ── 身体成分（按首次注册资料估算）───────────────────────────────────────
  if (bodyMetrics) {
    const pick = ['bmi', 'bodyFatPercentage', 'muscleMass', 'basalMetabolicRate'];
    const bodyItems = bodyMetrics
      .filter((m) => pick.includes(m.key))
      .map((m) => estimated({
        key: m.key, name: m.name, value: m.value.toFixed(m.decimals), unit: m.unit,
        status: m.status === 'low' ? 'low' : m.status === 'high' ? 'high' : 'ok',
        ref: m.range, note: bodyNote,
      }));
    if (bodyItems.length) {
      groups.push({ key: 'body', title: '身体成分', icon: '⚖️', note: '本组为按你首次填写的身高 / 体重 / 年龄 / 性别用公开公式估算，不是戒指测量。', metrics: bodyItems });
    }
  }

  // ── Pro 专属健康一览信号（仅 PRO_UI）────────────────────────────────────
  if (isPro) {
    const mentalSub: QCMetric[] = [];
    if (skin != null) mentalSub.push(measured({ key: 'skin', name: '皮肤含水量', value: String(Math.round(skin)), unit: '%', status: 'ok', note: MEASURED }));
    if (emotion != null) mentalSub.push(measured({ key: 'mood', name: '情绪', value: String(Math.round(emotion)), unit: '', status: 'ok', label: '已记录', note: MEASURED }));
    if (cortisol != null) mentalSub.push(measured({ key: 'cortisol', name: '皮质醇', value: String(r2(cortisol)), unit: 'μg/dL', status: 'ok', note: MEASURED }));
    if (fatigue != null) mentalSub.push(measured({ key: 'fatigue', name: '疲劳度', value: String(Math.round(fatigue)), unit: '', status: sb('fatigue', fatigue), note: MEASURED }));
    if (mentalSub.length) {
      const mentalRisk: QCRiskBlock = {
        name: '本次记录信号', status: 'ok', label: '已记录',
        note: '以下为本次真实记录到的信号值。Mira 只做描述与参考，不做风险评估或诊断性结论。',
        sub: mentalSub,
      };
      groups.push({ key: 'mental', title: '健康一览信号', icon: '🧠', risk: mentalRisk });
    }
  }

  const rec = await addQuickCheck(groups);

  // ── 4. 把「今日状态」结果写给首页（订阅后即时刷新）──────────────────────
  const toResultValue = (v: { value: number; source: QCSource; reason: string } | null): QuickCheckResultValue | null =>
    v ? { value: v.value, source: v.source, reason: v.reason } : null;
  const bmi = bodyMetrics?.find((m) => m.key === 'bmi')?.value ?? null;
  const bodyFat = bodyMetrics?.find((m) => m.key === 'bodyFatPercentage')?.value ?? null;
  const muscle = bodyMetrics?.find((m) => m.key === 'muscleMass')?.value ?? null;
  const bmr = bodyMetrics?.find((m) => m.key === 'basalMetabolicRate')?.value ?? null;
  await saveQuickCheckResult({
    createdAt: Date.now(),
    recordId: rec.id,
    status: toResultValue(todayStatus),
    stress: toResultValue(stressEst),
    body: bmi != null && bodyFat != null && muscle != null && bmr != null ? { bmi, bodyFat, muscle, bmr } : null,
    measuredCount,
    estimatedCount,
  });

  return { ok: true, record: rec };
}
