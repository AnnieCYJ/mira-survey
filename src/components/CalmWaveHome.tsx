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
 * ★ 2026-10-17 第十一轮（用户）：补齐「生理周期 / 身心压力」两张卡（与白底版 6 卡对齐）；
 *   chips / 半圆环全部可点 → 跳对应详情页（与 TodayScreen 同款路由目标）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, useWindowDimensions, StatusBar, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { sleepRecoveryScoreForDay } from '../lib/sleepPersonalized';
import { RingBle } from '../ble/RingBleManager';
import { dayKey } from '../data/healthStore';
import { computeEmotionalStress, MIN_BASELINE_DAYS as ES_MIN_BASELINE_DAYS } from '../lib/emotionalStress';
import { computeStressReport } from '../lib/stressAlgorithm';
import { estimateVo2maxFromStore } from '../lib/vo2max';
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as AsyncStorage from '../utils/prefs'; // ★ 2026-10-18：Expo Go 无 AsyncStorage 原生模块，改用 file-system 版同接口 KV
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur'; // ★ 2026-10-30（用户要真·磨砂玻璃）：对标题下方海浪视频做真实高斯模糊
import Icon from './Icon'; // ★ 2026-11-03：档位词右箭头（chevronRight）
import { pickSuggestion, type SuggestionCandidate } from '../lib/suggestionEngine'; // ★ 2026-11-04：动态建议
import { useDeviceModel } from '../config/deviceModel'; // ★ 2026-11-05：首页排布按机型分支，Pro 不受影响
import {
  getQuickCheckResultSync, loadQuickCheckResult, subscribeQuickCheckResult,
  validQuickCheckResult, type QuickCheckResult,
} from '../data/quickCheckResult'; // ★ 2026-11-05：一键体检 → 首页今日状态
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import Svg, { Path, Circle } from 'react-native-svg';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;

const WAVE_VIDEO = require('../assets/wave-video.mp4');
const HOME_BG = require('../assets/home_bg.jpg'); // ★ 2026-11-03 首页背景：用户指定雪景照（已裁掉状态栏/Home 黑条）
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
//   这里只保留静态元数据（顺序/图标/路由），顺序：睡眠恢复 → 身心压力 → 情绪 → 活动消耗 → 生理周期。
const CHIP_DEFS: ChipDef[] = [
  { key: 'recovery', label: '睡眠恢复', icon: lineIcon('M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'), go: (n) => n.navigate('SleepDetail') },
  { key: 'load', label: '身心压力', icon: lineIcon('M13 2.5 4.8 13.6h6L9.6 21.5 19.2 10h-6.2L13 2.5Z'), go: (n) => n.navigate('MetricDetail', { key: 'stress', name: '身心压力', unit: '/100', yMin: 0, yMax: 100 }) },
  // ★ 2026-10-18 用户：「压力水平」改名「情绪」（路由目标不变 → EnergyDetail emotion）
  { key: 'emo', label: '情绪压力', icon: lineIcon('M3 12h3l2-4.5 3 9 2.5-6.5 1.5 2h6'), go: (n) => n.navigate('EnergyDetail', { type: 'emotion' }) },
  { key: 'act', label: '活动消耗', icon: lineIcon(['M12 3c2.8 2.6 4.2 5.1 4.2 7.4a4.2 4.2 0 0 1-8.4 0C7.8 8.1 9.2 5.6 12 3Z', 'M8 17.5h8M9.5 20.5h5']), go: (n) => n.navigate('EnergyDetail', { type: 'activity' }) },
  { key: 'cycle', label: '生理周期', icon: lineIcon(['M12 3.2a8.8 8.8 0 1 0 8.8 8.8', 'M12 7.2a4.8 4.8 0 0 1 0 9.6']), go: (n) => n.navigate('CycleCalendar') },
  { key: 'cardio', label: '心肺能力', icon: lineIcon('M12 21s-7.5-4.6-10-9.3C.6 8.3 2.3 5 5.5 5c1.9 0 3.2 1 4.5 2.6C11.3 6 12.6 5 14.5 5 17.7 5 19.4 8.3 22 11.7 19.5 16.4 12 21 12 21Z'), go: (n) => n.navigate('CardioDetail') },
  // 「脑力准备度」按用户要求隐藏（2026-10-17 改花瓣布局只留 5 张）；要恢复：取消下行注释
  // { key: 'cognitive', label: '脑力准备度', icon: lineIcon(['M12 3a4.2 4.2 0 0 0-4.2 4.2c-1.9.6-3.3 2.4-3.3 4.5 0 1.6.8 3 2 3.9v2.1a3.3 3.3 0 0 0 3.3 3.3h4.4a3.3 3.3 0 0 0 3.3-3.3v-2.1a4.8 4.8 0 0 0 2-3.9c0-2.1-1.4-3.9-3.3-4.5A4.2 4.2 0 0 0 12 3Z', 'M9.5 13.5 11 12l1.5 1.5L14 12']), go: (n) => n.navigate('EnergyDetail', { type: 'cognitive' }) },
];

