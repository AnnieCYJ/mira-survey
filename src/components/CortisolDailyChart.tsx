/**
 * CortisolDailyChart —— 身体恢复详情页「今日皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致：
 *   collectSamples → analyzeCortisol → TrendChart（30min 槽位 + cosinor 填补 + 睡眠阴影 + 14天基线对比）
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Card from './Card';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import type { AiInsightRow } from '../ai/insight';
import { analyzeCortisol, type CortisolRhythmResult } from '../lib/cortisolRhythm';
import { collectSamples, collectSamplesForDay, getSleepWindow, TrendChart } from './CortisolRhythmCard';
import { buildCortisolProxyBaseline, buildCortisolProxyToday, proxySummaryFromSlots, judgeCortisolRhythm, MIN_BASELINE_DAYS, type CortisolRhythmLabel } from '../lib/cortisolProxy';
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
import { dayKey } from '../data/healthStore';

/**
 * ★ 删除本文件私有的 `sleepWindowForDay`（第四份各自为政的睡眠窗实现，且用 Math.floor 丢分钟）：
 *   改为复用 `CortisolRhythmCard.getSleepWindow(dk)`（内部委托 lib/sleepTime.parseClockMinutes，
 *   分钟精度、兼容 "HH:mm" 与原生 "yyyy-MM-dd HH:mm"）。下方取窗口处传 targetDk 即可。
 */

/** 节律洞察文案：卡片「节律洞察」与身体恢复页 AI 综合分析共用同一份逻辑（单一逻辑源） */
export function buildRhythmInsights(r: CortisolRhythmResult, isToday: boolean): string[] {
  const todayHigh = isToday ? r.today.high : false; // 历史单日无 14 天基线，偏高不可信
  const todayDys = r.today.dys;
  const dayWord = isToday ? '今日' : '当日';
  const cos = r.cosinor;
  const hasCos = Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude);
  const insights: string[] = [];
  if (!todayHigh && !todayDys) {
    insights.push('皮质醇节律弹性好，晨起皮质醇能正常爬升，入睡时能正常下降。');
  }
  if (todayHigh) {
    insights.push(`${dayWord}皮质醇水平偏高（高于你 14 天基线 75 分位），身体可能处于较高压力负荷，注意放松与恢复。`);
  }
  if (todayDys) {
    insights.push(`${dayWord}节律形态紊乱——昼夜曲线异常，可能和睡眠不规律、长期压力或激素波动有关。`);
  }
  if (hasCos && cos.amplitude < 0.15 * cos.mesor) {
    insights.push('昼夜波动幅度偏低，节律扁平——皮质醇早上起不来、晚上降不去。');
  }
  if (hasCos && Number.isFinite(cos.acrophaseH)) {
    if (cos.acrophaseH < 6) insights.push(`峰值出现在 ${cos.acrophaseH.toFixed(0)}:00，皮质醇起得太早，可能后半夜已经开始分泌。`);
    else if (cos.acrophaseH > 11) insights.push(`峰值出现在 ${cos.acrophaseH.toFixed(0)}:00，偏晚的皮质醇节律可能影响夜间睡眠。`);
  }
  if (Number.isFinite(r.css) && r.css < 0) {
    insights.push('皮质醇节律偏晚间型，"夜猫子"模式，长期可能导致社交时差。');
  }
  if (todayHigh || todayDys) {
    insights.push('💡 建议：保持固定睡眠节律、减少下午 3 点后咖啡因、上午接触自然光 30 分钟。');
  }
  return insights;
}

