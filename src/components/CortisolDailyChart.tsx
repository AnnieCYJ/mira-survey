/**
 * CortisolDailyChart —— 身体恢复详情页「今日皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致：
 *   collectSamples → analyzeCortisol → TrendChart（30min 槽位 + cosinor 填补 + 睡眠阴影 + 14天基线对比）
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import Card from './Card';
import EmptyChart from './charts/EmptyChart';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import type { AiInsightRow } from '../ai/insight';
import { analyzeCortisol, type CortisolRhythmResult } from '../lib/cortisolRhythm';
import { collectSamples, collectSamplesForDay, getSleepWindow, TrendChart } from './CortisolRhythmCard';
import { buildCortisolProxyBaseline, buildCortisolProxyToday, buildCortisolShapedToday, proxySummaryFromSlots, judgeCortisolRhythm, judgeCortisolRhythmForDay, MIN_BASELINE_DAYS, type CortisolRhythmLabel } from '../lib/cortisolProxy';
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
  asTwoCards = false,
  chartHeight,
}: {
  anchorDayMs?: number;
  showStatusChip?: boolean;
  showInsights?: boolean;
  /** ★ 2026-10-08（用户：把详情页里昼夜节律的去掉灰色背景）：flat=true 时「节律分析」4 格与「持续性」块不铺灰底，
   *   走无底色纯文字块（仅昼夜节律详情页传，睡眠 tab 的 CortisolSleepSummary 不受影响）。 */
  flat?: boolean;
  /** ★ 2026-10-10（用户：昼夜节律详情页按预览拆成两张独立卡）：asTwoCards=true 时
   *   趋势图单独一张卡、节律分析单独一张卡（下方），与 circadian-cortisol-preview.html 日面板一致；
   *   不渲染任何 AI 分析块。身体恢复详情页睡眠 tab 不传，保持原单卡结构。 */
  asTwoCards?: boolean;
  /** 趋势图高度（pt）：详情页传 chart.h.m 放大，与 chart-size-unified-spec 详情单指标档对齐；
   *   缺省走 TrendChart 内部默认 chart.h.s（卡内嵌档）。 */
  chartHeight?: number;
  /** 替代静态「节律洞察」的 AI 分析行（与身体恢复页 AI 综合分析同源：皮质醇节律 + 今日建议）。传入则优先展示 AI。 */
  insightRows?: AiInsightRow[];
} = {}) {
  const navigation = useNavigation<any>();
  // ★ 2026-10-10（用户）：昼夜节律详情页·日视图「节律分析」卡默认收起，点击「查看详情 ›」展开
  const [rhythmOpen, setRhythmOpen] = useState(false);
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
    // ★ 2026-11-08：判定层（psum / judge）用原始实测 vals；曲线层另取拟合形状。
    const measured = buildCortisolProxyToday(bl);
    const shaped = buildCortisolShapedToday(bl);
    return { ...measured, shaped, baselineDays: bl.days };
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

  // ★ 2026-10-10（Render Error 修复）：原门槛提前 return（今日槽 <3 → 空态卡）原本在
  //   下方两个 useMemo（psum / streak）之前，数据到达后 hooks 数量变多 →
  //   "Rendered more hooks than during the previous render"（真机实锤 CortisolDailyChart.tsx:149）。
  //   现将空态 return 移到全部 hooks 之后（见 streak useMemo 之后），hooks 顺序恒定，文案不变。

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
        // ★ 2026-11-08：曲线层改用「正常昼夜节律先验 + 实测温和修正」的拟合值；
        //   hourlyPredicted=true 的小时 = 只有参考形状 / 无实测信号，TrendChart 会画成虚线浅色。
        //   判定层 psum 仍读 proxy.vals（原始实测），不受拟合影响。
        hourlyMean: Array.from({ length: 24 }, (_, h) => {
          const a = proxy.shaped.vals[h * 2];
          const b = proxy.shaped.vals[h * 2 + 1];
          const both = [a, b].filter((v): v is number => v != null);
          return both.length ? +(both.reduce((x, y) => x + y, 0) / both.length).toFixed(1) : null;
        }),
        hourlyPredicted: Array.from({ length: 24 }, (_, h) =>
          proxy.shaped.vals[h * 2] == null && proxy.shaped.vals[h * 2 + 1] == null
            ? true
            : !!(proxy.shaped.modeled[h * 2] || proxy.shaped.modeled[h * 2 + 1])),
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
    // ★ 2026-10-14：改走模块级缓存的 judgeCortisolRhythmForDay（与节律日历同一入口），
    //   过去日期的基线判定结果缓存复用，消除「详情页每次刷新重算 14 天基线」的卡顿。
    const labelOfDay = (dayMs: number): CortisolRhythmLabel | null => {
      try {
        const dk = dayKey(dayMs);
        const j = judgeCortisolRhythmForDay(dk, dayKey(Date.now()) === dk);
        const map: Record<string, CortisolRhythmLabel> = { normal: '节律正常', high: '皮质醇偏高', late: '节律紊乱' };
        return map[j.kind];
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

  // ★ v18.123：门槛提前 return（今日槽 <3 → 空态卡）。2026-10-10 移到全部 hooks 之后，
  //   修复 "Rendered more hooks than during the previous render"（hooks 顺序恒定）。
  if (isToday ? proxyValid < 3 : false) {
    // ★ 2026-11-06（用户：没有数据展示空图表，不要展示一句话）→ 空态渲染同款图表骨架
    //   （坐标轴 + 网格 + 虚线基线），保留一行轻量进度提示（仅基线建立期），不再整卡纯文字。
    return (
      <Card>
        <Text style={styles.title}>{title}</Text>
        <EmptyChart height={chart.plot.m} xLabels={['00', '06', '12', '18', '24']} />
        {isToday && proxy && proxy.baselineDays < MIN_BASELINE_DAYS ? (
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            正在建立你的个人基线（{proxy.baselineDays}/{MIN_BASELINE_DAYS} 天）
          </Text>
        ) : null}
      </Card>
    );
  }

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

  // ★ 2026-10-10：抽取节律分析区块，供「单卡」（身体恢复页）与「两张独立卡」（昼夜节律详情页 asTwoCards）复用
  //   hideHead=true（asTwoCards 折叠卡）：由外层折叠卡头接管「节律分析」标题，避免重复。
  //   list=true（asTwoCards 日视图展开）：纵向列表（对标全天趋势·详细数据 rowsBox/rowItem），不画 2×2 格子。
  const renderRhythmAnalysis = (opts: { hideHead?: boolean; list?: boolean } = {}) => (
    <View style={flat && !asTwoCards ? [styles.rhythmFrame, styles.rhythmFrameOn] : styles.rhythmFrame}>
      {!flat && <View style={styles.divider} />}

      {!opts.hideHead && (
        <View style={styles.rhythmHead}>
          <Text style={styles.rhythmTitle}>节律分析</Text>
          {showStatusChip && (
            <View style={[styles.levelChip, { backgroundColor: chipColor + '22' }]}>
              <View style={[styles.levelDot, { backgroundColor: chipColor }]} />
              <Text style={[styles.levelText, { color: chipColor }]}>{chipLabel}</Text>
            </View>
          )}
        </View>
      )}

      {opts.list ? (
        <View style={styles.rhythmListBox}>
          <RhythmListRow k="整体压力水平" v={hasCos ? cos.mesor.toFixed(1) : '—'} s={hasCos && isToday && Number.isFinite(r.baseline.p75) ? (cos.mesor > r.baseline.p75 ? '高于个人基线 P75' : cos.mesor < r.baseline.p25 ? '低于个人基线 P25' : '在正常区间内') : hasCos ? '单日均值' : '全天压力代理均值'} />
          <RhythmListRow k="峰值时刻" v={fmtHour(cos.acrophaseH)} s={Number.isFinite(cos.acrophaseH) ? (cos.acrophaseH >= 6 && cos.acrophaseH <= 11 ? '正常范围 06–11 点' : cos.acrophaseH < 6 ? '过早（早醒风险）' : '偏晚（夜猫子型）') : '—'} />
          <RhythmListRow k="昼夜波动幅度" v={fmtAmpPct()} s={hasCos ? (cos.amplitude < 0.15 * cos.mesor ? '节律扁平 ⚠️' : cos.amplitude >= 0.3 * cos.mesor ? '节律弹性好' : '适中') : '—'} />
          <RhythmListRow k="作息类型" v={chrono.label} s={chrono.sub} />
          {isToday && (
            <>
              <Text style={styles.rhythmListSection}>持续性</Text>
              <RhythmListRow k="皮质醇偏高" v={streak.high === 0 ? '近期稳定' : streak.high === 1 ? '今日偏高' : `已连续 ${streak.high} 天（含今天）`} vTone={streak.high > 0 ? theme.colors.danger : undefined} />
              <RhythmListRow k="节律紊乱" v={streak.dys === 0 ? '近期稳定' : streak.dys === 1 ? '今日紊乱' : `已连续 ${streak.dys} 天（含今天）`} vTone={streak.dys > 0 ? theme.colors.stateTense : undefined} />
            </>
          )}
        </View>
      ) : (
        <>
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
            <View style={[styles.persistenceCard, flat ? styles.persistenceCardFlat : styles.persistenceCardSoft]}>
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
        </>
      )}
    </View>
  );

  // ★ 2026-10-10（用户）：昼夜节律详情页日视图——「查看详情」折叠入口直接放在图表下方（不再单独成「节律分析」卡），
  //   左「查看详情」、右向下箭头、无「节律分析」标题；点击展开节律分析（2×2 + 持续性），样式对标全天趋势·详细数据折叠。
  if (asTwoCards) {
    return (
      <Card>
        <TouchableOpacity activeOpacity={0.7} onPress={goDetail}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentText }}>详情 ›</Text>
          </View>
          <TrendChart r={r} sleepWindow={sleepWindow} mainDayDk={targetDk} hideYAxis={flat} height={chartHeight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.rhythmCollapsedRow, rhythmOpen && styles.rhythmCollapsedRowOpen]}
          activeOpacity={0.7}
          onPress={() => setRhythmOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={rhythmOpen ? '收起节律分析' : '展开节律分析'}
        >
          <Text style={styles.rhythmCollapsedTitle}>查看详情</Text>
          <View style={[styles.rhythmChev, rhythmOpen && styles.rhythmChevOpen]} />
        </TouchableOpacity>
        {rhythmOpen ? renderRhythmAnalysis({ hideHead: true, list: true }) : null}
      </Card>
    );
  }

  return (
    <Card>
      {/* 趋势图区域：可点击跳转详情 */}
      <TouchableOpacity activeOpacity={0.7} onPress={goDetail}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentText }}>详情 ›</Text>
        </View>
        {/* ★ 还原 2026-10-09 误改：昼夜节律详情页的皮质醇日视图保留「14 天基线」（绿色虚线），
           不画纵坐标（flat=详情页 → hideYAxis=true，皮质醇看波形节律、无 Y 轴）。
           用户明确要求：14 天基线别删。 */}
        <TrendChart r={r} sleepWindow={sleepWindow} mainDayDk={targetDk} hideYAxis={flat} height={chartHeight} />
      </TouchableOpacity>

      {renderRhythmAnalysis()}

      {/* AI 分析：统一 AiAnalysis 外壳 + 大标题 + 小点建议（身体恢复页睡眠 tab 走此分支） */}
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

