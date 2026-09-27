/**
 * EmotionCognitiveDetailScreen —— 身体恢复详情页（与情绪/脑力消耗详情页统一骨架）
 *
 * 结构：返回头 → Hero(周期标题) → RangeSwitch(日/周/月/年) → DateAnchorPicker → InsightBanner(AI综合) → 内容
 *   · 日：锚定日的全天看板（皮质醇全天趋势 + 情绪/脑力/睡眠摘要 + 相比前一天），与之前一致
 *   · 周/月/年：区间内逐日聚合（均值 + 对比上一等长周期），皮质醇用窗口样本做 cosinor 拟合
 *
 * 时间选择器与 EnergyDetailScreen / MetricDetail / SleepDetail 等完全一致（复用 RangeSwitch + DateAnchorPicker）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import Svg, { Polyline } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import Card from '../components/Card';
import CortisolDailyChart, { buildRhythmInsights } from '../components/CortisolDailyChart';
import { useAiInsight } from '../hooks/useAiInsight';
import { useDebouncedHealthStoreRefresh, useEnsureDerivedMetrics } from '../hooks/useHealthStore';
import { buildRecoveryFallbackRows, resolveInsightRows } from '../ai/insight';
import InsightBanner from '../components/InsightBanner';
import ChatSheet from '../components/ChatSheet';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { collectSamples, collectSamplesForDay, collectSamplesForRange } from '../components/CortisolRhythmCard';
import { analyzeCortisol, type CortisolSample, type RhythmLevel } from '../lib/cortisolRhythm';
import { type RangeKey } from '../data/metrics';
import { type StressReport } from '../lib/stressAlgorithm';
import { type CognitiveLoadReport } from '../lib/cognitiveLoad';
import { reportNowMsForDay, reportNowMsForPrevDay } from '../lib/dayAnchor';
import { computeSleepLoad, SLEEP_LOAD_LABEL, type SleepLoadDay } from '../lib/sleepLoad';
import { formatSleepClockText, isLateBedtime } from '../lib/sleepTime';

const DAY_MS = 86400000;

interface DayData {
  D: Date;
  prevD: Date;
  stress: StressReport;
  stressPrev: StressReport;
  cog: CognitiveLoadReport;
  cogPrev: CognitiveLoadReport;
  sl: SleepSummary | null;
  slPrev: SleepSummary | null;
}

type RangeAgg = {
  days: number;
  emotionLoad: number | null;
  eventsPerDay: number | null;
  recoverySec: number | null;
  cogLoad: number | null;
  cogRecovery: number | null; // 百分比
  sleepLoad: number | null;
  sleepScore: number | null;
  cortisolMesor: number | null;
  cortisolPeakH: number | null;
  cortisolCss: number | null;
  cortisolStatus: RhythmLevel | null;
  cortisolDaily: { date: string; mesor: number }[];
};

/** 区间内逐日采样点（周/月按天；年按月度抽样，控制开销） */
function eachDayInWindow(range: RangeKey, anchor: Date): Date[] {
  const out: Date[] = [];
  const push = (offset: number, unit: 'day' | 'month') => {
    const d = new Date(anchor);
    if (unit === 'day') d.setDate(d.getDate() - offset);
    else d.setMonth(d.getMonth() - offset);
    d.setHours(0, 0, 0, 0);
    out.push(d);
  };
  if (range === 'week') for (let i = 6; i >= 0; i--) push(i, 'day');
  else if (range === 'month') for (let i = 29; i >= 0; i--) push(i, 'day');
  else if (range === 'year') for (let i = 11; i >= 0; i--) push(i, 'month');
  return out;
}

function prevAnchor(range: RangeKey, anchor: Date): Date {
  const p = new Date(anchor);
  if (range === 'week') p.setDate(p.getDate() - 7);
  else if (range === 'month') p.setDate(p.getDate() - 30);
  else if (range === 'year') p.setFullYear(p.getFullYear() - 1);
  return p;
}

const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** 某日（含）往前 14 天窗口的睡眠记录（升序，末项=该日）——日视图与区间聚合共用同一口径 */
function sleepWindowEndingAt(dayMs: number): SleepLoadDay[] {
  const recs: SleepLoadDay[] = [];
  for (let i = 13; i >= 0; i--) {
    const s = healthStore.getSleep(dayKey(dayMs - i * 86400000));
    if (s && s.total > 0) {
      recs.push({ total: s.total, deep: s.deep, rem: s.rem, awake: s.awake, getUp: s.getUp, sleepTime: s.sleepTime });
    }
  }
  return recs;
}

