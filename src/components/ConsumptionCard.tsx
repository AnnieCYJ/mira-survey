/**
 * ConsumptionCard —— 首页「消耗」卡片（新增，独立组件，不改既有卡片）
 *
 * 布局：
 *   · 左：环状占比图 —— 情绪 / 脑力 / 运动 三项相对消耗构成；
 *     **环心 = 今日综合消耗率**（三项归一权重取均值，即整体消耗到什么程度），不是某一项的占比。
 *   · 右：三张**白底 + 单侧柔光晕**小卡（情绪消耗 / 脑力消耗 / 运动消耗），各展示数值 + 副信息，点击进对应详情页；
 *     色晕色 token 见 theme.colors.cardGlowEmotion / cardGlowBrain / cardGlowSport
 *     （色相取自下方三张消耗卡图片的暖橘桃 / 柔青蓝 / 紫蓝，明度饱和度对齐参考稿 S45~50 / L92~94）。
 *   · 外层卡片白底（colors.cardBg + cardBorder）。
 *
 * 数据口径（与首页既有三张小卡同源，不另起一套）：
 *   · 情绪：computeStressReport().events.length（事件数）、peakHour（峰值时间）
 *   · 脑力：computeCognitiveLoadReport().loadScore(0-100)、forecast.peak.hour（峰值预测）
 *   · 运动：RingBle state.stepDaily[dayKey].{steps, calorie}
 *
 * 算法（三项量纲不同，先各自归一到「满量程」）：
 *   w 情绪 = min(1, 事件数 / 6)   ← 与卡上展示的「次」同一口径
 *   w 脑力 = loadScore / 100
 *   w 运动 = min(1, 步数 / 8000)
 *   · 环内每段占比 share_i = w_i / Σw           —— 三项相对构成
 *   · 环心综合消耗率 = (w情绪+w脑力+w运动)/3×100% —— 今日整体消耗程度
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { dayKey } from '../data/healthStore';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';

const RING = 128;          // 圆环外径
const RING_W = 20;         // 环宽（粗环）
const GAP_RATIO = 0.7;     // 段间留白 = 环宽 × 该比例
const CARD_H = 84;         // 右侧小卡高度（比上一版明显加大）
const FULL_PEAK_EVENTS = 6;    // 情绪「满量程」参考：6 次压力事件
const FULL_PEAK_STEPS = 8000;  // 运动「满量程」参考：8000 步

export type NavType = 'emotion' | 'cognitive' | 'activity';
export type Seg = {
  key: string;
  label: string;
  color: string;
  /** 小卡右侧色晕色（token）：白底 + 横向光带（白 → 色晕 → 白），与明细大卡同一套处理 */
  glow: string;
  w: number;
  share: number;   // 环内占比 0-1
  value: string;
  unit: string;
  sub: string;
  nav: NavType;
};

/**
 * fmtShare —— 占比文案：≥1% 取整，>0 但不足 1% 显示 <1%，为 0 显示 0%。
 * （避免 21 步显示「占 0%」这种看起来像坏了的文案）
 */
export function fmtShare(share: number): string {
  const pct = share * 100;
  if (pct >= 1) return `${Math.round(pct)}%`;
  return pct > 0 ? '<1%' : '0%';
}

/**
 * computeConsumption —— 三项消耗的统一口径（本文件与 ConsumptionHighlightCards 共用，避免算法漂移）。
 * 返回 segs（含各自权重 w、环内占比 share、展示值）与 overall（综合消耗率 %）。
 */
