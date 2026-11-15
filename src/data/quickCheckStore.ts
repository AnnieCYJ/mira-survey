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
import { showCycleContent } from './cycleScope';
import { computeBodyComposition } from './examStore';
import { getProfile, getDeviceProfileId, hasCap } from '../config/deviceModel';
import {
  estimateTodayStatus, estimateStress, statusLevel,
  type EstimateInput, type QCSource,
} from '../lib/quickCheckEstimate';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { computeStressReport } from '../lib/stressAlgorithm';
import { physioValid } from '../lib/physioRange';
import { saveQuickCheckResult, type QuickCheckResultValue } from './quickCheckResult';
import { saneBodyTemp } from './ringDataIsolation';
import { loadCycleLog } from './cycleLog';
import { computeCycle, hormoneLevelsAtDay } from '../lib/cycleMath';
import { hormoneBrief } from '../lib/phaseHormoneBrief';
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
  /**
   * ★ 2026-11-13 真机验收：本次报告的「依据说明」（现场测得 / 今天已同步 / 当场重算 /
   *   最近记录推算）。必须独立于 note：refreshReportNotes() 会把有内容分组的 note 一律清空，
   *   之前拼进 groups[0].note 的分层说明在真机报告里全部消失（静态门禁查源码却全绿）。
   */
  basisNote?: string;
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
 * 新口径（★ 2026-11-13 用户拍板「首次只展示当场测的 + 当场算的，戴久了再加最近的数据」）：
 *  1. 本次现场测得：心率 / 血氧（35 秒窗口内新回流，优先于日值），与洞察页实时卡同源。
 *  2. 今天已同步：步数 / 昨夜睡眠 / 血压 / 体温 / 状态分等**当日**日值。`state.daily`
 *     有跨天清零基准，healthStore 只用 `getTodayValue()`；绝不回退到 `getLatest(k, 7)`
 *     拿几天前的最后一次读数顶替今天（老用户中途体检最容易踩的坑）。
 *  3. 当场算出：今日状态 / 身心压力用 ①+② **每次重算**，不沿用上一次的分数；
 *     身体成分由注册资料推算。全部带 source='estimated' 与来源说明，不冒充实测。
 *  4. 最近记录推算：睡眠节律 / 昼夜节律 / 压力恢复 / 周期趋势，来自近 7–14 天记录，
 *     是趋势结论、不是读数，报告里写明来源。首次没有这些记录 → 天然不出现。
 *  5. 每一项都有「没读数就不展示」守卫，所以**不需要首次分支**：首次时 ②④ 为空，
 *     报告自动收窄成 ①③。依据说明见 quickCheckScope.scopeNote()。
 *  6. 体检完成后把「今日状态」结果写入 quickCheckResult，首页据此刷新今日状态。
 *
 * 品牌铁律：只描述不诊断、不做风险结论；参考区间仅供参考。
 */
