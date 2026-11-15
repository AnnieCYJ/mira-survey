import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '../../theme/theme';
import { mm } from '../../theme/mindmate';
import { chart } from '../../theme/chart';
import { DAY_HOUR_TICKS, DAY_MINOR_TICK_MINUTES, hourTickLabel } from '../../lib/chartAxis';
import { bucketMean, type Bucket } from '../../lib/timeBuckets';
import MoodBlob from '../MoodBlob';
import ChartTapTip, { type ChartTapSlot } from '../ChartTapTip';
import type { MoodKey } from '../../data/emotionLog';

/**
 * AllDayBarsChart —— 全天柱状小条（2026-10-10 建立）
 *
 * ★ 口径来源：Oura 24h 心率图（api.ouraring.com / support.ouraring.com）
 *   - X 轴每 30 分钟一条刻度线（Oura 的 division），刻度线**无文字**
 *   - 每条刻度线内含 6 根 5 分钟一根的小柱（= 全天 288 根）
 *   - 白天心率数据本身也是 5 分钟一点（官方原文 "one full minute, every five minutes"）
 *
 * ★ 为什么柱状而不是平滑线：288 个点连成平滑线就是一片噪点；
 *   柱状能一眼看出「哪段时间密、哪段时间空、什么时候冲高」。
 *
 * ★ Mira 的三条纪律：
 *   1. 横轴**永远画满 24 小时**（0:00→24:00），当前时刻之后不画柱但刻度线照常
 *      （对齐「自然周期轴永远画满整段 + 未来留空槽」铁律）
 *   2. 没数据**不插值**：已过去的空槽画 2pt灰色空桩（让人看出「有槽但没读到」），
 *      未来的槽**完全不画**（不画桩也不画柱）
 *   3. ★ 2026-11-09（用户）：柱上不再叠加「全天均值」白色趋势线 ——
 *      288 根柱已经足够表达全天的疏密与冲高，再压一条平滑白线只会盖住柱子、看着像两层图。
 *      线与其图例项一并移除，`meanLine` 参数保留只为兼容调用方，不再生效。
 */

export type DayBarSegment = 'sleep' | 'awake' | 'active';

interface Props {
  /** 已分桶数据（建议 `binByMinutes(pts, 5)` → 288 槽）。`v === null` = 空槽 */
  buckets: Bucket[];
  /** 窗口起点（epoch ms）。默认取当天 0 点 */
  dayStartMs?: number;
  /** 当前时刻；之后的槽视为未来不画。默认 Date.now() */
  nowMs?: number;
  /** 时刻 → 语义段（决定柱色）。不给则全用 awake 色 */
  segmentOf?: (t: number) => DayBarSegment;
  /**
   * 按数值直接指定柱色（优先于 `segmentOf`）。
   * 压力 / 疲劳 / 情绪这类「状态型」指标用：低=浅灰、中=黄、高=红，
   * 语义比三段式更贴切（它们没有「睡眠/活动」之分，只有档位）。
   */
  colorOf?: (v: number) => string | null;
  /** Y 轴量程；不给则按有效槽自适应（上下各留 12% 余量，与其他详情图一致） */
  yMin?: number;
  yMax?: number;
  /** 均值线位置；不给则用有效槽均值自动算 */
  meanLine?: number | null;
  /** 绘图区净高（不含 X 轴标签带），默认 `chart.plot.l` */
  height?: number;
  /** 是否画 30 分钟次刻度线，默认 true */
  minorTicks?: boolean;
  /**
   * 时间窗长度（ms），默认一整天。
   * 夜间视图（HRV 睡眠段）传「入睡→起床」的窗口，柱子就会占满整宽而不是挤在左边一小段。
   */
  spanMs?: number;
  /**
   * 自定义刻度标签（`frac` = 距窗口起点的比例 0~1）。不给则用 0/4/8…24:00 的整点刻度。
   * 夜间窗口应传真实钟点（如 23:00 / 01:00 / 03:00 …）。
   */
  tickLabels?: { frac: number; label: string }[];
  /**
   * 需要「静默」的时间区间（epoch ms）。落在这些区间的槽**既不画柱也不画空桩**，
   * 只留背景 —— 用于「日间 HRV」这类视图：睡眠段本来就不该出现在日间图里，
   * 画成空桩会让人误以为「有槽但没读到」。
   */
  mutedRanges?: [number, number][];
  /**
   * ★ 2026-11-05（用户：记录此刻心情后，把心情 icon 标到趋势图上的「相应时间点」）：
   *   自报心情的标记。会按 `ts` 换算成 X 轴位置，在绘图区顶部画一个带白色光晕的表情，
   *   并拉一条竖向虚线到基线，让用户一眼看到「这个时刻记了什么心情」。
   *   不在绘图区范围内（如夜间视图下白天记的心情）则不渲染。
   */
  moodMarker?: { ts: number; mood: MoodKey } | null;
  /**
   * ★ 2026-11-07（用户「柱状图太细，不需要那么细」）：BASE_UI 低采样率机型专用。
   *   柱子占满槽宽的 0.9、最小 4px（仍 clamp 在槽宽内防止重叠）；
   *   不传时保持 PRO_UI 原有 token 口径，一个像素都不变。
   */
  denseBars?: boolean;
  /** ★ 统一数值气泡：数值单位（如 `bpm` / `ms` / `%`），只用于点柱时显示，不改坐标轴 */
  unit?: string;
}

