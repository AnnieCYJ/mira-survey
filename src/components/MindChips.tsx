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
  /** ★ 2026-10-07（用户：圆环上方 chip 的数字按好坏上色）：好=绿 / 差=粉 / 适中=默认墨色；
   *  不上色（如运动/经期）则不传。仅影响数字颜色，档位语与布局不变。 */
  valueTone?: 'good' | 'mid' | 'bad';
  /** 月相图标（经期卡）：传入后用 MoonDot 取代线性 icon，与首页圆环四个象限点同一套 */
  moonStyle?: MoonStyle;
  onPress: () => void;
}

function MindChipsImpl({ items }: { items: MindChipItem[] }) {
  // ★ 2026-11-05（用户：三个卡片偏左 + 活动卡右边露边像阴影）：
  //   不再走横向滚动（滚动会让卡片整体左对齐、末张露出一角像阴影），改为**整行均匀分配**——
  //   所有 chip 用 flex:1 等权均分整行宽、左右贴边、间距对称，肉眼就是「均匀排布」。
  //   条目再多也均分（窄一点但不偏左、不露边），彻底去掉右侧那条假阴影。
  const GAP = theme.sp(2);

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
          { flex: 1 },
          pressed && styles.chipPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${it.label} ${it.value}${it.unit ?? ''}${it.tag ? `，${it.tag}` : ''}`}
      >
        <View style={[styles.iconSq, { backgroundColor: cb.bg }]}>
          {it.moonStyle != null
            ? <MoonDot style={it.moonStyle} size={theme.fontSize.body} />
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
    <View style={{ flexDirection: 'row', gap: GAP }}>{items.map(renderChip)}</View>
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
    // ★ 2026-11-05（用户：活动卡右边那道阴影要去掉）：移除 chip 投影，只留上方已有的 1px 描边分层，
    //   不再有右侧假阴影（此前右缘投影在末张卡上显出一条边）。
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
