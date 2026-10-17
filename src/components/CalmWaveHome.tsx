/**
 * Calm 式海浪首页（真机预览版 · 2026-10-17）
 * 结构对齐根目录 home-calm-wave.html：
 *   上 1/3 海浪视频（已用 ffmpeg 裁掉内嵌 UI）→ 蓝→蓝紫渐变 →
 *   chips（2×3 网格，可点击进详情）→ Oura 式细弧半圆环（可点击）→ AI 分析卡沉底。
 * 纯静态预览数据，不接健康数据；
 * 预览开关在 BottomTabNavigator（USE_CALM_WAVE_HOME），改回 false 即恢复原 TodayScreen。
 *
 * ★ 2026-10-17 第十一轮（用户）：补齐「生理周期 / 身体负荷」两张卡（与白底版 6 卡对齐）；
 *   chips / 半圆环全部可点 → 跳对应详情页（与 TodayScreen 同款路由目标）。
 */
import React from 'react';
import { View, Text, StyleSheet, Image, useWindowDimensions, StatusBar, TouchableOpacity } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback } from 'react';
import Svg, { Path, Circle } from 'react-native-svg';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;

const WAVE_VIDEO = require('../assets/wave-video.mp4');
const THUMB_RELAX = require('../assets/card_relax.jpg');

const GLASS_BG = 'rgba(255,255,255,0.13)';
const GLASS_BD = 'rgba(255,255,255,0.28)';
const PAGE_BG = '#2B3564'; // 渐变末端：Calm 式深蓝紫

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
  { label: '睡眠恢复', value: '82', tag: '恢复良好', good: true, icon: lineIcon('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'), go: (n) => n.navigate('SleepDetail') },
  { label: '脑力准备度', value: '64', tag: '准备度中', icon: lineIcon(['M12 3a4.2 4.2 0 0 0-4.2 4.2c-1.9.6-3.3 2.4-3.3 4.5 0 1.6.8 3 2 3.9v2.1a3.3 3.3 0 0 0 3.3 3.3h4.4a3.3 3.3 0 0 0 3.3-3.3v-2.1a4.8 4.8 0 0 0 2-3.9c0-2.1-1.4-3.9-3.3-4.5A4.2 4.2 0 0 0 12 3Z', 'M9.5 13.5 11 12l1.5 1.5L14 12']), go: (n) => n.navigate('EnergyDetail', { type: 'cognitive' }) },
  { label: '压力水平', value: '38', tag: '压力偏低', good: true, icon: lineIcon('M3 12h3l2-4.5 3 9 2.5-6.5 1.5 2h6'), go: (n) => n.navigate('EnergyDetail', { type: 'emotion' }) },
  { label: '活动消耗', value: '320', unit: 'kcal', tag: '达成55%', icon: lineIcon(['M12 3c2.8 2.6 4.2 5.1 4.2 7.4a4.2 4.2 0 0 1-8.4 0C7.8 8.1 9.2 5.6 12 3Z', 'M8 17.5h8M9.5 20.5h5']), go: (n) => n.navigate('EnergyDetail', { type: 'activity' }) },
  { label: '生理周期', value: '第14天', tag: '黄体期', icon: lineIcon(['M12 3.2a8.8 8.8 0 1 0 8.8 8.8', 'M12 7.2a4.8 4.8 0 0 1 0 9.6']), go: (n) => n.navigate('CycleCalendar') },
  { label: '身体负荷', value: '46', tag: '负荷适中', icon: lineIcon('M13 2.5 4.8 13.6h6L9.6 21.5 19.2 10h-6.2L13 2.5Z'), go: (n) => n.navigate('MetricDetail', { key: 'stress', name: '压力', unit: '', yMin: 0, yMax: 100 }) },
];

const CHIP_H = 74;
const CHIP_GAP = 8;
// 注：icon 为白色细线 SVG（Oura 式），无圆底

