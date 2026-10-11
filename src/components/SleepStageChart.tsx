import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import { parseClockMinutes } from '../lib/sleepTime';
import type { SleepSegment } from '../ble/RingBleManager';

/** 睡眠阶段元数据：颜色严格取自 design token，避免裸值。
 *  0=深睡 1=浅睡 2=REM 3=失眠 4=清醒（KH18 固件通常只返回 0/1/2/4）。
 *  每个阶段占独立水平带（row），行高和行间距都压小，形成参考图那种密集分层。
 */
// v16 reskin（2026-09-24）：分期改四色系统（SPEC §3 睡眠分期 4 类，失眠并入「清醒·夜间醒来」）。
// ★ 2026-10-10（用户，覆盖 bar-spec P0 ④）：整夜分期图必须与「睡眠分析」卡下方图例同色
//   （深睡=紫 core / 浅睡=紫 mid / REM=蓝 skyCore / 清醒=黄 honeyCore）——图例是基准，图跟图例走：
//   深睡 purpleCore / 浅睡 purpleMid / REM skyCore / 清醒 honeyCore / 失眠 honeyDeep。
export const SLEEP_STAGE_META: Record<number, { label: string; color: string; row: number }> = {
  0: { label: '深睡', color: mm.colors.purpleCore, row: 0 },   // 最底行（最深档）
  1: { label: '浅睡', color: mm.colors.purpleMid, row: 1 },    // 中档
  2: { label: 'REM', color: mm.colors.skyCore, row: 2 },       // 亮档
  3: { label: '失眠', color: mm.colors.honeyDeep, row: 3 },    // 清醒·夜间醒来（黄，深档示警）
  4: { label: '清醒', color: mm.colors.honeyCore, row: 3 },    // 最顶行，黄小条
};

const ROW_H = theme.sp(4.5);       // 行带高度 ≈18
const BAR_H = theme.sp(2.5);       // 行内矩形高度 ≈10（短于行高，形成呼吸感）
const ROW_GAP = theme.sp(0.75);    // 行间距 ≈3（密集）
const AXIS_H = theme.sp(5);        // 时间轴
// ★ 2026-10-10：HRV 第二层（Oura 的「上分期 / 下 HRV」双层结构）
const HRV_BAND_H = theme.sp(7);    // HRV 层总高（含上下留白）
const HRV_BAR_H = theme.sp(5);     // HRV 柱区高度

/**
 * 时间轴起点（自 0 点分钟数）。
 *
 * ★ 必须复用 `lib/sleepTime.parseClockMinutes`（全仓唯一实现）：睡眠时刻串既可能是
 * `"01:38"`，也可能是原生原样的 `"2026-09-18 01:38"`。旧实现在此写死
 * `/^\d{1,2}:\d{2}/`（要求**以 HH:mm 开头**）→ 遇到完整 datetime 直接 null →
 * 时间轴退化成 `+0h / +2h` 相对刻度，刻度与真实入睡时刻错位。
 * 下方 `fmtClock` 的 `%24` 取模与「每 2 小时一刻度」的跨天逻辑本身是正确的，保持不动。
 */
const parseClock = parseClockMinutes;