/**
 * CortisolDailyChart —— 身体恢复详情页「皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致。
 * 可选 anchorDayMs：传入则展示该历史日的曲线（不再含 14 天基线对比与持续性卡片）；
 * 不传则为默认行为（今日 / 近 14 天节律，含持续性卡片），洞察页继续原样使用。
 * 可选 showStatusChip（默认 true）：控制「节律分析」标题右侧的当日状态 chip；
 * 身体恢复详情页顶部已有同结论大字，传 false 去重（洞察页不变）。
 * 可选 showInsights（默认 true）：控制卡片底部「📊 节律洞察」文字块；
 * 身体恢复页传 false（洞察文案已并入其 AI 综合分析，共用 buildRhythmInsights）。
 * 可选 insightRows：传入则用「AI 分析」行（与身体恢复页 AI 综合分析**同源**、同一 AiResultRow 组件）
 * 替代静态「节律洞察」——洞察页睡眠 tab 用它承接恢复页同款 AI，保证两处一致。
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）。
 */
export default function CortisolDailyChart({
  anchorDayMs,
  showStatusChip = true,
  showInsights = true,
  insightRows,
  flat = false,
}: {
  anchorDayMs?: number;
  showStatusChip?: boolean;
  showInsights?: boolean;
  /** ★ 2026-10-08（用户：把详情页里昼夜节律的去掉灰色背景）：flat=true 时「节律分析」4 格与「持续性」块不铺灰底，
   *   走无底色纯文字块（仅昼夜节律详情页传，睡眠 tab 的 CortisolSleepSummary 不受影响）。 */
  flat?: boolean;
  /** 替代静态「节律洞察」的 AI 分析行（与身体恢复页 AI 综合分析同源：皮质醇节律 + 今日建议）。传入则优先展示 AI。 */
  insightRows?: AiInsightRow[];
} = {}) {
  const navigation = useNavigation<any>();
  // ★ v18.123：回填/实时数据到达后要重算曲线（与首页昼夜节律卡同一 hook）
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const isToday = anchorDayMs == null || dayKey(anchorDayMs) === dayKey(Date.now());
  const targetMs = anchorDayMs ?? Date.now();
  const targetDk = dayKey(targetMs);
  // ★ v18.123：数据源切到**多模态反推的皮质醇活性**（v18.116 方案 A），与首页昼夜节律卡同源。
  //   旧实现读 `collectSamples()`（cortisol intraday，来自 `stress×1.6+20` 线性代理），
  //   门槛 `samples.length < 4`：今天只有 8 条 / 4 个槽 → 经常刚好卡在门槛附近或以下 → 「全天趋势图不展示」。
  //   新实现按 **30min 槽**判门槛（与首页一致），并且时段基线同样是「同时段跨天比较」。
  const sleepWindow = getSleepWindow(targetDk) ?? getSleepWindow();

  const proxy = useMemo(() => {
    if (!isToday) return null;
    const bl = buildCortisolProxyBaseline(14);
    return { ...buildCortisolProxyToday(bl), baselineDays: bl.days };
  }, [isToday, hsRefresh]);

  const proxyValid = proxy ? proxy.vals.filter((v: number | null): v is number => v != null).length : 0;
  // ★ 历史单日仍走旧的逐样本链路（多模态反推需要个人基线，历史日基线窗口不含当天，暂不适用）
  const samples = isToday ? [] : collectSamplesForDay(targetDk);

  const mdLabel = `${new Date(targetMs).getMonth() + 1}/${new Date(targetMs).getDate()}`;
  const title = isToday ? '今日皮质醇全天趋势' : `皮质醇全天趋势 · ${mdLabel}`;

  const goDetail = () => {
    navigation.navigate('MetricDetail', {
      key: 'cortisol',
      name: '皮质醇',
      unit: 'nmol/L',
      yMin: 0,
      yMax: 120,
      color: '#7C6AE0',
    });
  };

  // ★ v18.123：门槛按 30min 槽数判（≥3 槽即可画），并要求基线已成熟（≥3 天）。
  if (isToday ? proxyValid < 3 : false) {
    return (
      <Card>
        <Text style={styles.title}>{title}</Text>
        <Text style={{ fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          {isToday
            ? (proxy && proxy.baselineDays < MIN_BASELINE_DAYS
                ? `正在建立你的个人基线（${proxy.baselineDays}/${MIN_BASELINE_DAYS} 天），多戴几天戒指就能看到全天趋势。`
                : '佩戴戒指约半小时后，这里会显示由心率变异性、皮电、体温与心率反推出的全天皮质醇活性曲线。')
            : `${mdLabel} 暂无皮质醇数据`}
        </Text>
      </Card>
    );
  }

  // 历史单日无 14 天基线，baselineDays=1；todayLevel/持续性仅在「今日」有意义
  // ★ v18.123：今日主曲线已由 TrendChart 内部直接取 proxy（见 CortisolRhythmCard）；
  //   这里的 r 只用于顶部大字/chip/洞察文案，hourlyMean 同样喂 proxy 的槽值。
  //   填进 r.hourlyMean（每槽值）与 hourlyPredicted（true=实测槽 / false=无数据）。
  //   TrendChart 内部直接消费 r.hourlyMean 画 30min 曲线，因此这里只需把 proxy 结果映射成 r 的形状。
  //   历史日维持旧链路（analyzeCortisol + collectSamplesForDay）。
  // ★ v18.124：实测槽统计（水平/峰值时刻/波动幅度）——供 r.cosinor 消费，详情页那两个格子靠它出数
  const psum = useMemo(
    () => (proxy ? proxySummaryFromSlots(proxy.vals, proxy.real) : { mesor: null, acrophaseH: null, amplitudePct: null, n: 0 }),
    [proxy],
  );
  const r: CortisolRhythmResult = isToday && proxy
    ? {
        // ★ v18.124：不再填 NaN —— 直接用**实测槽统计**给水平/峰值/波动。
        //   旧实现这里全 NaN → 详情页「平均压力水平 / 平均峰值时刻」全显示「—」（用户实锤）。
        cosinor: {
          mesor: psum.mesor ?? NaN,
          amplitude: psum.amplitudePct != null && psum.mesor ? (psum.amplitudePct / 100) * psum.mesor : NaN,
          acrophaseH: psum.acrophaseH ?? NaN,
          r2: 0,
          n: proxyValid,
        },
        css: NaN,
        baseline: { p25: NaN, p75: NaN, n: proxy.baselineDays },
        // 每 2 个 30min 槽合成 1 个小时（TrendChart 内部会再聚合成 30min，这里给小时粒度即可）
        hourlyMean: Array.from({ length: 24 }, (_, h) => {
          const a = proxy.vals[h * 2];
          const b = proxy.vals[h * 2 + 1];
          const both = [a, b].filter((v): v is number => v != null);
          return both.length ? +(both.reduce((x, y) => x + y, 0) / both.length).toFixed(1) : null;
        }),
        hourlyPredicted: Array.from({ length: 24 }, (_, h) => !(proxy.vals[h * 2] != null || proxy.vals[h * 2 + 1] != null)),
        dailyMesors: psum.mesor != null ? [{ date: targetDk, mesor: psum.mesor }] : [],
        status: { level: 'normal', flags: [] },
        sustainedHighStreak: 0,
        todayLevel: 'normal',
        today: { high: false, dys: false },
        highStreak: 0,
        dysStreak: 0,
      }
    : analyzeCortisol(samples, 1);

  // ── 当前日自身状态（芯片）：紊乱 + 偏高 可能并存，需并排展示 ──
  // 历史单日无 14 天基线，偏高(high)无意义，强制为 false，仅保留形态紊乱(dys)
  const todayHigh = isToday ? r.today.high : false;
  const todayDys = r.today.dys;
  const chipLabel =
    todayDys && todayHigh ? '节律紊乱 · 当日偏高'
    : todayDys ? '节律紊乱'
    : todayHigh ? '当日偏高'
    : '节律正常';
  // v18.21：正常档改 ui.rhythmGood token（裸 hex #2ECC71 违反组件层禁裸色铁律；语义=节律正常）
  const chipColor = todayDys ? theme.colors.stateTense : todayHigh ? theme.colors.danger : theme.colors.ui.rhythmGood;
  const cos = r.cosinor;
  const hasCos = Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude);

  // ── 节律解读文字（与身体恢复页 AI 综合分析共用 buildRhythmInsights，单一逻辑源）──
  const insights = buildRhythmInsights(r, isToday);

  const fmtHour = (h: number) => {
    if (!Number.isFinite(h)) return '—';
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  };
  const fmtAmpPct = () => {
    if (!hasCos || cos.mesor <= 0) return '—';
    return `${Math.round(cos.amplitude / cos.mesor * 100)}%`;
  };

  // ★ 2026-10-08：当日「持续性」连续天数不再写死 0 —— 改从个人基线反推过去 14 天的真实节律结论，
  //   与首页/趋势图/日历同一套 judgeCortisolRhythm 判定：今天若「偏高/紊乱」，再往前逐日累计连续天数。
  const streak = useMemo(() => {
    if (!isToday) return { high: r.highStreak, dys: r.dysStreak };
    const DAY = 86400000;
    const labelOfDay = (dayMs: number): CortisolRhythmLabel | null => {
      try {
        const pbl = buildCortisolProxyBaseline(14, dayMs + DAY - 1);
        if (pbl.days < MIN_BASELINE_DAYS) return null;
        const px = buildCortisolProxyToday(pbl, { now: dayMs });
        const j = judgeCortisolRhythm(px.vals, px.real);
        return j.ready && j.label ? j.label : null;
      } catch { return null; }
    };
    const todayLabel = labelOfDay(Date.now());
    let high = todayLabel === '皮质醇偏高' ? 1 : 0;
    let dys = todayLabel === '节律紊乱' ? 1 : 0;
    for (let i = 1; i <= 14; i++) {
      const lbl = labelOfDay(Date.now() - i * DAY);
      if (lbl == null) break;
      if (todayLabel === '皮质醇偏高') { if (lbl === '皮质醇偏高') high++; else break; }
      else if (todayLabel === '节律紊乱') { if (lbl === '节律紊乱') dys++; else break; }
      else break;
    }
    return { high, dys };
  }, [isToday, proxy, r.highStreak, r.dysStreak]);

  // ★ 2026-10-08：作息类型从「实测峰值时段」推导（与峰值时刻同源），
  //   只要当日有真实活性槽就必出值，不再依赖 cosinor.acrophaseH 是否为有限值（避免恒显「—」）。
  //   峰值时刻 > 11 点=晚睡型 / < 6 点=早起型 / 其余=常规作息，与下方峰值时刻副文案阈值一致。
  const peakHour = (() => {
    if (isToday && proxy) {
      let bi = -1;
      let bv = -Infinity;
      for (let i = 0; i < proxy.vals.length; i++) {
        const v = proxy.vals[i];
        if (proxy.real[i] && v != null && v > bv) {
          bv = v;
          bi = i;
        }
      }
      if (bi >= 0) return bi / 2;
    }
    return r.cosinor.acrophaseH; // 历史日 / 兜底：cosinor 拟合峰值时刻
  })();
  const chrono = (() => {
    if (!Number.isFinite(peakHour)) return { label: '—', sub: '—' };
    const h = peakHour;
    if (h > 11) return { label: '晚睡型', sub: '皮质醇夜高晨低，建议调整' };
    if (h < 6) return { label: '早起型', sub: '皮质醇起得太早（早醒风险）' };
    return { label: '常规作息', sub: '皮质醇晨高夜低（正常）' };
  })();

  return (
    <Card>
      {/* 趋势图区域：可点击跳转详情 */}
      <TouchableOpacity activeOpacity={0.7} onPress={goDetail}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentSolid }}>详情 ›</Text>
        </View>
        {/* ★ 还原 2026-10-09 误改：昼夜节律详情页的皮质醇日视图保留「14 天基线」（绿色虚线），
           不画纵坐标（flat=详情页 → hideYAxis=true，皮质醇看波形节律、无 Y 轴）。
           用户明确要求：14 天基线别删。 */}
        <TrendChart r={r} sleepWindow={sleepWindow} mainDayDk={targetDk} hideYAxis={flat} />
      </TouchableOpacity>

      {/* ── 节律分析（flat=昼夜节律详情页：去掉灰底、改加描边外框，避免内容漂浮）── */}
      <View style={flat ? [styles.rhythmFrame, styles.rhythmFrameOn] : styles.rhythmFrame}>
        {!flat && <View style={styles.divider} />}

        {/* 状态 + flags */}
        <View style={styles.rhythmHead}>
          <Text style={styles.rhythmTitle}>节律分析</Text>
          {showStatusChip && (
            <View style={[styles.levelChip, { backgroundColor: chipColor + '22' }]}>
              <View style={[styles.levelDot, { backgroundColor: chipColor }]} />
              <Text style={[styles.levelText, { color: chipColor }]}>{chipLabel}</Text>
            </View>
          )}
        </View>

        {/* 2×2 SumCell 摘要 */}
        <View style={styles.summaryGrid}>
          <SumCell
            flat={flat}
            label="整体压力水平"
            value={hasCos ? cos.mesor.toFixed(1) : '—'}
            sub={
              hasCos && isToday && Number.isFinite(r.baseline.p75)
                ? cos.mesor > r.baseline.p75 ? '高于个人基线 P75'
                  : cos.mesor < r.baseline.p25 ? '低于个人基线 P25'
                  : '在正常区间内'
                : hasCos ? '单日均值' : '全天压力代理均值'
            }
          />
          <SumCell
            flat={flat}
            label="峰值时刻"
            value={fmtHour(cos.acrophaseH)}
            sub={
              Number.isFinite(cos.acrophaseH)
                ? cos.acrophaseH >= 6 && cos.acrophaseH <= 11 ? '正常范围 06–11 点'
                  : cos.acrophaseH < 6 ? '过早（早醒风险）'
                  : '偏晚（夜猫子型）'
                : '—'
            }
          />
        </View>
        <View style={[styles.summaryGrid, { marginTop: theme.sp(1) }]}>
          <SumCell
            flat={flat}
            label="昼夜波动幅度"
            value={fmtAmpPct()}
            sub={
              hasCos
                ? cos.amplitude < 0.15 * cos.mesor ? '节律扁平 ⚠️'
                  : cos.amplitude >= 0.3 * cos.mesor ? '节律弹性好'
                  : '适中'
                : '—'
            }
          />
          <SumCell
            flat={flat}
            label="作息类型"
            value={chrono.label}
            sub={chrono.sub}
          />
        </View>

        {/* 持续性：偏高 / 紊乱 连续天数（仅「今日」视图有意义，需 14 天基线） */}
        {isToday && (
          <View style={[styles.persistenceCard, !flat && styles.persistenceCardSoft]}>
            <Text style={styles.persistenceTitle}>持续性</Text>
            <View style={styles.persistenceRow}>
              <Text style={styles.persistenceLabel}>皮质醇偏高</Text>
              <Text style={[styles.persistenceValue, { color: streak.high > 0 ? theme.colors.danger : theme.colors.textSub }]}>
                {streak.high === 0 ? '近期稳定'
                  : streak.high === 1 ? '今日偏高'
                  : `已连续 ${streak.high} 天（含今天）`}
              </Text>
            </View>
            <View style={[styles.persistenceRow, { marginTop: theme.sp(1) }]}>
              <Text style={styles.persistenceLabel}>节律紊乱</Text>
              <Text style={[styles.persistenceValue, { color: streak.dys > 0 ? theme.colors.stateTense : theme.colors.textSub }]}>
                {streak.dys === 0 ? '近期稳定'
                  : streak.dys === 1 ? '今日紊乱'
                  : `已连续 ${streak.dys} 天（含今天）`}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* AI 分析：统一 AiAnalysis 外壳 + 大标题 + 小点建议 */}
      {(() => {
        const { title: cortisolTitle, sub: cortisolSub } = buildCortisolAiTitle(r, isToday, mdLabel);

        if (insightRows && insightRows.length > 0) {
          return (
            <AiAnalysis title={cortisolTitle} subtitle={cortisolSub}>
              {insightRows.map((row, i) => (
                <AiResultRow key={`${row.title}-${i}`} tone={row.tone} title={row.title}>
                  {row.body}
                </AiResultRow>
              ))}
            </AiAnalysis>
          );
        }
        if (showInsights && insights.length > 0) {
          return (
            <AiAnalysis title={cortisolTitle} subtitle={cortisolSub}>
              <AiResultRow tone={r.today.high ? 'warn' : 'good'} title={r.today.high ? '今日皮质醇偏高' : '今日节律良好'}>
                {insights.join(' ')}
              </AiResultRow>
            </AiAnalysis>
          );
        }
        return null;
      })()}

      {/* 持续天数已在上方「持续性」卡片展示 */}
    </Card>
  );
}

