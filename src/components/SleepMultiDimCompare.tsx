/**
 * SleepMultiDimCompare —— 「多维度对比」表
 *
 * ★ 单参照期原则（用户明确要求）：**同量级比同量级**
 *   周视图 → 本周 vs 上周；月视图 → 本月 vs 上月；年视图 → 本年 vs 去年。
 *   绝不把「上周 / 上月 / 去年」三个口径并排列在每一行下面 —— 那样维度错位、
 *   读起来也乱。只保留 1 个参照列，表头随 range 变。
 *
 * 覆盖：皮质醇整体水平、**皮质醇异常天数**、睡眠恢复分、平均睡眠时长、深睡占比。
 *
 * 着色：参照期相对当前是更优（绿）还是更差（红），方向由每个指标自己的
 * `dir` 决定（心率 / 异常天数越低越好）。数值本身始终可读，不靠颜色单独传达。
 *
 * ★ 诚实边界：任一格无数据显「—」，不插值不编造。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

export interface MetricRow {
  key: string;
  label: string;
  /** 单位（拼在数值后，小字） */
  unit?: string;
  /** 'high' = 越大越好；'low' = 越小越好 */
  dir: 'high' | 'low';
  cur: number | null;
  /** 上一同量级周期（周→上周 / 月→上月 / 年→去年） */
  prev: number | null;
  /** 档位型指标（如皮质醇整体水平）：值映射为展示文案 + 是否为「好」 */
  band?: Record<string, { text: string; good: boolean }>;
}

interface Props {
  rows: MetricRow[];
  /** 当前周期名，如「本周」 */
  curLabel: string;
  /** 参照周期名，如「上周」 */
  prevLabel: string;
  /** 副标题：说明对照口径 */
  subtitle?: string;
}

export default function SleepMultiDimCompare({ rows, curLabel, prevLabel, subtitle }: Props) {
  const anyPrev = rows.some((r) => r.prev != null);

  return (
    <View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.colLabel]}>指标</Text>
        <Text style={[styles.headerCell, styles.colNum]}>{curLabel}</Text>
        <Text style={[styles.headerCell, styles.colNum]}>{prevLabel}</Text>
      </View>

      {rows.map((r, ri) => (
        <View key={r.key} style={[styles.row, ri === rows.length - 1 && styles.rowLast]}>
          <Text style={[styles.labelCell, styles.colLabel]} numberOfLines={1}>{r.label}</Text>
          <View style={styles.colNum}>
            {r.band ? (
              <Pill band={r.band[String(r.cur)]} />
            ) : (
              <Text style={styles.curText}>{fmt(r.cur, r.unit)}</Text>
            )}
          </View>
          <View style={styles.colNum}>
            {r.band ? (
              <Pill band={r.band[String(r.prev)]} />
            ) : (
              <Text
                style={[
                  styles.refText,
                  r.prev == null || r.cur == null ? null
                    : toneOf(r.prev, r.cur, r.dir) === 'good' ? styles.good
                    : toneOf(r.prev, r.cur, r.dir) === 'bad' ? styles.bad : null,
                ]}
              >
                {fmt(r.prev, r.unit)}
              </Text>
            )}
          </View>
        </View>
      ))}

      {/* 图例：颜色只是辅助，数值本身始终可读 */}
      {anyPrev ? (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: theme.colors.trendUp }]} />
            <Text style={styles.legendText}>优于{curLabel}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: theme.colors.trendDown }]} />
            <Text style={styles.legendText}>劣于{curLabel}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.legendText}>· {prevLabel}暂无记录</Text>
      )}
    </View>
  );
}

function toneOf(v: number, cur: number, dir: 'high' | 'low'): 'good' | 'bad' | 'neutral' {
  if (v === cur) return 'neutral';
  const better = dir === 'high' ? v > cur : v < cur;
  return better ? 'good' : 'bad';
}

function fmt(v: number | null, unit?: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return unit ? `${n}${unit}` : n;
}

function Pill({ band }: { band?: { text: string; good: boolean } }) {
  if (!band) return <Text style={styles.refText}>—</Text>;
  return (
    <View style={[styles.pill, { backgroundColor: band.good ? mm.colors.limeSoft : mm.colors.honeySoft }]}>
      <Text style={[styles.pillText, { color: band.good ? mm.colors.limeDeep : mm.colors.honeyDeep }]}>{band.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: theme.space.sm, paddingBottom: theme.space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.ui.borderSoft,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: theme.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.ui.borderSoft,
  },
  rowLast: { borderBottomWidth: 0 },
  colLabel: { flex: 1.7, textAlign: 'left' },
  colNum: { flex: 1, alignItems: 'center' },
  headerCell: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontWeight: theme.weight.semibold },
  labelCell: { fontSize: theme.fontSize.xs, color: theme.colors.textTitle, fontWeight: theme.weight.medium, paddingRight: 2 },
  curText: { fontSize: theme.fontSize.xs, color: mm.colors.ink, fontWeight: theme.weight.bold },
  refText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  good: { color: theme.colors.trendUp, fontWeight: theme.weight.semibold },
  bad: { color: theme.colors.trendDown, fontWeight: theme.weight.semibold },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.pill },
  pillText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginTop: theme.space.sm, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