export function computeConsumption(ring: any): { segs: Seg[]; overall: number | null } {
    // —— 情绪 ——
    let events = 0;
    let peakHour: number | null = null;
    try {
      const r = computeStressReport();
      events = r?.events?.length ?? 0;
      peakHour = r?.peakHour ?? null;
    } catch { /* 静默：无数据时按 0 处理 */ }

    // —— 脑力 ——
    let loadScore = 0;
    let peakForecastHour: number | null = null;
    try {
      const r = computeCognitiveLoadReport();
      loadScore = Number.isFinite(r?.loadScore) ? Math.round(r.loadScore) : 0;
      const fp = (r as any)?.forecast?.peak;
      if (fp && Number.isFinite(fp.hour)) peakForecastHour = fp.hour;
    } catch { /* 静默 */ }

    // —— 运动 ——
    const step = ring?.stepDaily?.[dayKey(Date.now())];
    const steps = Number.isFinite(step?.steps) ? Math.round(step.steps) : 0;
    const calorie = Number.isFinite(step?.calorie) ? Math.round(step.calorie) : 0;

    // —— 各自归一到 0-1 权重 ——
    // ★ 口径必须与卡上展示的数值一致：卡上情绪显示的是「事件数」，占比就按事件数算。
    //   （曾用 emotionalLoad 做权重 → 出现「0 次 却 占 39%」的自相矛盾数字）
    const wEmotion = Math.max(0, Math.min(1, events / FULL_PEAK_EVENTS));
    const wBrain = Math.max(0, Math.min(1, loadScore / 100));
    const wSport = Math.max(0, Math.min(1, steps / FULL_PEAK_STEPS));

    const sum = wEmotion + wBrain + wSport;
    // 三项全空 → 等分展示（环心提示暂无数据），避免环画不出来
    const denom = sum > 0 ? sum : 1;
    const w = sum > 0 ? [wEmotion / denom, wBrain / denom, wSport / denom] : [1 / 3, 1 / 3, 1 / 3];
    // 综合消耗率 = 三项归一权重均值（整体消耗程度）
    const overall = sum > 0 ? Math.round(((wEmotion + wBrain + wSport) / 3) * 100) : null;

    // 同色系紫色三档（全 token）：主紫 → 次紫 → 浅紫
    const segs: Seg[] = [
      {
        key: 'emotion',
        label: '情绪消耗',
        color: theme.colors.stateTense,
        glow: theme.colors.cardGlowEmotion,
        w: wEmotion,
        share: w[0],
        value: String(events),
        unit: '次',
        sub: peakHour != null ? `峰值 ${String(peakHour).padStart(2, '0')}:00` : '暂无压力事件',
        nav: 'emotion',
      },
      {
        key: 'brain',
        label: '脑力消耗',
        color: theme.colors.accent2,
        glow: theme.colors.cardGlowBrain,
        w: wBrain,
        share: w[1],
        value: String(loadScore),
        unit: '/100',
        sub: peakForecastHour != null ? `峰值预测 ${String(peakForecastHour).padStart(2, '0')}:00` : '暂无预测',
        nav: 'cognitive',
      },
      {
        key: 'sport',
        label: '运动消耗',
        color: theme.colors.accentSolid,
        glow: theme.colors.cardGlowSport,
        w: wSport,
        share: w[2],
        // 千分位沿用项目既有写法（EnergyDetailScreen 的 fmtInt）
        value: steps.toLocaleString('zh-CN'),
        unit: '步',
        sub: `${calorie} kcal`,
        nav: 'activity',
      },
    ];
  return { segs, overall };
}

