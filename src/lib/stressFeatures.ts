/**
 * stressFeatures.ts —— **心理压力特征工程**（v18.134）
 *
 * ══ 依据：把开源女性专用模型（Luma / kookmin 2026-capstone-18）的 9 通道
 *    降维到我们戒指**能算得出来的**分钟级派生值上。══
 *
 * Luma 原始 9 通道（输入 `[B,9,1500]` @25Hz 原始波形）：
 *   0 ppg_calib        滤波后 PPG（z-score）
 *   1 eda_calib        绝对皮电（z-score）
 *   2 acc_global       全局活动量（1g 静息基线映射，clip ±3）
 *   3 eda_ema_context  300s(5min) EDA 宏观趋势
 *   4 bvp_ema_context  300s(5min) PPG 宏观趋势
 *   5 eda_macd         EDA phasic 变化（10s EMA − 60s EMA）
 *   6 bvp_macd         PPG phasic 变化
 *   7 norm_std_eda     300s 后行 EDA 噪声分���（log 压缩 + z）
 *   8 norm_std_bvp     300s 后行 PPG 噪声方差（同）
 *
 * ★ 为什么不能照抄：它吃 25Hz 原始 PPG/BVP/EDA/ACC 波形；
 *   Veepoo SDK 只给派生值（HR ~1Hz、HRV 1min、EDA 实时、temp 5min、MET 5/10min）
 *   ⇒ **没有原始波形 ⇒ 3~8 号通道全部算不出来**。
 *
 * ══ 降维策略 ══
 * 保留「EDA 为核心 + HR/HRV 反向 + 活动量剔除」这个**结构**，
 * 把高频动态特征替换成能在分钟级算的等价物：
 *   · 宏观趋势（3/4 号 300s EMA）→ **个人 14 天分时基线**（我们做得更细，是分时段而非滚动）
 *   · phasic 变化（5/6 号 MACD）→ **槽内一阶差分**（后段均值 − 前段均值）
 *   · 噪声方差（7/8 号 rolling std）→ **槽内标准差**
 *
 * ══ 为什么只保留 6 个特征（这是有依据的删减，不是偷懒）══
 * **Montoya Peña et al. 2026（Comput Methods Programs Biomed，WESAD，8 算法基准）**：
 * 两阶段主体自适应框架（LOSO 群体训练 + 目标用户少量校准微调）下，
 * XGBoost 用 **6 个特征达到 95.0%±4.6% 平衡准确率**，与 10 特征（95.1%±4.7%）
 * 和全 15 特征**无统计学显著差异**（95% CI 含零）——「统计饱和点」。
 * 同一研究里 XGBoost 特征重要性排序：**HRV 时域（median_rr、ibi）占主导**。
 *
 * ⚠ **但那个 95% 不能直接搬到我们身上**：它是「WESAD 同分布 LOSO」，
 *   即训练与测试同源受试者库。**跨数据集泛化会掉到 50~60%**
 *   （arXiv:2402.15513 实测：WESAD 训 → CASE 测，LGBM 只有 0.475~0.505 Acc）。
 *   加上我们的「心理压力」是日常慢性压力、标签只能来自用户自报，
 *   而 WESAD 是实验室 TSST 急性诱发 ⇒ **本文档给的是「有依据的初始权重」，
 *   不是「已标定的系数」**。真实标定必须走用户自报回归（见 MEMORY 诚实度铁律）。
 */

import { healthStore, type MetricKey } from '../data/healthStore';

// ══ 特征定义 ══

/**
 * ★ v18.139 **生理可信区间**（新增，两道防线的第一道）。
 *
 * ⚠⚠ **v18.138 真机复算暴露的 bug**：某些时段的基线 MAD **退化成 0**
 *   （实测槽31 15:30 的 HRV：前 3 天该时段中位数都是 45.0，MAD=0.000），
 *   尺度回落下限 3.0 后，今天一个 **HRV=165** 的值 → **z=+40**。
 *   而 HRV 165 vs 基线 45 本身是**可疑数据**（远超生理上限），
 *   若当成「压力高」就是把设备异常读成了心理状态。
 *
 * ⇒ 在算 z **之前**先剔掉生理上不可能的值。阈值取「常规范围 +  generous 余量」，
 *   不是临床标准（消费级戒指测的是相对趋势，不是诊断值）。
 * ⚠ 宁可漏（显示不出）不可错（把设备异常说成压力高）。
 */
