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
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

type TileTone = 'purple' | 'teal' | 'green' | 'orange' | 'neutral';

function buildTempSeries(ring: RingState) {
  const td = (ring.tempDaily ?? {}) as Record<string, number>;
  const keys = Object.keys(td);
  return keys.length ? keys.map((d) => ({ date: d, temp: td[d] })) : undefined;
}

function Tile({
  label,
  value,
  unit,
  sub,
  tone,
  hasData = true,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone: TileTone;
  hasData?: boolean;
}) {
  const color =
    tone === 'purple'
      ? theme.colors.accentSolid
      : tone === 'teal'
      ? theme.colors.stateCalm
      : tone === 'green'
      ? theme.colors.success
      : tone === 'orange'
      ? theme.colors.stateTense
      : theme.colors.textSub;
  return (
    <View style={[styles.tile, !hasData && styles.tileCompact]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, { color }, !hasData && styles.tileValueMuted]}>{value}</Text>
        {unit ? <Text style={[styles.tileUnit, { color }]}>{unit}</Text> : null}
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
function KeyDateCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.keyDateCell}>
      <Text style={styles.keyDateK}>{label}</Text>
      <Text style={styles.keyDateV}>{value}</Text>
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
      <View style={styles.head}>
        <Text style={styles.title}>周期健康指标</Text>
        <Text style={styles.badge}>基于可穿戴数据推算</Text>
      </View>

      {/* ★ 周期关键信息（放在指标之前）：预测经期 / 排卵日 / 易孕窗口——cycleInfo 已算出的确定值 */}
      {cycleInfo?.hasLog ? (
        <>
          <Text style={styles.subTitle}>周期关键信息</Text>
          <View style={styles.keyDateGrid}>
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
            <KeyDateCell
              label="易孕窗口"
              value={
                cycleInfo.fertilityStart && cycleInfo.fertilityEnd
                  ? `${md(cycleInfo.fertilityStart)}–${md(cycleInfo.fertilityEnd)}`
                  : '—'
              }
              sub={fertilityState || '待推算'}
            />
          </View>
          {cycleInfo.nextPeriodRange ? (
            <Text style={styles.keyDateFoot}>
              经期预测置信窗 {md(cycleInfo.nextPeriodRange[0])}–{md(cycleInfo.nextPeriodRange[1])}
            </Text>
          ) : null}
          {/* 指标区存在时才画分隔线（否则空态文案会孤零零跟着一条线） */}
          {hasAny ? <View style={styles.divider} /> : null}
        </>
      ) : null}

      {hasAny ? (
        <View style={styles.grid}>
          {/* 左列 */}
          <View style={styles.col}>
            <Tile
              label="排卵置信度"
              value={m.ovulationConfidence != null ? `${m.ovulationConfidence}` : '—'}
              unit={m.ovulationConfidence != null ? '%' : undefined}
              sub={m.ovulationBasis.join(' · ') || '日历推算'}
              tone="purple"
              hasData={m.ovulationConfidence != null}
            />
            <Tile
              label="黄体期长度"
              value={m.actualLutealLength != null ? `${m.actualLutealLength}` : '—'}
              unit={m.actualLutealLength != null ? '天' : undefined}
              sub={m.lutealMethod === '未知' ? '数据不足' : m.lutealMethod}
              tone="teal"
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
              tone={m.regularity.score != null && m.regularity.score >= 70 ? 'green' : 'neutral'}
              hasData={m.regularity.score != null}
            />
          </View>
          {/* 右列 */}
          <View style={styles.col}>
            <Tile
              label="周期长度"
              value={`${m.actualCycleLength ?? log.cycleLength}`}
              unit="天"
              sub={
                m.actualPeriodLength != null
                  ? `经期 ${m.actualPeriodLength} 天 · 实测均值`
                  : `经期约 ${log.periodLength} 天 · 按你的设置`
              }
              tone="purple"
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
              tone={m.pmsRisk === 'high' ? 'orange' : m.pmsRisk === 'moderate' ? 'neutral' : 'green'}
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
              tone="teal"
              hasData={m.fertilityProbability != null}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>
          持续佩戴戒指并记录经期后，这里会显示排卵置信度、双相体温、周期规律性、PMS 早筛等量化指标。
        </Text>
      )}

      {m.notes.length > 0 ? (
        <View style={styles.notes}>
          {m.notes.map((n, i) => (
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
  badge: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
  },
  grid: { flexDirection: 'row', gap: theme.space.xs },
  col: { flex: 1, gap: theme.space.xs },
  tile: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.sm,
    padding: theme.space.xs,
  },
  tileCompact: {
    paddingVertical: theme.sp(1.5),
  },
  tileLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.sp(0.5) },
  tileValue: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold as any },
  tileValueMuted: { fontWeight: theme.weight.regular as any, opacity: 0.5 },
  tileUnit: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any },
  tileSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.sp(0.5),
    lineHeight: theme.fontSize.micro * 1.3,
  },
  empty: { fontSize: theme.fontSize.sm, lineHeight: theme.fontSize.sm * 1.6, color: theme.colors.textSub, paddingVertical: theme.space.md },
  divider: { height: 1, backgroundColor: theme.colors.ui.borderSoft, marginTop: theme.space.sm },
  subTitle: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textSub,
    marginBottom: theme.sp(0.5),
  },
  /* 关键日期：与 CyclePhaseCard 的「关键日期」范式一致（居中 · 标签/值/副文，全 token） */
  keyDateGrid: { flexDirection: 'row', marginTop: theme.sp(1) },
  keyDateCell: { flex: 1, alignItems: 'center', paddingHorizontal: theme.sp(0.5) },
  keyDateK: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  keyDateV: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.75),
  },
  keyDateSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center' },
  keyDateFoot: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.space.xs, textAlign: 'center' },
  notes: { marginTop: theme.space.xs, gap: theme.sp(0.5) },
  noteItem: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: theme.fontSize.micro * 1.3 },
});
