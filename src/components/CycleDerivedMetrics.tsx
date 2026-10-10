/**
 * CycleDerivedMetrics —— 周期日历详情页「月相环」下方的量化指标卡
 *
 * 用开源算法（symptothermal / Oura RHR-progesterone / Frontiers HRV-estradiol 等）
 * 基于戒指已采生理信号 + 用户自记经期，推算一组经期量化指标：
 *   排卵置信度、黄体期长度、周期规律性、PMS 早筛、当前受孕概率。
 *   双相体温幅度已移到「体温双相监测」图下方，以 AI 解读形式呈现。
 *
 * 卡内下方另有「周期关键信息」区块：预测经期（含置信窗）、排卵日（体温是否已确认）、
 *   易孕窗口、周期/经期长度——都是 cycleInfo / 历史记录里已有但此前未展示的确定值。
 *
 * 所有结果均为「基于可穿戴数据推算·非实测」。数据不足时对应 tile 显示「—」，
 * 底部给出引导文案（持续佩戴 / 多记录几次经期）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { deriveCycleMetrics, type DerivedCycleMetrics } from '../lib/cycleDerived';
import { parseDate, type CycleLog, type CycleInfo } from '../lib/cycleMath';
import type { RingState } from '../ble/RingBleManager';
import type { PeriodDayLog } from '../data/cycleLog';

interface Props {
  log: CycleLog;
  cycleInfo: CycleInfo | null;
  ring: RingState;
  periodDays: Record<string, PeriodDayLog>;
}

function buildTempSeries(ring: RingState) {
  const td = (ring.tempDaily ?? {}) as Record<string, number>;
  const keys = Object.keys(td);
  return keys.length ? keys.map((d) => ({ date: d, temp: td[d] })) : undefined;
}

/**
 * ★ 2026-10-09（menstrual-cycle-preview.html 完全还原）：
 *   指标块 = 无底色 + 1px 描边小格（.tile：border line / radius 11 / 值 15px·650·墨色）。
 *   原先按 tone 上色的值统一改为墨色（预览稿里 6 个指标值全部同色）。
 */
