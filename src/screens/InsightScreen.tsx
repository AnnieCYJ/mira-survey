import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity, Pressable, Animated, useWindowDimensions, StatusBar } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Path as SvgPath, Defs, LinearGradient as SvgGradient, Stop, Rect as SvgRect, Text as SvgText, Line as SvgLine, Circle as SvgCircle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import EcgCard from '../components/EcgCard';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import ScreenContainer from '../components/ScreenContainer';
import Chip from '../components/Chip';
import InsightBanner from '../components/InsightBanner';
import SleepStructureCard from '../components/SleepStructureCard';
import CyclePhaseCard from '../components/CyclePhaseCard';
import BasicMetricCard from '../components/BasicMetricCard';
import ManualMetricCard from '../components/ManualMetricCard';
import ListCard, { type ListItem } from '../components/ListCard';
import Card from '../components/Card';
import Icon from '../components/Icon';
import { estimateHealthAge } from '../lib/healthAgeEstimate';
import ExamTab from '../components/ExamTab';
import QuickCheckTab from '../components/QuickCheckTab';
import { getLatestExamRecord } from '../data/examStore';
import ChatSheet from '../components/ChatSheet';
import EmotionInsightView from '../components/EmotionInsightView';
import EmotionQuickRecord from '../components/EmotionQuickRecord';
import CognitiveLoadCard from "../components/CognitiveLoadCard";
import CortisolSleepSummary from '../components/CortisolSleepSummary';
import CortisolRhythmCard from '../components/CortisolRhythmCard';
import {
  METRICS,
  BASIC_METRICS,
  signalsForDimension,
  type MetricKey,
  type BasicMetricDef,
} from '../data/metrics';
import { getTodaySeries } from '../lib/realSeries';
import { RingBle, type RingState, type MetricKey as RingMetricKey, type EcgReading } from '../ble/RingBleManager';
import { useDeviceModel, hasCap, type DeviceCapabilities } from '../config/deviceModel'; // ★ 2026-11-04（用户：双机型）
// ★ 2026-11-05：基础版禁止把 HK18 历史归档当成当前戒指温度/皮电数据源
import { LEGACY_HISTORY_BLOCKED_KEYS, saneBodyTemp } from '../data/ringDataIsolation';
import { healthStore, dayKey } from '../data/healthStore';
import { useAppState } from '../state/AppState';
import { useHealthStoreVersion, useEnsureDerivedMetrics } from '../hooks/useHealthStore';
import { useAiInsight } from '../hooks/useAiInsight';
import { resolveInsightRows } from '../ai/insight';
import HealthAgeCard from '../components/HealthAgeCard';
import AllDayRecoveryCard from '../components/AllDayRecoveryCard';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { buildCortisolProxyBaseline, buildCortisolProxyToday, judgeCortisolRhythm } from '../lib/cortisolProxy';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { computeStressReport } from '../lib/stressAlgorithm';
import { formatRelativeTime } from '../utils/format';

function formatValue(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 以 ima 归档（04-屏幕Screens）的权威洞察页设计为底：
// 5 个维度 chip（睡眠和激素/周期和激素/代谢/心脏健康/心理和压力）+ 选中后 DimensionCard + 本周关键变化。
// 新增「基础指标」tab 置顶：直连戒指真实信号（心率/血氧/体温/皮电/HRV/呼吸率）。
// 新增「一键体检」tab（置于身体指标首位、最左侧）：本地估算身体成分并持久化记录，洞察页只展示最新、历史页按时间排列。
type TabKey = 'basics' | MetricKey;

const TOP_TABS: { key: 'rhythm' | 'longevity'; label: string }[] = [
  { key: 'rhythm', label: '荷尔蒙节律' },
  { key: 'longevity', label: '身体指标' },
];

// ★ 2026-10-07（用户：皮质醇 → 昼夜节律；雌/孕激素 → 生理周期节律）——2026-10-12 落地到 label
const RHYTHM_SUBS: { key: string; label: string }[] = [
  { key: 'recover', label: '昼夜节律' },
  { key: 'body', label: '生理周期节律' },
];

const LONGEVITY_SUBS: { key: string; label: string }[] = [
  { key: 'quickcheck', label: '一键体检' },
  { key: 'ecg', label: '心电' },
  { key: 'bp', label: '血压' },
  { key: 'sugar', label: '血糖' },
  { key: 'bodycomp', label: '身体成分' },
  { key: 'bloodcomp', label: '血液成分' },
  { key: 'basics', label: '基础指标' },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'sleep', label: METRICS.sleep.name },
  { key: 'cycle', label: METRICS.cycle.name },
  { key: 'metabolism', label: METRICS.metabolism.name },
  { key: 'heart', label: METRICS.heart.name },
  { key: 'mind', label: METRICS.mind.name },
  { key: 'basics', label: '基础指标' },
];

/** ★ 2026-10-07（用户：长期健康里面，AI 综合分析先隐藏）：改回 true 即恢复。 */
const SHOW_LONGEVITY_AI: boolean = false;

const CHANGES: ListItem[] = [
  { dot: theme.colors.stateCalm, title: 'HRV 基线 58 → 62 ms', sub: '连续 5 天高于个人基线' },
  { dot: theme.colors.stateTense, title: '午后压力峰值提前 40 分钟', sub: '与新增的晨会时段高度重合' },
  { dot: theme.colors.stateEnergy, title: '深睡占比 21% → 24%', sub: '入睡时间提前带来的直接改善' },
];

/**
 * 代谢 tab 允许下发的信号白名单（除独立的「血液成分」面板外）。
 * 只留血糖：血脂四项（总胆固醇/甘油三酯/HDL/LDL）与血液成分面板重复；
 * BMI/体脂率/脂肪量/肌肉量/骨量等身体成分需先录入身高体重档案，未录入时恒为占位空卡。
 */
const METABOLISM_VISIBLE_KEYS = new Set<string>(['bloodSugar']);

/**
 * 基础指标「矮卡」白名单：只有数值行、**不渲染**底部 88pt 全天迷你趋势图。
 * 用于双列瀑布流的高度估算与错落排布，同时作为卡片的 showTrend 判据，
 * 保证「估高」与实际渲染高度一致（不会一个说有图一个说没图）。
 */
// ★ 2026-11-05（用户）：血氧也展示趋势图 → 把 spo2 从「短卡（无趋势）」集合里移除
const SHORT_METRIC_KEYS = new Set<string>(['eda', 'cortisol', 'stress', 'fatigue', 'emotion', 'skin', 'sns', 'snsActivation']);
const showTrendFor = (key: string) => !SHORT_METRIC_KEYS.has(key);

/**
 * 把卡片按「估高」贪心分配到两列：**每次放进当前最矮的一列**，复刻「错落有致」的瀑布流
 * （RN 没有原生 masonry；两列各自竖向堆叠 + 让总高接近，行与行天然不对齐正是参考稿的观感）。
 *
 * ★ 2026-10-10（用户：「最后那个交感神经活跃度要紧放在皮肤含水量的下面，你看中间空了很多」）：
 *   贪心只认「当前最矮的一列」，**既不能指定列位、也不能保证两张卡的相邻关系**。
 *   所以加第三参 `afterOf`：贪心分完之后，把指定卡**挪到锚点卡的紧后面（同一列）**。
 *   「先钉住再贪心」是错的 —— 钉住的卡会被放���列首，反而跑到最上面；这里必须用「贪心后搬家」。
 */
function splitColumnsBalanced<T>(
  items: T[],
  estH: (it: T) => number,
  keyOf: (it: T) => string,
  afterOf?: (it: T) => string | null,
): [T[], T[]] {
  const cols: [T[], T[]] = [[], []];
  const sum = [0, 0];
  for (const it of items) {
    const i = sum[0] <= sum[1] ? 0 : 1;
    cols[i].push(it);
    sum[i] += estH(it);
  }
  if (!afterOf) return cols;

  // 「搬家」：把 afterOf(it) 指定的卡，挪到 keyOf 锚点卡的紧后面（同一列）
  const all = cols[0].concat(cols[1]);
  for (const it of all) {
    const anchorKey = afterOf(it);
    if (!anchorKey) continue;
    const selfKey = keyOf(it);
    if (anchorKey === selfKey) continue;
    // 找锚点与自己在两列中的位置
    let aIdx = -1;
    let aCol = -1;
    let sIdx = -1;
    let sCol = -1;
    for (let c = 0; c < 2; c++) {
      const ai = cols[c].findIndex((x) => keyOf(x) === anchorKey);
      if (ai >= 0 && aIdx < 0) { aIdx = ai; aCol = c; }
      const si = cols[c].findIndex((x) => keyOf(x) === selfKey);
      if (si >= 0 && sIdx < 0) { sIdx = si; sCol = c; }
    }
    if (aIdx < 0 || sIdx < 0) continue;                    // 锚点不在本页 → 不动
    if (sCol === aCol && sIdx === aIdx + 1) continue;       // 已经紧挨着 → 不动
    cols[sCol].splice(sIdx, 1);
    sum[sCol] -= estH(it);
    const insertAt = aCol === sCol && sIdx < aIdx ? aIdx : aIdx + 1;
    cols[aCol].splice(insertAt, 0, it);
    sum[aCol] += estH(it);
  }
  return cols;
}

/**
 * ★ 2026-10-10（用户指定布局）：需要**指定紧邻关系**的基础指标卡。
 * 贪心分栏无法保证两张卡相邻；这里声明「sns（交感神经活跃）要紧跟在 skin（皮肤含水量）
 * 之后、且同一列」，由 `splitColumnsBalanced` 在贪心分完之后执行搬家。
 */
const PIN_AFTER: Record<string, string> = {
  sns: 'skin',
};

import { computeCurrentHealthAge } from '../lib/healthAgeCurrent';

