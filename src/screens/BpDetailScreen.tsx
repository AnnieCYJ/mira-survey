import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, Rect } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { theme } from '../theme/theme';
import { healthStore } from '../data/healthStore';
import type { RangeKey } from '../data/metrics';
import { dayStartMs } from '../data/healthStore';
import { dateKeyOf, startOfWeek, addDays } from '../lib/dateUtils';


const H = 180;          // 图表高
const Y_GUT = 44;       // Y 轴宽度
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 22;

// 颜色（对应截图：收缩压橙、舒张压蓝）
const COL_SYS = '#E8A87C';   // 橙
const COL_DIA = '#7EA6F8';   // 蓝

type Pt = { t: number; v: number };

function avgOrNull(arr: Pt[] | null | undefined): number | null {
  if (!arr || arr.length === 0) return null;
  let s = 0;
  for (const p of arr) if (Number.isFinite(p.v)) s += p.v;
  return arr.length > 0 ? s / arr.length : null;
}

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toString();
}

/** 构造双系列数据（复用 buildHistorySeries 的取数逻辑，两套 key 并行） */
function buildDual(
  range: RangeKey,
  anchor: Date
): {
  sys: { points: (number | null)[]; tPoints: Pt[]; axis: string[]; continuous: boolean };
  dia: { points: (number | null)[]; tPoints: Pt[]; axis: string[]; continuous: boolean };
  yMin: number;
  yMax: number;
  avgSys: number | null;
  avgDia: number | null;
} {
  const DAY = 86400000;
  const anchorKey = dateKeyOf(anchor.getTime());
  const isToday = anchorKey === dateKeyOf(Date.now());

  if (range === 'day') {
    const start = dayStartMs(anchor.getTime());
    const end = isToday ? Date.now() : start + DAY;
    const sysTPs = healthStore.getTimeRange('bpSys', start, end, { fillDailyMean: true, maxPoints: 480 });
    const diaTPs = healthStore.getTimeRange('bpDia', start, end, { fillDailyMean: true, maxPoints: 480 });
    return {
      sys: { points: sysTPs.map((p) => p.v), tPoints: sysTPs, axis: [], continuous: true },
      dia: { points: diaTPs.map((p) => p.v), tPoints: diaTPs, axis: [], continuous: true },
      yMin: 40, yMax: 200,
      avgSys: avgOrNull(sysTPs),
      avgDia: avgOrNull(diaTPs),
    };
  }

  // 周 / 月 / 年：按自然单位取每日均值
  const axis: string[] = [];
  const sysPts: (number | null)[] = [];
  const diaPts: (number | null)[] = [];

  if (range === 'week') {
    const mon = startOfWeek(anchor);
    for (let i = 0; i < 7; i++) {
      const dk = dateKeyOf(addDays(mon, i).getTime());
      const s = healthStore.getDay('bpSys', dk)?.mean ?? null;
      const d = healthStore.getDay('bpDia', dk)?.mean ?? null;
      sysPts.push(s);
      diaPts.push(d);
      axis.push(`${addDays(mon, i).getMonth() + 1}/${addDays(mon, i).getDate()}`);
    }
  } else if (range === 'month') {
    const y = anchor.getFullYear();
    const m0 = anchor.getMonth();
    const dim = new Date(y, m0 + 1, 0).getDate();
    for (let day = 1; day <= dim; day++) {
      const dk = dateKeyOf(new Date(y, m0, day).getTime());
      sysPts.push(healthStore.getDay('bpSys', dk)?.mean ?? null);
      diaPts.push(healthStore.getDay('bpDia', dk)?.mean ?? null);
      axis.push(`${day}`);
    }
  } else {
    const y = anchor.getFullYear();
    for (let mo = 0; mo < 12; mo++) {
      let sS = 0, sC = 0, dS = 0, dC = 0;
      const dim = new Date(y, mo + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const dk = dateKeyOf(new Date(y, mo, day).getTime());
        const sv = healthStore.getDay('bpSys', dk)?.mean;
        const dv = healthStore.getDay('bpDia', dk)?.mean;
        if (sv != null) { sS += sv; sC++; }
        if (dv != null) { dS += dv; dC++; }
      }
      sysPts.push(sC > 0 ? sS / sC : null);
      diaPts.push(dC > 0 ? dS / dC : null);
      axis.push(`${mo + 1}月`);
    }
  }

  // 找总量程
  const allVals = [...sysPts, ...diaPts].filter((v) => v != null) as number[];
  let yMin = 40, yMax = 200;
  if (allVals.length > 0) {
    const mn = Math.min(...allVals);
    const mx = Math.max(...allVals);
    const span = mx - mn || 1;
    yMin = Math.max(30, Math.floor(mn - span * 0.15));
    yMax = Math.min(220, Math.ceil(mx + span * 0.15));
  }

  const sysNonNull = sysPts.filter((v): v is number => v != null);
  const diaNonNull = diaPts.filter((v): v is number => v != null);
  const avgSys = sysNonNull.length > 0 ? sysNonNull.reduce((a, b) => a + b, 0) / sysNonNull.length : null;
  const avgDia = diaNonNull.length > 0 ? diaNonNull.reduce((a, b) => a + b, 0) / diaNonNull.length : null;

  return {
    sys: { points: sysPts, tPoints: [], axis, continuous: false },
    dia: { points: diaPts, tPoints: [], axis, continuous: false },
    yMin, yMax, avgSys, avgDia,
  };
}

