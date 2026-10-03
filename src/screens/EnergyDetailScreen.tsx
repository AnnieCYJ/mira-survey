/**
 * EnergyDetailScreen —— 详情页
 *
 * 顺序（对齐 MetricDetail + 用户要求）：
 *   返回头 → Hero → RangeSwitch → DateAnchorPicker → 图表(置顶) → 指标网格 → 其他内容 → 解读
 *
 * 情绪消耗: EmotionInsightView（★ 与洞察页「情绪压力」tab 共用同一实现，内容一致）
 * 脑力消耗: CognitiveLoadCard 的数据，图=全天认知负荷分布
 * 运动消耗: 步数/距离/消耗 list + MetricDetail 跳转
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Svg, { Rect, Text as SvgText, Line, Defs, LinearGradient, Stop, G, Polyline, Circle } from 'react-native-svg';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import Card from '../components/Card';
import { useRingState } from '../hooks/useRingState';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';import { RANGE_DEF, type RangeKey } from '../data/metrics';
// ★ 情绪周/月/年：堆叠柱 + 周期标注（经期/经前），替代通用 RangeTrendBars
import EmotionRangeBars from '../components/EmotionRangeBars';
import InsightBanner from '../components/InsightBanner';
import ChatSheet from '../components/ChatSheet';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { buildNaturalPeriods, buildPrevNaturalPeriods } from '../lib/periods';
// ★ 统一三档（低<40 / 中40-70 / 高≥70）—— 与卡片大数字 avgFatigue、柱状图 LEVELS 同源
import { cogLevel, cogLevelLabel, computeCognitiveLoadReport, COG_LEVEL_LOW, COG_LEVEL_HIGH } from '../lib/cognitiveLoad';

// ★「情绪洞察」统一视图：与洞察页「情绪压力」tab 共用同一实现，保证两处内容完全一致
import EmotionInsightView, { StatCell } from '../components/EmotionInsightView';
// 底部常驻「记录此时心情」悬浮按钮（仅情绪消耗页出现）
import EmotionQuickRecord from '../components/EmotionQuickRecord';

// CognitiveLoadCard 导出的组件/函数
import {
  HourHistogram as CognitiveHistogram,
} from '../components/CognitiveLoadCard';

type EnergyType = 'emotion' | 'cognitive' | 'activity';
interface RouteParams { type: EnergyType; }

const META: Record<EnergyType, { name: string; accent: string; sub: string }> = {
  emotion:   { name: '情绪洞察', accent: mm.colors.roseCore,    sub: '情绪消耗 + 唤醒分' }, // v16：情绪=Rose（旧 stateTense=honey 语义不符）
  cognitive: { name: '脑力消耗', accent: mm.colors.purpleCore, sub: '基于时序疲劳累积模型' },
  activity:  { name: '运动消耗', accent: mm.colors.skyCore,  sub: '步数 · 距离 · 活动消耗' },
};

export default function EnergyDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const type = route.params?.type ?? 'emotion';
  const meta = META[type];
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = (q: string) => { setChatQuestion(q); setChatVisible(true); };
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();

  return (
    <>
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.textWhite}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{meta.name}</Text>
            <Text style={styles.sub}>{meta.sub}</Text>
          </View>
        </View>

        {/* Hero —— ★ 情绪页不放分数大数字（品牌口径：情绪无 52/100 评分）；日视图下方已有「今日主情绪」HERO */}
        {type !== 'emotion' && <HeroRow type={type} accent={meta.accent} anchor={anchor} ring={ring} />}

        {/* RangeSwitch + DateAnchorPicker — activity 类型只保留日期选择器 */}
        {type !== 'activity' && <RangeSwitch value={range} onChange={setRange} />}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={type === 'activity' ? 'day' : range} />

        {/* AI 分析：情绪洞察 & 脑力消耗（按锚定日取数） */}
        {type !== 'activity' && <EnergyAiBanner type={type} ring={ring} openChat={openChat} anchor={anchor} />}

        {/* ===== 内容：图在上，数据在下（按锚定日取数） ===== */}
        {type === 'emotion' && range === 'day' && <EmotionInsightView anchorMs={anchor.getTime()} />}
        {type === 'cognitive' && range === 'day' && <CognitiveDetail anchorMs={anchor.getTime()} />}
        {type === 'activity' && range === 'day' && <ActivityDetail ring={ring} navigation={navigation} anchor={anchor} />}

        {range !== 'day' && (type === 'emotion'
          ? <EmotionRangeBars range={range} anchor={anchor} />
          : type === 'activity'
            ? <RangeTrendBars type={type} range={range} anchor={anchor} />
            : <CognitiveRangeView range={range} anchor={anchor} />)}

        {/* 给底部常驻「记录情绪」按钮留白，避免情绪洞察末尾（图例/分析卡）被遮挡 */}
        {type === 'emotion' && <View style={{ height: 160 }} />}
      </View>
    </ScreenContainer>
    </View>

    {/* 首页「情绪消耗」点进去的情绪洞察页：底部常驻记录按钮（仅情绪类型） */}
    {type === 'emotion' && <EmotionQuickRecord />}
    <ChatSheet
      visible={chatVisible}
      onClose={() => setChatVisible(false)}
      initialQuestion={chatQuestion}
    />
    </>
  );
}

/* ========== Hero ========== */
function HeroRow({ type, accent, anchor, ring }: { type: EnergyType; accent: string; anchor: Date; ring: any }) {
  // ★ 按「锚定日」取报告：今天=此刻；历史日=该日整天（传错会得到空区间/永远是今天）
  const reportMs = reportNowMsForDay(anchor.getTime());
  const report = useMemo(() => {
    if (type === 'emotion') {
      const { computeStressReport } = require('../lib/stressAlgorithm');
      return computeStressReport(reportMs);
    }
    if (type === 'cognitive') {
      const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
      return computeCognitiveLoadReport(reportMs);
    }
    return null;
    // reportMs 对历史日是稳定的；对今天是 Date.now()（每帧变），但报告内部按 30s 桶缓存，重算廉价
  }, [type, reportMs]);

  if (type === 'activity') {
    const dk = dayKey(anchor.getTime());  // ★ 跟随日期选择器
    const cal = Math.round(ring?.stepDaily?.[dk]?.calorie ?? 0);
    return (
      <View style={styles.hero}>
        <Text style={styles.heroVal}>{cal}</Text>
        <Text style={styles.heroUnit}>kcal</Text>
      </View>
    );
  }

  // ★ Hero 左上角: emotion 显示分, cognitive 显示档位文字
  if (type === 'cognitive') {
    // 与卡片大数字同源：档位取自 avgFatigue（低<40 / 中40-70 / 高≥70）；无真实数据 → 诚实显示 —
    const lv = report?.avgFatigue != null ? cogLevel(report.avgFatigue) : null;
    const map: Record<string, { text: string; color: string }> = {
      low: { text: '低疲劳', color: theme.colors.success },
      mid: { text: '中疲劳', color: theme.colors.warn },
      high: { text: '高疲劳', color: theme.colors.danger },
    };
    const m = lv ? map[lv] : null;
    return (
      <View style={styles.hero}>
        <Text style={[styles.heroVal, m && { color: m.color }]}>{m ? m.text : '—'}</Text>
      </View>
    );
  }
  const heroVal = report?.emotionalLoad;
  return (
    <View style={styles.hero}>
      <Text style={styles.heroVal}>{heroVal ?? '—'}</Text>
      <Text style={styles.heroUnit}>/100</Text>
    </View>
  );
}

