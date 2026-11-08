/**
 * HealthAgeDetailScreen —— 身体年龄详情页（月 / 年）
 *
 * ★ 2026-10-10（用户）：按 docs/body-age-detail-preview.html 设计稿实现。
 *   · 去掉 Hero 弧，进入即显示月/年趋势
 *   · RangeSwitch exclude=['day','week'] → 只留月/年
 *   · DateAnchorPicker 时间选择器
 *   · 数值卡（与 SleepRecoveryHero 同源）：大数字 + 较实际年龄差
 *   · 趋势折线图（黄绿 lime + 实际年龄虚线参考）
 *   · 对比卡（身体年龄 vs 实际年龄 + 影响因素贡献条）
 *
 * 数据来源：逐日复用 estimateHealthAge（actualAge + overallScore + 荷尔蒙节律）。
 *   月视图：当月每天一个身体年龄值；年视图：每月一个均值。
 */
import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import BackButton from '../components/BackButton';
import Card from '../components/Card';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { estimateHealthAge } from '../lib/healthAgeEstimate';
import { computeCurrentHealthAge, computeHormonalHealthyCurrent } from '../lib/healthAgeCurrent';
import { analyzeCortisol, type CortisolSample } from '../lib/cortisolRhythm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { computeStressReport } from '../lib/stressAlgorithm';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { getLatestExamRecord } from '../data/examStore';
import { userStore, getCachedSession } from '../data/userStore';
import { RingBle } from '../ble/RingBleManager';
import { type RangeKey } from '../data/metrics';
import { timeTickLabel } from '../lib/chartAxis';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

/**
 * ★ 2026-10-10（用户）：实际年龄改为 state + useFocusEffect 加载（见下方组件），与洞察页同口径：
 *   优先体检记录 record.inputs.age，fallback 戒指档案 getUserProfile()?.age。
 *   旧实现只用 getUserProfile()?.age 且强制整数 → 体检记录里的年龄在详情页取不到 → 完全没有数据。
 */

/**
 * ★ 2026-10-10（用户·续）：身体年龄口径统一为「与洞察页完全一致」。
 *   - 荷尔蒙节律（皮质醇是否健康）是慢变量，按「当日」判定一次（computeHormonalHealthy），
 *     对区间内每一天复用同一结论；这样只要有综合分就有身体年龄 → 趋势不再大片为空。
 *   - 综合分 = 100 - loadScore*0.6 / 100 - emotionalLoad*0.5 / 睡眠分，与洞察页 overallScoreFromReport 同公式。
 *   - computeHealthAgeNow 复刻洞察页 bodyAgeInsight 的「当日」口径（ring.daily.sleepScore + 无参报告 + 今日皮质醇），
 *     保证详情页头条 = 洞察页「年轻 X 岁」。
 */
/**
 * ★ v18.134：荷尔蒙判定**统一复用** src/lib/healthAgeCurrent 的共享实现，
 *   不再在本文件里维护第二份副本（原副本与共享实现漂移，且没有 hasHormonalData 出口）。
 */

/** 逐日身体年龄：综合分用当日报告，荷尔蒙健康复用「当日」结论（hormonalHealthy） */
function computeHealthAgeForDay(
  dk: string,
  actualAge: number,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
): number | null {
  try {
    const dkMs = parseDayKey(dk);
    const nowMs = reportNowMsForDay(dkMs);
    const scores: number[] = [];
    const sleep = healthStore.getSleep(dk);
    if (sleep?.score != null && Number.isFinite(sleep.score) && sleep.score >= 0 && sleep.score <= 100) {
      scores.push(sleep.score);
    }
    const fatigue = computeCognitiveLoadReport(nowMs);
    if (fatigue?.sampleCount > 0 && fatigue.loadScore != null && Number.isFinite(fatigue.loadScore)) {
      scores.push(Math.max(0, Math.min(100, 100 - fatigue.loadScore * 0.6)));
    }
    const stress = computeStressReport(nowMs);
    if (stress?.sampleCount > 0 && stress.emotionalLoad != null && Number.isFinite(stress.emotionalLoad)) {
      scores.push(Math.max(0, Math.min(100, 100 - stress.emotionalLoad * 0.5)));
    }
    if (scores.length === 0) return null;
    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    // ★ v18.134：hasHormonalData 不再硬编码 true —— 基础版无皮质醇实测时走中性 ±1.5
    return estimateHealthAge(actualAge, overallScore, hormonalHealthy, hasHormonalData);
  } catch (e) {
    console.warn('[HealthAgeDetail] 逐日身体年龄计算异常：', dk, e);
    return null;
  }
}

