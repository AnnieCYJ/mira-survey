/**
 * emotionalStress.ts —— **情绪压力**判定（多信号融合，v18.132）
 *
 * ══ 为什么需要这个模块（v18.125~131 一连串教训的收口）══
 * 旧实现 `lib/stressAlgorithm.ts` 的问题是：
 *   ① **单信号**（只用 EDA）→ 遇运动/设备漂移就误判；
 *   ② 输出**事件次数**当「情绪负荷 19」→ 量纲错、用户读不懂；
 *   ③ 阈值 `z ≥ 1.2` 是拍的，2026-10-03 真机数据里 EDA 整体漂 3 倍
 *      → 12/12 个槽全部触发 → 报出「19 次压力事件」，实为**设备故障**。
 *
 * ══ 文献依据（本轮 WebSearch 已核实，见 MEMORY）══
 * **Bosch et al. 2026-05（arXiv:2605.15756，德国航空航天中心 DLR，19 人 2×3 被试内设计）**：
 *   运动 vs 心理压力对五个信号的分解结果 ——
 *   · **tonic EDA 是唯一对心理压力可靠敏感的信号**（r = 0.48），
 *     且对压力与运动是**加性（additive）响应、无交互** ⇒ 可用运动信号把两者拆开；
 *   · **心率 / 斜方肌 EMG / 呼吸**：几乎完全由运动驱动，对压力任务**无可靠响应**；
 *   · **HRV（RMSSD）**：被运动**严重压制**，对认知负荷只有边际敏感度
 *     ⇒ **HRV 单独不能当压力指标**（这纠正了「原先有 HRV 就能说压力负荷」的错误认知）。
 * **MDPI Sensors 2026《Beyond EDA》综述**：
 *   EDA 标记「交感被激活」但**说不清是什么激活**；EDA+心脏能提高自主神经状态敏感度，
 *   但**不能解决「压力 vs 兴奋 vs 焦虑」** ⇒ 本模块**只分离 运动/设备故障**，
 *   剩下的「情绪压力」是**生理唤醒层面**的表述，不声称读懂主观情绪。
 *
 * ══ 判定规则（三态互斥，优先级从上到下）══
 *   1. **数据异常**（优先于一切）：EDA 相对个人基线整体漂移 → 传感器问题，不出结论。
 *   2. **运动中 / 运动后恢复期**：交给 `lib/motionGate.ts` 判（固件运动段 + MET + 步数 + 心率残差）。
 *      ★ v18.133：旧代码在这里用的是两个**拍的**绝对阈值（`MOVE_STEP_DELTA=250`、
 *      `MOVE_HR_PCT=30`），已删除。步数增量分不开「散步 / 通勤 / 站着不动」，
 *      而 EDA 对运动和心理压力**同样敏感**（Vieluf 2019： treadmill 后 30min 皮温与 EDA 仍高），
 *      不剔干净 ⇒「情绪压力」纯噪声。
 *   3. **情绪压力**：静息且已过恢复期 → EDA 相对基线升高，按 **MAD 稳健 z** 分四档给程度。
 *      ★ v18.133：`z = edaDevPct / 3.0`（把「3% ≈ 1σ」当常数）也是拍的，改为
 *      「该时段基线的 MAD×1.4826」当尺度，并设尺度下限（EDA ≥ 1.5 μS）。
 *
 * ══ 诚实边界（务必保留在 UI 口径里）══
 *   · EDA 能给**生理唤醒的程度**（分档），**不能读出「你为什么紧」**、读不出情绪种类。
 *   · 「情绪压力」= **身体在紧绷**（交感唤醒），不等于心理诊断。
 *   · **运动门控只回答「这次唤醒能不能被运动解释」，不回答「有没有压力」**——
 *     剔除运动后的残余唤醒仍可能是体位/气温/咖啡因/疼痛/经期不适。
 *   · 程度分档的**档位边界**（0.3/0.8/1.5）沿用历史口径 `stressAlgorithm.classifyLevel`，
 *     尺度换成了个人基线 MAD，但**档位本身仍待用户自报回归校准**（见 MEMORY「诚实度铁律」）。
 */

import { healthStore, dayStartMs, type MetricKey } from '../data/healthStore';
import { dayKey as hsDayKey } from '../data/healthStore';
import { MotionGate, MET_ACTIVE, type SportSessionLike } from './motionGate';
import {
  weightedMedian, weightedCenter, weightedRobustScale, poolSamples,
  BASELINE_DAYS as SHARED_BASELINE_DAYS,
  type WeightedSample,
} from './recencyBaseline';
import {
  computeSlotFeatureZs, fuseFeatures, slotSlope, slotStd,
  STRESS_FEATURE_SPECS, type StressFeatureSet,
} from './stressFeatures';
import {
  percentileFromZ, bandOf, confidenceOf, bandNarrative,
  type Confidence, type StressBand,
} from './psychologicalStressScale';
import {
  buildPairs, computeCalibration, shouldShowNumber,
  type CalibrationResult,
} from './selfReportCalibration';

export type EmotionalStressLevel = 'calm' | 'mild' | 'moderate' | 'high';
export type EmotionalStressState = 'noData' | 'deviceFault' | 'moving' | 'stress';

export interface EmotionalStressSlot {
  /** 30min 槽下标 0~47 */
  slot: number;
  /** 该槽判定 */
  state: EmotionalStressState;
  level: EmotionalStressLevel;
  /** EDA 相对个人基线的偏离（%）；无基线为 null */
  edaDevPct: number | null;
  /** HRV 相对基线偏离（%） */
  hrvDevPct: number | null;
  /** 心率相对基线偏离（%） */
  hrDevPct: number | null;
  /** 该半小时步数增量 */
  stepDelta: number;
}