export default function CalmWaveHome() {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();
  // ★ mira-ocean：视频+深底 → 状态栏亮图标（失焦恢复，避免影响其它白底 tab）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));
  // 渐变交界线（海浪 → 深色）= 屏幕高的 34%，与 HTML 渐变 stops 对齐
  const transitionY = height * 0.34;
  // chips：2×3 网格（单卡宽 = (屏宽 − 左右留白 − 2×gap) / 3）
  const chipW = (width - 32 - 2 * CHIP_GAP) / 3;
  const chipsH = CHIP_H * 2 + CHIP_GAP;
  // 半圆环贴 chips 下缘；AI 卡贴在真 tab 上方
  const gaugeTop = transitionY - 10 + chipsH + 12;
  // ★ 2026-10-17 用户：建议卡就在 tab 上方（tab 胶囊顶 = insets.bottom + 56，再留 12 间距）。
  //   注意：absolute 定位 bottom 值越大卡片越高——上一轮 76→112 是改反了方向。
  const aiBottom = insets.bottom + 68;

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

      {/* 顶部：用户账户 / 今日状态 / 设置（浮在海浪上；账户→我的 tab，设置→Settings） */}
      <View style={[s.head, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          style={s.hIcon}
          activeOpacity={0.7}
          accessibilityLabel="我的账户"
          onPress={() => navigation.navigate('Profile')}
        >
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={8.2} r={3.6} />
            <Path d="M4.8 20c1-3.6 3.8-5.6 7.2-5.6s6.2 2 7.2 5.6" />
          </Svg>
        </TouchableOpacity>
        <Text style={s.titleC}>今日状态</Text>
        <TouchableOpacity
          style={s.hIcon}
          activeOpacity={0.7}
          accessibilityLabel="设置"
          onPress={() => navigation.navigate('Settings')}
        >
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={12} r={3.2} />
            <Path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9" />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* chips：2×3 网格贴渐变交界线下方，每张可点进对应详情页 */}
      <View style={[s.chips, { top: transitionY - 10 }]}>
        {CHIPS.map((c) => (
          <TouchableOpacity
            key={c.label}
            style={[s.chip, { width: chipW }]}
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
      </View>

      {/* Oura 式细弧半圆环（进度末端白点 + 光晕，中心大数字；整环可点 → 全天状态趋势） */}
      <TouchableOpacity
        style={[s.gaugeZone, { top: gaugeTop }]}
        activeOpacity={0.85}
        accessibilityLabel="查看全天状态趋势详情"
        onPress={() => navigation.navigate('StatusTrendDetail')}
      >
        <View style={s.gauge}>
          <Svg width="100%" height="100%" viewBox="0 0 240 128">
            <Path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={5} strokeLinecap="round" />
            <Path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" strokeDasharray="258 314" />
            <Circle cx={204.4} cy={66.4} r={9} fill="rgba(255,255,255,0.20)" />
            <Circle cx={204.4} cy={66.4} r={4.5} fill="#FFFFFF" />
          </Svg>
          <View style={s.gaugeCenter}>
            <Text style={s.gBig}>82</Text>
            <Text style={s.gLabel}>状态良好</Text>
            <Text style={s.gUpd}>更新于 11:30</Text>
          </View>
        </View>
        {/* ★ mira-ocean（2026-10-17 用户）：今日状态 = 可进详情，环旁加向右箭头提示 */}
        <Svg width={13} height={22} viewBox="0 0 13 22" style={{ marginLeft: 2 }}>
          <Path d="M2 2 L10 11 L2 20" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </TouchableOpacity>

      {/* AI 分析卡：沉底（避开真 tab 栏） */}
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
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 顶部头栏
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
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleC: { fontSize: 17, fontWeight: '600', color: '#fff', letterSpacing: 0.5, textShadowColor: 'rgba(20,44,64,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 12 },

  // chips（2×3 网格，Oura 式玻璃矮卡：icon + label + 值 + tag）
  chips: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CHIP_GAP,
  },
  chip: {
    height: CHIP_H,
    borderRadius: 16,
    paddingTop: 9,
    paddingBottom: 7,
    paddingHorizontal: 2,
    backgroundColor: GLASS_BG,
    borderColor: GLASS_BD,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  chipIcon: { marginBottom: 2 },
  chipLabel: { fontSize: 10.5, fontWeight: '500', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.2 },
  chipValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  chipVal: { fontSize: 17, fontWeight: '700', color: '#fff' },
  chipValGood: { color: '#D5E384' },
  chipUnit: { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginLeft: 1 },
  chipTag: { fontSize: 9.5, color: 'rgba(255,255,255,0.47)', marginTop: 2 },

  // 半圆环
  gaugeZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gauge: { width: 270, height: 144 },
  gaugeCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -6,
    alignItems: 'center',
  },
  gBig: { fontSize: 46, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(20,44,64,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  gLabel: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 5, fontWeight: '500' },
  gUpd: { fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  // AI 分析卡（Oura 配色：深板岩玻璃 + 长春花蓝点缀）
  aiCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 16,
    paddingBottom: 15,
    paddingHorizontal: 17,
    borderRadius: 20,
    backgroundColor: 'rgba(9,28,48,0.52)',
    borderColor: 'rgba(255,255,255,0.17)',
    borderWidth: 1,
  },
  analysis: { fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.92)', marginBottom: 12 },
  hl: { fontWeight: '700', color: '#BFCBFF' },
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  sugThumb: { width: 50, height: 50, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  sugH: { fontSize: 15, fontWeight: '600', color: '#fff' },
  sugD: { fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  goPill: { backgroundColor: 'rgba(160,178,255,0.95)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  goTxt: { fontSize: 13, fontWeight: '600', color: '#101C33' },
});