export default function InsightScreen() {
  // ★ mira-ocean（2026-10-17）：深底页面 → 聚焦时状态栏改亮图标，失焦恢复深色
  //   （其余白底 tab 尚未 ocean 化，不能全局改 App.tsx 的 StatusBar）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });
  const navigation = useNavigation<any>();
  const [actualAge, setActualAge] = useState<number | null>(null);
  const profileRevision = useRef(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    const revision = profileRevision.current;
    // ★ 2026-11-06 审查（docs/audit/02）：**删除演示年龄兜底**。
    //   旧实现：未录入身体档案时硬塞 DEMO_PROFILE_AGE = 30，让身体年龄卡片能出数。
    //   但身体年龄 = 实际年龄 + 活力调整 —— 用假的 30 岁算出来的「身体年龄 27 岁」
    //   是彻头彻尾的假数据，渠道演示时会被当成用户的真实身体年龄。
    //   现在：无真实档案 → actualAge 保持 null → HealthAgeCard 的 hasEstimate 为 false
    //   → 走「去填写身体档案」CTA 空态，不显示任何编造的年龄数字。
    const clampAge = (a: number | null | undefined) =>
      a != null && Number.isInteger(a) && a >= 18 && a <= 120 ? a : null;
    const devAge = RingBle.getUserProfile()?.age;
    setActualAge(clampAge(devAge));
    getLatestExamRecord().then(record => {
      if (!active || revision !== profileRevision.current) return;
      const value = record?.inputs.age ?? RingBle.getUserProfile()?.age;
      setActualAge(clampAge(value));
    }).catch(() => {
      setActualAge(clampAge(RingBle.getUserProfile()?.age));
    });
    return () => { active = false; };
  }, []));
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = (question: string) => {
    setChatQuestion(question);
    setChatVisible(true);
  };
  const { autoMonitor } = useAppState();
  // 直接订阅戒指实时状态：真实心率/血氧/体温/皮电/HRV/呼吸率都从这里来
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  // 默认基础指标 tab：直连戒指真实信号；其余维度 tab 为周期-心理洞察（上线保留）
    const [topTab, setTopTab] = useState<'rhythm' | 'longevity'>('rhythm');
  const [subTab, setSubTab] = useState<string>('recover'); // rhythm: recover(皮质醇) | body(雌/孕激素)
  // ★ 2026-11-05：首页「今日状态」空值时，建议胶囊引导去一键体检 → 直达本页的 quickcheck 子 tab。
  //   路由参数变化时同步切换（含从后台切回的重复导航）。
  const route = useRoute<any>();
  useEffect(() => {
    if (route?.params?.subTab === 'quickcheck') {
      setTopTab('longevity');
      setSubTab('quickcheck');
    }
  }, [route?.params?.subTab, route?.params?.t]);
  // 当前 top tab 生效的子 tab 配置（hero/Segmented/UnderlineTabs 两个分支共用一套）
  // ★ 2026-11-05（用户：双机型）：基础版无心电/血压/血糖/皮电等，按机型能力过滤「身体指标」子 tab；
  //   一键体检 quickCheck 基础版保留（改为「实测 + 估算」，不依赖 Pro 专属传感器）。
  const { model: deviceModel } = useDeviceModel();
  // ★ 2026-11-05（用户：「我在基础版 UI 上做调整，不会改到 Pro 的排布吧？」）：
  //   本页 PRO_UI / BASE_UI 原本共用同一套 JSX、同一套子 tab，直接改排布会两档一起变。
  //   这里加机型分支：以下「去子 tab、上下卡片平铺」的新排布**只对 BASE_UI 生效**，
  //   PRO_UI 完整保留原来的 Segmented + UnderlineTabs + 分子 tab 渲染。
  const isBaseLayout = deviceModel.id === 'BASE_UI';
  const SUB_CAP: Partial<Record<string, keyof DeviceCapabilities>> = {
    ecg: 'ecg',
    bloodcomp: 'bloodComponents',
    quickcheck: 'quickCheck',
    bp: 'bp',
    sugar: 'glucose',
    bodycomp: 'bodyComp',
  };
  const longevitySubs = LONGEVITY_SUBS.filter(t => { const c = SUB_CAP[t.key]; return !c || hasCap(deviceModel, c); });
  const ACTIVE_SUBS = topTab === 'rhythm' ? RHYTHM_SUBS : longevitySubs;
  // 当前 subTab 被机型能力过滤掉时（如切到 Luna Mira），有效键回落到第一个可用 tab，避免空屏/选中错位
  const effSub = ACTIVE_SUBS.some(t => t.key === subTab) ? subTab : (ACTIVE_SUBS[0]?.key ?? 'basics');
  const [tab, setTab] = useState<TabKey>('basics');

  // ★ 顶部「AI 综合分析」：真实接入端侧大模型（Qwen2.5-1.5B），上下文为该用户的真实健康数据
  //   （buildHealthSnapshot：今日实时/皮质醇/激素推断/情绪脑力/周期相位/近 7 天趋势）。
  //   生成完成前用「真实数据规则文案」兜底（不再显示原来硬编码的假数值）；同日同指纹只生成一次。
  const aiOverview = useAiInsight('overview');
  // ★ 睡眠 tab「今日皮质醇全天趋势」卡片底部的节奏洞察 → 复用身体恢复页同款 AI（皮质醇节律 + 今日建议）。
  //   同源通道保证两处分析一致；同日同指纹只生成一次（与恢复页共享模块级缓存）。
  const aiRecovery = useAiInsight('recovery');

  /**
   * 顶部「AI 综合分析」最终分点行。
   * ★ 不能直接写 `aiOverview.rows ?? 兜底`：端侧 1.5B 经常不按格式分行，把整份数据念成一大段，
   *   parseInsightRows 会把这一大段也容错成 1 行 —— `??` 于是永远命中 AI，
   *   页面就变成「没有分点、整段糊住」。resolveInsightRows 会做质量门禁：
   *   不合格（<3 行 / 有超长行）→ 回落规则分点；合格 → 与规则分点合流补齐缺失指标。
   */
  const overallScoreFromReport = useMemo(() => {
    try {
      const fatigue = computeCognitiveLoadReport();
      const stress = computeStressReport();
      const sleep = ring.daily['sleepScore'];
      const scores: number[] = [];
      if (fatigue?.sampleCount > 0 && fatigue.loadScore != null && Number.isFinite(fatigue.loadScore)) scores.push(100 - fatigue.loadScore * 0.6);
      if (stress?.sampleCount > 0 && stress.emotionalLoad != null && Number.isFinite(stress.emotionalLoad)) scores.push(100 - stress.emotionalLoad * 0.5);
      if (sleep != null && Number.isFinite(sleep) && sleep >= 0 && sleep <= 100) scores.push(sleep);
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a,b) => a+b,0) / scores.length);
    } catch { return null; }
  }, [ring]);


  /**
   * ★ 2026-10-06（用户：身体年龄算法要「综合」荷尔蒙节律 + 长期健康数据，且 AI 分析太复杂 → 简化）：
   *   身体年龄 = 实际年龄 + 活力调整：两个维度都健康 → 偏年轻；任一失衡 → 偏老。
   *   分析结论与下方「建议」均由此综合生成，不再依赖冗长的 AI overview 原文。
   */
  const bodyAgeInsight = useMemo(() => {
    const ACTUAL = actualAge;
    // ① 荷尔蒙节律（皮质醇）是否健康 —— 直接读 healthStore 当日 intraday（RingState 上无此字段）
    let hormonalLabel: string = '数据不足';
    let hormonalHealthy = false;
    try {
      // ★ 2026-10-14：与「昼夜节律」卡片/详情页统一走 proxy 实测活性 + judgeCortisolRhythm，
      //   不再用旧 cosinor（analyzeCortisol 读 cortisol intraday 拟合），否则身体年龄文案会与卡片/详情页结论打架。
      const pbl = buildCortisolProxyBaseline(14);
      // ★ 2026-10-14：必须基于「最近一个有完整数据的日」判节律，不能死磕今天。
      //   今天实时融合活性往往只过了部分时段、未来槽为空 → 有效槽数不够 → judge 退回空 → 文案变「数据不足」。
      //   取 pbl.daysUsed 的最后一天（升序排列，即最近有数据日，通常是昨天），与昼夜节律卡片/详情页同口径。
      const _usedDays = pbl.daysUsed;
      const _recentDk = _usedDays.length ? _usedDays[_usedDays.length - 1] : null;
      const _recentMs = _recentDk ? new Date(`${_recentDk}T00:00:00`).getTime() : Date.now();
      const px = buildCortisolProxyToday(pbl, { now: _recentMs });
      const j = judgeCortisolRhythm(px.vals, px.real);
      if (j.label) {
        hormonalHealthy = j.label === '节律正常';
        hormonalLabel = j.label === '节律紊乱' ? '节律紊乱' : j.label === '皮质醇偏高' ? '持续偏高' : '节律平稳';
      }
    } catch { /* 保持数据不足 */ }
    // ② 长期健康数据（综合 脑力/压力/睡眠 的 0–100 分）
    const longTerm = overallScoreFromReport; // 0–100
    const longTermHealthy = longTerm != null && longTerm >= 65;
    const longTermLabel = longTerm == null ? '数据不足' : longTerm >= 80 ? '良好' : longTerm >= 65 ? '一般' : '偏弱';

    /**
     * ★ 2026-10-10（用户：「洞察页身体年龄一天最多变一次，不能老变」）：
     *   用 `resolveDailyHealthAge` 把「身体年龄 + 综合分」一起按天冻结。
     *   当天首次算出即钉死，之后整天复用 —— 无论戒指轮询/回填怎么刷新输入，
     *   卡片上的数字和圆弧都不会再跳；跨天自动重算。
     *   综合分必须一起冻结：圆弧长度 = 综合分，只冻数字会变成「数字不动、弧一直在跑」。
     */
    // ★ 2026-10-28：统一到共享实时计算（lib/healthAgeCurrent），与详情页头条完全一致；
    //   去掉按天冻结 —— 既保证洞察页卡 = 详情页数字（连通），又能随数据实时更新（不再「一天不变」）。
    const cur = computeCurrentHealthAge(ACTUAL);
    const healthAge = cur?.healthAge ?? estimateHealthAge(ACTUAL, longTerm, hormonalHealthy, hormonalLabel !== '数据不足');
    // 弧长用与身体年龄同一份实时综合分（数字与弧永远同步）
    const arcScore = cur?.overallScore ?? longTerm;
    // ★ 2026-10-18：用「年轻/偏老」结论统摄文案——确保下方 AI 分析与上方大数字（较实际年龄低/高 X 岁）同方向，不再各说各话。
    const hasEstimate = healthAge != null && ACTUAL != null && Number.isFinite(healthAge) && Number.isFinite(ACTUAL);
    const delta = hasEstimate ? (healthAge as number) - (ACTUAL as number) : 0;
    const isYounger = hasEstimate && delta < 0;
    const isFlat = hasEstimate && Math.abs(delta) < 0.5;
    // ④ 简化分析文案（综合两个维度）——★ 2026-10-08（用户：按 ISHO 风格，先事实再人话）
    let hormonalClause: string;
    if (hormonalLabel === '数据不足') {
      hormonalClause = '荷尔蒙节律的数据还没攒够，再戴几天会更准';
    } else if (hormonalLabel === '节律平稳') {
      hormonalClause = '皮质醇节律平稳，白天顶得住、夜里也降得下来';
    } else if (hormonalLabel === '持续偏高') {
      hormonalClause = '皮质醇持续偏高，身体这段时间一直绷着没真正松下来';
    } else {
      hormonalClause = '皮质醇节律紊乱，白天绷着、夜里也降不下来';
    }
    const longTermClause = longTerm == null ? '睡眠和压力数据还没攒够，暂不计算综合评分' : longTermHealthy
      ? `长期健康数据整体${longTermLabel}，状态稳得住`
      : `长期健康数据偏弱，主要是睡眠和压力在拖`;
    // ★ 2026-10-18：先说「年轻/偏老」结论（与上方大数字同源），再给两个维度拆解，避免文案方向与数字打架。
    let directionClause = '';
    if (hasEstimate) {
      directionClause = isFlat
        ? '身体年龄和实际年龄基本一致。'
        : isYounger
          ? `身体年龄比实际年龄小 ${Math.abs(delta).toFixed(1)} 岁，整体状态更轻盈。`
          : `身体年龄比实际年龄大 ${Math.abs(delta).toFixed(1)} 岁，近期身体负担偏重。`;
    }
    const analysis = directionClause
      ? `${directionClause}${hormonalClause}；${longTermClause}。`
      : `${hormonalClause}；${longTermClause}。`;
    // ⑤ 两条综合建议
    const suggestions: string[] = [];
    if (!hormonalHealthy && hormonalLabel !== '数据不足') {
      suggestions.push('这两周把上床时间固定下来，少熬几晚，节律会慢慢自己回来。');
    }
    if (longTerm != null && !longTermHealthy) {
      suggestions.push('先把觉睡够（7 小时起步），白天压力别攒着，指标会跟着慢慢回来。');
    }
    if (suggestions.length < 2) {
      suggestions.push(hormonalHealthy && longTermHealthy
        ? '现在的作息和运动节奏很好，照这样保持就行。'
        : '再连续戴 7 天，数据攒够了这份分析会准很多。');
    }
    return { healthAge, arcScore, analysis, suggestions: suggestions.slice(0, 2) };
  }, [ring, overallScoreFromReport, actualAge]);

  const insightRows = useMemo(
    () => resolveInsightRows('overview', aiOverview.rows),
    // 依赖 text（字符串，身份稳定）而非 rows（每次渲染新数组）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiOverview.text]
  );

  // 与身体恢复页同源：recovery 通道 → 2 点（皮质醇节律 + 今日建议）。resolveInsightRows 永远返回非空兜底。
  const recoveryRows = useMemo(
    () => resolveInsightRows('recovery', aiRecovery.rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiRecovery.text]
  );

  /**
   * ★ 睡眠卡「入睡 / 起床」以**当日**为唯一真值源。
   *
   * 为什么不能直接用 `ring.sleepTime / ring.wakeTime`：这两个是「最新一次」的便捷字段，
   * 与 sleepSummary 平行维护，可能残留更早一天的陈旧值 —— 实测 09-18 的
   * `sleepSummary.sleepTime = "2026-09-18 01:38"`，而顶层 `ring.sleepTime` 仍是 09-16 的
   * `"00:41"`。直接渲染会让卡片文案陈旧、且分期图时间轴也从 00:41 起算。
   *
   * 取数优先级（先命中先用；命中项可只含一侧时刻）：
   *   ① `ring.sleepSummary`（仅当 `sleepSummaryDate === 今天` 才代表当日，日期吻合才可信）
   *   ② `ring.sleepDaily[今天]`（按天归档，backfill 逐日写入）
   *   ③ `ring.sleepTime / ring.wakeTime`（顶层兜底，不再区分日期）
   * 取出的原始串（可能是原生完整 datetime）交给 SleepStructureCard 统一归一为 HH:mm，
   * 保证同一份值同时驱动文案与分期图时间轴，两处永不脱节。
   */
  const todaySleep = useMemo<{ sleepTime: string | null; wakeTime: string | null }>(() => {
    type ClockSrc = { sleepTime?: string | null; wakeTime?: string | null } | null;
    const todayDk = dayKey(Date.now());
    const daySummary: ClockSrc = ring.sleepSummaryDate === todayDk ? ring.sleepSummary : null;
    const dayDaily: ClockSrc = ring.sleepDaily?.[todayDk] ?? null;
    const fallback: ClockSrc = { sleepTime: ring.sleepTime, wakeTime: ring.wakeTime };
    const hit = [daySummary, dayDaily, fallback].find(
      (c) => !!c && (!!c.sleepTime || !!c.wakeTime)
    );
    return { sleepTime: hit?.sleepTime ?? null, wakeTime: hit?.wakeTime ?? null };
  }, [ring]);

  /**
   * ★ 夜期分期段同样按「当日优先」（与 SleepDetailScreen 的 isLatest 规则一致）。
   *
   * `ring.sleepStages` 是「最新一次」便捷字段，实测快照里它仍停留在 09-16（曲线跨度 540 分钟），
   * 而同日会渲染的 `sleepSummary` 已是 09-18（total 521）—— 两者混用会把旧曲线画在新摘要下面。
   * 取数：当日归档 `sleepStagesDaily[今天]`（backfill 逐日写入）→ 缺失才回落顶层字段
   * （保持原有可见性，绝不清空图）。
   */
  const todaySegments = useMemo(
    () => ring.sleepStagesDaily?.[dayKey(Date.now())] ?? ring.sleepStages,
    [ring]
  );

  // 趋势图可用性：连上戒指即视为「正在监测」（RingBleManager 连上会强制开启原生采集，
  // 与设置页总开关无关），不再被 autoMonitor 默认值 false 卡死——否则数据在采、数值有，
  // 但洞察页所有趋势图整体不渲染，造成「有数据没图」的观感。
  const trendOn = autoMonitor || ring.status === 'connected';

  // ★ v18.104 断流即空态（与首页圆环 / 昼夜节律卡 / 睡眠结构卡同一口径）：
  //   戒指超过 3 小时没送新采样时，睡眠 tab 不再把旧归档当成「昨夜实测」继续展示。
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;

  // 回填派生指标（eda/cortisol…）intraday：修复「历史皮质醇数据没有」（洞察页节律卡同样依赖）
  useEnsureDerivedMetrics(30);

  // healthStoreVersion 订阅已合并到下方 useMemo 里，避免重复重渲染

  useEffect(() => {
    let pending: RingState | null = null;
    let scheduled = false;
    const throttled = (s: RingState) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRing(pending);
        });
      }
    };
    const off = RingBle.onState(throttled);
    return off;
  }, []);

  // ★ 已移除「挂载即下发 autoMonitor」的 effect：AppState.setAutoMonitor（设置页开关）
  // 已经直接转发给 RingBle，这里再转发一次是冗余的；且挂载时 AppState 初始值为 false，
  // 会把「连上戒指即自动开启监测」的设计推翻——一进洞察页原生 monitorOn 就被关掉，
  // 戒指实时数据（HealthGlance/GSR 轮询）全部停流（日志 15:04:58 on=0 → raw=0）。

  // 任意卡片点击 → 进入「指标历史详情」全屏页（日/周/月/年切换 + 真实数据）
  const openDetail = (
    key: string,
    name: string,
    unit: string,
    yMin: number,
    yMax: number,
    color?: string
  ) => {
    navigation.navigate('MetricDetail', { key, name, unit, yMin, yMax, color });
  };

  // ★ 轻量缓存：render 内新建 Map（短生命周期，GC 友好），避免每次 render 遍历 healthStore
  const _cache = new Map<string, { hist: any[]; lastT: number | null }>();
  const getCachedHist = (key: string): any[] => {
    // ★ 2026-11-05（用户：HK18 数据不要混进来）：基础版的温度/皮电类指标
    //   一律不读本机 healthStore 历史归档 —— 里面混着旧戒指写入的 39℃ 体温、
    //   皮肤含水量（曾被误命名成 EDA）与皮肤温度。只用当前戒指的云端日值。
    //   Pro 机型保持原行为，不受影响。
    if (deviceModel.id === 'BASE_UI' && LEGACY_HISTORY_BLOCKED_KEYS.includes(key)) return [];
    const c = _cache.get(key);
    if (c) return c.hist;
    const raw = getTodaySeries(key);
    const lastT = raw.length ? raw[raw.length - 1].t : null;
    // 实时信号半小时聚合（只有 render 时才算）
    const _HALF = ['hr','spo2','temp','eda','hrv','rr','cortisol','stress','fatigue','emotion','skin','sns','bpSys','bpDia'];
    let hist = raw;
    if (_HALF.includes(key) && raw.length > 0) {
      const halfMs = 30 * 60 * 1000;
      const dayStart = new Date(); dayStart.setHours(0,0,0,0);
      const slots: { sum: number; n: number; t: number }[] = [];
      for (let i = 0; i < 48; i++) slots.push({ sum: 0, n: 0, t: dayStart.getTime() + i * halfMs });
      for (const pt of raw) {
        const slot = Math.floor((pt.t - dayStart.getTime()) / halfMs);
        if (slot >= 0 && slot < 48 && Number.isFinite(pt.v)) { slots[slot].sum += pt.v; slots[slot].n++; }
      }
      hist = slots.filter(s => s.n > 0).map(s => ({ t: s.t, v: +(s.sum / s.n).toFixed(1) }));
    }
    _cache.set(key, { hist, lastT });
    return hist;
  };
  const getCachedLastT = (key: string): number | null => {
    const c = _cache.get(key);
    if (c) return c.lastT;
    getCachedHist(key); // 填充缓存
    return _cache.get(key)?.lastT ?? null;
  };

  const realtimeKeys = new Set(BASIC_METRICS.map((b) => b.key));
  // ★ 云端日值对应的真实日期（auto_data 按天一条，今天没上传时最新是昨天）→ 卡片副标题如实标注
  const dailyDateTs = (ring?.daily as Record<string, number> | undefined)?.['dailyDateTs'] ?? null;
  const dailySourceLabel = typeof dailyDateTs === 'number' && Number.isFinite(dailyDateTs)
    ? `${new Date(dailyDateTs).getMonth() + 1}/${new Date(dailyDateTs).getDate()} 日均`
    : '最近日均';
  // 基础指标信号（★ 2026-11-06 修正注释：基础版 Luna Mira 实际**支持体温(temp)** 与 **交感神经(sns, gsr 通道)**，
  //   对应卡会正常渲染；仅「皮电(eda)/皮肤温度(skin)」基础版无数据源 → 不渲染。deviceModel 已在上方 229 行声明并订阅）
  const basicsSignals = useMemo(() => {
    const BASIC_CAP: Partial<Record<string, keyof DeviceCapabilities>> = {
      temp: 'temp',
      skinTemp: 'skin',  // ★ 2026-11-05：基础版无独立皮肤温度数据源（skin=false），不渲染
      eda: 'eda',        // ★ 2026-11-05：协议无 EDA，BASE_UI.eda=false → 不渲染
      rr: 'rr',
      skin: 'skin',
      emotion: 'emotion',
      cortisol: 'cortisolProxy',
      depressionRisk: 'cortisol',
      bpSys: 'bp',
      bpDia: 'bp',
      // ★ 2026-11-05：压力/疲劳度只来自「健康一览 healthGlance 自动快照」，
      //   基础版戒指该通道实测为空（后端 health_glance 0 条），卡片会永远显示「—」。
      //   复用 cortisol（同为健康一览族）作为该数据源的能力开关 → 基础版直接不渲染。
      stress: 'cortisol',
      fatigue: 'cortisol',
    };
    return signalsForDimension('basics').filter((m) => {
      // ★ 2026-11-05（用户）：体检/身体指标区移除 皮质醇 / 交感神经活跃 两张卡
      // ★ 2026-11-06（用户：「身体指标里为啥心率也没有了？」）→ 心率卡恢复展示
      if (m.key === 'cortisol' || m.key === 'sns') return false;
      const c = BASIC_CAP[m.key];
      return !c || hasCap(deviceModel, c);
    });
  }, [deviceModel]);
  // ★ 2026-11-05（修复「跨天基础指标全空」）：
  //   之前的 dataSig/visibleKeys 按「今日有无数据」隐藏卡片——新的一天戒指尚未同步时，
  //   当日 daily / 今日 intraday 都为空 → 所有卡被整页隐藏，造成「跨天全不见」。
  //   正确口径：卡片可见性只由**设备能力**决定（basicsSignals 已用 hasCap 过滤掉本机型不支持的指标，
  //   如基础版无 体温/皮电）；对设备支持的指标，**永远渲染卡片**，今天还没采到就显示「—」而非隐藏。
  //   这样既满足用户「本版本不返回的指标直接不展示」，又不会在跨天/未同步时把正常指标误删。
  // ★ 双列瀑布流布局：按 section 分组（组标题占整行），组内按「有无趋势图」估高做两列分配。
  //   分配结果（当前 6 张卡）：
  //     左列 = 心率 / EDA皮电 / 心率变异性（高·矮·高）
  //     右列 = 血氧 / 体温 / 皮质醇     （矮·高·矮）
  //   两列卡片高度交错 → 行不对齐，复刻参考稿左侧的「错落有致」。
  const basicsGroups = useMemo(() => {
    const estH = (m: BasicMetricDef) => (showTrendFor(m.key) ? 2 : 1);
    // ★ 2026-10-10（用户指定）：交感神经活跃卡必须**紧贴在皮肤含水量下面**（同一列）。
    const afterOf = (m: BasicMetricDef) => PIN_AFTER[m.key] ?? null;
    // ★ 2026-10-10（用户：「中间空了很多，上面那些卡片紧凑一点排列」）：
    //   原来按 `section` 把基础指标拆成**多个分组**，每组各渲染一对列，
    //   组与组之间会留出一整段空白（照片里 皮肤含水量 与 交感神经 中间那道空隙）。
    //   基础指标本身没有分组语义（section 皆为空），故**合并成单一分组**，
    //   11 张卡进同一对列 → 整体紧凑、底部两列自然对齐。
    return [{
      section: basicsSignals.find((m) => !!m.section)?.section ?? '',
      items: basicsSignals,
      columns: splitColumnsBalanced(basicsSignals, estH, (m) => m.key, afterOf),
    }];
  }, [basicsSignals]);

  /** 渲染单张基础指标卡（原网格内的卡片逻辑抽出，供左右两列复用）。 */
  const renderBasicsCard = (m: BasicMetricDef) => {
    const isRealtime = realtimeKeys.has(m.key);
    const rk = m.key as RingMetricKey;
    // ★ 2026-11-05（用户实锤「连着戒指为什么很多指标还不出值」「体温为什么还没有数据」）：
    //   5 张核心卡只读 ring.metrics，而基础版固件不开放体温/HRV 的实时流 → 恒为 null；
    //   ★ 2026-11-05 修正：温度类不再向本地 healthStore 兜底（那里是 HK18 时期的历史值，
    //   曾导致详情页显示 39℃）；只用「原生实时 → 当前戒指云端按天真实回读」两级。
    //   并挡住「心率 1 bpm」「日均体温 >38.5℃」这类明显不是生理读数的异常值。
    //   日值按云端真实日期标「M/D 日均」，不冒充今天。
    const sane = (k: string, v: number | null | undefined): boolean => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      if (k === 'hr') return v >= 30 && v <= 220;
      if (k === 'spo2') return v >= 50 && v <= 100;
      if (k === 'temp') {
        const t = saneBodyTemp(v);
        // 当前戒指只回读「日均体温」，日均 >38.5℃ 不可能是真实值 → 视为旧戒指/单位脏值
        return t != null && (deviceModel.id !== 'BASE_UI' || t <= 38.5);
      }
      if (k === 'hrv') return v > 0 && v <= 300;
      if (k === 'eda') return v >= 0 && v <= 99;
      return true;
    };
    const localLast = (key: string): { v: number; t: number } | null => {
      const arr = getCachedHist(key);
      const last = arr.length ? arr[arr.length - 1] : null;
      return last && Number.isFinite(last.v) ? { v: last.v as number, t: last.t as number } : null;
    };
    let real: number | null = null;
    let measureTime: number | null = null;
    let sourceLabel: string | undefined;
    if (isRealtime) {
      const rt = ring.metrics[rk] ?? null;
      if (!dataStale && sane(m.key, rt)) {
        real = rt ?? null;
        measureTime = ring.lastUpdated[rk] ?? null;
      } else {
        const dv = ring.daily[rk] ?? null;
        const loc = localLast(m.key);
        if (sane(m.key, dv)) { real = dv ?? null; measureTime = loc?.t ?? null; sourceLabel = dailySourceLabel; }
        else if (loc && sane(m.key, loc.v)) { real = loc.v; measureTime = loc.t; }
        else { measureTime = ring.lastUpdated[rk] ?? null; }
      }
    } else {
      const dv = ring.daily[m.key] ?? null;
      const loc = localLast(m.key);
      if (sane(m.key, dv)) {
        real = dv ?? null;
        measureTime = getCachedLastT(m.key);
        sourceLabel = measureTime == null ? dailySourceLabel : undefined;
      } else if (loc && sane(m.key, loc.v)) { real = loc.v; measureTime = loc.t; }
      else measureTime = getCachedLastT(m.key);
    }
    // ★ 2026-11-06（用户）：体温等「当前固件尚未回读到」的指标，没有任何真实读数时整张卡不渲染（降噪）
    if (m.hideNoData && real == null) return null;
    const hist = getCachedHist(m.key);
    if (m.manualOnly) {
      return (
        <ManualMetricCard
          key={m.key}
          metric={m}
          live={real != null}
          value={real != null ? formatValue(real) : m.value}
          measureTime={measureTime}
          onMeasure={() => RingBle.measure(rk)}
          onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
        />
      );
    }
    return (
      <BasicMetricCard
        key={m.key}
        compact
        metric={m}
        auto={trendOn}
        live={isRealtime ? (!dataStale && ring.availability[rk] === 'live') : real != null}
        syncing={isRealtime ? ring.availability[rk] === 'syncing' : false}
        value={formatValue(real)}
        data={hist}
        onMeasure={() => RingBle.measure(rk)}
        hideMeasure={m.hideMeasure ?? true}
        measureTime={measureTime}
        sourceLabel={sourceLabel}
        showTrend={showTrendFor(m.key)}
        onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
      />
    );
  };

  return (
    <>
    {/* ★ mira-ocean（2026-10-17）：页面由全白底改深海渐变（与 App 根渐变同源 bgGradStops） */}
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer compactTop scrollY={scrollY} topFadeColor={theme.colors.bgTop}>
      <View style={styles.stack}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>洞察</Text>
        </Animated.View>

        

        {/* ═══ hero + 顶 tab + 子 tab：两个 top tab 共用（目标稿六变体顶部是同一张 lime 大卡）═══ */}
        <HealthAgeCard
          healthAge={bodyAgeInsight.healthAge}
          actualAge={actualAge}
          onPress={() => navigation.navigate('HealthAgeDetail')}
          onEditProfile={() => { setTopTab('longevity'); setSubTab('bodycomp'); }}
          overallScore={bodyAgeInsight.arcScore ?? overallScoreFromReport}
          ring={ring}
          rows={insightRows}
          pending={aiOverview.loading}
          analysisText={bodyAgeInsight.analysis}
          suggestions={bodyAgeInsight.suggestions}
        />
        <Segmented
          options={TOP_TABS.map(t => t.label)}
          activeIndex={TOP_TABS.findIndex(t => t.key === topTab)}
          onChange={(i) => { const k = TOP_TABS[i].key; setTopTab(k); setSubTab(k === 'rhythm' ? 'recover' : 'quickcheck'); }}
        />
        {/* ★ 2026-10-06：节律健康仅 2 个 tab 时（large）——直接整屏等宽平铺，不套 ScrollView。
            横向 ScrollView 内 flex:1 宽度在 Fabric 下偶尔失效，导致两个 tab 没撑满整屏。
            其它 tab（ecg 等多项）仍走 ScrollView 横向滚动。 */}
        {!isBaseLayout && (topTab === 'rhythm' ? (
          <View style={{ width: '100%' }}>
            <UnderlineTabs
              options={ACTIVE_SUBS.map(t => t.label)}
              activeIndex={ACTIVE_SUBS.findIndex(t => t.key === effSub)}
              onChange={(i) => setSubTab(ACTIVE_SUBS[i].key)}
              large
            />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={styles.chipRow} contentContainerStyle={styles.chipContent}>
            <UnderlineTabs
              options={ACTIVE_SUBS.map(t => t.label)}
              activeIndex={ACTIVE_SUBS.findIndex(t => t.key === effSub)}
              onChange={(i) => setSubTab(ACTIVE_SUBS[i].key)}
              tone={'cy'}
            />
          </ScrollView>
        ))}

        {/* ★ 2026-11-05（用户）：基础版洞察页去掉子 tab ——
              · 荷尔蒙节律 = 上下两张卡片（昼夜节律 / 生理周期节律）
              · 身体指标   = 第一张一键体检，下面直接平铺心率/血氧/体温/HRV/皮电/交感等基础指标卡
            仅 BASE_UI 生效；PRO_UI 走下面原分子 tab 布局。 */}
        {isBaseLayout && (topTab === 'rhythm' ? (
          <>
            {/* ★ 2026-11-06（用户）：移除「昼夜节律」小标题；★ 本轮：生理周期节律改为卡片内标题（与昼夜节律一致）+ 先隐藏雌激素趋势图 */}
            <AllDayRecoveryCard title="昼夜节律" insightMode onPress={() => navigation.navigate('EmotionCognitiveDetail')} />
            <CyclePhaseCard ring={ring} female={ring.female} title="生理周期节律" hideHormoneTrend onPress={() => navigation.navigate('CycleCalendar')} />
          </>
        ) : (
          <>
            <QuickCheckTab />
            {/* ★ 2026-11-06（用户）：基础指标卡改为**单列全宽列表**（更宽、像列表一样平铺），并去掉「基础指标」标题文字 */}
            <View style={styles.basicsList}>
              {basicsSignals.map((m) => renderBasicsCard(m))}
            </View>
            {SHOW_LONGEVITY_AI ? <InsightBanner rows={insightRows} pending={aiOverview.loading} /> : null}
          </>
        ))}

        {!isBaseLayout && (topTab === 'rhythm' ? (
          <>
            {effSub === 'sleep' ? (
              <>
                <SleepStructureCard dataStale={dataStale} segments={todaySegments} summary={ring.sleepSummary} sleepTime={todaySleep.sleepTime} wakeTime={todaySleep.wakeTime} deepPct={ring.daily['sleepDeep'] ?? null} remPct={ring.daily['sleepRem'] ?? null} score={ring.daily['sleepScore'] ?? null} fallbackTotalMinutes={ring.daily['sleepTotal'] ?? null} onPress={() => navigation.navigate('SleepDetail')} />
                <CortisolSleepSummary dataStale={dataStale} insightRows={recoveryRows} />
              </>
            ) : effSub === 'body' ? (
              <CyclePhaseCard ring={ring} female={ring.female} onPress={() => navigation.navigate('CycleCalendar')} />
            ) : effSub === 'recover' ? (
              // v18.2：恢复节律 = 全天恢复（睡眠恢复+皮质醇全天趋势）
              <AllDayRecoveryCard title="昼夜节律" insightMode onPress={() => navigation.navigate('EmotionCognitiveDetail')} />
            ) : effSub === 'mindCog' ? (
              // v18.3：认知 = 认知负荷（与首页「认知消耗」同源 computeCognitiveLoadReport；
              //   今天无采样时回退到最近有数据日，避免整卡空态）
              <CogTabCard ring={ring} navigation={navigation} />
            ) : effSub === 'emotion' ? (
              // v18.3：情绪 = 情绪洞察，点卡片进「情绪消耗」日/周/年详情页
              <>
                <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })}>
                  <View style={{ position: 'relative' }}>
                    <EmotionInsightView />
                    <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} style={{ position: 'absolute', top: theme.sp(4), right: theme.sp(4) }} />
                  </View>
                </TouchableOpacity>
                {/* 给底部悬浮「记录情绪」按钮留白，避免情绪洞察末尾被遮挡 */}
                <View style={{ height: 120 }} />
              </>
            ) : (
              // v18.2：运动恢复节律 = 步数/距离/活动消耗 + 近 7 天步数波浪
              <SportRecoveryCard ring={ring} navigation={navigation} />
            )}
          </>
        ) : (
          <>
            {/* v18：心血管拆成「心电 / 血压」两个独立子 tab，各自全宽竖排 */}
            {effSub === 'ecg' ? (
              <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('EcgDetail')}>
                <Card style={{ padding: theme.space.cardPadCompact }}>
                  <EcgCard ring={ring} onPress={() => {}} compactMode />
                </Card>
              </TouchableOpacity>
            ) : effSub === 'bp' ? (
              /* ★ 2026-10-10（用户）：血压 tab 整卡重做 = 最新值 + 「全天血压趋势」双曲线，
                  与血糖卡同构；数据走 intraday bpSys/bpDia（与 BpDetail 详情页同源）。 */
              <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('BpDetail')}>
                <BpTrendCard ring={ring} />
              </TouchableOpacity>
            ) : effSub === 'sugar' ? (
              /* ★ 2026-10-10（用户）：血糖 tab 整卡重做 = 最新值 + 「全天血糖趋势」曲线。
                  数据走 healthStore intraday 'glucose'（RingBle 把血糖增量写入 15 分钟槽，与指标详情页同源）——
                  daily.bloodSugar 缺失时也能出值；无采样 → 空骨架 + 「—」，绝不画假曲线（空态铁律）。
                  替换原「静态数字卡 + 血液成分面板」。 */
              <TouchableOpacity activeOpacity={0.7} onPress={() => openDetail('bloodSugar', '血糖', 'mmol/L', 3, 12)}>
                <SugarTrendCard ring={ring} />
              </TouchableOpacity>
            ) : effSub === 'bodycomp' ? (
              // v18：一键体检 = 本地估算身体成分并持久化，独立成「身体成分」子 tab
              <ExamTab onProfileSaved={age => { profileRevision.current += 1; setActualAge(age); }} />
            ) : effSub === 'bloodcomp' ? (
              // ★ 2026-10-16（用户）：血液成分 = 尿酸 + 血脂四项，紧邻「身体成分」的独立子 tab
              <BloodPanelTab onOpenDetail={openDetail} />
            ) : effSub === 'quickcheck' ? (
              // ★ 2026-10-26（用户）：一键体检 = HealthGlance 聚合快检（概览 → 记录 → 报告详情）
              <QuickCheckTab />
            ) : (
              // basics
              <>
                {basicsGroups.map((g, gi) => (
                  <React.Fragment key={g.section ?? `basics-group-${gi}`}>
                    {g.section ? <Text style={styles.sectionLabel}>{g.section}</Text> : null}
                    <View style={styles.masonry}>
                      {g.columns.map((col, ci) => (
                        <View key={ci} style={styles.masonryCol}>
                          {col.map((m) => renderBasicsCard(m))}
                        </View>
                      ))}
                    </View>
                  </React.Fragment>
                ))}
              </>
            )}
            {/* ★ 2026-10-07（用户：长期健康里面，AI 综合分析先隐藏）：由 SHOW_LONGEVITY_AI 控制 */}
            {SHOW_LONGEVITY_AI ? <InsightBanner rows={insightRows} pending={aiOverview.loading} /> : null}
          </>
        ))}
      </View>
    </ScreenContainer>
    {/* 情绪洞察页底部悬浮记录卡（仅 emotion 子 tab 出现；认知/其他 tab 不动） */}
    {topTab === 'rhythm' && effSub === 'emotion' && <EmotionQuickRecord />}
    </View>
    <ChatSheet
      visible={chatVisible}
      onClose={() => setChatVisible(false)}
      initialQuestion={chatQuestion}
    />
  </>
  );
}

