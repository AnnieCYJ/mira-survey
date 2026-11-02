import React, { useCallback, useRef, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Animated, ScrollView, Pressable,
  useWindowDimensions, StatusBar,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import SavedAdviceDeck from '../components/SavedAdviceDeck';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';
import { RingBle } from '../ble/RingBleManager';
import { buildToolCtx } from '../lib/toolRecommend';
import { getToolPhaseLine } from '../lib/toolTips';
import { listHabits, undoHabit, type HabitEntry } from '../data/habitSuggestions';


/* ★ 2026-10-11 重做版：6 张工具卡图全部重新产出（源图按 4:5 精确裁切，无拉伸、无模糊补边）。
   所有图自身比例就是卡片的 4:5，渲染统一 cover 铺满，不再有任何「模糊铺底 + contain」分支。
   ⚠️ 真机曾出现「卡片区域渲染为纯色块」：Metro 的资源下载链路在设备上没走通（bundle 里 asset 记录、
   HTTP 200、字节数全部核对无误，但设备端就是不显示）。
   对策：图片改为 **内联 base64 data URI**（随 JS bundle 一起下发，不经过 asset 下载器），
   下面这份 require 仅作为 data URI 万一失败时的兜底。 */
import { TOOL_IMAGE_DATA } from '../assets/toolImageData';

const TOOL_IMAGES_FALLBACK: Record<string, number> = {
  '情绪调节': require('../assets/tool_emotion.jpg'),
  '提升颜值': require('../assets/tool_recovery.jpg'),
  '营养搭配': require('../assets/tool_food.jpg'),
  '运动建议': require('../assets/tool_activity.jpg'),
  '稳定睡眠': require('../assets/tool_sleep.jpg'),
  '知识科普': require('../assets/tool_learn.jpg'),
};

/** 卡片配图三级兜底：① 内联 data URI（随 bundle 必达）→ ② require（Metro asset）→ ③ 明示失败文字。
 *  第 ③ 态是为了下一次真机截图能直接判定：看到红字说明两种加载都失败，而不是「图不对」。 */
function ToolCardImage({ toolKey }: { toolKey: string }) {
  const [stage, setStage] = React.useState(0);
  const uri = TOOL_IMAGE_DATA[toolKey];
  const fallback = TOOL_IMAGES_FALLBACK[toolKey];

  if (stage === 0 && uri) {
    return (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onError={() => setStage(1)}
      />
    );
  }
  if (stage <= 1 && fallback) {
    return (
      <Image
        source={fallback}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, cardImgFail.box]}>
      <Text style={cardImgFail.text}>图片加载失败 · {toolKey}</Text>
    </View>
  );
}

const cardImgFail = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F4F1' },
  text: { color: '#E2554E', fontSize: 13, fontWeight: '600' },
});

/* ★ 2026-10-12（用户重做口径）—— 卡面文案区 = **底部一块白色磨砂玻璃蒙层 + 白字 + 一个按钮**：
   · 蒙层：**只一层**——同一张照片复制一份、整片用同一个模糊半径（18）铺满蒙层区，
     再叠一层白色磨砂玻璃渐变（顶透明 → 底 0.40 白），上缘与清晰图无缝相接。
     ⚠️ 之前用「三层不同模糊」叠出递增糊度，结果**三层之间出现可见的分界台阶**
     （用户：感觉蒙层有两三个不同的层级）——改成单一模糊半径，整片均匀一层，没有接缝。
   · 文案（全白字 + 淡投影托底）：
       ① 小字行：工具名 · 最近处于什么时期（如「黄体期 · 第 24 天」，未记录则「周期未记录」）
       ② 标题行：当下状态（取**真实**数据，如「今日情绪波动 3 次」「昨晚睡眠 82」；无数据显示「—」）
       ③ 建议行：怎么改善（每日微文案，按周期阶段每天轮换）
       ④ 小字行：该工具真实资源数（如「4 段冥想 · 3 个呼吸练习」）
   纯 JS（Image.blurRadius）实现，无原生模块依赖，可热更。 */
