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
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { computeCycle, parseDate, tempDailyToSeries, type CycleLog } from '../lib/cycleMath';
import { loadCycleLog, loadPeriodDays, type PeriodDayLog } from '../data/cycleLog';
import { type FemaleInfo, type RingState } from '../ble/RingBleManager';
import CycleMoonPhase from './CycleMoonPhase';
import Icon from './Icon';
import PhaseInsightSection from './PhaseInsightSection';
import PeriodRecordPanel from './PeriodRecordPanel';
// ★ 2026-10-07（用户：洞察页「生理周期节律」卡片里也加个 AI 分析，同样三行以内）
import AiAnalysis, { AiResultRow } from './AiAnalysis';
// ★ 2026-10-12（用户：「雌激素孕激素不要写文字，就画趋势图」）：
//   恢复 HormoneDualTrend 双相趋势图，以 embedded 模式嵌入本卡（AI 分析上方）。
import HormoneDualTrend from './HormoneDualTrend';

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

/** ★ 2026-10-07（用户：「雌孕激素下面的 AI 分析去掉」）：先隐藏整块「本阶段身心特征」
 *  （AI 分析结论行 + ● 建议）。代码保留，改回 true 即恢复。 */
const SHOW_PHASE_INSIGHT: boolean = false;

/** ★ 2026-10-07（用户：洞察页「生理周期节律」卡片里面也加个 AI 分析，三行以内）：
 *  只做相位层面的解读（戒指测不到雌激素/孕酮浓度，绝不编造具体激素值）。
 *  ★ 2026-10-12（用户：「下面的 AI 分析，内容可以稍微多一点」）：每相扩为两句——
 *  第一句讲当前身体处于什么状态，第二句给一个具体可做的建议，仍控制在三行以内。
 *  依据：Clue 生理科普 + ACSM 运动与周期指南。 */
