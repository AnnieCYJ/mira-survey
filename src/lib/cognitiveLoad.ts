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

export type LoadLevel = 'rested' | 'light' | 'moderate' | 'heavy';
export type FatigueLevel = 'fresh' | 'mild' | 'moderate' | 'severe';

export interface CognitiveLoadReport {
  /** 认知负荷分 0-100 (今日均值) */
  loadScore: number;
  loadLevel: LoadLevel;
  loadReason: string;
  /** 疲劳指数 0-100 (积累量, 高负荷时段占比 × 恢复延迟惩罚) */
  fatigueIndex: number;
  fatigueLevel: FatigueLevel;
  fatigueReason: string;
  /** 全天逐小时负荷分 (0-23) */
  hourly: { hour: number; score: number }[];
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
    peak: { hour: number; energy: number } | null;
    trough: { hour: number; energy: number } | null;
    hourlyEnergy: { hour: number; energy: number }[]; // 24h 预测脑力分布
  };
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
function computeMentalEnergy(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  sleepRecoveryFactor: number;  // 0-1, Borbély Process S 有效还债量
  circadianHour: number;
  cumulativeLoad: number;  // 今日平均负荷
}): number | null {
  if (params.hrvNow == null || params.hrvBaseline == null || params.hrvBaseline <= 0) return null;
  const hrvRatio = clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6);
  const circ = circadianWeight(params.circadianHour);
  const term =
    0.35 * hrvRatio +
    0.30 * params.sleepRecoveryFactor +
    0.25 * circ +
    0.10 * (1 - params.cumulativeLoad / 100);
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 当下专注力 (Focus) — Task 2023 RMSSD→attention r=0.61 + eSports SCR_phasic/RMSSD
 * Yerkes-Dodson: 唤醒度钟形曲线, 最优 SNS_ratio ∈ [0.9, 1.3]
 *
 * focus = 0.45 * RMSSD_ratio + 0.30 * arousal_optimal + 0.15 * circadian_focus + 0.10 * (1-fatigue/100)
 */
function computeFocus(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  snsNow: number | null; snsBaseline: number | null;
  circadianHour: number;
  fatigueIndex: number;
}): number | null {
  if (params.hrvNow == null || params.hrvBaseline == null || params.hrvBaseline <= 0) return null;
  const hrvRatio = clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6);

  // 唤醒度最优区间 (Yerkes-Dodson): SNS/Baseline ∈ [0.85, 1.25] = 满分
  let arousalOptimal = 0.5;
  if (params.snsNow != null && params.snsBaseline != null && params.snsBaseline > 0) {
    const snsRatio = params.snsNow / params.snsBaseline;
    if (snsRatio >= 0.85 && snsRatio <= 1.25) arousalOptimal = 1.0;
    else if (snsRatio >= 0.6 && snsRatio <= 1.5) arousalOptimal = 0.7;
    else arousalOptimal = 0.3;
  }

  // 专注黄金窗口: 9-11am / 2-4pm
  const h = params.circadianHour;
  let circFocus = 0.5;
  if (h >= 9 && h <= 11) circFocus = 1.0;
  else if (h >= 14 && h <= 16) circFocus = 0.85;
  else if (h >= 8 && h <= 18) circFocus = 0.6;
  else circFocus = 0.3;

  const term =
    0.45 * hrvRatio +
    0.30 * arousalOptimal +
    0.15 * circFocus +
    0.10 * (1 - params.fatigueIndex / 100);
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 当下决策力 (Decision-Making) — Executive Function & HRV 综述 r=0.61
 * 前额叶调控 → RMSSD, 晨间决策最佳 (JBDM 2023), 睡眠债 → 决策质量 ↓25%
 *
 * decision = 0.40 * RMSSD_ratio + 0.30 * circadian_decision + 0.20 * sleep_recovery + 0.10 * (1-load/100)
 */
function computeDecision(params: {
  hrvNow: number | null; hrvBaseline: number | null;
  circadianHour: number;
  sleepRecoveryFactor: number;
  loadScore: number;
}): number | null {
  if (params.hrvNow == null || params.hrvBaseline == null || params.hrvBaseline <= 0) return null;
  const hrvRatio = clamp(params.hrvNow / params.hrvBaseline, 0.4, 1.6);

  // 决策力窗口: 8-11am 最高 (前额叶 alert), 午后降, 晚上最低
  const h = params.circadianHour;
  let circDec = 0.5;
  if (h >= 8 && h <= 11) circDec = 1.0;
  else if (h >= 12 && h <= 14) circDec = 0.75;
  else if (h >= 15 && h <= 17) circDec = 0.6;
  else if (h >= 18 && h <= 20) circDec = 0.4;
  else circDec = 0.25;

  const term =
    0.40 * hrvRatio +
    0.30 * circDec +
    0.20 * params.sleepRecoveryFactor +
    0.10 * (1 - params.loadScore / 100);
  return Math.round(clamp(term * 100, 0, 100));
}