/**
 * 皮质醇 AI 分析的大标题 / 小标签（从本组件内联逻辑抽出，供睡眠 tab 的
 * CortisolSleepSummary 复用，保证「同一个结论只写一份」）。
 */
export function buildCortisolAiTitle(
  r: CortisolRhythmResult,
  isToday: boolean,
  mdLabel: string
): { title: string; sub: string } {
  const todayHigh = isToday ? r.today.high : false; // 历史单日无 14 天基线，偏高不可信
  const todayDys = r.today.dys;
  const css = r.css;
  const cssLabel = Number.isFinite(css)
    ? css > 10 ? '早起型' : Math.abs(css) < 10 ? '中间型' : '晚起型'
    : '节律未定型';
  const title =
    todayHigh && todayDys ? `${cssLabel} · 皮质醇偏高 + 节律紊乱`
    : todayHigh ? `${cssLabel} · 皮质醇偏高`
    : todayDys ? `${cssLabel} · 节律紊乱`
    : `${cssLabel} · 节律正常`;
  return { title, sub: isToday ? '今日' : mdLabel };
}

/** SumCell —— 与 EmotionCognitiveDetailScreen 同款（导出供 CortisolSleepSummary 复用，样式单一来源） */
export function SumCell({ label, value, sub, flat = false }: { label: string; value: string; sub?: string; flat?: boolean }) {
  return (
    <View style={[styles.sumCell, !flat && styles.sumCellSoft]}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
      {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },

  // ── 节律分析区 ──
  divider: { height: 1, backgroundColor: theme.colors.cardBorder2, marginTop: theme.sp(3), marginBottom: theme.sp(2) },
  rhythmHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(2) },
  rhythmTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  // SumCell
  summaryGrid: { flexDirection: 'row' },
  // ★ 2026-10-08（用户：把详情页里昼夜节律的去掉灰色背景）：底色拆出来，flat 时不铺
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, marginHorizontal: theme.sp(0.5) },
  sumCellSoft: { backgroundColor: theme.colors.cardBgSoft },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  // AI 洞察
  insightBox: { backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md, padding: theme.sp(2.5), marginTop: theme.sp(2) },
  insightTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  insightLine: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55, marginBottom: theme.sp(0.5) },

  streakText: { fontSize: theme.fontSize.sm, color: theme.colors.danger, marginTop: theme.sp(1.5), fontWeight: theme.weight.semibold as any },

  // 持续性卡片
  // ★ 2026-10-08：同上，flat 时不铺灰底
  persistenceCard: { borderRadius: theme.radius.md, padding: theme.sp(2.5), marginTop: theme.sp(2) },
  persistenceCardSoft: { backgroundColor: theme.colors.cardBgSoft },
  persistenceTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  persistenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  persistenceLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textBody },
  persistenceValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  // 节律分析外框（flat=昼夜节律详情页：去掉灰底后，用描边外框收口，避免内容漂浮）
  rhythmFrame: { marginTop: theme.sp(3) },
  rhythmFrameOn: {
    marginTop: theme.sp(2),
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.md,
    padding: theme.sp(2.5),
  },
});