/* ========== 情绪消耗：图在上 ========== */
/* ========== 脑力消耗：图在上 ========== */
function CognitiveDetail({ anchorMs }: { anchorMs: number }) {
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  const report = computeCognitiveLoadReport(reportNowMsForDay(anchorMs));

  const hasData = report.sampleCount >= 2;

  // 无真实数据 → 空骨架示意图：24 根空柱 + 三档坐标轴 + 「暂无数据」浮层（HourHistogram 内建），
  // 不放演示数据——示意图只说明「这里会有图表」，不冒充任何真实值。
  if (!hasData) {
    const skeletonHourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, score: 0, hasData: false }));
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={[styles.chartTitle, { marginBottom: theme.sp(1.5) }]}>认知疲劳度</Text>
          <CognitiveHistogram chartH={160}
            hourly={skeletonHourly}
            peakSpan={null}
            bestSpan={null}
            sleepWindow={null}
          />
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            连上戒指跑 2-3 轮自动监测后，这里将展示你的真实认知疲劳曲线
          </Text>
        </View>
      </Card>
    );
  }

  const rhythmChip = (() => {
    if (report.rhythmStatus === 'sustained_high') return { text: '节律偏高', color: theme.colors.danger };
    if (report.rhythmStatus === 'dysregulated') return { text: '节律紊乱', color: mm.colors.honeyDeep };
    if (report.rhythmStatus === 'normal') return { text: '节律正常', color: mm.colors.limeDeep };
    return null;
  })();

  const { sleepRecovery, sleepDebt } = report;
  const recoveryPenalty = Math.round((1 - sleepRecovery) * 35);
  const debtScore = Math.round(Math.min(sleepDebt * 6, 30));
  const recoveryLabel = sleepRecovery >= 0.75 ? '恢复良好' : sleepRecovery >= 0.55 ? '恢复一般' : sleepRecovery >= 0.35 ? '恢复不足' : '严重不足';

  return (
    <>
      {/* ① 顶部：认知准备度 + 预测高峰 / 低谷 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>认知准备度</Text>
          {(() => {
            const reserve = report.brainReserve;
            const used = report.brainUsed;
            const remain = report.brainRemaining;
            if (reserve == null || used == null || remain == null) return null;
            const lv = remain >= 70 ? { text: '转得动', color: theme.colors.success, tip: '认知状态在线' }
                     : remain >= 40 ? { text: '还剩一半', color: theme.colors.warn, tip: '注意节奏，重活放高峰' }
                     : { text: '接近见底', color: theme.colors.danger, tip: '先恢复再投入' };
            return (
              <View style={{ marginBottom: theme.sp(2), padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: lv.color + '12', borderLeftWidth: 3, borderLeftColor: lv.color }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 4 }}>当前剩余 · 估算</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.sp(1.5) }}>
                  <Text style={{ fontSize: theme.fontSize.hero, fontWeight: theme.weight.semibold as any, color: lv.color, lineHeight: theme.fontSize.hero }}>{remain}</Text>
                  <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, paddingBottom: 6 }}>/100 · {lv.text}</Text>
                </View>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 4 }}>
                  {lv.tip} · 早上储备 {reserve} · 已用 {used}（只算脑）
                </Text>
              </View>
            );
          })()}

          <View style={{ flexDirection: 'row', gap: theme.sp(3) }}>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: mm.colors.limeSoft }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>认知高峰 · 预测</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: mm.colors.limeDeep }}>
                {report.forecast?.peakSpan ? peakSpanText(report.forecast.peakSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                最适合烧脑
              </Text>
            </View>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.stateTense + '18' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>认知低谷 · 预测</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.stateTense }}>
                {report.forecast?.troughSpan ? peakSpanText(report.forecast.troughSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                轻度任务 / 休息
              </Text>
            </View>
          </View>
        </View>
      </Card>

      {/* ② 中间：认知疲劳度（低 / 中 / 高 三柱分布） */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1) }}>
            <Text style={styles.cardTitle}>认知疲劳度</Text>
            {(() => {
              // 与卡片大数字 / 柱状图同源：档位取自 avgFatigue（低<40 / 中40-70 / 高≥70）
              const lv = cogLevel(report.avgFatigue);
              const map = {
                low: { text: '低疲劳', color: theme.colors.success },
                mid: { text: '中疲劳', color: theme.colors.warn },
                high: { text: '高疲劳', color: theme.colors.danger },
              } as const;
              const m = map[lv];
              return (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: m.color + '20' }}>
                  <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: m.color }}>{m.text}</Text>
                </View>
              );
            })()}
          </View>
          <FatigueTimeline report={report} />
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            横轴为一天时间（已去掉睡眠时段），每半小时一根柱，柱高对应疲劳档位（低 / 中 / 高），颜色同档位
          </Text>
        </View>
      </Card>

      {/* ③ 底部：实际疲劳时段 — 最高 / 最低 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>实际疲劳时段</Text>
          <View style={{ flexDirection: 'row', gap: theme.sp(3) }}>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.danger + '14' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>疲劳最高</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.danger }}>
                {report.peakLoadSpan ? peakSpanText(report.peakLoadSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                需留意 · 少安排烧脑
              </Text>
            </View>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: mm.colors.limeSoft }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>疲劳最低</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: mm.colors.limeDeep }}>
                {report.bestSpan ? peakSpanText(report.bestSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                状态最佳窗口
              </Text>
            </View>
          </View>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1.5) }}>
            {report.forecast?.rhythmR2 != null
              ? (report.forecast.rhythmR2 >= 0.6 ? '节律稳定，预测准' : report.forecast.rhythmR2 >= 0.3 ? '节律一般，仅供参考' : '节律不稳定，预测不准')
              : '需积累 7+ 天节律数据'}
            {report.circadianPeakH != null ? ' · 个体化峰值 ' + fmtHM(report.circadianPeakH) : ''}
          </Text>
        </View>
      </Card>
    </>
  );
}

// 睡眠区间判断（支持跨午夜：bedHour > wakeHour 表示该段跨越 0 点）
function isAsleep(hour: number, sleep: { bedHour: number; wakeHour: number } | null | undefined): boolean {
  if (!sleep) return false;
  const { bedHour, wakeHour } = sleep;
  if (bedHour <= wakeHour) return hour >= bedHour && hour < wakeHour;
  return hour >= bedHour || hour < wakeHour;
}

// 认知疲劳度时间轴：横轴=一天(去掉睡眠)，每半小时一根柱，柱高=疲劳档位(低/中/高)
// ★ SVG 必须用 viewBox + width 100% 自适应卡片宽；纵轴标注 低/中/高 三档
function FatigueTimeline({ report }: { report: any }) {
  const sleep = report.sleepWindow;
  const hourly: { hour: number; score: number; hasData: boolean }[] = report.hourly ?? [];
  // 24 小时 → 48 个半小时槽
  const slots: { score: number | null; asleep: boolean }[] = [];
  for (let h = 0; h < 24; h++) {
    const slot = hourly.find((x: any) => x.hour === h);
    const score = slot && slot.hasData ? slot.score : null;
    const asleep = isAsleep(h, sleep);
    slots.push({ score, asleep });
    slots.push({ score, asleep });
  }
  const n = slots.length;
  // viewBox 固定坐标系，实际渲染 width=100% 等比铺满卡片
  const W = 320;
  const AX_L = 26;  // 左边距：留给纵轴 低/中/高 标签
  const AX_R = 6;
  const step = (W - AX_L - AX_R) / n;
  const barW = step * 0.68;
  const plotTop = 8;
  const plotH = 112;
  const plotBottom = plotTop + plotH;
  const chartH = plotBottom + 18;
  // 三档离散高度（低/中/高 各一个档位高度，让档位一眼可辨）
  const LEVEL_H = { low: 0.30, mid: 0.62, high: 1.0 } as const;
  const LEVEL_C = { low: theme.colors.success, mid: theme.colors.warn, high: theme.colors.danger } as const;
  const xOf = (i: number) => AX_L + i * step;
  const yOfLevel = (lh: number) => plotBottom - lh * plotH;
  const ticks = [0, 6, 12, 18, 24];
  return (
    <Svg viewBox={`0 0 ${W} ${chartH}`} width="100%" height={chartH * 1.7}>
      {/* 睡眠带 */}
      {slots.map((s, i) => s.asleep ? (
        <Rect key={`sl${i}`} x={xOf(i)} y={plotTop} width={step} height={plotH} fill={theme.colors.ui.borderSoft} opacity={0.45} />
      ) : null)}
      {/* 纵轴：三档档位线 + 标签 */}
      {([['high', 1.0, '高'], ['mid', 0.62, '中'], ['low', 0.30, '低']] as const).map(([key, lh, label]) => (
        <G key={`lv${key}`}>
          <Line x1={AX_L} y1={yOfLevel(lh)} x2={W - AX_R} y2={yOfLevel(lh)} stroke={theme.colors.cardBorder} strokeWidth={0.6} strokeDasharray="3 4" opacity={0.7} />
          <SvgText x={AX_L - 4} y={yOfLevel(lh) + 3} textAnchor="end" fontSize={8.5} fill={LEVEL_C[key]}>{label}</SvgText>
        </G>
      ))}
      {/* 基线 */}
      <Line x1={AX_L} y1={plotBottom} x2={W - AX_R} y2={plotBottom} stroke={theme.colors.cardBorder} strokeWidth={0.75} />
      {/* 柱 */}
      {slots.map((s, i) => {
        if (s.asleep) return null;
        const x = xOf(i);
        if (s.score == null) {
          return <Rect key={i} x={x} y={plotBottom - 2} width={barW} height={2} fill={theme.colors.textSub} opacity={0.3} />;
        }
        const lv = cogLevel(s.score);
        const h = Math.max(3, LEVEL_H[lv] * plotH);
        return <Rect key={i} x={x} y={plotBottom - h} width={barW} height={h} fill={LEVEL_C[lv]} rx={1} opacity={0.92} />;
      })}
      {/* 时间轴刻度 */}
      {ticks.map((hh) => {
        const idx = hh === 24 ? n - 1 : hh * 2;
        const x = xOf(idx) + barW / 2;
        return (
          <SvgText key={`tk${hh}`} x={x} y={chartH - 4} textAnchor="middle" fontSize={8.5} fill={theme.colors.textSub}>{hh}</SvgText>
        );
      })}
    </Svg>
  );
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

