/**
 * ReadinessTrendChart —— 认知准备度「全天趋势图」（折线 + 面积）
 *
 * ★ 替换原 `HourHistogram`（24 根离散柱）。
 * 为什么改柱状图 → 趋势图：
 *   准备度是**连续状态量**（晨高晚低的波形），柱状图会把相邻两小时切成互不相干的
 *   两根柱子，看不出「上午一路走高、傍晚回落」这个最重要的形态。折线才表达趋势。
 *
 * 与旧柱状图刻意保持一致的部分（避免同一张卡换皮换味）：
 *   · 同一数据源（hourlyInstant 同一小时是否有采样 → hasData 严格对齐）；
 *   · 同一档位阈值（40 / 70）与配色语义（高=绿好 / 中=黄 / 低=红）；
 *   · 睡眠时段遮罩 + 「睡眠中」标注；
 *   · X 轴 0–24 完整刻度（每 4h 主刻度）。
 *
 * 诚实边界：无数据小时不插值、不连线（`runs` 按连续有值区段切分），图上留空。
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText, Circle, Line, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { READY_LOW, READY_HIGH, type ReadinessPoint } from '../lib/cognitiveReadiness';

/** 准备度三档配色：分数高 = 状态好 = 绿（与疲劳档位方向相反） */
const LEVELS = [
  { min: READY_HIGH, color: theme.colors.success, label: '充足' },
  { min: READY_LOW, color: theme.colors.warn, label: '中等' },
  { min: -1, color: theme.colors.danger, label: '偏低' },
];
export function readinessColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return theme.colors.textSub;
  return LEVELS.find((l) => v >= l.min)!.color;
}

interface Props {
  points: ReadinessPoint[];
  /** 睡眠窗（小时）→ 画遮罩 */
  sleepWindow?: { bedHour: number; wakeHour: number } | null;
  /** 标注一个「此刻」竖线（首页/详情页日视图用） */
  nowHour?: number | null;
  /** 图下方说明（如「与个人基线相比」）；不传则不渲染 */
  caption?: string;
  chartH?: number;
}

