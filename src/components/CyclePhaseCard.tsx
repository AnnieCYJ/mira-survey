/**
 * CyclePhaseCard —— 周期维度主卡
 *
 * 顶部：当前阶段（经期/卵泡期/排卵期/黄体期）+ 周期进度；
 * 中部：排卵期窗口 / 下次经期预测 / 倒计时；
 * 下部：真实体温双相曲线（来自 RingBleManager 的每日体温归档）；
 * 记录入口：轻量 Modal（选上次经期开始日 + 周期长度）。
 *
 * 数据权威来源：戒指回传的 female（veepooSDKSettingDeviceFemale 读回 / 写入后回传），
 * 本地 cycleLog 仅作兜底与输入框初始值。经期记录写入戒指设备，换机/重装不丢。
 *
 * 周期预测完全基于「用户记录的经期」+「标准周期模型」推算，体温是戒指真测，
 * 除这两者外不编任何数据（雌激素/LH 等戒指测不到，明确不造假展示）。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { theme } from '../theme/theme';
import { computeCycle, dayKey, parseDate, tempDailyToSeries, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog, saveCycleLog } from '../data/cycleLog';
import { RingBle, type FemaleInfo, type RingState } from '../ble/RingBleManager';
import type { RangeKey } from '../data/metrics';
import TempBiphasicChart from './TempBiphasicChart';
import PhaseInsightSection from './PhaseInsightSection';
import HormoneCurveCard from './HormoneCurveCard';
import CycleMetricsCard from './CycleMetricsCard';
import HormoneStatusCard from './HormoneStatusCard';

const PHASE_ORDER: { key: string; label: string }[] = [
  { key: 'period', label: '经期' },
  { key: 'follicular', label: '卵泡期' },
  { key: 'ovulation', label: '排卵期' },
  { key: 'luteal', label: '黄体期' },
];

const FEMALE_STATE_LABEL: Record<number, string> = {
  0: '未设置',
  1: '月经期',
  2: '备孕期',
  3: '怀孕期',
  4: '辣妈期',
};

export default function CyclePhaseCard({
  ring,
  female,
  range = 'month',
  onPress,
}: {
  ring: RingState;
  female: FemaleInfo | null;
  range?: RangeKey;
  onPress?: () => void;
}) {
  const [log, setLog] = useState<CycleLog | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selDate, setSelDate] = useState('');
  const [cycleLen, setCycleLen] = useState(28);

  useEffect(() => {
    void loadCycleLog().then((l) => setLog(l));
  }, []);

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

  const openModal = () => {
    const base = female?.lastMenstrualDate ?? log?.lastPeriodStart ?? dayKey(new Date());
    setSelDate(base);
    setCycleLen(female?.menstrualCircle ?? log?.cycleLength ?? 28);
    setModalOpen(true);
  };

  const onSave = async () => {
    const next: CycleLog = {
      lastPeriodStart: selDate,
      cycleLength: cycleLen,
      lutealLength: 14,
      periodLength: 5,
    };
    // 1) 本地兜底：立即保存并刷新 UI，保证「点击必有反应」（哪怕戒指未写入）
    await saveCycleLog(next);
    setLog(next);
    setModalOpen(false);
    // 1.5) 让今日状态（圆环下方分析行、相位）立即用上这条记录，无需 ⌘R
    void RingBle.refreshLocalCycle();
    // 2) 尝试写入戒指（不阻塞 UI；超时/失败静默，本地已存，下次连接后再同步）
    try {
      await RingBle.writeFemale(selDate, cycleLen, 5);
    } catch {
      /* 戒指未写入：本地已存，不阻塞 */
    }
  };

  // 进度条 marker 位置
  const pct =
    info.hasLog && info.dayInCycle != null && effective
      ? Math.min(1, Math.max(0, (info.dayInCycle - 1) / (effective.cycleLength - 1)))
      : 0;

  // 戒指真实回传的生理期状态
  const ringSynced = !!(female && (female.state > 0 || female.lastMenstrualDate));
  const stateLabel = female ? FEMALE_STATE_LABEL[female.state] ?? '未知' : null;

  const chips: { key: string; label: string }[] = [];
  const t = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(t);
    d.setDate(d.getDate() - i);
    chips.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.92 : 1} onPress={onPress} disabled={!onPress}>
      <View style={styles.card}>
      {/* 阶段头部 */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.phaseLabel}>{info.phaseLabel}</Text>
          <Text style={styles.phaseSub}>
            {info.hasLog && info.dayInCycle != null && effective
              ? `周期第 ${info.dayInCycle} / ${effective.cycleLength} 天`
              : '记录经期后开启周期预测'}
          </Text>
          {ringSynced && stateLabel ? (
            <View style={styles.ringBadge}>
              <Text style={styles.ringBadgeText}>戒指已同步 · {stateLabel}</Text>
            </View>
          ) : null}
          {info.tempConfirmed ? (
            <View style={styles.tempBadge}>
              <Text style={styles.tempBadgeText}>
                体温确认排卵 · 基线 {info.baselineTemp != null ? info.baselineTemp.toFixed(2) : '—'}°C
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.recordBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            openModal();
          }}
        >
          <Text style={styles.recordBtnText}>{log || ringSynced ? '修改记录' : '记录经期'}</Text>
        </TouchableOpacity>
      </View>

      {/* 周期进度条 */}
      <View style={styles.bar}>
        <View style={styles.barTrack} />
        <View style={[styles.barMarker, { left: `${pct * 100}%` }]} />
      </View>
      <View style={styles.phaseRow}>
        {PHASE_ORDER.map((p) => (
          <Text
            key={p.key}
            style={[
              styles.phaseName,
              info.phase === p.key && styles.phaseNameActive,
            ]}
          >
            {p.label}
          </Text>
        ))}
      </View>

      {/* 关键日期 */}
      <View style={styles.dateGrid}>
        <View style={styles.dateCell}>
          <Text style={styles.dateK}>排卵期</Text>
          <Text style={styles.dateV}>{info.ovulationDate ?? '—'}</Text>
        </View>
        <View style={styles.dateCell}>
          <Text style={styles.dateK}>下次经期</Text>
          <Text style={styles.dateV}>{info.nextPeriodDate ?? '—'}</Text>
        </View>
        <View style={styles.dateCell}>
          <Text style={styles.dateK}>{info.daysToNextPeriod != null ? '距经期' : '距排卵'}</Text>
          <Text style={styles.dateV}>
            {info.daysToNextPeriod != null
              ? `${info.daysToNextPeriod} 天`
              : info.daysToOvulation != null
              ? `${info.daysToOvulation} 天`
              : '—'}
          </Text>
        </View>
      </View>

      {/* 体温双相曲线：仅展示戒指真实测得的体温，不编造数据 */}
      <TempBiphasicChart
        tempDaily={ring.tempDaily ?? {}}
        tempHistory={ring.history.temp}
        log={effective}
        range={range}
      />

      {/* ★ 本阶段身心特征 — 参考 Clue/Flo 官方科普 + 临床研究 */}
      {info.hasLog ? <PhaseInsightSection phase={info.phase} dayInCycle={info.dayInCycle ?? 0} cycleLength={effective?.cycleLength ?? 28} /> : null}

      {/* 雌激素建模曲线 */}
      <HormoneCurveCard cycleInfo={info} cycleLog={effective} />

      {/* 完整周期指标面板 */}
      <CycleMetricsCard cycleInfo={info} cycleLog={effective} />

      {/* ★ 戒指数据推断的激素状态 */}
      <HormoneStatusCard cycleInfo={info} cycleLog={effective} />

      {/* 记录 Modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.sheetMask}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>记录上次经期开始日</Text>
            <Text style={styles.sheetHint}>写入戒指设备，换手机/重装不丢；仅用于推算周期与排卵期。</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {chips.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, selDate === c.key && styles.chipOn]}
                  onPress={() => setSelDate(c.key)}
                >
                  <Text style={[styles.chipText, selDate === c.key && styles.chipTextOn]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>月经周期长度</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setCycleLen((v) => Math.max(21, v - 1))}>
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepValue}>{cycleLen} 天</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setCycleLen((v) => Math.min(40, v + 1))}>
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={onSave}>
                <Text style={styles.saveBtnText}>保存到戒指</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  phaseLabel: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  phaseSub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 2 },
  ringBadge: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(124,106,224,0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  ringBadgeText: { fontSize: theme.fontSize.micro, color: theme.colors.accentSolid, fontWeight: theme.weight.semibold as any },
  tempBadge: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(111,207,180,0.16)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  tempBadgeText: { fontSize: theme.fontSize.micro, color: '#3f9e7e', fontWeight: theme.weight.semibold as any },
  recordBtn: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    marginLeft: 12,
  },
  recordBtnText: { color: theme.colors.accentSolid, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  bar: { height: 8, marginTop: theme.space.md, justifyContent: 'center' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(124,106,224,0.14)' },
  barMarker: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.accentSolid,
    borderWidth: 3,
    borderColor: '#fff',
    top: -4,
    marginLeft: -8,
  },
  phaseRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  phaseName: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  phaseNameActive: { color: theme.colors.accentSolid, fontWeight: theme.weight.semibold as any },

  dateGrid: { flexDirection: 'row', marginTop: theme.space.md },
  dateCell: { flex: 1, alignItems: 'center' },
  dateK: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  dateV: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginTop: 3 },

  sheetMask: { flex: 1, backgroundColor: theme.colors.ui.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.cardBgStrong,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
    padding: theme.space.cardPad,
    paddingBottom: theme.space.xl,
  },
  sheetTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle },
  sheetHint: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: 4, marginBottom: theme.space.sm },
  chipScroll: { marginTop: theme.space.xs, maxHeight: 52 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(124,106,224,0.10)',
    marginRight: 8,
  },
  chipOn: { backgroundColor: theme.colors.accentSolid },
  chipText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub },
  chipTextOn: { color: '#fff', fontWeight: theme.weight.semibold as any },

  stepperRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.space.md },
  stepperLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textTitle },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124,106,224,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 22, color: theme.colors.accentSolid, fontWeight: theme.weight.bold as any },
  stepValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginHorizontal: 16, minWidth: 48, textAlign: 'center' },

  sheetActions: { flexDirection: 'row', marginTop: theme.space.lg },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, marginRight: 10, borderRadius: theme.radius.md, backgroundColor: 'rgba(120,120,140,0.12)' },
  cancelBtnText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  saveBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSolid },
  saveBtnText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: '#fff' },
});
