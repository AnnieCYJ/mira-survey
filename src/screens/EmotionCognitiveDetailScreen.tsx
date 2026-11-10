/**
 * EmotionCognitiveDetailScreen —— 「皮质醇趋势」详情页（原「昼夜节律」页；与情绪/脑力消耗详情页统一骨架）
 *
 * ★ 2026-11-09（用户）：这张页**本来就有日 / 周 / 月 / 年四档**，只是改成睡眠规律性主视觉后一度没有入口。
 *   现由昼夜节律详情页底部的「皮质醇趋势」卡直接点进来，不再另建 / 重写一个皮质醇详情页。
 *   对外名称统一叫「皮质醇趋势」（不叫「皮质醇活性」，后者只是算法层的 0~100 反推指数叫法）。
 *
 * 结构：返回头 → RangeSwitch(日/周/月/年) → DateAnchorPicker → 节律状态 Hero（白底描边卡）→ 内容（日=全天趋势+节律分析 / 周月年=节律日历+小结）→ 底部 AI 分析
 *   · 日：锚定日的全天看板（皮质醇全天趋势 + 情绪/脑力/睡眠摘要 + 相比前一天），与之前一致
 *   · 周/月/年：区间内逐日聚合（均值 + 对比上一等长周期），皮质醇用窗口样本做 cosinor 拟合
 *
 * 时间选择器与 EnergyDetailScreen / MetricDetail / SleepDetail 等完全一致（复用 RangeSwitch + DateAnchorPicker）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import Card from '../components/Card';
import CortisolDailyChart from '../components/CortisolDailyChart';
import { chart } from '../theme/chart';
import { useDebouncedHealthStoreRefresh, useEnsureDerivedMetrics } from '../hooks/useHealthStore';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { collectSamples, collectSamplesForDay, collectSamplesForRange } from '../components/CortisolRhythmCard';
// ★ v18.124：皮质醇水平/峰值改用多模态反推的实测槽统计（与首页/趋势图同源）
import { buildCortisolProxyBaseline, buildCortisolProxyToday, proxySummaryFromSlots, judgeCortisolRhythm, judgeCortisolRhythmForDay, MIN_BASELINE_DAYS } from '../lib/cortisolProxy';
import { analyzeCortisol, type CortisolSample, type RhythmLevel } from '../lib/cortisolRhythm';
import { type RangeKey } from '../data/metrics';
import { type StressReport } from '../lib/stressAlgorithm';
import { type CognitiveLoadReport } from '../lib/cognitiveLoad';
import { reportNowMsForDay, reportNowMsForPrevDay } from '../lib/dayAnchor';
import { computeSleepLoad, SLEEP_LOAD_LABEL, type SleepLoadDay } from '../lib/sleepLoad';
import { formatSleepClockText, isLateBedtime } from '../lib/sleepTime';
// ★ 2026-10-13：恢复分统一走 computeSleepPersonalized / sleepRecoveryTag（与首页 chip /
//   睡眠详情页 / 认知负荷同一把尺）——不再读 sl.score（戒指每次同步重写的绝对分，
//   正是「睡眠恢复分数一直变」的根源；且与全 App 的个人相对口径不一致）。
import { computeSleepPersonalized, sleepRecoveryTag } from '../lib/sleepPersonalized';

const DAY_MS = 86400000;

/**
 * v18.22 摘要格 pastel 底色（与首页 MindStatCard 角标同源，mm.chipBg）：
 *   情绪=粉 / 疲劳=紫 / 睡眠恢复=lime(恢复语义) / 皮质醇=亮绿(对齐 chart.ts：cortisol=limeMid，与日视图曲线同源)。
 *   ★ 2026-10-09（用户：日周月年都要跟 Design Token 一致）：皮质醇从主题紫 accentSoft/accentSolid 改为亮绿 lime 家族，
 *     与日视图「皮质醇全天趋势」单条亮绿曲线(chart.series.cortisol)及 sleep-recovery 预览同源。
 * 不传 bg/fg 时回落 cardBgSoft 灰（仅无数据占位格用）。
 */
