/**
 * SymptomPhaseMatrix —— 症状 × 周期相位 分布矩阵（方案三 · 2026-10-07）
 *
 * 用户原话：「这里面生理周期的很多统计呀、症状的一些个比方说统计啊什么的都挺丰富的……
 *   你给我生成几个 UI 的样式，我看一下。」
 * 参考 Clue 的「症状与周期阶段关联」视图：行 = 12 个身体症状，列 = 经期 / 卵泡期 / 排卵期 / 黄体期。
 * 格子值 = 该相位下出现该症状的记录天数 / 该相位下有记录的天数（只统计用户真实填过的日子，不臆造分母）。
 * 色深分档（低 / 中 / 高），底部给「低 → 高」图例，帮助看出「哪个症状偏爱哪个相位」。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { phaseOfDay } from '../lib/hormoneTrend';
import { parseDate, type CycleLog } from '../lib/cycleMath';
import { PHASE_LABEL, PHASE_COLOR, type PhaseKey } from '../lib/phaseColors';
import { SYMPTOM_TAGS, type PeriodDayLog } from '../data/cycleLog';
import type { RingState } from '../ble/RingBleManager';

const COLS: PhaseKey[] = ['period', 'follicular', 'ovulation', 'luteal'];

/** #rrggbb + alpha → rgba()（与 lib/phaseColors.phaseBg 同款做法） */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 比例 → 色深档（低 / 中 / 高）。高值用 purpleDeep 实底 + 白字，保证对比度达标。 */
function cellStyle(ratio: number): { bg: string; fg: string; level: 0 | 1 | 2 | 3 } {
  if (ratio <= 0) return { bg: mm.colors.emptyFill, fg: theme.colors.textSub, level: 0 };
  if (ratio < 0.34) return { bg: withAlpha(theme.colors.accentSolid, 0.16), fg: theme.colors.textTitle, level: 1 };
  if (ratio < 0.67) return { bg: withAlpha(theme.colors.accentSolid, 0.34), fg: theme.colors.textTitle, level: 2 };
  return { bg: mm.colors.purpleDeep, fg: theme.colors.textWhite, level: 3 };
}

export default function SymptomPhaseMatrix({
  periodDays,
  log,
  ring,
}: {
  periodDays: Record<string, PeriodDayLog>;
  log: CycleLog | null;
  ring: RingState;
}) {
  const { rows, hasData } = useMemo(() => {
    const days = Object.values(periodDays);
    const phaseOfDate: Record<string, PhaseKey> = {};
    const colTotals: Record<string, number> = {};
    for (const d of days) {
      const ph = phaseOfDay(log, parseDate(d.date), ring);
      if (ph === 'unknown') continue;
      phaseOfDate[d.date] = ph;
      colTotals[ph] = (colTotals[ph] ?? 0) + 1;
    }
    const rows = SYMPTOM_TAGS.map((t) => {
      const cells = COLS.map((c) => {
        const total = colTotals[c] ?? 0;
        const hit = days.filter((d) => phaseOfDate[d.date] === c && (d.tags ?? []).includes(t.key)).length;
        return { phase: c, total, hit, ratio: total ? hit / total : 0 };
      });
      return { key: t.key, label: t.label, cells, anyHit: cells.some((x) => x.hit > 0) };
    }).filter((r) => r.anyHit);
    const hasData = rows.length > 0 && COLS.some((c) => (colTotals[c] ?? 0) > 0);
    return { rows, hasData };
  }, [periodDays, log, ring]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>症状 × 相位分布</Text>
      {!hasData ? (
        <Text style={styles.empty}>
          记录几天身体症状后，这里会按经期 / 卵泡期 / 排卵期 / 黄体期汇总，帮你看出哪些症状偏爱哪个阶段。
        </Text>
      ) : (
        <>
          {/* 表头：列 = 四相位 */}
          <View style={styles.headRow}>
            <View style={styles.labelCol} />
            {COLS.map((c) => (
              <View key={c} style={styles.colHead}>
                <View style={[styles.colDot, { backgroundColor: PHASE_COLOR[c] }]} />
                <Text style={styles.colHeadText}>{PHASE_LABEL[c]}</Text>
              </View>
            ))}
          </View>

          {/* 行 = 症状；格子 = 该相位下的出现率 */}
          {rows.map((r) => (
            <View key={r.key} style={styles.row}>
              <View style={styles.labelCol}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {r.label}
                </Text>
              </View>
              {r.cells.map((cell) => {
                const cs = cellStyle(cell.ratio);
                return (
                  <View key={cell.phase} style={styles.cellWrap}>
                    <View style={[styles.cell, { backgroundColor: cs.bg }]}>
                      {cell.hit > 0 ? (
                        <Text style={[styles.cellText, { color: cs.fg }]}>{Math.round(cell.ratio * 100)}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          {/* 图例：低 → 高 */}
          <View style={styles.legend}>
            <Text style={styles.legendText}>低</Text>
            {[1, 2, 3].map((lv) => (
              <View key={lv} style={[styles.legendSwatch, { backgroundColor: cellStyle(lv === 1 ? 0.2 : lv === 2 ? 0.5 : 0.8).bg }]} />
            ))}
            <Text style={styles.legendText}>高</Text>
            <Text style={styles.legendHint}>格内数字 = 该阶段记录下来出现该症状的天数占比</Text>
          </View>
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
    gap: theme.space.xs,
  },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  empty: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.7, color: theme.colors.textSub },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: theme.sp(0.5) },
  labelCol: { width: theme.sp(20), justifyContent: 'center' },
  colHead: { flex: 1, alignItems: 'center', gap: theme.sp(0.5) },
  colDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.radius.pill },
  colHeadText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(1) },
  rowLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textBody },
  cellWrap: { flex: 1, paddingHorizontal: theme.sp(0.5) },
  cell: { height: theme.sp(5), borderRadius: theme.radius.sm, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold as any },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.sp(1), marginTop: theme.space.xs },
  legendSwatch: { width: theme.sp(3), height: theme.sp(2), borderRadius: theme.radius.sm },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legendHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.85 },
});
