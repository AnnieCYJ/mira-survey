/**
 * cortisolChartGeom —— 皮质醇趋势图的**共用绘图几何**（v18.125）
 *
 * 为什么要抽出来：
 *   用户反馈「详情页的今日皮质醇全天趋势图，和首页昼夜节律下面那个图不一样，看着难受」。
 *   实锤根因：首页 `AllDayRecoveryCard` 用 Catmull-Rom → 贝塞尔平滑（`smoothPath`）+ (1,2,1) 段内平滑；
 *   而详情页 `TrendChart` 的 `makePath` 是**直线折线**（一堆 `L` 拼接）→ 同样的数据画出来
 *   一个圆润、一个尖角嶙峋，观感割裂。
 *   同一个指标出现两套画法必然继续漂移 —— 所以把「切段 + 平滑 + 面积 + 刻度」全部收敛到这里，
 *   两处都调用 `buildSmoothSeries()`，**同一份数据、同一段代码、同一块画布**。
 *
 * 口径（沿用首页 v18.116~122 已定稿的铁律，不要改）：
 *   · 只画**有生理信号**的槽（`real[i] === true`），缺信号不编造；
 *   · 相邻真实槽间隔 > `GAP_SLOTS`（默认 2 槽 = 1 小时）就**断开**，不连线冒充连续观测；
 *   · 间隔 ≤1h 桥接（中间恰好 1 个空槽也算连续）；
 *   · 孤立单点段不画线，但画实心点标记（画了才知道「测到了」）；
 *   · 面积逐段收口到基线，绝不跨缺口斜插。
 */

/** 全天槽位数：48 × 30min */
export const CHART_SLOTS = 48;
/** 相邻真实槽间隔超过这个槽数就断开（2 槽 = 1 小时） */
export const GAP_SLOTS = 2;

export interface ChartPoint {
  /** 槽下标 0~47 */
  i: number;
  v: number;
}

