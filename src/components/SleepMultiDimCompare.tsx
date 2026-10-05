/**
 * SleepMultiDimCompare —— 「多维度对比」表
 *
 * 对齐 preview/sleep-rhythm.html v9 原型：表头 `指标 | 当前 | 上周 | 上月 | 去年`，
 * 覆盖皮质醇整体水平、**皮质醇异常天数**、睡眠恢复分、平均睡眠时长、深睡占比、
 * 夜间静息心率、夜间 HRV。
 *
 * 着色规则：每个参照期按「相对当前是更优还是更差」染色（绿=更优 / 红=更差），
 * 方向由每个指标自己的 `dir` 决定（心率 / 异常天数越低越好）。
 *
 * ★ 诚实边界：任一格无数据一律显「—」（不插值、不编造）；某参照期整体无数据时
 *   提示「该周期无记录」，避免把空值误读成 0。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';

/** 参照期键：上周 / 上月 / 去年 */
export type RefKey = 'lw' | 'lm' | 'ly';

export const REF_LABEL: Record<RefKey, string> = { lw: '上周', lm: '上月', ly: '去年' };
export const REF_ORDER: RefKey[] = ['lw', 'lm', 'ly'];

/** 单个指标在四个窗口里的值；null = 无数据 */
export interface MetricRow {
  key: string;
  label: string;
  /** 单位（拼在数值后，小字） */
  unit?: string;
  /** 'high' = 越大越好；'low' = 越小越好 */
  dir: 'high' | 'low';
  cur: number | null;
  refs: Record<RefKey, number | null>;
  /** 档位型指标（如皮质醇整体水平）：值映射为展示文案 + 是否为「好」 */
  band?: Record<string, { text: string; good: boolean }>;
}

interface Props {
  rows: MetricRow[];
  /** 副标题：说明对照口径 */
  subtitle?: string;
}

export default function SleepMultiDimCompare({ rows, subtitle }: Props) {
  const anyRefData = rows.some((r) => REF_ORDER.some((k) => r.refs[k] != null));

  return (
    <View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.colLabel]}>指标</Text>
        <Text style={[styles.headerCell, styles.colNum]}>当前</Text>
        {REF_ORDER.map((k) => (
          <Text key={k} style={[styles.headerCell, styles.colNum]}>{REF_LABEL[k]}</Text>
        ))}
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
          {REF_ORDER.map((k) => {
            const v = r.refs[k];
            const tone = v == null || r.cur == null || r.band ? 'neutral' : toneOf(v, r.cur!, r.dir);
            return (
              <View key={k} style={styles.colNum}>
                {r.band ? (
                  <Pill band={r.band[String(v)]} />
                ) : (
                  <Text style={[styles.refText, tone === 'good' ? styles.good : tone === 'bad' ? styles.bad : null]}>
                    {fmt(v, r.unit)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}

      {/* 图例：颜色只是辅助，数值本身始终可读（不靠颜色单独传达信息） */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: theme.colors.trendUp }]} />
          <Text style={styles.legendText}>优于当前</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: theme.colors.trendDown }]} />
          <Text style={styles.legendText}>劣于当前</Text>
        </View>
        {!anyRefData && <Text style={styles.legendText}>· 对照周期暂无记录</Text>}
      </View>
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
  colLabel: { flex: 1.5, textAlign: 'left' },
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