/** ★ 2026-10-16（用户）：血液成分 tab 卡 = 尿酸 + 血脂四项（TC/TG/HDL/LDL）。
 *  数据口径与 MetricDetailScreen 的 UaReferenceCard / LipidOverviewCard 完全一致：
 *  - 尿酸：0–90 偏低 / 90–360 正常 / 360–1000 偏高（µmol/L）
 *  - 血脂：各自理想上限（TC<5.2 / TG<1.7 / LDL<3.4，越高越差；HDL>1.0，越高越好）
 *  整卡可点进各指标详情页（尿酸走 key 'ua'，血脂走各自 key）。 */
const BLOOD_PANEL: {
  key: string; name: string; unit: string; yMin: number; yMax: number;
  decimals: number;
  status: (v: number) => { tone: 'good' | 'warn' | 'neutral'; label: string };
  rangeText: string;
}[] = [
  {
    key: 'ua', name: '尿酸', unit: 'μmol/L', yMin: 50, yMax: 600, decimals: 0,
    status: (v) => v < 90 ? { tone: 'neutral', label: '偏低' } : v <= 360 ? { tone: 'good', label: '正常' } : { tone: 'warn', label: '偏高' },
    rangeText: '偏低 0–90 / 正常 90–360 / 偏高 360–1000 µmol/L',
  },
  {
    key: 'cholesterol', name: '总胆固醇', unit: 'mmol/L', yMin: 0, yMax: 10, decimals: 2,
    status: (v) => v <= 5.2 ? { tone: 'good', label: '正常' } : { tone: 'warn', label: '偏高' },
    rangeText: '理想 < 5.2 mmol/L',
  },
  {
    key: 'triglyceride', name: '甘油三酯', unit: 'mmol/L', yMin: 0, yMax: 6, decimals: 2,
    status: (v) => v <= 1.7 ? { tone: 'good', label: '正常' } : { tone: 'warn', label: '偏高' },
    rangeText: '理想 < 1.7 mmol/L',
  },
  {
    key: 'hdl', name: '高密度脂蛋白', unit: 'mmol/L', yMin: 0, yMax: 3, decimals: 2,
    status: (v) => v >= 1.0 ? { tone: 'good', label: '正常' } : { tone: 'warn', label: '偏低' },
    rangeText: '理想 > 1.0 mmol/L',
  },
  {
    key: 'ldl', name: '低密度脂蛋白', unit: 'mmol/L', yMin: 0, yMax: 6, decimals: 2,
    status: (v) => v <= 3.4 ? { tone: 'good', label: '正常' } : { tone: 'warn', label: '偏高' },
    rangeText: '理想 < 3.4 mmol/L',
  },
];

