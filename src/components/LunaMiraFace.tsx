/**
 * LunaMiraFace —— 「lunamira」品牌字标（原 GrokFace 白色圆脸 + 两只黑眼睛）
 * ---------------------------------------------------------------------------
 * ★ 2026-11-05（用户）：「那个白色的 grok，直接改成 lunnamira 吧，不要 grok 了」。
 *   截图指向 Onboarding 问答气泡左下角的 30px 白圆黑眼头像。现统一为白底 +
 *   居中「lunamira」字标，App 内所有助手位（Onboarding 气泡、Mira AI 首页、
 *   ChatSheet 空态、底栏 bot 按钮）使用同一标识，不再出现 grok 形象。
 *
 * 尺寸策略：
 *   - size >= 44：圆形白底头像（AI 首页大头像 / 聊天空态 / 底栏 bot）。
 *   - size <  44：横向胶囊字标（气泡小头像）。圆形塞不下 8 个字母，胶囊才能
 *     完整显示「lunamira」而不是退化成一个首字母。
 *
 * 保留 size / glow 两个参数，替换成本为零。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Props = { size?: number; glow?: boolean };

export default function LunaMiraFace({ size = 150, glow = true }: Props) {
  const glowSize = Math.round(size * 1.5);
  const pill = size < 44;
  const w = pill ? Math.round(size * 2.6) : size;
  const fontSize = pill
    ? Math.max(9, Math.round(size * 0.34))
    : Math.max(7, Math.round(size * 0.135));

  return (
    <View style={[styles.wrap, { width: w, height: size }]}>
      {glow && !pill && (
        <View style={[styles.glow, { width: glowSize, height: glowSize, borderRadius: glowSize / 2 }]} />
      )}
      <View style={[styles.face, { width: w, height: size, borderRadius: size / 2 }]}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.word, { fontSize, maxWidth: Math.round(w * 0.88) }]}
        >
          lunamira
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', backgroundColor: 'rgba(150,195,255,0.20)' },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  word: {
    color: '#132A4A',
    fontWeight: '700',
    letterSpacing: -0.4,
    includeFontPadding: false,
    textAlign: 'center',
  },
});