/** 对一段日期数组逐日取值后聚合为单个 RangeAgg（周/月/单月均走这里） */
function aggregateOverDays(days: Date[]): RangeAgg {
  const { computeStressReport } = require('../lib/stressAlgorithm');
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  // ★ 逐日报告必须传「该日锚点→nowMs」（历史日=当日 23:59:59.999）；传零点会得到空区间
  const stresses = days.map((d) => computeStressReport(reportNowMsForDay(d.getTime())));
  const cogs = days.map((d) => computeCognitiveLoadReport(reportNowMsForDay(d.getTime())));
  const sleeps = days.map((d) => healthStore.getSleep(dayKey(d.getTime())));

  const startMs = days[days.length - 1].getTime();
  const endMs = days[0].getTime() + DAY_MS - 1;
  const samples: CortisolSample[] = collectSamplesForRange(startMs, endMs);
  const r = samples.length >= 4 ? analyzeCortisol(samples, days.length) : null;
  const cos = r?.cosinor;

  return {
    days: days.length,
    emotionLoad: mean(stresses.map((s) => s.emotionalLoad)),
    eventsPerDay: mean(stresses.map((s) => s.events.length)),
    recoverySec: mean(stresses.map((s) => s.avgRecoverySec)),
    cogLoad: mean(cogs.map((c) => c.loadScore)),
    cogRecovery: mean(cogs.map((c) => (c.recoveryCapacity != null ? c.recoveryCapacity * 100 : null))),
    // 睡眠负载：逐日以「该日往前 14 天」为窗口计算（与日视图 SleepCard 同口径）
    sleepLoad: mean(
      days.map((d) => {
        const recs = sleepWindowEndingAt(d.getTime());
        return recs.length ? computeSleepLoad(recs).load : null;
      })
    ),
    sleepScore: mean(sleeps.map((s) => (s && s.score != null ? s.score : null))),
    cortisolMesor: r && cos && Number.isFinite(cos.mesor) ? cos.mesor : null,
    cortisolPeakH: r && cos && Number.isFinite(cos.acrophaseH) ? cos.acrophaseH : null,
    cortisolCss: r ? r.css : null,
    cortisolStatus: r ? r.status.level : null,
    cortisolDaily: r ? r.dailyMesors : [],
  };
}

/** 返回某自然月的全部天数（0 点），用于年视图"逐月聚合" */
function daysInMonth(monthStart: Date): Date[] {
  const out: Date[] = [];
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const count = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= count; d++) {
    const date = new Date(y, m, d);
    date.setHours(0, 0, 0, 0);
    out.push(date);
  }
  return out;
}

/** 把若干（月度）RangeAgg 再 mean 一次 = "年是月的平均" */
function averageRangeAggs(monthly: RangeAgg[]): RangeAgg {
  const numMean = (sel: (a: RangeAgg) => number | null): number | null => mean(monthly.map(sel));
  // cortisolStatus：取有值的最后一个（多数语义近似），无则 null
  let status: RhythmLevel | null = null;
  for (const a of monthly) if (a.cortisolStatus != null) status = a.cortisolStatus;
  // days：UI 未强依赖精确值，取各月天数均值（代表"平均每月天数"）
  const daysAvg = monthly.length ? monthly.reduce((s, a) => s + a.days, 0) / monthly.length : 0;
  return {
    days: Math.round(daysAvg),
    emotionLoad: numMean((a) => a.emotionLoad),
    eventsPerDay: numMean((a) => a.eventsPerDay),
    recoverySec: numMean((a) => a.recoverySec),
    cogLoad: numMean((a) => a.cogLoad),
    cogRecovery: numMean((a) => a.cogRecovery),
    sleepLoad: numMean((a) => a.sleepLoad),
    sleepScore: numMean((a) => a.sleepScore),
    cortisolMesor: numMean((a) => a.cortisolMesor),
    cortisolPeakH: numMean((a) => a.cortisolPeakH),
    cortisolCss: numMean((a) => a.cortisolCss),
    cortisolStatus: status,
    // 年视图的每日 mesor 序列对"按月均值"语义无明确意义，置空数组（RangeView 已有空数组兜底）
    cortisolDaily: [],
  };
}

/** 区间聚合入口：周/月=逐日均值；年=12 个自然月各自月均后再均值 */
function aggregate(range: RangeKey, anchor: Date): RangeAgg {
  if (range === 'year') {
    const months = eachDayInWindow('year', anchor);
    return averageRangeAggs(months.map((m) => aggregateOverDays(daysInMonth(m))));
  }
  return aggregateOverDays(eachDayInWindow(range, anchor));
}

function periodLabel(range: RangeKey, anchor: Date): string {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const d = anchor.getDate();
  if (range === 'day') return `${m}月${d}日`;
  if (range === 'year') return `${y}年`;
  if (range === 'month') return `${y}年${m}月`;
  // week
  const s = new Date(anchor);
  s.setDate(s.getDate() - 6);
  return `${s.getMonth() + 1}/${s.getDate()} – ${m}/${d}`;
}

function fmtDelta(v: number | null, digits = 0): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
}

