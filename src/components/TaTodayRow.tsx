/**
 * TaTodayRow —— 「TA的今日」横向滑动状态卡（拒绝数据攀比）
 *
 * ★ 2026-10-19（用户需求）：首页不做双折线图（避免"你怎么又熬夜"的吵架）。
 *   改为横向滑动卡片，**只给结论**——TA 今日状态标签 + 一个心情脸，不曝光原始指标。
 *   好：TA今日 · 精力充沛 ✨；一般/差：TA今日 · 恢复略慢 🌙。
 *
 * 复用 GlassCard 玻璃质感；`dark` 变体用于浮在海浪首页（深色半透底 + 白字，保证可读）；
 * `compact` 变体减小卡片尺寸，便于嵌入首页头栏与「今日状态」标题之间的窄缝隙。
 */
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, type ViewStyle } from 'react-native';
import { theme } from '../theme/theme';
import { useFamilyMembers } from '../data/familyStore';
import EmotionFaceIcon from './EmotionFaceIcon';

const TONE_COLOR: Record<'good' | 'fair' | 'low', string> = {
  good: theme.colors.success,
  fair: '#F0C46E',
  low: theme.colors.danger,
};

interface Props {
  onSelect?: (id: string) => void;
  dark?: boolean;
  compact?: boolean;
  containerStyle?: ViewStyle;
}

export default function TaTodayRow({ onSelect, dark = false, compact = false, containerStyle }: Props) {
  const members = useFamilyMembers().filter((m) => m.bound && m.relationship !== 'self');
  if (members.length === 0) return null;

  const cardBg = dark ? 'rgba(9,28,48,0.46)' : theme.colors.cardBg;
  const border = dark ? 'rgba(255,255,255,0.16)' : theme.colors.cardBorder;
  const cardW = compact ? theme.sp(30) : theme.sp(36);
  const pad = compact ? theme.space.cardPadCompact : theme.space.cardPad;
  const avatarSize = compact ? theme.sp(5) : theme.sp(6);
  const labelColor = dark ? '#fff' : theme.colors.textTitle;
  const subColor = dark ? 'rgba(255,255,255,0.7)' : theme.colors.textSub;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={containerStyle}
      contentContainerStyle={{ paddingHorizontal: theme.space.screen, gap: theme.sp(2.5) }}
    >
      {members.map((m) => (
        <TouchableOpacity key={m.id} onPress={() => onSelect?.(m.id)} activeOpacity={0.9}>
          <View
            style={{
              width: cardW, padding: pad,
              borderRadius: theme.radius.card, backgroundColor: cardBg, borderWidth: 1, borderColor: border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) }}>
              <View
                style={{
                  width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2,
                  backgroundColor: m.avatarColor, alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: avatarSize * 0.42 }}>{m.avatarLetter}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: labelColor, fontSize: theme.fontSize.body, fontWeight: theme.weight.medium as any }}>{m.name}</Text>
                <Text style={{ color: subColor, fontSize: theme.fontSize.micro }}>TA今日</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1), marginTop: theme.sp(2) }}>
              <EmotionFaceIcon mood={m.mood ?? 'calm'} color={m.avatarColor} size={compact ? 18 : 22} />
              <Text
                style={{ color: TONE_COLOR[m.statusTone], fontSize: compact ? theme.fontSize.sm : theme.fontSize.card, fontWeight: theme.weight.medium as any, flex: 1 }}
                numberOfLines={1}
              >
                {m.statusLabel} {m.statusEmoji}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