export interface EmotionalStressReport {
  /** 全天有数据槽数 */
  dataSlots: number;
  /** 判定为情绪压力的槽数 */
  stressSlots: number;
  /** 判定为运动中的槽数 */
  movingSlots: number;
  /** 判定为设备异常的槽数 */
  faultSlots: number;
  /** 情绪压力槽占比（0~1，仅 stressSlots / 判定成功槽数） */
  stressRatio: number;
  /** 情绪压力槽的**最高程度**；无则 null */
  peakLevel: EmotionalStressLevel | null;
  /** 情绪压力槽的平均程度 0~100（★ v18.137 起是**百分位**：50=和平时差不多） */
  meanSeverity: number | null;
  /**
   * ★ v18.137 **心理压力 0-100 的完整读数**。UI 优先读这个，别自己拼百分位/档位/文案。
   * 为 null 时（基线不足 / 无有效槽）UI 应显「—」。
   */
  stressScale: {
    /** 0-100，锚点：50 = 和你平时一样、80 = 比平时高出一截 */
    value: number;
    /** 三档（与 `psychologicalStressScale.STRESS_BANDS` 同源） */
    band: StressBand;
    /** 档位文案：用户要求只用「压力低/中/高」三档 */
    bandLabel: string;
    /**
     * 副标：**只写口径，不写档位描述**。
     * ★ v18.138：曾用「相对你自己平时」，用户否决了「今天很松」这类措辞 ——
     *   主文案只要「压力低/中/高」，口径信息放这一行小字即可，不占档位名。
     *   保留它的理由：没有这一行，用户会把 62 读成「压力 62 分」（绝对量）。
     */
    caption: string;
    /** 可信度（由参与信号数决定，不由分数高低决定） */
    confidence: Confidence;
    /** 一句话说明（含降级提示） */
    narrative: string;
  } | null;
  /**
   * ★ v18.140 **自报校准状态**（「算法准不准」的唯一可回答方式）。
   * ⚠ `insufficient` / `invalid` 时 `stressScoreVisible=false` ⇒ 数字位显「—」。
   */
  calibration: CalibrationResult;
  /** 校准通过 ⇒ 可显示 0-100；否则数字位显「—」，只留档位 */
  stressScoreVisible: boolean;
  /** 设备是否判定为漂移（整体超基线 2×）—— UI 应显示「设备数据异常，暂无结果」 */
  deviceDrift: boolean;
  /** 逐槽明细 */
  slots: EmotionalStressSlot[];
  /** 参与判定的基线天数（< MIN_BASELINE_DAYS 不足以判「相对自己」） */
  baselineDays: number;
  /** ★ v18.133 运动门控诊断（研发侧，进 Metro 日志，**不要渲染到 UI**） */
  motionDiag: {
    /** 固件运动段是否可用。false ⇒ 门控只剩 MET/步数/心率三层，力度显著下降 */
    hasFirmwareSessions: boolean;
    gateSummary: string;
    /** 各层命中槽数（看哪一层在起作用、哪一层形同虚设） */
    byReason: Record<string, number>;
    driftZ: number | null;
    edaScalePool: number | null;
  };
  /** ★ v18.134 6 特征融合明细（UI 可展开「哪些信号在贡献」，权重表也放这里） */
  featureDetail: {
    specs: Array<{ key: string; label: string; weight: number; source: string }>;
    bySlot: Array<{
      slot: number;
      fusedZ: number | null;
      usedCount: number;
      weightSum: number;
      entries: Array<{ key: string; z: number | null; contribution: number }>;
    }>;
    avgUsedCount: number;
    /**
     * ★ v18.136 **信号完整度** = 参与特征的权重和（1.0 = 六路全可用；0.48 = EDA 被漂移剔除）。
     * <1 意味着这个数不是满可信的，**UI 必须提示用户**，否则就是在假装精确。
     */
    signalCompleteness: number;
    /** 便捷判定：处于降级状态（UI 显示「部分信号不可用」） */
    degraded: boolean;
  };
}

/** 最小基线天数：至少 3 天才谈得上「相对自己」 */
export const MIN_BASELINE_DAYS = 3;
/**
 * 基线窗口天数。
 * ★ v18.143：改引用 `recencyBaseline.BASELINE_DAYS` 单一真相源。
 *   之前本文件自己写死 14，而 `recencyBaseline` 的权重窗口也按 14 推导半衰期 ——
 *   两处各写一个数，改一个忘另一个就会让「权重」和「窗口」口径不一致（静默出错）。
 */
const BASELINE_DAYS = SHARED_BASELINE_DAYS;

/**
 * ★ v18.133 删除：MOVE_STEP_DELTA = 250 / MOVE_HR_PCT = 30（无来源的绝对阈值）。
 * 现在运动判定全部交给 `motionGate.verdictAt()`：
 * L1 固件运动段（Veepoo 已用真加速度计分类）→ L1b 按 MET 分档的恢复期
 * → L2 MET/步数连续活动量 → L3 心率残差。
 */

/**
 * EDA 稳健 z 的**尺度下限**（μS）。
 * ⚠ 必须设：实测佩戴稳定时 EDA 的 MAD 可能极小，不设下限会把 0.5μS 的正常波动放大成好几 σ。
 * 参照 `cortisolProxy` 对 EDA 设 2μS 下限的做法（那里量纲是 z-score 输入，此处是原始 μS，量级更小）。
 */
const EDA_SCALE_FLOOR = 1.5;