/** 把一个序列（可能含 null）转成 SVG path，遇 null 断线 */
function linePath(
  points: (number | null)[],
  xOf: (i: number) => number,
  yAt: (v: number) => number
): { lineD: string; areaD: string } {
  let line = '';
  let area = '';
  let seg: { x: number; y: number }[] = [];
  const flush = () => {
    if (seg.length < 2) { seg = []; return; }
    line += (line ? ' ' : '') + `M ${seg[0].x} ${seg[0].y} `;
    for (let i = 1; i < seg.length; i++) line += `L ${seg[i].x} ${seg[i].y} `;
    area += (area ? ' ' : '') + `M ${seg[0].x} ${yAt(0)} `;
    for (let i = 0; i < seg.length; i++) area += `L ${seg[i].x} ${seg[i].y} `;
    area += `L ${seg[seg.length - 1].x} ${yAt(0)} Z `;
    seg = [];
  };
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (v == null || !Number.isFinite(v)) { flush(); continue; }
    seg.push({ x: xOf(i), y: yAt(v) });
  }
  flush();
  return { lineD: line, areaD: area };
}

/** 连续时间轴：按真实 timestamp 映射 x */
function continuousPath(
  tPoints: Pt[],
  tMin: number, tMax: number,
  plotW: number,
  yAt: (v: number) => number
): { lineD: string; dots: { x: number; y: number }[] } {
  if (!tPoints.length) return { lineD: '', dots: [] };
  // ★ 断线阈值：30min（同 MetricDetailScreen）
const GAP = 30 * 60 * 1000;
  let line = '';
  const dots: { x: number; y: number }[] = [];
  let seg: { x: number; y: number }[] = [];
  const flush = () => {
    if (seg.length < 2) { seg = []; return; }
    line += (line ? ' ' : '') + `M ${seg[0].x} ${seg[0].y} `;
    for (let i = 1; i < seg.length; i++) line += `L ${seg[i].x} ${seg[i].y} `;
    seg = [];
  };
  for (let i = 0; i < tPoints.length; i++) {
    const p = tPoints[i];
    const x = PAD_L + (tMax > tMin ? (p.t - tMin) / (tMax - tMin) : 0.5) * plotW;
    const y = yAt(p.v);
    dots.push({ x, y });
    if (seg.length > 0 && p.t - tPoints[i - 1].t > GAP) flush();
    seg.push({ x, y });
  }
  flush();
  return { lineD: line, dots };
}

/** 日视图固定 0~24 小时刻度；今日末位显示「现在」，避免正午看到右侧标「24」造成错位 */
function dayXAxis(isToday: boolean): string[] {
  return ['0', '4', '8', '12', '16', '20', isToday ? '现在' : '24'];
}

