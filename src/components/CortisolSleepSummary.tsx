/**
 * CortisolSleepSummary —— 睡眠 tab 的「皮质醇分析」卡（关键指标 + AI 分析，**同一张卡片**）
 *
 * 为什么单独拆出来：
 *   原来这些内容都塞在 CortisolDailyChart（「今日皮质醇全天趋势」卡）里，而那张卡内容过长
 *   （趋势图 → 节律分析 2×2 摘要 → 持续性 → AI 分析），关键数字要滚很久才看得到。
 *   现在把「昼夜波动幅度 / 作息类型」两个关键指标 + AI 分析合并成一张卡，
 *   直接放在「睡眠结构」卡片正下方；原「今日皮质醇全天趋势」卡已从睡眠 tab 移除
 *   （组件本身仍供身体恢复详情页使用，未删除）。
 *
 * 数据同源（与 CortisolDailyChart、身体恢复页完全一致，绝不另起一套口径）：
 *   collectSamples() → analyzeCortisol(samples, 14)
 *   · 昼夜波动幅度 = cosinor.amplitude / cosinor.mesor（振幅占比）
 *   · 作息类型     = css（皮质醇正弦得分，>10 早起型 / |css|<10 不明显 / <-10 晚睡型）
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from './Card';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import { theme } from '../theme/theme';
import { analyzeCortisol } from '../lib/cortisolRhythm';
import { collectSamples } from './CortisolRhythmCard';
import { SumCell, buildCortisolAiTitle, buildRhythmInsights } from './CortisolDailyChart';
import type { AiInsightRow } from '../ai/insight';

/** 判定节律分析所需的最小样本数（与 CortisolDailyChart 的空状态阈值保持一致）。 */
const MIN_SAMPLES = 4;

export default function CortisolSleepSummary({
  insightRows,
  dataStale,
}: {
  /** AI 分析行（与身体恢复页 AI 综合分析同源）。传入则用它；否则回落本地规则文案。 */
  insightRows?: AiInsightRow[];
  /** ★ v18.104 断流即空态：与首页/睡眠结构卡同口径，旧采样拟合出的结论一律不展示。 */
  dataStale?: boolean;
}) {
  const samples = collectSamples();
  const r = analyzeCortisol(samples, 14);
  const enough = samples.length >= MIN_SAMPLES;

  const cos = r.cosinor;
  const hasCos = Number.isFinite(cos.mesor) && Number.isFinite(cos.amplitude) && cos.mesor > 0;

  // ── 指标 1：昼夜波动幅度 ──
  const ampValue = hasCos ? `${Math.round((cos.amplitude / cos.mesor) * 100)}%` : '—';
  const ampSub = !enough
    ? '数据不足'
    : hasCos
      ? cos.amplitude < 0.15 * cos.mesor ? '节律扁平 ⚠️'
        : cos.amplitude >= 0.3 * cos.mesor ? '节律弹性好'
        : '适中'
      : '—';

  // ── 指标 2：作息类型 ──
  const cssValue = Number.isFinite(r.css)
    ? r.css > 10 ? '早起型'
      : Math.abs(r.css) < 10 ? '不明显'
      : '晚睡型'
    : '—';
  const cssSub = Number.isFinite(r.css)
    ? r.css > 10 ? '皮质醇晨高夜低（正常）'
      : Math.abs(r.css) < 10 ? '昼夜无明显差异'
      : '皮质醇夜高晨低，建议调整'
    : '—';

  const { title: aiTitle, sub: aiSub } = buildCortisolAiTitle(r, true, '');
  const fallbackInsights = buildRhythmInsights(r, true);
  const showAi = !dataStale && enough && ((insightRows && insightRows.length > 0) || fallbackInsights.length > 0);

  return (
    <Card>
      {/* 皮质醇分析（置于睡眠结构卡正下方，一屏可见） */}
      <Text style={styles.title}>皮质醇分析</Text>
      <View style={styles.grid}>
        <SumCell
          label="昼夜波动幅度"
          value={dataStale ? '—' : ampValue}
          sub={dataStale ? '戒指暂无新数据' : ampSub}
        />
        <SumCell
          label="作息类型"
          value={dataStale ? '—' : cssValue}
          sub={dataStale ? '戒指暂无新数据' : cssSub}
        />
      </View>
      {dataStale ? (
        <Text style={styles.staleNote}>戒指已很久没有新数据，这里基于旧采样得出的结论暂不显示。</Text>
      ) : null}

      {/* AI 分析（与身体恢复页同源）：与关键指标同卡，用分割线区隔 */}
      {showAi ? (
        <>
          <View style={styles.divider} />
          <AiAnalysis title={aiTitle} subtitle={aiSub}>
            {insightRows && insightRows.length > 0 ? (
              insightRows.map((row, i) => (
                <AiResultRow key={`${row.title}-${i}`} tone={row.tone} title={row.title}>
                  {row.body}
                </AiResultRow>
              ))
            ) : (
              <AiResultRow
                tone={r.today.high ? 'warn' : 'good'}
                title={r.today.high ? '今日皮质醇偏高' : '今日节律良好'}
              >
                {fallbackInsights.join(' ')}
              </AiResultRow>
            )}
          </AiAnalysis>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(2),
  },
  grid: { flexDirection: 'row' },
  staleNote: {
    marginTop: theme.sp(2),
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.cardBorder2,
    marginTop: theme.sp(3),
    marginBottom: theme.sp(2),
  },
});
