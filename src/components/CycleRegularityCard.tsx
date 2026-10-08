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
          {/* 概览：平均 / 波动 / 档位 */}
          <View style={styles.sumRow}>
            <View style={styles.sumCol}>
              <Text style={styles.sumValue}>{Math.round(data.mean)}</Text>
              <Text style={styles.sumLabel}>平均周期（天）</Text>
            </View>
            <View style={styles.sumCol}>
              <Text style={styles.sumValue}>±{data.std.toFixed(1)}</Text>
              <Text style={styles.sumLabel}>波动（天）</Text>
            </View>
            <View style={styles.sumCol}>
              <Text style={[styles.sumValue, data.grade ? { color: gradeColor(data.grade) } : null]}>
                {data.grade ?? '—'}
              </Text>
              <Text style={styles.sumLabel}>规律性</Text>
            </View>
          </View>

          <Text style={styles.subStat}>
            最短 {data.min} 天 · 最长 {data.max} 天 · 共 {data.n} 个完整周期
          </Text>

          {/* 逐周期：起点 / 长度条 / 长度 / 晚·早 */}
          <View style={styles.list}>
            {data.recs.slice(0, MAX_ROWS).map((r) => {
              const dev = r.length - data.mean;
              const late = dev >= 0.75;
              const early = dev <= -0.75;
              const dt = parseDate(r.start);
              const pct = Math.max(8, Math.min(100, ((r.length - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
              return (
                <View key={r.start} style={styles.row}>
                  <View style={styles.rowDateCol}>
                    <Text style={styles.rowDate}>
                      {dt.getMonth() + 1}月{dt.getDate()}日
                    </Text>
                    {r.symptomDays > 0 ? (
                      <Text style={styles.rowSub}>症状 {r.symptomDays} 天</Text>
                    ) : null}
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.rowLen}>{r.length}天</Text>
                  <Text
                    style={[
                      styles.rowDev,
                      late ? { color: mm.colors.roseDeep } : early ? { color: theme.colors.accentText } : null,
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
  sumRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sumCol: { flex: 1, alignItems: 'center', gap: theme.sp(0.5) },
  sumValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sumLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  subStat: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  list: { gap: theme.sp(1.5) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  rowDateCol: { width: theme.sp(20) },
  rowDate: { fontSize: theme.fontSize.micro, color: theme.colors.textBody },
  rowSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.9 },
  track: {
    flex: 1,
    height: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.emptyFill,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentSolid },
  rowLen: { width: theme.sp(9), textAlign: 'right', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  rowDev: { width: theme.sp(14), textAlign: 'right', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  more: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  foot: { fontSize: theme.fontSize.micro, lineHeight: theme.fontSize.micro * 1.6, color: theme.colors.textSub, opacity: 0.9 },
});
