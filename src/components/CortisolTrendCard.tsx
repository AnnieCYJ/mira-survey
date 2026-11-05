/**
 * CortisolTrendCard —— 基础版「皮质醇推算节律」日 / 周 / 月 / 年趋势图
 *
 * ★ 2026-11-05（用户：「基础版是没有皮质醇是吧？底层有没有自己的算法推算节律？
 *    如果可以的话，我认为我这边也可以出皮质醇的日周月年的趋势图」）
 *
 * 诚实口径（必须守住）：
 *   · 基础版戒指**不实测皮质醇**：后端 health_glance 通道 0 条，auto_data 也无皮质醇字段。
 *   · 本卡用的是项目自有算法 lib/cortisolProxy.ts：先建 14 天个人基线做 z-score，
 *     再按 HRV .20 / 皮电 EDA .18 / 体温 .14 / 静息心率 .11 / 活动 .07 / 已有皮质醇 .30
 *     加权，经 50 + 50·tanh(z/2) 映射到 0–100 的「皮质醇相对活性」。
 *   · 它是**推算的节律形状**，不是激素浓度检测值；不做评分、不做诊断、不给健康结论。
 *   · 某个时间窗没有任何真实生理信号时返回 null（留白），绝不插值编造。
 *
 * 粒度：
 *   day   = 当天 48 个 30 分钟推算槽 → 聚合成 24 个小时柱
 *   week  = 最近 7 天逐日推算均值
 *   month = 最近 30 天逐日推算均值
 *   year  = 当年 12 个月，每月取该月已有天数的推算均值
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { buildCortisolProxyBaseline, computeCortisolProxyDay } from '../lib/cortisolProxy';
import { dayKey } from '../data/healthStore';
import type { RangeKey } from '../data/metrics';

const DAY_MS = 86_400_000;
const BAR_COLOR = 'rgba(139,122,216,0.88)';
const BAR_FAINT = 'rgba(139,122,216,0.18)';

interface Props {
  range: RangeKey;
  anchor: Date;
  title?: string;
}

interface Trend {
  points: (number | null)[];
  labels: string[];
  filled: number;
  total: number;
  note: string;
}

function mean(vals: (number | null)[]): number | null {
  const valid = vals.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** 各粒度的日期键（周/月按 anchor 往前推，年按当年 1–12 月） */
function dateKeysFor(range: Exclude<RangeKey, 'day'>, anchorMs: number): string[] {
  // 年视图按「月」聚合，走 buildTrend 的 monthGroups 分支，这里不会收到 'year'。
  if (range === 'year') return [];
  const n = range === 'week' ? 7 : 30;
  const end = new Date(anchorMs);
  end.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => dayKey(end.getTime() - (n - 1 - i) * DAY_MS));
}

/** 年视图：每月 1 号到月末的所有日期键，按 12 组返回 */
function monthGroups(anchorMs: number): string[][] {
  const y = new Date(anchorMs).getFullYear();
  return Array.from({ length: 12 }, (_, m) => {
    const start = new Date(y, m, 1).getTime();
    const days = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => dayKey(start + i * DAY_MS));
  });
}

