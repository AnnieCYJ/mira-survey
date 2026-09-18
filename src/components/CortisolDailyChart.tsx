/**
 * CortisolDailyChart —— 身体恢复详情页「今日皮质醇全天趋势」
 *
 * 数据管线与洞察页 CortisolRhythmCard.TrendChart 完全一致：
 *   collectSamples → analyzeCortisol → TrendChart（30min 槽位 + cosinor 填补 + 睡眠阴影 + 14天基线对比）
 * 点击卡片 → 跳转 MetricDetail（皮质醇日/周/月/年趋势）
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Card from './Card';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import type { AiInsightRow } from '../ai/insight';
import { analyzeCortisol, type CortisolRhythmResult } from '../lib/cortisolRhythm';
import { collectSamples, collectSamplesForDay, getSleepWindow, TrendChart } from './CortisolRhythmCard';
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
}: {
  anchorDayMs?: number;
  showStatusChip?: boolean;
  showInsights?: boolean;
  /** 替代静态「节律洞察」的 AI 分析行（与身体恢复页 AI 综合分析同源：皮质醇节律 + 今日建议）。传入则优先展示 AI。 */
  insightRows?: AiInsightRow[];
} = {}) {
  const navigation = useNavigation<any>();
  const isToday = anchorDayMs == null || dayKey(anchorDayMs) === dayKey(Date.now());
  const targetMs = anchorDayMs ?? Date.now();
  const targetDk = dayKey(targetMs);
  const samples = isToday ? collectSamples() : collectSamplesForDay(targetDk);
  const sleepWindow = getSleepWindow(targetDk) ?? getSleepWindow();

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

  if (samples.length < 4) {
    return (
      <Card>
        <Text style={styles.title}>{title}</Text>
        <Text style={{ fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          {isToday ? '暂无足够的皮质醇数据，连上戒指开启自动监测后即可查看' : `${mdLabel} 暂无皮质醇数据`}
        </Text>
      </Card>
    );
  }

  // 历史单日无 14 天基线，baselineDays=1；todayLevel/持续性仅在「今日」有意义
  const r = analyzeCortisol(samples, isToday ? 14 : 1);

  // ── 当前日自身状态（芯片）：紊乱 + 偏高 可能并存，需并排展示 ──
  // 历史单日无 14 天基线，偏高(high)无意义，强制为 false，仅保留形态紊乱(dys)
  const todayHigh = isToday ? r.today.high : false;
  const todayDys = r.today.dys;
  const chipLabel =
    todayDys && todayHigh ? '节律紊乱 · 当日偏高'
    : todayDys ? '节律紊乱'
    : todayHigh ? '当日偏高'
    : '节律正常';
  const chipColor = todayDys ? theme.colors.stateTense : todayHigh ? theme.colors.danger : '#2ECC71';
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

  return (
    <Card>
      {/* 趋势图区域：可点击跳转详情 */}
      <TouchableOpacity activeOpacity={0.85} onPress={goDetail}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.sp(1) }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.accentSolid }}>详情 ›</Text>
        </View>
        <TrendChart r={r} sleepWindow={sleepWindow} mainDayDk={targetDk} />
      </TouchableOpacity>

      {/* ── 节律分析 ── */}
      <View style={styles.divider} />

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
          label="作息类型"
          value={
            Number.isFinite(r.css)
              ? r.css > 10 ? '早起型'
                : Math.abs(r.css) < 10 ? '不明显'
                : '晚睡型'
              : '—'
          }
          sub={
            Number.isFinite(r.css)
              ? r.css > 10 ? '皮质醇晨高夜低（正常）'
                : Math.abs(r.css) < 10 ? '昼夜无明显差异'
                : '皮质醇夜高晨低，建议调整'
              : '—'
          }
        />
      </View>

      {/* 持续性：偏高 / 紊乱 连续天数（仅「今日」视图有意义，需 14 天基线） */}
      {isToday && (
        <View style={styles.persistenceCard}>
          <Text style={styles.persistenceTitle}>持续性</Text>
          <View style={styles.persistenceRow}>
            <Text style={styles.persistenceLabel}>皮质醇偏高</Text>
            <Text style={[styles.persistenceValue, { color: r.highStreak > 0 ? theme.colors.danger : theme.colors.textSub }]}>
              {r.highStreak === 0 ? '近期稳定'
                : r.highStreak === 1 ? '今日偏高'
                : `已连续 ${r.highStreak} 天（含今天）`}
            </Text>
          </View>
          <View style={[styles.persistenceRow, { marginTop: theme.sp(1) }]}>
            <Text style={styles.persistenceLabel}>节律紊乱</Text>
            <Text style={[styles.persistenceValue, { color: r.dysStreak > 0 ? theme.colors.stateTense : theme.colors.textSub }]}>
              {r.dysStreak === 0 ? '近期稳定'
                : r.dysStreak === 1 ? '今日紊乱'
                : `已连续 ${r.dysStreak} 天（含今天）`}
            </Text>
          </View>
        </View>
      )}

      {/* AI 分析：统一 AiAnalysis 外壳 + 大标题 + 小点建议 */}
      {(() => {
        // 标题
        const { css } = r;
        const cssLabel = Number.isFinite(css) ? (css > 10 ? '早起型' : Math.abs(css) < 10 ? '中间型' : '晚起型') : '节律未定型';
        const cortisolTitle = todayHigh && todayDys ? `${cssLabel} · 皮质醇偏高 + 节律紊乱`
          : todayHigh ? `${cssLabel} · 皮质醇偏高`
          : todayDys ? `${cssLabel} · 节律紊乱`
          : `${cssLabel} · 节律正常`;
        const cortisolSub = isToday ? '今日' : mdLabel;

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

/** SumCell —— 与 EmotionCognitiveDetailScreen 同款 */
function SumCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.sumCell}>
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
  sumCell: { flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, marginHorizontal: theme.sp(0.5) },
  sumLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  sumValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  sumSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },

  // AI 洞察
  insightBox: { backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md, padding: theme.sp(2.5), marginTop: theme.sp(2) },
  insightTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },
  insightLine: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: theme.fontSize.sm * 1.55, marginBottom: theme.sp(0.5) },

  streakText: { fontSize: theme.fontSize.sm, color: theme.colors.danger, marginTop: theme.sp(1.5), fontWeight: theme.weight.semibold as any },

  // 持续性卡片
  persistenceCard: { backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.md, padding: theme.sp(2.5), marginTop: theme.sp(2) },
  persistenceTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1.5) },
  persistenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  persistenceLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textBody },
  persistenceValue: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },
});