const FADE_H_RATIO = 0.44;               // 蒙层区高度 = 卡高 × 该比例
const FROST_BLUR = 18;                   // 模糊半径（单一值，整片均匀）
/* ★ 2026-10-12（用户：蒙层要做**渐渐进**的，现在边界太齐、像一块）——
   把蒙层区纵向切成 FROST_STEPS 条，每条都是同一张模糊图（坐标系与卡片一致）、
   但**不透明度逐条递增**（最上面接近 0 → 最下面 1）。
   ⇒ 从清晰到模糊是连续过渡的，看不出"蒙层从哪一行开始"，边界彻底消失。
   相邻两条只差 ~8% 不透明度，肉眼不可分辨；比"叠几层不同模糊"干净得多（后者会露出台阶）。 */
const FROST_STEPS = 8;
/** 第 i 条（0 = 最上）的不透明度：越往下越实，顶部用幂函数压得更淡，收尾更柔 */
const frostAlpha = (i: number) => Math.pow((i + 0.5) / FROST_STEPS, 1.25);

function CardGlassCaption({
  t, toolCtx, cardH,
}: { t: ToolItem; toolCtx: any; cardH: number }) {
  const phaseLine = toolCtx ? (getToolPhaseLine(toolCtx) || '周期未记录') : '周期未记录';

  const uri = TOOL_IMAGE_DATA[t.key];
  const fallback = TOOL_IMAGES_FALLBACK[t.key];
  const src: any = uri ? { uri } : fallback ? Image.resolveAssetSource(fallback) : null;
  const fadeH = Math.round(cardH * FADE_H_RATIO);

  return (
    // box-none：蒙层本身不拦触摸（点卡片任意处 = 打开该工具），但里面的按钮要能收到点击
    <View style={[styles.cardFade, { height: fadeH }]} pointerEvents="none">
      {/* ★ 渐渐进的磨砂蒙层：纵向 12 条，每条同一张模糊图、不透明度从顶到底递增 */}
      {src ? (
        <View style={[StyleSheet.absoluteFill, styles.fadeClip]}>
          {Array.from({ length: FROST_STEPS }).map((_, k) => {
            const i = FROST_STEPS - 1 - k;          // k=0 是最下面那条（最实）
            const sliceH = fadeH / FROST_STEPS;
            return (
              <View
                key={k}
                style={[
                  styles.frostSlice,
                  { height: sliceH + 0.5, bottom: k * sliceH, opacity: frostAlpha(i) },
                ]}
              >
                <Image
                  source={src}
                  style={{ position: 'absolute', left: 0, right: 0, bottom: -(k * sliceH), height: cardH }}
                  resizeMode="cover"
                  blurRadius={FROST_BLUR}
                />
              </View>
            );
          })}
        </View>
      ) : null}
      {/* ① 白色磨砂玻璃感（顶透明 → 底 0.30 白）：保留「奶白磨砂」的质感 */}
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.24)', 'rgba(255,255,255,0.30)']}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* ② 压深（顶透明 → 底 0.50 黑）：用户反馈白字看不清，叠一层向下加深的暗色把字托住。
            两层叠加后底部仍带一点奶白的磨砂味，但整体是「偏深的磨砂玻璃」，白字对比度足够。 */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.16)', 'rgba(0,0,0,0.36)', 'rgba(0,0,0,0.50)']}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.fadeInner}>
        {/* ① 类别名（放大当主标题，一眼分清是哪类工具） */}
        <Text style={styles.cgCat} numberOfLines={1}>{t.key}</Text>
        {/* ② 周期阶段（小字） */}
        <Text style={styles.cgPhase} numberOfLines={1}>{phaseLine}</Text>
        {/* ③ 用途描述（小字，原 t.d 一直没上卡，现在补上） */}
        {t.d ? <Text style={styles.cgDesc} numberOfLines={2}>{t.d}</Text> : null}
      </View>
    </View>
  );
}

