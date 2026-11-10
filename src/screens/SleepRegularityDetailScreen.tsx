/**
 * SleepRegularityDetailScreen —— 洞察页「昼夜节律」卡片详情页（日 / 周 / 月 / 年）
 *
 * 骨架与 StressRecoveryDetailScreen / SleepDetailScreen 完全一致：
 *   根渐变 → ScreenContainer → 返回 + 标题 → RangeSwitch（四档全开）→ DateAnchorPicker → 卡片。
 *
 * ★ 2026-11-09（用户）：加回「日」视图 —— 今天这一夜的入睡 / 起床时刻 + 昨天对照的两根柱
 *   + 和昨天的时间差（入睡 / 起床 / 跨度）+ 皮质醇趋势卡。周 / 月 / 年保持规律性统计不变。
 *   ★ 2026-11-09（用户纠偏）：底部「皮质醇趋势」卡直接复用**原来叫「昼夜节律」的那张详情页**
 *     （EmotionCognitiveDetail，自带日 / 周 / 月 / 年四档 + 皮质醇全天趋势），不另起 MetricDetail、不重写页面。
 *
 * 主图 = 入睡 / 起床区间柱：纵轴 18:00（底）→ 次日 12:00（顶），每天一根柱，
 *   下端入睡、上端起床；齐平 = 规律，逐日下移 = 逐渐偏晚。
 * 日 2 根（昨天 / 今天）、周 7 根、月按当月天数、年按 12 个月中位数（365 根不可读）。
 *
 * 数据全部来自 healthStore 逐日真实睡眠时刻，缺时刻留空槽；只做描述性观察，不评分、不诊断。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import BackButton from '../components/BackButton';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import SleepRegularityChart from '../components/SleepRegularityChart';
import AllDayRecoveryCard from '../components/AllDayRecoveryCard';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { type RangeKey } from '../data/metrics';
import {
  analyzeSleepRegularity,
  buildBaselineComparison,
  clockFromNormH,
  collectSleepSeries,
  compareWithYesterday,
  seriesTicks,
  type SleepRangeKey,
} from '../lib/sleepRegularity';

const RANGE_TITLE: Record<SleepRangeKey, string> = {
  day: '今日作息',
  week: '本周作息',
  month: '本月作息',
  year: '本年作息',
};

/** 与昨天的时间差文案：只讲早/晚 + 分钟，不做评价。跨度用「长 / 短」。 */
function diffText(min: number | null | undefined, later = '晚', earlier = '早'): string {
  if (min == null) return '—';
  if (Math.abs(min) < 10) return '差不多';
  return `${min > 0 ? later : earlier} ${Math.abs(min)} 分钟`;
}