export default function ReadinessTrendChart({ points, sleepWindow, nowHour, caption, chartH }: Props) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const estW = Dimensions.get('window').width - theme.space.screen * 2 - theme.space.cardPad * 2;
  const Y_W = theme.sp(7);
  const padL = Y_W + theme.sp(1);
  const padR = theme.sp(3);
  const padT = theme.sp(2);
  const padB = theme.sp(6);
  const svgW = measuredW > padL + padR ? measuredW : estW;
  const svgH = (chartH ?? theme.sp(50)) - theme.sp(2);
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const N = 24;
  const xAt = (h: number) => padL + (plotW * h) / N;
  const yAt = (v: number) => padT + plotH - (v / 100) * plotH;

  // ── 按连续有值区段切分（缺口处不连线） ──
  const runs: { idx: number[] }[] = [];
  {
    let cur: number[] = [];
    for (let h = 0; h < N; h++) {
      if (points[h]?.hasData) cur.push(h);
      else { if (cur.length) runs.push({ idx: cur }); cur = []; }
    }
    if (cur.length) runs.push({ idx: cur });
  }
  const lineOf = (idx: number[]) =>
    idx.map((h, k) => `${k === 0 ? 'M' : 'L'} ${xAt(h).toFixed(1)} ${yAt(points[h].score).toFixed(1)}`).join(' ');
  const areaOf = (idx: number[]) =>
    `${lineOf(idx)} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(idx[0]).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const anyData = points.some((p) => p.hasData);

  // 睡眠遮罩
  const sleepMask = sleepWindow ? (() => {
    const sX = xAt(sleepWindow.bedHour);
    const eX = xAt(Math.min(24, sleepWindow.wakeHour));
    return { sX, eX: Math.max(eX, sX + 4) };
  })() : null;

  // 档位边界虚线（40 / 70）
  const bounds = [READY_LOW, READY_HIGH];
  const MAIN_HOURS = [0, 4, 8, 12, 16, 20, 24];

  return (
    <View
      onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
      style={{ width: '100%' }}
    >
      <Svg width={svgW} height={svgH + theme.sp(2)}>
        <Defs>
          <SvgLinear id="readyArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={theme.colors.accentSolid} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={theme.colors.accentSolid} stopOpacity={0.01} />
          </SvgLinear>
        </Defs>

        {/* 0 基线 */}
        <Path d={`M ${padL} ${yAt(0)} L ${padL + plotW} ${yAt(0)}`} stroke={theme.colors.ui.borderSoft} strokeWidth={1.2} />
        {/* 档位边界虚线 */}
        {bounds.map((v) => (
          <Path key={'b' + v} d={`M ${padL} ${yAt(v)} L ${padL + plotW} ${yAt(v)}`}
            stroke={theme.colors.textSub + '30'} strokeWidth={1} strokeDasharray="3 3" />
        ))}
        {/* 档位文字（右侧） */}
        {LEVELS.map((lv, i) => {
          const v = i === 0 ? 85 : i === 1 ? 55 : 20;
          return (
            <SvgText key={'lb' + i} x={padL - theme.sp(1.5)} y={yAt(v) + 3} textAnchor="end"
              fontSize={theme.fontSize.micro} fontWeight="600" fill={lv.color}>{lv.label}</SvgText>
          );
        })}

        {/* 睡眠遮罩 */}
        {sleepMask && sleepMask.eX > sleepMask.sX + 2 && (
          <>
            <Rect x={sleepMask.sX} y={padT} width={sleepMask.eX - sleepMask.sX} height={plotH} fill={theme.colors.ui.borderSoft} />
            <SvgText x={(sleepMask.sX + sleepMask.eX) / 2} y={padT + theme.sp(3)} textAnchor="middle"
              fontSize={theme.fontSize.micro} fill={theme.colors.textSub} fontWeight="600">睡眠中</SvgText>
          </>
        )}

        {/* 面积 + 折线 */}
        {runs.map((r, i) => r.idx.length > 1 ? (
          <React.Fragment key={'r' + i}>
            <Path d={areaOf(r.idx)} fill="url(#readyArea)" />
            <Path d={lineOf(r.idx)} fill="none" stroke={theme.colors.accentSolid}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </React.Fragment>
        ) : null)}

        {/* 单点区段（只有一个有值小时）画一个点，否则该小时会完全看不见 */}
        {runs.map((r, i) => r.idx.length === 1 ? (
          <Circle key={'p' + i} cx={xAt(r.idx[0])} cy={yAt(points[r.idx[0]].score)} r={2.6}
            fill={theme.colors.accentSolid} stroke={theme.colors.cardBg} strokeWidth={1.2} />
        ) : null)}

        {/* 「此刻」竖线 + 定位点 */}
        {nowHour != null && points[nowHour]?.hasData ? (
          <>
            <Line x1={xAt(nowHour)} y1={padT} x2={xAt(nowHour)} y2={padT + plotH}
              stroke={theme.colors.accentSolid} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
            <Circle cx={xAt(nowHour)} cy={yAt(points[nowHour].score)} r={4}
              fill={theme.colors.accentSolid} stroke={theme.colors.cardBg} strokeWidth={1.6} />
          </>
        ) : null}

        {/* X 轴主刻度 */}
        {MAIN_HOURS.map((h) => {
          const x = h === 24 ? padL + plotW : xAt(h);
          const align = h === 0 ? 'start' : h >= 24 ? 'end' : 'middle';
          return (
            <SvgText key={'tx' + h} x={x} y={padT + plotH + theme.sp(4)} textAnchor={align}
              fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>{String(h).padStart(2, '0')}</SvgText>
          );
        })}
      </Svg>

      {/* 档位图例 */}
      <View style={styles.legendRow}>
        {LEVELS.map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: l.color }]} />
            <Text style={styles.legendText}>{l.label}</Text>
          </View>
        ))}
      </View>

      {caption ? <Text style={styles.caption}>{caption}</Text> : null}

      {!anyData && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>暂无数据</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: theme.sp(3), marginTop: theme.sp(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  dot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5) },
  legendText: { fontSize: theme.fontSize.xs, color: theme.colors.textSub },
  caption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1) },
  emptyOverlay: { position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center' },
  emptyText: {
    fontSize: theme.fontSize.sm, color: theme.colors.textSub,
    backgroundColor: theme.colors.cardBgSoft + 'CC', paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5), borderRadius: theme.radius.sm,
  },
});
