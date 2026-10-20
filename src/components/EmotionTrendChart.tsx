/**
 * EmotionTrendChart —— 情绪与唤醒 · 全天趋势图（D1：竖向进度条）
 *
 * ★ 2026-10-19（用户 finalized D1）：替换原 `StressTrendChart`（原心理压力 0–100 折线）。
 *   把"心理状态"拆成两个正交维度同屏展示：
 *     · 上：情绪 valence 线（−10~+10，零轴居中）——设备 emotionLevel 自动追踪；
 *     · 下：唤醒度（EDA 驱动，0–100）竖向进度条，**颜色越深 = 唤醒越高（身体越绷着）**；
 *     · 自报心情以「脸 icon」标在情绪线上（与 App 内 EmotionFaceIcon 同色同形）。
 *
 * 数据源（由 EmotionInsightView 预计算后传入，保证与首页/卡片同源）：
 *   · arousalSlots[48]  ← 原心理压力百分位（EDA/SCR 融合），重命名为「唤醒度」；
 *   · valenceSlots[48] ← 设备 emotionLevel(−10~+10) 逐 30 分钟均值；
 *   · markers[]        ← 用户手动心情记录（EmotionEntry.mood）。
 *
 * 诚实边界（沿用 emotionalStress 的口径）：
 *   · 唤醒度 = 身体交感激活，**读不出情绪种类**；
 *   · 情绪 valence 的正负由用户自报/设备判定，**不声称读懂主观情绪**；
 *   · 睡眠窗内不画（不插值、不画夜间唤醒）；运动中槽不参与连线。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import type { EmotionFaceMood } from './EmotionFaceIcon';

/** 五档情绪色（与 App 内 EmotionFaceIcon / 点阵 DOT_LEGEND 同源，绝不另起一套 hex） */
const MOOD: Record<EmotionFaceMood, { c: string; mouth: 'smile' | 'flat' | 'frown' }> = {
  excited: { c: '#F39A62', mouth: 'smile' },
  happy: { c: '#F2C35E', mouth: 'smile' },
  calm: { c: '#B8C86A', mouth: 'flat' },
  stressed: { c: '#D58AAE', mouth: 'frown' },
  sad: { c: '#7EA6F8', mouth: 'frown' },
};
/** 自报表情 → 代表 valence（落在 −10~+10 轴上，便于落点） */
const MOOD_VALENCE: Record<EmotionFaceMood, number> = {
  excited: 8, happy: 5, calm: 0, stressed: -5, sad: -8,
};

