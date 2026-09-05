/**
 * MetricDetailScreen —— 洞察页任意卡片点击进入的「指标历史详情」全屏页
 *
 * 设计约束（与全局 design token 一致）：
 *  - 顶部返回胶囊 + 指标名；大字当前值 + 较首点变化；日/周/月/年切换（复用 RangeSwitch）；
 *  - 真实数据趋势图（面积 + 渐变曲线 + 末端白点，与 BasicMetricCard / DimensionCard 同源）；
 *  - 平均/最高/最低统计；底部解读文案。
 *  - 数据来自 buildHistorySeries（真实戒指数据，缺口断线，不编造）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, Line } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { RingBle, type RingState, type EcgReading } from '../ble/RingBleManager';
import { loadCycleLog } from '../data/cycleLog';
import { buildHistorySeries, type HistoryResult } from '../lib/realSeries';
import { healthStore, type MetricKey as HSMetricKey, type ManualMeasurement } from '../data/healthStore';
import { dateKeyOf } from '../lib/dateUtils';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

interface Params {
  key: string;
  name: string;
  unit: string;
  yMin: number;
  yMax: number;
  dimension?: string;
  color?: string;
}

const W = 680;
const H = 240;
const PAD_L = 14;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 28;
// Y 轴左侧留白（容纳刻度数字，HTML 渲染避免 SVG 横向拉伸变形）
const Y_GUT = 34;

const PHASE_BG: Record<string, string> = {
  period: 'rgba(224,123,107,0.16)',
  follicular: 'rgba(124,106,224,0.10)',
  ovulation: 'rgba(111,207,180,0.20)',
  luteal: 'rgba(157,138,240,0.13)',
  unknown: 'rgba(138,138,168,0.05)',
};

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Y 轴刻度数字：整数不带小数，小数保留 1 位并去尾零。 */
function fmtYAxis(v: number): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 连续时间轴的 X 轴刻度：日视图出时分，周/月视图出月/日；今日末点标「现在」。 */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function timeAxisLabels(range: RangeKey, tMin: number, tMax: number, isToday: boolean): string[] {
  const N = 6;
  const labels: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = tMin + ((tMax - tMin) * i) / N;
    labels.push(range === 'day' ? fmtClock(t) : `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`);
  }
  if (range === 'day' && isToday) labels[labels.length - 1] = '现在';
  return labels;
}

