/**
 * CortisolTrendCard —— 基础版「皮质醇推算节律」日 / 周 / 月 / 年趋势图
 *
 * ★ 2026-11-05（用户：「基础版是没有皮质醇是吧？底层有没有自己的算法推算节律？
 *    如果可以的话，我认为我这边也可以出皮质醇的日周月年的趋势图」）
 *
 * 诚实口径（必须守住）：
 *   · 基础版戒指**不实测皮质醇**：后端 health_glance 通道 0 条，auto_data 也无皮质醇字段。
 *   · 实测信号走 lib/cortisolProxy.ts（6 路加权 z-score → 0–100 相对活性），
 *     ★ 2026-11-08 起展示曲线再经 lib/cortisolPrior.ts 拟合到「正常昼夜节律参考形状」：
 *     基础版只有 HRV + 静息心率 (+ 活动) 生效，单路 z-score 会被放大成 0~100 乱跳，
 *     现在以生理先验为骨架、实测按置信度做温和修正，单槽偏离限幅 ±14、3 槽平滑。
 *   · 它是**推算的节律形状**，不是激素浓度检测值；不做评分、不做诊断、不给健康结论。
 *   · 日视图中「只有参考形状、没有实测信号」的时段用浅色柱标注，绝不冒充检测值；
 *     周 / 月 / 年视图仍只统计有真实信号的日期，没有信号的日期留白。
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
import { buildCortisolProxyBaseline, computeCortisolProxyDay, computeCortisolShapedDay } from '../lib/cortisolProxy';
import { CORTISOL_PRIOR_DISCLAIMER } from '../lib/cortisolPrior';
import ChartTapTip, { type ChartTapSlot } from './ChartTapTip';
import { dayKey } from '../data/healthStore';
import type { RangeKey } from '../data/metrics';

const DAY_MS = 86_400_000;
const BAR_COLOR = 'rgba(139,122,216,0.88)';
const BAR_FAINT = 'rgba(139,122,216,0.18)';
/** 只有参考形状、无实测信号的槽：更淡的柱色，与实测段区分 */
const BAR_MODELED = 'rgba(139,122,216,0.34)';

interface Props {
  range: RangeKey;
  anchor: Date;
  title?: string;
}

interface Trend {
  points: (number | null)[];
  /** 与 points 等长：true = 该柱只有参考形状、无实测信号（画淡色 + 标注） */
  modeled: boolean[];
  labels: string[];
  /** 与 points 等长：逐柱的日期/时刻标签，供点击数值气泡显示 */
  slotLabels: string[];
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
      points: [], modeled: [], labels: [], slotLabels: [], filled: 0, total: 0,
      note: '个人基线还没建立，连续佩戴几天后这里会出现推算节律。',
    };
  }
  const now = Date.now();
  /** 原始实测驱动值：只用于周/月/年的「按天聚合」，绝不拿拟合值编造整月数据。 */
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
    // ★ 2026-11-08：日视图走「正常昼夜节律先验 + 实测温和修正」的拟合曲线
    let shaped;
    try {
      shaped = computeCortisolShapedDay(dk, baseline, { now: anchorMs });
    } catch {
      shaped = null;
    }
    const vals = shaped?.vals ?? dayVals(dk);
    const modeled48 = shaped?.modeled ?? new Array(48).fill(false);
    // 48 个 30 分钟槽 → 24 个小时柱（每 2 槽取均值）
    const points = Array.from({ length: 24 }, (_, h) => mean([vals[h * 2] ?? null, vals[h * 2 + 1] ?? null]));
    const modeled = Array.from({ length: 24 }, (_, h) => modeled48[h * 2] === true && modeled48[h * 2 + 1] === true);
    return {
      points,
      modeled,
      labels: ['0:00', '6:00', '12:00', '18:00', '24:00'],
      slotLabels: Array.from({ length: 24 }, (_, h) => `${h}:00`),
      filled: points.filter((v, i) => v != null && !modeled[i]).length,
      total: 24,
      note: shaped
        ? `每小时一根柱 = 拟合后的皮质醇相对活性（0–100）；深色柱含你的实测信号。${CORTISOL_PRIOR_DISCLAIMER}`
        : '每小时一根柱 = 该小时推算的皮质醇相对活性（0–100），仅作趋势参考。',
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
      modeled: new Array(points.length).fill(false),
      labels: ['1月', '4月', '7月', '10月', '12月'],
      slotLabels: groups.map((_, i) => `${i + 1}月`),
      filled: points.filter((v) => v != null).length,
      total: 12,
      note: '每月一根柱 = 当月有信号日期的推算活性均值；没有信号的月份留白。',
    };
  }

  const keys = dateKeysFor(range, anchorMs);
  const points = keys.map(dayMean);
  return {
    points,
    modeled: new Array(points.length).fill(false),
    labels: range === 'week' ? ['7天前', '5天前', '3天前', '昨天', '今天'] : ['30天前', '20天前', '10天前', '今天'],
    slotLabels: keys.map((dk) => `${Number(dk.slice(5, 7))}/${Number(dk.slice(8, 10))}`),
    filled: points.filter((v) => v != null).length,
    total: points.length,
    note: range === 'week'
      ? '每天一根柱 = 当日推算活性均值；没有真实生理信号的日期留白。'
      : '每天一根柱 = 当日推算活性均值，用于看一个月里的起伏；没有信号的日期留白。',
  };
}

