/**
 * ConsumptionHighlightCards —— 首页「消耗」卡下方的三张大卡（新增组件）
 *
 * 样式对齐用户给的参考稿（dashboard 卡）：
 *   左上：标题（情绪消耗 / 脑力消耗 / 运动消耗）
 *   右上：彩色关键比例（占 XX%）+ 灰色上下文（今日构成）
 *   左中：超大数字（fontSize.hero）+ 单位；下面一行「彩色强调 + 灰色说明」
 *   右侧：一片横向柔光（白 → 色晕 → 白，参考稿就是右侧那片晕开的光）
 *         + 一条平滑的现实曲线（3 小时移动平均去抖）+ 端点圆点
 *         + 白底两行浮标（**贴在曲线末端上方**，参考稿的做法）
 *
 * ★ 上一版踩过的坑（已修）：
 *   1) 浮标固定钉在卡片右上 → 情绪卡浮标悬在空白上、脑力卡浮标压在曲线中段。
 *      现在按曲线末点坐标定位（上下夹住不越界，水平贴右侧端点向左展开）。
 *   2) 逐时原始值直接连点 → 脑力那条线锯齿乱抖、运动那条成了「L 形台阶」。
 *      现在画之前做 3 小时移动平均。
 *   3) 今天没数据（如 0 个压力事件）时右侧整片空白 → 现在不画曲线，浮标居中并写明「今日暂无记录」。
 *   4) 占比与卡上数值不同口径（显示 0 次却 占 39%）→ 已统一到 computeConsumption（事件数 / 负荷分 / 步数）。
 *
 * 数据口径（与 ConsumptionCard / 首页既有卡片同源）：
 *   · 占比 / 数值 → computeConsumption(ring)
 *   · 情绪逐时 = computeStressReport().hourBuckets[].count
 *   · 脑力逐时 = computeCognitiveLoadReport().hourly[].score
 *   · 运动逐时 = healthStore.getIntraday('steps', 今日) 按小时求和
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { healthStore, dayKey } from '../data/healthStore';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { smoothPath } from '../lib/svgSmooth';
import { computeConsumption, fmtShare, type NavType, type Seg } from './ConsumptionCard';

const CHART_H = 74;        // 曲线绘制区高度
const CHIP_W = 104;        // 浮标宽度（用于夹住不越界）
const CHIP_H = 40;         // 浮标高度（估算，用于贴曲线末端定位）
const CARD_MIN_H = 140;    // 卡片最小高度

type Hourly = number[];

/** 3 点移动平均：逐时原始值噪声大（脑力尤其），先平滑再画 */
function smooth3(arr: number[]): number[] {
  if (arr.length < 3) return arr;
  return arr.map((_, i) => {
    const a = arr[i - 1] ?? arr[i];
    const b = arr[i];
    const c = arr[i + 1] ?? arr[i];
    return (a + b + c) / 3;
  });
}

function emotionHourly(): Hourly {
  try {
    const buckets = (computeStressReport() as any)?.hourBuckets as { hour: number; count: number }[] | undefined;
    const out = new Array(24).fill(0);
    if (buckets) for (const b of buckets) if (b.hour >= 0 && b.hour < 24) out[b.hour] = b.count;
    return out;
  } catch { return new Array(24).fill(0); }
}

function brainHourly(): Hourly {
  try {
    const hourly = (computeCognitiveLoadReport() as any)?.hourly as { hour: number; score: number }[] | undefined;
    const out = new Array(24).fill(0);
    if (hourly) for (const h of hourly) if (h.hour >= 0 && h.hour < 24) out[h.hour] = h.score;
    return out;
  } catch { return new Array(24).fill(0); }
}

function sportHourly(): Hourly {
  try {
    const out = new Array(24).fill(0);
    for (const p of healthStore.getIntraday('steps', dayKey(Date.now()))) {
      if (!Number.isFinite(p.v) || p.v <= 0) continue;
      const h = new Date(p.t).getHours();
      if (h >= 0 && h < 24) out[h] += p.v;
    }
    return out;
  } catch { return new Array(24).fill(0); }
}

