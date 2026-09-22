/**
 * TodayMetricTiles —— 首页顶部「四张指标小卡」（认知 / 情绪 / 运动 / 恢复）。
 * ---------------------------------------------------------------------------
 * 2026-09-22 新增。设计约束（用户明确要求）：**不展示趋势图**，只看四个当前值。
 *
 * 结构（三行，四张严格同构，不自作聪明给某一张加花样）：
 *   ① 领域名（2 字，textSub，13.5）
 *   ② 数值（22 semibold，textInk） + 单位（11，textSub，**内嵌 Text 共享基线**，不要用 alignItems:'baseline' 的 View）
 *   ③ 上下文（11，textSub）
 *
 * 几何：屏宽 390 时每张 (390-48-24)/4 = 79.5pt，减去 cardPadCompact(12)×2 = **内容宽 55.5pt**。
 *   ⚠️ 因此第 ③ 行文案必须 ≤ 约 8 个西文字符 / 2 个汉字，否则窄屏（375）会折行、把四张卡撑得高低不一。
 *   数值行有 `adjustsFontSizeToFit`（下限 0.8）兜底 5 位步数这类长数字。
 *
 * 配色：颜色只放**底色**（theme.colors.tileCog/tileEmo/tileAct/tileRec），文字一律 ink/sub ——
 *   不做「同色系浅底 + 该色文字」。四底色 × 两档文字的 WCAG 对比度已实算全部 ≥4.87。
 *
 * 交互：与 BigStatCard 完全同一套手感（Pressable + press.scaleCard + motion.instant，原生驱动）。
 *   组件定义在模块作用域并 React.memo —— 禁止定义在父组件内部（state 变更会整棵子树重挂载）。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { theme } from '../theme/theme';

export type MetricTileData = {
  key: string;
  /** 2 字领域名：认知 / 情绪 / 运动 / 恢复 */
  label: string;
  /** 主数值（已格式化的字符串；无数据传 '—'，便于卡上诚实留白） */
  value: string;
  /** 数值单位小字：/100、次、步、分；没有就不传 */
  unit?: string;
  /** 第三行上下文（**≤8 西文字符 / 2 汉字**，如 低 / 峰值10:00 / 128 kcal / 9h41m） */
  sub: string;
  /** 底色，取自 theme.colors.tileXxx */
  bg: string;
  onPress?: () => void;
};

const Tile = React.memo(function Tile({ d }: { d: MetricTileData }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.timing(scale, {
      toValue: v,
      duration: theme.motion.instant,
      easing: theme.motion.easeStandard,
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPress={d.onPress}
      onPressIn={() => to(theme.press.scaleCard)}
      onPressOut={() => to(1)}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={`${d.label} ${d.value}${d.unit ?? ''} ${d.sub}`}
    >
      <Animated.View style={[styles.tile, { backgroundColor: d.bg, transform: [{ scale }] }]}>
        <Text style={styles.label} numberOfLines={1}>{d.label}</Text>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {d.value}
          {d.unit ? <Text style={styles.unit}>{d.unit}</Text> : null}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>{d.sub}</Text>
      </Animated.View>
    </Pressable>
  );
});

function TodayMetricTiles({ items }: { items: MetricTileData[] }) {
  return (
    <View style={styles.row}>
      {items.map((d) => <Tile key={d.key} d={d} />)}
    </View>
  );
}

export default React.memo(TodayMetricTiles);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: theme.space.xs },
  hit: { flex: 1 },
  tile: {
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    overflow: 'hidden',
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
  },
  value: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    marginTop: theme.sp(1),
  },
  unit: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
  },
  sub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
});
