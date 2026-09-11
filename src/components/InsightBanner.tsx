import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Card from './Card';
import Icon from './Icon';

interface Props {
  onMore?: () => void;
  /** 自定义 AI 分析正文；不传则用默认的 HRV/激素通用文案 */
  text?: React.ReactNode;
}

export default function InsightBanner({ onMore, text }: Props) {
  return (
    <Card>
      <LinearGradient
        colors={theme.colors.aiBadgeGrad as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.badge}
      >
        <Icon name="sparkle" size={theme.fs(13)} color={theme.colors.textWhite} strokeWidth={2} />
        <Text style={styles.badgeText}>AI 综合分析</Text>
      </LinearGradient>

      {text ? (
        <Text style={styles.text}>{text}</Text>
      ) : (
        <Text style={styles.text}>
          过去 7 天你的 HRV 基线为 <Text style={styles.strong}>58ms</Text>
          ，较上周提升 6%。雌激素进入峰值区间，身体恢复能力处于本月高位。建议今明两天安排中等强度训练，并把入睡时间提前
          20 分钟。
        </Text>
      )}

      {onMore ? (
        <View style={styles.moreRow}>
          <TouchableOpacity style={styles.more} onPress={onMore} activeOpacity={0.85}>
            <Text style={styles.moreText}>查看更多分析</Text>
            <Icon name="arrowRight" size={theme.fs(13)} color={theme.colors.textWhite} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginBottom: theme.space.sm,
  },
  badgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
    marginLeft: theme.sp(1.5),
  },
  text: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.6,
    color: theme.colors.textSub,
  },
  strong: { color: theme.colors.accentSolid, fontWeight: theme.weight.semibold },
  moreRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.space.md },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.md + theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent1,
    height: theme.sp(11),
    ...theme.shadow.card,
  },
  moreText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
    marginRight: theme.sp(2),
  },
});
