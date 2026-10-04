import React from 'react';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText, Rect, G, Line } from 'react-native-svg';
import { theme } from '../theme/theme';
import Card from './Card';
import { computeCognitiveLoadReport, type LoadLevel, type FatigueLevel, levelLabel, COG_LEVEL_LOW, COG_LEVEL_HIGH, cogBarRatio } from '../lib/cognitiveLoad';

import { useHealthStoreVersion } from '../hooks/useHealthStore';

export function fmtRange(span: { startHour: number; endHour: number }): string {
  const s = String(span.startHour).padStart(2, '0');
  const e = String(span.endHour + 1).padStart(2, '0');
  return s + ':00 – ' + e + ':00';
}

// 与 HourHistogram 的 LEVELS、首页 MiniCognitiveBars、Hero chip 共用同一套配色：
// 低(<40)=success 绿 / 中(40–70)=warn 黄 / 高(≥70)=danger 红
export function loadColor(l: LoadLevel): string {
  return l === 'heavy' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.warn
    : theme.colors.success;
}
export function fatigueColor(l: FatigueLevel): string {
  return l === 'severe' ? theme.colors.danger
    : l === 'moderate' ? theme.colors.warn
    : theme.colors.success;
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

export default function CognitiveLoadCard({ nowMs, note }: { nowMs?: number; note?: string }) {
  useHealthStoreVersion(); // 触发 re-render
  const report = computeCognitiveLoadReport(nowMs ?? Date.now());
  // ★ debug: 每次 render 打印 sleepWindow
  try {
    const postLog = (globalThis as any).__postLog;
    // ★ v18.130：诊断补上「详情页实际画的是哪条序列 + 各档柱数」——
    //   v18.129 改完用户仍报「详情页全是低疲劳」，但日志里没这条 → 无法对质。
    const inst = report?.hourlyInstant ?? report?.hourly ?? [];
    const instHas = inst.filter((h: any) => h.hasData);
    const instTier = { low: 0, mid: 0, high: 0 };
    instHas.forEach((h: any) => { const v = h.score; if (v >= 70) instTier.high++; else if (v >= 40) instTier.mid++; else instTier.low++; });
    const msg = `sleepWindow=${JSON.stringify(report?.sleepWindow)} sampleCount=${report?.sampleCount}`
      + ` | src=${report?.hourlyInstant ? 'hourlyInstant' : 'hourly(累积!)'}`
      + ` | hasData=${instHas.length}/24 low=${instTier.low} mid=${instTier.mid} high=${instTier.high}`
      + ` | vals=[${instHas.map((h: any) => h.hour + ':' + h.score).join(' ')}]`
      + ` | peakSpan=${JSON.stringify(report?.peakLoadSpan)} bestSpan=${JSON.stringify(report?.bestSpan)}`;
    if (postLog) postLog('COG-CARD', msg);
    else {
      const fetch = (globalThis as any).fetch;
      if (fetch) fetch('http://localhost:8899/log', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({tag:'COG-CARD', msg}) }).catch(()=>{});
    }
  } catch(e) { console.log('COG-ERR', e); }
  const hasData = report.sampleCount >= 2;

  // 无真实数据 → 空骨架示意图（24 根空柱 + 档位轴 + 「暂无数据」浮层），绝不放演示数据
  // ★ v18.129 改用 `hourlyInstant`（瞬时/状态量），与首页 `MiniCognitiveBars` **同一数据源**。
  //   原用 `report.hourly`（累积量）→ 首页与详情页一个爬坡、一个等高，用户看着割裂
  //   （用户要求「首页跟详情页的要一样」）。累积量仍保留给脑力账户（brainUsed/brainRemaining）。
  const hourly = hasData
    ? (report.hourlyInstant ?? report.hourly)
    : Array.from({ length: 24 }, (_, h) => ({ hour: h, score: 0, hasData: false }));
  const spans = hasData
    ? { peak: report.peakLoadSpan, best: report.bestSpan, sleep: report.sleepWindow }
    : { peak: null, best: null, sleep: null };

  // ★ v18.129 疲劳度大数字也切到**瞬时**均值 `avgFatigueInstant` —— 必须与柱状图同源，
  //   否则出现「柱子都在同一档，但数字差很多」的割裂（v18.127 首页已切，详情页漏了）。
  const fatigueShown = report.avgFatigueInstant ?? report.avgFatigue;
  // 疲劳度大数字与柱状图同源；负荷分 loadScore 降为副信息
  const cogColor = (v: number | null) =>
    v == null ? theme.colors.textTitle
      : v >= COG_LEVEL_HIGH ? theme.colors.danger
      : v >= COG_LEVEL_LOW ? theme.colors.warn
      : theme.colors.success;
  const fCol = fatigueColor(report.fatigueLevel);

  return (
    <Card>
        {/* ── 头部 ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) }}>
          <Text style={styles.title}>认知疲劳度</Text>
          {note ? <Text style={styles.noteText}>{note}</Text> : null}
        </View>

        {/* ── 全天趋势分布图 ── */}
        <View style={styles.hourSection}>
          {/* 图例已内建在 HourHistogram 底部（此前的卡层图例与之重复展示） */}
          <HourHistogram hourly={hourly} peakSpan={spans.peak} bestSpan={spans.best} sleepWindow={spans.sleep} />
        </View>

        {/* ── 三个核心指标（无数据时换成提示，不显示假数字） ── */}
        {hasData ? (
          <View style={[styles.summaryGrid, { marginTop: theme.sp(2) }]}>
            <SumCell label="疲劳度" value={fatigueShown != null ? String(fatigueShown) : '—'} valueColor={cogColor(fatigueShown)} sub={report.loadScore != null ? `负荷 ${report.loadScore}` : undefined} />
            <SumCell label="疲劳指数" value={String(report.fatigueIndex)} valueColor={fCol} />
            <SumCell
              label="恢复能力"
              value={report.recoveryCapacity != null ? `${Math.round(report.recoveryCapacity * 100)}%` : '—'}
            />
          </View>
        ) : (
          <Text style={[styles.emptyText, { marginTop: theme.sp(2) }]}>
            连上戒指跑 2-3 轮自动监测后自动生成报告
          </Text>
        )}
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
  // ═══════════════════════════════════════════════════════════
  // 认知疲劳度 24 根整点柱 (hour = 钟点 0–23), 坐标系统一规范:
  //   Y 轴 0 基线 + 「低<40 / 中 40–70 / 高≥70」三档边界线
  //   X 轴 24h 完整刻度 (每 4h 主刻度)
  //   无数据柱画透明骨架, 睡眠遮罩叠在上面
  //   与 homepage MiniCognitiveBars / Hero chip 共用同一组阈值与配色
  // ═══════════════════════════════════════════════════════════
  const LEVELS = [
    { max: COG_LEVEL_LOW,  color: theme.colors.success, label: '低' },
    { max: COG_LEVEL_HIGH, color: theme.colors.warn,    label: '中' },
    { max: 101,            color: theme.colors.danger,  label: '高' },
  ];
  const barColor = (v: number) => LEVELS.find(l => v < l.max)!.color;

  const N = 24;
  const rows = Array.from({ length: N }, (_, i) => {
    const raw = hourly?.find(h => h.hour === i);
    const hasData = raw?.hasData === true && raw?.score != null;
    return { hour: i, score: raw?.score ?? 0, hasData };
  });

  // ── 画布尺寸：宽度用 onLayout 实测（保证图表严格落在所在卡片框内），
  //    首帧未测量时退回「屏宽 - 页边距 - 卡片内边距」的保守估算 ──
  const [measuredW, setMeasuredW] = React.useState(0);
  const estW = Dimensions.get('window').width - theme.space.screen * 2 - theme.space.cardPad * 2;
  const Y_W = theme.sp(7);         // Y 轴标签预留宽 = 28px
  const padL = Y_W + theme.sp(1);  // 32px, 含 Y 轴标签
  const padR = theme.sp(3);
  const padT = theme.sp(2);
  const padB = theme.sp(6);        // X 轴 label + padding = 24px
  const svgW = measuredW > padL + padR ? measuredW : estW;
  const svgH = (chartH ?? theme.sp(50)) - theme.sp(2);
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const slotW = plotW / N;
  const barW = slotW * 0.55;
  const cx = (step: number) => padL + slotW * (step + 0.5);
  const yFor = (v: number) => padT + plotH - (v / 100) * plotH;

  // ── 遮罩 X 坐标 (sleepWindow / peakSpan / bestSpan 的 hour 已是钟点 0–23) ──
  const sleepMask = sleepWindow ? (() => {
    const sX = cx(sleepWindow.bedHour) - barW / 2;
    const eX = cx(Math.min(23, sleepWindow.wakeHour)) + barW / 2;
    return { sX, eX: Math.max(eX, sX + 4) };
  })() : null;
  const peakSX = peakSpan ? cx(peakSpan.startHour) - barW / 2 : 0;
  const peakEX = peakSpan ? cx(Math.min(23, peakSpan.endHour)) + barW / 2 : 0;
  const bestSX = bestSpan ? cx(bestSpan.startHour) - barW / 2 : 0;
  const bestEX = bestSpan ? cx(Math.min(23, bestSpan.endHour)) + barW / 2 : 0;

  const anyData = rows.some(r => r.hasData);

  // ── X 轴刻度: 每 4 小时主刻度 (钟点 0/4/8/12/16/20/24) ──
  // ★ 末刻度是「24」不是 23（用户要求横坐标满 24），24 点画在绘图区右缘、右对齐
  const MAIN_HOURS = [0, 4, 8, 12, 16, 20, 24];
  const mainTicks = MAIN_HOURS.map(h => ({
    step: h,
    x: h === 24 ? padL + plotW : cx(h),
    label: String(h).padStart(2, '0'),
    align: h === 0 ? 'start' as const : h >= 24 ? 'end' as const : 'middle' as const,
  }));

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w);
      }}
      style={{ width: '100%' }}
    >
      <Svg width={svgW} height={svgH + theme.sp(2)}>

        {/* ═══ Y 轴网格 (0 基线 + 档位边界虚线) + 档位文字 ═══ */}
        {/* 0 基线 (实线加粗) */}
        <Path d={`M ${padL} ${yFor(0)} L ${padL + plotW} ${yFor(0)}`}
          stroke={theme.colors.ui.borderSoft} strokeWidth={1.2} />
        {/* 3 条网格虚线 (对齐档位边界) */}
        {[COG_LEVEL_LOW, COG_LEVEL_HIGH].map(v => (
          <Path key={'yg' + v}
            d={`M ${padL} ${yFor(v)} L ${padL + plotW} ${yFor(v)}`}
            stroke={theme.colors.ui.borderSoft}
            strokeWidth={0.8} strokeDasharray="3 3" />
        ))}
        {/* 3 档 Y 轴文字 — 低/中/高, 颜色对应档位 */}
        {LEVELS.map((lv, i) => {
          // 档位中值 Y 坐标（低 0–40→20, 中 40–70→55, 高 70–100→85）
          const midV = i === 0 ? 20 : i === 1 ? 55 : 85;
          const y = yFor(midV);
          return (
            <G key={'yl' + i}>
              <SvgText x={padL - theme.sp(1.5)} y={y + 3}
                textAnchor="end" fontSize={theme.fontSize.micro}
                fontWeight="600" fill={lv.color}>
                {lv.label}
              </SvgText>
            </G>
          );
        })}

        {/* ═══ 档位边界虚线 (叠加在网格上) ═══ */}
        {[COG_LEVEL_LOW, COG_LEVEL_HIGH].map(v => (
          <Path key={'g' + v}
            d={`M ${padL} ${yFor(v)} L ${padL + plotW} ${yFor(v)}`}
            stroke={theme.colors.textSub + '30'} strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* ═══ 睡眠遮罩 ═══ */}
        {sleepMask && sleepMask.eX > sleepMask.sX + 2 && (
          <>
            <Rect x={sleepMask.sX} y={padT}
              width={sleepMask.eX - sleepMask.sX} height={plotH}
              fill={theme.colors.ui.borderSoft} />
            <SvgText x={(sleepMask.sX + sleepMask.eX) / 2} y={padT + theme.sp(3)}
              textAnchor="middle" fontSize={theme.fontSize.micro}
              fill={theme.colors.textSub} fontWeight="600">
              睡眠中
            </SvgText>
          </>
        )}

        {/* ═══ peakSpan / bestSpan 遮罩 ═══ */}
        {peakSpan && peakEX > peakSX && (
          <Rect x={peakSX} y={padT} width={peakEX - peakSX} height={plotH}
            fill={theme.colors.accentSoft} />
        )}
        {bestSpan && bestEX > bestSX && (
          <Rect x={bestSX} y={padT} width={bestEX - bestSX} height={plotH}
            fill={theme.colors.successSoft} />
        )}

        {/* ═══ 24 根整点柱 · ★ v18.129 柱高改**档位离散**（低/中/高三级，同档等高）
             与首页 MiniCognitiveBars 调同一个 cogBarRatio()，两处必然同款。
             原先 `(r.score/100)*plotH` 连续映射：同属「低」档的 12/16/19 会画出三根不同高度，
             视觉上像在说 19 比 12 累得多 —— 同档内无此含义。 ═══ */}
        {rows.map(r => {
          const x = cx(r.hour) - barW / 2;
          const c = r.hasData ? barColor(r.score) : theme.colors.ui.white25;
          const ratio = r.hasData ? cogBarRatio(r.score) : null;
          const h = ratio == null ? theme.sp(0.5) : Math.max(theme.sp(0.5), ratio * plotH);
          const y = padT + plotH - h;
          return (
            <Rect key={'b' + r.hour}
              x={x} y={y} width={barW} height={h}
              fill={c} rx={theme.sp(0.75)}
              opacity={r.hasData ? 0.9 : 0.08} />
          );
        })}

        {/* ═══ X 轴主刻度 (每 4h) ═══ */}
        {mainTicks.map(t => (
          <SvgText key={'tx' + t.step} x={cx(t.step)} y={padT + plotH + theme.sp(4)}
            textAnchor={t.align} fontSize={theme.fontSize.xs}
            fill={theme.colors.textSub}>
            {t.label}
          </SvgText>
        ))}

        {/* ═══ X 轴次刻度 (每 2h 细灰线, 避开主刻度) ═══ */}
        {[2, 6, 10, 14, 18, 22].map(step => (
          <Path key={'txs' + step}
            d={`M ${cx(step)} ${padT + plotH} L ${cx(step)} ${padT + plotH + theme.sp(0.75)}`}
            stroke={theme.colors.textSub} strokeWidth={0.5} opacity={0.4} />
        ))}
      </Svg>

      {/* 档位图例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.sp(3), marginTop: theme.sp(1) }}>
        {LEVELS.map(l => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) }}>
            <View style={{ width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), backgroundColor: l.color, opacity: 0.85 }} />
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>{l.label}</Text>
          </View>
        ))}
      </View>

      {!anyData && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: padT + plotH / 2 - theme.sp(3), alignItems: 'center' }}>
          <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, backgroundColor: theme.colors.cardBgSoft + 'CC', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.sm }}>
            暂无数据
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── 复用 StressInsightCard token ──
  pad: { padding: theme.space.cardPad },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
  noteText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
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
