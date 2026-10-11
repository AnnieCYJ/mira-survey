/**
 * Cognitive Load & Fatigue Detection — 规则融合 (Rule-Based Fusion)
 * ------------------------------------------------------------------
 * 参考:
 *   - Wellby (Laiti et al., IEEE Trans Affective Computing 2026, DOI 10.1109/TAFFC.2025.3628467)
 *     轻量化 wearable PPG 管道：时域 HRV + 基线问卷 → AUC-ROC 91.60% (stress) / 85.84% (fatigue)
 *   - CogWatch (Dankovich et al., HardwareX 2024, DOI 10.1016/j.ohx.2024.e00538)
 *     开源认知负荷腕表平台；传感器权重: GSR 35-40% / HRV 30-35% / SkinTemp 15-20% / IMU 10-15%
 *   - Kim et al. (HCIS 2023, DOI 10.22967/hcis.2023.13.027)
 *     腕带传感器 + SHAP 特征归因的认知负荷识别：确认 HRV/EDA 频域特征为主要贡献项
 *     （替代原"ChatPPG 2026 review"——该来源经核查为厂商博客而非同行评审综述，已撤下）
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
import { computeSleepPersonalized } from './sleepPersonalized';
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
  /**
   * 当前口径下「正常睡眠」对应的 `sleepRecovery` 值（相对口径 0.5 / 绝对口径 0.75）。
   * ★ v18.144：判「恢复好坏」必须与它比较，**禁止写死 0.75 或 0.5** ——
   *   否则口径从绝对切到相对的那天，所有文案会集体偏移约 25 分负荷。
   */
  sleepRecoveryNeutral: number;
  loadLevel: LoadLevel;
  loadReason: string;
  /** 疲劳指数 0-100 (积累量, 高负荷时段占比 × 恢复延迟惩罚) */
  fatigueIndex: number;
  fatigueLevel: FatigueLevel;
  fatigueReason: string;
  /** 全天逐小时负荷分 (0-23), hasData=false 表示该小时无 HRV/SNS 数据 (score=0 仅占位) */
  hourly: { hour: number; score: number; hasData: boolean }[];
  /**
   * ★ v18.127：全天逐小时**瞬时**疲劳度（0-100，与 hourly.score 累积量并列，不替换它）。
   *
   * 为什么需要（用户实锤：「柱子不应该逐渐升高吧？」）：
   *   `hourly[].score` 来自 lex-fatigue 风格的 ODE **累积**模型 ——
   *   清醒期 `energy -= fatigueDrive * DT` 单调递减、**没有回血**，所以疲劳只会越积越高。
   *   一天下来曲线必然是一路爬升的斜坡（实测 `10:1 11:5 12:8 13:12 … 17:27`）。
   *   那画的是「今天一共消耗了多少脑力」，不是「此刻有多累」——
   *   用户在卡片上看到的是「柱子在爬」，会以为状态越来越差，但这与「低疲劳」矛盾。
   *
   * 业界口径（WHOOP / Oura 的 readiness 都是**状态量**而非累积量）：
   *   readiness = f(HRV vs 个人基线, RHR, 睡眠) 的**当前状态**，不随时间单调下降。
   *   本字段就是这个状态量：**该小时的唤醒偏离程度**（HRV 掉 / SNS 升 = 当时累不累），
   *   不含「清醒着就在用脑」的基础累积、不含睡眠债加速、不做跨小时积分。
   *   ⇒ 平稳的一天 = 柱子**基本等高**；有压力事件/HRV 掉的时段才凸起。
   *
   * hasData 判定沿用 hourly（该小时真有戒指 HRV 采样），保证两序列缺口对齐。
   */
  hourlyInstant: { hour: number; score: number; hasData: boolean }[];
  /** 全天**瞬时**疲劳度均值（仅统计有数据的小时）；柱状图与 chip 档位都用它 */
  avgFatigueInstant: number | null;
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
  /**
   * 睡眠恢复因子 (v2 核心, 0-1)。
   * ★ v18.144 起**复用 `computeSleepPersonalized()`**（与首页睡眠恢复卡同源同口径），
   *   且**可以为 null** = 没有「昨晚这一觉」。
   * ⚠ 消费方禁止 `|| 0.75` 兜底 —— 那会凭空做出一本假账
   *   （v18.95 用户实锤过：一晚没连戒指，首页照样出现脑力值）。
   *   正确做法：显式判 null 并显示「—」。
   * ⚠ 口径提示：相对口径下 `0.5` 是「和平时一样」，绝对口径下中性点是 `0.75`
   *   ⇒ **不要用固定阈值判好坏**，用报告里的 `sleepRecoveryNeutral`。
   */
  sleepRecovery: number | null;
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
  //   ★ v18.95 全部可空：账户完全建立在「睡眠恢复」上，最近两晚无真实睡眠记录 → null（诚实空态）。
  /** 早上的脑力储备 = 早起认知准备度 (0-100)；最近两晚无真实睡眠记录 → null */
  brainReserve: number | null;
  /** 今日已消耗脑力 (储备 − 剩余, 0-100)；无睡眠记录 → null */
  brainUsed: number | null;
  /**
   * 脑力账户所用睡眠的日期 key（'YYYY-MM-DD'）；null = 无睡眠数据（账户整体为空）。
   * ★ v18.98（用户口径：对齐 Oura）：这里**只可能是今晚（昨天 key 但起床在今早）或今天**，
   *   更早的睡眠归档一律不算数 → 账户直接置空（UI 显示「—」）。
   *   不再给旧数据打「昨」标 —— 没昨晚的睡眠就该是空态，而不是拿旧数 + 一行说明。
   */
  brainSleepDate: string | null;
  /** 当前节律能量位置 (0-100, Process C 参考值, 不参与余额计算) */
  circadianEnergy: number;
  /** 当前脑力余额 (0-100, = 100 − 当前疲劳度)；无睡眠记录 → null */
  brainRemaining: number | null;
  /** ★ 2026-10-06：48 槽能量线（准备度唯一数据源，与圆环同源同粒度） */
  energyHalfHourly?: { slot: number; value: number; hasData: boolean }[];
  /** ★ 2026-10-06 A+C：今日已用脑量（真实累计消耗）。无睡眠时也有值 → UI 改显它而非杠 */
  brainUsedToday?: number | null;
  /** ★ 起点来源：measured=实测晨起 / avg14=14 天均值（无睡眠时借用） / none=无 */
  readinessBaselineKind?: 'measured' | 'avg14' | 'none';
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
  // 脑力准备度：睡眠后的自主神经状态为主，固定昼夜曲线只做小修正。
  // 脑力消耗仍由 hourlyRes / loadEvent 独立累计，两者不混成一个分数。
  const term =
    0.40 * params.sleepRecoveryFactor +
    0.05 * circ +
    0.15 * (1 - params.cumulativeLoad / 100) +
    0.40 * (params.hrvNow != null && params.hrvBaseline != null && params.hrvBaseline > 0
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
/**
 * ★ 2026-10-06（认知锚定 · B 方案）夜间自主神经（HRV + 静息心率）聚合与基线
 *
 * 为什么要换掉「睡眠分主导」：见 ALGORITHM_REFERENCES.md 与 2026-10-05 17:08 评估。
 *  Oura 官方把准备度的 7 个贡献因子拆成「autonomic 4 个（HRV平衡/RHR/体温/恢复指数）
 *  + 睡眠 1 个 + 活动 2 个」——autonomic 是主轴，睡眠只是辅助之一。
 *  文献侧：Eur J Appl Physiol 2025（n=94）夜间 HRV 预测次日准备度 73% vs 早晨 HRV 51%；
 *  睡眠医学 2024（n=127）前半夜 HRV 增幅 <15% 者次日功率输出差 12%；
 *  Ann Intern Med/Sage：夜间副交感张力增幅是自发认知表现的唯一显著预测因子，
 *  而「睡眠时长」在多项研究中未达统计显著。
 *
 * 口径（全部相对**个人 14 天基线**，锚点 = 和平时一样，不做绝对人群阈值）：
 *   HRV  夜间均值 vs 14 天夜间均值 → zHRV（越高越好）
 *   RHR  夜间最低心率 vs 14 天     → zRHR（越低越好，方向反转）
 *   睡眠 时长/效率（相对个人需求与基线）→ zSleep（辅助，权重最小）
 */

/** 单夜自主神经快照（无数据 → null 字段） */
export interface NightAutonomic {
  /** 睡眠窗内 HRV 均值（RMSSD ms 量纲由戒指决定） */
  hrvMean: number | null;
  /** 睡眠窗内静息心率（取最低心率，Oura 口径） */
  rhrMin: number | null;
  /** 睡眠窗内样本数（过少则不可信） */
  hrvSamples: number;
}

/**
 * 取某个自然日的「睡眠窗内」HRV/静息心率。
 * 睡眠窗优先用该日 SleepSummary 的 sleepTime/wakeTime；没有就用默认 23:00–07:00。
 * 跨夜处理：入睡在 23 点前、起床在次日早晨 → 区间要跨天，用毫秒区间直接取。
 */
export function nightAutonomicOf(dayMs: number, sleepWindow: { bedHour: number; wakeHour: number } | null): NightAutonomic {
  const empty: NightAutonomic = { hrvMean: null, rhrMin: null, hrvSamples: 0 };
  const dayStart = dayStartMs(dayMs);
  const bedH = sleepWindow?.bedHour ?? 23;
  const wakeH = sleepWindow?.wakeHour ?? 7;
  const s = dayStart + bedH * 3600000;
  // 跨夜（bed > wake）→ 结束时间落到次日
  const rawEnd = dayStart + wakeH * 3600000;
  const e = wakeH <= bedH ? rawEnd + 86400000 : rawEnd;
  if (!(e > s)) return empty;

  const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, s, e, { maxPoints: 500 });
  if (hrvPts.length === 0) return empty;
  const hrvMean = hrvPts.reduce((a, p) => a + p.v, 0) / hrvPts.length;

  // 静息心率：睡眠窗内最低心率（Oura 用夜间最低 RHR 作贡献因子）
  const hrPts = healthStore.getTimeRange('hr' as MetricKey, s, e, { maxPoints: 500 });
  const rhrMin = hrPts.length > 0 ? Math.min(...hrPts.map((p) => p.v)) : null;

  return { hrvMean, rhrMin, hrvSamples: hrvPts.length };
}

