/**
 * AiAnalysis —— 统一的「AI 分析」展示外壳
 *
 * 与洞察页 InsightBanner 同一套视觉语言：渐变 ✨ 胶囊 + 正文规格（sm / 行高 1.6 / textSub）。
 * 供周期日历页各处 AI 解读（体温双相 / 雌激素 / 孕激素）复用，保证多张卡的分析样式一致。
 */
import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon from './Icon';

export type AiTone = 'good' | 'warn' | 'neutral';

/** 结论行：左侧状态圆点（good=绿 / warn=橙 / neutral=灰）+ 标题 + 正文 */
export function AiResultRow({ tone, title, children }: { tone: AiTone; title: string; children: ReactNode }) {
  const dot =
    tone === 'good' ? theme.colors.success : tone === 'warn' ? theme.colors.stateTense : theme.colors.textSub;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowText}>{children}</Text>
      </View>
    </View>
  );
}

/** 渐变「✨ AI 分析」胶囊（与洞察页一致） */
export function AiBadge({ label = 'AI 分析' }: { label?: string }) {
  return (
    <LinearGradient
      colors={theme.colors.aiBadgeGrad as unknown as string[]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.aiBadge}
    >
      <Icon name="sparkle" size={theme.fs(13)} color={theme.colors.textWhite} strokeWidth={2} />
      <Text style={styles.aiBadgeText}>{label}</Text>
    </LinearGradient>
  );
}

/** 完整外壳：胶囊 + 结论内容 + 脚注 */
export default function AiAnalysis({
  children,
  foot,
  label,
}: {
  children: ReactNode;
  foot?: ReactNode;
  label?: string;
}) {
  return (
    <View style={styles.wrap}>
      <AiBadge label={label} />
      {children}
      {foot ? <Text style={styles.foot}>{foot}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.md },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginBottom: theme.space.sm,
  },
  aiBadgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textWhite,
    marginLeft: theme.sp(1.5),
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(2), marginBottom: theme.space.xs },
  dot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.sp(1.25),
    marginTop: theme.sp(1.5),
    flexShrink: 0,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(0.5),
  },
  rowText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.6,
    color: theme.colors.textSub,
  },
  foot: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.2,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
    opacity: 0.85,
  },
});