// 周/月/年 分桶：★自然日历周期（周=本周一~周日 / 月=本月1号~月末 / 年=今年1月~12月）
function buildPeriods(range: RangeKey, anchorMs: number): { label: string; dayKeys: string[] }[] {
  if (range === 'day') return [];
  return buildNaturalPeriods(range, anchorMs);
}

// 月视图 28~31 根柱太密：只标 1/5/10/15/20/25/30；周/年全标
function showXLabel(range: RangeKey, i: number, label: string): boolean {
  if (range !== 'month') return true;
  const num = Number(label);
  if (Number.isNaN(num)) return true;
  return num === 1 || num % 5 === 0;
}

interface CogPeriodRow {
  readiness: number | null;
  lowPct: number; midPct: number; highPct: number;
  hasData: boolean;
}

// 单周期认知指标：准备度(脑力余额均值) + 疲劳三档占比(按佩戴且清醒小时统计)
function computeCogRow(p: { dayKeys: string[] }): CogPeriodRow {
  let readySum = 0, readyCnt = 0, low = 0, mid = 0, high = 0, any = false;
  for (const dk of p.dayKeys) {
    const midMs = (parseDayKey(dk) || 0) + 12 * 3600 * 1000;
    const rep = computeCognitiveLoadReport(midMs);
    if (!rep || rep.sampleCount < 2) continue;
    any = true;
    if (rep.brainRemaining != null) { readySum += rep.brainRemaining; readyCnt++; }
    const sleep = rep.sleepWindow;
    for (const hr of rep.hourly) {
      if (!hr.hasData) continue;
      if (isAsleep(hr.hour, sleep)) continue;
      const lv = cogLevel(hr.score);
      if (lv === 'low') low++; else if (lv === 'mid') mid++; else high++;
    }
  }
  const tot = low + mid + high;
  return {
    readiness: readyCnt > 0 ? Math.round(readySum / readyCnt) : null,
    lowPct: tot > 0 ? low / tot : 0,
    midPct: tot > 0 ? mid / tot : 0,
    highPct: tot > 0 ? high / tot : 0,
    hasData: any,
  };
}