/**
 * 睡眠窗（某夜），供夜间聚合复用；无睡眠归档时用默认夜窗。
 *
 * ★ 2026-10-06 修正（真机 COG-NIGHT 日志实锤）：跨午夜睡眠（入睡 01:12 / 起床 10:38）
 *   按「起床日」归档 —— 起床在今天 → SleepSummary 落在**今天**的 key；
 *   但若起床在下午（起床 ≥ 12:00，判定为更旧的白天存档），该条会落在**昨天**的 key。
 *   原实现只查当天 key → 后者取不到睡眠窗 → 退回默认 23:00–07:00 → 夜间 HRV 落空（n=0）→ zHRV 缺。
 *   现在两处都查（今天 → 昨天），与 `sleepSourceDate` 的判定口径一致。
 */
function nightWindowOf(dayMs: number): { bedHour: number; wakeHour: number } | null {
  const today = healthStore.getSleep(_dayKey(dayMs));
  const pick = (sum: typeof today): { bedHour: number; wakeHour: number } | null => {
    if (!sum || sum.total <= 0) return null;
    const bedH = parseClockMinutes(sum.sleepTime);
    const wakeH = parseClockMinutes(sum.wakeTime);
    if (bedH != null && wakeH != null) {
      return { bedHour: Math.floor(bedH / 60), wakeHour: Math.floor(wakeH / 60) };
    }
    if (sum.getUp > 0) {
      return {
        bedHour: Math.floor((sum.getUp - sum.total) / 60 + 24) % 24,
        wakeHour: Math.floor(sum.getUp / 60),
      };
    }
    return null;
  };
  return pick(today) ?? pick(healthStore.getSleep(dayKey(-1, dayMs)));
}

/**
 * 夜间自主神经相对基线的偏离（z-score 口径）。
 *  - zHRV > 0：昨夜 HRV 高于平时 → 恢复好（+）
 *  - zRHR < 0：昨夜最低心率低于平时 → 恢复好（+）
 *  - zSleep：时长/效率相对个人基线（辅助）
 * 返回 { zHRV, zRHR, zSleep, nDays }；样本不足 → 对应项 null。
 */
