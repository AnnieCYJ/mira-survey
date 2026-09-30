/**
 * Cognitive Load & Fatigue Detection — 规则融合 (Rule-Based Fusion)
 * ------------------------------------------------------------------
 * 参考:
 *   - Wellby (IEEE Trans Affective Computing 2026)  轻量化 wearable PPG 管道
 *     只用时域 HRV + 基线问卷 → AUC-ROC 91.6% for stress, 85.84% for fatigue
 *   - CogWatch (HardwareX 2024)  开源认知负荷平台
 *     传感器权重: GSR 35-40% / HRV 30-35% / SkinTemp 15-20% / IMU 10-15%
 *   - ChatPPG 2026 review       HF 功率 & LF/HF 比对认知负荷最敏感
 *
 * 生理原理:
 *   - 认知负荷↑ → HRV↓ (RMSSD↓, 迷走抑制)
 *   - 认知负荷↑ → 血管收缩 → VTI (ppgSys-ppgDia) ↑
 *   - 疲劳积累 → 外周血流↓ → Skin Temp↑
 *   - 情绪激活伴随 → EDA↑ + sns↑ (区分"紧张" vs "专注")
 *
 * 与 stressAlgorithm 的区别:
 *   stress 测 arousal (交感激活程度), cognitiveLoad 测 mental effort (脑力投入程度)
 *   两者相关但不等价: 心流时 高负荷+低压力, 被吓一跳时 低负荷+高压力
 */
import { healthStore, dayStartMs, type MetricKey } from '../data/healthStore';
import { parseClockMinutes } from './sleepTime';
import { getEntriesForDay, ensureEmotionLogLoaded } from '../data/emotionLog';
import { detectCognitiveLoad, applyLoadCorrection, CognitiveLoadEvent } from './cognitiveLoadDetector';
import { analyzeCortisol } from './cortisolRhythm';
import type { CortisolRhythmResult } from './cortisolRhythm';

/** 归因为「情绪事件」的自报情绪档（沉色系高唤醒/低落; tired 归恢复不归情绪事件） */
const EMOTION_EVENT_MOODS = new Set<string>(['stressed', 'anxious', 'sad', 'angry', 'lonely']);
/** 半小时步数增量 ≥ 此值 → 归因为运动窗口（约 ≥500 步/小时的活动强度） */
const EXERCISE_STEP_DELTA = 250;

export type LoadLevel = 'rested' | 'light' | 'moderate' | 'heavy';
export type FatigueLevel = 'fresh' | 'mild' | 'moderate' | 'severe';

export interface CognitiveLoadReport {
  /** 认知负荷分 0-100 (今日均值, 仅基于有数据的小时) */
  loadScore: number;
  loadLevel: LoadLevel;
  loadReason: string;
  /** 疲劳指数 0-100 (积累量, 高负荷时段占比 × 恢复延迟惩罚) */
  fatigueIndex: number;
  fatigueLevel: FatigueLevel;
  fatigueReason: string;
  /** 全天逐小时负荷分 (0-23), hasData=false 表示该小时无 HRV/SNS 数据 (score=0 仅占位) */
  hourly: { hour: number; score: number; hasData: boolean }[];
  /** 全天平均疲劳度 0-100 (仅基于有数据的小时, 与柱状图同源; 卡片大数字与柱子保持一致) */
  avgFatigue: number | null;
  /** 恢复能力 (全天 RMSSD 基线 vs 近期最低窗口) */
  recoveryCapacity: number | null;
  /** 活跃时段高负荷占比 */
  highLoadRatio: number;
  /** 认知负荷最高时段 (连续小时合并) */
  peakLoadSpan: { startHour: number; endHour: number; avgScore: number } | null;
  /** 认知能力最强时段: 白天 + 连续低负荷 */
  bestSpan: { startHour: number; endHour: number; avgScore: number } | null;
  /** 睡眠窗口 (用于 UI 过滤柱状图) */
  sleepWindow: { bedHour: number; wakeHour: number } | null;
  /** 信号覆盖天数 (用于 UI 空状态) */
  sampleCount: number;
  /** 今日基线值 (用于 UI 显示) */
  baselines: {
    hrv: number | null;
    vti: number | null;
    sns: number | null;
    temp: number | null;
  };
  // ★ v2 脑力指标 (开源算法融合):
  /** 脑力值 0-100 (Mental Energy, WHOOP-like, 储备可用脑力) */
  mentalEnergy: number | null;
  /** 当下专注力 0-100 (Focus, RMSSD + 唤醒度 + 节律) */
  focusScore: number | null;
  /** 当下决策力 0-100 (Decision-Making, 前额叶调控 + 节律 + 睡眠) */
  decisionScore: number | null;
  /** 今日剩余时段脑力预测峰谷: peak = 脑力最佳时刻, trough = 脑力最低时刻 */
  forecast: {
    peak: { hour: number; energy: number; confidence?: number } | null;
    trough: { hour: number; energy: number; confidence?: number } | null;
    /** 认知高峰区间 (±1.5h) */
    peakSpan?: { startHour: number; endHour: number } | null;
    /** 认知低谷区间 (±1.5h) */
    troughSpan?: { startHour: number; endHour: number } | null;
    hourlyEnergy: { hour: number; energy: number }[];
    /** 节律拟合 R² — 个体化程度 */
    rhythmR2?: number;
  };
  /** 睡眠恢复因子 (v2 核心, 0-1) */
  sleepRecovery: number;
  /** 7 天睡眠债 (小时) */
  sleepDebt: number;
  /** 节律峰值时刻 (cosinor acrophaseH) */
  circadianPeakH?: number;
  /** 节律状态 */
  rhythmStatus?: 'normal' | 'sustained_high' | 'dysregulated';
  /** 第二步: 实时负荷检测事件 */
  loadEvent?: import('./cognitiveLoadDetector').CognitiveLoadEvent;
  // ── 脑力账户（Borbély 双过程，给用户看的直白数）──
  //   一条账讲完：早上的储备 = 早起认知准备度；白天清醒+费脑持续扣款；
  //   剩余 = 储备 − 已用；疲劳度 = 100 − 剩余（与逐时柱状图同一条能量线）。
  /** 早上的脑力储备 = 早起认知准备度 (0-100) */
  brainReserve: number;
  /** 今日已消耗脑力 (储备 − 剩余, 0-100) */
  brainUsed: number;
  /** 当前节律能量位置 (0-100, Process C 参考值, 不参与余额计算) */
  circadianEnergy: number;
  /** 当前脑力余额 (0-100, = 100 − 当前疲劳度) */
  brainRemaining: number;
  /** 今日被剔除的非认知消耗分钟数（只算脑：情绪事件 / 运动窗口的唤醒偏离不计入脑力消耗） */
  brainExcluded: { emotion: number; exercise: number };
}

const DAYS_BACK = 7;

// ★ 统一用 healthStore.dayKey 补零格式
import { dayKey as _dayKey } from '../data/healthStore';
function todayKey(nowMs: number): string { return _dayKey(nowMs); }
function dayKey(offset: number, nowMs: number): string {
  const d = new Date(nowMs);
  d.setDate(d.getDate() + offset);
  return _dayKey(d.getTime());
}

function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 计算一个 key 的多日基线 (排除今天) */
function baselineOf(key: MetricKey, nowMs: number): number | null {
  const vals: number[] = [];
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = healthStore.getDay(key, dayKey(-i, nowMs));
    if (d?.mean != null && d.samples >= 5) vals.push(d.mean);
  }
  return mean(vals);
}