/* ========== 脑力消耗：周/月/年 = 准备度趋势 + 疲劳三档占比 + 对比 ========== */
function CognitiveRangeView({ range, anchor }: { range: RangeKey; anchor: Date }) {
  const anchorMs = anchor.getTime();
  const periods = useMemo(() => buildPeriods(range, anchorMs), [range, anchorMs]);
  const rows = useMemo(() => periods.map(computeCogRow), [periods]);

  const prevPeriods = useMemo(() => buildPrevNaturalPeriods(range, anchorMs), [range, anchorMs]);
  const prevRows = useMemo(() => prevPeriods.map(computeCogRow), [prevPeriods]);

  const prevLabel = range === 'week' ? '上周' : range === 'month' ? '上月' : '去年同期';

  // 布局：★固定 viewBox 坐标系（320 宽）+ width="100%" 自适应卡片，禁止固定像素 width（会挤成一小条）
  const n = periods.length;
  const VW = 320;                       // viewBox 虚拟宽
  const AX_L = 26, AX_R = 6;            // 左侧留纵轴刻度、右留边
  const plotTop = 16, plotH = 120, xLabelH = 20;
  const chartH = plotTop + plotH + xLabelH;
  const step = (VW - AX_L - AX_R) / n;  // 每个周期格宽
  const barW = Math.min(24, Math.max(4, step * 0.55));
  const xOf = (i: number) => AX_L + i * step + (step - barW) / 2;
  const cxOf = (i: number) => AX_L + i * step + step / 2;
  const yOf = (v: number) => plotTop + (1 - v / 100) * plotH;

  const hasAny = rows.some((r) => r.hasData);
  const readyVals = rows.filter((r) => r.readiness != null).map((r) => r.readiness as number);
  const meanReady = readyVals.length > 0 ? Math.round(readyVals.reduce((a, b) => a + b, 0) / readyVals.length) : null;
  const meanHigh = rows.length > 0 ? Math.round((rows.reduce((a, r) => a + r.highPct, 0) / rows.length) * 100) : null;

  const prevReadyVals = prevRows.filter((r) => r.readiness != null).map((r) => r.readiness as number);
  const prevMeanReady = prevReadyVals.length > 0 ? Math.round(prevReadyVals.reduce((a, b) => a + b, 0) / prevReadyVals.length) : null;
  const prevMeanHigh = prevRows.length > 0 ? Math.round((prevRows.reduce((a, r) => a + r.highPct, 0) / prevRows.length) * 100) : null;

  const readyDelta = meanReady != null && prevMeanReady != null ? meanReady - prevMeanReady : null;
  const highDelta = meanHigh != null && prevMeanHigh != null ? meanHigh - prevMeanHigh : null;

  const grid = [0, 25, 50, 75, 100];

  return (
    <>
      {/* 卡 ① 准备度趋势图 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) }}>
            <Text style={styles.chartTitle}>认知准备度趋势</Text>
            {meanReady != null && (
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
                周期均值 {meanReady}
              </Text>
            )}
          </View>
          <View style={{ position: 'relative' }}>
            <Svg viewBox={`0 0 ${VW} ${chartH}`} width="100%" height={chartH * 1.7}>
              {grid.map((v) => {
                const y = yOf(v);
                return (
                  <G key={v}>
                    <Line x1={AX_L} y1={y} x2={VW - AX_R} y2={y}
                      stroke={v === 0 ? theme.colors.cardBorder : theme.colors.cardBorder + '55'} strokeWidth={0.5}
                      strokeDasharray={v === 0 ? undefined : '2 3'} />
                    <SvgText x={AX_L - 4} y={y + 3} textAnchor="end" fontSize={8.5} fill={theme.colors.textSub}>{v}</SvgText>
                  </G>
                );
              })}
              {(() => {
                const pts = rows.map((r, i) => r.readiness != null ? `${cxOf(i).toFixed(1)},${yOf(r.readiness).toFixed(1)}` : null).filter(Boolean).join(' ');
                return pts ? <Polyline points={pts} fill="none" stroke={mm.colors.purpleCore} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" /> : null;
              })()}
              {rows.map((r, i) => r.readiness != null ? (
                <G key={i}>
                  <Circle cx={cxOf(i)} cy={yOf(r.readiness)} r={3.2} fill={mm.colors.purpleCore} />
                  {n <= 8 && <SvgText x={cxOf(i)} y={yOf(r.readiness) - 7} textAnchor="middle" fontSize={8.5} fontWeight="700" fill={mm.colors.purpleCore}>{r.readiness}</SvgText>}
                </G>
              ) : null)}
              {periods.map((p, i) => (
                <SvgText key={i} x={cxOf(i)} y={chartH - 5} textAnchor="middle" fontSize={8.5} fill={theme.colors.textSub}>{showXLabel(range, i, p.label) ? p.label : ''}</SvgText>
              ))}
            </Svg>
            {!hasAny && (
              <View style={{ position: 'absolute', left: 0, right: 0, top: plotTop + plotH / 2 - 10, alignItems: 'center' }}>
                <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, backgroundColor: theme.colors.cardBgSoft + 'CC', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.sm }}>
                  暂无 {RANGE_DEF[range].label}数据
                </Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            纵轴 = 认知准备度（脑力余额 0–100），每天一个点
          </Text>
        </View>
      </Card>

      {/* 卡 ② 疲劳度高中低占比堆叠柱（每天一根） */}
      <Card padded={false} style={{ marginTop: theme.sp(2) }}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) }}>
            <Text style={styles.chartTitle}>疲劳度高中低占比</Text>
            <View style={{ flexDirection: 'row', gap: theme.sp(2) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
                <View style={{ width: theme.sp(2.2), height: theme.sp(2.2), borderRadius: 2, backgroundColor: theme.colors.success }} />
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>低</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
                <View style={{ width: theme.sp(2.2), height: theme.sp(2.2), borderRadius: 2, backgroundColor: theme.colors.warn }} />
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>中</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
                <View style={{ width: theme.sp(2.2), height: theme.sp(2.2), borderRadius: 2, backgroundColor: theme.colors.danger }} />
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>高</Text>
              </View>
            </View>
          </View>
          <Svg viewBox={`0 0 ${VW} ${chartH}`} width="100%" height={chartH * 1.7}>
            {grid.map((v) => {
              const y = yOf(v);
              return (
                <G key={v}>
                  <Line x1={AX_L} y1={y} x2={VW - AX_R} y2={y}
                    stroke={v === 0 ? theme.colors.cardBorder : theme.colors.cardBorder + '55'} strokeWidth={0.5}
                    strokeDasharray={v === 0 ? undefined : '2 3'} />
                  <SvgText x={AX_L - 4} y={y + 3} textAnchor="end" fontSize={8.5} fill={theme.colors.textSub}>{v}</SvgText>
                </G>
              );
            })}
            {rows.map((r, i) => {
              const x = xOf(i);
              const baseY = plotTop + plotH;
              if (!r.hasData) {
                return <Rect key={i} x={x} y={baseY - 2} width={barW} height={2} fill={theme.colors.cardBorder + '55'} />;
              }
              const hLow = r.lowPct * plotH, hMid = r.midPct * plotH, hHigh = r.highPct * plotH;
              return (
                <G key={i}>
                  <Rect x={x} y={baseY - hLow} width={barW} height={Math.max(0.5, hLow)} fill={theme.colors.success} opacity={0.9} />
                  <Rect x={x} y={baseY - hLow - hMid} width={barW} height={Math.max(0.5, hMid)} fill={theme.colors.warn} opacity={0.9} />
                  <Rect x={x} y={baseY - hLow - hMid - hHigh} width={barW} height={Math.max(0.5, hHigh)} fill={theme.colors.danger} opacity={0.9} />
                </G>
              );
            })}
            {periods.map((p, i) => (
              <SvgText key={i} x={cxOf(i)} y={chartH - 5} textAnchor="middle" fontSize={8.5} fill={theme.colors.textSub}>{showXLabel(range, i, p.label) ? p.label : ''}</SvgText>
            ))}
          </Svg>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            每根柱 = 当天清醒佩戴时段里，低/中/高疲劳所占比例（合计 100%）
          </Text>
        </View>
      </Card>

      {/* 卡 ③ 对比分析 */}
      {hasAny && (prevMeanReady != null || prevMeanHigh != null) && (
        <Card padded={false} style={{ marginTop: theme.sp(2) }}>
          <View style={styles.pad}>
            <Text style={styles.chartTitle}>对比{prevLabel}</Text>
            <View style={{ flexDirection: 'row', gap: theme.sp(3), marginTop: theme.sp(1) }}>
              <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: mm.colors.purpleSoft }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>准备度均值</Text>
                <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: mm.colors.purpleDeep }}>
                  {meanReady ?? '—'}
                </Text>
                {readyDelta != null && (
                  <Text style={{ fontSize: theme.fontSize.micro, color: readyDelta >= 0 ? theme.colors.success : theme.colors.danger, marginTop: theme.sp(0.5) }}>
                    {readyDelta > 0 ? '↑' : readyDelta < 0 ? '↓' : '→'} {Math.abs(readyDelta)} vs {prevLabel}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.danger + '14' }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>高疲劳占比</Text>
                <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.danger }}>
                  {meanHigh != null ? `${meanHigh}%` : '—'}
                </Text>
                {highDelta != null && (
                  <Text style={{ fontSize: theme.fontSize.micro, color: highDelta <= 0 ? theme.colors.success : theme.colors.danger, marginTop: theme.sp(0.5) }}>
                    {highDelta > 0 ? '↑' : highDelta < 0 ? '↓' : '→'} {Math.abs(highDelta)}pp vs {prevLabel}
                  </Text>
                )}
              </View>
            </View>
            <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1.5), lineHeight: 18 }}>
              {meanReady != null && prevMeanReady != null
                ? (readyDelta! > 0
                    ? `本周期认知准备度较${prevLabel}上升 ${readyDelta} 点，脑力更从容，可安排更多烧脑任务。`
                    : readyDelta! < 0
                      ? `本周期认知准备度较${prevLabel}下降 ${Math.abs(readyDelta!)} 点，建议减少高强度用脑、增加恢复。`
                      : `本周期认知准备度与${prevLabel}基本持平。`)
                : ''}
              {meanHigh != null && prevMeanHigh != null
                ? (highDelta! > 0
                    ? `高疲劳时段占比上升 ${highDelta} 个百分点，注意劳逸结合。`
                    : highDelta! < 0
                      ? `高疲劳时段占比下降 ${Math.abs(highDelta!)} 个百分点，状态在改善。`
                      : `高疲劳时段占比稳定。`)
                : ''}
            </Text>
          </View>
        </Card>
      )}
    </>
  );
}