/** ECG 波形路径：原始 ADC/mV 点归一化到 320×120 视窗的折线。 */
function ecgWaveformPath(values: number[]): string {
  if (!values || values.length < 2) return '';
  const W = 320;
  const H = 120;
  const pad = 8;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) max = min + 1;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = pad + (i / (n - 1)) * (W - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function MetricDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = route.params as Params;

  const [ring, setRing] = useState<RingState>(RingBle.getState());
  // 默认打开「日」视图：洞察页卡片今日段已与日视图同源同频，点卡片直接落到对得上的今日趋势。
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [cycleLog, setCycleLog] = useState<ReturnType<typeof loadCycleLog> extends Promise<infer T> ? T : null>(null);
  const [w, setW] = useState(0);
  const isEcg = params.key === 'ecg';
  const [measuring, setMeasuring] = useState(false);
  // 打开「历史日」且当前指标无数据时的自动补拉状态
  const [backfilling, setBackfilling] = useState(false);
  const requestedForRef = useRef<string | null>(null);
  // 锚点是否为「今天」之外：只有历史日才需要（且值得）自动触发 backfill
  const anchorKey = dateKeyOf(anchor.getTime());
  const isHistorical = anchorKey !== dateKeyOf(Date.now());

  // 心电图：仅主动测量。点击按钮触发原生 ECG 测量（约 30 秒），完成后 ring.ecg 更新并自动刷新本页。
  const measureEcg = useCallback(() => {
    if (measuring) return;
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring]);
  // 手动结束 ECG「关闭测试」（对齐 uni-app 文档的「关闭测试」按钮）：提前结束拿结果
  const stopEcg = useCallback(() => {
    RingBle.stopEcg();
    // 原生会回传 Over + 最终模型，ring.ecg 写入后 useEffect 自动结束「测量中」；
    // 这里先乐观清进度，避免按钮文案卡在最后进度。
    setRing((s) => ({ ...s, ecgProgress: null }));
  }, []);
  useEffect(() => {
    // 测量完成（ring.ecg 被写入）即结束「测量中」
    if (measuring && ring.ecg) setMeasuring(false);
  }, [measuring, ring.ecg]);
  useEffect(() => {
    // 安全超时：原生 ECG 为动态流式、需手动点「停止测量」结束（或 150s 兜底自动结束），
    // 故给 160 秒兜底，避免提前把按钮复位成「重新测量」而误以为失败。
    if (!measuring) return;
    const t = setTimeout(() => setMeasuring(false), 160000);
    return () => clearTimeout(t);
  }, [measuring]);

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);
  useEffect(() => {
    void loadCycleLog().then((l) => setCycleLog(l));
  }, []);

  const series: HistoryResult = useMemo(
    () => buildHistorySeries(params.key, range, ring, cycleLog, anchor),
    [params.key, range, ring, cycleLog, anchor]
  );

  const color = params.color || theme.colors.accentSolid;
  // 手动测量类 key — 在底部显示历史测量列表（按时间倒序）
  const MANUAL_KEYS = ['triglyceride', 'hdl', 'ldl', 'cholesterol', 'bloodFat', 'uricAcid', 'bloodSugar', 'glucose', 'bpSys', 'bpDia', 'bodyComposition'];
  const showManualList = MANUAL_KEYS.includes(params.key);
  const manualHsKeyMap: Record<string, HSMetricKey> = {
    triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl',
    cholesterol: 'cholesterol', bloodFat: 'cholesterol',
    uricAcid: 'ua', bloodSugar: 'glucose', glucose: 'glucose',
    bpSys: 'bpSys', bpDia: 'bpDia',
  };
  const manualList: ManualMeasurement[] = showManualList
    ? healthStore.getManualMeasurements(manualHsKeyMap[params.key] ?? params.key as HSMetricKey).slice(0, 30)
    : [];
  const gid = `md_${params.key}`;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = series.points.length;
  const xAt = (i: number) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

  // 自适应 Y 轴量程：以当前视图实际数据为界，上下各留 12% 余量，曲线更饱满、刻度更接近真实值；
  // 单点/空数据时回退到指标的固定显示量程（series.yMin/yMax），避免退化或 NaN。
  const yBounds = useMemo(() => {
    const vals: number[] = [];
    const pts = series.tPoints;
    if (pts && pts.length) {
      for (const p of pts) if (Number.isFinite(p.v)) vals.push(p.v);
    } else {
      for (const v of series.points) if (v != null) vals.push(v);
    }
    if (!vals.length) return { lo: series.yMin, hi: series.yMax };
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    if (rawMin === rawMax) {
      const pad = Math.abs(rawMin) * 0.1 || 1;
      return { lo: rawMin - pad, hi: rawMax + pad };
    }
    const span = rawMax - rawMin;
    const pad = span * 0.12;
    return { lo: rawMin - pad, hi: rawMax + pad };
  }, [series.tPoints, series.points, series.yMin, series.yMax]);
  const yLo = yBounds.lo;
  const yHi = yBounds.hi;
  const yAt = (v: number) => {
    const c = Math.max(yLo, Math.min(yHi, Number.isFinite(v) ? v : yLo));
    return PAD_T + (1 - (c - yLo) / (yHi - yLo || 1)) * plotH;
  };

  // 连续时间轴（真实时间戳）：今日实时点 + 历史回填点都在 tMin..tMax 域内按 t 映射 x
  const isTodayAnchor = anchorKey === dateKeyOf(Date.now());
  const useContinuous = series.continuous && !!series.tPoints && series.tPoints.length > 0;
  const tMin = series.tMin ?? 0;
  const tMax = series.tMax ?? 0;
  const xAtT = (t: number) =>
    PAD_L + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0.5) * plotW;

  // 折线分段（遇 null / 超阈值断线）；同时把所有真实点收集为散点，保证稀疏/单点历史日也能看见。
  const { lineD, areaD, last, dots } = useMemo(() => {
    if (w === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
    const GAP = 36 * 3600 * 1000; // 断裂阈值：相邻点时间差 > 36h 视为缺口断线

    // 连续时间轴：按真实 t 映射 x，今日实时点接在历史回填之后
    if (useContinuous && series.tPoints) {
      const pts = series.tPoints;
      let line = '';
      let area = '';
      let seg: { x: number; y: number }[] = [];
      const allDots: { x: number; y: number }[] = [];
      const flush = () => {
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
        line += d;
        area += `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
        seg = [];
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = xAtT(p.t);
        const y = yAt(p.v);
        allDots.push({ x, y });
        if (i > 0 && p.t - pts[i - 1].t > GAP) flush();
        seg.push({ x, y });
      }
      flush();
      const lastPt = allDots.length ? allDots[allDots.length - 1] : { x: 0, y: 0 };
      return { lineD: line, areaD: area, last: lastPt, dots: allDots };
    }

    // 非连续（年 / 周期）：按索引绘制
    if (n === 0) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
    if (n === 1) {
      const v = series.points[0];
      if (v == null) return { lineD: '', areaD: '', last: { x: 0, y: 0 }, dots: [] };
      const pt = { x: xAt(0), y: yAt(v) };
      return { lineD: '', areaD: '', last: pt, dots: [pt] };
    }
    let line = '';
    let area = '';
    let seg: { x: number; y: number }[] = [];
    const allDots: { x: number; y: number }[] = [];
    const flush = () => {
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
      line += d;
      area += `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
      seg = [];
    };
    for (let i = 0; i < n; i++) {
      const v = series.points[i];
      if (v == null) {
        flush();
        continue;
      }
      const pt = { x: xAt(i), y: yAt(v) };
      allDots.push(pt);
      seg.push(pt);
    }
    flush();
    const lastPt = (() => {
      for (let i = n - 1; i >= 0; i--) if (series.points[i] != null) return { x: xAt(i), y: yAt(series.points[i]!) };
      return { x: 0, y: 0 };
    })();
    return { lineD: line, areaD: area, last: lastPt, dots: allDots };
  }, [w, useContinuous, series, plotW, plotH, yBounds]);

  // 首点（用于变化率）：连续序列取 tPoints 首点
  const firstReal = (() => {
    if (useContinuous && series.tPoints && series.tPoints.length) return series.tPoints[0].v;
    for (const v of series.points) if (v != null) return v;
    return null;
  })();
  const deltaPct =
    firstReal != null && series.latest != null && firstReal !== 0
      ? Math.round(((series.latest - firstReal) / Math.abs(firstReal)) * 100)
      : 0;
  const hasData = series.latest != null || series.avg != null;
  // 顶部聚合值：日视图显示当日最新读数；周/月/年显示区间平均（按需求：周月=周月均值，年=年均）
  const heroVal = range === 'day' ? series.latest : series.avg;

  // 打开「历史日」且当前指标无数据时，自动触发一次 backfill（需戒指已连接），
  // 让历史趋势图无需手动连戒指即可补拉。同一日期只触发一次，避免重复请求刷屏。
  useEffect(() => {
    if (isEcg || !isHistorical || hasData) return;
    if (ring.status !== 'connected') return;
    if (requestedForRef.current === anchorKey) return;
    requestedForRef.current = anchorKey;
    setBackfilling(true);
    RingBle.syncBackfill();
    // 兜底复位：原生 onBackfillComplete 会强制落盘，但这里给 15s 超时防止「正在补拉」一直挂着
    const t = setTimeout(() => setBackfilling(false), 15000);
    return () => clearTimeout(t);
  }, [isEcg, isHistorical, hasData, ring.status, anchorKey]);

  // X 轴标签：连续时间轴按时间域出刻度（日=时分，周/月=月/日，今日末点标"现在"）
  const axisLabels = useMemo(() => {
    if (useContinuous && tMin && tMax && tMax > tMin) {
      return timeAxisLabels(range, tMin, tMax, isTodayAnchor);
    }
    if (series.axisOverride && series.axisOverride.length > 1) {
      const arr = series.axisOverride;
      const pick = 7;
      const idxs = Array.from({ length: pick }, (_, i) => Math.floor((i * (arr.length - 1)) / (pick - 1)));
      const labels = idxs.map((i) => arr[i]);
      if (labels[labels.length - 1] !== arr[arr.length - 1]) labels.push(arr[arr.length - 1]);
      return labels;
    }
    return RANGE_DEF[range].axis;
  }, [useContinuous, tMin, tMax, range, isTodayAnchor, series.axisOverride]);

  return (
    <ScreenContainer>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{params.name}</Text>
            {params.dimension ? <Text style={styles.sub}>{params.unit}</Text> : null}
          </View>
          {!isEcg && hasData ? (
            <View style={styles.liveTag}>
              <Text style={styles.liveText}>真实数据</Text>
            </View>
          ) : null}
        </View>

        {/* 当前值（连续型指标） */}
        {!isEcg && (
          <View style={styles.hero}>
            <Text style={styles.heroVal}>{fmtVal(heroVal)}</Text>
            {series.unit ? <Text style={styles.heroUnit}>{series.unit}</Text> : null}
            {range !== 'day' && hasData ? <Text style={styles.heroTag}>区间平均</Text> : null}
            {range === 'day' && hasData && deltaPct !== 0 && series.kind !== 'cycle' && (
              <Text style={[styles.delta, deltaPct > 0 ? styles.up : styles.down]}>
                {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较区间首点
              </Text>
            )}
          </View>
        )}

        {/* 日 / 周 / 月 / 年 切换 */}
        {!isEcg && <RangeSwitch value={range} onChange={setRange} />}

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        {!isEcg && <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />}

        {!isEcg && (
        <View style={styles.chartCard}>
          {/* 图表主体：左侧 Y 轴刻度列 + 右侧曲线（X 轴标签在下方，左移 Y_GUT 对齐） */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {/* Y 轴刻度：HTML 文字避免 SVG 横向拉伸变形；位置与参考线一一对应 */}
            <View style={{ width: Y_GUT, height: H, position: 'relative' }}>
                {hasData &&
                [0, 1, 2, 3, 4].map((k) => {
                  const gv = yLo + (yHi - yLo) * (1 - k / 4);
                  return (
                    <Text
                      key={`y-${k}`}
                      style={{
                        position: 'absolute',
                        top: Math.max(0, yAt(gv) - 7),
                        right: 3,
                        fontSize: theme.fontSize.micro,
                        color: theme.colors.textSub,
                        textAlign: 'right',
                      }}
                    >
                      {fmtYAxis(gv)}
                      {k === 0 && series.unit ? ` ${series.unit}` : ''}
                    </Text>
                  );
                })}
            </View>
            <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`${gid}_grad`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <Stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </LinearGradient>
                  <LinearGradient id={`${gid}_line`} x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor={theme.colors.accent1} />
                    <Stop offset="100%" stopColor={color} />
                  </LinearGradient>
                </Defs>

                {/* 周期相位背景带 */}
                {series.phaseAt
                  ? series.phaseAt.map((ph, i) => (
                      <Rect
                        key={`bg-${i}`}
                        x={xAt(i) - plotW / (n || 1) / 2}
                        y={PAD_T}
                        width={plotW / (n || 1)}
                        height={plotH}
                        fill={PHASE_BG[ph ?? 'unknown'] ?? PHASE_BG.unknown}
                      />
                    ))
                  : null}

                {/* 自适应量程参考线（yLo / 中 / yHi） */}
                {[yLo, (yLo + yHi) / 2, yHi].map((gv, i) => (
                  <Line
                    key={`g-${i}`}
                    x1={PAD_L}
                    y1={yAt(gv)}
                    x2={W - PAD_R}
                    y2={yAt(gv)}
                    stroke={theme.colors.ui.borderSoft}
                    strokeWidth={1}
                  />
                ))}

                {areaD ? <Path d={areaD} fill={`url(#${gid}_grad)`} /> : null}
                {lineD ? (
                  <Path d={lineD} fill="none" stroke={`url(#${gid}_line)`} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
                {/* 所有真实数据点（小圆点），稀疏/单点历史日也能看见；连续密集时只画线避免噪点 */}
                {dots.length <= 120
                  ? dots.map((d, i) => (
                      <Circle key={`dot-${i}`} cx={d.x} cy={d.y} r={3.5} fill="#FFFFFF" stroke={color} strokeWidth={2} />
                    ))
                  : null}
              </Svg>
            ) : null}
          </View>
          </View>

          {/* 无数据占位（诚实 + 引导） */}
          {!hasData ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {ring.status !== 'connected'
                  ? '连接戒指以加载历史数据'
                  : backfilling
                  ? '正在补拉历史数据…'
                  : '当前范围内暂无真实测量数据'}
              </Text>
            </View>
          ) : null}

          {/* X 轴标签 */}
          <View style={styles.axis}>
            {axisLabels.map((t, i) => (
              <Text key={i} style={styles.axisText}>
                {t}
              </Text>
            ))}
          </View>
        </View>
        )}

        {/* 统计：平均 / 最高 / 最低 */}
        {!isEcg && (
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均</Text>
              <Text style={styles.statValue}>{fmtVal(series.avg)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最高</Text>
              <Text style={styles.statValue}>{fmtVal(series.hi)}</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低</Text>
              <Text style={styles.statValue}>{fmtVal(series.lo)}</Text>
            </View>
          </View>
        )}

        {/* 解读 */}
        {!isEcg && series.note ? <Text style={styles.note}>{series.note}</Text> : null}

        {/* 历史测量列表（手动测量类指标才显示，按时间倒序） */}
        {showManualList && (
          <View style={{ marginTop: theme.space.md }}>
            <Text style={{
              fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold,
              color: theme.colors.textTitle, marginBottom: theme.space.sm,
            }}>历史测量记录</Text>
            {manualList.length === 0 ? (
              <Text style={{
                fontSize: theme.fontSize.sm, color: theme.colors.textSub,
                fontStyle: 'italic',
              }}>
                还没有测量记录。点击下方「一键血液成分测量」获取首次读数。
              </Text>
            ) : (
              manualList.map((m, i) => {
                const d = new Date(m.t);
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
                const valStr = params.key === 'uricAcid' ? m.v.toFixed(1) : m.v.toFixed(2);
                return (
                  <View key={`${m.t}-${i}`} style={{
                    flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: theme.space.sm,
                    paddingHorizontal: theme.space.md,
                    backgroundColor: i === 0 ? theme.colors.accentSoft : 'transparent',
                    borderRadius: theme.radius.sm,
                    marginBottom: theme.sp(1),
                  }}>
                    <Text style={{
                      fontSize: theme.fontSize.sm, color: theme.colors.textSub,
                    }}>{dateLabel}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{
                        fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold,
                        color: theme.colors.textTitle,
                      }}>{valStr}</Text>
                      <Text style={{
                        fontSize: theme.fontSize.micro, color: theme.colors.textSub,
                        marginLeft: theme.sp(1),
                      }}>{params.unit}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* 心电图：仅主动测量 —— 按钮触发，展示波形 + 派生指标，不做连续趋势图 */}
        {isEcg ? (
          <View style={styles.ecgDetail}>
            <Text style={styles.ecgTitle}>
              {ring.ecg ? `心电图波形 · ${new Date(ring.ecg.ts).toLocaleString()}` : '心电图 · 主动测量'}
            </Text>
            {ring.ecg ? (
              <View style={styles.ecgChart}>
                <Svg width="100%" height={120} viewBox="0 0 320 120" preserveAspectRatio="none">
                  <Path d={ecgWaveformPath(ring.ecg.waveform)} fill="none" stroke={theme.colors.accent1} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
                </Svg>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>尚未测量。点击下方按钮开始约 30 秒心电图测量（需手指接触电极）。</Text>
              </View>
            )}
            <View style={styles.ecgGrid}>
              {(
                [
                  ['平均心率', ring.ecg ? `${Math.round(ring.ecg.aveHeart)} bpm` : '—'],
                  ['HRV', ring.ecg ? `${Math.round(ring.ecg.aveHrv)} ms` : '—'],
                  ['呼吸率', ring.ecg ? `${Math.round(ring.ecg.aveResRate)} 次/分` : '—'],
                  ['QT', ring.ecg ? `${Math.round(ring.ecg.aveQT)} ms` : '—'],
                  ['PWV', ring.ecg ? `${Math.round(ring.ecg.avePWV)} cm/s` : '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <View style={styles.ecgCell} key={k}>
                  <Text style={styles.ecgLabel}>{k}</Text>
                  <Text style={styles.ecgValue}>{v}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={measureEcg} disabled={measuring} style={[styles.ecgBtn, measuring && styles.ecgBtnBusy]}>
              <Text style={[styles.ecgBtnLabel, measuring && styles.ecgBtnLabelBusy]}>
                {measuring
                  ? ring.ecgProgress?.progress
                    ? `测量中 ${ring.ecgProgress.progress}%${ring.ecgProgress.hr ? ` · ${Math.round(ring.ecgProgress.hr)} bpm` : ''}`
                    : '测量中…（约 30 秒）'
                  : ring.ecg
                    ? '重新测量'
                    : '开始心电图测量'}
              </Text>
            </TouchableOpacity>
            {measuring ? (
              <TouchableOpacity activeOpacity={0.7} onPress={stopEcg} style={styles.ecgStopBtn}>
                <Text style={styles.ecgStopLabel}>停止测量</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: theme.space.sm,
  },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) },
  liveTag: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.successSoft,
  },
  liveText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.success },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.sp(1) },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  heroTag: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: theme.space.md, alignSelf: 'center' },
  delta: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, marginLeft: theme.space.md },
  up: { color: theme.colors.success },
  down: { color: theme.colors.stateTense },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
  },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2), paddingLeft: Y_GUT },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statGrid: { flexDirection: 'row' },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: 'rgba(255,255,255,0.6)',
    marginHorizontal: theme.sp(1),
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  statValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
  ecgDetail: { gap: theme.space.sm, marginTop: theme.space.sm },
  ecgTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  ecgChart: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    padding: theme.space.sm,
  },
  ecgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  ecgCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  ecgLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  ecgValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  ecgBtn: {
    marginTop: theme.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentSolid,
  },
  ecgBtnBusy: { backgroundColor: theme.colors.ui.offTrack },
  ecgBtnLabel: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
  ecgBtnLabelBusy: { color: theme.colors.textSub },
  ecgStopBtn: {
    marginTop: theme.sp(8),
    paddingVertical: theme.sp(10),
    paddingHorizontal: theme.sp(20),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.ui.offTrack,
    borderWidth: 1,
    borderColor: theme.colors.ui.borderSoft,
  },
  ecgStopLabel: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.danger ?? theme.colors.textSub },
});
