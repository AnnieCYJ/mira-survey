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
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Text as SvgText, Circle, Line, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { READY_LOW, READY_HIGH, type ReadinessPoint } from '../lib/cognitiveReadiness';

/** 准备度三档配色：分数高 = 状态好 = 绿（与疲劳档位方向相反） */
const LEVELS = [
  { min: READY_HIGH, color: theme.colors.success, label: '高', range: '高 >70' },
  { min: READY_LOW, color: theme.colors.warn, label: '中', range: '中 40-70' },
  { min: -1, color: theme.colors.danger, label: '低', range: '低 <40' },
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
  // ★ 2026-10-06（用户：左边纵坐标再往边一点）：padL 加大，0/100 刻度数字不挤曲线
  const Y_W = theme.sp(8);
  const padL = Y_W + theme.sp(2);
  // ★ 2026-10-06（用户：图表两侧留白太多、显得又窄又小）：右侧只留「高/中/低」标注需要的宽度，
  //   不再额外空一截；同时给图更大高度，让折线有振幅空间。
  const padR = theme.sp(6);
  const padT = theme.sp(2);
  const padB = theme.sp(6);
  // ★ 关键修复：measuredW 尚未上报时**不要**用 estW 顶替（那会让图先按窄屏宽渲染、显得小且居中）；
  //   未测量到宽度时先不渲染 SVG，测到后按真实宽度画满整行 → 图自然变宽、贴齐卡片左右。
  const svgW = measuredW > padL + padR ? measuredW : 0;
  const svgH = (chartH ?? theme.sp(50)) - theme.sp(2);
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  // ★ 2026-10-06（用户：所有指标统一 30 分钟一个点）：N 由 24 改为 48 个半小时槽
  const N = 48;
  const xAt = (slot: number) => padL + (plotW * slot) / N;
  const yAt = (v: number) => padT + plotH - (v / 100) * plotH;

  // ── 按连续有值区段切分（缺口处不连线） ──
  const runs: { idx: number[] }[] = [];
  {
    let cur: number[] = [];
    for (let s = 0; s < N; s++) {
      if (points[s]?.hasData) cur.push(s);
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
  // ★ 2026-10-06：N=48（半小时槽），X 轴主刻度每 4 小时 = 每 8 槽
  const MAIN_HOURS = [0, 4, 8, 12, 16, 20, 24];

  return (
    <View
      onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
      style={{ width: '100%' }}
    >
      {svgW > 0 ? (
      <Svg width={svgW} height={svgH + theme.sp(2)}>
        <Defs>
          <SvgLinear id="readyArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={chart.series.primary} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={chart.series.primary} stopOpacity={0.01} />
          </SvgLinear>
        </Defs>

        {/* ★ 2026-10-06（用户口径）：纵轴 = 0-100，三档柔和背景带 + 右侧低/中/高标注
            （脑力是连续量纲，色带只做背景分区、不给点染色；主视觉仍是 0-100 折线） */}
        {[0, 1, 2].map((i) => {
          const hi = i === 0 ? 100 : i === 1 ? READY_HIGH : READY_LOW;
          const lo = i === 0 ? READY_HIGH : i === 1 ? READY_LOW : 0;
          return (
            <Rect key={'band' + i} x={padL} y={yAt(hi)} width={plotW} height={Math.max(0, yAt(lo) - yAt(hi))}
              fill={LEVELS[i].color} opacity={0.07} />
          );
        })}
        {/* 0 基线（网格 token：线宽 1 + 3 4 虚线） */}
        <Path d={`M ${padL} ${yAt(0)} L ${padL + plotW} ${yAt(0)}`} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
        {/* 档位边界虚线（仅作 40/70 参考基准：参考虚线 token：线宽 1.3 + 5 4） */}
        {bounds.map((v) => (
          <Path key={'b' + v} d={`M ${padL} ${yAt(v)} L ${padL + plotW} ${yAt(v)}`}
            stroke={chart.refFaint} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} />
        ))}
        {/* 数值刻度锚点（0 / 100） */}
        <SvgText key="y100" x={padL - theme.sp(1.5)} y={yAt(100) + 3} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>100</SvgText>
        <SvgText key="y0" x={padL - theme.sp(1.5)} y={yAt(0) + 3} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>0</SvgText>

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
            <Path d={lineOf(r.idx)} fill="none" stroke={chart.series.primary}
              strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
          </React.Fragment>
        ) : null)}

        {/* 单点区段（只有一个有值小时）画一个点，否则该小时会完全看不见 */}
        {runs.map((r, i) => r.idx.length === 1 ? (
          <Circle key={'p' + i} cx={xAt(r.idx[0])} cy={yAt(points[r.idx[0]].score)} r={chart.dot.radius}
            fill={chart.series.primary} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
        ) : null)}

        {/* 「此刻」竖线 + 定位点（nowHour 为钟点 0–23 → 换算成槽号 ×2） */}
        {nowHour != null && points[nowHour * 2]?.hasData ? (
          <>
            <Line x1={xAt(nowHour * 2)} y1={padT} x2={xAt(nowHour * 2)} y2={padT + plotH}
              stroke={chart.series.primary} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} opacity={0.55} />
            <Circle cx={xAt(nowHour * 2)} cy={yAt(points[nowHour * 2].score)} r={4}
              fill={chart.series.primary} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
          </>
        ) : null}

        {/* 右侧档位标注：低(<40) / 中(40-70) / 高(>70) —— 纵轴 0-100 分区 */}
        {[
          { label: '高', v: (100 + READY_HIGH) / 2, color: theme.colors.success },
          { label: '中', v: (READY_HIGH + READY_LOW) / 2, color: theme.colors.warn },
          { label: '低', v: READY_LOW / 2, color: theme.colors.danger },
        ].map((b) => (
          <SvgText key={'lvl' + b.label} x={padL + plotW + theme.sp(1.5)} y={yAt(b.v) + 3}
            textAnchor="start" fontSize={theme.fontSize.micro} fill={b.color} fontWeight="600">{b.label}</SvgText>
        ))}

        {/* X 轴主刻度（每 4 小时 = 每 8 槽；24 时 = 末端边界） */}
        {MAIN_HOURS.map((h) => {
          const slot = h * 2;                       // 钟点 → 槽号
          const x = h === 24 ? padL + plotW : xAt(slot);
          const align = h === 0 ? 'start' : h >= 24 ? 'end' : 'middle';
          return (
            <SvgText key={'tx' + h} x={x} y={padT + plotH + theme.sp(4)} textAnchor={align}
              fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>{String(h).padStart(2, '0')}</SvgText>
          );
        })}
      </Svg>
      ) : null}

      {/* ★ 2026-10-06（用户口径）：图例改为中性文字说明 0-100 量纲与阈值参考，不再用彩色圆点渲染三档 */}
      <View style={styles.legendRow}>
        <Text style={styles.legendText}>0–100 量纲 · {'<40'} 偏低 · 40–70 适中 · {'>70'} 充沛</Text>
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