export default function EmotionCognitiveDetailScreen() {
  const navigation = useNavigation<any>();
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // ── 防抖订阅 healthStore：实时/回填数据到达后约 700ms 刷新一次本页（而非每个样本重渲染），
  //    既修复「今日趋势要退出重进才出」，又避免实时流高频写把主线程压满导致返回键点不动 ──
  const refreshKey = useDebouncedHealthStoreRefresh(700);
  // ── 回填派生指标（eda/cortisol…）intraday：修复「历史皮质醇数据没有」──
  useEnsureDerivedMetrics(30);

  // ── 日视图：锚定日 + 前一天 ──
  const dayData = useMemo(() => {
    const D = new Date(anchor);
    D.setHours(0, 0, 0, 0);
    const prevD = new Date(D.getTime() - DAY_MS);
    const { computeStressReport } = require('../lib/stressAlgorithm');
    const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
    // ★ 必须传「日锚点→报告 nowMs」（今天=此刻 / 历史日=23:59:59.999）。
    //   早前传 D.getTime()（零点）会让 getTimeRange 退化成 [零点,零点] 空区间 → 情绪消耗恒为 0 次 / —。
    const nowMs = reportNowMsForDay(anchor.getTime());
    const prevNowMs = reportNowMsForPrevDay(anchor.getTime());
    const stress = computeStressReport(nowMs);
    const stressPrev = computeStressReport(prevNowMs);
    const cog = computeCognitiveLoadReport(nowMs);
    const cogPrev = computeCognitiveLoadReport(prevNowMs);
    const sl = healthStore.getSleep(dayKey(D.getTime()));
    const slPrev = healthStore.getSleep(dayKey(prevD.getTime()));
    return { D, prevD, stress, stressPrev, cog, cogPrev, sl, slPrev };
    // 依赖 refreshKey：数据到达约 700ms 后重新 computeStressReport（其内部门缓存按版本失效），情绪消耗卡刷新
  }, [anchor, refreshKey]);

  // ── 区间视图：聚合 + 对比上一周期 ──
  const rangeData = useMemo(() => {
    if (range === 'day') return null;
    const cur = aggregate(range, anchor);
    const prev = aggregate(range, prevAnchor(range, anchor));
    return { cur, prev };
  }, [range, anchor]);

  // ── 返回头/大字：今日皮质醇节律结论（固定=今天，与当前 anchor/range 选择无关） ──
  const todayRhythm = useMemo(() => {
    const r = analyzeCortisol(collectSamples(), 14);
    return { level: r.todayLevel, firstInsight: buildRhythmInsights(r, true)[0] ?? '' };
    // 依赖 refreshKey：回填/实时皮质醇到达后，顶部「今日皮质醇节律」大字与节律卡同步刷新
  }, [refreshKey]);
  /**
   * 节律结论文案。颜色不再按状态区分——统一走主题 `textTitle`，
   * 与情绪/脑力消耗详情页的 Hero 大字保持一致（形态异常另由节律卡的色块/日历承担）。
   */
  const RHYTHM_LABEL: Record<'normal' | 'high' | 'dysregulated', string> = {
    normal: '节律正常',
    high: '皮质醇偏高',
    dysregulated: '节律紊乱',
  };
  const todayRhythmLabel = RHYTHM_LABEL[todayRhythm.level];

  // ── AI 综合分析 ──
  // ★ 真实端侧大模型（MiraAI · Qwen2.5-1.5B）：与洞察页同通道（ai/insight.ts 'recovery' kind），
  //   输出分点行 tone|标题|正文（皮质醇节律→情绪→脑力→睡眠），带落盘缓存与静默降级。
  //   ★ 跟随锚定日：历史日按「该日事实串」生成（aiDayArg=该日 dk），不再固定用今天的数据。
  const anchorDk = dayKey(anchor.getTime());
  const aiDayArg = anchorDk === dayKey(Date.now()) ? undefined : anchorDk;
  const aiRecovery = useAiInsight('recovery', aiDayArg);

  // 「查看更多分析」→ 拉起端侧聊天，带入今日皮质醇追问
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = (question: string) => {
    setChatQuestion(question);
    setChatVisible(true);
  };

  /** 规则兜底：与 AI 行同构的 2 点分点（异常数据分析 + 今日建议），全区间一致、不铺陈。 */
  const aiFallbackRows = useMemo<SummaryRow[]>(() => {
    const parts: string[] = [];
    const titles: string[] = [];

    if (range === 'day') {
      const { D } = dayData;
      const isToday = dayKey(D.getTime()) === dayKey(Date.now());
      // 今日：直接复用与洞察页共用的兜底（首行=皮质醇节律 + 今日建议，2 点）
      if (isToday) return buildRecoveryFallbackRows() as SummaryRow[];
      // 历史日：无 14 天基线，偏高不可信，只看当日曲线形态 + 情绪/脑力
      const rSamples = collectSamplesForDay(dayKey(D.getTime()));
      if (rSamples.length >= 4) {
        const rr = analyzeCortisol(rSamples, 1);
        if (rr.today.dys || rr.today.high) {
          parts.push(rr.today.dys ? '当日皮质醇节律紊乱' : '当日皮质醇节律偏高');
          titles.push('代谢');
        }
      }
      if (dayData.stress?.emotionalLoad != null && dayData.stress.emotionalLoad >= 70) {
        parts.push('当日情绪消耗偏高');
        titles.push('情绪压力');
      }
      if (dayData.cog?.loadLevel === 'heavy') {
        parts.push('当日脑力负荷偏高');
        titles.push('情绪压力');
      }
    } else if (rangeData) {
      const { cur } = rangeData;
      const st = cur.cortisolStatus;
      if (st && st !== 'normal') {
        parts.push(st === 'dysregulated' ? '区间内皮质醇节律紊乱' : '区间内皮质醇持续偏高');
        titles.push('代谢');
      }
      if (cur.sleepScore != null && cur.sleepScore < 70) {
        parts.push('平均睡眠评分偏低');
        titles.push('睡眠');
      }
      if (cur.emotionLoad != null && cur.emotionLoad >= 70) {
        parts.push('平均情绪消耗偏高');
        titles.push('情绪压力');
      }
      if (cur.cogLoad != null && cur.cogLoad >= 70) {
        parts.push('平均脑力负荷偏高');
        titles.push('情绪压力');
      }
    }

    const PRIORITY = ['代谢', '睡眠', '情绪压力', '恢复'];
    const verdictMap: Record<string, string> = {
      代谢: '压力与恢复偏弱，注意休息。',
      睡眠: '修复不够充分，今晚早点补觉。',
      情绪压力: '主动减压，留点放松时间。',
      恢复: '恢复力不足，今天多休息。',
    };
    let anomaly: SummaryRow;
    if (!parts.length) {
      anomaly = { tone: 'good', title: '异常数据分析', body: '该区间各项指标都在正常范围内，整体平稳。' };
    } else {
      const top = PRIORITY.find((t) => titles.includes(t)) ?? '代谢';
      anomaly = {
        tone: 'warn',
        title: '异常数据分析',
        body: parts.slice(0, 3).join('、') + '，' + (verdictMap[top] ?? '注意调整恢复。'),
      };
    }
    const advice: SummaryRow = {
      tone: parts.length ? 'warn' : 'good',
      title: '今日建议',
      body: parts.length ? '保持规律作息，关注最突出的异常项。' : '状态平稳，保持现在的节奏即可。',
    };
    return [anomaly, advice];
  }, [range, dayData, rangeData, anchor, todayRhythm]);

  /**
   * 「AI 综合分析」最终展示行。
   *  - day：走 resolveInsightRows —— AI 行不满足质量门禁（<3 行 / 有超长行 / 首行不是皮质醇节律）
   *    时**整段回落**规则分点，满足时与规则分点合流。这样无论如何都是分点、首行都是皮质醇节律。
   *  - 周/月/年：AI 只产出「今日」视角的 recovery 分析，与区间聚合口径不符，直接用区间规则分点。
   */
  const aiBannerRows = useMemo<SummaryRow[]>(
    // 历史日：把该日 dk 传进去，规则兜底也按该日（AI 行同样来自该日事实）
    () => (range === 'day' ? resolveInsightRows('recovery', aiRecovery.rows, aiDayArg) : aiFallbackRows),
    // 依赖 text（字符串，身份稳定）而非 rows（每次渲染新数组），避免每帧重算 14 天节律
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, aiRecovery.text, aiFallbackRows, aiDayArg]
  );

  return (
    <>
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        {/* 返回头 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>身体恢复</Text>
            {/* ★ 副标题：与情绪/脑力消耗详情页同结构（标题 + 副标题） */}
            <Text style={styles.sub}>今日皮质醇节律 · 睡眠恢复</Text>
          </View>
        </View>

        {/* 当日皮质醇节律结论（大字，仅日视图显示；周/月/年为区间聚合，无"今日"概念）
            ★ 颜色/字重与情绪/脑力消耗详情页 Hero 完全一致：fontSize.hero + medium + textTitle */}
        {range === 'day' && (
          <View style={styles.rhythmHero}>
            <Text style={styles.rhythmHeroVal}>{todayRhythmLabel}</Text>
          </View>
        )}
        {/* ★ 统一选择器：日/周/月/年 + 日期步进器（与情绪/脑力消耗详情页一致） */}
        <RangeSwitch value={range} onChange={setRange} />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* AI 综合分析（真实端侧 MiraAI 分点行；生成中 pending 提示，不合格/失败回落规则分点） */}
        <InsightBanner
          rows={aiBannerRows}
          pending={aiRecovery.loading}
          onMore={() => openChat('帮我详细分析今天的皮质醇节律')}
        />

        {/* ── 内容 ── */}
        {range === 'day' ? (
          <DayView data={dayData} anchorDayMs={anchor.getTime()} />
        ) : rangeData ? (
          <RangeView cur={rangeData.cur} prev={rangeData.prev} range={range} anchor={anchor} />
        ) : null}
      </View>
    </ScreenContainer>
    </View>
    <ChatSheet
      visible={chatVisible}
      onClose={() => setChatVisible(false)}
      initialQuestion={chatQuestion}
    />
    </>
  );
}




