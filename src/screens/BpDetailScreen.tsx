import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, Rect } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import InsightBanner from '../components/InsightBanner';
import ChatSheet from '../components/ChatSheet';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { theme } from '../theme/theme';
import { compareLabel } from '../lib/periodLabels';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import { healthStore } from '../data/healthStore';
import type { RangeKey } from '../data/metrics';
import { dayStartMs } from '../data/healthStore';
import { dateKeyOf, startOfWeek, addDays } from '../lib/dateUtils';
import { timeTickLabel } from '../lib/chartAxis';


const H = 180;          // 图表高
const Y_GUT = 44;       // Y 轴宽度
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 22;

// v16：血压=蓝图（收缩=蓝 core / 舒张=蓝 mid），统一走 Design Token
// ★ 2026-11-03（用户「蓝色太不明显」）：舒张压 skyMid(#B9CCF9) 淡得几乎隐形 → skyDeep(#4C74C9)；
//   收缩压保持 skyCore(#7EA6F8)——一亮一深同为 mm token，曲线/大数字/图例区分度都拉起来
const COL_SYS = mm.colors.skyCore;
const COL_DIA = mm.colors.skyDeep;

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

/** 提取一个系列的全部数值（兼容日视图 tPoints 与周/月/年 points 两种结构） */
function seriesVals(s: { points: (number | null)[]; tPoints: Pt[] }): number[] {
  const fromPoints = s.points.filter((v): v is number => v != null && Number.isFinite(v));
  const fromTP = s.tPoints.map((p) => p.v).filter((v): v is number => Number.isFinite(v));
  return [...fromPoints, ...fromTP];
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
      axis.push(timeTickLabel({ range: 'week', weekday: addDays(mon, i).getDay() }));
    }
  } else if (range === 'month') {
    const y = anchor.getFullYear();
    const m0 = anchor.getMonth();
    const dim = new Date(y, m0 + 1, 0).getDate();
    for (let day = 1; day <= dim; day++) {
      const dk = dateKeyOf(new Date(y, m0, day).getTime());
      sysPts.push(healthStore.getDay('bpSys', dk)?.mean ?? null);
      diaPts.push(healthStore.getDay('bpDia', dk)?.mean ?? null);
      axis.push(timeTickLabel({ range: 'month', dayOfMonth: day }));
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
      axis.push(timeTickLabel({ range: 'year', monthIndex: mo }));
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

/** 晨晚窗口（本地小时，含起点不含终点） */
const AM_RANGE: [number, number] = [6, 12];   // 06:00–11:59
const PM_RANGE: [number, number] = [18, 22];  // 18:00–21:59

/** 取范围内覆盖的每一天（Date 数组），用于跨天聚合晨晚读数 */
function daysForRange(range: RangeKey, anchor: Date): Date[] {
  if (range === 'day') return [new Date(anchor)];
  if (range === 'week') {
    const mon = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }
  if (range === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: dim }, (_, d) => new Date(y, m, d + 1));
  }
  const y = anchor.getFullYear();
  const out: Date[] = [];
  for (let mo = 0; mo < 12; mo++) {
    const dim = new Date(y, mo + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) out.push(new Date(y, mo, d));
  }
  return out;
}

export type AmpmAvg = { sys: number | null; dia: number | null; n: number };

