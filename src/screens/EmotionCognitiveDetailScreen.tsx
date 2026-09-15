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
import { useNavigation } from '@react-navigation/native';
import Svg, { Polyline } from 'react-native-svg';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import Card from '../components/Card';
import CortisolDailyChart, { buildRhythmInsights } from '../components/CortisolDailyChart';
import { useAiInsight } from '../hooks/useAiInsight';
import InsightBanner from '../components/InsightBanner';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import { healthStore, dayKey, type SleepSummary } from '../data/healthStore';
import { collectSamples, collectSamplesForDay, collectSamplesForRange } from '../components/CortisolRhythmCard';
import { analyzeCortisol, type CortisolSample, type RhythmLevel } from '../lib/cortisolRhythm';
import { type RangeKey } from '../data/metrics';
import { type StressReport } from '../lib/stressAlgorithm';
import { type CognitiveLoadReport } from '../lib/cognitiveLoad';

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
  sleepDebt: number | null;
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

/** 对一段日期数组逐日取值后聚合为单个 RangeAgg（周/月/单月均走这里） */
function aggregateOverDays(days: Date[]): RangeAgg {
  const { computeStressReport } = require('../lib/stressAlgorithm');
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  const stresses = days.map((d) => computeStressReport(d.getTime()));
  const cogs = days.map((d) => computeCognitiveLoadReport(d.getTime()));
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
    sleepDebt: mean(sleeps.map((s) => (s && s.total > 0 ? Math.max(0, +(8 - s.total / 60).toFixed(1)) : null))),
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
    sleepDebt: numMean((a) => a.sleepDebt),
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

  // ── 日视图：锚定日 + 前一天 ──
  const dayData = useMemo(() => {
    const D = new Date(anchor);
    D.setHours(0, 0, 0, 0);
    const prevD = new Date(D.getTime() - DAY_MS);
    const { computeStressReport } = require('../lib/stressAlgorithm');
    const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
    const stress = computeStressReport(D.getTime());
    const stressPrev = computeStressReport(prevD.getTime());
    const cog = computeCognitiveLoadReport(D.getTime());
    const cogPrev = computeCognitiveLoadReport(prevD.getTime());
    const sl = healthStore.getSleep(dayKey(D.getTime()));
    const slPrev = healthStore.getSleep(dayKey(prevD.getTime()));
    return { D, prevD, stress, stressPrev, cog, cogPrev, sl, slPrev };
  }, [anchor]);

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
  }, []);
  const rhythmLabelMap: Record<'normal' | 'high' | 'dysregulated', { label: string; color: string }> = {
    normal: { label: '节律正常', color: theme.colors.ui.rhythmGood },
    high: { label: '皮质醇偏高', color: theme.colors.ui.rhythmWarn },
    dysregulated: { label: '节律紊乱', color: theme.colors.moodRest },
  };
  const todayRhythmMeta = rhythmLabelMap[todayRhythm.level];

  // ── AI 综合分析 ──
  // ★ 真实端侧大模型（MiraAI · Qwen2.5-1.5B）：与洞察页同通道（ai/insight.ts 'recovery' kind），
  //   输出分点行 tone|标题|正文（皮质醇节律→情绪→脑力→睡眠），带落盘缓存与静默降级。
  const aiRecovery = useAiInsight('recovery');

  /** 规则兜底：与 AI 行同构的分点（AI 生成中 pending 提示 + 不可用/无数据时显示） */
  const aiFallbackRows = useMemo<SummaryRow[]>(() => {
    const rows: SummaryRow[] = [];
    if (range === 'day') {
      const { D, stress: s, cog: g } = dayData;
      const isToday = dayKey(D.getTime()) === dayKey(Date.now());
      // 皮质醇节律（洞察文案与卡片同源 buildRhythmInsights，取首条作分点正文）
      if (isToday) {
        if (todayRhythm.firstInsight) {
          rows.push({
            tone: todayRhythm.level === 'normal' ? 'good' : 'warn',
            title: '皮质醇节律',
            body: todayRhythm.firstInsight,
          });
        }
      } else {
        const rSamples = collectSamplesForDay(dayKey(D.getTime()));
        if (rSamples.length >= 4) {
          const rr = analyzeCortisol(rSamples, 1);
          const lines = buildRhythmInsights(rr, false);
          if (lines[0]) rows.push({ tone: rr.today.dys ? 'warn' : 'good', title: '皮质醇节律', body: lines[0] });
        }
      }
      if (s.emotionalLoad != null) {
        rows.push({
          tone: s.emotionalLoad >= 70 ? 'warn' : s.emotionalLoad >= 40 ? 'neutral' : 'good',
          title: '情绪消耗',
          body: `情绪消耗 ${s.emotionalLoad}/100${s.events.length > 0 ? `，当日 ${s.events.length} 次压力事件` : '，无压力事件'}。`,
        });
      }
      if (g.loadScore != null) {
        rows.push({
          tone: g.loadLevel === 'heavy' ? 'warn' : g.loadLevel === 'moderate' ? 'neutral' : 'good',
          title: '脑力负荷',
          body: `脑力消耗 ${g.loadScore}/100${g.bestSpan ? `，最佳时段 ${String(g.bestSpan.startHour).padStart(2, '0')}:00–${String(g.bestSpan.endHour).padStart(2, '0')}:00` : ''}。`,
        });
      }
      if (!isToday) rows.push({ tone: 'neutral', title: '数据说明', body: `以上为 ${periodLabel('day', D)} 数据。` });
    } else if (rangeData) {
      const { cur, prev } = rangeData;
      if (cur.emotionLoad != null) {
        const d = prev.emotionLoad != null ? cur.emotionLoad - prev.emotionLoad : null;
        rows.push({
          tone: cur.emotionLoad >= 70 ? 'warn' : cur.emotionLoad >= 40 ? 'neutral' : 'good',
          title: '情绪消耗',
          body: `${periodLabel(range, anchor)}平均情绪消耗 ${cur.emotionLoad.toFixed(0)}/100${d != null ? `，较上期${d >= 0 ? '升' : '降'} ${Math.abs(d).toFixed(0)}` : ''}。`,
        });
      }
      if (cur.cogLoad != null) {
        const d = prev.cogLoad != null ? cur.cogLoad - prev.cogLoad : null;
        rows.push({
          tone: cur.cogLoad >= 70 ? 'warn' : cur.cogLoad >= 40 ? 'neutral' : 'good',
          title: '脑力负荷',
          body: `平均脑力负荷 ${cur.cogLoad.toFixed(0)}/100${d != null ? `，较上期${d >= 0 ? '升' : '降'} ${Math.abs(d).toFixed(0)}` : ''}。`,
        });
      }
      if (cur.cortisolMesor != null) {
        const st = cur.cortisolStatus;
        rows.push({
          tone: st === 'normal' ? 'good' : st != null ? 'warn' : 'neutral',
          title: '皮质醇节律',
          body: `平均皮质醇 ${cur.cortisolMesor.toFixed(1)}${st === 'dysregulated' ? '，区间内节律形态紊乱' : st === 'sustained_high' ? '，区间内持续偏高' : ''}。`,
        });
      }
      if (cur.sleepScore != null) {
        rows.push({
          tone: cur.sleepScore >= 75 ? 'good' : cur.sleepScore >= 60 ? 'neutral' : 'warn',
          title: '睡眠恢复',
          body: `平均睡眠评分 ${cur.sleepScore.toFixed(0)}${cur.sleepDebt != null ? `，睡眠负债 ${cur.sleepDebt.toFixed(1)} 小时` : ''}。`,
        });
      }
    }
    if (rows.length === 0) {
      rows.push({ tone: 'neutral', title: '等待数据', body: '继续佩戴戒指，更多数据生成后即可提供皮质醇、情绪与脑力的综合分析。' });
    }
    return rows;
  }, [range, dayData, rangeData, anchor, todayRhythm]);

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 返回头 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>身体恢复</Text>
          </View>
        </View>

        {/* 当日皮质醇节律结论（大字，仅日视图显示；周/月/年为区间聚合，无"今日"概念） */}
        {range === 'day' && (
          <View style={styles.rhythmHero}>
            <Text style={styles.rhythmHeroLabel}>今日皮质醇节律</Text>
            <Text style={[styles.rhythmHeroVal, { color: todayRhythmMeta.color }]}>{todayRhythmMeta.label}</Text>
          </View>
        )}
        {/* ★ 统一选择器：日/周/月/年 + 日期步进器（与情绪/脑力消耗详情页一致） */}
        <RangeSwitch value={range} onChange={setRange} />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* AI 综合分析（真实端侧 MiraAI 分点行；生成中 pending 提示，失败回落规则分点） */}
        <InsightBanner rows={aiRecovery.rows ?? aiFallbackRows} pending={aiRecovery.loading} />

        {/* ── 内容 ── */}
        {range === 'day' ? (
          <DayView data={dayData} anchorDayMs={anchor.getTime()} />
        ) : rangeData ? (
          <RangeView cur={rangeData.cur} prev={rangeData.prev} range={range} anchor={anchor} />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

/** 日视图：锚定日全天看板 */
function DayView({ data, anchorDayMs }: { data: DayData; anchorDayMs: number }) {
  const { D, stress: s, stressPrev: sP, cog: g, cogPrev: gP, sl, slPrev } = data;
  return (
    <>
      <CortisolDailyChart anchorDayMs={anchorDayMs} showStatusChip={false} showInsights={false} />

      {/* 情绪消耗摘要 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>情绪消耗摘要</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="压力事件" value={`${s.events.length} 次`} sub={s.events.length > 0 ? `峰值 ${s.peakHour != null ? `${String(Math.floor(s.peakHour)).padStart(2, '0')}:00` : '—'}` : '无事件'} />
            <SumCell label="恢复" value={s.avgRecoverySec != null ? `${s.avgRecoverySec}s` : '—'} sub={s.avgRecoverySec != null ? (s.avgRecoverySec > 120 ? '恢复偏慢' : '恢复正常') : '—'} />
          </View>
          <View style={styles.compareRow}>
            <View style={styles.compareCell}>
              <Text style={styles.compareLabel}>相比前一天</Text>
              <Text style={styles.compareValue}>
                {(() => {
                  const d = s.events.length - sP.events.length;
                  const r = (s.avgRecoverySec ?? 0) - (sP.avgRecoverySec ?? 0);
                  const parts: string[] = [];
                  if (d !== 0) parts.push(`${d > 0 ? '+' : ''}${d}次压力`);
                  if (s.avgRecoverySec != null && sP.avgRecoverySec != null && Math.abs(r) >= 10) parts.push(`${r > 0 ? '恢复慢' : '恢复快'} ${Math.abs(r)}s`);
                  return parts.length > 0 ? parts.join(' ') : '基本持平';
                })()}
              </Text>
            </View>
          </View>
        </View>
      </Card>

      {/* 脑力消耗摘要 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>脑力消耗摘要</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="脑力负荷" value={g.loadScore != null ? String(g.loadScore) : '—'} sub={g.peakLoadSpan ? `峰值 ${String(g.peakLoadSpan.startHour).padStart(2, '0')}:00–${String(g.peakLoadSpan.endHour).padStart(2, '0')}:00` : '—'} />
            <SumCell label="恢复" value={g.recoveryCapacity != null ? `${Math.round(g.recoveryCapacity * 100)}%` : '—'} sub={g.bestSpan ? `最佳 ${String(g.bestSpan.startHour).padStart(2, '0')}:00–${String(g.bestSpan.endHour).padStart(2, '0')}:00` : '—'} />
          </View>
          <View style={styles.compareRow}>
            <View style={styles.compareCell}>
              <Text style={styles.compareLabel}>相比前一天</Text>
              <Text style={styles.compareValue}>
                {(() => {
                  const loadD = (g.loadScore ?? 0) - (gP.loadScore ?? 0);
                  const recD = (g.recoveryCapacity ?? 0) - (gP.recoveryCapacity ?? 0);
                  const parts: string[] = [];
                  if (g.loadScore != null && gP.loadScore != null && Math.abs(loadD) >= 5) parts.push(`负荷 ${loadD > 0 ? '+' : ''}${loadD.toFixed(0)}`);
                  if (g.recoveryCapacity != null && gP.recoveryCapacity != null && Math.abs(recD) >= 0.05) parts.push(`恢复 ${recD > 0 ? '+' : ''}${Math.round(recD * 100)}%`);
                  return parts.length > 0 ? parts.join(' ') : '基本持平';
                })()}
              </Text>
            </View>
          </View>
        </View>
      </Card>

      {/* 睡眠恢复摘要 */}
      <SleepCard sl={sl} slPrev={slPrev} />
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

/** 节律日历配色（引用 token）：异常=首页圆环粉 moodRest，正常=淡紫 ui.rhythmCalm */
const CAL_COLOR = { abn: theme.colors.moodRest, normal: theme.colors.ui.rhythmCalm };

type CalCell = { key: string; label: string; abn: boolean; isToday: boolean };
type CalData = { mode: 'year' | 'days'; head?: string[]; rows: CalCell[][] };
/** AI 综合分析分点行（AI 生成行与规则兜底行同构，均由 InsightBanner rows 渲染） */
type SummaryRow = { tone: 'good' | 'warn' | 'neutral'; title: string; body: string };

/** 周/月：按天 7 列日历；年：12 月格。异常=首页圆环粉(moodRest)，正常/无数据=淡紫(rhythmCalm) */
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
              <View style={[styles.calLegendSwatch, { backgroundColor: CAL_COLOR.abn }]} />
              <Text style={styles.calLegendText}>{data.mode === 'year' ? '异常偏多' : '异常'}</Text>
            </View>
            <View style={styles.calLegendItem}>
              <View style={[styles.calLegendSwatch, { backgroundColor: CAL_COLOR.normal }]} />
              <Text style={styles.calLegendText}>正常</Text>
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
                  { backgroundColor: c.abn ? CAL_COLOR.abn : CAL_COLOR.normal },
                  c.isToday && styles.calCellToday,
                ]}
              >
                <Text style={styles.calCellText}>{c.label}</Text>
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
    normal: { label: '节律正常', color: '#2ECC71' },
    sustained_high: { label: '持续偏高', color: theme.colors.danger },
    dysregulated: { label: '节律紊乱', color: theme.colors.stateTense },
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
            <SumCell label="平均脑力负荷" value={cur.cogLoad != null ? `${cur.cogLoad.toFixed(0)}/100` : '—'} sub={prev.cogLoad != null && cur.cogLoad != null ? `上期 ${fmtDelta(cur.cogLoad - prev.cogLoad)}` : '对比上一周期'} />
            <SumCell label="平均恢复能力" value={cur.cogRecovery != null ? `${cur.cogRecovery.toFixed(0)}%` : '—'} sub={prev.cogRecovery != null && cur.cogRecovery != null ? `上期 ${fmtDelta(cur.cogRecovery - prev.cogRecovery)}%` : '对比上一周期'} />
          </View>
        </View>
      </Card>

      {/* 睡眠恢复区间聚合 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>睡眠恢复 · 区间均值</Text>
          <View style={styles.summaryGrid}>
            <SumCell label="平均睡眠负债" value={cur.sleepDebt != null ? `${cur.sleepDebt.toFixed(1)}h` : '—'} sub={prev.sleepDebt != null && cur.sleepDebt != null ? `上期 ${fmtDelta(cur.sleepDebt - prev.sleepDebt, 1)}h` : '对比上一周期'} />
            <SumCell label="平均睡眠评分" value={cur.sleepScore != null ? `${cur.sleepScore.toFixed(0)}` : '—'} sub={prev.sleepScore != null && cur.sleepScore != null ? `上期 ${fmtDelta(cur.sleepScore - prev.sleepScore)}` : '对比上一周期'} />
          </View>
        </View>
      </Card>
    </>
  );
}

/** 睡眠恢复卡片（日/区间共用） */
function SleepCard({ sl, slPrev }: { sl: ReturnType<typeof healthStore.getSleep>; slPrev: ReturnType<typeof healthStore.getSleep> }) {
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
  const totalH = (sl.total / 60).toFixed(1);
  const debtNow = Math.max(0, +(8 - parseFloat(totalH)).toFixed(1));
  const debtPrev = slPrev ? Math.max(0, +(8 - slPrev.total / 60).toFixed(1)) : null;
  const scoreD = (sl.score ?? 0) - (slPrev?.score ?? 0);
  return (
    <Card padded={false}>
      <View style={styles.pad}>
        <Text style={styles.cardTitle}>睡眠恢复摘要</Text>
        <View style={styles.summaryGrid}>
          <SumCell label="睡眠负债" value={`${debtNow}h`} sub={(() => { const d = debtNow; return d <= 0 ? '充足' : d < 1 ? '轻微不足' : d < 2 ? '中度不足' : '严重不足'; })()} />
          <SumCell label="恢复" value={sl.score != null ? String(sl.score) : '—'} sub={sl.score >= 85 ? '恢复良好' : sl.score >= 70 ? '恢复正常' : sl.score >= 55 ? '恢复偏慢' : '需改善'} />
        </View>
        <View style={styles.compareRow}>
          <View style={styles.compareCell}>
            <Text style={styles.compareLabel}>相比前一天</Text>
            <Text style={styles.compareValue}>
              {(() => {
                const parts: string[] = [];
                if (debtPrev != null && debtNow !== debtPrev) parts.push(`负债 ${debtNow < debtPrev ? '减' : '增'} ${Math.abs(+(debtNow - debtPrev).toFixed(1))}h`);
                if (sl.score != null && slPrev?.score != null && Math.abs(scoreD) >= 5) parts.push(`评分 ${scoreD >= 0 ? '+' : ''}${scoreD}`);
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
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: theme.colors.textWhite },
  rhythmHero: { marginTop: theme.sp(1), marginBottom: theme.sp(1) },
  rhythmHeroLabel: { fontSize: theme.fontSize.body, color: theme.colors.textWhite80, marginBottom: theme.sp(0.5) },
  rhythmHeroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.bold as any },

  pad,
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
  compareYesterday: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), textAlign: 'right' },

  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  // ── 节律日历（周/月 7 列按天 / 年 4 列按月）──
  calRow: { flexDirection: 'row', gap: theme.sp(1), marginBottom: theme.sp(1) },
  calHeadText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  calCell: { flex: 1, aspectRatio: 1, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  calMonthCell: { flex: 1, aspectRatio: 1.5, borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  calCellToday: { borderWidth: 2, borderColor: theme.colors.accentSolid },
  calCellText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any, color: theme.colors.ui.chipText },
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
