import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { habitHeadline, HABIT_QUESTION } from '../data/habitSuggestions';

/**
 * SuggestionCard —— H1「好习惯确认」卡（产品定稿样式，2026-10-07）
 *
 * 结构（自上而下）：
 *   ◍ 圆点 + 右上 ✕
 *   主句：我发现你通过{动作}，状态有了改善
 *   证据小字：{真实信号改善}（如 HRV 回升 8%，深睡连着 3 天变好）
 *   问句（全卡唯一强调色 · 品牌紫）：可以和我聊聊你的感受吗？
 *   主按钮「感受很好，留下建议」（品牌紫实底）/ 次按钮「没啥感觉」（幽灵）
 *
 * 交互：
 *   · 点「感受很好，留下建议」→ 收成一行「♥ 已留作你的专属建议」+「撤销」
 *   · 点「没啥感觉」/ ✕ → 淡出上移，并记一条负反馈（30 天冷却）
 */
interface Props {
  /** 动作稳定 key（去重 / 冷却判定） */
  id: string;
  /** 动作名，如 '睡前 4-7-8 呼吸' */
  action: string;
  /** 证据指标短语（必须是真实信号改善） */
  metric: string;
  /** 已留存态（从 store 读到时传 true，直接渲染收起的行） */
  saved?: boolean;
  onKeep?: (e: { id: string; action: string; metric: string }) => void;
  onDismiss?: (id: string) => void;
  onUndo?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

export default function SuggestionCard({ id, action, metric, saved = false, onKeep, onDismiss, onUndo, style }: Props) {
  const [kept, setKept] = useState(saved);
  useEffect(() => {
    setKept(saved);
  }, [saved]);

  // 退场动画（淡出 + 轻微上移）
  const fade = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const handleKeep = () => {
    setKept(true);
    onKeep?.({ id, action, metric });
  };

  const handleUndo = () => {
    setKept(false);
    onUndo?.(id);
  };

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 0,
        duration: theme.motion.base,
        easing: theme.motion.easeExit,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: theme.space.sm,
        duration: theme.motion.base,
        easing: theme.motion.easeExit,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss?.(id));
  };

  // 已留存：收成一行
  if (kept) {
    return (
      <View style={[styles.card, styles.keptRow, style]}>
        <Icon name="heart" size={theme.fs(16)} color={mm.colors.purpleDeep} />
        <Text style={styles.keptText}>已留作你的专属建议</Text>
        <TouchableOpacity
          onPress={handleUndo}
          hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
          activeOpacity={theme.press.opacity}
          accessibilityRole="button"
          accessibilityLabel="撤销留下"
        >
          <Text style={styles.undoText}>撤销</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.card, { opacity: fade, transform: [{ translateY: lift }] }, style]}>
      <View style={styles.topRow}>
        <View style={styles.dot} />
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={theme.press.opacity}
          accessibilityRole="button"
          accessibilityLabel="关闭建议"
        >
          <Icon name="close" size={theme.fs(16)} color={mm.colors.inkFaint} />
        </TouchableOpacity>
      </View>

      <Text style={styles.headline}>{habitHeadline(action)}</Text>
      {!!metric && <Text style={styles.evidence}>{metric}</Text>}
      <Text style={styles.question}>{HABIT_QUESTION}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primary}
          onPress={handleKeep}
          activeOpacity={theme.press.opacity}
          accessibilityRole="button"
          accessibilityLabel="感受很好，留下建议"
        >
          <Text style={styles.primaryText}>感受很好，留下建议</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ghost}
          onPress={handleDismiss}
          activeOpacity={theme.press.opacity}
          accessibilityRole="button"
          accessibilityLabel="没啥感觉"
        >
          <Text style={styles.ghostText}>没啥感觉</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mm.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    // 硬约束：所有卡片边框统一 1px / #E8E6F2（theme.colors.cardBorder）
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    ...theme.shadow.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: mm.colors.purpleDeep,
  },
  headline: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    lineHeight: theme.fs(22),
    marginTop: theme.space.xs,
  },
  evidence: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginTop: theme.sp(1.5),
  },
  question: {
    // 全卡唯一强调色：品牌紫
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: mm.colors.purpleDeep,
    marginTop: theme.space.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.md,
  },
  primary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mm.colors.purpleBtn,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.space.sm,
  },
  primaryText: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
  },
  ghost: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.space.sm,
  },
  ghostText: {
    color: theme.colors.textSub,
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
  },
  keptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingVertical: theme.space.md,
  },
  keptText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
  },
  undoText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.purpleDeep,
  },
});