/** 晨晚血压汇总：按本地小时把同时含收缩/舒张的读数分入晨间/晚间窗口，取均值与次数 */
function ampmSummary(range: RangeKey, anchor: Date): { morning: AmpmAvg; evening: AmpmAvg } {
  let mS = 0, mD = 0, mN = 0, eS = 0, eD = 0, eN = 0;
  for (const day of daysForRange(range, anchor)) {
    const dk = dateKeyOf(day.getTime());
    const s = healthStore.getIntraday('bpSys', dk);
    const d = healthStore.getIntraday('bpDia', dk);
    const sMap = new Map(s.map((p) => [p.t, p.v]));
    const dMap = new Map(d.map((p) => [p.t, p.v]));
    const tsAll = new Set<number>([...s.map((p) => p.t), ...d.map((p) => p.t)]);
    for (const t of tsAll) {
      const sv = sMap.get(t), dv = dMap.get(t);
      if (sv == null || dv == null || !Number.isFinite(sv) || !Number.isFinite(dv)) continue;
      const hr = new Date(t).getHours();
      if (hr >= AM_RANGE[0] && hr < AM_RANGE[1]) { mS += sv; mD += dv; mN++; }
      else if (hr >= PM_RANGE[0] && hr < PM_RANGE[1]) { eS += sv; eD += dv; eN++; }
    }
  }
  const mk = (s: number, d: number, n: number): AmpmAvg =>
    n ? { sys: s / n, dia: d / n, n } : { sys: null, dia: null, n: 0 };
  return { morning: mk(mS, mD, mN), evening: mk(eS, eD, eN) };
}

