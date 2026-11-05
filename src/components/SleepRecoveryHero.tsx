/**
 * SleepRecoveryHero —— 「睡眠恢复分」卡片（日 / 周 / 月 / 年 统一）
 *
 * ★ 2026-10-09（用户定稿）：统一做成一张**置于时间选择器下方**的卡片，四视图一致；
 *   - 日视图：传 `anchorMs`，由 `computeSleepPersonalized` 算「当日」恢复分（50 = 和平时一样）；
 *   - 周/月/年：传 `value`（区间平均恢复分），标签为「平均恢复分（近 N 天/月）」。
 *   大数字字号 = theme.fontSize.hero（46），与预览稿日面板 .big 同款。
 *   右下角状态语：日视图按相对 50 基线自动判读；周月年不传 ctx（仅展示均值）。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { computeSleepPersonalized } from '../lib/sleepPersonalized';
// ★ 用与首页同源的「健康库刷新节拍」当依赖，睡眠记录到达后 hero 才会跟着刷新
import { useDebouncedHealthStoreRefresh } from '../hooks/useHealthStore';
// ★ 本轮（用户）：把「脑力峰值 / 低谷时段」合进这张「睡眠恢复分」卡内部，
//   不再单独成块。与能量详情页「认知准备度」同源同口径：forecast.peakSpan / troughSpan。
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { RingBle } from '../ble/RingBleManager';

function fmtSpan(span: { startHour: number; endHour: number } | null | undefined): string {
  if (!span) return '—';
  const f = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`;
  return `${f(span.startHour)} – ${f(span.endHour)}`;
}

interface Props {
  /** 日视图：用锚点日毫秒算当日睡眠恢复分 */
  anchorMs?: number;
  /** 周/月/年：直接传入区间平均恢复分（覆盖 anchorMs 计算） */
  value?: number | null;
  /** 卡片主标签（日=睡眠恢复分（个人相对·50=平时）/ 周月年=平均恢复分（本区间）） */
  label: string;
  /** 右下角状态语；不传且走 anchorMs 时按相对 50 基线自动判读 */
  ctx?: string | null;
}

