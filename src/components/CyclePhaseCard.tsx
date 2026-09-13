/**
 * CyclePhaseCard —— 周期维度主卡（洞察「生理」tab）
 *
 * 顶部：记录经期入口（上次经期 + 修改按钮）
 * 主体：**月相 Hero**（CycleMoonPhase，与周期日历页顶部同一组件/同一套画法：
 *       中央月相 + 外围月相环 + 相位文字 + 距下次经期）
 * 其下：关键日期（排卵期 / 下次经期 / 距经期）→ 状态徽章 → 阶段科普 → 激素曲线 → 指标面板。
 *
 * ★ 原先的「相位大字 + 进度条 + 4 个相位名」三行已由月相环取代；
 *   体温双相曲线已移除（体温双相监测现在是周期日历页的独立卡片，带 AI 解读，此处不重复）。
 *
 * 数据权威来源：戒指回传的 female（veepooSDKSettingDeviceFemale 读回 / 写入后回传），
 * 本地 cycleLog 仅作兜底与输入框初始值。经期记录写入戒指设备，换机/重装不丢。
 *
 * 周期预测完全基于「用户记录的经期」+「标准周期模型」推算，体温是戒指真测，
 * 除这两者外不编任何数据（雌激素/LH 等戒指测不到，明确不造假展示）。
 */
