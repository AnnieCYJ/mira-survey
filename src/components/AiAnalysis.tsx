/**
 * AiAnalysis —— 统一的「AI 分析」展示外壳
 *
 * 统一格式（PhaseInsightSection 模板）：
 *   ✨ AI 分析 badge
 *   [大标题]              ← title
 *   [小字标签]            ← subtitle（可选，如「周期第 14 天」）
 *   ● 分段结论 (AiResultRow)
 *   ● 建议               ← advice 小点列表
 *
 * 供周期各阶段、雌激素/孕激素趋势、体温双相、皮质醇节律等 AI 解读统一复用。
 */
import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';

export type AiTone = 'good' | 'warn' | 'neutral';

/** 结论行：左侧状态圆点（good=绿 / warn=橙 / neutral=灰）+ 标题 + 正文 */
export function AiResultRow({
  tone,
  title,
  children,
  compact = false,
  bodyColor,
}: {
  tone: AiTone;
  title: string;
  children: ReactNode;
  /** ★ 2026-10-07（用户：AI 分析太长了，缩小一点）：紧凑模式 —— 字号降一档、行距收紧、正文最多 2 行 */
  compact?: boolean;
  /** ★ 2026-10-08（用户：那些个节律分析，我不要灰色的）：正文色可覆写（传 theme.colors.textBody 等正文色）；不传保持灰色 textSub */
  bodyColor?: string;
}) {
  const dot =
    tone === 'good' ? theme.colors.success : tone === 'warn' ? theme.colors.stateTense : theme.colors.textSub;
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, compact && styles.rowTitleCompact]}>{title}</Text>
        <Text
          style={[styles.rowText, compact && styles.rowTextCompact, bodyColor ? { color: bodyColor } : null]}
          numberOfLines={compact ? 2 : undefined}
        >
          {children}
        </Text>
      </View>
    </View>
  );
}

/**
 * 完整外壳：大标题 + 标签 + 结论行(children) + 小点建议 + 脚注
 *
 * @param title 大标题（加粗，如「排卵期·状态巅峰」）
 * @param subtitle 小字标签（如「周期第 14 天」）
 * @param advice 建议小点列表（纯文本）
 * @param foot 脚注（免责声明等）
 */
export default function AiAnalysis({
  children,
  foot,
  title,
  subtitle,
  advice,
  compact = false,
}: {
  children: ReactNode;
  foot?: ReactNode;
  title?: string;
  subtitle?: string;
  advice?: string[];
  /** ★ 2026-10-07（用户：AI 分析太长了，缩小一点）：紧凑模式 —— 标题/正文降字号、行距与间距收紧、正文截断到 2 行 */
  compact?: boolean;
}) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {title ? <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text> : null}
      {children}
      {advice && advice.length > 0 ? (
        <View style={[styles.adviceBox, compact && styles.adviceBoxCompact]}>
          <Text style={[styles.adviceTitle, compact && styles.textCompact]}>● 建议</Text>
          {advice.map((t, i) => (
            <Text key={i} style={[styles.adviceItem, compact && styles.textCompact]} numberOfLines={compact ? 2 : undefined}>· {t}</Text>
          ))}
        </View>
      ) : null}
      {foot ? (
        <Text style={[styles.foot, compact && styles.textCompact]} numberOfLines={compact ? 2 : undefined}>{foot}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.md },
  title: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.bold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(0.5),
  },
  subtitle: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.space.xs },
  dot: {
    width: theme.sp(2.5),
    height: theme.sp(2.5),
    borderRadius: theme.sp(1.25),
    marginTop: theme.sp(1.5),
    flexShrink: 0,
  },
  rowBody: { flex: 1, marginLeft: theme.space.sm },
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
  adviceBox: {
    marginTop: theme.space.sm,
    gap: theme.sp(0.5),
  },
  adviceTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(0.5),
  },
  adviceItem: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  foot: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.2,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
    opacity: 0.85,
  },
  /* ★ 2026-10-07：紧凑模式（compact）—— 体验详情页的 AI 解读用 */
  wrapCompact: { marginTop: theme.space.sm },
  titleCompact: { fontSize: theme.fontSize.card, marginBottom: 0 },
  subtitleCompact: { marginBottom: theme.sp(1) },
  rowCompact: { marginBottom: theme.sp(0.75) },
  rowTitleCompact: { fontSize: theme.fontSize.micro, marginBottom: 0 },
  rowTextCompact: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.5 },
  adviceBoxCompact: { marginTop: theme.space.xs },
  textCompact: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.35 },
});