/** VTI 从 ppgSys/ppgDia 派生 */
function vtiFrom(nowMs: number): { now: number | null; baseline: number | null } {
  const today = todayKey(nowMs);
  const ppgT = healthStore.getDay('ppgSys', today)?.mean ?? null;
  const ppgD = healthStore.getDay('ppgDia', today)?.mean ?? null;
  const now = (ppgT != null && ppgD != null && ppgT > ppgD + 5) ? ppgT - ppgD : null;

  const vals: number[] = [];
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = dayKey(-i, nowMs);
    const s = healthStore.getDay('ppgSys', d)?.mean ?? null;
    const dia = healthStore.getDay('ppgDia', d)?.mean ?? null;
    if (s != null && dia != null && s > dia + 5) vals.push(s - dia);
  }
  return { now, baseline: mean(vals) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}


// ══════════════════════════════════════════════════════════════════════
// ★ v2 脑力指标算法 — 融合 NeuroPlay 2024 / WHOOP / 学术开源公式
// ══════════════════════════════════════════════════════════════════════

/**
 * 皮质醇日内节律曲线 (ICFMR 2023 元分析)
 * 标准化窗口: 峰在 8am (~0.95), 谷在 3pm (~0.55), 午夜 ~0.60
 * 返回 0-1 权重, 高 = 认知表现好
 */
function circadianWeight(hour: number): number {
  // 用两个正弦波叠加模拟晨起峰 + 午后反弹
  // 主成分: 24h 周期, 峰在 8am, 振幅 0.35
  // 次成分: 12h 周期, 给午后一个小反弹 (4pm)
  const main = 0.65 + 0.35 * Math.sin(2 * Math.PI * (hour - 5) / 24);
  const afternoon_bump = 0.08 * Math.sin(2 * Math.PI * (hour - 14) / 12);
  return clamp(main + afternoon_bump, 0.3, 1.0);
}

/**
 * 脑力值 (Mental Energy) — WHOOP Mental Readiness 同款算法
 * 权重参考 NeuroPlay 2024 (RMSSD → cognitive reserve r=0.71), Borbély Process S, circadian
 *
 * energy = 0.35 * HRV_ratio + 0.30 * sleepRecovery + 0.25 * circadian + 0.10 * (1 - load/100)
 */
/**
 * mentalEnergy v2 — 节律+睡眠 85% / HRV 辅助 15%
 * 能量 = 节律峰值 × 睡眠恢复 × 债惩罚 × HRV 辅助
 */
function computeMentalEnergy(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  sleepRecoveryFactor: number;
  circadianHour: number;
  cumulativeLoad: number;
}): number | null {
  const circ = circadianWeight(params.circadianHour);
  // 节律+睡眠主导
  const term =
    0.40 * params.sleepRecoveryFactor +
    0.35 * circ +
    0.15 * (1 - params.cumulativeLoad / 100) +
    0.10 * (params.hrvNow != null && params.hrvBaseline != null && params.hrvBaseline > 0
      ? clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6) : 0.7);
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 当下专注力 (Focus) — Task 2023 RMSSD→attention r=0.61 + eSports SCR_phasic/RMSSD
 * Yerkes-Dodson: 唤醒度钟形曲线, 最优 SNS_ratio ∈ [0.9, 1.3]
 *
 * focus = 0.45 * RMSSD_ratio + 0.30 * arousal_optimal + 0.15 * circadian_focus + 0.10 * (1-fatigue/100)
 */
/**
 * focus v2 — 节律窗口 40% / Yerkes-Dodson 唤醒度 30% / 疲劳/睡眠 20% / HRV 辅助 10%
 * （Yerkes-Dodson 是心理物理定律，保留较高权重）
 */
function computeFocus(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  snsNow: number | null; snsBaseline: number | null;
  circadianHour: number;
  fatigueIndex: number;
}): number | null {
  // 唤醒度最优区间 (Yerkes-Dodson): SNS/Baseline ∈ [0.85, 1.25] = 满分
  let arousalOptimal = 0.5;
  if (params.snsNow != null && params.snsBaseline != null && params.snsBaseline > 0) {
    const snsRatio = params.snsNow / params.snsBaseline;
    if (snsRatio >= 0.85 && snsRatio <= 1.25) arousalOptimal = 1.0;
    else if (snsRatio >= 0.6 && snsRatio <= 1.5) arousalOptimal = 0.7;
    else arousalOptimal = 0.3;
  }
  // 专注黄金窗口: 9-11am / 2-4pm (节律驱动)
  const h = params.circadianHour;
  let circFocus = 0.5;
  if (h >= 9 && h <= 11) circFocus = 1.0;
  else if (h >= 14 && h <= 16) circFocus = 0.85;
  else if (h >= 8 && h <= 18) circFocus = 0.6;
  else circFocus = 0.3;

  const hrvAux = (params.hrvNow != null && params.hrvBaseline != null && params.hrvBaseline > 0)
    ? clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6) : 0.7;

  const term =
    0.40 * circFocus +
    0.30 * arousalOptimal +
    0.20 * (1 - params.fatigueIndex / 100) +
    0.10 * hrvAux;
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 当下决策力 (Decision-Making) — Executive Function & HRV 综述 r=0.61
 * 前额叶调控 → RMSSD, 晨间决策最佳 (JBDM 2023), 睡眠债 → 决策质量 ↓25%
 *
 * decision = 0.40 * RMSSD_ratio + 0.30 * circadian_decision + 0.20 * sleep_recovery + 0.10 * (1-load/100)
 */
/**
 * decision v2 — 节律窗口 40% / 睡眠恢复 35% / 负荷 15% / HRV 辅助 10%
 */
function computeDecision(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  circadianHour: number;
  sleepRecoveryFactor: number;
  loadScore: number;
}): number | null {
  const h = params.circadianHour;
  let circDec = 0.5;
  if (h >= 8 && h <= 11) circDec = 1.0;
  else if (h >= 12 && h <= 14) circDec = 0.75;
  else if (h >= 15 && h <= 17) circDec = 0.6;
  else if (h >= 18 && h <= 20) circDec = 0.4;
  else circDec = 0.25;

  const hrvAux = (params.hrvNow != null && params.hrvBaseline != null && params.hrvBaseline > 0)
    ? clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6) : 0.7;

  const term =
    0.40 * circDec +
    0.35 * params.sleepRecoveryFactor +
    0.15 * (1 - params.loadScore / 100) +
    0.10 * hrvAux;
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 早起认知准备度 — 脑力账户的「早上储备」
 *   70% 睡眠恢复基础分（睡得好不好 − 睡眠债扣分）
 * + 30% 节律相位分（起床时间落在个体化节律的什么位置）
 * 与 EnergyDetailScreen「早起认知准备度」是同一个数（该 UI 已改读本报告字段）。
 */
export function computeMorningReadiness(p: {
  rec: number;          // sleepRecovery 0-1
  debt: number;         // 7 天睡眠债（小时）
  peakH: number;        // 个体化皮质醇峰值时刻（小时，默认 8）
  wakeH: number | null; // 起床时间（小时，浮点）
}): number {
  const circAdj = p.wakeH != null
    ? clamp(50 + 50 * Math.sin(2 * Math.PI * (p.wakeH - p.peakH + 6) / 24), 0, 100) / 100
    : 0.5;
  return Math.round(clamp(clamp(p.rec * 80 + 20 - p.debt * 8, 0, 100) * 0.7 + circAdj * 100 * 0.3, 0, 100));
}

/**
 * 今日剩余时段脑力预测 — 过去 7 天同小时中位数 + 今天已测走势 + circadian 修正
 * 参考: WHOOP Daily Outlook, AstroGuard (NASA) LOESS 思想
 */