function monthSeries(
  anchor: Date,
  actualAge: number,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
): { val: number | null }[] {
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const out: { val: number | null }[] = [];
  for (let d = 1; d <= days; d++) {
    const dk = dayKey(new Date(y, m, d).getTime());
    out.push({ val: computeHealthAgeForDay(dk, actualAge, hormonalHealthy, hasHormonalData) });
  }
  return out;
}

function yearSeries(
  anchor: Date,
  actualAge: number,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
): { val: number | null }[] {
  const y = anchor.getFullYear();
  const out: { val: number | null }[] = [];
  for (let mo = 0; mo < 12; mo++) {
    const days = new Date(y, mo + 1, 0).getDate();
    const vals: number[] = [];
    for (let d = 1; d <= days; d++) {
      const dk = dayKey(new Date(y, mo, d).getTime());
      const v = computeHealthAgeForDay(dk, actualAge, hormonalHealthy, hasHormonalData);
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    out.push({ val: vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null });
  }
  return out;
}

/**
 * ★ P0-3（2026-10-28）：衰老速度（对标 WHOOP Pace of Aging）。
 *   取最近 180 天逐日身体年龄，做**普通最小二乘（OLS）线性拟合**得到斜率（岁/年）。
 *   以「实际年龄老化速度 = 1 岁/年」为基准：
 *     · slope < 0        → 逆转（身体年龄在下移，越活越年轻）
 *     · 0 ≤ slope ≤ 1    → 平稳（接近实际老化速度）
 *     · slope > 1        → 加速（比实际年龄老得还快）
 *   另给「近 30 天均值」vs「长期基线均值（180 天）」对照，直观显示近期是否改善。
 *   参考：WHOOP Healthspan「Pace of Aging」= 近 30 天相对 6 个月 WHOOP Age 的投影速度（-1x~3x）。
 *   口径：数据不足（有效天 <30）返回 null，不展示，避免噪声。
 */
function agingPaceSeries(
  actualAge: number,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
  days = 180,
): number[] {
  const out: number[] = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const dk = dayKey(now - i * 86400000);
    const v = computeHealthAgeForDay(dk, actualAge, hormonalHealthy, hasHormonalData);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function computeAgingPace(actualAge: number, hormonalHealthy: boolean, hasHormonalData: boolean): {
  slopePerYear: number | null;
  paceX: number | null;
  band: 'reversing' | 'steady' | 'accelerating' | null;
  recentMean: number | null;
  baselineMean: number | null;
  enough: boolean;
} {
  const series = agingPaceSeries(actualAge, hormonalHealthy, hasHormonalData, 180);
  if (series.length < 30) {
    return { slopePerYear: null, paceX: null, band: null, recentMean: null, baselineMean: null, enough: false };
  }
  const n = series.length;
  // OLS 斜率：以「天序号」为自变量，岁为因变量 → 再换算成 岁/年
  const xs = series.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = series.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (series[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slopePerDay = sxx > 1e-9 ? sxy / sxx : 0;
  const slopePerYear = slopePerDay * 365;
  const paceX = Math.round(slopePerYear * 100) / 100; // 以 1 岁/年为基准
  const band: 'reversing' | 'steady' | 'accelerating' =
    slopePerYear < 0 ? 'reversing' : slopePerYear <= 1 ? 'steady' : 'accelerating';
  const recentMean = Math.round(series.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, series.length) * 10) / 10;
  const baselineMean = Math.round(my * 10) / 10;
  return { slopePerYear: Math.round(slopePerYear * 100) / 100, paceX, band, recentMean, baselineMean, enough: true };
}

function computeFactors(dk: string) {
  const factors: { name: string; contribution: number; pct: number }[] = [];
  const sleep = healthStore.getSleep(dk);
  if (sleep?.score != null) {
    factors.push({ name: '睡眠恢复', contribution: Math.round((sleep.score - 65) / 20 * 10) / 10, pct: Math.max(5, Math.min(100, (sleep.score / 100) * 100)) });
  } else {
    factors.push({ name: '睡眠恢复', contribution: 0, pct: 0 });
  }
  const hrvArr = healthStore.getIntraday('hrv', dk).filter((p: any) => typeof p.v === 'number' && p.v > 0);
  if (hrvArr.length > 0) {
    const avg = hrvArr.reduce((a: number, b: any) => a + b.v, 0) / hrvArr.length;
    factors.push({ name: '运动心肺', contribution: Math.round((avg - 40) / 40 * 10) / 10, pct: Math.max(5, Math.min(100, ((avg - 20) / 60) * 100)) });
  } else {
    factors.push({ name: '运动心肺', contribution: 0, pct: 0 });
  }
  const stressArr = healthStore.getIntraday('stress', dk).filter((p: any) => typeof p.v === 'number' && p.v > 0);
  if (stressArr.length > 0) {
    const avg = stressArr.reduce((a: number, b: any) => a + b.v, 0) / stressArr.length;
    factors.push({ name: '代谢', contribution: Math.round((50 - avg) / 50 * 10) / 10, pct: Math.max(5, Math.min(100, (1 - avg / 100) * 100)) });
  } else {
    factors.push({ name: '代谢', contribution: 0, pct: 0 });
  }
  const cortisolRaw = healthStore.getIntraday('cortisol', dk).filter((p: any) => typeof p.v === 'number' && p.v > 0);
  if (cortisolRaw.length >= 4) {
    const samples: CortisolSample[] = cortisolRaw.map((p: any, i: number) => ({ t: Number.isFinite(p.t) ? p.t : i * 3600 * 1000, v: p.v }));
    const a = analyzeCortisol(samples);
    const level = (a as any)?.status?.level ?? 'normal';
    factors.push({ name: '节律压力', contribution: level === 'normal' ? -0.3 : level === 'sustained_high' ? 0.3 : 0.5, pct: Math.max(5, Math.min(100, level === 'normal' ? 80 : 30)) });
  } else {
    factors.push({ name: '节律压力', contribution: 0, pct: 0 });
  }
  return factors;
}

function TrendChart({ data, actualAge, isMonth }: { data: { val: number | null }[]; actualAge: number | null; isMonth: boolean }) {
  const W = 320, H = 240;
  const PAD_L = 28, PAD_R = 14, PAD_T = 18, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xAt = (i: number) => PAD_L + (data.length <= 1 ? plotW / 2 : plotW * i / (data.length - 1));

  // ★ 2026-10-10（用户・七改）：横轴与其他图表统一 —— 走 chartAxis.timeTickLabel，
  //   月 = 1/5/10/15/20/25/30（仅已发生的天），年 = 1月/3月/5月/7月/9月/11月。不再自编刻度。
  const axis: string[] = data.map((_, i) =>
    isMonth
      ? timeTickLabel({ range: 'month', dayOfMonth: i + 1 })
      : timeTickLabel({ range: 'year', monthIndex: i }),
  );

  const vals = data.map((d) => d.val).filter((v): v is number => v != null && Number.isFinite(v));

  // ★ 2026-10-10（用户・七改）：纵轴改为「差值」—— 0 = 实际年龄；低于 0 = 年轻（绿），高于 0 = 偏高（红粉）。
  //   不写具体年龄，只标差值；空态仍画占位 + 实际年龄参考线（标签写「实际年龄」）。
  const deltas: number[] = actualAge != null
    ? data.map((d) => (d.val != null && Number.isFinite(d.val) ? d.val - actualAge : NaN)).filter((v) => Number.isFinite(v))
    : [];
  if (vals.length < 2 || actualAge == null || deltas.length < 2) {
    const base = actualAge != null ? actualAge : 30;
    const yMin = Math.floor(base - 4), yMax = Math.ceil(base + 4);
    const rangeE = Math.max(yMax - yMin, 4);
    const yAtE = (v: number) => PAD_T + plotH * (1 - (v - yMin) / rangeE);
    const gridsE: number[] = [];
    for (let g = yMin; g <= yMax; g++) gridsE.push(g);
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {gridsE.map((g, i) => {
            const y = yAtE(g);
            const isRef = actualAge != null && g === Math.round(actualAge);
            return (
              <React.Fragment key={i}>
                <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={theme.colors.ui.white05} strokeWidth={1} />
                {isRef && (
                  <SvgText x={W - PAD_R} y={y - 4} fontSize={9} fill={theme.colors.textSub} textAnchor="end">{'实际年龄'}</SvgText>
                )}
              </React.Fragment>
            );
          })}
          {actualAge != null && (
            <Line x1={PAD_L} y1={yAtE(actualAge)} x2={W - PAD_R} y2={yAtE(actualAge)} stroke={theme.colors.ui.white25} strokeWidth={1.3} strokeDasharray="5 4" />
          )}
        </Svg>
        <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, backgroundColor: 'transparent', paddingHorizontal: theme.sp(2) }}>
          暂无数据 · 连续佩戴后可见趋势
        </Text>
      </View>
    );
  }

  const minD = Math.min(...deltas, 0), maxD = Math.max(...deltas, 0);
  // 0（实际年龄）必须落在量程内，两侧各留 >=2 余量
  const yMin = Math.min(Math.floor(minD - 1.5), -2);
  const yMax = Math.max(Math.ceil(maxD + 1.5), 2);
  const rangeY = Math.max(yMax - yMin, 4);
  const yAt = (dv: number) => PAD_T + plotH * (1 - (dv - yMin) / rangeY);

  const GREEN = mm.colors.limeMid;   // 低 / 年轻 = 绿
  const PINK = mm.colors.roseDeep;   // 高 / 偏高 = 红粉
  const GRAY = theme.colors.textSub; // 贴近实际年龄 = 中性
  const segColor = (dv: number) => (dv < -0.05 ? GREEN : dv > 0.05 ? PINK : GRAY);

  const step = rangeY <= 8 ? 1 : rangeY <= 16 ? 2 : 5;
  const grids: number[] = [];
  for (let g = yMin; g <= yMax; g += step) grids.push(g);

  // 分段着色折线：相邻两点都有效才连线，颜色按两点平均差值归属（绿=年轻 / 粉=偏高）
  const segs: { d: string; c: string }[] = [];
  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i].val, b = data[i + 1].val;
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const da = a - actualAge!, db = b - actualAge!;
    segs.push({
      d: `M${xAt(i).toFixed(1)} ${yAt(da).toFixed(1)} L${xAt(i + 1).toFixed(1)} ${yAt(db).toFixed(1)}`,
      c: segColor((da + db) / 2),
    });
  }

  let lastIdx = -1;
  for (let i = data.length - 1; i >= 0; i--) { if (data[i].val != null) { lastIdx = i; break; } }
  let lastDot: { x: number; y: number; c: string } | null = null;
  if (lastIdx >= 0 && data[lastIdx].val != null) {
    const dv = data[lastIdx].val! - actualAge!;
    lastDot = { x: xAt(lastIdx), y: yAt(dv), c: segColor(dv) };
  }

  const xLabels: { x: number; text: string }[] = [];
  axis.forEach((t, i) => { if (t) xLabels.push({ x: xAt(i), text: t }); });

  return (
    <Svg width="100%" height={H} viewBox={'0 0 ' + W + ' ' + H}>
      {grids.map((g, i) => {
        const y = yAt(g);
        const isRef = g === 0;
        return (
          <React.Fragment key={i}>
            <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={theme.colors.ui.white05} strokeWidth={1} />
            {isRef ? (
              <SvgText x={W - PAD_R} y={y - 4} fontSize={9} fill={theme.colors.textSub} textAnchor="end">{'实际年龄'}</SvgText>
            ) : (
              <SvgText x={PAD_L - 4} y={y + 3} fontSize={9} fill={theme.colors.textSub} textAnchor="end">{g > 0 ? '+' + g : String(g)}</SvgText>
            )}
          </React.Fragment>
        );
      })}
      {/* 实际年龄参考线（差值 0 位） */}
      <Line x1={PAD_L} y1={yAt(0)} x2={W - PAD_R} y2={yAt(0)} stroke={theme.colors.ui.white25} strokeWidth={1.3} strokeDasharray="5 4" />
      {segs.map((s, i) => (
        <Path key={i} d={s.d} fill="none" stroke={s.c} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {lastDot && (
        <>
          <Circle cx={lastDot.x} cy={lastDot.y} r={4} fill={lastDot.c} />
          <Circle cx={lastDot.x - 1.4} cy={lastDot.y - 1.4} r={1.6} fill="rgba(255,255,255,0.6)" />
        </>
      )}
      {xLabels.map((l, i) => (
        <SvgText key={i} x={l.x} y={H - 8} fontSize={9} fill={theme.colors.textSub} textAnchor="middle">{l.text}</SvgText>
      ))}
    </Svg>
  );
}

function CompareCard({ bodyAge, actualAge, factors, isMonth }: { bodyAge: number | null; actualAge: number | null; factors: { name: string; contribution: number; pct: number }[]; isMonth: boolean }) {
  return (
    <Card style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>{isMonth ? '与实际年龄对比' : '年度变化'}</Text>
      </View>
      {/* ★ 2026-10-10（九改・用户）：
          (a) 两个绝对值必须写出来 —— 「身体年龄 29.8 岁」「实际年龄 35.0 岁」，标签在上、数值在下，
              左右两列各占一半，不做 numberOfLines 截断，杜绝「只剩 岁 看不到数字」。
          (b) 删掉「年轻 5.5 岁」胶囊 —— 顶部 Hero 已写「5.5 岁 较实际年龄低」，此处不再重复。 */}
      <View style={styles.cmpGrid}>
        <View style={styles.cmpCol}>
          <Text style={styles.cmpLab}>身体年龄</Text>
          <View style={styles.cmpValRow}>
            <Text style={[styles.cmpNum, { color: mm.colors.limeCore }]}>
              {bodyAge != null ? bodyAge.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cmpUnit}>岁</Text>
          </View>
        </View>
        <View style={[styles.cmpCol, { alignItems: 'flex-end' }]}>
          <Text style={styles.cmpLab}>实际年龄</Text>
          <View style={styles.cmpValRow}>
            <Text style={[styles.cmpNum, { color: mm.colors.ink }]}>
              {actualAge != null ? actualAge.toFixed(1) : '—'}
            </Text>
            <Text style={styles.cmpUnit}>岁</Text>
          </View>
        </View>
      </View>
      <Text style={styles.factorTitle}>{isMonth ? '影响因素贡献（岁）' : '年度主要改善因素'}</Text>
      {factors.map((f, i) => (
        <View key={i} style={styles.factor}>
          <Text style={styles.factorName}>{f.name}</Text>
          <View style={styles.factorTrack}>
            <View style={[styles.factorBar, { width: `${Math.max(0, Math.min(100, f.pct))}%` }]} />
          </View>
          <Text style={[styles.factorVal, { color: mm.colors.limeCore }]}>
            {f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(1)}
          </Text>
        </View>
      ))}
      <Text style={styles.cmpNote}>身体年龄 = 实际年龄 + 活力调整；综合睡眠恢复 / 运动心肺 / 代谢 / 节律压力估算，仅作健康参考，非医学诊断。</Text>
    </Card>
  );
}

export default function HealthAgeDetailScreen() {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<RangeKey>('month');
  const [anchor, setAnchor] = useState(new Date());
  // ★ 2026-10-10（用户）：实际年龄与洞察页同口径——优先体检记录，fallback 戒指档案。
  //   旧实现只用 getUserProfile()?.age 且强制整数，体检记录里的年龄在详情页取不到 → 完全没有数据。
  // ★ 2026-10-28（用户·修「先空状态后数据」闪烁）：actualAge 同步从戒指档案初始化（getUserProfile 同步可读），
  //   首帧即有值（有档案年龄时不再闪空状态）；体检记录为异步，仅用于覆盖/细化。
  // ★ 2026-11-07（用户）：与洞察页同口径补上「首次登录 Onboarding 已录入的年龄」。
  //   这枚 LunaMira 从未下发过身体档案，只读 getUserProfile() 会让详情页也拿不到年龄。
  const clampAge = (a: unknown): number | null => {
    const n = typeof a === 'number' ? a : typeof a === 'string' ? Number(a) : NaN;
    return Number.isFinite(n) && n >= 18 && n <= 120 ? Math.round(n) : null;
  };
  const [actualAge, setActualAge] = useState<number | null>(() =>
    clampAge(RingBle.getUserProfile()?.age) ?? clampAge(getCachedSession()?.profile?.age),
  );
  useFocusEffect(useCallback(() => {
    let active = true;
    const devAge = RingBle.getUserProfile()?.age;
    const profileAge = getCachedSession()?.profile?.age;
    setActualAge(clampAge(devAge) ?? clampAge(profileAge));
    Promise.all([
      getLatestExamRecord().catch(() => null),
      userStore.loadSession().catch(() => null),
    ]).then(([record, session]) => {
      if (!active) return;
      const value = record?.inputs.age ?? session?.profile?.age ?? devAge ?? profileAge;
      setActualAge(clampAge(value));
    }).catch(() => { /* 记录不可用时保留已读到的档案年龄 */ });
    return () => { active = false; };
  }, []));

  // ★ 荷尔蒙节律（慢变量）按「当日」判定一次，区间内逐日复用 → 有综合分即出身体年龄
  // ★ v18.134（审查 04 🟡-5）：皮质醇入库后荷尔蒙判定要能重算（原来 deps 为空，永不刷新）
  const hormonalNow = useMemo(() => computeHormonalHealthyCurrent(dayKey(Date.now())), [hsVer]);
  const hormonalHealthyNow = hormonalNow.hormonalHealthy;
  const hasHormonalDataNow = hormonalNow.hasHormonalData;
  const series = useMemo(() => {
    if (actualAge == null) return [];
    return range === 'month'
      ? monthSeries(anchor, actualAge, hormonalHealthyNow, hasHormonalDataNow)
      : yearSeries(anchor, actualAge, hormonalHealthyNow, hasHormonalDataNow);
  }, [range, anchor, actualAge, hormonalHealthyNow, hasHormonalDataNow, hsVer]);

  // ★ 头条 = 当日身体年龄（与洞察页 bodyAgeInsight 完全同口径）→ 数值一致
  // ★ 2026-10-28：头条用共享实时计算（与洞察页身体年龄卡完全一致 → 两页数字连通），去掉本地重算分支
  const currentBodyAge = actualAge != null ? computeCurrentHealthAge(actualAge)?.healthAge ?? null : null;
  const validVals = series.map((d) => d.val).filter((v): v is number => v != null && Number.isFinite(v));
  const avgBodyAge = validVals.length > 0 ? Math.round(validVals.reduce((a, b) => a + b, 0) / validVals.length * 10) / 10 : null;
  // ★ 2026-10-10（用户）：Hero 只讲差值 → 用 currentBodyAge 优先、缺失回退区间均值（有图就有数）
  const headline = currentBodyAge ?? avgBodyAge;
  const delta = headline != null && actualAge != null ? headline - actualAge : null;

  const todayDk = dayKey(Date.now());
  const factors = useMemo(() => computeFactors(todayDk), [todayDk, hsVer]);

  // ★ P0-3（2026-10-28）：衰老速度（对标 WHOOP Pace of Aging）—— 近 180 天 OLS 斜率，以 1 岁/年为基准
  const pace = useMemo(() => {
    if (actualAge == null) return null;
    return computeAgingPace(actualAge, hormonalHealthyNow, hasHormonalDataNow);
  }, [actualAge, hormonalHealthyNow, hasHormonalDataNow, hsVer]);

  return (
    <ScreenContainer compactTop withGradient>
      {/* ★ 2026-10-10（九改・用户）：返回头对齐其他详情页（睡眠恢复 / 脑力·昼夜节律 / 情绪）。
          原实现三处不一致：① 返回 icon 外面套了圆形底框+描边（别页没有）；
          ② 标题用 fontSize.card + semibold（别页统一 h2 + medium）；
          ③ header/scrollContent 又叠了一层 sp(4) 左右内边距，而 ScreenContainer 内层已有 space.screen(sp(6))
          → 整页比别的详情页内缩一圈，看着「窄一块」。现全部对齐。 */}
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>身体年龄</Text>
          <Text style={styles.headerSub}>活力调整 · 睡眠 / 运动 / 代谢 / 节律</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <RangeSwitch value={range} onChange={setRange} exclude={['day', 'week']} />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* ★ 2026-10-10（用户・六改）：Hero 不再显示 29.6（身体年龄绝对值）与「身体年龄·当前」标签，
            只讲差值 —— 大数字 = 较实际年龄的差（5.4）+ 岁，右侧绿字「较实际年龄低」（贴着数字右边，不再悬到卡片最右）。
            绝对值 29.6 / 35.0 一律挪到下方「与实际年龄对比」卡里（身体年龄 XX岁 / 实际年龄 XX岁）。 */}
        <Card style={styles.heroCard}>
          <Text style={styles.heroTitle}>身体年龄</Text>
          {delta != null ? (
            Math.abs(delta) < 0.05 ? (
              <Text style={styles.heroCompare}>与实际年龄相近</Text>
            ) : (
              <View style={styles.heroNumRow}>
                <Text style={styles.heroNum}>{Math.abs(delta).toFixed(1)}</Text>
                <Text style={styles.heroUnit}>岁</Text>
                <Text style={styles.heroCompare}>
                  {delta < 0 ? '较实际年龄低' : '较实际年龄高'}
                </Text>
              </View>
            )
          ) : (
            <View style={styles.heroNumRow}>
              <Text style={styles.heroNum}>—</Text>
              <Text style={[styles.heroCompare, { color: theme.colors.textSub }]}>
                {'数据加载中…'}
              </Text>
            </View>
          )}
          <Text style={styles.heroAnalysis}>
            {(() => {
              if (delta == null) return '身体年龄趋势将在这里展示。';
              const d = Math.abs(delta);
              if (d < 0.05) return '身体年龄与实际年龄基本一致。';
              if (delta < 0) return `身体年龄比实际年龄小 ${d.toFixed(1)} 岁，近期恢复和状态不错。`;
              return `身体年龄比实际年龄大 ${d.toFixed(1)} 岁，近期可以多些恢复和睡眠。`;
            })()}
          </Text>
        </Card>

        {/* 年龄已在首次登录时录入，无需额外「填写身体成分」引导 */}

        <Card style={styles.panel}>
          <View style={styles.panelHead}>
            <Text style={styles.panelTitle}>身体年龄趋势</Text>
            <Text style={styles.panelMeta}>{range === 'month' ? '近 30 天 · 单位 岁' : '近 12 个月 · 单位 岁'}</Text>
          </View>
          <TrendChart data={series} actualAge={actualAge} isMonth={range === 'month'} />
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: mm.colors.limeMid }]} />
              <Text style={styles.legendText}>年轻（低于实际）</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: mm.colors.roseDeep }]} />
              <Text style={styles.legendText}>偏高（高于实际）</Text>
            </View>
            <View style={styles.legendItem}>
              {/* ★ 2026-10-10：原来用 borderStyle:'dashed' 画虚线段，iOS 会报
                  「Unsupported dashed / dotted border style」警示条；改用三段实心小段拼出虚线，零告警。 */}
              <View style={styles.legendDashes}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.legendDashSeg, { backgroundColor: theme.colors.ui.scrimSoft }]} />
                ))}
              </View>
              <Text style={styles.legendText}>实际年龄{actualAge != null ? ' ' + actualAge : ''}</Text>
            </View>
          </View>
          {avgBodyAge != null && (
            <Text style={styles.trendMean}>区间均值 {avgBodyAge.toFixed(1)} 岁</Text>
          )}
        </Card>

        {/* ★ 2026-10-10（用户）：CompareCard 的身体年龄改用 headline（当前身体年龄 ?? 区间均值），
            与 Hero 大数字同源——避免「当日 computeHealthAgeNow 返回 null（只有月均）时，
            CompareCard 身体年龄显示 — 而 Hero 有数」的不一致（用户实锤两处对不上）。
            实际年龄仍由 actualAge 驱动，未填身体成分时为 —（引导卡已提示去填）。 */}
        <CompareCard bodyAge={headline} actualAge={actualAge} factors={factors} isMonth={range === 'month'} />

        {/* ★ P0-3（2026-10-28）：衰老速度卡 —— 置于身体年龄详情页内（对比卡之后），对标 WHOOP Pace of Aging */}
        {pace && pace.enough && pace.slopePerYear != null && (
          <PaceCard pace={pace} />
        )}

        <View style={{ height: theme.sp(6) }} />
      </ScrollView>
    </ScreenContainer>
  );
}

