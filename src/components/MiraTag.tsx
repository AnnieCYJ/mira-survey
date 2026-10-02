import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

interface Props {
  /** 标签文字，如 "MIRA AI · 今日建议" */
  label: string;
  /** md = 主标签（默认） / sm = 次级标签 */
  size?: 'sm' | 'md';
  /** 前置星标字符，默认 Mira 四角星 ✦ */
  icon?: string;
  /** 标签配色：brand=紫→蓝渐变（默认·AI 品牌） / lime=黄绿（推荐多吃） / honey=蜜黄（先少碰） */
  tone?: 'brand' | 'lime' | 'honey';
  /** 透传到外层 View 的样式（用于 margin 等） */
  style?: object;
}

/**
 * MiraTag —— Mira 品牌标签（紫→蓝渐变胶囊 + 星标 + 白字）。
 * 与 App 内 AI 气泡一致的「紫色 · 有星星」识别，用于工具页各区块标题与状态标签，
 * 让饮食 / 运动两页的标题层级统一、品牌感更强。
 *
 * v19.1：新增 tone —— brand（默认·渐变）/ lime（黄绿 tint）/ honey（蜜黄 tint），
 * 后两者用于饮食页「推荐多吃 / 先少碰」这类分类标签，避免整段都是紫色。
 */
const SOLID_TONE = {
  lime: { bg: mm.colors.limeSoft, deep: mm.colors.limeDeep },
  honey: { bg: mm.colors.honeySoft, deep: mm.colors.honeyDeep },
} as const;

export default function MiraTag({ label, size = 'md', icon = '✦', tone = 'brand', style }: Props) {
  const compact = size === 'sm';
  const padX = theme.sp(compact ? 2.75 : 3.25);
  const padY = theme.sp(compact ? 1 : 1.5);
  const fs = compact ? theme.fontSize.micro : theme.fontSize.xs;

  /* brand：紫→蓝渐变 + 白字 + 白星（AI 品牌） */
  if (tone === 'brand') {
    return (
      <View style={[styles.wrap, style]}>
        <LinearGradient
          colors={[mm.colors.purpleCore, mm.colors.skyCore]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.grad, { paddingHorizontal: padX, paddingVertical: padY }]}
        >
          <Text style={[styles.star, { fontSize: fs }]}>{icon}</Text>
          <Text style={[styles.label, { fontSize: fs }]}>{label}</Text>
        </LinearGradient>
      </View>
    );
  }

  /* lime / honey：对应色相 tint 底 + 深字 + 深星（分类标签，不打渐变） */
  const t = SOLID_TONE[tone];
  return (
    <View style={[styles.wrapSolid, { backgroundColor: t.bg, paddingHorizontal: padX, paddingVertical: padY }, style]}>
      <Text style={[styles.starSolid, { color: t.deep, fontSize: fs }]}>{icon}</Text>
      <Text style={[styles.labelSolid, { color: t.deep, fontSize: fs }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  grad: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.pill,
    gap: theme.sp(1.25),
  },
  star: { color: theme.colors.textWhite, fontWeight: '700' as never, includeFontPadding: false },
  label: {
    color: theme.colors.textWhite,
    fontWeight: '700' as never,
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  /* 实色 tint 标签（lime / honey） */
  wrapSolid: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.pill,
    gap: theme.sp(1.25),
  },
  starSolid: { fontWeight: '700' as never, includeFontPadding: false },
  labelSolid: { fontWeight: '700' as never, letterSpacing: 0.3, includeFontPadding: false },
});
