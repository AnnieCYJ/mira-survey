import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity, Pressable, Animated, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path as SvgPath, Defs, LinearGradient as SvgGradient, Stop, Rect as SvgRect, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import BpCard from '../components/BpCard';
import EcgCard from '../components/EcgCard';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Chip from '../components/Chip';
import InsightBanner from '../components/InsightBanner';
import DimensionCard from '../components/DimensionCard';
import SleepStructureCard from '../components/SleepStructureCard';
import CyclePhaseCard from '../components/CyclePhaseCard';
import BasicMetricCard from '../components/BasicMetricCard';
import ManualMetricCard from '../components/ManualMetricCard';
import ListCard, { type ListItem } from '../components/ListCard';
import Card from '../components/Card';
import Icon from '../components/Icon';
import ExamTab from '../components/ExamTab';
import ChatSheet from '../components/ChatSheet';
import BloodComponentPanel from '../components/BloodComponentPanel';
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
import { dayKey } from '../data/healthStore';
import { useAppState } from '../state/AppState';
import { useHealthStoreVersion, useEnsureDerivedMetrics } from '../hooks/useHealthStore';
import { useAiInsight } from '../hooks/useAiInsight';
import { resolveInsightRows } from '../ai/insight';
import HealthAgeCard from '../components/HealthAgeCard';
import AllDayRecoveryCard from '../components/AllDayRecoveryCard';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
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
// 新增「一键体检」tab（置于中部）：本地估算身体成分并持久化记录，洞察页只展示最新、历史页按时间排列。
type TabKey = 'basics' | MetricKey;

const TOP_TABS: { key: 'rhythm' | 'longevity'; label: string }[] = [
  { key: 'rhythm', label: '节律健康' },
  { key: 'longevity', label: '长期健康' },
];

const RHYTHM_SUBS: { key: string; label: string }[] = [
  { key: 'recover', label: '皮质醇' },
  { key: 'body', label: '雌/孕激素' },
];

