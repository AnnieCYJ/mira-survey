import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { mm, pastelFamilyFor } from '../theme/mindmate';
import Card from './Card';
import Icon from './Icon';
import type { BasicMetricDef } from '../data/metrics';

// 与 DimensionCard 同源的折线算法，但 X 轴改为"今日时间"（0:00→24:00），
// Y 轴随今日真实数据自适应缩放（值域上下各留 12% 余量，单点/空时回退固定生理量程）。
// 数据点按时间排序后绘制；相邻点间隔超过 36h 则断线（诚实留白，不编造连续趋势）。
// v16 reskin（2026-09-24）：趋势线按指标 key 从五色 core 家族稳定取色（紫/蓝/粉/黄/黄绿mid），
// 同一指标永远同色（跨页面/刷新不变），不同指标错开色相。青色已删除。
const TREND_PALETTE: string[] = [
  mm.colors.purpleCore, // 紫 = 认知
  mm.colors.skyCore,    // 蓝 = 运动·心肺
  mm.colors.roseCore,   // 粉 = 情绪
  mm.colors.honeyCore,  // 黄 = 代谢
  mm.colors.limeMid,    // 黄绿 mid = 恢复
  mm.colors.purpleDeep, // 紫 deep（第 6 项兜底）
];
function trendColorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TREND_PALETTE[h % TREND_PALETTE.length];
}

/** 迷你趋势图 Y 标注：整数不带小数，小数保留 1 位。 */
function fmtMini(v: number): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * ★ 2026-10-10（用户）：今日横轴窗口**全局统一为「0:00 → 现在」**。
 *
 * 原来固定 0:00→24:00，于是每张卡画多长取决于「最后一条样本落在几点」：
 * 心率/血氧有样本到 19:00 → 线铺到右边；皮质醇最后一条在 11:32 → 线只到中间，
 * 视觉上就是「有的展示到现在、有的展示 24 小时」，横坐标完全不统一。
 *
 * 现在所有基础指标卡共用同一个「今日 0:00 → 现在」窗口：曲线一律从左端画到右端，
 * 轴右端统一写「现在 HH:mm」，一眼就知道数据到哪儿为止。
 * 距午夜不足 2h 时窗口太短没有意义，退回 0:00→24:00。
 */
const MIN_SPAN_MS = 2 * 3600_000;
function todayWindow(now = Date.now()): { start: number; end: number; left: string; right: string } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  const full = start + 86_400_000;
  const end = now - start < MIN_SPAN_MS ? full : now;
  const hm = (t: number) => {
    const x = new Date(t);
    return `${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`;
  };
  return { start, end, left: '0:00', right: end >= full ? '24:00' : `现在 ${hm(now)}` };
}

/**
 * ★ 2026-10-10（用户）：卡片右上角时间戳统一口径。
 * 原来超过 1 小时就直接显示「11:32」，看不出「数据停在 11:32」还是「11:32 刚测的」——
 * 19 点看皮质醇写着 11:32 就像坏了。加「截至」前缀明确是数据截止时间。
 */