export const PHYSIO_PLAUSIBLE: Record<StressFeatureKey, { lo: number; hi: number } | null> = {
  edaLevel: { lo: 0.5, hi: 200 },   // μS；EDA 常规 1-100，汗湿/接触不良可到 200
  hrvDrop: { lo: 3, hi: 250 },      // ms；RMSSD 常规 10-150，250 是极端上限
  hrRise: { lo: 25, hi: 220 },      // bpm；静息 40-100，220 是极限
  edaSlope: { lo: -120, hi: 120 },  // μS / 半小时
  tempRise: { lo: 33, hi: 42 },     // ℃ 腕温/皮温区间
  edaVar: { lo: 0, hi: 150 },       // μS
};

/** 返回 false 表示「生理上不可能，直接判该路无数据」 */
export function isPhysioPlausible(key: StressFeatureKey, value: number | null): boolean {
  const r = PHYSIO_PLAUSIBLE[key];
  if (value == null || !Number.isFinite(value)) return false;
  if (!r) return true;
  return value >= r.lo && value <= r.hi;
}

/**
 * 6 个特征，每个都标注了它在 Luma 9 通道里的对应物 + 文献依据。
 * ⚠️ 权重**不是拟合出来的**，是「按文献信号强度 + 保守打折」定的初始值。
 *   方向有依据 ≠ 系数有依据（MEMORY 铁律）。
 */
export const STRESS_FEATURE_SPECS = [
  {
    key: 'edaLevel',
    label: '皮电水平',
    /** 对应 Luma 通道 1（eda_calib）。EDA 是心理压力最可靠的单一信号。 */
    weight: 0.30,
    direction: 1 as const,
    /** 依据：EDA 是唯一在受试者内对心理压力稳定敏感的通道 */
    source: 'EDA 是心理压力最可靠的单一外周信号',
  },
  {
    key: 'hrvDrop',
    label: '心率变异性下降',
    /** 对应 Luma 通道 0（ppg_calib）+ 通道 6（bvp_macd）。方向反相。 */
    weight: 0.22,
    direction: -1 as const,
    /** 依据：Montoya Peña 2026 XGBoost 重要性排序里 HRV 时域（median_rr/ibi）占首位 */
    source: 'Montoya Peña 2026：XGBoost 特征重要性 HRV 时域占主导',
  },
  {
    key: 'hrRise',
    label: '心率上升',
    /** 对应 Luma 通道 0。心率对**运动**极敏感，所以运动门控必须先跑。 */
    weight: 0.16,
    direction: 1 as const,
    source: '交感激活直接抬高心率；运动亦然，故必须先过运动门控',
  },
  {
    key: 'edaSlope',
    label: '皮电上升趋势',
    /** 对应 Luma 通道 5（eda_macd = 10s EMA − 60s EMA）的分钟级等价物。 */
    weight: 0.14,
    direction: 1 as const,
    source: 'EDA phasic 上升是交感激活的动态特征（Luma 通道 5）',
  },
  {
    key: 'tempRise',
    label: '体温偏移',
    /** 对应 Luma 通道 3/4 的体温部分。体温反映长期交感背景而非急性。 */
    weight: 0.10,
    direction: 1 as const,
    source: '外周血管收缩致体温下降（反向）；此处用个人基线偏移，已含方向',
  },
  {
    key: 'edaVar',
    label: '皮电波动度',
    /** 对应 Luma 通道 7（norm_std_eda = 300s 滚动 std 的 log 压缩）。 */
    weight: 0.08,
    direction: 1 as const,
    source: 'Luma 通道 7：EDA 噪声方差本身携带唤醒信息',
  },
] as const;

export type StressFeatureKey = typeof STRESS_FEATURE_SPECS[number]['key'];

/** 权重和（应恒为 1，便于 UI 说明「这是加权」） */
export const FEATURE_WEIGHT_SUM = STRESS_FEATURE_SPECS.reduce((a, s) => a + s.weight, 0);

export interface StressFeatureValues {
  edaLevel: number | null;   // EDA 相对分时基线的稳健 z
  hrvDrop: number | null;    // HRV 相对基线的稳健 z（已取反 ⇒ 正值=偏低）
  hrRise: number | null;     // 心率相对基线的稳健 z
  edaSlope: number | null;   // 槽内 EDA 后段−前段（相对基线尺度归一）
  tempRise: number | null;   // 体温相对分时基线的稳健 z
  edaVar: number | null;     // 槽内 EDA 标准差（相对基线尺度归一）
}