const BloodPanelTab = React.memo(function BloodPanelTab({ onOpenDetail }: { onOpenDetail: (key: string, name: string, unit: string, yMin: number, yMax: number) => void }) {
  const hsVer = useHealthStoreVersion();
  const { model: bpModel } = useDeviceModel();
  const dk = dayKey(Date.now());
  const getLatest = useCallback((k: string): number | null => {
    try {
      const pts = healthStore.getIntraday(k as any, dk);
      return pts.length ? pts[pts.length - 1].v : null;
    } catch { return null; }
  }, [dk, hsVer]);

  // ★ 2026-10-16（续）：仿「身体成分」小卡片样式（2 列网格 + 圆角小卡），而非整行大卡。
  const chipBase: any = {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    justifyContent: 'center',
    minHeight: theme.sp(22),
  };
  // ★ 2026-10-16（续 4）：血脂四张小卡共用的外框
  const lipidGroup: any = {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingBottom: theme.space.sm,
  };
  const renderChip = (it: (typeof BLOOD_PANEL)[number], wide?: boolean) => {
    const v = getLatest(it.key);
    const st = v == null ? null : it.status(v);
    const toneColor = st == null ? theme.colors.textSub
      : st.tone === 'good' ? theme.colors.success
      : st.tone === 'warn' ? theme.colors.stateTense : theme.colors.textSub;
    return (
      <TouchableOpacity
        key={it.key}
        activeOpacity={0.7}
        onPress={() => onOpenDetail(it.key, it.name, it.unit, it.yMin, it.yMax)}
        style={[
          chipBase,
          { flexBasis: wide ? '100%' : '46%', flexGrow: 1, marginBottom: theme.space.sm },
        ]}
      >
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) }}>{it.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
          <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle }}>
            {v == null ? '—' : v.toFixed(it.decimals)}
          </Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{it.unit}</Text>
        </View>
        {st ? (
          <View style={{ alignSelf: 'flex-start', marginTop: theme.sp(1), borderRadius: theme.radius.pill, paddingHorizontal: theme.sp(2.5), paddingVertical: 2, backgroundColor: toneColor + '22' }}>
            <Text style={{ fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: toneColor }}>{st.label}</Text>
          </View>
        ) : (
          <Text style={{ marginTop: theme.sp(1), fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{it.rangeText}</Text>
        )}
      </TouchableOpacity>
    );
  };
  const grid = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.space.sm };

  // ★ 2026-11-05（用户：按真机收敛）：基础版不展示其硬件未回读的指标（尿酸 uricAcid / 总胆固醇 cholesterol）
  const panelItems = BLOOD_PANEL.filter((it) => {
    if (it.key === 'ua') return hasCap(bpModel, 'uricAcid');
    if (it.key === 'cholesterol') return hasCap(bpModel, 'cholesterol');
    return true;
  });
  const uricItems = panelItems.filter((it) => it.key === 'ua');
  const lipidItems = panelItems.filter((it) => it.key !== 'ua');
  const subHead = { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginTop: theme.sp(3), marginBottom: theme.sp(1.5) };

  return (
    <View>
      {uricItems.length > 0 ? (
        <>
          <Text style={subHead}>尿酸</Text>
          <View style={grid}>{uricItems.map((it) => renderChip(it, true))}</View>
        </>
      ) : null}
      {/* ★ 2026-10-16（续 4）：四张血脂小卡外面包一个框，右上角箭头 → 进入血脂详情（内含日/周/月/年趋势图） */}
      <View style={[lipidGroup, { marginTop: theme.sp(3) }]}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onOpenDetail('cholesterol', '血脂', 'mmol/L', 0, 10)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space.md, paddingTop: theme.space.sm }}
        >
          <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink }}>血脂</Text>
          <Text style={{ fontSize: theme.fontSize.stat, color: theme.colors.textSub, lineHeight: theme.sp(6) }}>›</Text>
        </TouchableOpacity>
        <View style={[grid, { paddingHorizontal: theme.space.md, paddingTop: theme.space.sm }]}>
          {lipidItems.map((it) => renderChip(it))}
        </View>
      </View>
      <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.sp(5) }}>参考区间仅供参考，不替代医学检测。数据来自戒指健康一览自动评估，需连接戒指完成一次测量后更新。</Text>
    </View>
  );
});

