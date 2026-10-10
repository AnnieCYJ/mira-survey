/**
 * CycleYearReviewCard —— 年度回顾（2026-10-07）
 *
 * 用户原话：「现在目前只有按周期来切换，其实还有年嘛。那前年的一个分析，我不知道其他的
 *   生理周期 APP 有没有？它其实还是可以统计一些东西的」→「年度回顾」。
 * 口径对齐 Oura Cycle Insights 的年度视图：按自然年汇总本机真实记录——
 *   ① 该年 周期数 / 平均周期长度 / 波动 / 最短·最长 / 全年经期天数 / 记症状天数；
 *   ② 12 个月柱图：每月「经期天数」+「记症状天数」两根柱，一眼看出全年节律分布。
 * 全部来自用户自填数据，不编造；该年没有记录时给引导文案。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import { daysBetween, parseDate } from '../lib/cycleMath';
import type { PeriodDayLog } from '../data/cycleLog';

/** 柱图画布（viewBox 单位，外层按宽度自适应缩放） */
const W = 680;
const H = chart.h.m;     // ★ 规范：150 → M 档 180
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 2;

const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

export default function CycleYearReviewCard({
  cycleStarts,
  periodDays,
}: {
  /** 周期首日（新 → 旧，index 0 = 当前周期） */
  cycleStarts: string[];
  periodDays: Record<string, PeriodDayLog>;
}) {
  // 可选年份：来自经期首日 + 逐日记录，去重后降序（兜底当前年）
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const s of cycleStarts) set.add(parseDate(s).getFullYear());
    for (const k of Object.keys(periodDays)) set.add(parseDate(k).getFullYear());
    if (set.size === 0) set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [cycleStarts, periodDays]);

  const [idx, setIdx] = useState(0);
  const year = years[Math.min(idx, years.length - 1)];

  const data = useMemo(() => {
    // ① 该年 12 个月的经期天数 / 记症状天数
    const months = MONTH_LABELS.map(() => ({ period: 0, symptom: 0 }));
    let periodTotal = 0;
    let symptomTotal = 0;
    for (const k of Object.keys(periodDays)) {
      const d = parseDate(k);
      if (d.getFullYear() !== year) continue;
      const e = periodDays[k];
      if (e?.flow) {
        months[d.getMonth()].period++;
        periodTotal++;
      }
      if ((e?.tags ?? []).length > 0 || e?.pain) {
        months[d.getMonth()].symptom++;
        symptomTotal++;
      }
    }

    // ② 该年开始的完整周期长度（只有「有下一次经期首日」的周期才知道长度）
    const lens: number[] = [];
    for (let i = 1; i < cycleStarts.length; i++) {
      if (parseDate(cycleStarts[i]).getFullYear() !== year) continue;
      const len = daysBetween(cycleStarts[i], cycleStarts[i - 1]);
      if (len > 0) lens.push(len);
    }
    const n = lens.length;
    const mean = n ? lens.reduce((s, v) => s + v, 0) / n : 0;
    const std = n ? Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0;
    const min = n ? Math.min(...lens) : 0;
    const max = n ? Math.max(...lens) : 0;

    const maxV = Math.max(1, ...months.map((m) => Math.max(m.period, m.symptom)));
    return { months, periodTotal, symptomTotal, n, mean, std, min, max, maxV };
  }, [periodDays, cycleStarts, year]);

  const hasAny = data.periodTotal > 0 || data.symptomTotal > 0 || data.n > 0;
  const canPrev = idx < years.length - 1; // ‹ 更早的年份
  const canNext = idx > 0;                // › 更晚的年份

  const innerW = W - PAD_L - PAD_R;
  const groupW = innerW / 12;
  const barW = groupW * 0.28;
  const chartH = H - PAD_T - PAD_B;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>年度回顾</Text>
        <View style={styles.nav}>
          <TouchableOpacity
            style={styles.navBtn}
            disabled={!canPrev}
            onPress={() => setIdx((v) => Math.min(v + 1, years.length - 1))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.navText, !canPrev ? styles.navTextOff : null]}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navYear}>{year}</Text>
          <TouchableOpacity
            style={styles.navBtn}
            disabled={!canNext}
            onPress={() => setIdx((v) => Math.max(v - 1, 0))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.navText, !canNext ? styles.navTextOff : null]}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!hasAny ? (
        <Text style={styles.empty}>
          {year} 年还没有经期或症状记录。记录后这里会按自然年汇总你的周期数与每月经期/症状分布。
        </Text>
      ) : (
        <>
          {/* 概览 */}
          <View style={styles.sumRow}>
            <View style={styles.sumCol}>
              <Text style={styles.sumValue}>{data.n}</Text>
              <Text style={styles.sumLabel}>完整周期</Text>
            </View>
            <View style={styles.sumCol}>
              <Text style={styles.sumValue}>{data.n ? Math.round(data.mean) : '—'}</Text>
              <Text style={styles.sumLabel}>平均长度（天）</Text>
            </View>
            <View style={styles.sumCol}>
              <Text style={styles.sumValue}>{data.n ? `±${data.std.toFixed(1)}` : '—'}</Text>
              <Text style={styles.sumLabel}>波动（天）</Text>
            </View>
          </View>
          <Text style={styles.subStat}>
            {data.n ? `最短 ${data.min} 天 · 最长 ${data.max} 天 · ` : ''}
            全年经期 {data.periodTotal} 天 · 记症状 {data.symptomTotal} 天
          </Text>

          {/* 12 个月柱图 */}
          <View style={styles.chartWrap}>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
              {data.months.map((m, i) => {
                const gx = PAD_L + i * groupW;
                const cx = gx + groupW / 2;
                const base = H - PAD_B;
                const pv = (m.period / data.maxV) * chartH;
                const sv = (m.symptom / data.maxV) * chartH;
                // ★ 2026-10-10（bar-design-unified-spec）：rx 统一 3（去掉 min(barW/2,6)）
                const r = chart.barRadius;
                return (
                  <React.Fragment key={i}>
                    {m.period > 0 ? (
                      <Rect
                        x={cx - barW - 1}
                        y={base - pv}
                        width={barW}
                        height={Math.max(2, pv)}
                        rx={r}
                        fill={mm.colors.roseCore}
                      />
                    ) : null}
                    {m.symptom > 0 ? (
                      <Rect
                        x={cx + 1}
                        y={base - sv}
                        width={barW}
                        height={Math.max(2, sv)}
                        rx={r}
                        fill={mm.colors.roseMid}
                      />
                    ) : null}
                  </React.Fragment>
                );
              })}
            </Svg>
            <View style={styles.axis}>
              {MONTH_LABELS.map((m) => (
                <Text key={m} style={styles.axisText}>
                  {m}
                </Text>
              ))}
            </View>
          </View>

          {/* 图例 */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: mm.colors.roseCore }]} />
              <Text style={styles.legendText}>经期天数</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: mm.colors.roseMid }]} />
              <Text style={styles.legendText}>记症状天数</Text>
            </View>
          </View>

          <Text style={styles.foot}>
            按自然年汇总本机记录；周期长度为相邻两次经期首日的间隔。仅供参考，不构成医学诊断。
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.sm,
    gap: theme.space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  nav: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  navBtn: { paddingHorizontal: theme.sp(1) },
  navText: { fontSize: theme.fontSize.card, color: theme.colors.accentText },
  navTextOff: { color: theme.colors.textSub, opacity: 0.35 },
  navYear: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  empty: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },
  sumRow: { flexDirection: 'row', alignItems: 'stretch', gap: theme.space.xs },
  // ★ 2026-10-09（menstrual-cycle-preview 年视图 .tile）：概览列 = 无底色描边小格（radius 11）
  sumCol: {
    flex: 1,
    alignItems: 'center',
    gap: theme.sp(0.5),
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: theme.sp(1),
  },
  sumValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sumLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  subStat: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  chartWrap: { width: '100%' },
  axis: { flexDirection: 'row', marginTop: theme.sp(0.5) },
  axisText: { flex: 1, textAlign: 'center', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legend: { flexDirection: 'row', gap: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  legendDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  foot: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, opacity: 0.9 },
});
