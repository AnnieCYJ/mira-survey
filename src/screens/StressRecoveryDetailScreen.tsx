/**
 * StressRecoveryDetailScreen —— 洞察页「压力恢复」卡片详情页（日 / 周 / 月 / 年）
 *
 * ★ 2026-11-07（用户）：结构对齐其他详情页（睡眠恢复 / 身心压力）—— 顶部返回 + 标题 + 副标题，
 *   其下「日/周/月/年」切换（RangeSwitch）→「日期步进器」（DateAnchorPicker）→ 数据卡（置于选择器下方）。
 *   · 算法参考用户给出的 HealthStateEngine：HRV 相对基线 + METs 活动量，四态判定
 *     （恢复 / 心流 / 松弛 / 紧绷），含 14 天动态基线、滑动平滑、恢复分数（0–100）。
 *     详见 lib/recoveryEngine.ts。
 *   · 日：恢复分数 hero → 全天状态带（时间线）→ 四态分布 → AI 洞察。
 *   · 周/月/年：区间均恢复分数 hero（含较上一周期对比）→ 恢复分数趋势 → 四态分布 → AI 洞察。
 *
 * 数据全部真实（healthStore 真实 HRV/METs intraday）；缺口留空，绝不伪造。
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
import RecoveryTrendChart from '../components/RecoveryTrendChart';
import RecoveryDayTrendChart from '../components/RecoveryDayTrendChart';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
import { type RangeKey } from '../data/metrics';
import {
  computeDayRecovery,
  computeDayRecoveryCurve,
  computeRangeRecovery,
  recoveryTag,
  STATE_META,
  type RecoveryState,
} from '../lib/recoveryEngine';

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtHrs(h: number): string {
  if (!h || h <= 0) return '0 分';
  if (h < 1) return `${Math.round(h * 60)} 分`;
  return `${h.toFixed(1)} 小时`;
}

/* ── 周/月/年恢复分数趋势：与日视图 / 洞察卡同一张 Oura 式单线图（右侧四档 + 阈值虚线） ──
 * ★ 2026-11-07（用户「周月年趋势图也挺奇怪的，恢复分数也没改」）：旧的 ScoreArea
 *   多彩分段面积图整体废弃，统一换成 RecoveryTrendChart；刻度用区间自带日期标签（首/中/尾）。 */
function RangeRecoveryChart({
  rangeData,
  anchor,
  rangeTicks,
}: {
  rangeData: ReturnType<typeof computeRangeRecovery> | null;
  anchor: Date;
  rangeTicks: { i: number; label: string }[];
}) {
  const pts = rangeData?.points ?? [];
  const endMs = pts.length > 0 ? pts[pts.length - 1].dateMs : startOfDayMs(anchor);
  return (
    <View style={styles.chartCard}>
      <Text style={styles.cardTitle}>恢复分数趋势</Text>
      {pts.length === 0 ? (
        <Text style={styles.emptyText}>暂无恢复数据 · 戒指同步后自动绘制</Text>
      ) : (
        <RecoveryTrendChart values={pts.map((p) => p.score)} endDayMs={endMs} height={190} ticks={rangeTicks} />
      )}
    </View>
  );
}

/* ── 恢复相关指标条（竞品恢复力页范式：指标名 + 数值 + 占比细条） ──
 * ★ 2026-11-07（用户）：恢复时长/紧绷时长从 hero 下沉到这张卡，hero 与其他模块统一。 */
