/**
 * Calm 式海浪首页（真机预览版 · 2026-10-17）
 * 结构对齐根目录 home-calm-wave.html：
 *   上 1/3 海浪视频（已用 ffmpeg 裁掉内嵌 UI）→ 蓝→蓝紫渐变 →
 *   花瓣簇（5 张玻璃卡围绕半圆环，可点击进详情）→ Oura 式细弧半圆环（可点击）→ AI 分析卡沉底。
 * 纯静态预览数据，不接健康数据；
 * 预览开关在 BottomTabNavigator（USE_CALM_WAVE_HOME），改回 false 即恢复原 TodayScreen。
 *
 * ★ 2026-10-17 第十七轮（用户："没看到花瓣啊"）：上版 2+3 排布仍像网格 → 重排为
 *   切向旋转的真正花簇：肩瓣 ±29°、上排瓣 ±12°、顶心瓣 0° 围绕环心；环 270→240（R=100）
 *   给花瓣让位；卡 96×78 紧凑四行；z 序 = 数组序（肩→上排→顶心）。
 * ★ 2026-10-17 第十六轮（用户）：隐藏「脑力准备度」，余 5 张卡改花瓣状围绕半圆环
 *   （参考用户提供的玻璃拟态花瓣簇截图）。
 * ★ 2026-10-17 第十一轮（用户）：补齐「生理周期 / 身体负荷」两张卡（与白底版 6 卡对齐）；
 *   chips / 半圆环全部可点 → 跳对应详情页（与 TodayScreen 同款路由目标）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, useWindowDimensions, StatusBar, TouchableOpacity, ScrollView } from 'react-native';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as AsyncStorage from '../utils/prefs'; // ★ 2026-10-18：Expo Go 无 AsyncStorage 原生模块，改用 file-system 版同接口 KV
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;

const WAVE_VIDEO = require('../assets/wave-video.mp4');
const WAVE_SOUND = require('../assets/wave-sound.mp3'); // ★ 2026-10-18 用户：海浪白噪音（FFmpeg 合成 30s 无缝循环）
const THUMB_RELAX = require('../assets/card_relax.jpg');

const GLASS_BG = 'rgba(255,255,255,0.13)';
const GLASS_BD = 'rgba(255,255,255,0.28)';
const PAGE_BG = '#2B3564'; // 渐变末端：Calm 式深蓝紫
// ★ 2026-10-18 用户：头栏图标与「今日状态」标题改明显的深色（浮在浅色海浪视频上）
const HEAD_INK = 'rgba(16,36,58,0.88)';
// AI 建议卡（语音气泡）底色——尾巴 SVG 与卡身同色
const AI_CARD_BG = 'rgba(9,28,48,0.52)';
// ★ 2026-10-18：扁平浅弧双弧配色——外白弧=恢复分，内金弧=周期天数（Oura 香槟金）
const GOLD = '#d6c283';

// ★ 2026-10-18：扁平浅弧几何（用户选 Oura 风格双弧、去月相）。超大半径 R=300 的浅弧——
//   弦 330（x 30→360）、端点 y=150、弧顶仅比两端高 ≈50px（与 design/oura-flat-arc.html 一致）。
//   φ∈[-ARC_HALF, +ARC_HALF]，0=弧顶；sweep≈66.7°（浅弧）。外弧 R=300、内弧 R=274。
const ARC_R = 300;
const ARC_CX = 195;
const ARC_HALFC = 165;
const ARC_Y0 = 150;
const ARC_RI = ARC_R - 26;
const ARC_SWEEP = 2 * Math.asin(ARC_HALFC / ARC_R);
const ARC_HALF = ARC_SWEEP / 2;
function arcPt(phi: number, Rr: number) {
  return { x: ARC_CX + Rr * Math.sin(phi), y: ARC_Y0 + ARC_R * Math.cos(ARC_HALF) - Rr * Math.cos(phi) };
}
function arcPath(f0: number, f1: number, Rr: number) {
  const a = arcPt(f0, Rr);
  const b = arcPt(f1, Rr);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${Rr} ${Rr} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}
// 海浪声音开关的存储 key（与 SettingsScreen 共用）
const WAVE_SOUND_KEY = 'waveSound';

type Chip = {
  label: string;
  value: string;
  unit?: string;
  tag: string;
  good?: boolean;
  icon: JSX.Element;
  /** 点击目标（与白底版 TodayScreen 同款路由） */
  go: (nav: NavProp) => void;
};
const lineIcon = (d: string | string[]) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <Path key={i} d={p} />)}
  </Svg>
);
const CHIPS: Chip[] = [
  // ★ 2026-10-18 用户：「压力水平」改名「情绪」（tag 同步为情绪平稳，路由目标不变）
  { label: '情绪', value: '38', tag: '情绪平稳', good: true, icon: lineIcon('M3 12h3l2-4.5 3 9 2.5-6.5 1.5 2h6'), go: (n) => n.navigate('EnergyDetail', { type: 'emotion' }) },
  { label: '生理周期', value: '第14天', tag: '黄体期', icon: lineIcon(['M12 3.2a8.8 8.8 0 1 0 8.8 8.8', 'M12 7.2a4.8 4.8 0 0 1 0 9.6']), go: (n) => n.navigate('CycleCalendar') },
  { label: '睡眠恢复', value: '82', tag: '恢复良好', good: true, icon: lineIcon('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'), go: (n) => n.navigate('SleepDetail') },
  { label: '活动消耗', value: '320', unit: 'kcal', tag: '达成55%', icon: lineIcon(['M12 3c2.8 2.6 4.2 5.1 4.2 7.4a4.2 4.2 0 0 1-8.4 0C7.8 8.1 9.2 5.6 12 3Z', 'M8 17.5h8M9.5 20.5h5']), go: (n) => n.navigate('EnergyDetail', { type: 'activity' }) },
  { label: '身体负荷', value: '46', tag: '负荷适中', icon: lineIcon('M13 2.5 4.8 13.6h6L9.6 21.5 19.2 10h-6.2L13 2.5Z'), go: (n) => n.navigate('MetricDetail', { key: 'stress', name: '压力', unit: '', yMin: 0, yMax: 100 }) },
  // 「脑力准备度」按用户要求隐藏（2026-10-17 改花瓣布局只留 5 张）；要恢复：取消下行注释
  // { label: '脑力准备度', value: '64', tag: '准备度中', icon: lineIcon(['M12 3a4.2 4.2 0 0 0-4.2 4.2c-1.9.6-3.3 2.4-3.3 4.5 0 1.6.8 3 2 3.9v2.1a3.3 3.3 0 0 0 3.3 3.3h4.4a3.3 3.3 0 0 0 3.3-3.3v-2.1a4.8 4.8 0 0 0 2-3.9c0-2.1-1.4-3.9-3.3-4.5A4.2 4.2 0 0 0 12 3Z', 'M9.5 13.5 11 12l1.5 1.5L14 12']), go: (n) => n.navigate('EnergyDetail', { type: 'cognitive' }) },
];

