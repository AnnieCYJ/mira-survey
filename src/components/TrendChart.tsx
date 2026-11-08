import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { MOODS, TREND_AXIS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS, isSameDay, type CurvePoint } from '../lib/dailyStatus';
import { DAY_HOUR_TICKS_COMPACT } from '../lib/chartAxis';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayFrac(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const f = (t - d.getTime()) / DAY_MS;
  return Math.min(1, Math.max(0, f));
}

function moodFor(value: number) {
  const idx = curveLevel(value, CURVE_DEFAULTS).index;
  return MOODS[idx] ?? MOODS[1];
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** ★ v18.105：断流阈值 —— 相邻采样点间隔超过 90 分钟就断开（戒指摘下 / 没电 / 离线回填的空白段不连线）。
 *  用户实锤口径：0:29 之后没再戴戒指，0:29 到现在的这一整段都应该是「空的」，不能把线连过去。 */
const GAP_MS = 90 * 60 * 1000;

interface Props {
  width: number;
  height?: number;
  timeline?: CurvePoint[];
  /** ★ v18.105：断流（dataStale）——只在空态文案上区分「戴过但没新数据」与「压根没数据」 */
  stale?: boolean;
}

interface PPoint {
  x: number;
  y: number;
  value: number;
  t: number;
}

export default function TrendChart({ width, height = theme.fs(108), timeline, stale }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const padX = 10;  // 左右内边距, 保证首尾点不被左/右边缘裁掉

  const { segPaths, fillPaths, gradStops, pts, minGapX, hasGap } = useMemo(() => {
    // padX 用顶层常量
    // ★ 顶部留出气泡高度：值 100 的峰点也只到 padTop 线，浮层气泡完全悬在曲线上方，不再盖住峰点
    const padTop = 36;
    const padBottom = 6;
    const innerW = Math.max(1, width - padX * 2);
    const now = Date.now();
    // ★ v18.106：只画**真实采样点** —— `fill:true` 是 healthStore intraday 反推的「补齐空缺」点，
    //   用户口径实锤：断流期（0:29 采过一次、之后没戴戒指）中间那一段必须是空白，不是一条伪造的水平线。
    const source: { value: number; t: number }[] = (timeline ?? [])
      .filter((p) => p && !p.fill && typeof p.value === 'number' && Number.isFinite(p.value) && Number.isFinite(p.t) && isSameDay(p.t, now))
      .map((p) => ({ value: p.value, t: p.t }));

    const empty = { segPaths: [] as string[], fillPaths: [] as string[], gradStops: [] as { offset: string; color: string }[], pts: [] as PPoint[], minGapX: 28, hasGap: false };
    if (source.length === 0) return empty;

    const p: PPoint[] = source.map((s) => {
      const frac = dayFrac(s.t);
      const x = padX + innerW * frac;
      const y = height - padBottom - (height - padTop - padBottom) * (s.value / 100);
      return { x, y, value: s.value, t: s.t };
    });

    // ★ v18.105 断流分段：相邻点时间差 > GAP_MS → 另起一段，段间不连线（空白就是空白）
    const groups: PPoint[][] = [];
    for (const pt of p) {
      const cur = groups[groups.length - 1];
      if (!cur || pt.t - cur[cur.length - 1].t > GAP_MS) groups.push([pt]);
      else cur.push(pt);
    }

    /** Catmull-Rom → Cubic Bezier: 真正平滑的样条插值（单段内） */
    const buildPath = (g: PPoint[]): string => {
      if (g.length < 2) return '';
      let d = `M ${g[0].x.toFixed(1)} ${g[0].y.toFixed(1)}`;
      for (let i = 0; i < g.length - 1; i++) {
        const p0 = g[Math.max(0, i - 1)];
        const p1 = g[i];
        const p2 = g[i + 1];
        const p3 = g[Math.min(g.length - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) * 0.22;
        const cp1y = p1.y + (p2.y - p0.y) * 0.22;
        const cp2x = p2.x - (p3.x - p1.x) * 0.22;
        const cp2y = p2.y - (p3.y - p1.y) * 0.22;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
      return d;
    };
    /** 波浪收口：首尾用贝塞尔平滑下探到底部，不是硬垂直线（按段计算，段外不留填充） */
    const buildFill = (g: PPoint[]): string => {
      const d = buildPath(g);
      if (!d) return '';
      const fLN = g[0].x;
      const fLYN = g[0].y;
      const fRN = g[g.length - 1].x;
      const dipX = Math.min(28, (fRN - fLN) * 0.15);
      return `${d} C ${(fRN - dipX).toFixed(1)} ${fLYN.toFixed(1)}, ${fRN.toFixed(1)} ${height}, ${fRN.toFixed(1)} ${height} L ${fLN.toFixed(1)} ${height} C ${fLN.toFixed(1)} ${height}, ${(fLN + dipX).toFixed(1)} ${fLYN.toFixed(1)}, ${fLN.toFixed(1)} ${fLYN.toFixed(1)} Z`;
    };

    const segPaths = groups.map(buildPath).filter(Boolean);
    const fillPaths = groups.map(buildFill).filter(Boolean);

    // 多 stop LinearGradient: 每个点一个 stop，颜色随位置变化（跨全图点范围）
    const totalX = p[p.length - 1].x - p[0].x || 1;
    const gradStops = p.map((pt) => ({
      offset: ((pt.x - p[0].x) / totalX * 100).toFixed(2) + '%',
      color: moodFor(pt.value).color,
    }));

    let gap = 28;
    for (let i = 0; i < p.length - 1; i++) {
      const g = Math.abs(p[i + 1].x - p[i].x);
      if (g > 0 && g < gap) gap = g;
    }
    return { segPaths, fillPaths, gradStops, pts: p, minGapX: gap, hasGap: groups.length > 1 };
  }, [width, height, timeline]);

  const selIdx = selected != null && selected >= 0 && selected < pts.length
    ? selected
    : (pts.length > 0 ? pts.length - 1 : null);

  // ★ v18.105/106：无数据 **或断流（dataStale）** 都保留「空图表」骨架
  //   （基线 + 横向刻度 + 虚线占位框 + 居中说明），不再只丢一个小字「暂无数据」，
  //   也不再画任何曲线/圆点/气泡 —— 断流时用户看到的必须是「一张空着的图」。
  if (pts.length === 0 || stale) {
    const padTop = 36;
    const padBottom = 6;
    const innerW = Math.max(1, width - padX * 2);
    const baseY = height - padBottom;
    return (
      <View style={[styles.empty, { width, height }]}>
        {/* ★ v18.108：空图表 = 骨架铺满 + 「暂无数据」绝对定位压在图表**正中**（叠在虚线框中间），
            不再把它排在 SVG 下面（旧实现文字落在图表下方、贴着时间轴，看着像图外的说明文字）。 */}
        <View style={styles.emptySvgLayer}>
        <Svg width={width} height={height}>
          {[25, 50, 75].map((v) => {
            const y = baseY - (baseY - padTop) * (v / 100);
            return <Line key={v} x1={padX} y1={y} x2={width - padX} y2={y} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />;
          })}
          <Line x1={padX} y1={baseY} x2={width - padX} y2={baseY} stroke={chart.grid} strokeWidth={chart.lw.grid} />
          {DAY_HOUR_TICKS_COMPACT.map((h) => (
            <SvgText key={h} x={padX + innerW * (h / 24)} y={baseY + 12} fontSize={9} fill={theme.colors.textSub} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
              {String(h).padStart(2, '0')}
            </SvgText>
          ))}
          {/* 空图表占位：虚线框明确「这里本该有曲线」 */}
          <Rect x={padX} y={padTop} width={innerW} height={Math.max(4, baseY - padTop)} rx={6} fill="none" stroke={theme.colors.cardBorder} strokeWidth={1} strokeDasharray="4 5" />
        </Svg>
        </View>
        {/* ★ v18.107：空态只有这一句 —— 「暂无数据」；★ v18.108 改成绝对定位压在图表正中
            （纵轴落在绘图区 padTop~baseY 的中间），不再排到 SVG 下面、看着像图外的说明文字。 */}
        <Text style={[styles.emptyText, { top: (padTop + baseY) / 2 - 8 }]}>暂无数据</Text>
      </View>
    );
  }

  const hitW = Math.max(18, Math.min(minGapX, 34) - 2);
  const hitH = 26;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
            {gradStops.map((gs, i) => (
              <Stop key={'gs' + i} offset={gs.offset} stopColor={gs.color} />
            ))}
          </LinearGradient>
          <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={gradStops[0]?.color ?? '#8B5CF6'} stopOpacity={0.28} />
            <Stop offset="55%" stopColor={gradStops[Math.floor(gradStops.length/2)]?.color ?? '#8B5CF6'} stopOpacity={0.10} />
            <Stop offset="100%" stopColor={gradStops[gradStops.length-1]?.color ?? '#8B5CF6'} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {/* ★ v18.105 波浪填充逐段收口：断流的空白段不铺填充（原来整条 path 会一路填到底，
            看着像「今天一直有数据」）。单点的段没有 path，只有下面的圆点。 */}
        {fillPaths.map((d, i) => <Path key={`fill${i}`} d={d} fill="url(#trendFill)" />)}
        {segPaths.map((d, i) => (
          <Path key={`seg${i}`} d={d} fill="none" stroke="url(#trendStroke)" strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {/* 单点段（例如只在 00:29 采过一次）：只画点，不画任何线（孤立单点无折线可画） */}
        {pts.length === 1 ? (
          (() => {
            const p = pts[0]!;
            return <Circle key="solo" cx={p.x} cy={p.y} r={5} fill={moodFor(p.value).color} stroke="#fff" strokeWidth={2} />;
          })()
        ) : null}
        {/* ★ 2026-10-21（用户）：不再在最新数据点画实心圆（selDot）—— 趋势图只留线，
           当前档位已由下方彩色气泡（backgroundColor=mood.color）表达，圆点属冗余装饰。 */}
      </Svg>

      {selIdx != null && pts[selIdx] ? (() => {
        const p = pts[selIdx]!;
        const mood = moodFor(p.value);
        const bubbleW = 78;
        const left = Math.max(4, Math.min(width - bubbleW - 4, p.x - bubbleW / 2));
        const top = Math.max(2, p.y - 46);
        return (
          <Pressable key="bubble" pointerEvents="none" style={[styles.bubble, { left, top, backgroundColor: mood.color }]}>
            <Text style={styles.bubbleLevel}>{mood.label} {Math.round(p.value)}</Text>
            <Text style={styles.bubbleTime}>{fmtTime(p.t)}</Text>
          </Pressable>
        );
      })() : null}

      {pts.map((p, i) => (
        <Pressable key={`hit-${i}`} onPress={() => setSelected(i)} style={[styles.hit, { left: Math.max(padX, p.x - hitW / 2), top: Math.max(0, p.y - hitH / 2), width: hitW, height: hitH }]} />
      ))}
    </View>
  );
}


export function TrendAxis({ width }: { width: number }) {
  return (
    <View style={[styles.axis, { width }]}>
      {TREND_AXIS.map((t) => (<Text key={t} style={styles.axisText}>{t}</Text>))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptySvgLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  // ★ v18.108：叠在图表正中的空态文字（top 由绘图区中线算出，左右铺满 + 居中对齐）
  emptyText: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  bubble: { position: 'absolute', minWidth: 70, paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  bubbleLevel: { fontSize: theme.fontSize.tiny, color: theme.colors.textWhite, fontWeight: theme.weight.semibold },
  bubbleTime: { fontSize: theme.fontSize.tiny, color: theme.colors.ui.white85, marginTop: 1 },
  hit: { position: 'absolute', backgroundColor: 'transparent' },
});