/** v18.3：认知 tab 卡 —— 与首页「认知消耗」同源（computeCognitiveLoadReport）。
 *  今天采样不足时回退到最近有数据日（≤6 天前），note 标注展示的是哪天；整卡可点进认知消耗详情。 */
const CogTabCard = React.memo(function CogTabCard({ ring, navigation }: { ring: any; navigation: any }) {
  const { nowMs, note } = useMemo(() => {
    // 先试今天（=此刻）；采样不够再往前找最近有数据的一天
    if (computeCognitiveLoadReport(Date.now()).sampleCount >= 2) return { nowMs: Date.now(), note: undefined as string | undefined };
    for (let i = 1; i <= 6; i++) {
      const ms = Date.now() - i * 86400000;
      if (computeCognitiveLoadReport(reportNowMsForDay(ms)).sampleCount >= 2) {
        const d = new Date(ms);
        return { nowMs: reportNowMsForDay(ms), note: `展示最近有数据日 · ${d.getMonth() + 1}-${d.getDate()}` };
      }
    }
    return { nowMs: undefined, note: undefined };
  }, [ring]);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })}>
      <CognitiveLoadCard nowMs={nowMs} note={note} />
    </TouchableOpacity>
  );
});

/** Catmull-Rom → 三次贝塞尔平滑曲线（与全站「趋势=平滑弧线」口径一致，不画折线） */
function smoothSpline(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** ★ 2026-10-10（用户）：血糖 tab 卡 = 最新值 + 「全天血糖趋势」。
 *  数据 = healthStore intraday 'glucose'（RingBle 把血糖增量写入 15 分钟槽，与指标详情页同源）；
 *  无采样 → 空骨架（虚线基线 + 「—」），绝不画假曲线（空态铁律）。视觉走 chart token（S 档 96）。 */
const SugarTrendCard = React.memo(function SugarTrendCard({ ring }: { ring: any }) {
  const hsVer = useHealthStoreVersion();
  const pts = useMemo(() => {
    try {
      return healthStore
        .getIntraday('glucose', dayKey(Date.now()))
        .filter((p: any) => Number.isFinite(p?.v) && p.v > 0);
    } catch { return []; }
  }, [ring, hsVer]);
  const last = pts.length > 0 ? pts[pts.length - 1] : null;
  const latest = last != null ? last.v : ((ring?.daily?.bloodSugar as number | undefined) ?? null);

  const [w, setW] = useState(0);
  const H = chart.h.s;                      // ★ 规范：全宽卡内嵌趋势 = S 档 96
  const PAD_L = 30, PAD_R = 10, PAD_T = 8, PAD_B = 16;
  const plotW = Math.max(1, w - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const Y_MIN = 3, Y_MAX = 12;              // 与详情页血糖 y 轴同域（openDetail 3–12）
  const yOf = (v: number) => PAD_T + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  const midnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const xOf = (t: number) => PAD_L + Math.max(0, Math.min(1, (t - midnight) / 86400000)) * plotW;
  const curvePts = pts.map((p: any) => ({ x: xOf(p.t), y: yOf(p.v) }));
  const lineD = smoothSpline(curvePts);
  const Y_TICKS = [4, 7, 10];
  const HOUR_TICKS = [0, 6, 12, 18, 24];    // 与 chartAxis 日刻度同源
  const hasData = pts.length >= 2;

  return (
    <Card padded={false}>
      <View style={{ padding: theme.space.cardPad }}>
        {/* 头部：图标方 + 名称 + 右侧测量时间 */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 26, height: 26, borderRadius: mm.radius.iconSq, backgroundColor: mm.colors.honeySoft, alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(1) }}>
            <Icon name="drop" size={14} color={mm.colors.honeyDeep} />
          </View>
          <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: mm.colors.ink }}>血糖</Text>
          <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
                {last != null ? formatRelativeTime(last.t) : '今日暂无采样'}
              </Text>
              <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} />
            </View>
          </View>

        {/* 大数字：intraday 最新 → daily 兜底 → 「—」；单位保留 */}
        <Text style={{ fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: mm.colors.ink, marginTop: theme.sp(1) }}>
          {formatValue(latest)}
        </Text>
        <Text style={{ fontSize: theme.fontSize.micro, color: mm.colors.honeyDeep, marginTop: theme.sp(0.5) }}>mmol/L · 今日</Text>

        {/* 全天趋势（S 档）：有数据画平滑曲线 + 末点；无数据画虚线基线骨架 */}
        <View
          onLayout={(e) => { const cw = e.nativeEvent.layout.width; if (cw > 0 && Math.abs(cw - w) > 1) setW(cw); }}
        >
          {w > 0 ? (
            <Svg width={w} height={H}>
              {Y_TICKS.map((v) => (
                <SvgLine
                  key={v}
                  x1={PAD_L} y1={yOf(v)} x2={w - PAD_R} y2={yOf(v)}
                  stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid}
                />
              ))}
              {Y_TICKS.map((v) => (
                <SvgText key={`t${v}`} x={PAD_L - 5} y={yOf(v) + 3} fontSize={8.5} fill={theme.colors.textSub} textAnchor="end">{v}</SvgText>
              ))}
              {hasData ? (
                <>
                  <SvgPath d={lineD} fill="none" stroke={mm.colors.honeyCore} strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
                  {last != null && (
                    <SvgCircle
                      cx={xOf(last.t)} cy={yOf(last.v)} r={chart.dot.radius}
                      fill={mm.colors.honeyCore} stroke="#FFFFFF" strokeWidth={chart.dot.stroke}
                    />
                  )}
                </>
              ) : (
                <SvgLine
                  x1={PAD_L} y1={PAD_T + plotH / 2} x2={w - PAD_R} y2={PAD_T + plotH / 2}
                  stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref}
                />
              )}
              {HOUR_TICKS.map((h) => {
                const x = PAD_L + (h / 24) * plotW;
                return (
                  <SvgText key={`h${h}`} x={Math.min(w - PAD_R, Math.max(PAD_L, x))} y={H - 3} fontSize={8.5} fill={theme.colors.textSub} textAnchor="middle">{h}</SvgText>
                );
              })}
            </Svg>
          ) : null}
        </View>
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1) }}>
          纵轴 = mmol/L · 横轴 = 一天 24h{hasData ? '' : ' · 暂无血糖采样'}
        </Text>
      </View>
    </Card>
  );
});

