import React from 'react';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import Card from './Card';
import { computeCognitiveLoadReport, type LoadLevel, type FatigueLevel, levelLabel } from '../lib/cognitiveLoad';

import { useHealthStoreVersion } from '../hooks/useHealthStore';

export function fmtRange(span: { startHour: number; endHour: number }): string {
  const s = String(span.startHour).padStart(2, '0');
  const e = String(span.endHour + 1).padStart(2, '0');
  return s + ':00 – ' + e + ':00';
}

export function loadColor(l: LoadLevel): string {
  return l === 'heavy' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : theme.colors.stateCalm;
}
export function fatigueColor(l: FatigueLevel): string {
  return l === 'severe' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.stateTense
    : l === 'mild' ? theme.colors.moodEnergy
    : theme.colors.stateCalm;
}
export function loadLabel(l: LoadLevel): string {
  return l === 'heavy' ? '高强度投入'
    : l === 'moderate' ? '中等投入'
    : l === 'light' ? '轻度投入'
    : '基本放松';
}
function fatigueLabel(l: FatigueLevel): string {
  return l === 'severe' ? '严重疲劳'
    : l === 'moderate' ? '中度疲劳'
    : l === 'mild' ? '轻度疲劳'
    : '精力充沛';
}

export default function CognitiveLoadCard() {
  useHealthStoreVersion(); // 触发 re-render
  const report = computeCognitiveLoadReport();
  // ★ debug: 每次 render 打印 sleepWindow
  try {
    const postLog = (globalThis as any).__postLog;
    if (postLog) postLog('COG-CARD', `sleepWindow=${JSON.stringify(report?.sleepWindow)} sampleCount=${report?.sampleCount}`);
    else {
      const fetch = (globalThis as any).fetch;
      if (fetch) fetch('http://localhost:8899/log', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({tag:'COG-CARD', msg:`sleepWindow=${JSON.stringify(report?.sleepWindow)} sampleCount=${report?.sampleCount}`}) }).catch(()=>{});
    }
  } catch(e) { console.log('COG-ERR', e); }
  const hasData = report.sampleCount >= 2;

  if (!hasData) {
    return (
      <Card>
          <Text style={styles.title}>认知疲劳度</Text>
          <Text style={styles.emptyText}>暂无足够的生理数据，连上戒指跑 2-3 轮自动监测后自动生成报告</Text>
      </Card>
    );
  }

  const lCol = loadColor(report.loadLevel);
  const fCol = fatigueColor(report.fatigueLevel);

  return (
    <Card>
        {/* ── 头部 ── */}
        <Text style={styles.title}>认知疲劳度</Text>

        {/* ── 全天趋势分布图 ── */}
        <View style={styles.hourSection}>
          <HourHistogram hourly={report.hourly} peakSpan={report.peakLoadSpan} bestSpan={report.bestSpan} sleepWindow={report.sleepWindow} />
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateCalm }]} />
              <Text style={styles.legendText}>放松</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateTense }]} />
              <Text style={styles.legendText}>中度</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.danger }]} />
              <Text style={styles.legendText}>高强度</Text>
            </View>
          </View>
        </View>

        {/* ── 三个核心指标 ── */}
        <View style={[styles.summaryGrid, { marginTop: theme.sp(2) }]}>
          <SumCell label="疲劳度" value={String(report.loadScore)} valueColor={lCol} />
          <SumCell label="疲劳指数" value={String(report.fatigueIndex)} valueColor={fCol} />
          <SumCell
            label="恢复能力"
            value={report.recoveryCapacity != null ? `${Math.round(report.recoveryCapacity * 100)}%` : '—'}
          />
        </View>
    </Card>
  );
}