function fmtClock(absMin: number): string {
  const h = (((Math.floor(absMin / 60) % 24) + 24) % 24);
  const m = (((absMin % 60) + 60) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function SleepStageChart({
  segments,
  sleepTime,
  totalMinutes,
  hrvLayer,
  bedTimeMs,
}: {
  segments: SleepSegment[];
  sleepTime?: string | null;
  /** 横轴基准（分钟）—— 传卡片标题同源的「总睡眠时长」；缺省则回落到分期段跨度 */
  totalMinutes?: number | null;
  /**
   * ★ 2026-10-10（用户：心率变异性分「睡眠阶段 / 日间」两个展示）：夜间 HRV 作为**第二层**
   * 画在分期条下面，与分期共用同一个 `x(min)` 映射 —— 这是 Oura 的结构（上分期 / 下 HRV），
   * 两者时间轴天然对齐，能直接看出「HRV 高点落在哪个分期」。
   * 数据传**绝对时间戳**（`{t: epochMs, v: ms}`），本组件按入睡时刻换算成相对分钟。
   */
  hrvLayer?: { t: number; v: number }[] | null;
  /** hrvLayer 的参考起点（入睡时刻，epoch ms）。缺省则用 sleepTime 解析 */
  bedTimeMs?: number | null;
}) {
  const { width: winW } = useWindowDimensions();
  const padX = theme.space.screen + theme.space.cardPad;
  const W = Math.max(200, winW - padX * 2);
  const rows = [0, 1, 2, 3];
  const chartH = rows.length * ROW_H + (rows.length - 1) * ROW_GAP;
  const showHrv = !!(hrvLayer && hrvLayer.length > 0);
  const H = chartH + (showHrv ? HRV_BAND_H : 0) + AXIS_H;
  const segSpan = segments && segments.length > 0
    ? segments[segments.length - 1].end
    : 0;

  /**
   * ★ 横轴基准 = **卡片标题同源的「总睡眠时长」**（summary.total），缺失才回落到分期段跨度。
   *
   * 为什么必须同源：分期曲线（sleepLine 逐分钟）与「总睡眠」口径不同 —— 实测同一晚
   * 曲线跨度 540 分钟而 summary.total = 521（尾部清醒/未计入段），此前横轴按 540 画、
   * 标题写 521，两个数字对不上（相差 19 分钟），用户会以为数据错。
   *
   * 曲线比总时长长时，把段尾**夹回轴内**（Math.min），避免条形溢出画布 / 刻度跑到框外；
   * 19 分钟量级的压缩在视觉上不可见，但「轴长 = 标题数字」的口径从此一致。
   */
  const totalMin = totalMinutes != null && totalMinutes > 0 ? totalMinutes : segSpan;

  const x = (min: number) => (totalMin > 0 ? (Math.min(min, totalMin) / totalMin) * W : 0);
  const startAbs = parseClock(sleepTime);

  // 时间轴刻度：从入睡时间开始，每 2 小时一个标签
  const ticks: { x: number; label: string }[] = [];
  if (startAbs != null && totalMin > 0) {
    let cur = Math.ceil(startAbs / 60) * 60;
    const endAbs = startAbs + totalMin;
    while (cur <= endAbs && ticks.length < 40) {
      const rel = cur - startAbs;
      ticks.push({ x: x(rel), label: fmtClock(cur) });
      cur += 120;
    }
  } else if (totalMin > 0) {
    for (let t = 0; t <= totalMin; t += 120) {
      ticks.push({ x: x(t), label: `+${Math.round(t / 60)}h` });
    }
  }

  if (!segments || segments.length === 0) {
    return (
      <View style={[styles.empty, { height: H }]}>
        <Text style={styles.emptyText}>昨夜睡眠结构暂未同步</Text>
      </View>
    );
  }

  // 行底部 y 坐标（深睡在底）
  const rowBottomY = (rowIndex: number) =>
    chartH - (rowIndex + 1) * ROW_H - rowIndex * ROW_GAP;

  const gap = 0.5; // 段间极小间隙

  /**
   * HRV 第二层：把绝对时间戳的 HRV 序列按 5 分钟分桶（Oura 的rMSSD 也是 5 分钟一点），
   * 再映射到与分期同一个 `x(relMin)`—— 缺数据的槽不画（不插值）。
   */
  const hrvGeom = (() => {
    if (!showHrv || !hrvLayer) return null;
    const bed = bedTimeMs != null ? bedTimeMs : (startAbs != null ? startAbs * 60_000 : null);
    if (bed == null) return null;
    const slotMs = 5 * 60_000;
    const slotCount = Math.max(1, Math.ceil((totalMin * 60_000) / slotMs));
    const sum = new Array(slotCount).fill(0);
    const cnt = new Array(slotCount).fill(0);
    for (const p of hrvLayer) {
      if (!Number.isFinite(p.v) || p.v <= 0) continue;
      const s = Math.floor((p.t - bed) / slotMs);
      if (s < 0 || s >= slotCount) continue;
      sum[s] += p.v;
      cnt[s] += 1;
    }
    let hi = 0;
    for (let i = 0; i < slotCount; i++) if (cnt[i] > 0 && sum[i] / cnt[i] > hi) hi = sum[i] / cnt[i];
    const top = hi > 0 ? hi * 1.15 : 1;
    const bandTop = chartH + theme.sp(1);
    const baseY = bandTop + HRV_BAR_H;
    const slotW = totalMin > 0 ? (W / ((totalMin * 60_000) / slotMs)) : W / slotCount;
    const barW = Math.max(0.8, Math.min(chart.bar.maxWidth, slotW * chart.bar.slotRatio));
    const bars: React.ReactNode[] = [];
    for (let i = 0; i < slotCount; i++) {
      if (cnt[i] === 0) continue;                       // 缺口不画、不插值
      const v = sum[i] / cnt[i];
      const h = Math.max(chart.bar.minHeight, (v / top) * HRV_BAR_H);
      const relMin = (i * slotMs) / 60_000;
      bars.push(
        <Rect key={`h${i}`} x={x(relMin) + gap / 2} y={baseY - h} width={barW}
          height={h} rx={Math.min(chart.bar.radius, barW / 2)}
          fill={mm.colors.roseDeep} opacity={chart.bar.opacity.solid} />,
      );
    }
    return {
      bars,
      base: (
        <Line x1={0} y1={baseY} x2={W} y2={baseY} stroke={chart.grid}
          strokeWidth={chart.lw.grid} />
      ),
      label: (
        <>
          <SvgText x={0} y={bandTop + theme.sp(2.4)} fontSize={theme.fontSize.micro}
            fill={theme.colors.textSub}>HRV</SvgText>
          <SvgText x={W} y={bandTop + theme.sp(2.4)} fontSize={theme.fontSize.micro}
            fill={theme.colors.textSub} textAnchor="end">{`${Math.round(top)} ms`}</SvgText>
        </>
      ),
      offset: chartH + HRV_BAND_H,
    };
  })();

  return (
    <View>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* 阶段段：每个 type 落在自己的行内，矩形在行内居中 */}
        {segments.map((s, i) => {
          const meta = SLEEP_STAGE_META[s.type] ?? SLEEP_STAGE_META[1];
          const rawSx = x(s.start);
          const rawEx = x(s.end);
          const sw = Math.max(1.5, rawEx - rawSx - gap);
          const sx = rawSx + gap / 2;
          const rowY = rowBottomY(meta.row);
          const barY = rowY + (ROW_H - BAR_H) / 2; // 行内居中
          return (
            <Rect
              key={i}
              x={sx}
              y={barY}
              width={sw}
              height={BAR_H}
              fill={meta.color}
              rx={chart.barRadius}
            />
          );
        })}

        {/* ★ 2026-10-10：HRV 第二层（与分期共用同一条 x 轴 → 能直接对照「HRV 高点落在哪个分期」） */}
        {hrvGeom ? (
          <>
            {hrvGeom.label}
            {hrvGeom.base}
            {hrvGeom.bars}
          </>
        ) : null}

        {/* 时间轴竖线 */}
        {ticks.map((t, i) => (
          <Line
            key={`tick-${i}`}
            x1={t.x}
            y1={chartH + (hrvGeom ? hrvGeom.offset : 0) + theme.sp(0.5)}
            x2={t.x}
            y2={chartH + (hrvGeom ? hrvGeom.offset : 0) + theme.sp(2)}
            stroke={chart.axisText}
            strokeWidth={chart.lw.grid}
            opacity={0.45}
          />
        ))}

        {/* 时间轴标签 */}
        {ticks.map((t, i) => (
          <SvgText
            key={`tl-${i}`}
            x={t.x}
            y={H - theme.sp(0.75)}
            fontSize={theme.fontSize.micro}
            fill={theme.colors.textSub}
            textAnchor="middle"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textSub,
  },
});