export async function assembleQuickCheckFromRealtime(
  /** ★ 2026-11-13：现场测量窗口起点；只认这个时间点之后新回流的实时读数，
   *  避免把上一次连接留下的旧值当成「本次现场测量」。不传则按已同步日值组装。 */
  opts?: { since?: number }
): Promise<{ ok: boolean; record?: QuickCheckRecord; reason?: string }> {
  const now = Date.now();
  // ★ 2026-11-13（用户：老用户中途体检「用测量 + 最近的数据」）：给「最近」划边界 ——
  //   单点读数只认**今天**。旧实现 healthStore.getLatest(k, 7) 会一路回退到 7 天前，
  //   把「上一次测到的血压」当今天的数值展示；state.daily 有跨天清零基准，
  //   healthStore.getTodayValue() 同样只取当日，两者都不会带出昨天的数。
  //   真正跨天的是「节律」组的趋势结论（推算，不是读数），单独标注「基于最近 N 天记录」。
  const todayVal = (k: MetricKey): number | null => healthStore.getTodayValue(k, now);
  const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const profileId = await getDeviceProfileId();
  const profile = getProfile(profileId);
  const isPro = profileId === 'PRO_UI';

  const state = RingBle.getState();
  const daily = state?.daily ?? {};
  const d = (k: string): number | null => num(daily[k]);

  // ── 0. 本次现场测量读数（★ 2026-11-13）─────────────────────────────────
  // 体检窗口内 QuickCheckTab 真的调了 RingBle.measure('hr'/'spo2')，读数回流到
  // state.metrics + state.lastUpdated。这里只认「窗口内新回流」的值：
  //   · 与洞察页实时卡同源（都是 state.metrics），口径天然一致；
  //   · 没有时间戳或时间戳早于窗口 → 是上次连接留下的旧值，不算本次现场测量；
  //   · 戒指 RTC 可能超前/滞后，时间戳留 60s 容差。
  // ★ 2026-11-13（用户：「HRV 当场测不了，那也不展示 HRV 了吧，不用写固件接口的说明，
  //   用户不关心」）：体检报告不再有 HRV 这一项，也不写任何技术限制说明。
  //   HRV 已同步的日值仍留在洞察页独立卡片，那里才是看 HRV 的地方。
  const since = typeof opts?.since === 'number' ? opts.since : null;
  const liveReading = (k: MetricKey): number | null => {
    const v = num((state as any)?.metrics?.[k]);
    if (v == null) return null;
    if (since != null) {
      const t = num((state as any)?.lastUpdated?.[k]);
      if (t == null || t < since - 60_000) return null;
    }
    return v;
  };
  const liveHr = liveReading('hr');
  const liveSpo2Raw = liveReading('spo2');
  const liveSpo2 = liveSpo2Raw != null && physioValid('spo2', liveSpo2Raw) ? liveSpo2Raw : null;
  const liveTemp = liveReading('temp');

  // ★ 2026-11-14（用户拍板「一键体检加 BP/HRV 主动测量」）：体检窗口内主动发起的血压 /
  //   HRV 测量经 onRealtime 落 healthStore 时间轴。这里按窗口查库取最新点 ——
  //   不读 state.metrics（bpSys/bpDia 不在 CORE_KEYS，不进 metrics）。
  //   同一条 onRealtime 链路会写 state.daily / lastUpdated / extDaily，
  //   洞察页与首页卡片和体检报告同源同步刷新，不存在「体检出了数、卡片不更新」的分叉。
  const windowReading = (k: string): number | null => {
    if (since == null) return null;
    try {
      const pts = healthStore.getTimeRange(k as any, since - 60_000, Date.now(), { maxPoints: 8 });
      const last = pts.length ? pts[pts.length - 1] : null;
      return last && Number.isFinite(last.v) ? last.v : null;
    } catch {
      return null;
    }
  };
  const rawLiveBpSys = windowReading('bpSys');
  const rawLiveBpDia = windowReading('bpDia');
  const rawLiveHrv = windowReading('hrv');
  const liveBpSys = rawLiveBpSys != null && physioValid('bpSys', rawLiveBpSys) ? rawLiveBpSys : null;
  const liveBpDia = rawLiveBpDia != null && physioValid('bpDia', rawLiveBpDia) ? rawLiveBpDia : null;
  const liveHrv = rawLiveHrv != null && physioValid('hrv', rawLiveHrv) ? rawLiveHrv : null;
  // ★ BP/HRV 现场读数也计入「有现场测量」判定（组说明与 liveTag 据此如实标注）
  const hasLiveReading = liveHr != null || liveSpo2 != null || liveTemp != null || liveBpSys != null || liveHrv != null;

  // ── 1. 实测回读（基础版白名单：戒指真实上传的日值）───────────────────────
  // ★ 绝不回退到 healthStore：那里的 hr/spo2/hrv 可能是 HK18 时期留下的历史值，
  //   一旦兜底就会把旧数据标成「戒指真实回读」（用户实锤批评的数据混显）。
  //   后端 auto_data 本来就有这三项；没同步到就如实不展示，不编数字。
  // ★ 2026-11-13：本次现场测到的读数优先，其次才是已同步日值；两者都取不到就 null → 该项不展示。
  const hr = liveHr ?? d('hr');
  // ★ 2026-11-13：读取兜底——若当日血氧日均值被脏值（如 1%）污染，回退为 null（不编数字，连上戒指重新同步后自动恢复）
  let spo2 = liveSpo2 ?? d('spo2');
  if (spo2 != null && !physioValid('spo2', spo2)) spo2 = null;
  // ★ 体温仅硬件支持时回读（精简版 type=0 不支持，避免把旧设备遗留值冒充实测）
  const temp = hasCap(profile, 'temp') ? saneBodyTemp(liveTemp ?? d('temp')) : null;
  // ★ 2026-11-13：体检报告不再读取/展示 HRV（当场测不了，也不解释原因）。
  //   洞察页的 HRV 卡片仍读 state.daily.hrv，不受这里影响。
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
  // ★ 2026-11-13：不再取 HRV 短窗 / 7 天基线作为估算输入（见下方 estInput 说明）。

  // Pro 专属：仅 PRO_UI 才允许读 healthStore 的历史测量（基础版一律不碰，避免 HK18 混显）
  // ★ 血压：基础版硬件支持（BpTag=1）。★ 2026-11-14：本次窗口内主动测得的读数最优先，
  //   其次今天已同步日值；都没有就 null → 该项不展示。
  const bpSupported = hasCap(profile, 'bp');
  const bpSys = bpSupported ? (liveBpSys ?? d('bpSys') ?? (isPro ? todayVal('bpSys') : null)) : null;
  const bpDia = bpSupported ? (liveBpDia ?? d('bpDia') ?? (isPro ? todayVal('bpDia') : null)) : null;
  // ★ 2026-11-14（用户拍板）：HRV 重新接回体检 —— 窗口内主动测得的 HRV 优先，
  //   其次今天已同步日值；都没有则该项不出现（不写任何固件限制说明）。
  //   注意：估算输入仍不含 HRV（hrv60/30/baseline 维持 null），
  //   「今日状态 / 身心压力」算法口径不变，避免这批改动引入分数漂移。
  const hrvVal = liveHrv ?? d('hrv');
  const glucose = isPro && hasCap(profile, 'glucose') ? todayVal('glucose') : null;
  const ua = isPro && hasCap(profile, 'uricAcid') ? todayVal('ua') : null;
  const tc = isPro && hasCap(profile, 'cholesterol') ? todayVal('cholesterol') : null;
  const skin = isPro && hasCap(profile, 'skin') ? todayVal('skin') : null;
  const emotion = isPro && hasCap(profile, 'emotion') ? todayVal('emotion') : null;
  const cortisol = isPro && hasCap(profile, 'cortisol') ? todayVal('cortisol') : null;
  const stressMeasured = isPro && hasCap(profile, 'cortisol') ? todayVal('stress') : null;
  const fatigue = isPro && hasCap(profile, 'cortisol') ? todayVal('fatigue') : null;
  // 运动消耗（当日卡路里汇总：优先 healthStore 当日值，其次戒指已同步的今日步数日值）
  const calorie = todayVal('calorie') ?? d('calorie');

  // ── 2. 估算输入：只用现场心率/血氧 + 已同步睡眠 ──────────────────────────
  // ★ 2026-11-13（用户：「HRV 当场测不了，那也不展示 HRV 了吧」）：
  //   HRV 短窗 / 7 天基线都不再进入估算 —— 让「今日状态 / 身心压力」的来源
  //   与 35 秒现场测量窗口一致，报告里也不会再冒出 HRV 字样。
  //   估算只吃「本次现场读数 / 当日已同步日值」，不再回退到 history 里不限日期的
  //   「最近一个点」（那会把另一枚戒指或几天前的数据混进今日状态）。
  //   来源仍标「估算」，不冒充实测。
  const estInput: EstimateInput = {
    hrv60: null, hrv30: null, hrvBaseline: null,
    hr, spo2, sns: null, sleepMin, statusMeasured, stressMeasured,
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

  // ★ 2026-11-13（用户：首次登录没数据时不该有一份像模像样的报告）：
  //   只认**戒指真实读数**（本次现场 / 已同步日值）。纯估算项（今日状态 / 压力 / 身体成分）
  //   不能单独撑起一份体检报告 —— 否则没连戒指也能出一份「55 分」的空报告。
  //   睡眠、血压等没回读到的项目本就走 `if (x != null)` 守卫，不会以「--」占位出现。
  // ★ 2026-11-13：HRV 不再计入「有真实读数」门槛（报告已不展示它，也不拿它算状态），
  //   否则只有一份 HRV 日值时会生成一份几乎空白的报告。
  const hasRingReading = [hr, spo2, temp, steps, sleepMin, tg, hdl, ldl, statusMeasured, calorie,
    bpSys, hrvVal, glucose, ua, tc, skin, emotion, cortisol, fatigue].some((v) => v != null);
  if (!hasRingReading) return { ok: false, reason: 'no-data' };

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
      note: '这一组会同步到首页「今日状态」。两项都用这次的读数重新算出，不沿用上一次的分数；看趋势比单次更有意义。',
      metrics: statusItems,
    });
  }

  // ── 核心体征（全部实测）─────────────────────────────────────────────────
  // ★ 2026-11-13（用户：「要查这些数据是不是当场能够测量的」）：每项 note 末尾如实标注来源，
  //   现场读数与洞察页实时卡同源（state.metrics）；日值则是戒指已同步的读数。
  const liveTag = '本次为现场测量读数，与洞察页实时卡同源。';
  const dailyTag = '本次取今天已同步的读数，不是这次现场测得的数值。';
  const core: QCMetric[] = [];
  if (hr != null) core.push(measured({ key: 'hr', name: '心率', value: String(Math.round(hr)), unit: '次/分', status: sb('hr', hr), ref: '参考 60~100', note: `心率反映心脏负荷与即时状态；静息持续 >100 或 <50 并伴不适时建议留意，偶发波动多与运动、情绪或咖啡因有关。${liveHr != null ? liveTag : dailyTag}` }));
  // ★ 2026-11-14（用户拍板）：HRV 主动测量接回体检 —— 现场测得的优先，其次今日已同步日值。
  if (hrvVal != null) core.push(measured({ key: 'hrv', name: '心率变异性', value: String(Math.round(hrvVal)), unit: 'ms', status: 'ok', ref: '个体差异大，看趋势', note: `心率变异性反映恢复与自主神经状态，个体基线差异大、无公认统一区间，建议对照自己近几天的值看趋势。${liveHrv != null ? liveTag : dailyTag}` }));
  // ★ 2026-11-13（用户）：HRV 当场测不了 → 整项从体检报告移除，也不写固件限制说明。
  //   洞察页的 HRV 卡片仍展示戒指已同步的日值，两处口径互不干扰。
  if (spo2 != null) core.push(measured({ key: 'spo2', name: '血氧', value: String(Math.round(spo2)), unit: '%', status: sb('spo2', spo2), ref: '参考 95~100%', note: `血氧是血液氧气饱和度，正常约 95–100%；低于 95% 可能与呼吸、睡眠或佩戴松紧有关，持续偏低建议就医排查。${liveSpo2 != null ? liveTag : dailyTag}` }));
  if (temp != null) core.push(measured({ key: 'temp', name: '体温', value: String(r2(temp)), unit: '°C', status: 'ok', note: `体表温度受环境、活动与周期影响，单次略高/低多为正常波动；若伴发热感应结合体温计判断。${liveTemp != null ? liveTag : dailyTag}` }));
  if (bpSys != null && bpDia != null) {
    const st = sb('bpSys', bpSys) !== 'ok' || sb('bpDia', bpDia) !== 'ok'
      ? (sb('bpSys', bpSys) === 'high' || sb('bpDia', bpDia) === 'high' ? 'high' : 'low') : 'ok';
    core.push(measured({ key: 'bp', name: '血压', value: `${Math.round(bpSys)}/${Math.round(bpDia)}`, unit: 'mmHg', status: st, ref: '参考 <120/80 mmHg', scale: { min: 80, max: 160, v: Math.round(bpSys) }, note: `血压反映心血管负荷，理想约 <120/80；偏高常与高盐饮食、压力、睡眠不足相关，异常请以医用血压计确认。${liveBpSys != null ? liveTag : dailyTag}` }));
  }
  if (core.length) groups.push({ key: 'core', title: '核心体征', icon: '❤️', note: hasLiveReading
    ? '心率、血压、心率变异性与血氧为本次现场测量所得（以这次实际测到的为准），其余项目取今天已同步的读数；每项都标了来源。'
    : '以下为今天已同步的读数，本次没有现场读到新值。', metrics: core });

  // ── 活动与睡眠（实测）───────────────────────────────────────────────────
  const activity: QCMetric[] = [];
  if (steps != null) activity.push(measured({ key: 'steps', name: '今日步数', value: String(Math.round(steps)), unit: '步', status: sb('steps', steps), label: sb('steps', steps) === 'low' ? '偏少' : undefined, note: '步数反映日常活动量，一般建议每日 6000–8000 步以上以维持基础活动水平；偏少时可分两段各走 10 分钟补齐。' }));
  if (sleepMin != null) activity.push(measured({ key: 'sleep', name: '昨夜睡眠', value: `${Math.floor(sleepMin / 60)}小时${Math.round(sleepMin % 60)}分`, unit: '', status: sb('sleepMin', sleepMin), label: sb('sleepMin', sleepMin) === 'low' ? '偏短' : undefined, note: '昨夜睡眠时长反映恢复基础，成人建议 7–9 小时；偏短时恢复窗口偏紧，今晚可提前半小时上床。' }));
  if (calorie != null) activity.push(measured({ key: 'calorie', name: '运动消耗', value: String(Math.round(calorie)), unit: '千卡', status: 'ok', note: '运动消耗反映当日能量支出，结合饮食与休息有助于体重与体能管理。' }));
  if (activity.length) groups.push({ key: 'activity', title: '活动与睡眠', icon: '🌙', note: '以下为今天已同步的活动量与昨夜睡眠，不是这次现场测得的；它们一起参与今日状态与身心压力的推算。', metrics: activity });

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
            note: `基于近 14 天连续记录：自主神经活跃度约 ${String(peak.h).padStart(2, '0')}:00 最高、${String(trough.h).padStart(2, '0')}:00 最低，昼夜节律${lvlText}。规律作息有助于维持波动。`,
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
  // ★ 2026-11-14：男性用户的一键体检报告不产出「生理周期阶段 / 雌激素趋势 / 孕激素趋势」。
  const cycleOn = showCycleContent();
  const cycleLog = cycleOn ? await loadCycleLog() : null;
  const cycleInfo = computeCycle(cycleLog);
  if (cycleOn && cycleInfo.hasLog && cycleInfo.dayInCycle != null) {
    const hl = hormoneLevelsAtDay(cycleLog, cycleInfo.dayInCycle);
    rhythmItems.push(estimated({
      key: 'cyclePhase', name: '生理周期阶段', value: cycleInfo.phaseLabel, unit: '',
      status: 'ok', label: `周期第 ${cycleInfo.dayInCycle} 天`,
      note: `当前处在${cycleInfo.phaseLabel}、周期第 ${cycleInfo.dayInCycle} 天，激素水平正走在这一阶段对应的变化里，精力、体温和情绪会跟着起伏。把这段当背景看其它数据，安排强度和休息会更贴合身体。`,
    }));
    // ★ 2026-11-13（用户）：「这两项不该显示 22 呀、8 呀这种数据，只能给出『水平在上升 / 下降』的结论」。
    //   戒指根本不测激素浓度，之前把经期建模的 0–100 指数当成数值展示，属于伪精确。
    //   hormoneLevelsAtDay 已经算好 estrogenTrend / progesteroneTrend（与周期日历页同源），
    //   这里直接只给方向：没有趋势数据（null）→ 整项不展示，不用「--」占位。
    //   顺带统一命名：黄体酮 = 孕酮 = 孕激素（progesterone），不再用用户看不懂的「黄体酮」。
    const trendLabel = (t: 'up' | 'down' | 'flat' | null): string | null =>
      t === 'up' ? '水平在上升' : t === 'down' ? '水平在下降' : t === 'flat' ? '水平相对平稳' : null;
    const estDir = trendLabel(hl.estrogenTrend);
    if (estDir != null) {
      rhythmItems.push(estimated({
        key: 'estrogen', name: '雌激素趋势', value: estDir, unit: '',
        status: 'ok', label: estDir,
        // ★ 2026-11-13（用户）：与洞察页「生理周期节律」卡片底部那段同一种话术 ——
        //   只讲激素现在处于什么情况 + 由此带来的状态 + 一条具体建议；
        //   不写「由经期记录推算 / 与周期日历页同源 / 戒指不直接测量 / 浓度数值」等说明。
        note: hormoneBrief(cycleInfo.phase, 'estrogen'),
      }));
    }
    const progDir = trendLabel(hl.progesteroneTrend);
    if (progDir != null) {
      rhythmItems.push(estimated({
        key: 'progesterone', name: '孕激素趋势', value: progDir, unit: '',
        status: 'ok', label: progDir,
        note: hormoneBrief(cycleInfo.phase, 'progesterone'),
      }));
    }
  }

  // ★ 2026-11-13（用户：「没有数据就不要展示」）：数据不足时不再放一个空的「节律」占位组，
  //   报告里只出现真正算得出来的项，不用说明文字假装有一节内容。
  if (rhythmItems.length) {
    groups.push({
      key: 'rhythm', title: '节律', icon: '🌀',
      // ★ 2026-11-13（用户）：不在报告里解释「怎么推算的 / 戒指测不测」，
      //   分组说明只讲这一组看的是什么；依据分层由 basisNote 单独承担。
      note: cycleOn
        ? '这一组是最近一段时间的节律观察，看的是变化方向而不是单次数值：睡眠规律性看近几天入睡是否稳定；昼夜节律看一天里的起伏；压力恢复看放松回来的速度；生理周期看当前所处阶段；雌激素与孕激素描述的是激素当下的变化方向。无对应数据时该项不展示。'
        : '这一组是最近一段时间的节律观察，看的是变化方向而不是单次数值：睡眠规律性看近几天入睡是否稳定；昼夜节律看一天里的起伏；压力恢复看放松回来的速度。无对应数据时该项不展示。',
      metrics: rhythmItems,
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

/**
 * ★ 2026-11-14 一键体检现场测量时长口径（用户拍板「血压不出值就自动重试」）：
 *   心率独占 21s → 血压主动测量（第一次 ≤45s，没出值自动重试再 ≤45s）→
 *   HRV 主动测量（≤10s）→ 血氧实时流 10s → 组装报告。
 *   每段读数回流即提前进入下一段，不再死等固定总窗口；QUICK_CHECK_DURATION_MS
 *   变成「最坏情况硬上限」（21+90+10+10+组装 ≈ 2.5 分钟），仅供文案参考，不参与流程。
 * 两个体检入口（洞察页一键体检卡 / 体检记录页「再体检一次」）共用这套流程，口径不分叉。
 */
export const QUICK_CHECK_DURATION_MS = 150_000;

/** 原生 VeepooRingModule.startSingleHeartDetect() 写死的 20 秒 PPG 独占窗口。 */
const HR_DETECT_WINDOW_MS = 20_000;
/** BP 主动测量：第一轮等待上限（读数回流即提前结束；原生侧另有 90s 兜底 stop）。 */
const BP_DETECT_WAIT_MS = 45_000;
/** ★ 2026-11-14（用户：戴着很稳也不出值是啥意思）：第一轮没出值自动重试一轮（固件判定
 *   信号质量不够会中途放弃不回值，重测一次是这类 PPG 血压测量的正常策略）。 */
const BP_DETECT_RETRY_WAIT_MS = 45_000;
/** HRV 主动测量等待上限（本机固件 isSupportHrvAppDetect=false 会被秒拒，等满即过）。 */
const HRV_DETECT_WAIT_MS = 10_000;
/** 血氧实时流最短采集窗（流每秒回传，10s 足够攒出现场血氧读数）。 */
const SPO2_MIN_WINDOW_MS = 10_000;

/** 体检会话阶段（等待浮层文案按这个实时切换，不再按总时长均分猜测）。 */
export type QCSessionPhase = 'hr' | 'bp' | 'bp-retry' | 'hrv' | 'spo2' | 'assemble';

/**
 * 等待指定指标在体检窗口内出现新落库样本（healthStore 时间轴）。
 * 轮询间隔 2s；全命中返回 true，超时返回 false（调用方据此决定是否重试）。
 * 查库失败不中断（照常等满超时，按「没读到」处理）。
 */
async function waitForLiveSamples(keys: string[], since: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 2_000));
    try {
      const now = Date.now();
      const all = keys.every(
        (k) => healthStore.getTimeRange(k as any, since - 60_000, now, { maxPoints: 4 }).length > 0,
      );
      if (all) return true;
    } catch {
      // 查询失败继续等，不阻断体检
    }
  }
  return false;
}