/**
 * 设备漂移判定：今日 EDA 相对基线的偏离达到该**稳健 z** 即判漂移。
 * ★ v18.133：从旧的「比值 ≥ 2.0」改成 MAD 稳健 z。
 * 比值的问题：基线本身偏高时（换手/季节），2× 是很松的门槛；基线偏低时又过严。
 */
const DRIFT_Z = 4.0;

/**
 * ★ v18.134：至少要有几个特征参与融合才给结论。
 * 6 个特征里只有 1~2 个有数据时，综合分几乎等于那一个特征
 * ⇒ 等于退回单信号，而单信号的权重（0.30）远高于它在融合里的名义占比，
 * 会出现「只有 EDA 有数时分数虚高」的系统性偏差。所以设门槛。
 *
 * ★ v18.136 调整 3 → 2：EDA 漂移时只剩 3 路（hrv/hr/temp），门槛 3 会把它们全判 noData，
 * 等于「漂移仍然废掉整天」，正是本轮要修的问题。降到 2 的理由：
 * 2 路独立生理信号（HRV + HR 都是自主神经，且方向相反 ⇒ 可互为对照）足以给出**有方向**的提示，
 * 且 `fuseFeatures` 已做权重归一化（不会因只剩 2 路而分数虚高）。
 * ⚠ 但 2~3 路时的可信度低于 6 路，**UI 必须显示「部分信号不可用」**（`featureDetail.weightSum < 1`）。
 * ⚠ 1 路仍不给结论（那时确实是单信号，无法互相对照）。
 */
export const MIN_FEATURES_FOR_VERDICT = 2;

/**
 * ★ v18.142 **MET 判为「活动」的槽内占比门槛**。
 * 依据来自真机实测的槽内形态：
 * · 连续活动（走路/通勤）→ 活动点占 **50~100%**（实测 10:00 槽 3/5 = 60%）
 * · 零星活动（转身/抬手/打字）→ 活动点占 **17~33%**（实测 00:00、22:00 槽 2/6 = 33%）
 * 取 **0.5** ⇒ 至少一半时间是动的才算「这一槽在运动」。
 * ⚠ 仍是**产品决策**（无文献规定 MET 占比阈值），但它对应一个可观察的物理事实：
 *   「有没有动」和「有没有一直在动」是两件事，后者才该影响心理压力的解读。
 */
const MET_ACTIVE_RATIO = 0.5;

/** z → 程度档（与 stressAlgorithm.classifyLevel 同口径：0.3/0.8/1.5） */
export function levelFromZ(z: number): EmotionalStressLevel {
  if (!Number.isFinite(z)) return 'calm';
  if (z < 0.3) return 'calm';
  if (z < 0.8) return 'mild';
  if (z < 1.5) return 'moderate';
  return 'high';
}

/**
 * ★ v18.139 **尺度退化哨兵值**。`scaleOf` 用它区分两种「没有尺度」：
 * · `null`     = 样本不足（<3 天）→ 可回退全池尺度
 * · `DEGENERATE_SCALE` = 样本够但 MAD=0（历史该时段毫无波动）→ **不可回退，该路不给数**
 * 用 −1 作哨兵是因为尺度恒为正数，不会与真实值混淆。
 */
export const DEGENERATE_SCALE = -1;

export const LEVEL_LABEL: Record<EmotionalStressLevel, string> = {
  calm: '放松',
  mild: '有点紧',
  moderate: '偏紧',
  high: '很紧',
};

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 取某日某半小时窗口内的样本均值（windowStart = 当天本地午夜 + slot*30min） */
function windowMean(
  dk: string,
  midnight: number,
  slot: number,
  metric: MetricKey,
): { mean: number; n: number } | null {
  const s = midnight + slot * 1800000;
  const e = s + 1800000;
  const pts = healthStore.getIntraday(metric, dk).filter((p) => p.v > 0 && p.t >= s && p.t < e);
  if (!pts.length) return null;
  return { mean: pts.reduce((a, p) => a + p.v, 0) / pts.length, n: pts.length };
}

/** 取某日某半小时的步数增量（末值 − 首值，与 stressAlgorithm 同法） */
function stepDeltaIn(dk: string, midnight: number, slot: number): number {
  const s = midnight + slot * 1800000;
  const e = s + 1800000;
  const pts = healthStore.getIntraday('steps' as MetricKey, dk)
    .filter((p) => p.t >= s && p.t < e)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return 0;
  return Math.max(0, pts[pts.length - 1].v - pts[0].v);
}

/** 取某日某半小时的 MET 均值（运动门控 L2 用；固件每 5/10 分钟一点） */
/**
 * 取某日某半小时的 MET —— ★ v18.142 改为**峰值 + 占比**双判，不再用均值。
 *
 * ⚠⚠ **v18.142 真机实锤的 bug**：原先取槽内**均值**，
 * 而固件 MET 每 5 分钟一点、每点可能是「静息 1」也可能是「活动 6.5」。
 * 一个活动点就把 30 分钟均值从 1.0 抬到 4.26 ⇒ **坐着不动被判成在运动**。
 * 实测今日：均值口径判 `moving=18` 槽（含 00:00、01:00 睡眠时段、
 * 以及 22:00 我正在回消息的时段），**全部是误判** ⇒ 直接把心理压力均值从 54 压到 50。
 *
 * ★ 正确口径（两条同时满足才判「这一槽有运动」）：
 *   ① **峰值** `peak > MET_ACTIVE`：槽内确实出现过活动强度；
 *   ② **占比** `ratio >= MET_ACTIVE_RATIO`：且活动时间是**一段**，不是一瞬间。
 * 实测对照（今日）：
 *   · 00:00 槽 `[1,1,1,6.5,6.5,0.9]` peak=6.5 但 ratio=0.33 ⇒ 只擦过 ⇒ **不算运动**
 *   · 10:00 槽 `[1,1,6.5,6.4,6.4]`     peak=6.5 且 ratio=0.60 ⇒ 连续活动 ⇒ **算运动**
 *   · 22:00 槽 `[1,1,6,1,5.5,1]`       peak=6.0 但 ratio=0.33 ⇒ **不算运动**（坐着打字）
 */
