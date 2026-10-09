/**
 * CycleRegularityCard —— 周期规律性 & 提前/推迟（2026-10-07）
 *
 * 用户原话：「这里面还没有生理周期是否准确？每个生理周期是不准确，还是推迟了，还是怎么样？
 *   这个分析也还没有做呢。我记得 oura 有。」
 * 口径对齐 Oura Cycle Insights / Flo Cycle Length Analysis，用本机真实经期首日
 * （cycleLog.history + 每日记录推出的经期首日）算出：
 *   ① 平均周期长度、波动（标准差）、最短 / 最长；
 *   ② 规律性档位（规律 / 偏不规律 / 不规律）——周期间波动越大越不规律；
 *   ③ 逐周期一行：起点日期 + 长度条 + 长度 + 相对平均「晚 / 早 N 天」+ 该周期记过症状的天数。
 * 判据参考 ACOG：正常周期 21–35 天，周期间波动 > 7 天通常视为不规律。
 * 全部为本机记录的统计，不编造；不足 1 个完整周期时给引导文案。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { addDays, daysBetween, parseDate } from '../lib/cycleMath';
import type { PeriodDayLog } from '../data/cycleLog';

/** 长度条的可比刻度（正常 21–35 天，两侧各留余量） */
const SCALE_MIN = 20;
const SCALE_MAX = 40;
/** 最多列出多少个周期，避免卡片过长 */
const MAX_ROWS = 8;

interface Rec {
  start: string;
  end: string;
  length: number;
  symptomDays: number;
}

