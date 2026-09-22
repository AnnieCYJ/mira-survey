/**
 * TodayMetricTiles —— 首页顶部四张「指标环」（认知 / 情绪 / 运动 / 恢复）。
 * ---------------------------------------------------------------------------
 * 2026-09-22 第三版（用户定稿）：**去掉外层方卡**——
 *   每一项就是一个**圆环**，环内自上而下 = 图标（与环同色）+ 领域名 + 数值。
 *   环色直接复用**既有语义 token**（accentSolid / moodRest / stateTired / stateCalm），
 *   由 TodayScreen 传入；白底直接透出。
 *
 * 环的进度口径（与下方大卡 / ConsumptionCard 完全同源，由 TodayScreen 传入）：
 *   认知 = avgFatigue/100 · 情绪 = min(1, 事件数/6) · 运动 = min(1, 步数/8000) · 恢复 = 睡眠评分/100
 *   无数据 → progress 0（只剩底轨、数值 '—'），不编数字。
 *
 * 设计 token 铁律：本组件零裸 hex / 零裸尺寸——颜色取 theme.colors，字号取 fontSize，
 *   间距取 space，环尺寸用 theme.fs()、环宽用 theme.sp()，图标复用 components/Icon。
 *
 * 交互：Pressable + press.scaleCard + motion.instant（原生驱动）。
 *   组件定义在模块作用域并 React.memo —— 禁止定义在父组件内部（state 变更会整棵子树重挂载）。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { theme } from '../theme/theme';
import ProgressRing from './ProgressRing';
import Icon, { type IconName } from './Icon';

export type MetricTileData = {
  key: string;
  /** 环内图标（Icon 库既有字形） */
  icon: IconName;
  /** 2 字领域名：认知 / 情绪 / 运动 / 恢复 */
  label: string;
  /** 主数值（已格式化的字符串；无数据传 '—'，环心诚实留白） */
  value: string;
  /** 环填充进度 0-1（无数据传 0 → 只剩底轨） */
  progress: number;
  /** 环色（同时用作图标色），取自既有语义 token：accentSolid / moodRest / stateTired / stateCalm */
  ringColor: string;
  onPress?: () => void;
};

/** 环外径 / 环宽：全部走 theme 缩放，不写裸尺寸（72：给 5 字领域名留足环内净宽） */
const TILE_RING_SIZE = theme.fs(72);
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
      <Animated.View style={[styles.hit, { transform: [{ scale }] }]}>
        <ProgressRing
          progress={d.progress}
          size={TILE_RING_SIZE}
          stroke={TILE_RING_STROKE}
          color={d.ringColor}
          track={theme.colors.tileRingTrack}
        >
          <View style={styles.inner}>
            <Icon name={d.icon} size={theme.fs(14)} color={d.ringColor} />
            <Text
              style={styles.label}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {d.label}
            </Text>
            <Text
              style={styles.value}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {d.value}
            </Text>
          </View>
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
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  hit: { alignItems: 'center' },
  inner: {
    alignItems: 'center',
    // 限宽到环内径 → 长数字自动缩字（adjustsFontSizeToFit），不撑出环
    maxWidth: TILE_RING_SIZE - TILE_RING_STROKE * 2 - theme.sp(1),
  },
  label: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
  },
  value: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
});