// 时间格式化工具
function fmtHM(h: number | null | undefined): string {
  if (h == null) return '--';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function peakSpanText(span: { startHour: number; endHour: number } | null | undefined): string {
  if (!span) return '--';
  return `${fmtHM(span.startHour)} - ${fmtHM(span.endHour)}`;
}

function ActivityDetail({ ring, navigation, anchor }: { ring: any; navigation: any; anchor: Date }) {
  const dk = dayKey(anchor.getTime());  // ★ 跟随日期选择器
  const step = ring?.stepDaily?.[dk];
  const steps = step?.steps ?? 0;
  const distance = step?.distance ?? 0;
  const calorie = step?.calorie ?? 0;

  const fmtInt = (n: number) => n.toLocaleString('zh-CN');
  const fmtKm = (km: number) => (km >= 10 ? km.toFixed(1) : km.toFixed(2));

  const openDetail = (key: string, name: string, unit: string, yMin: number, yMax: number) => {
    navigation.navigate('MetricDetail', { key, name, unit, yMin, yMax });
  };

  return (
    <>
      <View style={styles.chartCard}>
        <ActivityTile label="步数" value={fmtInt(steps)} unit="步" color={mm.colors.skyDeep}
          onPress={() => openDetail('steps', '步数', '步', 0, Math.max(10000, Math.ceil(steps * 1.2)))} />
        <View style={{ height: 1, backgroundColor: theme.colors.ui.borderSoft }} />
        <ActivityTile label="步行距离" value={fmtKm(distance)} unit="km" color={mm.colors.skyDeep}
          onPress={() => openDetail('distance', '步行距离', 'km', 0, Math.max(5, Math.ceil(distance * 1.5)))} />
        <View style={{ height: 1, backgroundColor: theme.colors.ui.borderSoft }} />
        <ActivityTile label="活动消耗" value={fmtInt(Math.round(calorie))} unit="kcal" color={mm.colors.honeyDeep} last
          onPress={() => openDetail('calorie', '活动消耗', 'kcal', 0, Math.max(200, Math.ceil(calorie * 1.5)))} />
      </View>
      <View style={styles.statGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>步数</Text>
          <Text style={styles.statValue} numberOfLines={1}>{fmtInt(steps)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>距离</Text>
          <Text style={styles.statValue} numberOfLines={1}>{fmtKm(distance)} km</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>消耗</Text>
          <Text style={styles.statValue} numberOfLines={1}>{Math.round(calorie)} kcal</Text>
        </View>
      </View>
      <Text style={styles.insightText}>
        今日步行 {fmtKm(distance)} km，活动消耗 {Math.round(calorie)} kcal。点击任一项查看历史趋势。
      </Text>
    </>
  );
}


function ActivityTile({ label, value, unit, color, onPress, last }: {
  label: string; value: string; unit: string; color: string; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity activeOpacity={0.6} onPress={onPress} style={[
      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.space.md },
      last && { borderBottomLeftRadius: theme.radius.md, borderBottomRightRadius: theme.radius.md },
    ]}>
      <Text style={styles.activityLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={[styles.activityValue, { color }]}>{value}</Text>
        <Text style={styles.activityUnit}>{unit}</Text>
      </View>
      <Icon name="chevronRight" size={theme.fs(16)} color={theme.colors.textSub} />
    </TouchableOpacity>
  );
}

/* ========== styles ========== */
const pad = { padding: theme.space.cardPad };

const styles = StyleSheet.create({
  stack: { gap: theme.space.md },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: theme.space.sm },
  back: { width: theme.sp(9), height: theme.sp(9), borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.sp(1) },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: mm.colors.ink },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginLeft: theme.sp(2) },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: theme.space.xl * 2 },
  emptyText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, textAlign: 'center' },

  pad,
  cardTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(2) },
  chartTitle: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },

  scoreRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.sp(2), marginBottom: theme.space.sm },
  bigScore: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.bold as any },
  scoreUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  scoreLabel: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginBottom: theme.sp(0.5) },
  scoreBlock: { flex: 1, alignItems: 'center' },
  scoreDivider: { width: 1, height: theme.sp(10), backgroundColor: theme.colors.ui.borderSoft },

  badge: {
    paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(1), borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.stateTense + '22', marginRight: theme.sp(2),
  },
  badgeText: { fontSize: theme.fontSize.micro, color: theme.colors.stateTense },

  

  legendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: theme.sp(2), gap: theme.space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1) },
  legendSwatch: { width: theme.sp(3), height: theme.sp(3), borderRadius: 2 },
  legendText: { fontSize: theme.fontSize.body, color: theme.colors.textSub },

  peakRow: { flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.sp(2) },
  peakChip: { flex: 1, padding: theme.space.sm, borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft },
  peakLabel: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
  peakTime: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, marginTop: 2 },
  peakSub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: 2 },

  reasonText: { fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, lineHeight: theme.fontSize.sm * 1.5 },

  chartCard: {
    borderRadius: theme.radius.card, backgroundColor: theme.colors.cardBg,
    borderWidth: 1, borderColor: theme.colors.cardBorder, ...theme.shadow.card,
    paddingHorizontal: theme.space.cardPad,
  },
  statGrid: { flexDirection: 'row' },
  statCell: {
    flex: 1, alignItems: 'center', paddingVertical: theme.sp(2), paddingHorizontal: theme.sp(1),
    borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft,
    marginHorizontal: theme.sp(0.5),
    
  },
  statSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  statValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.orb * 1.15, textAlign: 'center' },
  insightText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.55, paddingHorizontal: theme.space.xs },

  activityLabel: { fontSize: theme.fontSize.body, color: theme.colors.textInkSoft },
  activityValue: { fontSize: theme.fontSize.orb, fontWeight: theme.weight.bold as any },
  activityUnit: { fontSize: theme.fontSize.body, color: theme.colors.textSub },
});