/**
 * computeForecast — v2 节律+睡眠驱动 (2026-09-21)
 *
 * 科学依据:
 *   - Cosinor 拟合皮质醇代理值 → 个体化 acrophaseH (峰值时刻)
 *   - Borbély Process S → 睡眠恢复因子修正节律振幅
 *   - 睡眠窗 → 个体作息相位 (早睡/晚起整体偏移节律)
 */
function computeForecast(
  hourly: { hour: number; score: number }[],
  cortisolResult: CortisolRhythmResult | null,
  sleepRecoveryFactor: number,
  sleepWindow: { bedHour: number; wakeHour: number } | null,
  circadianHour: number,
): {
  peak: { hour: number; energy: number; confidence?: number } | null;
  trough: { hour: number; energy: number; confidence?: number } | null;
  peakSpan: { startHour: number; endHour: number } | null;
  troughSpan: { startHour: number; endHour: number } | null;
  hourlyEnergy: { hour: number; energy: number }[];
} {
  const hourlyEnergy: { hour: number; energy: number }[] = [];
  let cosinorPeakH: number | null = null;
  let r2 = 0;

  if (cortisolResult?.cosinor && Number.isFinite(cortisolResult.cosinor.acrophaseH)) {
    cosinorPeakH = cortisolResult.cosinor.acrophaseH;
    r2 = cortisolResult.cosinor.r2;
  }

  // 睡眠相位修正 — 起床时间偏离 8:00 的小时数
  let phaseShift = 0;
  if (sleepWindow) phaseShift = sleepWindow.wakeHour - 8;

  // 逐小时能量
  for (let h = 0; h < 24; h++) {
    let base;
    if (cosinorPeakH != null && cortisolResult?.hourlyMean) {
      const m = cortisolResult.hourlyMean[h];
      if (m != null) {
        const mesor = cortisolResult.cosinor.mesor;
        const amp = cortisolResult.cosinor.amplitude;
        const normalized = clamp((m - (mesor - amp)) / (amp * 2), 0, 1);
        base = normalized * 100;
      } else {
        base = circadianWeight(h + phaseShift) * 100;
      }
    } else {
      base = circadianWeight(h + phaseShift) * 100;
    }
    const recoveryPenalty = (1 - sleepRecoveryFactor) * 20;
    hourlyEnergy.push({ hour: h, energy: Math.round(clamp(base - recoveryPenalty, 0, 100)) });
  }

  const confidence = clamp(Math.round((r2 > 0 ? r2 : 0.5) * 100), 30, 95);
  let peak: { hour: number; energy: number; confidence?: number } | null = null;
  let trough: { hour: number; energy: number; confidence?: number } | null = null;

  if (cosinorPeakH != null) {
    const ph = Math.round(cosinorPeakH);
    peak = { hour: ph, energy: hourlyEnergy[ph]?.energy ?? 70, confidence };
    // 下午低谷 = 峰值后约 6h
    const th = Math.round((cosinorPeakH + 6) % 24);
    trough = { hour: th, energy: hourlyEnergy[th]?.energy ?? 50, confidence: Math.max(20, confidence - 15) };
  } else {
    const scanList = hourlyEnergy.filter(e => e.hour >= (sleepWindow?.wakeHour ?? 7) && e.hour <= 23);
    if (scanList.length >= 3) {
      peak = { ...scanList.reduce((a, b) => (b.energy > a.energy ? b : a)), confidence: 55 };
      trough = { ...scanList.reduce((a, b) => (b.energy < a.energy ? b : a)), confidence: 40 };
    }
  }
  // 区间 = 峰/谷时刻 ± 1.5h (3小时窗口，对齐整点)
  const makeSpan = (h: number | undefined | null) => {
    if (h == null) return null;
    const start = (Math.round(h - 1.5) + 24) % 24;
    const end = (Math.round(h + 1.5)) % 24;
    return { startHour: start, endHour: end };
  };
  const peakSpan = peak ? makeSpan(peak.hour) : null;
  const troughSpan = trough ? makeSpan(trough.hour) : null;
  return { peak, trough, peakSpan, troughSpan, hourlyEnergy };
}

// ★ 结果缓存：同 (日期, healthStore 版本, 30s 窗) 内直接命中（与 stressAlgorithm 同款）。
let _cogReportCache: { key: string; val: CognitiveLoadReport } | null = null;

export function computeCognitiveLoadReport(nowMs = Date.now()): CognitiveLoadReport {
  const key = `${todayKey(nowMs)}|${healthStore.getVersion()}|${Math.floor(nowMs / 30000)}`;
  const c = _cogReportCache;
  if (c && c.key === key) return c.val;
  const val = computeCognitiveLoadReportUncached(nowMs);
  _cogReportCache = { key, val };
  return val;
}