const PHASE_BRIEF: Record<string, { name: string; tone: 'good' | 'warn' | 'neutral'; body: string }> = {
  period: {
    name: '经期',
    tone: 'warn',
    body: '雌激素与孕酮处于低位，身体进入恢复模式，能量与运动表现偏低，也更容易累。建议降低训练强度、多做拉伸和散步，注意保暖，睡前少看屏幕、把睡眠补足。',
  },
  follicular: {
    name: '卵泡期',
    tone: 'good',
    body: '雌激素逐步回升、HRV 上升，精力与情绪持续变好，恢复能力增强。适合安排高强度训练、重要任务与新的计划，想启动的习惯放在这时候最容易坚持。',
  },
  ovulation: {
    name: '排卵期',
    tone: 'good',
    body: '雌激素达峰值、状态最佳，是运动与决策的黄金窗口，反应和耐力都在线。想冲力量 PR 或处理难任务就选这两天，同时处于易孕期，如有避孕或备孕计划需注意时间安排。',
  },
  luteal: {
    name: '黄体期',
    tone: 'warn',
    body: '孕酮主导、体温升高，能量回落、恢复变慢，PMS 症状较易出现，别用前两周的标准要求自己。建议把高强度换成中等强度有氧，控制糖盐摄入，保证睡眠，重要决定尽量避开经前一周。',
  },
};

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
  const [periodDays, setPeriodDays] = useState<Record<string, PeriodDayLog>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadCycleLog().then((l) => setLog(l));
    void loadPeriodDays().then((pd) => setPeriodDays(pd));
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
    periodDays,
  });

  // 戒指真实回传的生理期状态
  const ringSynced = !!(female && (female.state > 0 || female.lastMenstrualDate));
  const stateLabel = female ? FEMALE_STATE_LABEL[female.state] ?? '未知' : null;

  // 月相环尺寸：卡片内可用宽度 = 屏宽 − 屏幕左右留白(space.screen) − 卡片内边距(cardPad×2)。
  // ★ 2026-10-12（用户：「月相圆环小一点」）：封顶由 300 收到 220，整体明显缩小但仍清晰。
  const ringSize = Math.min(Math.round(Dimensions.get('window').width - theme.space.screen * 2 - theme.space.cardPad * 2 - 16), 220);

  // ★ 2026-10-07：相位解读（三行以内）—— 无记录/未知相位时为 null，走引导文案
  const phaseBrief = PHASE_BRIEF[info.phase] ?? null;

  return (
    <TouchableOpacity
      activeOpacity={onPress && !expanded ? theme.press.opacity : 1}
      onPress={expanded ? undefined : onPress}
      disabled={expanded || !onPress}
    >
      <View style={styles.card}>
      {/* ★ 月相 Hero：与周期日历页顶部同一组件——相位 / 第几天 / 距下次经期由月相环表达。
          尺寸按「卡片实际可用宽度」收窄（默认按屏宽算会溢出卡片内边距）。
          ★ 2026-10-12（用户：环缩小后「里面的字小一点」）：compact 模式，中央文字降一档。 */}
      <CycleMoonPhase cycleInfo={info} log={effective} size={ringSize} compact />
      {/* ★ 2026-10-07（用户：洞察页「生理周期节律」卡片右上角加一个向右的箭头，表示可以点击） */}
      <View style={styles.cardChevron} pointerEvents="none">
        <Icon name="chevronRight" size={18} color={mm.colors.inkFaint} />
      </View>

      {/* ★ 2026-10-07（用户：「记录与修改」的按钮放在点击之后的经期详情页，就是那个圆环的下面）：
          月相环下方的「记录 / 修改」入口已整体移走 —— 记录入口统一放在经期详情页
          （screens/CycleCalendarScreen）的月相环正下方，本卡只保留月相 + 关键日期概览。
          注：下方 Modal Sheet（expanded / PeriodRecordPanel）代码保留，日后要恢复卡片入口，
          把上面这段 JSX 放回来即可。 */}

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

      {/* ★ 2026-10-12（用户：「雌激素孕激素不要写文字，就画趋势图」+「只展示雌激素，孕激素先不展示」）：
          置于 AI 分析上方；embedded 嵌入本卡（无独立外壳），onlyEstrogen 只画雌激素一条线
          （HRV·EDA 推算，戒指不直接测量激素，组件标题右侧自带「推算 · 非实测」口径）。 */}
      <HormoneDualTrend embedded onlyEstrogen ring={ring} cycleInfo={info} log={effective} />

      {/* ★ 2026-10-07（用户：「雌孕激素下面的 AI 分析去掉」）：整块「本阶段身心特征」
          （AI 分析结论行 + ● 建议）先隐藏，由 SHOW_PHASE_INSIGHT 控制。 */}
      {SHOW_PHASE_INSIGHT && info.hasLog ? (
        <PhaseInsightSection phase={info.phase} dayInCycle={info.dayInCycle ?? 0} ring={ring} cycleInfo={info} />
      ) : null}

      {/* ★ 2026-10-07（用户：洞察页「生理周期节律」卡片里面也加个 AI 分析，同样三行以内）：
          仅相位结论 + 真实周期进度，数据不足时给引导语。 */}
      <AiAnalysis>
        <AiResultRow
          tone={phaseBrief ? phaseBrief.tone : 'neutral'}
          title={phaseBrief ? (info.hasLog ? `${phaseBrief.name} · 第 ${info.dayInCycle ?? 0} 天` : phaseBrief.name) : '周期数据不足'}
        >
          {phaseBrief
            ? phaseBrief.body
            : '还没有经期记录。记录一次经期开始日后，这里会根据当前周期相位，给出对应的身心状态与训练建议。'}
        </AiResultRow>
      </AiAnalysis>
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

  /** ★ 2026-10-07：卡片右上角的「可点击」箭头 */
  cardChevron: {
    position: 'absolute',
    top: theme.sp(2),
    right: theme.sp(2),
    zIndex: 2,
  },
  recordCenter: {
    alignItems: 'center',
    paddingTop: theme.space.xs,
    marginTop: -theme.space.xs,
  },
  recordHint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.space.xs },
  // ★ 渐变自成胶囊：圆角+水平 padding 都在渐变层上（同 TaskDeck/设置页套路），
  //   外层 Touchable 只负责点击区域，避免父级裁切/宽度解析出方形渐变块
  recordBtn: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  recordBtnGrad: {
    paddingVertical: theme.sp(2),
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
  },
  recordBtnText: { color: mm.colors.btnTextOnGrad, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any },

  ringBadge: {
    alignSelf: 'flex-start',
    backgroundColor: mm.colors.limeSoft,
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(1),
    borderRadius: theme.radius.pill,
  },
  ringBadgeText: { fontSize: theme.fontSize.micro, color: mm.colors.limeDeep, fontWeight: theme.weight.semibold as any },
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
