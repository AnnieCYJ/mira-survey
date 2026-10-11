/**
 * smoothPath —— Catmull-Rom → 三次贝塞尔 的路径生成（全 App 趋势线统一算法）
 *
 * 2026-10-10 建立。此前 `InsightScreen.smoothSpline` 是本地私有函数，
 * 新增图表（柱状小条上的趋势线）需要同一套平滑曲线，故抽成唯一出口。
 *
 * ★ 为什么趋势线不能用折线（用户 2026-10-10：「这趋势图要做成趋势，不要做成折线」）：
 *   趋势表达的是「连续变化的趋势」，`L` 直线段会在每个采样点留下折角，
 *   读起来像「一堆离散点的连线」；Catmull-Rom 过所有采样点且切线连续，
 *   出来的是平滑趋势，视觉上与 App 里其他所有趋势图一致。
 */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}