function computeCognitiveLoadReportUncached(nowMs: number): CognitiveLoadReport {
  const today = todayKey(nowMs);

  // ── 1. 今日均值 ───────────────────────────────────────────
  const hrvNow = healthStore.getDay('hrv', today)?.mean ?? null;
  const snsNow = healthStore.getDay('sns', today)?.mean ?? null;
  const tempNow = healthStore.getDay('temp', today)?.mean ?? null;
  const edaNow = healthStore.getDay('eda', today)?.mean ?? null;
  const { now: vtiNow, baseline: vtiBaseline } = vtiFrom(nowMs);

  // ── 2. 多日基线 ───────────────────────────────────────────
  const hrvBaseline = baselineOf('hrv', nowMs);
  const snsBaseline = baselineOf('sns', nowMs);
  const tempBaseline = baselineOf('temp', nowMs);

  const sampleCount = [hrvNow, snsNow, tempNow, vtiNow, edaNow].filter(v => v != null).length;

  // ── 3. 各因子偏离 ────────────────────────────────────────
  const hrvDev = (hrvNow != null && hrvBaseline != null && hrvBaseline > 0)
    ? (hrvNow - hrvBaseline) / hrvBaseline : null;
  const snsDev = (snsNow != null && snsBaseline != null && snsBaseline > 0)
    ? (snsNow - snsBaseline) / snsBaseline : null;
  const tempDev = (tempNow != null && tempBaseline != null && tempBaseline > 0)
    ? (tempNow - tempBaseline) / tempBaseline : null;
  // vtiDev 保留但降权 (自研指标)
  const vtiDev = (vtiNow != null && vtiBaseline != null && vtiBaseline > 0)
    ? (vtiNow - vtiBaseline) / vtiBaseline : null;

  // ── 4. 融合认知负荷分 v2 (2026-09-21)
  //     科学依据: 节律+睡眠 85% / HRV代理 15%
  //     节律+睡眠 = 个体化皮质醇节律相位 + Borbély 恢复因子
  //     HRV 代理 = 生理紧张度 (辅助, 不可单独解释认知)
  //
  // 步骤 A: 先算节律驱动的基础负荷 (基于 hourly 已观测 HRV/SNS 偏离)
  let loadScore = 50;
  let hrContrib = 0;   // HRV/SNS/VTI 贡献 (占 15%)
  let hrWeight = 0;

  if (hrvDev != null) { hrContrib += -hrvDev * 80; hrWeight += 8; }
  if (snsDev != null && hrvDev != null && hrvDev < -0.03) { hrContrib += snsDev * 30; hrWeight += 5; }
  if (vtiDev != null) { hrContrib += vtiDev * 30; hrWeight += 2; }
  if (tempDev != null) { hrContrib += tempDev * 30; hrWeight += 0; }
  hrContrib = clamp(hrContrib, -30, 30);

  // 步骤 B: 睡眠恢复因子 (Borbély Process S) — 直接影响基础负荷
  //         恢复差 → 基础负荷整体上移
  const _todayKey2 = todayKey(nowMs);
  const _sleepSum2 = healthStore.getSleep(_todayKey2);
  let sleepRecovery = 0.75;  // 默认
  if (_sleepSum2 && _sleepSum2.total > 0) {
    const sleepHours = _sleepSum2.total / 60;
    const deepRatio = _sleepSum2.total > 0 ? (_sleepSum2.deep / _sleepSum2.total) : 0.15;
    // 恢复 = 睡眠时长充足性 × 深睡占比
    const durationAdequacy = clamp((sleepHours - 6) / 2, 0, 1);  // 6h=0, 8h+=1
    const deepBonus = clamp((deepRatio - 0.12) / 0.08, 0, 1);   // 12%=0, 20%+=1
    sleepRecovery = 0.6 * durationAdequacy + 0.4 * deepBonus;
  }
  // 步骤 C: 睡眠债修正 (过去 7 天 Borbély)
  let sleepDebt = 0;
  for (let di = 1; di <= 7; di++) {
    const sl = healthStore.getSleep(dayKey(-di, nowMs));
    if (sl && sl.total > 0) {
      const gap = Math.max(0, (8 * 60 - sl.total) / 60);
      sleepDebt += gap * Math.exp(-di / 5);
    }
  }
  const debtPenalty = clamp(sleepDebt * 6, 0, 30);  // 每欠 1h 加 6 分负荷, 封顶 30

  // 最终融合: 基础 40 + 睡眠恢复驱动 + 债 penalty + HRV 代理辅助
  loadScore = clamp(40 + (1 - sleepRecovery) * 35 + debtPenalty + hrContrib * 0.5, 0, 100);

  // ── 4.5 节律拟合（提前：准备度 / 逐时负荷 / 预测三处共用一次 cosinor）──
  void ensureEmotionLogLoaded(); // 情绪归因素材：异步载入，未就绪的本帧按空表处理（下一帧生效）
  let cortisolResult: CortisolRhythmResult | null = null;
  try {
    const _dayMs0 = dayStartMs(nowMs);
    const samples: { t: number; v: number }[] = [];
    for (let di = 0; di < 14; di++) {
      const dStart = _dayMs0 - di * 86400000;
      const pts = healthStore.getTimeRange('cortisol' as MetricKey, dStart, dStart + 86400000, { maxPoints: 500 });
      pts.forEach(p => { if (p.v > 0) samples.push({ t: p.t, v: p.v }); });
    }
    if (samples.length >= 8) cortisolResult = analyzeCortisol(samples, 14);
  } catch {}
  const _acrophase = cortisolResult?.cosinor?.acrophaseH != null && Number.isFinite(cortisolResult.cosinor.acrophaseH)
    ? cortisolResult.cosinor.acrophaseH : 8;

  // ── 5. 疲劳指数 = 脑力账户能量线：早上准备度开局 → 白天消耗 → 此刻剩余 ──
  const highLoadThreshold = 65;
  const _sleepPre = healthStore.getSleep(todayKey(nowMs));
  const _wakeMin = _sleepPre?.wakeTime != null ? parseClockMinutes(_sleepPre.wakeTime) : null;
  const morningReadiness = computeMorningReadiness({
    rec: sleepRecovery, debt: sleepDebt, peakH: _acrophase,
    wakeH: _wakeMin != null ? _wakeMin / 60 : null,
  });
  const hourlyRes = computeHourlyLoad(nowMs, { initEnergy: morningReadiness, acrophaseH: _acrophase });
  const hourly = hourlyRes.hourly;
  // ★ debug: 暴露 hourly 到 global
  (global as any).__cogHourlyDebug = hourly.filter(h => h.score > 0).map(h => `${h.hour}:${h.score}`).join(',');

  // ── 读睡眠数据, 动态确定睡眠时间 ──
  const todayDK = todayKey(nowMs);
  const sleepSum = healthStore.getSleep(todayDK);
  let sleepWindow: { bedHour: number; wakeHour: number } | null = null;
  if (sleepSum && sleepSum.total > 0) {
    // 优先用原生精准 sleepTime/wakeTime（"HH:mm" 或原生 "YYYY-MM-DD HH:mm"）
    // ★ 解析复用 lib/sleepTime.parseClockMinutes（全仓唯一解析实现，保留分钟精度）
    const parseHM = (s: string | null | undefined): number | null => {
      const min = parseClockMinutes(s);
      return min == null ? null : min / 60;
    };
    const bedH = parseHM(sleepSum.sleepTime);
    const wakeH = parseHM(sleepSum.wakeTime);
    if (bedH != null && wakeH != null) {
      sleepWindow = { bedHour: Math.floor(bedH), wakeHour: Math.floor(wakeH) };
      (global as any).__cogSleepDebug = { sleepTime: sleepSum.sleepTime, wakeTime: sleepSum.wakeTime, bedH, wakeH, sleepWindow };
    } else if (sleepSum.getUp > 0) {
      // fallback: 用 getUp 和 total 反推
      const wakeHour = Math.floor(sleepSum.getUp / 60);
      const bedHour = Math.floor((sleepSum.getUp - sleepSum.total) / 60 + 24) % 24;
      sleepWindow = { bedHour, wakeHour };
    }
  } else {
    (global as any).__cogSleepDebug = { noSleep: true };
  }

  // ★ debug: 也暴露过滤后的 visible hourly (用 isAsleep 逻辑)
  if (sleepWindow) {
    const sw = sleepWindow;
    const visible = hourly.filter(h => {
      if (sw.bedHour < sw.wakeHour) return !(h.hour >= sw.bedHour && h.hour < sw.wakeHour);
      return !(h.hour >= sw.bedHour || h.hour < sw.wakeHour);
    });
    (global as any).__cogFilteredDebug = visible.filter(h => h.score > 0).map(h => `${h.hour}:${h.score}`).join(',');
  }

  const activeHours = hourly.filter(h => h.score > 0).length;
  const highLoadHours = hourly.filter(h => h.score >= highLoadThreshold).length;
  const highLoadRatio = activeHours > 0 ? highLoadHours / activeHours : 0;

  const recoveryCapacity = computeRecoveryCapacity(nowMs);

  let fatigueIndex = highLoadRatio * 60;
  if (recoveryCapacity != null && recoveryCapacity < 0.85) {
    fatigueIndex += (0.85 - recoveryCapacity) * 200;
  }
  if (tempDev != null && tempDev > 0.005) {
    fatigueIndex += Math.min(15, tempDev * 800);
  }
  fatigueIndex = clamp(fatigueIndex, 0, 100);

  // ── 6. 分类（阈值与全 App 统一的 COG_LEVEL_LOW/HIGH 对齐：≥70 高 / 40–70 中 / <40 低）──
  const loadLevel: LoadLevel =
    loadScore >= COG_LEVEL_HIGH ? 'heavy'
    : loadScore >= COG_LEVEL_LOW ? 'moderate'
    : loadScore >= 20 ? 'light'
    : 'rested';

  const fatigueLevel: FatigueLevel =
    fatigueIndex >= 75 ? 'severe'
    : fatigueIndex >= 50 ? 'moderate'
    : fatigueIndex >= 25 ? 'mild'
    : 'fresh';

  const loadReason = buildLoadReason({ hrvDev, vtiDev, snsDev, loadLevel, sleepRecovery: sleepRecovery, sleepDebt });
  const fatigueReason = buildFatigueReason({ fatigueIndex, highLoadRatio, recoveryCapacity, tempDev, sleepRecovery: sleepRecovery, sleepDebt });

  // ── 8. 极值时段 (互斥 + bestSpan 重新定义) ─────────────────
  function classify(h: { hour: number; score: number }): 'heavy' | 'moderate' | 'light' | 'calm' | 'empty' {
    if (h.score <= 0) return 'empty';
    if (h.score >= 65) return 'heavy';
    if (h.score >= 40) return 'moderate';
    if (h.score >= 20) return 'light';
    return 'calm';
  }
  function mergeRanges(target: Set<string>, minLen = 1): { startHour: number; endHour: number; avgScore: number; hours: number[] }[] {
    const ranges: { startHour: number; endHour: number; scores: number[]; hours: number[] }[] = [];
    let cur: { startHour: number; endHour: number; scores: number[]; hours: number[] } | null = null;
    for (const h of hourly) {
      const cls = classify(h);
      if (!target.has(cls)) { cur = null; continue; }
      if (cur && h.hour === cur.endHour + 1) { cur.endHour = h.hour; cur.scores.push(h.score); cur.hours.push(h.hour); }
      else { if (cur && cur.scores.length >= minLen) ranges.push(cur); cur = { startHour: h.hour, endHour: h.hour, scores: [h.score], hours: [h.hour] }; }
    }
    if (cur && cur.scores.length >= minLen) ranges.push(cur);
    return ranges.map(r => ({ startHour: r.startHour, endHour: r.endHour, avgScore: Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length), hours: r.hours }));
  }

  // Step 1: peakLoadSpan 先选 (heavy/moderate, >=40)
  const peakLoadSpan = (() => {
    const ranges = mergeRanges(new Set(['heavy', 'moderate']), 1);
    if (ranges.length === 0) return null;
    return ranges.reduce((a, b) => ((b.endHour - b.startHour) + b.avgScore / 50) > ((a.endHour - a.startHour) + a.avgScore / 50) ? b : a);
  })();

  // Step 2: bestSpan 后选 — 互斥 + 重新定义
  //   认知最佳 ≠ 负荷最低 (calm 可能是睡觉/发呆)
  //   认知最佳 = 白天(8-20) + light(20-50) 轻度投入
  //              适度放松但专注 = 心流, 脑力储备充足
  //   排除所有 peakLoadSpan 覆盖的 hour
  const bestSpan = (() => {
    const peakHours = new Set(peakLoadSpan?.hours ?? []);
    const filtered = mergeRanges(new Set(['light']), 1)
      .filter(r => !r.hours.some(h => peakHours.has(h)))
      .filter(r => r.endHour >= 8 && r.startHour <= 20);
    if (filtered.length === 0) return null;
    return filtered.reduce((a, b) => {
      const aCov = Math.min(a.endHour, 20) - Math.max(a.startHour, 8) + 1;
      const bCov = Math.min(b.endHour, 20) - Math.max(b.startHour, 8) + 1;
      if (bCov !== aCov) return bCov > aCov ? b : a;
      const aFit = Math.abs(a.avgScore - 32.5);
      const bFit = Math.abs(b.avgScore - 32.5);
      return bFit < aFit ? b : a;
    });
  })();

  // ★ 最终全量 debug
  try {
    const sw = sleepWindow;
    const visible = sw ? hourly.filter(h => {
      if (sw.bedHour < sw.wakeHour) return !(h.hour >= sw.bedHour && h.hour < sw.wakeHour);
      return !(h.hour >= sw.bedHour || h.hour < sw.wakeHour);
    }) : hourly;
    // ★★ 查每个小时实际拿到的 HRV/SNS 点数
    const dayMs = dayStartMs(nowMs);
    const hrvCounts: string[] = [];
    const snsCounts: string[] = [];
    const hrvMeans: string[] = [];
    const snsMeans: string[] = [];
    for (let h = 0; h < 24; h++) {
      const s = dayMs + h * 3600 * 1000;
      const e = s + 3600 * 1000;
      const hc = healthStore.getTimeRange('hrv' as MetricKey, s, e, { maxPoints: 50 });
      const sc = healthStore.getTimeRange('sns' as MetricKey, s, e, { maxPoints: 50 });
      const hMean = hc.length > 0 ? Math.round(hc.reduce((a,p)=>a+p.v,0)/hc.length) : '-';
      const sMean = sc.length > 0 ? Math.round(sc.reduce((a,p)=>a+p.v,0)/sc.length) : '-';
      hrvCounts.push(`${h}:${hc.length}`);
      snsCounts.push(`${h}:${sc.length}`);
      hrvMeans.push(`${h}:${hMean}`);
      snsMeans.push(`${h}:${sMean}`);
    }
    // ★ 也查 HRV 样本实际时间戳分布
    const allHrv = healthStore.getTimeRange('hrv' as MetricKey, dayMs, dayMs + 86400000, { maxPoints: 500 });
    const hrvTs = allHrv.map(p => {
      const localHour = new Date(p.t).getHours();
      return `${localHour}`;
    });
    (global as any).__cogAll = {
      sleepWindow,
      hourlyAll: hourly.map(h => `${h.hour}:${h.score}`).join(','),
      hourlyNonZero: hourly.filter(h => h.score > 0).map(h => `${h.hour}:${h.score}`).join(','),
      visibleNonZero: visible.filter(h => h.score > 0).map(h => `${h.hour}:${h.score}`).join(','),
      hrvCounts: hrvCounts.join(','),
      snsCounts: snsCounts.join(','),
      hrvMeans: hrvMeans.join(','),
      snsMeans: snsMeans.join(','),
      hrvTotal: allHrv.length,
      hrvLocalHours: hrvTs.join(','),
      nowMs,
      dayStartMs: dayMs,
      nowLocal: new Date(nowMs).toString(),
      dayStartLocal: new Date(dayMs).toString(),
      healthStoreHasHrv: healthStore.getDay('hrv', todayKey(nowMs))?.mean,
      healthStoreHasSns: healthStore.getDay('sns', todayKey(nowMs))?.mean,
      hrvSamplesLast5: allHrv.slice(-5).map(p => {
        const d = new Date(p.t);
        return `${d.getHours()}:${d.getMinutes()} ts=${p.t}`;
      }).join(','),
      hrvSampleFirstTs: allHrv.length > 0 ? (() => {
        const d = new Date(allHrv[0].t);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
      })() : null,
      hrvSampleLastTs: allHrv.length > 0 ? (() => {
        const d = new Date(allHrv[allHrv.length-1].t);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
      })() : null,
    };
  } catch(e) { (global as any).__cogAll = { error: String(e) }; }

  // ── v2: 睡眠恢复因子 (Borbély Process S 简化) ──
  // 内部估算: 过去 7 天每日 total_sleep vs 8h 目标, 指数衰减累积缺口
  let sleepDebtH = 0;
  for (let di = 1; di <= 7; di++) {
    const dk = dayKey(-di, nowMs);
    const sl = healthStore.getSleep(dk);
    if (sl && sl.total > 0) {
      const gap = Math.max(0, (8 * 60 - sl.total) / 60); // 小时
      sleepDebtH += gap * Math.exp(-di / 5); // τ=5d 衰减
    }
  }
  let sleepRecoveryFactor: number;
  if (sleepDebtH <= 0) sleepRecoveryFactor = 0.95;
  else if (sleepDebtH < 2) sleepRecoveryFactor = 0.75;
  else if (sleepDebtH < 5) sleepRecoveryFactor = 0.5;
  else sleepRecoveryFactor = 0.25;

  const circadianHour = new Date(nowMs).getHours() + new Date(nowMs).getMinutes() / 60;

  const mentalEnergy = computeMentalEnergy({
    hrvNow, hrvBaseline,
    sleepRecoveryFactor,
    circadianHour,
    cumulativeLoad: loadScore,
  });
  const focusScore = computeFocus({
    hrvNow, hrvBaseline, snsNow, snsBaseline,
    circadianHour, fatigueIndex,
  });
  const decisionScore = computeDecision({
    hrvNow, hrvBaseline, circadianHour,
    sleepRecoveryFactor, loadScore,
  });
  const forecast = computeForecast(hourly, cortisolResult, sleepRecoveryFactor, sleepWindow, circadianHour);

  // ── 脑力账户（与疲劳曲线同一条能量线，一条账讲完）──────────
  //   储备 = 早起认知准备度（sleepRecovery / sleepDebt / 节律相位）
  //   已用 = 储备 − 剩余；剩余 = 此刻能量（清醒+费脑扣款，情绪/运动窗口已剔除）
  //   疲劳度 = 100 − 剩余（逐时柱状图同源）
  const brainReserve = morningReadiness;
  const circadianEnergy = clamp(Math.round(
    50 + 50 * Math.sin(2 * Math.PI * (circadianHour - _acrophase + 6) / 24)
  ), 0, 100);
  let brainRemaining = clamp(hourlyRes.energyNow, 0, 100);
  let brainUsed = clamp(brainReserve - brainRemaining, 0, 100);

  // ── 全天平均疲劳度（仅统计有数据的小时），与柱状图同源，作为卡片大数字 ──
  const _fatigueScores = hourly.filter(h => h.hasData).map(h => h.score);
  const avgFatigue = _fatigueScores.length > 0
    ? Math.round(_fatigueScores.reduce((a, b) => a + b, 0) / _fatigueScores.length)
    : null;

  // ── 第二步: 实时负荷检测 + 动态修正 ────────────────────
  const loadEvent: CognitiveLoadEvent | null = detectCognitiveLoad(
    hrvBaseline ?? 55, snsBaseline ?? 30, nowMs,
  );
  if (loadEvent) {
    const corrected = applyLoadCorrection({ brainUsed, circadianEnergy, brainRemaining }, loadEvent);
    // 保持一条账：实时负荷修正只调余额，已用恒 = 储备 − 剩余
    brainRemaining = clamp(corrected.brainRemaining, 0, brainReserve);
    brainUsed = clamp(brainReserve - brainRemaining, 0, 100);
  }

  const result: CognitiveLoadReport = {
    loadScore: Math.round(loadScore),
    loadLevel,
    loadReason,
    fatigueIndex: Math.round(fatigueIndex),
    fatigueLevel,
    fatigueReason,
    hourly,
    avgFatigue,
    recoveryCapacity,
    highLoadRatio: Math.round(highLoadRatio * 100),
    peakLoadSpan,
    bestSpan,
    sleepWindow,
    sampleCount,
    baselines: {
      hrv: hrvNow,
      vti: vtiNow,
      sns: snsNow,
      temp: tempNow,
    },
    mentalEnergy,
    focusScore,
    decisionScore,
    forecast: {
      ...forecast,
      rhythmR2: cortisolResult?.cosinor?.r2,
    },
    sleepRecovery: sleepRecovery,
    sleepDebt: Math.round(sleepDebt * 10) / 10,
    circadianPeakH: cortisolResult?.cosinor?.acrophaseH != null && Number.isFinite(cortisolResult.cosinor.acrophaseH)
      ? Math.round(cortisolResult.cosinor.acrophaseH * 10) / 10
      : undefined,
    rhythmStatus: cortisolResult?.status?.level,
    loadEvent: loadEvent ?? undefined,
    brainReserve,
    brainUsed,
    circadianEnergy,
    brainRemaining,
    brainExcluded: hourlyRes.excludedMin,
  };

  try {
    if (__DEV__) console.log('[COG-V2]', JSON.stringify({
      hrvNow, hrvBaseline, snsNow, snsBaseline,
      mentalEnergy, focusScore, decisionScore,
      peakHour: forecast?.peak?.hour, peakEnergy: forecast?.peak?.energy,
      troughHour: forecast?.trough?.hour, troughEnergy: forecast?.trough?.energy,
      sleepDebtH, sleepRecoveryFactor,
      circadianHour,
      // ★ 口径诊断（首页大数字 = avgFatigue，副标题峰值 = 柱子最高点）
      loadScore: result.loadScore,
      avgFatigue: result.avgFatigue,
      fatigueIndex: result.fatigueIndex,
      loadLevel: result.loadLevel,
      dataHours: hourly.filter(h => h.hasData).length,
      hourlyMax: hourly.length ? Math.max(...hourly.map(h => h.score)) : null,
      hourlyPeakHour: hourly.length ? hourly.reduce((a, b) => (b.score > a.score ? b : a)).hour : null,
      hourlyStr: hourly.filter(h => h.hasData).map(h => `${h.hour}:${h.score}`).join(' '),
      // ★ 调用身份诊断：区分「不同 nowMs / 不同天 / 不同数据快照」的多个调用方
      nowMs, today: _dayKey(nowMs), debt: Math.round(sleepDebt * 100) / 100,
      sleepWin: sleepWindow ? `${sleepWindow.bedHour}->${sleepWindow.wakeHour}` : null,
      sleepRaw: sleepSum ? { sleepTime: sleepSum.sleepTime, wakeTime: sleepSum.wakeTime, getUp: sleepSum.getUp, total: sleepSum.total, deep: sleepSum.deep } : null,
    }));
  } catch {}
  // ↓ 自动持久化
  try {
    healthStore.saveAnalysis(_dayKey(nowMs), 'cognitive', {
      loadScore: result.loadScore,
      avgFatigue: result.avgFatigue,
      fatigueIndex: result.fatigueIndex,
      peakHour: result.peakLoadSpan?.startHour ?? null,
      bestHour: result.bestSpan?.startHour ?? null,
      recoveryCapacity: result.recoveryCapacity,
    });
  } catch {}
  return result;
}