export default function SleepRecoveryHero({ anchorMs, value, label, ctx }: Props) {
  const hsRefresh = useDebouncedHealthStoreRefresh(700);
  const pers = useMemo(() => {
    if (value != null || anchorMs == null) return null;
    try { return computeSleepPersonalized(anchorMs); } catch { return null; }
  }, [value, anchorMs, hsRefresh]);

  const score = value != null ? value : (pers?.score ?? null);
  const resolvedCtx = ctx != null ? ctx
    : pers ? (pers.mode === 'relative'
        ? (score != null ? (score >= 82 ? '比平时好 ↑' : score <= 68 ? '比平时吃力 ↓' : '和平时差不多 —') : null)
        : (pers.daysToReady > 0 ? `还需 ${pers.daysToReady} 晚建立基线` : '按固定目标评估'))
    : null;

  // ★ 本轮（用户）：数字下方加一段短 AI 分析（不太长），按相对 50 基线判读
  const analysis = (() => {
    if (score == null) return '今天还没有睡眠数据，戴上戒指睡一觉，明天这里会显示你的恢复分和解读。';
    if (score >= 82) return '今天睡得比平时好，身体恢复得很到位，保持现在的入睡节奏，明天状态会更稳。';
    if (score >= 69) return '睡眠恢复略低于平时，今晚早点休息，给身体一点缓冲，状态会慢慢回来。';
    if (score >= 51) return '恢复偏弱，今天别把安排排太满，午间小憩或傍晚散个步会有帮助。';
    return '恢复明显偏低，今天以休养为主，早点睡比什么都重要。';
  })();

  // ★ 本轮（用户）：脑力峰值 / 低谷时段合进本卡（仅日视图有 anchorMs 时展示）
  //   ★ 审计（2026-10-27）：戒指断流（>3h 无采样）时，时段不得再显示旧预测值，强制空态。
  const dataStale = (RingBle.getState().curveStatus as any)?.dataStale === true;
  const cog = useMemo(() => {
    if (anchorMs == null || value != null) return null;
    try { return computeCognitiveLoadReport(reportNowMsForDay(anchorMs)); } catch { return null; }
  }, [anchorMs, value, hsRefresh]);
  const peak = !dataStale ? cog?.forecast?.peakSpan : null;
  const trough = !dataStale ? cog?.forecast?.troughSpan : null;

  // ★ 2026-11-06（用户）：把「睡眠恢复分怎么看」折叠进本卡（置于脑力峰/谷下方），默认收起，点击展开。
  const [showHow, setShowHow] = useState(false);

  return (
    <View style={styles.card}>
      {/* ★ 本轮：title 移到数字上方（如「睡眠恢复分」） */}
      <Text style={styles.title}>{label}</Text>
      <View style={styles.hero}>
        <Text style={styles.score}>{score != null ? String(Math.round(score)) : '—'}</Text>
        <Text style={[styles.ctx, resolvedCtx == null && { color: theme.colors.textSub }]}>
          {resolvedCtx ?? '暂无数据'}
        </Text>
      </View>
      {/* ★ 本轮：数字下方短 AI 分析 */}
      <Text style={styles.analysis}>{analysis}</Text>
      {/* ★ 本轮（用户）：脑力峰值 / 低谷时段两格，合进睡眠恢复分卡内部 */}
      {anchorMs != null ? (
        <View style={styles.brDuo}>
          <View style={[styles.brCell, { backgroundColor: theme.colors.success + '1A' }]}>
            <Text style={styles.brCellLab}>脑力峰值时段</Text>
            <Text
              style={[styles.brCellTime, { color: !dataStale && peak ? theme.colors.success : theme.colors.textSub }]}
            >
              {!dataStale && peak ? fmtSpan(peak) : '—'}
            </Text>
            <Text style={styles.brCellSub}>适合深度思考</Text>
          </View>
          <View style={[styles.brCell, { backgroundColor: theme.colors.danger + '1A' }]}>
            <Text style={styles.brCellLab}>脑力低谷时段</Text>
            <Text
              style={[styles.brCellTime, { color: !dataStale && trough ? theme.colors.danger : theme.colors.textSub }]}
            >
              {!dataStale && trough ? fmtSpan(trough) : '—'}
            </Text>
            <Text style={styles.brCellSub}>安排休息 / 轻任务</Text>
          </View>
        </View>
      ) : null}

      {/* ★ 2026-11-06（用户）：什么是睡眠恢复分 —— 默认收起，点击展开说明 */}
      <TouchableOpacity
        style={styles.howHead}
        activeOpacity={0.7}
        onPress={() => setShowHow((v) => !v)}
      >
        <Text style={styles.howTitle}>什么是睡眠恢复分</Text>
        <Icon name={showHow ? 'chevronDown' : 'chevronRight'} size={theme.fs(16)} color={theme.colors.textSub} strokeWidth={2} />
      </TouchableOpacity>
      {showHow ? (
        <View style={styles.howBody}>
          <Text style={styles.howText}>75 分：接近个人平时　·　82 分以上：明显好于平时</Text>
          <Text style={styles.howText}>68–81 分：轻度偏低　·　45–67 分：恢复偏低</Text>
          <Text style={styles.howNote}>这是基于个人滚动基线的趋势分，不是医学诊断分。</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...theme.shadow.card,
    backgroundColor: theme.colors.cardBg,
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.space.cardPad,
    marginBottom: theme.space.md,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  lhs: { flexDirection: 'column' },
  // ★ 本轮：title 在数字上方（如「睡眠恢复分」）
  title: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, marginBottom: 6 },
  score: {
    fontSize: theme.fontSize.hero,
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    lineHeight: 48,
  },
  lab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 4 },
  ctx: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.limeMid, paddingBottom: 4 },
  // ★ 本轮：数字下方短 AI 分析
  analysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: 10 },
  // ★ 本轮（用户）：脑力峰/谷时段两格（合进卡内）
  brDuo: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  brCell: { flex: 1, borderRadius: mm.radius.card, padding: theme.space.sm },
  brCellLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  brCellTime: { fontSize: theme.fontSize.body, fontWeight: theme.weight.bold, color: theme.colors.textSub, marginTop: theme.sp(1) },
  brCellSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  // ★ 2026-11-06（用户）：什么是睡眠恢复分 —— 卡内可折叠说明
  howHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
  },
  howTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: theme.colors.textSub },
  howBody: { marginTop: theme.space.sm },
  howText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, lineHeight: 18 },
  howNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, fontStyle: 'italic', marginTop: theme.sp(1) },
});
