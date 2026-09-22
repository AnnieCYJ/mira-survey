/**
 * TodayMetricTiles —— 首页顶部「四张指标小卡」（认知 / 情绪 / 运动 / 恢复）。
 * ---------------------------------------------------------------------------
 * 2026-09-22 第二版（用户定稿方向）：**环 + 环心数值**——
 *   ① 领域名（2 字，textSub，居中）
 *   ② 进度环（ProgressRing 复用；环色 = theme.colors.tileRingXxx，与底色同族）
 *      环心 = 当前值（textInk，semibold，adjustsFontSizeToFit 兜底 5 位步数）
 * 不再展示第三行上下文与单位（用户：「就环中间加数就行」）。
 *
 * 环的进度口径（与下方大卡 / ConsumptionCard 完全同源，由 TodayScreen 传入）：
 *   认知 = avgFatigue/100 · 情绪 = min(1, 事件数/6) · 运动 = min(1, 步数/8000) · 恢复 = 睡眠评分/100
 *   无数据 → progress 0（只剩底轨、环心 '—'），不编数字。
 *
 * 设计 token 铁律：本组件零裸 hex / 零裸尺寸——颜色取 theme.colors，字号取 fontSize，
 *   间距取 space，圆角取 radius，环尺寸用 theme.fs()、环宽用 theme.sp()。
 *
 * 交互：与 BigStatCard 完全同一套手感（Pressable + press.scaleCard + motion.instant，原生驱动）。
 *   组件定义在模块作用域并 React.memo —— 禁止定义在父组件内部（state 变更会整棵子树重挂载）。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { theme } from '../theme/theme';
import ProgressRing from './ProgressRing';

export type MetricTileData = {
  key: string;
  /** 2 字领域名：认知 / 情绪 / 运动 / 恢复 */
  label: string;
  /** 主数值（已格式化的字符串；无数据传 '—'，便于环心诚实留白） */
  value: string;
  /** 环填充进度 0-1（无数据传 0 → 只剩底轨） */
  progress: number;
  /** 环色，取自 theme.colors.tileRingXxx */
  ringColor: string;
  /** 底色，取自 theme.colors.tileXxx */
  bg: string;
  onPress?: () => void;
};

/** 环外径 / 环宽：全部走 theme 缩放，不写裸尺寸 */
const TILE_RING_SIZE = theme.fs(50);
const TILE_RING_STROKE = theme.sp(1);

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
      accessibilityLabel={`${d.label} ${d.value}`}
    >
      <Animated.View style={[styles.tile, { backgroundColor: d.bg, transform: [{ scale }] }]}>
        <Text style={styles.label} numberOfLines={1}>{d.label}</Text>
        <ProgressRing
          progress={d.progress}
          size={TILE_RING_SIZE}
          stroke={TILE_RING_STROKE}
          color={d.ringColor}
          track={theme.colors.tileRingTrack}
        >
          <Text
            style={styles.value}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {d.value}
          </Text>
        </ProgressRing>
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
    paddingVertical: theme.space.cardPadCompact,
    paddingHorizontal: theme.space.xs,
    alignItems: 'center',
    gap: theme.sp(1.5),
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: theme.colors.textSub,
  },
  value: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    // 限宽到环内径 → adjustsFontSizeToFit 才会真正触发（5 位步数自动缩字，不撑出环）
    maxWidth: TILE_RING_SIZE - TILE_RING_STROKE * 2,
  },
});