function computeHourlyLoad(
  nowMs: number,
  opts?: { initEnergy?: number | null; acrophaseH?: number | null },
): { hourly: { hour: number; score: number; hasData: boolean }[]; energyNow: number; initEnergy: number; excludedMin: { emotion: number; exercise: number } } {
  // ══════════════════════════════════════════════════════════════════════
  // ★ v3: 认知疲劳度 — lex-fatigue 风格能量衰减模型
  // 核心: 疲劳是累积过程, 用 ODE 离散化模拟能量衰减 + 恢复
  // E(t+dt) = E(t) - fatigueDrive · dt + recoveryDrive · dt
  // fatigue = 100 - E  (能量越低 = 疲劳越高)
  // dt = 0.5h (半小时步长), 输出 48 个点
  // 参考: IEEE 2026 Bi-LSTM 疲劳预测, lex-fatigue (MIT)
  // ══════════════════════════════════════════════════════════════════════
  const dayMs = dayStartMs(nowMs);
  const _todayKey = todayKey(nowMs);
  const sleepSum = healthStore.getSleep(_todayKey);
  const parseHM = (st: string | null | undefined): number | null => {
    const min = parseClockMinutes(st);
    return min == null ? null : min / 60;
  };
  const bedH = parseHM(sleepSum?.sleepTime);
  const wakeH = parseHM(sleepSum?.wakeTime);
  const bedHour = bedH != null ? Math.floor(bedH) : 0;
  const wakeHour = wakeH != null ? Math.floor(wakeH) : 7;

  // ── 1. 先算 baseline (全天清醒时段 HRV/SNS) ──
  const awakeHrv: number[] = [];
  const awakeSns: number[] = [];
  for (let h = 0; h < 24; h++) {
    const isAsleep = (bedHour < wakeHour) ? (h >= bedHour && h < wakeHour) : (h >= bedHour || h < wakeHour);
    if (isAsleep) continue;
    const hs = healthStore.getTimeRange('hrv' as MetricKey, dayMs + h * 3600000, dayMs + (h + 1) * 3600000, { maxPoints: 50 });
    const ss = healthStore.getTimeRange('sns' as MetricKey, dayMs + h * 3600000, dayMs + (h + 1) * 3600000, { maxPoints: 50 });
    hs.forEach(p => awakeHrv.push(p.v));
    ss.forEach(p => awakeSns.push(p.v));
  }
  const _today = _dayKey(nowMs);
  const hrvBaseline = awakeHrv.length >= 3 ? awakeHrv.reduce((a, b) => a + b, 0) / awakeHrv.length
    : (healthStore.getDay('hrv' as any, _today)?.mean ?? 55);
  const snsBaseline = awakeSns.length >= 3 ? awakeSns.reduce((a, b) => a + b, 0) / awakeSns.length
    : (healthStore.getDay('sns' as any, _today)?.mean ?? 30);

  // ── 2. 睡眠恢复因子 → 初始能量 ──
  const sleepRec = (() => {
    const totalMin = sleepSum?.total ?? 480;
    const deepRatio = sleepSum?.deep != null && totalMin > 0 ? sleepSum.deep / totalMin : 0.15;
    const durAdequacy = clamp((totalMin / 60 - 6) / 2, 0, 1); // 6h=0, 8h+=1
    const deepBonus = clamp((deepRatio - 0.12) / 0.08, 0, 1);  // 12%=0, 20%+=1
    return clamp(durAdequacy * 0.6 + deepBonus * 0.4, 0.2, 1);
  })();
  // 7 天睡眠债
  let debt = 0;
  for (let i = 0; i < 7; i++) {
    const d = healthStore.getSleep(dayKey(-i, nowMs));
    const h = (d?.total ?? 480) / 60;
    if (h < 8) debt += (8 - h) * Math.exp(-i / 5);
  }
  debt = clamp(debt, 0, 6);
  const debtAccel = 1 + debt * 0.08;  // 每欠 1h, 疲劳加速 8%

  // ── 3. 节律驱动 (外部传入 cosinor acrophase, 无数据 fallback 8 点) ──
  const acrophaseH = opts?.acrophaseH != null && Number.isFinite(opts.acrophaseH) ? opts.acrophaseH : 8;

  // ── 4. ODE 离散化: 48 个半小时步 ──
  // E(t) = 认知能量 (0-100), fatigue = 100 - E
  const DT = 0.5;  // 半小时
  const ALPHA_HRV = 0.04;  // HRV 偏离 → 疲劳累积系数
  const ALPHA_SNS = 0.03;  // SNS 偏离 → 疲劳累积系数
  const ALPHA_AWAKE = 1.6; // 清醒期基础疲劳累积 (每 h)
  // ★ 曲线是否铺满「清醒时段」由当天整体实测量决定：
  //   旧实现要求「该半小时内有实测样本」才算 hasData，戒指采样断续时曲线被打成碎片
  //   （实测只落在 1 个半小时 → 均值只由 1 小时决定 → 出现「平均疲劳度 8」这类无意义值）
  //   ★★ v18.63 诚实数据：只认**真实戒指 HRV 采样**。SNS 是 offlineEstimates 用 stress
  //   推导的估计值（没戴戒指也恒有），计入门槛会把全天模型曲线伪装成实测（用户实锤投诉：
  //   「没戴戒指怎么可能有数据」）。估计值一律不作为 hasData 依据。
  //   ★★ v18.69 再收紧：dayHasData（当日≥10 采样就全天开门）废弃——用户再次实锤
  //   「没戴戒指怎么还有认知疲劳度趋势图」：只戴了早上 1 小时，当天其余时段全被模型柱
  //   冒充实测。hasData 改回**逐时段判定**：该半小时真的有 HRV 采样才算，没采样的
  //   时段显示灰桩（MiniCognitiveBars NO_DATA）。「均值只由少数时段决定」= 诚实，不修。

  const morningEnergy = clamp(sleepRec * 80 + 20, 20, 100); // 睡眠恢复决定的晨起能量上限

  // ── 3.5 窗口归因素材（只算脑）──
  const emotionEntries = getEntriesForDay(_today);
  const excludedMin = { emotion: 0, exercise: 0 };
  // 开局能量 = 脑力账户储备（早起认知准备度）；未传时退回睡眠恢复决定的晨起上限
  const initEnergy = opts?.initEnergy != null ? clamp(opts.initEnergy, 20, 100) : morningEnergy;
  let energy = initEnergy;
  const half: { score: number; hasData: boolean }[] = []; // 内部 48 个半步
  let energyAtNow = initEnergy; // 此刻的能量余额（用于脑力账户）

  for (let step = 0; step < 48; step++) {
    const halfH = step * 0.5;
    const fullH = Math.floor(halfH);
    const isAsleep = (bedHour < wakeHour) ? (fullH >= bedHour && fullH < wakeHour) : (fullH >= bedHour || fullH < wakeHour);

    if (isAsleep) {
      // 睡眠时: 能量恢复至「本次晨起能量」上限
      // ★ 不再固定 92 —— 旧实现会把睡眠期能量顶到 92，从而把 sleepRec（睡得好不好）
      //   对全天疲劳曲线的影响彻底抹掉
      energy = clamp(energy + 18 * DT, 0, morningEnergy);
      if (dayMs + step * 1800000 < nowMs) energyAtNow = energy;
      half.push({ score: 0, hasData: false });
      continue;
    }

    // ── 取这个半小时的 HRV/SNS ──
    const stepStart = dayMs + step * 1800000;  // 半小时 = 1800s
    const inFuture = stepStart >= nowMs;       // ★ 只到「此刻」为止算已观测(不写未发生时段)
    const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, stepStart, stepStart + 1800000, { maxPoints: 25 });
    const snsPts = healthStore.getTimeRange('sns' as MetricKey, stepStart, stepStart + 1800000, { maxPoints: 25 });
    const hrvMean = hrvPts.length > 0 ? hrvPts.reduce((a, p) => a + p.v, 0) / hrvPts.length : null;
    const snsMean = snsPts.length > 0 ? snsPts.reduce((a, p) => a + p.v, 0) / snsPts.length : null;
    // ★ v18.69：该半小时真的有戒指 HRV 采样才算「有实测」；没戴/没采样的时段 = 无数据
    const hasData = !inFuture && hrvMean != null;

    // ── ★ 窗口归因（只算脑，不混情绪/运动）──
    //   运动: 半小时步数增量 ≥250 → 该窗口 HRV/SNS 偏离是身体活动所致, 不计入脑
    //   情绪: ±30min 内有用户自报沉色情绪(stressed/anxious/sad/angry/lonely)
    //         → 该窗口唤醒偏离大概率是情绪事件触发, 不计入脑（概率归因, 诚实剔除）
    let isExercise = false;
    if (!inFuture) {
      const stepPts = healthStore.getTimeRange('steps' as MetricKey, stepStart, stepStart + 1800000, { maxPoints: 10 });
      if (stepPts.length >= 2 && stepPts[stepPts.length - 1].v - stepPts[0].v >= EXERCISE_STEP_DELTA) isExercise = true;
    }
    const isEmotionEvent = !inFuture && emotionEntries.some(
      e => EMOTION_EVENT_MOODS.has(e.mood) && Math.abs(e.t - (stepStart + 900000)) <= 1800000,
    );
    if (isExercise) excludedMin.exercise += 30;
    else if (isEmotionEvent) excludedMin.emotion += 30;

    // ── fatigueDrive: Process S —— 清醒期疲劳单调累积 ──
    let fatigueDrive = 0;
    fatigueDrive += ALPHA_AWAKE * debtAccel;  // 清醒基础累积 + 睡眠债加速（醒着就在用脑）
    let arousalDrive = 0;                     // 唤醒偏离: 需归因后才能计入脑
    if (hrvMean != null && hrvBaseline > 0) {
      const hrvDrop = clamp((hrvBaseline - hrvMean) / hrvBaseline, 0, 1);
      arousalDrive += ALPHA_HRV * hrvDrop * 100;
    }
    if (snsMean != null && snsBaseline > 0) {
      const snsRise = clamp((snsMean - snsBaseline) / snsBaseline, 0, 1);
      arousalDrive += ALPHA_SNS * snsRise * 100;
    }
    // 归因裁决: 运动窗口全剔除; 情绪事件窗口全剔除; 其余视为认知投入, 全额计入
    if (isExercise || isEmotionEvent) arousalDrive = 0;
    fatigueDrive += arousalDrive;

    // ── 节律只调制「累积速度」(0.9–1.6×)：清晨略慢、下午低谷略快，但不产生「回血」──
    //    旧实现的 recoveryDrive(最大 2.0/h) 与 fatigueDrive(≈1.13/h) 几乎相等，
    //    导致能量全天几乎不降、疲劳度恒在 8–12，曲线与卡片数字双双失去意义。
    const circSpeed = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (halfH - acrophaseH + 12) / 24));

    // ── ODE 更新 ──
    energy = clamp(energy - fatigueDrive * circSpeed * DT, 0, 100);
    if (!inFuture) energyAtNow = energy;

    // ── 计算疲劳度 = 100 - 能量 ──
    half.push({ score: Math.round(100 - energy), hasData });
  }

  // ── 聚合为 24 个整点桶 (hour = 钟点 0–23, 每桶 = 该小时两个半步的均值) ──
  const out: { hour: number; score: number; hasData: boolean }[] = [];
  for (let h = 0; h < 24; h++) {
    const a = half[2 * h];
    const b = half[2 * h + 1];
    const has = !!(a?.hasData || b?.hasData);
    let score = 0;
    if (has) {
      const vals = [a?.hasData ? a.score : null, b?.hasData ? b.score : null].filter((v): v is number => v != null);
      score = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    out.push({ hour: h, score, hasData: has });
  }
  return { hourly: out, energyNow: Math.round(energyAtNow), initEnergy: Math.round(initEnergy), excludedMin };
}