/**
 * ★ 2026-11-05（用户）：首页隐藏「情绪压力」「生理周期」；
 *   ★ 2026-11-06（用户纠偏）：「稳定睡眠」不再放首页 chip 行，移到睡眠恢复详情页（SleepDetail）底部最下面。
 *   ★ 仅 BASE_UI 使用 —— PRO_UI 仍走上面的完整 CHIP_DEFS，卡片顺序完全不变。
 *   顺序：睡眠恢复 → 身心压力 → 活动消耗 → 心肺能力。
 */
const BASE_CHIP_DEFS: ChipDef[] = [
  CHIP_DEFS[0],
  ...CHIP_DEFS.filter((c) => c.key !== 'recovery' && c.key !== 'emo' && c.key !== 'cycle'),
];

// ★ 2026-10-18 第二十三轮（用户："卡片展示四个，最后一个滑动可看；整体字太小"）：
//   一行 5 张改横向 ScrollView——首屏露出 4 张（84×96 大卡大字），第 5 张滑动可见；
//   卡行从弧上方移到海浪/深色交界线下方（过渡区）；环 240→280、中心字 46→58；
//   AI 建议卡字号同步放大。花瓣历史资产见 git a07525c。
// ★ 2026-11-03（用户：展示三个卡片，后边往后移；睡眠恢复/身心压力字要大一些）：
//   前 3 张大卡（宽 100、标签 14）更醒目，其余卡片收窄（宽 74、标签 12.5）向右滑动可见。
// ★ 本轮：底部指标卡整体略放大（用户："卡片可以稍微大一点"）—— 高 96→104
const CHIP_H = 104;
const CHIP_GAP = 8;
// 大半圆环尺寸（★ 2026-11-03 还原 2026-10-18 大半圆：viewBox 280×150，R=116.7，用于下方布局块高估算）
const GAUGE_W = 280;
const GAUGE_H = 150; // ★ 2026-10-18：大半圆块（弧 150 高，中心字 58px）估算高，用于居中计算

