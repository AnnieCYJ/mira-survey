/**
 * dayAnchor —— 把「锚定日」换算成 computeStressReport / computeCognitiveLoadReport 的 nowMs。
 *
 * 背景（易踩坑）：这两个报告函数内部按
 *     getTimeRange(key, dayStartMs(nowMs), nowMs, …)
 * 取数——**nowMs 被当作区间结束**（同时用于「近 30min / 近 5min」窗口）。因此：
 *   · 传某天 00:00 → 区间是 [零点, 零点]，几乎取不到样本 → 报告整体 null（情绪消耗显示 0 次 / —）。
 *   · 正确做法：今天 → 传当前时刻（区间到今天此刻）；历史日 → 传该日 23:59:59.999（完整一整天）。
 *
 * 本模块即为该换算的**唯一实现**，详情页切历史日时必须走这里。
 */
import { dayStartMs } from '../data/healthStore';

/** 锚定日对应的报告 nowMs：今天=此刻；历史日=该日 23:59:59.999（完整一天）。 */
export function reportNowMsForDay(anchorMs: number): number {
  const start = dayStartMs(anchorMs);
  const e = new Date(start);
  e.setHours(23, 59, 59, 999);
  return Math.min(Date.now(), e.getTime());
}

/** 锚定日「前一天」对应的报告 nowMs（用于「相比前一天」等对比）。 */
export function reportNowMsForPrevDay(anchorMs: number): number {
  const start = dayStartMs(anchorMs);
  const prev = new Date(start);
  prev.setDate(prev.getDate() - 1);
  const e = new Date(prev);
  e.setHours(23, 59, 59, 999);
  return Math.min(Date.now(), e.getTime());
}