function Tile({
  label,
  value,
  unit,
  sub,
  hasData = true,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  hasData?: boolean;
}) {
  return (
    <View style={[styles.tile, !hasData && styles.tileCompact]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, !hasData && styles.tileValueMuted]}>{value}</Text>
        {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      </View>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

/** 'YYYY-M-D' → 「M/D」（与日历 chip / 图表轴标签同格式）；空值给「—」 */
const md = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 距今天的相对描述（正=未来，负=已过） */
function relDays(d: number | null | undefined): string {
  if (d == null) return '';
  if (d === 0) return '就在今天';
  return d > 0 ? `还有 ${d} 天` : `已过 ${-d} 天`;
}

/**
 * 关键日期单元格：小标签 / 值 / 副文，居中 —— 与 CyclePhaseCard 的「关键日期」范式一致
 * （label=micro/textSub、value=card/semibold/textTitle），保证同 App 同类信息同一种读法。
 */
function KeyDateCell({
  label,
  value,
  sub,
  valueStyle,
}: {
  label: string;
  value: string;
  sub?: string;
  /** ★ 2026-10-07：长值（如易孕窗口的日期区间）可传更小的字号，配合单行避免折行 */
  valueStyle?: object;
}) {
  return (
    <View style={styles.keyDateCell}>
      <Text style={styles.keyDateK}>{label}</Text>
      <Text
        style={[styles.keyDateV, valueStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {value}
      </Text>
      {sub ? <Text style={styles.keyDateSub}>{sub}</Text> : null}
    </View>
  );
}

export default function CycleDerivedMetrics({ log, cycleInfo, ring, periodDays }: Props) {
  const m: DerivedCycleMetrics = useMemo(() => {
    const tempSeries = buildTempSeries(ring);
    if (!cycleInfo) {
      return {
        ovulationConfidence: null,
        ovulationBasis: [],
        thermalShiftMag: null,
        thermalBaseline: null,
        thermalCover: null,
        actualLutealLength: null,
        lutealMethod: '未知',
        actualPeriodLength: null,
        actualCycleLength: null,
        regularity: { score: null, label: '数据不足', cv: null, sampleN: 0 },
        pmsIndex: null,
        pmsRisk: 'unknown',
        fertilityProbability: null,
        daysToOvulation: null,
        notes: [],
      };
    }
    return deriveCycleMetrics({ log, cycleInfo, tempSeries: tempSeries ?? [], periodDays });
  }, [log, cycleInfo, ring.tempDaily, periodDays]);

  const hasAny =
    m.ovulationConfidence != null ||
    m.actualLutealLength != null ||
    m.regularity.score != null ||
    m.pmsIndex != null ||
    m.fertilityProbability != null;

  // 易孕窗口当前状态（基于距排卵天数：窗口 = 排卵前 5 天 ~ 排卵后 1 天）
  const dOv = cycleInfo?.daysToOvulation ?? null;
  // ★ 2026-10-07：指标区（排卵置信度 / 黄体期长度 / 周期规律性 / 周期长度 / PMS / 受孕概率）默认收起
  const [moreOpen, setMoreOpen] = useState(false);

  // ★ 2026-10-07（用户：「底下那个双相体温需连续佩戴 ≥12 天才能识别，放到展开以后展示」）
  //   这条属于「数据不足」提示，跟指标区放一起更合理；其余提示仍留在卡片底部。
  const tempNote = m.notes.find((n) => n.includes('双相体温')) ?? null;
  const restNotes = m.notes.filter((n) => !n.includes('双相体温'));

  const fertilityState =
    dOv == null
      ? ''
      : dOv >= -5 && dOv <= 1
        ? '当前处于受孕窗内'
        : dOv > 1
          ? `排卵已过 ${dOv} 天，受孕窗结束`
          : `还有 ${Math.abs(dOv) - 5} 天进入受孕窗`;

  return (
    <View style={styles.card}>
      {/* ★ 2026-10-07（用户：「周期健康指标旁边的基于可穿戴数据推算」这个去掉） */}
      <View style={styles.head}>
        <Text style={styles.title}>周期健康指标</Text>
      </View>

      {/* ★ 周期关键信息（放在指标之前）：预测经期 / 排卵日 / 易孕窗口——cycleInfo 已算出的确定值 */}
      {cycleInfo?.hasLog ? (
        <>
          {/* ★ 2026-10-07（用户：去掉「周期关键信息」这几个字；预测经期 / 排卵日 / 易孕窗口写得有点太密 → 给它们一个外框） */}
          <View style={[styles.keyDateGrid, styles.keyDateBox]}>
            <KeyDateCell
              label="预测经期"
              value={md(cycleInfo.nextPeriodDate)}
              sub={relDays(cycleInfo.daysToNextPeriod) || '待推算'}
            />
            <KeyDateCell
              label="排卵日"
              value={md(cycleInfo.ovulationDate)}
              sub={cycleInfo.tempConfirmed ? '体温已确认' : '日历推算'}
            />
            {/* ★ 2026-10-07（用户：「易孕窗口已经分成两行了，整体这个排布优化一下」）：
                日期区间比另外两格长 → 降到小一号字体 + 强制单行，不再折行 */}
            <KeyDateCell
              label="易孕窗口"
              value={
                cycleInfo.fertilityStart && cycleInfo.fertilityEnd
                  ? `${md(cycleInfo.fertilityStart)}–${md(cycleInfo.fertilityEnd)}`
                  : '—'
              }
              sub={fertilityState || '待推算'}
              valueStyle={styles.keyDateVSmall}
            />
          </View>
          {cycleInfo.nextPeriodRange ? (
            <Text style={styles.keyDateFoot}>
              经期预测置信窗 {md(cycleInfo.nextPeriodRange[0])}–{md(cycleInfo.nextPeriodRange[1])}
            </Text>
          ) : null}
          {/* ★ 2026-10-07（用户：「展开更多指标上面那条横线不要有，不要分隔，只用留白」）——原来的分隔线已去掉 */}
        </>
      ) : null}

      {hasAny ? (
        <>
          {/* ★ 2026-10-07（用户：排卵置信度、周期长度这些可以加一个收起来，点击展开，默认收起）
              ★ 2026-10-09（collapse-unified-preview）：折叠头统一为 mhRow（左标签 + 右 chevron，
                  浅底描边行，对齐 SleepAnalysisCard.moreHead 与预览稿 .mhRow） */}
          <TouchableOpacity
            style={styles.mhRow}
            activeOpacity={0.7}
            onPress={() => setMoreOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={moreOpen ? '收起指标' : '展开更多指标'}
          >
            <Text style={styles.mhLabel}>展开更多指标</Text>
            <View style={[styles.mhChev, moreOpen && styles.mhChevOpen]} />
          </TouchableOpacity>
          {moreOpen ? (
        <>
        {/* ★ 2026-10-09（menstrual-cycle-preview）：展开区 = 两行 3 列描边小格（.statRow/.tile） */}
        <View style={styles.statRow}>
          <Tile
            label="排卵置信度"
            value={m.ovulationConfidence != null ? `${m.ovulationConfidence}` : '—'}
            unit={m.ovulationConfidence != null ? '%' : undefined}
            sub={m.ovulationBasis.join(' · ') || '日历推算'}
            hasData={m.ovulationConfidence != null}
          />
          <Tile
            label="黄体期长度"
            value={m.actualLutealLength != null ? `${m.actualLutealLength}` : '—'}
            unit={m.actualLutealLength != null ? '天' : undefined}
            sub={m.lutealMethod === '未知' ? '数据不足' : m.lutealMethod}
            hasData={m.actualLutealLength != null}
          />
          <Tile
            label="周期规律性"
            value={m.regularity.score != null ? m.regularity.label : '—'}
            sub={
              m.regularity.cv != null
                ? `CV ${m.regularity.cv} · 近 ${m.regularity.sampleN} 周期`
                : '记录 ≥2 次经期'
            }
            hasData={m.regularity.score != null}
          />
        </View>
        <View style={[styles.statRow, styles.statRowGap]}>
          <Tile
            label="周期长度"
            value={`${m.actualCycleLength ?? log.cycleLength}`}
            unit="天"
            sub={
              m.actualPeriodLength != null
                ? `经期 ${m.actualPeriodLength} 天 · 实测均值`
                : `经期约 ${log.periodLength} 天 · 按你的设置`
            }
          />
          <Tile
            label="PMS 早筛"
            value={
              m.pmsIndex != null
                ? m.pmsRisk === 'high'
                  ? '偏高'
                  : m.pmsRisk === 'moderate'
                  ? '中等'
                  : '偏低'
                : '—'
            }
            sub={m.pmsIndex != null ? `指数 ${m.pmsIndex}` : '经前 7 天评估'}
            hasData={m.pmsIndex != null}
          />
          <Tile
            label="当前受孕概率"
            value={m.fertilityProbability != null ? `${m.fertilityProbability}` : '—'}
            unit={m.fertilityProbability != null ? '%' : undefined}
            sub={
              m.daysToOvulation != null
                ? m.daysToOvulation >= 0
                  ? `距排卵 ${m.daysToOvulation} 天`
                  : `排卵已过 ${-m.daysToOvulation} 天`
                : '—'
            }
            hasData={m.fertilityProbability != null}
          />
        </View>
        {tempNote ? (
          <View style={styles.notes}>
            <Text style={styles.noteItem}>· {tempNote}</Text>
          </View>
        ) : null}
        </>
          ) : null}
        </>
      ) : (
        <Text style={styles.empty}>
          持续佩戴戒指并记录经期后，这里会显示排卵置信度、双相体温、周期规律性、PMS 早筛等量化指标。
        </Text>
      )}

      {restNotes.length > 0 ? (
        <View style={styles.notes}>
          {restNotes.map((n, i) => (
            <Text key={i} style={styles.noteItem}>
              · {n}
            </Text>
          ))}
        </View>
      ) : null}
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
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space.xs },
  title: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  // ★ 2026-10-09（menstrual-cycle-preview）：展开区 = 3 列 statRow（第二行 marginTop 8）
  statRow: { flexDirection: 'row', gap: theme.space.xs },
  statRowGap: { marginTop: theme.space.xs },
  // ★ 2026-10-07（用户：周期健康指标下面那几个灰块 —— 背景不喜欢，不要灰色背景）：
  //   指标块不再铺浅紫底。
  // ★ 2026-10-09（menstrual-cycle-preview .tile）：无底色 + 1px 描边小格（radius 11 / 值 15px·650·墨色），
  //   3 列同排，替代原先 2 列纯文字块。
  tile: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: theme.sp(2.5),
  },
  tileCompact: {
    paddingVertical: theme.sp(1.5),
  },
  tileLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(0.5) },
  tileValue: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  tileValueMuted: { fontWeight: theme.weight.regular as any, opacity: 0.5 },
  tileUnit: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
  tileSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.micro * 1.3,
  },
  empty: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.6, color: theme.colors.textSub, paddingVertical: theme.space.md },
  subTitle: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textSub,
    marginBottom: theme.sp(0.5),
  },
  /* 关键日期：与 CyclePhaseCard 的「关键日期」范式一致（居中 · 标签/值/副文，全 token） */
  /* ★ 2026-10-09（collapse-unified-preview .mhRow）：「展开更多指标」折叠头
     （左标签 12.5px·600·墨 + 右 chevron，浅底描边行，对齐 SleepAnalysisCard.moreHead） */
  mhRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space.sm,
    backgroundColor: theme.colors.cardBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: theme.space.sm,
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
  keyDateGrid: { flexDirection: 'row', marginTop: theme.sp(1) },
  /* ★ 2026-10-07：三列关键日期的外框（原本只靠紧排的文字分隔，看着太密）
     ★ 2026-10-09（menstrual-cycle-preview .kpi3）：圆角对齐 11（radius.md） */
  keyDateBox: {
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.sm,
    marginTop: theme.space.xs,
    gap: theme.space.xs,
  },
  keyDateCell: { flex: 1, alignItems: 'center', paddingHorizontal: theme.sp(0.5) },
  keyDateK: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  keyDateV: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.75),
  },
  keyDateSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center' },
  /** ★ 2026-10-07：易孕窗口的长日期区间用小一号字号，保证单行 */
  keyDateVSmall: { fontSize: theme.fontSize.sm },
  keyDateFoot: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.xs, textAlign: 'center' },
  notes: { marginTop: theme.space.xs, gap: theme.sp(0.5) },
  noteItem: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: theme.fontSize.micro * 1.3 },
});
