import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import {
  type CurveStatus,
  type CurvePoint,
  isSameDay,
  curveLevel,
  CURVE_DEFAULTS,
} from '../lib/dailyStatus';
import { MOODS } from '../data/metrics';

// 档位 → 圆环一致的友好名 + 配色（index 对应 MOODS：0 元气满满 / 1 状态良好 / 2 平平静静 / 3 休息一下）
function moodFor(value: number) {
  const li = curveLevel(value, CURVE_DEFAULTS);
  const m = MOODS[li.index] ?? MOODS[1];
  return { label: m.label, color: m.color, level: li.level, index: li.index };
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 电量档位分界（spec §8，均匀 25 段）：休息一下 0–25 / 平平静静 26–50 / 状态良好 51–75 / 元气满满 76–100
const CUTS = [26, 51, 76];

export default function DailyStatusCard({
  status,
  timeline = [],
}: {
  status: CurveStatus | null;
  timeline?: CurvePoint[];
}) {
  const [w, setW] = useState(0);

  const todayPts = useMemo(() => {
    const now = Date.now();
    return timeline.filter((p) => isSameDay(p.t, now));
  }, [timeline]);

  if (!status || !status.hasData || status.value == null) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>今日状态</Text>
        <Text style={styles.empty}>连接戒指并连续佩戴几天后，这里会显示你的恢复电量曲线</Text>
      </Card>
    );
  }

  const mood = moodFor(status.value);
  const scoreText = Math.round(status.value).toString();
  const markerPct = Math.max(1, Math.min(99, status.value));
  const phaseText = status.hasLog
    ? `${status.phaseLabel}${status.dayInCycle ? ` · 周期第 ${status.dayInCycle} 天` : ''}`
    : status.phaseLabel;

  const seed = status.seed;
  const s0Text = seed && seed.value != null ? Math.round(seed.value).toString() : '—';
  const deltaText =
    seed && seed.recoveryDelta != null ? `${seed.recoveryDelta > 0 ? '+' : ''}${Math.round(seed.recoveryDelta)}` : '';
  const seedLabel = seed?.recoveryLabel ?? '校准中';
  const deltaColor =
    seedLabel === '优于平时'
      ? theme.colors.stateEnergy
      : seedLabel === '差于平时'
      ? theme.colors.stateTired
      : theme.colors.textSub;

  const lastT = todayPts.length ? todayPts[todayPts.length - 1].t : null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>今日状态</Text>
        <View style={[styles.badge, { backgroundColor: mood.color }]}>
          <Text style={styles.badgeText}>{mood.label}</Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: mood.color }]}>{scoreText}</Text>
        <Text style={styles.scoreUnit}>分</Text>
        <Text style={styles.phase}>{phaseText}</Text>
      </View>

      {/* 电量刻度条：分界 26/51/76，标记点 = 当前电量 */}
      <View style={styles.track}>
        {CUTS.map((c) => (
          <View key={c} style={[styles.divider, { left: `${c}%` }]} />
        ))}
        <View style={[styles.marker, { left: `${markerPct}%`, backgroundColor: mood.color }]} />
      </View>
      <View style={styles.ticks}>
        <Text style={styles.tick}>不足</Text>
        <Text style={styles.tick}>偏低</Text>
        <Text style={styles.tick}>平稳</Text>
        <Text style={styles.tick}>充沛</Text>
      </View>

      {/* 晨间恢复读数（S0 + 比平时 ±Δ） */}
      <View style={styles.seedRow}>
        <Text style={styles.seedLabel}>晨间恢复</Text>
        <Text style={[styles.seedValue, { color: theme.colors.textInk }]}>{s0Text}</Text>
        <Text style={[styles.seedDelta, { color: deltaColor }]}>
          · {seedLabel}
          {deltaText ? ` ${deltaText}` : ''}
        </Text>
      </View>

      {/* 日内趋势：每 30 分钟一个电量点 */}
      <Text style={styles.trendLabel}>
        日内趋势（每 30 分钟）{lastT ? `· 最近 ${fmtTime(lastT)}` : ''}
      </Text>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={styles.sparkWrap}>
        {w > 0 ? <Sparkline points={todayPts} width={w} /> : null}
      </View>
      {todayPts.length < 2 ? (
        <Text style={styles.sparkHint}>
          {todayPts.length === 1
            ? `已记录 ${fmtTime(todayPts[0].t)} 的读数，每 30 分钟自动新增一个点`
            : '佩戴 30 分钟后，这里会画出今天的恢复电量曲线'}
        </Text>
      ) : null}

      <Text style={styles.narrative}>{status.narrative}</Text>
    </Card>
  );
}