function computeRecoveryCapacity(nowMs: number): number | null {
  const hrvBase = baselineOf('hrv', nowMs);
  if (hrvBase == null) return null;
  const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, dayStartMs(nowMs), dayStartMs(nowMs) + 86400000, { maxPoints: 500 });
  if (hrvPts.length < 5) return null;
  let minWinMean = Infinity;
  const winSize = Math.max(3, Math.floor(hrvPts.length / 8));
  for (let i = 0; i + winSize <= hrvPts.length; i++) {
    const win = hrvPts.slice(i, i + winSize);
    const m = win.reduce((a, p) => a + p.v, 0) / win.length;
    if (m < minWinMean) minWinMean = m;
  }
  return minWinMean / hrvBase;
}

/**
 * 诚实描述: 节律+睡眠为主, HRV仅辅助 (不声称"HRV下降导致负荷高")
 */
function buildLoadReason(p: {
  hrvDev: number | null; vtiDev: number | null; snsDev: number | null;
  loadLevel: LoadLevel;
  sleepRecovery: number; sleepDebt: number;
}): string {
  const parts: string[] = [];
  // 睡眠债 — 最可靠的预测因子
  if (p.sleepDebt >= 2) parts.push(`累计睡眠债 ${p.sleepDebt.toFixed(1)}h`);
  else if (p.sleepDebt >= 1) parts.push(`轻度睡眠债 ${p.sleepDebt.toFixed(1)}h`);
  // 睡眠恢复
  if (p.sleepRecovery < 0.4) parts.push('睡眠恢复不足');
  else if (p.sleepRecovery < 0.6) parts.push('恢复一般');
  // HRV 偏离 — 仅作为"今天生理状态"的辅助信号
  if (p.hrvDev != null && p.hrvDev < -0.08) parts.push('今日生理紧张');
  if (parts.length === 0) return '状态良好';
  return parts.join('，');
}

