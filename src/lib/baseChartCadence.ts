/**
 * ★ 2026-11-07（用户）：「柱状图按现在的实际情况来展示，比如 30 分钟就 30 分钟一个柱子」
 *
 * 背景：详情页日视图柱状图原先一律按 5 分钟分桶（Oura / 全量版 HK18 口径），
 *   但用户手上这枚 **LunaMira 精简版（BASE_UI）** 真实回传的有效读数是
 *   心率 / 血压约 30 分钟一点、HRV 日间 30 分钟夜间 5 分钟、血氧约 1 分钟一点。
 *   继续用 5 分钟桶 → 一天 288 根柱里绝大多数是空槽，看上去像「数据丢了一大半」。
 *
 * 本模块只做一件事：**按 healthStore 里真实落库样本的时间戳，算出该指标的有效读数
 *   间隔中位数，再映射到标准柱宽**。不插值、不补点、不写死机型数值。
 *
 * ⚠ 机型隔离铁律（用户明确要求）：
 *   本模块 **只在 BASE_UI 分支被调用**；PRO_UI（HK18 / Luna Mira Pro）调用方直接
 *   传 DEFAULT_BIN_MIN=5，保持原来的 5 分钟桶、原排布、原文案，一个像素都不变。
 *   调用处统一是 `MetricDetailScreen` 的 `isBaseLayout` 门禁。
 */
import { healthStore, type MetricKey } from '../data/healthStore';
import { computeMeasuredCadence } from './samplingCadence';

/** 全量版 / 未知机型的历史口径：5 分钟一根柱（288 槽） */
export const DEFAULT_BIN_MIN = 5;

/**
 * BASE_UI 允许的柱宽档位。
 *
 * ★ 2026-11-07（用户续）：「还有很多的数据，它其实采样率没有那么高，柱状图有点太细了，
 *   不需要那么细」—— 5 分钟一档会画 288 根 0.8px 的细线，视觉上像一堵毛刺墙。
 *   实测这枚戒指的有效读数多为 30 分钟一点，血氧虽 1 分钟一点但绝大多数 slot 是 0 占位，
 *   画图没必要跟着 1 分钟走。所以 BASE_UI 最细就到 **30 分钟一柱（48 根，柱子约 6px）**；
 *   读数比 1 小时还稀时才用 60 分钟档。
 *
 * ⚠ DEFAULT_BIN_MIN=5 仍保留给 PRO_UI；本模块只在 `isBaseLayout` 分支被调用，
 *   两档机型的柱宽 / 排布 / 文案互不影响。
 */
const BIN_STEPS = [30, 60] as const;
/** BASE_UI 的最小柱宽（分钟）：无样本时也给 30，避免首帧仍是 288 根细柱。 */
export const BASE_MIN_BIN_MIN = 30;

export interface BaseBinResult {
  /** 实际用于 binByMinutes 的柱宽（分钟） */
  minutes: number;
  /** 真实有效读数间隔中位数（分钟）；无样本为 null */
  measured: number | null;
  /** 样本点数 */
  samples: number;
  /** 是否因为读数过密而做了 5 分钟合并（要在图表说明里如实讲） */
  merged: boolean;
}

/**
 * 按某指标近几天的真实落库样本算柱宽。
 * @param dayKeys 统计窗口（YYYY-MM-DD），调用方传「设备可存天数 + 当前 anchor 日」
 */
export function resolveBaseBin(metric: MetricKey, dayKeys: string[]): BaseBinResult {
  let measured: number | null = null;
  let samples = 0;
  try {
    const c = computeMeasuredCadence(metric, dayKeys);
    measured = c.overallMinutes;
    samples = c.daySamples + c.nightSamples;
  } catch {
    return { minutes: BASE_MIN_BIN_MIN, measured: null, samples: 0, merged: false };
  }
  if (measured == null || !Number.isFinite(measured) || measured <= 0 || samples < 3) {
    return { minutes: BASE_MIN_BIN_MIN, measured, samples, merged: false };
  }
  // 取「≥ 实测中位数」的最小标准档：30 分钟读数 → 30 分钟一柱；
  // 1 / 5 分钟这类过密读数 → 合并到 BASE_UI 下限 30 分钟（用户「不需要那么细」），
  // 并在图表说明里如实标注合并口径。
  let minutes: number = BIN_STEPS[BIN_STEPS.length - 1];
  for (const b of BIN_STEPS) {
    if (measured <= b + 0.5) { minutes = b; break; }
  }
  return { minutes, measured, samples, merged: measured < BASE_MIN_BIN_MIN };
}

/** 图表下方的口径说明（BASE_UI 专用；PRO_UI 仍用原来的静态文案）。 */
export function baseBinNote(r: BaseBinResult, metricLabel: string): string {
  if (r.measured == null || r.samples < 3) {
    return `柱宽 ${r.minutes} 分钟（默认口径）；当前范围内样本不足，实测间隔待戒指同步后重算。`;
  }
  const mergeText = r.merged
    ? `实测约 ${r.measured} 分钟一点，为控制图表密度按 ${r.minutes} 分钟合并；`
    : `实测约 ${r.measured} 分钟一点，柱宽已按真实读数间隔对齐为 ${r.minutes} 分钟；`;
  return `${mergeText}共 ${r.samples} 个${metricLabel}有效读数。数据缺失的时段留白，不做插值。`;
}

/**
 * 把旧的静态说明里「每根柱 = 5 分钟」替换成实际柱宽。
 * PRO_UI 传 DEFAULT_BIN_MIN 时原样返回，文案零变化。
 */
export function withBaseBinText(staticNote: string | undefined, minutes: number): string | undefined {
  if (!staticNote) return staticNote;
  if (minutes === DEFAULT_BIN_MIN) return staticNote;
  return staticNote.replace(/每根柱\s*=\s*5\s*分钟/g, `每根柱 = ${minutes} 分钟`);
}

/** 供「压力时长汇总」等按桶折算分钟数的逻辑复用，避免柱宽变了时长还按 5 分钟算。 */
export function nearestValidPoints(metric: MetricKey, dayKeys: string[]): number {
  try {
    return dayKeys.reduce((n, dk) => n + (healthStore.getIntraday(metric, dk)?.length ?? 0), 0);
  } catch {
    return 0;
  }
}