/** 一行指标（标签左 / 数值右），与详情页其他卡片同款排版。 */
function StatRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.statRow, last && styles.statRowLast]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export default function SleepRegularityDetailScreen() {
  const navigation = useNavigation<any>();
  const hsVer = useHealthStoreVersion();
  // ★ 2026-11-09（用户）：加回「日」视图 —— 单夜入睡/起床 + 和昨天对比 + 皮质醇趋势卡。
  const [range, setRange] = useState<SleepRangeKey>('week');
  const [anchor, setAnchor] = useState(new Date());
  const isDay = range === 'day';

  const points = useMemo(() => collectSleepSeries(range, anchor), [range, anchor, hsVer]);
  const reg = useMemo(() => analyzeSleepRegularity(points, range), [points, range]);
  const ticks = useMemo(() => seriesTicks(points, range), [points, range]);
  // 跟随日期锚点（周/月/年切到别的日期时基线也跟着走，不再写死今天）
  const cmp = useMemo(() => buildBaselineComparison(anchor), [anchor, hsVer]);
  const yCmp = useMemo(
    () => (isDay ? compareWithYesterday(anchor) : null),
    [isDay, anchor, hsVer],
  );

  const toneOfLabel =
    reg.tone === 'warn' ? mm.colors.honeyCore : reg.tone === 'good' ? mm.colors.limeCore : mm.colors.ink;
  const meanBed = reg.meanBedH != null ? clockFromNormH(reg.meanBedH) : '—';
  const meanWake = reg.meanWakeH != null ? clockFromNormH(reg.meanWakeH) : '—';
  const cmpColor =
    cmp.tone === 'warn' ? mm.colors.honeyCore : cmp.tone === 'good' ? mm.colors.limeCore : mm.colors.inkSoft;
  const yCmpColor =
    yCmp?.tone === 'warn' ? mm.colors.honeyCore
      : yCmp?.tone === 'good' ? mm.colors.limeCore : mm.colors.inkSoft;

  /** ★ 2026-11-09（用户纠偏）：「皮质醇趋势」卡点进**已有的**原「昼夜节律」详情页
   *  （EmotionCognitiveDetail）——那一页本来就有日 / 周 / 月 / 年 RangeSwitch + DateAnchorPicker
   *  与皮质醇全天趋势 / 节律日历，直接复用即可，不再另建一个皮质醇详情页。 */
  const goCortisolDetail = () => navigation.navigate('EmotionCognitiveDetail');

  const cortisolCard = (
    <>
      <Text style={[styles.sectionLabel, { marginTop: theme.space.lg }]}>皮质醇趋势（反推估算）</Text>
      <AllDayRecoveryCard title="皮质醇趋势" onPress={goCortisolDetail} />
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer topFadeColor={theme.colors.bgTop}>
        {/* 顶部返回 + 标题：与压力恢复 / 睡眠恢复详情页同款 h2 + xs 副题 */}
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.titleWrap}>
            <Text style={styles.title}>昼夜节律</Text>
            <Text style={styles.unit}>睡眠作息规律性</Text>
          </View>
        </View>

        {/* ★ 2026-11-09：主视觉仍是「睡眠规律性」（入睡/起床时间图 + 规律性数据）；
            皮质醇趋势作为单独一张可点卡片放在作息数据之后（日视图在对比卡下，周/月/年在页尾）。 */}
        <Text style={styles.sectionLabel}>睡眠作息规律</Text>

        {/* ★ 2026-11-09：四档全开（日 / 周 / 月 / 年），不再 exclude day */}
        <RangeSwitch
          value={range as RangeKey}
          onChange={(r) => setRange(r as SleepRangeKey)}
        />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {isDay ? (
          <>
            {/* 日视图 ①：单夜入睡 / 起床时刻 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{RANGE_TITLE.day}</Text>
              <Text style={styles.clockLine}>
                {yCmp?.today.bedClock ?? '—'} → {yCmp?.today.wakeClock ?? '—'}
              </Text>
              <Text style={styles.chartHint}>
                {yCmp?.today.durationH != null
                  ? `这一夜跨度 ${yCmp.today.durationH.toFixed(1)} 小时 · 下端为入睡、上端为起床`
                  : '今天还没有带入睡 / 起床时刻的记录'}
              </Text>
            </View>

            {/* 日视图 ②：昨天 / 今天两根区间柱，一眼可比 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>入睡 / 起床时间</Text>
              <Text style={styles.chartHint}>左柱昨天、右柱今天；下端入睡、上端起床</Text>
              <SleepRegularityChart points={points} height={210} ticks={ticks} />
              <View style={styles.legendRow}>
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.limeCore }]}>●</Text> 入睡
                </Text>
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.ink }]}>●</Text> 起床
                </Text>
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.inkFaint }]}>┆</Text> 无记录
                </Text>
              </View>
              {yCmp?.today.bedH == null || yCmp?.yesterday.bedH == null ? (
                <Text style={styles.emptyText}>有一天没有带入睡 / 起床时刻的记录，那一格保留空槽。</Text>
              ) : null}
            </View>

            {/* 日视图 ③：和昨天比（入睡 / 起床 / 跨度，全部真实时刻差） */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>和昨天比</Text>
              <Text style={[styles.headline, { color: yCmpColor }]}>{yCmp?.headline ?? '—'}</Text>
              <StatRow label="入睡" value={diffText(yCmp?.diffBedMin)} />
              <StatRow label="起床" value={diffText(yCmp?.diffWakeMin)} />
              <StatRow label="一夜跨度" value={diffText(yCmp?.diffDurationMin, '长', '短')} last />
            </View>

            {/* 日视图 ④：皮质醇趋势卡（可点进日/周/月/年详情页） */}
            {cortisolCard}
          </>
        ) : (
          <>
            {/* Hero：规律性状态 + 平均时刻 + 描述性结论 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{RANGE_TITLE[range]}</Text>
              <View style={styles.heroRow}>
                <Text style={[styles.heroVal, { color: toneOfLabel }]} numberOfLines={1} adjustsFontSizeToFit>
                  {reg.label}
                </Text>
                <View style={styles.heroMeta}>
                  <Text style={styles.heroNote}>平均入睡 {meanBed}</Text>
                  <Text style={styles.heroNote}>平均起床 {meanWake}</Text>
                </View>
              </View>
              <Text style={styles.heroAnalysis}>{reg.summary}</Text>
            </View>

            {/* 主图：区间柱（无数据也保留网格 + 空槽） */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>入睡 / 起床时间</Text>
              <Text style={styles.chartHint}>下端为入睡、上端为起床，柱高即这一夜的跨度</Text>
              <SleepRegularityChart
                points={points}
                height={210}
                baselineBedH={cmp.baselineBedH}
                ticks={ticks}
              />
              <View style={styles.legendRow}>
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.limeCore }]}>●</Text> 入睡
                </Text>
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.ink }]}>●</Text> 起床
                </Text>
                {cmp.baselineBedH != null ? (
                  <Text style={styles.legendItem}>
                    <Text style={[styles.legendDot, { color: mm.colors.honeyCore }]}>┄</Text> 入睡基线
                  </Text>
                ) : null}
                <Text style={styles.legendItem}>
                  <Text style={[styles.legendDot, { color: mm.colors.inkFaint }]}>┆</Text> 无记录
                </Text>
              </View>
              {range === 'year' ? (
                <Text style={styles.chartHint}>年视图按每月有效夜的中位数绘制。</Text>
              ) : null}
              {reg.n === 0 ? (
                <Text style={styles.emptyText}>这段时间没有带入睡 / 起床时刻的记录，网格仍保留。</Text>
              ) : null}
            </View>

            {/* 最近一晚 vs 前面基线（结论只讲早 / 晚 + 分钟数） */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>最近一晚 · 相比前面</Text>
              <Text style={styles.clockLine}>
                {cmp.latest?.bedClock ?? '—'} → {cmp.latest?.wakeClock ?? '—'}
              </Text>
              <Text style={[styles.headline, { color: cmpColor }]}>{cmp.headline}</Text>
              {cmp.baselineClock != null ? (
                <Text style={styles.chartHint}>
                  前面 {cmp.baselineN} 晚的入睡基线 {cmp.baselineClock}（中位数）
                </Text>
              ) : null}
            </View>

            {/* 数据概览 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>这段时间的记录</Text>
              <StatRow label="有效记录" value={`${reg.n} ${range === 'year' ? '个月' : '晚'}`} />
              <StatRow
                label="入睡时间波动"
                value={reg.sdBedMin != null ? `约 ${Math.round(reg.sdBedMin)} 分钟` : '—'}
              />
              <StatRow
                label="平均一夜跨度"
                value={reg.meanDurationH != null ? `${reg.meanDurationH.toFixed(1)} 小时` : '—'}
              />
              <StatRow
                label="趋势"
                value={
                  reg.slopeMinPerStep != null && Math.abs(reg.slopeMinPerStep) >= 10
                    ? `平均${range === 'year' ? '每月' : '每晚'}${reg.slopeMinPerStep > 0 ? '晚' : '早'}约 ${Math.round(Math.abs(reg.slopeMinPerStep))} 分钟`
                    : '没有持续的单方向变化'
                }
                last
              />
            </View>

            {/* 周/月/年：皮质醇趋势卡同样可点进详情页 */}
            {cortisolCard}
          </>
        )}

        <Text style={styles.foot}>只描述作息时间的变化，不构成诊断或评分。皮质醇趋势按生理信号反推，为相对指数，非血液检测。</Text>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
  titleWrap: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: mm.colors.ink },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  sectionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginTop: theme.space.md,
    marginBottom: theme.space.xs,
  },

  card: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: theme.sp(1.5),
    gap: theme.space.sm,
  },
  heroVal: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.semibold,
    lineHeight: theme.fontSize.h1 * 1.2,
    flexShrink: 1,
  },
  heroMeta: { alignItems: 'flex-end' },
  heroNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  heroAnalysis: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textBody,
    lineHeight: theme.fontSize.sm * 1.55,
    marginTop: theme.sp(1.5),
  },
  chartHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1), lineHeight: 17 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.sp(1.5),
  },
  legendItem: { fontSize: theme.fontSize.tiny, color: mm.colors.inkSoft },
  legendDot: { fontSize: theme.fontSize.tiny },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.space.sm },
  clockLine: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginTop: theme.sp(1.5),
  },
  headline: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    marginTop: theme.sp(0.75),
    lineHeight: theme.fontSize.sm * 1.5,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.ui.borderSoft,
  },
  statRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  statLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textInk, flex: 1 },
  statValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  foot: {
    fontSize: theme.fontSize.tiny,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginBottom: theme.space.md,
  },
});