/** ★ 2026-10-10（用户）：血压卡重做 = 最新值 + 「全天血压趋势」双曲线（与血糖卡同构）。
    数据走 healthStore intraday bpSys/bpDia（与 BpDetail 详情页完全同源，fillDailyMean 兜底）；
    无采样 → 空骨架虚线基线 + 「—」，绝不画假曲线（空态铁律）。 */
const BpTrendCard = React.memo(function BpTrendCard({ ring }: { ring: any }) {
  const hsVer = useHealthStoreVersion();
  const { sysPts, diaPts } = useMemo(() => {
    try {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const now = Date.now();
      return {
        sysPts: healthStore.getTimeRange('bpSys', midnight.getTime(), now, { fillDailyMean: true, maxPoints: 240 }).filter((p: any) => Number.isFinite(p?.v) && p.v > 0),
        diaPts: healthStore.getTimeRange('bpDia', midnight.getTime(), now, { fillDailyMean: true, maxPoints: 240 }).filter((p: any) => Number.isFinite(p?.v) && p.v > 0),
      };
    } catch { return { sysPts: [], diaPts: [] }; }
  }, [ring, hsVer]);
  const lastSys = sysPts.length > 0 ? sysPts[sysPts.length - 1] : null;
  const lastDia = diaPts.length > 0 ? diaPts[diaPts.length - 1] : null;
  const lastT = Math.max(lastSys?.t ?? 0, lastDia?.t ?? 0);
  const hasData = sysPts.length >= 2 || diaPts.length >= 2;

  const [w, setW] = useState(0);
  const H = chart.h.s;                      // ★ 规范：全宽卡内嵌趋势 = S 档 96（与血糖卡等高）
  const PAD_L = 30, PAD_R = 10, PAD_T = 8, PAD_B = 16;
  const plotW = Math.max(1, w - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const Y_MIN = 40, Y_MAX = 160;            // mmHg 域（收缩 60–140 / 舒张 40–90 均在框内）
  const yOf = (v: number) => PAD_T + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;
  const midnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);
  const xOf = (t: number) => PAD_L + Math.max(0, Math.min(1, (t - midnight) / 86400000)) * plotW;
  const sysD = smoothSpline(sysPts.map((p: any) => ({ x: xOf(p.t), y: yOf(p.v) })));
  const diaD = smoothSpline(diaPts.map((p: any) => ({ x: xOf(p.t), y: yOf(p.v) })));
  const Y_TICKS = [60, 100, 140];
  const HOUR_TICKS = [0, 6, 12, 18, 24];    // 与 chartAxis 日刻度同源

  return (
    <Card padded={false}>
      <View style={{ padding: theme.space.cardPad }}>
        {/* 头部：图标方 + 名称 + 右侧测量时间 */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 26, height: 26, borderRadius: mm.radius.iconSq, backgroundColor: mm.colors.skySoft, alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(1) }}>
            <Icon name="drop" size={14} color={mm.colors.skyDeep} />
          </View>
          <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: mm.colors.ink }}>血压</Text>
          <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
                {lastT > 0 ? formatRelativeTime(lastT) : '今日暂无测量'}
              </Text>
              <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} />
            </View>
          </View>

        {/* 大数字：收缩/舒张最新一对；单位保留 */}
        <Text style={{ fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: mm.colors.ink, marginTop: theme.sp(1) }}>
          {lastSys != null && lastDia != null ? `${Math.round(lastSys.v)}/${Math.round(lastDia.v)}` : '—'}
        </Text>
        <Text style={{ fontSize: theme.fontSize.micro, color: mm.colors.skyDeep, marginTop: theme.sp(0.5) }}>mmHg · 今日</Text>

        {/* 全天趋势（S 档）：收缩 skyCore / 舒张 skyMid 双平滑曲线 + 末点；无数据画虚线基线骨架 */}
        <View
          onLayout={(e) => { const cw = e.nativeEvent.layout.width; if (cw > 0 && Math.abs(cw - w) > 1) setW(cw); }}
        >
          {w > 0 ? (
            <Svg width={w} height={H}>
              {Y_TICKS.map((v) => (
                <SvgLine
                  key={v}
                  x1={PAD_L} y1={yOf(v)} x2={w - PAD_R} y2={yOf(v)}
                  stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid}
                />
              ))}
              {Y_TICKS.map((v) => (
                <SvgText key={`t${v}`} x={PAD_L - 5} y={yOf(v) + 3} fontSize={8.5} fill={theme.colors.textSub} textAnchor="end">{v}</SvgText>
              ))}
              {hasData ? (
                <>
                  <SvgPath d={sysD} fill="none" stroke={mm.colors.skyCore} strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
                  <SvgPath d={diaD} fill="none" stroke={mm.colors.skyMid} strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
                  {lastSys != null && (
                    <SvgCircle cx={xOf(lastSys.t)} cy={yOf(lastSys.v)} r={chart.dot.radius}
                      fill={mm.colors.skyCore} stroke="#FFFFFF" strokeWidth={chart.dot.stroke} />
                  )}
                  {lastDia != null && (
                    <SvgCircle cx={xOf(lastDia.t)} cy={yOf(lastDia.v)} r={chart.dot.radius}
                      fill={mm.colors.skyMid} stroke="#FFFFFF" strokeWidth={chart.dot.stroke} />
                  )}
                </>
              ) : (
                <SvgLine
                  x1={PAD_L} y1={PAD_T + plotH / 2} x2={w - PAD_R} y2={PAD_T + plotH / 2}
                  stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref}
                />
              )}
              {HOUR_TICKS.map((h) => {
                const x = PAD_L + (h / 24) * plotW;
                return (
                  <SvgText key={`h${h}`} x={Math.min(w - PAD_R, Math.max(PAD_L, x))} y={H - 3} fontSize={8.5} fill={theme.colors.textSub} textAnchor="middle">{h}</SvgText>
                );
              })}
            </Svg>
          ) : null}
        </View>

        {/* 图例：收缩 / 舒张 */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.sp(3), marginTop: theme.sp(1) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mm.colors.skyCore }} />
            <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>收缩压</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mm.colors.skyMid }} />
            <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>舒张压</Text>
          </View>
        </View>
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(0.5) }}>
          纵轴 = mmHg · 横轴 = 一天 24h{hasData ? '' : ' · 暂无血压采样'}
        </Text>
      </View>
    </Card>
  );
});

