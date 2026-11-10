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
 *
 * ★ 2026-11-06 审查（docs/audit/02）：**不再写入任何演示记录**。
 *   旧实现会在首次启动（表为空）时 seed 3 条演示体检记录，供无戒指环境审阅 UI。
 *   这对渠道商演示是致命的 —— 用户会把演示值当成自己的真实体检结果。
 *   现在表为空就是空状态，由用户**手动触发**一键体检后才写入真实测量结果。
 * ---------------------------------------------------------------------------
 */
import * as SQLite from 'expo-sqlite';
import { healthStore, dayKey, type MetricKey } from './healthStore';
import { RingBle } from '../ble/RingBleManager';
import { userStore } from './userStore';
import { computeBodyComposition } from './examStore';
import { getProfile, getDeviceProfileId, hasCap } from '../config/deviceModel';
import {
  estimateTodayStatus, estimateStress, statusLevel,
  windowMean, baselineFromDaily, type EstimateInput, type QCSource,
} from '../lib/quickCheckEstimate';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { computeStressReport } from '../lib/stressAlgorithm';
import { saveQuickCheckResult, type QuickCheckResultValue } from './quickCheckResult';
import { saneBodyTemp } from './ringDataIsolation';
import { loadCycleLog } from './cycleLog';
import { computeCycle, hormoneLevelsAtDay } from '../lib/cycleMath';
import { refreshReportNotes } from './quickCheckInterpret';

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
  /** 数据来源（内部保留，用于合规区分；微体检报告已不在每条下面展示「实测/估算」标签，来源说明统一放在分组级） */
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
  // ★ 2026-11-08：旧记录把「戒指真实回读 / 按首次填写推算」等文案连同数值一起
  //   序列化进了 SQLite，改前端代码改不到历史数据。读出时统一过一遍解读引擎，
  //   让所有历史报告打开即显示「这个数值意味着什么 + 正常与否 + 建议」，不改任何测量结果。
  let groups: QCGroup[] = [];
  try {
    groups = JSON.parse(row.groups) as QCGroup[];
  } catch {
    groups = [];
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    groups: refreshReportNotes(groups),
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

/**
 * ★ 2026-11-08 B 稿「异常概览」三分类口径（用户拍板）：
 *   顶部概览不再笼统写「完成 N 项」，而是诚实拆成三类：
 *   - flagged  测量项里状态异常的（high/low/risk）→ 需要留意，数据用黄色呈现
 *   - ok       测量项里状态正常的
 *   - model    source='estimated' 的推算/模型值 → 不参与正常/异常判定（蓝点呈现）
 *   口径：正常/异常只针对有参考区间的测量项；推算与模型值不做判定，仅供参考。
 *   历史记录里 source 缺失的条目按测量项处理（estimated 标记自 2026-11-06 引入，齐全）。
 */
export interface RecordTally {
  total: number;
  ok: number;
  flagged: number;
  model: number;
  /** 需要留意的测量项清单（按出现顺序） */
  flaggedMetrics: QCMetric[];
}

export function classifyRecord(rec: QuickCheckRecord): RecordTally {
  let total = 0;
  let ok = 0;
  let flagged = 0;
  let model = 0;
  const flaggedMetrics: QCMetric[] = [];
  const walk = (m?: QCMetric[]) => {
    for (const it of m ?? []) {
      total++;
      if (it.source === 'estimated') {
        model++;
      } else if (it.status !== 'ok') {
        flagged++;
        flaggedMetrics.push(it);
      } else {
        ok++;
      }
    }
  };
  for (const g of rec.groups) {
    walk(g.metrics);
    walk(g.risk?.sub);
    walk(g.standalone);
  }
  return { total, ok, flagged, model, flaggedMetrics };
}

/** 保存一次体检记录。record.groups 直接序列化入库。 */
export async function saveQuickCheck(rec: QuickCheckRecord): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO ${TABLE} (id, created_at, groups) VALUES (?, ?, ?)`,
    [rec.id, rec.createdAt, JSON.stringify(rec.groups)]
  );
}

/** 真实测量后落库：从外部传入已组装好的 groups（落库前统一走数值驱动解读引擎）。 */
export async function addQuickCheck(groups: QCGroup[]): Promise<QuickCheckRecord> {
  const rec: QuickCheckRecord = { id: genId(), createdAt: Date.now(), groups: refreshReportNotes(groups) };
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
  // ★ 体温仅硬件支持时回读（精简版 type=0 不支持，避免把旧设备遗留值冒充实测）
  const temp = hasCap(profile, 'temp') ? saneBodyTemp(d('temp')) : null;
  const hrv = d('hrv');
  // ★ 交感神经活跃度非戒指可测指标（EDA/皮电精简版不支持），绝不在微体检冒充「实测」
  const sns: number | null = null;
  const steps = d('steps');
  const sleepMin = d('sleepTotal');
  // ★ 血液成分仅硬件支持时回读（精简版 CompTag=0 不支持；避免 HK18 遗留血脂冒充实测）
  const bcSupported = hasCap(profile, 'bloodComponents');
  const tg = bcSupported ? d('triglyceride') : null;
  const hdl = bcSupported ? d('hdl') : null;
  const ldl = bcSupported ? d('ldl') : null;
  const statusMeasured = d('statusScore');   // auto_data.status_score 真实回读
  const hrvDaily = (state as any)?.hrvDaily as Record<string, number> | undefined;
  const hrvPts = (state as any)?.history?.hrv as { t: number; v: number }[] | undefined;
  const hrPts = (state as any)?.history?.hr as { t: number; v: number }[] | undefined;

  // Pro 专属：仅 PRO_UI 才允许读 healthStore 的历史测量（基础版一律不碰，避免 HK18 混显）
  // ★ 血压：基础版硬件支持（BpTag=1），应从当前戒指 daily 真实回读，而非仅限 Pro
  const bpSupported = hasCap(profile, 'bp');
  const bpSys = bpSupported ? (d('bpSys') ?? (isPro ? gl('bpSys') : null)) : null;
  const bpDia = bpSupported ? (d('bpDia') ?? (isPro ? gl('bpDia') : null)) : null;
  const glucose = isPro && hasCap(profile, 'glucose') ? gl('glucose') : null;
  const ua = isPro && hasCap(profile, 'uricAcid') ? gl('ua') : null;
  const tc = isPro && hasCap(profile, 'cholesterol') ? gl('cholesterol') : null;
  const skin = isPro && hasCap(profile, 'skin') ? gl('skin') : null;
  const emotion = isPro && hasCap(profile, 'emotion') ? gl('emotion') : null;
  const cortisol = isPro && hasCap(profile, 'cortisol') ? gl('cortisol') : null;
  const stressMeasured = isPro && hasCap(profile, 'cortisol') ? gl('stress') : null;
  const fatigue = isPro && hasCap(profile, 'cortisol') ? gl('fatigue') : null;
  // 运动消耗（卡路里日汇总，来自逐点 calorie 折日写入 healthStore，非逐点）
  const calorie = gl('calorie');

  // ── 2. 估算输入：HRV 60s / 30s 短窗 + 近 7 天基线 ────────────────────────
  // ★ 2026-11-06（用户：做完体检今日状态不能还是空的）：短窗/今日 daily 都取不到时，
  //   回退到「最近一次」HRV / 心率读数（history 里最新的一个点，不限今天），
  //   让体检总能基于最近的生理信号给出状态结果；来源仍标「估算」，不冒充实测。
  const now = Date.now();
  const lastPt = (pts: { t: number; v: number }[] | null | undefined): number | null => {
    if (!pts || !pts.length) return null;
    const sorted = [...pts].filter((p) => Number.isFinite(p.v) && p.v > 0).sort((a, b) => b.t - a.t);
    return sorted.length ? sorted[0].v : null;
  };
  const hrvLatest = hrv ?? lastPt(hrvPts);
  const hrLatest = hr ?? lastPt(hrPts);
  const estInput: EstimateInput = {
    hrv60: windowMean(hrvPts, 60_000, now) ?? hrvLatest,
    hrv30: windowMean(hrvPts, 30_000, now) ?? hrvLatest,
    hrvBaseline: baselineFromDaily(hrvDaily ?? {}, 7, now),
    hr: hrLatest, spo2, sns: null, sleepMin, statusMeasured, stressMeasured,
  };
  const todayStatus = estimateTodayStatus(estInput);
  const stressEst = estimateStress(estInput);

  // ── 3. 身体成分：来自首次注册录入的身高 / 体重 / 年龄 / 性别 ─────────────
  let bodyMetrics: ReturnType<typeof computeBodyComposition> | null = null;
  let bodyNote = '';
  // ★ v18.134（审查 03 🔵#17）：区分「档案读取失败」与「用户从未填过身高体重」。
  //   两者在 UI 上原本完全一样 —— 身体成分整项凭空消失，用户不知道是自己的问题还是 App 读失败。
  let bodyAbsentReason: 'profile-missing' | 'profile-read-failed' | null = null;
  try {
    const session = await userStore.loadSession();
    const p = session.profile;
    if (p && typeof p.height === 'number' && typeof p.weight === 'number' && p.height > 0 && p.weight > 0) {
      const age = typeof p.age === 'number' && p.age > 0 ? p.age : 30;
      const sex: 'female' | 'male' = p.gender === 'male' ? 'male' : 'female';
      bodyMetrics = computeBodyComposition({ weight: p.weight, height: p.height, age, sex });
      bodyNote = '身体成分反映脂肪、肌肉与基础代谢的大致水平，精确值以专业体测为准，建议结合饮食运动看趋势。';
    } else {
      bodyAbsentReason = 'profile-missing';
      bodyNote = '填写身高体重后可推算身体成分。';
    }
  } catch (e) {
    // ★ 读取失败与「未填写」必须区分 —— 否则用户看到身体成分凭空消失却不知原因。
    console.warn('[quickCheckStore] 读取用户档案失败：', e);
    bodyAbsentReason = 'profile-read-failed';
    bodyNote = '身体成分档案读取失败，可稍后重试或检查设置。';
  }

  const hasAny = [hr, spo2, temp, hrv, steps, sleepMin, tg, hdl, ldl, statusMeasured, calorie,
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
      // ★ 2026-11-08 B 稿落地（用户拍板口径）：活动量/睡眠补一层偏离判定（只作用于实测项）。
      //   步数 <3000 明显低于日常活动下限（B 稿示例 1,280 步判「偏少」）；昨夜睡眠 <6h 恢复窗口偏紧。
      //   HRV / 运动消耗个体差异大、无公认参考区间，维持不判定（看趋势，不评分）。
      case 'steps': return v < 3000 ? 'low' : 'ok';
      case 'sleepMin': return v < 360 ? 'low' : 'ok';
      default: return 'ok';
    }
  };
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
      key: 'stress', name: '身心压力', value: String(stressEst.value), unit: '',
      status: sb('stress', stressEst.value),
      label: stressEst.value >= 60 ? '偏高' : stressEst.value >= 30 ? '平稳' : '放松',
      scale: { min: 0, max: 100, v: stressEst.value },
      levels: '身心压力等级参考：1-29 放松 / 30-59 平稳 / 60-79 中等 / 80-100 压力较大',
      note: stressEst.reason,
    }));
  }
  if (statusItems.length) {
    groups.push({
      key: 'today', title: '今日状态', icon: '✨',
      note: '这一组反映你当下的整体状态，会同步到首页「今日状态」。结合心率、HRV、睡眠等信号给出，看趋势比单次更有意义。',
      metrics: statusItems,
    });
  }

  // ── 核心体征（全部实测）─────────────────────────────────────────────────
  const core: QCMetric[] = [];
  if (hr != null) core.push(measured({ key: 'hr', name: '心率', value: String(Math.round(hr)), unit: '次/分', status: sb('hr', hr), ref: '参考 60~100', note: '心率反映心脏负荷与即时状态；静息持续 >100 或 <50 并伴不适时建议留意，偶发波动多与运动、情绪或咖啡因有关。' }));
  if (hrv != null) core.push(measured({ key: 'hrv', name: 'HRV', value: String(Math.round(hrv)), unit: '毫秒', status: 'ok', note: 'HRV 反映自主神经弹性，越高通常代表恢复越好、抗压能力越强；短期下降常因熬夜、压力或饮酒，看趋势比单次更有意义。' }));
  if (spo2 != null) core.push(measured({ key: 'spo2', name: '血氧', value: String(Math.round(spo2)), unit: '%', status: sb('spo2', spo2), ref: '参考 95~100%', note: '血氧是血液氧气饱和度，正常约 95–100%；低于 95% 可能与呼吸、睡眠或佩戴松紧有关，持续偏低建议就医排查。' }));
  if (temp != null) core.push(measured({ key: 'temp', name: '体温', value: String(r2(temp)), unit: '°C', status: 'ok', note: '体表温度受环境、活动与周期影响，单次略高/低多为正常波动；若伴发热感应结合体温计判断。' }));
  if (bpSys != null && bpDia != null) {
    const st = sb('bpSys', bpSys) !== 'ok' || sb('bpDia', bpDia) !== 'ok'
      ? (sb('bpSys', bpSys) === 'high' || sb('bpDia', bpDia) === 'high' ? 'high' : 'low') : 'ok';
    core.push(measured({ key: 'bp', name: '血压', value: `${Math.round(bpSys)}/${Math.round(bpDia)}`, unit: 'mmHg', status: st, ref: '参考 <120/80 mmHg', scale: { min: 80, max: 160, v: Math.round(bpSys) }, note: '血压反映心血管负荷，理想约 <120/80；偏高常与高盐饮食、压力、睡眠不足相关，异常请以医用血压计确认。' }));
  }
  if (core.length) groups.push({ key: 'core', title: '核心体征', icon: '❤️', note: '以下为核心体征，逐项说明当前是否正常、可能的原因，以及可参考的日常建议。', metrics: core });

  // ── 活动与睡眠（实测）───────────────────────────────────────────────────
  const activity: QCMetric[] = [];
  if (steps != null) activity.push(measured({ key: 'steps', name: '今日步数', value: String(Math.round(steps)), unit: '步', status: sb('steps', steps), label: sb('steps', steps) === 'low' ? '偏少' : undefined, note: '步数反映日常活动量，一般建议每日 6000–8000 步以上以维持基础活动水平；偏少时可分两段各走 10 分钟补齐。' }));
  if (sleepMin != null) activity.push(measured({ key: 'sleep', name: '昨夜睡眠', value: `${Math.floor(sleepMin / 60)}小时${Math.round(sleepMin % 60)}分`, unit: '', status: sb('sleepMin', sleepMin), label: sb('sleepMin', sleepMin) === 'low' ? '偏短' : undefined, note: '昨夜睡眠时长反映恢复基础，成人建议 7–9 小时；偏短时恢复窗口偏紧，今晚可提前半小时上床。' }));
  if (calorie != null) activity.push(measured({ key: 'calorie', name: '运动消耗', value: String(Math.round(calorie)), unit: '千卡', status: 'ok', note: '运动消耗反映当日能量支出，结合饮食与休息有助于体重与体能管理。' }));
  if (activity.length) groups.push({ key: 'activity', title: '活动与睡眠', icon: '🌙', note: '以下反映你当日的活动量与昨夜睡眠，是评估恢复基础的重要参考。', metrics: activity });

  // ── 血脂（基础版也有，实测）─────────────────────────────────────────────
  const blood: QCMetric[] = [];
  if (tg != null) blood.push(measured({ key: 'tg', name: '甘油三酯', value: String(r2(tg)), unit: 'mmol/L', status: sb('triglyceride', tg), ref: '参考 <1.7', note: '甘油三酯偏高常与饮食油腻、运动不足相关，建议结合饮食调整与复查。' }));
  if (hdl != null) blood.push(measured({ key: 'hdl', name: '高密度脂蛋白', value: String(r2(hdl)), unit: 'mmol/L', status: sb('hdl', hdl), ref: '参考 >1.0', note: '高密度脂蛋白（“好胆固醇”）偏低时，可通过有氧运动与均衡饮食改善。' }));
  if (ldl != null) blood.push(measured({ key: 'ldl', name: '低密度脂蛋白', value: String(r2(ldl)), unit: 'mmol/L', status: sb('ldl', ldl), ref: '参考 <3.4', note: '低密度脂蛋白（“坏胆固醇”）偏高与心血管风险相关，建议结合饮食与体检关注。' }));
  if (glucose != null) blood.push(measured({ key: 'glucose', name: '血糖', value: String(r2(glucose)), unit: 'mmol/L', status: sb('glucose', glucose), ref: '空腹参考 3.9~6.1', note: '空腹血糖异常建议以医用检测确认，单点读数受进食时间影响较大。' }));
  if (ua != null) blood.push(measured({ key: 'uricAcid', name: '尿酸', value: String(Math.round(ua)), unit: 'μmol/L', status: sb('ua', ua), ref: '常见参考 155~428', scale: { min: 100, max: 500, v: Math.round(ua) }, note: '尿酸偏高与饮食、代谢相关，持续升高需关注痛风风险，建议减少高嘌呤饮食。' }));
  if (tc != null) blood.push(measured({ key: 'tc', name: '总胆固醇', value: String(r2(tc)), unit: 'mmol/L', status: sb('cholesterol', tc), ref: '参考 <5.2', note: '总胆固醇偏高与心血管风险相关，建议结合饮食与体检关注。' }));
  if (blood.length) groups.push({ key: 'blood', title: '血液指标', icon: '🩸', note: '以下血液相关指标供你了解血脂、血糖等趋势；单点读数受进食与近期状态影响，异常请以医用检测为准。', metrics: blood });

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
      groups.push({ key: 'body', title: '身体成分', icon: '⚖️', note: '以下为身体成分推算，反映脂肪、肌肉与基础代谢的大致水平；精确值以专业体测为准，建议结合饮食与运动观察趋势。', metrics: bodyItems });
    }
  } else if (bodyAbsentReason) {
    // ★ v18.134：没有身体成分时**仍然给一整组说明**，让用户知道是「没填」还是「读失败」，
    //   而不是让整项凭空消失。
    groups.push({
      key: 'body',
      title: '身体成分',
      icon: '⚖️',
      note: bodyAbsentReason === 'profile-read-failed'
        ? '未包含身体成分：读取身高体重档案失败，可稍后重试或检查设置。'
        : '未包含身体成分：还没填身高体重，填好后按公开公式推算。',
    });
  }

  // ── 节律组（睡眠节律 / 昼夜节律 / 压力恢复节律 / 生理周期节律）─────────────
  // ★ 全部为「推算 / 节律分析」项，绝不冒充戒指单点实测；任一子项无数据则不展示，
  //   绝不编数。睡眠节律基础版即可算（精准睡眠）；昼夜节律仅 Pro/有皮质醇信号时；
  //   压力恢复节律依赖 EDA/压力事件数据；生理周期节律基于用户记录的经期推算。
  const rhythmItems: QCMetric[] = [];

  // 1) 睡眠节律：近 7 天入睡规律性（基础版支持精准睡眠）
  const bedHours: number[] = [];
  for (let i = 0; i < 7; i++) {
    const s = healthStore.getSleep(dayKey(now - i * 86400000));
    if (s && typeof s.bedHour === 'number') bedHours.push(s.bedHour);
  }
  if (bedHours.length >= 3) {
    const meanBh = bedHours.reduce((a, b) => a + b, 0) / bedHours.length;
    const stdBh = Math.sqrt(bedHours.reduce((a, b) => a + (b - meanBh) ** 2, 0) / bedHours.length);
    const stdMin = Math.round(stdBh * 60);
    const irregular = stdBh > 1;
    const label = stdBh <= 0.5 ? '稳定' : irregular ? '不规律' : '稍波动';
    rhythmItems.push(estimated({
      key: 'sleepRhythm', name: '睡眠节律', value: label, unit: '',
      status: irregular ? 'low' : 'ok', label,
      note: `基于近 ${bedHours.length} 天记录，入睡时间标准差约 ${stdMin} 分钟，当前节律${label}。固定上床与起床时间最见效。`,
    }));
  }

  // 2) 昼夜节律（波动）：优先用真实皮质醇信号拟合；无皮质醇时用 HRV 日内波动作为代理。
  //    ★ 基础版无皮质醇/EDA 传感器，但 HRV 是戒指实测信号，其日内波动与生物钟驱动的
  //      皮质醇节律同源，可作为「波动」的近似参考（只描述形态，不给出激素绝对值）。
  {
    const cFrom = now - 14 * 86400000;
    // ★ 2026-11-08 门禁：只认**实测**皮质醇样本。历史日 cortisol 常是
    //   offlineEstimates 用 stress×1.6+20 线性换算的推算值（healthStore 打了 derivedDays 标），
    //   拿它拟合 cosinor 会得出「晨峰 08:00 / 节律良好」这类建立在假数据上的生理结论。
    //   过滤后样本不足 4 点 → 自然回落到下面的 HRV 代理路径，只描述波动形态。
    const cSamples = healthStore
      .getTimeRange('cortisol', cFrom, now, { fillDailyMean: false, maxPoints: 2000 })
      .filter((p) => Number.isFinite(p.v) && p.v > 0 && !healthStore.isDerivedDay('cortisol', dayKey(p.t)))
      .map((p) => ({ t: p.t, v: p.v }));
    if (cSamples.length >= 4) {
      const cr = analyzeCortisol(cSamples);
      const lvlText = cr.todayLevel === 'dysregulated' ? '紊乱' : cr.todayLevel === 'high' ? '偏高' : '正常';
      const tail = [
        cr.highStreak ? `已连续 ${cr.highStreak} 天偏高` : '',
        cr.dysStreak ? `已连续 ${cr.dysStreak} 天紊乱` : '',
      ].filter(Boolean).join('，');
      rhythmItems.push(estimated({
        key: 'circadian', name: '昼夜节律', value: lvlText, unit: '',
        status: cr.todayLevel === 'normal' ? 'ok' : cr.todayLevel === 'high' ? 'high' : 'risk',
        label: lvlText,
        note: `基于近 14 天皮质醇信号拟合昼夜曲线，当前节律${lvlText}${tail ? `（${tail}）` : ''}。正常应呈晨高夜低；持续偏高或峰值错位常与压力、作息紊乱相关，可留意放松与睡眠、保持规律作息。`,
      }));
    } else {
      // HRV 代理：用日内 HRV 波动近似皮质醇昼夜节律形态（只给波动，不给激素绝对值）
      const hrvPts = healthStore
        .getTimeRange('hrv', cFrom, now, { fillDailyMean: false, maxPoints: 2000 })
        .filter((p) => Number.isFinite(p.v) && p.v > 0);
      if (hrvPts.length >= 8) {
        const buckets: number[][] = Array.from({ length: 24 }, () => []);
        for (const p of hrvPts) buckets[new Date(p.t).getHours()].push(p.v);
        const hourly: { h: number; mean: number }[] = [];
        for (let h = 0; h < 24; h++) {
          if (buckets[h].length) {
            hourly.push({ h, mean: buckets[h].reduce((a, b) => a + b, 0) / buckets[h].length });
          }
        }
        if (hourly.length >= 6) {
          const means = hourly.map((x) => x.mean);
          const max = Math.max(...means), min = Math.min(...means);
          const avg = means.reduce((a, b) => a + b, 0) / means.length;
          const peak = hourly.find((x) => x.mean === max)!;
          const trough = hourly.find((x) => x.mean === min)!;
          // 自主神经（HRV）通常与皮质醇呈反向昼夜节律：夜间/休息高、日间/活动低。
          // 用波动幅度判断节律是否分明。
          const ratio = avg > 0 ? (max - min) / avg : 0;
          const regular = ratio > 0.12;
          const lvlText = regular ? '昼夜分明' : '波动平缓';
          rhythmItems.push(estimated({
            key: 'circadian', name: '昼夜节律', value: lvlText, unit: '',
            status: regular ? 'ok' : 'low',
            label: lvlText,
            note: `基于近 14 天 HRV 日内波动：自主神经活跃度约 ${String(peak.h).padStart(2, '0')}:00 最高、${String(trough.h).padStart(2, '0')}:00 最低，昼夜节律${lvlText}。规律作息有助于维持波动。`,
          }));
        }
      }
    }
  }

  // 3) 压力恢复节律：有 EDA / 压力事件数据时
  const stressRep = computeStressReport(now);
  if (stressRep.avgRecoverySec != null) {
    const recSec = stressRep.avgRecoverySec;
    const prolonged = stressRep.recoveryProlonged;
    const slow = prolonged != null && prolonged > 100;
    const label = recSec <= 60 ? '恢复快' : recSec <= 90 ? '正常' : '偏慢';
    // ★ 2026-11-10（用户）：2400 秒看着像写死的常量，其实是 EDA/压力事件恢复耗时均值。
    //   大数改读成「分」更直观，并明确标注「信号推算、非实测」。
    const recText = recSec >= 60 ? `${Math.round(recSec / 60)} 分` : `${recSec} 秒`;
    rhythmItems.push(estimated({
      key: 'recovery', name: '压力恢复节律', value: recText, unit: '',
      status: slow ? 'high' : 'ok', label,
      note: `基于全天压力事件后的恢复时长，平均每次约 ${recText} 回到基线（EDA / 压力信号推算，非实测）。恢复偏慢提示自主神经弹性下降，留意放松与睡眠。`,
    }));
  }

  // 4) 生理周期节律：基于用户记录的经期周期推算（非戒指激素实测）
  const cycleLog = await loadCycleLog();
  const cycleInfo = computeCycle(cycleLog);
  if (cycleInfo.hasLog && cycleInfo.dayInCycle != null) {
    const hl = hormoneLevelsAtDay(cycleLog, cycleInfo.dayInCycle);
    rhythmItems.push(estimated({
      key: 'cyclePhase', name: '生理周期阶段', value: cycleInfo.phaseLabel, unit: '',
      status: 'ok', label: `周期第 ${cycleInfo.dayInCycle} 天`,
      note: '基于你记录的经期周期推算，反映当前所处的周期阶段；结合 HRV 与静息心率可交叉观察身体状态的变化趋势。',
    }));
    if (hl.estrogen != null) {
      rhythmItems.push(estimated({
        key: 'estrogen', name: '雌激素（周期建模）', value: String(Math.round(hl.estrogen)), unit: '/100',
        status: 'ok', scale: { min: 0, max: 100, v: Math.round(hl.estrogen) },
        note: '由经期记录推算的建模值（戒指不测激素），反映当前周期阶段的相对水平，可结合 HRV 与静息心率观察变化趋势。',
      }));
    }
    if (hl.progesterone != null) {
      rhythmItems.push(estimated({
        key: 'progesterone', name: '黄体酮（周期建模）', value: String(Math.round(hl.progesterone)), unit: '/100',
        status: 'ok', scale: { min: 0, max: 100, v: Math.round(hl.progesterone) },
        note: '由经期记录推算的建模值（戒指不测激素），黄体期通常高于卵泡期，可结合身体感受观察趋势。',
      }));
    }
  }

  if (rhythmItems.length) {
    groups.push({
      key: 'rhythm', title: '节律', icon: '🌀',
      note: '本组从节律角度解读你的身体状态：睡眠规律性看近 7 天入睡是否稳定；昼夜节律看皮质醇或自主神经的日内波动；压力恢复看事件后放松回来的速度；生理周期看经期记录推算的阶段。各项均为趋势性参考，无对应数据时该项不展示。',
      metrics: rhythmItems,
    });
  } else {
    groups.push({
      key: 'rhythm', title: '节律', icon: '🌀',
      note: '节律分析需要连续几天的睡眠、压力信号或经期记录。当前数据不足，连续佩戴并记录经期后可查看。',
    });
  }

  // ── Pro 专属健康一览信号（仅 PRO_UI）────────────────────────────────────
  if (isPro) {
    const mentalSub: QCMetric[] = [];
    if (skin != null) mentalSub.push(measured({ key: 'skin', name: '皮肤含水量', value: String(Math.round(skin)), unit: '%', status: 'ok', note: '皮肤含水量反映皮肤屏障与 hydration 状态，受环境湿度、饮水与护肤影响；偏低时可留意补水与保湿。' }));
    if (emotion != null) mentalSub.push(measured({ key: 'mood', name: '情绪', value: String(Math.round(emotion)), unit: '', status: 'ok', label: '已记录', note: '情绪记录反映你当天的情绪倾向，连续记录有助于识别自身情绪节律与触发因素。' }));
    if (cortisol != null) mentalSub.push(measured({ key: 'cortisol', name: '皮质醇', value: String(r2(cortisol)), unit: 'μg/dL', status: 'ok', note: '皮质醇是应激激素，正常应呈晨高夜低；持续偏高常与压力、作息紊乱相关，可留意放松与睡眠。' }));
    if (fatigue != null) mentalSub.push(measured({ key: 'fatigue', name: '疲劳度', value: String(Math.round(fatigue)), unit: '', status: sb('fatigue', fatigue), note: '疲劳度反映身心消耗累积，偏高时建议增加休息与睡眠，避免长期透支。' }));
    if (mentalSub.length) {
      const mentalRisk: QCRiskBlock = {
        name: '本次记录信号', status: 'ok', label: '已记录',
        note: '以下为本次记录到的信号，Mira 只做描述与参考，不做风险评估或诊断性结论。',
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