/** 指标小卡：label + 大数值 + 迷你对比箭头 */
function MetricMini({ label, value, unit, todayN, prevN, goodWhen, noCompare, showHour }: {
  label: string;
  value: string;
  unit?: string;
  todayN?: number | null;
  prevN?: number | null;
  goodWhen?: 'up' | 'down';
  noCompare?: boolean;
  showHour?: boolean;
}) {
  return (
    <View style={{ flex: 1, paddingVertical: theme.sp(1.5), paddingHorizontal: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, alignItems: 'center' }}>
      <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>{label}</Text>
      <Text style={{ fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold, color: theme.colors.textTitle }}>
        {value}{unit ? <Text style={{ fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular, color: theme.colors.textSub }}>{unit}</Text> : null}
      </Text>
      {!noCompare && todayN != null && prevN != null && todayN !== prevN ? (
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          相比昨天 {(() => {
            const diff = showHour ? (todayN - prevN) / 60 : todayN - prevN;
            const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
            const v = showHour ? (Math.abs(diff) >= 1 ? `${Math.abs(diff).toFixed(0)}h` : `${Math.abs((todayN - prevN) % 60)}m`) : Math.abs(diff).toFixed(0);
            return `${arrow} ${v}`;
          })()}
        </Text>
      ) : !noCompare ? (
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>相比昨天 —</Text>
      ) : null}
    </View>
  );
}

/** 迷你对比行：today vs prev 一句话 */
function CompareMini({ today, prev, label, goodWhen }: { today: string; prev: string; label: string; goodWhen: 'up' | 'down' }) {
  if (today === prev || today === '—' || prev === '—') return null;
  return (
    <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) }}>
      相比前一天 {label} {today} {(() => {
        const t = parseFloat(today), p = parseFloat(prev);
        if (isNaN(t) || isNaN(p)) return '';
        const diff = t - p;
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
        const good = goodWhen === 'up' ? diff > 0 : diff < 0;
        return arrow ? `${arrow} ${Math.abs(diff).toFixed(0)}` : '';
      })()}
    </Text>
  );
}