/** v18.13：周步数柱状图 —— 7 根柱（一~日），今日高亮；全零=空骨架灰桩（不冒充数据）。宽度 onLayout 实测。 */const WeekStepsBars = React.memo(function WeekStepsBars({ values }: { values: number[] }) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const H = chart.h.xs, AX = 13, CH = H - AX;  // ★ 规范：XS 档 64
  const MON = ['一', '二', '三', '四', '五', '六', '日'];
  const N = values.length || 7;
  const empty = !values.some(v => v > 0);
  const max = Math.max(1, ...values);
  const slotW = measuredW / N;
  // ★ 2026-10-10（bar-design-unified-spec 规则3）：柱宽全站统一 clamp(4, slot×0.6, 24)
  const bw = Math.min(24, Math.max(4, slotW * 0.6));
  const todayIdx = N - 1;
  const EMPTY_COL = mm.colors.emptyFill;
  return (
    <View
      onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
      style={{ width: '100%', height: H }}
    >
      {measuredW > 0 && (
        <Svg width={measuredW} height={H}>
          {values.map((v, i) => {
            const bh = empty ? 2 : Math.max(3, (v / max) * CH * 0.92);
            const x = i * slotW + (slotW - bw) / 2;
            const y = CH - bh;
            // ★ 规则4：今日=deep 档强调，非今日=core 档，透明度一律 1（原 0.55 越界）
            const col = empty ? EMPTY_COL : i === todayIdx ? mm.colors.skyDeep : mm.colors.skyCore;
            return <SvgRect key={'wb' + i} x={x} y={y} width={bw} height={bh} rx={empty ? 1 : chart.barRadius} fill={col} />;
          })}
          {MON.slice(0, N).map((d, i) => (
            <SvgText key={'wl' + i} x={i * slotW + slotW / 2} y={H - 4}
              textAnchor="middle" fontSize={9}
              fontWeight={i === todayIdx ? '700' : '500'}
              fill={i === todayIdx ? mm.colors.skyDeep : mm.colors.inkFaint}>
              {d}
            </SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
});

/** v18.2：运动恢复节律卡 —— 今日步数/距离/活动消耗 + 近 7 天步数柱状图，点击进运动消耗详情。 */
const SportRecoveryCard = React.memo(function SportRecoveryCard({ ring, navigation }: { ring: any; navigation: any }) {
  const weekSteps = useMemo(() => {
    const out: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dk = dayKey(Date.now() - i * 86400000);
      out.push(ring?.stepDaily?.[dk]?.steps ?? 0);
    }
    return out;
  }, [ring]);
  const today = ring?.stepDaily?.[dayKey(Date.now())] ?? {};
  const steps = today?.steps ?? 0;
  const distanceKm = (today?.distance ?? 0) >= 10
    ? (today?.distance ?? 0).toFixed(1)
    : (today?.distance ?? 0).toFixed(2);
  const calorie = Math.round(today?.calorie ?? 0);

  const rows: [string, string, string][] = [
    ['今日步数', steps > 0 ? steps.toLocaleString('zh-CN') : '—', '步'],
    ['步行距离', steps > 0 ? distanceKm : '—', 'km'],
    ['活动消耗', calorie > 0 ? String(calorie) : '—', 'kcal'],
  ];
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })}>
      <Card style={{ padding: theme.space.cardPadCompact }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.profTitle}>运动恢复</Text>
          <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} />
        </View>
        <WeekStepsBars values={weekSteps} />
        <View style={{ marginTop: theme.sp(1.5), gap: theme.sp(1) }}>
          {rows.map(([label, val, unit]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: theme.fontSize.sm, color: mm.colors.inkSoft }}>{label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                {/* v18.11：数值与首页运动卡同步加大（card 18 → h2 22） */}
                <Text style={{ fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as never, color: mm.colors.skyDeep }}>{val}</Text>
                <Text style={{ fontSize: theme.fontSize.sm, color: mm.colors.inkSoft }}>{unit}</Text>
              </View>
            </View>
          ))}
        </View>
      </Card>
    </TouchableOpacity>
  );
});

