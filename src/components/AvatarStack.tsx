/**
 * AvatarStack —— 首页多头像栈（本人 + 已绑定家人）
 *
 * 绑定家人后，头像叠加显示。点击单个头像 → onSelect(id)（本人 self 也走此回调）；
 * 点击虚线"+" → onAdd()（唤起绑定流程）。叠放 + 负 margin 做出"重叠"层次感。
 */
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { familyStore, useFamilyMembers, familyToneColor } from '../data/familyStore';

interface Props {
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  size?: number;
  /** 是否在头像外圈加"状态环" + 右上角状态表情（仅给结论，不曝光数据）。默认开。 */
  showStatus?: boolean;
  /** mono 白玻璃模式：头像全白半透明 + 白描边 + 暗字 + 隐藏彩色状态环/表情（首页用）。 */
  mono?: boolean;
}

export default function AvatarStack({ onSelect, onAdd, size = theme.sp(7), showStatus = true, mono = false }: Props) {
  const members = useFamilyMembers();
  const shown = members.filter((m) => m.bound);
  const overlap = size * 0.36;
  const badgeSize = Math.max(12, size * 0.4);
  // ★ 2026-11-03（用户：首页家人区全部白色）：mono → 隐藏彩色状态环/表情
  const showSt = mono ? false : showStatus;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((m, i) => {
        // ★ 2026-11-06：无状态结论时不再取到 undefined 颜色（原来会渲染成无色文字）
        const toneColor = showSt ? (familyToneColor(m.statusTone) ?? theme.colors.cardBorder) : theme.colors.cardBorder;
        const avatarBg = mono ? 'rgba(255,255,255,0.18)' : m.avatarColor;
        const avatarBorder = mono ? 'rgba(255,255,255,0.62)' : toneColor;
        const letterColor = mono ? 'rgba(10,30,55,0.92)' : '#fff';
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
                backgroundColor: avatarBg,
                borderWidth: 2.5, borderColor: avatarBorder,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: letterColor, fontWeight: '600', fontSize: size * 0.42 }}>{m.avatarLetter}</Text>
              {showSt && m.statusEmoji ? (
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
              backgroundColor: mono ? 'rgba(255,255,255,0.14)' : theme.colors.ui.white10,
              borderWidth: 1.5, borderStyle: 'dashed', borderColor: mono ? 'rgba(255,255,255,0.62)' : theme.colors.cardBorder,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ color: mono ? '#fff' : theme.colors.textSub, fontSize: size * 0.5, fontWeight: '600' }}>+</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
