/**
 * dailyStatus —— 「今日状态」恢复就绪度算法（Phase 1 实现）
 *
 * 设计原则（来自 docs/daily-status-algorithm-spec-v1.md）：
 *  1. 恢复就绪度单轴：今日状态只回答"今天恢复得怎么样"，运动负荷独立成轴，不扣分。
 *  2. 晨间锚点 ± 日间修正（Phase 1 仅晨间锚点，日间修正为 Phase 2）。
 *  3. 相位专属基线：所有带周期波动的指标（HRV/RHR/sleep）相对"用户自己同相位历史中位"评分，
 *     相位差异被基线完全吸收，无显式 phase_adjustment 项（彻底避免双重惩罚）。
 *  4. 不造假：只使用戒指真测或可严谨推导的量；SDK sleep_score 量纲不明 → 自算。
 *  5. 展示层归一化：内部 raw_readiness 经经验 CDF 映射为均匀 0–100 展示分（=你在自身历史的百分位），
 *     档位切点设在百分位 65/30/5 → 不足≈5%（稀有且严肃）。
 *
 * 本模块为纯 TS、零 react-native 依赖，可被 node 直接单测。
 */

import { computeCycle, type CycleInfo, type CyclePhase } from './cycleMath';

export type PhaseBucket = CyclePhase | 'unknown';

export interface DailyRecord {
  /** 'YYYY-M-D'（与 RingBleManager.dayKeyOf 对齐） */
  date: string;
  /** 晨间代表 HRV（ms），已滤伪迹；null = 当日未取到 */
  hrv: number | null;
  /** 夜间 min HR（bpm，RHR 近似）；null = 当日未取到 */
  rhr: number | null;
  /** 睡眠总时长（分钟） */
  sleepTotal: number | null;
  /** 深睡（分钟） */
  sleepDeep: number | null;
  /** REM（分钟） */
  sleepRem: number | null;
  /** 起夜次数 */
  getUp: number | null;
  /** 发烧标记：true 则永不计入基线窗口 */
  fever: boolean;
  /** 当日相位桶 */
  phase: PhaseBucket;
  /** 计算后回填的当日原始就绪度，用于百分位归一化 */
  rawReadiness: number | null;
}

export interface AlgoConst {
  ANCHOR: number;
  K_HRV: number;
  HRV_DOWN_GAIN: number; // 低于基线时的不对称放大
  K_RHR: number;
  W_HRV: number;
  W_RHR: number;
  W_SLEEP: number;
  TARGET_DURATION: number; // 分钟
  TARGET_DEEP_PCT: number;
  TARGET_GETUP: number;
  W_D: number;
  W_DEEP: number;
  W_G: number;
  HRV_ARTIFACT_MAX: number;
  HRV_ARTIFACT_MIN: number;
  LEVEL_TOP: number; // 充沛阈值（电量刻度 0–100 切点）
  LEVEL_MID: number; // 平稳阈值（电量刻度 0–100 切点）
  LEVEL_LOW: number; // 偏低阈值（电量刻度 0–100 切点）
  MIN_PHASE_SAMPLES: number;
  MIN_GLOBAL_SAMPLES: number;
  MIN_DAYS: number; // 百分位归一化成熟所需天数
}

/** Phase 1 标定初值（依据 spec §12 真实回放方向：提高下行灵敏度 + 顶部阈值上调 + 归一化层） */
export const ALGO_DEFAULTS: AlgoConst = {
  ANCHOR: 70,
  K_HRV: 120,
  HRV_DOWN_GAIN: 1.6,
  K_RHR: 100,
  W_HRV: 0.4,
  W_RHR: 0.25,
  W_SLEEP: 0.35,
  TARGET_DURATION: 450, // 7.5h
  TARGET_DEEP_PCT: 20,
  TARGET_GETUP: 1,
  W_D: 0.35,
  W_DEEP: 0.35,
  W_G: 0.3,
  HRV_ARTIFACT_MAX: 120,
  HRV_ARTIFACT_MIN: 15,
  LEVEL_TOP: 76,
  LEVEL_MID: 51,
  LEVEL_LOW: 26,
  MIN_PHASE_SAMPLES: 8,
  MIN_GLOBAL_SAMPLES: 8,
  MIN_DAYS: 30,
};