/**
 * 跑一次完整的一键体检：心率独占测量 → 血压主动测量（失败自动重试一次）→ HRV 主动测量
 * → 血氧实时流 → 组装报告。每进入一个阶段回调 onPhase（等待浮层文案实时跟随）。
 *
 * ★ 顺序很关键（三处都有真机实证过的 bug）：
 *   ① hr 与 spo2 **绝不能同时下发**：本固件 PPG 通道一次只能跑一个检测，
 *      连着发会让 SDK 写队列只保留后者，heart_read_oprate 全程 0 次（2026-11-09 实锤）。
 *      必须先让心率独占 20s；BP/HRV 同理必须串行插队，进入前原生会先停血氧流。
 *   ② 组装必须放在所有测量段**之后**：旧写法把组装放进 Promise.all 里立即执行，
 *      读到的是点击瞬间（还没测）的空 state，现场读数永远进不了报告。
 *   ③ BP/HRV 主动测量结果经 onRealtime → healthStore + RingState（daily/lastUpdated/extDaily）
 *      全链路落库，洞察页与首页卡片和体检报告同源同步刷新（2026-11-14 用户要求）。
 * ★ 2026-11-14（用户：戴着很稳血压也不出值）：第一轮 ≤45s 没回值 → 自动 measure('bp')
 *   再测一轮 ≤45s（原生 startBpDetect 已改可重入：先停旧轮再发新轮）；两轮都没出值
 *   也照常往下走，报告里血压按「没读到」处理。BP 阶段结束无论成败都 stopMeasure('bp')
 *   显式归还 PPG，防止占道挡住后面的 HRV / 血氧。
 * ★ HRV 测量需固件 isSupportHrvAppDetect=true（与全天自动 HRV 是两个能力位）；
 *   原生侧不支持时只留日志、不产数，报告里该项自然不出现，不向用户解释固件限制。
 */