function staleTag(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '尚未测量';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const d = new Date(ts);
  return `截至 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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

  // 断线阈值 60min：聚合粒度是 30min/点，相邻两个有数据的槽位间隔本来就 ≥30min，
  // 旧阈值 30min 会让「刚好差几秒到 30 分钟」的相邻点被误判成断线 → 曲线被切成一节一节（用户说的"看着乱"）。
  // 60min 恰好容许一个空槽（60min 采样、30min 一格）而不会误断。
  const GAP_MS = 60 * 60 * 1000;
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
    if (i > 0 && pts[i].t - pts[i - 1].t > GAP_MS) flushSeg();
    seg.push({ x: pts[i].x, y: pts[i].y });
  }
  flushSeg();

  const last = pts[pts.length - 1];
  return { lineD, areaD, last: { x: last.x, y: last.y }, hasData: true };
}

const SLOT_MS = 60_000;
const DAY_MS = 86_400_000;

interface Props {
  /** 洞察页 2 列小卡片形态：只留「图标+名称 / 数值 / 可选趋势图」，切掉 range/note/freq 三级信息 */
  compact?: boolean;
  metric: BasicMetricDef;
  /** 是否开启全局「基础指标自动监测」（设置页控制），决定下方趋势图是否展示 */
  auto: boolean;
  /** 是否已收到戒指真实数据 */
  live: boolean;
  /** 是否正在等待戒指回包 */
  syncing: boolean;
  /** 当前数值（由调用方从真实测量格式化；无真实数据时传 '—'，本组件不做任何 mock 回退） */
  value: string;
  /** 全天趋势数据：每个点 { t: epoch ms, v: 数值 }，按今日时间轴绘制 */
  data: { t: number; v: number }[];
  /** 手动测量回调 */
  onMeasure: () => void;
  /** 自动同步类信号（如睡眠/计步/血糖）无可手动测量，隐藏按钮避免误导 */
  hideMeasure?: boolean;
  /** 最近测量/更新时间（epoch ms），显示在数值右侧，确认数据新鲜度 */
  measureTime?: number | null;
  /** ★ 数据来源标签（如「今日日均」）。给出时替代相对时间，避免把日均值伪装成实时读数 */
  sourceLabel?: string;
  /** 点击卡片进入「指标历史详情」全屏页 */
  onPress?: () => void;
  /** 是否渲染全天趋势图（默认 true） */
  showTrend?: boolean;
}

export default function BasicMetricCard({
  compact = false,
  metric,
  auto,
  live,
  syncing,
  value,
  data,
  onMeasure,
  hideMeasure,
  measureTime,
  sourceLabel,
  onPress,
  showTrend = true,
}: Props) {
  const [w, setW] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [lastMeasured, setLastMeasured] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const h = theme.fs(84);
  const gid = `bm_${metric.key}`;
  // 统一配色铁律：血氧(spo2)趋势线强制 skyCore 蓝（与血压/心电同源，修掉哈希随机色）
  let tc = trendColorFor(metric.key);
  if (metric.key === 'spo2') tc = mm.colors.skyCore;
  // 今日窗口内的实际最大/最小值，作为迷你趋势图的 Y 向参照（不画整条标尺，避免拥挤）
  const yStats = useMemo(() => {
    const ys = data.map((d) => d.v).filter((v) => Number.isFinite(v));
    if (!ys.length) return null;
    return { max: Math.max(...ys), min: Math.min(...ys) };
  }, [data]);
  // 自适应 Y 量程：以今日真实数据为界上下各留 12% 余量；不足 2 点则回退固定生理量程。
  const yBounds = useMemo(() => {
    const ys = data.map((d) => d.v).filter((v) => Number.isFinite(v));
    if (ys.length < 2) return null;
    const rawMin = Math.min(...ys);
    const rawMax = Math.max(...ys);
    if (rawMin === rawMax) return null;
    const pad = (rawMax - rawMin) * 0.12;
    return { lo: rawMin - pad, hi: rawMax + pad };
  }, [data]);
  // ★ 2026-10-10（用户）：今日窗口统一「0:00 → 现在」（原来固定 0:00→24:00，
  // 每张卡的线画多长取决于「最后一条样本在几点」→ 横轴看着不统一）。
  const axis = todayWindow();
  const { lineD, areaD, last, hasData } = useMemo(() => {
    const yLo = yBounds?.lo ?? metric.yMin;
    const yHi = yBounds?.hi ?? metric.yMax;
    return buildDayPath(data, w, h, axis.start, axis.end, yLo, yHi);
  }, [data, w, h, yBounds, metric.yMin, metric.yMax, axis.start, axis.end]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // ★ 2026-11-05（用户：「心率反馈要 15 分钟」）：staleTag 原来只在 render 时算一次，
  //   页面不重渲染时「15 分钟前」会一直冻结不动。这里每 30 秒自重绘副标题。
  const [, tickClock] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tickClock((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

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
  const statusTag = sourceLabel ? '日值' : live ? '实时' : syncing ? '同步中' : '待接入';

  // compact: Insight 2列小卡片，有图/无图由 showTrend 决定
  if (compact) {
    // v16：数据卡一律白底——pastel 家族只用于卡内 26px 图标方块（soft 底 + deep 图标）
    const fam = pastelFamilyFor(metric.key);
    // 统一：血氧(spo2)图标方强制 sky 蓝家族，与血压/心电同源
    const icBg = metric.key === 'spo2' ? mm.colors.skySoft : fam.chipBg;
    const icFg = metric.key === 'spo2' ? mm.colors.skyDeep : fam.fg;
    const placeholderPath = (() => {
      if (!showTrend || w <= 0) return '';
      const pad = 4;
      const cw = w - pad * 2;
      const ch = h - pad * 2;
      let d = '';
      for (let i = 0; i <= 30; i++) {
        const x = pad + (cw * i) / 30;
        const y = pad + ch * (0.55 + 0.12 * Math.sin((i / 30) * Math.PI * 2.5));
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      }
      return d.trim();
    })();
    return (
      <TouchableOpacity activeOpacity={onPress ? theme.press.opacity : 1} onPress={onPress} disabled={!onPress}>
        <Card style={{ padding: theme.sp(3.5), borderRadius: theme.radius.md }}>
          {/* ★ compact 卡文字层级（对齐 design token）：
              标题 body/medium（原 card 18 过大，窄列易挤压）→ 数值 h2/semibold 拉开主次
              ★ 2026-10-10（用户：「好多名称 title 没展示全，心率变异性、皮肤含水量、交感神经都被截断」）：
              原来「相对时间 + 右箭头」和标题挤在同一行，两者都flexShrink，
              标题先被压到只剩 3 个字（「心率变…」「皮肤含…」「交感神…」）。
              现在**标题独占一行**（右侧只留箭头），相对时间下移到「数值」那一行右端。*/}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(2) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: theme.sp(1) }}>
              {metric.icon && (
                <View style={{
                  width: 26, height: 26, borderRadius: mm.radius.iconSq,
                  backgroundColor: icBg, alignItems: 'center', justifyContent: 'center',
                  marginRight: theme.sp(1),
                }}>
                  <Icon name={metric.icon} size={14} color={icFg} />
                </View>
              )}
              <Text numberOfLines={1} style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: mm.colors.ink, flex: 1 }}>{metric.name}</Text>
            </View>
            <Icon name="chevronRight" size={14} color={mm.colors.inkFaint} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, flexShrink: 1 }}>{value}</Text>
            <Text style={{ fontSize: theme.fontSize.sm, color: mm.colors.inkSoft, marginLeft: theme.sp(1) }}>{metric.unit}</Text>
            <Text numberOfLines={1} style={{ fontSize: theme.fontSize.micro, color: mm.colors.inkFaint, marginLeft: 'auto', paddingLeft: theme.sp(1) }}>{sourceLabel ?? staleTag(measureTime)}</Text>
          </View>
          {showTrend && (
          <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={h}>
                {hasData ? (
                  <>
                    <Defs>
                      <LinearGradient id={`${gid}_grad`} x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0%" stopColor={tc} stopOpacity={0.32} />
                        <Stop offset="100%" stopColor={tc} stopOpacity={0.02} />
                      </LinearGradient>
                      <LinearGradient id={`${gid}_line`} x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0%" stopColor={tc} />
                        <Stop offset="100%" stopColor={tc} stopOpacity={0.72} />
                      </LinearGradient>
                    </Defs>
                    <Path d={areaD} fill={`url(#${gid}_grad)`} />
                    <Path d={lineD} fill="none" stroke={`url(#${gid}_line)`} strokeWidth={chart.lw.series} strokeLinecap="round" />
                  </>
                ) : (
                  <Path d={placeholderPath} fill="none" stroke={tc} strokeWidth={chart.lw.series} strokeLinecap="round" opacity={0.3} />
                )}
              </Svg>
            ) : null}
            {/* ★ 2026-10-10（用户）：横轴口径全卡统一 —— 左「0:00」右「现在 HH:mm」，
                所有基础指标卡同一套，不再一个画到中午一个画到整天。 */}
            <View style={styles.axisRow}>
              <Text style={styles.axisText}>{axis.left}</Text>
              <Text style={styles.axisText}>{axis.right}</Text>
            </View>
          </View>
          )}

        </Card>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity activeOpacity={onPress ? theme.press.opacity : 1} onPress={onPress} disabled={!onPress}>
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
            {/* v10：所有按钮统一 lime→粉 渐变（SPEC §1 #12） */}
            <ExpoLinearGradient
              colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.measureGrad}
            >
              <Text style={styles.measureLabel}>{measureLabel}</Text>
            </ExpoLinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* 当前数值 + 单位 + 最近测量时间（右侧，确认数据新鲜度） */}
      <View style={styles.main}>
        <Text style={styles.val}>{value}</Text>
        <Text style={styles.unit}>{metric.unit}</Text>
        <Text style={styles.measuredAt}>{sourceLabel ?? staleTag(measureTime)}</Text>
      </View>

      <Text style={styles.range}>{metric.range}</Text>

      {/* 自动监测开启 + showTrend → 全天时间轴趋势图 */}
      {auto && showTrend ? (
        <View style={styles.chartWrap}>
          <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ position: 'relative' }}>
            {w > 0 ? (
              <Svg width={w} height={h}>
                <Defs>
                  <LinearGradient id={`${gid}_grad`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={tc} stopOpacity={0.32} />
                    <Stop offset="100%" stopColor={tc} stopOpacity={0.02} />
                  </LinearGradient>
                  <LinearGradient id={`${gid}_line`} x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={tc} />
                    <Stop offset="100%" stopColor={tc} stopOpacity={0.72} />
                  </LinearGradient>
                </Defs>
                {/* 与睡眠/激素卡片视觉同源：渐变面积 + 渐变曲线 + 末端白点；无数据则整张图留白 */}
                {hasData && <Path d={areaD} fill={`url(#${gid}_grad)`} />}
                {hasData && <Path d={lineD} fill="none" stroke={`url(#${gid}_line)`} strokeWidth={chart.lw.series} strokeLinecap="round" />}
                {hasData && <Circle cx={last.x} cy={last.y} r={4.5} fill="#FFFFFF" stroke={tc} strokeWidth={chart.dot.stroke} />}
              </Svg>
            ) : null}
            {/* 今日窗口最大 / 最小值（Y 向参照，小字叠加在趋势图左上 / 左下） */}
            {yStats && hasData ? (
              <>
                <Text style={{ position: 'absolute', top: 1, left: 2, fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.8 }}>
                  {fmtMini(yStats.max)}
                </Text>
                <Text style={{ position: 'absolute', bottom: 1, left: 2, fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.8 }}>
                  {fmtMini(yStats.min)}
                </Text>
              </>
            ) : null}
          </View>
          {/* ★ 2026-10-10（用户）：横轴与洞察页紧凑卡同口径 —— 左 0:00 / 右「现在 HH:mm」（原为固定 0/4/8…24时） */}
          <View style={styles.axisLabels}>
            <Text style={styles.axisLabel}>{axis.left}</Text>
            <Text style={styles.axisLabel}>{axis.right}</Text>
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
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  measureWrapBusy: { opacity: 0.5 },
  measureGrad: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(1.5),
  },
  measureLabel: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: mm.colors.btnTextOnGrad,
  },
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
    color: theme.colors.accentText,
    marginBottom: theme.space.sm,
  },
  chartWrap: { marginTop: theme.space.sm, marginBottom: theme.space.sm },
  // ★ 2026-10-10（用户）：横轴统一为「左 0:00 / 右 现在 HH:mm」，紧凑卡与整卡同源
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  axisText: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    opacity: 0.75,
  },
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
