/**
 * svgSmooth —— SVG 平滑曲线工具（Catmull-Rom 转三次贝塞尔）
 *
 * 折线直接连点会有明显棱角，用控制点把每段转成 C 命令即可得到顺滑曲线。
 * 被首页「全天恢复」卡与「消耗明细」三张卡共用。
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * 把一串点转成平滑的 SVG path（M + 多个 C）。
 * 少于 2 个点返回空串（调用方据此跳过绘制）。
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    // 控制点取相邻点差值的 1/6（Catmull-Rom → Bezier 的标准换算）
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
