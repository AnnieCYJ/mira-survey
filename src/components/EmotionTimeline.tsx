/**
 * EmotionTimeline — 情绪时间线
 *   X = 今日清醒时段 (自动用 HR/HRV 生理信号推断, 无硬编码睡眠)
 *   Y = 唤醒度 arousal (0-100) = "剧烈程度"
 *   每个点颜色 = 情绪类型, 大小 = 唤醒度
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Circle, Rect, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { dayKey, healthStore } from '../data/healthStore';
import type { EmotionLabel } from '../lib/emotionEngine';

const LABEL_COLOR: Record<EmotionLabel, string> = {
  focused:  '#2ECC71',
  calm:     '#7C6AE0',
  stressed: '#E74C3C',
  bored:    '#95A5A6',
  depleted: '#8B5A2B',
};

const LABEL_EMOJI: Record<EmotionLabel, string> = {
  focused:  '🎯',
  calm:     '😌',
  stressed: '😰',
  bored:    '😶',
  depleted: '😩',
};

interface HistoryPt {
  t: number;
  arousalScore: number;
  valenceScore: number;
  emotionLabel: string;
}

interface Props {
  history: HistoryPt[];
  width: number;
  height?: number;
}

function fmtHM(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * ★ 用真实生理信号推断清醒窗口 — 不依赖硬编码 sleepTime/wakeTime
 *
 * 优先级:
 *   1. healthStore 官方睡眠记录 (sleepSum.sleepTime/wakeTime) — 最准
 *   2. 全天 HR + HRV 生理信号扫描 — 找 HR 低 + HRV 高的连续段
 *   3. 退化: 全天展示 (0..24h)
 *
 * 保证: 当前时刻永远在 awake 窗口内 (你在看手机 = 你醒着)
 */
function getTodayAwakeWindow(nowMs: number): { wakeHour: number; bedHour: number } {
  const now = new Date(nowMs);
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const todayKey = dayKey(nowMs);
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // ── Step 1: 优先官方睡眠记录 ──
  const sleepSum = healthStore.getSleep(todayKey);
  const parseHM = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : null;
  };
  if (sleepSum && sleepSum.total > 0) {
    const bedH = parseHM(sleepSum.sleepTime);
    const wakeH = parseHM(sleepSum.wakeTime);
    if (bedH != null && wakeH != null) {
      let wh = wakeH, bh = bedH;
      // 当前时刻必须在 awake 窗口内
      if (bh > wh && nowHour > bh) bh = Math.min(24, nowHour + 0.5);
      if (bh < wh) bh = nowHour + 0.5;
      if (nowHour < wh) wh = Math.max(0, nowHour - 0.5);
      return { wakeHour: wh, bedHour: bh };
    }
  }

  // ── Step 2: 用 HR + HRV 生理信号推断睡眠段 ──
  // ★ 这里原来误用了 useMemo：本函数是【普通函数】而非组件/Hook，调 Hook 会触发
  //   React「Do not call Hooks inside useMemo(...)」告警（metro.log 已抓获，component stack
  //   指向 EmotionTimeline）。且它本就运行在外层 useMemo 内，再包一层毫无意义，直接算即可。
  const hrPts = healthStore.getTimeRange('hr' as any, today0, nowMs, { maxPoints: 500 });
  const hrvPts = healthStore.getTimeRange('hrv' as any, today0, nowMs, { maxPoints: 500 });

  if (hrPts.length >= 20 && hrvPts.length >= 20) {
    const byHour = new Map<number, { hrs: number[]; hrv: number[] }>();
    for (const p of hrPts) {
      const h = new Date(p.t).getHours();
      if (!byHour.has(h)) byHour.set(h, { hrs: [], hrv: [] });
      byHour.get(h)!.hrs.push(p.v);
    }
    for (const p of hrvPts) {
      const h = new Date(p.t).getHours();
      if (!byHour.has(h)) byHour.set(h, { hrs: [], hrv: [] });
      byHour.get(h)!.hrv.push(p.v);
    }

    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const hourly: { h: number; hr: number; hrv: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const b = byHour.get(h);
      if (b && b.hrs.length >= 2 && b.hrv.length >= 2) {
        hourly.push({ h, hr: mean(b.hrs), hrv: mean(b.hrv) });
      }
    }

    if (hourly.length >= 8) {
      const hrMeanAll = mean(hourly.map(x => x.hr));
      const hrvMeanAll = mean(hourly.map(x => x.hrv));

      // 睡眠候选: HR 低 (<均值×0.88) + HRV 高 (>均值×1.10)
      const sleepHours = hourly.filter(x =>
        x.hr < hrMeanAll * 0.88 && x.hrv > hrvMeanAll * 1.10
      ).map(x => x.h);

      // 合并连续段
      const ranges: { start: number; end: number }[] = [];
      let cur: { start: number; end: number } | null = null;
      for (const h of sleepHours.sort((a, b) => a - b)) {
        if (!cur || h === cur.end + 1) cur = { start: cur?.start ?? h, end: h };
        else { ranges.push(cur); cur = { start: h, end: h }; }
      }
      if (cur) ranges.push(cur);

      // 取最长的一段作为主睡眠
      const mainSleep = ranges.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

      if (mainSleep && mainSleep.end - mainSleep.start >= 2) {
        let wakeHour = mainSleep.end + 0.5;
        let bedHour = mainSleep.start - 0.25;
        // 保证当前时刻在窗口内
        if (nowHour >= wakeHour && nowHour <= bedHour) {
          return { wakeHour, bedHour };
        }
      }
    }
  }

  // ── Step 3: 退化 — 全天展示, 当前时刻 +30min ──
  return { wakeHour: 0, bedHour: Math.min(24, nowHour + 0.5) };
}