/** 单张大卡 */
function HighlightCard({
  seg,
  hourly,
  onNav,
}: {
  seg: Seg;
  hourly: Hourly;
  onNav?: (type: NavType) => void;
}) {
  const [chartW, setChartW] = useState(0);

  // 只画到「当前小时」；再平滑去抖
  const nowHour = new Date().getHours();
  const data = useMemo(
    () => smooth3(hourly.slice(0, nowHour + 1)),
    [hourly, nowHour],
  );
  const hasCurve = data.some((v) => v > 0);

  const maxV = Math.max(...data, 0.0001);
  const xOf = (i: number) => (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW);
  // 上下留 8px 余量，曲线不贴边
  const yOf = (v: number) => CHART_H - 8 - (v / maxV) * (CHART_H - 16);

  const pts = data.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const linePath = smoothPath(pts);
  const endPt = pts.length ? pts[pts.length - 1] : null;

  // 浮标：贴在曲线末端上方；水平贴右端向左展开；上下夹在绘制区内
  const chipLeft = chartW > 0 ? Math.max(0, Math.min(chartW - CHIP_W, chartW - CHIP_W)) : 0;
  const chipTop = endPt
    ? Math.max(0, Math.min(CHART_H - CHIP_H, endPt.y - CHIP_H - 10))
    : Math.max(0, (CHART_H - CHIP_H) / 2);

  const chipSub = hasCurve ? seg.sub : '今日暂无记录';

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={!onNav}
      onPress={() => onNav?.(seg.nav)}
      accessibilityRole="button"
      accessibilityLabel={`${seg.label} ${seg.value}${seg.unit}`}
      style={{ marginTop: theme.space.md }}
    >
      <View style={styles.card}>
        {/* 右侧柔光：白 → 色晕 → 白（参考稿就是右侧那片晕开的光，色值走 cardGlowXxx token） */}
        <LinearGradient
          colors={[theme.colors.cardBg, seg.glow, theme.colors.cardBg] as unknown as string[]}
          locations={[0.34, 0.72, 1]}
          start={{ x: 0, y: 0.15 }}
          end={{ x: 1, y: 0.85 }}
          style={StyleSheet.absoluteFill}
        />

        {/* 右侧曲线 + 浮标 */}
        <View
          style={styles.chartBox}
          onLayout={(e) => setChartW(e.nativeEvent.layout.width)}
          pointerEvents="none"
        >
          {chartW > 0 && hasCurve ? (
            <Svg width={chartW} height={CHART_H}>
              <Path
                d={linePath}
                fill="none"
                stroke={seg.color}
                strokeOpacity={0.5}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {endPt ? <Circle cx={endPt.x} cy={endPt.y} r={2.8} fill={seg.color} fillOpacity={0.8} /> : null}
            </Svg>
          ) : null}

          <View style={[styles.chip, { left: chipLeft, top: chipTop }]}>
            <Text style={styles.chipValue} numberOfLines={1}>{seg.value}{seg.unit === '/100' ? '' : ` ${seg.unit}`}</Text>
            <Text style={styles.chipSub} numberOfLines={1}>{chipSub}</Text>
          </View>
        </View>

        {/* 左侧文字区 */}
        <View style={styles.textCol}>
          <View style={styles.headRow}>
            <Text style={styles.title} numberOfLines={1}>{seg.label}</Text>
            <View style={styles.headRight}>
              <Text style={[styles.share, { color: seg.color }]} numberOfLines={1}>
                占 {fmtShare(seg.share)}
              </Text>
              <Text style={styles.shareLabel} numberOfLines={1}>今日构成</Text>
            </View>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
              {seg.value}
            </Text>
            <Text style={styles.unit}>{seg.unit}</Text>
          </View>

          <Text style={styles.sub} numberOfLines={1}>
            <Text style={{ color: seg.color }}>{seg.sub}</Text>
            <Text> · 今日</Text>
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ConsumptionHighlightCards({
  ring,
  onNav,
}: {
  ring: any;
  onNav?: (type: NavType) => void;
}) {
  const { segs } = useMemo(() => computeConsumption(ring), [ring]);
  const curves = useMemo<Record<string, Hourly>>(
    () => ({ emotion: emotionHourly(), brain: brainHourly(), sport: sportHourly() }),
    [ring],
  );

  return (
    <View>
      {segs.map((s) => (
        <HighlightCard key={s.key} seg={s} hourly={curves[s.key] ?? []} onNav={onNav} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    minHeight: CARD_MIN_H,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // 右侧曲线区（纵向撑满卡片内容区，让曲线有舒展空间）
  chartBox: {
    position: 'absolute',
    right: theme.space.cardPad,
    top: theme.space.cardPad + theme.sp(7),
    width: '56%',
    height: CHART_H,
  },
  // 浮标：白底两行小字，贴在曲线末端
  chip: {
    position: 'absolute',
    width: CHIP_W,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.cardBg,
    paddingHorizontal: theme.sp(1.75),
    paddingVertical: theme.sp(1.25),
  },
  chipValue: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  chipSub: {
    fontSize: theme.fs(10),
    color: theme.colors.textSub,
    marginTop: theme.sp(0.25),
  },
  // 左侧文字
  textCol: { alignItems: 'flex-start' },
  headRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  headRight: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 'auto' },
  share: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
  },
  shareLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginLeft: theme.sp(1),
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: theme.space.sm },
  // 参考稿里的超大数字
  value: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  unit: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginLeft: theme.sp(1),
  },
  sub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
});
