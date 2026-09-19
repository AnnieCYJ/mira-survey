/**
 * ConsumptionTilesCard —— 首页「今日消耗」2×2 玻璃方块卡（新增组件）
 *
 * 样式对齐用户参考稿（2×2 方圆角玻璃块）：
 *   每块 = 同色系渐变底（方圆角 squircle）+ 一圈**点状环**（strokeDasharray 点线）
 *          + 一段**进度弧**（白色圆头，长度 = 该项占比）+ 环心「大数字 + 名称」
 *          + 环下一行小字副信息
 *   四块：综合消耗 / 情绪消耗 / 脑力消耗 / 运动消耗（正好铺满 2×2）。
 *   除「综合」外三块可点击进各自详情页（EnergyDetail）。
 *
 * 数据口径与「消耗」卡 / 「消耗分析」卡完全同源：computeConsumption(ring) + fmtShare()
 *   综合 = overall（今日综合消耗率）｜情绪 = 事件数｜脑力 = 认知负荷分｜运动 = 步数
 *   副信息 = 峰值时刻 / 峰值预测 / 卡路里
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { computeConsumption, type NavType } from './ConsumptionCard';

const RING = 92;           // 环外径
const STROKE = 7;          // 环宽
const DOT_GAP = 5;         // 点线间距（dash 5）
const FULL_PEAK = 1;       // 进度弧：占比 0~1 直接映射

type Tile = {
  key: string;
  label: string;
  value: string;
  unit: string;
  sub: string;
  arc: number;                        // 0~1 进度弧
  grad: readonly [string, string];    // 渐变底（token）
  nav?: NavType;
};

function Ring({ arc }: { arc: number }) {
  const r = (RING - STROKE) / 2;
  const C = 2 * Math.PI * r;
  const len = Math.max(1, Math.min(FULL_PEAK, arc) * C);
  return (
    <Svg width={RING} height={RING}>
      {/* 点状底环 */}
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke={theme.colors.textWhite}
        strokeOpacity={0.42}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`1.5 ${DOT_GAP}`}
        fill="none"
      />
      {/* 进度弧（白色圆头） */}
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke={theme.colors.textWhite}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
        fill="none"
        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
      />
    </Svg>
  );
}

export default function ConsumptionTilesCard({
  ring,
  onNav,
}: {
  ring: any;
  onNav?: (type: NavType) => void;
}) {
  const { segs, overall } = useMemo(() => computeConsumption(ring), [ring]);

  const tiles: Tile[] = useMemo(() => {
    const [emo, brain, sport] = segs;
    const out: Tile[] = [
      {
        key: 'overall',
        label: '综合消耗',
        value: overall != null ? `${overall}` : '—',
        unit: overall != null ? '%' : '',
        sub: overall != null ? '今日整体消耗' : '佩戴后生成',
        arc: overall != null ? overall / 100 : 0,
        grad: [theme.colors.accentSolid, theme.colors.accent1],
      },
    ];
    if (emo) out.push({ key: emo.key, label: emo.label, value: emo.value, unit: emo.unit, sub: emo.sub, arc: emo.share, grad: [theme.colors.stateTense, theme.colors.celebrateGrad[0]], nav: emo.nav });
    if (brain) out.push({ key: brain.key, label: brain.label, value: brain.value, unit: brain.unit, sub: brain.sub, arc: brain.share, grad: [theme.colors.accent2, theme.colors.bgTop], nav: brain.nav });
    if (sport) out.push({ key: sport.key, label: sport.label, value: sport.value, unit: sport.unit, sub: sport.sub, arc: sport.share, grad: [theme.colors.stateCalm, theme.colors.accent2], nav: sport.nav });
    return out;
  }, [segs, overall]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>今日消耗</Text>
        <Text style={styles.hint}>点按进入详情</Text>
      </View>

      <View style={styles.grid}>
        {tiles.map((t) => {
          const box = (
            <View style={styles.tile}>
              <LinearGradient
                colors={[...t.grad] as unknown as string[]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.tileBody}>
                <View style={styles.ringBox}>
                  <Ring arc={t.arc} />
                  {/* 环心：大数字 + 名称 */}
                  <View style={styles.ringCenter} pointerEvents="none">
                    <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                      {t.value}
                      <Text style={styles.unit}>{t.unit}</Text>
                    </Text>
                    <Text style={styles.label} numberOfLines={1}>{t.label}</Text>
                  </View>
                </View>
                <Text style={styles.sub} numberOfLines={1}>{t.sub}</Text>
              </View>
            </View>
          );
          if (!t.nav) return <View key={t.key} style={styles.cell}>{box}</View>;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.cell}
              activeOpacity={0.88}
              disabled={!onNav}
              onPress={() => onNav?.(t.nav!)}
              accessibilityRole="button"
              accessibilityLabel={`${t.label} ${t.value}${t.unit}`}
            >
              {box}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.md,
    ...theme.shadow.card,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space.sm },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textTitle,
  },
  hint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp(3) },
  // ★ 单元格宽度必须留出间距：卡内宽 262pt、间距 12pt → 每格 (262-12)/2 ≈ 47.6%，
  //   写 48% 会变成 96%+12pt > 100% → flexWrap 把 2×2 挤成一列（已在预览中验证）
  cell: { width: '47%' },
  tile: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  tileBody: { paddingVertical: theme.sp(3), paddingHorizontal: theme.sp(2), alignItems: 'center' },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.sp(1) },
  value: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.bold,
    color: theme.colors.textWhite,
  },
  unit: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  label: {
    fontSize: theme.fs(10),
    color: theme.colors.textWhite80,
    marginTop: theme.sp(0.25),
  },
  sub: {
    fontSize: theme.fs(10),
    color: theme.colors.textWhite80,
    marginTop: theme.sp(1.5),
  },
});