export interface StressFeatureSet {
  /** 每个特征：原始 z、方向修正后的贡献、是否参与 */
  entries: Array<{
    key: StressFeatureKey;
    label: string;
    /** 原始稳健 z（未乘方向） */
    z: number | null;
    /** 归一化后的贡献（÷ 参与特征权重和） */
    contribution: number;
    /** 归一化前的贡献（= 方向化 z × 权重），供 UI 对质 */
    rawContribution: number;
    hasData: boolean;
    source: string;
  }>;
  /** 加权融合后的综合 z（已归一化），无任何特征时为 null */
  fusedZ: number | null;
  /** 参与融合的特征数 */
  usedCount: number;
  /** ★ v18.136 参与特征的权重和（<1 表示有特征缺失，贡献已按此归一化） */
  weightSum: number;
}

// ══ 工具 ══

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantileOf(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = (sorted.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  if (f === c) return sorted[f];
  return sorted[f] + (k - f) * (sorted[c] - sorted[f]);
}

/** MAD×1.4826；样本 <3 返回 null；MAD 退化用 IQR 兜底（与 cortisolProxy 同口径） */
export function robustScaleOf(vals: number[]): number | null {
  const v = vals.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const med = medianOf(v)!;
  const mad = medianOf(v.map((x) => Math.abs(x - med)))!;
  const sigma = mad * 1.4826;
  if (sigma > 1e-6) return sigma;
  const iqr = (quantileOf(v, 0.75) - quantileOf(v, 0.25)) / 1.349;
  return iqr > 1e-6 ? iqr : null;
}

// ══ 槽内统计（替代高频动态特征）══

/** 某半小时窗口内某指标的样本 */
function slotSamples(dk: string, midnight: number, slot: number, metric: MetricKey) {
  const s = midnight + slot * 1800000;
  const e = s + 1800000;
  return healthStore.getIntraday(metric, dk).filter((p) => p.v > 0 && p.t >= s && p.t < e);
}

/** 槽内均值 + 样本数 */
export function slotMean(
  dk: string, midnight: number, slot: number, metric: MetricKey,
): { mean: number; n: number } | null {
  const pts = slotSamples(dk, midnight, slot, metric);
  if (!pts.length) return null;
  return { mean: pts.reduce((a, p) => a + p.v, 0) / pts.length, n: pts.length };
}

/** 槽内标准差（替代 Luma 通道 7/8 的 300s rolling std） */
export function slotStd(
  dk: string, midnight: number, slot: number, metric: MetricKey,
): number | null {
  const pts = slotSamples(dk, midnight, slot, metric);
  if (pts.length < 3) return null;   // 样本太少，std 不可靠
  const m = pts.reduce((a, p) => a + p.v, 0) / pts.length;
  const v = pts.reduce((a, p) => a + (p.v - m) * (p.v - m), 0) / (pts.length - 1);
  return Math.sqrt(v);
}

/**
 * 槽内一阶差分（替代 Luma 通道 5/6 的 MACD = 10s EMA − 60s EMA）。
 * 取「后 1/3 时段均值 − 前 1/3 时段均值」—— 抗噪且能表达方向性上升。
 */
export function slotSlope(
  dk: string, midnight: number, slot: number, metric: MetricKey,
): number | null {
  const pts = slotSamples(dk, midnight, slot, metric).sort((a, b) => a.t - b.t);
  if (pts.length < 4) return null;
  const third = Math.max(1, Math.floor(pts.length / 3));
  const head = pts.slice(0, third);
  const tail = pts.slice(-third);
  const mh = head.reduce((a, p) => a + p.v, 0) / head.length;
  const mt = tail.reduce((a, p) => a + p.v, 0) / tail.length;
  return mt - mh;
}

// ══ 尺度下限（每路一个，理由见 MEMORY「尺度必须设下限」）══
/**
 * ⚠️ 这些下限来自实测：静息心率 MAD 只有 0.185 bpm、HRV 14.8、EDA 8.9、体温 0.148。
 * 不设下限时「1bpm 正常波动」会被放大成 5σ，让分数乱跳。
 * 数值与 `cortisolProxy` 同口径（刻意一致，避免两处算法自相矛盾）。
 */
export const SCALE_FLOOR: Record<StressFeatureKey, number> = {
  edaLevel: 1.5,   // μS
  hrvDrop: 3.0,     // ms
  hrRise: 2.0,      // bpm
  edaSlope: 0.8,    // μS（斜率的尺度天然更小）
  tempRise: 0.05,   // ℃
  edaVar: 0.5,      // μS
};

/**
 * 单路**方向化后** z 的 clamp 上限：单项极端不打爆综合分（与 cortisolProxy 的 tanh 压缩同思路）。
 *
 * ★ v18.135 修正（自测实锤的 bug）：原先是 `clamp(directed * weight, ±3)`，
 *   即**先乘权重再 clamp**。后果：单项 z=100 时贡献被 clamp 到 3.0，
 *   而它在融合里的名义占比只有 0.30 ⇒ **单路就能打满 3 分，权重被放大 3.3 倍**，
 *   且「哪个特征在贡献」的信息丢失（一个特征吃掉全部分数）。
 *   正确顺序：**先 clamp 方向化 z（±Z_CLAMP），再乘权重** ⇒ 单路贡献上限 = Z_CLAMP × weight。
 *   下限 3.0 的依据：z=3 已远超日常生理波动的 3σ，是「明确异常」而非「有点高」。
 *
 * ★ v18.139 真机复算后再降为 **2.5**：实测出现 z=+9（心率）、z=−40（HRV）这类值，
 *   说明尺度退化时单路 z 会爆掉。压到 2.5 让「单一可疑信号」不至于把综合分推到顶 ——
 *   它仍是「明确异常」（2.5σ），但留给其它信号参与的空间更大。
 */
const Z_CLAMP = 2.5;

// ══ 特征构建 ══

/**
 * 取某槽的 6 个特征 z 值。
 * @param baselines 分时基线与尺度（来自 emotionalStress 的 buildBaselines 或等价物）
 */
export interface FeatureBaseline {
  /** 该槽各指标基线中位数 */
  base: { eda: number | null; hrv: number | null; hr: number | null; temp: number | null };
  /** 该槽各指标稳健尺度（MAD×1.4826） */
  scale: { eda: number | null; hrv: number | null; hr: number | null; temp: number | null };
  /** EDA 斜率与标准差的基线/尺度（跨天同槽统计） */
  slopeBase: number | null;
  slopeScale: number | null;
  stdBase: number | null;
  stdScale: number | null;
}

/**
 * 由**原始值**与基线算出 6 个特征的 z。
 * ⚠️ 与 `emotionalStress` 的槽内函数同源（`slotMean`/`slotStd`/`slotSlope`），
 *    避免两处各算一套导致「卡片说偏高、特征说正常」。
 */
export function computeSlotFeatureZs(
  dk: string,
  midnight: number,
  slot: number,
  bl: FeatureBaseline,
): StressFeatureValues {
  const zOf = (
    val: number | null, base: number | null, scale: number | null, floorKey: StressFeatureKey,
  ): number | null => {
    if (val == null || base == null || base <= 0) return null;
    // ★ v18.139 **基线尺度退化 ⇒ 该路不给数**（哨兵值 −1，由 emotionalStress.scaleOf 设置）。
    // 实测（v18.138 真机复算）：槽31 15:30 的 HRV 前 3 天中位数都是 45.0、MAD=0.000
    // ⇒ 尺度只能回落下限 3.0 ⇒ 今天的 165 被算成 z=+40。
    // 但 MAD=0 意味着**那个时段历史上根本没有真实波动**（固件写死同值 / 样本同源），
    // 这样的基线**不能用来判断偏离**，给数就是编。
    if (scale != null && scale <= 0) return null;
    const sc = Math.max(scale ?? 0, SCALE_FLOOR[floorKey]);
    if (sc <= 0) return null;
    return (val - base) / sc;
  };

  const edaM = slotMean(dk, midnight, slot, 'eda' as MetricKey);
  const hrvM = slotMean(dk, midnight, slot, 'hrv' as MetricKey);
  const hrM = slotMean(dk, midnight, slot, 'hr' as MetricKey);
  const tempM = slotMean(dk, midnight, slot, 'temp' as MetricKey);

  return {
    // ★ v18.139 每路先过**生理可信区间**，不可能的值直接判该路无数据（不算 z）。
    edaLevel: isPhysioPlausible('edaLevel', edaM?.mean ?? null)
      ? zOf(edaM?.mean ?? null, bl.base.eda, bl.scale.eda, 'edaLevel') : null,
    hrvDrop: isPhysioPlausible('hrvDrop', hrvM?.mean ?? null)
      ? zOf(hrvM?.mean ?? null, bl.base.hrv, bl.scale.hrv, 'hrvDrop') : null,
    hrRise: isPhysioPlausible('hrRise', hrM?.mean ?? null)
      ? zOf(hrM?.mean ?? null, bl.base.hr, bl.scale.hr, 'hrRise') : null,
    edaSlope: (() => {
      const raw = slotSlope(dk, midnight, slot, 'eda' as MetricKey);
      return isPhysioPlausible('edaSlope', raw)
        ? zOf(raw, bl.slopeBase, bl.slopeScale, 'edaSlope') : null;
    })(),
    tempRise: isPhysioPlausible('tempRise', tempM?.mean ?? null)
      ? zOf(tempM?.mean ?? null, bl.base.temp, bl.scale.temp, 'tempRise') : null,
    edaVar: (() => {
      const raw = slotStd(dk, midnight, slot, 'eda' as MetricKey);
      return isPhysioPlausible('edaVar', raw)
        ? zOf(raw, bl.stdBase, bl.stdScale, 'edaVar') : null;
    })(),
  };
}

/**
 * 按权重把 6 个特征融合成一个综合 z。
 * ⚠️ **缺数据不做插补**：无数据的特征贡献记 0，且 `usedCount` 会变小。
 *    调用方应据此判断可信度（`usedCount` < 4 时建议不出数字）。
 */
/**
 * 按权重把特征融合成一个综合 z。
 *
 * ★ v18.136 **缺特征时必须重新归一化权重**（真机数据实锤的 bug）。
 * 背景：6 特征里 EDA 占 3 个（edaLevel/edaSlope/edaVar，权重合计 0.52）。
 * 当 EDA 因漂移/未佩戴而不可用时，只剩 3 路参与（权重合计 0.48）——
 * 若直接求和，综合分被**系统性压低 52%**，所有槽都会误判成「放松」。
 *   ⚠ 这是「分母不变、分子变小」的经典陷阱：不是数据少了一点，是结论方向反了。
 * 修法：Σ 贡献 ÷ Σ 参与特征的权重 ⇒ 无论参与几路，综合分都回到同一把尺。
 *   代价：只剩 1 路时该路等同于满权重（信息量确实只有 1 路），所以
 *   `MIN_FEATURES_FOR_VERDICT` 门槛必须同时存在，两道防线缺一不可。
 *
 * ⚠ **缺数据不做插补**：无数据的特征不参与，`usedCount` 会变小，调用方据此判断可信度。
 */
export function fuseFeatures(v: StressFeatureValues): StressFeatureSet {
  const raw = STRESS_FEATURE_SPECS.map((spec) => {
    const z = v[spec.key];
    const hasData = z != null && Number.isFinite(z);
    // ★ v18.135：先 clamp 方向化 z，再乘权重（顺序不能反，见 Z_CLAMP 处的 bug 说明）
    const directed = hasData
      ? Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z! * spec.direction))
      : 0;
    return { spec, z, hasData, contribution: hasData ? directed * spec.weight : 0 };
  });

  // ★ v18.136：权重归一化的分母 = 实际参与特征的权重和
  const wSum = raw.reduce((a, r) => a + (r.hasData ? r.spec.weight : 0), 0);
  const entries = raw.map((r) => ({
    key: r.spec.key,
    label: r.spec.label,
    z: r.hasData ? r.z! : null,
    contribution: r.hasData ? r.contribution / wSum : 0,
    /** 该路的原始贡献（未归一化），供 UI 展示「归一化前」 */
    rawContribution: r.contribution,
    hasData: r.hasData,
    source: r.spec.source,
  }));

  const used = entries.filter((e) => e.hasData);
  const fusedZ = used.length && wSum > 0
    ? used.reduce((a, e) => a + e.contribution, 0)
    : null;

  return { entries, fusedZ, usedCount: used.length, weightSum: wSum };
}

/** 诊断摘要（进日志，不给用户看） */
export function featureDiag(fs: StressFeatureSet): string {
  const parts = fs.entries.map(
    (e) => `${e.key}=${e.z == null ? '—' : e.z.toFixed(2)}→${e.contribution.toFixed(3)}`,
  );
  return `used=${fs.usedCount}/6 fusedZ=${fs.fusedZ == null ? '—' : fs.fusedZ.toFixed(3)} [${parts.join(' ')}]`;
}
