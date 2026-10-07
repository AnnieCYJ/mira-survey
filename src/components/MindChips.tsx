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
import { MoonDot, type MoonStyle } from './CycleMoonPhase';

export interface MindChipItem {
  key: string;
  icon: MindIconName;
  tone: MindChipTone;
  label: string;
  value: string;
  /** 可选小号单位后缀（如 '/100'），紧跟数值右侧；不传则不渲染 */
  unit?: string;
  /** 数值下方的数据标签（如「恢复良好」「低消耗」）；无数据/不传则不渲染 */
  tag?: string;
  /** 月相图标（经期卡）：传入后用 MoonDot 取代线性 icon，与首页圆环四个象限点同一套 */
  moonStyle?: MoonStyle;
  onPress: () => void;
}

function MindChipsImpl({ items }: { items: MindChipItem[] }) {
  // ★ 2026-10-06（用户反馈：4 个小卡左右间距不对称——「睡眠恢复」离左缘窄、「生理周期」离右缘宽）：
  //   旧实现用 ScrollView + 手工算宽 `chipW = (avail - GAP*3)/4 - 3`，那个 `-3` 把每张卡缩窄 3pt，
  //   4 张累计留下 12pt 余量，而 ScrollView 内容左对齐 → 全部余量堆在右侧，造成「最右卡离右边宽」的观感。
  //   改为 **flex 均分行**：每张卡 `flex:1`、行间 `gap`，4 张严格均分整行宽，左右都贴边、间距完全对称。
  //   flex 行天然按当前条目数均分，4 张/5 张都不再需要算宽度或横向滚动。
  const GAP = theme.sp(2);
  return (
    <View style={{ flexDirection: 'row', gap: GAP }}>
      {items.map((it) => {
        const cb = mm.chipBg[it.tone];
        return (
          <Pressable
            key={it.key}
            onPress={it.onPress}
            onPressIn={() => {}} // 视觉反馈交给 activeOpacity 类；chip 保持轻量
            style={({ pressed }) => [styles.chip, { flex: 1 }, pressed && { opacity: 0.82 }]}
            accessibilityRole="button"
            accessibilityLabel={`${it.label} ${it.value}`}
          >
            <View style={[styles.iconSq, { backgroundColor: cb.bg }]}>
              {it.moonStyle != null
                ? <MoonDot style={it.moonStyle} size={theme.fs(15)} />
                : <MindIcon name={it.icon} size={theme.fs(14)} color={cb.fg} />}
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
            {it.tag != null && it.value !== '—' && (
              <Text style={styles.tag} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {it.tag}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export default React.memo(MindChipsImpl);

const styles = StyleSheet.create({
  chip: {
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
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    maxWidth: '100%',
  },
  value: {
    fontSize: theme.fontSize.xs,
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
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    marginLeft: 1,
  },
  // ★ 2026-10-06：经期「第 N 天」的数字彩底（deep lavender 底 + 白字）
  dayPill: {
    backgroundColor: mm.chipBg.lav.fg,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.sp(1.5),
    paddingVertical: theme.sp(0.25),
    marginHorizontal: theme.sp(0.5),
  },
  dayPillText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.bold,
    color: '#FFFFFF',
  },
  tag: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
    marginTop: theme.sp(0.5),
    maxWidth: '100%',
  },
});