export async function runQuickCheckSession(
  opts?: { onPhase?: (phase: QCSessionPhase) => void },
): Promise<{ ok: boolean; record?: QuickCheckRecord; reason?: string }> {
  const startedAt = Date.now();
  const onPhase = opts?.onPhase ?? (() => {});
  const samplesInWindow = (keys: string[]): boolean => {
    try {
      const now = Date.now();
      return keys.every(
        (k) => healthStore.getTimeRange(k as any, startedAt - 60_000, now, { maxPoints: 4 }).length > 0,
      );
    } catch {
      return false;
    }
  };
  // ① 心率独占窗口（20s）
  onPhase('hr');
  try {
    RingBle.measure('hr');
  } catch {
    // 测量指令失败不阻断体检，仍按已同步的真实读数出报告
  }
  await new Promise<void>((r) => setTimeout(r, HR_DETECT_WINDOW_MS + 1_000));
  // ② 血压主动测量（PPG 空出后发起；读数回流即提前进入下一步）
  onPhase('bp');
  try {
    RingBle.measure('bp');
  } catch {
    // 同上，不阻断
  }
  await waitForLiveSamples(['bpSys', 'bpDia'], startedAt, BP_DETECT_WAIT_MS);
  if (!samplesInWindow(['bpSys', 'bpDia'])) {
    // ★ 2026-11-14（用户拍板）：第一轮没出值自动再测一次 —— 固件判信号质量不够会中途
    //   放弃不回值（progress 走到中段就停），重测是这类 PPG 血压测量的正常策略。
    onPhase('bp-retry');
    try {
      RingBle.measure('bp');
    } catch {
      // 不阻断
    }
    await waitForLiveSamples(['bpSys', 'bpDia'], startedAt, BP_DETECT_RETRY_WAIT_MS);
  }
  // 无论成败都显式归还 PPG 通道（出值时原生已自停，重复 stop 无害；没出值时防止占道）
  try {
    RingBle.stopMeasure('bp');
  } catch {
    // iOS 桥暂无此方法，静默
  }
  // ③ HRV 主动测量
  onPhase('hrv');
  try {
    RingBle.measure('hrv');
  } catch {
    // 同上，不阻断
  }
  await waitForLiveSamples(['hrv'], startedAt, HRV_DETECT_WAIT_MS);
  // ④ 血氧实时流（每秒回传，10s 足够攒出现场读数）
  onPhase('spo2');
  try {
    RingBle.measure('spo2');
  } catch {
    // 同上，不阻断
  }
  await new Promise<void>((r) => setTimeout(r, SPO2_MIN_WINDOW_MS));
  // ⑤ 等到现场数据都回流了，才组装报告
  onPhase('assemble');
  return assembleQuickCheckFromRealtime({ since: startedAt });
}