function metIn(dk: string, midnight: number, slot: number): number | null {
  const s = midnight + slot * 1800000;
  const e = s + 1800000;
  const pts = healthStore.getIntraday('met' as MetricKey, dk).filter((p) => p.v > 0 && p.t >= s && p.t < e);
  if (!pts.length) return null;
  const vals = pts.map((p) => p.v);
  const peak = Math.max(...vals);
  // 峰值不够高 ⇒ 这槽没有任何活动，直接给 null（让下游 L2 不命中）
  if (peak <= MET_ACTIVE) return null;
  // 峰值够高但只是零星几个点 ⇒ 不足以判「这一槽在运动」，用**峰值的一半**作为代表值
  // （下游只做 `> MET_ACTIVE` 比较 ⇒ 返回 ≤ 阈值即等价于「不判运动」）
  const ratio = vals.filter((v) => v > MET_ACTIVE).length / vals.length;
  return ratio >= MET_ACTIVE_RATIO ? peak : MET_ACTIVE * 0.9;
}

/**
 * ★ v18.143 **已删除** `robustScaleOf`（等权 MAD）。
 * 原因：基线尺度改用 `recencyBaseline.weightedRobustScale`（时间加权 MAD），
 * 与 `cortisolProxy` 走同一个实现 —— 等权版本已无任何调用方，留在文件里
 * 会让人以为还有两条尺度口径（历史上正是「两处算法不同 ⇒ 皮质醇说偏高、
 * 情绪压力说正常」这种自相矛盾的根源）。
 * ⚠ 保留行为差异记录：新实现**不再有 IQR/1.349 兜底**，
 *   MAD 退化时直接返回 null（由 `DEGENERATE_SCALE` 哨兵接管，v18.139 的既定语义）。
 */

/**
 * 建立 EDA / HRV / HR 的**时段基线**（按 30min 槽分桶，跨天**时间加权**）。
 * ★ 分时段是必须的：EDA 与 HRV 都有明显昼夜节律，混在一起取中位会让凌晨被白天样本判成「偏高」。
 * ★ 窗口**不含当天**（算「今天相对自己」不能把今天算进基准）。
 */
