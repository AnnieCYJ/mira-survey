/**
 * HormoneEstrogenCard —— 雌激素建模曲线（周期和激素 tab 下的独立卡片）
 *
 * 数据说明（不造假）：戒指硬件无法测量雌激素/LH，此曲线是依据「用户真实记录的经期数据」
 *（上次经期开始日 + 周期长度 + 体温确认的排卵日）对当前周期激素背景的建模估算。
 * 用于帮助理解周期阶段，非实测值。
 *
 * 日/周/月：展示当前周期完整建模曲线，并用虚线标出今天所在位置。
 * 年：展示按真实周期模型回推/外推的近 365 天雌激素指数走势，帮助观察全年节律。
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Rect, Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import {
  computeCycle,
  dayKey,
  parseDate,
  modelEstrogenCurve,
  estrogenAt,
  estrogenForDate,
  type CycleLog,
} from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { RingBle, type FemaleInfo, type RingState } from '../ble/RingBleManager';
import type { RangeKey } from '../data/metrics';

const W = 680;
const H = 210;
const PAD_L = 12;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 26;
const Y_MAX = 100;

const PHASE_BG: Record<string, string> = {
  period: 'rgba(224,123,107,0.16)',
  follicular: 'rgba(124,106,224,0.10)',
  ovulation: 'rgba(111,207,180,0.20)',
  luteal: 'rgba(157,138,240,0.13)',
  unknown: 'rgba(138,138,168,0.05)',
};

const PHASE_LABEL: Record<string, string> = {
  period: '经期',
  follicular: '卵泡期',
  ovulation: '排卵期',
  luteal: '黄体期',
};

const LEGEND = [
  { key: 'follicular', label: '卵泡期', color: 'rgba(124,106,224,0.55)' },
  { key: 'ovulation', label: '排卵期', color: 'rgba(111,207,180,0.85)' },
  { key: 'luteal', label: '黄体期', color: 'rgba(157,138,240,0.7)' },
  { key: 'period', label: '经期', color: 'rgba(224,123,107,0.7)' },
];

interface Props {
  ring: RingState;
  female: FemaleInfo | null;
  range: RangeKey;
  onPress?: () => void;
}

function buildYearSeries(log: CycleLog | null): { date: Date; value: number | null; phase: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pts: { date: Date; value: number | null; phase: string }[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const info = computeCycle(log, d, { tempSeries: [], periodHistory: log?.history });
    pts.push({ date: d, value: estrogenForDate(log, d), phase: info.phase });
  }
  return pts;
}

export default function HormoneEstrogenCard({ ring, female, range, onPress }: Props) {
  const [localLog, setLocalLog] = useState<CycleLog | null>(null);

  useEffect(() => {
    void loadCycleLog().then((l) => setLocalLog(l));
  }, []);

  // effective log：本地 log ∪ 戒指 female，取 lastPeriodStart 更晚的那条
  const ringLog: CycleLog | null =
    female && female.menstrualCircle > 0 && female.lastMenstrualDate
      ? {
          lastPeriodStart: female.lastMenstrualDate,
          cycleLength: female.menstrualCircle,
          lutealLength: 14,
          periodLength: female.menstrualDays || 5,
        }
      : null;
  const effective: CycleLog | null = (() => {
    if (!localLog && !ringLog) return null;
    if (!ringLog) return localLog;
    if (!localLog) return ringLog;
    return parseDate(ringLog.lastPeriodStart).getTime() >= parseDate(localLog.lastPeriodStart).getTime()
      ? ringLog
      : localLog;
  })();

  // ⚠️ React 规则：所有 hooks 必须在任何 early return 之前调用。
  // 旧版 if (!effective) return ... 在两个 useMemo 之前，首次渲染 effective=null 跳过 hook，
  // 第二次渲染 loadCycleLog 完成后 effective 变非 null 又调了 hook，触发
  // "Rendered more hooks than during the previous render" 红屏。
  // 修复：把 hooks 全部提前；effective 为 null 时 useMemo 返回空数组供 render 安全降级。
  const isYear = range === 'year';
  const cycleLen = Math.max(20, Math.min(45, Math.round(effective?.cycleLength || 28)));
  const luteal = Math.max(9, Math.min(20, Math.round(effective?.lutealLength || 14)));
  const periodLen = Math.max(2, Math.min(10, Math.round(effective?.periodLength || 5)));
  const ovulationDay = cycleLen - luteal;

  // 当前周期日：优先用权威 curveStatus（与首页一致），回退到 computeCycle
  const cs = RingBle.getState().curveStatus;
  const dayInCycle =
    effective && cs && cs.hasLog && cs.dayInCycle != null
      ? cs.dayInCycle
      : computeCycle(effective, new Date()).dayInCycle;
  const currentPhase = effective && dayInCycle != null ? computeCycle(effective, new Date()).phase : 'unknown';

  // 当前周期曲线（日/周/月共用）
  const curve = useMemo(
    () =>
      effective
        ? modelEstrogenCurve({ cycleLength: cycleLen, ovulationDay, periodLength: periodLen })
        : [],
    [effective, cycleLen, ovulationDay, periodLen]
  );
  const currentValue = estrogenAt(curve, dayInCycle);

  // 年度曲线：365 天 modeled 序列
  const yearSeries = useMemo(() => (effective ? buildYearSeries(effective) : []), [effective]);

  if (!effective) {
    return (
      <TouchableOpacity activeOpacity={onPress ? 0.92 : 1} onPress={onPress} disabled={!onPress}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>雌激素曲线（周期建模）</Text>
          <Text style={styles.emptyText}>
            记录上次经期开始日后，这里会画出雌激素随周期的估算曲线：经期低位、排卵期前冲到峰值、黄体期小幅回落。戒指暂未直接测量雌激素，曲线为建模估算。
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // 绘图数据源
  const series = isYear ? yearSeries : curve;
  const step = plotW / (series.length - 1 || 1);
  const xAt = (i: number) => PAD_L + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
  const yAt = (v: number) => PAD_T + (1 - Math.max(0, Math.min(Y_MAX, v)) / Y_MAX) * plotH;

  // path
  let d = '';
  let area = '';
  if (!isYear) {
    const c = curve;
    d = `M ${xAt(0).toFixed(1)} ${yAt(c[0].value).toFixed(1)}`;
    for (let i = 1; i < c.length; i++) {
      d += ` L ${xAt(i).toFixed(1)} ${yAt(c[i].value).toFixed(1)}`;
    }
    area = `${d} L ${xAt(c.length - 1).toFixed(1)} ${PAD_T + plotH} L ${xAt(0).toFixed(1)} ${PAD_T + plotH} Z`;
  } else {
    const yBottom = PAD_T + plotH;
    const pts = yearSeries;
    const validIdx = pts.map((p, i) => (p.value != null ? i : -1)).filter((i) => i >= 0);
    if (validIdx.length > 0) {
      d = `M ${xAt(validIdx[0]).toFixed(1)} ${yAt(pts[validIdx[0]].value!).toFixed(1)}`;
      for (let i = 1; i < validIdx.length; i++) {
        d += ` L ${xAt(validIdx[i]).toFixed(1)} ${yAt(pts[validIdx[i]].value!).toFixed(1)}`;
      }
      area = `${d} L ${xAt(validIdx[validIdx.length - 1]).toFixed(1)} ${yBottom} L ${xAt(validIdx[0]).toFixed(1)} ${yBottom} Z`;
    }
  }

  const markerX = !isYear && dayInCycle != null ? xAt(dayInCycle - 1) : null;
  const yearMarkerIndex = isYear ? yearSeries.findIndex((p) => dayKey(p.date) === dayKey(new Date())) : -1;
  const yearMarkerX = isYear && yearMarkerIndex >= 0 ? xAt(yearMarkerIndex) : null;
  const yearCurrentValue = yearMarkerIndex >= 0 ? yearSeries[yearMarkerIndex].value : null;

  // 读数文案
  const readout = (() => {
    if (!isYear) {
      return `${dayInCycle != null ? `周期第 ${dayInCycle} 天` : '记录经期后显示'}${
        currentValue != null ? ` · 雌激素指数 ${currentValue}` : ''
      }${currentPhase && PHASE_LABEL[currentPhase] ? ` · ${PHASE_LABEL[currentPhase]}` : ''}`;
    }
    const valid = yearSeries.filter((p) => p.value != null).map((p) => p.value as number);
    const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    return `近一年雌激素均值约 ${avg ?? '—'} · 基于当前周期模型估算 · 当前周期第 ${dayInCycle ?? '—'} 天`;
  })();

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.92 : 1} onPress={onPress} disabled={!onPress}>
      <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>雌激素曲线（周期建模）</Text>
        <Text style={styles.sub}>建模估算 · 非实测</Text>
      </View>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* 阶段背景带 */}
        {!isYear ? (
          curve.map((p, i) => (
            <Rect
              key={`bg-${p.day}`}
              x={xAt(i) - step / 2}
              y={PAD_T}
              width={step}
              height={plotH}
              fill={PHASE_BG[p.phase] ?? PHASE_BG.unknown}
            />
          ))
        ) : (
          yearSeries.map((p, i) => (
            <Rect
              key={`bg-y-${i}`}
              x={xAt(i) - step / 2}
              y={PAD_T}
              width={step}
              height={plotH}
              fill={PHASE_BG[p.phase] ?? PHASE_BG.unknown}
            />
          ))
        )}
        {/* 网格线 0 / 50 / 100 */}
        {[0, 50, 100].map((gv) => (
          <Line
            key={`g-${gv}`}
            x1={PAD_L}
            y1={yAt(gv)}
            x2={W - PAD_R}
            y2={yAt(gv)}
            stroke={theme.colors.ui.borderSoft}
            strokeWidth={1}
          />
        ))}
        {/* 面积 + 曲线 */}
        {area ? <Path d={area} fill="rgba(233,128,168,0.16)" /> : null}
        {d ? <Path d={d} fill="none" stroke="#e980a8" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {/* 当前日标记 */}
        {markerX != null && currentValue != null && (
          <>
            <Line x1={markerX} y1={PAD_T} x2={markerX} y2={PAD_T + plotH} stroke={theme.colors.textTitle} strokeWidth={1.4} strokeDasharray="4 3" />
            <Circle cx={markerX} cy={yAt(currentValue)} r={5.5} fill="#e980a8" stroke="#fff" strokeWidth={2.4} />
            <SvgText x={Math.min(W - PAD_R - 2, Math.max(PAD_L + 2, markerX))} y={yAt(currentValue) - 12} textAnchor="middle" fontSize={12} fontWeight="700" fill={theme.colors.textTitle}>
              {currentValue}
            </SvgText>
          </>
        )}
        {yearMarkerX != null && yearCurrentValue != null && (
          <>
            <Line x1={yearMarkerX} y1={PAD_T} x2={yearMarkerX} y2={PAD_T + plotH} stroke={theme.colors.textTitle} strokeWidth={1.4} strokeDasharray="4 3" />
            <Circle cx={yearMarkerX} cy={yAt(yearCurrentValue)} r={5.5} fill="#e980a8" stroke="#fff" strokeWidth={2.4} />
          </>
        )}
        {/* 关键日标注 */}
        {!isYear ? (
          <>
            <SvgText x={xAt(0) + 2} y={H - 8} fontSize={10} fill={theme.colors.textSub}>{`第1天`}</SvgText>
            <SvgText x={xAt(ovulationDay - 1)} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="middle">{`排卵`}</SvgText>
            <SvgText x={xAt(curve.length - 1)} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="end">{`第${curve.length}天`}</SvgText>
          </>
        ) : (
          <>
            <SvgText x={xAt(0) + 2} y={H - 8} fontSize={10} fill={theme.colors.textSub}>{`${yearSeries[0]?.date.getMonth() + 1}月`}</SvgText>
            <SvgText x={W / 2} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="middle">{`近一年走势`}</SvgText>
            <SvgText x={xAt(yearSeries.length - 1)} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="end">{`${yearSeries[yearSeries.length - 1]?.date.getMonth() + 1}月`}</SvgText>
          </>
        )}
      </Svg>

      {/* 当前读数 */}
      <View style={styles.readout}>
        <Text style={styles.readoutText}>{readout}</Text>
      </View>

      <Text style={styles.disclaimer}>
        戒指暂未直接测量雌激素，曲线依据你记录的经期日期与周期长度，按标准月经周期激素动力学建模，用于帮助理解当前阶段背景，非实测值。
      </Text>

      <View style={styles.legend}>
        {LEGEND.map((l) => (
          <View key={l.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  title: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  readout: { marginTop: 4 },
  readoutText: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle, fontWeight: theme.weight.medium as any },
  disclaimer: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: 6,
    lineHeight: theme.fontSize.micro * 1.6,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 2 },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: 5 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  empty: { paddingVertical: 26, alignItems: 'center', paddingHorizontal: 22, backgroundColor: theme.colors.cardBg, borderColor: theme.colors.cardBorder, borderWidth: 1, borderRadius: theme.radius.card, marginTop: theme.space.sm },
  emptyTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: 8 },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center', lineHeight: 21 },
});
