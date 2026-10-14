import React, { useRef } from 'react';
import { Animated, View, StyleSheet, type ScrollView, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';

interface Props {
  children: React.ReactNode;
  /**
   * ★ 把内部 ScrollView 的 ref 交给调用方（可选，不传行为与原来完全一致）。
   *   用于「点 CTA 滚到某区块」：调用方 measure 目标 View 后 scrollTo。
   */
  scrollRef?: React.Ref<ScrollView> | null;
  compactTop?: boolean;
  style?: ViewStyle;
  /** ★ 覆盖 inner（内容容器）的样式——主要用来调整本页横向留白（如把日历页留白收窄让网格更宽）。默认不传 = 与原行为完全一致。 */
  innerStyle?: ViewStyle;
  contentStyle?: ViewStyle;
  withGradient?: boolean;
  /**
   * ★ 滚动联动入口：传入一个 Animated.Value 后，容器会把**垂直滚动偏移量（px）**回传给它，
   * 且走**原生驱动**（不占 JS 线程）。不传则不注册 onScroll，行为与原来完全一致。
   * 用法见 TodayScreen：`scrollY.interpolate(...)` 驱动 opacity / transform。
   */
  scrollY?: Animated.Value;
  /**
   * 顶部「化入」遮罩的颜色。**默认 = App 根渐变顶部 `colors.bgTop`**，因为所有 tab 场景背景透明、
   * 显示的都是 App 根渐变（App.tsx），顶部恒为 bgTop。传 `null` 可关掉遮罩。
   * 例外：TodayScreen 自己铺了「上白下紫」，所以它传 `colors.textWhite`。
   */
  topFadeColor?: string | null;
  /**
   * ★ 让 inner 容器 flex:1（配合 contentStyle={{flexGrow:1}} 使用）。
   * 用于「滚动区 + 固定底部 CTA」结构：内容短时按钮也稳稳贴在屏幕底部。
   * 默认关闭，不影响任何现有页面。
   */
  stretchInner?: boolean;
}

// 与 App 根渐变同源（不再重复写色值，唯一真相源在 theme.colors.bgGradStops）
const GRAD_COLORS: string[] = [...theme.colors.bgGradStops] as unknown as string[];
const GRAD_LOCS: number[] = [0, 0.34, 0.64, 1];

export default function ScreenContainer({
  children,
  scrollRef,
  compactTop = false,
  innerStyle,
  style,
  contentStyle,
  withGradient = false,
  scrollY,
  topFadeColor = theme.colors.bgTop,
  stretchInner = false,
}: Props) {
  const insets = useSafeAreaInsets();
  // ★ 顶边「化入」遮罩（全 App 共用）：内容滚到顶边时溶入底色，而不是被上边缘硬切。
  //   调用方不传 scrollY 时，容器内部自己持有一个（不额外注册滚动监听给别人）。
  //   遮罩必须在 ScrollView **之外**，否则会跟着内容一起滚。
  const innerScrollY = useRef(new Animated.Value(0)).current;
  const sy = scrollY ?? innerScrollY;
  const topFadeOpacity = sy.interpolate({
    inputRange: [6, 48],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  return (
    <View style={[styles.outer, style]}>
      {withGradient && (
        <LinearGradient
          colors={GRAD_COLORS}
          locations={GRAD_LOCS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <Animated.ScrollView
        ref={scrollRef as React.Ref<ScrollView> | undefined}
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (compactTop ? theme.space.screen : theme.space.xl) + insets.top,
            paddingBottom: theme.layout.pageBottomPad(insets.bottom),
          },
          contentStyle,
        ]}
        showsVerticalScrollIndicator={false}
        // 仅在需要滚动联动时才注册（原生驱动，滚动过程中 JS 线程不参与）
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: sy } } }], {
          useNativeDriver: true,
        })}
      >
        <View style={[styles.inner, stretchInner && styles.innerStretch, innerStyle]}>{children}</View>
      </Animated.ScrollView>

      {topFadeColor ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.topFade, { height: insets.top + theme.sp(5), opacity: topFadeOpacity }]}
        >
          {/* 2 段线性即可；3 段且中间段过实会在滚动 60px 内就把顶部内容盖掉 */}
          <LinearGradient colors={[topFadeColor, 'transparent']} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, width: '100%', position: 'relative' },
  fill: { flex: 1, width: '100%' },
  content: { alignItems: 'center' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  inner: {
    width: '100%',
    maxWidth: theme.layout.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: theme.space.screen,
  },
  innerStretch: { flex: 1 },
});