export default function BpDetailScreen() {
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);

  const data = useMemo(() => buildDual(range, anchor), [range, anchor]);

  const plotW = w - PAD_L - PAD_R;
  const yLo = data.yMin;
  const yHi = data.yMax;
  const yAt = (v: number) => PAD_T + (1 - (Math.max(yLo, Math.min(yHi, v)) - yLo) / (yHi - yLo || 1)) * (H - PAD_T - PAD_B);

  const sysHasData = (data.sys.points.some((v) => v != null) || data.sys.tPoints.length > 0);
  const diaHasData = (data.dia.points.some((v) => v != null) || data.dia.tPoints.length > 0);
  const hasData = sysHasData || diaHasData;

  // 日视图固定以全天 0~24h 为时间轴，测量点按真实时间落位，避免单点被缩到最右侧
  const isTodayAnchor = dateKeyOf(anchor.getTime()) === dateKeyOf(Date.now());
  const dayStart = dayStartMs(anchor.getTime());
  const tMin = dayStart;
  const tMax = isTodayAnchor ? Math.max(Date.now(), dayStart + 3600000) : dayStart + 86400000;

  let sysLine = '', sysDots: { x: number; y: number }[] = [],
      diaLine = '', diaDots: { x: number; y: number }[] = [];
  const gid = 'bp_detail';

  if (w > 0 && hasData) {
    if (data.sys.continuous && data.sys.tPoints.length > 0) {
      const allT = [...data.sys.tPoints, ...data.dia.tPoints];
      ({ lineD: sysLine, dots: sysDots } = continuousPath(data.sys.tPoints, tMin, tMax, plotW, yAt));
      ({ lineD: diaLine, dots: diaDots } = continuousPath(data.dia.tPoints, tMin, tMax, plotW, yAt));
    } else {
      const n = data.sys.points.length || data.dia.points.length || 1;
      const xAt = (i: number) => PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
      ({ lineD: sysLine } = linePath(data.sys.points, xAt, yAt));
      ({ lineD: diaLine } = linePath(data.dia.points, xAt, yAt));
    }
  }

  return (
    <ScreenContainer compactTop>
      <View style={styles.head}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 20 }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>血压</Text>
          <Text style={styles.sub}>收缩压 / 舒张压 · {anchor.toLocaleDateString('zh-CN')}</Text>
        </View>
      </View>

      {/* Hero：平均值 sys/dia */}
      <View style={styles.heroRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroAvgLabel}>平均值</Text>
          <View style={styles.heroVals}>
            <Text style={[styles.heroSys, { color: COL_SYS }]}>{fmt(data.avgSys)}</Text>
            <Text style={styles.heroSep}>/</Text>
            <Text style={[styles.heroDia, { color: COL_DIA }]}>{fmt(data.avgDia)}</Text>
            <Text style={styles.heroUnit}> mmHg</Text>
          </View>
        </View>
        {/* 图例 */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COL_SYS }} />
            <Text style={styles.legendText}>收缩压</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COL_DIA }} />
            <Text style={styles.legendText}>舒张压</Text>
          </View>
        </View>
      </View>

      <RangeSwitch value={range} onChange={setRange} />
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

      {/* 图表 */}
      <View style={styles.chartCard}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {/* Y 轴刻度 */}
          <View style={{ width: Y_GUT, height: H, position: 'relative' }}>
            {[0, 1, 2, 3, 4].map((k) => {
              const gv = yLo + (yHi - yLo) * (1 - k / 4);
              return (
                <Text
                  key={`y-${k}`}
                  style={{
                    position: 'absolute',
                    top: Math.max(0, yAt(gv) - 7),
                    right: 3,
                    fontSize: 11,
                    color: theme.colors.textSub,
                    textAlign: 'right',
                  }}
                >
                  {Math.round(gv)}{k === 0 ? ' mmHg' : ''}
                </Text>
              );
            })}
          </View>
          <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
            {w > 0 ? (
              <Svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`${gid}_sys`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={COL_SYS} stopOpacity={0.25} />
                    <Stop offset="100%" stopColor={COL_SYS} stopOpacity={0.02} />
                  </LinearGradient>
                </Defs>

                {/* 参考线 */}
                {[yLo, (yLo + yHi) / 2, yHi].map((gv, i) => (
                  <Line key={`g-${i}`} x1={PAD_L} y1={yAt(gv)} x2={w - PAD_R} y2={yAt(gv)}
                    stroke={theme.colors.ui?.borderSoft ?? 'rgba(0,0,0,0.08)'} strokeWidth={1} />
                ))}

                {/* 每个测量时刻：一根竖线 从 舒张压（蓝，下） 到 收缩压（橙，上） */}
                {(() => {
                  // 合并 sys + dia 到同一时间轴，配对渲染竖线
                  type Pair = { t: number; sys?: number; dia?: number; x: number };
                  const pairs: Pair[] = [];
                  const tAll = new Set<number>();
                  if (data.sys.continuous) {
                    data.sys.tPoints.forEach((p) => tAll.add(p.t));
                    data.dia.tPoints.forEach((p) => tAll.add(p.t));
                    const sysMap = new Map(data.sys.tPoints.map((p) => [p.t, p.v]));
                    const diaMap = new Map(data.dia.tPoints.map((p) => [p.t, p.v]));
                    for (const t of Array.from(tAll).sort((a, b) => a - b)) {
                      const x = PAD_L + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0.5) * plotW;
                      pairs.push({ t, sys: sysMap.get(t), dia: diaMap.get(t), x });
                    }
                  } else {
                    // 离散（周/月/年）：按索引配对
                    const n = Math.max(data.sys.points.length, data.dia.points.length);
                    for (let i = 0; i < n; i++) {
                      const x = PAD_L + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
                      const sv = data.sys.points[i];
                      const dv = data.dia.points[i];
                      if (sv != null || dv != null) pairs.push({ t: i, sys: sv ?? undefined, dia: dv ?? undefined, x });
                    }
                  }
                  return pairs.map((p, i) => {
                    const children: React.ReactElement[] = [];
                    const hasSys = p.sys != null && Number.isFinite(p.sys);
                    const hasDia = p.dia != null && Number.isFinite(p.dia);
                    if (hasSys && hasDia) {
                      const ySys = yAt(p.sys!);
                      const yDia = yAt(p.dia!);
                      const yTop = Math.min(ySys, yDia);
                      const yBot = Math.max(ySys, yDia);
                      children.push(
                        <Line key={`v-${i}`} x1={p.x} y1={yTop} x2={p.x} y2={yBot}
                          stroke={theme.colors.textSub} strokeWidth={1.5} opacity={0.7} />
                      );
                    }
                    if (hasDia) {
                      children.push(
                        <Circle key={`d-${i}`} cx={p.x} cy={yAt(p.dia!)} r={4} fill={COL_DIA} />
                      );
                    }
                    if (hasSys) {
                      children.push(
                        <Circle key={`s-${i}`} cx={p.x} cy={yAt(p.sys!)} r={4} fill={COL_SYS} />
                      );
                    }
                    return children;
                  });
                })()}
              </Svg>
            ) : null}
          </View>
        </View>

        {/* X 轴标签：日视图固定 0/4/8/12/16/20/24（今日末位显示「现在」），与曲线真实时间轴对齐 */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: Y_GUT, marginTop: 6 }}>
          {(range === 'day' ? dayXAxis(isTodayAnchor) : data.sys.axis.filter((_, i) => i % Math.max(1, Math.ceil(data.sys.axis.length / 6)) === 0)).map((a, i) => (
            <Text key={i} style={{ fontSize: 11, color: theme.colors.textSub }}>{a}</Text>
          ))}
        </View>

        {!hasData ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>当前范围内暂无血压数据。连接戒指后点击下方「快速测量」获取读数。</Text>
          </View>
        ) : null}
      </View>

      {/* 统计：全天平均 / 最小值 / 最大值 */}
      {hasData ? (
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.statLabel}>全天平均</Text>
              <Text style={styles.statVal}>
                <Text style={{ color: COL_SYS }}>{fmt(data.avgSys)}</Text>
                <Text style={{ color: theme.colors.textSub }}>/</Text>
                <Text style={{ color: COL_DIA }}>{fmt(data.avgDia)}</Text>
              </Text>
            </View>
            <View style={{ width: 1, height: 40, backgroundColor: theme.colors.cardBorder }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.statLabel}>当前范围</Text>
              <Text style={styles.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{range === 'day' ? '日' : range === 'week' ? '周' : range === 'month' ? '月' : '年'}</Text>
            </View>
          </View>
        </Card>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', marginRight: 8 },
  title: { fontSize: 20, fontWeight: '600', color: theme.colors.textTitle },
  sub: { fontSize: 12, color: theme.colors.textSub, marginTop: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  heroAvgLabel: { fontSize: 13, color: theme.colors.textSub },
  heroVals: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  heroSys: { fontSize: 40, fontWeight: '700' },
  heroSep: { fontSize: 28, color: theme.colors.textSub, marginHorizontal: 4 },
  heroDia: { fontSize: 40, fontWeight: '700' },
  heroUnit: { fontSize: 14, color: theme.colors.textSub, marginLeft: 4 },
  legendText: { fontSize: 12, color: theme.colors.textSub },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
    marginTop: 12,
  },
  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { fontSize: 13, color: theme.colors.textSub },
  statLabel: { fontSize: 12, color: theme.colors.textSub, marginBottom: 4 },
  statVal: { fontSize: 20, fontWeight: '700', color: theme.colors.textTitle },
});
