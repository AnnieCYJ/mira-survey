/**
 * 第二步：认知负荷实时检测器
 *
 * 设计目标: 当戒指检测到持续认知负荷时 (30min RMSSD↓ + SNS↑),
 * 动态下调认知曲线, 并可触发推送建议.
 *
 * 数据来源: 戒指 RMSSD(HRV) + SNS (已有 healthStore 接口)
 * 参考: CogWear 数据集 (Pantopoulos 2023), WHOOP 实时负荷检测
 *
 * 这是接口层 —— 算法就绪, 推送链路待接入.
 */
import { healthStore, MetricKey } from '../data/healthStore';

export interface CognitiveLoadEvent {
  /** 事件时间戳 */
  t: number;
  /** 持续时长 (分钟) */
  durationMin: number;
  /** 检测时 RMSSD 偏离基线比例 (负数=偏低) */
  hrvDev: number;
  /** 检测时 SNS 偏离基线比例 (正数=偏高) */
  snsDev: number;
  /** 综合负荷等级 */
  severity: 'low' | 'medium' | 'high';
  /** 建议 */
  suggestion: string;
  /** EDA 仅作辅助证据；样本不足时不参与触发。 */
  edaSamples?: number;
  edaMedianGapMin?: number;
}

export interface LoadDetectorConfig {
  /** 滑动窗口分钟数 */
  windowMin: number;
  /** RMSSD 偏离阈值 (-0.2 = 低于基线 20%) */
  hrvDropThreshold: number;
  /** SNS 偏离阈值 (0.25 = 高于基线 25%) */
  snsRiseThreshold: number;
}

const DEFAULT_CONFIG: LoadDetectorConfig = {
  windowMin: 30,
  hrvDropThreshold: -0.2,
  snsRiseThreshold: 0.25,
};

/**
 * 检测最近 windowMin 内是否有持续认知负荷信号.
 *
 * 调用方 (computeCognitiveLoadReport) 传入已算好的个体基线.
 * 算法: 最近 30min HRV/SNS 均值 vs 基线 → 若同时偏离阈值 → 触发事件.
 */
export function detectCognitiveLoad(
  hrvBaseline: number,
  snsBaseline: number,
  nowMs: number = Date.now(),
  config: Partial<LoadDetectorConfig> = {},
): CognitiveLoadEvent | null {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const windowMs = cfg.windowMin * 60000;
  const winStart = nowMs - windowMs;

  const hrvPts = healthStore.getTimeRange('hrv' as MetricKey, winStart, nowMs, { maxPoints: 60 });
  const snsPts = healthStore.getTimeRange('sns' as MetricKey, winStart, nowMs, { maxPoints: 60 });
  const edaPts = healthStore.getTimeRange('eda' as MetricKey, winStart, nowMs, { maxPoints: 5000 });

  if (hrvPts.length < 5 || snsPts.length < 5) return null;
  if (hrvBaseline <= 0 || snsBaseline <= 0) return null;

  const hrvNow = hrvPts.reduce((a, p) => a + p.v, 0) / hrvPts.length;
  const snsNow = snsPts.reduce((a, p) => a + p.v, 0) / snsPts.length;

  const hrvDev = (hrvNow - hrvBaseline) / hrvBaseline;
  const snsDev = (snsNow - snsBaseline) / snsBaseline;

  const hrvHit = hrvDev <= cfg.hrvDropThreshold;
  const snsHit = snsDev >= cfg.snsRiseThreshold;
  if (!hrvHit || !snsHit) return null;

  const combined = -hrvDev + snsDev;
  const severity: CognitiveLoadEvent['severity'] =
    combined > 0.6 ? 'high' : combined > 0.35 ? 'medium' : 'low';

  const suggestion =
    severity === 'high' ? '检测到持续高强度脑力消耗，建议暂停 10 分钟休息'
    : severity === 'medium' ? '脑力负荷偏高，考虑切换到轻度任务'
    : '脑力消耗正常，注意补充水分';

  return {
    t: nowMs,
    durationMin: cfg.windowMin,
    hrvDev: Math.round(hrvDev * 100) / 100,
    snsDev: Math.round(snsDev * 100) / 100,
    severity,
    suggestion,
    edaSamples: edaPts.length,
    edaMedianGapMin: (() => {
      const ts = edaPts.map((p) => p.t).sort((a, b) => a - b);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0).sort((a, b) => a - b);
      return gaps.length ? Math.round((gaps[Math.floor(gaps.length / 2)] / 60000) * 10) / 10 : undefined;
    })(),
  };
}

/**
 * 动态修正认知储备 —— 供 computeCognitiveLoadReport 调用.
 * 当检测到持续负荷时, 下调 brainRemaining, 上调 brainUsed.
 */
export function applyLoadCorrection(
  report: { brainUsed: number; circadianEnergy: number; brainRemaining: number },
  event: CognitiveLoadEvent | null,
): { brainUsed: number; circadianEnergy: number; brainRemaining: number } {
  if (!event) return report;
  const correction =
    event.severity === 'high' ? 12
    : event.severity === 'medium' ? 6
    : 2;
  return {
    ...report,
    brainRemaining: Math.max(0, report.brainRemaining - correction),
    brainUsed: Math.min(100, report.brainUsed + correction * 0.6),
  };
}
