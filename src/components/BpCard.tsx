import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { healthStore } from '../data/healthStore';
import { dayStartMs } from '../data/healthStore';

// v16 §4.2 #7：血压 = 蓝双档（同色相双折线，收缩 core / 舒张 mid）
const COL_SYS = mm.colors.skyCore;
const COL_DIA = mm.colors.skyMid;

interface Props {
  ring: any;
  onPress: () => void;
}

export default function BpCard({ ring, onPress }: Props) {
  const now = Date.now();
  const start = dayStartMs(now);
  // ★ 2026-11-14 修复：血压卡同时读取「戒指原生 bpSys/bpDia」与「手动自测 manualBpSys/manualBpDia」。
  //   基础版戒指无血压传感器，原生通道恒空，唯一来源是用户在「记录血压」手动录入（写 manualBp*）。
  //   旧实现只读 bpSys/bpDia → 手动录入的血压永不显示在卡上，表现为「连上戒指后血压没更新」。
  //   优先取原生/较新的一条，两条通道取时间更近者。
  const sysTPs = healthStore.getTimeRange('bpSys', start, now, { maxPoints: 240 });
  const diaTPs = healthStore.getTimeRange('bpDia', start, now, { maxPoints: 240 });
  const mSysTPs = healthStore.getTimeRange('manualBpSys' as any, start, now, { maxPoints: 240 });
  const mDiaTPs = healthStore.getTimeRange('manualBpDia' as any, start, now, { maxPoints: 240 });

  const pick = (native: { t: number; v: number }[], manual: { t: number; v: number }[]): { t: number; v: number } | null => {
    const n = native.length ? native[native.length - 1] : null;
    const m = manual.length ? manual[manual.length - 1] : null;
    if (n && m) return n.t >= m.t ? n : m;
    return n ?? m;
  };
  const lastSys = pick(sysTPs, mSysTPs);
  const lastDia = pick(diaTPs, mDiaTPs);
  const lastT = Math.max(lastSys?.t ?? 0, lastDia?.t ?? 0);

  const fmtTime = (t: number) => {
    if (!t) return '';
    const diff = Math.floor((Date.now() - t) / 60000);
    if (diff < 1) return '刚刚';
    if (diff < 60) return `${diff}分钟前`;
    return `${Math.floor(diff / 60)}小时前`;
  };

  const hasData = !!lastSys || !!lastDia;

  return (
    <View>
      {/* ★ 统一头部：图标方 + 名称 + 时间 + 状态 pill */}
      <View style={styles.ucTop}>
        <View style={styles.ucId}>
          <View style={styles.ic}>
            <Svg width={15} height={15} viewBox="0 0 24 24">
              <Path
                d="M12 21s-7-4.5-9.5-9C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 16.5 12 21 12 21z"
                fill="currentColor"
              />
            </Svg>
          </View>
          <Text style={styles.ucName}>血压</Text>
          <Text style={styles.ucTime}>{fmtTime(lastT)}</Text>
        </View>
        <View style={[styles.pill, hasData ? styles.pillLive : styles.pillOff]}>
          <Text style={[styles.pillText, hasData ? styles.pillTextLive : styles.pillTextOff]}>
            {hasData ? '已测' : '待接入'}
          </Text>
        </View>
      </View>

      {/* 收缩/舒张 双行（保留真实数值，蓝家族） */}
      <View style={styles.bpRows}>
        <View style={styles.bpRow}>
          <Text style={styles.bpLab}>收缩压</Text>
          <Text style={[styles.bpNum, styles.bpSys]}>{lastSys ? Math.round(lastSys.v) : '—'}</Text>
        </View>
        <View style={styles.sepLine} />
        <View style={styles.bpRow}>
          <Text style={styles.bpLab}>舒张压</Text>
          <Text style={[styles.bpNum, styles.bpDia]}>{lastDia ? Math.round(lastDia.v) : '—'}</Text>
        </View>
      </View>
      {!hasData && <Text style={styles.emptyHint}>点击查看</Text>}

      {/* ★ 统一底部入口（点卡片进日/周/月/年趋势详情） */}
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.enter}>
        <Text style={styles.enterTxt}>查看趋势图</Text>
        <Text style={styles.enterArr}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // 统一头部
  ucTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  ucId: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexShrink: 1 },
  ic: {
    width: 26,
    height: 26,
    borderRadius: mm.radius.iconSq,
    backgroundColor: mm.colors.skySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  ucName: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  ucTime: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: 8 },
  pill: { paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.pill, alignSelf: 'flex-start' },
  pillLive: { backgroundColor: theme.colors.successSoft },
  pillOff: { backgroundColor: theme.colors.ui.offTrack },
  pillText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  pillTextLive: { color: theme.colors.success },
  pillTextOff: { color: theme.colors.textSub },

  // 收缩/舒张双行
  bpRows: { marginTop: 10, borderTopWidth: 1, borderTopColor: mm.colors.chipBorder, paddingTop: 9, gap: 7 },
  bpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sepLine: { height: 1, backgroundColor: mm.colors.chipBorder },
  bpLab: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  bpNum: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold },
  bpSys: { color: COL_SYS },
  bpDia: { color: COL_DIA },
  emptyHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: 4 },

  // 统一底部入口
  enter: {
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: mm.colors.chipBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enterTxt: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold, color: mm.colors.skyDeep },
  enterArr: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.bold, color: mm.colors.skyCore },
});