/** SumCell —— 与 EmotionCognitiveDetailScreen 同款（导出供 CortisolSleepSummary 复用，样式单一来源）
 *  ★ 2026-10-10：flat 对齐预览稿 sumCell2（白底 + cardBorder 描边 + 亮绿左条 3px limeMid），
 *    不再是无框纯文字（用户反馈"还是原先那样"）——灰底版本保留给非 flat 调用方。 */
export function SumCell({ label, value, sub, flat = false }: { label: string; value: string; sub?: string; flat?: boolean }) {
  return (
    <View style={[styles.sumCell, flat ? styles.sumCellFlat : styles.sumCellSoft]}>
      <Text style={[styles.sumLabel, flat && styles.sumLabelFlat]}>{label}</Text>
      <Text style={[styles.sumValue, flat && styles.sumValueFlat]}>{value}</Text>
      {sub ? <Text style={[styles.sumSub, flat && styles.sumSubFlat]}>{sub}</Text> : null}
    </View>
  );
}

/** RhythmListRow —— 昼夜节律详情页日视图展开「列表」行（对标全天趋势·详细数据 rowItem）
 *  左 = label（xs textSub），右 = value（xs semibold textTitle）+ 副文（micro textSub，右对齐） */
function RhythmListRow({ k, v, s, vTone }: { k: string; v: string; s?: string; vTone?: string }) {
  return (
    <View style={styles.rhythmListRow}>
      <Text style={styles.rhythmListK}>{k}</Text>
      <View style={styles.rhythmListR}>
        <Text style={[styles.rhythmListV, vTone ? { color: vTone } : null]}>{v}</Text>
        {s ? <Text style={styles.rhythmListS}>{s}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },

  // ── 节律分析区 ──
  divider: { height: 1, backgroundColor: theme.colors.cardBorder2, marginTop: theme.sp(3), marginBottom: theme.sp(2) },
  rhythmHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(2) },
  rhythmTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  levelChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  levelDot: { width: theme.sp(1.5), height: theme.sp(1.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1) },
  levelText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  // SumCell
  summaryGrid: { flexDirection: 'row' },
  // ★ 2026-10-08（用户：把详情页里昼夜节律的去掉灰色背景）：底色拆出来，flat 时不铺
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, marginHorizontal: theme.sp(0.5) },
  sumCellSoft: { backgroundColor: theme.colors.cardBgSoft },
  // ★ 2026-10-10：flat = 预览稿 sumCell2 —— 白底 + 描边 + 亮绿左条（RN 用 borderLeftWidth 实现 ::before）
  sumCellFlat: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderLeftWidth: 3,
    borderLeftColor: mm.colors.limeMid,
  },
  // ★ 2026-10-10：flat（昼夜节律详情页）字号对齐预览 Design Token：label=micro(11) / value=h2(22) / sub=micro(11)
  sumLabelFlat: { fontSize: theme.fontSize.micro },
  sumValueFlat: { fontSize: theme.fontSize.h2, lineHeight: theme.fontSize.h2 * 1.15 },
  sumSubFlat: { fontSize: theme.fontSize.micro },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  // AI 洞察
  insightBox: { backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(2) },
  insightTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  insightLine: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55, marginBottom: theme.sp(0.5) },

  streakText: { fontSize: theme.fontSize.sm, color: theme.colors.danger, marginTop: theme.sp(1.5), fontWeight: theme.weight.semibold as any },

  // 持续性卡片
  // ★ 2026-10-08：同上，flat 时不铺灰底
  persistenceCard: { borderRadius: theme.radius.card, padding: theme.space.cardPadCompact, marginTop: theme.sp(2) },
  persistenceCardSoft: { backgroundColor: theme.colors.cardBgSoft },
  // ★ 2026-10-10：flat = 预览稿 persistCard —— 白底 + 描边（不再无框）
  persistenceCardFlat: {
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
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

  // ★ 2026-10-10（用户）：日视图「节律分析」折叠卡头，对标 EnergyDetailScreen「全天趋势·详细数据」mhRow
  //   默认收起（仅卡头），展开后顶部发丝线分隔卡头与内容
  rhythmCollapsedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.sp(2), paddingVertical: theme.sp(1), paddingHorizontal: 0,
  },
  rhythmCollapsedRowOpen: {
    marginTop: theme.sp(1.5), paddingTop: theme.sp(2.5),
  },
  rhythmCollapsedTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  rhythmCollapsedHint: { fontSize: theme.fontSize.micro, color: theme.colors.accentText, marginRight: theme.sp(2) },
  rhythmChev: {
    width: theme.sp(2), height: theme.sp(2),
    borderRightWidth: 1.6, borderBottomWidth: 1.6, borderColor: theme.colors.textSub,
    transform: [{ rotate: '45deg' }], marginRight: theme.sp(0.75),
  },
  rhythmChevOpen: { transform: [{ rotate: '-135deg' }] },

  // ★ 2026-10-10（用户：日视图展开为「列表」而非 2×2 格子；不画横线，只留白拉开间距，与其他页一致）
  rhythmListBox: { marginTop: theme.sp(1.5) },
  rhythmListRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: theme.sp(3),
  },
  rhythmListK: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, flexShrink: 1, marginRight: theme.sp(2) },
  rhythmListR: { alignItems: 'flex-end', flexShrink: 0 },
  rhythmListV: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  rhythmListS: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'right', lineHeight: theme.fontSize.micro * 1.4 },
  rhythmListSection: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginTop: theme.sp(3.5), marginBottom: theme.sp(1) },
});
