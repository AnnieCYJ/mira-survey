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
import type { ImageSourcePropType } from 'react-native';
import { theme } from '../theme/theme';
import { sleepRecoveryScoreForDay } from '../lib/sleepPersonalized';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey, dayStartMs } from '../data/healthStore';
import { userStore, getCachedSession, onSessionChange, type Gender } from '../data/userStore';
import { computeEmotionalStress, MIN_BASELINE_DAYS as ES_MIN_BASELINE_DAYS } from '../lib/emotionalStress';
import { getLatestForDay } from '../data/emotionLog'; // ★ 2026-11-14：今日心情偏沉 → 进关系链归因
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
// ★ 2026-11-11（用户：「分析基本没分析，就是在罗列数据」「今天都晚上了又把睡眠恢复拿出来了」，
//   要像 Oura 讲人话、按半小时状态点走时间顺序、规则加 AI 且 AI 只润色）：
//   旧链路 useAiInsight('overview') **按天缓存** → 早上生成的睡眠叙事到深夜还在显示；
//   本地兜底又把「今天的 77 分，睡眠恢复 89，日间身心压力 47」直接铺上去。两处都被点名。
//   改为「规则定事实 + AI 只润色」：
//     · lib/homeNarrative：用今日 30 分钟真实状态点 + 当前时段 + 近 3 小时真实事件，
//       决定讲哪件事、朝哪个方向、给哪条同源建议；睡眠/昨晚仅早晨允许出现；
//     · ai/homePolish：只把那句中文换个说法，过不了 isSafePolish 同事实闸门就回落规则句；
//   洞察页顶部仍可继续使用 overview 通道，首页不再直接吃它。
import {
  buildHomeNarrative,
  isMealCopy,
  type NarrativePoint,
  type NarrativeEvent,
} from '../lib/homeNarrative';
import { dayPhase, type DayPhase } from '../lib/timePhase'; // ★ 2026-11-14：时段不再由本组件自行取时，改用 narrative.phase
// ★ 2026-11-15（用户）：场景词触发 30 分钟后必须回落到四档基础词，不能从傍晚挂到深夜；
//   状态持久化到 prefs，App 重启后当天已展示过的场景不再重复冒出来。
import {
  pickHomeWord,
  configureHomeWordPersist,
  hydrateHomeWord,
  HOME_WORD_STORAGE_KEY,
} from '../lib/homeStatusWord'; // ★ 2026-11-14：圆环中心「场景词」引擎（短暂出现后回落底层档位词）
import { getItem, setItem } from '../utils/prefs';
// ★ 2026-11-26：首页背景改为「设置页可选」——订阅选择，点选即时换图
import { getHomeBackgroundSource, getHomeBackgroundId, hydrateHomeBackground, subscribeHomeBackground } from '../data/homeBackground';
import { HOME_BG_DATA_URI } from '../assets/homeBgData';

// ★ 2026-11-14（用户）：圆环中心状态词改由 lib/homeStatusWord「场景词引擎」统一输出
//   （底层档位词 元气满满/状态良好/平平静静/休息一下 按档位常态展示，场景词短暂出现后回落）。
//   档位规范词仍由 mood.label 传给叙事引擎（homeNarrative 用正则 /休息一下|平平静静/ 判定低档，不可改），
//   此处不再单独维护词表。
import { useHomePolish } from '../ai/homePolish';
import { allInterventionEntries, ensureInterventionLogLoaded } from '../data/interventionLog';

type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;

// ★ 2026-11-09：回填数据回落。各卡片默认读「今天」，今天无该指标时回落到「最近一个有该指标的天」，
// 让已同步的历史数据（睡眠/心率/HRV/压力…）在首页可见，而不是一律「— / 暂无数据」。
// 符合产品铁律：有冻结值就显示、不显空态；回落到的非今日日期由调用方显式标注「数据截至 X日」，不伪装成今天。
function dayKeyToTs(dk: string): number {
  const [y, m, d] = dk.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}
function lastDayWithData(keys: string[], maxDays = 30): string {
  for (let i = 0; i <= maxDays; i++) {
    const dk = dayKey(Date.now() - i * 86400000);
    for (const k of keys) {
      if (k === 'sleep') {
        // ★ 2026-11-14（P30 真机：昨天没连戒指，首页却显示旧睡眠分、点进去是空态）：
        //   原来只判对象存在，total=0 的空壳 / 快照残留会被当成「有睡眠」。
        //   与 SleepDetailScreen 的 toRecords / sleepDaily 判据对齐：必须 total > 0。
        const s = healthStore.getSleep(dk);
        if (s && Number(s.total) > 0) return dk;
        continue;
      }
      const d = healthStore.getDay(k as any, dk);
      if (d && ((d.last != null && d.last > 0) || (d.mean != null && d.mean > 0) || (d.samples ?? 0) > 0)) return dk;
      const intra = healthStore.getIntraday(k as any, dk);
      if (intra && intra.length > 0) return dk;
    }
  }
  return dayKey(Date.now());
}

const WAVE_VIDEO = require('../assets/wave-video.mp4');
// ★ 2026-11-26：首页背景不再写死，改由设置页选择（data/homeBackground），默认仍是雪景照
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
 *   ★ 2026-11-16（用户）：BASE_CHIP_DEFS 不再是基础版专属——PRO_UI 首页也统一用这份
 *     三卡列表（睡眠恢复/身心压力/活动消耗），情绪压力、生理周期不上首页。
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