export default function BpDetailScreen() {
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);

  // ★ 2026-10-16：血压详情页内 AI 问答入口（与精力/情绪详情页同款 ChatSheet）
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = useCallback((q: string) => { setChatQuestion(q); setChatVisible(true); }, []);

  // ★ 2026-10-17：录入（手动添加读数）弹窗状态 + 刷新计数（手动写入后强制重算）
  const [entryVisible, setEntryVisible] = useState(false);
  const [sysIn, setSysIn] = useState('');
  const [diaIn, setDiaIn] = useState('');
  const [timeIn, setTimeIn] = useState('');
  const [entryErr, setEntryErr] = useState('');
  const [nonce, setNonce] = useState(0);

  const data = useMemo(() => buildDual(range, anchor), [range, anchor, nonce]);

  // 上一周期锚点（用于「较上一周期」对比）
  const prevAnchor = useMemo(() => {
    const a = new Date(anchor);
    if (range === 'day') a.setDate(a.getDate() - 1);
    else if (range === 'week') a.setDate(a.getDate() - 7);
    else if (range === 'month') a.setMonth(a.getMonth() - 1);
    else a.setFullYear(a.getFullYear() - 1);
    return a;
  }, [anchor, range]);
  const prev = useMemo(() => buildDual(range, prevAnchor), [range, prevAnchor, nonce]);

  // ★ 2026-10-17：晨晚血压汇总（随数据变化重算）
  const ampm = useMemo(() => ampmSummary(range, anchor), [range, anchor, nonce]);

  const sysVals = seriesVals(data.sys);
  const diaVals = seriesVals(data.dia);
  const minSys = sysVals.length ? Math.min(...sysVals) : null;
  const maxSys = sysVals.length ? Math.max(...sysVals) : null;
  const minDia = diaVals.length ? Math.min(...diaVals) : null;
  const maxDia = diaVals.length ? Math.max(...diaVals) : null;
  const dSys = data.avgSys != null && prev.avgSys != null ? data.avgSys - prev.avgSys : null;
  const dDia = data.avgDia != null && prev.avgDia != null ? data.avgDia - prev.avgDia : null;

  const plotW = w - PAD_L - PAD_R;
  const yLo = data.yMin;
  const yHi = data.yMax;
  const yAt = (v: number) => PAD_T + (1 - (Math.max(yLo, Math.min(yHi, v)) - yLo) / (yHi - yLo || 1)) * (H - PAD_T - PAD_B);

  const sysHasData = (data.sys.points.some((v) => v != null) || data.sys.tPoints.length > 0);
  const diaHasData = (data.dia.points.some((v) => v != null) || data.dia.tPoints.length > 0);
  const hasData = sysHasData || diaHasData;

  // ★ 2026-10-16：取某指标当天最新一次读数（光电/气囊血压细分卡用）
  const latestVal = (k: 'ppgSys' | 'ppgDia' | 'bpSys' | 'bpDia'): number | null => {
    try {
      const pts = healthStore.getIntraday(k, dateKeyOf(Date.now()));
      return pts.length ? pts[pts.length - 1].v : null;
    } catch {
      return null;
    }
  };

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

  // ★ 2026-10-17：保存手动录入的血压读数（写入 intraday，使其出现在趋势图并更新日均）
  const saveEntry = () => {
    const sys = parseInt(sysIn, 10);
    const dia = parseInt(diaIn, 10);
    if (!Number.isFinite(sys) || sys < 50 || sys > 300) { setEntryErr('收缩压请填 50–300 的整数'); return; }
    if (!Number.isFinite(dia) || dia < 30 || dia > 200) { setEntryErr('舒张压请填 30–200 的整数'); return; }
    if (dia >= sys) { setEntryErr('舒张压应小于收缩压'); return; }
    let hh = new Date().getHours(), mm = new Date().getMinutes();
    const tStr = timeIn.trim();
    if (tStr) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(tStr);
      if (!m) { setEntryErr('时间格式应为 HH:mm，如 08:30'); return; }
      hh = Number(m[1]); mm = Number(m[2]);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) { setEntryErr('时间超出范围'); return; }
    }
    const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), hh, mm, 0, 0);
    const ts = base.getTime();
    healthStore.upsertRealtime('bpSys', { t: ts, v: sys }, ts);
    healthStore.upsertRealtime('bpDia', { t: ts, v: dia }, ts);
    setEntryVisible(false); setSysIn(''); setDiaIn(''); setTimeIn(''); setEntryErr('');
    setNonce((n) => n + 1);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer compactTop topFadeColor={theme.colors.bgTop}>
      <View style={styles.head}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: theme.fontSize.lg }}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>血压</Text>
          <Text style={styles.sub}>收缩压 / 舒张压 · {anchor.toLocaleDateString('zh-CN')}</Text>
        </View>
        <TouchableOpacity style={styles.entryBtn} onPress={() => setEntryVisible(true)}>
          <Text style={styles.entryBtnText}>＋ 录入</Text>
        </TouchableOpacity>
      </View>

      <RangeSwitch value={range} onChange={setRange} />
      <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

      {/* ★ 2026-11-03（用户）：血压数据卡移到「日/周/月/年」切换器下方，与其他详情页统一（切换 → 选择器 → 数据卡 → 图表）。此前本页 hero+分析在切换器上方，属孤例。 */}
      <Card>
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

        {/* ★ 2026-11-03（用户·统一 hero 结构）：大数字下方短分析（分级解读在下方 InsightBanner） */}
        <Text style={styles.heroAnalysis}>
          {(() => {
            const sys = data.avgSys, dia = data.avgDia;
            if (sys == null || dia == null) return '今天还没有血压读数，连上气囊血压计或做一次光电血压测量后这里会显示。';
            if (sys >= 140 || dia >= 90) return `平均 ${Math.round(sys)}/${Math.round(dia)} mmHg，属于高血压范围，建议规律监测并咨询医生。`;
            if (sys >= 130 || dia >= 80) return `平均 ${Math.round(sys)}/${Math.round(dia)} mmHg，略偏高，注意减盐、规律有氧。`;
            if (sys >= 90 && dia >= 60) return `平均 ${Math.round(sys)}/${Math.round(dia)} mmHg，在理想范围内，保持就好。`;
            return `平均 ${Math.round(sys)}/${Math.round(dia)} mmHg，偏低，留意是否有头晕乏力。`;
          })()}
        </Text>
      </Card>

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
                    fontSize: theme.fontSize.micro,
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
                    stroke={theme.colors.ui?.borderSoft ?? 'rgba(0,0,0,0.08)'} strokeWidth={chart.lw.grid} />
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
                          stroke={theme.colors.textSub} strokeWidth={chart.lw.ref} opacity={0.7} />
                      );
                    }
                    if (hasDia) {
                      children.push(
                        <Circle key={`d-${i}`} cx={p.x} cy={yAt(p.dia!)} r={chart.dot.radius} fill={COL_DIA} />
                      );
                    }
                    if (hasSys) {
                      children.push(
                        <Circle key={`s-${i}`} cx={p.x} cy={yAt(p.sys!)} r={chart.dot.radius} fill={COL_SYS} />
                      );
                    }
                    return children;
                  });
                })()}
              </Svg>
            ) : null}
          </View>
        </View>

        {/* X 轴标签：日视图走时间轴（space-between）；周/月/年每个柱位一槽、刻度居中，稀疏刻度与柱对齐 */}
        <View style={{ flexDirection: 'row', justifyContent: range === 'day' ? 'space-between' : undefined, paddingLeft: Y_GUT, marginTop: 6 }}>
          {(range === 'day' ? dayXAxis(isTodayAnchor) : data.sys.axis).map((a, i) => (
            <Text key={i} style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, flex: range === 'day' ? undefined : 1, textAlign: range === 'day' ? undefined : 'center' }}>{a}</Text>
          ))}
        </View>

        {!hasData ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>当前范围内暂无血压数据。点击右上角「录入」手动添加读数，或连接戒指后测量获取读数。</Text>
          </View>
        ) : null}
      </View>

      {/* ★ 2026-10-17：晨晚血压汇总（Omron / SmartBP 同款 AM/PM 均值） */}
      {hasData ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.detailTitle}>晨晚血压汇总</Text>
          <View style={styles.detailGrid}>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>晨间 06–12 时</Text>
              <Text style={styles.detailColVal}><Text style={{ color: COL_SYS }}>{fmt(ampm.morning.sys)}</Text><Text style={{ color: theme.colors.textSub }}>/</Text><Text style={{ color: COL_DIA }}>{fmt(ampm.morning.dia)}</Text></Text>
              <Text style={styles.detailColLabel}>{ampm.morning.n ? `${ampm.morning.n} 次` : '暂无读数'}</Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>晚间 18–22 时</Text>
              <Text style={styles.detailColVal}><Text style={{ color: COL_SYS }}>{fmt(ampm.evening.sys)}</Text><Text style={{ color: theme.colors.textSub }}>/</Text><Text style={{ color: COL_DIA }}>{fmt(ampm.evening.dia)}</Text></Text>
              <Text style={styles.detailColLabel}>{ampm.evening.n ? `${ampm.evening.n} 次` : '暂无读数'}</Text>
            </View>
          </View>
          <Text style={[styles.compareLabel, { marginTop: 10 }]}>晨/晚各取该时段收缩压与舒张压均值；仅统计同时含收缩、舒张读数的测量。</Text>
        </Card>
      ) : null}

      {/* ★ 统一「详细分析」块：平均 / 最高 / 最低 + 较上一周期对比 */}
      {hasData ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.detailTitle}>详细分析</Text>
          <View style={styles.detailGrid}>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>平均</Text>
              <Text style={styles.detailColVal}><Text style={{ color: COL_SYS }}>{fmt(data.avgSys)}</Text><Text style={{ color: theme.colors.textSub }}>/</Text><Text style={{ color: COL_DIA }}>{fmt(data.avgDia)}</Text></Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>最高</Text>
              <Text style={styles.detailColVal}><Text style={{ color: COL_SYS }}>{fmt(maxSys)}</Text><Text style={{ color: theme.colors.textSub }}>/</Text><Text style={{ color: COL_DIA }}>{fmt(maxDia)}</Text></Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>最低</Text>
              <Text style={styles.detailColVal}><Text style={{ color: COL_SYS }}>{fmt(minSys)}</Text><Text style={{ color: theme.colors.textSub }}>/</Text><Text style={{ color: COL_DIA }}>{fmt(minDia)}</Text></Text>
            </View>
          </View>
          {dSys != null && (
            <View style={styles.compareRow}>
              {/* ★ 2026-11-03：统一走 lib/periodLabels —— 较昨日/较上周/较上个月/较去年 */}
              <Text style={styles.compareLabel}>{compareLabel(range)}</Text>
              <Text style={styles.compareVal}>
                收缩压 {dSys > 0 ? '↑' : dSys < 0 ? '↓' : '−'} {fmt(Math.abs(dSys))} · 舒张压 {dDia! > 0 ? '↑' : dDia! < 0 ? '↓' : '−'} {fmt(Math.abs(dDia!))} mmHg
              </Text>
            </View>
          )}
        </Card>
      ) : null}

      {/* ★ 2026-10-16：血压细分——光电血压（PPG，无气囊戒指默认）vs 气囊血压（带气囊机型） */}
      {hasData ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.detailTitle}>测量方式细分</Text>
          <View style={styles.detailGrid}>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>光电血压（PPG）</Text>
              <Text style={styles.detailColVal}>
                <Text style={{ color: COL_SYS }}>{fmt(latestVal('ppgSys'))}</Text>
                <Text style={{ color: theme.colors.textSub }}>/</Text>
                <Text style={{ color: COL_DIA }}>{fmt(latestVal('ppgDia'))}</Text>
                <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs }}> mmHg</Text>
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailColLabel}>气囊血压</Text>
              <Text style={styles.detailColVal}>
                <Text style={{ color: COL_SYS }}>{fmt(latestVal('bpSys'))}</Text>
                <Text style={{ color: theme.colors.textSub }}>/</Text>
                <Text style={{ color: COL_DIA }}>{fmt(latestVal('bpDia'))}</Text>
                <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs }}> mmHg</Text>
              </Text>
            </View>
          </View>
          <Text style={[styles.compareLabel, { marginTop: 10 }]}>
            读数优先采用气囊血压；无气囊机型（如本款）以光电血压（PPG）为准，数值含估测成分。
          </Text>
        </Card>
      ) : null}

      {/* ★ 2026-10-16：血压分级（WHO/ISH 六档）+ 规则 AI 解读 */}
      {hasData ? <BpClassificationCard sysAvg={data.avgSys} diaAvg={data.avgDia} openChat={openChat} /> : null}
    </ScreenContainer>

    {/* ★ 2026-11-05（修复：弹窗背景错色 + 无法退出）：
        背景改 App 统一磨砂白卡（cardBg），加 X 关闭按钮，点遮罩也可关闭。 */}
    <Modal visible={entryVisible} transparent animationType="fade" onRequestClose={() => { setEntryVisible(false); setEntryErr(''); }}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => { setEntryVisible(false); setEntryErr(''); }}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => { setEntryVisible(false); setEntryErr(''); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.modalCloseTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>录入血压</Text>
          <Text style={styles.modalHint}>为「{anchor.toLocaleDateString('zh-CN')}」添加一次读数，将显示在趋势图中。</Text>
          <View style={styles.modalInputRow}>
            <View style={styles.modalInputWrap}>
              <Text style={styles.modalInputLabel}>收缩压</Text>
              <TextInput style={styles.modalInput} keyboardType="number-pad" placeholder="120" maxLength={3}
                value={sysIn} onChangeText={setSysIn} />
            </View>
            <Text style={styles.modalSlash}>/</Text>
            <View style={styles.modalInputWrap}>
              <Text style={styles.modalInputLabel}>舒张压</Text>
              <TextInput style={styles.modalInput} keyboardType="number-pad" placeholder="80" maxLength={3}
                value={diaIn} onChangeText={setDiaIn} />
            </View>
          </View>
          <View style={styles.modalInputWrap}>
            <Text style={styles.modalInputLabel}>时间（可选 · HH:mm · 留空=现在）</Text>
            <TextInput style={styles.modalInput} keyboardType="numbers-and-punctuation" placeholder="现在" maxLength={5}
              value={timeIn} onChangeText={setTimeIn} />
          </View>
          {entryErr ? <Text style={styles.modalErr}>{entryErr}</Text> : null}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtn} onPress={() => { setEntryVisible(false); setEntryErr(''); }}>
              <Text style={styles.modalBtnText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={saveEntry}>
              <Text style={[styles.modalBtnText, { color: '#fff' }]}>保存</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
    <ChatSheet visible={chatVisible} onClose={() => setChatVisible(false)} initialQuestion={chatQuestion} />
    </View>
  );
}