/** EnergyAiBanner —— 情绪/脑力消耗详情页的规则 AI 分析卡片
 * 参考身体恢复页格式：InsightBanner（第一段纯段落 + 其余 AiResultRow） */
function EnergyAiBanner({ type, ring, openChat, anchor }: { type: EnergyType; ring: any; openChat: (q: string) => void; anchor: Date }) {
  // ★ 按「锚定日」取报告，历史日文案才不是「今日…」
  const reportMs = reportNowMsForDay(anchor.getTime());
  const { computeStressReport } = require('../lib/stressAlgorithm');
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  const report = type === 'emotion' ? computeStressReport(reportMs) : computeCognitiveLoadReport(reportMs);

  // ── 情绪洞察 ──
  if (type === 'emotion') {
    const events = report?.events?.length ?? 0;
    const peak = report?.peakHour;
    const avgRec = report?.avgRecoverySec;
    const load = report?.emotionalLoad;
    const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];

    // 第一段：纯段落（InsightBanner 会自动处理）
    const firstBody = events === 0
      ? '今日暂无压力事件记录，状态保持平稳。'
      : events <= 3
        ? `今日共有 ${events} 次压力事件，情绪消耗 ${load ?? '—'}，整体处于低压力区间。`
        : events <= 6
          ? `今日共有 ${events} 次压力事件，情绪消耗 ${load ?? '—'}，处于中等压力水平。`
          : `今日共有 ${events} 次压力事件，情绪消耗 ${load ?? '—'}，压力负荷较高，注意放松。`;

    // 其余分段
    if (events > 0 && peak != null) {
      rows.push({ tone: 'neutral', title: '峰值时段', body: `压力事件集中于 ${String(Math.floor(peak)).padStart(2, '0')}:00 前后。` });
    }
    if (avgRec != null) {
      rows.push({ tone: avgRec > 120 ? 'warn' : 'good', title: '恢复速度', body: avgRec > 120 ? `平均恢复 ${avgRec}s，偏慢，建议注意恢复策略。` : `平均恢复 ${avgRec}s，处于正常区间。` });
    }

    return (
      <InsightBanner
        rows={[{ tone: 'neutral', title: '', body: firstBody }, ...rows]}
        onMore={() => openChat('帮我分析身体恢复情况')}
      />
    );
  }

  // ── 脑力消耗 ──
  if (type === 'cognitive') {
    // ★ 与卡片大数字 / 柱状图同源：avgFatigue + 统一三档
    const avgFatigue = report?.avgFatigue;
    const fatigueScore = report?.fatigueIndex;
    const bestSpan = report?.bestSpan;
    const bars = (report?.hourly ?? []).filter((h: any) => h.hasData);
    const peakBar = bars.length > 0 ? bars.reduce((a: any, b: any) => (b.score > a.score ? b : a)) : null;
    const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];

    const firstBody = avgFatigue == null
      ? '今日暂无脑力数据。'
      : `今日脑力消耗 ${avgFatigue}，处于${cogLevelLabel(avgFatigue)}位，${cogLevel(avgFatigue) === 'high' ? '建议安排适当休息。' : cogLevel(avgFatigue) === 'mid' ? '可持续工作。' : '精力较充裕。'}`;

    if (peakBar) {
      rows.push({ tone: 'neutral', title: '疲劳高峰', body: `疲劳度在 ${String(peakBar.hour).padStart(2, '0')}:00 达到当日最高（${peakBar.score}），此时段适合安排轻量任务。` });
    }
    if (bestSpan) {
      rows.push({ tone: 'good', title: '高效时段', body: `${String(bestSpan.startHour).padStart(2, '0')}:00–${String(bestSpan.endHour).padStart(2, '0')}:00 为今日脑力黄金时段，适合深度工作。` });
    }
    if (fatigueScore != null && fatigueScore >= 60) {
      rows.push({ tone: 'warn', title: '疲劳提醒', body: `今日疲劳分 ${fatigueScore}，建议尽早休息。` });
    }

    return (
      <InsightBanner
        rows={[{ tone: 'neutral', title: '', body: firstBody }, ...rows]}
        onMore={() => openChat('帮我分析脑力消耗情况')}
      />
    );
  }

  return null;
}

