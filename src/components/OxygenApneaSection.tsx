/**
 * OxygenApneaSection —— 呼吸暂停（OSAHS）分析卡
 *
 * ★ 2026-11-05（用户 E）：原本只在「血氧」详情页渲染；用户要求**睡眠恢复详情页**也展示
 *   OSAHS（阻塞性睡眠呼吸暂停低通气综合征），因为呼吸暂停本质上是睡眠期现象。
 *   因此把该组件抽成独立可复用组件，血氧页与睡眠恢复页共用同一份实现与样式。
 *
 * 数据来自戒指血氧历史（原生 triggerOxygenAnalysis 读取设备库 → VPOxygenAnalysisModel 解析）：
 *   ring.oxygenAnalysis = { osahsResult:-1|0|1|2|3, aveOxygen, minOxygen, aveRespRate,
 *                          aveLowOxygenTime, aveCardiacLoad, freqTimes }。
 * 展示：平均血氧 / 最低血氧 / 呼吸暂停(OSAHS 分级) / 呼吸率 / 低氧时间 / 心脏负荷 + 频现时段 + 免责说明。
 */
import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { useRingState } from '../hooks/useRingState';
import { RingBle } from '../ble/RingBleManager';

export const OSAHS_LEVELS: { [k: number]: { label: string; color: string } } = {
  [-1]: { label: '暂无结果', color: theme.colors.textSub },
  0: { label: '正常', color: mm.colors.skyDeep },
  1: { label: '轻度', color: mm.colors.honeyCore },
  2: { label: '中度', color: mm.colors.roseMid },
  3: { label: '重度', color: mm.colors.roseDeep },
};

export function OxygenApneaSection({ title = '呼吸暂停分析' }: { title?: string }) {
  const ring = useRingState();
  const [loading, setLoading] = useState(false);
  const a = ring.oxygenAnalysis;
  const osahs = a ? (OSAHS_LEVELS[a.osahsResult] ?? OSAHS_LEVELS[-1]) : null;

  const reload = useCallback(async () => {
    setLoading(true);
    try { await RingBle.triggerOxygenAnalysis(); } finally { setTimeout(() => setLoading(false), 1200); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <Card>
      <Text style={styles.ecgTitle}>{title}</Text>
      {!a && !loading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>当天暂无血氧数据，请先佩戴一段时间或测量血氧后再查看。</Text>
        </View>
      ) : !a && loading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>正在读取戒指血氧历史…</Text>
        </View>
      ) : a ? (
        <>
          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均血氧</Text>
              <Text style={[styles.statValue, { color: mm.colors.skyDeep }]}>{a.aveOxygen || '—'}<Text style={styles.statLabel}> %</Text></Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低血氧</Text>
              <Text style={[styles.statValue, { color: a.minOxygen > 0 && a.minOxygen < 90 ? mm.colors.roseMid : theme.colors.textTitle }]}>{a.minOxygen || '—'}<Text style={styles.statLabel}> %</Text></Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>呼吸暂停</Text>
              <Text style={[styles.statValue, { color: osahs?.color, fontSize: theme.fontSize.body }]}>{osahs?.label ?? '—'}</Text>
            </View>
          </View>
          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>呼吸率（均）</Text>
              <Text style={styles.statValue}>{a.aveRespRate || '—'}<Text style={styles.statLabel}> 次/分</Text></Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>低氧时间（均）</Text>
              <Text style={styles.statValue}>{a.aveLowOxygenTime || '—'}<Text style={styles.statLabel}> s</Text></Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>心脏负荷（均）</Text>
              <Text style={styles.statValue}>{a.aveCardiacLoad || '—'}</Text>
            </View>
          </View>
          {a.freqTimes.length > 0 ? (
            <View style={styles.note}>
              <Text style={styles.note}>呼吸暂停频现时段：{a.freqTimes.join('、')}</Text>
            </View>
          ) : null}
          <TouchableOpacity activeOpacity={0.7} onPress={reload} style={styles.ecgBtn}>
            <Text style={styles.ecgBtnLabel}>重新读取</Text>
          </TouchableOpacity>
          <Text style={styles.note}>数据来自戒指血氧历史，仅供参考，不作为睡眠呼吸暂停综合征诊断依据。</Text>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  ecgTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  statGrid: {
    flexDirection: 'row',
    gap: theme.sp(2),
    marginTop: theme.sp(1),
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(1),
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  statValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  emptyBox: { alignItems: 'center', paddingVertical: theme.space.lg },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  note: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.7,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
  ecgBtn: {
    marginTop: theme.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: mm.colors.purpleBtn,
  },
  ecgBtnLabel: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
});