// 卡片比例固定 4:5（0.8）—— 与 6 张卡图自身比例完全一致，cover 即整图，不裁不拉不变形。
const CARD_RATIO = 0.8;
// ★ 2026-10-12（用户参考图）：卡片圆角加大 —— 露出量很小时，屏边看到的才是邻卡的那个「圆弧角」
const CARD_RADIUS = theme.fs(26);
  // ★ 两侧卡片相对中间卡的缩放：缩小后它在屏幕边缘露出的只是「一个角」，而不是平着的整条竖边
const SIDE_SCALE = 0.86;
/** 两侧想露出的圆角宽度（视觉上真正能看到的部分，不是内边距） */
const CORNER = 16;

/* ★ H2 版（2026-10-13 用户定稿）：扇形展开 —— 中卡最大最正（scale 1 / 0°），
   两侧邻卡整体外移 + 绕底部中心向外倾 10°（左邻逆时针、右邻顺时针）。
   三通道全部随 scrollX 连续插值，滑动过程扇子开合：
     · scale：     1 ↔ SIDE_SCALE
     · rotate：    0deg ↔ ±10deg（scrollX 小 = 卡在右 = 右倾 +10deg）
     · translateX：0 ↔ ±cardW×0.30（邻卡外移，铺满屏幕两侧不再留白）
   绕底部旋转的写法：transform 数组里先 translateY(+h/2) → rotate → translateY(−h/2)。
   ⚠️ zIndex 必须按 |i−active| 动态给（外移后邻卡与中卡重叠区大，否则晚渲染的邻卡会盖住中卡）。 */
function cardFan(scrollX: Animated.Value, i: number, page: number, cardW: number, cardH: number) {
  const scale = scrollX.interpolate({
    inputRange: [(i - 1) * page, i * page, (i + 1) * page],
    outputRange: [SIDE_SCALE, 1, SIDE_SCALE],
    extrapolate: 'clamp',
  });
  const rotate = scrollX.interpolate({
    inputRange: [(i - 1) * page, i * page, (i + 1) * page],
    outputRange: ['10deg', '0deg', '-10deg'],
    extrapolate: 'clamp',
  });
  const shift = Math.round(cardH / 2);
  return {
    transform: [
      {
        translateX: scrollX.interpolate({
          inputRange: [(i - 1) * page, i * page, (i + 1) * page],
          outputRange: [cardW * 0.30, 0, -cardW * 0.30],
          extrapolate: 'clamp',
        }),
      },
      { translateY: shift },
      { rotate },
      { translateY: -shift },
      { scale },
    ],
  };
}

/* ★ 2026-10-11（用户定稿 P4，2026-10-11 方案 B 修正）：工具 = 一排连接式圆形图标（贯穿细线串起来），共 6 个；
   每张工具都是一样大的纯图卡片（无蒙层字，文案压在底部磨砂玻璃卡上），左右滑切换，点中间卡片进入对应功能页；
   「我的建议」已移出横滑卡，改为顶部「我收藏的建议」叠卡（见 SavedAdviceDeck）。 */
type ToolItem = {
  key: string;
  d?: string;
  m?: string;
  route?: { name: keyof RootStackParamList | string; params?: any };
};
const TOOLS: ToolItem[] = [
  { key: '情绪调节', d: '缓一缓，把紧绷的情绪松下来。', m: '4 段冥想 · 3 个呼吸练习', route: { name: 'EmotionIntervene' } },
  { key: '提升颜值', d: '跟着周期养气色，状态更稳。', m: '5 个护肤提醒 · 周期建议', route: { name: 'ToolTopic', params: { topic: 'glow' } } },
  { key: '营养搭配', d: '吃对，激素稳，能量也更平稳。', m: '6 份食谱 · 经期饮食指南', route: { name: 'FoodScan' } },
  { key: '运动建议', d: '今天怎么动，看身体状态。', m: '4 类运动 · 按周期推荐', route: { name: 'ToolTopic', params: { topic: 'sport' } } },
  { key: '稳定睡眠', d: '睡好，恢复更快，状态更稳。', m: '3 段助眠音 · 睡眠回顾', route: { name: 'Breathing' } },
  { key: '知识科普', d: '读懂身体的每个变化。', m: '12 篇科普 · 每周更新', route: { name: 'ToolTopic', params: { topic: 'learn' } } },
];

