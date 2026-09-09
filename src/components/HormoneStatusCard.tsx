/**
 * HormoneStatusCard — 戒指生理数据推断的激素状态卡
 *
 * 数据源: hormoneInference.inferHormones() — 基于体温/HRV/RHR/EDA
 * 方法: symptothermal BBT + HRV 相位差 + RHR 黄体反应
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Path as SvgPath } from 'react-native-svg';
import { theme } from '../theme/theme';
import { inferHormones, collectDailyPhysio, type HormoneInference } from '../lib/hormoneInference';
import { modelProgesteroneCurve, modelEstrogenCurve, type CycleLog, type CycleInfo } from '../lib/cycleMath';


function statusLabel(s: string | null | undefined): string {
  switch (s) {
    case 'high': return '偏高';
    case 'normal': return '正常';
    case 'low': return '偏低';
    case 'inconclusive': return '待确认';
    case 'insufficient': return '数据不够';
    case 'reference': return '参考值';
    default: return '—';
  }
}

function statusColor(s: string | null | undefined): string {
  switch (s) {
    case 'high': return theme.colors.danger;
    case 'normal': return theme.colors.success;
    case 'low': return theme.colors.stateTense;
    case 'inconclusive': return theme.colors.accentSolid;
    case 'insufficient': return theme.colors.textSub;
    case 'reference': return theme.colors.accentSolid;
    default: return theme.colors.textSub;
  }
}


function ProgSparkline({ dayInCycle, cycleLog, status }: { dayInCycle: number | null; cycleLog: CycleLog | null; status: string }) {
  if (!cycleLog) return null;
  const pts = modelProgesteroneCurve({
    cycleLength: cycleLog.cycleLength,
    ovulationDay: cycleLog.cycleLength - cycleLog.lutealLength,
    periodLength: cycleLog.periodLength,
  });
  return <Sparkline pts={pts} dayInCycle={dayInCycle} color={theme.colors.stateTense} status={status} />;
}

function E2Sparkline({ dayInCycle, cycleLog, status }: { dayInCycle: number | null; cycleLog: CycleLog | null; status: string }) {
  if (!cycleLog) return null;
  const pts = modelEstrogenCurve({
    cycleLength: cycleLog.cycleLength,
    ovulationDay: cycleLog.cycleLength - cycleLog.lutealLength,
    periodLength: cycleLog.periodLength,
  });
  return <Sparkline pts={pts} dayInCycle={dayInCycle} color={theme.colors.accentSolid} status={status} />;
}

function Sparkline({ pts, dayInCycle, color, status }: { pts: { day: number; value: number }[]; dayInCycle: number | null; color: string; status: string }) {
  const W = 260, H = 36, padL = 8, padR = 8;
  const N = pts.length;
  const xAt = (d: number) => padL + (W - padL - padR) * ((d - 1) / (N - 1));
  const yAt = (v: number) => H - 4 - (H - 8) * (v / 100);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(p.day).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');
  const todayX = dayInCycle != null ? xAt(Math.min(N, Math.max(1, dayInCycle))) : null;
  const todayY = dayInCycle != null ? yAt(pts[Math.min(N - 1, Math.max(0, dayInCycle - 1))].value) : null;
  const isRef = status === 'reference';
  return (
    <View style={{ marginTop: 4 }}>
      <Svg width={W} height={H}>
        <SvgPath d={path} fill="none" stroke={color} strokeWidth={isRef ? 1.5 : 2} opacity={isRef ? 0.6 : 1} />
        {todayX != null && todayY != null && (
          <Circle cx={todayX} cy={todayY} r={3} fill={color} />
        )}
      </Svg>
    </View>
  );
}

export default function HormoneStatusCard({
  cycleLog,
  cycleInfo,
}: {
  cycleLog: CycleLog | null;
  cycleInfo: CycleInfo | null;
}) {
  const inference: HormoneInference | null = useMemo(() => {
    if (!cycleLog || !cycleInfo || !cycleInfo.hasLog) return null;
    const physio = collectDailyPhysio(60);
    return inferHormones(physio, {
      lastPeriodStart: cycleLog.lastPeriodStart,
      cycleLength: cycleLog.cycleLength,
      lutealLength: cycleLog.lutealLength,
      periodLength: cycleLog.periodLength,
      dayInCycle: cycleInfo.dayInCycle,
      phase: cycleInfo.phase,
      ovulationDate: cycleInfo.ovulationDate,
    });
  }, [cycleLog, cycleInfo]);

  if (!inference) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>💫 体内激素状态</Text>
        <View style={{ marginTop: 8 }}>
          <Text style={styles.emptyTitle}>先记录经期 + 连续佩戴戒指</Text>
          <Text style={styles.emptyText}>激素推断需要: 经期记录 + 连续 ≥10 天皮肤体温 + ≥10 天 HRV 数据</Text>
          <Text style={styles.emptyText}>📱 方法: 先记一次经期, 戒指保持佩戴, 睡一晚, 数据会自动累积</Text>
        </View>
      </View>
    );
  }

  const { progesterone, estradiol, regularity, dataQuality } = inference;

  // 数据质量提示
  const qOk = dataQuality.daysWithTemp >= 10 || dataQuality.daysWithHRV >= 10;
  const qLabel = qOk
    ? `体温 ${dataQuality.daysWithTemp}d · HRV ${dataQuality.daysWithHRV}d`
    : `体温 ${dataQuality.daysWithTemp}/10 · HRV ${dataQuality.daysWithHRV}/10`;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>💫 体内激素状态</Text>
        <Text style={styles.dataQ}>{qLabel}</Text>
      </View>

      {/* 黄体酮 */}
      <View style={styles.hormoneRow}>
        <View style={styles.hormoneHead}>
          <Text style={styles.hormoneName}>孕激素</Text>
          <View style={[styles.statusChip, { backgroundColor: statusColor(progesterone.status) + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor(progesterone.status) }]}>
              {statusLabel(progesterone.status)}
            </Text>
          </View>
        </View>

        {progesterone.score != null && (
          <View style={[styles.scoreBar, progesterone.status === "reference" || estradiol.status === "reference" ? { opacity: 0.6 } : null]}>
            <View style={[styles.scoreFill, { width: progesterone.score + '%', backgroundColor: theme.colors.stateTense }]} />
          </View>
        )}
        {progesterone.score != null && (
          <Text style={styles.scoreNum}>{progesterone.score}/100 </Text>
        )}

        <View style={[styles.metaRow, { flexWrap: 'wrap' }]}>
          {progesterone.bbtConfirmed ? (
            <Text style={styles.metaItem}>✅ 体温出现了双相跳升（有排卵）</Text>
          ) : (
            <Text style={styles.metaItem}>⚠️ 体温还没出现明显跳升</Text>
          )}
          {progesterone.delta != null && (
            <Text style={styles.metaItem}>体温上升 {progesterone.delta.toFixed(2)}°C</Text>
          )}
          {progesterone.level !== 'unknown' && (
            <Text style={styles.metaItem}>阶段: {progesterone.level}</Text>
          )}
        </View>

        {/* mini sparkline */}
        <ProgSparkline dayInCycle={cycleInfo?.dayInCycle} cycleLog={cycleLog} status={progesterone.status} />
        <Text style={styles.srcLabel}>方法: 体温 + 心率</Text>
      </View>

      {/* 雌二醇 */}
      <View style={styles.hormoneRow}>
        <View style={styles.hormoneHead}>
          <Text style={styles.hormoneName}>雌激素</Text>
          <View style={[styles.statusChip, { backgroundColor: statusColor(estradiol.status) + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor(estradiol.status) }]}>
              {statusLabel(estradiol.status)}
            </Text>
          </View>
        </View>

        {estradiol.score != null && (
          <View style={[styles.scoreBar, progesterone.status === "reference" || estradiol.status === "reference" ? { opacity: 0.6 } : null]}>
            <View style={[styles.scoreFill, { width: estradiol.score + '%', backgroundColor: theme.colors.accentSolid }]} />
          </View>
        )}
        {estradiol.score != null && (
          <Text style={styles.scoreNum}>{estradiol.score}/100 </Text>
        )}

        <View style={[styles.metaRow, { flexWrap: 'wrap' }]}>
          {estradiol.hrvDipDetected ? (
            <Text style={styles.metaItem}>✅ 排卵前心率下降信号</Text>
          ) : (
            <Text style={styles.metaItem}>• 未检测到排卵前心率下降信号</Text>
          )}
          {estradiol.trend !== 'unknown' && (
            <Text style={styles.metaItem}>趋势: {estradiol.trend === 'rising' ? '↑ 上升' : estradiol.trend === 'falling' ? '↓ 下降' : '→ 持平'}</Text>
          )}
        </View>

        {/* mini sparkline */}
        <E2Sparkline dayInCycle={cycleInfo?.dayInCycle} cycleLog={cycleLog} status={estradiol.status} />
        <Text style={styles.srcLabel}>方法: 心率波动</Text>
      </View>

      {/* 整体周期状态 */}
      <View style={[styles.healthBox, {
        borderColor: regularity.irregularity === 'insufficient'
          ? theme.colors.textSub + '33'
          : regularity.irregularity === 'normal'
          ? theme.colors.success + '55'
          : regularity.irregularity === 'possible'
          ? theme.colors.stateTense + '55'
          : theme.colors.danger + '55',
        backgroundColor: regularity.irregularity === 'insufficient'
          ? theme.colors.cardBgSoft
          : regularity.irregularity === 'normal'
          ? theme.colors.success + '10'
          : regularity.irregularity === 'possible'
          ? theme.colors.stateTense + '15'
          : theme.colors.danger + '15',
      }]}>
        <Text style={[styles.healthTitle, {
          color: regularity.irregularity === 'insufficient'
            ? theme.colors.textSub
            : regularity.irregularity === 'normal'
            ? theme.colors.success
            : regularity.irregularity === 'possible'
            ? theme.colors.stateTense
            : theme.colors.danger,
        }]}>
          {regularity.irregularity === 'insufficient'
            ? '📊 数据累积中'
            : regularity.irregularity === 'normal'
            ? '✨ 你的周期很规律'
            : regularity.irregularity === 'possible'
            ? '⚠️ 可能有点小问题'
            : '🚨 需要关注'}
        </Text>

        {regularity.irregularity === "insufficient" ? (
          <Text style={styles.flagItem}>数据还不够, 戒指多戴几天就能判断</Text>
        ) : regularity.flags.length > 0 ? (
          regularity.flags.map((f, i) => (
            <Text key={i} style={styles.flagItem}>• {f}</Text>
          ))
        ) : (
          <Text style={styles.flagItem}>跨周期心率变化正常</Text>
        )}
      </View>

      <Text style={styles.disclaimer}>
        ⚠️ 戒指不能直接测激素, 这是根据生理信号推算的结果, 不是临床诊断。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.sm, flexWrap: 'wrap' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  dataQ: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, flexShrink: 1, maxWidth: '55%', textAlign: 'right' },

  hormoneRow: {
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  hormoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1), flexWrap: 'wrap' },
  hormoneName: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, flexShrink: 1 },
  statusChip: { paddingHorizontal: theme.sp(1.5), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill },
  statusText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any },

  scoreBar: { height: 6, backgroundColor: 'rgba(124,106,224,0.1)', borderRadius: 3, overflow: 'hidden', marginTop: theme.sp(0.5) },
  scoreFill: { height: 6, borderRadius: 3 },
  scoreNum: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.sp(1), gap: theme.sp(1) },
  metaItem: { fontSize: theme.fontSize.micro, color: theme.colors.textBody, marginRight: theme.sp(1), flexShrink: 1 },

  srcLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontStyle: 'italic', marginTop: theme.sp(1) },

  healthBox: {
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    borderLeftWidth: 3,
    marginTop: theme.space.xs,
  },
  healthTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.bold as any, marginBottom: theme.sp(0.5) },
  flagItem: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.5 },

  disclaimer: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: theme.space.sm,
  },

  emptyTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.6, marginBottom: theme.sp(0.5) },
});