/**
 * 诚实描述: 疲劳压力来自恢复因子 (睡眠债+恢复能力), HRV 辅助
 */
function buildFatigueReason(p: {
  fatigueIndex: number; highLoadRatio: number;
  recoveryCapacity: number | null; tempDev: number | null;
  sleepRecovery: number; sleepDebt: number;
}): string {
  const parts: string[] = [];
  // 睡眠恢复压力
  if (p.sleepRecovery < 0.3) parts.push('深度睡眠恢复严重不足');
  else if (p.sleepRecovery < 0.5) parts.push('恢复压力偏高');
  if (p.sleepDebt >= 3) parts.push(`睡眠债 ${p.sleepDebt.toFixed(1)}h`);
  // 生理恢复能力
  if (p.recoveryCapacity != null) {
    if (p.recoveryCapacity < 0.7) parts.push('迷走恢复显著下降');
    else if (p.recoveryCapacity < 0.85) parts.push('恢复能力略差');
  }
  if (p.highLoadRatio >= 0.3) parts.push(`今日高强度时段较多`);
  if (parts.length === 0) return '恢复良好';
  return parts.join('，');
}

function labelForLevel(l: LoadLevel): string {
  return l === 'heavy' ? '持续高强度投入'
    : l === 'moderate' ? '中等脑力投入'
    : l === 'light' ? '轻度脑力投入'
    : '基本放松';
}

