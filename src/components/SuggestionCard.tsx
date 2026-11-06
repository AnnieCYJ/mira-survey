import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { habitHeadline, HABIT_QUESTION } from '../data/habitSuggestions';

/**
 * SuggestionCard —— 「我的建议」小卡片（2026-10-08 改版）
 *
 * 用途：工具页「我的建议」tab 里，把用户确认过的建议渲染成一张张小卡片。
 * 卡片内容优先用 headline（行动型 / 状态型建议的原文），
 * 习惯确认型回退到 habitHeadline(action)（我发现你通过{动作}，状态有了改善）。
 *
 * 结构（自上而下）：
 *   ◍ 圆点 + 右上「撤销」（仅已留存态）
 *   主句（建议原文 / 习惯确认句）
 *   证据小字（真实信号改善，如有）
 *   脚注：「♥ 已留作你的专属建议」；若带 cta（行动型）则多一个「去看看 ›」直跳工具页
 *
 * 也保留内联确认流程（onKeep / onDismiss），供未来首页内联卡复用：
 *   · 点「留下建议」→ 收成卡片（kept 态）
 *   · 点「没啥感觉」/ ✕ → 淡出上移 + 负反馈
 */
interface Props {
  /** 动作稳定 key（去重 / 冷却判定） */
  id: string;
  /** 动作名，如 '睡前 4-7-8 呼吸'（习惯确认型用） */
  action?: string;
  /** 证据指标短语（真实信号改善，如有） */
  metric?: string;
  /** 建议原文（行动 / 状态型建议直接给文案，覆盖 habitHeadline） */
  headline?: string;
  /** 行动型建议落地页：{ screen, params }，留存后卡片可一键跳转 */
  cta?: { screen: string; params?: Record<string, any> };
  /** 已留存态（从 store 读到时传 true，直接渲染留存卡片） */
  saved?: boolean;
  onKeep?: (e: { id: string; action?: string; metric?: string; headline?: string }) => void;
  onDismiss?: (id: string) => void;
  onUndo?: (id: string) => void;
  /** 卡片「去看看 ›」点击：行动型建议跳对应工具页 */
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function SuggestionCard({
  id,
  action,
  metric,
  headline,
  cta,
  saved = false,
  onKeep,
  onDismiss,
  onUndo,
  onOpen,
  style,
}: Props) {
  const [kept, setKept] = useState(saved);
  useEffect(() => {
    setKept(saved);
  }, [saved]);

  // 退场动画（淡出 + 轻微上移）
  const fade = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const headlineText = headline ?? (action ? habitHeadline(action) : '');

  const handleKeep = () => {
    setKept(true);
    onKeep?.({ id, action, metric, headline });
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

  // 已留存：渲染成「我的建议」小卡片（显示原文 + 已留存脚注 + 撤销 / 去看看）
  if (kept) {
    return (
      <View style={[styles.card, style]}>
        <View style={styles.topRow}>
          <View style={styles.dot} />
          {onUndo && (
            <TouchableOpacity
              onPress={handleUndo}
              hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
              activeOpacity={theme.press.opacity}
              accessibilityRole="button"
              accessibilityLabel="撤销留下"
            >
              <Text style={styles.undoText}>撤销</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.headline}>{headlineText}</Text>
        {!!metric && <Text style={styles.evidence}>{metric}</Text>}

        <View style={styles.savedFoot}>
          <View style={styles.savedTag}>
            <Icon name="heart" size={theme.fontSize.xs} color={mm.colors.limeDeep} />
            {/* ★ 2026-10-08 十改：与首页气泡的确认文案同口径（Mira 声线统一） */}
            <Text style={styles.savedTagText}>已收进你的专属建议啦</Text>
          </View>
          {cta && onOpen && (
            <TouchableOpacity
              onPress={onOpen}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={theme.press.opacity}
              accessibilityRole="button"
              accessibilityLabel="去看看"
              style={styles.openBtn}
            >
              <Text style={styles.openBtnText}>去看看 ›</Text>
            </TouchableOpacity>
          )}
        </View>
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

      <Text style={styles.headline}>{headlineText}</Text>
      {!!metric && <Text style={styles.evidence}>{metric}</Text>}
      <Text style={styles.question}>{HABIT_QUESTION}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primary}
          onPress={handleKeep}
          activeOpacity={theme.press.opacity}
          accessibilityRole="button"
          accessibilityLabel="留下建议"
        >
          <Text style={styles.primaryText}>留下建议</Text>
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
    lineHeight: theme.fontSize.h2,
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
  // ── 已留存卡片脚注行 ──
  savedFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space.sm,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.ui.borderSoft,
  },
  savedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp(1.5),
  },
  savedTagText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textBody,
  },
  openBtn: {
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.limeSoft,
  },
  openBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.limeDeep,
  },
});
