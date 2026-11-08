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
import React, { useMemo, useState, useEffect, useRef, useLayoutEffect, useDeferredValue } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, type LayoutChangeEvent, Easing } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line, Rect, G, Text as SvgText } from 'react-native-svg';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { previousPeriodLabel, baselineLabel } from '../lib/periodLabels';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import ChartTooltip from '../components/ChartTooltip';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import BackButton from '../components/BackButton';
import Card from '../components/Card';
import { useRingState } from '../hooks/useRingState';
import { type RangeKey } from '../data/metrics';
import { startOfWeek, addDays, formatDate } from '../lib/dateUtils';
import { timeTickLabel } from '../lib/chartAxis';
import { MOODS } from '../data/metrics';
import { curveLevel, CURVE_DEFAULTS } from '../lib/dailyStatus';
import { dayKey, healthStore } from '../data/healthStore';
import { computeCycle, parseDate, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { phaseBg, PHASE_COLOR, PHASE_LABEL, type PhaseKey } from '../lib/phaseColors';
import AxisLabels from '../components/charts/AxisLabels';
import { useHealthStoreVersion } from '../hooks/useHealthStore';


// ★ 2026-10-10（用户「按现在的 design token」）：图表高度挂 token —— 详情页主趋势 = L 档
//   （chart-size-unified-spec 规则 1）。日/周/月/年共用本图，天然等高；原裸写 const H = 240。
const H = chart.h.l;
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
/** 皮质醇异常图标色（单档）：红底白「!」，周视图顶部 + 图例共用。
 *  ★ 2026-10-10：token 化 —— 与全站异常色同源（chart.series.anomaly = #E2554E）。 */
const CORT_COLOR = chart.anomaly;

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

/* ─────────────────────────────────────────────────────────────
 * ★ 2026-11-07（用户）：今日状态周/月/年详情页 → 新增「状态分布 + 状态时段」两块分析，
 *   与身心压力详情页的 压力分布 / 压力时段（MetricDetailScreen.StressDistributionTimeCards）完全同构：
 *   ① 状态分布 —— 按天取当日状态分（statusDaily → timelineByDay 均值 → 今日实时兜底，与主曲线同一口径），
 *      归入 元气满满/状态良好/平平静静/休息一下 四档（curveLevel，阈值 76/51/26），
 *      统计有效天数与各档占比，纵向堆叠条。
 *   ② 状态时段 —— 天×小时 热力矩阵（每格取该小时出现最多的档位；数据源 ring.statusTimelineByDay），
 *      给出 元气满满 / 休息一下 的高发 3 小时频段；并附 HRV 极值（与压力时段同款）。
 *   空数据照样渲染骨架与占位，不整块消失（与压力分布同铁律）。
 * ───────────────────────────────────────────────────────────── */

/** 区间内每一天的 dayKey（week=7 天 / month=当月逐日 / year=全年逐日） */
function statusRangeDayKeys(anchor: Date, range: RangeKey): string[] {
  const keys: string[] = [];
  if (range === 'week') {
    const mon = startOfWeek(anchor);
    for (let i = 0; i < 7; i++) keys.push(dayKey(addDays(mon, i).getTime()));
  } else if (range === 'month') {
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) keys.push(dayKey(new Date(y, m, d).getTime()));
  } else {
    const y = anchor.getFullYear();
    for (let mo = 0; mo < 12; mo++) {
      const dim = new Date(y, mo + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) keys.push(dayKey(new Date(y, mo, d).getTime()));
    }
  }
  return keys;
}

