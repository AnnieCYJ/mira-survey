/**
 * StressRecoveryCard —— 洞察页「荷尔蒙节律」区、昼夜节律卡片上方的「压力恢复」卡
 *
 * ★ 2026-11-07（用户「正面展示太复杂，就展示 0~100 的恢复力，像 Oura 那样，
 *   展示恢复力趋势，压力别在这儿展示了」）：
 *  · 只保留「恢复力」一格（四态算法逐日分对应档位词，黄绿）；
 *  · 趋势 = 近 14 天恢复力单线趋势（RecoveryTrendChart：0–100 单线 + 右侧四档 + 星期横轴）；
 *  · 压力 tile / 压力线 / 四态图例全部撤出 —— 压力看「身心压力」详情页。
 *  点进卡片进入 StressRecoveryDetail（日 / 周 / 月 / 年 同其他详情页结构）。
 *
 * 数据全部真实：恢复 = lib/recoveryEngine 四态算法（HRV 相对 14 天基线 + METs）逐日实算。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { MindIcon } from './MindIcons';
import AiAnalysis, { AiResultRow } from './AiAnalysis';
import RecoveryDayTrendChart from './RecoveryDayTrendChart';
import { useRingState } from '../hooks/useRingState';
import { useHealthStoreVersion } from '../hooks/useHealthStore';
// ★ 2026-11-07（用户「恢复分数日周月年都要统一」）：卡片恢复指数不再挂 sleepPersonalized（另一把尺），
//   改用 computeDayRecoveryCurve 当日曲线非空均分 + recoveryTag 四档词 —— 与详情页 hero / 趋势图完全同源。
import { computeDayRecoveryCurve, recoveryTag } from '../lib/recoveryEngine';

export default function StressRecoveryCard({ onPress }: { onPress?: () => void }) {
  const ring = useRingState();
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;
  // ★ healthStore 异步水合：订阅版本号，数据落库后立即重算
  const hsVer = useHealthStoreVersion();

  const { recScore, recTag, todayCurve, dayStartMs } = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const curve = computeDayRecoveryCurve(base.getTime());
    const vals = curve.points
      .filter((p) => p.score != null && Number.isFinite(p.score))
      .map((p) => p.score as number);
    const score = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return {
      recScore: score,
      recTag: recoveryTag(score),
      todayCurve: curve.points,
      dayStartMs: base.getTime(),
    };
  }, [ring.curveStatus, hsVer]);

  // ★ 2026-11-07（用户：压力恢复节律卡片底部也要像昼夜节律一样有分析段）：
  //   与详情页 / 昼夜节律卡同源——基于真实恢复分给出结论，绝不编造。
  const recTone: 'good' | 'warn' | 'neutral' =
    recScore == null ? 'neutral' : recScore >= 70 ? 'good' : recScore >= 60 ? 'neutral' : 'warn';
  const recAiBody = dataStale
    ? '戒指暂无新数据，恢复信号同步后，这里会给出今日恢复力与节奏建议。'
    : recScore == null
      ? '今天还没有足够的 HRV 与活动数据，连接戒指并同步后，这里会显示你的恢复力趋势。'
      : recScore >= 70
        ? `今天恢复力 ${recScore} 分（${recTag}），身体处在良好的修复窗口，HRV 整体平稳。顺势安排轻松活动，把节奏稳住就好。`
        : recScore >= 60
          ? `今天恢复力 ${recScore} 分（${recTag}），状态平稳，恢复窗口一般。保持规律作息与适度活动，恢复会慢慢上来。`
          : `今天恢复力 ${recScore} 分（${recTag}），HRV 持续偏低，身体处在紧绷态。傍晚用一次呼吸练习、早点休息，把身体切回松弛。`;

  const body = (
    <View style={styles.wrap}>
      <View style={styles.inner}>
        <View style={styles.headRow}>
          <View style={styles.titleRow}>
            <View style={styles.iconChip}>
              <MindIcon name="breath" size={theme.fs(17)} color={mm.colors.limeMid} />
            </View>
            <Text style={styles.title}>压力恢复节律</Text>
          </View>
          <Icon name="chevronRight" size={18} color={mm.colors.inkFaint} />
        </View>

        {/* ★ 2026-11-07（用户）：只展示恢复力 —— 档位词（黄绿）+ 恢复指数 */}
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>恢复力</Text>
          <Text style={[styles.tileVal, { color: mm.colors.ringTeal }]} numberOfLines={1} adjustsFontSizeToFit>
            {dataStale ? '—' : recTag}
          </Text>
          <Text style={styles.tileSub} numberOfLines={1}>
            {dataStale ? '戒指暂无新数据' : recScore != null ? `恢复指数 ${recScore}` : '暂无 HRV 数据'}
          </Text>
        </View>

        {/* ★ 2026-11-07（用户「趋势图应是 0–100 连续分」）：当日 0–24h 恢复分连续曲线
            （HRV 相对基线比值 → 连续映射 → 平滑 + 15min 降采样；四态阶梯线已废弃） */}
        <Text style={styles.chartLabel}>今日恢复趋势</Text>
        <RecoveryDayTrendChart curve={todayCurve} dayStart={dayStartMs} height={132} />
        <AiAnalysis>
          <AiResultRow tone={recTone} title={recTag ?? '恢复力'} bodyColor={theme.colors.textBody}>
            {recAiBody}
          </AiResultRow>
        </AiAnalysis>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: mm.radius.card,
    overflow: 'hidden',
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: mm.shadow.elevation,
  },
  inner: { padding: theme.sp(2.5) },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: theme.fontSize.h1,
    height: theme.fontSize.h1,
    borderRadius: theme.radius.pill,
    backgroundColor: mm.chipBg.lime.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.sp(2),
  },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  tile: { marginTop: theme.sp(1) },
  tileLabel: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginBottom: theme.sp(0.75),
  },
  tileVal: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  tileSub: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkSoft,
    marginTop: theme.sp(0.75),
  },
  chartLabel: { fontSize: theme.fontSize.micro, color: mm.colors.inkSoft, marginTop: theme.sp(2) },
});