function buildBaselines(nowMs: number) {
  // ★ v18.143：**带权样本**（`daysAgo` 越久远权重越低），不再是等权 `number[]`。
  //   等权中位数 ⇒ 15 天前的一次熬夜和昨天的一次熬夜对基线影响一样大，
  //   而生理基线是会移动的（Garmin 25 夜滚动平均加权偏近期 / Oura「more weight on
  //   recent days」）。详见 lib/recencyBaseline.ts 头注与半衰期论证。
  const perSlot: {
    eda: Map<number, WeightedSample[]>;
    hrv: Map<number, WeightedSample[]>;
    hr: Map<number, WeightedSample[]>;
    // ★ v18.134：6 特征融合新增的三路
    temp: Map<number, WeightedSample[]>;
    edaSlope: Map<number, WeightedSample[]>;
    edaStd: Map<number, WeightedSample[]>;
  } = {
    eda: new Map(), hrv: new Map(), hr: new Map(),
    temp: new Map(), edaSlope: new Map(), edaStd: new Map(),
  };
  const daySet = new Set<string>();
  let days = 0;

  for (let i = 1; i <= BASELINE_DAYS; i++) {
    const ts = nowMs - i * 86400000;
    const dk = hsDayKey(ts);
    if (daySet.has(dk)) continue;
    daySet.add(dk);
    const midnight = dayStartMs(ts);
    // 至少一个 EDA 或 HRV 样本才算「这天有生理数据」
    let dayHas = false;
    // ⚠ v18.143：必须记 `daysAgo = i`（真实天数，不是「第几个有数据的日」）。
    //   若用计数器，遇到某天没数据就会让权重错位（越久远的实际拿到越高权重）。
    const push = (m: Map<number, WeightedSample[]>, slot: number, v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return;
      if (!m.has(slot)) m.set(slot, []);
      m.get(slot)!.push({ v, daysAgo: i });
    };
    for (let slot = 0; slot < 48; slot++) {
      const e = windowMean(dk, midnight, slot, 'eda' as MetricKey);
      if (e) { push(perSlot.eda, slot, e.mean); dayHas = true; }
      const h = windowMean(dk, midnight, slot, 'hrv' as MetricKey);
      if (h) push(perSlot.hrv, slot, h.mean);
      const r = windowMean(dk, midnight, slot, 'hr' as MetricKey);
      if (r) push(perSlot.hr, slot, r.mean);
      // ★ v18.134 三路新特征
      push(perSlot.temp, slot, windowMean(dk, midnight, slot, 'temp' as MetricKey)?.mean);
      push(perSlot.edaSlope, slot, slotSlope(dk, midnight, slot, 'eda' as MetricKey));
      push(perSlot.edaStd, slot, slotStd(dk, midnight, slot, 'eda' as MetricKey));
    }
    if (dayHas) days++;
  }

  // 每槽样本数不足时回退到全池中位（与 cortisolProxy 的时段基线同一策略）
  // ★ v18.143：改用**截尾加权均值**（跨槽混算时**必须**带 daysAgo，见 poolSamples 注释）
  const poolOf = (m: Map<number, WeightedSample[]>) => weightedCenter(poolSamples(m));
  const pE = poolOf(perSlot.eda);
  const pH = poolOf(perSlot.hrv);
  const pR = poolOf(perSlot.hr);
  /**
   * ★ v18.142 **基线天数门槛统一为 3**（原为 2）。
   * 发现的 bug：`toMap` 用 `arr.length >= 2` 建基线中位数，而 `scaleOf` 用 `< 3 → null`
   * ⇒ **只有 2 天数据的槽有中位数、却没自己的尺度**（回退到全池）。
   * 这是「用 2 天的中位数 + 全池的尺度」拼出来的基线，**口径不自洽**，
   * 会让同一个槽在不同特征上得到不可比的 z。
   * ⚠ 实测影响：真机有 5 个槽（22/24/45/46/47）落在 2 天档，
   *   这类槽算出的 z 偏大（2 天中位数偶然接近今天值的概率高），
   *   是「50 vs 55」这类 5 分级偏差的来源之一。
   * ⇒ 统一：`scaleOf` 判「样本 < 3 → 无基线」，`toMap` 也必须同样处理。
   */
  const MIN_BASE_DAYS_PER_SLOT = 3;
  // ★ v18.143：等权中位数 → **截尾加权均值**（`weightedCenter`）。
  //   ⚠ 试过「加权中位数」，自测实锤它对单日突变响应为 **零**
  //     （单个异常样本只占权重和 14%，推不动中位数）⇒ 等于没加权。
  //   详见 lib/recencyBaseline.ts 的「为什么中心估计量用截尾加权均值」。
  const toMap = (m: Map<number, WeightedSample[]>, fallback: number | null) => {
    const out = new Map<number, number | null>();
    for (const [slot, arr] of m) {
      out.set(slot, arr.length >= MIN_BASE_DAYS_PER_SLOT ? weightedCenter(arr) : fallback);
    }
    return out;
  };
  // ★ v18.133：每槽的稳健尺度（MAD×1.4826）。样本 <3 的槽给 null（尺度不可估），
  //   由调用方回退到全池尺度 —— 与 cortisolProxy 的策略一致。
  // ★ v18.139 **修一个真 bug**：原先「样本≥3 但 MAD 退化（全相等）」也会拿到 null，
  //   然后被 poolScale 回填 ⇒ **全池尺度被套到一个「历史上毫无波动」的时段上**。
  //   实锤：槽31 15:30 的 HRV 前 3 天都是 45.0（MAD=0），却被套上全池尺度，
  //   今天 165 → z=+40（HRV 165 本身生理上就不可能）。
  //   修法：**区分两种缺失** ——
  //     · 样本不足（<3）→ 回退全池（真的没测到，用总体尺度估）
  //     · 样本够但无波动（MAD=0）→ 保持 null（**基线退化，不该给数**）
  //   区分方法：先算原始值，只有「样本够」才看是否退化。
  const scaleOf = (
    m: Map<number, WeightedSample[]>,
    poolVals: WeightedSample[],
  ): Map<number, number | null> => {
    const poolScale = weightedRobustScale(poolVals);
    const out = new Map<number, number | null>();
    for (const [slot, arr] of m) {
      if (arr.length < MIN_BASE_DAYS_PER_SLOT) { out.set(slot, null); continue; }  // 样本不足 → 允许回退
      const s = weightedRobustScale(arr);
      out.set(slot, s == null ? DEGENERATE_SCALE : s);               // 退化 → 哨兵值，不回退
    }
    // 桶级尺度**样本不足**时回退全池；**尺度退化**（哨兵值）不回退 ——
    // 基线退化的时段「历史上没有真实波动」，套全池尺度会造出假的高/低（v18.139 实锤）。
    if (poolScale != null) {
      for (const [slot, s] of out) if (s == null) out.set(slot, poolScale);
    }
    return out;
  };
  const allEda: WeightedSample[] = [];
  for (const a of perSlot.eda.values()) allEda.push(...a);
  const allOf = (m: Map<number, WeightedSample[]>): WeightedSample[] => poolSamples(m);
  return {
    eda: toMap(perSlot.eda, pE),
    hrv: toMap(perSlot.hrv, pH),
    hr: toMap(perSlot.hr, pR),
    edaScale: scaleOf(perSlot.eda, allEda),
    /** 全池 EDA 尺度（槽级缺失时的回退 + 漂移判定用） */
    edaScalePool: weightedRobustScale(allEda),
    // ★ v18.134：6 特征融合所需的六路基线/尺度
    hrvScale: scaleOf(perSlot.hrv, allOf(perSlot.hrv)),
    hrScale: scaleOf(perSlot.hr, allOf(perSlot.hr)),
    temp: toMap(perSlot.temp, poolOf(perSlot.temp)),
    tempScale: scaleOf(perSlot.temp, allOf(perSlot.temp)),
    edaSlope: toMap(perSlot.edaSlope, poolOf(perSlot.edaSlope)),
    edaSlopeScale: scaleOf(perSlot.edaSlope, allOf(perSlot.edaSlope)),
    edaStd: toMap(perSlot.edaStd, poolOf(perSlot.edaStd)),
    edaStdScale: scaleOf(perSlot.edaStd, allOf(perSlot.edaStd)),
    days,
  };
}

/**
 * 算今日「情绪压力」。
 * @param nowMs 当前时间（默认 Date.now）
 * @param sportSessions 固件运动段（来自 `ring.sportSessions`）。★ 必须传，否则运动门控只剩
 *        MET/步数两层，会漏掉「通勤走路」这类步数不多但确有活动的时段。
 */
