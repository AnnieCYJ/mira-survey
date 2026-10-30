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
import { theme } from '../theme/theme';
import { sleepRecoveryScoreForDay } from '../lib/sleepPersonalized';
import { RingBle } from '../ble/RingBleManager';
import { dayKey } from '../data/healthStore';
import { computeEmotionalStress, MIN_BASELINE_DAYS as ES_MIN_BASELINE_DAYS } from '../lib/emotionalStress';
import { computeStressReport } from '../lib/stressAlgorithm';
import { estimateVo2maxFromStore } from '../lib/vo2max';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as AsyncStorage from '../utils/prefs'; // ★ 2026-10-18：Expo Go 无 AsyncStorage 原生模块，改用 file-system 版同接口 KV
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur'; // ★ 2026-10-30（用户要真·磨砂玻璃）：对标题下方海浪视频做真实高斯模糊
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';
import AvatarStack from './AvatarStack';

type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;

const WAVE_VIDEO = require('../assets/wave-video.mp4');
const WAVE_SOUND = require('../assets/wave-sound.mp3'); // ★ 2026-10-18 用户：海浪白噪音（FFmpeg 合成 30s 无缝循环）
const THUMB_RELAX = require('../assets/card_relax.jpg');

const GLASS_BG = 'rgba(255,255,255,0.13)';
const GLASS_BD = 'rgba(255,255,255,0.28)';
// ★ 2026-10-30（用户：首页底部由蓝改黑，避免与其它页蓝不一致；改用与 tab 栏/AI 卡同款的近黑深板岩，三者同色不冲突）
const HOME_BOTTOM_RGB = '9,28,48';                 // 首页底部近黑深板岩 = 自定义 tab 栏 leftCard / AI 卡同款，确保无缝
const PAGE_BG = `rgba(${HOME_BOTTOM_RGB},1)`;       // 根背景兜底（视频下方实色区同色）
// ★ 2026-10-18 用户：头栏图标与「今日状态」标题改明显的深色（浮在浅色海浪视频上）
const HEAD_INK = 'rgba(16,36,58,0.88)';
// AI 建议卡（语音气泡）底色——尾巴 SVG 与卡身同色
const AI_CARD_BG = 'rgba(9,28,48,0.52)';
// ★ 2026-10-18：扁平浅弧双弧配色——外弧=状态分（按当前档位染色，如 82→黄），
//   内弧=周期天数（白色）；"有颜色的那条=状态分、白的那条=周期"，不再混淆。
//   ★ 本轮：状态分档位色——0–25 淡粉 / 26–50 紫 / 51–75 绿 / 76–100 黄。

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
// hex → rgba（给状态弧轨道加透明，与进度同色系）
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
// 周期天数 + 四期模型（经期1–7 / 卵泡期8–13 / 排卵期14–21 / 黄体期22–28）；
// 第14天 → 排卵期。若改用两期模型（卵泡期/黄体期），改此函数即可。
const CYCLE_DAY = 14;
const CYCLE_LEN = 28;
function cyclePhase(day: number) {
  if (day <= 7) return '经期';
  if (day <= 13) return '卵泡期';
  if (day <= 21) return '排卵期';
  return '黄体期';
}
// 海浪声音开关的存储 key（与 SettingsScreen 共用）
const WAVE_SOUND_KEY = 'waveSound';

