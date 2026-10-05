/**
 * SleepRhythmCard —— 日视图「睡眠节律」卡
 *
 * 对齐 preview/sleep-rhythm.html v9 原型：
 *   卡头「睡眠节律」+ 右侧作息类型胶囊（晚睡型 / 早起型 / 常规）；
 *   下方标题「皮质醇节律趋势图」+ 全天趋势（复用 App 的 TrendChart，与洞察页同源管线）；
 *   再下方 4 格：整体水平 / 全天峰值时刻 / 昼夜起伏幅度 / 节律模式。
 *
 * ★「整体水平」那格**可点击** → 弹出 CortisolAnomalySheet，明确指出当天皮质醇
 *   是偏高 / 节律偏平 / 峰值后移。
 *
 * 数据全部真实：collectSamplesForDay(dk) → analyzeCortisol（cosinor 拟合）。
 * 历史日不套用「偏高」判定（无 14 天基线不可信），与 RhythmCalendar 的口径一致。
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { analyzeCortisol, fitCosinor } from '../lib/cortisolRhythm';
import { collectSamplesForDay, TrendChart, getSleepWindow } from './CortisolRhythmCard';
import CortisolAnomalySheet, { cortKindOf } from './CortisolAnomalySheet';

/** 皮质醇 acrophase（峰值时刻）→ 作息类型。阈值对齐原型：>10 点偏晚，<6 点偏早 */
function chronotypeOf(acrophaseH: number | null): { label: string; style: 'lark' | 'night' | 'flat' } | null {
  if (acrophaseH == null || !Number.isFinite(acrophaseH)) return null;
  if (acrophaseH > 10) return { label: `晚睡型 · 峰值 ${fmtClock(acrophaseH)}`, style: 'night' };
  if (acrophaseH < 6) return { label: `早起型 · 峰值 ${fmtClock(acrophaseH)}`, style: 'lark' };
  return { label: '常规作息', style: 'flat' };
}
function fmtClock(h: number): string {
  const hh = Math.floor(h);
  const mmv = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mmv).padStart(2, '0')}`;
}

interface Props {
  /** 锚点日（YYYY-MM-DD） */
  dk: string;
  /** 该日是否为「今天」——决定能否用 14 天基线判偏高 */
  isToday: boolean;
}

export default function SleepRhythmCard({ dk, isToday }: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const data = useMemo(() => {
    const samples = collectSamplesForDay(dk);
    if (samples.length < 4) return null;
    // ★ 与 EmotionCognitiveDetailScreen.dayAbnormal 同口径：历史日 baselineDays=1（不判偏高）
    const r = analyzeCortisol(samples, isToday ? 14 : 1);
    const co = fitCosinor(samples);
    const kind = cortKindOf({ high: r.today.high, dys: r.today.dys });
    return { r, kind, co, n: samples.length };
  }, [dk, isToday]);

  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>睡眠节律</Text>
        <Text style={styles.empty}>
          这一天暂无足够的皮质醇数据。连上戒指并开启自动监测后，约 1 天即可开始分析昼夜节律。
        </Text>
      </View>
    );
  }

  const { r, kind, co, n } = data;
  const chrono = chronotypeOf(Number.isFinite(co.acrophaseH) ? co.acrophaseH : null);
  const ampOk = Number.isFinite(co.amplitude) && co.amplitude > 0;
  // 昼夜起伏幅度：cosinor 振幅（相对中值的百分比），过低即节律偏平
  const ampPct = ampOk && co.mesor > 0 ? (co.amplitude / co.mesor) * 100 : null;
  const ampFlat = ampPct != null && ampPct < 45;
  const levelText = kind === 'normal' ? '正常' : kind === 'high' ? '偏高' : kind === 'late' ? '节律紊乱' : '偏低';
  const sleepWindow = getSleepWindow(dk);

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>睡眠节律</Text>
        {chrono ? (
          <View style={[styles.chrono, chrono.style === 'night' ? styles.chronoNight : chrono.style === 'lark' ? styles.chronoLark : styles.chronoFlat]}>
            <Text style={[styles.chronoText, chrono.style === 'night' ? { color: mm.colors.honeyDeep } : chrono.style === 'lark' ? { color: mm.colors.limeDeep } : { color: mm.colors.inkSoft }]}>
              {chrono.label}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.chartTitle}>皮质醇节律趋势图</Text>
      <View style={{ marginTop: theme.space.xs }}>
        <TrendChart r={r} sleepWindow={sleepWindow} mainDayDk={dk} />
      </View>

      <View style={styles.grid}>
        {/* 整体水平 —— 可点击，弹出当天异常说明 */}
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`皮质醇整体水平 ${levelText}，点击查看说明`}
        >
          <View style={styles.cellHeadRow}>
            <Text style={[styles.cellVal, kind !== 'normal' && { color: kind === 'late' ? mm.colors.roseDeep : mm.colors.honeyDeep }]}>{levelText}</Text>
            <Text style={styles.chevHint}>›</Text>
          </View>
          <Text style={styles.cellLab}>整体水平（vs 14 天基线）</Text>
        </Pressable>

        <View style={styles.cell}>
          <Text style={styles.cellVal}>{Number.isFinite(co.acrophaseH) ? fmtClock(co.acrophaseH) : '—'}</Text>
          <Text style={styles.cellLab}>全天峰值时刻（正常 06–10）</Text>
        </View>

        <View style={styles.cell}>
          <Text style={[styles.cellVal, ampFlat && { color: mm.colors.honeyDeep }]}>{ampPct != null ? (ampFlat ? '偏平' : '正常') : '—'}</Text>
          <Text style={styles.cellLab}>昼夜起伏幅度</Text>
        </View>

        <View style={styles.cell}>
          <Text style={styles.cellVal}>{Number.isFinite(co.r2) ? `规律 ${Math.round(Math.max(0, Math.min(1, co.r2)) * 100)}%` : '—'}</Text>
          <Text style={styles.cellLab}>节律模式（R² 拟合）</Text>
        </View>
      </View>

      <Text style={styles.disclaimer}>
        基于戒指压力代理值（非化验级皮质醇）· 当日样本 {n} 条 · 仅供参考
      </Text>

      <CortisolAnomalySheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        kind={kind}
        dateLabel={dk}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  chrono: { paddingHorizontal: theme.space.sm, paddingVertical: 3, borderRadius: theme.radius.pill },
  chronoLark: { backgroundColor: mm.colors.limeSoft },
  chronoNight: { backgroundColor: mm.colors.honeySoft },
  chronoFlat: { backgroundColor: 'rgba(31,29,26,0.07)' },
  chronoText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  chartTitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.md },
  cell: {
    width: '48.5%',
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.sm,
    padding: theme.space.sm,
  },
  cellHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cellVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  cellLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },
  chevHint: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.accentText },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.sm, lineHeight: 20 },
  disclaimer: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.sm, opacity: 0.8 },
});
