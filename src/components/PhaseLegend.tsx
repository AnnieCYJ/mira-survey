/**
 * PhaseLegend —— 周期四相图例（经期 / 卵泡期 / 排卵期 / 黄体期）
 *
 * 唯一实现：体温双相曲线、激素趋势卡（雌激素 / 孕激素）、日历网格共用，
 * 保证「同一相位到处同色」且样式一致。色值取自 lib/phaseColors（token）。
 *
 * ★ 2026-10-16（用户：「两行有点多，能不能就展示一行，只展示当下的相位，其他的不展示」）：
 *   新增可选 `current` prop ——
 *   · 传 PhaseKey  → 只渲染该相位一项（单行，首页圆环下方用）；
 *   · 传 null      → 未记录，整条隐藏；
 *   · 不传         → 维持四相全量原样（体温/激素/日历等消费方零改动）。
 * ★ 2026-10-16（用户：「卵泡期能不能和元气满满、状态良好那些放在同一行」）：
 *   新增 `inline` prop —— 去掉自身 marginTop/padding，作为一项嵌进父级图例行
 *   （与相邻项的间距由父级 gap 统一给）。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { PHASE_COLOR, PHASE_LABEL, PHASE_ORDER, type PhaseKey } from '../lib/phaseColors';
import { MoonDot, type MoonStyle } from './CycleMoonPhase';

// ★ 2026-10-15：图例色块换成对应相位的月相图案（与首页圆环上的四相位月相同源）
const PHASE_MOON: Partial<Record<PhaseKey, MoonStyle>> = {
  period: 'full',
  follicular: 'quarterR',
  luteal: 'allPurple',
  ovulation: 'quarterL',
};

export default function PhaseLegend({ current, inline }: { current?: PhaseKey | null; inline?: boolean }) {
  // current 未传 → 四相全量（原行为，其他页面不受影响）
  if (current === null) return null; // 未记录：不渲染
  const items: PhaseKey[] = current ? [current] : PHASE_ORDER;
  return (
    <View style={[styles.legend, inline && styles.legendInline]}>
      {items.map((p) => (
        <View key={p} style={[styles.item, inline && styles.itemInline]}>
          <View style={styles.dot}>
            <MoonDot style={PHASE_MOON[p] ?? 'full'} size={theme.sp(2.5)} />
          </View>
          <Text style={styles.text}>{PHASE_LABEL[p]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.space.xs, paddingHorizontal: 2 },
  item: { flexDirection: 'row', alignItems: 'center', marginRight: theme.sp(3.5), marginTop: theme.sp(1) },
  // ★ inline 模式（首页与 MOODS 图例同行）：自身不带来往外边距，间距由父级 gap 统一给
  legendInline: { marginTop: 0, paddingHorizontal: 0, flexWrap: 'nowrap' },
  itemInline: { marginRight: 0, marginTop: 0 },
  dot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(0.75), marginRight: theme.sp(1.25) },
  text: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