/** 判断一个时间点是否在 awake window 内 */
function isAwake(t: number, wakeHour: number, bedHour: number): boolean {
  const d = new Date(t);
  const h = d.getHours() + d.getMinutes() / 60;
  if (bedHour > wakeHour) return h >= wakeHour && h <= bedHour;
  return h >= wakeHour || h <= bedHour;
}

export default function EmotionTimeline({
  history,
  width,
  height = 140,
}: Props) {
  const pad = { l: 36, r: 8, t: 12, b: 24 };
  const innerW = Math.max(1, width - pad.l - pad.r);
  const innerH = Math.max(1, height - pad.t - pad.b);

  const { pts, path, area, awakeStart, awakeEnd } = useMemo(() => {
    const now = Date.now();
    const dNow = new Date(now);
    const today0 = new Date(dNow.getFullYear(), dNow.getMonth(), dNow.getDate()).getTime();

    const aw = getTodayAwakeWindow(now);
    const awakeStart = today0 + aw.wakeHour * 3600_000;
    const awakeEnd = (aw.bedHour >= 24 ? today0 + 24 * 3600_000 : today0 + aw.bedHour * 3600_000);

    const visible = history
      .filter(p => p.t >= awakeStart && p.t <= Math.min(awakeEnd, now))
      .filter(p => isAwake(p.t, aw.wakeHour, aw.bedHour))
      .sort((a, b) => a.t - b.t);

    if (visible.length === 0) {
      return { pts: [] as any[], path: '', area: '', awakeStart, awakeEnd };
    }

    const mapped = visible.map(p => {
      const frac = (p.t - awakeStart) / (awakeEnd - awakeStart || 1);
      const x = pad.l + innerW * frac;
      const y = pad.t + innerH * (1 - p.arousalScore / 100);
      return { ...p, x, y };
    });

    let p = `M ${mapped[0].x.toFixed(1)} ${mapped[0].y.toFixed(1)}`;
    for (let i = 0; i < mapped.length - 1; i++) {
      const a = mapped[i], b = mapped[i + 1];
      const mx = (a.x + b.x) / 2;
      p += ` C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    const areaPath = p + ` L ${mapped[mapped.length - 1].x.toFixed(1)} ${pad.t + innerH} L ${mapped[0].x.toFixed(1)} ${pad.t + innerH} Z`;

    return { pts: mapped, path: p, area: areaPath, awakeStart, awakeEnd };
  }, [history, width, height]);

  const empty = pts.length === 0;

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="emoArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#7C6AE0" stopOpacity="0.25" />
            <Stop offset="100%" stopColor="#7C6AE0" stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {/* Y 轴刻度 */}
        {[0, 50, 100].map(v => {
          const y = pad.t + innerH * (1 - v / 100);
          return (
            <React.Fragment key={v}>
              <Rect x={pad.l} y={y} width={innerW} height={0.5} fill="#E5E0D6" opacity={0.5} />
              <SvgText x={pad.l - 6} y={y + 3} fontSize={9} fill="#999" textAnchor="end">{v}</SvgText>
            </React.Fragment>
          );
        })}

        {empty ? (
          <SvgText x={width / 2} y={height / 2} fontSize={11} fill="#AAA" textAnchor="middle">
            暂无情绪数据 — 等戒指同步几轮后自动画
          </SvgText>
        ) : (
          <>
            <Path d={area} fill="url(#emoArea)" />
            <Path d={path} stroke="#7C6AE0" strokeWidth={1.5} fill="none" />

            {pts.map((p, i) => {
              const color = LABEL_COLOR[(p.emotionLabel as EmotionLabel) ?? 'calm'] ?? '#7C6AE0';
              const r = 2.5 + (p.arousalScore / 100) * 2.5;
              return <Circle key={i} cx={p.x} cy={p.y} r={r} fill={color} />;
            })}

            {pts.length > 0 && (() => {
              const last = pts[pts.length - 1];
              const emoji = LABEL_EMOJI[(last.emotionLabel as EmotionLabel) ?? 'calm'] ?? '•';
              return (
                <SvgText
                  x={Math.min(last.x, width - 14)}
                  y={Math.max(last.y - 6, pad.t + 10)}
                  fontSize={11} textAnchor="middle"
                >{emoji}</SvgText>
              );
            })()}
          </>
        )}

        {/* X 轴时间刻度 */}
        {!empty && [0, 0.5, 1].map((frac, i) => {
          const t = awakeStart + (awakeEnd - awakeStart) * frac;
          const x = pad.l + innerW * frac;
          return (
            <SvgText key={i} x={x} y={height - 6} fontSize={9} fill="#999" textAnchor="middle">
              {fmtHM(t)}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

export function EmotionLegend() {
  const items: { label: EmotionLabel; name: string }[] = [
    { label: 'focused',  name: '专注' },
    { label: 'calm',     name: '平静' },
    { label: 'stressed', name: '焦虑' },
    { label: 'bored',    name: '倦怠' },
    { label: 'depleted', name: '耗竭' },
  ];
  return (
    <View style={styles.legendRow}>
      {items.map(it => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: LABEL_COLOR[it.label] }]} />
          <Text style={styles.legendText}>{it.name}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginBottom: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { fontSize: 11, color: '#666' },
});