/* ★ 2026-10-16：血压分级（WHO/ISH 六档）
 * 按收缩压 / 舒张压中较高的等级定级（取两者中更重的一档）。 */
const BP_TIERS = [
  { stage: 1, name: '理想血压', sLo: 0, sHi: 120, dLo: 0, dHi: 80, color: mm.colors.limeMid, note: '血压理想，继续保持规律作息与运动。' },
  { stage: 2, name: '正常血压', sLo: 120, sHi: 130, dLo: 80, dHi: 85, color: mm.colors.limeCore, note: '血压正常，建议保持当前生活方式。' },
  { stage: 3, name: '正常高值', sLo: 130, sHi: 140, dLo: 85, dHi: 90, color: mm.colors.honeyCore, note: '处于正常高值，注意减盐、规律运动，定期监测。' },
  { stage: 4, name: '高血压 1 级', sLo: 140, sHi: 160, dLo: 90, dHi: 100, color: mm.colors.roseMid, note: '轻度升高，建议改善生活方式并咨询医生。' },
  { stage: 5, name: '高血压 2 级', sLo: 160, sHi: 180, dLo: 100, dHi: 110, color: mm.colors.roseDeep, note: '明显升高，建议尽早就医评估。' },
  { stage: 6, name: '高血压 3 级', sLo: 180, sHi: 999, dLo: 110, dHi: 999, color: mm.colors.roseDeep, note: '显著升高，请及时就医。' },
] as const;

