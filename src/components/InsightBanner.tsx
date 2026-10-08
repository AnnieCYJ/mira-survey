import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import { AiBadge, AiResultRow } from './AiAnalysis';

interface InsightRow {
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
}

interface Props {
  onMore?: () => void;
  /** 大标题（如「今日综合状态」） */
  title?: string | null;
  /** 小字标签（如「基于真实数据」） */
  subtitle?: string;
  /** 建议小点列表 */
  advice?: string[];
  /** AI 分析正文（由真实数据生成）；不传则用中性占位文案 */
  text?: React.ReactNode;
  /** 分点结论行（tone|标题|正文）；传入时优先于 text 渲染 */
  rows?: InsightRow[];
  /** 端侧大模型是否正在生成中 */
  pending?: boolean;
  /** ★ 2026-10-08（用户：那些个节律分析，我不要灰色的）：正文色可覆写（传 theme.colors.textBody）；不传保持灰色 textSub */
  bodyColor?: string;
}

export default function InsightBanner({ onMore, title = null, subtitle, advice, text, rows, pending, bodyColor }: Props) {
  return (
    <Card>
      <AiBadge label="AI 综合分析" />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {rows && rows.length > 0 ? (
        <View style={{ marginTop: theme.sp(1) }}>
          {/* 第一段：纯段落，无点无标题 */}
          <Text style={[styles.firstParagraph, bodyColor ? { color: bodyColor } : null]}>{rows[0].body}</Text>
          {/* 其余段：AiResultRow（点 + 标题 + 正文）*/}
          {rows.slice(1).map((r, i) => (
            <AiResultRow key={`${r.title}-${i}`} tone={r.tone} title={r.title} bodyColor={bodyColor}>
              {r.body}
            </AiResultRow>
          ))}
        </View>
      ) : text ? (
        <Text style={[styles.text, bodyColor ? { color: bodyColor } : null]}>{text}</Text>
      ) : (
        <Text style={[styles.text, bodyColor ? { color: bodyColor } : null]}>
          持续佩戴后，这里会结合你的 HRV、睡眠、体温与周期相位，生成属于你的综合分析。
        </Text>
      )}

      {/* 小点建议 */}
      {advice && advice.length > 0 ? (
        <View style={styles.adviceBox}>
          <Text style={styles.adviceTitle}>● 建议</Text>
          {advice.map((t, i) => (
            <Text key={i} style={styles.adviceItem}>· {t}</Text>
          ))}
        </View>
      ) : null}

      {pending ? (
        <Text style={styles.pending}>✨ 正在结合你的真实数据生成…</Text>
      ) : null}

      {onMore ? (
        <TouchableOpacity style={styles.moreLink} onPress={onMore} activeOpacity={0.7}>
          <Text style={styles.moreText}>查看更多分析</Text>
          <Text style={styles.moreArrow}>›</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
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
  text: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.6,
    color: theme.colors.textSub,
  },
  firstParagraph: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.65,
    color: theme.colors.textSub,
    marginBottom: theme.space.xs,
  },
  strong: { color: theme.colors.accentText, fontWeight: theme.weight.semibold }, // v16：正文字色用 accentText（accentSolid 仅图形/色块）
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
  pending: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    opacity: 0.75,
  },
  moreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: theme.space.sm,
    paddingHorizontal: theme.sp(1),
    paddingVertical: theme.sp(0.5),
  },
  moreText: { fontSize: theme.fontSize.sm, color: theme.colors.accentText, fontWeight: theme.weight.medium },
  moreArrow: { fontSize: theme.fontSize.h2, color: theme.colors.accentText, lineHeight: theme.fontSize.h2, marginLeft: 2 },
});