export default function ConsumptionCard({
  ring,
  onNav,
}: {
  ring: any;
  onNav?: (type: NavType) => void;
}) {
  const { segs, overall } = useMemo(() => computeConsumption(ring), [ring]);

  const hasData = overall != null;

  // —— 圆环几何 ——
  const cx = RING / 2;
  const cy = RING / 2;
  const r = (RING - RING_W) / 2;
  const circumference = 2 * Math.PI * r;
  const gapLen = RING_W * GAP_RATIO;
  let acc = 0;
  const arcs = segs.map((s) => {
    // 段长扣掉留白；占比极小时保底 1px，避免渲染成 0 宽
    const len = Math.max(1, s.share * circumference - gapLen);
    const dashOffset = -acc * circumference;
    acc += s.share;
    return { ...s, len, dashOffset };
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>消耗</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>今日构成</Text>
        </View>
      </View>

      <View style={styles.body}>
        {/* 左：环状占比（环心 = 今日综合消耗率） */}
        <View style={styles.ringBox}>
          <Svg width={RING} height={RING}>
            {/* 轨道（浅紫，token 半透明紫） */}
            <Circle
              cx={cx}
              cy={cy}
              r={r}
              stroke={theme.colors.avatarBgLight}
              strokeWidth={RING_W}
              fill="none"
            />
            {/* 三段弧：圆头端点 + 段间留白 */}
            {arcs.map((a) => (
              <Circle
                key={a.key}
                cx={cx}
                cy={cy}
                r={r}
                stroke={a.color}
                strokeWidth={RING_W}
                strokeLinecap="round"
                strokeDasharray={`${a.len.toFixed(2)} ${(circumference - a.len).toFixed(2)}`}
                strokeDashoffset={a.dashOffset.toFixed(2)}
                fill="none"
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            ))}
          </Svg>
          <View style={styles.ringCenter} pointerEvents="none">
            <Text style={styles.ringLabel} numberOfLines={1}>今日消耗</Text>
            <Text style={styles.ringPct} numberOfLines={1} adjustsFontSizeToFit>
              {hasData ? `${overall}%` : '—'}
            </Text>
          </View>
        </View>

        {/* 右：三张图片背景小卡（与下方三张小卡同一套图 + 同一套底部蒙层） */}
        <View style={styles.cards}>
          {segs.map((s) => (
            <TouchableOpacity
              key={s.key}
              activeOpacity={0.85}
              disabled={!onNav}
              onPress={() => onNav?.(s.nav)}
              accessibilityRole="button"
              accessibilityLabel={`${s.label} ${s.value}${s.unit}`}
            >
              <View style={styles.cardInner}>
                {/* 参考稿做法：白底 + 横向柔光带（白 → 色晕 → 白），色值走 cardGlowXxx token */}
                <LinearGradient
                  colors={[theme.colors.cardBg, s.glow, theme.colors.cardBg] as unknown as string[]}
                  locations={[0.34, 0.72, 1]}
                  start={{ x: 0, y: 0.15 }}
                  end={{ x: 1, y: 0.85 }}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <View style={[styles.dot, { backgroundColor: s.color }]} />
                      <Text style={styles.cardLabel} numberOfLines={1}>{s.label}</Text>
                      <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
                        {s.value}
                        <Text style={styles.cardUnit}> {s.unit}</Text>
                      </Text>
                    </View>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {s.sub} · 占 {fmtShare(s.share)}
                    </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.caption}>
        {hasData ? '三项相对消耗构成（各自归一到满量程后计算占比）' : '佩戴并记录后，这里显示今日消耗构成'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // 白底卡片（细描边）
  wrap: {
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginTop: theme.space.md,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.md,
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  pill: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
  },
  pillText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.accentSolid,
  },
  body: { flexDirection: 'row', alignItems: 'center' },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.sp(1.5),
  },
  ringLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.sp(0.25),
  },
  ringPct: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.bold,
    color: theme.colors.textTitle,
  },
  // 右侧三张小卡（白底 + 右侧柔光晕 + 细描边，参考稿样式）
  cards: { flex: 1, marginLeft: theme.space.sm, gap: theme.sp(2) },
  cardInner: {
    height: CARD_H,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  cardBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.sp(2),
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: theme.sp(2),
    height: theme.sp(2),
    borderRadius: theme.sp(1),
    marginRight: theme.sp(1.25),
  },
  cardLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.textTitle,
    fontWeight: theme.weight.medium,
  },
  cardValue: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.bold,
    color: theme.colors.textInk,
    marginRight: theme.sp(0.5),
  },
  cardUnit: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.regular,
    // ★ 用 ui.chipText 而非 textSub：在暖橘/青蓝/紫蓝三档渐变上，
    //   textSub(#8A8AA8) 对比度仅 2.0~2.6，chipText(#55557A) 可到 4.2~5.5
    color: theme.colors.ui.chipText,
  },
  cardSub: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.ui.chipText,
    marginTop: theme.sp(0.75),
    marginLeft: theme.sp(3.25),
  },
  caption: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginTop: theme.space.sm,
  },
});