export default function CycleRegularityCard({
  cycleStarts,
  baseCycleLength,
  periodDays,
}: {
  /** 周期首日（新 → 旧，index 0 = 当前周期） */
  cycleStarts: string[];
  /** 用户设定的基准周期长度（记录不足时提示用） */
  baseCycleLength?: number;
  periodDays: Record<string, PeriodDayLog>;
}) {
  const data = useMemo(() => {
    // 只有「有下一次经期首日」的周期才知道长度，因此从 index 1 起算（index 0 是进行中的当前周期）
    const recs: Rec[] = [];
    for (let i = 1; i < cycleStarts.length; i++) {
      const start = cycleStarts[i];
      const next = cycleStarts[i - 1];
      const length = daysBetween(start, next);
      if (!(length > 0)) continue;
      let symptomDays = 0;
      for (let k = 0; k < length; k++) {
        const e = periodDays[addDays(start, k)];
        if (e && ((e.tags ?? []).length > 0 || !!e.pain)) symptomDays++;
      }
      recs.push({ start, end: addDays(next, -1), length, symptomDays });
    }
    const lens = recs.map((r) => r.length);
    const n = lens.length;
    const mean = n ? lens.reduce((s, v) => s + v, 0) / n : 0;
    const std = n ? Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0;
    const min = n ? Math.min(...lens) : 0;
    const max = n ? Math.max(...lens) : 0;
    const grade: string | null = n < 2 ? null : std <= 3.5 ? '规律' : std <= 7 ? '偏不规律' : '不规律';
    return { recs, n, mean, std, min, max, grade };
  }, [cycleStarts, periodDays]);

  const gradeColor = (g: string) =>
    g === '规律' ? theme.colors.accentSolid : g === '偏不规律' ? mm.colors.purpleMid : mm.colors.roseDeep;

  /** 把「天」映射到 20–40 的标尺百分比（与区间条共用） */
  const normPct = (d: number) => {
    const c = Math.max(SCALE_MIN, Math.min(SCALE_MAX, d));
    return ((c - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  };
  /** 用大白话解释规律性档位（参考 Flo / Oura 的判读语气） */
  const gradePlain = (g: string | null, min: number, max: number): string => {
    if (g === '规律') return `你的周期大多落在 ${min}–${max} 天之间，比较稳定。`;
    if (g === '偏不规律') return `你的周期长度有一定波动（${min}–${max} 天），多数女性也会有类似变化。`;
    if (g === '不规律') return `你的周期长度波动较大（${min}–${max} 天），可以留意作息与压力是否稳定。`;
    return '';
  };
  /** 是否整体落在正常区间 21–35 天 */
  const inRange = data.min >= 21 && data.max <= 35;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>周期规律性</Text>

      {data.n === 0 ? (
        <Text style={styles.empty}>
          还需要至少 2 次经期记录（凑满 1 个完整周期）才能算出规律性。在「记录 / 修改」里每记一次经期首日，
          就会多一个可统计的周期。
          {baseCycleLength ? ` 目前基准周期长度设为 ${baseCycleLength} 天。` : ''}
        </Text>
      ) : (
        <>
          {/* ① 判读 Hero：档位徽章 + 一句大白话 */}
          <View style={styles.hero}>
            <View style={[styles.heroBadge, data.grade ? { backgroundColor: gradeColor(data.grade) } : null]}>
              <Text style={styles.heroBadgeText}>{data.grade ?? '—'}</Text>
            </View>
            <Text style={styles.heroText}>{gradePlain(data.grade, data.min, data.max)}</Text>
          </View>

          {/* ② 主指标：平均周期长度（大字）+ 正常区间参照 */}
          <View style={styles.mainStat}>
            <Text style={styles.mainValue}>{Math.round(data.mean)}</Text>
            <Text style={styles.mainUnit}>天</Text>
            <Text style={styles.mainLabel}>平均周期长度（正常区间 21–35 天）</Text>
          </View>

          {/* ③ 次级指标：波动 / 最短–最长 / 周期数 */}
          <View style={styles.subRow}>
            <View style={styles.subCol}>
              <Text style={styles.subValue}>±{data.std.toFixed(1)}</Text>
              <Text style={styles.subLabel}>波动（天）</Text>
            </View>
            <View style={styles.subCol}>
              <Text style={styles.subValue}>{data.min}–{data.max}</Text>
              <Text style={styles.subLabel}>最短–最长（天）</Text>
            </View>
            <View style={styles.subCol}>
              <Text style={styles.subValue}>{data.n}</Text>
              <Text style={styles.subLabel}>完整周期</Text>
            </View>
          </View>

          {/* ④ 区间条：把你的 min–max 落在 20–40 标尺上，绿色=正常区间 */}
          <View style={styles.rangeBox}>
            <View style={styles.rangeTrack}>
              <View style={[styles.rangeNormal, { left: `${normPct(21)}%`, width: `${normPct(35) - normPct(21)}%` }]} />
              <View
                style={[
                  styles.rangeFill,
                  { left: `${normPct(data.min)}%`, width: `${Math.max(normPct(data.max) - normPct(data.min), 2)}%` },
                ]}
              />
              <Text style={styles.rangeBandLabel}>正常区间 21–35 天</Text>
            </View>
            <View style={styles.rangeScale}>
              <Text style={styles.rangeScaleText}>20</Text>
              <Text style={styles.rangeScaleText}>30</Text>
              <Text style={styles.rangeScaleText}>40</Text>
            </View>
          </View>
          <Text style={styles.rangeNote}>
            你的周期长度 {data.min}–{data.max} 天，{inRange ? '处于正常区间' : '部分超出正常区间'}。
          </Text>

          {/* ⑤ 逐周期明细：日期 / 长度 / 准时·晚·早 */}
          <Text style={styles.listTitle}>逐周期</Text>
          <View style={styles.list}>
            {data.recs.slice(0, MAX_ROWS).map((r) => {
              const dev = r.length - data.mean;
              const late = dev >= 0.75;
              const early = dev <= -0.75;
              const dt = parseDate(r.start);
              return (
                <View key={r.start} style={styles.row}>
                  <Text style={styles.rowDate}>{dt.getMonth() + 1}月{dt.getDate()}日</Text>
                  <Text style={styles.rowLen}>{r.length} 天</Text>
                  <Text
                    style={[
                      styles.rowDev,
                      late ? { color: mm.colors.roseDeep } : early ? { color: theme.colors.accentText } : { color: theme.colors.textSub },
                    ]}
                  >
                    {late ? `晚 ${Math.round(dev)} 天` : early ? `早 ${Math.round(-dev)} 天` : '准时'}
                  </Text>
                </View>
              );
            })}
          </View>
          {data.recs.length > MAX_ROWS ? (
            <Text style={styles.more}>
              仅显示最近 {MAX_ROWS} 个周期（共 {data.recs.length} 个）
            </Text>
          ) : null}

          <Text style={styles.foot}>
            正常周期 21–35 天；周期间波动大于 7 天通常视为不规律（ACOG）。「晚 / 早」是相对你自己的平均值，
            不构成医学诊断。
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
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  empty: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },
  // ① 判读 Hero
  hero: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  heroBadge: {
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.emptyFill,
  },
  heroBadgeText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: '#fff' },
  heroText: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.5, color: theme.colors.textBody },
  // ② 主指标
  mainStat: { alignItems: 'center', gap: theme.sp(0.5), marginTop: theme.sp(0.5) },
  mainValue: { fontSize: theme.fontSize.h1, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.h1 },
  mainUnit: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginTop: -theme.sp(1) },
  mainLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ③ 次级指标
  subRow: { flexDirection: 'row', alignItems: 'flex-start' },
  subCol: { flex: 1, alignItems: 'center', gap: theme.sp(0.5) },
  subValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  subLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ④ 区间条
  rangeBox: { gap: theme.sp(0.75), marginTop: theme.sp(0.5) },
  rangeTrack: {
    position: 'relative',
    height: theme.sp(6),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.emptyFill,
    overflow: 'hidden',
  },
  rangeNormal: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(120,190,120,0.30)' },
  rangeFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid },
  rangeBandLabel: {
    position: 'absolute',
    alignSelf: 'center',
    top: 0,
    bottom: 0,
    textAlignVertical: 'center',
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    includeFontPadding: false,
  },
  rangeScale: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeScaleText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  rangeNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ⑤ 逐周期明细
  listTitle: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  list: { gap: theme.sp(1.5) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  rowDate: { width: theme.sp(20), fontSize: theme.fontSize.micro, color: theme.colors.textBody },
  rowLen: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textBody },
  rowDev: { width: theme.sp(16), textAlign: 'right', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  more: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  foot: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, opacity: 0.9 },
});