/** 睡眠摘要（内嵌版，用于三卡并排） */
function SleepSummaryInline({ sl }: { sl: SleepSummary | null }) {
  if (!sl) return <SumCell label="睡眠" value="—" sub="无数据" />;
  const total = sl.total ?? 0;
  const deep = sl.deep ?? 0;
  const score = sl.score;
  const clock = formatSleepClockText(sl.sleepTime ?? '', sl.wakeTime ?? '');
  return (
    <>
      <SumCell label="睡眠时长" value={total > 0 ? `${Math.floor(total / 60)}h ${total % 60}m` : '—'} sub={deep > 0 ? `深睡 ${Math.round((deep / total) * 100)}%` : ''} />
      <SumCell label="睡眠评分" value={score != null ? String(score) : '—'} sub={`${clock.bed ?? "—"} 入睡`} />
    </>
  );
}

/** 日视图：锚定日全天看板 */
function DayView({ data, anchorDayMs }: { data: DayData; anchorDayMs: number }) {
  const { D, prevD, stress: s, stressPrev: sP, cog: g, cogPrev: gP, sl, slPrev } = data;
  const debt = computeSleepLoad(sleepWindowEndingAt(anchorDayMs)).debtH;
  const debtPrev = computeSleepLoad(sleepWindowEndingAt(prevD.getTime())).debtH;
  return (
    <>
      <CortisolDailyChart anchorDayMs={anchorDayMs} showStatusChip={false} showInsights={false} />

      {/* 三张摘要卡（外大卡纵向，内小卡横向各含对比） */}
      <View style={{ gap: theme.sp(1), marginTop: theme.sp(2) }}>
        {/* 情绪消耗摘要 */}
        <Card padded={false}>
          <View style={{ padding: theme.sp(3) }}>
            <Text style={[styles.cardTitle, { fontSize: theme.fontSize.card, marginBottom: theme.sp(1.5) }]}>情绪消耗摘要</Text>
            <View style={{ flexDirection: 'row', gap: theme.sp(1) }}>
              <MetricMini label="压力事件" value={`${s.events.length}`} todayN={s.events.length} prevN={sP.events.length} unit="次" goodWhen="down" />
              <MetricMini label="恢复时长" value={s.avgRecoverySec != null ? `${s.avgRecoverySec}` : '—'} todayN={s.avgRecoverySec} prevN={sP.avgRecoverySec} unit="s" goodWhen="down" />
              <MetricMini label="峰值时段" value={s.peakHour != null ? `${String(Math.floor(s.peakHour)).padStart(2, '0')}:00` : '—'} noCompare />
            </View>
          </View>
        </Card>

        {/* 脑力消耗摘要 — v2: 脑力值 / 专注力 / 决策力 + 预测峰谷 */}
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={[styles.cardTitle, { fontSize: theme.fontSize.card, marginBottom: theme.sp(1.5) }]}>疲劳摘要</Text>
            {/* Row 1: 当下能力 */}
            <View style={styles.metricRow}>
              <MetricMini label="节律能量" value={g.mentalEnergy != null ? (g.mentalEnergy >= 65 ? '高' : g.mentalEnergy >= 40 ? '中' : '低') : '—'} noCompare />
              <MetricMini label="专注力" value={g.focusScore != null ? String(g.focusScore) : '—'} todayN={g.focusScore} prevN={gP.focusScore} goodWhen="up" />
              <MetricMini label="决策力" value={g.decisionScore != null ? String(g.decisionScore) : '—'} todayN={g.decisionScore} prevN={gP.decisionScore} goodWhen="up" />
            </View>
            {/* Row 2: 预测峰谷 + 脑力负荷 */}
            <View style={[styles.metricRow, { marginTop: theme.sp(1.5) }]}>
              <MetricMini
                label="峰值预测"
                value={g.forecast?.peak
                  ? `${String(g.forecast.peak.hour).padStart(2, '0')}:00 · ${g.forecast.peak.energy}`
                  : '—'}
                noCompare
              />
              <MetricMini
                label="低谷预测"
                value={g.forecast?.trough
                  ? `${String(g.forecast.trough.hour).padStart(2, '0')}:00 · ${g.forecast.trough.energy}`
                  : '—'}
                noCompare
              />
              <MetricMini label="认知负荷" value={g.loadScore != null ? ((() => {
  const ll = g.loadLevel;
  if (ll === 'rested' || ll === 'light') return '低';
  if (ll === 'moderate') return '中';
  if (ll === 'heavy') return '高';
  return g.loadScore < 40 ? '低' : g.loadScore < 65 ? '中' : '高';
})()) : '—'} noCompare />
            </View>
          </View>
        </Card>

        {/* 睡眠恢复摘要 */}
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={[styles.cardTitle, { fontSize: theme.fontSize.card, marginBottom: theme.sp(1.5) }]}>睡眠恢复摘要</Text>
            <View style={styles.metricRow}>
              <MetricMini label="睡眠负债" value={debt > 0 ? `${debt.toFixed(1)}` : '0.0'} todayN={debt > 0 ? Math.round(debt * 10) / 10 : 0} prevN={debtPrev > 0 ? Math.round(debtPrev * 10) / 10 : 0} unit="h" goodWhen="down" />
              <MetricMini label="睡眠恢复度" value={sl?.score != null ? String(sl.score) : '—'} todayN={sl?.score ?? null} prevN={slPrev?.score ?? null} goodWhen="up" />
              <MetricMini label="睡眠时长" value={sl && sl.total ? `${(sl.total / 60).toFixed(1)}h` : '—'} todayN={sl ? Math.round(sl.total / 60 * 10) / 10 : null} prevN={slPrev ? Math.round(slPrev.total / 60 * 10) / 10 : null} unit="h" goodWhen="up" />
            </View>
          </View>
        </Card>
      </View>
    </>
  );
}