function bpStageOf(s: number, d: number): number {
  const sStage = s >= 180 ? 6 : s >= 160 ? 5 : s >= 140 ? 4 : s >= 130 ? 3 : s >= 120 ? 2 : 1;
  const dStage = d >= 110 ? 6 : d >= 100 ? 5 : d >= 90 ? 4 : d >= 85 ? 3 : d >= 80 ? 2 : 1;
  return Math.max(sStage, dStage);
}

function BpClassificationCard({ sysAvg, diaAvg, openChat }: { sysAvg: number | null; diaAvg: number | null; openChat: (q: string) => void }) {
  const s = sysAvg ?? latestValLocal('bpSys');
  const d = diaAvg ?? latestValLocal('bpDia');
  const has = s != null && d != null;
  const stage = has ? bpStageOf(s, d) : 0;
  const tier = has ? BP_TIERS[stage - 1] : null;

  const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [
    {
      tone: 'neutral',
      title: '',
      body:
        has
          ? `当前血压约 ${Math.round(s!)}/${Math.round(d!)} mmHg，评级为「${tier?.name}」。`
          : '今日暂无足够血压数据，连接戒指完成一次测量后查看分级。',
    },
  ];
  if (has && tier) {
    if (stage >= 4) rows.push({ tone: 'warn', title: '关注', body: tier.note });
    else if (stage === 3) rows.push({ tone: 'neutral', title: '提示', body: tier.note });
    else rows.push({ tone: 'good', title: '良好', body: tier.note });
  }
  rows.push({ tone: 'neutral', title: '建议', body: '定期监测、减盐限酒、规律有氧；分级仅作参考，诊断请遵医嘱。' });

  return (
    <>
      <Card style={{ marginTop: 12 }}>
        <Text style={styles.detailTitle}>血压分级（WHO/ISH）</Text>
        {has ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 }}>
              <Text style={{ fontSize: theme.fontSize.stat, fontWeight: '700', color: tier?.color }}>
                {Math.round(s!)}/{Math.round(d!)}
              </Text>
              <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: 6 }}>mmHg</Text>
              <View style={{ flex: 1 }} />
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.md, backgroundColor: tier?.color, opacity: 0.18 }}>
                <Text style={{ fontSize: theme.fontSize.xs, fontWeight: '600', color: tier?.color }}>{tier?.name}</Text>
              </View>
            </View>
            {/* 六档水平条：当前档高亮 */}
            <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' }}>
              {BP_TIERS.map((t) => (
                <View
                  key={t.stage}
                  style={{ flex: 1, backgroundColor: t.color, opacity: t.stage === stage ? 1 : 0.35 }}
                />
              ))}
            </View>
            <View style={{ height: 0, position: 'relative', marginTop: 2 }}>
              <View
                style={{
                  position: 'absolute',
                  left: `${((stage - 1) / (BP_TIERS.length - 1)) * 100}%`,
                  top: -6,
                  width: 3,
                  height: 20,
                  backgroundColor: mm.colors.ink,
                  borderRadius: 2,
                  transform: [{ translateX: -1.5 }],
                }}
              />
            </View>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 10, lineHeight: 18 }}>
              {tier?.name}：{tier?.note}
            </Text>
          </>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>当前范围内暂无血压数据。</Text>
          </View>
        )}
      </Card>
      <InsightBanner title="血压解读" rows={rows} onMore={() => openChat('帮我分析今天的血压')} />
    </>
  );
}