// ★ 2026-10-18 第二十三轮（用户："卡片展示四个，最后一个滑动可看；整体字太小"）：
//   一行 5 张改横向 ScrollView——首屏露出 4 张（84×96 大卡大字），第 5 张滑动可见；
//   卡行从弧上方移到海浪/深色交界线下方（过渡区）；环 240→280、中心字 46→58；
//   AI 建议卡字号同步放大。花瓣历史资产见 git a07525c。
const CHIP_W = 84;
const CHIP_H = 96;
const CHIP_GAP = 8;
// 半圆环尺寸（旧；已弃用为扁平浅弧）——保留 GAUGE_H 仅作下方 clamp 的块高估算
const GAUGE_W = 280;
const GAUGE_H = 192; // ★ 2026-10-18：扁平浅弧块（弧 68 + 状态词/82(48px)/周期 ≈124）估算高，用于居中计算

export default function CalmWaveHome() {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();
  // ★ mira-ocean：视频+深底 → 状态栏亮图标（失焦恢复，避免影响其它白底 tab）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));
  // ★ 2026-10-18 用户：设置里「海浪白噪音」开关控制本页海浪声（AsyncStorage 持久化）。
  //   视频无音轨，声音用独立 mp3（wave-sound.mp3）经 Audio.Sound 循环播放；
  //   聚焦+开 → 播放；失焦/关 → 暂停；组件卸载 → 卸载 Sound 资源。
  const [waveOn, setWaveOn] = useState(false);
  const [focused, setFocused] = useState(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useFocusEffect(useCallback(() => {
    let alive = true;
    AsyncStorage.getItem(WAVE_SOUND_KEY).then((v) => {
      if (alive) setWaveOn(v === '1');
    });
    return () => { alive = false; };
  }, []));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (waveOn && focused) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
        if (soundRef.current) {
          await soundRef.current.playAsync(); // 已加载过 → 直接续播
          return;
        }
        const { sound } = await Audio.Sound.createAsync(WAVE_SOUND, { isLooping: true, volume: 0.6 });
        if (cancelled) { await sound.unloadAsync(); return; }
        soundRef.current = sound;
        await sound.playAsync();
      } else if (soundRef.current) {
        await soundRef.current.pauseAsync();
      }
    })();
    return () => { cancelled = true; };
  }, [waveOn, focused]);
  useEffect(() => () => { soundRef.current?.unloadAsync(); }, []); // 卸载清理
  // 渐变交界线（海浪 → 深色）= 屏幕高的 34%，与 HTML 渐变 stops 对齐
  const transitionY = height * 0.34;
  // AI 卡贴在真 tab 上方。★ 2026-10-18 第二十五轮：几何纠正——CustomTabBar wrap 是
  //   bottom:0 + marginBottom:8 + height:48，**tab 视觉顶距屏底 56，与 insets 无关**；
  //   之前误按「insets+56」模型，导致 AI 卡实际距 tab 还有 30px。
  //   现在 bottom = insets+32（34 屏 = 66，距 tab 顶 10px）——用户："分析和建议卡片再下一点"。
  //   注意：absolute 定位 bottom 值越大卡片越高——勿再改反方向。
  const aiBottom = insets.bottom + 32;
  const aiCardH = 164; // AI 卡近似高（两行分析 + 建议行 + 内边距；字号放大后 +16）
  // 扁平浅弧端点 / 进度尖端坐标（供 SVG Circle 定位）
  const tipR = arcPt(-ARC_HALF + ARC_SWEEP * (82 / 100), ARC_R);
  const lEnd = arcPt(-ARC_HALF, ARC_R);
  const rEnd = arcPt(ARC_HALF, ARC_R);
  // ★ 第三十四轮：白底版「今日状态」四档词（DailyStatusCard 同源）：
  //   元气满满 ≥76 / 状态良好 51–75 / 平平静静 26–50 / 休息一下 0–25，颜色与圆环同源
  const RECOVERY = 82;
  const mood = RECOVERY >= 76 ? { label: '元气满满', color: '#F0C46E' }
    : RECOVERY >= 51 ? { label: '状态良好', color: '#BCCB62' }
    : RECOVERY >= 26 ? { label: '平平静静', color: '#9D8AF0' }
    : { label: '休息一下', color: '#9DA7B5' };
  const moodLabel = mood.label;
  const moodColor = mood.color;
  // ★ 2026-10-18 第二十三轮：卡行移到交界线正下方（过渡区）——贴海浪下缘的深色渐变带；
  //   短屏时整体上移，防环底撞 AI 卡顶。
  // ★ 第二十五轮：标题+卡行整体再上移 12px（用户："连着下面的卡片位置整体再往上移一点"）。
  // ★ 第二十七轮：用户"卡行靠上、离弧太近，要往下"——chipRowTop 下移 8px（-6→+2），
  //   且环与卡行的间距 14→24（gaugeTop 派生同步 +10），拉开卡行与弧顶的呼吸感。
  // ★ 第二十八轮：用户看到间距拉开后反馈"今日状态和卡片再往上移一些"——chipRowTop
  //   +2→-8（再上移 10px，与第二十六轮持平略高），与弧的间距保持 24 不变。
  // ★ 第二十九轮：用户"上移不太明显，再往上一点"——-8→-16（再上移 8px）。
  //   长屏复算（852 高）：环底距 AI 卡顶 ≈53px 安全；短屏走下方 Math.min 钳位不受影响。
  // ★ 第三十五轮（真机照片反馈）：①卡行+标题整体再上移 12px（-16→-28；用户"今日状态再往上一点，
  //   情绪/生理周期卡片再往上挪一点点"）②弧+文字块在「卡行底 ↔ AI 卡顶」之间垂直居中
  //   （用户"圆弧往下一点、整个中间的圆弧和文字应该居中"）——不再贴卡行，取中点下移。
  const chipRowTop = transitionY - 28;
  const chipsBottom = chipRowTop + CHIP_H;
  const aiTop = height - aiBottom - aiCardH;
  const gaugeTop = Math.max(
    chipsBottom + 8,
    chipsBottom + (aiTop - chipsBottom - GAUGE_H) / 2,
  );

  return (
    <View style={[s.root, { backgroundColor: PAGE_BG }]}>
      {/* 上 1/3 海浪视频（全屏铺底，渐变盖住下 2/3） */}
      <Video
        style={StyleSheet.absoluteFill}
        source={WAVE_VIDEO}
        resizeMode={ResizeMode.COVER}
        isLooping
        isMuted
        shouldPlay
        useNativeControls={false}
      />
      {/* 渐变：透明 → 钢蓝 → 深蓝紫（与 HTML 同参数） */}
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={['rgba(62,98,122,0)', 'rgba(62,98,122,0)', 'rgba(52,88,116,0.45)', 'rgba(38,62,96,0.94)', '#2A4470', '#2B3564']}
        locations={[0, 0.14, 0.24, 0.31, 0.4, 1]}
      />

      {/* 顶部：左 = 账户 icon；右 = 设置 icon（均浮在海浪上）。
          ★ 2026-10-18 用户：「今日状态」白色标题从头栏移到指标卡行上方（见下方 cardTitle）。 */}
      <View style={[s.head, { paddingTop: insets.top + 30 }]}>
        <TouchableOpacity
          style={s.hIcon}
          activeOpacity={0.7}
          accessibilityLabel="我的账户"
          onPress={() => navigation.navigate('Profile')}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HEAD_INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={8.2} r={3.6} />
            <Path d="M4.8 20c1-3.6 3.8-5.6 7.2-5.6s6.2 2 7.2 5.6" />
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.hIcon}
          activeOpacity={0.7}
          accessibilityLabel="设置"
          onPress={() => navigation.navigate('Settings')}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HEAD_INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={12} r={3.2} />
            <Path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9" />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* 「今日状态」白色标题：★ 2026-10-18 用户要求改白色、放到指标卡行上方。
          位置在渐变 94% 不透明深色线（0.31×height）附近，白字可读。
          ★ 第二十六轮：字号 25→28、位置再往上 8px（用户："字大一些，位置再往上一点"）。
          ★ 第三十轮：仅标题再上移 12px（-38→-50，卡行不动；用户："今日状态这几个字位置再往上"）。
          ★ 第三十一轮：再上移 12px（-50→-62；用户："今日状态位置再往上放一点"）。 */}
      <Text style={[s.cardTitle, { top: chipRowTop - 62 }]}>今日状态</Text>

      {/* 扁平浅弧双弧（Oura 风格，去月相）——外白弧=恢复分、内金弧=周期天数；整区可点 → 全天状态趋势。
          ★ 2026-10-18 用户拍板：用双弧样式、不要月相标识（design/oura-dual-arc-nomoon.html A 版）。 */}
      <TouchableOpacity
        style={[s.gaugeZone, { top: gaugeTop }]}
        activeOpacity={0.85}
        accessibilityLabel="查看全天状态趋势详情"
        onPress={() => navigation.navigate('StatusTrendDetail')}
      >
        <View style={s.arcWrap}>
          {/* 只裁弧本体：viewBox y 从 96 起（弧顶 100.5 上留 4.5 余量），裁掉上方 ~90px 空白 */}
          <Svg width={350} height={68} viewBox="0 96 390 76">
            {/* 外弧轨道 */}
            <Path d={arcPath(-ARC_HALF, ARC_HALF, ARC_R)} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2.5} strokeLinecap="round" />
            {/* 外弧进度（白） */}
            <Path d={arcPath(-ARC_HALF, -ARC_HALF + ARC_SWEEP * (82 / 100), ARC_R)} fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
            {/* 内弧轨道（金） */}
            <Path d={arcPath(-ARC_HALF, ARC_HALF, ARC_RI)} fill="none" stroke="rgba(214,194,131,0.28)" strokeWidth={2.5} strokeLinecap="round" />
            {/* 内弧进度（金） */}
            <Path d={arcPath(-ARC_HALF, -ARC_HALF + ARC_SWEEP * (14 / 28), ARC_RI)} fill="none" stroke={GOLD} strokeWidth={2.5} strokeLinecap="round" />
            {/* 外弧进度端点白点 */}
            <Circle cx={tipR.x} cy={tipR.y} r={4.5} fill="#FFFFFF" />
            {/* 端点刻度 0 / 100 */}
            <SvgText x={lEnd.x - 4} y={lEnd.y + 16} fontSize={11} fill="rgba(255,255,255,0.45)" fontWeight="500">0</SvgText>
            <SvgText x={rEnd.x - 16} y={rEnd.y + 16} fontSize={11} fill="rgba(255,255,255,0.45)" fontWeight="500">100</SvgText>
          </Svg>
        </View>
        {/* 弧下方（Oura 结构 + 白底版状态词）：状态档位词 → 82 → 周期。
            ★ 第三十四轮（用户）：圆弧下写状态词（白底版四档：元气满满/状态良好/平平静静/休息一下，
            按 82 分→元气满满，颜色与圆环同源），下面写 82，下面只留「周期第 14 天」；
            去掉「恢复状态」「恢复优秀」；整块上提（离卡行更近）。 */}
        <View style={s.gaugeInfo}>
          <View style={s.gMoodRow}>
            <Text style={[s.gMood, { color: moodColor }]}>{moodLabel}</Text>
            <Svg width={13} height={22} viewBox="0 0 13 22">
              <Path d="M2 2 L10 11 L2 20" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
          <Text style={[s.gBig, { color: moodColor }]}>82</Text>
          <Text style={s.gDesc}>周期第 14 天</Text>
        </View>
      </TouchableOpacity>

      {/* 指标卡行：横向滑动（★ 2026-10-18 用户："卡片展示四个，最后一个滑动可看"）。
          首屏 4 张 84×96 大卡（大字），第 5 张滑动可见；snapToInterval 逐张吸附；
          位置在海浪/深色交界线正下方（过渡区深色渐变带上）。每张可点进对应详情页。 */}
      <View style={[s.chipRowZone, { top: chipRowTop, height: CHIP_H }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={CHIP_W + CHIP_GAP}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: 16, gap: CHIP_GAP }}
        >
          {CHIPS.map((c) => (
            <TouchableOpacity
              key={c.label}
              style={[s.chip, { width: CHIP_W }]}
              activeOpacity={0.7}
              accessibilityLabel={`${c.label} ${c.value}`}
              onPress={() => c.go(navigation)}
            >
              <View style={s.chipIcon}>{c.icon}</View>
              <Text style={s.chipLabel}>{c.label}</Text>
              <View style={s.chipValRow}>
                <Text style={[s.chipVal, c.good && s.chipValGood]}>{c.value}</Text>
                {c.unit ? <Text style={s.chipUnit}>{c.unit}</Text> : null}
              </View>
              <Text style={s.chipTag}>{c.tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {/* 右侧渐隐带：提示"还有卡片，向左滑动"（pointerEvents 放过触摸） */}
        <LinearGradient
          colors={['rgba(42,68,112,0)', 'rgba(42,68,112,0.92)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.chipFade}
          pointerEvents="none"
        />
      </View>

      {/* AI 分析卡：沉底（避开真 tab 栏）★ 2026-10-18 第二十六→二十七轮（用户）：
          改语音气泡——右下角逐出白版同款圆角小尾巴（尖朝右下，参考 5b22460
          白玻璃气泡 HomeAiBubble：底边两点汇聚成尖 + strokeLinejoin/cap round）。
          第二十七轮：去掉骑角的紫色圆环头像（用户："不是要那个东西"），尾巴即终点。 */}
      <View style={[s.aiCard, { bottom: aiBottom }]}>
        <Text style={s.analysis}>
          恢复得不错，<Text style={s.hl}>82 分</Text>比平时高一点，压力也低，别浪费今天的好状态～
        </Text>
        <View style={s.sug}>
          <Image source={THUMB_RELAX} style={s.sugThumb} />
          <View style={{ flex: 1 }}>
            <Text style={s.sugH}>3 分钟呼吸放松</Text>
            <Text style={s.sugD}>开会前把心率平一下</Text>
          </View>
          <View style={s.goPill}>
            <Text style={s.goTxt}>去呼吸 ›</Text>
          </View>
        </View>
        {/* 气泡尾巴：白版（5b22460 HomeAiBubble）同款几何——
           卡底边两点 (b0,b1) 汇聚到下方尖端 tip，strokeLinejoin/cap=round 出圆角尖；
           Svg 60×12、right:16 bottom:-9 → 顶缘 y=0..3 在卡内被底边盖住，y=3 即卡底边，
           尖伸出卡外 9px；tip 略右偏（相对 b0b1 中点 +2）指向右下。 */}
        <Svg
          width={60}
          height={12}
          viewBox="0 0 60 12"
          style={{ position: 'absolute', right: 16, bottom: -9 }}
          pointerEvents="none"
        >
          <Path
            d="M16 3 L36 12 L32 3"
            fill={AI_CARD_BG}
            stroke={AI_CARD_BG}
            strokeWidth={1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 顶部头栏：左 = 账户 icon；右 = 设置 icon
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  hIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 「今日状态」白色标题：★ 2026-10-18 用户要求改白色、放到指标卡行上方（过渡区深色带上）。
  // ★ 第二十五轮：字号 21→25；★ 第二十六轮：25→28 再加大 + 投影加深（用户："字大一些"）。
  cardTitle: {
    position: 'absolute',
    left: 16,
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(20,44,64,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },

  // 指标方卡（Oura 式玻璃卡：icon + label + 值 + tag；84×96 大字版，横向滑动 4+1）
  chipRowZone: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  chipFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 26,
  },
  chip: {
    height: CHIP_H,
    borderRadius: 16,
    paddingTop: 9,
    paddingBottom: 8,
    paddingHorizontal: 2,
    backgroundColor: GLASS_BG,
    borderColor: GLASS_BD,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  chipIcon: { marginBottom: 3 },
  chipLabel: { fontSize: 11.5, fontWeight: '500', color: 'rgba(255,255,255,0.62)', letterSpacing: 0.1 },
  chipValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  chipVal: { fontSize: 20, fontWeight: '700', color: '#fff' },
  chipValGood: { color: '#D5E384' },
  chipUnit: { fontSize: 10.5, color: 'rgba(255,255,255,0.62)', marginLeft: 1.5 },
  chipTag: { fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  // 扁平浅弧双弧区（Oura 风格，去月相）：整区居中、可点
  gaugeZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // 弧包裹：宽 350、只裁弧本体（viewBox y 96-172 → 高 76，缩放后 68）
  arcWrap: {
    alignSelf: 'center',
  },
  // 弧下文字块：状态词 → 82 → 周期（全部顺排，不叠字）
  gaugeInfo: {
    alignItems: 'center',
    marginTop: 4,
  },
  gMoodRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  gMood: { fontSize: 22, fontWeight: '600', letterSpacing: 0.5 },
  gBig: { fontSize: 48, fontWeight: '700', letterSpacing: -1.5, marginTop: 4, textShadowColor: 'rgba(20,44,64,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  gDesc: { fontSize: 13.5, fontWeight: '300', color: 'rgba(255,255,255,0.65)', marginTop: 8, lineHeight: 20, textAlign: 'center' },

  // AI 分析卡（Oura 配色：深板岩玻璃 + 长春花蓝点缀）；★ 2026-10-18：改语音气泡，底色走 AI_CARD_BG 常量（尾巴同色）
  aiCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    paddingBottom: 15,
    paddingHorizontal: 17,
    borderRadius: 20,
    backgroundColor: AI_CARD_BG,
    borderColor: 'rgba(255,255,255,0.17)',
    borderWidth: 1,
  },
  analysis: { fontSize: 16.5, lineHeight: 24, color: 'rgba(255,255,255,0.92)', marginBottom: 12 },
  hl: { fontWeight: '700', color: '#BFCBFF' },
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  sugThumb: { width: 56, height: 56, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  sugH: { fontSize: 17, fontWeight: '600', color: '#fff' },
  sugD: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  goPill: { backgroundColor: 'rgba(160,178,255,0.95)', borderRadius: 999, paddingHorizontal: 15, paddingVertical: 7 },
  goTxt: { fontSize: 14.5, fontWeight: '600', color: '#101C33' },
});
