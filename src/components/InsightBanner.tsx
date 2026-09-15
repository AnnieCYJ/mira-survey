import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Card from './Card';
import Icon from './Icon';
import { AiResultRow } from './AiAnalysis';

interface InsightRow {
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
}

interface Props {
  onMore?: () => void;
  /** AI 分析正文（由真实数据生成）；不传则用中性占位文案 */
  text?: React.ReactNode;
  /** 分点结论行（tone|标题|正文）；传入时优先于 text 渲染（身体恢复页 AI / 规则兜底分点） */
  rows?: InsightRow[];
  /** 端侧大模型是否正在生成中（生成期间显示轻提示，正文用兜底文案） */
  pending?: boolean;
}

export default function InsightBanner({ onMore, text, rows, pending }: Props) {
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

      {rows && rows.length > 0 ? (
        <View>
          {rows.map((r, i) => (
            <AiResultRow key={`${r.title}-${i}`} tone={r.tone} title={r.title}>
              {r.body}
            </AiResultRow>
          ))}
        </View>
      ) : text ? (
        <Text style={styles.text}>{text}</Text>
      ) : (
        <Text style={styles.text}>
          持续佩戴后，这里会结合你的 HRV、睡眠、体温与周期相位，生成属于你的综合分析。
        </Text>
      )}

      {pending ? (
        <Text style={styles.pending}>✨ 正在结合你的真实数据生成…</Text>
      ) : null}

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
  pending: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    opacity: 0.75,
  },
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