const MOD_BG = {
  emotion: { bg: mm.chipBg.pink.bg, fg: mm.chipBg.pink.fg },
  mind: { bg: mm.chipBg.lav.bg, fg: mm.chipBg.lav.fg },
  sleep: { bg: mm.chipBg.lime.bg, fg: mm.chipBg.lime.fg },
  cortisol: { bg: mm.chipBg.lime.bg, fg: mm.chipBg.lime.fg },
};

/**
 * 节律状态 → 语义色（与睡眠详情页 levelMeta / 节律日历 CAL_COLOR 同源）。
 * 正常=limeCore 亮黄绿 / 偏高=danger 红 / 紊乱=roseDeep 粉（★ 2026-11-07 用户：紊乱用粉色，不再琥珀）。
 * ★ 2026-11-08：深玻璃卡上的深橄榄绿 limeDeep 发糊，语义色统一换 limeCore。
 */
const RHYTHM_STATUS_COLOR: Record<string, string> = {
  节律正常: mm.colors.limeCore,
  皮质醇偏高: theme.colors.danger,
  节律紊乱: mm.colors.roseDeep,
  normal: mm.colors.limeCore,
  sustained_high: theme.colors.danger,
  dysregulated: mm.colors.roseDeep,
};
const RANGE_STATUS_LABEL: Record<RhythmLevel, string> = {
  normal: '节律正常',
  sustained_high: '持续偏高',
  dysregulated: '节律紊乱',
};

/**
 * 节律状态 Hero —— **统一置于时间选择器下方**，与睡眠/运动/情绪详情页的 Hero 卡片同一骨架
 * （白底 + cardBorder 描边 + radius.card + shadow.card + cardPad），不再把结论做成顶部大字或 AI banner。
 * 日：大字=今日节律结论（节律正常 / 皮质醇偏高 / 节律紊乱）；
 * 周/月/年：大字=区间节律状态（正常 / 持续偏高 / 节律紊乱）。
 */