/** SumCell —— 与详情页 EmotionCognitiveDetailScreen.SumCell 100% 对齐 */
function SumCell({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <View style={styles.sumCell}>
      <Text style={styles.sumLabel}>{label}</Text>
      {value ? <Text style={[styles.sumValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

export function HourHistogram({ hourly, peakSpan, bestSpan, sleepWindow, chartH }: {
  hourly: { hour: number; score: number; hasData?: boolean }[];
  peakSpan: { startHour: number; endHour: number; avgScore: number } | null;
  bestSpan: { startHour: number; endHour: number; avgScore: number } | null;
  sleepWindow: { bedHour: number; wakeHour: number } | null;
  chartH?: number;
}) {
  // 认知疲劳度 = 分类变量 (低/中/高), 半小时步长 48 根柱
  // 档位: <40 低(绿), 40-65 中(琥珀), >=65 高(红)
  const LEVELS = [
    { max: 40, color: '#22C55E', label: '低疲劳' },
    { max: 65, color: '#F59E0B', label: '中疲劳' },
    { max: 101, color: '#9D8AF0', label: '高疲劳' },
  ];
  const barColor = (s: number) => LEVELS.find(l => s < l.max)!.color;

  const N = 48; // 半小时步长
  const rows = Array.from({ length: N }, (_, i) => {
    const raw = hourly?.find(h => h.hour === i);
    const hasData = raw?.hasData === true && raw?.score != null;
    return { hour: i, score: raw?.score ?? 0, hasData };
  });

  const wrapW = Dimensions.get('window').width - theme.space.cardPad * 2 - theme.sp(2) * 2;
  const padL = 12, padR = 12, padT = 8, padB = 22;
  const svgW = wrapW;
  const svgH = (chartH ?? 240) - 30;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  // 每小时一根柱子, 柱宽 = 可用宽 / 24 * 0.6
  const slotW = plotW / N;
  const barW = slotW * 0.55;
  const hourCenterX = (h: number) => padL + slotW * (h + 0.5);
  const barY = (score: number) => padT + plotH - (score / 100) * plotH;

  // 背景遮罩
  let sleepMask: { startX: number; endX: number } | null = null;
  if (sleepWindow) {
    const sStep = Math.round(sleepWindow.bedHour * 2);
    const eStep = Math.round((sleepWindow.wakeHour < sleepWindow.bedHour ? 47 : Math.min(47, sleepWindow.wakeHour * 2)));
    const sX = hourCenterX(sStep) - barW / 2;
    const eX = hourCenterX(eStep) + barW / 2;
    sleepMask = { startX: sX, endX: Math.max(eX, sX + 4) };
  }
  const peakSX = peakSpan ? hourCenterX(Math.round(peakSpan.startHour * 2)) - barW / 2 : 0;
  const peakEX = peakSpan ? hourCenterX(Math.round(Math.min(23, peakSpan.endHour) * 2)) + barW / 2 : 0;
  const bestSX = bestSpan ? hourCenterX(Math.round(bestSpan.startHour * 2)) - barW / 2 : 0;
  const bestEX = bestSpan ? hourCenterX(Math.round(Math.min(23, bestSpan.endHour) * 2)) + barW / 2 : 0;

  const anyData = rows.some(r => r.hasData);
  // tickHours 存 step 索引 (0-47), 整数小时 = step*2
  const tickHours: { step: number; label: string; align: 'start'|'middle'|'end' }[] = [
    { step: 0,  label: '0',  align: 'start' },
    { step: 12, label: '6',  align: 'middle' },
    { step: 24, label: '12', align: 'middle' },
    { step: 36, label: '18', align: 'middle' },
    { step: 47, label: '23', align: 'end' },
  ];

  return (
    <View style={{ height: svgH + 8, width: '100%' }}>
      <Svg width={svgW} height={svgH + 8}>
        {/* 3 条水平网格 (档位边界) */}
        {[40, 65].map(v => (
          <Path key={'yg' + v}
            d={`M ${padL} ${barY(v)} L ${padL + plotW} ${barY(v)}`}
            stroke="rgba(120,110,160,0.08)" strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* 睡眠遮罩 */}
        {sleepMask && sleepMask.endX > sleepMask.startX + 2 && (
          <>
            <Rect x={sleepMask.startX} y={padT}
              width={sleepMask.endX - sleepMask.startX} height={plotH}
              fill="rgba(100,116,139,0.10)" />
            <SvgText x={(sleepMask.startX + sleepMask.endX) / 2} y={padT + 14}
              textAnchor="middle" fontSize={8} fill="rgba(100,116,139,0.5)"
              fontWeight="600">睡眠中</SvgText>
          </>
        )}

        {/* peakSpan 红色半透明遮罩 */}
        {peakSpan && peakEX > peakSX && (
          <Rect x={peakSX} y={padT} width={peakEX - peakSX} height={plotH}
            fill="rgba(157,138,240,0.10)" />
        )}
        {/* bestSpan 绿色半透明遮罩 */}
        {bestSpan && bestEX > bestSX && (
          <Rect x={bestSX} y={padT} width={bestEX - bestSX} height={plotH}
            fill="rgba(34,197,94,0.06)" />
        )}

        {/* 柱状图 — 按档位分色 */}
        {rows.map(r => {
          if (!r.hasData) return null;  // 无数据/睡眠 → 不画
          const c = barColor(r.score);
          const x = hourCenterX(r.hour) - barW / 2;
          const y = barY(r.score);
          const h = (padT + plotH) - y;
          const rx = Math.min(3, barW / 2);
          return (
            <Rect key={'b' + r.hour}
              x={x} y={y} width={barW} height={Math.max(h, 2)}
              fill={c} rx={rx} opacity={0.85} />
          );
        })}

        {/* X 轴刻度 */}
        {tickHours.map(t => (
          <SvgText key={'tx' + t.step} x={hourCenterX(t.step)} y={padT + plotH + 16}
            textAnchor={t.align} fontSize={10} fill="rgba(120,110,160,0.65)">
            {t.label.padStart(2, '0')}
          </SvgText>
        ))}
      </Svg>

      {/* 档位图例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 4 }}>
        {LEVELS.map(l => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: l.color, opacity: 0.85 }} />
            <Text style={{ fontSize: 10, color: 'rgba(120,110,160,0.65)' }}>{l.label}</Text>
          </View>
        ))}
      </View>

      {!anyData && (
        <Text style={{ position: 'absolute', left: '50%', top: '40%', transform: [{ translateX: -40 }], fontSize: 11, color: 'rgba(120,110,160,0.5)' }}>
          暂无数据
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── 复用 StressInsightCard token ──
  pad: { padding: theme.space.cardPad },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.sp(1.5) },
  metricItem: { width: '50%', paddingHorizontal: theme.sp(1.5), marginBottom: theme.sp(2.5) },
  metricLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  metricValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, color: theme.colors.textBody, marginTop: theme.sp(0.5) },
  metricSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  sectionTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textBody, marginBottom: theme.sp(1.5) },
  hourSection: {
    backgroundColor: theme.colors.cardBgSoft,
    marginTop: theme.sp(2), paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(2),
    borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.colors.cardBorder2,
    overflow: 'visible',
  },
  emptyText: { fontSize: theme.fontSize.body, color: theme.colors.textSub, lineHeight: theme.fontSize.body + theme.sp(1.5), marginTop: theme.sp(1.5) },

  // ── 认知负荷专属 ──
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: theme.sp(2), marginBottom: theme.sp(3) },
  scoreBlock: { flex: 1, alignItems: 'center' },
  scoreLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625), marginBottom: theme.sp(0.5) },
  score: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium, letterSpacing: -1 },
  scoreDivider: { width: 1, height: theme.sp(10), backgroundColor: theme.colors.ui.borderSoft },

  histogramWrap: { height: theme.sp(10), marginTop: theme.sp(1), position: 'relative', width: '100%', overflow: 'visible' },
  spanHighlight: {
    position: 'absolute',
    top: 0, bottom: theme.sp(1.5),
    borderTopWidth: 2, borderBottomWidth: 2,
    opacity: 0.5,
  },
  histogram: { flexDirection: 'row', alignItems: 'flex-end', height: theme.sp(6), gap: 1 },
  histBin: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  histBar: { width: theme.sp(1.5), borderRadius: theme.sp(0.5) },
  histAxis: { flexDirection: 'row', marginTop: theme.sp(0.5), paddingHorizontal: 0 },
  histAxisLabel: { flex: 1, fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', lineHeight: theme.sp(3) },
  hourAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1), paddingHorizontal: theme.sp(0.5) },
  hourAxisLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  legendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.sp(1.5) },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.sp(1.5) },
  legendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), marginRight: theme.sp(0.75) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  peakRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(2) },
  peakChip: { flex: 1, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm, paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(2), marginHorizontal: theme.sp(0.75) },
  peakLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textTransform: 'uppercase', letterSpacing: theme.sp(0.0625) },
  peakTime: { fontSize: theme.fontSize.card, fontWeight: theme.weight.medium, marginTop: theme.sp(0.5) },
  peakSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

  reasonText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(2) },

  // SumCell 风格摘要（与详情页对齐）
  summaryGrid: { flexDirection: 'row' },
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
});