/** 唤醒度 0–100 → 深紫（深=高）。HSL 紫(266°) 亮度 70%→22%，饱和度随升。 */
function arousalColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const h = 266, s = 0.5 + 0.12 * t, l = 0.70 - 0.48 * t;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`;
}

export interface EmotionTrendMarker { slot: number; mood: EmotionFaceMood; valence?: number }

interface Props {
  /** 48 个 30 分钟槽的唤醒度 0–100（null = 无数据） */
  arousalSlots: (number | null)[];
  /** 48 个 30 分钟槽的情绪 valence −10~+10（null = 无数据） */
  valenceSlots: (number | null)[];
  /** 用户手动心情记录标记 */
  markers?: EmotionTrendMarker[];
  /** 标注「此刻」竖线（槽下标 0–47） */
  nowSlot?: number | null;
  /** 睡眠时段：窗内断开，不插值 */
  sleepWindow?: { bedHour: number; wakeHour: number } | null;
  chartH?: number;
}

const N = 48;

export default function EmotionTrendChart({
  arousalSlots, valenceSlots, markers = [], nowSlot, sleepWindow, chartH,
}: Props) {
  const [measuredW, setMeasuredW] = React.useState(0);
  const svgW = measuredW;
  const svgH = (chartH ?? theme.sp(64)) - theme.sp(2);
  const padL = theme.sp(7);
  const padR = theme.sp(9);
  const padT = theme.sp(3);
  const padB = theme.sp(13);
  const plotW = Math.max(1, svgW - padL - padR);
  const plotH = Math.max(1, svgH - padT - padB);

  // 上下两块：情绪线占 62%，唤醒条占 30%，中间留白
  const eH = plotH * 0.62;
  const aH = plotH * 0.30;
  const eTop = padT;
  const aTop = eTop + eH + theme.sp(10);

  const xAt = (slot: number) => padL + ((slot + 0.5) / N) * plotW;
  const vY = (val: number) => eTop + eH * (1 - (val + 10) / 20);     // −10~+10
  const aBottom = aTop + aH;

  const inSleep = (slot: number): boolean => {
    if (!sleepWindow) return false;
    const bedS = Math.max(0, Math.min(47, Math.floor(sleepWindow.bedHour * 2)));
    const wakeS = Math.max(0, Math.min(47, Math.floor(sleepWindow.wakeHour * 2)));
    if (bedS === wakeS) return false;
    if (bedS < wakeS) return slot >= bedS && slot <= wakeS;
    return slot >= bedS || slot <= wakeS;
  };

  // 情绪线：连续有值区段（睡眠/缺口断开，不插值）
  const vRuns: number[][] = [];
  {
    let cur: number[] = [];
    for (let s = 0; s < N; s++) {
      const v = valenceSlots[s];
      if (v != null && !inSleep(s)) cur.push(s);
      else { if (cur.length) vRuns.push(cur); cur = []; }
    }
    if (cur.length) vRuns.push(cur);
  }
  const smoothV = (idx: number[]) => {
    if (idx.length < 2) return '';
    const pts = idx.map((s) => ({ x: xAt(s), y: vY(valenceSlots[s]!) }));
    if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const anyValence = valenceSlots.some((v) => v != null);
  const anyArousal = arousalSlots.some((v) => v != null);
  const anyData = anyValence || anyArousal;

  const HOURS = [0, 6, 12, 18, 24];
  const xTick = (h: number) => (h === 24 ? padL + plotW : padL + (h / 24) * plotW);

  return (
    <View>
      <View
        onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - measuredW) > 1) setMeasuredW(w); }}
        style={{ width: '100%' }}
      >
        {svgW > 0 ? (
          <Svg width={svgW} height={svgH + theme.sp(2)}>
            <Defs>
              <SvgLinear id="valenceArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={chart.series.primary} stopOpacity={0.22} />
                <Stop offset="100%" stopColor={chart.series.primary} stopOpacity={0.01} />
              </SvgLinear>
            </Defs>

            {/* 情绪区：−10 / 0 / +10 网格 + 零轴 */}
            {[-10, 10].map((v) => (
              <Path key={'v' + v} d={`M ${padL} ${vY(v)} L ${padL + plotW} ${vY(v)}`} stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
            ))}
            <Path d={`M ${padL} ${vY(0)} L ${padL + plotW} ${vY(0)}`} stroke={chart.refFaint} strokeWidth={1.3} strokeDasharray={chart.dash.ref} />
            {[-10, 0, 10].map((v) => (
              <SvgText key={'vy' + v} x={padL - theme.sp(1.5)} y={vY(v) + 3} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>{v > 0 ? '+' + v : v}</SvgText>
            ))}

            {/* 情绪线 + 面积 */}
            {vRuns.map((idx, i) => idx.length > 1 ? (
              <React.Fragment key={'vr' + i}>
                <Path d={`${smoothV(idx)} L ${xAt(idx[idx.length - 1]).toFixed(1)} ${aBottom.toFixed(1)} L ${xAt(idx[0]).toFixed(1)} ${aBottom.toFixed(1)} Z`} fill="url(#valenceArea)" opacity={0.5} />
                <Path d={smoothV(idx)} fill="none" stroke={chart.series.primary} strokeWidth={chart.lw.series} strokeLinecap="round" strokeLinejoin="round" />
              </React.Fragment>
            ) : (
              <Circle key={'vp' + i} cx={xAt(idx[0])} cy={vY(valenceSlots[idx[0]]!)} r={chart.dot.radius} fill={chart.series.primary} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
            ))}

            {/* 自报表情标记（落在情绪线上，深底光环 + 脸 icon） */}
            {markers.map((mk, i) => {
              if (mk.slot < 0 || mk.slot >= N) return null;
              const cx = xAt(mk.slot);
              const cy = vY(mk.valence ?? MOOD_VALENCE[mk.mood]);
              return (
                <React.Fragment key={'mk' + i}>
                  <Circle cx={cx} cy={cy} r={13} fill="#0E1A2B" opacity={0.5} />
                  {faceCircle(cx, cy, mk.mood, 9)}
                </React.Fragment>
              );
            })}

            {/* 唤醒度：竖向进度条（深=高） */}
            <Rect x={padL} y={aTop} width={plotW} height={aH} rx={8} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
            {Array.from({ length: N }).map((_, s) => {
              const v = arousalSlots[s];
              if (v == null || inSleep(s)) return null;
              const bw = Math.max(1.5, (plotW / N) * 0.6);
              const bh = Math.max(1.5, (v / 100) * aH);
              const x = xAt(s) - bw / 2;
              const y = aBottom - bh;
              return <Rect key={'ar' + s} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} rx={(bw / 2).toFixed(1)} fill={arousalColor(v)} />;
            })}
            {/* 唤醒区左标签 */}
            <SvgText x={padL - theme.sp(1.5)} y={aTop + 11} textAnchor="end" fontSize={theme.fontSize.micro} fill={theme.colors.textSub}>唤醒</SvgText>

            {/* 此刻竖线（贯穿两块） */}
            {nowSlot != null && nowSlot >= 0 && nowSlot < N ? (
              <Line x1={xAt(nowSlot)} y1={eTop} x2={xAt(nowSlot)} y2={aBottom} stroke={chart.series.primary} strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} opacity={0.5} />
            ) : null}

            {/* X 轴刻度 */}
            {HOURS.map((h) => {
              const x = xTick(h);
              const align = h === 0 ? 'start' : h >= 24 ? 'end' : 'middle';
              return <SvgText key={'x' + h} x={x} y={aBottom + theme.sp(11)} textAnchor={align} fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>{String(h).padStart(2, '0')}</SvgText>;
            })}
          </Svg>
        ) : null}
      </View>

      {/* 图例 + 口径说明 */}
      <View style={styles.legendRow}>
        {(Object.keys(MOOD) as EmotionFaceMood[]).map((m) => (
          <View key={m} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: MOOD[m].c }]} />
            <Text style={styles.legendText}>{({ excited: '兴奋', happy: '开心', calm: '平静', stressed: '压力', sad: '难过' } as Record<EmotionFaceMood, string>)[m]}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: arousalColor(85) }]} />
          <Text style={styles.legendText}>唤醒·深=高</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        {anyData
          ? '紫线 = 情绪（−10~+10，零为中性）· 脸 = 你记的心情 · 下方条 = 唤醒度（身体激活，越深越绷着）'
          : '今天还没有可判定的时段 · 连上戒指开启自动监测后开始生成（约需 3 天建立个人基线）'}
      </Text>
    </View>
  );
}

/** 单纯返回一张脸的 SVG 片段（Circle + 眼 + 嘴），供标记复用 */
function faceCircle(cx: number, cy: number, mood: EmotionFaceMood, r: number): React.ReactNode {
  const m = MOOD[mood];
  const eyeY = cy - r * 0.28;
  const eyeDx = r * 0.38;
  const eyeR = Math.max(0.9, r * 0.13);
  const mouthY = cy + r * 0.22;
  const dark = '#1A2030';
  let mouth: string;
  if (m.mouth === 'smile') mouth = `M ${(cx - r * 0.45).toFixed(1)} ${mouthY.toFixed(1)} Q ${cx.toFixed(1)} ${(cy + r * 0.62).toFixed(1)} ${(cx + r * 0.45).toFixed(1)} ${mouthY.toFixed(1)}`;
  else if (m.mouth === 'frown') mouth = `M ${(cx - r * 0.45).toFixed(1)} ${(cy + r * 0.5).toFixed(1)} Q ${cx.toFixed(1)} ${(mouthY - r * 0.1).toFixed(1)} ${(cx + r * 0.45).toFixed(1)} ${(cy + r * 0.5).toFixed(1)}`;
  else mouth = `M ${(cx - r * 0.42).toFixed(1)} ${mouthY.toFixed(1)} L ${(cx + r * 0.42).toFixed(1)} ${mouthY.toFixed(1)}`;
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} fill={m.c} stroke="#0E1A2B" strokeWidth={1} />
      <Circle cx={cx - eyeDx} cy={eyeY} r={eyeR} fill={dark} />
      <Circle cx={cx + eyeDx} cy={eyeY} r={eyeR} fill={dark} />
      <Path d={mouth} stroke={dark} strokeWidth={r * 0.14} fill="none" strokeLinecap="round" />
    </>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', marginTop: theme.sp(2), gap: theme.space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  caption: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1), lineHeight: 16 },
});