const PAD_L = 30;
const PAD_R = 12;
const PAD_T = 16;
// ★ 2026-11-05（用户「横坐标被遮挡 / 裁掉」）：20 → 28，给 12px 字号留足下探空间，
//   同时把 X 轴标签带与最底部 Y 轴刻度彻底分开（两者原来只差 12px，会叠在一起）。
const AXIS_H = 28;

export default function AllDayBarsChart({
  buckets,
  dayStartMs,
  nowMs,
  segmentOf,
  yMin,
  yMax,
  meanLine,
  height,
  minorTicks = true,
  spanMs: spanMsProp,
  tickLabels,
  mutedRanges,
  colorOf,
  moodMarker,
  denseBars = false,
  unit,
}: Props) {
  const plotH = height ?? chart.plot.l;
  const H = PAD_T + plotH + AXIS_H;
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  // ★ 2026-11-08 修复条件 Hook（Rules of Hooks）：`dayStartMs ?? useMemo(...)` 在传入
  //   dayStartMs 的渲染里不会调用该 Hook，Hook 数量随 prop 变化 → React 崩溃风险。
  //   改为无条件 useMemo + 事后取值。
  const t0Fallback = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const t0 = dayStartMs ?? t0Fallback;
  const now = nowMs ?? Date.now();
  const spanMs = spanMsProp ?? 86_400_000;
  const plotW = Math.max(0, w - PAD_L - PAD_R);

  // 量程：优先外部指定；否则按有效槽自适应
  // ★ v18.134（审查 04 🟡-2）：只传单边量程时也要尊重它 ——
  //   旧实现只有 yMin/yMax 同时传才生效，`yMin={0}`（hrv）或 `yMin={-10}`（emotion）
  //   在自适应分支被无视 → HRV 柱画到 0 线以下、emotion 负值区间被压掉。
  const range = useMemo(() => {
    if (yMin != null && yMax != null && yMax > yMin) return { lo: yMin, hi: yMax };
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of buckets) {
      if (b.v == null) continue;
      if (b.v < lo) lo = b.v;
      if (b.v > hi) hi = b.v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: yMin ?? 0, hi: yMax ?? (yMin != null ? yMin + 1 : 1) };
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    // ★ 2026-11-14（用户：身心压力日视图纵轴冒出 -3 这种不可能刻度）：
    //   自适应分支下限不许穿 0 —— 生理指标没有负值；emotion 等真可负的指标走的是
    //   显式 yMin={-10} 的固定分支，不受影响。
    const loClamp = yMin != null ? yMin : 0;
    return {
      lo: Math.max(loClamp, yMin != null ? Math.min(lo - pad, yMin) : lo - pad),
      hi: yMax != null ? Math.max(hi + pad, yMax) : hi + pad,
    };
  }, [buckets, yMin, yMax]);

  const mean = meanLine !== undefined ? meanLine : bucketMean(buckets);

  const geom = useMemo(() => {
    if (w <= 0) return null;
    // ★ v18.134（审查 04 🟡-2）：yAt 必须 clamp 到量程内 —— 旧实现无任何 clamp，
    //   超量程值会把柱子画出绘图区、溢出到图例/标题区域；NaN/Infinity 还会产出非法
    //   SVG 坐标（非有限值会让 iOS 原生 SVG 渲染器硬退出）。口径与 MetricDetailScreen.yAt 对齐。
    const ySpan = range.hi - range.lo;
    const yAt = (v: number) => {
      const c = Number.isFinite(v) ? Math.max(range.lo, Math.min(range.hi, v)) : range.lo;
      return PAD_T + plotH * (1 - (ySpan === 0 ? 0 : (c - range.lo) / ySpan));
    };
    const xOf = (t: number) => PAD_L + (plotW * (t - t0)) / spanMs;

    const slotCount = Math.max(1, buckets.length);
    const slotW = plotW / slotCount;
    // ★ 2026-11-07（BASE_UI）：低采样率机型柱子要看得见 —— 占满槽宽 0.9、最小 4px；
    //   同时 clamp 在 slotW*0.94 内，避免相邻柱重叠成一堵墙。PRO_UI 不传 denseBars，保持原口径。
    const ratio = denseBars ? 0.9 : chart.bar.slotRatio;
    const floor = denseBars ? chart.bar.minWidth : 0.8;
    const barW = Math.max(
      Math.min(floor, slotW * 0.94),
      Math.min(chart.bar.maxWidth, slotW * ratio),
    );
    const baseY = PAD_T + plotH;

    const bars: React.ReactNode[] = [];
    // ★ 统一数值气泡：与柱子同源的坐标，避免「点 A 显示 B 的数值」
    const tapPoints: { cx: number; cy: number; t: number; v: number }[] = [];
    let hasData = false;
    for (const b of buckets) {
      if (b.t > now) continue;                              // 未来槽：完全不画
      if (mutedRanges?.some(([a, z]) => b.t >= a && b.t <= z)) continue;   // 静默区：不画柱也不画桩
      const x = xOf(b.t) - barW / 2;
      if (b.v == null) {
        bars.push(                                          // 已过去的空槽 → 2pt 空桩
          <Rect key={`e${b.slot}`} x={x} y={baseY - chart.bar.emptyH} width={barW}
            height={chart.bar.emptyH} rx={Math.min(chart.bar.emptyRadius, barW / 2)}
            fill={mm.colors.emptyFill} opacity={chart.bar.opacity.solid} />,
        );
        continue;
      }
      hasData = true;
      const y = yAt(b.v);
      tapPoints.push({ cx: xOf(b.t), cy: y, t: b.t, v: b.v });
      const fill = colorOf?.(b.v) ?? chart.dayBarSegment[segmentOf?.(b.t) ?? 'awake'];
      bars.push(
        <Rect key={b.slot} x={x} y={y} width={barW}
          height={Math.max(chart.bar.minHeight, baseY - y)}
          rx={Math.min(chart.bar.radius, barW / 2)}
          fill={fill} opacity={chart.bar.opacity.solid} />,
      );
    }

    // ★ 2026-11-09（用户「去掉柱状图上面那个白色的趋势图那个线」）：
    //   原这里按 ~24 个取样点算分段平滑折线（meanPaths），画成压在柱子之上的纯白趋势线。
    //   用户要求去掉这条线；柱状图保留。整段平滑计算一并移除，日视图不再做无用功。
    //   `mean` 变量保留只为兼容 meanLine 参数与下方 geom 依赖数组。
    const meanPaths: string[] = [];

    const minorLines: React.ReactNode[] = [];
    if (minorTicks) {
      const stepH = DAY_MINOR_TICK_MINUTES / 60;
      for (let k = 0; k * stepH <= 24 + 1e-9; k++) {
        const hh = k * stepH;
        if (Math.abs(hh % 1) < 1e-6) continue;              // 整小时已有主刻度线
        const x = PAD_L + (plotW * hh) / 24;
        if (x > PAD_L + plotW) break;
        minorLines.push(
          <Line key={`m${hh}`} x1={x} y1={PAD_T} x2={x} y2={baseY}
            stroke={chart.grid} strokeWidth={chart.lw.grid} opacity={0.5} />,
        );
      }
    }

    const labelDefs = tickLabels
      ? tickLabels.map((l) => ({ frac: l.frac, label: l.label }))
      : DAY_HOUR_TICKS.map((hh) => ({ frac: hh / 24, label: hourTickLabel(hh) }));
    // ★ 2026-11-05（用户实锤「心率/血氧详情页 20 点跟 24 点重合」）：
    //   这是心率/血氧/HRV/压力**日视图真正生效**的 X 轴（SVG SvgText），不走 AxisLabels。
    //   ① 刻度改 6h 等距 → 相邻中心距 plotW/4，不再挤在一起；
    //   ② 首末标签按文字半宽 clamp 到绘图区内，middle 锚点保证不越界、不被裁；
    //   ③ 自定义 tickLabels（HRV 夜间窗口刻度较密）时，与上一个标签距离不足就跳过，
    //      但首尾两个标签永远保留 → 既不重叠也不丢时间端点。
    //   竖线始终画在原始刻度 x 上，只有文字位置被 clamp，视觉不错位。
    const labelHalf = (s: string) => (s.length * chart.axisFont * 0.62) / 2;
    let lastKeptX = -Infinity;
    const ticks: React.ReactNode[] = labelDefs.map((l, i) => {
      const rawX = PAD_L + plotW * l.frac;
      const lh = labelHalf(l.label);
      const x = Math.max(PAD_L + lh, Math.min(PAD_L + plotW - lh, rawX));
      const isEdge = i === 0 || i === labelDefs.length - 1;
      if (!isEdge && x - lastKeptX < lh * 2 + 4) return null;
      lastKeptX = x;
      return (
        <React.Fragment key={`t${l.label}-${i}`}>
          <Line x1={rawX} y1={PAD_T} x2={rawX} y2={baseY} stroke={chart.grid} strokeWidth={chart.lw.grid} />
          <SvgText x={x} y={H - 6} fontSize={chart.axisFont} fill={chart.axisText}
            textAnchor="middle">
            {l.label}
          </SvgText>
        </React.Fragment>
      );
    });

    const yLabels: React.ReactNode[] = [];
    for (const g of niceTicks(range.lo, range.hi)) {
      const y = yAt(g);
      if (y < PAD_T - 1 || y > baseY + 1) continue;
      // 最底部刻度抬高，避免与 X 轴标签带重叠造成「被遮挡」
      const ty = Math.min(y + 3, baseY - 8);
      yLabels.push(
        <SvgText key={`y${g}`} x={PAD_L - 5} y={ty} fontSize={chart.axisFont} fill={chart.axisText}
          textAnchor="end">{fmtTick(g)}</SvgText>,
      );
    }

    const baseline = <Line x1={PAD_L} y1={baseY} x2={PAD_L + plotW} y2={baseY}
      stroke={chart.grid} strokeWidth={chart.lw.grid} />;

    // ★ 2026-11-05（用户：心情 icon 标到趋势图相应时间点）：按 ts 换算 X，
    //   绘图区顶部画竖向虚线 + 白色光晕底，定位「这个时刻记了心情」；
    //   真正的 MoodBlob 由外层 RN 层叠覆盖（SVG 内不便嵌动态 blob）。
    let moodNode: React.ReactNode = null;
    if (moodMarker) {
      const mx = xOf(moodMarker.ts);
      if (mx >= PAD_L && mx <= PAD_L + plotW) {
        moodNode = (
          <React.Fragment key="mood">
            <Line x1={mx} y1={PAD_T} x2={mx} y2={baseY}
              stroke={theme.colors.textSub} strokeWidth={1} strokeDasharray="3,4" opacity={0.5} />
            <Rect x={mx - 12} y={PAD_T - 2} width={24} height={20} rx={6}
              fill={theme.colors.cardBg} opacity={0.92} />
          </React.Fragment>
        );
      }
    }

    return { bars, meanPaths, minorLines, ticks, yLabels, baseline, hasData, moodNode, tapPoints };
  }, [buckets, w, plotW, plotH, range.lo, range.hi, t0, spanMs, now, segmentOf, colorOf, minorTicks, mean, H, tickLabels, mutedRanges, moodMarker, denseBars]);

  // ★ 2026-11-05（用户）：心情 marker 的 X 坐标（外层 RN 叠 MoodBlob 用，不进 SVG）
  const moodX = moodMarker && w > 0 ? PAD_L + (plotW * (moodMarker.ts - t0)) / spanMs : null;
  const moodVisible = moodX != null && moodX >= PAD_L - 1 && moodX <= PAD_L + plotW + 1;

  // ★ 统一数值气泡：点任意一根柱 → 显示该时刻 + 数值（有单位时带单位）
  const tapSlots = useMemo<ChartTapSlot[]>(() => {
    if (!geom || w <= 0) return [];
    return geom.tapPoints.map((p) => {
      const d = new Date(p.t);
      const hh = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const v = Number.isInteger(p.v) ? String(p.v) : p.v.toFixed(1);
      return {
        fx: p.cx / w,
        fy: p.cy / H,
        label: `${hh}:${mins}`,
        value: unit ? `${v} ${unit}` : v,
      };
    });
  }, [geom, w, H, unit]);

  return (
    <View onLayout={onLayout}>
      {geom && (
        <Svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
          {geom.minorLines}
          {geom.yLabels}
          {geom.ticks}
          {geom.baseline}
          {geom.bars}
          {/* ★ 2026-11-09（用户）：白色「全天均值」趋势线 + 卡底色衬底描边已整体移除。
              柱状图只留 288 根小柱，不再叠任何折线；meanPaths 恒为空数组。 */}
          {/* ★ 2026-11-05（用户）：心情 icon 标在趋势图上的对应时间点（最上层，盖在柱之上） */}
          {geom.moodNode}
        </Svg>
      )}
      {/* ★ 2026-11-05（用户）：MoodBlob 叠在趋势图顶部对应时间点（不进 SVG，保动态 blob） */}
      {moodVisible && moodMarker ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: (moodX ?? 0) - 11, top: PAD_T - 3, width: 22, height: 22, zIndex: 5 }}
        >
          <MoodBlob mood={moodMarker.mood} size={22} variant={1} />
        </View>
      ) : null}
      <ChartTapTip slots={tapSlots} height={H} width={w} />
    </View>
  );
}