export interface ChartGeom {
  /** SVG 宽（由 onLayout 实测传入） */
  W: number;
  H: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export interface SmoothSeries {
  /** 连续段（每段 ≥2 点，可画线） */
  segs: ChartPoint[][];
  /** 孤立单点（真实但断开，画实心点；已带屏幕坐标 x/y） */
  singles: { x: number; y: number; i: number; v: number }[];
  /** 全部真实点 */
  points: ChartPoint[];
  xOf: (i: number) => number;
  yOf: (v: number) => number;
  /** 曲线 path（各段平滑后拼接，空格分隔） */
  linePath: string;
  /** 面积 path（逐段收口到基线） */
  areaPath: string;
  /** 基线 y（= padT + chartH） */
  yBase: number;
  /** 刻度用：Y 轴下界 / 上界（含 18% 上下留白，与首页一致） */
  yLo: number;
  yHi: number;
  /** 峰值（最高真实点）；无数据时 idx = -1 */
  peakIdx: number;
  peakV: number;
  peakX: number;
  peakY: number;
  chartW: number;
  chartH: number;
}

/**
 * Catmull-Rom → 三次贝塞尔：把一串点转成平滑曲线。
 * 抽成独立函数，首页与详情页共用（此前只有首页有，详情页是折线）。
 */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
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
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** 把逐槽数组切成连续段：间隔 > gapSlots 断开 */
export function splitSegments(points: ChartPoint[], gapSlots: number = GAP_SLOTS): ChartPoint[][] {
  const out: ChartPoint[][] = [];
  let cur: ChartPoint[] = [];
  for (const p of points) {
    if (cur.length === 0 || p.i - cur[cur.length - 1].i <= gapSlots) cur.push(p);
    else {
      out.push(cur);
      cur = [p];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * 核心：把逐槽值 + 真实槽标记，算出全部绘图几何。
 * 首页与详情页都调这个，保证「同一份数据画出同一张图」。
 */
export function buildSmoothSeries(
  values: (number | null)[],
  real: boolean[],
  geom: ChartGeom,
  opts?: {
    gapSlots?: number;
    /** 外部指定 Y 轴范围（详情页今日线与 14 天基线必须共用一把尺，否则高低关系会误导） */
    yLo?: number;
    yHi?: number;
  },
): SmoothSeries {
  const { W, H, padL, padR, padT, padB } = geom;
  const chartW = Math.max(40, W - padL - padR);
  const chartH = Math.max(20, H - padT - padB);
  const yBase = padT + chartH;
  const xOf = (i: number) => padL + (i / (CHART_SLOTS - 1)) * chartW;

  // 只取「有信号且数值有效」的槽
  const points: ChartPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!real[i]) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    points.push({ i, v });
  }

  const vals = points.map((p) => p.v);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || 1;
  // 两组数据（今日 / 14 天基线）先各自算范围，再由调用方取并集传回来 → 保证同一把尺
  // ★ 2026-10-08：非负量（皮质醇活性）未显式给范围时，下限同样不跌破 0（避免 -7 刻度）
  const yLoRaw = opts?.yLo ?? lo - span * 0.18;
  const yLo = opts?.yLo != null ? yLoRaw : (lo >= 0 ? Math.max(0, yLoRaw) : yLoRaw);
  const yHi = opts?.yHi ?? hi + span * 0.18;
  const yOf = (v: number) => padT + chartH - ((v - yLo) / (yHi - yLo)) * chartH;

  const all = splitSegments(points, opts?.gapSlots ?? GAP_SLOTS);
  const segs = all.filter((s) => s.length >= 2);
  const singles = all.filter((s) => s.length === 1).map((s) => ({ ...s[0], x: xOf(s[0].i), y: yOf(s[0].v) }));

  // 段内 (1,2,1) 三点平滑 → 再走 Catmull-Rom 贝塞尔
  const segPath = (seg: ChartPoint[]): string => {
    if (seg.length < 2) return '';
    const sm = seg.map((p, k) => ((seg[k - 1]?.v ?? p.v) + 2 * p.v + (seg[k + 1]?.v ?? p.v)) / 4);
    return smoothPath(seg.map((p, k) => ({ x: xOf(p.i), y: yOf(sm[k]) })));
  };

  const linePath = segs.map(segPath).filter(Boolean).join(' ');
  const areaPath = segs
    .map((seg) => {
      const d = segPath(seg);
      if (!d) return '';
      const x0 = xOf(seg[0].i).toFixed(1);
      const x1 = xOf(seg[seg.length - 1].i).toFixed(1);
      return `${d} L ${x1} ${yBase.toFixed(1)} L ${x0} ${yBase.toFixed(1)} Z`;
    })
    .filter(Boolean)
    .join(' ');

  let peakIdx = -1;
  let peakV = -Infinity;
  for (const p of points) {
    if (p.v > peakV) {
      peakV = p.v;
      peakIdx = p.i;
    }
  }

  return {
    segs,
    singles,
    points,
    xOf,
    yOf,
    linePath,
    areaPath,
    yBase,
    yLo,
    yHi,
    peakIdx,
    peakV: peakIdx >= 0 ? peakV : 0,
    peakX: peakIdx >= 0 ? xOf(peakIdx) : 0,
    peakY: peakIdx >= 0 ? yOf(peakV) : 0,
    chartW,
    chartH,
  };
}

/**
 * 只算 Y 轴范围（不生成 path）——详情页要先取「今日 + 基线」的并集范围，
 * 再把范围传回 buildSmoothSeries，才能让两条线画在同一坐标系里。
 */
export function computeYRange(
  series: { values: (number | null)[]; real: boolean[] }[],
): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { values, real } of series) {
    for (let i = 0; i < values.length; i++) {
      if (!real[i]) continue;
      const v = values[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
  const span = hi - lo || 1;
  // ★ 2026-10-08（用户实锤：详情页 Y 轴出现 -7）：皮质醇活性是 0~100 的非负量，
  //   18% 余量把下限推到 0 以下 → 底部刻度变负。数据本身全 >= 0 时把下限钳回 0。
  const loPadded = lo - span * 0.18;
  return { lo: lo >= 0 ? Math.max(0, loPadded) : loPadded, hi: hi + span * 0.18 };
}

/** 槽下标 → HH:MM（0 → 00:00，47 → 23:30） */
export function slotToClock(slot: number): string {
  const s = Math.max(0, Math.min(CHART_SLOTS - 1, Math.round(slot)));
  const hh = Math.floor(s / 2);
  const mm = s % 2 === 1 ? '30' : '00';
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

/** 小时（可为小数）→ HH:00，详情页顶部大字用 */
export function hourToClock(hourFloat: number): string {
  if (!Number.isFinite(hourFloat)) return '—';
  const h = Math.round(hourFloat) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}
