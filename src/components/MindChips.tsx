/**
 * MindChips —— 首页四指标 chips（MindMate v10，DESIGN-SPEC §1 #2）
 * 白卡 chip：pastel 方块 icon + 灰标签 + 数值。数据与消耗大卡同源（由 TodayScreen 传入）。
 * 取代原「四指标环」TodayMetricTiles 的展示位（组件文件保留，可随时回退）。
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { theme } from '../theme/theme';
import { mm, type MindChipTone } from '../theme/mindmate';
import { MindIcon, type MindIconName } from './MindIcons';

export interface MindChipItem {
  key: string;
  icon: MindIconName;
  tone: MindChipTone;
  label: string;
  value: string;
  /** 可选小号单位后缀（如 '/100'），紧跟数值右侧；不传则不渲染 */
  unit?: string;
  onPress: () => void;
}

function MindChipsImpl({ items }: { items: MindChipItem[] }) {
  return (
    <View style={styles.row}>
      {items.map((it) => {
        const cb = mm.chipBg[it.tone];
        return (
          <Pressable
            key={it.key}
            onPress={it.onPress}
            onPressIn={() => {}} // 视觉反馈交给 activeOpacity 类；chip 保持轻量
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.82 }]}
            accessibilityRole="button"
            accessibilityLabel={`${it.label} ${it.value}`}
          >
            <View style={[styles.iconSq, { backgroundColor: cb.bg }]}>
              <MindIcon name={it.icon} size={theme.fs(14)} color={cb.fg} />
            </View>
            <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {it.label}
            </Text>
            <View style={styles.valueRow}>
              <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                {it.value}
              </Text>
              {it.unit != null && it.value !== '—' && (
                <Text style={styles.unit}>{it.unit}</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default React.memo(MindChipsImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: theme.sp(2),
  },
  chip: {
    flex: 1,
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.chipBorder,
    borderRadius: theme.fs(mm.radius.chip),
    paddingTop: theme.sp(2),
    paddingBottom: theme.sp(1.5),
    paddingHorizontal: theme.sp(1),
    alignItems: 'center',
  },
  iconSq: {
    width: theme.fs(26),
    height: theme.fs(26),
    borderRadius: theme.fs(mm.radius.iconSq),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.sp(0.75),
  },
  label: {
    fontSize: theme.fs(8.5),
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    maxWidth: '100%',
  },
  value: {
    fontSize: theme.fs(12.5),
    fontWeight: theme.weight.bold,
    color: mm.colors.ink,
    marginTop: 0,
    flexShrink: 1,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    maxWidth: '100%',
    marginTop: 0,
  },
  unit: {
    fontSize: theme.fs(8.5),
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    marginLeft: 1,
  },
});