// ── 文献默认女性群体基线（按相位分桶的常量表，TBD-1）
// 冷启动（个人样本不足）时使用：取健康女性单群体中位 × 各相位典型偏移。
// 这些是占位文献常数值，正式上线前应替换为已发表的纵向研究数据。
type LitRow = { hrv: number; rhr: number; sleep: number };
const LIT: Record<PhaseBucket, LitRow> = {
  follicular: { hrv: 50, rhr: 58, sleep: 75 },
  ovulation: { hrv: 55, rhr: 56, sleep: 76 },
  luteal: { hrv: 45, rhr: 62, sleep: 72 }, // 整段黄体期取晚期偏保守值
  period: { hrv: 47, rhr: 60, sleep: 70 },
  unknown: { hrv: 50, rhr: 59, sleep: 74 },
};

export type MetricKeyAlg = 'hrv' | 'rhr' | 'sleep';

export interface LevelInfo {
  level: '充沛' | '平稳' | '偏低' | '不足';
  index: 0 | 1 | 2 | 3;
  advice: string;
}

export interface DailyStatusResult {
  /** 内部原始就绪度（未归一化，约 0–100，但分布可能偏窄） */
  rawReadiness: number | null;
  /** 归一化展示分（0–100，=自身历史百分位） */
  score: number | null;
  level: LevelInfo['level'] | null;
  levelIndex: LevelInfo['index'] | null;
  advice: string | null;
  phaseLabel: string;
  phaseBucket: PhaseBucket;
  dayInCycle: number | null;
  hasLog: boolean;
  /** 基线来源：phase=同相位个人 / global=全局个人 / lit=文献群体 */
  baselineSource: 'phase' | 'global' | 'lit';
  /** 是否具备计算所需的最低输入（HRV/RHR/睡眠至少其一） */
  hasData: boolean;
  /** 首页叙事文案（百分位语义） */
  narrative: string;
}

/** 某一时刻的「今日状态」快照（用于每 30 分钟一个结果的时间线） */
export interface StatusSnapshot extends DailyStatusResult {
  /** 快照时刻 epoch ms */
  t: number;
}