/** 取某指标当天最新一次读数（兜底：avg 为 null 时用最新值） */
function latestValLocal(k: 'bpSys' | 'bpDia'): number | null {
  try {
    const pts = healthStore.getIntraday(k, dateKeyOf(Date.now()));
    return pts.length ? pts[pts.length - 1].v : null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)', marginRight: 8 },
  title: { fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  heroAvgLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  heroVals: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  heroSys: { fontSize: theme.fontSize.hero, fontWeight: '700' },
  heroSep: { fontSize: theme.fontSize.stat, color: theme.colors.textSub, marginHorizontal: 4 },
  heroDia: { fontSize: theme.fontSize.hero, fontWeight: '700' },
  heroUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: 4 },
  /* ★ 2026-11-03（用户·统一 hero 结构）：数字下方短分析 */
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(1.5) },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
    marginTop: 12,
  },
  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: 4 },
  statVal: { fontSize: theme.fontSize.lg, fontWeight: '700', color: theme.colors.textTitle },
  // 详细分析块
  detailTitle: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: theme.colors.textTitle, marginBottom: 10 },
  detailGrid: { flexDirection: 'row' },
  detailCol: { flex: 1, alignItems: 'center' },
  detailColLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: 4 },
  detailColVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold, color: theme.colors.textTitle },
  compareRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compareLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  compareVal: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: mm.colors.skyDeep },
  // ★ 2026-10-17：录入按钮 + 录入弹窗样式
  entryBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.lg,
    backgroundColor: mm.colors.skySoft, marginLeft: 8,
  },
  entryBtnText: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: mm.colors.skyDeep },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 340, backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md, padding: 18, borderWidth: 1, borderColor: theme.colors.cardBorder,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  modalClose: {
    position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ui.offTrack,
  },
  modalCloseTxt: { fontSize: theme.fontSize.card, color: theme.colors.textTitle, fontWeight: theme.weight.semibold },
  modalTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold, color: theme.colors.textTitle },
  modalHint: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 6, lineHeight: 17 },
  modalInputRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 14 },
  modalInputWrap: { flex: 1 },
  modalInputLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: 6 },
  modalInput: {
    borderWidth: 1, borderColor: theme.colors.cardBorder, borderRadius: theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: theme.fontSize.card, color: theme.colors.textTitle,
    textAlign: 'center', backgroundColor: theme.colors.cardBgStrong,
  },
  modalSlash: { fontSize: theme.fontSize.h2, color: theme.colors.textSub, paddingHorizontal: 10, paddingBottom: 8 },
  modalErr: { fontSize: theme.fontSize.xs, color: mm.colors.roseDeep, marginTop: 10 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  modalBtn: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.ui.offTrack,
  },
  modalBtnPrimary: { backgroundColor: mm.colors.skyDeep },
  modalBtnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
});
