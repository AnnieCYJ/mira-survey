/**
 * LearnReadScreen —— 知识科普 · 阅读详情页（v18.70）
 *
 * 参考图文阅读样式：顶部返回 + 插画封面 + 分类/时长眉行 + 标题 + 作者/日期
 * + 短段落正文 + 参考出处。
 * （★ 2026-10-08 用户：去掉底部「和 Mira 聊聊这篇」入口——读文章就是读文章，不再跳 AI。）
 * 文章数据：lib/learnArticles.ts（静态内容，无假数据）。
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { getLearnArticle, LEARN_AUTHOR } from '../lib/learnArticles';
import { getGlowArticle } from '../lib/glowArticles';
import { getEmotionArticle } from '../lib/emotionArticles';
import { getSportArticle } from '../lib/sportArticles';
import { getNutritionArticle } from '../lib/nutritionArticles';

/** v18.79/82/83/85：collection 区分文章库（科普/颜值/情绪/运动/营养），版式共用 */
const GETTERS = {
  learn: getLearnArticle,
  glow: getGlowArticle,
  emotion: getEmotionArticle,
  sport: getSportArticle,
  nutrition: getNutritionArticle,
} as const;
const HEAD_TITLES: Record<keyof typeof GETTERS, string> = {
  learn: '图文科普',
  glow: '图文科普',
  emotion: '情绪调节',
  sport: '运动建议',
  nutrition: '饮食营养',
};

export default function LearnReadScreen() {
  const route = useRoute<{ key: string; name: string; params: { articleId: string; collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition' } }>();
  const navigation = useNavigation();
  const collection = route.params?.collection ?? 'learn';
  const article = GETTERS[collection](route.params?.articleId ?? '');
  // ★ 封面尺寸显式计算（v18.73）：width:'100%'+aspectRatio 在真机上没生效、
  //   Image 退回原始 1080×569 被屏幕裁成「满屏大图」。这里用窗口宽-边距直接给像素宽高。
  const winW = useWindowDimensions().width;
  const coverW = Math.round(Math.min(winW, theme.layout.maxWidth) - theme.space.screen * 2);
  const coverH = Math.round(coverW / 1.9);

  return (
    <View style={styles.page}>
      <LinearGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer topFadeColor={theme.colors.textWhite}>
        {/* 顶部返回 + 居中标题 */}
        <View style={styles.head}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.headTitle}>{HEAD_TITLES[collection]}</Text>
          <View style={styles.headSpacer} />
        </View>

        {/* 插画封面（显式像素宽高，禁百分比+aspectRatio 组合） */}
        <Image
          source={article.cover}
          style={[styles.cover, { width: coverW, height: coverH }]}
          resizeMode="cover"
        />

        {/* 眉行：分类 · 时长 */}
        <Text style={styles.eyebrow}>{article.eyebrow} · {article.minutes} 分钟阅读</Text>

        {/* 标题 + 作者/日期 */}
        <Text style={styles.title}>{article.title}</Text>
        <Text style={styles.byline}>{LEARN_AUTHOR} · {article.date}</Text>

        <View style={styles.divider} />

        {/* 正文短段落 */}
        {article.paragraphs.map((p, i) => (
          <Text key={i} style={styles.para}>{p}</Text>
        ))}

        {/* 参考出处（v18.86：附真实文献的文章显示） */}
        {article.sources && article.sources.length > 0 ? (
          <View style={styles.sourcesBox}>
            <Text style={styles.sourcesTitle}>参考出处</Text>
            {article.sources.map((s, i) => (
              <Text key={i} style={styles.sourceItem}>[{i + 1}] {s}</Text>
            ))}
          </View>
        ) : null}

        {/* （2026-10-08）原底部「和 Mira 聊聊这篇」入口已按用户要求移除 */}
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.space.md,
  },
  back: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
  },
  headSpacer: { width: theme.sp(9) },
  cover: {
    borderRadius: theme.radius.card,
    marginBottom: theme.space.md,
    backgroundColor: theme.colors.cardBgSoft,
  },
  eyebrow: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.8,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(1.5),
  },
  title: {
    fontSize: theme.fontSize.h2,
    lineHeight: theme.fs(27),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1.5),
  },
  byline: {
    fontSize: theme.fontSize.xs,
    color: mm.colors.inkFaint,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.cardBorder,
    marginVertical: theme.space.md,
  },
  para: {
    fontSize: theme.fontSize.body,
    lineHeight: theme.fs(23),
    color: mm.colors.inkSoft,
    marginBottom: theme.space.md,
  },
  sourcesBox: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.space.lg,
  },
  sourcesTitle: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.8,
    color: mm.colors.inkFaint,
    marginBottom: theme.sp(1.5),
  },
  sourceItem: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fs(17),
    color: mm.colors.inkFaint,
    marginBottom: theme.sp(0.75),
  },
});
