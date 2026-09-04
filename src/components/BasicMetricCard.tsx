import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import Card from './Card';
import { TREND_AXIS } from '../data/metrics';
import { formatRelativeTime } from '../utils/format';
import type { BasicMetricDef } from '../data/metrics';

// 与 DimensionCard 同源的折线算法，但 X 轴改为"今日时间"（0:00→24:00），Y 轴改为固定生理量程。
// 数据点按时间排序后绘制；相邻点间隔超过 30 分钟则断线（诚实留白，不编造连续趋势）。
function buildDayPath(
  points: { t: number; v: number }[],
  w: number,
  h: number,
  dayStart: number,
  dayEnd: number,
  yMin: number,
  yMax: number
) {
  // 防御：任何非有限值（NaN/Infinity）都会导致 iOS 原生 SVG 渲染器直接崩溃（硬退出）。
  const clean = points
    .filter(
      (p) =>
        Number.isFinite(p.t) &&
        Number.isFinite(p.v) &&
        p.t >= dayStart &&
        p.t <= dayEnd + SLOT_MS
    )
    .slice()
    .sort((a, b) => a.t - b.t);
  if (clean.length < 2) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, hasData: false };

  const pad = theme.sp(2);
  const xOf = (t: number) => pad + ((w - pad * 2) * (t - dayStart)) / (dayEnd - dayStart);
  const yRange = yMax - yMin || 1;
  const yOf = (v: number) => {
    const y = h - pad - (h - pad * 2) * ((v - yMin) / yRange);
    return Math.max(pad, Math.min(h - pad, y));
  };
  const pts = clean.map((p) => ({ x: xOf(p.t), y: yOf(p.v), t: p.t }));

  const GAP = 30 * 60 * 1000; // 30 分钟以上无数据 → 断线
  let lineD = '';
  let areaD = '';
  let seg: { x: number; y: number }[] = [];
  const flushSeg = () => {
    if (seg.length < 2) {
      seg = [];
      return;
    }
    let d = `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i];
      const b = seg[i + 1];
      const mx = (a.x + b.x) / 2;
      d += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    lineD += d;
    areaD += `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(h - pad).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(h - pad).toFixed(1)} Z`;
    seg = [];
  };
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].t - pts[i - 1].t > GAP) flushSeg();
    seg.push({ x: pts[i].x, y: pts[i].y });
  }
  flushSeg();

  const last = pts[pts.length - 1];
  return { lineD, areaD, last: { x: last.x, y: last.y }, hasData: true };
}

const SLOT_MS = 60_000;
const DAY_MS = 86_400_000;

interface Props {
  metric: BasicMetricDef;
  /** 是否开启全局「基础指标自动监测」（设置页控制），决定下方趋势图是否展示 */
  auto: boolean;
  /** 是否已收到戒指真实数据 */
  live: boolean;
  /** 是否正在等待戒指回包 */
  syncing: boolean;
  /** 当前数值（优先真实值，未收到则回退到 mock） */
  value: string;
  /** 全天趋势数据：每个点 { t: epoch ms, v: 数值 }，按今日时间轴绘制 */
  data: { t: number; v: number }[];
  /** 手动测量回调 */
  onMeasure: () => void;
  /** 自动同步类信号（如睡眠/计步/血糖）无可手动测量，隐藏按钮避免误导 */
  hideMeasure?: boolean;
  /** 最近测量/更新时间（epoch ms），显示在数值右侧，确认数据新鲜度 */
  measureTime?: number | null;
  /** 点击卡片进入「指标历史详情」全屏页 */
  onPress?: () => void;
  /** 是否渲染全天趋势图（默认 true） */
  showTrend?: boolean;
}

export default function BasicMetricCard({
  metric,
  auto,
  live,
  syncing,
  value,
  data,
  onMeasure,
  hideMeasure,
  measureTime,
  onPress,
  showTrend = true,
}: Props) {
  const [w, setW] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [lastMeasured, setLastMeasured] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const h = theme.fs(88);
  const gid = `bm_${metric.key}`;
  const { lineD, areaD, last, hasData } = useMemo(() => {
    const now = Date.now();
    const ds = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    return buildDayPath(data, w, h, ds, ds + DAY_MS, metric.yMin, metric.yMax);
  }, [data, w, h, metric.yMin, metric.yMax]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onPressMeasure = () => {
    if (measuring) return;
    setMeasuring(true);
    onMeasure();
    timer.current = setTimeout(() => {
      setMeasuring(false);
      setLastMeasured(Date.now());
    }, 2000);
  };

  const measureLabel = measuring || syncing ? '测量中…' : lastMeasured ? '刚刚测量' : '手动测量';
  const statusTag = live ? '实时' : syncing ? '同步中' : '待接入';

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.92 : 1} onPress={onPress} disabled={!onPress}>
      <Card>
      {/* 顶部：名称 + 状态标签 + 手动测量按钮（与 DimensionCard 顶部节奏一致） */}
      <View style={styles.top}>
        <View style={styles.topLeft}>
          <Text style={styles.name}>{metric.name}</Text>
          <View style={[styles.tag, live ? styles.tagLive : syncing ? styles.tagSync : styles.tagOff]}>
            <Text style={[styles.tagText, live ? styles.tagTextLive : styles.tagTextOff]}>{statusTag}</Text>
          </View>
        </View>
        {!hideMeasure && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPressMeasure}
            style={[styles.measureWrap, measuring && styles.measureWrapBusy]}
          >
            <Text style={[styles.measureLabel, measuring && styles.measureLabelBusy]}>{measureLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 当前数值 + 单位 + 最近测量时间（右侧，确认数据新鲜度） */}
      <View style={styles.main}>
        <Text style={styles.val}>{value}</Text>
        <Text style={styles.unit}>{metric.unit}</Text>
        <Text style={styles.measuredAt}>{formatRelativeTime(measureTime)}</Text>
      </View>

      <Text style={styles.range}>{metric.range}</Text>

      {/* 自动监测开启 + showTrend → 全天时间轴趋势图 */}
      {auto && showTrend ? (
        <View style={styles.chartWrap}>
          <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={h}>
                <Defs>
                  <LinearGradient id={`${gid}_grad`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} stopOpacity={0.32} />
                    <Stop offset="100%" stopColor={theme.colors.accent2} stopOpacity={0.02} />
                  </LinearGradient>
                  <LinearGradient id={`${gid}_line`} x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} />
                    <Stop offset="100%" stopColor={theme.colors.accent2} />
                  </LinearGradient>
                </Defs>
                {/* 与睡眠/激素卡片视觉同源：渐变面积 + 渐变曲线 + 末端白点；无数据则整张图留白 */}
                {hasData && <Path d={areaD} fill={`url(#${gid}_grad)`} />}
                {hasData && <Path d={lineD} fill="none" stroke={`url(#${gid}_line)`} strokeWidth={2.4} strokeLinecap="round" />}
                {hasData && <Circle cx={last.x} cy={last.y} r={4.5} fill="#FFFFFF" stroke={theme.colors.accentSolid} strokeWidth={2.4} />}
              </Svg>
            ) : null}
          </View>
          {/* 全天时间轴刻度：0/6/12/18/24 时（仅轻量文字，无轴线，与 Today 页「全天状态趋势」同源） */}
          <View style={styles.axisLabels}>
            {TREND_AXIS.map((label) => (
              <Text key={label} style={styles.axisLabel}>{label}</Text>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.offBox}>
          <Text style={styles.offText}>未开启自动监测，点击右上角手动测量</Text>
        </View>
      )}

      <Text style={styles.note}>{metric.note}</Text>

      {/* 监测频率置于卡片最底部 */}
      <View style={styles.freqRow}>
        <Text style={styles.freqLabel}>监测频率</Text>
        <Text style={styles.freqValue}>{metric.freq}</Text>
      </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: theme.space.sm,
  },
  name: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  tag: {
    marginLeft: theme.space.sm,
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
  },
  tagLive: { backgroundColor: theme.colors.successSoft },
  tagSync: { backgroundColor: theme.colors.accentSoft },
  tagOff: { backgroundColor: theme.colors.ui.offTrack },
  tagText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
  },
  tagTextLive: { color: theme.colors.success },
  tagTextOff: { color: theme.colors.textSub },
  measureWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
  },
  measureWrapBusy: { backgroundColor: theme.colors.ui.offTrack },
  measureLabel: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  measureLabelBusy: { color: theme.colors.textSub },
  main: { flexDirection: 'row', alignItems: 'baseline', marginBottom: theme.sp(1) },
  val: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  measuredAt: {
    marginLeft: 'auto',
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
  },
  range: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
    marginBottom: theme.space.sm,
  },
  chartWrap: { marginTop: theme.space.sm, marginBottom: theme.space.sm },
  axisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.sp(1),
  },
  axisLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  freqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.space.sm,
  },
  freqLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  freqValue: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  offBox: {
    marginTop: theme.space.sm,
    marginBottom: theme.space.sm,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.ui.offTrack,
  },
  offText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});