function StatusDistributionTimeCards({ anchor, range, ring }: { anchor: Date; range: RangeKey; ring: any }) {
  const hsVer = useHealthStoreVersion();
  const C = MOODS.map((m) => m.color);
  const LABELS = MOODS.map((m) => m.label);
  const tierOf = (v: number): 0 | 1 | 2 | 3 => curveLevel(v, CURVE_DEFAULTS).index as 0 | 1 | 2 | 3;
  const todayK = dayKey(Date.now());

  /** 某天状态分（与主趋势图同一条 fallback 链：statusDaily → timelineByDay 均值 → 今日实时） */
  const dayMean = (dk: string): number | null => {
    const sd = (ring.statusDaily ?? {})[dk];
    if (sd != null && Number.isFinite(sd) && sd > 0) return sd;
    const tl = ring.statusTimelineByDay?.[dk];
    if (tl && tl.length > 0) {
      const vals = tl.map((p: any) => p.value).filter((v: any) => Number.isFinite(v) && v > 0);
      if (vals.length > 0) return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    }
    if (dk === todayK) {
      const rt = ring.statusTimeline ?? [];
      const vals = rt.map((p: any) => p.value).filter((v: any) => Number.isFinite(v) && v > 0);
      if (vals.length > 0) return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    }
    return null;
  };

  /** 某天逐点状态样本（fill 插值补点一律剔除，与全天曲线同口径） */
  const dayPoints = (dk: string): { t: number; v: number }[] => {
    let src: any[] | undefined = ring.statusTimelineByDay?.[dk];
    if ((!src || src.length === 0) && dk === todayK) src = ring.statusTimeline;
    if (!src) return [];
    return src
      .filter((p: any) => Number.isFinite(p?.value) && p.value > 0 && Number.isFinite(p?.t) && !(p as any).fill)
      .map((p: any) => ({ t: p.t as number, v: p.value as number }));
  };

  // ① 状态分布：按天统计各档天数
  const dist = useMemo(() => {
    const counts = [0, 0, 0, 0];
    let valid = 0;
    for (const dk of statusRangeDayKeys(anchor, range)) {
      const m = dayMean(dk);
      if (m == null) continue;
      counts[tierOf(m)] += 1;
      valid += 1;
    }
    return { counts, valid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, range, hsVer, ring.statusDaily, ring.statusTimelineByDay, ring.statusTimeline]);

  // ② 状态时段：天×小时 热力矩阵 + 元气/休息高发时段
  const time = useMemo(() => {
    const rows: { label: string; dks: string[] }[] = [];
    if (range === 'week') {
      const wd = ['日', '一', '二', '三', '四', '五', '六'];
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) { const d = addDays(mon, i); rows.push({ label: `周${wd[d.getDay()]}`, dks: [dayKey(d.getTime())] }); }
    } else if (range === 'month') {
      const y = anchor.getFullYear();
      const m = anchor.getMonth();
      const dim = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= dim; d++) rows.push({ label: `${d}`, dks: [dayKey(new Date(y, m, d).getTime())] });
    } else {
      const y = anchor.getFullYear();
      for (let mo = 0; mo < 12; mo++) {
        const dim = new Date(y, mo + 1, 0).getDate();
        const dks: string[] = [];
        for (let d = 1; d <= dim; d++) dks.push(dayKey(new Date(y, mo, d).getTime()));
        rows.push({ label: `${mo + 1}月`, dks });
      }
    }
    const rowHour: number[][][] = rows.map(() => Array.from({ length: 24 }, () => [0, 0, 0, 0]));
    let anyData = false;
    for (let r = 0; r < rows.length; r++) {
      for (const dk of rows[r].dks) {
        for (const p of dayPoints(dk)) {
          const h = new Date(p.t).getHours();
          rowHour[r][h][tierOf(p.v)] += 1;
          anyData = true;
        }
      }
    }
    const cell: (0 | 1 | 2 | 3 | null)[][] = rowHour.map((rh) =>
      rh.map((cnt) => {
        let mi = -1;
        let mv = 0;
        for (let i = 0; i < 4; i++) { if (cnt[i] > mv) { mv = cnt[i]; mi = i; } }
        return mv > 0 ? (mi as 0 | 1 | 2 | 3) : null;
      }),
    );
    // 3 小时频段：元气满满(idx0) / 休息一下(idx3) 最多时段
    const hourSum: number[][] = Array.from({ length: 24 }, (_, h) =>
      rows.reduce((acc, _row, r) => acc.map((x, i) => x + rowHour[r][h][i]), [0, 0, 0, 0]));
    let top = { start: 0, count: 0 };
    let rest = { start: 0, count: 0 };
    for (let h = 0; h < 24; h += 3) {
      let hi = 0;
      let lo = 0;
      for (let k = 0; k < 3; k++) { hi += hourSum[h + k][0]; lo += hourSum[h + k][3]; }
      if (hi > top.count) top = { start: h, count: hi };
      if (lo > rest.count) rest = { start: h, count: lo };
    }
    // HRV 极值（带时间戳）—— 与压力时段同款
    let hvMin = { v: Infinity, t: 0 };
    let hvMax = { v: -Infinity, t: 0 };
    for (const dk of statusRangeDayKeys(anchor, range)) {
      const pts = healthStore.getIntraday('hrv', dk);
      for (const p of pts) {
        if (typeof p.v !== 'number' || !Number.isFinite(p.v) || p.v <= 0) continue;
        if (p.v < hvMin.v) hvMin = { v: p.v, t: p.t };
        if (p.v > hvMax.v) hvMax = { v: p.v, t: p.t };
      }
    }
    return {
      rows, cell, anyData, top, rest,
      hvMin: hvMin.v < Infinity ? hvMin : null,
      hvMax: hvMax.v > -Infinity ? hvMax : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, range, hsVer, ring.statusTimelineByDay, ring.statusTimeline]);

  const fmtTs = (t: number) => {
    const d = new Date(t);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    // ★ 2026-11-07（用户）：外层裸 View 吃掉父级 gap → 两卡紧贴；补 gap 与其他卡间距统一
    <View style={{ gap: theme.space.md }}>
      {/* ① 状态分布 —— 空数据也渲染占位 */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>状态分布</Text>
        {dist.valid === 0 ? <Text style={stdStyles.note}>暂无状态样本 · 戒指同步后自动填充</Text> : null}
        <View style={stdStyles.distRow}>
          <View style={stdStyles.distLeft}>
            <View style={stdStyles.distBigRow}>
              <Text style={stdStyles.distBig}>{dist.valid}</Text>
              <Text style={stdStyles.distBigUnit}>有效天数</Text>
            </View>
            <View style={{ marginTop: theme.sp(2) }}>
              {LABELS.map((lab, i) => (
                <View key={i} style={stdStyles.legendItem}>
                  <View style={[stdStyles.legendDot, { backgroundColor: C[i] }]} />
                  <Text style={stdStyles.legendText}>{lab}</Text>
                  <Text style={stdStyles.legendVal}>{dist.valid > 0 ? `${dist.counts[i]}天 · ${Math.round((dist.counts[i] / dist.valid) * 100)}%` : '0天 · —'}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={stdStyles.barWrap}>
            <View style={stdStyles.bar}>
              {dist.valid > 0
                ? dist.counts.map((c, i) => (c > 0 ? <View key={i} style={[stdStyles.barSeg, { flex: c, backgroundColor: C[i] }]} /> : null))
                : <View style={[stdStyles.barSeg, { flex: 1, backgroundColor: theme.colors.cardBgSoft }]} />}
            </View>
          </View>
        </View>
      </View>

      {/* ② 状态时段 —— 空数据渲染热力网格骨架 + 占位 */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>状态时段</Text>
        {!time.anyData ? <Text style={stdStyles.note}>暂无逐小时状态样本 · 戒指同步后自动填充</Text> : null}
        <View>
          {time.rows.map((row, r) => (
            <View key={r} style={stdStyles.heatRow}>
              <Text style={stdStyles.heatRowLabel}>{row.label}</Text>
              <View style={stdStyles.heatCells}>
                {time.cell[r].map((lvl, h) => (
                  <View key={h} style={[stdStyles.heatCell, { backgroundColor: lvl == null ? theme.colors.cardBgSoft : C[lvl] }]} />
                ))}
              </View>
            </View>
          ))}
          <View style={stdStyles.heatRow}>
            <View style={stdStyles.heatRowLabel} />
            <View style={stdStyles.heatCells}>
              {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => (
                <Text key={h} style={stdStyles.heatXLabel}>{h}</Text>
              ))}
            </View>
          </View>
          <View style={stdStyles.timeSummary}>
            <View style={stdStyles.timeCol}>
              <Text style={stdStyles.timeColLab}>元气满满最多时段</Text>
              <Text style={stdStyles.timeColVal}>{time.anyData ? `${time.top.start}–${time.top.start + 3}时` : '—'}</Text>
              <Text style={stdStyles.timeColSub}>元气满满 {time.anyData ? time.top.count : 0} 次</Text>
            </View>
            <View style={stdStyles.timeCol}>
              <Text style={stdStyles.timeColLab}>休息一下最多时段</Text>
              <Text style={stdStyles.timeColVal}>{time.anyData ? `${time.rest.start}–${time.rest.start + 3}时` : '—'}</Text>
              <Text style={stdStyles.timeColSub}>休息一下 {time.anyData ? time.rest.count : 0} 次</Text>
            </View>
          </View>
          {time.hvMin && time.hvMax ? (
            <View style={stdStyles.hrvRow}>
              <Text style={stdStyles.hrvText}>最低 HRV：{Math.round(time.hvMin.v)} ms · {fmtTs(time.hvMin.t)}</Text>
              <Text style={stdStyles.hrvText}>最高 HRV：{Math.round(time.hvMax.v)} ms · {fmtTs(time.hvMax.t)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const stdStyles = StyleSheet.create({
  note: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(4) },
  distLeft: { flex: 1 },
  distBigRow: { flexDirection: 'row', alignItems: 'baseline' },
  distBig: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.bold as any, color: mm.colors.ink, lineHeight: 44 },
  distBigUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.sp(1.5) },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: theme.fontSize.sm, color: mm.colors.ink, width: 64 },
  legendVal: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  barWrap: { width: 30, height: 132, justifyContent: 'center' },
  bar: { width: 30, height: 132, borderRadius: 15, overflow: 'hidden', backgroundColor: theme.colors.cardBgSoft, flexDirection: 'column' },
  barSeg: { width: '100%' },
  heatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  heatRowLabel: { width: 36, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'right', paddingRight: 6 },
  heatCells: { flex: 1, flexDirection: 'row', gap: 2 },
  heatCell: { flex: 1, height: 9, borderRadius: 2 },
  heatXLabel: { flex: 1, fontSize: 9, color: theme.colors.textSub, textAlign: 'center' },
  timeSummary: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.sp(3) },
  timeCol: { flex: 1, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm, padding: theme.sp(2) },
  timeColLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  timeColVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginTop: 2 },
  timeColSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  hrvRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2) },
  hrvText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});

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
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const navigation = useNavigation<any>();
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  const [range, setRange] = useState<RangeKey>('day');
  // ★ B4（2026-10-08）：range 的「延迟版」—— chip 高亮即时，重计算/图表稍后跟上。
  const dRange = useDeferredValue(range);
  // ★ chart fade transition: 旧图层 fadeOut → 新图层 fadeIn
  const chartOpacity = useRef(new Animated.Value(1)).current;
  const [renderKey, setRenderKey] = useState(0); // 强制新图层 mount
  const prevRangeRef = useRef<RangeKey>('day');
  useEffect(() => {
    if (prevRangeRef.current === dRange) return;
    prevRangeRef.current = dRange;
    // fadeOut → 换 key → fadeIn（★ B4：180/320 → token quick/base，图表更快到位）
    Animated.sequence([
      Animated.timing(chartOpacity, { toValue: 0, duration: theme.motion.quick, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(chartOpacity, { toValue: 1, duration: theme.motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    setRenderKey((k) => k + 1);
  }, [dRange]);
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
  const { pts, axisLabels, fixedAxis, current, firstReal, avg, hasData } = useMemo(() => {
    const anchorKey = dayKey(anchor.getTime());  // ★ 补零格式

    if (dRange === 'day') {
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
          // ★ 与首页 TrendChart 同口径：剔除 `fill:true` 的插值补点 ——
          //   睡眠/断流期没有真实采样，healthStore 会补 fill 点；不过滤就会把空档连成曲线，
          //   看着像「睡眠期间也有状态数据」。真实点之外一律断线（缺口 = 空白）。
          .filter((p) => !(p as any).fill)
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
          // ★ 同首页口径：剔除插值补点（历史归档同样只画真实采样，缺口断线不补值）
          .filter((p) => !(p as any).fill)
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

    if (dRange === 'year') {
      const y = anchor.getFullYear();
      if (__DEV__) console.log('[STATUS-YEAR]', JSON.stringify({ year: y, statusDaily_all_keys: Object.keys(statusDaily ?? {}) }));
      const labels: string[] = [];
      const values: (number | null)[] = [];
      for (let mo = 0; mo < 12; mo++) {
        labels.push(timeTickLabel({ range: 'year', monthIndex: mo }));
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
      dRange, anchorKey,
      statusDaily_all: Object.fromEntries(
        Object.entries(statusDaily ?? {}).map(([k, v]) => [k, v?.toFixed(1) ?? null])
      ),
    }));
    const keys: string[] = [];
    const labels: string[] = [];
    if (dRange === 'week') {
      const mon = startOfWeek(anchor);   // ★ 自然周（周一~周日）：用户口径，之前的实现是对的
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(timeTickLabel({ range: 'week', weekday: d.getDay() }));
      }
    } else {
      const y = anchor.getFullYear();
      const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) {
        const d = new Date(y, m0, day);
        keys.push(dayKey(d.getTime()));  // ★ 用 dayKey() 补零格式
        labels.push(timeTickLabel({ range: 'month', dayOfMonth: day }));
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
    if (__DEV__ && dRange === 'week') {
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
  }, [dRange, ring.statusTimeline, ring.statusTimelineByDay, statusDaily, anchor, hsVer]);

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

  // ★ 性能修复（2026-10-28）：原先 chartOverlay 的 useMemo 依赖含 `pts`，
  //   实时数据一推送（pts 变化）就重跑月视图 31 次 computeCycle + 周视图皮质醇扫描，主线程被反复占满
  //   → 详情页进场 / 切月视图"卡一下"。现拆为两个独立 memo：
  //   - phaseBands（月视图相位带）：只依赖 range/anchor/cycle/temp，**不依赖实时 pts**；
  //   - cortIcons（周视图皮质醇）：只在周视图跑，y 对齐用 pts（7 天开销极小）。

  // 月视图：周期相位带 + 经前 PMS（不依赖实时 pts，range/anchor/cycleLog 变化时才算）
  const phaseBands = useMemo(() => {
    const bands: { x0: number; x1: number; phase: PhaseKey; pms: boolean }[] = [];
    if (w === 0 || dRange !== 'month') return bands;
    const y = anchor.getFullYear();
    const m0 = anchor.getMonth();
    const dim = new Date(y, m0 + 1, 0).getDate();
    const dayKeys: string[] = [];
    for (let d = 1; d <= dim; d++) dayKeys.push(dayKey(new Date(y, m0, d).getTime()));
    const n = dayKeys.length;
    if (n < 2) return bands;
    const edge = (frac: number) => PAD_L + Math.max(0, Math.min(1, frac)) * plotW;
    const leftOf = (i: number) => edge((i - 0.5) / (n - 1));
    const rightOf = (i: number) => edge((i + 0.5) / (n - 1));
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
    return bands;
  }, [w, plotW, dRange, anchor, ring.tempDaily, cycleLog]);

  // 周视图：皮质醇异常图标（y 对齐用 pts，仅在周视图跑；range/anchor 不变时只因 pts 微重算，7 天开销极小）
  const cortIcons = useMemo(() => {
    const cort: { x: number; y: number; i: number; mesor: number }[] = [];
    if (w === 0 || dRange !== 'week') return cort;
    const mon = startOfWeek(anchor);
    const dayKeys: string[] = [];
    for (let i = 0; i < 7; i++) dayKeys.push(dayKey(addDays(mon, i).getTime()));
    const n = dayKeys.length;
    if (n < 2) return cort;
    const edge = (frac: number) => PAD_L + Math.max(0, Math.min(1, frac)) * plotW;
    const xAt = (i: number) => edge(i / (n - 1));
    // ★ 与节律卡同口径：个人基线 = 被查看这一周之前 14 天的皮质醇日均值（不含本周，避免当天自身抬高阈值）
    const baseMeans: number[] = [];
    for (let i = 1; i <= CORT_BASELINE_DAYS; i++) {
      const m = cortisolDayMean(dayKey(addDays(mon, -i).getTime()));
      if (m != null) baseMeans.push(m);
    }
    const cortBaseN = baseMeans.length;
    const cortP75 = percentileOf(baseMeans.slice().sort((a, b) => a - b), CORT_ANOMALY_P);
    if (cortP75 != null) {
      for (let i = 0; i < n; i++) {
        const m = cortisolDayMean(dayKeys[i]);
        if (m == null || m <= cortP75) continue;   // 未超过个人 P75 → 不算异常
        const v = pts[i]?.value ?? null;
        const y = v != null ? yAt(v) : PAD_T + 6;
        cort.push({ x: xAt(i), y, i, mesor: m });
      }
    }
    if (__DEV__) {
      console.log('[STATUS-WEEK-CORT]', JSON.stringify({
        anchor: formatDate(anchor),
        baseDays: cortBaseN,
        p75: cortP75 != null ? Math.round(cortP75 * 10) / 10 : null,
        cortDays: cort.map((c) => ({ day: dayKeys[c.i], mesor: Math.round(c.mesor) })),
        note: cort.length === 0 ? '本周无 cortisol 样本 / 基线不足 4 天 / 日均值均未超个人 P75 → 不标图标（数据侧，非渲染 bug）' : '',
      }));
    }
    return cort;
  }, [w, plotW, dRange, anchor, pts]);

  // ★ 2026-11-03：hero delta 改走 comparison.prevDelta（统一「较昨日/上周/上个月/去年」口径），
  //   原「较区间首点」的 deltaPct / firstReal 计算随之删除。

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
    // ★ 2026-11-03：标签统一走 lib/periodLabels —— 昨日/上周/上个月/去年 全 App 唯一口径
    let prevLabel = previousPeriodLabel(dRange);
    let baseLabel = baselineLabel(dRange);
    if (dRange === 'day') {
      const dk = dayKey(anchor.getTime());
      units = [{ label: '今日', value: valOf(dk) }];
      curKeys = [dk];
    } else if (dRange === 'week') {
      const mon = startOfWeek(anchor);
      for (let i = 0; i < 7; i++) { const d = addDays(mon, i); curKeys.push(dayKey(d.getTime())); units.push({ label: fmtD(d), value: valOf(dayKey(d.getTime())) }); }
    } else if (dRange === 'month') {
      const y = anchor.getFullYear(); const m0 = anchor.getMonth();
      const dim = new Date(y, m0 + 1, 0).getDate();
      for (let day = 1; day <= dim; day++) { const d = new Date(y, m0, day); curKeys.push(dayKey(d.getTime())); units.push({ label: `${day}`, value: valOf(dayKey(d.getTime())) }); }
    } else {
      const y = anchor.getFullYear();
      for (let mo = 0; mo < 12; mo++) units.push({ label: `${mo + 1}月`, value: monthMean(statusDaily, y, mo) });
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
    if (dRange === 'day') {
      const y = new Date(anchor); y.setDate(y.getDate() - 1); prevKeys = [dayKey(y.getTime())];
      for (let i = 1; i <= 7; i++) { const d = new Date(anchor); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    } else if (dRange === 'week') {
      const mon = startOfWeek(anchor); const s = new Date(mon); s.setDate(s.getDate() - 7);
      for (let i = 0; i < 7; i++) prevKeys.push(dayKey(addDays(s, i).getTime()));
      for (let i = 1; i <= 30; i++) { const d = new Date(mon); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    } else if (dRange === 'month') {
      const end = new Date(anchor.getFullYear(), anchor.getMonth(), 0);
      const s = new Date(end); s.setDate(s.getDate() - (curKeys.length - 1));
      for (let i = 0; i < curKeys.length; i++) prevKeys.push(dayKey(addDays(s, i).getTime()));
      const ms = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      for (let i = 1; i <= 30; i++) { const d = new Date(ms); d.setDate(d.getDate() - i); baseKeys.push(dayKey(d.getTime())); }
    }

    let vsPrev: number | null = null;
    let vsBase: number | null = null;
    if (dRange === 'year') {
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
      showBestWorst: dRange !== 'day',
    };
  }, [dRange, anchor, statusDaily, ring, avg, hsVer]);

  // ★ 2026-11-03：hero 卡解读文字（数据锚定 + 人话 + 诚实口径，与第十轮 AI 文案铁律一致）。
  //   依赖 comparison（best/worst/prevDelta），必须放在 comparison memo 之后。
  const heroAnalysis = useMemo(() => {
    if (!hasData || avg == null) return null;
    const lvl = curveLevel(avg, CURVE_DEFAULTS);
    const mLabel = MOODS[lvl.index]?.label ?? '平平静静';
    if (dRange === 'day') {
      const good = lvl.index <= 1;
      return `今天状态平均 ${Math.round(avg)} 分、当前 ${fmtVal(current)} 分，处在「${mLabel}」档——${good ? '趁状态好，把难的事往前推' : '节奏放缓一点，别硬撑'}。`;
    }
    const b = comparison.best;
    const wst = comparison.worst;
    const bw = b && wst && b.label !== wst.label ? `，${b.label}最好（${fmtVal(b.value)} 分）、${wst.label}最低（${fmtVal(wst.value)} 分）` : '';
    const trend = !comparison.prevDelta
      ? '上一期还没有足够数据对照'
      : comparison.prevDelta.startsWith('▲')
        ? `较${comparison.prevLabel}有所回升`
        : `较${comparison.prevLabel}有所回落`;
    return `这段状态平均 ${Math.round(avg)} 分${bw}；${trend}，${lvl.index <= 1 ? '整体节奏在线' : '给恢复多留点空间'}。`;
  }, [hasData, avg, current, dRange, comparison, hsVer]);

  // ★ 2026-11-05：X 轴标签统一交给 AxisLabels（只渲染可见项 + 比例定位 + 边界 clamp）。
  //   旧 renderAxis 用 space-between 排「每点一个 Text」，月/年视图密槽时标签互相压住、
  //   末标签贴右缘被裁，已废弃。

  return (
    <View style={{ flex: 1 }}>
      {/* v16：全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.bgTop}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.headText}>
            <Text style={styles.title}>全天状态趋势</Text>
          </View>
          {/* ★ 2026-11-05（用户）：详情页右上角不显示「真实数据 / 实时」徽标 */}
        </View>

        {/* 日 / 周 / 月 / 年 切换 */}
        <RangeSwitch value={range} onChange={setRange} />

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={dRange} />

        {/* ★ 2026-10-10（用户 10-09 硬性要求，此前本页漏改）：总体数据卡移到时间选择器**下方**，
              切换上方不再放大数字 —— 与脑力/心理压力等详情页统一（切换 → 选择器 → 数据卡 → 图表） */}
        <Card padded={false}>
          <View style={styles.pad}>
            {/* ★ 2026-11-05（用户·统一）：顶部数据卡补标题，随区间变化 */}
            <Text style={styles.heroCardTitle}>{dRange === 'day' ? '今日状态' : dRange === 'week' ? '本周状态' : dRange === 'month' ? '本月状态' : '本年状态'}</Text>
            <View style={styles.hero}>
              <Text style={styles.heroVal}>{fmtVal(current)}</Text>
              <Text style={styles.heroUnit}>/ 100</Text>
              {/* ★ 2026-11-03（用户「对比口径不统一」）：「较区间首点」→ 统一「较昨日/上周/上个月/去年」
                  （previousPeriodLabel，与 MetricDetail / BpDetail 同一 lib 出口）；▲绿▼红 = 活力语义（升=好） */}
              {hasData && comparison.prevDelta ? (
                <Text style={[styles.delta, comparison.prevDelta.startsWith('▲') ? styles.up : styles.down]}>
                  {comparison.prevDelta} · 较{comparison.prevLabel}
                </Text>
              ) : null}
            </View>
            {/* ★ 2026-11-03（用户「整个分析没按统一格式」）：hero 卡内补解读文字 ——
                与 MetricDetail 同款「大数字 + 一句数据锚定的人话解读」结构 */}
            {heroAnalysis ? <Text style={styles.heroAnalysis}>{heroAnalysis}</Text> : null}
          </View>
        </Card>

        {/* 趋势图 */}
        <View style={styles.chartCard}>
          {/* ★ 2026-11-05（用户·统一）：趋势图卡补标题 */}
          <Text style={styles.chartTitle}>全天状态曲线</Text>
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
              <Animated.View key={renderKey} style={{ opacity: chartOpacity }}>
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
                {dRange === 'month'
                  ? phaseBands.map((b, i) => {
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
                              <SvgText x={x + wClip - 5} y={PAD_T + 17} fontSize={chart.axisFont} fontWeight="600" fill={PMS_COLOR} textAnchor="end">
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
                              fontSize={chart.axisFont}
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
                      strokeWidth={chart.lw.grid}
                    />
                    <SvgText
                      x={PAD_L - 7}
                      y={yAt(gv) + 3.2}
                      fontSize={chart.axisFont}
                      fill={theme.colors.textSub}
                      textAnchor="end"
                    >
                      {String(gv)}
                    </SvgText>
                  </G>
                ))}
                {/* 纵轴轴线 */}
                <Line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={theme.colors.ui.borderSoft} strokeWidth={chart.lw.grid} />

                {areaD ? <Path d={areaD} fill="url(#std_grad)" /> : null}
                {/* ★ 主折线：与首页「全天状态趋势」同款 —— 等级色横向渐变描边 2.5pt，
                    线本身随等级变色。不再压白底粗线、也不再统一单色。
                    ★ 2026-10-21（用户）：去掉逐点实心圆（散点），趋势图只留线，等级色靠线条渐变表达。
                       dots 数组仍保留，仅供点击 tooltip 命中检测（见下方 onLayout 触摸逻辑）。 */}
                {lineD ? (
                  <Path d={lineD} fill="none" stroke="url(#std_line)" strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
                ) : null}

                {/* ★ 周视图：皮质醇异常图标（单档，红底白「!」），虚线连到当天的数据点 */}
                {dRange === 'week'
                  ? cortIcons.map((c, i) => {
                      const topY = PAD_T + 8;
                      return (
                        <G key={`cort-${i}`}>
                          <Line x1={c.x} y1={topY + 8} x2={c.x} y2={c.y} stroke={CORT_COLOR} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} opacity={0.65} />
                          <Circle cx={c.x} cy={topY} r={8} fill={CORT_COLOR} />
                          <SvgText x={c.x} y={topY + 3.5} fontSize={11} fontWeight="700" fill="#FFFFFF" textAnchor="middle">{'!'}</SvgText>
                        </G>
                      );
                    })
                  : null}
              </Svg>
              </Animated.View>
            ) : null}
            {/* ★ tooltip：点击显示磨砂玻璃详情框（统一组件） */}
            <ChartTooltip tip={tip} w={w} H={H} />
          </View>

          {/* 无数据占位（诚实） */}
          {!hasData ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {dRange === 'day'
                  ? '今日状态曲线尚未生成，佩戴戒指并打开数据同步后将实时记录'
                  : '当前范围内暂无数据，佩戴并同步后将逐日累积'}
              </Text>
            </View>
          ) : null}

          {/* X 轴标签 ★ 2026-11-05：不再被遮挡 / 裁切 */}
          <AxisLabels
            labels={axisLabels}
            mode={fixedAxis || axisLabels.length <= 8 ? 'edge' : 'slot'}
            padLeft={PAD_L}
            padRight={PAD_R}
          />

          {/* ★ 图表图例：等级色（日/周/月/年通用，散点颜色）+ 周期相位·经前PMS（月）+ 皮质醇异常（周） */}
          <View style={styles.legendRow}>
            {LEVEL_LEGEND.map((l) => (
              <View key={l.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: l.color }]} />
                <Text style={styles.legendText}>{l.label}</Text>
              </View>
            ))}
          </View>

          {dRange === 'month' ? (
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

          {dRange === 'week' ? (
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: CORT_COLOR }]} />
                <Text style={styles.legendText}>皮质醇异常</Text>
              </View>
            </View>
          ) : null}

        </View>

        {/* ★ 2026-11-07（用户）：今日状态周/月/年详情页 → 状态分布 + 状态时段 两块分析
            （与身心压力详情页的 压力分布/压力时段 同构；日视图不加，保持全天曲线专注） */}
        {dRange !== 'day' ? <StatusDistributionTimeCards anchor={anchor} range={dRange} ring={ring} /> : null}

        {/* ★ 详细分析（StressWatch 范式：方块+数字，不写长段文字）
            口径（v18.153 用户定的顺序）：**第一排 = 平均 / 最高 / 最低**，
            再 状态最好 / 状态最差，最后 对比上期 / 对比基线。
            （前两版把统计值沉到中间/最底，用户逐次纠正后定稿为「统计值在最上」。）
            ★ 2026-11-05（用户·统一）：整段包进 Card，与其他模块分析卡一致。 */}
        <Card padded={false}>
          <View style={styles.pad}>
            <View style={styles.cmpHead}>
              <Text style={styles.cmpTitle}>详细分析</Text>
              <Text style={styles.cmpSub}>{dRange === 'day' ? '今日' : dRange === 'week' ? '本周' : dRange === 'month' ? '本月' : '本年'}</Text>
            </View>

        {/* ★ 2026-11-03（用户）：平均/最高/最低三卡条已全 App 删除（与 MetricDetail 同口径），统计语义由下方 状态最好/最差 + 对比 承担 */}

        {comparison.showBestWorst && (
          <View style={[styles.cmpGrid2, { marginTop: theme.space.sm }]}>
            <View style={styles.cmpCell}>
              <Text style={styles.cmpLabel}>状态最好</Text>
              {/* ★ 数值必须过 fmtVal：best/worst 直接来自 statusDaily / timeline 日均，
                  未格式化时会出现 68.42857142857143 这种一串小数（用户实测）。 */}
              <Text style={[styles.cmpVal, { color: theme.colors.ui.status.good }]}>{fmtVal(comparison.best ? comparison.best.value : null)}</Text>
              <Text style={styles.cmpMeta}>{comparison.best ? comparison.best.label : '暂无数据'}</Text>
            </View>
            <View style={styles.cmpCell}>
              <Text style={styles.cmpLabel}>状态最差</Text>
              <Text style={[styles.cmpVal, { color: theme.colors.ui.status.danger }]}>{fmtVal(comparison.worst ? comparison.worst.value : null)}</Text>
              <Text style={styles.cmpMeta}>{comparison.worst ? comparison.worst.label : '暂无数据'}</Text>
            </View>
          </View>
        )}

        <View style={[styles.cmpGrid2, { marginTop: theme.space.sm }]}>
          <View style={styles.cmpCell}>
            <Text style={styles.cmpLabel}>对比{comparison.prevLabel}</Text>
            <Text style={styles.cmpVal}>{fmtVal(comparison.vsPrev)}</Text>
            <Text style={[styles.cmpMeta, { color: comparison.prevDelta.startsWith('▲') ? theme.colors.ui.status.good : comparison.prevDelta.startsWith('▼') ? theme.colors.ui.status.danger : theme.colors.textSub }]}>{comparison.prevDelta || '—'}</Text>
          </View>
          <View style={styles.cmpCell}>
            <Text style={styles.cmpLabel}>对比{comparison.baseLabel}</Text>
            <Text style={styles.cmpVal}>{fmtVal(comparison.vsBase)}</Text>
            <Text style={[styles.cmpMeta, { color: comparison.baseDelta.startsWith('▲') ? theme.colors.ui.status.good : comparison.baseDelta.startsWith('▼') ? theme.colors.ui.status.danger : theme.colors.textSub }]}>{comparison.baseDelta || '—'}</Text>
          </View>
        </View>
          </View>
        </Card>

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
  pad: { padding: theme.space.cardPad },
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
  liveText: { fontSize: theme.fontSize.micro, color: theme.colors.ui.status.good, fontWeight: theme.weight.medium as any },
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  heroUnit: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  delta: { fontSize: theme.fontSize.sm, marginLeft: 6 },
  // ★ 2026-11-03：状态指数是「活力」语义——升=好=绿、降=注意=红（原 up 红/down 绿是心率类指标的语义，装反了）
  up: { color: theme.colors.ui.status.good },
  down: { color: theme.colors.ui.status.danger },
  // ★ 2026-11-03：hero 卡内解读文字（与 MetricDetail heroAnalysis 同款层级）
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(2) },
  // ★ 2026-11-05（用户·统一）：顶部数据卡标题
  heroCardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginBottom: theme.sp(1) },
  // ★ 2026-11-05（用户·统一）：趋势图卡标题
  chartTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginBottom: theme.sp(1) },
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
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs, paddingLeft: 34, paddingRight: 14 },
  axisText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: theme.space.sm },
  moreHint: { alignItems: 'center', justifyContent: 'center', marginTop: theme.space.md, gap: 2 },
  moreHintText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
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
  // ★ 2026-11-05（用户·统一）：现处 Card 内，去掉额外的顶部大间距
  cmpHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 0, marginBottom: theme.space.xs },
  cmpTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },
  cmpSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  cmpGrid2: { flexDirection: 'row', gap: theme.space.sm },
  cmpCell: { flex: 1, backgroundColor: theme.colors.cardBg, borderColor: theme.colors.cardBorder, borderWidth: 1, borderRadius: theme.radius.md, padding: theme.space.sm },
  cmpLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 2 },
  cmpVal: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: mm.colors.ink },
  cmpMeta: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
});
