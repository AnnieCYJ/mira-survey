/**
 * AxisLabels —— 详情页统一的 X 轴刻度渲染（2026-11-05）
 *
 * ★ 用户实锤「很多指标横坐标不是被遮挡了，就是裁掉了」「20 点跟 24 点都重合在一起了」。
 *   旧实现把每个数据点一个 Text 用 `flexDirection:'row' + justifyContent:'space-between'`
 *   排成一行，有三个硬伤：
 *     ① 末标签右端贴着容器边缘 → 被卡片圆角 / overflow 裁掉；
 *     ② 月视图 31 槽、日视图 288 槽时，每个 Text 分到的宽度远小于文字本身 →
 *        换行、截断、相邻标签互相压住；
 *     ③ 空标签（不显示的刻度）仍然占位，把可见标签挤得与对应柱子错位。
 *
 * 现实现：**只渲染可见标签**，按数据点索引比例绝对定位并 clamp 到容器内；
 * 盒宽按标签实际字数自适应（不再固定 46px）；渲染前做一次**防重叠过滤**——
 * 与上一个已保留标签相交就跳过中间标签，但首尾两个端点永远保留。
 * 这样窄屏下宁可少标几个中间刻度，也不会出现两个时间叠在一起。
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { theme } from '../../theme/theme';

interface Props {
  /** 全部标签（长度 = 数据点数）；空串自动跳过 */
  labels: string[];
  /** 该位置是否应显示（不传则全部显示） */
  visible?: (label: string, index: number) => boolean;
  /**
   * 定位模式：
   *  - 'slot'（默认）= 柱状图，刻度落在第 i 个槽中心 (i+0.5)/n
   *  - 'edge' = 均匀刻度线轴（如 0/6/12/18/24），刻度落在 i/(n-1)，首末贴绘图区两端
   */
  mode?: 'slot' | 'edge';
  /** 左侧留白（与图表 Y 轴刻度列宽对齐，实际 px） */
  padLeft?: number;
  /** 右侧留白（与图表绘图区右边距对齐，实际 px） */
  padRight?: number;
  /** 单个标签盒宽上限，默认 46（实际按字数取小值） */
  boxWidth?: number;
}

interface Candidate {
  key: string;
  text: string;
  left: number;
  box: number;
}

export default function AxisLabels({
  labels,
  visible,
  mode = 'slot',
  padLeft = 0,
  padRight = 0,
  boxWidth = 46,
}: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const plotW = Math.max(0, w - padLeft - padRight);
  const n = labels.length;
  const fontSize = theme.fontSize.micro;

  // 1) 收集所有应显示的标签，按真实字数算盒宽、按槽位比例定位并 clamp
  const candidates: Candidate[] = [];
  labels.forEach((t, i) => {
    if (!t) return;
    if (visible && !visible(t, i)) return;
    const frac = n <= 1 ? 0.5 : mode === 'edge' ? i / (n - 1) : (i + 0.5) / n;
    const center = padLeft + plotW * frac;
    const box = Math.max(22, Math.min(boxWidth, t.length * fontSize * 0.62 + 10));
    const left = Math.max(0, Math.min(Math.max(0, w - box), center - box / 2));
    candidates.push({ key: `${t}-${i}`, text: t, left, box });
  });

  // 2) 防重叠：与上一个已保留标签相交则跳过；但最后一个标签永远保留
  //    （若与上一个冲突，替换掉上一个 —— 端点比中间刻度更重要）
  const kept: Candidate[] = [];
  candidates.forEach((c, idx) => {
    const isLast = idx === candidates.length - 1;
    const prev = kept[kept.length - 1];
    if (prev && c.left < prev.left + prev.box + 2) {
      if (isLast) kept[kept.length - 1] = c;
      return;
    }
    kept.push(c);
  });

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {w > 0 && kept.map((c) => (
        <Text key={c.key} numberOfLines={1} style={[styles.label, { left: c.left, width: c.box }]}>
          {c.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 20, position: 'relative', marginTop: 6 },
  label: {
    position: 'absolute',
    top: 0,
    textAlign: 'center',
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
  },
});