export default function CortisolTrendCard({ range, anchor, title = '皮质醇趋势图' }: Props) {
  const t = useMemo(() => buildTrend(range, anchor.getTime()), [range, anchor]);
  // 日视图即使一个实测槽都没有，也要能画出「正常节律参考形状」（用户 2026-11-08 要求）
  const hasAny = t.points.some((v) => v != null);

  // ★ 统一数值气泡：点任意一根柱 → 显示时间窗 + 相对活性；浅色参考形状也如实标注
  const tapSlots: ChartTapSlot[] = t.points.flatMap((v, i) => {
    if (v == null) return [];
    return [{
      fx: (i + 0.5) / t.total,
      fy: 1 - Math.max(4, Math.min(100, v)) / 100,
      label: t.slotLabels[i] ?? `${i + 1}`,
      value: `${Math.round(v)} / 100${t.modeled[i] ? ' · 参考' : ''}`,
      color: t.modeled[i] ? BAR_MODELED : BAR_COLOR,
    }];
  });

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
                      : {
                          height: `${Math.max(4, Math.min(100, v))}%`,
                          backgroundColor: t.modeled[i] ? BAR_MODELED : BAR_COLOR,
                        },
                  ]}
                />
              </View>
            ))}
            <ChartTapTip slots={tapSlots} height={150} />
          </View>
          <View style={styles.axis}>
            {t.labels.map((l) => <Text key={l} style={styles.axisTxt}>{l}</Text>)}
          </View>
          <Text style={styles.count}>
            {t.modeled.some(Boolean)
              ? `${t.filled}/${t.total} 个时间窗含实测信号 · 浅色为正常节律参考形状`
              : `${t.filled}/${t.total} 个时间窗有推算值`}
          </Text>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>这一区间还没有足够的真实生理信号来推算节律。{'\n'}连续佩戴后，这里会出现你的节律趋势。</Text>
        </View>
      )}

      <Text style={styles.note}>{t.note}</Text>
      <Text style={styles.disclaimer}>
        基础版实际可用的实测信号为 HRV、静息心率与活动。{CORTISOL_PRIOR_DISCLAIMER}不是戒指直接测量，也不是医学检测结果；不做评分、不做诊断。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    padding: theme.sp(3.5),
    backgroundColor: theme.colors.ui.white82,
    borderWidth: 1,
    borderColor: theme.colors.ui.white90,
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
