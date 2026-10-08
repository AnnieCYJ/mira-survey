/**
 * SymptomStatsPanel —— 症状统计面板（方案二 · 2026-10-07）
 *
 * 用户原话：「这里面生理周期的很多。统计呀、症状的一些个比方说统计啊什么的都挺丰富的。
 *   你参考一下。然后国内外的 App 它都有哪些数据？你给我生成几个 UI 的样式，我看一下。」
 * 参考 Clue / Flo / 美柚 等经期 App 的「周期回顾」维度，用本地已有的真实记录（periodLog）统计三块：
 *   ① 最常记录的症状 —— 每个症状出现的记录天数 / 有症状标签的记录天数，横向条形按频率排序；
 *   ② 经量分布 —— 点滴 / 量少 / 正常 / 量多 四档占比，分段条用粉色系分档表达；
 *   ③ 疼痛程度分布 —— 无痛 / 轻微 / 中度 / 严重 四档占比，分段条用主紫分档表达。
 * 全部来自用户自填数据；无数据时给引导文案，不编造。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import {
  SYMPTOM_TAGS,
  FLOW_LABEL,
  PAIN_LABEL,
  type PeriodDayLog,
  type FlowLevel,
  type PainLevel,
} from '../data/cycleLog';

/** #rrggbb + alpha → rgba()（与 lib/phaseColors.phaseBg 同款做法，避免在组件里写裸色值） */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const FLOW_STEPS: FlowLevel[] = ['spotting', 'light', 'normal', 'heavy'];
const FLOW_ALPHA = [0.28, 0.46, 0.68, 0.92];
const PAIN_STEPS: PainLevel[] = ['none', 'mild', 'moderate', 'severe'];
const PAIN_ALPHA = [0.24, 0.46, 0.68, 0.92];

export default function SymptomStatsPanel({ periodDays }: { periodDays: Record<string, PeriodDayLog> }) {
  const stats = useMemo(() => {
    const days = Object.values(periodDays);
    const tagDays = days.filter((d) => (d.tags ?? []).length > 0);
    const tagTotal = tagDays.length;

    const freq = SYMPTOM_TAGS.map((t) => {
      const count = tagDays.filter((d) => (d.tags ?? []).includes(t.key)).length;
      return { key: t.key, label: t.label, emoji: t.emoji, count, ratio: tagTotal ? count / tagTotal : 0 };
    })
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    const flowDays = days.filter((d) => d.flow);
    const flowTotal = flowDays.length;
    const flow = FLOW_STEPS.map((f, i) => ({
      key: f,
      label: FLOW_LABEL[f],
      alpha: FLOW_ALPHA[i],
      ratio: flowTotal ? flowDays.filter((d) => d.flow === f).length / flowTotal : 0,
    }));

    const painDays = days.filter((d) => d.pain);
    const painTotal = painDays.length;
    const pain = PAIN_STEPS.map((p, i) => ({
      key: p,
      label: PAIN_LABEL[p],
      alpha: PAIN_ALPHA[i],
      ratio: painTotal ? painDays.filter((d) => d.pain === p).length / painTotal : 0,
    }));

    return { tagTotal, freq, flowTotal, flow, painTotal, pain };
  }, [periodDays]);

  const hasAny = stats.tagTotal > 0 || stats.flowTotal > 0 || stats.painTotal > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>症状统计</Text>
      {!hasAny ? (
        <Text style={styles.empty}>
          还没有足够的状态记录。在日历里点任意一天，记录经量、疼痛与身体症状后，这里会汇总你的高频症状与分布。
        </Text>
      ) : (
        <>
          {/* ① 高频症状 */}
          <Text style={styles.blockTitle}>最常记录的症状</Text>
          {stats.freq.length === 0 ? (
            <Text style={styles.blockEmpty}>暂无身体症状记录</Text>
          ) : (
            <View style={styles.freqList}>
              {stats.freq.map((x) => (
                <View key={x.key} style={styles.freqRow}>
                  <Text style={styles.freqLabel} numberOfLines={1}>
                    {x.emoji} {x.label}
                  </Text>
                  <View style={styles.freqTrack}>
                    <View
                      style={[
                        styles.freqFill,
                        {
                          width: `${Math.max(4, Math.round(x.ratio * 100))}%`,
                          backgroundColor: theme.colors.accentSolid,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.freqValue}>
                    {x.count}天 {Math.round(x.ratio * 100)}%
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ② 经量分布 */}
          <Text style={styles.blockTitle}>经量分布</Text>
          {stats.flowTotal === 0 ? (
            <Text style={styles.blockEmpty}>暂无经量记录</Text>
          ) : (
            <DistributionBar
              segments={stats.flow.map((x) => ({
                key: x.key,
                label: x.label,
                ratio: x.ratio,
                color: withAlpha(mm.colors.roseMid, x.alpha),
              }))}
            />
          )}

          {/* ③ 疼痛程度分布 */}
          <Text style={styles.blockTitle}>疼痛程度分布</Text>
          {stats.painTotal === 0 ? (
            <Text style={styles.blockEmpty}>暂无疼痛记录</Text>
          ) : (
            <DistributionBar
              segments={stats.pain.map((x) => ({
                key: x.key,
                label: x.label,
                ratio: x.ratio,
                color: withAlpha(theme.colors.accentSolid, x.alpha),
              }))}
            />
          )}
        </>
      )}
    </View>
  );
}

/** 四档分布：一条分段比例条 + 下方图例（每档颜色深浅递进） */
function DistributionBar({
  segments,
}: {
  segments: { key: string; label: string; ratio: number; color: string }[];
}) {
  const shown = segments.filter((s) => s.ratio > 0);
  return (
    <View>
      <View style={styles.distBar}>
        {shown.map((s) => (
          <View key={s.key} style={[styles.distSeg, { flex: s.ratio, backgroundColor: s.color }]} />
        ))}
      </View>
      <View style={styles.distLegend}>
        {segments.map((s) => (
          <View key={s.key} style={styles.distLegendItem}>
            <View style={[styles.distDot, { backgroundColor: s.color }]} />
            <Text style={styles.distLegendText}>
              {s.label} {Math.round(s.ratio * 100)}%
            </Text>
          </View>
        ))}
      </View>
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
  blockTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.5),
  },
  blockEmpty: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  freqList: { gap: theme.sp(1.5) },
  freqRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  freqLabel: { width: theme.sp(20), fontSize: theme.fontSize.micro, color: theme.colors.textBody },
  freqTrack: {
    flex: 1,
    height: theme.sp(2),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.emptyFill,
    overflow: 'hidden',
  },
  freqFill: { height: '100%', borderRadius: theme.radius.pill },
  freqValue: { width: theme.sp(18), textAlign: 'right', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  distBar: {
    flexDirection: 'row',
    height: theme.sp(3),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    backgroundColor: mm.colors.emptyFill,
  },
  distSeg: { height: '100%' },
  distLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.xs },
  distLegendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  distDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill },
  distLegendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