export function computeEmotionalStress(
  nowMs: number = Date.now(),
  sportSessions?: SportSessionLike[] | null,
): EmotionalStressReport {
  const dk = hsDayKey(nowMs);
  const midnight = dayStartMs(nowMs);
  const bl = buildBaselines(nowMs);
  const lastSlot = Math.min(47, Math.floor((nowMs - midnight) / 1800000));
  const gate = MotionGate.fromSessions(sportSessions ?? null);

  const slots: EmotionalStressSlot[] = [];
  /** ★ v18.134 逐槽 6 特征明细（供 UI 展开与日志对质） */
  const featureBySlot = new Map<number, StressFeatureSet>();

  // ── 1) 设备漂移检测：今日 EDA 整体中位 vs 基线（★ v18.133 改用 MAD 稳健 z）──
  //   ⚠ v18.143：这里**有意保留等权中位**，不用加权。
  //   理由：漂移是「今天整天整体偏高」的全天性偏差，判定对象是**当日分布本身**，
  //   今天没有 daysAgo 维度；而 `bl.eda` 已是加权中心，再套一层加权没有意义。
  //   真正决定结果的是分母 `edaScalePool`（它已改为加权 MAD）。
  const todayEdaAll: number[] = [];
  for (let slot = 0; slot <= lastSlot; slot++) {
    const e = windowMean(dk, midnight, slot, 'eda' as MetricKey);
    if (e) todayEdaAll.push(e.mean);
  }
  const todayEdaMed = medianOf(todayEdaAll);
  const baseEdaMed = medianOf([...bl.eda.values()].filter((v): v is number => v != null));
  // 尺度：优先全池 MAD（今日整体漂移是全天性偏差，用全池尺度最稳），并设下限
  const driftScale = Math.max(bl.edaScalePool ?? 0, EDA_SCALE_FLOOR);
  const driftZ =
    todayEdaMed != null && baseEdaMed != null && driftScale > 0
      ? (todayEdaMed - baseEdaMed) / driftScale
      : null;
  const deviceDrift = driftZ != null && driftZ >= DRIFT_Z;

  // ── 2) 逐槽三态判定 ──
  for (let slot = 0; slot <= lastSlot; slot++) {
    const eda = windowMean(dk, midnight, slot, 'eda' as MetricKey);
    const hrv = windowMean(dk, midnight, slot, 'hrv' as MetricKey);
    const hr = windowMean(dk, midnight, slot, 'hr' as MetricKey);
    const stp = stepDeltaIn(dk, midnight, slot);
    const met = metIn(dk, midnight, slot);
    if (!eda && !hrv && !hr) continue;

    const be = bl.eda.get(slot) ?? null;
    const bh = bl.hrv.get(slot) ?? null;
    const br = bl.hr.get(slot) ?? null;

    const edaDevPct = eda && be ? ((eda.mean - be) / be) * 100 : null;
    const hrvDevPct = hrv && bh ? ((hrv.mean - bh) / bh) * 100 : null;
    const hrDevPct = hr && br ? ((hr.mean - br) / br) * 100 : null;

    // ★ v18.136 设备漂移：**只降级 EDA 三路，不清零整段**（这是本轮最重要的一处修正）。
    //   旧行为（v18.132）：漂移 → 全槽 `deviceFault` → 6 特征一个都不参与 → 整段没结论。
    //   为什么错：真机 2026-10-03 实测 EDA 从昨夜 23:00 起单调爬升（52→69→95），
    //   9/9 个同小时全部漂 1.46~2.95×，但**同时段 HRV/HR/体温/MET 四路基线完好**
    //   （下午 16~17 个槽全部有 ≥2 天基线）。旧行为让一次 EDA 接触问题
    //   **把整天都废掉**，而实际有 3 路（权重和 0.48）完全可用。
    //   新行为：EDA 三路（edaLevel/edaSlope/edaVar，权重合计 0.52）标记为不可信，
    //   由 fuseFeatures 的权重归一化把剩下 3 路重新缩放到同一把尺。
    //   ⚠ 代价要说清：只剩 3 路时「心理压力」的判别力弱于 6 路（EDA 是最可靠的那一路），
    //     所以 UI 必须显示「部分信号不可用」，不能装作与 6 路同等可信。
    //   ⚠ `deviceDrift` 字段仍保留（供 UI 提示与日志），但不再阻断判定。
    // 基线天数不足 → 有数据但不给结论
    if (bl.days < MIN_BASELINE_DAYS) {
      slots.push({ slot, state: 'noData', level: 'calm', edaDevPct, hrvDevPct, hrDevPct, stepDelta: stp });
      continue;
    }
    // ★ v18.133 运动判定：交给 motionGate（L1 固件运动段 + L1b 恢复期 + L2 MET/步数 + L3 心率残差）
    const mv = gate.slotMoving(midnight + slot * 1800000, 1800000, {
      met,
      stepDelta: stp,
      hrOverBasePct: hrDevPct,
    });
    if (mv.moving) {
      slots.push({
        slot, state: 'moving', level: 'calm', edaDevPct, hrvDevPct, hrDevPct, stepDelta: stp,
      });
      continue;
    }
    // ★ v18.134：**6 特征融合**替代单信号 EDA 判定。
    //   结构来自 Luma（kookmin 2026-capstone-18）9 通道降维 —— 见 lib/stressFeatures.ts 头注。
    //   权重是「有文献方向依据的初始值」，**不是拟合系数**；真实标定需用户自报回归。
    // ★ v18.136：EDA 漂移时把 EDA 三路的基线/尺度置 null ⇒ zOf 返回 null ⇒ 该路不参与。
    const edaTrusted = !deviceDrift;
    const fz = computeSlotFeatureZs(dk, midnight, slot, {
      base: {
        eda: edaTrusted ? be : null, hrv: bh, hr: br,
        temp: bl.temp.get(slot) ?? null,
      },
      scale: {
        // ★ v18.139 退化哨兵（−1）**不能回退全池**，必须原样传给 zOf 让它判无数据。
        eda: edaTrusted ? (bl.edaScale.get(slot) ?? bl.edaScalePool ?? null) : null,
        hrv: bl.hrvScale?.get(slot) ?? null,
        hr: bl.hrScale?.get(slot) ?? null,
        temp: bl.tempScale.get(slot) ?? null,
      },
      slopeBase: edaTrusted ? (bl.edaSlope.get(slot) ?? null) : null,
      slopeScale: edaTrusted ? (bl.edaSlopeScale.get(slot) ?? null) : null,
      stdBase: edaTrusted ? (bl.edaStd.get(slot) ?? null) : null,
      stdScale: edaTrusted ? (bl.edaStdScale.get(slot) ?? null) : null,
    });
    const fused = fuseFeatures(fz);
    // 综合 z 存在即入 slot 诊断（供 UI 与日志对质）
    featureBySlot.set(slot, fused);

    // ★ 参与特征太少（<3）时不给结论：6 特征里只有 1~2 个有数据时
    //   综合分几乎等于那一个特征，等于退回单信号 —— 这时给数是假精确。
    if (fused.fusedZ == null || fused.usedCount < MIN_FEATURES_FOR_VERDICT) {
      slots.push({ slot, state: 'noData', level: 'calm', edaDevPct, hrvDevPct, hrDevPct, stepDelta: stp });
      continue;
    }
    // 情绪压力：静息且已过恢复期 → 6 特征综合 z 升高
    if (fused.fusedZ > 0) {
      slots.push({
        slot, state: 'stress', level: levelFromZ(fused.fusedZ),
        edaDevPct, hrvDevPct, hrDevPct, stepDelta: stp,
      });
      continue;
    }
    slots.push({ slot, state: 'stress', level: 'calm', edaDevPct, hrvDevPct, hrDevPct, stepDelta: stp });
  }

  const stressSlots = slots.filter((s) => s.state === 'stress');
  const judged = slots.filter((s) => s.state === 'stress' || s.state === 'moving');
  const ORDER: EmotionalStressLevel[] = ['calm', 'mild', 'moderate', 'high'];
  let peakLevel: EmotionalStressLevel | null = null;
  if (stressSlots.length) {
    peakLevel = 'calm';
    for (const s of stressSlots) {
      if (ORDER.indexOf(s.level) > ORDER.indexOf(peakLevel)) peakLevel = s.level;
    }
  }
  // ★ v18.137 心理压力 0-100：**百分位口径**取代旧的 Z2SEV 约定映射。
  //   旧实现是 `Z2SEV` 那张手写分段表（z=0.6→35、z=1.2→60、z≥2→100）——
  //   数字看着像「压力 62 分」，实际含义只有「跟档位自洽」，无法向用户解释。
  //   新实现走 `psychologicalStressScale.percentileFromZ`：
  //   **50 = 和你平时一样，80 = 比平时高出一截**（在个人 14 天同时段分布里的百分位）。
  //   口径依据：Oura 官方「scores are relative to you, 不设固定阈值」；
  //   映射 `50 + 50·tanh(z/2)` 与 cortisolProxy 同源（一个项目里 z→有界量必须同一套）。
  //   ⚠ 注意口径变化：以前只在 level≠calm 的槽上取均值，现在**全部参与判定的槽都进平均**
  //     （百分位有明确中心点 50，混入低压槽才有「全天平均偏高/偏低」的意义）。
  const stressSev = stressSlots
    .map((s) => {
      const fz = featureBySlot.get(s.slot);
      return fz?.fusedZ != null ? percentileFromZ(fz.fusedZ) : null;
    })
    .filter((v): v is number => v != null);
  const meanSeverity = stressSev.length
    ? Math.round(stressSev.reduce((a, b) => a + b, 0) / stressSev.length)
    : null;

  // ★ v18.137 心理压力的完整读数（UI 直接用，不要再自己拼）
  const avgUsed = featureBySlot.size
    ? Array.from(featureBySlot.values()).reduce((a, f) => a + f.usedCount, 0) / featureBySlot.size
    : 0;
  const avgWsum = featureBySlot.size
    ? Array.from(featureBySlot.values()).reduce((a, f) => a + f.weightSum, 0) / featureBySlot.size
    : 0;
  const confidence: Confidence = confidenceOf(Math.round(avgUsed), avgWsum);
  const stressScale = meanSeverity != null
    ? (() => {
        const b = bandOf(meanSeverity);
        return {
          /** 0-100，50 = 和平时差不多 */
          value: meanSeverity,
          band: b.level,
          /** 档位文案：用户要求只用「压力低/中/高」三档 */
          bandLabel: b.label,
          /**
           * 副标：**只写口径，不写档位描述**。
           * ★ v18.138：曾用「相对你自己平时」，用户否决了「今天很松」这类措辞 ——
           *   主文案只要「压力低/中/高」，口径信息放这一行小字即可，不占档位名。
           *   保留它的理由：没有这一行，用户会把 62 读成「压力 62 分」（绝对量）。
           */
          caption: '0-100 相对你自己平时',
          confidence,
          narrative: bandNarrative(meanSeverity, confidence, {
            featureCount: Math.round(avgUsed),
            totalFeatures: STRESS_FEATURE_SPECS.length,
            degraded: deviceDrift,
          }),
        };
      })()
    : null;

  // ★ v18.140 **自报校准**：把「用户自报的压力情绪」与「同时段生理分」配对，算出 r。
  //   这是唯一能回答「这个分数准不准」的路径 —— 没有真值，r 就无从谈起。
  // ⚠ 配对用**当天的槽**（`featureBySlot` 里已有 fusedZ），跨天回看由
  //   `selfReportCalibration` 自己取历史；此处只负责给出「某时刻所在槽的分」。
  // ⚠ 样本不足时返回 `insufficient`，UI 应显示「还在攒数据」而不是假装有准确度。
  const calibration: CalibrationResult = (() => {
    try {
      const pairs = buildPairs(
        (tMs) => {
          // 时刻 → 当天槽 → fusedZ → 百分位
          const dd = new Date(tMs);
          const dk2 = hsDayKey(tMs);
          const mid2 = dayStartMs(tMs);
          const sl = Math.max(0, Math.min(47, Math.floor((tMs - mid2) / 1800000)));
          if (dk2 !== dk) return null;          // 只配今天的（跨天需要重算历史，不在此做）
          const f = featureBySlot.get(sl);
          return f?.fusedZ != null ? percentileFromZ(f.fusedZ) : null;
        },
        14,
        nowMs,
      );
      const res = computeCalibration(pairs);
      return res;
    } catch (e) {
      return computeCalibration([]);
    }
  })();
  /** 校准未通过 ⇒ 数字位应显示「—」，只保留档位（诚实度闸门） */
  const stressScoreVisible = shouldShowNumber(calibration.level) && meanSeverity != null;

  return {
    dataSlots: slots.length,
    stressSlots: judged.length ? stressSlots.length : 0,
    movingSlots: slots.filter((s) => s.state === 'moving').length,
    faultSlots: slots.filter((s) => s.state === 'deviceFault').length,
    stressRatio: judged.length ? stressSlots.length / judged.length : 0,
    peakLevel,
    meanSeverity,
    deviceDrift,
    slots,
    baselineDays: bl.days,
    /** ★ v18.137 心理压力 0-100 的完整读数（UI 优先读这个，别自己拼百分位） */
    stressScale,
    /**
     * ★ v18.140 **自报校准状态**。这是「算法准不准」的唯一可回答方式。
     * UI 必须读它决定：数字位是否显示（`stressScoreVisible`）、要不要显示「还在攒数据」。
     */
    calibration,
    /** 校准通过 ⇒ 可显示 0-100；否则数字位应显「—」，只留档位 */
    stressScoreVisible,
    // ── v18.134 特征明细（供 UI 展开「哪些信号在贡献」+ 日志对质）──
    featureDetail: {
      /** 6 个特征的权重（供 UI 展示与文档对齐，勿在组件里写死） */
      specs: STRESS_FEATURE_SPECS.map((s) => ({
        key: s.key, label: s.label, weight: s.weight, source: s.source,
      })),
      /** 逐槽融合结果（只含参与判定的槽） */
      bySlot: Array.from(featureBySlot.entries()).map(([slot, f]) => ({
        slot,
        fusedZ: f.fusedZ == null ? null : Number(f.fusedZ.toFixed(3)),
        usedCount: f.usedCount,
        weightSum: Number(f.weightSum.toFixed(3)),
        entries: f.entries.map((e) => ({
          key: e.key,
          z: e.z == null ? null : Number(e.z.toFixed(2)),
          contribution: Number(e.contribution.toFixed(3)),
        })),
      })),
      /** 全天平均参与特征数（判断数据够不够；<2 说明佩戴或采样有问题） */
      avgUsedCount: featureBySlot.size
        ? Number(
            (
              Array.from(featureBySlot.values()).reduce((a, f) => a + f.usedCount, 0) /
              featureBySlot.size
            ).toFixed(2),
          )
        : 0,
      /**
       * ★ v18.136 **信号完整度**（UI 必须读它决定要不要提示用户）。
       * = 参与特征的权重和（1.0 = 六路全可用；0.48 = 只有 HRV/HR/体温，EDA 被漂移剔除）。
       * <1 意味着**这个数不是满可信的**，必须让用户知道，否则就是在假装精确。
       */
      signalCompleteness: featureBySlot.size
        ? Number(
            (
              Array.from(featureBySlot.values()).reduce((a, f) => a + f.weightSum, 0) /
              featureBySlot.size
            ).toFixed(3),
          )
        : 0,
      /** 便捷判定：完整度 <1 ⇒ 处于降级状态（UI 应显示「部分信号不可用」） */
      degraded: deviceDrift,
    },
    // ── v18.133 运动门控诊断（研发侧，进 Metro 日志；**不要给用户看**）──
    motionDiag: {
      /** 固件运动段是否可用。false ⇒ 门控只剩 MET/步数/心率三层，力度显著下降 */
      hasFirmwareSessions: gate.hasFirmwareSessions,
      /** 固件运动段摘要（时段 + MET + 恢复期长度） */
      gateSummary: gate.summary(),
      /** 各层各命中多少槽（诊断哪一层在起作用 / 哪一层形同虚设） */
      byReason: (() => {
        const m: Record<string, number> = {};
        for (let slot = 0; slot <= lastSlot; slot++) {
          const v = gate.slotMoving(midnight + slot * 1800000, 1800000, {
            met: metIn(dk, midnight, slot),
            stepDelta: stepDeltaIn(dk, midnight, slot),
          });
          if (v.moving && v.reason) m[v.reason] = (m[v.reason] ?? 0) + 1;
        }
        return m;
      })(),
      /** 漂移判定的 z 与尺度（看是不是尺度太小导致的乱判） */
      driftZ: driftZ == null ? null : Number(driftZ.toFixed(2)),
      edaScalePool: bl.edaScalePool == null ? null : Number(bl.edaScalePool.toFixed(3)),
    },
  };
}