import React, { useEffect, useState } from 'react';
import { Dimensions, View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { computeCycle, parseDate, tempDailyToSeries, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog } from '../data/cycleLog';
import { type FemaleInfo, type RingState } from '../ble/RingBleManager';
import CycleMoonPhase from './CycleMoonPhase';
import PhaseInsightSection from './PhaseInsightSection';
import HormoneDualTrend from './HormoneDualTrend';
import PeriodRecordPanel from './PeriodRecordPanel';

const FEMALE_STATE_LABEL: Record<number, string> = {
  0: '未设置',
  1: '月经期',
  2: '备孕期',
  3: '怀孕期',
  4: '辣妈期',
};

/** 把 'YYYY-MM-DD' 压缩为 'M/D'（如 2026-09-02 → 9/2），避免窄列里被截断 */
function shortDate(s: string | null | undefined): string {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${Number(m)}/${Number(d)}`;
}

export default function CyclePhaseCard({
  ring,
  female,
  onPress,
}: {
  ring: RingState;
  female: FemaleInfo | null;
  onPress?: () => void;
}) {
  const [log, setLog] = useState<CycleLog | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadCycleLog().then((l) => setLog(l));
  }, []);

  // 面板保存后：重载本地经期主记录，刷新月相环相位 / 关键日期
  const handleSaved = () => {
    void loadCycleLog().then((l) => setLog(l));
  };

  // 经期数据来源合并：本地 log + 戒指 female，用 lastPeriodStart 更晚的那条。
  // 原因：戒指 female 可能是旧数据/未同步成功；用户在本 App 内刚输入的记录更可能是真值。
  const ringLog: CycleLog | null =
    female && female.menstrualCircle > 0 && female.lastMenstrualDate
      ? {
          lastPeriodStart: female.lastMenstrualDate,
          cycleLength: female.menstrualCircle,
          lutealLength: 14,
          periodLength: female.menstrualDays || 5,
        }
      : null;

  const effective: CycleLog | null = (() => {
    if (!log && !ringLog) return null;
    if (!ringLog) return log;
    if (!log) return ringLog;
    return parseDate(ringLog.lastPeriodStart).getTime() >= parseDate(log.lastPeriodStart).getTime()
      ? ringLog
      : log;
  })();

  const info = computeCycle(effective, new Date(), {
    tempSeries: tempDailyToSeries(ring.tempDaily ?? {}),
    periodHistory: effective?.history,
  });

  // 戒指真实回传的生理期状态
  const ringSynced = !!(female && (female.state > 0 || female.lastMenstrualDate));
  const stateLabel = female ? FEMALE_STATE_LABEL[female.state] ?? '未知' : null;

  // 月相环尺寸：卡片内可用宽度 = 屏宽 − 屏幕左右留白(space.screen) − 卡片内边距(cardPad×2)。
  // 留出少量呼吸空间并封顶 300，避免在较窄屏幕/横屏下溢出卡片。
  const ringSize = Math.min(Math.round(Dimensions.get('window').width - theme.space.screen * 2 - theme.space.cardPad * 2 - 16), 300);

  return (
    <TouchableOpacity
      activeOpacity={onPress && !expanded ? 0.92 : 1}
      onPress={expanded ? undefined : onPress}
      disabled={expanded || !onPress}
    >
      <View style={styles.card}>
      {/* ★ 月相 Hero：与周期日历页顶部同一组件——相位 / 第几天 / 距下次经期由月相环表达。
          尺寸按「卡片实际可用宽度」收窄（默认按屏宽算会溢出卡片内边距）。 */}
      <CycleMoonPhase cycleInfo={info} log={effective} size={ringSize} height={Math.round(ringSize * 0.8)} />

      {/* ★ 经期记录入口：月相环下方居中；点击内联展开日期 + 症状记录面板 */}
      <View style={styles.recordCenter}>
        <Text style={styles.recordHint}>
          {effective?.lastPeriodStart ? `上次经期 ${effective.lastPeriodStart}` : '还没有经期记录'}
        </Text>
        <TouchableOpacity
          style={styles.recordBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            setExpanded(true);
          }}
        >
          <Text style={styles.recordBtnText}>
            {effective ? '记录 / 修改' : '记录经期'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ★ 经期记录：从底部弹起的 Sheet */}
      <Modal visible={expanded} transparent animationType="slide" onRequestClose={() => setExpanded(false)}>
        <TouchableOpacity style={styles.sheetMask} activeOpacity={1} onPress={() => setExpanded(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>经期记录</Text>
              <TouchableOpacity style={styles.sheetClose} onPress={() => setExpanded(false)}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetBody}>
              <PeriodRecordPanel
                female={female}
                currentLog={effective}
                onSaved={() => {
                  handleSaved();
                  setExpanded(false);
                }}
              />
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 关键日期 */}
      <View style={styles.dateGrid}>
        <View style={styles.dateCell}>
          <Text style={styles.dateK}>排卵期</Text>
          <Text style={styles.dateV} numberOfLines={1} ellipsizeMode="tail">{shortDate(info.ovulationDate)}</Text>
        </View>
        <View style={[styles.dateCell, styles.dateDivider]}>
          <Text style={styles.dateK}>下次经期</Text>
          <Text style={styles.dateV} numberOfLines={1} ellipsizeMode="tail">{shortDate(info.nextPeriodDate)}</Text>
        </View>
        <View style={[styles.dateCell, styles.dateDivider]}>
          <Text style={styles.dateK}>{info.daysToNextPeriod != null ? '距经期' : '距排卵'}</Text>
          <Text style={styles.dateV} numberOfLines={1} ellipsizeMode="tail">
            {info.daysToNextPeriod != null
              ? `${info.daysToNextPeriod} 天`
              : info.daysToOvulation != null
              ? `${info.daysToOvulation} 天`
              : '—'}
          </Text>
        </View>
      </View>

      {/* 数据来源徽章 */}
      {ringSynced && stateLabel ? (
        <View style={styles.badgeRow}>
          <View style={styles.ringBadge}>
            <Text style={styles.ringBadgeText}>戒指已同步 · {stateLabel}</Text>
          </View>
          {info.tempConfirmed ? (
            <View style={styles.tempBadge}>
              <Text style={styles.tempBadgeText}>
                体温确认排卵 · 基线 {info.baselineTemp != null ? info.baselineTemp.toFixed(2) : '—'}°C
              </Text>
            </View>
          ) : null}
        </View>
      ) : info.tempConfirmed ? (
        <View style={styles.badgeRow}>
          <View style={styles.tempBadge}>
            <Text style={styles.tempBadgeText}>
              体温确认排卵 · 基线 {info.baselineTemp != null ? info.baselineTemp.toFixed(2) : '—'}°C
            </Text>
          </View>
        </View>
      ) : null}

      {/* ★ 雌激素 + 孕激素 双相趋势（近 30 天，真实数据推算），置于「精力回升」分析之上 */}
      <HormoneDualTrend ring={ring} cycleInfo={info} log={effective} />

      {/* ★ 本阶段身心特征（AI 分析外壳）— 参考 Clue/Flo 官方科普 + 临床研究 */}
      {info.hasLog ? (
        <PhaseInsightSection phase={info.phase} dayInCycle={info.dayInCycle ?? 0} ring={ring} cycleInfo={info} />
      ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  recordCenter: {
    alignItems: 'center',
    paddingTop: theme.space.xs,
    marginTop: -theme.space.xs,
  },
  recordHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.space.xs },
  recordBtn: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
  },
  recordBtnText: { color: theme.colors.accentSolid, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  ringBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
  },
  ringBadgeText: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid, fontWeight: theme.weight.semibold as any },
  tempBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.successSoft,
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
  },
  tempBadgeText: { fontSize: theme.fontSize.micro, color: theme.colors.ui.successText, fontWeight: theme.weight.semibold as any },

  dateGrid: {
    flexDirection: 'row',
    marginTop: theme.space.md,
    backgroundColor: theme.colors.cardBgSoft,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
  },
  dateCell: { flex: 1, alignItems: 'center', paddingHorizontal: theme.sp(2) },
  dateDivider: { borderLeftWidth: 1, borderLeftColor: theme.colors.cardBorder2 },
  dateK: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  dateV: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold as any,
    color: theme.colors.textTitle,
    marginTop: theme.sp(0.75),
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, marginTop: theme.space.sm },

  /* 底部弹起 Sheet */
  sheetMask: { flex: 1, backgroundColor: theme.colors.ui.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.cardBgStrong,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    maxHeight: '88%',
    paddingBottom: theme.space.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.cardBorder2,
    alignSelf: 'center',
    marginTop: theme.space.sm,
    marginBottom: theme.space.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.cardPad,
    paddingBottom: theme.space.xs,
  },
  sheetTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sheetClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.cardBgSoft,
  },
  sheetCloseText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  sheetBody: { paddingHorizontal: theme.space.cardPad, marginTop: theme.space.xs },
});
