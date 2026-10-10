/**
 * MindChips —— 首页四指标 chips（MindMate v10，DESIGN-SPEC §1 #2）
 * 白卡 chip：pastel 方块 icon + 灰标签 + 数值。数据与消耗大卡同源（由 TodayScreen 传入）。
 * 取代原「四指标环」TodayMetricTiles 的展示位（组件文件保留，可随时回退）。
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
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
  /** ★ 2026-10-07（用户：圆环上方 chip 的数字按好坏上色）：好=绿 / 差=粉 / 适中=默认墨色；
   *  不上色（如运动/经期）则不传。仅影响数字颜色，档位语与布局不变。 */
  valueTone?: 'good' | 'mid' | 'bad';
  /** 月相图标（经期卡）：传入后用 MoonDot 取代线性 icon，与首页圆环四个象限点同一套 */
  moonStyle?: MoonStyle;
  onPress: () => void;
}

/** 每屏可见 chip 数：4 张均分整行宽（v18.153 定稿的视觉基线） */
const PER_SCREEN = 4;

function MindChipsImpl({ items }: { items: MindChipItem[] }) {
  // ★ 2026-10-07（用户：「加一个运动的小卡片…它是可以左右滑动的，可以看得到这个卡片」）：
  //   条目 > 4 张时改走**横向滚动**，第 5 张卡能被滑出；
  //   ≤ 4 张仍走 flex 均分行，左右贴边、间距对称，与旧版逐像素一致。
  //   ⚠ 滚动模式下 chip 宽度必须**手工固定**为 (行宽 − 3×gap)/4：
  //     ScrollView 的内容宽度不受 flex 约束，写 flex:1 会被压成 0 宽；
  //     该式与旧 flex 均分同解 ⇒ 第 5 张是「多出来一张」，而不是把前 4 张挤窄。
  const GAP = theme.sp(2);
  // ★ 2026-10-07（用户：「运动旁边应该留一点点边，否则我并不知道还可以滑动」）：
  //   可滚动时右侧**预留一条露边**（PEEK），让第 5 张卡露出一角 ⇒
  //   用户一眼就知道“这里还能往右滑”。
  //   可见宽度 = PEEK − GAP = 12pt（只露一点儿边，用户 2026-10-07：「只展示一点儿边就行」）。
  //   非滚动（≤ 4 张）时 PEEK = 0，布局与旧版逐像素一致。
  const PEEK = theme.sp(3) + GAP;
  const [rowW, setRowW] = useState(0);
  const peek = items.length > PER_SCREEN ? PEEK : 0;
  const chipW = rowW > 0 ? (rowW - GAP * (PER_SCREEN - 1) - peek) / PER_SCREEN : 0;
  const scrollable = items.length > PER_SCREEN && chipW > 0;

  const renderChip = (it: MindChipItem) => {
    const cb = mm.chipBg[it.tone];
    // ★ 2026-10-07：数字按好坏上色（好=绿 success / 差=粉 danger(roseDeep) / 适中与未传=默认墨色）
    const valueColor =
      it.valueTone === 'good' ? theme.colors.success
      : it.valueTone === 'bad' ? theme.colors.danger
      : mm.colors.ink;
    return (
      <Pressable
        key={it.key}
        onPress={it.onPress}
        style={({ pressed }) => [
          styles.chip,
          scrollable ? { width: chipW } : { flex: 1 },
          pressed && styles.chipPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${it.label} ${it.value}${it.unit ?? ''}${it.tag ? `，${it.tag}` : ''}`}
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
          <Text style={[styles.value, { color: valueColor }]}>
            {it.value}
          </Text>
          {it.unit != null && it.value !== '—' && (
            <Text style={styles.unit}>{it.unit}</Text>
          )}
        </View>
        {it.tag != null && it.value !== '—' && (
          <Text style={styles.tag} numberOfLines={1}>
            {it.tag}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
      {scrollable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: GAP }}
          directionalLockEnabled
        >
          {items.map(renderChip)}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', gap: GAP }}>{items.map(renderChip)}</View>
      )}
    </View>
  );
}

export default React.memo(MindChipsImpl);

const styles = StyleSheet.create({
  chip: {
    // ★ 2026-10-10（用户：卡片高度太高、下边空白）：94 → 80 —— 内容实高约 73pt（icon 26 + 标签 + 数值
    //   + 上下 padding），原 94 底部空出 ~20pt；80 保留 7pt 余量防标签换行裁切。
    height: 80,
    overflow: 'hidden',
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.chipBorder,
    borderRadius: theme.fs(mm.radius.chip),
    paddingTop: theme.sp(2),
    paddingBottom: theme.sp(1.5),
    paddingHorizontal: theme.sp(1),
    alignItems: 'center',
  },
  /** 按下反馈：整体轻缩 + 略降透——chip 本身就小，缩幅取 0.96 刚好“按得动，但不跳” */
  chipPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
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
    textAlign: 'center',
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
    flexWrap: 'nowrap',
    justifyContent: 'center',
    maxWidth: '100%',
    textAlign: 'center',
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
    textAlign: 'center',
  },
});
