/**
 * StatusTrendDetailScreen —— 「全天状态趋势」点击进入的日 / 周 / 月 / 年历史详情页
 *
 * 设计约束（与 MetricDetailScreen / design token 一致）：
 *  - 顶部返回 + 标题「全天状态趋势」+ 单位「状态指数 0–100」；
 *  - 日 / 周 / 月 / 年切换（复用 RangeSwitch）；
 *  - 日：今日分时曲线（ring.statusTimeline，实时能量曲线，0–24h）；
 *  - 周 / 月：每日均值（statusDaily，按天聚合的当日状态分值），一天一个点；
 *  - 年：每月均值（statusDaily 当月所有天的均值），一月一个点；
 *  - 全部使用真实数据，缺口断线 / 缺天留空，不编造；无数据区间诚实显示占位。
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, Rect, G, Text as SvgText } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import { useRingState } from '../hooks/useRingState';
import { type RangeKey } from '../data/metrics';
import { startOfWeek, addDays, formatDate } from '../lib/dateUtils';
import { MOODS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { dayKey, healthStore } from '../data/healthStore';
import { computeCycle, parseDate, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { phaseBg, PHASE_COLOR, PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';


const W = 680;
const H = 240;
/** ★ v18.151：PAD_L 14 → 34 —— 左侧要留出纵坐标刻度（0/50/100）的位置。
 *  所有 x 坐标都由 PAD_L / plotW 派生（plotW = w - PAD_L - PAD_R），所以调这一个常量即全局对齐。 */
const PAD_L = 34;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 28;
const Y_MIN = 0;
const Y_MAX = 100;
/** 纵坐标刻度（值 → 是否主刻度） */
const Y_TICKS = [100, 50, 0];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

/** 皮质醇异常判定（★ 与全 App 唯一口径对齐，见 CortisolRhythmCard / lib/cortisolRhythm）：
 *  「当日皮质醇均值 > 个人近 14 天日均值的 P75」= 相对你自己偏高。
 *  ⚠ 旧实现用的是指数绝对值 ≥ 58（tanh 压缩后的 0–100），与节律卡的百分位口径是两套标准，
 *    导致「节律卡里标了偏高的那天」在趋势页不出图标（用户实测撞上）。
 *  数据源同为 healthStore 的 `cortisol` 逐样本 —— 全 App 同一份信号，不再另算一套。 */
const CORT_BASELINE_DAYS = 14;
const CORT_ANOMALY_P = 0.75;

/** 线性插值分位数（与 lib/cortisolRhythm 的 percentile 同实现，保证阈值一致） */
function percentileOf(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

/** 某天的皮质醇日均值（读 healthStore 的 cortisol 逐样本）；无实测样本返回 null。 */
function cortisolDayMean(dk: string): number | null {
  const arr = healthStore.getIntraday('cortisol', dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
  if (arr.length === 0) return null;
  return arr.reduce((a, p) => a + p.v, 0) / arr.length;
}
/** PMS 早筛窗口：下次经期前 N 天内判为经前 PMS（黄体期末段） */
const PMS_WINDOW = 7;
/** 经前 PMS 暖色标记（柔和暖橙，区别于 4 相位，且不用红斜纹） */
const PMS_COLOR = '#E8894A';
/** 皮质醇异常图标色（单档）：红底白「!」，周视图顶部 + 图例共用 */
const CORT_COLOR = '#E2554E';

/** ★ 4 等级取色：任意数值 → 该点自己的等级色。
 *  与首页圆环/趋势图同源（curveLevel 的 index → MOODS 同索引），
 *  驱动散点色与折线渐变 stop，是等级信息的唯一载体，不要改成单色。 */
function moodFor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return MOODS[1].color;
  const idx = curveLevel(value, CURVE_DEFAULTS).index;
  return MOODS[idx]?.color ?? MOODS[1].color;
}

/** 4 等级图例：★ 与首页圆环下方图例完全同源（直接用 MOODS：元气满满/状态良好/平平静静/休息一下），
 *  不再用 curveLevel 的「充沛/平稳/偏低/不足」—— 两套叫法会让用户以为是两回事。 */
const LEVEL_LEGEND = MOODS.map((m) => ({ label: m.label, color: m.color }));

/** 把稀疏的 statusTimeline 点展开为全天 48 个 30min 边界槽。
 *  没数据的槽用 null，让折线分段逻辑自动断线。 */
// ★ 修：在每个 30min 窗口内找窗口最后一个点（不是精准匹配）
function expandTo48Slots(points: { t: number; value: number }[], anchorDayMs: number): { x: number; value: number | null }[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const n = sorted.length;
  let idx = 0;
  const result: { x: number; value: number | null }[] = [];
  for (let i = 0; i < 48; i++) {
    const slotStart = anchorDayMs + i * 30 * 60 * 1000;
    const slotEnd = slotStart + 30 * 60 * 1000;
    // 跳过 slotStart 之前的点
    while (idx < n && sorted[idx].t < slotStart) idx++;
    // 收集 [slotStart, slotEnd) 内所有点，取最后一个
    let lastInSlot: { value: number } | null = null;
    while (idx < n && sorted[idx].t < slotEnd) {
      lastInSlot = sorted[idx];
      idx++;
    }
    result.push({ x: dayFrac(slotStart), value: lastInSlot?.value ?? null });
  }
  return result;
}

function dayFrac(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.min(1, Math.max(0, (t - d.getTime()) / DAY_MS));
}

function lastDayKeys(n: number): string[] {
  const arr: string[] = [];
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    arr.push(dayKey(d.getTime()));  // ★ 补零格式
  }
  return arr;
}