// ★ 2026-11-10（用户）：首页「今日状态」下方「更新时间 几时几点」格式化。
//   当天显示「今天 HH:MM」，跨天显示「M月D日 HH:MM」，与中文习惯一致。
function formatUpdateTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `更新时间 今天 ${hh}:${mm}`
    : `更新时间 ${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * ★ 2026-11-10（用户：「下面那段话没说完、还加了省略号，希望三行把事情完整说完，要控制字数」）
 *
 * 首页分析区固定三行（字号 18、左右各留 24 → 每行约 17 字，三行≈51 字）。
 * 端侧模型生成的句子经常 60~90 字，交给 numberOfLines 截断会变成「……」且话没说完。
 * 这里在**渲染前**就把文案压到上限内，并且只在完整分句处收尾（不留半句、不加省略号），
 * 三行一定装得下、意思也完整。
 */
const HOME_ANALYSIS_MAX = 45;
function fitHomeAnalysis(text: string | null): string | null {
  if (!text) return null;
  // 压空白 + 去掉模型自带的省略号尾巴
  let t = text.replace(/\s+/g, ' ').replace(/[…⋯\.。]+$/u, '').trim();
  if (!t) return null;
  const chars = Array.from(t);
  if (chars.length <= HOME_ANALYSIS_MAX) {
    // 短句也补上句号，读起来是「一句完整的话」而不是半截
    return /[。！？!?]$/u.test(t) ? t : `${t}。`;
  }
  const cut = chars.slice(0, HOME_ANALYSIS_MAX).join('');
  const sentenceEnd = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  const clauseEnd = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf('、'));
  // 优先在完整句末收尾；退而求其次在分句末收尾，避免把半句话摆上去
  let base = sentenceEnd >= HOME_ANALYSIS_MAX * 0.5
    ? cut.slice(0, sentenceEnd + 1)
    : clauseEnd >= HOME_ANALYSIS_MAX * 0.5
      ? cut.slice(0, clauseEnd)
      : cut;
  base = base.replace(/[，,、；;：:]\s*$/u, '').trim();
  if (!/[。！？!?]$/u.test(base)) base += '。';
  return base;
}

export default function CalmWaveHome() {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();
  // ★ 2026-11-15：注入场景词持久化并恢复当天状态。hydrate 完成前 pickHomeWord 不写盘，
  //   避免首帧覆盖磁盘里「今天已展示过」的记录；恢复完触发一次重渲染让圆环词即时回落。
  const [, setWordHydrated] = useState(0);
  useEffect(() => {
    configureHomeWordPersist({
      load: async () => {
        const raw = await getItem(HOME_WORD_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      },
      save: (s) => { void setItem(HOME_WORD_STORAGE_KEY, JSON.stringify(s)).catch(() => {}); },
    });
    void hydrateHomeWord().then(() => setWordHydrated((v) => v + 1));
  }, []);
  // ★ 2026-11-26（用户）：首页背景图可在设置页选择，点选后即时换图、重启后保持。
  //   ★ 修复：直接用 require 固定新默认图初始化（避免 module 初始化顺序导致拿到旧 source），
  //     hydrate/订阅仍保留，让用户在设置页选的图即时生效。
  // ★ 2026-11-26 定稿：首页背景用内联 base64（同工具卡方案），彻底绕开 Metro asset id
  //   映射错位——真机上 require 的图片 id 曾渲染成旧的雪坡图，无论换文件名/清缓存都无效。
  const [homeBgSource, setHomeBgSource] = useState<ImageSourcePropType>({ uri: HOME_BG_DATA_URI });
  useEffect(() => {
    // ★ 2026-11-26 定稿：首页固定用藏蓝小屋新图（上面 require 写死）。
    //   旧 prefs 里残留的 snow/alpine/night/reflection 会经 hydrate 的 emit 把图冲回旧版，
    //   所以首页彻底不订阅背景切换——设置页选择器作为「预览其它图」入口保留，
    //   但默认首页永远是新图。需要恢复切换时把这里改回订阅即可。
    void hydrateHomeBackground();
  }, []);
  // ★ 2026-10-26（用户）：首页 5 张指标卡改为接真实数据（之前 4 张写死静态预览值）。
  //   订阅 RingBle 实时状态，数据推送/重连即刷新卡片；派生值口径与 TodayScreen 顶部 chips 同源。
  const [ring, setRing] = useState(() => RingBle.getState());
  useEffect(() => RingBle.onState((s) => setRing(s)), []);
  // ★ 2026-11-11（用户）：男性用户首页隐藏「生理周期」chip（男性无生理周期）。
  //   profile.gender 由 Onboarding 采集；订阅 onSessionChange 即时反映设置变更。
  const [gender, setGender] = useState<Gender | undefined>(() => getCachedSession()?.profile?.gender);
  useEffect(() => {
    const sync = () => setGender(getCachedSession()?.profile?.gender);
    sync();
    return onSessionChange(sync);
  }, []);
  const showCycle = gender !== 'male';
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
  // ★ 2026-11-14（P30 真机，用户：「昨天没连戒指，睡眠数据应该是空的，但首页显示了一个数字，
  //   点进去又是个空页」）：取消睡眠的历史回落。
  //   根因：原 `lastDayWithData(['sleep'])` 会往回扫 30 天，拿 N 天前的旧分数显示在首页；
  //   而 SleepDetailScreen 严格只认今天（且要求 total>0）→ 首页有数字 / 详情空态。
  //   睡眠是「每晚一条」的强时效指标，断连就该空，不能用历史值冒充今天。
  //   口径与详情页完全一致：dayKey(今天) + healthStore.getSleep(今天).total > 0。
  const recoveryDay = dayKey(Date.now());
  const hasRealSleepToday = (() => {
    try {
      const s = healthStore.getSleep(recoveryDay);
      return !!s && Number(s.total) > 0;
    } catch { return false; }
  })();
  const recoveryScore = useMemo(
    () => (hasRealSleepToday ? sleepRecoveryScoreForDay(dayKeyToTs(recoveryDay)) : null),
    [refreshKey, recoveryDay, hasRealSleepToday],
  );
  const hasRecoveryData = hasRealSleepToday && recoveryScore != null;
  // 无数据时不产出数字 0（避免 0 继续往叙事 / 圆环里传，被当成有效值）
  const RECOVERY: number | null = hasRecoveryData ? Math.round(recoveryScore!) : null;
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

  // ★ 2026-11-11（用户：「建议要和分析联动」「中午吃点好的吧 → 胶囊去拍张照记饮食」）：
  //   胶囊默认展示与上方分析**同源**的规则建议（narrative.suggestion，见下方）。
  //   suggestionEngine 现在只做一件事：用户点过 CTA 从工具页回来后给一条不同的下一条，
  //   免得「刚从拍照页回来，胶囊还写着去拍照」；下一个半小时状态点一到就自动回到同源建议。
  const [followUpSugg, setFollowUpSugg] = useState<SuggestionCandidate | null>(null);
  const suggTapRef = useRef(false);
  const navTo = useCallback((screen: string, params?: Record<string, unknown>) => {
    suggTapRef.current = true;
    (navigation.navigate as unknown as (screen: string, params?: Record<string, unknown>) => void)(screen, params);
  }, [navigation]);
  // 刚点过建议从工具页回来 → 换一条（引擎避开刚展示的 id，被否的有 30 天冷却）
  useFocusEffect(
    useCallback(() => {
      if (!suggTapRef.current) return;
      suggTapRef.current = false;
      void pickSuggestion(status, { requireCta: true, force: true })
        .then((c) => { if (c) setFollowUpSugg(c); })
        .catch(() => { /* 引擎异常 → 保留同源建议 */ });
    }, [status]),
  );
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
  const qcStress = qcValid?.stress?.value ?? null;
  const curveHasValue = CV != null && !CV_STALE;
  // ★ 本轮（用户：一键体检后今日状态/身心状态要同步到首页）：当日有效的体检结果优先于连续曲线，
  //   曲线仅在「今天没做过体检」时兜底。体检结果按自然日有效（跨天清零），不会长期压住连续数据。
  const displayStatus = qcStatus?.value != null ? qcStatus.value : (curveHasValue ? CV : null);
  const hasStatusData = displayStatus != null;
  const statusFromCheck = qcStatus?.value != null;
  // ★ 2026-11-10（用户）：首页「今日状态」下方加一行「更新时间 几时几点」——
  //   取最近一次数据刷新时刻：优先一键体检完成时刻；否则戒指最近同步时刻；
  //   否则取各项指标里最新的真实采样时刻（ring.lastUpdated）。空态不显示。
  // ★ 2026-11-11（用户：更新时间应落在整点 / 半点，如 15:00、15:30，不要出现 15:47 这类任意分钟）：
  //   展示前把时刻对齐到最近的 :00 / :30。**向下取整**（<30 取整点、≥30 取半点），
  //   绝不进位到未来——否则 18:25 会被取整成 18:30（明明还没到），用户看到「更新时间是未来」很困惑。
  const snapHalfHour = (ts: number): number => {
    const d = new Date(ts);
    const m = d.getMinutes();
    if (m < 30) d.setMinutes(0, 0, 0);
    else d.setMinutes(30, 0, 0);
    return d.getTime();
  };
  const statusUpdatedAt: number | null = (() => {
    if (statusFromCheck && qcValid?.createdAt) return snapHalfHour(qcValid.createdAt);
    if (ring.lastSyncedAt) return snapHalfHour(ring.lastSyncedAt);
    const lus = Object.values(ring.lastUpdated ?? {}).filter(
      (t): t is number => typeof t === 'number' && t > 0,
    );
    return lus.length ? snapHalfHour(Math.max(...lus)) : null;
  })();
  const EMPTY_COLOR = theme.colors.stateEnergy; // 空态统一紫（与 EnergyBall 圆环同源）
  const mood = !hasStatusData
    ? { label: '暂无数据', color: EMPTY_COLOR }
    : displayStatus! >= 76 ? { label: '元气满满', color: '#F0C46E' }
    : displayStatus! >= 51 ? { label: '状态良好', color: '#BCCB62' }
    : displayStatus! >= 26 ? { label: '平平静静', color: '#9D8AF0' }
    : { label: '休息一下', color: '#F0B5C4' };
  const moodLabel = mood.label;
  const moodColor = mood.color;
  // ★ 2026-11-13（用户）：圆环中心展示词 = 时段 × 档位 自然大标题（不改动 moodLabel，后者仍喂叙事引擎）
  const moodLevel: 0 | 1 | 2 | 3 = !hasStatusData
    ? 0
    : displayStatus! >= 76 ? 0
    : displayStatus! >= 51 ? 1
    : displayStatus! >= 26 ? 2
    : 3;
  // ★ 2026-11-14（用户）：标题词不再自己取 new Date()，改为复用 narrative.phase
  //   （定义在下方 narrative 之后），与分析/建议/配图共用一个时段，杜绝跨时段边界错位。
  // ★ 2026-11-11：叙事按半小时节拍推进。圆环的 :00/:30 状态点会触发 RingBle.onState 重渲染，
  //   但断流时没有新点 —— 仍要一个墙钟滴答，保证跨时段（傍晚 → 睡前）必定翻页，
  //   绝不出现「已经深夜了，下面还挂着下午那段话」。
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const halfSlotNow = Math.floor(nowTick / (30 * 60 * 1000));
  // ★ 2026-11-14：场景词引擎需要的副信号（久坐判定），在 nowTick 之后算一次即可
  const phaseNow = dayPhase(new Date(nowTick));
  const drvSteps = healthStore.getTimeRange('steps', nowTick - 90 * 60e3, nowTick, { maxPoints: 240 });
  const drvStepSum = drvSteps.reduce((a: number, p: any) => a + (Number.isFinite(p?.v) ? p.v : 0), 0);
  const activityNow = drvSteps.length ? drvStepSum / (3 * 600) : 1;
  const sedentary = phaseNow === 'afternoon' && activityNow < 0.2;
  // 干预行为日志异步读盘；加载完成后触发一次重算，让「刚缓了一缓」能进归因。
  const [interventionVersion, setInterventionVersion] = useState(0);
  useEffect(() => {
    void ensureInterventionLogLoaded().then(() => setInterventionVersion((v) => v + 1));
  }, []);
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

  // ★ 2026-11-14（用户）：今日自报心情偏沉/紧 → 进关系链（与心率/运动/压力并列），丰富「状态为什么变」的归因
  const lowMoods = new Set(['tired', 'stressed', 'anxious', 'sad', 'angry', 'lonely']);
  const latestMood = (() => { try { return getLatestForDay(dkToday); } catch { return null; } })();
  const moodLow = !!latestMood && lowMoods.has(latestMood.mood);
  // 脑力准备度高峰：取今日状态曲线峰值时刻（与「脑力准备度」同源）；无数据则不给具体小时
  const brainPeakHour = useMemo(() => {
    const pts = (ring?.statusTimeline ?? []).filter((p: any) => {
      const d = new Date(p?.t); const n = new Date(nowTick);
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() && p?.value > 0;
    });
    if (pts.length < 2) return null;
    let best: any = pts[0];
    for (const p of pts) if (p.value > best.value) best = p;
    const d = new Date(best.t);
    return d.getHours() + d.getMinutes() / 60;
  }, [ring?.statusTimeline, dkToday, nowTick]);

  // 身心压力：与「基础指标 → 压力」卡同源 —— 设备 SDK 压力信号经 stressAlgorithm 算出的当前压力分（0–100，越高越紧张）。
  // ★ 2026-10-26 修复：此前误用 ring.metrics['stress']，但 RingBle 的 metrics 只填 hr/hr，daily 也不含 stress，
  //   该字段恒为 null → 身心压力卡永远「— / 暂无数据」；改用 computeStressReport().score（与 MetricDetail「压力」卡同源）。
  // ★ 2026-11-09：身心压力回落到最近一个有心率/皮电的天（今天无 hr/eda 时显示最近有数据的那天）
  const stressDay = lastDayWithData(['hr', 'eda']);
  // ★ 2026-11-15（用户：跨天首点保留值 + 修 dayKeyToTs=中午的潜 bug）：
  //   今天 → 用 Date.now() 读「今天 00:00 → 此刻」（实时，且读完整天而非仅上午 00:00–12:00）；
  //   过去天（跨天回退）→ 窗口上限取「当天 23:59」，读满整天压力，作为冻结保底值显示，直到今天出数据。
  const stressReport = useMemo(() => {
    try {
      const isToday = stressDay === dayKey(Date.now());
      const upper = isToday ? Date.now() : dayStartMs(dayKeyToTs(stressDay)) + 86400000 - 1;
      return computeStressReport(upper);
    } catch { return null; }
  }, [refreshKey, stressDay]);
  const bodyLoad = stressReport?.score ?? null;
  // ★ 本轮（用户：体检的身心压力也要同步到首页「身心压力」卡）：当日有效的体检压力优先，否则回退到戒指连续压力分。
  const displayStress = qcStress != null ? qcStress : bodyLoad;

  // 情绪：emotionalStress 多信号融合（0–100，50=和平时差不多；越高压力越大）
  const esReport = useMemo(() => {
    try { return computeEmotionalStress(dayKeyToTs(stressDay), sportSessions); } catch { return null; }
  }, [refreshKey, sportSessions, stressDay]);
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
  // ★ 本轮（用户）：男性不展示生理周期相位，首页分析里也不出现「处于卵泡期/黄体期」等措辞
  const dayInCycle = showCycle ? (status?.dayInCycle ?? null) : null;
  const phaseLabel = showCycle ? (status?.phaseLabel ?? null) : null;
  // ★ 2026-10-27 修复：双弧周期药丸此前写死 CYCLE_DAY=14，与上方真实「生理周期」卡不一致；
  //   改用真实周期日（无记录时回退 14），让弧与卡口径统一。
  const cycleDay = dayInCycle ?? CYCLE_DAY;
  const cyclePhaseNow = phaseLabel && phaseLabel !== '未记录' ? phaseLabel : cyclePhase(cycleDay);

  // ★ 2026-11-11：首页叙事 = 规则定事实 + AI 只润色。
  //   points 只取今天的 30 分钟真实状态点（fill 补齐点由规则引擎再过滤一次）；
  //   events 只取已发生、3 小时内的真实动作 / 运动段，绝不用昨天的行为解释今晚；
  //   recoveryScore 只有早晨会被采用，其余时段连「睡眠恢复」四个字都不会出现。
  const narrative = useMemo(() => {
    const now = nowTick;
    const points: NarrativePoint[] = ((ring?.statusTimeline ?? []) as any[]).map((p) => ({
      t: Number(p?.t), value: Number(p?.value), fill: p?.fill === true,
    }));
    const events: NarrativeEvent[] = [];
    try {
      for (const e of allInterventionEntries()) {
        if (typeof e?.ts === 'number' && e.ts <= now && now - e.ts <= 3 * 3600e3) {
          events.push({ at: e.ts, label: String(e.kind), kind: 'action' });
        }
      }
    } catch { /* 行为日志未就绪 → 跳过，不影响主叙事 */ }
    for (const s of (ring?.sportSessions ?? []) as any[]) {
      const t = Number(s?.beginTime);
      if (Number.isFinite(t) && t > 0 && t <= now && now - t <= 3 * 3600e3) {
        events.push({ at: t, label: '动了一阵', kind: 'sport' });
      }
    }
    // ★ 诚实口径守卫：卡片行允许「回落到最近有数据的一天」，但**叙事不许**拿几天前的
    //   睡眠说成「昨晚」、拿几天前的压力说成「一直没松开」。睡眠只认今天/昨夜，压力只认今天。
    const todayDk = dayKey(now);
    const yesterdayDk = dayKey(now - 86400000);
    const recoveryIsRecent = recoveryDay === todayDk || recoveryDay === yesterdayDk;
    const stressIsToday = stressDay === todayDk;

    // ★ 关系链驱动信号：从近 90 分钟真实 HR / 步数，算「心率升高」「运动」两个元素，
    //   让首页分析能把状态下滑归因到具体数据（与 dailyStatus 消耗项 K_DR_HR / K_DR_STEP 同源）。
    const DRV_WIN = 90 * 60e3;
    const recentHr = healthStore.getTimeRange('hr', now - DRV_WIN, now, { maxPoints: 240 });
    const hrVals = recentHr.map((p) => p.v).filter((v) => Number.isFinite(v) && v > 30 && v < 160);
    let hrElev: number | null = null;
    if (hrVals.length >= 3) {
      const hrMean = hrVals.reduce((a, b) => a + b, 0) / hrVals.length;
      // 静息代理：近 6 小时 HR 的 10 分位（近似静息心率），避免再引一套基线
      const wide = healthStore
        .getTimeRange('hr', now - 6 * 3600e3, now, { maxPoints: 600 })
        .map((p) => p.v)
        .filter((v) => Number.isFinite(v) && v > 30 && v < 160)
        .sort((a, b) => a - b);
      const hrRest = wide.length ? wide[Math.floor(wide.length * 0.1)] : 60;
      hrElev = Math.max(0, (hrMean - hrRest) / hrRest);
    }
    const recentSteps = healthStore.getTimeRange('steps', now - DRV_WIN, now, { maxPoints: 240 });
    let activity: number | null = null;
    if (recentSteps.length) {
      const stepSum = recentSteps.reduce((a, p) => a + (Number.isFinite(p.v) ? p.v : 0), 0);
      activity = stepSum / (3 * 600); // 3 个 30min 窗 × CURVE 步数基线(600)
    }

    // ★ 2026-11-14（用户点名「心率血氧身心心率变异性…可以展示出来」）：把血氧、心率变异性也并进
    //   「状态为什么变」的关系链——状态下滑时，和心率升高、运动、压力、心情一样，
    //   作为「可能和…有关」的可核对元素之一。口径：血氧取近 90 分钟均值，低于 94%（日常清醒态常见
    //   下限，非诊断）视为偏低；HRV 取近 90 分钟均值相对近 6 小时自身基线（中位数）下降 >20% 视为
    //   偏低，一律「相对自己」、不带绝对医学阈值，避免误报/诊断口径。无任何点则不给（不编造）。
    const recentSpo2 = healthStore.getTimeRange('spo2', now - DRV_WIN, now, { maxPoints: 240 });
    const spo2Vals = recentSpo2.map((p) => p.v).filter((v) => Number.isFinite(v) && v > 70 && v <= 100);
    const spo2Mean = spo2Vals.length ? spo2Vals.reduce((a, b) => a + b, 0) / spo2Vals.length : null;
    const spo2Low = spo2Mean != null && spo2Mean < 94 ? true : null;
    const recentHrv = healthStore.getTimeRange('hrv', now - DRV_WIN, now, { maxPoints: 240 });
    const hrvVals = recentHrv.map((p) => p.v).filter((v) => Number.isFinite(v) && v > 5 && v < 250);
    const hrvMean = hrvVals.length ? hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length : null;
    const wideHrv = healthStore
      .getTimeRange('hrv', now - 6 * 3600e3, now, { maxPoints: 600 })
      .map((p) => p.v)
      .filter((v) => Number.isFinite(v) && v > 5 && v < 250)
      .sort((a, b) => a - b);
    const hrvBase = wideHrv.length ? wideHrv[Math.floor(wideHrv.length * 0.5)] : null;
    const hrvLow = hrvMean != null && hrvBase != null ? (hrvMean < hrvBase * 0.8 ? true : null) : null;

    return buildHomeNarrative({
      now, points, mood: moodLabel,
      stress: qcStress != null ? qcStress : (stressIsToday ? bodyLoad : null),
      events, phaseLabel,
      recoveryScore: hasRecoveryData && recoveryIsRecent ? RECOVERY : null,
      hasStatusData, statusFromCheck,
      hrElev, activity,
      // ★ 2026-11-14：把圆环档位喂给叙事引擎，作为标题/分析/建议/CTA 的共同主题真源
      topicLevel: moodLevel,
      // ★ 2026-11-14：场景词/久坐/脑力高峰/今日心情 四类信号，让「词→分析→建议」同源一致
      sedentary, brainPeakHour, moodLow,
      // ★ 2026-11-14（用户）：血氧 / 心率变异性 并进关系链，状态下滑时一并解释综合数据变化
      spo2Low, hrvLow,
    });
  }, [
    halfSlotNow, ring?.statusTimeline, ring?.sportSessions, refreshKey, interventionVersion,
    moodLabel, bodyLoad, qcStress, phaseLabel, RECOVERY, hasRecoveryData, hasStatusData, statusFromCheck,
    recoveryDay, stressDay,
    sedentary, brainPeakHour, moodLow,
  ]);
  // AI 只负责换个说法：首帧显示规则句，润色到货才无声替换；判废则一直是规则句。
  const polished = useHomePolish(narrative.analysis, narrative.signature, narrative.polishCtx);
  const homeAnalysis = fitHomeAnalysis(polished ?? narrative.analysis);
  // ★ 2026-11-14（用户）：圆环中心词 = 「场景词短暂出现后回落到底层档位词」。
  //   底层四词（元气满满/状态良好/平平静静/休息一下）按档位常态展示；
  //   刚醒/临近中午/午后久坐/傍晚下班/睡前 才短暂露出场景词（摸个鱼/收个工…），出现一两次即回落，不长时间霸屏。
  const moodHeadline = hasStatusData
    ? pickHomeWord({ phase: narrative.phase, level: moodLevel, sedentary, now: nowTick }).word
    : '暂无数据';
  // 半小时状态点 / 时段 / 方向 / 主题任一变化 → 回到与分析同源的建议（清掉「点完换的下一条」）
  useEffect(() => { setFollowUpSugg(null); }, [narrative.signature]);

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
      // ★ 2026-11-14：无真实睡眠归档时一律「—」+「暂无数据」，不显示任何数字。
      value: hasRecoveryData && RECOVERY != null ? String(RECOVERY) : '—',
      unit: hasRecoveryData && RECOVERY != null ? '/100' : undefined,
      tag: RECOVERY == null ? '暂无数据'
        : RECOVERY >= 76 ? '恢复良好'
        : RECOVERY >= 51 ? '恢复较好'
        : RECOVERY >= 26 ? '恢复中'
        : '恢复偏弱',
      good: RECOVERY != null && RECOVERY >= 51,
    },
    load: {
      // ★ 本轮（用户：体检的身心压力同步到首页）：displayStress 当日体检优先，否则回退戒指连续压力分。
      value: displayStress != null ? String(displayStress) : '—',
      unit: displayStress != null ? '/100' : undefined,
      tag: displayStress == null ? '暂无数据'
        : displayStress < 30 ? '日间轻松'
        : displayStress < 55 ? '日间适中'
        : '日间偏重',
      good: displayStress != null && displayStress < 30,
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
  // ★ 2026-11-08（用户：分析文字第一行被圆环/档位词压住）：分析文字下移 318→348。
  //   根因：gaugeCenter（大数字 46 + 档位词 h1）实际内容底 ≈ gaugeTop+206k+118，
  //   超出仪表盒底（gaugeTop+300k），而 318k 起排的分析文字正好撞上 → 首行被盖。
  //   348k 后与档位词底留出 ~15px 呼吸间隙。
  // ★ 2026-11-09（用户：「状态良好下面那段文案可以是三行；放不下的话三张卡片再往下一点挪」）：
  //   348→340（上移约 7dp，与档位词仍留 ~13dp 间隙），把腾出的高度让给第三行文案。
  const analysisTop = gaugeTop + 340 * k;              // 分析文字（★ 2026-11-03 310→318；★ 2026-11-08 318→348 修复与圆环档位词重叠）
  // ★ 2026-11-09 修复「两行自锁」：旧逻辑把最大高度按贴底卡片行反算，P30(745dp) 只余 ~50dp
  //   → numberOfLines 被钳成 2 行；而 analysisH 来自「已截断文本」的 onTextLayout，只报 2 行，
  //   于是高度永远回不到三行，长文案一直显示「…但…」。现在行数上限只由屏幕几何决定，
  //   与被测文本高度无关，三行不再被锁死。
  const LINE_H = 25;                    // 与 s.analysis.lineHeight 一致
  const MAX_ANALYSIS_LINES = 3;        // 用户：文案可以是三行
  const [analysisH, setAnalysisH] = useState(2 * LINE_H);
  const [capsuleH, setCapsuleH] = useState(54);        // 建议胶囊实测高度（1~2 行）
  // 中间空白收紧：分析↔胶囊 12→6、胶囊↔卡片 12→6（胶囊自身 marginTop 8→4 见样式），
  // 换出 ~18dp 给第三行；底部是悬浮玻璃 tab（marginBottom 10），卡片底可轻微探到 tab 后面，
  // 因此卡片行取「最靠下的安全位置」= 卡片整体下移，且 tag 文字仍在 tab 之上、不被遮挡。
  const ANALYSIS_GAP = 6;       // 分析文字底 ↔ 胶囊
  const CARD_GAP = 6;           // 胶囊底 ↔ 卡片顶
  const CARD_BOTTOM_GAP = -4;   // 卡片底相对 tab 名义顶（height-56）：负值 = 允许探入悬浮 tab 区
  const chipRowBase = height - 56 - CARD_BOTTOM_GAP - CHIP_H;
  // 固定几何上限（不含 analysisH）→ 不会自锁；短屏自动降到 2 行，P30 稳定 3 行。
  const maxAllowedAnalysisH = Math.max(2 * LINE_H,
    chipRowBase - analysisTop - ANALYSIS_GAP - capsuleH - CARD_GAP - 2);
  // ★ 2026-11-10（用户：三行把话说完）：下限从 2 提到 3。文案已在渲染前按字数裁到完整分句
  //   （见 fitHomeAnalysis），不会被截出省略号；胶囊与下方卡片由 capsuleTop/chipRowTop 联动下移。
  const displayLines = Math.max(3, Math.min(MAX_ANALYSIS_LINES, Math.floor(maxAllowedAnalysisH / LINE_H)));
  const safeAnalysisH = Math.min(analysisH, displayLines * LINE_H);
  // 胶囊永远贴分析文字实际底沿；卡片行取「贴底安全位」与「胶囊底 + 间隙」较大值，
  // 文案三行时胶囊顺势下移、卡片保持在最下方，不与胶囊重叠、不压底部导航。
  const capsuleTop = analysisTop + safeAnalysisH + ANALYSIS_GAP;
  const chipRowTop = Math.max(chipRowBase, capsuleTop + capsuleH + CARD_GAP);

  return (
    <View style={[s.root, { backgroundColor: PAGE_BG }]}>
      {/* ★ 2026-11-26：首页背景 = 设置页选中的图（默认高清雪景照），全屏 cover 覆盖。
          整体轻磨砂（BlurView）保留照片观感又统一磨砂质感；底部加深一点保证磨砂卡/玻璃 tab 可读。 */}
      {/* ★ 2026-11-26：背景图按真机 1080×2340 精确制作，stretch 保证纵向百分比 1:1 映射，
          不用 cover（cover 在长屏上按高度缩放+裁左右，之前小屋位置算错就栽在这）。 */}
      <Image
        source={homeBgSource}
        style={StyleSheet.absoluteFill}
        resizeMode="stretch"
      />
      {/* 整体磨砂：★ 2026-11-26 强度 18 → 6。原图仅 491×968 且叠 18 强度高斯模糊，
          真机反馈背景糊；已换 1024×1366 高清图，模糊降到 6 保磨砂质感但保留风景细节。 */}
      <BlurView style={StyleSheet.absoluteFill} intensity={6} tint="default" />
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
          // ★ 2026-11-08（真机截图：档位词「状态良好 ›」下半截被裁掉）：根因 = 中心文字组
          //   （大数字 46 + 档位词 h1）实际高度超出 300×300 仪表盒（约溢出 26k），渲染时被
          //   盒子底边裁切。修法 = 容器加高 96k 容纳溢出文字；Svg 改固定 gaugeSize 尺寸
          //   （不再 100% 拉伸，避免跟随容器变高把圆环下移）。
          style={[s.gauge, { width: gaugeSize, height: gaugeSize + 96 * k, overflow: 'visible' }]}
          activeOpacity={0.85}
          accessibilityLabel="查看全天状态趋势详情"
          onPress={() => navigation.navigate('StatusTrendDetail')}
        >
          <Svg width={gaugeSize} height={gaugeSize} viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
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
            <Circle cx={arcEnd.x} cy={arcEnd.y} r={13} fill="rgba(255,255,255,0.3)" />
            <Circle cx={arcEnd.x} cy={arcEnd.y} r={7} fill="#FFFFFF" />
          </Svg>
          {/* 数字落圆下部开口处（圆心空）：★ 2026-11-03 整体下移，正好落在 0/100 中间开口处 */}
          {/* ★ 2026-11-10（用户：「更新时间压住了下面那段话」）：中心文字组新增一行「更新时间」后，
              内容底比原来多出 ~20dp，正好盖住分析文字首行。整体 206→196 上移 10k，
              再配合下方 gUpd 的 marginTop 收紧，让更新时间停在分析文字上方、留出呼吸间隙。 */}
          <View style={[s.gaugeCenter, { top: 196 * (gaugeSize / 300) }]}>
            <Text style={s.gBig}>{hasStatusData ? displayStatus : '—'}</Text>
            {/* ★ 2026-11-03（用户）：档位词右边加向右箭头 —— 提示整块可点、进入全天状态趋势（外层 gauge 已是 TouchableOpacity） */}
            <View style={s.gLabelRow}>
              <Text style={s.gLabel}>{moodHeadline}</Text>
              <Icon name="chevronRight" size={theme.fontSize.body} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
            </View>
            {/* ★ 2026-11-10（用户）：状态词下方一行「更新时间 几时几点」——取最近一次数据刷新时刻（见 statusUpdatedAt） */}
            {statusUpdatedAt != null && hasStatusData ? (
              <Text style={s.gUpd}>{formatUpdateTime(statusUpdatedAt)}</Text>
            ) : null}
          </View>
          {/* 0 / 100 刻度（左 0、右 100）★ 2026-11-08：容器加高后 % 定位会随高度漂移，改弧端点绝对像素（弧端 y=234.6/300） */}
          <Text style={[s.scaleTxt, { left: '30.8%', top: 234.6 * (gaugeSize / 300) }]}>0</Text>
          <Text style={[s.scaleTxt, { left: '69.2%', top: 234.6 * (gaugeSize / 300) }]}>100</Text>
        </TouchableOpacity>
      </View>

      {/* 指标卡行：★ 2026-11-07（用户）：取消横向滑动，改为整行等宽平铺，不再有右滑阴影。
          位置在海浪/深色交界线正下方（过渡区深色渐变带上）。每张可点进对应详情页。
          ★ 2026-11-16（用户）：PRO_UI 首页也只展示三张卡（睡眠恢复/身心压力/活动消耗），
            与基础版完全一致——情绪压力、生理周期不再上首页（详情页路由保留，入口另说）。 */}
      <View style={[s.chipRowZone, { top: chipRowTop, height: CHIP_H }]}>
        <View style={s.chipRow}>
          {BASE_CHIP_DEFS
            .filter((c) => c.key !== 'cardio' || !!vo2)
            .filter((c) => showCycle || c.key !== 'cycle')
            .map((c) => {
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

      {/* 分析文字（浮于照片，无卡片底）★ 2026-11-09：最多三行完整展示（用户），
          行数由屏幕几何决定、不再被自身实测高度锁死；实测行高仍驱动下方胶囊与卡片行联动。
          ★ 2026-11-08：优先展示真实 AI 综合分析（端侧模型生成）；模型未就绪 / 无数据 → 回落下方本地模板。 */}
      <View style={[s.analysisWrap, { top: analysisTop }]}>
        <Text
          style={s.analysis}
          numberOfLines={displayLines}
          ellipsizeMode="clip"
          onTextLayout={(e) => {
            // 用实际渲染行数 × 行高作为分析块高度，驱动下方胶囊与卡片行联动下移。
            // ★ 2026-11-09：行数上限不再由这里反算，避免「截成 2 行 → 报 2 行 → 永远回不到三行」的自锁。
            const n = e.nativeEvent.lines.length;
            if (n > 0) setAnalysisH(n * LINE_H);
          }}
        >
          {/* ★ 2026-11-11（用户）：不再罗列「今天的 77 分，睡眠恢复 89，日间身心压力 47」。
              分数由圆环大数字承担，这里只讲「这段时间状态怎么变的、大概和什么有关」，
              且时段由当前墙钟决定 —— 晚上不会再冒出昨晚的睡眠恢复。 */}
          {!hasStatusData
            ? '今天还没有状态数据，做一次一键体检就能看到。'
            : (homeAnalysis ?? narrative.analysis)}
        </Text>
      </View>
      {/* 建议胶囊：★ 2026-11-10（用户）：一行建议、不啰嗦；
          只有「真能跳转到对应工具页」的建议（cta 存在 / 空态引导体检）才显示 › 箭头并响应点击；
          AI 建议与状态观察型建议无落地页 → 不画箭头、不可点（避免「点一下像能跳其实跳不了」）。 */}
      <View style={[s.capsuleWrap, { top: capsuleTop }]}>
        {(() => {
          let text: string;
          let onPress: (() => void) | null = null;
          if (!hasStatusData) {
            text = '去一键体检，获取最新的健康数据 ›';
            onPress = onGoQuickCheck;
          } else if (
            followUpSugg?.cta &&
            // ★ 2026-11-14（用户）：点完 CTA 换的「下一条」也必须服从当前主题，
            //   否则午休主题下引擎仍可能塞回「快到饭点了，拍张照记这餐」。
            !(narrative.topic !== 'meal' && (
              isMealCopy(`${followUpSugg.headline ?? ''}${followUpSugg.action ?? ''}${followUpSugg.question ?? ''}`) ||
              followUpSugg.cta.screen === 'FoodScan'
            ))
          ) {
            // 点过 CTA 从工具页回来后的下一条：仍是「说的 = 跳到的」
            const cta = followUpSugg.cta;
            text = `${followUpSugg.headline ?? followUpSugg.action ?? '缓一缓'} ›`;
            onPress = () => navTo(cta.screen, cta.params);
          } else if (narrative.suggestion.cta) {
            // ★ 与分析同源：中午「吃点好的吧」→「拍张照，记下这顿吃了什么」，点了直达拍照记录页；
            //   状态回落「先喘口气」→ 具体节奏的放松呼吸，点了直达呼吸练习。
            const cta = narrative.suggestion.cta;
            text = `${narrative.suggestion.text} ›`;
            onPress = () => navTo(cta.screen, cta.params);
          } else {
            // 观察型建议无落地页：纯展示一行人话，不画箭头、不可点
            text = narrative.suggestion.text;
          }
          const content = (
            <Text style={s.relaxPillTxt} numberOfLines={1}>{text}</Text>
          );
          if (onPress) {
            return (
              <TouchableOpacity style={s.relaxPill} activeOpacity={0.85}
                onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) setCapsuleH(h); }}
                onPress={onPress}>
                {content}
              </TouchableOpacity>
            );
          }
          return (
            <View style={s.relaxPill}
              onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) setCapsuleH(h); }}>
              {content}
            </View>
          );
        })()}
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
    backgroundColor: theme.colors.ui.white55,
    borderWidth: 1,
    borderColor: theme.colors.ui.white75,
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
  chipLabel: { fontSize: theme.fontSize.xs, fontWeight: '500', color: theme.colors.ui.white62, letterSpacing: 0.1 },
  chipLabelBig: { fontSize: theme.fontSize.sm, color: theme.colors.ui.white78 },
  chipValRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 3 },
  chipVal: { fontSize: theme.fontSize.card, fontWeight: '700', color: theme.colors.textWhite },
  chipValBig: { fontSize: theme.fontSize.h2 },
  chipValGood: { color: '#D5E384' },
  chipUnit: { fontSize: theme.fontSize.tiny, color: theme.colors.ui.white62, marginLeft: 1.5 },
  chipTag: { fontSize: theme.fontSize.tiny, color: theme.colors.ui.white50, marginTop: 3 },

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
  gLabel: { fontSize: theme.fontSize.h1, color: theme.colors.ui.white85, fontWeight: '600' },
  // ★ 2026-11-03：档位词 + 右箭头行（整块仍随外层 gauge 可点 → 全天状态趋势）
  gLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  // 「更新时间」副行：★ 2026-11-10（用户）marginTop 6→2，配合 gaugeCenter 上移，不再压住下方分析文字
  gUpd: { fontSize: theme.fontSize.xs, color: theme.colors.ui.white55, marginTop: 2 },
  // 建议胶囊（★ 2026-11-04 动态建议：maxWidth 防长文案撑爆，最多两行）
  relaxPill: {
    marginTop: 4, // ★ 2026-11-09：8→4，与分析↔胶囊间距一起收紧，换出高度给第三行文案
    maxWidth: '92%', // ★ 2026-11-08（用户：宽度自定义）：胶囊贴内容自适应宽度，上限 92% 防溢出
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.ui.white12,
    borderWidth: 1,
    borderColor: theme.colors.ui.white28,
  },
  relaxPillTxt: { fontSize: theme.fontSize.body, fontWeight: '600', color: theme.colors.textWhite, textAlign: 'center' },

  // 分析文字（浮于照片，无卡片底）
  analysisWrap: { position: 'absolute', left: 24, right: 24 },
  capsuleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  scaleTxt: {
    position: 'absolute', fontSize: theme.fontSize.xs, fontWeight: '600', color: theme.colors.ui.white60,
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
    borderColor: theme.colors.ui.white17,
    borderWidth: 1,
  },
  analysis: { fontSize: theme.fontSize.card, lineHeight: 25, color: theme.colors.ui.white92, marginBottom: 0, textAlign: 'center' },
  hl: { fontWeight: '700', color: '#BFCBFF' },
  sug: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: theme.colors.ui.white14,
  },
  sugThumb: { width: 56, height: 56, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.ui.white35 },
  sugH: { fontSize: theme.fontSize.card, fontWeight: '600', color: theme.colors.textWhite },
  sugD: { fontSize: theme.fontSize.sm, color: theme.colors.ui.white65, marginTop: 2 },
  goPill: { backgroundColor: 'rgba(160,178,255,0.95)', borderRadius: theme.radius.pill, paddingHorizontal: 15, paddingVertical: 7 },
  goTxt: { fontSize: theme.fontSize.body, fontWeight: '600', color: '#101C33' },
});
