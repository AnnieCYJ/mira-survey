/**
 * 设置页「当前戒指 · 数据实况」卡片（2026-11-07）
 *
 * 用户诉求：不要跟 HK18 全量版混在一起，要在 App 上直接看到
 *   「连的是哪枚 / 哪些数据真的传上来了 / 各是多少频率」。
 * 本卡片默认展开（旧「数据覆盖诊断」默认收起，用户反馈「显示不出来」），
 * 所有点数与频率来自 buildDeviceReality() 对 healthStore 真实样本的统计。
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Card from './Card';
import { theme } from '../theme/theme';
import { buildDeviceReality, type RealityRow, type RealityState } from '../lib/deviceReality';
import type { DeviceProfileId } from '../config/deviceModel';
import type { RingState } from '../ble/RingBleManager';

interface Props {
  ring: RingState;
  profile: DeviceProfileId;
  /** 进入设置页 / 同步完成的变化信号，用于触发重算 */
  version?: number;
}

const STATE_COLOR: Record<RealityState, string> = {
  ok: theme.colors.success,
  empty: theme.colors.textSub,
  channel: theme.colors.warn,
  none: theme.colors.danger,
};

function fmtMin(v: number | null): string {
  return v == null ? '—' : `${v} 分钟`;
}

function fmtVal(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function Row({ row, daily = false }: { row: RealityRow; daily?: boolean }) {
  const color = STATE_COLOR[row.state];
  const amount = daily ? `${row.points} 天` : `${row.points} 点`;
  const denseAtNight = !daily &&
    row.dayMinutes != null && row.nightMinutes != null && row.nightMinutes < row.dayMinutes;
  const cadence = !daily && row.dayMinutes != null && row.nightMinutes != null
    ? `读数间隔 日 ${fmtMin(row.dayMinutes)} / 夜 ${fmtMin(row.nightMinutes)}`
    : row.source;
  return (
    <View style={s.metricRow}>
      <View style={[s.metricDot, { backgroundColor: color }]} />
      <View style={s.metricBody}>
        <View style={s.metricTop}>
          <Text style={s.metricName} numberOfLines={1}>{row.label}</Text>
          <Text style={[s.metricAmount, { color }]}>{amount}</Text>
        </View>
        <Text style={s.metricCadence} numberOfLines={2}>{cadence}</Text>
        <Text style={s.metricNote}>{row.note}{denseAtNight ? ' · 夜间更密' : ''}</Text>
      </View>
      {row.latest != null ? (
        <View style={s.latestBox}>
          <Text style={s.latestVal}>{fmtVal(row.latest)}</Text>
          <Text style={s.latestUnit} numberOfLines={1}>{row.unit || '最新值'}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DeviceRealityCard({ ring, profile, version = 0 }: Props) {
  // 只在「进入页面 / 同步完成 / 实收摘要变化」时重算，避免 BLE 高频推送导致逐点统计卡顿
  const signature = [
    version, ring.dataVersion, ring.lastBackfillAt, ring.lastSyncedAt,
    ring.deviceId, ring.firmware, ring.deviceBroadcastName, ring.status, profile,
    Object.keys(ring.batchSummaries ?? {}).length,
  ].join('|');
  const reality = useMemo(
    () => buildDeviceReality(ring, profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const batch = reality.latestBatch;

  return (
    <Card style={s.card}>
      <Text style={s.title}>当前戒指 · 数据实况</Text>
      <Text style={s.subtitle}>
        只统计你正在戴的这枚戒指（{reality.modelLabel}），不含 HK18 / 全量版的数据与口径
      </Text>

      {/* 身份：连的到底是哪一枚 */}
      <View style={s.identityBox}>
        {reality.identityRows.map((r) => (
          <View key={r.label} style={s.identityRow}>
            <Text style={s.identityLabel}>{r.label}</Text>
            <Text style={s.identityVal} numberOfLines={1}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* 频率：实测值 + 这枚机型的原生口径 + 与另一枚戒指的明确分界 */}
      <View style={s.cadenceBox}>
        <Text style={s.cadenceHeadline}>{reality.cadenceHeadline}</Text>
        <Text style={s.cadenceLine}>{reality.cadenceNative}</Text>
        <Text style={s.cadenceCaveat}>{reality.cadenceCaveat}</Text>
        <Text style={s.cadenceCompare}>{reality.cadenceCompare}</Text>
      </View>

      {/* 本次 onBatch 实收的固件原始字段（最硬的证据） */}
      <Text style={s.blockTitle}>本次同步实际回传</Text>
      {batch ? (
        <View style={s.batchBox}>
          <Text style={s.batchLine}>
            {batch.dayKey} · 收到 {batch.slotCount} 个时间点 · 日间 {fmtMin(batch.dayMinutes)} / 夜间 {fmtMin(batch.nightMinutes)}
          </Text>
          <Text style={s.batchKeys}>固件原始字段：{batch.slotKeys.join(', ')}</Text>
          <Text style={s.batchLine}>
            本批单日已落库：{batch.written.length > 0
              ? batch.written.map((w) => `${w.key} ${w.count} 点`).join(' · ')
              : '本批没有可入库的指标'}
          </Text>
        </View>
      ) : (
        <Text style={s.emptyHint}>
          本次运行还没收到 onBatch 数据。开启上方「数据同步」并等待戒指回传后再看这里。
        </Text>
      )}

      {/* 逐点指标：真实传上来了什么 */}
      <Text style={s.blockTitle}>逐点指标 · 真实落库</Text>
      {reality.rows.map((r) => <Row key={r.key} row={r} />)}

      {/* 其它通道：日汇总 / 睡眠 / 压力 */}
      <Text style={s.blockTitle}>其它通道</Text>
      {reality.extras.map((r) => <Row key={r.key} row={r} daily={r.key === 'activity' || r.key === 'sleep'} />)}

      {/* 硬件不支持：明确不是「没传」，是这枚戒指没有 */}
      {reality.noSensor.length > 0 ? (
        <>
          <Text style={s.blockTitle}>这枚戒指没有的传感器 / 功能</Text>
          <View style={s.chips}>
            {reality.noSensor.map((x) => (
              <View key={x} style={s.chip}><Text style={s.chipText}>{x}</Text></View>
            ))}
          </View>
          <Text style={s.evidence}>{reality.noSensorEvidence}</Text>
          <Text style={s.emptyHint}>这些指标不是「没传上来」，而是硬件不支持，UI 里不应该出现。</Text>
        </>
      ) : null}

      <Text style={s.foot}>{reality.windowLabel} · 点数与间隔均按真实样本时间戳计算，未插值</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: theme.space.sm, paddingVertical: theme.space.sm },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  subtitle: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
    color: theme.colors.textSub,
  },
  identityBox: {
    marginTop: theme.space.md,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp(1),
  },
  identityLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  identityVal: {
    flex: 1,
    textAlign: 'right',
    marginLeft: theme.space.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  cadenceBox: {
    marginTop: theme.space.md,
    padding: theme.space.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.cardBgSoft,
  },
  cadenceHeadline: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  cadenceLine: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.55,
    color: theme.colors.textBody,
  },
  cadenceCaveat: {
    marginTop: theme.space.xs,
    padding: theme.space.xs,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBg,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textBody,
  },
  cadenceCompare: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.55,
    color: theme.colors.accentText,
  },
  blockTitle: {
    marginTop: theme.space.md,
    marginBottom: theme.space.xs,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textBody,
  },
  batchBox: {
    padding: theme.space.sm,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  batchLine: {
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.6,
    color: theme.colors.textBody,
  },
  batchKeys: {
    marginVertical: theme.space.xs,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    lineHeight: theme.fontSize.xs * 1.6,
    color: theme.colors.textTitle,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.space.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  metricDot: {
    width: theme.fs(7),
    height: theme.fs(7),
    borderRadius: theme.radius.pill,
    marginTop: theme.fs(6),
    marginRight: theme.space.sm,
  },
  metricBody: { flex: 1 },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  metricAmount: {
    marginLeft: theme.space.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
  },
  metricCadence: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.accentText,
  },
  metricNote: {
    marginTop: 2,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.55,
    color: theme.colors.textSub,
  },
  latestBox: { alignItems: 'flex-end', marginLeft: theme.space.sm, minWidth: theme.fs(46) },
  latestVal: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
  },
  latestUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
  chip: {
    paddingVertical: theme.sp(1),
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  evidence: {
    marginTop: theme.space.sm,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.55,
    color: theme.colors.textSub,
  },
  emptyHint: {
    marginTop: theme.space.xs,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
  },
  foot: {
    marginTop: theme.space.md,
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.5,
    color: theme.colors.textSub,
  },
});