function safeNum(v: number): number {
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function Sparkline({ points, width }: { points: CurvePoint[]; width: number }) {
  const H = 64;
  const padX = 4;
  const padTop = 18;
  const padBottom = 6;
  const innerW = Math.max(1, width - padX * 2);
  const innerH = H - padTop - padBottom;
  const valid = points.filter(
    (p) => p != null && typeof p.value === 'number' && Number.isFinite(p.value)
  );
  const n = valid.length;
  const x = (i: number) => padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (s: number) => padTop + (1 - s / 100) * innerH;

  const refLines = CUTS.map((c) => ({ c, yy: safeNum(y(c)) }));
  const last = valid[n - 1];
  const lastMood = last ? moodFor(last.value) : null;

  const hSegs: { key: string; left: number; top: number; width: number; color: string }[] = [];
  const vSegs: { key: string; left: number; top: number; height: number; color: string }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const x1 = x(i);
    const y1 = y(valid[i].value);
    const x2 = x(i + 1);
    const y2 = y(valid[i + 1].value);
    const segColor = moodFor(valid[i + 1].value).color;
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
      continue;
    }
    if (Math.abs(x2 - x1) > 0.5) {
      hSegs.push({ key: `h-${i}`, left: Math.min(x1, x2), top: Math.round((y1 + y2) / 2), width: Math.max(1, Math.abs(x2 - x1)), color: segColor });
    }
    if (Math.abs(y2 - y1) > 0.5) {
      vSegs.push({ key: `v-${i}`, left: Math.round(x2), top: Math.min(y1, y2), height: Math.max(1, Math.abs(y2 - y1)), color: segColor });
    }
  }

  if (n === 0) {
    return (
      <View style={{ width, height: H }}>
        {refLines.map((r) => (
          <View key={`ref-${r.c}`} style={{ position: 'absolute', left: padX, width: Math.max(1, width - padX * 2), top: r.yy, height: 1, backgroundColor: 'rgba(140,138,168,0.16)' }} />
        ))}
      </View>
    );
  }

  // 每个非末点上方显示真实状态值（碰撞避免，避免密集重叠）
  let lastLabelX = -999;
  const LABEL_GAP = 22;

  return (
    <View style={{ width, height: H }}>
      {refLines.map((r) => (
        <View key={`ref-${r.c}`} style={{ position: 'absolute', left: padX, width: Math.max(1, width - padX * 2), top: r.yy, height: 1, backgroundColor: 'rgba(140,138,168,0.16)' }} />
      ))}
      {hSegs.map((s) => (
        <View key={s.key} style={{ position: 'absolute', left: safeNum(s.left), top: safeNum(s.top), width: Math.max(1, safeNum(s.width)), height: 1, backgroundColor: s.color }} />
      ))}
      {vSegs.map((s) => (
        <View key={s.key} style={{ position: 'absolute', left: safeNum(s.left), top: safeNum(s.top), width: 1, height: Math.max(1, safeNum(s.height)), backgroundColor: s.color }} />
      ))}
      {valid.map((p, i) => {
        const m = moodFor(p.value);
        const isStart = i === 0;
        const isEnd = i === n - 1;
        const r = isStart ? 3 : isEnd ? 4 : 2;
        const fill = isStart ? '#fff' : isEnd ? m.color : '#fff';
        return (
          <View
            key={`dot-${i}`}
            style={{ position: 'absolute', left: safeNum(x(i) - r), top: safeNum(y(p.value) - r), width: r * 2, height: r * 2, borderRadius: r, backgroundColor: fill, borderWidth: 1, borderColor: m.color }}
          />
        );
      })}
      {valid.map((p, i) => {
        if (i === n - 1) return null; // 末点用下方大标注
        const lx = safeNum(x(i));
        if (lx - lastLabelX < LABEL_GAP) return null;
        lastLabelX = lx;
        return (
          <Text key={`vl-${i}`} style={[styles.sparkVal, { left: Math.max(2, lx - 9), top: Math.max(2, safeNum(y(p.value)) - 15) }]}>
            {Math.round(p.value)}
          </Text>
        );
      })}
      {last && lastMood && (
        <View
          pointerEvents="none"
          style={[styles.sparkLabel, { left: Math.min(width - 72, Math.max(4, safeNum(x(n - 1)) - 32)), top: Math.max(2, safeNum(y(last.value)) - 20), backgroundColor: lastMood.color }]}
        >
          <Text style={styles.sparkLabelText}>{lastMood.label} {Math.round(last.value)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.space.md, marginBottom: theme.space.sm },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  empty: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
    lineHeight: 22,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  badge: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
  },
  badgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: '#fff',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.space.xs,
  },
  score: {
    fontSize: theme.fontSize.h1 * 1.6,
    fontWeight: theme.weight.semibold,
    lineHeight: 46,
  },
  scoreUnit: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textSub,
    marginLeft: theme.space.xs,
  },
  phase: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginLeft: theme.space.md,
  },
  track: {
    position: 'relative',
    height: theme.sp(1.6),
    backgroundColor: 'rgba(140,138,168,0.18)',
    borderRadius: theme.radius.pill,
    marginTop: theme.space.md,
  },
  divider: {
    position: 'absolute',
    top: -theme.sp(1),
    width: 1,
    height: theme.sp(3.6),
    backgroundColor: 'rgba(140,138,168,0.5)',
  },
  marker: {
    position: 'absolute',
    top: -theme.sp(1.4),
    width: theme.sp(3),
    height: theme.sp(3),
    borderRadius: theme.radius.pill,
    marginLeft: -theme.sp(1.5),
    borderWidth: 2,
    borderColor: '#fff',
  },
  ticks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.space.xs,
  },
  tick: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: theme.space.md,
  },
  seedLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  seedValue: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    marginLeft: theme.space.xs,
  },
  seedDelta: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    marginLeft: theme.space.xs,
  },
  trendLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.space.lg,
    marginBottom: theme.space.xs,
  },
  sparkWrap: {
    width: '100%',
  },
  sparkHint: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.space.xs,
  },
  sparkLabel: {
    position: 'absolute',
    minWidth: 52,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkLabelText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: theme.weight.semibold,
  },
  sparkVal: {
    position: 'absolute',
    fontSize: 9,
    color: theme.colors.textInk,
    fontWeight: theme.weight.medium,
  },
  narrative: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textInk,
    marginTop: theme.space.md,
    lineHeight: 22,
  },
});