/**
 * 今日剩余时段脑力预测 — 过去 7 天同小时中位数 + 今天已测走势 + circadian 修正
 * 参考: WHOOP Daily Outlook, AstroGuard (NASA) LOESS 思想
 */
function computeForecast(hourly: { hour: number; score: number }[],
                          hrvBaseline: number | null,
                          nowHour: number,
                          circadianHour: number): {
  peak: { hour: number; energy: number } | null;
  trough: { hour: number; energy: number } | null;
  hourlyEnergy: { hour: number; energy: number }[];
} {
  // 先算过去 7 天同小时的基线负荷 (简单用 hour 对应的 circadian 能量倒数)
  const hourlyEnergy: { hour: number; energy: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const circ = circadianWeight(h);
    // energy = circadian - 今日已观测的 load 走势修正
    const todayAtH = hourly[h]?.score ?? null;
    let energy;
    if (todayAtH != null && todayAtH > 0) {
      // 已观测到: energy 与 load 反向
      energy = clamp(100 - todayAtH * 0.7 - (1 - circ) * 30, 0, 100);
    } else {
      // 未观测: 纯 circadian 预测 + HRV 基线修正
      const hrvBoost = hrvBaseline != null ? clamp((hrvBaseline / 55 - 1) * 10, -15, 15) : 0;
      energy = clamp(circ * 100 + hrvBoost, 0, 100);
    }
    hourlyEnergy.push({ hour: h, energy: Math.round(energy) });
  }

  // 只看"剩下的时段" (nowHour 之后) 或全量 (凌晨/早间)
  const futureHours = hourlyEnergy.filter(e => e.hour > circadianHour);
  const scanList = futureHours.length > 0 ? futureHours : hourlyEnergy.filter(e => e.hour >= 7 && e.hour <= 23);

  let peak: { hour: number; energy: number } | null = null;
  let trough: { hour: number; energy: number } | null = null;
  if (scanList.length >= 3) {
    peak = scanList.reduce((a, b) => (b.energy > (a?.energy ?? -1) ? b : a), null as any);
    trough = scanList.reduce((a, b) => (b.energy < (a?.energy ?? 999) ? b : a), null as any);
  }
  return { peak, trough, hourlyEnergy };
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
  const vtiDev = (vtiNow != null && vtiBaseline != null && vtiBaseline > 0)
    ? (vtiNow - vtiBaseline) / vtiBaseline : null;
  const snsDev = (snsNow != null && snsBaseline != null && snsBaseline > 0)
    ? (snsNow - snsBaseline) / snsBaseline : null;
  const tempDev = (tempNow != null && tempBaseline != null && tempBaseline > 0)
    ? (tempNow - tempBaseline) / tempBaseline : null;

  // ── 4. 融合认知负荷分 (0-100) ────────────────────────────
  let loadScore = 50;
  let loadWeight = 0;

  // HRV: RMSSD↓ 10% → 负荷 +8
  if (hrvDev != null) {
    loadScore += -hrvDev * 80;
    loadWeight += 30;
  }
  // VTI: 血管张力↑ 10% → 负荷 +5
  if (vtiDev != null) {
    loadScore += vtiDev * 50;
    loadWeight += 25;
  }
  // SNS: 只有 HRV↓ 时才认为是认知伴随激活
  if (snsDev != null && hrvDev != null && hrvDev < -0.03) {
    loadScore += snsDev * 30;
    loadWeight += 20;
  } else if (snsDev != null) {
    loadScore += snsDev * 15;
    loadWeight += 10;
  }
  // Temp: 体温偏高 → 疲劳加罚
  if (tempDev != null) {
    loadScore += tempDev * 30;
    loadWeight += 15;
  }

  if (loadWeight >= 30) {
    loadScore = clamp(loadScore, 0, 100);
  } else {
    loadScore = 50;
  }

  // ── 5. 疲劳指数 ───────────────────────────────────────────
  const highLoadThreshold = 65;
  const hourly = computeHourlyLoad(nowMs);
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

  // ── 6. 分类 ────────────────────────────────────────────────
  const loadLevel: LoadLevel =
    loadScore >= 75 ? 'heavy'
    : loadScore >= 60 ? 'moderate'
    : loadScore >= 40 ? 'light'
    : 'rested';

  const fatigueLevel: FatigueLevel =
    fatigueIndex >= 75 ? 'severe'
    : fatigueIndex >= 50 ? 'moderate'
    : fatigueIndex >= 25 ? 'mild'
    : 'fresh';

  const loadReason = buildLoadReason({ hrvDev, vtiDev, snsDev, loadLevel });
  const fatigueReason = buildFatigueReason({ fatigueIndex, highLoadRatio, recoveryCapacity, tempDev });

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
  const forecast = computeForecast(hourly, hrvBaseline, new Date(nowMs).getHours(), circadianHour);

  const result: CognitiveLoadReport = {
    loadScore: Math.round(loadScore),
    loadLevel,
    loadReason,
    fatigueIndex: Math.round(fatigueIndex),
    fatigueLevel,
    fatigueReason,
    hourly,
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
    forecast,
  };

  try {
    console.log('[COG-V2]', JSON.stringify({
      hrvNow, hrvBaseline, snsNow, snsBaseline,
      mentalEnergy, focusScore, decisionScore,
      peakHour: forecast?.peak?.hour, peakEnergy: forecast?.peak?.energy,
      troughHour: forecast?.trough?.hour, troughEnergy: forecast?.trough?.energy,
      sleepDebtH, sleepRecoveryFactor,
      circadianHour,
    }));
  } catch {}
  // ↓ 自动持久化
  try {
    healthStore.saveAnalysis(_dayKey(nowMs), 'cognitive', {
      loadScore: result.loadScore,
      fatigueIndex: result.fatigueIndex,
      peakHour: result.peakLoadSpan?.startHour ?? null,
      bestHour: result.bestSpan?.startHour ?? null,
      recoveryCapacity: result.recoveryCapacity,
    });
  } catch {}
  return result;
}