function monthMean(
  statusDaily: Record<string, number>,
  year: number,
  month0: number
): number | null {
  const prefix = `${year}-${month0 + 1}-`;
  const vals = Object.keys(statusDaily)
    .filter((k) => k.startsWith(prefix))
    .map((k) => statusDaily[k]);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function meanOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function maxOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.max(...v);
}
function minOf(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) return null;
  return Math.min(...v);
}

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
}

const DAY_AXIS = ['0', '6', '12', '18', '24'];

export default function StatusTrendDetailScreen() {
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [w, setW] = useState(0);
  // ★ tooltip 状态
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: string; color: string } | null>(null);
  // ★ 周期相位 / PMS 标记需要的本地经期记录（异步加载一次）
  const [cycleLog, setCycleLog] = useState<CycleLog | null>(null);
  useEffect(() => {
    let alive = true;
    loadCycleLog().then((log) => { if (alive) setCycleLog(log); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const statusDaily = ring.statusDaily ?? {};

  // ★ Fallback: 从 statusTimelineByDay 反推某一天的状态均值
  const dailyMeanFromTimeline = (dayKey: string): number | null => {
    const tl = ring.statusTimelineByDay?.[dayKey];
    if (!tl || tl.length === 0) return null;
    const vals = tl.map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // ★ Fallback: 从今日实时 statusTimeline 反推均值（只给今天用）
  const todayMeanFromTimeline = (): number | null => {
    const tl = ring.statusTimeline ?? [];
    if (tl.length === 0) return null;
    const vals = tl.map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // 计算各区间的（点序列 + 轴标签 + 当前值 + 统计）
  const { pts, axisLabels, fixedAxis, current, firstReal, avg, hi, lo, hasData } = useMemo(() => {
    const anchorKey = dayKey(anchor.getTime());  // ★ 补零格式

    if (range === 'day') {
      const todayKey = dayKey(Date.now());
      // ★ 诊断 log（仅 __DEV__）
      if (__DEV__) {
        console.log('[STATUS-DAY]', JSON.stringify({
          anchorKey, todayKey,
          anchorIsToday: anchorKey === todayKey,
          timeline_len: (ring.statusTimeline ?? []).length,
          timeline_first2: (ring.statusTimeline ?? []).slice(0, 2),
          timelineByDay_keys: Object.keys(ring.statusTimelineByDay ?? {}),
          timelineByDay_counts: Object.fromEntries(
            Object.entries(ring.statusTimelineByDay ?? {}).map(([k, v]) => [k, v?.length ?? 0])
          ),
          statusDaily_keys: Object.keys(statusDaily ?? {}),
          statusDaily_vals: Object.fromEntries(Object.entries(statusDaily ?? {}).slice(-7)),
        }));
      }
      if (anchorKey === todayKey) {
        const anchorDayMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0).getTime();
        // ★ 与首页「全天状态趋势」(TrendChart.todayStatusTimeline) 同口径：只取「今天」的点，
        //   剔除混入 ring.statusTimeline 的历史/回填数据点 —— 否则首页为空、点进详情页却把旧曲线当成今天画出来。
        const nowD = new Date();
        const tl = (ring.statusTimeline ?? [])
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .filter((p) => {
            const d = new Date(p.t);
            return d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth() && d.getDate() === nowD.getDate();
          })
          .map((p) => ({ t: p.t, value: p.value }))
          .sort((a, b) => a.t - b.t);
        // ★ 展开为 48 个完整槽，gap 填 null → 折线自动断线
        const points = expandTo48Slots(tl, anchorDayMs);
        const values = tl.map((p) => p.value);
        return {
          pts: points,
          axisLabels: DAY_AXIS,
          fixedAxis: true,
          current: values.length ? values[values.length - 1] : null,
          firstReal: values.length ? values[0] : null,
          avg: meanOf(values),
          hi: maxOf(values),
          lo: minOf(values),
          hasData: values.length > 0,
        };
      }
      // 历史某天：优先用按天归档的真实状态曲线（每 30 分钟一个点，与当时一致）；无归档则退化为当日均值
      const archived = ring.statusTimelineByDay?.[anchorKey];
      if (archived && archived.length > 0) {
        const anchorDayMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0).getTime();
        const tl = archived
          .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.t))
          .map((p) => ({ t: p.t as number, value: p.value as number }))
          .sort((a, b) => a.t - b.t);
        // ★ 展开为 48 个完整槽，gap 填 null → 折线自动断线
        const points = expandTo48Slots(tl, anchorDayMs);
        const values = tl.map((p) => p.value);
        return {
          pts: points,
          axisLabels: DAY_AXIS,
          fixedAxis: true,
          current: values.length ? values[values.length - 1] : null,
          firstReal: values.length ? values[0] : null,
          avg: meanOf(values),
          hi: maxOf(values),
          lo: minOf(values),
          hasData: values.length > 0,
        };
      }
      const v = statusDaily[anchorKey] != null ? statusDaily[anchorKey] : null;
      const values = v != null ? [v] : [];
      return {
        pts: v != null ? [{ x: 0.5, value: v }] : [],
        axisLabels: DAY_AXIS,
        fixedAxis: true,
        current: v,
        firstReal: v,
        avg: meanOf(values),
        hi: maxOf(values),
        lo: minOf(values),
        hasData: v != null,
      };
    }

    if (range === 'year') {
      const y = anchor.getFullYear();
      if (__DEV__) console.log('[STATUS-YEAR]', JSON.stringify({ year: y, statusDaily_all_keys: Object.keys(statusDaily ?? {}) }));
      const labels: string[] = [];
      const values: (number | null)[] = [];
      for (let mo = 0; mo < 12; mo++) {
        labels.push(`${mo + 1}月`);
        // ★ monthMean 基础 + timelineByDay fallback
        const base = monthMean(statusDaily, y, mo);
        if (base != null) { values.push(base); continue; }
        // 从 timelineByDay 扫当月每天
        const prefix = `${y}-${String(mo + 1).padStart(2, '0')}-`;  // ★ 补零匹配 timelineByDay key
        const tlVals: number[] = [];
        for (const dk of Object.keys(ring.statusTimelineByDay ?? {})) {
          if (dk.startsWith(prefix)) {
            const m = dailyMeanFromTimeline(dk);
            if (m != null) tlVals.push(m);
          }
        }
        if (tlVals.length > 0) {
          values.push(tlVals.reduce((a, b) => a + b, 0) / tlVals.length);
        } else {
          values.push(null);
        }
      }
      const points = values.map((v, i) => ({ x: values.length > 1 ? i / (values.length - 1) : 0.5, value: v }));
      return {
        pts: points,
        axisLabels: labels,
        fixedAxis: false,
        current: lastNonNull(values),
        firstReal: lastNonNull(values),
        avg: meanOf(values),
        hi: maxOf(values),
        lo: minOf(values),
        hasData: values.some((v) => v != null),
      };
    }

    // week（anchor 所在自然周 周一~周日）/ month（anchor 所在自然月）：每日均值。
    console.log('[STATUS-RANGE]', JSON.stringify({
      range, anchorKey,
      statusDaily_all: Object.fromEntries(
        Object.entries(statusDaily ?? {}).map(([k, v]) => [k, v?.toFixed(1) ?? null])
      ),
    }));
    const keys: string[] = [];
    const labels: string[] = [];
    if (range === 'week') {
      const mon = startOfWeek(anchor);   // ★ 自然周（周一~周日）：用户口径，之前的实现是对的
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(WEEK_LABEL[d.getDay()]);
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const d = new Date(y, m0, day);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(`${day}`);
      }
    }
    // ★ 3 层 fallback: statusDaily → statusTimelineByDay 均值 → 今日 timeline 均值（仅今天）
    const todayK = keys.includes(dayKey(Date.now()));
    const values = keys.map((k) => {
      if (statusDaily[k] != null) return statusDaily[k];
      const fromTl = dailyMeanFromTimeline(k);
      if (fromTl != null) return fromTl;
      // 如果是今天且 timelineByDay 没有，试实时 timeline
      if (k === dayKey(Date.now())) {
        const fromRT = todayMeanFromTimeline();
        if (fromRT != null) return fromRT;
      }
      return null;
    });
    const points = values.map((v, i) => ({ x: values.length > 1 ? i / (values.length - 1) : 0.5, value: v }));
    // ★ 诊断日志（仅 __DEV__）：核对周视图「有没有数据 / 数据从哪来」，避免把「本来就没测」误判成渲染 bug。
    if (__DEV__ && range === 'week') {
      console.log('[STATUS-WEEK]', JSON.stringify({
        anchor: formatDate(anchor),
        weekKeys: keys,
        values,
        fromStatusDaily: keys.map((k) => statusDaily[k] ?? null),
        fromTimelineByDay: keys.map((k) => dailyMeanFromTimeline(k)),
        todayRealtime: keys.includes(dayKey(Date.now())) ? todayMeanFromTimeline() : null,
        hasData: values.some((v) => v != null),
      }));
    }
    return {
      pts: points,
      axisLabels: labels,
      fixedAxis: false,
      current: lastNonNull(values),
      firstReal: lastNonNull(values),
      avg: meanOf(values),
      hi: maxOf(values),
      lo: minOf(values),
      hasData: values.some((v) => v != null),
    };
  }, [range, ring.statusTimeline, ring.statusTimelineByDay, statusDaily, anchor]);

  const plotW = w - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const yAt = (v: number) => {
    const c = Math.max(Y_MIN, Math.min(Y_MAX, Number.isFinite(v) ? v : Y_MIN));
    return PAD_T + (1 - (c - Y_MIN) / (Y_MAX - Y_MIN || 1)) * plotH;
  };

  // 折线分段（遇 null 断线）；同时把所有真实点收集为散点，保证历史日单点/稀疏点也能看见。
  // ★ 散点带 srcIndex：散点数组跳过 null，索引与 pts/axisLabels 不再一一对应，
  //   tooltip 命中时用它回查原始点，避免有缺口时「点 A 显示 B 的数值」。
  // ★ 散点带 color：每点自己的 4 等级色（moodFor），日/周/月/年都按这个上色。
  // ★ 折线口径与首页「全天状态趋势」(TrendChart) 对齐：
  //   - 描边是一条**横向多 stop 渐变**，每个数据点一个 stop，颜色 = 该点等级色 → 折线自己就带等级语义；
  //   - 填充用首/中/末三点等级色的竖向渐变（0.24 → 0.08 → 0.02），与首页同款；
  //   - 不再画「白底粗线」压线（首页没有），改成 2.5pt 渐变描边直接画。
  //   （以往那版 colorLines「按等级分段上色」已废弃：它遍历 allDots，会跨缺口连线，与「断线不补值」相反。）
  const { lineD, areaD, dots, gradStops } = useMemo(() => {
    if (w === 0) return { lineD: '', areaD: '', dots: [] as { x: number; y: number; srcIndex: number; color: string }[], gradStops: [] as { offset: string; color: string }[] };
    let line = '';
    let area = '';
    let seg: { x: number; y: number }[] = [];
    const allDots: { x: number; y: number; srcIndex: number; color: string }[] = [];
    const flush = () => {
      if (seg.length < 2) {
        seg = [];
        return;
      }
      // Catmull-Rom → Bezier 平滑 (用 seg 内部邻居)
      const sn = seg.length;
      let d = `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
      for (let i = 0; i < sn - 1; i++) {
        const p0 = seg[Math.max(0, i - 1)];
        const p1 = seg[i];
        const p2 = seg[i + 1];
        const p3 = seg[Math.min(sn - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
      line += d;
      area += `${d} L ${seg[sn - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;
      seg = [];
    };
    pts.forEach((p, i) => {
      const v = p.value;
      if (v == null) {
        flush();
        return;
      }
      const pt = { x: PAD_L + p.x * plotW, y: yAt(v), srcIndex: i, color: moodFor(v) };
      allDots.push(pt);
      seg.push(pt);
    });
    flush();
    // ★ 渐变 stop：按点的 x 位置归一化（沿用首页 TrendChart 的做法）。
    //   注意用 allDots（跳过缺口）而不是 pts —— 缺口处不该产生 stop。
    const gradStops = (() => {
      const n = allDots.length;
      if (n === 0) return [] as { offset: string; color: string }[];
      if (n === 1) return [{ offset: '0%', color: allDots[0].color }, { offset: '100%', color: allDots[0].color }];
      const x0 = allDots[0].x;
      const span = allDots[n - 1].x - x0 || 1;
      return allDots.map((d) => ({ offset: `${(((d.x - x0) / span) * 100).toFixed(2)}%`, color: d.color }));
    })();
    return { lineD: line, areaD: area, dots: allDots, gradStops };
  }, [w, pts]);

  // ★ v18.150 图表叠加层：月视图周期相位带 + 经前 PMS；周视图皮质醇异常图标
  // 与图表点对齐（周=7天等距 / 月=当月每天等距）。
  const chartOverlay = useMemo(() => {
    const bands: { x0: number; x1: number; phase: PhaseKey; pms: boolean }[] = [];
    const cort: { x: number; y: number; i: number; mesor: number }[] = [];
    // 皮质醇基线的中间量（供 __DEV__ 日志核对，不影响渲染）
    let cortBaseN = 0;
    let cortP75: number | null = null;
    if (w === 0) return { bands, cort };

    // 与图表点对齐的日期 keys
    let dayKeys: string[] = [];
    if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) dayKeys.push(dayKey(addDays(mon, i).getTime()));
    } else if (range === 'month') {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) dayKeys.push(dayKey(new Date(y, m0, d).getTime()));
    } else {
      return { bands, cort };
    }

    const n = dayKeys.length;
    if (n < 2) return { bands, cort };
    const edge = (frac: number) => PAD_L + Math.max(0, Math.min(1, frac)) * plotW;
    const xAt = (i: number) => edge(i / (n - 1));
    const leftOf = (i: number) => edge((i - 0.5) / (n - 1));
    const rightOf = (i: number) => edge((i + 0.5) / (n - 1));

    if (range === 'month') {
      const tempSeries = Object.keys(ring.tempDaily ?? {}).length
        ? Object.keys(ring.tempDaily).map((d) => ({ date: d, temp: (ring.tempDaily as any)[d] }))
        : undefined;
      const days: { phase: PhaseKey; pms: boolean }[] = dayKeys.map((dk) => {
        const info = computeCycle(cycleLog, parseDate(dk), { tempSeries, periodHistory: cycleLog?.history });
        const dtnp = info.daysToNextPeriod;
        const pms = dtnp != null && dtnp >= 0 && dtnp <= PMS_WINDOW && info.phase === 'luteal';
        return { phase: (info.phase as PhaseKey) ?? 'unknown', pms };
      });
      // 合并同相位连续段 → 干净背景带
      let runPhase: PhaseKey = days[0].phase;
      let runStart = 0;
      const flushRun = (endIdx: number) => {
        if (runPhase === 'unknown') { runStart = endIdx + 1; return; }
        bands.push({ x0: leftOf(runStart), x1: rightOf(endIdx), phase: runPhase, pms: false });
      };
      for (let i = 1; i < n; i++) {
        if (days[i].phase !== runPhase) { flushRun(i - 1); runPhase = days[i].phase; runStart = i; }
      }
      flushRun(n - 1);
      // PMS 段叠加（暖色覆盖在黄体带之上）
      let pStart = -1;
      for (let i = 0; i <= n; i++) {
        const isP = i < n && days[i].pms;
        if (isP && pStart < 0) pStart = i;
        if (!isP && pStart >= 0) {
          bands.push({ x0: leftOf(pStart), x1: rightOf(i - 1), phase: 'unknown', pms: true });
          pStart = -1;
        }
      }
    } else if (range === 'week') {
      // ★ 与节律卡同口径：个人基线 = 被查看这一周之前 14 天的皮质醇日均值（不含本周，避免当天自身抬高阈值）
      const mon = startOfWeek(anchor);
      const baseMeans: number[] = [];
      for (let i = 1; i <= CORT_BASELINE_DAYS; i++) {
        const m = cortisolDayMean(dayKey(addDays(mon, -i).getTime()));
        if (m != null) baseMeans.push(m);
      }
      cortBaseN = baseMeans.length;
      cortP75 = percentileOf(baseMeans.slice().sort((a, b) => a - b), CORT_ANOMALY_P);
      if (cortP75 != null) {
        for (let i = 0; i < n; i++) {
          const m = cortisolDayMean(dayKeys[i]);
          if (m == null || m <= cortP75) continue;   // 未超过个人 P75 → 不算异常
          const v = pts[i]?.value ?? null;
          const y = v != null ? yAt(v) : PAD_T + 6;
          cort.push({ x: xAt(i), y, i, mesor: m });
        }
      }
    }
    if (__DEV__ && range === 'week') {
      console.log('[STATUS-WEEK-CORT]', JSON.stringify({
        anchor: formatDate(anchor),
        baseDays: cortBaseN,
        p75: cortP75 != null ? Math.round(cortP75 * 10) / 10 : null,
        cortDays: cort.map((c) => ({ day: dayKeys[c.i], mesor: Math.round(c.mesor) })),
        note: cort.length === 0 ? '本周无 cortisol 样本 / 基线不足 4 天 / 日均值均未超个人 P75 → 不标图标（数据侧，非渲染 bug）' : '',
      }));
    }
    return { bands, cort };
  }, [w, plotW, range, anchor, ring.tempDaily, cycleLog, pts, plotH]);

  const deltaPct =
    firstReal != null && current != null && firstReal !== 0
      ? Math.round(((current - firstReal) / Math.abs(firstReal)) * 100)
      : 0;

  // ★ v18.147 对比模块数据（StressWatch 范式：方块+数字，不写长段文字）
  const comparison = useMemo(() => {
    const valOf = (dk: string): number | null => {
      if (statusDaily[dk] != null) return statusDaily[dk];
      const fromTl = dailyMeanFromTimeline(dk);
      if (fromTl != null) return fromTl;
      if (dk === dayKey(Date.now())) return todayMeanFromTimeline();
      return null;
    };
    const avgKeys = (keys: string[]): number | null => {
      const vs = keys.map(valOf).filter((v): v is number => v != null && Number.isFinite(v));
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const fmtD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

    // 当前区间逐单元（日/月）序列 + 区间 dayKeys
    let units: { label: string; value: number | null }[] = [];
    let curKeys: string[] = [];
    let prevLabel = '上期';
    let baseLabel = '基线';
    if (range === 'day') {
      const dk = dayKey(anchor.getTime());
      units = [{ label: '今日', value: valOf(dk) }];
      curKeys = [dk];
      prevLabel = '昨日'; baseLabel = '7天基线';
    } else if (range === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) { const d = addDays(mon, i); curKeys.push(dayKey(d.getTime())); units.push({ label: fmtD(d), value: valOf(dayKey(d.getTime())) }); }
      prevLabel = '上周'; baseLabel = '30天基线';
    } else if (range === 'month') {
      const y = anchor.getFullYear(); const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) { const d = new Date(y, m0, day); curKeys.push(dayKey(d.getTime())); units.push({ label: `${day}`, value: valOf(dayKey(d.getTime())) }); }
      prevLabel = '上月'; baseLabel = '30天基线';
    } else {
      const y = anchor.getFullYear();
      for (let mo = 0; mo < 12; mo++) units.push({ label: `${mo + 1}月`, value: monthMean(statusDaily, y, mo) });
      prevLabel = '去年'; baseLabel = '全年基线';
    }

    const withVal = units.filter((u): u is { label: string; value: number } => u.value != null);
    let best: { label: string; value: number } | null = null;
    let worst: { label: string; value: number } | null = null;
    if (withVal.length) {
      best = withVal.reduce((a, b) => (b.value > a.value ? b : a));
      worst = withVal.reduce((a, b) => (b.value < a.value ? b : a));
    }

    // 上期（等长前一窗口）与基线窗口
    let prevKeys: string[] = [];
    let baseKeys: string[] = [];
    if (range === 'day') {
      const y = new Date(anchor); y.setDate(y.getDate() - 1); prevKeys = [dayKey(y.getTime())];
      for (let i = 1; i <= 7; i++) { const d = new Date(anchor); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    } else if (range === 'week') {
      const mon = startOfWeek(anchor); const s = new Date(mon); s.setDate(s.getDate() - 7);
      for (let i = 0; i < 7; i++) prevKeys.push(dayKey(addDays(s, i).getTime()));
      for (let i = 1; i <= 30; i++) { const d = new Date(mon); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    } else if (range === 'month') {
      const end = new Date(anchor.getFullYear(), anchor.getMonth(), 0);
      const s = new Date(end); s.setDate(s.getDate() - (curKeys.length - 1));
      for (let i = 0; i < curKeys.length; i++) prevKeys.push(dayKey(addDays(s, i).getTime()));
      const ms = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      for (let i = 1; i <= 30; i++) { const d = new Date(ms); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    }

    let vsPrev: number | null = null;
    let vsBase: number | null = null;
    if (range === 'year') {
      const y = anchor.getFullYear();
      const prevMonths: (number | null)[] = []; for (let mo = 0; mo < 12; mo++) prevMonths.push(monthMean(statusDaily, y - 1, mo));
      const allMonths: (number | null)[] = []; for (let mo = 0; mo < 12; mo++) allMonths.push(monthMean(statusDaily, y, mo));
      vsPrev = meanOf(prevMonths);
      vsBase = meanOf(allMonths);
    } else {
      vsPrev = avgKeys(prevKeys);
      vsBase = avgKeys(baseKeys);
    }

    const pct = (a: number | null, b: number | null): string => {
      if (a == null || b == null || !Number.isFinite(b) || b === 0) return '';
      const d = Math.round(((a - b) / Math.abs(b)) * 100);
      return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%`;
    };
    const prevDelta = pct(avg, vsPrev);
    const baseDelta = pct(avg, vsBase);

    return {
      best, worst, prevLabel, baseLabel, vsPrev, vsBase, prevDelta, baseDelta,
      showBestWorst: range !== 'day',
    };
  }, [range, anchor, statusDaily, ring, avg]);

  // 轴标签：固定（日=时间轴）则均匀排；否则取 ~7 个等距点
  const renderAxis = () => {
    if (fixedAxis) {
      return DAY_AXIS.map((t, i) => (
        <Text key={i} style={styles.axisText}>
          {t}
        </Text>
      ));
    }
    const arr = axisLabels;
    if (arr.length <= 7) {
      return arr.map((t, i) => (
        <Text key={i} style={styles.axisText}>
          {t}
        </Text>
      ));
    }
    const pick = 7;
    const idxs = Array.from({ length: pick }, (_, i) => Math.floor((i * (arr.length - 1)) / (pick - 1)));
    return idxs.map((i) => (
      <Text key={i} style={styles.axisText}>
        {arr[i]}
      </Text>
    ));
  };

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>全天状态趋势</Text>
            <Text style={styles.sub}>状态指数 0–100（越高越有活力）</Text>
          </View>
          {hasData ? (
            <View style={styles.liveTag}>
              <Text style={styles.liveText}>真实数据</Text>
            </View>
          ) : null}
        </View>

        {/* 当前值 */}
        <View style={styles.hero}>
          <Text style={styles.heroVal}>{fmtVal(current)}</Text>
          <Text style={styles.heroUnit}>/ 100</Text>
          {hasData && deltaPct !== 0 ? (
            <Text style={[styles.delta, deltaPct > 0 ? styles.up : styles.down]}>
              {deltaPct > 0 ? '↑' : '↓'} {Math.abs(deltaPct)}% · 较区间首点
            </Text>
          ) : null}
        </View>

        {/* 日 / 周 / 月 / 年 切换 */}
        <RangeSwitch value={range} onChange={setRange} />

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* 趋势图 */}
        <View style={styles.chartCard}>
          <View
            onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
            onTouchStart={(e) => {
              if (dots.length === 0) return;
              const touch = e.nativeEvent;
              // ★ 修正：本页 <Svg width={w} height={H}> **没有 viewBox**，用户单位就是 pt，
              //   点坐标 dots[].x/y 与触摸坐标同一坐标系，不需要任何缩放。
              //   旧代码按 `wScale = W / w`（W=680）换算，等于把命中点放大到 680 坐标系去找最近点：
              //   在 ~340pt 的卡片上会命中「约两倍远处」的那一天 —— tooltip 位置看着没错（渲染时又除回去），
              //   但数值和日期是错的（点第 2 天显示第 5 天的数）。去掉换算即与绘图同源。
              const svgX = touch.locationX;
              let best = -1, bestDist = Infinity;
              for (let i = 0; i < dots.length; i++) {
                const dd = Math.abs(dots[i].x - svgX);
                if (dd < bestDist) { bestDist = dd; best = i; }
              }
              if (best < 0) return;
              const d = dots[best];
              // ★ 散点数组跳过了无数据的日期，索引与 pts/axisLabels 不再对齐，
              //   必须用 dots[].srcIndex 回查，否则有缺口时会取到别的日期的值。
              const rawVal = pts[d.srcIndex]?.value ?? null;
              const label = axisLabels[Math.min(d.srcIndex, axisLabels.length - 1)] ?? '';
              const lv = curveLevel(rawVal ?? 50, CURVE_DEFAULTS);
              const mo = MOODS[lv.index] ?? MOODS[1];
              setTip({
                x: d.x,
                y: d.y,
                label,
                value: fmtVal(rawVal),
                color: mo.color,
              });
            }}
            onTouchEnd={() => setTimeout(() => setTip(null), 2000)}
            pointerEvents="box-none"
          >
            {w > 0 ? (
              <Svg width={w} height={H}>
                <Defs>
                  {/* 填充：竖向渐变，颜色取首/中/末点的等级色（与首页 TrendChart 同款口径） */}
                  <LinearGradient id="std_grad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%" stopColor={gradStops[0]?.color ?? mm.colors.purpleCore} stopOpacity={0.24} />
                    <Stop offset="55%" stopColor={gradStops[Math.floor(gradStops.length / 2)]?.color ?? mm.colors.purpleCore} stopOpacity={0.08} />
                    <Stop offset="100%" stopColor={gradStops[gradStops.length - 1]?.color ?? mm.colors.purpleCore} stopOpacity={0.02} />
                  </LinearGradient>
                  {/* 描边：横向多 stop 渐变，每点一个 stop（= 该点等级色）→ 线随等级变色 */}
                  <LinearGradient id="std_line" x1="0" y1="0" x2="1" y2="0">
                    {(gradStops.length
                      ? gradStops
                      : [
                          { offset: '0%', color: mm.colors.purpleCore },
                          { offset: '100%', color: mm.colors.purpleDeep },
                        ]
                    ).map((gs, i) => (
                      <Stop key={`gs-${i}`} offset={gs.offset} stopColor={gs.color} />
                    ))}
                  </LinearGradient>
                </Defs>

                {/* ★ v18.151（用户选 A）：日/周/年的 4 等级背景带已移除 ——
                    折线本身已是等级色渐变（见下方 std_line），背景带成了重复表达，
                    同一条「充沛」带上再压一条同色线反而糊。等级信息 = 渐变线 + 散点色。 */}

                {/* ★ 月视图背景 = 周期相位（经期/卵泡期/排卵期/黄体期），四相都会画出来，
                    不是只标 PMS：一个月必然横跨多个相位，每个相位的连续段各有一条带 + 顶部相位色描边 + 相位名。
                    经前 PMS 是叠加在黄体期末段的暖橙段（额外一层）。
                    等级信息在月视图不再走背景，改由「每个点的等级色」表达（见下方散点）。 */}
                {range === 'month'
                  ? chartOverlay.bands.map((b, i) => {
                      const x = Math.max(PAD_L, b.x0);
                      const wClip = Math.max(0, Math.min(PAD_L + plotW, b.x1) - x);
                      if (wClip <= 0) return null;
                      if (b.pms) {
                        // 经前 PMS：暖橙整段 + 顶部高亮条（柔和，不用红斜纹）
                        return (
                          <G key={`pms-${i}`}>
                            <Rect x={x} y={PAD_T} width={wClip} height={plotH} fill={PMS_COLOR} opacity={0.24} />
                            <Rect x={x} y={PAD_T} width={wClip} height={3} fill={PMS_COLOR} opacity={0.9} />
                            {/* PMS 名靠右写：相位名统一靠左，两者不会压在一起 */}
                            {wClip >= 44 ? (
                              <SvgText x={x + wClip - 5} y={PAD_T + 17} fontSize={9} fontWeight="600" fill={PMS_COLOR} textAnchor="end">
                                经前PMS
                              </SvgText>
                            ) : null}
                          </G>
                        );
                      }
                      return (
                        <G key={`pb-${i}`}>
                          <Rect x={x} y={PAD_T} width={wClip} height={plotH} fill={phaseBg(b.phase, 0.22)} />
                          {/* 顶部相位色描边：把相邻相位的分界标出来（0.14 的淡底几乎看不出分界） */}
                          <Rect x={x} y={PAD_T} width={wClip} height={3} fill={PHASE_COLOR[b.phase]} opacity={0.85} />
                          {/* 相位名靠左写（带太窄就不写，避免互相压字）；靠左是为了给靠右的 PMS 名留位置 */}
                          {wClip >= 36 ? (
                            <SvgText
                              x={x + 5}
                              y={PAD_T + 17}
                              fontSize={9}
                              fontWeight="600"
                              fill={theme.colors.textSub}
                              textAnchor="start"
                            >
                              {PHASE_LABEL[b.phase]}
                            </SvgText>
                          ) : null}
                        </G>
                      );
                    })
                  : null}

                {/* 量程参考线 + 纵坐标刻度（日/周/月/年通用）。
                    ★ v18.151：x2 由 W−PAD_R 改为 PAD_L+plotW —— 原来那版会画到 666pt（超出绘图区），
                      靠 SVG 宽度裁掉才看着正常；宽度变了就会露出来。 */}
                {Y_TICKS.map((gv, i) => (
                  <G key={`g-${i}`}>
                    <Line
                      x1={PAD_L}
                      y1={yAt(gv)}
                      x2={PAD_L + plotW}
                      y2={yAt(gv)}
                      stroke={theme.colors.ui.borderSoft}
                      strokeWidth={1}
                    />
                    <SvgText
                      x={PAD_L - 7}
                      y={yAt(gv) + 3.2}
                      fontSize={9}
                      fill={theme.colors.textSub}
                      textAnchor="end"
                    >
                      {String(gv)}
                    </SvgText>
                  </G>
                ))}
                {/* 纵轴轴线 */}
                <Line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={theme.colors.ui.borderSoft} strokeWidth={1} />

                {areaD ? <Path d={areaD} fill="url(#std_grad)" /> : null}
                {/* ★ 主折线：与首页「全天状态趋势」同款 —— 等级色横向渐变描边 2.5pt，
                    线本身随等级变色。不再压白底粗线、也不再统一单色。 */}
                {lineD ? (
                  <Path d={lineD} fill="none" stroke="url(#std_line)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}

                {/* ★ 散点：日/周/月/年每个点都画，颜色 = 该点自己的 4 等级色（moodFor）。
                    等级信息靠它表达（月视图背景已经让位给周期相位），所以不能统一成单色。
                    日视图 48 槽很密 → 小半径细描边；周/月/年较疏 → 大半径 + 白描边压住背景。 */}
                {dots.map((d, i) => {
                  const dense = range === 'day';
                  const isLast = i === dots.length - 1;
                  return (
                    <Circle
                      key={`dot-${i}`}
                      cx={d.x}
                      cy={d.y}
                      r={dense ? 2.6 : isLast ? 4.5 : 3.5}
                      fill={d.color}
                      stroke="#FFFFFF"
                      strokeWidth={dense ? 0.8 : 1.5}
                    />
                  );
                })}

                {/* ★ 周视图：皮质醇异常图标（单档，红底白「!」），虚线连到当天的数据点 */}
                {range === 'week'
                  ? chartOverlay.cort.map((c, i) => {
                      const topY = PAD_T + 8;
                      return (
                        <G key={`cort-${i}`}>
                          <Line x1={c.x} y1={topY + 8} x2={c.x} y2={c.y} stroke={CORT_COLOR} strokeWidth={1} strokeDasharray="3,3" opacity={0.65} />
                          <Circle cx={c.x} cy={topY} r={8} fill={CORT_COLOR} />
                          <SvgText x={c.x} y={topY + 3.5} fontSize={11} fontWeight="700" fill="#FFFFFF" textAnchor="middle">{'!'}</SvgText>
                        </G>
                      );
                    })
                  : null}
              </Svg>
            ) : null}
            {/* ★ tooltip：点击显示白色详情框 */}
            {tip && w > 0 ? (() => {
              const TW = 110, TH = 60;
              let tipX = tip.x - TW / 2;
              if (tipX < 4) tipX = 4;
              if (tipX + TW > w - 4) tipX = w - 4 - TW;
              const tipY = Math.max(0, tip.y - TH - 12);
              const triX = tip.x - 8;
              return (
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: H }}>
                  <View style={{ position: 'absolute', left: tipX, top: tipY, width: TW, height: TH, backgroundColor: '#FFFFFF', borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, paddingHorizontal: 10, paddingVertical: 8 }}>
                    <Text style={{ fontSize: 11, color: theme.colors.textSub, marginBottom: 2 }}>{tip.label}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: tip.color }}>{tip.value}</Text>
                  </View>
                  <View style={{ position: 'absolute', left: triX, top: tipY + TH, width: 0, height: 0, backgroundColor: 'transparent', borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFFFFF' }} />
                </View>
              );
            })() : null}
          </View>

          {/* 无数据占位（诚实） */}
          {!hasData ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {range === 'day'
                  ? '今日状态曲线尚未生成，佩戴戒指并打开数据同步后将实时记录'
                  : '当前范围内暂无真实测量数据，开启数据同步并佩戴戒指后将逐日累积'}
              </Text>
            </View>
          ) : null}

          {/* X 轴标签 */}
          <View style={styles.axis}>{renderAxis()}</View>

          {/* ★ 图表图例：等级色（日/周/月/年通用，散点颜色）+ 周期相位·经前PMS（月）+ 皮质醇异常（周） */}
          <View style={styles.legendRow}>
            {LEVEL_LEGEND.map((l) => (
              <View key={l.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                <Text style={styles.legendText}>{l.label}</Text>
              </View>
            ))}
          </View>

          {range === 'month' ? (
            <View style={styles.legendRow}>
              {(['period', 'follicular', 'ovulation', 'luteal'] as PhaseKey[]).map((p) => (
                <View key={p} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: PHASE_COLOR[p] }]} />
                  <Text style={styles.legendText}>{PHASE_LABEL[p]}</Text>
                </View>
              ))}
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: PMS_COLOR }]} />
                <Text style={styles.legendText}>经前PMS</Text>
              </View>
            </View>
          ) : null}

          {range === 'week' ? (
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CORT_COLOR }]} />
                <Text style={styles.legendText}>皮质醇异常</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* ★ 详细分析（StressWatch 范式：方块+数字，不写长段文字）
            口径（v18.153 用户定的顺序）：**第一排 = 平均 / 最高 / 最低**，
            再 状态最好 / 状态最差，最后 对比上期 / 对比基线。
            （前两版把统计值沉到中间/最底，用户逐次纠正后定稿为「统计值在最上」。） */}
        <View style={styles.cmpHead}>
          <Text style={styles.cmpTitle}>详细分析</Text>
          <Text style={styles.cmpSub}>{range === 'day' ? '今日' : range === 'week' ? '本周' : range === 'month' ? '本月' : '本年'}</Text>
        </View>

        {/* 第一排：平均 / 最高 / 最低（本区间统计值，与上方曲线同源：pts 的有效点） */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>平均</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(avg)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最高</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(hi)}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>最低</Text>
            <Text style={styles.statValue} numberOfLines={1}>{fmtVal(lo)}</Text>
          </View>
        </View>

        {comparison.showBestWorst && (
          <View style={[styles.cmpGrid2, { marginTop: theme.space.sm }]}>
            <View style={styles.cmpCell}>
              <Text style={styles.cmpLabel}>状态最好</Text>
              {/* ★ 数值必须过 fmtVal：best/worst 直接来自 statusDaily / timeline 日均，
                  未格式化时会出现 68.42857142857143 这种一串小数（用户实测）。 */}
              <Text style={[styles.cmpVal, { color: theme.colors.success }]}>{fmtVal(comparison.best ? comparison.best.value : null)}</Text>
              <Text style={styles.cmpMeta}>{comparison.best ? comparison.best.label : '暂无数据'}</Text>
            </View>
            <View style={styles.cmpCell}>
              <Text style={styles.cmpLabel}>状态最差</Text>
              <Text style={[styles.cmpVal, { color: theme.colors.danger }]}>{fmtVal(comparison.worst ? comparison.worst.value : null)}</Text>
              <Text style={styles.cmpMeta}>{comparison.worst ? comparison.worst.label : '暂无数据'}</Text>
            </View>
          </View>
        )}

        <View style={[styles.cmpGrid2, { marginTop: theme.space.sm }]}>
          <View style={styles.cmpCell}>
            <Text style={styles.cmpLabel}>对比{comparison.prevLabel}</Text>
            <Text style={styles.cmpVal}>{fmtVal(comparison.vsPrev)}</Text>
            <Text style={[styles.cmpMeta, { color: comparison.prevDelta.startsWith('▲') ? theme.colors.success : comparison.prevDelta.startsWith('▼') ? theme.colors.danger : theme.colors.textSub }]}>{comparison.prevDelta || '—'}</Text>
          </View>
          <View style={styles.cmpCell}>
            <Text style={styles.cmpLabel}>对比{comparison.baseLabel}</Text>
            <Text style={styles.cmpVal}>{fmtVal(comparison.vsBase)}</Text>
            <Text style={[styles.cmpMeta, { color: comparison.baseDelta.startsWith('▲') ? theme.colors.success : comparison.baseDelta.startsWith('▼') ? theme.colors.danger : theme.colors.textSub }]}>{comparison.baseDelta || '—'}</Text>
          </View>
        </View>

        {/* ★ v18.151：原来这里的「激素均值」三宫格 + 下面那段解读文案已整块删除（用户口径）。
            相关计算（buildEstrogenData / buildProgesteroneData / cortAvg）同步从 comparison 里移除，
            不再做无渲染消费的逐日皮质醇扫描。 */}
      </View>
    </ScreenContainer>
    </View>
  );
}

function firstNonNull(arr: (number | null)[]): number | null {
  for (const v of arr) if (v != null && Number.isFinite(v)) return v;
  return null;
}
function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && Number.isFinite(arr[i])) return arr[i]!;
  return null;
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { padding: theme.space.xs, marginRight: theme.space.sm },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  liveTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(111,207,180,0.16)',
  },
  liveText: { fontSize: theme.fontSize.micro, color: theme.colors.success, fontWeight: theme.weight.medium as any },
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroVal: { fontSize: 40, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  heroUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  delta: { fontSize: theme.fontSize.sm, marginLeft: 6 },
  up: { color: theme.colors.danger },
  down: { color: theme.colors.success },
  chartCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.cardPad,
  },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.md },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statGrid: { flexDirection: 'row', gap: 10 },
  statCell: {
    flex: 1,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  statValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginTop: 2 },

  // ★ v18.147 对比模块（StressWatch 范式：方块+数字）
  cmpHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: theme.space.lg, marginBottom: theme.space.xs },
  cmpTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },
  cmpSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  cmpGrid2: { flexDirection: 'row', gap: theme.space.sm },
  cmpCell: { flex: 1, backgroundColor: theme.colors.cardBg, borderColor: theme.colors.cardBorder, borderWidth: 1, borderRadius: theme.radius.md, padding: theme.space.sm },
  cmpLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 2 },
  cmpVal: { fontSize: 24, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },
  cmpMeta: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
});