type ChipDef = {
  key: string;
  label: string;
  icon: JSX.Element;
  /** 点击目标（与白底版 TodayScreen 同款路由） */
  go: (nav: NavProp) => void;
};
const lineIcon = (d: string | string[]) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d) ? d : [d]).map((p, i) => <Path key={i} d={p} />)}
  </Svg>
);
// ★ 2026-10-26（用户）：卡片的 value/tag/unit/good 不再写死，改为组件内接真实数据（见下方 chipDyn）。
//   这里只保留静态元数据（顺序/图标/路由），顺序：睡眠恢复 → 身体负荷 → 情绪 → 活动消耗 → 生理周期。
const CHIP_DEFS: ChipDef[] = [
  { key: 'recovery', label: '睡眠恢复', icon: lineIcon('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'), go: (n) => n.navigate('SleepDetail') },
  { key: 'load', label: '身体负荷', icon: lineIcon('M13 2.5 4.8 13.6h6L9.6 21.5 19.2 10h-6.2L13 2.5Z'), go: (n) => n.navigate('MetricDetail', { key: 'stress', name: '身体负荷', unit: '/100', yMin: 0, yMax: 100 }) },
  // ★ 2026-10-18 用户：「压力水平」改名「情绪」（路由目标不变 → EnergyDetail emotion）
  { key: 'emo', label: '情绪', icon: lineIcon('M3 12h3l2-4.5 3 9 2.5-6.5 1.5 2h6'), go: (n) => n.navigate('EnergyDetail', { type: 'emotion' }) },
  { key: 'act', label: '活动消耗', icon: lineIcon(['M12 3c2.8 2.6 4.2 5.1 4.2 7.4a4.2 4.2 0 0 1-8.4 0C7.8 8.1 9.2 5.6 12 3Z', 'M8 17.5h8M9.5 20.5h5']), go: (n) => n.navigate('EnergyDetail', { type: 'activity' }) },
  { key: 'cycle', label: '生理周期', icon: lineIcon(['M12 3.2a8.8 8.8 0 1 0 8.8 8.8', 'M12 7.2a4.8 4.8 0 0 1 0 9.6']), go: (n) => n.navigate('CycleCalendar') },
  { key: 'cardio', label: '心肺能力', icon: lineIcon('M12 21s-7.5-4.6-10-9.3C.6 8.3 2.3 5 5.5 5c1.9 0 3.2 1 4.5 2.6C11.3 6 12.6 5 14.5 5 17.7 5 19.4 8.3 22 11.7 19.5 16.4 12 21 12 21Z'), go: (n) => n.navigate('CardioDetail') },
  // 「脑力准备度」按用户要求隐藏（2026-10-17 改花瓣布局只留 5 张）；要恢复：取消下行注释
  // { key: 'cognitive', label: '脑力准备度', icon: lineIcon(['M12 3a4.2 4.2 0 0 0-4.2 4.2c-1.9.6-3.3 2.4-3.3 4.5 0 1.6.8 3 2 3.9v2.1a3.3 3.3 0 0 0 3.3 3.3h4.4a3.3 3.3 0 0 0 3.3-3.3v-2.1a4.8 4.8 0 0 0 2-3.9c0-2.1-1.4-3.9-3.3-4.5A4.2 4.2 0 0 0 12 3Z', 'M9.5 13.5 11 12l1.5 1.5L14 12']), go: (n) => n.navigate('EnergyDetail', { type: 'cognitive' }) },
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
  // ★ 2026-10-26（用户）：首页 5 张指标卡改为接真实数据（之前 4 张写死静态预览值）。
  //   订阅 RingBle 实时状态，数据推送/重连即刷新卡片；派生值口径与 TodayScreen 顶部 chips 同源。
  const [ring, setRing] = useState(() => RingBle.getState());
  useEffect(() => RingBle.onState((s) => setRing(s)), []);
  // ★ 2026-10-26（修复「今日状态一直不更新」）：圆环恢复分 / 压力 / 情绪 都从 healthStore 读取，
  //   而 healthStore 在戒指回填写入后只增 version、不会自动触发本组件重渲染 —— 故显式订阅其版本，
  //   每次同步/回填完成即重算首页数据（与 InsightScreen / MetricDetail / CognitiveLoadCard 同源机制）。
  useHealthStoreVersion();
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
  // 扁平浅弧两端坐标（供端点刻度 0 / 100 定位）
  const lEnd = arcPt(-ARC_HALF, ARC_R);
  const rEnd = arcPt(ARC_HALF, ARC_R);
  // ★ 第三十四轮：白底版「今日状态」四档词（DailyStatusCard 同源）：
  //   元气满满 ≥76 / 状态良好 51–75 / 平平静静 26–50 / 休息一下 0–25，颜色与圆环同源。
  //   ★ 本轮：0–25 改淡粉（白底版），其余 紫/绿/黄 不变。
  //   ★ 2026-10-21（用户：圆弧下的数不能一直 82）：改用与睡眠节律卡 / SleepCard 同源的
  //     今日恢复分（sleepRecoveryScoreForDay），数据随模拟日变化；取不到时回落 82。
  // ★ 2026-10-26（用户）：今日恢复分必须「随天清零」—— 今天若没有任何恢复数据（新的一天 / 没戴戒指），
  //   一律显示「暂无数据」，不再写死兜底 82 + 元气满满。取数本身按天（Date.now() 当日），
  //   24:00 跨天后自动回到空态，无需额外定时器。
  // 恢复分（睡眠指标，下沉到卡片行「睡眠恢复」）—— 仅供下方卡片行展示，不再作为首页「今日状态」大数字
  const recoveryScore = sleepRecoveryScoreForDay(Date.now());
  const hasRecoveryData = recoveryScore != null;
  const RECOVERY = hasRecoveryData ? Math.round(recoveryScore) : 0;
  // ★ 2026-10-26：首页指标卡全部接真实数据（替代原写死的静态预览值 82/46/38/320/第14天）。
  //   口径与 TodayScreen 顶部 chips 同源：
  //   · 睡眠恢复 → sleepRecoveryScoreForDay（上方已算）
  //   · 身体负荷 → 基础指标压力信号 ring.metrics['stress'] / ring.daily['stress']（与 MetricDetail stress 同源）
  //   · 情绪     → emotionalStress 百分位 stressScale.value（与 EnergyDetail emotion 同源）
  //   · 活动消耗 → 运动段 totalCal 优先，否则当日计步 calorie（与运动消耗卡同源）
  //   · 生理周期 → curveStatus.phaseLabel / dayInCycle（与周期卡同源）
  //   任一项无数据 / 断流 / 校准无效 → 显「—」+「暂无数据 / 建立基线中」，不编数字。
  const status = ring.curveStatus;
  // ★ 2026-10-28（修复：原样输出浮点原始值导致 33.645316484174145 这种一长串小数）：
  //   状态分取整显示（与弧进度/档位词口径统一），不再露原始浮点。
  // ★ 2026-10-28（用户：首页「今日状态」大数字须为状态曲线值，与详情页同源；恢复分=睡眠，已下沉到卡片行「睡眠恢复」）
  const CV = status?.value != null ? Math.round(status.value) : null;
  const CV_STALE = status?.dataStale ?? true;
  const hasStatusData = CV != null && !CV_STALE;
  const EMPTY_COLOR = theme.colors.stateEnergy; // 空态统一紫（与 EnergyBall 圆环同源）
  const mood = !hasStatusData
    ? { label: '暂无数据', color: EMPTY_COLOR }
    : CV >= 76 ? { label: '元气满满', color: '#F0C46E' }
    : CV >= 51 ? { label: '状态良好', color: '#BCCB62' }
    : CV >= 26 ? { label: '平平静静', color: '#9D8AF0' }
    : { label: '休息一下', color: '#F0B5C4' };
  const moodLabel = mood.label;
  const moodColor = mood.color;
  const dkToday = dayKey(Date.now());
  // ★ sportSessions 是跨天持久化列表（固件回传+本地归档），不能整体累加；
  //   活动消耗只统计「今天」的运动段 totalCal，与活动详情页（EnergyDetail dayK === dk）同口径。
  const sportSessions = ring?.sportSessions ?? null;
  const stepsToday = ring?.stepDaily?.[dkToday]?.steps ?? 0;
  const stepKcalToday = ring?.stepDaily?.[dkToday]?.calorie ?? 0;
  const activityHasData = stepsToday > 0;
  const todaysSessions = (ring?.sportSessions ?? []).filter((s: any) => dayKey(s.beginTime) === dkToday);
  const hasTodaySport = todaysSessions.length > 0;
  const actKcal = hasTodaySport
    ? Math.round(todaysSessions.reduce((a: number, s: any) => a + (s.totalCal || 0), 0))
    : (activityHasData ? Math.round(stepKcalToday) : null);

  // 身体负荷：与「基础指标 → 压力」卡同源 —— 设备 SDK 压力信号经 stressAlgorithm 算出的当前压力分（0–100，越高越紧张）。
  // ★ 2026-10-26 修复：此前误用 ring.metrics['stress']，但 RingBle 的 metrics 只填 hr/hr，daily 也不含 stress，
  //   该字段恒为 null → 身体负荷卡永远「— / 暂无数据」；改用 computeStressReport().score（与 MetricDetail「压力」卡同源）。
  const stressReport = (() => { try { return computeStressReport(Date.now()); } catch { return null; } })();
  const bodyLoad = stressReport?.score ?? null;

  // 情绪：emotionalStress 多信号融合（0–100，50=和平时差不多；越高压力越大）
  const esReport = (() => {
    try { return computeEmotionalStress(Date.now(), sportSessions); } catch { return null; }
  })();
  const emoValue = (() => {
    try {
      if ((status as any)?.dataStale) return null;
      if (!esReport || !esReport.stressScale) return null;
      if (esReport.baselineDays == null || esReport.baselineDays < ES_MIN_BASELINE_DAYS) return null;
      if (esReport.calibration?.level === 'invalid') return null;
      return esReport.stressScale.value;
    } catch { return null; }
  })();

  // 生理周期
  const dayInCycle = status?.dayInCycle ?? null;
  const phaseLabel = status?.phaseLabel ?? null;
  // ★ 2026-10-27 修复：双弧周期药丸此前写死 CYCLE_DAY=14，与上方真实「生理周期」卡不一致；
  //   改用真实周期日（无记录时回退 14），让弧与卡口径统一。
  const cycleDay = dayInCycle ?? CYCLE_DAY;
  const cyclePhaseNow = phaseLabel && phaseLabel !== '未记录' ? phaseLabel : cyclePhase(cycleDay);

  // 心肺能力（VO₂max）：权威非运动估算法（Jackson 1990 + Uth 心率比法交叉），详见 lib/vo2max.ts。
  const vo2 = (() => { try { return estimateVo2maxFromStore(Date.now()); } catch { return null; } })();

  // 各卡展示数据（value / unit / tag / good）
  const chipDyn: Record<string, { value: string; unit?: string; tag: string; good?: boolean }> = {
    recovery: {
      value: hasRecoveryData ? String(RECOVERY) : '—',
      unit: hasRecoveryData ? '/100' : undefined,
      tag: !hasRecoveryData ? '暂无数据'
        : RECOVERY >= 76 ? '恢复良好'
        : RECOVERY >= 51 ? '恢复较好'
        : RECOVERY >= 26 ? '恢复中'
        : '恢复偏弱',
      good: hasRecoveryData && RECOVERY >= 51,
    },
    load: {
      value: bodyLoad != null ? String(bodyLoad) : '—',
      unit: bodyLoad != null ? '/100' : undefined,
      tag: bodyLoad == null ? '暂无数据'
        : bodyLoad < 30 ? '负荷轻松'
        : bodyLoad < 55 ? '负荷适中'
        : '负荷偏重',
      good: bodyLoad != null && bodyLoad < 30,
    },
    emo: {
      value: emoValue != null ? String(emoValue) : '—',
      unit: emoValue != null ? '/100' : undefined,
      tag: emoValue == null
        ? (esReport && esReport.baselineDays < ES_MIN_BASELINE_DAYS ? '建立基线中' : '暂无数据')
        : emoValue < 35 ? '情绪轻松'
        : emoValue < 60 ? '情绪平稳'
        : '情绪偏紧',
      good: emoValue != null && emoValue < 35,
    },
    act: {
      value: actKcal != null && actKcal > 0 ? String(actKcal) : '—',
      unit: actKcal != null && actKcal > 0 ? 'kcal' : undefined,
      tag: actKcal != null && actKcal > 0 ? '今日活动' : '暂无活动',
      good: false,
    },
    cycle: {
      value: dayInCycle != null ? `第 ${dayInCycle} 天` : '—',
      unit: undefined,
      tag: phaseLabel && phaseLabel !== '未记录' ? phaseLabel : '未记录',
      good: false,
    },
    cardio: {
      value: vo2 ? String(Math.round(vo2.estimate)) : '—',
      unit: vo2 ? 'ml/kg·min' : undefined,
      tag: vo2 ? vo2.band : '暂无数据',
      good: vo2 ? vo2.bandRank >= 4 : false,
    },
  };
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
  // ★ 2026-10-20 布局实验（用户）：把「上方卡片行（睡眠恢复/身体负荷…）」与「下方双弧块（元气满满/82/周期）」
  //   位置调换——双弧 hero 上移、卡片行下移到「弧底 ↔ AI 卡顶」之间垂直居中。
  //   ▶ 还原原布局：把下面 gaugeTop / chipRowTop 两行换回——
  //     chipRowTop = transitionY - 28；gaugeTop = Math.max(chipRowTop+CHIP_H+8, chipRowTop+CHIP_H+(aiTop-chipRowTop-CHIP_H-GAUGE_H)/2)
  // ★ 2026-10-20 微调：用户"圆环+周期+下方睡眠恢复卡片整体往下移一点点"——给 gaugeTop 加
  //   TOP_OFFSET(=20)，因「今日状态」标题(gaugeTop-62)、弧块(gaugeTop)、卡行(arcBottom 派生) 全部由
  //   gaugeTop 驱动，三者会整体同步下移；卡行有 Math.min 钳位不撞 AI 卡顶。
  const TOP_OFFSET = 20;
  const gaugeTop = transitionY - 28 + TOP_OFFSET;     // 双弧块移到原卡行顶部位置 + 整体下移 20px
  const arcBottom = gaugeTop + GAUGE_H;
  // ★ 2026-10-29 蒙层策略（用户修正：参考图只有「海浪→一段过渡→底部实色」三段，不要分多层）：
  //   顶部海浪清晰，约 1/3 处起一段平滑过渡，底部纯灰蓝实色。标题靠自身文字阴影保证可读，不再单独加托底分层。
  const aiTop = height - aiBottom - aiCardH;
  const chipRowTop = Math.min(
    Math.max(arcBottom + 8, arcBottom + (aiTop - arcBottom - CHIP_H) / 2),
    aiTop - CHIP_H - 8,                              // 钳位：卡行底不撞 AI 卡顶
  );
  // ★ 2026-10-30（用户：蓝要从「今日状态」下面就开始，整体再往上提一点）：
  //   标题顶(titleFrac)=纯海浪视频零蒙层（标题靠文字阴影可读）；标题底(fadeStartFrac)=蓝从这里化入。
  //   fadeStartFrac = gaugeTop-28（标题文字高约 34，故标题底≈gaugeTop-28），即"今日状态"正下方。
  //   titleFrac 钳 [0.16,0.30]，fadeStartFrac 钳 [0.20,0.34]，兼容长短屏。
  const titleFrac = Math.min(0.30, Math.max(0.16, (gaugeTop - 62) / height));
  const fadeStartFrac = Math.min(0.34, Math.max(0.20, (gaugeTop - 28) / height));

  return (
    <View style={[s.root, { backgroundColor: PAGE_BG }]}>
      {/* ★ 2026-10-30（用户：首页底部改黑）：底层兜底 = 近黑深板岩（与 tab/AI 卡同款）。
          正常被视频 + 黑染层完全覆盖，仅作视频异常时的兜底，避免蓝/白漏底。 */}
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={['#091C30', '#091C30', '#091C30']}
        locations={[0, 0.5, 1]}
      />
      {/* 上 1/3 海浪视频（全屏铺底，渐变盖住下 2/3） */}
      <Video
        style={StyleSheet.absoluteFill}
        source={WAVE_VIDEO}
        resizeMode={ResizeMode.COVER}
        isLooping
        isMuted
        shouldPlay
        paused={!focused}
        useNativeControls={false}
      />
      {/* ★ 2026-10-30 真·磨砂玻璃 + 过渡（用户参考 Oura：标题往下视频逐渐磨砂模糊、压暗，再过渡成黑）：
          - 顶部 0~标题顶(titleFrac) 全透：海浪=原始视频，零蒙层（标题靠文字阴影可读）。
          - 标题底(fadeStartFrac) 起：① 真实高斯模糊 BlurView（expo-blur / UIVisualEffectView）对下方海浪做磨砂；
            ② 黑染层(TINT)：与 tab/AI 卡同款的近黑深板岩由透化实，0.66 起完全化实 → 黑。
          - 标题以上仍是原始清晰视频、零蒙层；视频可换森林等，下面磨砂+黑过渡都不变。 */}
      <BlurView
        style={{ position: 'absolute', top: `${fadeStartFrac * 100}%`, left: 0, right: 0, bottom: 0 }}
        intensity={70}
        tint="default"
      />
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={[
          `rgba(${HOME_BOTTOM_RGB},0)`,        // 0              顶部全透
          `rgba(${HOME_BOTTOM_RGB},0)`,        // titleFrac      标题顶仍全透
          `rgba(${HOME_BOTTOM_RGB},0.28)`,     // fadeStartFrac  「今日状态」下面起：近黑深板岩化入（与 tab/AI 卡同款）
          `rgba(${HOME_BOTTOM_RGB},0.78)`,     // 0.50          黑染中段：海浪已很弱、呈磨砂暗玻璃
          `rgba(${HOME_BOTTOM_RGB},1)`,        // 0.66          完全化实
          `rgba(${HOME_BOTTOM_RGB},1)`,        // 1              固定近黑实色（= tab 栏/AI 卡同款，全 App 底统一）
        ]}
        locations={[0, titleFrac, fadeStartFrac, 0.50, 0.66, 1]}
      />

      {/* 顶部：左 = 账户 icon；右 = 设置 icon（均浮在海浪上）。
          ★ 2026-10-18 用户：「今日状态」白色标题从头栏移到指标卡行上方（见下方 cardTitle）。 */}
      <View style={[s.head, { paddingTop: insets.top + 30 }]}>
        <AvatarStack
          size={34}
          onSelect={(id) => {
            if (id === 'self') navigation.navigate('AccountHub');
            else navigation.navigate('MemberDetail', { memberId: id });
          }}
          onAdd={() => navigation.navigate('AccountHub')}
        />
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

      {/* ★ 2026-10-20 家人状态改为"头像状态环 + 右上角表情标识"（见头栏 AvatarStack），
          不再用独立横滑卡——更小巧、只给结论。头栏 AvatarStack 已承载状态。

      {/* 「今日状态」白色标题：★ 2026-10-18 用户要求改白色、放到指标卡行上方。
          位置在渐变 94% 不透明深色线（0.31×height）附近，白字可读。
          ★ 第二十六轮：字号 25→28、位置再往上 8px（用户："字大一些，位置再往上一点"）。
          ★ 第三十轮：仅标题再上移 12px（-38→-50，卡行不动；用户："今日状态这几个字位置再往上"）。
          ★ 第三十一轮：再上移 12px（-50→-62；用户："今日状态位置再往上放一点"）。 */}
      <Text style={[s.cardTitle, { top: gaugeTop - 62 }]}>今日状态</Text>

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
            {/* 外弧轨道（状态分，淡色同系） */}
            <Path d={arcPath(-ARC_HALF, ARC_HALF, ARC_R)} fill="none" stroke={hexA(moodColor, 0.22)} strokeWidth={2.5} strokeLinecap="round" />
            {/* 外弧进度（状态分档位色，如 82→黄） */}
            <Path d={arcPath(-ARC_HALF, -ARC_HALF + ARC_SWEEP * ((hasStatusData ? CV : 0) / 100), ARC_R)} fill="none" stroke={moodColor} strokeWidth={3} strokeLinecap="round" />
            {/* 内弧轨道（周期，白） */}
            <Path d={arcPath(-ARC_HALF, ARC_HALF, ARC_RI)} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2.5} strokeLinecap="round" />
            {/* 内弧进度（周期，白） */}
            <Path d={arcPath(-ARC_HALF, -ARC_HALF + ARC_SWEEP * (cycleDay / CYCLE_LEN), ARC_RI)} fill="none" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" />
            {/* 端点刻度 0 / 100（状态分刻度） */}
            <SvgText x={lEnd.x - 4} y={lEnd.y + 16} fontSize={11} fill="rgba(255,255,255,0.45)" fontWeight="500">0</SvgText>
            <SvgText x={rEnd.x - 16} y={rEnd.y + 16} fontSize={11} fill="rgba(255,255,255,0.45)" fontWeight="500">100</SvgText>
          </Svg>
        </View>
        {/* 弧下方（Oura 结构 + 白底版状态词）：状态档位词 → 82 → 周期。
            ★ 第三十四轮（用户）：圆弧下写状态词（白底版四档：元气满满/状态良好/平平静静/休息一下，
            按 82 分→元气满满，颜色与圆环同源），下面写 82，下面只留「周期第 14 天」；
            去掉「恢复状态」「恢复优秀」；整块上提（离卡行更近）。 */}
        <View style={s.gaugeInfo}>
          <Text style={[s.gMood, { color: moodColor }]}>{moodLabel}</Text>
          {hasStatusData ? (
            <View style={s.gScoreRow}>
              <Text style={[s.gBig, { color: moodColor }]}>{CV}</Text>
              <Text style={s.gDen}>/100</Text>
              <Svg width={13} height={22} viewBox="0 0 13 22">
                <Path d="M2 2 L10 11 L2 20" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          ) : null}
          <View style={s.gPhase}>
            <Text style={s.gPhaseTxt}>周期 · {cyclePhaseNow} · 第{cycleDay}天</Text>
          </View>
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
          {/* ★ 2026-10-28（用户：暂时没数据的心肺能力不该放首页）—— vo2 为 null（档案缺 / 不足 7 晚静息心率）
              时直接从卡行移除；有值才出现，不影响其余 5 张卡的滑动布局。 */}
          {CHIP_DEFS.filter((c) => c.key !== 'cardio' || !!vo2).map((c) => {
            const d = chipDyn[c.key];
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, { width: CHIP_W }]}
                activeOpacity={0.7}
                accessibilityLabel={`${c.label} ${d.value}${d.unit ? d.unit : ''}`}
                onPress={() => c.go(navigation)}
              >
                <View style={s.chipIcon}>{c.icon}</View>
                <Text style={s.chipLabel}>{c.label}</Text>
                <View style={s.chipValRow}>
                  <Text style={[s.chipVal, d.good && s.chipValGood]}>{d.value}</Text>
                  {d.unit ? <Text style={s.chipUnit}>{d.unit}</Text> : null}
                </View>
                <Text style={s.chipTag}>{d.tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* 右侧渐隐带：提示"还有卡片，向左滑动"（pointerEvents 放过触摸） */}
        <LinearGradient
          colors={[`rgba(${HOME_BOTTOM_RGB},0)`, `rgba(${HOME_BOTTOM_RGB},0.92)`]}
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
          {hasStatusData
            ? <>今天状态不错，<Text style={s.hl}>{CV} 分</Text>比平时稳，趁状态好做点想做的事～</>
            : '今天还没有状态数据，戴上戒指，我会帮你把今天的状态看得更准～'}
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
  // 弧下文字块：状态词 → 82/100 → 周期药丸（全部顺排，不叠字）
  gaugeInfo: {
    alignItems: 'center',
    marginTop: 4,
  },
  gMood: { fontSize: 22, fontWeight: '600', letterSpacing: 0.5, textShadowColor: 'rgba(20,44,64,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  // 分数行：82（主视觉，缩小）+ 小号 /100 + 右箭头（点击进全天趋势）
  gScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  gBig: { fontSize: 34, fontWeight: '700', letterSpacing: -1.5, textShadowColor: 'rgba(20,44,64,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  gDen: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  // 周期药丸：明示所属时期（排卵期等）
  gPhase: {
    marginTop: 10,
    paddingVertical: 5,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  gPhaseTxt: { fontSize: 12.5, fontWeight: '500', color: '#FFFFFF', textShadowColor: 'rgba(20,44,64,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },

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
