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
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { chart } from '../theme/chart';
import EmptyChart from './charts/EmptyChart';
import {
  SYMPTOM_TAGS,
  FLOW_LABEL,
  PAIN_LABEL,
  type PeriodDayLog,
  type FlowLevel,
  type PainLevel,
} from '../data/cycleLog';

const FLOW_STEPS: FlowLevel[] = ['spotting', 'light', 'normal', 'heavy'];
const PAIN_STEPS: PainLevel[] = ['none', 'mild', 'moderate', 'severe'];
// ★ 2026-10-10（bar-design-unified-spec 规则1/4）：症状=粉，四档用 roseSoft→roseDeep 同相递进
//   取代「基色 + alpha 渐变」（透明度只允许 1 / 0.12，轻重用色相档位表达）
const ROSE_TIERS = ['roseSoft', 'roseMid', 'roseCore', 'roseDeep'] as const;
const TIER_COLOR = {
  roseSoft: mm.colors.roseSoft,
  roseMid: mm.colors.roseMid,
  roseCore: mm.colors.roseCore,
  roseDeep: mm.colors.roseDeep,
} as const;

/**
 * ★ 2026-10-09（menstrual-cycle-preview.html 完全还原）：
 *   高频症状常驻；经量分布 / 疼痛程度分布 / 症状×相位分布（children 内嵌，embedded 模式）
 *   收进「查看完整症状分布」mhRow 折叠区（默认收起，对齐 .mhRow/.mhSec）。
 */
export default function SymptomStatsPanel({
  periodDays,
  children,
}: {
  periodDays: Record<string, PeriodDayLog>;
  /** 内嵌到折叠区的内容（SymptomPhaseMatrix embedded 模式） */
  children?: React.ReactNode;
}) {
  // ★ 2026-10-09：完整症状分布折叠区，默认收起
  const [fullOpen, setFullOpen] = useState(false);
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
      alpha: 1,
      tierColor: TIER_COLOR[ROSE_TIERS[i]],
      ratio: flowTotal ? flowDays.filter((d) => d.flow === f).length / flowTotal : 0,
    }));

    const painDays = days.filter((d) => d.pain);
    const painTotal = painDays.length;
    const pain = PAIN_STEPS.map((p, i) => ({
      key: p,
      label: PAIN_LABEL[p],
      alpha: 1,
      tierColor: TIER_COLOR[ROSE_TIERS[i]],
      ratio: painTotal ? painDays.filter((d) => d.pain === p).length / painTotal : 0,
    }));

    return { tagTotal, freq, flowTotal, flow, painTotal, pain };
  }, [periodDays]);

  const hasAny = stats.tagTotal > 0 || stats.flowTotal > 0 || stats.painTotal > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>症状统计</Text>
      {!hasAny ? (
        /* ★ 2026-11-06（用户：「症状统计也是可以是空的，就是没有数据的一些个空的图表。不要全部是描述文字。」）
           → 无数据时展示**空图表骨架 + 空分布条**，不再是一段说明文字。 */
        <View style={styles.emptyChartBox}>
          <EmptyChart height={chart.plot.s} />
          <Text style={styles.blockTitle}>经量分布</Text>
          <View style={styles.distBar}>
            {FLOW_STEPS.map((f, i) => (
              <View key={f} style={[styles.distSeg, { flex: 1, backgroundColor: mm.colors.emptyFill, opacity: 0.5 }]} />
            ))}
          </View>
          <Text style={styles.blockTitle}>疼痛程度分布</Text>
          <View style={styles.distBar}>
            {PAIN_STEPS.map((p, i) => (
              <View key={p} style={[styles.distSeg, { flex: 1, backgroundColor: mm.colors.emptyFill, opacity: 0.5 }]} />
            ))}
          </View>
        </View>
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
                          backgroundColor: mm.colors.roseCore,
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

          {/* ★ 2026-10-09（menstrual-cycle-preview）：完整分布默认收起，mhRow 折叠头 */}
          <TouchableOpacity
            style={styles.mhRow}
            activeOpacity={0.7}
            onPress={() => setFullOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={fullOpen ? '收起完整症状分布' : '展开完整症状分布'}
          >
            <Text style={styles.mhLabel}>查看完整症状分布</Text>
            <View style={[styles.mhChev, fullOpen && styles.mhChevOpen]} />
          </TouchableOpacity>
          {fullOpen ? (
            <>
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
                color: x.tierColor,
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
                color: x.tierColor,
              }))}
            />
          )}

          {/* ④ 症状 × 相位分布（menstrual-cycle-preview：同在折叠区内，embedded 模式） */}
          {children ? (
            <>
              <Text style={styles.blockTitle}>症状 × 相位分布</Text>
              {children}
            </>
          ) : null}
            </>
          ) : null}
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
  // ★ 2026-11-06（用户：症状统计无数据时展示空图表，不要全是文字）
  emptyChartBox: { gap: theme.sp(1.5) },
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
    height: theme.sp(2.25), // ★ 2026-10-09（.freqTrack 9px）
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.emptyFill,
    overflow: 'hidden',
  },
  freqFill: { height: '100%', borderRadius: theme.radius.pill },
  freqValue: { width: theme.sp(18), textAlign: 'right', fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  // ★ 2026-10-10（用户：灰底折叠头统一去掉 → 无灰底无方框，仅顶部发丝线 + 左标签 + 右 chevron）
  mhRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space.sm,
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: 0,
  },
  mhLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textInk, fontWeight: theme.weight.semibold as any },
  mhChev: {
    width: theme.sp(2),
    height: theme.sp(2),
    borderRightWidth: 1.6,
    borderBottomWidth: 1.6,
    borderColor: theme.colors.textSub,
    transform: [{ rotate: '45deg' }],
    marginRight: theme.sp(0.75),
  },
  mhChevOpen: { transform: [{ rotate: '-135deg' }] },
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