export function nightAutonomicZ(nowMs: number): {
  zHRV: number | null; zRHR: number | null; zSleep: number | null; nDays: number;
  _dbg?: {
    win: { bedHour: number; wakeHour: number } | null;
    tonightHrv: number | null; tonightSamples: number; tonightRhr: number | null;
    hrvHistN: number; rhrHistN: number; hrvHist: number[]; rhrHist: number[];
  };
} {
  // 昨夜窗口（今天凌晨那一夜）
  const win = nightWindowOf(nowMs) ?? { bedHour: 23, wakeHour: 7 };
  const today = nightAutonomicOf(nowMs, win);

  // 过去 14 天同口径基线
  const hrvHist: number[] = [];
  const rhrHist: number[] = [];
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = nowMs - i * 86400000;
    const w = nightWindowOf(d) ?? { bedHour: 23, wakeHour: 7 };
    const n = nightAutonomicOf(d, w);
    if (n.hrvMean != null && n.hrvSamples >= 4) hrvHist.push(n.hrvMean);
    if (n.rhrMin != null) rhrHist.push(n.rhrMin);
  }

  // z：用中位数 + MAD 估基线离散度（抗离群），与 cortisolProxy 同一套口径。
  // ⚠ MAD 可能为 0（14 天里该指标几乎不变，如静息心率常年在 ±1bpm）→ 直接除会爆出
  //   ±1e6 的假 z 值（真机实测 zRHR=-1000000）。故设下限：HRV/RHR 用各自的最小标准差。
  const zOf = (cur: number | null, hist: number[], minSd: number): number | null => {
    if (cur == null || hist.length < 3) return null;
    const med = medianOf(hist);
    const mad = medianOf(hist.map((v) => Math.abs(v - med)));
    const sd = Math.max(minSd, mad * 1.4826);
    // 再夹一道安全上限：单点离群不超过 ±4σ（z>4 视为异常，不让它主导分数）
    return Math.max(-4, Math.min(4, (cur - med) / sd));
  };

  // 睡眠时长 z（辅助）：今夜睡眠总时长 vs 14 天平均
  const durs: number[] = [];
  let curDur: number | null = null;
  for (let i = 0; i <= DAYS_BACK; i++) {
    const d = nowMs - i * 86400000;
    const s = healthStore.getSleep(_dayKey(d));
    if (s && s.total > 0) {
      if (i === 0) curDur = s.total;
      else durs.push(s.total);
    }
  }

  return {
    // 最小标准差下限：HRV 以 ms 计（1ms）、RHR 以 bpm 计（1bpm）——量纲不同，不能共用同一 epsilon
    zHRV: zOf(today.hrvMean, hrvHist, 1),      // 越高越好
    zRHR: zOf(today.rhrMin, rhrHist, 1),        // 越低越好（方向在下面反转）
    zSleep: zOf(curDur, durs, 10),               // 分钟
    nDays: hrvHist.length,
    // ★ 诊断用（供 __DEV__ 日志核对夜间取数为何为空）
    _dbg: {
      win,
      tonightHrv: today.hrvMean, tonightSamples: today.hrvSamples, tonightRhr: today.rhrMin,
      hrvHistN: hrvHist.length, rhrHistN: rhrHist.length,
      hrvHist: hrvHist.slice(0, 5), rhrHist: rhrHist.slice(0, 5),
    },
  };
}

/**
 * ★ 2026-10-06（A+C 方案，用户拍板）历史晨起准备度均值 —— 无睡眠时的曲线起点
 *
 * 背景：认知锚定 B 方案后，晨起起点吃「夜间 HRV/静息心率」，而这两项都取自睡眠窗。
 *   ⇒ 当**今夜没有睡眠归档**时（没戴戒指/忘了戴），起点为 null → 储备/剩余/曲线全为 null，
 *      首页与详情页只能显「—」。这虽诚实，但把「白天明明有真实用脑信号」也一起抹掉了。
 *
 * A 方案：无睡眠时用**过去 14 天各夜晨起准备度的均值**当起点（借一个稳定的起点），
 *   让白天的真实耗竭（HRV↓+SNS↑）仍能画出曲线、算出「今日已用脑量」。
 *   ⚠ 诚实标注：UI 需注明「起点为 14 天平均」，不得让用户误以为这是今晨实测值。
 * C 方案：此时顶部数字改显**真实累计消耗**（起点 − 当前能量），而不是「剩余百分比」。
 *
 * 样本不足（<3 个有效夜）→ 返回 null，UI 显「—」，不猜。
 */