// 与 mockup 同款线性图标（stroke=currentColor）
const ICON_PATHS: string[] = [
  'M12 20.6C12 20.6 3.6 15.3 3.6 9.5c0-3 2.3-5 4.8-5 1.6 0 2.8.8 3.6 1.9.8-1.1 2-1.9 3.6-1.9 2.5 0 4.8 2 4.8 5 0 5.8-8.4 11.1-8.4 11.1z',
  'M11 3.4l1.5 4.1 4.1 1.5-4.1 1.5L11 14.6 9.5 10.5 5.4 9l4.1-1.5zM18.3 14.1l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z',
  'M7 3.4v5.4a2.3 2.3 0 0 0 4.6 0V3.4M9.3 11.1V20.6M17.2 3.4c-1.3 1.5-1.9 3.4-1.9 5.5 0 1.7.6 2.7 1.9 2.9v8.8',
  'M13 3l-8 10.5h5.2L10 21l8-10.5h-5.2z',
  'M20.2 14.3A8.2 8.2 0 0 1 9.7 3.8a7.7 7.7 0 1 0 10.5 10.5z',
  'M12 6.7c-1.1-1.3-2.7-2-5-2H4.6v12.1H7c2.3 0 3.9.7 5 2 1.1-1.3 2.7-2 5-2h2.4V4.7H17c-2.3 0-3.9.7-5 2zM12 6.7v12.1',
];

function ToolIcon({ path, size, color }: { path: string; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Path d={path} />
    </Svg>
  );
}