function RhythmHero({ range, dayLabel, rangeStatus, rangeLabel, dayPeakH, dayPeakSub, dayChrono }: {
  range: RangeKey;
  dayLabel: string;
  rangeStatus: RhythmLevel | null;
  rangeLabel: string;
  /** ★ 2026-10-10（用户）：日视图顶部状态卡下展示「峰值时刻 + 作息类型」；仅日视图有意义 */
  dayPeakH: number | null;
  dayPeakSub: string;
  dayChrono: { label: string; sub: string };
}) {
  // ★ 2026-10-10（用户）：顶部状态卡保留，但样式对齐「脑力消耗详情页·认知准备度」卡
  //   （ctitle 标题 + heroWrap 大数字左/上下文右），统一用 Design Token（此前 heroBig 写死 32 属违规）。
  const big = range === 'day' ? (dayLabel ?? '—') : (rangeStatus ? RANGE_STATUS_LABEL[rangeStatus] : '—');
  const color = RHYTHM_STATUS_COLOR[big] ?? RHYTHM_STATUS_COLOR[rangeStatus ?? 'normal'] ?? mm.colors.ink;
  const lab = range === 'day' ? '今日节律结论' : '区间节律结论';
  const ctx = range === 'day' ? '今天' : rangeLabel;
  /* ★ 2026-11-06（用户：「它那个字因为数字可以写大一些，但是那个文字那有点太大了，可以稍微小一点。」）
     → Hero 大字位原本是给「数字」设计的（hero 46px）。这里显示的是「节律紊乱 / 皮质醇偏高」这类**词**，
       46px 撑满整行显得过大 → 词用 stat 档 32px；若是纯数字则仍用 hero 46px。 */
  const bigIsNumber = /^[0-9]/.test(String(big));
  // ★ 2026-10-10（用户）：日视图峰值时刻格式化 HH:MM（与节律分析卡 fmtHour 同源）
  const fmtHM = (h: number | null) => {
    if (h == null || !Number.isFinite(h)) return '—';
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };
  return (
    <View style={styles.heroCard}>
      <Text style={styles.ctitle}>皮质醇昼夜节律</Text>
      <View style={styles.heroWrap}>
        <View>
          <Text style={[styles.heroBig, { color }, !bigIsNumber && styles.heroBigWord]}>{big}</Text>
          <Text style={styles.heroLab}>{lab}</Text>
        </View>
            <Text style={[styles.heroCtx, { color }]}>{ctx}</Text>
          </View>
          {/* ★ 2026-11-03（用户·统一 hero 结构）：大字下方短分析 */}
          <Text style={styles.heroAnalysis}>
            {(() => {
              if (big == null || big === '—') return '今天还没有足够数据判断皮质醇节律，多戴几天会更准。';
              if (String(big).includes('偏高')) return '皮质醇整体偏高，今天注意减压，傍晚后少刺激、早点休息。';
              if (String(big).includes('紊乱')) return '皮质醇节律还不够稳，作息尽量规律，给身体一个固定节奏。';
              return '皮质醇节律正常，身体按预期在白天清醒、夜里回落。';
            })()}
          </Text>
          {/* ★ 2026-10-10（用户）：峰值时刻 + 作息类型，样式对标脑力消耗日视图「认知准备度」duoRow */}
      {range === 'day' ? (
        <View style={styles.duoRow}>
          {/* ★ 2026-10-20 对比度修复：浅色主题实色粉彩 limeSoft(#EAF0BE) 在深色 ocean 主题下
              与白色 textTitle/textSub 组合 → 白字落在浅粉彩上不可读。改用 chipBg.lime 半透底
              （深蓝紫上呈暗橄榄，白字/浅 lime 字对比达标，与 MOD_BG 同一套深色安全配色）。 */}
          <View style={[styles.duoCell, { backgroundColor: mm.chipBg.lime.bg }]}>
            <Text style={styles.duoLab}>峰值时刻</Text>
            <Text style={[styles.duoTime, { color: mm.chipBg.lime.fg }]}>{fmtHM(dayPeakH)}</Text>
            <Text style={styles.duoSub}>{dayPeakSub}</Text>
          </View>
          <View style={[styles.duoCell, { backgroundColor: theme.colors.cardBgSoft }]}>
            <Text style={styles.duoLab}>作息类型</Text>
            <Text style={styles.duoTime}>{dayChrono.label}</Text>
            <Text style={styles.duoSub}>{dayChrono.sub}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

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
  // ★ v18.124：皮质醇水平/峰值改用**多模态反推的实测槽统计**（lib/cortisolProxy）。
  //   旧实现 `collectSamplesForRange` 读的是 cortisol intraday（`stress×1.6+20` 线性代理），
  //   经 `analyzeCortisol` 拟合 cosinor —— 今天只有 8 条/4 槽 → 拟合不出 → mesor/acrophaseH 是 NaN
  //   → 详情页「平均压力水平 / 平均峰值时刻」全显示「—」（用户实锤「都是杠」）。
  //   新口径：**逐日**用 `buildCortisolProxyToday(now=该日)` 取 48 槽实测活性，再对区间取均值。
  //   注意 proxy 的基线窗口不含当天（v18.117），所以历史日必须逐日单独算，不能只算一次。
  const perDayMesor: (number | null)[] = [];
  const perDayPeak: (number | null)[] = [];
  const perDayMesors: { date: string; mesor: number }[] = [];
  // ★ 2026-10-08（用户：你看一下周月年这个数据对不对）：把区间内各天的 48 槽实测活性按
  //   「同一时段」平均，得到区间平均昼夜曲线，再交给与卡片/详情页 Hero **同一个**判定函数
  //   （judgeCortisolRhythm）→ 区间也能判「节律紊乱 / 持续偏高 / 节律正常」。
  //   此前 `cortisolStatus` 恒为 null：周/月/年既没有节律 chip，AI 分析行也永远不含「代谢」项。
  const slotSum: number[] = new Array(48).fill(0);
  const slotCnt: number[] = new Array(48).fill(0);
  for (const d of days) {
    try {
      const pbl = buildCortisolProxyBaseline(14, d.getTime() + DAY_MS - 1);
      const px = buildCortisolProxyToday(pbl, { now: d.getTime() + DAY_MS - 1 });
      const s = proxySummaryFromSlots(px.vals, px.real);
      perDayMesor.push(s.mesor);
      perDayPeak.push(s.acrophaseH);
      if (s.mesor != null) perDayMesors.push({ date: dayKey(d.getTime()), mesor: s.mesor });
      for (let i = 0; i < px.vals.length; i++) {
        const v = px.vals[i];
        if (px.real[i] && v != null && Number.isFinite(v)) { slotSum[i] += v; slotCnt[i]++; }
      }
    } catch {
      perDayMesor.push(null);
      perDayPeak.push(null);
    }
  }
  perDayMesors.sort((a, b) => a.date.localeCompare(b.date));
  const rAvgVals = slotSum.map((v, i) => (slotCnt[i] > 0 ? v / slotCnt[i] : null));
  const rAvgReal = slotCnt.map((c) => c > 0);
  const rJudge = judgeCortisolRhythm(rAvgVals, rAvgReal);
  const rangeCortisolStatus: RhythmLevel | null =
    rJudge.label === '皮质醇偏高' ? 'sustained_high'
      : rJudge.label === '节律紊乱' ? 'dysregulated'
        : rJudge.label === '节律正常' ? 'normal'
          : null;

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
    // ★ v18.124：取上面逐日 proxy 实测统计的均值（不再读 cosinor 拟合值）
    cortisolMesor: mean(perDayMesor),
    cortisolPeakH: mean(perDayPeak),
    cortisolCss: null,
    cortisolStatus: rangeCortisolStatus,
    cortisolDaily: perDayMesors,
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
  // ★ 2026-10-08：年视图的节律判定取 12 个月里出现次数最多的那个（并列时优先 紊乱 > 偏高 > 正常），
  //   比原来「取最后一个月的」更贴近「这一年整体」的语义。
  const statusRank: Record<RhythmLevel, number> = { normal: 1, sustained_high: 2, dysregulated: 3 };
  const statusCount: Partial<Record<RhythmLevel, number>> = {};
  for (const a of monthly) if (a.cortisolStatus != null) statusCount[a.cortisolStatus] = (statusCount[a.cortisolStatus] ?? 0) + 1;
  let status: RhythmLevel | null = null;
  (Object.keys(statusCount) as RhythmLevel[]).forEach((k) => {
    if (status == null) { status = k; return; }
    const ck = statusCount[k] ?? 0;
    const cs = statusCount[status as RhythmLevel] ?? 0;
    if (ck > cs || (ck === cs && statusRank[k] > statusRank[status as RhythmLevel])) status = k;
  });
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
  // ★ v18.124：顶部大字也改用 proxy 实测口径（与趋势图、下面两个格子同源）。
  //   旧实现 `analyzeCortisol(collectSamples(), 14)` 读 cortisol intraday + cosinor 拟合 →
  //   样本稀疏时 todayLevel 恒 'normal'、洞察文案也不对。
  // ★ 2026-10-08（用户实锤：洞察页那张卡判「节律紊乱」，点进详情页大字却写「节律正常」）：
  //   大字改用与卡片**同一个**判定函数 judgeCortisolRhythm（同一份 proxy 实测槽）。
  //   旧实现只按 mesor 分「偏高/正常」，永远判不出「节律紊乱」→ 与卡片是两个结论。
  const todayRhythm = useMemo(() => {
    try {
      const pbl = buildCortisolProxyBaseline(14);
      const px = buildCortisolProxyToday(pbl);
      const j = judgeCortisolRhythm(px.vals, px.real);
      if (!j.ready || !j.label) {
        return { label: null as string | null, firstInsight: '佩戴戒指后，这里会显示你今日的皮质醇趋势。', peakH: null, peakSub: '—', chrono: { label: '—' as string, sub: '—' as string } };
      }
      // ★ 2026-10-10（用户：顶部状态卡下显示「峰值时刻 + 作息类型」，与趋势图/节律分析卡同源）
      const sum = proxySummaryFromSlots(px.vals, px.real);
      const peakH = Number.isFinite(sum.acrophaseH) ? sum.acrophaseH : null;
      const peakSub = peakH == null ? '—'
        : peakH >= 6 && peakH <= 11 ? '正常范围 06–11 点'
          : peakH < 6 ? '过早（早醒风险）'
            : '偏晚（夜猫子型）';
      const chrono = (() => {
        if (peakH == null) return { label: '—', sub: '—' };
        if (peakH > 11) return { label: '晚睡型', sub: '皮质醇夜高晨低，建议调整' };
        if (peakH < 6) return { label: '早起型', sub: '皮质醇起得太早（早醒风险）' };
        return { label: '常规作息', sub: '皮质醇晨高夜低（正常）' };
      })();
      return {
        label: j.label as string,
        firstInsight: `今日皮质醇全天均值 ${j.avg}（峰值时段 ${j.peakWindow ?? j.peakClock}）· ${j.label}。由心率变异性、体温、心率与活动反推。`,
        peakH, peakSub, chrono,
      };
    } catch {
      return { label: null as string | null, firstInsight: '佩戴戒指后，这里会显示你今日的皮质醇趋势。', peakH: null, peakSub: '—', chrono: { label: '—' as string, sub: '—' as string } };
    }
    // 依赖 refreshKey：回填/实时数据到达后，顶部大字与节律卡同步刷新
  }, [refreshKey]);
  // 大字文案 = 卡片同款节律结论（无数据显「—」，与卡片 tile 一致）
  const todayRhythmLabel = todayRhythm.label ?? '—';

  // ★ 2026-10-10（用户）：按预览昼夜节律·皮质醇页，移除全部 AI 分析（底部 AI 块、端侧兜底、聊天入口）。
  //   预览日面板 = 趋势卡 + 节律分析卡；周月年 = 节律日历 + 节律小结，均无 AI 分析块。

  return (
    <>
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.bgTop}>
      <View style={styles.stack}>
        {/* 返回头 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fontSize.h2} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>皮质醇趋势</Text>
          </View>
        </View>

        {/* ★ 统一选择器：日/周/月/年 + 日期步进器（与情绪/脑力消耗详情页一致） */}
        <RangeSwitch value={range} onChange={setRange} />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* 节律状态 Hero（统一置于时间选择器下方，与睡眠/运动/情绪详情页一致） */}
        <RhythmHero
          range={range}
          dayLabel={todayRhythmLabel}
          rangeStatus={rangeData ? rangeData.cur.cortisolStatus : null}
          rangeLabel={rangeData ? periodLabel(range, anchor) : ''}
          dayPeakH={todayRhythm.peakH}
          dayPeakSub={todayRhythm.peakSub}
          dayChrono={todayRhythm.chrono}
        />

        {/* ── 内容 ── */}
        {range === 'day' ? (
          <DayView data={dayData} anchorDayMs={anchor.getTime()} />
        ) : rangeData ? (
          <RangeView cur={rangeData.cur} prev={rangeData.prev} range={range} anchor={anchor} />
        ) : null}

        {/* ★ 2026-11-06（用户：「去掉昼夜节律详情页下面的抑郁风险」）→ 移除 DepressionRiskCard。
            （该指标仍保留在「健康一览 / 戒指健康」里，只是不在昼夜节律详情页展示。） */}
      </View>
    </ScreenContainer>
    </View>
    </>
  );
}




/** 指标小卡：label + 大数值 + 小字副行(sub)或迷你对比箭头（bg/fg = 模块 pastel 底/字色，不传=灰底） */
function MetricMini({ label, value, unit, todayN, prevN, goodWhen, noCompare, showHour, sub, bg, fg }: {
  label: string;
  value: string;
  unit?: string;
  todayN?: number | null;
  prevN?: number | null;
  goodWhen?: 'up' | 'down';
  noCompare?: boolean;
  showHour?: boolean;
  /** 固定小字副行（如「脑力 78」）；设置后不再渲染「相比昨天」 */
  sub?: string;
  bg?: string;
  fg?: string;
}) {
  return (
    <View style={{ flex: 1, paddingVertical: theme.sp(1.5), paddingHorizontal: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: bg ?? theme.colors.cardBgSoft, alignItems: 'center' }}>
      <Text style={{ fontSize: theme.fontSize.micro, color: fg ?? theme.colors.textSub, marginBottom: theme.sp(0.5) }}>{label}</Text>
      <Text style={{ fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold, color: theme.colors.textTitle }} numberOfLines={1} adjustsFontSizeToFit>
        {value}{unit ? <Text style={{ fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular, color: theme.colors.textSub }}>{unit}</Text> : null}
      </Text>
      {sub ? (
        <Text style={{ fontSize: theme.fontSize.micro, color: fg ?? theme.colors.textSub, marginTop: theme.sp(1) }}>{sub}</Text>
      ) : !noCompare && todayN != null && prevN != null && todayN !== prevN ? (
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
    // ★ 2026-10-10（用户：按预览昼夜节律·皮质醇 日面板）：趋势图与节律分析拆成两张独立卡，
    //   不渲染 AI 分析；预览无「睡眠恢复摘要」卡，故移除。
    <CortisolDailyChart anchorDayMs={anchorDayMs} showStatusChip={false} showInsights={false} flat asTwoCards chartHeight={chart.h.m} />
  );
}

// ── 节律日历：单日异常判定（★ 2026-10-10 收敛到与睡眠恢复页共用唯一入口 judgeCortisolRhythmForDay，
//   保证两页异常天数逐位一致：proxy 实测槽 + judgeCortisolRhythm 同一套阈值）。──
function dayAbnormal(dayMs: number, isToday: boolean): boolean {
  return judgeCortisolRhythmForDay(dayKey(dayMs), isToday).abn;
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

/** 周/月：按天 7 列日历；年：12 月格。正常=limeSoft，异常=danger 柔和底（v18.21 语义色规范） */
function RhythmCalendar({ range, anchor }: { range: RangeKey; anchor: Date }) {
  const data = useMemo<CalData | null>(() => {
    const todayDk = dayKey(Date.now());
    if (range === 'year') {
      const cells: CalCell[] = eachDayInWindow('year', anchor).map((m) => {
        const days = daysInMonth(m);
        const abnCount = days.filter((d) => {
          const dk = dayKey(d.getTime());
          return dayAbnormal(d.getTime() + DAY_MS - 1, dk === todayDk);
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
          return { key: dk, label: String(d.getDate()), abn: dayAbnormal(d.getTime() + DAY_MS - 1, dk === todayDk), isToday: dk === todayDk };
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

/** 区间视图：★ 2026-10-10（design-system-spec / circadian-cortisol-preview「App 待同步点」）：
 *  周/月/年**不做区间均值** —— 去掉「平均压力水平 / 平均峰值时刻」两张均值格，
 *  改为节律小结三格（异常天数 / 节律状态 / 峰值时段）；异常天数与节律日历同源（dayAbnormal）。 */
function RangeView({ cur, prev, range, anchor }: { cur: RangeAgg; prev: RangeAgg; range: RangeKey; anchor: Date }) {
  const levelMeta: Record<RhythmLevel, { label: string; color: string }> = {
    normal: { label: '节律正常', color: mm.colors.limeCore },
    sustained_high: { label: '持续偏高', color: theme.colors.danger },
    dysregulated: { label: '节律紊乱', color: mm.colors.roseDeep },
  };
  const cMeta = cur.cortisolStatus ? levelMeta[cur.cortisolStatus] : null;
  // 异常天数（年=异常月份）：与 RhythmCalendar 完全同一判定（dayAbnormal 模块级缓存，不重复算）
  const abn = useMemo(() => {
    const todayDk = dayKey(Date.now());
    if (range === 'year') {
      const months = eachDayInWindow('year', anchor);
      let count = 0;
      for (const m of months) {
        const days = daysInMonth(m);
        const c = days.filter((d) => dayAbnormal(d.getTime() + DAY_MS - 1, dayKey(d.getTime()) === todayDk)).length;
        if (days.length > 0 && c / days.length >= 0.3) count += 1;
      }
      return { count, total: months.length };
    }
    const days = eachDayInWindow(range, anchor);
    const count = days.filter((d) => dayAbnormal(d.getTime() + DAY_MS - 1, dayKey(d.getTime()) === todayDk)).length;
    return { count, total: days.length };
  }, [range, anchor]);
  const peakH = cur.cortisolPeakH != null ? Math.round(cur.cortisolPeakH) : null;
  const peakSub = peakH == null ? undefined : peakH >= 6 && peakH <= 11 ? '正常 06–11' : peakH < 6 ? '过早' : '偏晚';
  return (
    <>
      {/* 节律日历（周/月=按天，年=按月；异常=粉，正常=淡紫） */}
      <RhythmCalendar range={range} anchor={anchor} />

      {/* 皮质醇节律小结（无均值）：异常天数 / 节律状态 / 峰值时段 */}
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
            <SumCell
              label={range === 'year' ? '异常月份' : '异常天数'}
              value={String(abn.count)}
              sub={`/ ${abn.total}`}
              bg={MOD_BG.cortisol.bg}
              fg={MOD_BG.cortisol.fg}
            />
            <SumCell
              label="节律状态"
              value={cMeta?.label ?? '—'}
              sub={range === 'year' ? '按异常月占比' : '按异常日占比'}
              bg={MOD_BG.cortisol.bg}
              fg={cMeta?.color ?? MOD_BG.cortisol.fg}
            />
            <SumCell
              label="峰值时段"
              value={peakH != null ? `${String(peakH).padStart(2, '0')}:00` : '—'}
              sub={peakSub}
              bg={MOD_BG.cortisol.bg}
              fg={MOD_BG.cortisol.fg}
            />
          </View>
        </View>
      </Card>

      {/* ★ 2026-10-10（用户：按预览昼夜节律·皮质醇页，周月年不做区间均值 / 无睡眠恢复卡）：
          仅保留节律日历 + 节律小结（异常天数 / 状态 / 峰值时段）。 */}
    </>
  );
}

/**
 * 睡眠恢复卡片（日视图）：**睡眠负载** + **恢复**。
 *  - 睡眠负载：参考成熟算法（WHOOP 睡眠债 / Apple 就寝一致性 / Oura Timing / Fitbit·Garmin 碎片化与阶段质量），
 *    见 `lib/sleepLoad.ts`；窗口 = 该日及此前共 14 天。越高越「欠账」。
 *  - 恢复：当晚睡眠恢复分（`lib/sleepPersonalized.ts`：个人相对口径，醒来即定稿；
 *    与首页 chip / 睡眠详情页 / 认知负荷同一把尺。50 = 和平时一样，勿读成百分制及格线）。
 *  - 晚睡归入「睡眠负载」（时机维度），不再和恢复分重复计分。
 */
function SleepCard({ sl, slPrev, anchorDayMs }: { sl: ReturnType<typeof healthStore.getSleep>; slPrev: ReturnType<typeof healthStore.getSleep>; anchorDayMs: number }) {
  // ★ hooks 不能放在下面 early-return 之后（hook 必须无条件调用）
  const load = useMemo(() => computeSleepLoad(sleepWindowEndingAt(anchorDayMs)), [anchorDayMs, sl]);
  // ★ 2026-10-13：恢复分走统一入口（醒来即定稿的快照口径），与全 App 同一把尺
  const pers = useMemo(() => { try { return computeSleepPersonalized(anchorDayMs); } catch { return null; } }, [anchorDayMs, sl]);
  const persPrev = useMemo(() => { try { return computeSleepPersonalized(anchorDayMs - 86400000); } catch { return null; } }, [anchorDayMs, slPrev]);

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
  const scoreD = (pers?.score ?? 0) - (persPrev?.score ?? 0);
  const scoreLabel = sleepRecoveryTag(pers?.score ?? null, pers?.mode ?? 'absolute') ?? '—';
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
          <SumCell label="睡眠负载(0–100)" value={String(load.load)} sub={`${SLEEP_LOAD_LABEL[load.level]}${debtTxt}`} bg={MOD_BG.sleep.bg} fg={MOD_BG.sleep.fg} />
          <SumCell label="恢复" value={pers?.score != null ? String(pers.score) : '—'} sub={scoreLabel} bg={MOD_BG.sleep.bg} fg={MOD_BG.sleep.fg} />
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
                if (pers?.score != null && persPrev?.score != null && Math.abs(scoreD) >= 3) {
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

function SumCell({ label, value, sub, bg, fg }: { label: string; value: string; sub?: string; bg?: string; fg?: string }) {
  return (
    <View style={[styles.sumCell, bg ? { backgroundColor: bg } : null]}>
      <Text style={[styles.sumLabel, fg ? { color: fg } : null]}>{label}</Text>
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
  // ★ 2026-10-10：节律状态 Hero（与睡眠/运动/情绪详情页 Hero 同一骨架：白底 + 描边 + 圆角 + 阴影）
  heroCard: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  // ★ 2026-11-06（用户：「我感觉这个 title 的字字体大小也不统一」）
  //   → 与同页其它卡标题（cardTitle / ecgTitle = fontSize.card 18）统一，不再用 body 15。
  ctitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  // 对标 .heroWrap：左大数字/标签，右上下文，两端对齐
  heroWrap: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  // 对标 .big：46pt（hero token），状态着色
  heroBig: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.semibold as any, lineHeight: theme.fontSize.hero },
  /* ★ 2026-11-06（用户：结论是词不是数字，字有点太大 → 稍小一点）：词用 stat 档 32px */
  heroBigWord: { fontSize: theme.fontSize.stat, lineHeight: theme.fontSize.stat },
  heroLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) },
  heroCtx: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any },
  /* ★ 2026-11-03（用户·统一 hero 结构）：大字下方短分析 */
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(2) },
  // ★ 2026-10-10（用户）：峰值时刻 + 作息类型，对标脑力消耗「认知准备度」.duo 双格（圆角 11 · 内边距 · 标签/副文 11px · 时间 17px·600）
  duoRow: { flexDirection: 'row', gap: theme.sp(2.5), marginTop: theme.sp(2) },
  duoCell: { flex: 1, paddingVertical: theme.sp(2.5), paddingHorizontal: theme.sp(2.75), borderRadius: theme.radius.md },
  duoLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.75) },
  duoTime: { fontSize: theme.fs(17), fontWeight: theme.weight.semibold as any, lineHeight: theme.fs(17) * 1.1, color: theme.colors.textTitle },
  duoSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.75), lineHeight: theme.fontSize.micro * 1.4 },

  pad,
  metricRow: { flexDirection: 'row', gap: theme.sp(1.5) },
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(2) },

  summaryGrid: { flexDirection: 'row' },
  // ★ v18.123：用户不喜欢灰色底。原 `cardBgSoft` = #F7F6FC（冷灰紫）。
  //   换成品牌紫的极浅底（accentSoft 系列），与皮质醇卡的紫调一致；
  //   文字色不变（textTitle/textSub 在浅紫上对比度更高，实测 AA 达标）。
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.accentSoft, marginHorizontal: theme.sp(0.5) },
  // ★ 2026-10-09（circadian-cortisol-preview）：.sumLabel 11px / .sumValue 21px·650
  sumLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.75), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.h2 * 1.1, textAlign: 'center' },
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
  calCellToday: { borderWidth: 2, borderColor: theme.colors.ui.white95 }, // ★ mira-ocean：紫 → 白
  calCellText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any },
  calCellEmpty: { flex: 1 },
  calTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calLegendRow: { flexDirection: 'row' },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', marginLeft: theme.sp(2) },
  calLegendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill, marginRight: theme.sp(1) },
  calLegendText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
});
