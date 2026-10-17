/**
 * Calm 式海浪首页（真机预览版 · 2026-10-17）
 * 结构对齐根目录 home-calm-wave.html：
 *   上 1/3 海浪视频（已用 ffmpeg 裁掉内嵌 UI）→ 蓝→蓝紫渐变 →
 *   chips 贴交界线下 → Oura 式细弧半圆环 → AI 分析卡沉底。
 * 纯静态预览数据（82/64/38/320kcal），不接健康数据；
 * 预览开关在 BottomTabNavigator（USE_CALM_WAVE_HOME），改回 false 即恢复原 TodayScreen。
 */
import React from 'react';
import { View, Text, StyleSheet, Image, useWindowDimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';

const WAVE_VIDEO = require('../assets/wave-video.mp4');
const THUMB_RELAX = require('../assets/card_relax.jpg');

const GLASS_BG = 'rgba(255,255,255,0.13)';
const GLASS_BD = 'rgba(255,255,255,0.28)';
const PAGE_BG = '#2B3564'; // 渐变末端：Calm 式深蓝紫

type Chip = { label: string; value: string; unit?: string; tag: string; good?: boolean };
const CHIPS: Chip[] = [
  { label: '睡眠恢复', value: '82', tag: '恢复良好', good: true },
  { label: '脑力准备度', value: '64', tag: '准备度中' },
  { label: '压力水平', value: '38', tag: '压力偏低', good: true },
  { label: '活动消耗', value: '320', unit: 'kcal', tag: '达成55%' },
];

const CHIP_H = 76;
const CHIP_GAP = 9;

export default function CalmWaveHome() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 渐变交界线（海浪 → 深色）= 屏幕高的 34%，与 HTML 渐变 stops 对齐
  const transitionY = height * 0.34;

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

      {/* 顶部：用户账户 / 今日状态 / 设置（浮在海浪上） */}
      <View style={[s.head, { paddingTop: insets.top + 10 }]}>
        <View style={s.hIcon}>
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={8.2} r={3.6} />
            <Path d="M4.8 20c1-3.6 3.8-5.6 7.2-5.6s6.2 2 7.2 5.6" />
          </Svg>
        </View>
        <Text style={s.titleC}>今日状态</Text>
        <View style={s.hIcon}>
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={12} r={3.2} />
            <Path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9" />
          </Svg>
        </View>
      </View>

      {/* chips：贴渐变交界线下方 */}
      <View style={[s.chips, { top: transitionY + 6 }]}>
        {CHIPS.map((c) => (
          <View key={c.label} style={s.chip}>
            <Text style={s.chipLabel}>{c.label}</Text>
            <View style={s.chipValRow}>
              <Text style={[s.chipVal, c.good && s.chipValGood]}>{c.value}</Text>
              {c.unit ? <Text style={s.chipUnit}>{c.unit}</Text> : null}
            </View>
            <Text style={s.chipTag}>{c.tag}</Text>
          </View>
        ))}
      </View>

      {/* Oura 式细弧半圆环（进度末端白点 + 光晕，中心大数字） */}
      <View pointerEvents="none" style={[s.gaugeZone, { top: transitionY + 6 + CHIP_H + 26 }]}>
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
      </View>

      {/* AI 分析卡：沉底（避开真 tab 栏） */}
      <View style={[s.aiCard, { bottom: insets.bottom + 68 }]}>
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

  // chips（Oura 式玻璃矮卡：label + 值 + tag，无图标）
  chips: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: CHIP_GAP,
  },
  chip: {
    flex: 1,
    height: CHIP_H,
    borderRadius: 18,
    paddingTop: 11,
    paddingBottom: 9,
    paddingHorizontal: 4,
    backgroundColor: GLASS_BG,
    borderColor: GLASS_BD,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
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
    alignItems: 'center',
  },
  gauge: { width: 206, height: 110 },
  gaugeCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -6,
    alignItems: 'center',
  },
  gBig: { fontSize: 34, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(20,44,64,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  gLabel: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 5, fontWeight: '500' },
  gUpd: { fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  // AI 分析卡（Oura 配色：深板岩玻璃 + 长春花蓝点缀）
  aiCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 12,
    paddingBottom: 11,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: 'rgba(9,28,48,0.52)',
    borderColor: 'rgba(255,255,255,0.17)',
    borderWidth: 1,
  },
  analysis: { fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.92)', marginBottom: 8 },
  hl: { fontWeight: '700', color: '#BFCBFF' },
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  sugThumb: { width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  sugH: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  sugD: { fontSize: 10.5, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  goPill: { backgroundColor: 'rgba(160,178,255,0.95)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  goTxt: { fontSize: 11, fontWeight: '600', color: '#101C33' },
});