export default function MeditationScreen() {
  // ★ mira-ocean：深底 → 状态栏亮图标（失焦恢复，避免影响其它白底 tab）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  // ★ 2026-10-11（用户定稿方案 B）：「我收藏的建议」叠卡置于图标条上方，
  //   由 SavedAdviceDeck 渲染（最近 3 张叠起，点开看全部）。
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const refreshHabits = useCallback(() => {
    listHabits().then(setHabits).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { refreshHabits(); }, [refreshHabits]));

  // ★ 2026-10-10（用户）：今日旅程已迁到日历页「日」Tab，工具页不再显示。
  type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;
  const navigation = useNavigation<NavProp>();

  // ★ 2026-10-11（方案 A）：工具卡「每日微文案」需要的当日上下文（阶段 / 周期第 N 天 / 状态）。
  //   屏幕挂载即取当天数据，跨天重进页面自然刷新。
  const toolCtx = useMemo(() => {
    try {
      return buildToolCtx(RingBle.getState());
    } catch {
      return null;
    }
  }, []);

  // ★ 2026-10-11（用户定稿 P4）：连接式图标条 + 纯图横滑卡片（无灰底）+ 下方文字
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  // ★ 横滑位移（原生驱动）→ 用来算每张卡的缩放：居中的 1，两侧缩到 SIDE_SCALE
  const scrollX = useRef(new Animated.Value(0)).current;

  const N = TOOLS.length;
  /* ★ 2026-10-12（用户参考图：卡片左右**只露出一个（圆）角**，带一点弧形的滑动感）——
     横滑区**全出血到屏幕两边**（负外边距抵消 ScreenContainer 的左右 24）：
       · 中间卡 = 出血宽 − 2×PEEK；卡间距 = GAP；吸附步长 PAGE = 卡宽 + GAP
       · 内容左右各留 PEEK → 吸附到第 i 张时卡正好居中，前后各露 (PEEK − GAP)，左右对称
     露出量刻意做**小**（一条窄边），再配合「两侧卡片整体缩一圈」+ 卡片较大的圆角 →
     屏边看到的就不是一条平着的竖边，而是邻卡的**一个圆角**。 */
  const GAP = theme.sp(1);     // 卡间距 4
  const winW = useWindowDimensions().width;
  const bleedW = Math.min(winW, theme.layout.maxWidth ?? winW);        // 全出血宽（屏宽）
  const contentW = Math.max(1, bleedW - theme.space.screen * 2);       // 常规内容宽（节点行 / 收藏卡沿用）
  /* ★ 反解 PEEK（别再手填内边距再猜露出量）——两侧卡片是**缩过的**，
     所以真正露出来的宽度 = (PEEK − GAP) − (卡宽/2)×(1−SIDE_SCALE)：
       可见 = PEEK − GAP − (bleedW/2 − PEEK)×k，  k = 1 − SIDE_SCALE
     ⇒ PEEK = (CORNER + GAP + k×bleedW/2) / (1 + k)
     屏宽 390、缩 0.86、想露 16 → PEEK ≈ 41.5，卡宽 ≈ 307。 */
  const PEEK = (CORNER + GAP + (1 - SIDE_SCALE) * (bleedW / 2)) / (1 + (1 - SIDE_SCALE));
  const cardW = Math.max(1, bleedW - PEEK * 2);                        // 中间工具卡宽
  const PAGE = cardW + GAP;                                            // 吸附步长
  // 卡片比例固定 4:5（0.8）——与用户给的图片比例（0.807）几乎一致，可整图铺满不裁切
  const cardH = Math.round(cardW / CARD_RATIO);

  const goTo = useCallback((i: number) => {
    const idx = Math.max(0, Math.min(N - 1, i));
    activeRef.current = idx;
    setActive(idx);
    scrollRef.current?.scrollTo({ x: idx * PAGE, animated: true });
  }, [N, PAGE]);

  const onCarouselScroll = useCallback((e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.max(0, Math.min(N - 1, Math.round(x / PAGE)));
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
  }, [N, PAGE]);

  const openTool = useCallback((item: ToolItem) => {
    if (!item.route) return;
    // @ts-ignore —— route.name 为已知导航名，params 已按各页约定写好
    navigation.navigate(item.route.name as any, item.route.params);
  }, [navigation]);

  return (
    <View style={styles.page}>
      {/* ★ mira-ocean（2026-10-17）：工具页背景由白底改深海渐变（Calm 式钢蓝→蓝紫，同 App 根渐变） */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer compactTop scrollY={scrollY} topFadeColor={theme.colors.bgTop}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>Tools</Text>
          <Text style={styles.subtitle}>小的改变积累起来也很了不起</Text>
        </Animated.View>

      {/* ★ 纯图横滑卡片：全出血 + 左右各露出邻卡的一个圆角（点中间卡片进入对应功能页） */}
      <View style={[styles.carouselWrap, { width: bleedW, marginHorizontal: -theme.space.screen }]}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true, listener: onCarouselScroll },
          )}
          // ★ 不用 pagingEnabled（它只会按视口整屏翻页，邻卡永远看不到）：
          //   改成按「卡宽 + 间距」吸附，配合左右 PEEK 内边距 → 卡居中、前后各露一条。
          snapToInterval={PAGE}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: PEEK }}
        >
          {TOOLS.map((t, i) => (
            /* ★ 两侧卡片整体缩一圈（SIDE_SCALE）：缩了以后它在屏幕边缘露出的就不再是
               「一条平着的竖边」，而是**卡片的一个圆角**（上下都让出空间），
               正好是参考图那种「两边各留一个角」的滑动感。缩放走原生驱动，滑动过程连续。 */
            <Animated.View
              key={t.key}
              style={{
                width: cardW,
                marginRight: GAP,
                // 扇形三通道 + 动态层级（中卡永远在最上）
                ...cardFan(scrollX, i, PAGE, cardW, cardH),
                zIndex: N - Math.abs(i - active),
              }}
            >
              <TouchableOpacity
                activeOpacity={theme.press.scaleCard}
                style={[styles.card, { height: cardH }]}
                onPress={() => openTool(t)}
              >
                {/* 卡图自身就是 4:5 → cover 即整图铺满；底部叠加磨砂蒙层承载文案。
                    ★ 蒙层要叠 12 条模糊切片，成本不低；而几何上只有 |i−active| ≤ 1 的卡才可能出现在屏内，
                      所以只给这三张渲染蒙层（其余整张在屏外，渲染了也看不见）。 */}
                <ToolCardImage toolKey={t.key} />
                {Math.abs(i - active) <= 1 ? (
                  <CardGlassCaption t={t} toolCtx={toolCtx} cardH={cardH} />
                ) : null}
              </TouchableOpacity>
            </Animated.View>
          ))}
        </Animated.ScrollView>
      </View>

      {/* ★ H2 版：tab 行删除后，用一排小点补上「共 6 张 / 滑到第几张」的位置感。
         当前项拉长为胶囊（墨色），未选中 = 18% 淡墨；点不可点（滑动即切换）。 */}
      <View style={styles.dots}>
        {TOOLS.map((_, i) => (
          <View key={i} style={[styles.dot, i === active && styles.dotOn]} />
        ))}
      </View>

      {/* ★ 2026-10-11 用户：收藏建议移到页面底部（工具卡下方） */}
      <SavedAdviceDeck
        habits={habits}
        width={contentW}
        navigation={navigation}
        onRemove={async (id: string) => {
          try { await undoHabit(id); } catch { /* 静默 */ }
          refreshHabits();
        }}
      />

      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  // ★ H2 版：6 点指示器（当前项 = 墨色胶囊）
  dots: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: theme.sp(1.5), marginTop: theme.sp(2.5),
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotOn: { width: 14, backgroundColor: mm.colors.ink },
  page: { flex: 1 },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.inkSoft,
    marginBottom: theme.space.lg,
  },
  // 细线：left/right 由调用方按 NODE/2 传入（只连到首尾节点圆心）
  /* ★ 2026-10-12（用户选 D 版）：选中态不描边、不反色 ——
     底色由浅 pastel 压深一档（deepen()）+ 放大 1.12，图标保持原深色。 */
  // ★ 纯图横滑卡片
  carouselWrap: {
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    width: '100%',
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: theme.colors.cardBg,
    // 极轻投影，避免「灰底」观感（用户：不要灰底）
    shadowColor: '#1F1D1A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  // ★ 图卡底部「白色磨砂玻璃蒙层」文案区（贴卡底、无边界的渐入蒙层）
  cardFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  fadeClip: { overflow: 'hidden' },
  // 渐入蒙层的一条（bottom / height / opacity 由调用方按序号给出）
  frostSlice: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  fadeInner: {
    paddingHorizontal: theme.sp(4),
    paddingBottom: theme.sp(4),
    alignItems: 'flex-start',
  },
  // ① 类别名（放大当主标题，一眼分清是哪类工具）
  cgCat: {
    fontSize: theme.fs(20),
    fontWeight: theme.weight.semibold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  // ② 周期阶段（小字）
  cgPhase: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 0.2,
    marginTop: theme.sp(1),
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // ③ 用途描述（小字，原 t.d 一直没上卡，现在补上）
  cgDesc: {
    marginTop: theme.sp(0.5),
    fontSize: theme.fs(13),
    fontWeight: theme.weight.regular,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: theme.fs(18),
    textShadowColor: 'rgba(0,0,0,0.42)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
