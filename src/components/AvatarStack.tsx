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

interface Props {
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  size?: number;
}

export default function AvatarStack({ onSelect, onAdd, size = theme.sp(7) }: Props) {
  const members = useFamilyMembers();
  const shown = members.filter((m) => m.bound);
  const overlap = size * 0.36;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((m, i) => (
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
              borderWidth: 2, borderColor: theme.colors.cardBorder,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: size * 0.42 }}>{m.avatarLetter}</Text>
          </View>
        </TouchableOpacity>
      ))}
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
