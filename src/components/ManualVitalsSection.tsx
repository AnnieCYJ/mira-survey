import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Card from './Card';
import Icon from './Icon';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { healthStore } from '../data/healthStore';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { formatClockTime } from '../utils/format';
import ManualMeasureSheet, { ManualMeasureMode } from './ManualMeasureSheet';

/**
 * 手动记录（自测）区块 —— ★ 2026-11-06（用户：基础版 LunaMira 无血压/血糖传感器，
 *   但很多戒指都有这功能，且血压/血糖本质是趋势）：
 *   在基础版「身体指标」区新增「手动记录」卡组，允许用户自填血压（收缩/舒张）与血糖（mmol/L），
 *   数据走 manualBpSys/manualBpDia/manualGlucose（与戒指原生 proOnly 指标解耦、不会被机型门禁/数据隔离误伤），
 *   并展示最新值与迷你趋势。明确「仅供参考，不替代专业测量与诊断」，符合 Mira 用户自报 + 不诊断口径。
 *
 * 仅基础版（isBaseLayout）注入；Pro 版已有独立的血压/血糖子 tab（戒指原生测量）。
 */
function lastOf(key: 'manualBpSys' | 'manualBpDia' | 'manualGlucose'): { v: number; t: number } | null {
  const arr = healthStore.getManualMeasurements(key);
  if (!arr || arr.length === 0) return null;
  return { v: arr[0].v, t: arr[0].t };
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (!points || points.length < 2) return null;
  const W = 132, H = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = W / (points.length - 1);
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const x = i * step;
    const y = H - ((points[i] - min) / span) * (H - 8) - 4;
    d += (i === 0 ? 'M ' : 'L ') + `${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={styles.spark}>
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

function ManualVitalCard({
  icon,
  name,
  valueText,
  unit,
  measureTime,
  sparkColor,
  sparkPoints,
  buttonLabel,
  onRecord,
}: {
  icon: string;
  name: string;
  valueText: string;
  unit: string;
  measureTime: number | null;
  sparkColor: string;
  sparkPoints: number[];
  buttonLabel: string;
  onRecord: () => void;
}) {
  const hasData = valueText !== '—';
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={styles.id}>
          <View style={[styles.iconSq, { backgroundColor: sparkColor + '22' }]}>
            <Icon name={icon as any} size={14} color={sparkColor} />
          </View>
          <Text style={styles.name}>{name}</Text>
        </View>
        <View style={[styles.pill, hasData ? styles.pillLive : styles.pillOff]}>
          <Text style={[styles.pillText, hasData ? styles.pillTextLive : styles.pillTextOff]}>
            {hasData ? '已记录' : '待记录'}
          </Text>
        </View>
      </View>

      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: hasData ? mm.colors.ink : theme.colors.textSub }]}>
          {valueText}
        </Text>
        {hasData && unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>

      <Sparkline points={sparkPoints} color={sparkColor} />

      {!hasData ? (
        <Text style={styles.emptyHint}>点击「记录」自填实测值</Text>
      ) : (
        <Text style={styles.timeHint}>最近：{formatClockTime(measureTime)}</Text>
      )}

      <TouchableOpacity activeOpacity={0.7} onPress={onRecord} style={styles.btnWrap}>
        <LinearGradient
          colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.btnGrad}
        >
          <Text style={styles.btnLabel}>{buttonLabel}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </Card>
  );
}

export default function ManualVitalsSection() {
  // ★ 订阅 healthStore：手动保存后本区块即时刷新最新值/趋势
  useHealthStoreVersion();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetMode, setSheetMode] = useState<ManualMeasureMode>(null);

  const openSheet = (mode: ManualMeasureMode) => {
    setSheetMode(mode);
    setSheetVisible(true);
  };

  // —— 血压：收缩/舒张 + 最近测量时间 ——
  const sysLast = lastOf('manualBpSys');
  const diaLast = lastOf('manualBpDia');
  const bpValue = sysLast && diaLast ? `${Math.round(sysLast.v)}/${Math.round(diaLast.v)}` : '—';
  const bpTime = Math.max(sysLast?.t ?? 0, diaLast?.t ?? 0) || null;
  const bpSpark = healthStore
    .getManualMeasurements('manualBpSys')
    .slice(0, 14)
    .reverse()
    .map((m) => m.v);

  // —— 血糖：单值 mmol/L ——
  const gluLast = lastOf('manualGlucose');
  const gluValue = gluLast ? gluLast.v.toFixed(1) : '—';
  const gluSpark = healthStore
    .getManualMeasurements('manualGlucose')
    .slice(0, 14)
    .reverse()
    .map((m) => m.v);

  return (
    <View style={styles.wrap}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>手动记录（自测）</Text>
        <Text style={styles.sectionNote}>仅供参考 · 不替代专业测量与诊断</Text>
      </View>

      <View style={styles.grid}>
        <ManualVitalCard
          icon="heart"
          name="血压"
          valueText={bpValue}
          unit="mmHg"
          measureTime={bpTime}
          sparkColor={mm.colors.skyCore}
          sparkPoints={bpSpark}
          buttonLabel="记录血压"
          onRecord={() => openSheet('bp')}
        />
        <ManualVitalCard
          icon="drop"
          name="血糖"
          valueText={gluValue}
          unit="mmol/L"
          measureTime={gluLast?.t ?? null}
          sparkColor={mm.colors.purpleCore}
          sparkPoints={gluSpark}
          buttonLabel="记录血糖"
          onRecord={() => openSheet('glucose')}
        />
      </View>

      <ManualMeasureSheet
        visible={sheetVisible}
        mode={sheetMode}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  sectionNote: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  grid: { flexDirection: 'row', gap: theme.space.sm },
  card: {
    flex: 1,
    padding: theme.space.md,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  id: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  iconSq: {
    width: 26,
    height: 26,
    borderRadius: mm.radius.iconSq,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  name: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  pill: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
  },
  pillLive: { backgroundColor: theme.colors.successSoft },
  pillOff: { backgroundColor: theme.colors.ui.offTrack },
  pillText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  pillTextLive: { color: theme.colors.success },
  pillTextOff: { color: theme.colors.textSub },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.sp(1),
  },
  value: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
  },
  unit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
    marginLeft: theme.sp(1),
  },
  spark: { marginTop: theme.sp(2), marginBottom: theme.sp(1) },
  emptyHint: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginBottom: theme.sp(1),
  },
  timeHint: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginBottom: theme.sp(1),
  },
  btnWrap: {
    marginTop: theme.sp(1),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  btnGrad: { paddingVertical: theme.sp(3), alignItems: 'center' },
  btnLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.btnTextOnGrad,
  },
});