/* ========== 跨天/周/月/年分析卡 ========== */
function RangeTrendBars({ type, range, anchor }: { type: EnergyType; range: RangeKey; anchor: Date }) {
  const anchorMs = anchor.getTime();
  const { axis } = RANGE_DEF[range];

  const periods: { label: string; dayKeys: string[] }[] = (() => {
    // ★自然日历周期：周=本周一~周日 / 月=本月逐日(1号~月末) / 年=今年1月~12月
    return buildNaturalPeriods(range, anchorMs).map((p) => ({ label: p.label, dayKeys: p.dayKeys }));
  })();

  const computeScores = (periodList: { dayKeys: string[] }[]): (number | null)[] =>
    periodList.map(p => {
      let sum = 0, cnt = 0;
      for (const dk of p.dayKeys) {
        try {
          if (type === 'cognitive') {
            const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
            const midMs = (parseDayKey(dk) || 0) + 12 * 3600 * 1000;
            const rep = computeCognitiveLoadReport(midMs);
            if (rep?.sampleCount >= 2 && rep.loadScore != null) { sum += rep.loadScore; cnt++; }
          } else if (type === 'emotion') {
            const { computeStressReport } = require('../lib/stressAlgorithm');
            const midMs = (parseDayKey(dk) || 0) + 12 * 3600 * 1000;
            const rep = computeStressReport(midMs);
            if (rep?.sampleCount >= 2 && rep.emotionalLoad != null) { sum += rep.emotionalLoad; cnt++; }
          } else if (type === 'activity') {
            const d = healthStore.getDay('steps' as any, dk);
            if (d?.mean != null) { sum += Math.min(100, (d.mean / 8000) * 100); cnt++; }
          }
        } catch {}
      }
      return cnt > 0 ? Math.round(sum / cnt) : null;
    });

  const rawScores = computeScores(periods);
  // 无真实数据 → 保持骨架（灰色 2px 底条 + 「暂无数据」覆盖层），不放演示序列
  const scores = rawScores;

  // 上一自然周期（上周 / 上月 / 去年）
  const prevPeriods: { dayKeys: string[] }[] = buildPrevNaturalPeriods(range, anchorMs)
    .map((p) => ({ dayKeys: p.dayKeys }));
  const prevScores = computeScores(prevPeriods);

  const validScores = scores.filter((s): s is number => s != null);
  const validPrev = prevScores.filter((s): s is number => s != null);
  const hasAny = validScores.length > 0;

  const mean = hasAny ? Math.round(validScores.reduce((a,b)=>a+b,0) / validScores.length) : 0;
  const peak = hasAny ? Math.max(...validScores) : 0;
  const trough = hasAny ? Math.min(...validScores) : 0;
  const volatility = hasAny && validScores.length > 1
    ? Math.round(Math.sqrt(validScores.reduce((a,b)=>a+(b-mean)**2,0) / validScores.length))
    : 0;

  const prevMean = validPrev.length > 0 ? Math.round(validPrev.reduce((a,b)=>a+b,0) / validPrev.length) : null;
  const delta = prevMean != null ? mean - prevMean : null;
  const deltaPct = prevMean != null && prevMean > 0 ? Math.round((delta! / prevMean) * 100) : null;

  const gradId = (i: number) => `rbg-${type}-${range}-${i}`;
  const stopsFor = (s: number | null) => {
    if (s == null) return ['transparent', 'transparent'];
    // 与 StressInsightCard.HourHistogram 档位语义一致:
    //   低负荷/低疲劳 → success (绿, 好状态)
    //   中负荷/中疲劳 → warn (黄, 一般)
    //   高负荷/高疲劳 → stateEnergy (紫, 需注意)
    let top: string, bot: string;
    const TH_LOW  = type === 'emotion' ? 30 : 40;
    const TH_HIGH = type === 'emotion' ? 60 : 65;
    if (s < TH_LOW) { top = theme.colors.success;    bot = theme.colors.ui.successText; }
    else if (s < TH_HIGH) { top = theme.colors.warn; bot = theme.colors.stateTense; }
    else { top = mm.colors.honeyCore; bot = mm.colors.honeyDeep; } // v21：认知疲劳=蜜（中档 honeyDeep，与 fatigueLevels 同源）
    return [top, bot];
  };

  const lowerIsBetter = type === 'cognitive' || type === 'emotion';
  const trendBad = delta != null && ((lowerIsBetter && delta > 0) || (!lowerIsBetter && delta < 0));
  const trendColor = trendBad ? theme.colors.danger : delta != null && delta !== 0 ? theme.colors.success : theme.colors.textSub;
  const trendLabel = range === 'week' ? '上周' : range === 'month' ? '上月' : '去年同期';
  const trendArrow = delta == null ? '—' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

  // 图表尺寸：★viewBox 固定坐标系(320 宽) + width 100% 自适应；月视图 28~31 柱自动收窄
  const VW = 320;
  const nP = periods.length;
  const AX_L2 = 30, AX_R2 = 6;
  const stepP = (VW - AX_L2 - AX_R2) / Math.max(1, nP);
  const barW = Math.min(24, Math.max(3, stepP * 0.6));
  const plotTop = theme.sp(4.5);    // 18
  const plotH = theme.sp(37.5);     // 150
  const chartH = plotTop + plotH + theme.sp(6.5); // +26
  const xOfP = (i: number) => AX_L2 + i * stepP + (stepP - barW) / 2;
  const cxOfP = (i: number) => AX_L2 + i * stepP + stepP / 2;

  return (
    <>
      {/* 卡 ① 趋势图 — SVG 始终渲染, 空数据画骨架 + 覆盖层 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={styles.chartTitle}>{META[type].name} · {RANGE_DEF[range].label}趋势</Text>
            {prevMean != null && deltaPct != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: theme.colors.textSub }}>vs {trendLabel}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: trendColor, marginLeft: 4 }}>
                  {trendArrow} {Math.abs(deltaPct!)}%
                </Text>
              </View>
            )}
          </View>

          <View style={{ position: 'relative' }}>
            <Svg viewBox={`0 0 ${VW} ${chartH}`} width="100%" height={chartH * 1.7}>
              <Defs>
                {scores.map((s, i) => {
                  const [t, b] = stopsFor(s);
                  return (
                    <LinearGradient key={i} id={gradId(i)} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor={t} stopOpacity="1" />
                      <Stop offset="100%" stopColor={b} stopOpacity="1" />
                    </LinearGradient>
                  );
                })}
              </Defs>

              {/* Y 轴刻度 & 网格 — 始终渲染 */}
              {[0, 25, 50, 75, 100].map(v => {
                const y = plotTop + plotH - (v / 100) * plotH;
                return (
                  <G key={`y${v}`}>
                    <SvgText x={AX_L2 - 4} y={y + 3} textAnchor="end" fontSize={8.5} fill={theme.colors.textSub}>
                      {v}
                    </SvgText>
                    {v > 0 && v < 100 && (
                      <Line x1={AX_L2} y1={y} x2={VW - AX_R2} y2={y}
                        stroke={theme.colors.cardBorder + '50'} strokeWidth={0.5} strokeDasharray="2 3" />
                    )}
                  </G>
                );
              })}

              {/* 50 分参考线 (加粗) */}
              <Line x1={AX_L2} y1={plotTop + plotH - 50 / 100 * plotH}
                    x2={VW - AX_R2} y2={plotTop + plotH - 50 / 100 * plotH}
                    stroke={theme.colors.celebrateGrad[0]} strokeWidth={1.2} strokeDasharray="4 3" />

              {/* 柱子 — 空数据画灰色 2px 底条 */}
              {scores.map((s, i) => {
                const h = s != null ? Math.max(3, (s / 100) * plotH) : 0;
                const x = xOfP(i);
                const y = plotTop + plotH - h;
                const isPeak = hasAny && s != null && s === peak;
                return (
                  <G key={i}>
                    {s != null ? (
                      <Rect x={x} y={y} width={barW} height={h} rx={theme.radius.sm} ry={theme.radius.sm}
                            fill={`url(#${gradId(i)})`} />
                    ) : (
                      <Rect x={x} y={plotTop + plotH - 2} width={barW} height={2} rx={theme.sp(0.25)} ry={theme.sp(0.25)}
                            fill={theme.colors.cardBorder + '50'} />
                    )}
                    {s != null && nP <= 14 && (
                      <SvgText x={cxOfP(i)} y={y - theme.sp(1)} textAnchor="middle" fontSize={theme.fontSize.xs}
                               fontWeight={isPeak ? '700' : '500'}
                               fill={isPeak ? theme.colors.celebrateGrad[0] : theme.colors.textSub}>
                        {s}
                      </SvgText>
                    )}
                    {isPeak && nP > 14 && validScores.filter(v => v === peak).length === 1 && (
                      <SvgText x={cxOfP(i)} y={y - theme.sp(1)} textAnchor="middle" fontSize={theme.fontSize.xs}
                               fontWeight="700" fill={theme.colors.celebrateGrad[0]}>▲</SvgText>
                    )}
                    {(nP <= 14 || showXLabel(range, i, periods[i].label)) && (
                      <SvgText x={cxOfP(i)} y={chartH - theme.sp(1.5)} textAnchor="middle" fontSize={8.5} fill={theme.colors.textSub}>
                        {periods[i].label}
                      </SvgText>
                    )}
                  </G>
                );
              })}
            </Svg>
            {/* 空数据覆盖层 */}
            {!hasAny && (
              <View style={{ position: 'absolute', left: 0, right: 0, top: plotTop + plotH / 2 - 10, alignItems: 'center' }}>
                <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, backgroundColor: theme.colors.cardBgSoft + 'CC', paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.5), borderRadius: theme.radius.sm }}>
                  暂无 {RANGE_DEF[range].label}数据
                </Text>
              </View>
            )}
          </View>
        </View>
      </Card>

      {/* 卡 ② 统计指标网格 */}
      {hasAny && (
        <Card padded={false} style={{ marginTop: theme.sp(2) }}>
          <View style={styles.pad}>
            <View style={styles.statGrid}>
              <StatCell label="周期均值" value={String(mean)} sub={type === 'activity' ? '' : '/ 100'} />
              <StatCell label="峰值" value={String(peak)} sub={type === 'activity' ? '' : '/ 100'} valueColor={theme.colors.celebrateGrad[0]} />
              <StatCell label="低谷" value={String(trough)} sub={type === 'activity' ? '' : '/ 100'} valueColor={theme.colors.success} />
              <StatCell label="波动度" value={String(volatility)} sub="σ" />
            </View>
          </View>
        </Card>
      )}

      {/* 卡 ③ 对比上周期 */}
      {hasAny && prevMean != null && (
        <Card padded={false} style={{ marginTop: theme.sp(2) }}>
          <View style={styles.pad}>
            <Text style={styles.chartTitle}>对比{trendLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: trendColor }}>
                {delta == null ? '—' : (delta > 0 ? '+' : '') + delta}
              </Text>
              <Text style={{ fontSize: 14, color: theme.colors.textSub, marginLeft: 6 }}>
                {deltaPct != null ? `(${trendArrow} ${Math.abs(deltaPct!)}%)` : ''}
              </Text>
              <View style={{ flex: 1 }} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 11, color: theme.colors.textSub }}>{trendLabel}均值</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textTitle }}>{prevMean}</Text>
              </View>
            </View>
            <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1.5), lineHeight: 18 }}>
              {lowerIsBetter
                ? (delta! > 0
                    ? `本周期${META[type].name}负荷较${trendLabel}上升 ${deltaPct!}%，建议关注高负荷时段，调整节奏避免疲劳累积。`
                    : delta! < 0
                      ? `本周期${META[type].name}负荷较${trendLabel}下降 ${Math.abs(deltaPct!)}%，状态良好，继续保持当前作息与活动节奏。`
                      : `本周期${META[type].name}负荷与${trendLabel}基本持平，稳定在健康区间。`)
                : (delta! > 0
                    ? `本周期运动量较${trendLabel}提升 ${deltaPct!}%，继续保持！注意运动后恢复。`
                    : delta! < 0
                      ? `本周期运动量较${trendLabel}下降 ${Math.abs(deltaPct!)}%，建议每天增加 10-15 分钟活动。`
                      : `本周期运动量与${trendLabel}基本持平，稳定输出中。`)
              }
            </Text>
          </View>
        </Card>
      )}
    </>
  );
}