// ── 节律日历：单日异常判定（dys 形态异常；今日额外含偏高）。模块级缓存，年视图 365 天只算一次 ──
const dayAbnormalCache = new Map<string, boolean>();
function dayAbnormal(dk: string, isToday: boolean): boolean {
  const key = `${dk}|${isToday}`;
  const hit = dayAbnormalCache.get(key);
  if (hit != null) return hit;
  let v = false;
  const samples = collectSamplesForDay(dk);
  if (samples.length >= 4) {
    const r = analyzeCortisol(samples, isToday ? 14 : 1);
    v = r.today.dys || (isToday && r.today.high);
  }
  dayAbnormalCache.set(key, v);
  return v;
}

/**
 * v18.21 节律日历配色（对齐设计规范语义）：
 *   正常日 = limeSoft 底 + limeDeep 字（App「好状态」语言，与 tab 选中同源）；
 *   异常日 = danger 柔和底 + danger 字（危险语义，不再借用首页圆环粉）；
 *   紫(accentSolid) 只留给「今日」描边——与皮质醇主曲线/认知环同源，不再大面积铺紫。
 */
const CAL_COLOR = {
  normal: { bg: mm.colors.limeSoft, text: mm.colors.limeDeep },
  abn: { bg: theme.colors.danger + '2E', text: theme.colors.danger },
};

type CalCell = { key: string; label: string; abn: boolean; isToday: boolean };
type CalData = { mode: 'year' | 'days'; head?: string[]; rows: CalCell[][] };
/** AI 综合分析分点行（AI 生成行与规则兜底行同构，均由 InsightBanner rows 渲染） */
type SummaryRow = { tone: 'good' | 'warn' | 'neutral'; title: string; body: string };