/**
 * 全天柱状小条的图例。
 *
 * 默认三色分段（睡眠/清醒/活动，供 HR / 血氧 / HRV 等用 `segmentOf` 的图使用）；
 * `items` 可传自定义项（情绪这类「状态型」图用 colorOf 按方向分色，图例也要跟着换，
 * 否则图例写「睡眠/清醒/活动」而柱子按情绪方向着色，用户完全对不上 —— 用户 2026-10-12 实锤）。
 */
export function DayBarsLegend({
  showMean = false,
  items,
}: {
  /** ★ 2026-11-09：白色均值线已移除，此参数保留兼容，恒不显示 */
  showMean?: boolean;
  items?: { color: string; label: string }[];
}) {
  const its: { color: string; label: string }[] = items ?? [
    { color: chart.dayBarSegment.sleep, label: '睡眠' },
    { color: chart.dayBarSegment.awake, label: '清醒' },
    { color: chart.dayBarSegment.active, label: '活动' },
  ];
  return (
    <View style={styles.legend}>
      {its.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
      {showMean && (
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: mm.colors.ink }]} />
          <Text style={styles.legendText}>全天均值</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Y 轴刻度：整数友好 + **按数量抽稀**。
 *
 * ★ 2026-10-10（用户：「HRV 纵坐标太密了，不要显示那么多个数值，可以隔几个展示一下」）：
 *   原来只看量程选步长（≤40 用 5），HRV 量程 20~100 会冒出 17 条刻度，挤成一团。
 *   现在从小到大挑**第一个能让刻度数 ≤ maxCount 的步长** —— 保留分辨率又不挤。
 */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

function niceTicks(lo: number, hi: number, maxCount = 5): number[] {
  const range = Math.max(1e-6, hi - lo);
  const countOf = (step: number) => Math.floor(range / step) + 1;
  let step = TICK_STEPS[TICK_STEPS.length - 1];
  for (const c of TICK_STEPS) {
    if (countOf(c) <= maxCount) { step = c; break; }
  }
  const out: number[] = [];
  for (let v = Math.ceil(lo); v <= hi; v += step) out.push(v);
  return out;
}

function fmtTick(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
    marginTop: theme.sp(1.5),
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  legendSwatch: { width: 10, height: 10, borderRadius: theme.radius.xs },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
});