const LONGEVITY_SUBS: { key: string; label: string }[] = [
  { key: 'ecg', label: '心电' },
  { key: 'bp', label: '血压' },
  { key: 'sugar', label: '血糖' },
  { key: 'bodycomp', label: '身体成分' },
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
const SHORT_METRIC_KEYS = new Set<string>(['spo2', 'eda', 'cortisol', 'stress', 'fatigue', 'emotion', 'skin', 'snsActivation']);
const showTrendFor = (key: string) => !SHORT_METRIC_KEYS.has(key);

/**
 * 把卡片按「估高」贪心分配到两列：**每次放进当前最矮的一列**。
 *
 * 为什么这样做：参考稿左侧是「错落有致」的瀑布流 —— 两列各自竖向堆叠、卡片高度不一，
 * 行与行天然不对齐。RN 没有原生 masonry，但只要把卡片交给两个独立的列容器，
 * 再让两列总高尽量接近（避免一条长一条短），就能得到同样的错落观感；
 * 而原来的 flexWrap 网格会因为每行等高而显得呆板。
 */
function splitColumnsBalanced<T>(items: T[], estH: (it: T) => number): [T[], T[]] {
  const cols: [T[], T[]] = [[], []];
  const sum = [0, 0];
  for (const it of items) {
    const i = sum[0] <= sum[1] ? 0 : 1;
    cols[i].push(it);
    sum[i] += estH(it);
  }
  return cols;
}

export default function InsightScreen() {
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });
  const navigation = useNavigation<any>();
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
  // 当前 top tab 生效的子 tab 配置（hero/Segmented/UnderlineTabs 两个分支共用一套）
  const ACTIVE_SUBS = topTab === 'rhythm' ? RHYTHM_SUBS : LONGEVITY_SUBS;
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
      if (fatigue?.loadScore != null) scores.push(100 - fatigue.loadScore * 0.6);
      if (stress?.emotionalLoad != null) scores.push(100 - stress.emotionalLoad * 0.5);
      if (sleep != null) scores.push(sleep);
      if (scores.length === 0) return 75;
      return Math.round(scores.reduce((a,b) => a+b,0) / scores.length);
    } catch { return 75; }
  }, [ring.daily['sleepScore']]);

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
    const c = _cache.get(key);
    if (c) return c.hist;
    const raw = getTodaySeries(key);
    const lastT = raw.length ? raw[raw.length - 1].t : null;
    // 实时信号半小时聚合（只有 render 时才算）
    const _HALF = ['hr','spo2','temp','eda','hrv','rr','cortisol','stress','fatigue','emotion','skin','bpSys','bpDia'];
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
  // 基础指标信号（纯静态定义，只算一次）
  const basicsSignals = useMemo(() => signalsForDimension('basics'), []);
  // ★ 双列瀑布流布局：按 section 分组（组标题占整行），组内按「有无趋势图」估高做两列分配。
  //   分配结果（当前 6 张卡）：
  //     左列 = 心率 / EDA皮电 / 心率变异性（高·矮·高）
  //     右列 = 血氧 / 体温 / 皮质醇     （矮·高·矮）
  //   两列卡片高度交错 → 行不对齐，复刻参考稿左侧的「错落有致」。
  const basicsGroups = useMemo(() => {
    const estH = (m: BasicMetricDef) => (showTrendFor(m.key) ? 2 : 1);
    const groups: { section?: string; items: BasicMetricDef[] }[] = [];
    for (const m of basicsSignals) {
      const last = groups[groups.length - 1];
      if (last && last.section === m.section) last.items.push(m);
      else groups.push({ section: m.section, items: [m] });
    }
    return groups.map((g) => ({
      section: g.section,
      columns: splitColumnsBalanced(g.items, estH),
    }));
  }, [basicsSignals]);

  /** 渲染单张基础指标卡（原网格内的卡片逻辑抽出，供左右两列复用）。 */
  const renderBasicsCard = (m: BasicMetricDef) => {
    const isRealtime = realtimeKeys.has(m.key);
    const rk = m.key as RingMetricKey;
    const real = isRealtime ? (ring.metrics[rk] ?? null) : (ring.daily[m.key] ?? null);
    const hist = getCachedHist(m.key);
    const measureTime = isRealtime ? ring.lastUpdated[rk] : getCachedLastT(m.key);
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
        live={isRealtime ? ring.availability[rk] === 'live' : real != null}
        syncing={isRealtime ? ring.availability[rk] === 'syncing' : false}
        value={formatValue(real)}
        data={hist}
        onMeasure={() => RingBle.measure(rk)}
        hideMeasure={m.hideMeasure ?? true}
        measureTime={measureTime}
        showTrend={showTrendFor(m.key)}
        onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
      />
    );
  };

  return (
    <>
    {/* v10 reskin：页面全白底（与 Today 同款做法），盖住 App 根渐变 */}
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer compactTop scrollY={scrollY} topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>Insights</Text>
        </Animated.View>

        

        {/* ═══ hero + 顶 tab + 子 tab：两个 top tab 共用（目标稿六变体顶部是同一张 lime 大卡）═══ */}
        <HealthAgeCard
          healthAge={22.6}
          actualAge={28}
          overallScore={overallScoreFromReport}
          ring={ring}
          rows={insightRows}
          pending={aiOverview.loading}
        />
        <Segmented
          options={TOP_TABS.map(t => t.label)}
          activeIndex={TOP_TABS.findIndex(t => t.key === topTab)}
          onChange={(i) => { const k = TOP_TABS[i].key; setTopTab(k); setSubTab(k === 'rhythm' ? 'recover' : 'ecg'); }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={styles.chipRow} contentContainerStyle={styles.chipContent}>
          <UnderlineTabs
            options={ACTIVE_SUBS.map(t => t.label)}
            activeIndex={ACTIVE_SUBS.findIndex(t => t.key === subTab)}
            onChange={(i) => setSubTab(ACTIVE_SUBS[i].key)}
            tone={topTab === 'rhythm' ? undefined : 'cy'}
          />
        </ScrollView>

        {topTab === 'rhythm' ? (
          <>
            {subTab === 'sleep' ? (
              <>
                <SleepStructureCard dataStale={dataStale} segments={todaySegments} summary={ring.sleepSummary} sleepTime={todaySleep.sleepTime} wakeTime={todaySleep.wakeTime} deepPct={ring.daily['sleepDeep'] ?? null} remPct={ring.daily['sleepRem'] ?? null} score={ring.daily['sleepScore'] ?? null} fallbackTotalMinutes={ring.daily['sleepTotal'] ?? null} onPress={() => navigation.navigate('SleepDetail')} />
                <CortisolSleepSummary dataStale={dataStale} insightRows={recoveryRows} />
              </>
            ) : subTab === 'body' ? (
              <CyclePhaseCard ring={ring} female={ring.female} onPress={() => navigation.navigate('CycleCalendar')} />
            ) : subTab === 'recover' ? (
              // v18.2：恢复节律 = 全天恢复（睡眠恢复+皮质醇全天趋势）
              <AllDayRecoveryCard title="昼夜节律" onPress={() => navigation.navigate('EmotionCognitiveDetail')} />
            ) : subTab === 'mindCog' ? (
              // v18.3：认知 = 认知负荷（与首页「认知消耗」同源 computeCognitiveLoadReport；
              //   今天无采样时回退到最近有数据日，避免整卡空态）
              <CogTabCard ring={ring} navigation={navigation} />
            ) : subTab === 'emotion' ? (
              // v18.3：情绪 = 情绪洞察，点卡片进「情绪消耗」日/周/年详情页
              <>
                <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('EnergyDetail', { type: 'emotion' })}>
                  <EmotionInsightView />
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
            {subTab === 'ecg' ? (
              <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('EcgDetail')}>
                <Card style={{ padding: theme.space.cardPadCompact }}>
                  <EcgCard ring={ring} onPress={() => {}} compactMode />
                </Card>
              </TouchableOpacity>
            ) : subTab === 'bp' ? (
              <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('BpDetail')}>
                <Card style={{ padding: theme.space.cardPadCompact }}>
                  <BpCard ring={ring} onPress={() => {}} />
                </Card>
              </TouchableOpacity>
            ) : subTab === 'sugar' ? (
              <>
                <TouchableOpacity activeOpacity={0.92} onPress={() => openDetail('bloodSugar', '血糖', 'mmol/L', 3, 12)}>
                  {/* v16：数据卡白底全宽，语义色只在角标（黄 soft 底 + 黄 deep 图标）与数值标签 */}
                  <Card style={{ padding: theme.sp(3) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 26, height: 26, borderRadius: mm.radius.iconSq, backgroundColor: mm.colors.honeySoft, alignItems: 'center', justifyContent: 'center', marginRight: theme.sp(1) }}>
                        <Icon name="drop" size={14} color={mm.colors.honeyDeep} />
                      </View>
                      <Text style={{ fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: mm.colors.ink }}>血糖</Text>
                    </View>
                    <Text style={{ fontSize: theme.fontSize.h1, fontWeight: theme.weight.medium, color: mm.colors.ink, marginTop: theme.sp(1) }}>{formatValue(ring.daily.bloodSugar ?? null)}</Text>
                    <Text style={{ fontSize: theme.fontSize.micro, color: mm.colors.honeyDeep, marginTop: theme.sp(0.5) }}>mmol/L · 自动同步</Text>
                  </Card>
                </TouchableOpacity>
                <Card style={{ padding: theme.space.cardPadCompact }}>
                  <BloodComponentPanel ring={ring} onOpenDetail={openDetail} />
                </Card>
              </>
            ) : subTab === 'bodycomp' ? (
              // v18：一键体检 = 本地估算身体成分并持久化，独立成「身体成分」子 tab
              <ExamTab />
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
            {/* AI 分析洞察：长期健康语义，固定在内容末尾 */}
            <InsightBanner rows={insightRows} pending={aiOverview.loading} />
          </>
        )}
      </View>
    </ScreenContainer>
    {/* 情绪洞察页底部悬浮记录卡（仅 emotion 子 tab 出现；认知/其他 tab 不动） */}
    {topTab === 'rhythm' && subTab === 'emotion' && <EmotionQuickRecord />}
    </View>
    <ChatSheet
      visible={chatVisible}
      onClose={() => setChatVisible(false)}
      initialQuestion={chatQuestion}
    />
  </>
  );
}

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
    <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('EnergyDetail', { type: 'cognitive' })}>
      <CognitiveLoadCard nowMs={nowMs} note={note} />
    </TouchableOpacity>
  );
});