/** 周/月：按天 7 列日历；年：12 月格。正常=limeSoft，异常=danger 柔和底（v18.21 语义色规范） */
function RhythmCalendar({ range, anchor }: { range: RangeKey; anchor: Date }) {
  const data = useMemo<CalData | null>(() => {
    const todayDk = dayKey(Date.now());
    if (range === 'year') {
      const cells: CalCell[] = eachDayInWindow('year', anchor).map((m) => {
        const days = daysInMonth(m);
        const abnCount = days.filter((d) => {
          const dk = dayKey(d.getTime());
          return dayAbnormal(dk, dk === todayDk);
        }).length;
        return {
          key: `${m.getFullYear()}-${m.getMonth() + 1}`,
          label: `${m.getMonth() + 1}月`,
          abn: days.length > 0 && abnCount / days.length >= 0.3,
          isToday: false,
        };
      });
      const rows: CalCell[][] = [];
      for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4));
      return { mode: 'year', rows };
    }
    if (range === 'week' || range === 'month') {
      const days = eachDayInWindow(range, anchor);
      // 7 列顺序填充，列对齐星期；表头取窗口首日所在星期起
      const head = Array.from({ length: 7 }, (_, j) => '日一二三四五六'[new Date(days[0].getTime() + j * DAY_MS).getDay()]);
      const rows: CalCell[][] = [];
      for (let i = 0; i < days.length; i += 7) {
        rows.push(days.slice(i, i + 7).map((d) => {
          const dk = dayKey(d.getTime());
          return { key: dk, label: String(d.getDate()), abn: dayAbnormal(dk, dk === todayDk), isToday: dk === todayDk };
        }));
      }
      return { mode: 'days', head, rows };
    }
    return null;
  }, [range, anchor]);

  if (!data) return null;
  const perRow = data.mode === 'year' ? 4 : 7;

  return (
    <Card padded={false}>
      <View style={styles.pad}>
        <View style={styles.calTitleRow}>
          <Text style={styles.cardTitle}>{data.mode === 'year' ? '月度节律' : '节律日历'}</Text>
          <View style={styles.calLegendRow}>
            <View style={styles.calLegendItem}>
              <View style={[styles.calLegendSwatch, { backgroundColor: CAL_COLOR.abn.bg }]} />
              <Text style={[styles.calLegendText, { color: CAL_COLOR.abn.text }]}>{data.mode === 'year' ? '异常偏多' : '异常'}</Text>
            </View>
            <View style={styles.calLegendItem}>
              <View style={[styles.calLegendSwatch, { backgroundColor: CAL_COLOR.normal.bg }]} />
              <Text style={[styles.calLegendText, { color: CAL_COLOR.normal.text }]}>正常</Text>
            </View>
          </View>
        </View>
        {data.head && (
          <View style={styles.calRow}>
            {data.head.map((w, i) => (
              <Text key={`h${i}`} style={styles.calHeadText}>{w}</Text>
            ))}
          </View>
        )}
        {data.rows.map((row, ri) => (
          <View key={ri} style={styles.calRow}>
            {row.map((c) => (
              <View
                key={c.key}
                style={[
                  data.mode === 'year' ? styles.calMonthCell : styles.calCell,
                  { backgroundColor: c.abn ? CAL_COLOR.abn.bg : CAL_COLOR.normal.bg },
                  c.isToday && styles.calCellToday,
                ]}
              >
                <Text style={[styles.calCellText, { color: c.abn ? CAL_COLOR.abn.text : CAL_COLOR.normal.text }]}>
                  {c.label}
                </Text>
              </View>
            ))}
            {Array.from({ length: perRow - row.length }).map((_, i) => (
              <View key={`e${ri}-${i}`} style={styles.calCellEmpty} />
            ))}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** 区间视图：聚合均值 + 对比上一周期 */
function RangeView({ cur, prev, range, anchor }: { cur: RangeAgg; prev: RangeAgg; range: RangeKey; anchor: Date }) {
  const levelMeta: Record<RhythmLevel, { label: string; color: string }> = {
    normal: { label: '节律正常', color: mm.colors.limeDeep },
    sustained_high: { label: '持续偏高', color: theme.colors.danger },
    dysregulated: { label: '节律紊乱', color: mm.colors.honeyDeep },
  };
  const cMeta = cur.cortisolStatus ? levelMeta[cur.cortisolStatus] : null;
  return (
    <>
      {/* 节律日历（周/月=按天，年=按月；异常=粉，正常=淡紫） */}
      <RhythmCalendar range={range} anchor={anchor} />

      {/* 皮质醇区间聚合 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>皮质醇 · {periodLabel(range, anchor)}</Text>
          {cMeta && (
            <View style={[styles.levelChip, { backgroundColor: cMeta.color + '22', alignSelf: 'flex-start', marginBottom: theme.sp(2) }]}>
              <View style={[styles.levelDot, { backgroundColor: cMeta.color }]} />
              <Text style={[styles.levelText, { color: cMeta.color }]}>{cMeta.label}</Text>
            </View>
          )}
          <View style={styles.summaryGrid}>
            <SumCell label="平均压力水平" value={cur.cortisolMesor != null ? cur.cortisolMesor.toFixed(1) : '—'} sub="区间日均值" />
            <SumCell label="平均峰值时刻" value={cur.cortisolPeakH != null ? `${String(Math.round(cur.cortisolPeakH)).padStart(2, '0')}:00` : '—'} sub={cur.cortisolPeakH != null ? (cur.cortisolPeakH >= 6 && cur.cortisolPeakH <= 11 ? '正常 06–11' : cur.cortisolPeakH < 6 ? '过早' : '偏晚') : '—'} />
          </View>
          <MesorSparkline data={cur.cortisolDaily} />
        </View>
      </Card>

      {/* 情绪消耗区间聚合 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>情绪消耗 · 区间均值</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="平均情绪消耗" value={cur.emotionLoad != null ? `${cur.emotionLoad.toFixed(0)}/100` : '—'} sub={prev.emotionLoad != null && cur.emotionLoad != null ? `上期 ${fmtDelta(cur.emotionLoad - prev.emotionLoad)}` : '对比上一周期'} />
            <SumCell label="日均压力事件" value={cur.eventsPerDay != null ? `${cur.eventsPerDay.toFixed(1)} 次` : '—'} sub={prev.eventsPerDay != null && cur.eventsPerDay != null ? `上期 ${fmtDelta(cur.eventsPerDay - prev.eventsPerDay, 1)}` : '对比上一周期'} />
          </View>
          <View style={[styles.summaryGrid, { marginTop: theme.sp(1) }]}>
            <SumCell label="平均恢复" value={cur.recoverySec != null ? `${cur.recoverySec.toFixed(0)}s` : '—'} sub={prev.recoverySec != null && cur.recoverySec != null ? `上期 ${fmtDelta(cur.recoverySec - prev.recoverySec)}s` : '对比上一周期'} />
          </View>
        </View>
      </Card>

      {/* 脑力消耗区间聚合 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>脑力消耗 · 区间均值</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="平均疲劳度" value={cur.cogLoad != null ? `${cur.cogLoad.toFixed(0)}/100` : '—'} sub={prev.cogLoad != null && cur.cogLoad != null ? `上期 ${fmtDelta(cur.cogLoad - prev.cogLoad)}` : '对比上一周期'} />
            <SumCell label="平均恢复能力" value={cur.cogRecovery != null ? `${cur.cogRecovery.toFixed(0)}%` : '—'} sub={prev.cogRecovery != null && cur.cogRecovery != null ? `上期 ${fmtDelta(cur.cogRecovery - prev.cogRecovery)}%` : '对比上一周期'} />
          </View>
        </View>
      </Card>

      {/* 睡眠恢复区间聚合 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>睡眠恢复 · 区间均值</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="平均睡眠负载" value={cur.sleepLoad != null ? `${cur.sleepLoad.toFixed(0)}` : '—'} sub={prev.sleepLoad != null && cur.sleepLoad != null ? `上期 ${fmtDelta(cur.sleepLoad - prev.sleepLoad)}` : '对比上一周期'} />
            <SumCell label="平均睡眠评分" value={cur.sleepScore != null ? `${cur.sleepScore.toFixed(0)}` : '—'} sub={prev.sleepScore != null && cur.sleepScore != null ? `上期 ${fmtDelta(cur.sleepScore - prev.sleepScore)}` : '对比上一周期'} />
          </View>
        </View>
      </Card>
    </>
  );
}

/**
 * 睡眠恢复卡片（日视图）：**睡眠负载** + **恢复**。
 *  - 睡眠负载：参考成熟算法（WHOOP 睡眠债 / Apple 就寝一致性 / Oura Timing / Fitbit·Garmin 碎片化与阶段质量），
 *    见 `lib/sleepLoad.ts`；窗口 = 该日及此前共 14 天。越高越「欠账」。
 *  - 恢复：当晚睡眠质量分（`lib/sleepScore.ts`：时长达成 / 深睡结构 / 起夜）。
 *  - 晚睡归入「睡眠负载」（时机维度），不再和恢复分重复计分。
 */
function SleepCard({ sl, slPrev, anchorDayMs }: { sl: ReturnType<typeof healthStore.getSleep>; slPrev: ReturnType<typeof healthStore.getSleep>; anchorDayMs: number }) {
  // ★ hooks 不能放在下面 early-return 之后（hook 必须无条件调用）
  const load = useMemo(() => computeSleepLoad(sleepWindowEndingAt(anchorDayMs)), [anchorDayMs, sl]);

  if (!sl || sl.total <= 0) {
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>睡眠恢复摘要</Text>
          <Text style={styles.emptyHint}>该日无有效睡眠数据，继续佩戴戒指即可记录。</Text>
        </View>
      </Card>
    );
  }
  const totalH = sl.total / 60;
  const prevH = slPrev && slPrev.total > 0 ? slPrev.total / 60 : null;
  const scoreD = (sl.score ?? 0) - (slPrev?.score ?? 0);
  const scoreLabel =
    sl.score == null ? '—'
    : sl.score >= 90 ? '恢复优秀'
    : sl.score >= 80 ? '恢复良好'
    : sl.score >= 70 ? '恢复正常'
    : sl.score >= 55 ? '恢复偏慢'
    : '需改善';
  const debtTxt = load.debtH >= 0.1 ? ` · 欠 ${load.debtH.toFixed(1)}h` : '';
  // ★ 展示前归一为 "HH:mm" 并处理跨天（唯一实现见 lib/sleepTime.formatSleepClockText）：
  //   `healthStore.getSleep(dk).sleepTime` 存的是完整 datetime（真机实测 "2026-09-18 01:38"），
  //   旧代码直接插值 → 界面印出「入睡 2026-09-18 01:38 · 起床 2026-09-18 10:19」。
  //   23:05 入睡 → 次日 07:20 起床 时，起床侧显示「次日 07:20」，不再让人误以为是同一天早上。
  const clock = formatSleepClockText(sl.sleepTime, sl.wakeTime);
  return (
    <Card padded={false}>
      <View style={styles.pad}>
        <Text style={styles.cardTitle}>睡眠恢复摘要</Text>
        <View style={styles.summaryGrid}>
          <SumCell label="睡眠负载(0–100)" value={String(load.load)} sub={`${SLEEP_LOAD_LABEL[load.level]}${debtTxt}`} />
          <SumCell label="恢复" value={sl.score != null ? String(sl.score) : '—'} sub={scoreLabel} />
        </View>
        {(clock.bed || clock.wake) && (
          <Text style={styles.sleepMeta}>
            入睡 {clock.bed ?? '—'} · 起床 {clock.wake ?? '—'}{isLateBedtime(sl.sleepTime) ? ' · 偏晚' : ''} · 时长 {totalH.toFixed(1)}h
          </Text>
        )}
        <View style={styles.compareRow}>
          <View style={styles.compareCell}>
            <Text style={styles.compareLabel}>相比前一天</Text>
            <Text style={styles.compareValue}>
              {(() => {
                const parts: string[] = [];
                if (prevH != null && Math.abs(totalH - prevH) >= 0.1) {
                  parts.push(`时长${totalH > prevH ? '增' : '减'} ${Math.abs(totalH - prevH).toFixed(1)}h`);
                }
                if (sl.score != null && slPrev?.score != null && Math.abs(scoreD) >= 3) {
                  parts.push(`评分 ${scoreD >= 0 ? '+' : ''}${scoreD}`);
                }
                return parts.length > 0 ? parts.join(' ') : '基本持平';
              })()}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

/** 皮质醇日均值迷你折线 */
function MesorSparkline({ data }: { data: { date: string; mesor: number }[] }) {
  if (data.length < 2) return null;
  const w = 300, h = 56, pad = 6;
  const vals = data.map((d) => d.mesor);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.mesor - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <View style={{ marginTop: theme.sp(2) }}>
      <Text style={styles.sparkLabel}>区间每日均值</Text>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* v18.21：折线改 accentSolid——与皮质醇主曲线(#7C6AE0)/「当前进度」语义同源，不再借用认知疲劳的蜜色 */}
        <Polyline points={pts.join(' ')} fill="none" stroke={theme.colors.accentSolid} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

const pad = { padding: theme.space.cardPad };

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  // ★ 与情绪/脑力消耗详情页（EnergyDetailScreen）完全一致：标题 textTitle + 副标题 sub
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  rhythmHero: { marginTop: theme.sp(1), marginBottom: theme.sp(1) },
  // 大字结论：与另两页 Hero 同款（hero 字号 + medium + textTitle；不再用状态色）
  rhythmHeroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: mm.colors.ink },

  pad,
  metricRow: { flexDirection: 'row', gap: theme.sp(1.5) },
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(2) },

  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
  emptyHint: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  compareRow: { flexDirection: 'row', marginTop: theme.sp(1) },
  compareCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(1.5), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  compareLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5) },
  compareValue: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, textAlign: 'center' },
  /** 睡眠恢复卡：入睡/起床/时长 一行小字 */
  sleepMeta: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1.5), textAlign: 'center' },
  compareYesterday: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), textAlign: 'right' },

  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  // ── 节律日历（周/月 7 列按天 / 年 4 列按月）──
  calRow: { flexDirection: 'row', gap: theme.sp(1), marginBottom: theme.sp(1) },
  calHeadText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  calCell: { flex: 1, aspectRatio: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  calMonthCell: { flex: 1, aspectRatio: 1.5, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  calCellToday: { borderWidth: 2, borderColor: theme.colors.accentSolid },
  calCellText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any },
  calCellEmpty: { flex: 1 },
  calTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calLegendRow: { flexDirection: 'row' },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', marginLeft: theme.sp(2) },
  calLegendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill, marginRight: theme.sp(1) },
  calLegendText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  sparkLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(1) },
});
