import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import Card from './Card';
import { formatClockTime } from '../utils/format';
import type { BasicMetricDef } from '../data/metrics';

/**
 * 纯手动测量类信号卡片（血糖 / 血脂 / 血压 / 梅脱 / ECG / PPG / 压力）。
 * 与 BasicMetricCard 视觉同源、共用 design token，但做减法：
 *  - 去掉趋势图（此类信号无自动数据流，趋势恒为空）
 *  - 数值在左、测量时间在右（带「测量时间」标签）——一眼确认测量是否成功
 *  - 测量按钮全宽置底
 */
interface Props {
  metric: BasicMetricDef;
  /** 是否已收到真实测量值（决定状态标签与按钮文案） */
  live: boolean;
  /** 当前数值（真实值或占位「—」） */
  value: string;
  /** 最近一次测量的时间戳（epoch ms）；用于显示在数值右侧，确认测量成功 */
  measureTime: number | null;
  /** 手动测量回调 */
  onMeasure: () => void;
  /** 点击卡片进入「指标历史详情」全屏页 */
  onPress?: () => void;
}

export default function ManualMetricCard({ metric, live, value, measureTime, onMeasure, onPress }: Props) {
  const [measuring, setMeasuring] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // 一旦真实测量值回传（live 翻 true），立即结束「测量中」过渡，按钮切回「重新测量」。
  useEffect(() => {
    if (live && measuring) setMeasuring(false);
  }, [live, measuring]);

  // 注意：本地测量处理函数命名为 onPressMeasure，避免遮蔽同名导航 prop onPress。
  const onPressMeasure = () => {
    if (measuring) return;
    setMeasuring(true);
    onMeasure();
    // 当前为「安全重读设备历史」，通常数秒内完成；给一个 6s 安全窗防连点，
    // 真实成功会被上面的 live 监听提前结束。
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMeasuring(false), 6000);
  };

  const showHint = !live && !measuring && metric.manualHint;

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.92 : 1} onPress={onPress} disabled={!onPress}>
      <Card>
      {/* 顶部：名称 + 状态标签（无按钮，按钮统一置底） */}
      <View style={styles.top}>
        <Text style={styles.name}>{metric.name}</Text>
        <View style={[styles.tag, live ? styles.tagLive : styles.tagOff]}>
          <Text style={[styles.tagText, live ? styles.tagTextLive : styles.tagTextOff]}>
            {live ? '已测量' : '待测量'}
          </Text>
        </View>
      </View>

      {/* 主区：数值 + 单位（左）｜测量时间（右，带标签） */}
      <View style={styles.mainRow}>
        <View style={styles.valueBox}>
          <Text style={styles.val}>{value}</Text>
          <Text style={styles.unit}>{metric.unit}</Text>
        </View>
        <View style={styles.timeBox}>
          <Text style={styles.timeLabel}>测量时间</Text>
          <Text style={[styles.timeValue, !live && styles.timeValueIdle]}>
            {formatClockTime(measureTime)}
          </Text>
        </View>
      </View>

      <Text style={styles.range}>{metric.range}</Text>

      <Text style={styles.note}>{metric.note}</Text>

      {showHint ? (
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{metric.manualHint}</Text>
        </View>
      ) : null}

      {/* 测量按钮：全宽置底 */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPressMeasure}
        style={[styles.btn, measuring && styles.btnBusy]}
      >
        <Text style={[styles.btnLabel, measuring && styles.btnLabelBusy]}>
          {measuring ? '测量中…' : live ? '重新测量' : '手动测量'}
        </Text>
      </TouchableOpacity>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp(3),
  },
  name: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  tag: {
    paddingHorizontal: theme.sp(2),
    paddingVertical: theme.sp(0.5),
    borderRadius: theme.radius.pill,
  },
  tagLive: { backgroundColor: theme.colors.successSoft },
  tagOff: { backgroundColor: theme.colors.ui.offTrack },
  tagText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
  },
  tagTextLive: { color: theme.colors.success },
  tagTextOff: { color: theme.colors.textSub },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  valueBox: { flexDirection: 'row', alignItems: 'baseline' },
  val: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  unit: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  timeBox: { alignItems: 'flex-end' },
  timeLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.sp(0.5),
  },
  timeValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  timeValueIdle: { color: theme.colors.textSub },
  range: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
    marginBottom: theme.space.sm,
  },
  note: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginBottom: theme.space.md,
  },
  hintBox: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
    marginBottom: theme.space.md,
  },
  hintText: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.6,
    color: theme.colors.textSub,
  },
  btn: {
    marginTop: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    paddingVertical: theme.space.sm,
    alignItems: 'center',
  },
  btnBusy: { backgroundColor: theme.colors.ui.offTrack },
  btnLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  btnLabelBusy: { color: theme.colors.textSub },
});
