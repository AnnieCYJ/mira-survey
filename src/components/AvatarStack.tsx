/**
 * AvatarStack —— 首页多头像栈（本人 + 已绑定家人）
 *
 * 绑定家人后，头像叠加显示。点击单个头像 → onSelect(id)（本人 self 也走此回调）；
 * 点击虚线"+" → onAdd()（唤起绑定流程）。叠放 + 负 margin 做出"重叠"层次感。
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { familyStore, useFamilyMembers } from '../data/familyStore';

// 状态色（与 TaTodayRow 同口径）：good=绿 / fair=黄 / low=红
const TONE_COLOR: Record<'good' | 'fair' | 'low', string> = {
  good: theme.colors.success,
  fair: '#F0C46E',
  low: theme.colors.danger,
};

interface Props {
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  size?: number;
  /** 是否在头像外圈加"状态环" + 右上角状态表情（仅给结论，不曝光数据）。默认开。 */
  showStatus?: boolean;
}

export default function AvatarStack({ onSelect, onAdd, size = theme.sp(7), showStatus = true }: Props) {
  const members = useFamilyMembers();
  const shown = members.filter((m) => m.bound);
  const overlap = size * 0.36;
  const badgeSize = Math.max(12, size * 0.4);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((m, i) => {
        const toneColor = showStatus ? TONE_COLOR[m.statusTone] : theme.colors.cardBorder;
        return (
          <TouchableOpacity
            key={m.id}
            onPress={() => onSelect?.(m.id)}
            activeOpacity={0.8}
            style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: shown.length - i }}
          >
            <View
              style={{
                width: size, height: size, borderRadius: size / 2,
                backgroundColor: m.avatarColor,
                borderWidth: showStatus ? 2.5 : 2, borderColor: toneColor,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: size * 0.42 }}>{m.avatarLetter}</Text>
              {showStatus ? (
                <View
                  style={{
                    position: 'absolute', top: -size * 0.12, right: -size * 0.12,
                    width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2,
                    backgroundColor: toneColor, borderWidth: 1.5, borderColor: '#fff',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: badgeSize * 0.62, lineHeight: badgeSize * 0.66 }}>{m.statusEmoji}</Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
      {onAdd ? (
        <TouchableOpacity
          onPress={onAdd}
          activeOpacity={0.8}
          style={{ marginLeft: -overlap, zIndex: 0 }}
        >
          <View
            style={{
              width: size, height: size, borderRadius: size / 2,
              backgroundColor: 'rgba(255,255,255,0.10)',
              borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.cardBorder,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.textSub, fontSize: size * 0.5, fontWeight: '600' }}>+</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