export function levelLabel(l: LoadLevel | FatigueLevel): string {
  return l === 'heavy' || l === 'severe' ? '高'
    : l === 'moderate' ? '中'
    : l === 'mild' ? '轻度'
    : '良好';
}

// ══════════════════════════════════════════════════════════════════════
// ★ 脑力「高中低」三档 —— 全 App 唯一权威阈值（图表柱色 / Y 轴 / Hero chip / 首页副标题 全部对齐）
//   低 < 40（绿，状态好）｜中 40–70（黄，一般）｜高 ≥ 70（红，需关注）
//   注：hourly[].score 是「疲劳度(0-100)」、loadScore 是「负荷(0-100)」，二者量纲不同，
//       但都用同一组阈值着色，保证颜色语义一致（绿=低、黄=中、红=高）。
// ══════════════════════════════════════════════════════════════════════
export const COG_LEVEL_LOW = 40;
export const COG_LEVEL_HIGH = 70;

export type CogLevelKey = 'low' | 'mid' | 'high';

/** 由分数判定档位（统一用 COG_LEVEL_LOW / COG_LEVEL_HIGH） */
export function cogLevel(score: number | null | undefined): CogLevelKey {
  if (score == null || !Number.isFinite(score)) return 'low';
  if (score < COG_LEVEL_LOW) return 'low';
  if (score < COG_LEVEL_HIGH) return 'mid';
  return 'high';
}

/** 档位中文短标签（高中低） */
export function cogLevelLabel(score: number | null | undefined): string {
  const k = cogLevel(score);
  return k === 'low' ? '低' : k === 'mid' ? '中' : '高';
}