export function averageMorningReadiness(nowMs: number): number | null {
  const vals: number[] = [];
  for (let i = 0; i <= DAYS_BACK; i++) {
    const d = nowMs - i * 86400000;
    const w = nightWindowOf(d);
    if (!w) continue;                                  // 该夜无睡眠归档 → 跳过
    const n = nightAutonomicOf(d, w);
    if (n.hrvMean == null || n.hrvSamples < 4) continue;
    const z = nightAutonomicZ(d);
    // 注意：nightAutonomicZ(d) 内部是「以 d 当天」的昨夜窗口，与此处 w 同口径，
    // 若 z 缺失（HRV/RHR 都不足）则该夜不计入，避免用睡眠分把它顶上来。
    if (z.zHRV == null && z.zRHR == null) continue;
    const dur = healthStore.getSleep(_dayKey(d))?.total ?? null;
    const debt = 0; // 历史睡眠债不重算（无逐日债务数据），保持起点可比
    const r = computeMorningReadinessV2({
      zHRV: z.zHRV, zRHR: z.zRHR, zSleep: dur != null && dur > 0 ? z.zSleep : null,
      debt, peakH: 8, wakeH: w.wakeHour,
    });
    if (r != null) vals.push(r);
  }
  return vals.length >= 3 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * ★ 认知锚定 · B 方案：晨起准备度新公式（B 方案，用户 2026-10-06 拍板）
 *
 * 相对个人基线的恢复度（锚点 50 = 和平时一样）：
 *   recovery = 50 + 50 × tanh( 0.50·zHRV  +  0.30·(−zRHR)  +  0.20·zSleep )
 * 睡眠债每欠 1h −5 分；节律相位 ±8 分。
 *
 * 权重依据：Oura 贡献因子 autonomic 占 4/7、睡眠 1/7；开源 health_dashboard
 * HRV 40% / RHR 25% / 睡眠 35%（且全部转 z-score）。此处取 HRV 50 / RHR 30 / 睡眠 20
 * —— 睡眠只保留 20% 作为辅助，符合"认知锚定"（睡眠只定水箱，不是曲线主轴）。
 *
 * ⚠ 任一必需项缺失 → 不编造，UI 显「—」（由调用方处理 null）。
 */
export function computeMorningReadinessV2(p: {
  zHRV: number | null;
  zRHR: number | null;
  zSleep: number | null;
  debt: number;         // 7 天睡眠债（小时）
  peakH: number;        // 个体化皮质醇峰值时刻（小时）
  wakeH: number | null; // 起床时间（小时，浮点）
}): number | null {
  // autonomic 主轴：HRV 越高越好、RHR 越低越好（方向反转）
  const hrvPart = p.zHRV == null ? null : p.zHRV;
  const rhrPart = p.zRHR == null ? null : -p.zRHR;   // 方向反转：低心率 = 恢复好
  // 缺 HRV 时可用 RHR 顶上；两者都缺 → 返回 null（诚实空态，不拿睡眠分顶替）
  if (hrvPart == null && rhrPart == null) return null;

  const W_HRV = 0.5, W_RHR = 0.3, W_SLEEP = 0.2;
  let acc = 0, wsum = 0;
  if (hrvPart != null) { acc += W_HRV * hrvPart; wsum += W_HRV; }
  if (rhrPart != null) { acc += W_RHR * rhrPart; wsum += W_RHR; }
  if (p.zSleep != null) { acc += W_SLEEP * p.zSleep; wsum += W_SLEEP; }
  if (wsum <= 0) return null;
  // 缺失项按剩余权重归一化（不因为缺 HRV 就偷偷把 RHR 放大到 100%）
  const weighted = acc / wsum;
  const recovery = 50 + 50 * Math.tanh(weighted);

  const circAdj = p.wakeH != null
    ? clamp(50 + 50 * Math.sin(2 * Math.PI * (p.wakeH - p.peakH + 6) / 24), 0, 100) / 100
    : 0.5;
  const debtPenalty = clamp(p.debt, 0, 6) * 5;
  const circShift = (circAdj - 0.5) * 16;
  return Math.round(clamp(recovery - debtPenalty + circShift, 5, 100));
}

export function computeMorningReadiness(p: {
  rec: number;          // sleepRecovery 0-1
  debt: number;         // 7 天睡眠债（小时）
  peakH: number;        // 个体化皮质醇峰值时刻（小时，默认 8）
  wakeH: number | null; // 起床时间（小时，浮点）
}): number {
  const circAdj = p.wakeH != null
    ? clamp(50 + 50 * Math.sin(2 * Math.PI * (p.wakeH - p.peakH + 6) / 24), 0, 100) / 100
    : 0.5;
  // ★ 纯相对口径（2026-10-05 修正）：rec 0→1 线性映射 40→100；睡眠债每欠 1h −5 分；
  //   节律相位 ±8 分。废弃旧的 `rec*80+20` 绝对↔相对切换（曾凭空掉 ~20 分）。
  const base = 40 + 60 * clamp(p.rec, 0, 1);
  const debtPenalty = clamp(p.debt, 0, 6) * 5;
  const circShift = (circAdj - 0.5) * 16;
  return Math.round(clamp(base - debtPenalty + circShift, 5, 100));
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
  // ★ v18.95 诚实守卫（提前声明，mentalEnergy / 脑力账户两处共用）：
  //   今天和昨天都没有真实睡眠记录（total>0）→ 睡眠恢复无从谈起。
  //   此前的兜底（无睡眠按 8h 假设、无债按恢复因子 0.95）会凭空做出一本假账
  //   （用户实锤：一晚没连戒指，首页照样出现脑力值/恢复程度）。
  // ★ v18.98（用户口径：参考 Oura——没昨晚的睡眠就是「—」，不写「昨」、不拿更早的旧数据冒充）：
  //   睡眠恢复只认「昨晚这一夜」= 今天的睡眠摘要，或**昨天那条记录且起床时刻落在今早**
  //   （跨午夜睡眠常被 SDK 记在前一日）。昨天 12 点以后睡的、以及前天/更早的任何归档，
  //   一律不算「昨晚」→ sleepSourceDate = null → 脑力账户/准备度诚实显示「—」。
  const isLastNightSleep = (s: { total?: number; wakeTime?: string | null; getUp?: number | null } | null | undefined): boolean => {
    if (!s || !((s.total ?? 0) > 0)) return false;
    const upMin = s.getUp ?? (s.wakeTime ? (() => {
      const m = /(\d{1,2}):(\d{2})/.exec(String(s.wakeTime));
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    })() : null);
    // 起床在 12:00 之前 ⇒ 这一夜是昨晚睡到今早的；起床 ≥12:00 说明这是更旧的白天存档
    return upMin == null || upMin < 12 * 60;
  };
  const sleepSourceDate: string | null = (() => {
    if (isLastNightSleep(_sleepSum2)) return _todayKey2;
    const yst = healthStore.getSleep(dayKey(-1, nowMs)); // 昨天（跨午夜睡眠常记在前一日）
    return isLastNightSleep(yst) ? dayKey(-1, nowMs) : null;
  })();
  const hasRecentSleep = sleepSourceDate != null;

  // ★ v18.144 **口径统一**：原来这里自己算了一套「两项简化」恢复因子
  //   （0.6×时长充足性 + 0.4×深睡占比，只用 `_sleepSum2`），与首页睡眠恢复卡
  //   用的 `sleepScore` 四项加权**完全不是一回事** ⇒ 同一个「睡眠」两处数字对不上。
  //   ⇒ 改为复用 `computeSleepPersonalized()`（同一份基线、同一套口径）。
  //
  // ⚠ 顺带修一个隐藏 bug：旧实现只在 `_sleepSum2`（今天那条）有数据时才算，
  //   但 `hasRecentSleep` 判定用的是 `sleepSourceDate`（**含昨天那条**）
  //   ⇒ 跨午夜睡眠记在前一日时，`hasRecentSleep=true` 却走 `sleepRecovery=0.75` 默认值。
  //   现在两者同源。
  const sleepPers = (() => { try { return computeSleepPersonalized(); } catch { return null; } })();
  /** 睡眠恢复 0-1；null = 没有「昨晚这一觉」，调用方必须显式处理（诚实空态） */
  let sleepRecovery: number | null = null;
  /**
   * 「正常睡眠」在该口径下对应的 recovery 值 —— loadScore 的中性点。
   * ⚠ 必须随口径切换，否则换口径会整体平移脑力负荷：
   *   绝对口径：0.75 = 睡够 7.5h + 深睡达标（原实现的「良好」水平）
  *   相对口径：0.50 = 和自己平时一样（相对分的锚点）
   */
  let sleepRecoveryNeutral = 0.75;
  if (sleepPers?.score != null) {
    sleepRecovery = sleepPers.score / 100;
    sleepRecoveryNeutral = sleepPers.mode === 'relative' ? 0.5 : 0.75;
  } else if (_sleepSum2 && _sleepSum2.total > 0) {
    // sleepPersonalized 不可用（异常）时退回旧算法，别让整份报告空掉
    const sleepHours = _sleepSum2.total / 60;
    const deepRatio = _sleepSum2.deep / _sleepSum2.total;
    const durationAdequacy = clamp((sleepHours - 6) / 2, 0, 1);
    const deepBonus = clamp((deepRatio - 0.12) / 0.08, 0, 1);
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
  // ★ v18.144：睡眠恢复**相对该口径的中性点**计偏差，而不是「离满分还差多少」。
  //   旧式 `40 + (1 - rec)*35` 的隐含前提是「rec 越接近 1 越好」，但相对口径下
  //   rec=0.5 才是「和平时一样」⇒ 用旧式会让日常用户凭空多背 ~17 分负荷。
  //   rec 为 null（没有昨晚睡眠）⇒ 偏差按 0 计（不额外加负荷），由 UI 显「—」。
  const sleepRecDev = sleepRecovery == null ? 0 : (sleepRecoveryNeutral - sleepRecovery);
  loadScore = clamp(40 + sleepRecDev * 35 + debtPenalty + hrContrib * 0.5, 0, 100);

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
  // ★ v18.144：rec 为 null 时传中性点，**不要传 0**（0 会被算成「恢复极差」）。
  //   真正的「没有昨晚睡眠」由 `hasRecentSleep` 在 UI 层显「—」处理。
  // ★ 2026-10-06（认知锚定 B 方案，用户拍板）：晨起起点改为**夜间自主神经主轴**
  //   （夜间 HRV 50% / 夜间静息心率 30% / 睡眠时长 20%，全部相对个人 14 天基线的 z-score）。
  //   依据：Oura 贡献因子 autonomic 占 4/7、睡眠仅 1/7；Eur J Appl Physiol 2025 夜间 HRV
  //   预测次日准备度 73% vs 早晨 51%；睡眠时长在多项认知研究未达统计显著。
  //   夜间 autonomic 数据缺失 → 退回旧公式（睡眠分口径），保证不出现「无数据却给分」。
  const _nightZ = nightAutonomicZ(nowMs);
  const _morningV2 = computeMorningReadinessV2({
    zHRV: _nightZ.zHRV, zRHR: _nightZ.zRHR, zSleep: _nightZ.zSleep,
    debt: sleepDebt, peakH: _acrophase, wakeH: _wakeMin != null ? _wakeMin / 60 : null,
  });
  // ★ A 方案兜底：今夜无睡眠 → V2 必为 null（夜间信号取自睡眠窗）→ 用 14 天各夜晨起准备度均值当起点。
  //   这样白天真实的耗竭（HRV↓+SNS↑）仍能画曲线、算消耗量；UI 需标注"起点为 14 天平均"。
  const _morningAvgBaseline = hasRecentSleep ? null : averageMorningReadiness(nowMs);
  const morningReadiness = _morningV2
    ?? _morningAvgBaseline
    ?? computeMorningReadiness({
      rec: sleepRecovery ?? sleepRecoveryNeutral, debt: sleepDebt, peakH: _acrophase,
      wakeH: _wakeMin != null ? _wakeMin / 60 : null,
    });
  if (__DEV__) {
    const d = (_nightZ as any)._dbg;
    console.log(`[COG-ANCHOR] zHRV=${_nightZ.zHRV?.toFixed(2) ?? '—'} zRHR=${_nightZ.zRHR?.toFixed(2) ?? '—'} zSleep=${_nightZ.zSleep?.toFixed(2) ?? '—'} days=${_nightZ.nDays} v2=${_morningV2 ?? '—'} avg14=${_morningAvgBaseline ?? '—'} hasSleep=${hasRecentSleep} final=${morningReadiness}`);
    if (d) console.log(`[COG-NIGHT] win=${JSON.stringify(d.win)} tonightHrv=${d.tonightHrv?.toFixed(1) ?? '—'} n=${d.tonightSamples} tonightRhr=${d.tonightRhr ?? '—'} hrvHistN=${d.hrvHistN} rhrHistN=${d.rhrHistN} hrvHist=[${d.hrvHist.map((v: number) => v.toFixed(0)).join(',')}] rhrHist=[${d.rhrHist.join(',')}]`);
  }
  const hourlyRes = computeHourlyLoad(nowMs, { initEnergy: morningReadiness, acrophaseH: _acrophase });
  const hourly = hourlyRes.hourly;
  // ★ debug: 暴露 hourly 到 global
  (global as any).__cogHourlyDebug = hourly.filter(h => h.score > 0).map(h => `${h.hour}:${h.score}`).join(',');
  // ★ v18.127：瞬时疲劳度（状态量）诊断 —— 与上面的累积量并列，便于真机核对柱子是否等高
  (global as any).__cogInstantDebug = hourlyRes.hourlyInstant.filter(h => h.hasData).map(h => `${h.hour}:${h.score}`).join(',');

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

  // ★ v18.144：文案层只需「相对中性是好还是差」，null 传中性点即可（UI 已另行显「—」）
  const _recForText = sleepRecovery ?? sleepRecoveryNeutral;
  const loadReason = buildLoadReason({ hrvDev, vtiDev, snsDev, loadLevel, sleepRecovery: _recForText, sleepDebt });
  const fatigueReason = buildFatigueReason({ fatigueIndex, highLoadRatio, recoveryCapacity, tempDev, sleepRecovery: _recForText, sleepDebt });

  // ── 8. 极值时段 (互斥 + bestSpan 重新定义) ─────────────────
  // ★ v18.130：统一走 cogLevel()（40/70），与柱高/柱色同源。
  //   旧实现用 20/40/65 三档、柱色柱高用 40/70 —— **两套标准并存**，
  //   导致遮罩说「高峰」而柱子却是低档绿，视觉自相矛盾（用户反馈「详情页全是低疲劳」）。
  function classify(h: { hour: number; score: number }): 'high' | 'mid' | 'low' | 'empty' {
    if (!Number.isFinite(h.score) || h.score <= 0) return 'empty';
    const k = cogLevel(h.score);
    return k === 'high' ? 'high' : k === 'mid' ? 'mid' : 'low';
  }
  function mergeRanges(target: Set<string>, minLen = 1): { startHour: number; endHour: number; avgScore: number; hours: number[] }[] {
    const ranges: { startHour: number; endHour: number; scores: number[]; hours: number[] }[] = [];
    let cur: { startHour: number; endHour: number; scores: number[]; hours: number[] } | null = null;
    // ★ v18.130：改用 hourlyInstant（瞬时/状态量），与柱状图同数据源
    for (const h of hourlyRes.hourlyInstant) {
      const cls = classify(h);
      if (!target.has(cls)) { cur = null; continue; }
      if (cur && h.hour === cur.endHour + 1) { cur.endHour = h.hour; cur.scores.push(h.score); cur.hours.push(h.hour); }
      else { if (cur && cur.scores.length >= minLen) ranges.push(cur); cur = { startHour: h.hour, endHour: h.hour, scores: [h.score], hours: [h.hour] }; }
    }
    if (cur && cur.scores.length >= minLen) ranges.push(cur);
    return ranges.map(r => ({ startHour: r.startHour, endHour: r.endHour, avgScore: Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length), hours: r.hours }));
  }

  // Step 1: peakLoadSpan（高/中档 = 疲劳明显偏高的时段）
  const peakLoadSpan = (() => {
    const ranges = mergeRanges(new Set(['high', 'mid']), 1);
    if (ranges.length === 0) return null;
    return ranges.reduce((a, b) => ((b.endHour - b.startHour) + b.avgScore / 50) > ((a.endHour - a.startHour) + a.avgScore / 50) ? b : a);
  })();

  // Step 2: bestSpan 后选 — 互斥 + 重新定义
  //   认知最佳 ≠ 负荷最低 (calm 可能是睡觉/发呆)
  //   认知最佳 = 白天(8-20) + **低档**（疲劳最低 = 脑力状态最好）
  //   排除所有 peakLoadSpan 覆盖的 hour
  const bestSpan = (() => {
    const peakHours = new Set(peakLoadSpan?.hours ?? []);
    const filtered = mergeRanges(new Set(['low']), 1)
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

  // ★ v18.95：mentalEnergy 睡眠权重 40%，无真实睡眠记录时与脑力账户一起置 null（诚实空态）
  const mentalEnergy = hasRecentSleep ? computeMentalEnergy({
    hrvNow, hrvBaseline,
    sleepRecoveryFactor,
    circadianHour,
    cumulativeLoad: loadScore,
  }) : null;
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
  // ★ v18.95 诚实守卫：无真实睡眠记录 → 「剩余百分比」返回 null（首页显「—」）。
  // ★ 2026-10-06 A+C：但**今日已用脑量是真实的**（从 14 天平均起点到此刻的实测耗竭），
  //   它不依赖今晨睡眠，由白天 HRV↓/SNS↑ 逐步累加得出 → 无睡眠时照常给出，不编造。
  const brainReserve: number | null = hasRecentSleep ? morningReadiness : null;
  const circadianEnergy = clamp(Math.round(
    50 + 50 * Math.sin(2 * Math.PI * (circadianHour - _acrophase + 6) / 24)
  ), 0, 100);
  const _energyNowRaw = clamp(hourlyRes.energyNow, 0, 100);
  // 起点为 14 天均值（无睡眠）时，"剩余"这个百分比概念不成立 → 仍给 null；
  //   但能量线本身（hourlyRes.energyHalfHourly）是真实耗竭轨迹，UI 画曲线用。
  let brainRemaining: number | null = hasRecentSleep ? _energyNowRaw : null;
  /** ★ A+C：今日已用脑量（真实累计消耗）——无睡眠时也能算，UI 改显这个而非杠 */
  const brainUsedToday: number | null = (() => {
    if (hourlyRes.energyHalfHourly?.some((p) => p.hasData)) {
      return clamp(Math.round(morningReadiness - _energyNowRaw), 0, 100);
    }
    return null;
  })();
  /** ★ 起点来源标注，供 UI 诚实说明（"起点为 14 天平均" vs 实测晨起） */
  const readinessBaselineKind: 'measured' | 'avg14' | 'none' =
    hasRecentSleep && _morningV2 != null ? 'measured'
      : _morningAvgBaseline != null ? 'avg14'
        : 'none';
  let brainUsed: number | null =
    brainReserve != null && brainRemaining != null ? clamp(brainReserve - brainRemaining, 0, 100) : null;

  // ── 全天平均疲劳度（仅统计有数据的小时），与柱状图同源，作为卡片大数字 ──
  const _fatigueScores = hourly.filter(h => h.hasData).map(h => h.score);
  const avgFatigue = _fatigueScores.length > 0
    ? Math.round(_fatigueScores.reduce((a, b) => a + b, 0) / _fatigueScores.length)
    : null;

  // ── 第二步: 实时负荷检测 + 动态修正 ────────────────────
  const loadEvent: CognitiveLoadEvent | null = detectCognitiveLoad(
    hrvBaseline ?? 55, snsBaseline ?? 30, nowMs,
  );
  if (loadEvent && brainRemaining != null && brainUsed != null && brainReserve != null) {
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
    // ★ v18.127：瞬时疲劳度（状态量）——柱状图与 chip 档位改用它，累积量 hourly 保留给脑力账户
    hourlyInstant: hourlyRes.hourlyInstant,
    // ★ 2026-10-06：48 槽能量线挂到 report，供 cognitiveReadiness 直接取用（准备度唯一数据源）
    energyHalfHourly: hourlyRes.energyHalfHourly,
    avgFatigueInstant: (() => {
      const xs = hourlyRes.hourlyInstant.filter(h => h.hasData).map(h => h.score);
      return xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    })(),
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
    /** ★ v18.144 可为 null（没有昨晚睡眠）—— 消费方必须显式处理，别 `|| 0.75` */
    sleepRecovery: sleepRecovery,
    /**
     * 当前口径下「正常睡眠」对应的 recovery 值（相对口径 0.5 / 绝对口径 0.75）。
     * ★ v18.144：判「恢复好坏」必须与它比较，**不要写死 0.75 或 0.5** ——
     *   否则口径从绝对切到相对的那天，所有文案会集体偏移 ~25 分负荷。
     */
    sleepRecoveryNeutral,
    sleepDebt: Math.round(sleepDebt * 10) / 10,
    circadianPeakH: cortisolResult?.cosinor?.acrophaseH != null && Number.isFinite(cortisolResult.cosinor.acrophaseH)
      ? Math.round(cortisolResult.cosinor.acrophaseH * 10) / 10
      : undefined,
    rhythmStatus: cortisolResult?.status?.level,
    loadEvent: loadEvent ?? undefined,
    brainReserve,
    brainUsed,
    brainSleepDate: sleepSourceDate,
    circadianEnergy,
    brainRemaining,
    brainUsedToday,
    readinessBaselineKind,
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
      // ★ v18.127：瞬时（状态量）—— 首页柱状图/chip 档位已改用它；上面 hourlyStr 是累积量
      avgFatigueInstant: result.avgFatigueInstant,
      instantStr: result.hourlyInstant.filter(h => h.hasData).map(h => `${h.hour}:${h.score}`).join(' '),
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
): {
  hourly: { hour: number; score: number; hasData: boolean }[];
  /** ★ v18.127 瞬时疲劳度（状态量） */
  hourlyInstant: { hour: number; score: number; hasData: boolean }[];
  /** ★ 2026-10-06：48 个半小时槽的脑力能量线（准备度唯一数据源，与圆环同源） */
  energyHalfHourly: { slot: number; value: number; hasData: boolean }[];
  energyNow: number; initEnergy: number; excludedMin: { emotion: number; exercise: number };
} {
  // ══════════════════════════════════════════════════════════════════════
  // ★ 认知准备度能量衰减模型（2026-10-05 认知锚定重建）
  // 核心: 能量 E(t) 从「晨起认知准备度」开局, 白天被**真实用脑**耗竭, 静养不耗。
  //   E(t+dt) = E(t) - fatigueDrive · circSpeed · dt
  //   fatigueDrive = BASELINE_DRIFT(极小被动开销) + arousalDrive(HRV↓+SNS↑, 已剔除运动/情绪)
  //   准备度 = E（能量越高 = 准备度越高; 早上高、随用脑下降 → 与 Oura 身体恢复分拉开）
  // dt = 0.5h (半小时步长), 输出 48 个点
  // 依据: HRV 副交感撤退 + 交感上升至交感主导在持续认知任务中方向一致
  //      (IJMS 2026 脑疲劳生物标志物综述; Sensors 2026 认知负荷评估综述;
  //       Backs & Seljos 1994 持续注意 HRV 抑制)。信号对负荷非特异 → 仅作慢变量 + 排除身体/情绪。
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
  // ★ v18.96（审计 4-4）：旧实现 bedHour/wakeHour 缺省硬编码 0:00–7:00，等于凭空认定
  //   「0–7 点在睡觉」。今天没有真实睡眠记录时**不判睡眠窗**（整天按清醒处理），
  //   夜里若有真实 HRV 采样就如实计入疲劳，而不是被假睡眠窗吞掉。
  //   （睡眠的跨天豁免只用于「展示最近一晚」，不用于编造今天的作息窗。）
  const hasSleepWindow = bedH != null && wakeH != null && bedH !== wakeH;
  const bedHour = bedH != null ? Math.floor(bedH) : 0;
  const wakeHour = wakeH != null ? Math.floor(wakeH) : 7;
  const inSleepWindow = (h: number): boolean => {
    if (!hasSleepWindow) return false;
    return (bedHour < wakeHour) ? (h >= bedHour && h < wakeHour) : (h >= bedHour || h < wakeHour);
  };

  // ── 1. 先算 baseline (全天清醒时段 HRV/SNS) ──
  const awakeHrv: number[] = [];
  const awakeSns: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (inSleepWindow(h)) continue;
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
  // ★ v18.96（审计 2-4）：旧实现 `sleepSum?.total ?? 480` = 无睡眠记录时**按满睡 8h 假设**，
  //   凭空造出一个偏高的起点能量。今天无睡眠记录时改用中性 0.5（不奖不罚），
  //   有记录（含沿用最近一晚）才按真实时长/深睡算。
  const sleepRec = (() => {
    if (!sleepSum || sleepSum.total <= 0) return 0.5;
    const totalMin = sleepSum.total;
    const deepRatio = sleepSum.deep != null && totalMin > 0 ? sleepSum.deep / totalMin : 0.15;
    const durAdequacy = clamp((totalMin / 60 - 6) / 2, 0, 1); // 6h=0, 8h+=1
    const deepBonus = clamp((deepRatio - 0.12) / 0.08, 0, 1);  // 12%=0, 20%+=1
    return clamp(durAdequacy * 0.6 + deepBonus * 0.4, 0.2, 1);
  })();
  // 7 天睡眠债
  let debt = 0;
  for (let i = 0; i < 7; i++) {
    const d = healthStore.getSleep(dayKey(-i, nowMs));
    // ★ v18.96（审计 2-5）：缺失日旧实现按「睡满 8h」处理（`?? 480`）→ 从没戴戒指的那天
    //   反而算出 0 睡眠债、「睡得很好」。缺失 = 未知，不奖不罚，直接跳过。
    if (!d || !(d.total > 0)) continue;
    const h = d.total / 60;
    if (h < 8) debt += (8 - h) * Math.exp(-i / 5);
  }
  debt = clamp(debt, 0, 6);
  const debtAccel = 1 + debt * 0.08;  // 每欠 1h, 疲劳加速 8%

  // ── 3. 节律驱动 (外部传入 cosinor acrophase, 无数据 fallback 8 点) ──
  const acrophaseH = opts?.acrophaseH != null && Number.isFinite(opts.acrophaseH) ? opts.acrophaseH : 8;

  // ── 4. ODE 离散化: 48 个半小时步 ──
  // E(t) = 认知能量 (0-100), fatigue = 100 - E
  const DT = 0.5;  // 半小时
  // ★ 认知锚定衰减系数（2026-10-05 重建）：主轴=真实用脑，基线漂移极小
  //   依据: HRV 副交感撤退 + 交感上升在持续认知任务方向一致(IJMS 2026/Sensors 2026 综述;
  //        Backs & Seljos 1994); 该信号对负荷非特异, 故只作慢变量且排除运动/情绪窗口。
  const BASELINE_DRIFT = 0.2;  // 清醒被动代谢/注意开销(每 h), 极小 → 静养/走神几乎不耗脑
  const ALPHA_HRV = 0.12;      // HRV 偏离 → 用脑耗竭系数(放大, 使真实费脑成为主轴)
  const ALPHA_SNS = 0.09;      // SNS 偏离 → 用脑耗竭系数
  // 旧 ALPHA_AWAKE=1.6(纯时间衰减, 醒着≈3.2 分/h 硬掉)已废弃: 与用没用脑无关, 不是认知信号。
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

  // ★ 晨起能量上限 = 与「早起认知准备度」同一公式（不再用 sleepRec*80+20 绝对映射），
  //   并取 max(自身, 传入 initEnergy) 防止睡眠窗把开局能量错误压低。
  const morningEnergy = clamp(
    Math.max(
      computeMorningReadiness({ rec: sleepRec, debt, peakH: acrophaseH, wakeH }),
      opts?.initEnergy != null ? opts.initEnergy : -1,
    ),
    20, 100,
  );

  // ── 3.5 窗口归因素材（只算脑）──
  const emotionEntries = getEntriesForDay(_today);
  const excludedMin = { emotion: 0, exercise: 0 };
  // 开局能量 = 脑力账户储备（早起认知准备度）；未传时退回睡眠恢复决定的晨起上限
  const initEnergy = opts?.initEnergy != null ? clamp(opts.initEnergy, 20, 100) : morningEnergy;
  let energy = initEnergy;
  const half: { score: number; hasData: boolean }[] = []; // 内部 48 个半步
  // ★ v18.127 瞬时疲劳度（状态量，不累积）：该半小时的唤醒偏离 → 0~100
  const halfInstant: number[] = [];
  // 瞬时档位标定：HRV 掉 20% 或 SNS 升 20% 视为「明显疲劳」= 60 分；
  //   偏离 0 → 15 分（平静）；偏离 100% → 100 分。线性映射后 clamp。
  const INSTANT_BASE = 12;
  const INSTANT_SPAN = 78;
  // ★ 死区：唤醒偏离小于 DEADZONE 直接当 0 —— 生理噪声（HRV 几个百分点的抖动）不该
  //   变成「疲劳一阵一阵」。实测半步级 HRV 掉 13% 才算真偏离，但单半小时掉 3~5% 很常见。
  //   加死区后平稳时段基本等高，只有真实偏离才凸起（用户要的效果）。
  const INSTANT_DEADZONE = 0.05;
  // ★ 最小样本门槛：某半小时只有 1~2 个 HRV 样本时**不判瞬时疲劳**。
  //   实锤（真机 hsE 日志）：13:30 只有 **1 个** 样本 HRV=31、14:30 只有 **2 个** 样本 HRV=33，
  //   而清醒基线是 62.8 → 被算成「掉 50%」→ 瞬时值顶到 90，柱子看起来一阵一阵。
  //   单点噪声不是生理状态。要求该半小时 HRV **≥4 个样本**才计入，否则视为数据不足（不判高疲劳）。
  const INSTANT_MIN_SAMPLES = 4;
  // 归一化分母：arousalDrive 实测有效范围约 0~0.6（HRV 掉 15% + SNS 升 10% ≈ 0.55），
  //   取 1.4 作为满量程 → 轻微偏离只给小幅上升，不会轻易顶到高疲劳档。
  const INSTANT_FULL = 1.4;
  let energyAtNow = initEnergy; // 此刻的能量余额（用于脑力账户）
  // ★ 2026-10-06（用户：所有指标统一 30 分钟一个点）：把整条能量线暴露出去，
  //   供 cognitiveReadiness 直接使用 → 圆环 / 首页 chip / 详情页曲线 / 徽章 全部同源同粒度。
  const energyHalf: { slot: number; value: number; hasData: boolean }[] = [];

  for (let step = 0; step < 48; step++) {
    const halfH = step * 0.5;
    const fullH = Math.floor(halfH);
    const isAsleep = inSleepWindow(fullH);

    if (isAsleep) {
      // 睡眠时: 能量恢复至「本次晨起能量」上限
      // ★ 不再固定 92 —— 旧实现会把睡眠期能量顶到 92，从而把 sleepRec（睡得好不好）
      //   对全天疲劳曲线的影响彻底抹掉
      energy = clamp(energy + 18 * DT, 0, morningEnergy);
      if (dayMs + step * 1800000 < nowMs) energyAtNow = energy;
      energyHalf.push({ slot: step, value: Math.round(energy), hasData: false });
      half.push({ score: 0, hasData: false });
      halfInstant.push(0);
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

    // ── fatigueDrive: 认知锚定耗竭 —— 主轴=真实用脑(HRV↓+SNS↑), 基线漂移极小 ──
    let fatigueDrive = BASELINE_DRIFT * debtAccel;   // 微小被动开销, 乘睡眠债加速
    let arousalDrive = 0;                            // 唤醒偏离: 需归因后才算「脑」
    if (hrvMean != null && hrvBaseline > 0) {
      const hrvDrop = clamp((hrvBaseline - hrvMean) / hrvBaseline, 0, 1);
      arousalDrive += ALPHA_HRV * hrvDrop * 100;
    }
    if (snsMean != null && snsBaseline > 0) {
      const snsRise = clamp((snsMean - snsBaseline) / snsBaseline, 0, 1);
      arousalDrive += ALPHA_SNS * snsRise * 100;
    }
    // 归因裁决: 运动/情绪窗口全剔除; 其余视为认知投入, 计入耗竭(非身体/非情绪的心力消耗)
    if (isExercise || isEmotionEvent) arousalDrive = 0;
    fatigueDrive += arousalDrive;

    // ── 节律只调制「累积速度」(0.9–1.6×)：清晨略慢、下午低谷略快，但不产生「回血」──
    //    旧实现的 recoveryDrive(最大 2.0/h) 与 fatigueDrive(≈1.13/h) 几乎相等，
    //    导致能量全天几乎不降、疲劳度恒在 8–12，曲线与卡片数字双双失去意义。
    const circSpeed = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (halfH - acrophaseH + 12) / 24));

    // ── ODE 更新 ──
    energy = clamp(energy - fatigueDrive * circSpeed * DT, 0, 100);
    if (!inFuture) energyAtNow = energy;
    // ★ 2026-10-06（用户：所有指标统一 30 分钟一个点）：记录整条能量线，
    //   供 cognitiveReadiness 直接用 → 圆环/首页chip/详情页曲线/徽章 全部同源同粒度。
    energyHalf.push({ slot: step, value: Math.round(energy), hasData });

    // ── 计算疲劳度 = 100 - 能量（累积量）──
    half.push({ score: Math.round(100 - energy), hasData });
    // ── v18.127 瞬时疲劳度（状态量）──
    //   只用「唤醒偏离」 arousalDrive（HRV 掉 + SNS 升，归因裁决后），
    //   **不含** BASELINE_DRIFT（被动开销）**不含** debtAccel（睡眠债）**不做积分**。
    //   ⇒ 平稳时段基本等高；只有真实偏离（HRV 掉/SNS 升）才凸起。
    //   归因被剔除的窗口（运动/情绪事件）arousalDrive 已置 0 → 瞬时也低，符合「不是脑力消耗」。
    const dead = Math.max(0, arousalDrive - INSTANT_DEADZONE * INSTANT_FULL);
    // 样本不足 → 退回「基准平静值」，宁可等高也不拿噪声当高疲劳
    const instant = hasData && hrvPts.length >= INSTANT_MIN_SAMPLES
      ? clamp(Math.round(INSTANT_BASE + INSTANT_SPAN * clamp(dead / INSTANT_FULL, 0, 1)), 0, 100)
      : INSTANT_BASE;
    halfInstant.push(instant);
  }

  // ── v18.127：聚合出 hourlyInstant（与 hourly 的 hasData 判定严格一致，两序列缺口对齐）──
  const outInstant: { hour: number; score: number; hasData: boolean }[] = [];
  for (let h = 0; h < 24; h++) {
    const has = !!(half[2 * h]?.hasData || half[2 * h + 1]?.hasData);
    let sc = 0;
    if (has) {
      const vals = [halfInstant[2 * h], halfInstant[2 * h + 1]].filter((v): v is number => v != null);
      sc = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }
    outInstant.push({ hour: h, score: sc, hasData: has });
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
  return {
    hourly: out, hourlyInstant: outInstant,
    energyHalfHourly: energyHalf,
    energyNow: Math.round(energyAtNow), initEnergy: Math.round(initEnergy), excludedMin,
  };
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

/**
 * ★ v18.129 档位**离散柱高**（用户要求：「它只分疲劳度低、中、高三个高度的柱子」）。
 *
 * 为什么要改：
 *   两处柱状图原先都用 `yFor(score)` 连续映射 —— 分数 12 / 16 / 19 会画出三根**不一样高**的柱子，
 *   但它们同属「低」档。用户看到的是「同一档却高低不齐」，视觉上像在说 19 比 12 累得多，
 *   而这既不成立（同档内 12 vs 19 的差别没有量纲意义），也让图看着乱。
 *   按用户口径改成：**柱高只由档位决定，同档等高**。
 *
 * 三档高度（占绘图区高度的比例，0~1）：
 *   低 → 0.34 | 中 → 0.67 | 高 → 1.00
 *   递增且间隔均匀，一眼能数出「几档」；不是线性按分数，避免同档内抖动被放大。
 *
 * 阈值仍只用 COG_LEVEL_LOW / COG_LEVEL_HIGH（70/40），与柱色、Y 轴标签同源。
 */
export const COG_LEVEL_BAR_RATIO: Record<CogLevelKey, number> = {
  low: 0.34,
  mid: 0.67,
  high: 1.0,
};

/** 分数 → 柱高比例（0~1）。无数据返回 null（调用方画占位桩）。 */
export function cogBarRatio(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return COG_LEVEL_BAR_RATIO[cogLevel(score)];
}

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
