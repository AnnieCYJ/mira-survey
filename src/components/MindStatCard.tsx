/**
 * MindStatCard —— MindMate v10 白卡（DESIGN-SPEC §1 #7/#8/#9）
 * 结构：右上 30px pastel 角标 + 标题 + 灰副题 + 大数字(+小单位) + 图表槽 + 可选虚线脚注。
 * 首页「消耗与恢复节律」tab 的四张卡（睡眠/情绪/认知/运动）统一用这张卡。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { theme } from '../theme/theme';
import { mm, type MindChipTone } from '../theme/mindmate';
import { MindIcon, type MindIconName } from './MindIcons';

interface Props {
  title: string;
  sub?: string;
  value: string;
  unit?: string;
  cornerIcon?: MindIconName;
  cornerTone?: MindChipTone;
  /** 图表槽（EmotionDots / MindWave 等），占卡底部 */
  chart?: React.ReactNode;
  /** 底部虚线分隔脚注（如「入睡 23:42 · 夜间醒来 1 次」） */
  foot?: string;
  /** 底部虚线分隔脚注·多行版（每项一行，如 ['步数 8,432', '距离 6.1 km']） */
  footLines?: string[];
  onPress?: () => void;
}

function MindStatCardImpl({ title, sub, value, unit, cornerIcon, cornerTone = 'lav', chart, foot, footLines, onPress }: Props) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressTo = (v: number) =>
    Animated.timing(pressScale, { toValue: v, duration: theme.motion.instant, easing: theme.motion.easeStandard, useNativeDriver: true }).start();
  const cb = mm.chipBg[cornerTone];
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => pressTo(theme.press.scaleCard)}
      onPressOut={() => pressTo(1)}
      style={{ flex: 1 }}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${value}${unit ?? ''}`}
    >
      <Animated.View style={[styles.card, { transform: [{ scale: pressScale }] }]}>
        {cornerIcon ? (
          <View style={[styles.corner, { backgroundColor: cb.bg }]}>
            <MindIcon name={cornerIcon} size={theme.fs(15)} color={cb.fg} />
          </View>
        ) : null}
        <Text style={styles.ttl} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}
        <View style={styles.numRow}>
          <Text style={styles.num} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
          {!!unit && <Text style={styles.unit}>{unit}</Text>}
        </View>
        {chart}
        {!!foot && (
          <View style={styles.foot}>
            <Text style={styles.footText} numberOfLines={1}>{foot}</Text>
          </View>
        )}
        {!!footLines?.length && (
          <View style={styles.foot}>
            {footLines.map((line, i) => (
              <Text key={i} style={styles.footLineText} numberOfLines={1}>{line}</Text>
            ))}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default React.memo(MindStatCardImpl);

const styles = StyleSheet.create({
  card: {
    // ★ 同行两卡等高：Pressable 被 row 拉伸到行高（由较高的一张决定），
    //   卡体 flexGrow 填满该高度 → 矮卡（只有脚注）不会比带图表的卡矮一截
    flexGrow: 1,
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: theme.fs(mm.radius.card),
    padding: theme.sp(3.5),
    shadowColor: mm.shadow.color,
    shadowOffset: { width: 0, height: theme.sp(mm.shadow.height) },
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: theme.sp(mm.shadow.radius),
    elevation: mm.shadow.elevation,
  },
  corner: {
    position: 'absolute',
    top: theme.sp(3),
    right: theme.sp(3),
    width: theme.fs(30),
    height: theme.fs(30),
    borderRadius: theme.fs(mm.radius.iconSqMd),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ttl: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.bold,
    color: mm.colors.ink,
    maxWidth: '72%',
  },
  sub: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    marginTop: theme.sp(0.1),
    maxWidth: '78%',
  },
  numRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.sp(1.75),
  },
  num: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.bold,
    color: mm.colors.ink,
    lineHeight: theme.fs(25),
    flexShrink: 1,
  },
  unit: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: mm.colors.inkFaint,
    marginLeft: theme.sp(0.3),
  },
  foot: {
    marginTop: theme.sp(3),
    paddingTop: theme.sp(2.25),
    borderTopWidth: 1,
    borderTopColor: 'rgba(31,29,26,0.10)',
    
  },
  footText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
  },
  footLineText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginTop: theme.sp(1),
  },
});