/** v18.13：周步数柱状图 —— 7 根柱（一~日），今日高亮；全零=空骨架灰桩（不冒充数据）。宽度 onLayout 实测。 */
const WeekStepsBars = React.memo(function WeekStepsBars({ values }: { values: number[] }) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const H = 64, AX = 13, CH = H - AX;
  const MON = ['一', '二', '三', '四', '五', '六', '日'];
  const N = values.length || 7;
  const empty = !values.some(v => v > 0);
  const max = Math.max(1, ...values);
  const slotW = measuredW / N;
  const bw = Math.max(6, slotW * 0.5);
  const todayIdx = N - 1;
  const EMPTY_COL = 'rgba(120,110,160,0.13)';
  return (
    <View
      onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
      style={{ width: '100%', height: H }}
    >
      {measuredW > 0 && (
        <Svg width={measuredW} height={H}>
          {values.map((v, i) => {
            const bh = empty ? 3 : Math.max(3, (v / max) * CH * 0.92);
            const x = i * slotW + (slotW - bw) / 2;
            const y = CH - bh;
            const col = empty ? EMPTY_COL : i === todayIdx ? mm.colors.skyDeep : mm.colors.skyCore;
            return <SvgRect key={'wb' + i} x={x} y={y} width={bw} height={bh} rx={2.5} fill={col} opacity={empty ? 1 : i === todayIdx ? 1 : 0.55} />;
          })}
          {MON.slice(0, N).map((d, i) => (
            <SvgText key={'wl' + i} x={i * slotW + slotW / 2} y={H - 2}
              textAnchor="middle" fontSize={9}
              fontWeight={i === todayIdx ? '700' : '500'}
              fill={i === todayIdx ? mm.colors.skyDeep : 'rgba(120,110,160,0.6)'}>
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
    <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('EnergyDetail', { type: 'activity' })}>
      <Card style={{ padding: theme.space.cardPadCompact }}>
        <Text style={styles.profTitle}>运动恢复</Text>
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
  const H = 80;
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
}: {
  options: string[];
  activeIndex: number;
  onChange: (i: number) => void;
  tone?: 'lav' | 'cy';
}) {
  // v16 §1.7：所有胶囊选中态统一黄绿（soft 底 + deep 字），不再分 lavender/cyan（tone 仅为兼容保留）
  const pair = { bg: mm.colors.limeSoft, fg: mm.colors.limeDeep };
  return (
    <View style={styles.underlineWrap}>
      {options.map((label, i) => {
        const isActive = i === activeIndex;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(i)}
            style={[styles.underlineBtn, isActive && { backgroundColor: pair.bg }]}
          >
            <Text
              style={[styles.underlineLabel, isActive && { color: pair.fg, fontWeight: theme.weight.semibold }]}
            >
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
  masonry: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp(2.5) },
  masonryCol: { flex: 1, gap: theme.sp(2.5) },
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
    backgroundColor: theme.colors.ui.white55,
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

  // v16 统一 tab 样式：未选 = 中性灰浅底（原透明），选中 limeSoft 由组件内注入
  underlineWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(1) },
  underlineBtn: {
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1.25),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.btnBusyBg,
  },
  underlineLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: mm.colors.inkSoft },

});