export default function CalmWaveHome() {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();
  // ★ 2026-10-26（用户）：首页 5 张指标卡改为接真实数据（之前 4 张写死静态预览值）。
  //   订阅 RingBle 实时状态，数据推送/重连即刷新卡片；派生值口径与 TodayScreen 顶部 chips 同源。
  const [ring, setRing] = useState(() => RingBle.getState());
  useEffect(() => RingBle.onState((s) => setRing(s)), []);
  // ★ 2026-11-05（用户）：首次进入「今日状态」是空的 → 做完一键体检后首页要有当下结果。
  //   订阅体检结果缓存（体检完成即广播），并在每次回到首页时重新读一次，避免跨页丢刷新。
  const [qcResult, setQcResult] = useState<QuickCheckResult | null>(() => getQuickCheckResultSync());
  useEffect(() => {
    void loadQuickCheckResult().then(setQcResult);
    return subscribeQuickCheckResult(setQcResult);
  }, []);
  useFocusEffect(useCallback(() => {
    void loadQuickCheckResult().then(setQcResult);
    return () => {};
  }, []));
  // ★ 2026-10-26（修复「今日状态一直不更新」）：圆环恢复分 / 压力 / 情绪 都从 healthStore 读取，
  //   而 healthStore 在戒指回填写入后只增 version、不会自动触发本组件重渲染 —— 故显式订阅其版本，
  // ★ 性能修复：原本 useHealthStoreVersion() 在 healthStore 每次写入（实时流/回填高频）都重渲染整页
  //   并同步重算 stressReport / esReport / 恢复分 等重型函数 → 主线程被压满 → 首页卡顿、点卡片无响应、
  //   切 Tab / Grok 共享同一 JS 线程也跟着卡。改用品详情页同源的「防抖刷新键」：
  //   数据安静约 700ms（高频时最多 1500ms）才重渲染一次，重型派生值也用 useMemo 跟着收口。
  const refreshKey = useDebouncedHealthStoreRefresh(700);
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
  const recoveryScore = useMemo(() => sleepRecoveryScoreForDay(Date.now()), [refreshKey]);
  const hasRecoveryData = recoveryScore != null;
  const RECOVERY = hasRecoveryData ? Math.round(recoveryScore) : 0;
  // ★ 2026-10-26：首页指标卡全部接真实数据（替代原写死的静态预览值 82/46/38/320/第14天）。
  //   口径与 TodayScreen 顶部 chips 同源：
  //   · 睡眠恢复 → sleepRecoveryScoreForDay（上方已算）
  //   · 身心压力 → 基础指标压力信号 ring.metrics['stress'] / ring.daily['stress']（与 MetricDetail stress 同源）
  //   · 情绪     → emotionalStress 百分位 stressScale.value（与 EnergyDetail emotion 同源）
  //   · 活动消耗 → 运动段 totalCal 优先，否则当日计步 calorie（与运动消耗卡同源）
  //   · 生理周期 → curveStatus.phaseLabel / dayInCycle（与周期卡同源）
  //   任一项无数据 / 断流 / 校准无效 → 显「—」+「暂无数据 / 建立基线中」，不编数字。
  const status = ring.curveStatus;
  // ★ 2026-10-28（修复：原样输出浮点原始值导致 33.645316484174145 这种一长串小数）：
  //   状态分取整显示（与弧进度/档位词口径统一），不再露原始浮点。
  // ★ 2026-10-28（用户：首页「今日状态」大数字须为状态曲线值，与详情页同源；恢复分=睡眠，已下沉到卡片行「睡眠恢复」）
  const CV = status?.value != null ? Math.round(status.value) : null;

  // ★ 2026-11-04（用户「建议要跟分析结合、点完换下一条」）：建议胶囊接入 suggestionEngine
  //   （与旧版首页建议卡同源，今日状态/相位/睡眠/压力同一事实源 → 与上方分析说得是同一件事）：
  //  · 只取带 cta 的行动引导型（requireCta）——点了直接跳进对应工具页；
  //  · 从工具页回来 → 强制换下一条（引擎避开刚展示的 id，负反馈还有 30 天冷却）；
  //  · 引擎按 30 分钟槽位轮换、按状态签名去重（状态没变不会闪换）；池子空 → 回落原「呼吸放松」。
  const [sugg, setSugg] = useState<SuggestionCandidate | null>(null);
  const suggTapRef = useRef(false);
  const refreshSugg = useCallback(
    async (force: boolean) => {
      try {
        const c = await pickSuggestion(status, { requireCta: true, ...(force ? { force: true } : {}) });
        if (c) setSugg(c);
        else if (force) setSugg(null); // 强制换但池子空 → 回落默认胶囊
        // 非 force 的 null = 状态没变/引擎让保留当前 → 不动
      } catch {
        /* 引擎异常 → 保留当前 */
      }
    },
    [status],
  );
  useEffect(() => {
    refreshSugg(false);
  }, [refreshSugg]);
  // 刚点过建议从工具页回来 → 换一条
  useFocusEffect(
    useCallback(() => {
      if (suggTapRef.current) {
        suggTapRef.current = false;
        refreshSugg(true);
      }
    }, [refreshSugg]),
  );
  const onSuggPress = () => {
    const c = sugg;
    suggTapRef.current = true;
    // cta.screen 来自引擎候选（Breathing/ToolTopic/LearnRead/FoodScan 等，均为已注册路由）
    const nav = navigation.navigate as unknown as (screen: string, params?: Record<string, unknown>) => void;
    if (c?.cta) nav(c.cta.screen, c.cta.params);
    else nav('Breathing');
  };
  // ★ 2026-11-05：空态胶囊 → 底部 Tab「洞察」→「身体指标 → 一键体检」子 tab
  const onGoQuickCheck = () => {
    suggTapRef.current = false;
    (navigation.navigate as unknown as (screen: string, params?: Record<string, unknown>) => void)(
      'Insight', { subTab: 'quickcheck', t: Date.now() },
    );
  };
  const CV_STALE = status?.dataStale ?? true;
  // ★ 2026-11-05：曲线模型无值/断流时，回退到「一键体检」给出的当下状态分。
  //   曲线优先（真实连续采样），体检结果兜底（首次进入、或戒指断流时也能看到今天的体检结果）。
  const qcValid = validQuickCheckResult(qcResult);
  const qcStatus = qcValid?.status ?? null;
  const curveHasValue = CV != null && !CV_STALE;
  const displayStatus = curveHasValue ? CV : (qcStatus?.value ?? null);
  const hasStatusData = displayStatus != null;
  const statusFromCheck = !curveHasValue && qcStatus != null;
  const EMPTY_COLOR = theme.colors.stateEnergy; // 空态统一紫（与 EnergyBall 圆环同源）
  const mood = !hasStatusData
    ? { label: '暂无数据', color: EMPTY_COLOR }
    : displayStatus! >= 76 ? { label: '元气满满', color: '#F0C46E' }
    : displayStatus! >= 51 ? { label: '状态良好', color: '#BCCB62' }
    : displayStatus! >= 26 ? { label: '平平静静', color: '#9D8AF0' }
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

  // 身心压力：与「基础指标 → 压力」卡同源 —— 设备 SDK 压力信号经 stressAlgorithm 算出的当前压力分（0–100，越高越紧张）。
  // ★ 2026-10-26 修复：此前误用 ring.metrics['stress']，但 RingBle 的 metrics 只填 hr/hr，daily 也不含 stress，
  //   该字段恒为 null → 身心压力卡永远「— / 暂无数据」；改用 computeStressReport().score（与 MetricDetail「压力」卡同源）。
  const stressReport = useMemo(() => { try { return computeStressReport(Date.now()); } catch { return null; } }, [refreshKey]);
  const bodyLoad = stressReport?.score ?? null;

  // 情绪：emotionalStress 多信号融合（0–100，50=和平时差不多；越高压力越大）
  const esReport = useMemo(() => {
    try { return computeEmotionalStress(Date.now(), sportSessions); } catch { return null; }
  }, [refreshKey, sportSessions]);
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

  // ★ 2026-11-03（V2，对齐用户参考图）：近整圆几何——圆心(150,135) R=115，底部留 ~60° 开口。
  //   左端点(0%)=(92.5,234.6)，右端点(100%)=(207.5,234.6)；进度从左侧起、顺时针过顶部到右。
  const ARC_CX2 = 150;
  const ARC_CY2 = 135;
  const ARC_R2 = 115;
  const ARC_GAP = 60;                         // 底部开口角度
  const ARC_SWEEP2 = 360 - ARC_GAP;            // 弧总角度 300°
  const START_A = 90 + ARC_GAP / 2;            // 左端点角度（120°）
  const ptOnArc = (deg: number) => ({
    x: ARC_CX2 + ARC_R2 * Math.cos((deg * Math.PI) / 180),
    y: ARC_CY2 + ARC_R2 * Math.sin((deg * Math.PI) / 180),
  });
  const arcStart = ptOnArc(START_A);
  const arcEndFull = ptOnArc(START_A + ARC_SWEEP2);
  const frac = hasStatusData ? (displayStatus ?? 0) / 100 : 0;
  const arcEnd = ptOnArc(START_A + ARC_SWEEP2 * frac);
  const progLargeArc = ARC_SWEEP2 * frac > 180 ? 1 : 0;

  // 心肺能力（VO₂max）：权威非运动估算法（Jackson 1990 + Uth 心率比法交叉），详见 lib/vo2max.ts。
  const vo2 = (() => { try { return estimateVo2maxFromStore(Date.now()); } catch { return null; } })();

  // ★ 2026-11-05：首页卡片排布调整只对基础版生效，Pro 保持原样。
  const { model: homeModel } = useDeviceModel();
  const isBase = homeModel.id === 'BASE_UI';

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
        : bodyLoad < 30 ? '压力轻松'
        : bodyLoad < 55 ? '压力适中'
        : '压力偏重',
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
  // ★ 2026-10-20 布局实验（用户）：把「上方卡片行（睡眠恢复/身心压力…）」与「下方双弧块（元气满满/82/周期）」
  //   位置调换——双弧 hero 上移、卡片行下移到「弧底 ↔ AI 卡顶」之间垂直居中。
  //   ▶ 还原原布局：把下面 gaugeTop / chipRowTop 两行换回——
  //     chipRowTop = transitionY - 28；gaugeTop = Math.max(chipRowTop+CHIP_H+8, chipRowTop+CHIP_H+(aiTop-chipRowTop-CHIP_H-GAUGE_H)/2)
  // ★ 2026-10-20 微调：用户"圆环+周期+下方睡眠恢复卡片整体往下移一点点"——给 gaugeTop 加
  //   TOP_OFFSET(=20)，因「今日状态」标题(gaugeTop-62)、弧块(gaugeTop)、卡行(arcBottom 派生) 全部由
  //   gaugeTop 驱动，三者会整体同步下移；卡行有 Math.min 钳位不撞 AI 卡顶。
  // ★ 2026-11-03（V2）：以 844 设计高为基准等比缩放，对齐用户参考图布局
  const k = height / 844;
  const gaugeSize = 300 * k;                          // 近整圆仪表尺寸
  const gaugeTop = 158 * k;                            // 仪表区顶部（★ 2026-11-03：140→158 整体再下移一点点，圆环+分析+胶囊联动下移）
  const analysisTop = gaugeTop + 318 * k;              // 分析文字（★ 2026-11-03 310→318：用户「和下面的今日状态不错拉开一点点距离」）
  // ★ 2026-11-06（用户：分析文字三排要自适应）：分析文字行数不定（1~3 行），
  //   胶囊不再用固定 40k 偏移，而是跟随实测文字高度下移；三排时指标卡行（睡眠恢复/身心压力/活动消耗）也随之下移一点。
  const [analysisH, setAnalysisH] = useState(50);      // 默认按两行（lineHeight 25）
  const analysisLines = Math.max(1, Math.round(analysisH / 25));
  const capsuleTop = analysisTop + analysisH + 6;      // 建议胶囊：贴分析文字实际底沿
  // 卡片行：贴 tab 上方（tab 高 84 + 安全区）；★ 本轮：底部间隙 4→14，卡片整体再下移约 10px
  // ★ 2026-11-06（用户）：分析文字 ≥3 行时，卡行也顺势再往下挪 8px，保持整页呼吸感
  const chipRowTop = height - insets.bottom - 84 - 2 - (analysisLines >= 3 ? 8 : 0) - CHIP_H;

  return (
    <View style={[s.root, { backgroundColor: PAGE_BG }]}>
      {/* ★ 2026-11-03：首页背景 = 用户指定雪景照（home_bg.jpg，已裁掉状态栏/Home 黑条），全屏覆盖。
          整体轻磨砂（BlurView）保留照片观感又统一磨砂质感；底部加深一点保证磨砂卡/玻璃 tab 可读。 */}
      <Image
        source={HOME_BG}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      {/* 整体磨砂：轻高斯模糊，统一磨砂玻璃质感（tint=default 保照片本色） */}
      <BlurView style={StyleSheet.absoluteFill} intensity={18} tint="default" />
      {/* 顶部微提亮 + 底部加深：上半照片清晰，下半为卡片/tab 提供对比底 */}
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)', 'rgba(10,41,79,0.05)', 'rgba(10,41,79,0.30)']}
        locations={[0, 0.42, 0.72, 1]}
      />

      {/* 顶部：左 = 账户 icon；右 = 设置 icon（均浮在海浪上）。
          ★ 2026-10-18 用户：「今日状态」白色标题从头栏移到指标卡行上方（见下方 cardTitle）。 */}
      <View style={[s.head, { paddingTop: insets.top + 30 }]}>
        <TouchableOpacity
          style={s.hIcon}
          activeOpacity={0.7}
          accessibilityLabel="账户"
          onPress={() => navigation.navigate('AccountHub')}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={HEAD_INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx={12} cy={8} r={4} />
            <Path d="M4 20c0-4.2 3.6-6.8 8-6.8s8 2.6 8 6.8" />
          </Svg>
        </TouchableOpacity>
        <Text style={s.navTitle}>今日状态</Text>
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
      {/* ★ 2026-11-03：标题「今日状态」已移至顶部导航栏中央（s.navTitle），此处不再单独渲染 */}

      {/* 仪表区：近整圆（底部开口）+ 数字落开口处（圆心空）+ 分析/胶囊浮于照片 */}
      <View style={[s.gaugeZone, { top: gaugeTop }]}>
        <TouchableOpacity
          style={[s.gauge, { width: gaugeSize, height: gaugeSize }]}
          activeOpacity={0.85}
          accessibilityLabel="查看全天状态趋势详情"
          onPress={() => navigation.navigate('StatusTrendDetail')}
        >
          <Svg width="100%" height="100%" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
            {/* 轨道：近整圆、底部开口 60°，淡白 */}
            <Path
              d={`M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${ARC_R2} ${ARC_R2} 0 1 1 ${arcEndFull.x.toFixed(2)} ${arcEndFull.y.toFixed(2)}`}
              fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={8} strokeLinecap="round"
            />
            {/* 进度：白色，左0→CV%（按当前状态分） */}
            <Path
              d={`M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${ARC_R2} ${ARC_R2} 0 ${progLargeArc} 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`}
              fill="none" stroke="#FFFFFF" strokeWidth={8} strokeLinecap="round"
            />
            {/* 进度末端亮点（更明显：外晕+实心） */}
            <Circle cx={arcEnd.x} cy={arcEnd.y} r={13} fill="rgba(255,255,255,0.30)" />
            <Circle cx={arcEnd.x} cy={arcEnd.y} r={7} fill="#FFFFFF" />
          </Svg>
          {/* 数字落圆下部开口处（圆心空）：★ 2026-11-03 整体下移，正好落在 0/100 中间开口处 */}
          <View style={[s.gaugeCenter, { top: 206 * (gaugeSize / 300) }]}>
            <Text style={s.gBig}>{hasStatusData ? displayStatus : '—'}</Text>
            {/* ★ 2026-11-03（用户）：档位词右边加向右箭头 —— 提示整块可点、进入全天状态趋势（外层 gauge 已是 TouchableOpacity） */}
            <View style={s.gLabelRow}>
              <Text style={s.gLabel}>{moodLabel}</Text>
              <Icon name="chevronRight" size={theme.fontSize.body} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
            </View>
          </View>
          {/* 0 / 100 刻度（左 0、右 100） */}
          <Text style={[s.scaleTxt, { left: '30.8%', top: '79%' }]}>0</Text>
          <Text style={[s.scaleTxt, { left: '69.2%', top: '79%' }]}>100</Text>
        </TouchableOpacity>
      </View>

      {/* 指标卡行：★ 2026-11-07（用户）：取消横向滑动，改为整行等宽平铺，不再有右滑阴影。
          位置在海浪/深色交界线正下方（过渡区深色渐变带上）。每张可点进对应详情页。 */}
      <View style={[s.chipRowZone, { top: chipRowTop, height: CHIP_H }]}>
        <View style={s.chipRow}>
          {(isBase ? BASE_CHIP_DEFS : CHIP_DEFS).filter((c) => c.key !== 'cardio' || !!vo2).map((c) => {
            const d = chipDyn[c.key];
            // ★ 本轮：全部卡片统一为大卡尺寸（活动消耗/生理周期 与 情绪/身心压力 同尺寸）
            const big = true;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.chip, { flex: 1, minWidth: 0 }]}
                activeOpacity={0.7}
                accessibilityLabel={`${c.label} ${d.value}${d.unit ? d.unit : ''}`}
                onPress={() => c.go(navigation)}
              >
                <View style={s.chipIcon}>{c.icon}</View>
                <Text style={[s.chipLabel, big && s.chipLabelBig]}>{c.label}</Text>
                <View style={s.chipValRow}>
                  <Text style={[s.chipVal, big && s.chipValBig, d.good && s.chipValGood]}>{d.value}</Text>
                  {d.unit ? <Text style={s.chipUnit}>{d.unit}</Text> : null}
                </View>
                <Text style={s.chipTag}>{d.tag}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 分析文字（浮于照片，无卡片底）★ 2026-11-06：实测行高驱动下方胶囊位置（三排自适应） */}
      <View style={[s.analysisWrap, { top: analysisTop }]}>
        <Text
          style={s.analysis}
          onTextLayout={(e) => {
            // RN 的 onTextLayout 只给 lines（无整体 layout.height）——行数 × lineHeight(25) 换算
            const n = e.nativeEvent.lines.length;
            if (n > 0) setAnalysisH(n * 25);
          }}
        >
          {statusFromCheck
            ? <>刚做完一键体检，今天的<Text style={s.hl}>{displayStatus} 分</Text>{qcStatus?.source === 'estimated' ? '是按当前 HRV 估算的，连续佩戴后会更贴近真实状态～' : '来自戒指同步～'}</>
            : hasStatusData
              ? <>今天状态不错，<Text style={s.hl}>{displayStatus} 分</Text>比平时稳，趁状态好做点想做的事～</>
              : '今日状态暂无数据，做一次一键体检，最快获取你的健康数据～'}
        </Text>
      </View>
      {/* 建议胶囊：★ 2026-11-05（用户）今日状态空值时引导「去一键体检一下」；有数据后走动态建议引擎 */}
      <View style={[s.capsuleWrap, { top: capsuleTop }]}>
        <TouchableOpacity style={s.relaxPill} activeOpacity={0.85}
          onPress={hasStatusData ? onSuggPress : onGoQuickCheck}>
          <Text style={s.relaxPillTxt} numberOfLines={2}>
            {hasStatusData
              ? (sugg?.cta ? `${sugg.headline ?? sugg.action ?? '轻呼吸放松放松'} ›` : '收工啦，轻呼吸放松放松 ›')
              : '去一键体检，获取最新的健康数据 ›'}
          </Text>
        </TouchableOpacity>
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
    position: 'relative',
  },
  /* ★ 2026-11-06（用户）：今日状态 字号加大，并改为与「账户 / 设置」图标同一行的流式居中，
       不再绝对定位 —— 标题与齿轮图标在同一水平线上、字更大更醒目。 */
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: theme.fontSize.stat,
    fontWeight: '700',
    color: theme.colors.textWhite,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(10,41,79,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
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
    fontSize: theme.fontSize.stat,
    fontWeight: '700',
    color: theme.colors.textWhite,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(20,44,64,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },

  // 指标方卡（Oura 式玻璃卡：icon + label + 值 + tag；整行等宽平铺，不可滑动）
  chipRowZone: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: CHIP_GAP,
    alignItems: 'stretch',
  },
  chip: {
    height: CHIP_H,
    borderRadius: theme.radius.lg,
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
  chipLabel: { fontSize: theme.fontSize.xs, fontWeight: '500', color: 'rgba(255,255,255,0.62)', letterSpacing: 0.1 },
  chipLabelBig: { fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.78)' },
  chipValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  chipVal: { fontSize: theme.fontSize.card, fontWeight: '700', color: theme.colors.textWhite },
  chipValBig: { fontSize: theme.fontSize.h2 },
  chipValGood: { color: '#D5E384' },
  chipUnit: { fontSize: theme.fontSize.tiny, color: 'rgba(255,255,255,0.62)', marginLeft: 1.5 },
  chipTag: { fontSize: theme.fontSize.tiny, color: 'rgba(255,255,255,0.5)', marginTop: 3 },

  // 大半圆区（Oura 风格，去月相）：整区居中、可点
  gaugeZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // 半圆环容器（280×150，viewBox 1:1，弧两端在 y=140）
  gauge: { width: GAUGE_W, height: GAUGE_H },
  // 中心文字组（绝对定位，沉到半圆底部下方）
  gaugeCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
  },
  // 分数主视觉（★ 2026-11-03：58→44 数字缩小；★ 本轮 收紧与状态词间距）
  gBig: { fontSize: theme.fontSize.hero, fontWeight: '700', color: theme.colors.textWhite, marginBottom: 2, textShadowColor: 'rgba(20,44,64,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 14 },
  // 状态档位词（如 平平静静）：★ 2026-11-03（用户「稍微小一点儿」）hero(46) → h1(36)——
  //   之前注释写「44→40」但实际挂的仍是 hero，与上面大数字同大；现降到 h1，层级回到「数字主、档位词辅」
  gLabel: { fontSize: theme.fontSize.h1, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  // ★ 2026-11-03：档位词 + 右箭头行（整块仍随外层 gauge 可点 → 全天状态趋势）
  gLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  // 周期副行
  gUpd: { fontSize: theme.fontSize.xs, color: 'rgba(255,255,255,0.55)', marginTop: 6 },
  // 建议胶囊（★ 2026-11-04 动态建议：maxWidth 防长文案撑爆，最多两行）
  relaxPill: {
    marginTop: 16,
    maxWidth: '86%',
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  relaxPillTxt: { fontSize: theme.fontSize.body, fontWeight: '600', color: theme.colors.textWhite, textAlign: 'center' },

  // 分析文字（浮于照片，无卡片底）
  analysisWrap: { position: 'absolute', left: 24, right: 24 },
  capsuleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  scaleTxt: {
    position: 'absolute', fontSize: theme.fontSize.xs, fontWeight: '600', color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(10,41,79,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },

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
  analysis: { fontSize: theme.fontSize.card, lineHeight: 25, color: 'rgba(255,255,255,0.92)', marginBottom: 0, textAlign: 'center' },
  hl: { fontWeight: '700', color: '#BFCBFF' },
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  sugThumb: { width: 56, height: 56, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  sugH: { fontSize: theme.fontSize.card, fontWeight: '600', color: theme.colors.textWhite },
  sugD: { fontSize: theme.fontSize.sm, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  goPill: { backgroundColor: 'rgba(160,178,255,0.95)', borderRadius: theme.radius.pill, paddingHorizontal: 15, paddingVertical: 7 },
  goTxt: { fontSize: theme.fontSize.body, fontWeight: '600', color: '#101C33' },
});