function computeHourlyLoad(nowMs: number): { hour: number; score: number }[] {
  const dayMs = dayStartMs(nowMs);
  const _todayKey = todayKey(nowMs);
  const sleepSum = healthStore.getSleep(_todayKey);
  // ★ 解析复用 lib/sleepTime.parseClockMinutes（唯一解析实现；兼容 "HH:mm" 与原生完整 datetime）
  const parseHM = (s: string | null | undefined): number | null => {
    const min = parseClockMinutes(s);
    return min == null ? null : min / 60;
  };
  const bedH = parseHM(sleepSum?.sleepTime);
  const wakeH = parseHM(sleepSum?.wakeTime);
  const bedHour = bedH != null ? Math.floor(bedH) : 0;
  const wakeHour = wakeH != null ? Math.floor(wakeH) : 7;

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
  const _today = _dayKey(nowMs);  // ★ 补零格式
  const hrvBaseline = awakeHrv.length >= 3 ? awakeHrv.reduce((a,b)=>a+b,0)/awakeHrv.length : (healthStore.getDay('hrv' as any, _today)?.mean ?? 55);
  const snsBaseline = awakeSns.length >= 3 ? awakeSns.reduce((a,b)=>a+b,0)/awakeSns.length : (healthStore.getDay('sns' as any, _today)?.mean ?? 30);

  const hourly: { hour: number; score: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const hourStart = dayMs + h * 3600000;
    const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, hourStart, hourStart + 3600000, { maxPoints: 50 });
    const snsPts = healthStore.getTimeRange('sns' as MetricKey, hourStart, hourStart + 3600000, { maxPoints: 50 });
    const hrvMean = hrvPts.length > 0 ? hrvPts.reduce((a,p)=>a+p.v,0)/hrvPts.length : null;
    const snsMean = snsPts.length > 0 ? snsPts.reduce((a,p)=>a+p.v,0)/snsPts.length : null;
    let score = 0, w = 0;
    if (hrvMean != null && hrvBaseline > 0) { score += ((hrvBaseline - hrvMean) / hrvBaseline) * 50; w++; }
    if (snsMean != null && snsBaseline > 0) { score += ((snsMean - snsBaseline) / snsBaseline) * 50; w++; }
    if (w === 0) score = 0;
    hourly.push({ hour: h, score: Math.round(clamp(score, 0, 100)) });
  }
  return hourly;
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

function buildLoadReason(p: { hrvDev: number | null; vtiDev: number | null; snsDev: number | null; loadLevel: LoadLevel }): string {
  const parts: string[] = [];
  if (p.hrvDev != null) {
    const sign = p.hrvDev >= 0 ? '↑' : '↓';
    parts.push(`HRV${sign}${Math.round(Math.abs(p.hrvDev) * 100)}%`);
  }
  if (p.vtiDev != null) {
    const sign = p.vtiDev >= 0 ? '↑' : '↓';
    parts.push(`血管张力${sign}${Math.round(Math.abs(p.vtiDev) * 100)}%`);
  }
  if (p.snsDev != null && p.hrvDev != null && p.hrvDev < -0.03) {
    parts.push(`交感↑${Math.round(p.snsDev * 100)}%`);
  }
  if (parts.length === 0) return '数据不足';
  return `${labelForLevel(p.loadLevel)} · ${parts.join('，')}`;
}

function buildFatigueReason(p: { fatigueIndex: number; highLoadRatio: number; recoveryCapacity: number | null; tempDev: number | null }): string {
  const parts: string[] = [];
  if (p.highLoadRatio > 0) parts.push(`高负荷时段占 ${p.highLoadRatio}%`);
  if (p.recoveryCapacity != null) {
    if (p.recoveryCapacity < 0.7) parts.push('恢复能力显著下降');
    else if (p.recoveryCapacity < 0.85) parts.push('恢复能力略差');
  }
  if (p.tempDev != null && p.tempDev > 0.005) parts.push('体温偏高');
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
