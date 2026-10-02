/**
 * ConsumptionHighlightCards —— 首页「今日消耗」下方的紧凑小卡（2 列 grid）
 *
 * 布局：
 *   ┌─────────────┐  ┌─────────────┐
 *   │ 情绪消耗     │  │ 脑力消耗     │
 *   │   占 39%    │  │   占 91%    │
 *   │             │  │             │
 *   │    0 次     │  │   66 /100   │
 *   │             │  │             │
 *   │ 暂无压力事件 │  │ 峰值19:00   │
 *   └─────────────┘  └─────────────┘
 *   ┌─────────────┐
 *   │ 运动消耗     │
 *   │   占 9%     │
 *   │             │
 *   │  533 步     │
 *   │  19 kcal    │
 *   └─────────────┘
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { computeConsumption, fmtShare, type NavType, type Seg } from './ConsumptionCard';

/** 单张紧凑小卡（半宽） */
function HighlightMiniCard({
  seg,
  onNav,
}: {
  seg: Seg;
  onNav?: (type: NavType) => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={!onNav}
      onPress={() => onNav?.(seg.nav)}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${seg.label} ${seg.value}${seg.unit}`}
    >
      {/* 右侧柔光 */}
      <LinearGradient
        colors={[theme.colors.cardBg, seg.glow, theme.colors.cardBg] as unknown as string[]}
        locations={[0.3, 0.7, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* 顶部：标题 + 占比 */}
      <View style={styles.headRow}>
        <Text style={styles.title} numberOfLines={1}>{seg.label}</Text>
        <Text style={[styles.share, { color: seg.color }]} numberOfLines={1}>
          占 {fmtShare(seg.share)}
        </Text>
      </View>

      {/* 中间：大数字 */}
      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
          {seg.value}
        </Text>
        <Text style={styles.unit} numberOfLines={1}>{seg.unit}</Text>
      </View>

      {/* 底部：副信息 */}
      <Text style={styles.sub} numberOfLines={1}>
        {seg.sub}
      </Text>
    </TouchableOpacity>
  );
}

export default function ConsumptionHighlightCards({
  ring,
  onNav,
}: {
  ring: any;
  onNav?: (type: NavType) => void;
}) {
  const { segs } = useMemo(() => computeConsumption(ring), [ring]);

  // 把 3 段分成两行：第一行前两个，第二行最后一个居中
  const [first, second, third] = segs;

  return (
    <View style={styles.grid}>
      <HighlightMiniCard seg={first} onNav={onNav} />
      <HighlightMiniCard seg={second} onNav={onNav} />
      {third && (
        <HighlightMiniCard seg={third} onNav={onNav} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: theme.space.md,
    gap: theme.sp(2),
  },
  card: {
    width: '48%',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.sp(3),
    minHeight: 140,
    justifyContent: 'space-between',
    overflow: 'hidden',
    marginBottom: theme.sp(2),
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  share: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.sp(2),
  },
  value: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
    flexShrink: 1,
  },
  unit: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginLeft: theme.sp(0.75),
  },
  sub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(1),
  },
});