/** 判断两个时间戳是否同一天（本地时区） */
export function isSameDay(t: number, now: number): boolean {
  const a = new Date(t);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ─────────────────────────────────────────────────────────────────────────────
// 统计工具
// ─────────────────────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function median(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 中位数 + MAD 过滤（剔除 |x−median| > k×MAD），再取过滤后中位。HRV 偏态稳健。 */
function madMedian(values: number[], k = 3): number {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return NaN;
  const med = median(clean);
  const absdev = clean.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = absdev.length % 2 ? absdev[Math.floor(absdev.length / 2)] : (absdev[absdev.length / 2 - 1] + absdev[absdev.length / 2]) / 2;
  if (mad === 0) return med;
  const filtered = clean.filter((v) => Math.abs(v - med) <= k * 1.4826 * mad);
  return median(filtered.length ? filtered : clean);
}

// ─────────────────────────────────────────────────────────────────────────────
// 睡眠分自算（规避 SDK sleep_score 量纲未知风险）
// ─────────────────────────────────────────────────────────────────────────────

export interface SleepInput {
  sleepTotal: number | null;
  sleepDeep: number | null;
  getUp: number | null;
}

export function computeSleepScore(s: SleepInput, c: AlgoConst): number {
  if (!s.sleepTotal || s.sleepTotal <= 0) return 0;
  const durNorm = clamp(s.sleepTotal / c.TARGET_DURATION, 0, 1);
  const total = s.sleepTotal;
  const deepPct = ((s.sleepDeep ?? 0) / total) * 100;
  const deepNorm = clamp(deepPct / c.TARGET_DEEP_PCT, 0, 1);
  const getUpNorm = clamp(1 - (s.getUp ?? 0) / c.TARGET_GETUP, 0, 1);
  const v = 100 * (c.W_D * durNorm + c.W_DEEP * deepNorm + c.W_G * getUpNorm);
  return clamp(v, 0, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// 相位专属基线系统
// ─────────────────────────────────────────────────────────────────────────────

export class BaselineStore {
  private byPhase: Record<PhaseBucket, Record<MetricKeyAlg, number[]>>;
  private globalAll: Record<MetricKeyAlg, number[]>;
  private dayCount: number;

  constructor(history: DailyRecord[], private c: AlgoConst) {
    const phases: PhaseBucket[] = ['follicular', 'ovulation', 'luteal', 'period', 'unknown'];
    this.byPhase = {} as any;
    this.globalAll = { hrv: [], rhr: [], sleep: [] };
    for (const p of phases) {
      this.byPhase[p] = { hrv: [], rhr: [], sleep: [] };
    }
    // 发烧日永不计入基线（spec §9）
    for (const r of history) {
      if (r.fever) continue;
      const bucket = this.byPhase[r.phase] ?? this.byPhase.unknown;
      if (r.hrv != null) {
        bucket.hrv.push(r.hrv);
        this.globalAll.hrv.push(r.hrv);
      }
      if (r.rhr != null) {
        bucket.rhr.push(r.rhr);
        this.globalAll.rhr.push(r.rhr);
      }
      if (r.sleepTotal != null && r.sleepTotal > 0) {
        const sv = computeSleepScore(r, c);
        if (sv > 0) {
          bucket.sleep.push(sv);
          this.globalAll.sleep.push(sv);
        }
      }
    }
    this.dayCount = history.filter((r) => !r.fever).length;
  }

  /** 返回某指标在某相位的基线值 + 来源（同相位个人 → 全局个人 → 文献群体） */
  baselineFor(metric: MetricKeyAlg, phase: PhaseBucket): { value: number; source: 'phase' | 'global' | 'lit' } {
    const phaseArr = (this.byPhase[phase] ?? this.byPhase.unknown)[metric];
    const globalArr = this.globalAll[metric];
    if (phaseArr.length >= this.c.MIN_PHASE_SAMPLES && this.dayCount >= this.c.MIN_DAYS) {
      return { value: madMedian(phaseArr), source: 'phase' };
    }
    if (globalArr.length >= this.c.MIN_GLOBAL_SAMPLES) {
      return { value: madMedian(globalArr), source: 'global' };
    }
    const lit = LIT[phase] ?? LIT.unknown;
    return { value: metric === 'hrv' ? lit.hrv : metric === 'rhr' ? lit.rhr : lit.sleep, source: 'lit' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 单项评分
// ─────────────────────────────────────────────────────────────────────────────

function scoreHrv(hrv: number, base: number, c: AlgoConst): number {
  const ratio = hrv / base;
  const dev = ratio - 1;
  const gain = dev >= 0 ? 1 : c.HRV_DOWN_GAIN; // 低于基线不对称放大
  return clamp(c.ANCHOR + dev * c.K_HRV * gain, 0, 100);
}

function scoreRhr(rhr: number, base: number, c: AlgoConst): number {
  const ratio = rhr / base;
  // 静息比基线低 15%（ratio≈0.85）为最优区
  return clamp(c.ANCHOR - (ratio - 0.85) * c.K_RHR, 0, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// 归一化层（内部 raw → 均匀 0–100 展示分 = 自身历史百分位）
// ─────────────────────────────────────────────────────────────────────────────

function normalizeToScore(raw: number, historyRaw: number[], phase: PhaseBucket, c: AlgoConst): number {
  const valid = historyRaw.filter((v) => Number.isFinite(v));
  if (valid.length >= 10) {
    const below = valid.filter((v) => v <= raw).length;
    return clamp((below / valid.length) * 100, 0, 100);
  }
  // 冷启动：用文献参考作为分布中心，按 ±1sd ≈ ±45 百分位映射
  const litMed = LIT[phase] ? (LIT[phase].hrv + LIT[phase].rhr + LIT[phase].sleep) / 3 : 70;
  const pct = 50 + ((raw - litMed) / 18) * 45;
  return clamp(pct, 2, 98);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 级映射
// ─────────────────────────────────────────────────────────────────────────────

export function mapLevel(score: number, c: AlgoConst): LevelInfo {
  if (score >= c.LEVEL_TOP) {
    return { level: '充沛', index: 0, advice: '状态良好，可安排重要工作' };
  }
  if (score >= c.LEVEL_MID) {
    return { level: '平稳', index: 1, advice: '处于正常波动，按节奏推进' };
  }
  if (score >= c.LEVEL_LOW) {
    return { level: '偏低', index: 2, advice: '需要主动休息，建议轻活动' };
  }
  return { level: '不足', index: 3, advice: '今日恢复差，优先休息' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数：根据当日输入 + 历史 + 周期信息，产出今日状态
// ─────────────────────────────────────────────────────────────────────────────

export interface TodayInput {
  hrv: number | null;
  rhr: number | null;
  sleep: SleepInput;
}

export interface ComputeOpts {
  input: TodayInput;
  history: DailyRecord[];
  cycle: CycleInfo;
  consts?: AlgoConst;
}

export const PHASE_LABEL: Record<PhaseBucket, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
  unknown: '未记录',
};

export function computeDailyStatus(opts: ComputeOpts): DailyStatusResult {
  const c = opts.consts ?? ALGO_DEFAULTS;
  const { input, history, cycle } = opts;
  const phase = cycle.phase as PhaseBucket;

  const hasData = input.hrv != null || input.rhr != null || (input.sleep.sleepTotal ?? 0) > 0;
  if (!hasData) {
    return {
      rawReadiness: null,
      score: null,
      level: null,
      levelIndex: null,
      advice: null,
      phaseLabel: PHASE_LABEL[phase],
      phaseBucket: phase,
      dayInCycle: cycle.dayInCycle,
      hasLog: cycle.hasLog,
      baselineSource: 'lit',
      hasData: false,
      narrative: cycle.hasLog ? '今日佩戴数据不足，暂无法评估恢复状态' : '记录经期并连续佩戴几天后，开启今日状态评估',
    };
  }

  const store = new BaselineStore(history, c);

  const parts: { w: number; v: number }[] = [];
  let baselineSource: 'phase' | 'global' | 'lit' = 'lit';

  if (input.hrv != null) {
    const b = store.baselineFor('hrv', phase);
    baselineSource = b.source;
    parts.push({ w: c.W_HRV, v: scoreHrv(input.hrv, b.value, c) });
  }
  if (input.rhr != null) {
    const b = store.baselineFor('rhr', phase);
    if (b.source === 'lit' && baselineSource !== 'phase' && baselineSource !== 'global') baselineSource = 'lit';
    else if (b.source === 'global' && baselineSource === 'lit') baselineSource = 'global';
    else if (b.source === 'phase') baselineSource = 'phase';
    parts.push({ w: c.W_RHR, v: scoreRhr(input.rhr, b.value, c) });
  }
  if ((input.sleep.sleepTotal ?? 0) > 0) {
    const b = store.baselineFor('sleep', phase);
    if (b.source === 'phase') baselineSource = 'phase';
    else if (b.source === 'global' && baselineSource === 'lit') baselineSource = 'global';
    const sv = computeSleepScore(input.sleep, c);
    parts.push({ w: c.W_SLEEP, v: sv });
  }

  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const rawReadiness = wsum > 0 ? parts.reduce((a, p) => a + p.w * p.v, 0) / wsum : 0;

  // 历史 rawReadiness（用于百分位归一化）
  const historyRaw = history
    .filter((r) => !r.fever && r.rawReadiness != null)
    .map((r) => r.rawReadiness as number);

  const score = normalizeToScore(rawReadiness, historyRaw, phase, c);
  const lvl = mapLevel(score, c);

  // 叙事：与过去同期的自己比（百分位语义）
  let narrative: string;
  const phaseText = cycle.hasLog ? `你目前处于${PHASE_LABEL[phase]}（周期第 ${cycle.dayInCycle} 天）` : '你目前尚未记录经期';
  if (baselineSource === 'lit') {
    narrative = `${phaseText}，今日状态基于群体基线估算`;
  } else {
    narrative = `${phaseText}，今日恢复水平优于过去约 ${Math.round(score)}% 的日子`;
  }

  return {
    rawReadiness,
    score,
    level: lvl.level,
    levelIndex: lvl.index,
    advice: lvl.advice,
    phaseLabel: PHASE_LABEL[phase],
    phaseBucket: phase,
    dayInCycle: cycle.dayInCycle,
    hasLog: cycle.hasLog,
    baselineSource,
    hasData: true,
    narrative,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// v2 累积能量模型（今日状态曲线）
//
// 取代 v1「每日总分」：输出每 30 分钟一个 0–100 电量，形成连续曲线
// （类似 Garmin Body Battery / WHOOP）。S0 晨间算一次锁死，之后每窗口累积 ΔE。
// 设计详见 docs/daily-status-curve-spec.md
// ═══════════════════════════════════════════════════════════════════════════

export interface CurveConst extends AlgoConst {
  /** 持平基线时电量（S0 锚点） */
  BASE_CHARGE: number;
  /** S0 三项权重（HRV / RHR / 睡眠） */
  W_S0_H: number; W_S0_R: number; W_S0_S: number;
  /** 睡眠分参考值（持平锚点） */
  SLEEP_REF: number;
  /** 恢复增益 */
  K_REC_HRV: number; K_REC_REST: number; REC_CAP: number;
  /** 消耗系数 */
  K_DR_HR: number; K_DR_STEP: number; K_DR_EDA: number; K_DR_STRESS: number; DRN_CAP: number;
  /** 睡眠 / 小睡强充电 */
  RECHARGE_SLEEP: number; RECHARGE_NAP: number;
  /** 稳态回拉（equilibrium 随语境变化） */
  EQ_REST: number; EQ_ACTIVE: number; EQ_STRESS: number; K_HOME: number;
  /** HRV 偏移校正 */
  HRV_OFFSET_GAIN: number; HRV_OFFSET_CAP: number;
  /** 佩戴中断阈值（>2h 触发软重置） */
  WEAR_GAP_MS: number;
  /** EDA 应激阈值与满量程（用于 lowStress / stressProxy） */
  EDA_STRESS_THRESH: number; EDA_FULL: number;
  /** 每窗口步数期望（中等活动） */
  STEP_BASELINE: number;
}

export const CURVE_DEFAULTS: CurveConst = {
  ...ALGO_DEFAULTS,
  BASE_CHARGE: 60,
  W_S0_H: 0.4, W_S0_R: 0.25, W_S0_S: 0.35,
  SLEEP_REF: 72,
  // 速率常数（初值已按目标弧线原则标定：醒~70/忙时≥45/晚休~62/睡眠充电；待 collector.log 回放精修）
  K_REC_HRV: 6, K_REC_REST: 3.5, REC_CAP: 6,
  K_DR_HR: 4, K_DR_STEP: 2.5, K_DR_EDA: 0.8, K_DR_STRESS: 1.5, DRN_CAP: 4,
  RECHARGE_SLEEP: 4, RECHARGE_NAP: 2,
  EQ_REST: 95, EQ_ACTIVE: 70, EQ_STRESS: 72, K_HOME: 0.05,
  HRV_OFFSET_GAIN: 4, HRV_OFFSET_CAP: 3,
  WEAR_GAP_MS: 2 * 60 * 60 * 1000,
  EDA_STRESS_THRESH: 3, EDA_FULL: 8,
  STEP_BASELINE: 600,
};

export interface SeedResult {
  /** 绝对电量 0–100（null = 无数据） */
  value: number | null;
  /** 个人 wake-norm（同相位 S0 的近期中心）；冷启动 null */
  wakeNorm: number | null;
  /** S0 − wakeNorm（睡眠恢复好/不好读数） */
  recoveryDelta: number | null;
  recoveryLabel: '优于平时' | '差于平时' | '持平' | '校准中';
  rawReadiness: number | null;
  phaseBucket: PhaseBucket;
}

export interface DaytimeBaseline {
  hrRest: number;
  hrvExpected: number;
  stepBaseline: number;
}

export interface WindowSignals {
  /** 窗口内 HR 均值（必填主驱动） */
  hrMean: number | null;
  /** 窗口内步数增量 */
  stepsDelta: number | null;
  /** 窗口内 EDA 波峰 / SCR 事件数 */
  edaEvents: number | null;
  /** 窗口内 HRV（最新或均值） */
  hrv: number | null;
  /** 睡眠态（强充电） */
  asleep: boolean;
  /** 小睡态（轻度充电） */
  isNap: boolean;
}

export interface WindowResult {
  next: number;
  recovery: number;
  drain: number;
  homeo: number;
  equilibrium: number;
  isRecovering: boolean;
}

/** 日间基线（Phase 1 简化：夜间基线近似日间静息 + 文献步数期望） */
export function deriveDaytimeBaseline(history: DailyRecord[], phase: PhaseBucket, c: CurveConst): DaytimeBaseline {
  const store = new BaselineStore(history, c);
  return {
    hrRest: store.baselineFor('rhr', phase).value,
    hrvExpected: store.baselineFor('hrv', phase).value,
    stepBaseline: c.STEP_BASELINE,
  };
}

/**
 * 晨间种子 S0：夜间 HRV/RHR/睡眠 → 同相位基线 → 绝对电量。
 * 仅在醒后第一个窗口算一次（调用方负责锁死 + 持久化）。
 * wakeNorm 用历史 rawReadiness 的近期中心作代理（S0 ≈ rawReadiness − ANCHOR + BASE_CHARGE）。
 */
export function computeSeed(opts: ComputeOpts, consts?: CurveConst): SeedResult {
  const c = consts ?? CURVE_DEFAULTS;
  const { input, history, cycle } = opts;
  const phase = cycle.phase as PhaseBucket;
  const store = new BaselineStore(history, c);

  let subH: number | null = null, subR: number | null = null, subS: number | null = null;
  if (input.hrv != null) { const b = store.baselineFor('hrv', phase); subH = scoreHrv(input.hrv, b.value, c); }
  if (input.rhr != null) { const b = store.baselineFor('rhr', phase); subR = scoreRhr(input.rhr, b.value, c); }
  if ((input.sleep.sleepTotal ?? 0) > 0) { subS = computeSleepScore(input.sleep, c); }

  const subs = [subH, subR, subS].filter((x) => x != null);
  if (subs.length === 0) {
    return { value: null, wakeNorm: null, recoveryDelta: null, recoveryLabel: '校准中', rawReadiness: null, phaseBucket: phase };
  }
  const wH = subH != null ? c.W_S0_H : 0;
  const wR = subR != null ? c.W_S0_R : 0;
  const wS = subS != null ? c.W_S0_S : 0;
  const wsum = wH + wR + wS;
  const avg = (wH * (subH ?? 0) + wR * (subR ?? 0) + wS * (subS ?? 0)) / wsum;
  const value = clamp(avg - c.ANCHOR + c.BASE_CHARGE, 0, 100);

  // wakeNorm：历史 S0 代理
  const histRaw = history
    .filter((r) => !r.fever && r.phase === phase && r.rawReadiness != null)
    .map((r) => r.rawReadiness as number);
  let wakeNorm: number | null = null;
  if (histRaw.length >= c.MIN_DAYS) {
    wakeNorm = median(histRaw) - c.ANCHOR + c.BASE_CHARGE;
  }
  let recoveryDelta: number | null = null;
  let recoveryLabel: SeedResult['recoveryLabel'] = '校准中';
  if (wakeNorm != null) {
    recoveryDelta = value - wakeNorm;
    const X = 5;
    recoveryLabel = recoveryDelta > X ? '优于平时' : recoveryDelta < -X ? '差于平时' : '持平';
  }
  return { value, wakeNorm, recoveryDelta, recoveryLabel, rawReadiness: avg, phaseBucket: phase };
}

/**
 * 单个 30 分钟窗口的累积：S(t) = clamp(S(t-1) + 恢复 − 消耗 + 稳态回拉, 0, 100)。
 * - 睡眠态 → 强充电；小睡态 → 轻度充电；
 * - 清醒态：仅当 isRecovering（低活动+低应激+HRV 不差）才给恢复增益；
 * - equilibrium 随 isRecovering 闸门变化（放松久坐→95，活跃→70，焦虑久坐→70 或更低），
 *   避免"久坐焦虑"被稳态回拉错误拉高（spec §5.5）。
 */
export function accumulateWindow(prev: number, sig: WindowSignals, dt: DaytimeBaseline, c: CurveConst): WindowResult {
  const hrMean = sig.hrMean;
  const hrRest = dt.hrRest || 60;
  const hrvExpected = dt.hrvExpected || 50;
  const hrElev = hrMean != null ? clamp((hrMean - hrRest) / hrRest, 0, 1) : 0;
  const hrvRatio = sig.hrv != null ? sig.hrv / hrvExpected : 1;
  const steps = sig.stepsDelta ?? 0;
  const eda = sig.edaEvents ?? 0;
  const lowStress = eda <= c.EDA_STRESS_THRESH && (sig.hrv == null || hrvRatio > 0.9);

  const isRecovering = isRecoveringNow(sig, dt, c);

  let recovery = 0;
  let drain = 0;

  if (sig.asleep) {
    recovery = c.RECHARGE_SLEEP;
  } else if (sig.isNap) {
    recovery = c.RECHARGE_NAP;
  } else if (isRecovering) {
    recovery = c.K_REC_HRV * Math.max(0, hrvRatio - 1) + c.K_REC_REST * (1 - hrElev) * (lowStress ? 1 : 0.4);
    // 恢复语境下仍可能有轻微消耗（如短暂起身），但整体以恢复为主
    drain = c.K_DR_HR * hrElev + c.K_DR_STEP * clamp(steps / dt.stepBaseline, 0, 1.5);
  } else {
    const stepIntensity = clamp(steps / dt.stepBaseline, 0, 1.5);
    const stressProxy = clamp(eda / c.EDA_FULL, 0, 1);
    drain = c.K_DR_HR * hrElev + c.K_DR_STEP * stepIntensity + c.K_DR_EDA * eda + c.K_DR_STRESS * stressProxy;
    // HRV 偏移校正（低于期望额外消耗）
    const hrvOffset = sig.hrv != null ? Math.max(0, (hrvExpected - sig.hrv) / hrvExpected) : 0;
    drain += Math.min(hrvOffset * c.HRV_OFFSET_GAIN, c.HRV_OFFSET_CAP);
  }

  recovery = Math.min(recovery, c.REC_CAP);
  drain = Math.min(drain, c.DRN_CAP);

  const active = hrElev > 0.1 || steps > dt.stepBaseline * 0.3;
  const equilibrium = sig.asleep || sig.isNap || isRecovering
    ? c.EQ_REST
    : active ? c.EQ_ACTIVE : c.EQ_STRESS;
  const homeo = (equilibrium - prev) * c.K_HOME;

  const next = clamp(prev + recovery - drain + homeo, 0, 100);
  return { next, recovery, drain, homeo, equilibrium, isRecovering };
}

/** 恢复状态硬判定（spec §5.2 / §5.5）：低活动 + 低应激 + HRV 不差。累积与"佩戴中断软重置"共用，
 *  避免"久坐焦虑（高 EDA/低 HRV）"被稳态回拉错误拉高。 */
export function isRecoveringNow(sig: WindowSignals, dt: DaytimeBaseline, c: CurveConst): boolean {
  const hrMean = sig.hrMean;
  const hrRest = dt.hrRest || 60;
  const hrvExpected = dt.hrvExpected || 50;
  const hrvRatio = sig.hrv != null ? sig.hrv / hrvExpected : 1;
  const steps = sig.stepsDelta ?? 0;
  const eda = sig.edaEvents ?? 0;
  return (
    hrMean != null &&
    hrMean < hrRest * 0.95 &&
    steps < 5 &&
    eda <= c.EDA_STRESS_THRESH &&
    (sig.hrv == null || hrvRatio > 0.9)
  );
}

/** 今日状态曲线单点（每 30 分钟一个结果） */
export interface CurvePoint {
  /** 快照时刻 epoch ms */
  t: number;
  /** 当前电量 0–100（S(t)） */
  value: number;
  /** 该点档位文字（充沛/平稳/偏低/不足） */
  level: string;
}

/** 首页「今日状态」头条（曲线模型展示聚合） */
export interface CurveStatus {
  /** 当前最新电量 S(t_now)（null = 无数据） */
  value: number | null;
  /** 当前档位 */
  level: string | null;
  /** 相位文字（如「黄体期」） */
  phaseLabel: string;
  /** 周期第几天（null = 未记录） */
  dayInCycle: number | null;
  /** 是否已记录经期（决定对比文案） */
  hasLog: boolean;
  /** 晨间种子 S0 + 睡眠恢复读数 */
  seed: SeedResult | null;
  /** 首页叙事文案 */
  narrative: string;
  /** 是否具备计算所需最低输入 */
  hasData: boolean;
}

/** 电量 → 四档（直接套 0–100 电量尺；切点 65/30/5 与 spec §8 一致） */
export function curveLevel(value: number, c: CurveConst): LevelInfo {
  if (value >= c.LEVEL_TOP) return { level: '充沛', index: 0, advice: '状态良好，可安排重要工作' };
  if (value >= c.LEVEL_MID) return { level: '平稳', index: 1, advice: '处于正常波动，按节奏推进' };
  if (value >= c.LEVEL_LOW) return { level: '偏低', index: 2, advice: '需要主动休息，建议轻活动' };
  return { level: '不足', index: 3, advice: '今日恢复差，优先休息' };
}