function buildTrend(range: RangeKey, anchorMs: number): Trend {
  let baseline: ReturnType<typeof buildCortisolProxyBaseline>;
  try {
    baseline = buildCortisolProxyBaseline();
  } catch {
    return {
      points: [], labels: [], filled: 0, total: 0,
      note: '个人基线还没建立，连续佩戴几天后这里会出现推算节律。',
    };
  }
  const now = Date.now();
  const dayVals = (dk: string): (number | null)[] => {
    try {
      return computeCortisolProxyDay(dk, baseline, { now }).vals;
    } catch {
      return [];
    }
  };
  const dayMean = (dk: string): number | null => mean(dayVals(dk));

  if (range === 'day') {
    const dk = dayKey(anchorMs);
    const vals = dayVals(dk);
    // 48 个 30 分钟推算槽 → 24 个小时柱（每 2 槽取均值），保持「晨高夜低」的节律形状
    const points = Array.from({ length: 24 }, (_, h) => mean([vals[h * 2] ?? null, vals[h * 2 + 1] ?? null]));
    return {
      points,
      labels: ['0:00', '6:00', '12:00', '18:00', '24:00'],
      filled: points.filter((v) => v != null).length,
      total: 24,
      note: '每小时一根柱 = 该小时推算的皮质醇相对活性（0–100）。晨间偏高、夜间回落是常见节律形态，仅作趋势参考。',
    };
  }

  if (range === 'year') {
    const groups = monthGroups(anchorMs);
    const points = groups.map((group) => {
      const perDay = group.map(dayMean).filter((v): v is number => v != null);
      return perDay.length ? Math.round(perDay.reduce((a, b) => a + b, 0) / perDay.length) : null;
    });
    return {
      points,
      labels: ['1月', '4月', '7月', '10月', '12月'],
      filled: points.filter((v) => v != null).length,
      total: 12,
      note: '每月一根柱 = 当月有信号日期的推算活性均值；没有信号的月份留白。',
    };
  }

  const keys = dateKeysFor(range, anchorMs);
  const points = keys.map(dayMean);
  return {
    points,
    labels: range === 'week' ? ['7天前', '5天前', '3天前', '昨天', '今天'] : ['30天前', '20天前', '10天前', '今天'],
    filled: points.filter((v) => v != null).length,
    total: points.length,
    note: range === 'week'
      ? '每天一根柱 = 当日推算活性均值；没有真实生理信号的日期留白。'
      : '每天一根柱 = 当日推算活性均值，用于看一个月里的起伏；没有信号的日期留白。',
  };
}

export default function CortisolTrendCard({ range, anchor, title = '皮质醇趋势图' }: Props) {
  const t = useMemo(() => buildTrend(range, anchor.getTime()), [range, anchor]);
  const hasAny = t.filled > 0;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.badge}>推算</Text>
      </View>
      <Text style={styles.sub}>皮质醇相对活性 · 0–100 · 非激素浓度检测值</Text>

      {hasAny ? (
        <>
          <View style={styles.plot}>
            {t.points.map((v, i) => (
              <View key={i} style={styles.col}>
                <View
                  style={[
                    styles.bar,
                    v == null
                      ? { height: 2, backgroundColor: BAR_FAINT }
                      : { height: `${Math.max(4, Math.min(100, v))}%`, backgroundColor: BAR_COLOR },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.axis}>
            {t.labels.map((l) => <Text key={l} style={styles.axisTxt}>{l}</Text>)}
          </View>
          <Text style={styles.count}>{t.filled}/{t.total} 个时间窗有推算值</Text>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>这一区间还没有足够的真实生理信号来推算节律。{'\n'}连续佩戴后，这里会出现你的节律趋势。</Text>
        </View>
      )}

      <Text style={styles.note}>{t.note}</Text>
      <Text style={styles.disclaimer}>
        依据 HRV / 体温 / 心率 / 活动 / 交感等多信号加权推算，不是戒指直接测量，也不是医学检测结果；不做评分、不做诊断。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    padding: theme.sp(3.5),
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as never, color: '#2C2A44', flex: 1 },
  badge: {
    fontSize: theme.fontSize.micro,
    color: '#6E58C8',
    backgroundColor: 'rgba(139,122,216,0.14)',
    paddingHorizontal: theme.sp(2),
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  sub: { fontSize: theme.fontSize.micro, color: '#7A7794', marginTop: theme.sp(1), marginBottom: theme.sp(3) },
  plot: { flexDirection: 'row', alignItems: 'flex-end', height: 150, gap: 2 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderRadius: 2, width: '100%' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.sp(1.5), paddingHorizontal: theme.sp(1.5) },
  axisTxt: { fontSize: theme.fontSize.micro, color: '#8B88A6' },
  count: { fontSize: theme.fontSize.micro, color: '#8B88A6', marginTop: theme.sp(2) },
  empty: { height: 150, justifyContent: 'center', alignItems: 'center', paddingHorizontal: theme.sp(3) },
  emptyTxt: { fontSize: theme.fontSize.sm, color: '#8B88A6', textAlign: 'center', lineHeight: 20 },
  note: { fontSize: theme.fontSize.micro, color: '#7A7794', lineHeight: 18, marginTop: theme.sp(2) },
  disclaimer: { fontSize: theme.fontSize.micro, color: '#9A97B0', lineHeight: 17, marginTop: theme.sp(1.5) },
});
