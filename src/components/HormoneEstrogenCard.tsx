/**
 * HormoneEstrogenCard —— 雌激素建模曲线（周期和激素 tab 下的独立卡片）
 *
 * 数据说明（不造假）：戒指硬件无法测量雌激素/LH，此曲线是依据「标准月经周期激素动力学」
 * 对当前所处阶段大致激素背景的建模估算（非实测值），用于帮助用户理解周期阶段。
 * 曲线形状随真实记录（上次经期 + 周期长度 + 黄体期）与体温确认的排卵日动态生成。
 *
 * 与 CyclePhaseCard 同源：同样用 effective log（本地 cycleLog ∪ 戒指 female，取更晚一条）
 * + computeCycle + modelEstrogenCurve。当前周期日取自 RingState.curveStatus.dayInCycle。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import {
  computeCycle,
  dayKey,
  parseDate,
  tempDailyToSeries,
  modelEstrogenCurve,
  estrogenAt,
  type CycleLog,
} from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { RingBle, type FemaleInfo, type RingState } from '../ble/RingBleManager';

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

export default function HormoneEstrogenCard({
  ring,
  female,
}: {
  ring: RingState;
  female: FemaleInfo | null;
}) {
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

  if (!effective) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>雌激素曲线（周期建模）</Text>
        <Text style={styles.emptyText}>
          记录上次经期开始日后，这里会画出雌激素随周期的估算曲线：经期低位、排卵期前冲到峰值、黄体期小幅回落。戒指暂未直接测量雌激素，曲线为建模估算。
        </Text>
      </View>
    );
  }

  const cycleLen = Math.max(20, Math.min(45, Math.round(effective.cycleLength || 28)));
  const luteal = Math.max(9, Math.min(20, Math.round(effective.lutealLength || 14)));
  const periodLen = Math.max(2, Math.min(10, Math.round(effective.periodLength || 5)));
  const ovulationDay = cycleLen - luteal;

  const curve = modelEstrogenCurve({ cycleLength: cycleLen, ovulationDay, periodLength: periodLen });

  // 当前周期日：优先用权威 curveStatus（与首页一致），回退到 computeCycle
  const cs = RingBle.getState().curveStatus;
  const dayInCycle =
    cs && cs.hasLog && cs.dayInCycle != null ? cs.dayInCycle : computeCycle(effective, new Date()).dayInCycle;
  const currentValue = estrogenAt(curve, dayInCycle);
  const currentPhase =
    dayInCycle != null ? curve.find((p) => p.day === dayInCycle)?.phase ?? null : null;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const step = plotW / (curve.length - 1);
  const xAt = (day: number) => PAD_L + ((day - 1) / (curve.length - 1)) * plotW;
  const yAt = (v: number) => PAD_T + (1 - Math.max(0, Math.min(Y_MAX, v)) / Y_MAX) * plotH;

  // 曲线 path
  let d = `M ${xAt(curve[0].day).toFixed(1)} ${yAt(curve[0].value).toFixed(1)}`;
  for (let i = 1; i < curve.length; i++) {
    d += ` L ${xAt(curve[i].day).toFixed(1)} ${yAt(curve[i].value).toFixed(1)}`;
  }
  const area = `${d} L ${xAt(curve[curve.length - 1].day).toFixed(1)} ${PAD_T + plotH} L ${xAt(curve[0].day).toFixed(1)} ${PAD_T + plotH} Z`;

  const markerX = dayInCycle != null ? xAt(dayInCycle) : null;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>雌激素曲线（周期建模）</Text>
        <Text style={styles.sub}>建模估算 · 非实测</Text>
      </View>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* 阶段背景带 */}
        {curve.map((p) => (
          <Rect
            key={`bg-${p.day}`}
            x={xAt(p.day) - step / 2}
            y={PAD_T}
            width={step}
            height={plotH}
            fill={PHASE_BG[p.phase] ?? PHASE_BG.unknown}
          />
        ))}
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
        <Path d={area} fill="rgba(233,128,168,0.16)" />
        <Path d={d} fill="none" stroke="#e980a8" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
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
        {/* 关键日标注 */}
        <SvgText x={xAt(1) + 2} y={H - 8} fontSize={10} fill={theme.colors.textSub}>{`第1天`}</SvgText>
        <SvgText x={xAt(ovulationDay)} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="middle">{`排卵`}</SvgText>
        <SvgText x={xAt(curve.length)} y={H - 8} fontSize={10} fill={theme.colors.textSub} textAnchor="end">{`第${curve.length}天`}</SvgText>
      </Svg>

      {/* 当前读数 */}
      <View style={styles.readout}>
        <Text style={styles.readoutText}>
          {dayInCycle != null
            ? `周期第 ${dayInCycle} 天`
            : '记录经期后显示'}
          {currentValue != null ? ` · 雌激素指数 ${currentValue}` : ''}
          {currentPhase ? ` · ${PHASE_LABEL[currentPhase]}` : ''}
        </Text>
      </View>

      <Text style={styles.disclaimer}>
        戒指暂未直接测量雌激素，曲线依据标准月经周期激素动力学建模，用于帮助理解当前阶段背景，非实测值。
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
