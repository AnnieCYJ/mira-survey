/**
 * 采样频率标注（2026-11-07 用户：「夜间频率高、日间频率低，这个频率也要标出来」）
 *
 * 一行说清三件事：
 *  ① 实测：从 healthStore 真实样本时间戳算出的 日间 / 夜间 间隔中位数；
 *  ② 差异：夜间确实更密时明确写出，不再让人把疏密差当成丢数据；
 *  ③ 协议：SDK 口径与出处（点开可看），协议值与实测值严格分开。
 *
 * 只读、不改数据；没有样本时如实显示「暂无样本」，不拿协议值冒充实测。
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { cadenceLines, PROTOCOL_CADENCE, UNKNOWN_CADENCE } from '../lib/samplingCadence';
import type { MetricKey } from '../data/healthStore';

export interface CadenceNoteProps {
  /** healthStore 指标 key（展示层别名也可，未登记的 key 会回退到通用协议口径） */
  metric: string;
  /** 要统计的日期 key 列表（日视图传 1 天，周/月/年传区间内所有天） */
  dks: string[];
  /** healthStore 版本号，数据回填后传进来触发重算 */
  version?: number;
  /** 紧凑模式：不显示可展开的协议出处 */
  compact?: boolean;
}

export default function CadenceNote({ metric, dks, version, compact = false }: CadenceNoteProps) {
  const [expanded, setExpanded] = useState(false);
  const key = metric as MetricKey;
  const lines = useMemo(
    () => cadenceLines(key, dks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, dks.join(','), version],
  );
  const protocol = PROTOCOL_CADENCE[key] ?? UNKNOWN_CADENCE;

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        hitSlop={6}
        disabled={compact}
        style={s.row}
      >
        <View style={s.dot} />
        <Text style={s.primary} numberOfLines={2}>
          {lines.primary}
          {lines.denseAtNight ? ' · 夜间更密' : ''}
        </Text>
        {!compact ? (
          <Text style={s.more}>{expanded ? '收起' : '口径'}</Text>
        ) : null}
      </Pressable>
      {expanded && !compact ? (
        <View style={s.detail}>
          <Text style={s.detailText}>协议日间：{protocol.day}</Text>
          <Text style={s.detailText}>协议夜间：{protocol.night}</Text>
          <Text style={s.detailText}>{protocol.note}</Text>
          <Text style={s.source}>依据：{protocol.source}</Text>
          <Text style={s.source}>实测取相邻样本间隔中位数（超过 2 小时的缺口不计），仅统计真实时间戳。</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: theme.sp(6), marginBottom: theme.sp(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(6) },
  dot: {
    width: theme.sp(5), height: theme.sp(5), borderRadius: theme.sp(2.5),
    backgroundColor: mm.colors.skyMid, opacity: 0.9,
  },
  primary: {
    flex: 1, color: theme.colors.textSub,
    fontSize: theme.fontSize.xs, lineHeight: theme.fontSize.xs * 1.45,
  },
  more: { color: theme.colors.textSub, fontSize: theme.fontSize.micro, opacity: 0.7 },
  detail: { marginTop: theme.sp(5), paddingLeft: theme.sp(11), gap: theme.sp(2) },
  detailText: {
    color: theme.colors.textSub, fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.5,
  },
  source: {
    color: theme.colors.textSub, fontSize: theme.fontSize.tiny,
    lineHeight: theme.fontSize.tiny * 1.5, opacity: 0.66,
  },
});