/** ★ P0-3（2026-10-28）：衰老速度卡 —— 对标 WHOOP Pace of Aging（-1x~3x） */
function PaceCard({ pace }: { pace: NonNullable<ReturnType<typeof computeAgingPace>> }) {
  const band = pace.band;
  const bandText = band === 'reversing' ? '逆转 · 在变年轻' : band === 'steady' ? '平稳' : '加速 · 偏快';
  const bandColor = band === 'reversing' ? mm.colors.limeCore : band === 'steady' ? theme.colors.textSub : mm.colors.roseDeep;
  const slopeTxt = pace.slopePerYear != null
    ? (pace.slopePerYear >= 0 ? '+' : '') + pace.slopePerYear.toFixed(2)
    : '—';
  return (
    <Card style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>衰老速度</Text>
        <Text style={[styles.paceBand, { color: bandColor }]}>{bandText}</Text>
      </View>
      <View style={styles.paceHero}>
        <Text style={[styles.paceNum, { color: bandColor }]}>{slopeTxt}</Text>
        <Text style={styles.paceUnit}>岁 / 年</Text>
      </View>
      <Text style={styles.paceDesc}>
        以「实际年龄老化 = 1 岁/年」为基准。近 30 天身体年龄均值 {pace.recentMean ?? '—'} 岁，长期基线 {pace.baselineMean ?? '—'} 岁。
        {band === 'reversing' ? '近期趋势下移，身体年龄在下降。' : band === 'steady' ? '近期趋势接近实际老化速度。' : '近期趋势上移，老得比实际年龄还快。'}
      </Text>
      <Text style={styles.cmpNote}>
        算法：近 180 天逐日身体年龄做最小二乘（OLS）线性拟合，斜率换算为岁/年（对标 WHOOP Pace of Aging 的近 30 天相对 6 个月投影速度）。仅作健康参考，非医学诊断。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  // ★ 2026-10-10（九改）：与 EmotionCognitiveDetailScreen / SleepDetailScreen 的 head 完全同构
  //   head = row/center + marginTop sm；back = 9×9 纯点击区（无底框）；title = h2 + medium；副标题 body。
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.sm,
    marginBottom: theme.space.md,
  },
  backBtn: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -theme.sp(2),
  },
  headerText: {
    flex: 1,
    marginLeft: theme.sp(1),
  },
  headerTitle: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium as any,
    color: mm.colors.ink,
  },
  headerSub: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
  },
  scrollContent: {
    paddingBottom: theme.sp(8),
  },
  heroCard: {
    alignItems: 'flex-start',
    paddingVertical: theme.sp(4),
    paddingHorizontal: theme.sp(4),
    marginBottom: theme.sp(3),
  },
  examCta: {
    alignItems: 'stretch',
    marginBottom: theme.sp(3),
  },
  examCtaIcon: {
    width: 40, height: 40, borderRadius: theme.radius.md,
    backgroundColor: mm.colors.limeSoft, alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.sp(2),
  },
  examCtaTitle: {
    fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  examCtaText: {
    fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 18,
    marginBottom: theme.sp(3),
  },
  examCtaBtn: {
    borderRadius: theme.radius.sm, overflow: 'hidden',
  },
  examCtaBtnGrad: {
    minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingVertical: theme.sp(1.25),
  },
  examCtaBtnText: {
    fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad,
  },
  heroNumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  heroNum: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    letterSpacing: -1.5,
    lineHeight: 50,
    color: mm.colors.ink,
  },
  heroUnit: {
    fontSize: theme.fontSize.body,
    fontWeight: '400',
    color: theme.colors.textSub,
    marginLeft: 4,
    marginBottom: 6,
  },
  // ★ 2026-10-10（用户・六改）：Hero 右侧绿字「较实际年龄低」，紧贴大数字右边，与数字基线对齐
  heroCompare: {
    fontSize: theme.fontSize.body,
    fontWeight: '600',
    color: mm.colors.limeCore,
    marginLeft: 10,
    marginBottom: 9,
  },
  /* ★ 2026-11-03（用户·统一 hero 结构）：数字上方 title + 数字下方短 AI 分析 */
  heroTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginBottom: theme.sp(1) },
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(2) },
  panel: {
    padding: theme.sp(4),
    marginBottom: theme.sp(3),
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(1),
  },
  panelTitle: {
    fontSize: theme.fontSize.body,
    fontWeight: '600' as any,
    color: mm.colors.ink,
  },
  panelMeta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  // ★ 2026-10-10（八改）：三项图例原来一行排不下，「实际年龄」那项被挤出屏幕右侧（只剩虚线看不到字）。
  //   改为可换行：放不下时自动折到第二行，保证「实际年龄」标识始终可见。
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 6,
    marginTop: theme.sp(1.5),
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  legendLine: {
    width: 20,
    height: 2.4,
    borderRadius: 2,
  },
  legendDashes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    width: 20,
  },
  legendDashSeg: {
    width: 4,
    height: 2.4,
    borderRadius: 1,
  },
  legendText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
  },
  trendMean: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(1.5),
  },
  // ★ 2026-10-10（九改）：左右两列（各 flex:1），列内「标签在上、数值在下」，两个绝对值都写全
  cmpGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.sp(1.5),
    marginBottom: theme.sp(1),
  },
  cmpCol: {
    flex: 1,
    flexDirection: 'column',
  },
  cmpValRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  cmpLab: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  // ★ 2026-10-10（十改・根因）：这里原来写的是 `lineHeight: 1.04`——RN 的 lineHeight 是**绝对 px**，
  // 不是倍数！30px 字号配1.04px 行高 → 行盒被压成一条缝，数字被裁得只剩一个像素 → 手机上「29.9」彻底看不见，
  // 只剩旁边 13px 的「岁」有行高照常显示，于是每张对比卡都成了「只有岁没有数」。
  cmpNum: {
    fontSize: theme.fontSize.stat,
    fontWeight: '300',
    letterSpacing: -1,
    lineHeight: 36,
  },
  cmpUnit: {
    fontSize: theme.fontSize.xs,
    fontWeight: '400',
    color: theme.colors.textSub,
    marginLeft: 2,
    marginBottom: 4,
  },
  factorTitle: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginVertical: theme.sp(2),
  },
  factor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: theme.sp(1.5),
  },
  factorName: {
    width: 64,
    fontSize: theme.fontSize.xs,
    color: mm.colors.ink,
    flexShrink: 0,
  },
  factorTrack: {
    flex: 1,
    height: 12,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  factorBar: {
    height: '100%',
    backgroundColor: mm.colors.limeCore,
    borderRadius: theme.radius.pill,
  },
  factorVal: {
    width: 42,
    textAlign: 'right',
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    flexShrink: 0,
  },
  cmpNote: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(2.5),
    lineHeight: 17,
  },
  // ★ P0-3：衰老速度卡样式
  paceBand: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
  },
  paceHero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.sp(1),
    marginBottom: theme.sp(1),
  },
  paceNum: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    letterSpacing: -1.5,
    lineHeight: 48,
  },
  paceUnit: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginLeft: 6,
  },
  paceDesc: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.ink,
    lineHeight: 19,
    marginTop: theme.sp(1),
  },
});