/** ECG 波形路径：归一化 + Catmull-Rom 平滑成真实心电图曲线。 */
function ecgWaveformPath(values: number[]): string {
  if (!values || values.length < 4) return '';
  const W = 320;
  const H = chart.h.xs;  // ★ 规范：XS 档 64（原 80，与同页 64 不一致）
  const pad = 8;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) max = min + 1;
  const n = values.length;
  const pts: [number, number][] = values.map((v, i) => [
    pad + (i / (n - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / (max - min)) * (H - pad * 2),
  ]);
  // Catmull-Rom → cubic bezier
  const d = [`M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
  }
  return d.join(' ');
}

/** 心电图卡片：空状态 / 测量进度 / 最近一次波形 + 指标。 */
function EcgReadout({ ring }: { ring: RingState }) {
  const reading = ring.ecg;
  const progress = ring.ecgProgress;
  const caps = ring.deviceCapabilities;
  const ecgSupported = !caps || caps.ecgType > 0;
  const isMeasuring = progress != null;

  if (!ecgSupported) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图</Text>
        <Text style={styles.emptyNote}>当前戒指硬件不支持 ECG 测量</Text>
      </Card>
    );
  }

  // v10：渐变按钮（lime→粉，135°，参考稿「Save Mood」）
  const measureBtn = (
    <TouchableOpacity
      style={[styles.ecgBtn, isMeasuring && styles.ecgBtnDisabled]}
      onPress={() => RingBle.measure('ecg')}
      disabled={isMeasuring}
    >
      <LinearGradient
        colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.ecgBtnGrad}
      >
        <Text style={styles.ecgBtnText}>
          {isMeasuring ? `测量中 ${progress?.progress ?? 0}%` : reading ? '重新测量' : '开始测量'}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );

  if (!reading && !isMeasuring) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图</Text>
        <Text style={styles.emptyNote}>尚未测量，点击下方按钮启动 ECG（约 30 秒完成）</Text>
        {measureBtn}
      </Card>
    );
  }

  if (!reading) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图 · 测量中</Text>
        <View style={styles.ecgProgressBar}>
          <View style={[styles.ecgProgressFill, { width: `${progress?.progress ?? 0}%` }]} />
        </View>
        <Text style={styles.emptyNote}>
          {progress?.hr ? `当前心率 ${Math.round(progress.hr)} bpm · ` : ''}
          {progress?.progress ?? 0}% — 请保持手指稳定接触戒指
        </Text>
      </Card>
    );
  }

  const rows: [string, string][] = [
    ['平均心率', `${Math.round(reading.aveHeart)} bpm`],
    ['HRV', `${Math.round(reading.aveHrv)} ms`],
    ['呼吸率', `${Math.round(reading.aveResRate)} 次/分`],
    ['QT', `${Math.round(reading.aveQT)} ms`],
    ['PWV', `${Math.round(reading.avePWV)} cm/s`],
  ];
  return (
    <Card>
      <Text style={styles.profTitle}>心电图 · 最近一次测量</Text>
      <View style={styles.ecgChart}>
        <Svg width="100%" height={80} viewBox="0 0 320 80" preserveAspectRatio="none">
          <SvgPath
            d={ecgWaveformPath(reading.waveform)}
            fill="none"
            stroke={mm.colors.skyCore}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <View style={styles.ecgGrid}>
        {rows.map(([k, v]) => (
          <View style={styles.ecgCell} key={k}>
            <Text style={styles.ecgLabel}>{k}</Text>
            <Text style={styles.ecgValue}>{v}</Text>
          </View>
        ))}
      </View>
      {isMeasuring ? (
        <Text style={styles.emptyNote}>测量中…（{progress?.progress ?? 0}%）</Text>
      ) : (
        measureBtn
      )}
    </Card>
  );
}


// ── v10: 组 tab 胶囊（白底描边轨道 + lime 选中滑块，SPEC §1 #15）──
function Segmented({ options, activeIndex, onChange }: { options: string[]; activeIndex: number; onChange: (i: number) => void }) {
  // v18.2：与 App 内容区同宽（ScreenContainer 左右各 space.screen，轨道自身再留 sp(1)×2）
  const { width: winW } = useWindowDimensions();
  const W = winW - 2 * theme.space.screen - theme.sp(2);
  const itemW = W / options.length;
  const [anim] = useState(() => new Animated.Value(activeIndex));
  useEffect(() => {
    Animated.timing(anim, { toValue: activeIndex, duration: 260, useNativeDriver: false }).start();
  }, [activeIndex]);
  const thumbLeft = anim.interpolate({ inputRange: options.map((_, i) => i), outputRange: options.map((_, i) => theme.sp(1) + itemW * i) });
  return (
    <View style={[styles.segmentedWrap, { width: W + theme.sp(2) }]}>
      <View style={[styles.segmentedTrack, { width: W + theme.sp(2) }]}>
        <Animated.View style={[styles.segmentedThumb, { width: itemW - theme.sp(2), left: thumbLeft }]} />
        {options.map((label, i) => {
          const isActive = i === activeIndex;
          return (
            <Pressable key={label} onPress={() => onChange(i)} style={[styles.segmentedBtn, { width: itemW }]}>
              <Text style={[styles.segmentedLabel, isActive && styles.segmentedLabelOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── v10: 子 tab 胶囊（节律=lavender 选中 / 长期=cyan 选中，SPEC §1 #15）──
function UnderlineTabs({
  options,
  activeIndex,
  onChange,
  large,
}: {
  options: string[];
  activeIndex: number;
  onChange: (i: number) => void;
  tone?: 'lav' | 'cy';
  large?: boolean;
}) {
  // ★ 2026-10-06（用户口径，参考设计稿）：胶囊「无底色、纯文字」；选中态只让**描边**变色，不改底色。
  //   ★ large（节律健康仅 2 个 tab）：等宽平铺、字更大、未选也保留浅描边 → 像并排的描边按钮。
  return (
    <View style={[styles.underlineWrap, large && styles.underlineWrapLarge]}>
      {options.map((label, i) => {
        const isActive = i === activeIndex;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(i)}
            style={[styles.underlineBtn, large && styles.underlineBtnLarge, isActive && styles.underlineBtnOn]}
          >
            <Text style={[styles.underlineLabel, isActive && styles.underlineLabelOn]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.lg },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
  },
  topTabRow: { flexDirection: 'row', marginBottom: theme.sp(2) },
  topTab: { paddingHorizontal: theme.sp(4), paddingVertical: theme.sp(2), borderRadius: theme.radius.pill, marginRight: theme.sp(1.5), fontSize: theme.fontSize.card },
  chipRow: { flexGrow: 0, marginLeft: -theme.space.screen },
  chipContent: { paddingHorizontal: theme.space.screen, paddingVertical: theme.sp(1) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(2.5), alignItems: 'stretch' },
  // 双列瀑布流：两列等宽、各自竖向堆叠（配 gap），卡片高度不一 → 错落有致
  // ★ 2026-10-10（用户：「上面那些卡片紧凑一点排列」）：列间距与卡间距统一收到 sp(2)，
  //   配合「单一分组」消除组间空白，整页明显更紧凑。
  masonry: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(2) },
  masonryCol: { flex: 1, gap: theme.sp(2) },
  // ★ 2026-11-06（用户）：基础指标卡改为单列全宽列表（更宽、像列表一样平铺）
  basicsList: { flexDirection: 'column', gap: theme.sp(3) },
  emptyNote: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
  },
  sectionLabel: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
    marginTop: theme.space.md,
    marginBottom: theme.sp(1),
  },
  ecgBtn: {
    marginTop: theme.space.md,
    borderRadius: theme.radius.pill,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  ecgBtnGrad: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  ecgBtnDisabled: { opacity: 0.5 },
  ecgBtnText: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
  },
  ecgProgressBar: {
    height: 6,
    backgroundColor: theme.colors.textSub + '44',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: theme.space.sm,
  },
  ecgProgressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent1,
    borderRadius: 3,
  },
  profTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.space.xs,
  },
  profHint: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  profRow: { flexDirection: 'row', gap: theme.space.md, marginBottom: theme.space.sm },
  profField: { flex: 1 },
  profLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.xs,
  },
  profInput: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    fontSize: theme.fontSize.card,
    color: theme.colors.textTitle,
  },
  seg: { flexDirection: 'row', backgroundColor: theme.colors.ui.offTrack, borderRadius: theme.radius.card, padding: theme.sp(1) },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.card,
  },
  segBtnOn: { backgroundColor: theme.colors.accentSolid },
  segText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textSub },
  segTextOn: { color: theme.colors.textWhite },
  profSave: {
    marginTop: theme.space.xs,
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    alignItems: 'center',
  },
  profSaveText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
  profSaved: { marginTop: theme.space.xs, fontSize: theme.fontSize.micro, color: theme.colors.success, textAlign: 'center' },
  ecgChart: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    padding: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  ecgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  ecgCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: theme.colors.cardBg, // mira-ocean：white55(0.55) 浅玻璃 + 浅字不可读 → 深色玻璃
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  ecgLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  ecgValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  // 方案 A Segmented
  segmentedWrap: { alignItems: 'flex-start' },
  segmentedTrack: {
    // v16 统一 tab 样式：轨道 = 中性灰浅底（无描边），与首页模块 tab/子 tab 同款
    backgroundColor: mm.colors.btnBusyBg,
    borderRadius: theme.radius.pill,
    padding: theme.sp(1),
    flexDirection: 'row',
    position: 'relative',
    height: theme.sp(10),
  },
  // 选中滑块 = limeSoft（选中字 limeDeep，与子 tab 一致）
  segmentedThumb: {
    position: 'absolute',
    top: theme.sp(1),
    bottom: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.limeSoft,
  },
  segmentedBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: theme.sp(8),
    borderRadius: theme.radius.pill,
  },
  segmentedLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
  },
  segmentedLabelOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold },

  // ★ 2026-10-06（用户口径）：无底色纯文字；未选无边框，选中只描边（lime）。
  underlineWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1) },
  underlineWrapLarge: { flexWrap: 'nowrap', width: '100%' },
  underlineBtn: {
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  underlineBtnLarge: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp(3),
    paddingHorizontal: theme.sp(3),
    borderColor: mm.colors.cardBorder,
  },
  underlineBtnOn: { borderColor: mm.colors.limeMid },
  underlineLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: mm.colors.inkSoft },
  underlineLabelOn: { color: mm.colors.ink, fontWeight: theme.weight.semibold },

});