function MetricBar({ label, value, ratio, color }: { label: string; value: string; ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color }]}>{value}{pct > 0 ? ` · ${Math.round(pct * 100)}%` : ''}</Text>
      </View>
      <View style={styles.metricTrack}>
        <View style={[styles.metricFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function StressRecoveryDetailScreen() {
  const navigation = useNavigation<any>();
  const storeVersion = useHealthStoreVersion();
  // ★ 2026-11-07（用户「压力恢复没有日视图吗」）：与其他详情页一致，默认「日」
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState(new Date());

  const day = useMemo(() => computeDayRecovery(startOfDayMs(anchor)), [anchor, storeVersion]);
  // ★ 2026-11-07（用户「趋势图应是 0–100 连续分」）：当日恢复分曲线（HRV 比值连续映射）
  const dayCurve = useMemo(() => computeDayRecoveryCurve(startOfDayMs(anchor)), [anchor, storeVersion]);
  const rangeData = useMemo(
    () => (range === 'day' ? null : computeRangeRecovery(range, anchor)),
    [range, anchor, storeVersion],
  );
  // ★ 2026-11-07（用户「详情页 hero 也要连续 0–100 分，别用恢复时长占比顶满 100」）：
  //   日/周/月/年 hero 统一用 curveScore（HRV 相对基线连续分，与当日曲线 / 趋势图同尺）
  const prevDayScore = useMemo(() => {
    const d = computeDayRecovery(startOfDayMs(anchor) - 864e5);
    return d.hasData ? d.curveScore : null;
  }, [anchor, storeVersion]);

  // ★ 周/月/年趋势刻度：首 / 中 / 尾三个点，用区间自带的日期标签
  const rangeTicks = useMemo(() => {
    const pts = rangeData?.points ?? [];
    if (pts.length === 0) return [];
    const idx = pts.length <= 3 ? pts.map((_, i) => i) : [0, Math.floor(pts.length / 2), pts.length - 1];
    return idx.map((i) => ({ i, label: pts[i].label }));
  }, [rangeData]);

  const isDay = range === 'day';

  return (
    <View style={{ flex: 1 }}>
      {/* 与睡眠恢复 / 身心压力详情页同款根渐变底（bgGradStops），盖住 App 根渐变 */}
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer topFadeColor={theme.colors.bgTop}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.titleWrap}>
            <Text style={styles.title}>压力恢复节律</Text>
            <Text style={styles.unit}>恢复 · 心流 · 松弛 · 紧绷</Text>
          </View>
        </View>

        {/* 日 / 周 / 月 / 年 切换 */}
        <RangeSwitch value={range} onChange={setRange} />

        {/* 日期步进器：选任意日期，日/周/月/年 以该日期为基准，按当前单位左右步进 */}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {isDay ? (
          <>
            {/* ★ 2026-11-07（用户「hero 跟其他模块保持一致」）：大数字 + 档位词 + 较昨日 + 分析段；
                恢复时长/紧绷时长下沉到「恢复相关指标」卡 */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>今日恢复分数</Text>
              <View style={styles.heroRow}>
              <Text style={styles.heroVal}>
                {day.hasData ? day.curveScore : '—'}
              </Text>
              <View style={styles.heroMeta}>
                <Text style={[styles.heroTag, { color: mm.colors.ringTeal }]}>
                  {day.hasData ? recoveryTag(day.curveScore) : '待数据'}
                </Text>
                <Text style={styles.heroNote}>
                  {prevDayScore != null && day.hasData
                    ? `较昨日 ${day.curveScore - prevDayScore >= 0 ? '+' : ''}${day.curveScore - prevDayScore} 分`
                    : day.hasData
                      ? `基线 HRV ${Math.round(day.baseHrv)}`
                      : '戒指暂无新数据'}
                </Text>
              </View>
              </View>
              <Text style={styles.heroAnalysis}>{buildDayInsight(day)}</Text>
            </View>

            {/* ★ 2026-11-07（用户「日视图展示当天恢复分数趋势」）：当日 0–24h 恢复分数
                阶梯趋势（四态算法逐时段真实判定 → 档位高度；当前时刻竖线；右侧四档） */}
            <View style={styles.chartCard}>
              <Text style={styles.cardTitle}>当日恢复趋势</Text>
              <RecoveryDayTrendChart
                curve={dayCurve.points}
                dayStart={startOfDayMs(anchor)}
                endMs={startOfDayMs(anchor) + 864e5}
                height={190}
              />
            </View>

            {/* 恢复相关指标（从 hero 下沉）：恢复 / 紧绷 时长占全天比 */}
            <View style={styles.chartCard}>
              <Text style={styles.cardTitle}>恢复相关指标</Text>
              <MetricBar label="恢复时长" value={fmtHrs(day.recoveryHrs)} ratio={day.totalHrs > 0 ? day.recoveryHrs / day.totalHrs : 0} color={mm.colors.ringTeal} />
              <MetricBar label="紧绷时长" value={fmtHrs(day.tenseHrs)} ratio={day.totalHrs > 0 ? day.tenseHrs / day.totalHrs : 0} color={STATE_META.tense.color} />
            </View>
          </>
        ) : (
          <>
            {/* ★ 2026-11-07（用户「hero 跟其他模块保持一致」）：大数字 + 档位词 + 较上一周期 + 分析段 */}
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>{range === 'week' ? '本周恢复分数' : range === 'month' ? '本月恢复分数' : '本年恢复分数'}</Text>
              <View style={styles.heroRow}>
                <Text style={styles.heroVal}>
                  {rangeData?.avgScore != null ? rangeData.avgScore : '—'}
                </Text>
                <View style={styles.heroMeta}>
                  <Text style={[styles.heroTag, { color: mm.colors.ringTeal }]}>
                    {rangeData?.avgScore != null ? recoveryTag(rangeData.avgScore) : '待数据'}
                  </Text>
                  {rangeData?.prevAvgScore != null && rangeData.avgScore != null ? (
                    <Text style={styles.heroNote}>
                      较上一周期 {rangeData.avgScore - rangeData.prevAvgScore >= 0 ? '+' : ''}
                      {rangeData.avgScore - rangeData.prevAvgScore} 分
                    </Text>
                  ) : (
                    <Text style={styles.heroNote}>暂无上一周期数据</Text>
                  )}
                </View>
              </View>
              <Text style={styles.heroAnalysis}>{buildRangeInsight(rangeData, range)}</Text>
            </View>

            {/* 恢复分数趋势：与日视图/洞察卡同一张 Oura 式单线图（右侧四档 + 阈值虚线） */}
            <RangeRecoveryChart rangeData={rangeData} anchor={anchor} rangeTicks={rangeTicks} />

            {/* 恢复相关指标（从 hero 下沉） */}
            <View style={styles.chartCard}>
              <Text style={styles.cardTitle}>恢复相关指标</Text>
              <MetricBar
                label="恢复时长"
                value={fmtHrs(rangeData?.totalRecoveryHrs ?? 0)}
                ratio={sumHours(rangeData?.hours) > 0 ? (rangeData?.totalRecoveryHrs ?? 0) / sumHours(rangeData?.hours) : 0}
                color={mm.colors.ringTeal}
              />
              <MetricBar
                label="紧绷时长"
                value={fmtHrs(rangeData?.totalTenseHrs ?? 0)}
                ratio={sumHours(rangeData?.hours) > 0 ? (rangeData?.totalTenseHrs ?? 0) / sumHours(rangeData?.hours) : 0}
                color={STATE_META.tense.color}
              />
            </View>
          </>
        )}
      </ScreenContainer>
    </View>
  );
}

/* ── 工具函数 ── */
function startOfDayMs(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function sumHours(h?: Record<RecoveryState, number>): number {
  if (!h) return 0;
  return h.recovery + h.flow + h.relax + h.tense;
}
function buildDayInsight(day: ReturnType<typeof computeDayRecovery>): string {
  if (!day.hasData) return '今天还没有足够的 HRV 与活动数据，连接戒指并同步后，这里会自动绘制你的恢复状态带。';
  const total = day.totalHrs || 1;
  const recPct = Math.round((day.recoveryHrs / total) * 100);
  const tensePct = Math.round((day.tenseHrs / total) * 100);
  if (day.recoveryHrs >= day.tenseHrs && recPct >= 20) {
    return `今天恢复充足，约有 ${fmtHrs(day.recoveryHrs)} 处于恢复态（占 ${recPct}%）。身体处在良好的修复窗口，可以顺势安排一些轻松的事。`;
  }
  if (day.tenseHrs > day.recoveryHrs) {
    return `今天紧绷偏多，约 ${fmtHrs(day.tenseHrs)}（占 ${tensePct}%）处于紧绷态，HRV 持续走低。傍晚建议用一次呼吸练习，把身体切回松弛。`;
  }
  return `今天状态较平稳：恢复约 ${fmtHrs(day.recoveryHrs)}、紧绷约 ${fmtHrs(day.tenseHrs)}。保持节奏即可。`;
}

function buildRangeInsight(rr: ReturnType<typeof computeRangeRecovery> | null, range: RangeKey): string {
  if (!rr || rr.avgScore == null) {
    return range === 'week'
      ? '本周还没有足够的恢复数据，连接戒指并同步后，这里会自动绘制恢复分数趋势。'
      : range === 'month'
        ? '本月还没有足够的恢复数据，连接戒指并同步后，这里会自动绘制恢复分数趋势。'
        : '本年还没有足够的恢复数据，连接戒指并同步后，这里会自动绘制恢复分数趋势。';
  }
  const total = sumHours(rr.hours) || 1;
  const recPct = Math.round((rr.hours.recovery / total) * 100);
  const tensePct = Math.round((rr.hours.tense / total) * 100);
  const name = range === 'week' ? '本周' : range === 'month' ? '本月' : '本年';
  let s = `${name}平均恢复分数 ${rr.avgScore} 分（${recoveryTag(rr.avgScore)}），恢复态约占 ${recPct}%。`;
  if (rr.prevAvgScore != null) {
    const d = rr.avgScore - rr.prevAvgScore;
    s += d >= 0 ? `较上一周期提升 ${d} 分。` : `较上一周期下降 ${-d} 分。`;
  }
  if (tensePct > recPct) {
    s += ` 紧绷占比偏高（${tensePct}%），长期韧性处于吃紧状态，建议周末安排一次彻底放松。`;
  } else if (recPct >= 20) {
    s += ' 恢复窗口充足，整体节奏健康。';
  }
  return s;
}

const styles = StyleSheet.create({
  // ★ 2026-11-07（用户）：header/标题与睡眠恢复等详情页完全同款 —— h2 标题、xs 副题，
  //   无额外横向留白（ScreenContainer.inner 已统一 paddingHorizontal，不能再叠）。
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
  titleWrap: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium, color: mm.colors.ink },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  // ★ 2026-11-07（用户）：卡片基座与 SleepRecoveryHero / 睡眠详情页 mCard 完全同款 token ——
  //   去掉 marginHorizontal（inner 已有留白，之前叠了一层导致卡片被挤窄居中）、
  //   cardBg/cardBorder/shadow 走 theme token、padding 用 space.cardPad、纵向间距用 marginBottom。
  hero: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  heroTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  // 分数字号对齐 SleepRecoveryHero（fontSize.hero = 46），不再用 h1×2.1 的超大号
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.semibold, color: mm.colors.ink, lineHeight: 48 },
  heroMeta: { alignItems: 'flex-end' },
  heroTag: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold },
  heroNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 4 },
  // ★ 2026-11-07（用户）：hero 下的分析段（与其他模块 hero 分析同口径：fontSize.sm、不截断）
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55, marginTop: theme.sp(1.5) },
  // 恢复相关指标条（竞品恢复力页范式）
  metricRow: { marginTop: theme.sp(2) },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) },
  metricLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textInk },
  metricValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  metricTrack: { height: 4, borderRadius: 2, backgroundColor: theme.colors.ui.white12, overflow: 'hidden' },
  metricFill: { height: 4, borderRadius: 2 },
  statRow: { flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.md },
  statItem: { flex: 1 },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 2 },
  statVal: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold },

  chartCard: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: theme.space.sm },
  insight: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21 },

  band: { flexDirection: 'row', borderRadius: theme.radius.sm, overflow: 'hidden' },
  bandAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1) },
  bandTime: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },
  dot: { width: theme.sp(1.6), height: theme.sp(1.6), borderRadius: theme.sp(0.8) },
  legendTxt: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },

  // ★ 2026-11-07：四档分色图例
  tierLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md, marginTop: theme.sp(1.5) },
  tierLegendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.75) },
  tierLegendTxt: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
