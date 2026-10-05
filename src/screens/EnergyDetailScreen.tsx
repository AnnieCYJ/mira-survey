/**
 * EnergyDetailScreen —— 详情页
 *
 * 顺序（对齐 MetricDetail + 用户要求）：
 *   返回头 → Hero → RangeSwitch → DateAnchorPicker → 图表(置顶) → 指标网格 → 其他内容 → 解读
 *
 * 情绪消耗: EmotionInsightView（★ 与洞察页「情绪压力」tab 共用同一实现，内容一致）
 * 脑力消耗: 认知准备度（computeReadinessSeries），日=全天趋势图 / 周月年=区间准备度趋势
 * 运动消耗: 步数/距离/消耗 list + MetricDetail 跳转
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Svg, { Rect, Text as SvgText, Line, Defs, LinearGradient, Stop, G, Polyline, Circle, Path } from 'react-native-svg';
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
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';

// ★「情绪洞察」统一视图：与洞察页「情绪压力」tab 共用同一实现，保证两处内容完全一致
import EmotionInsightView, { StatCell } from '../components/EmotionInsightView';
// 底部常驻「记录此时心情」悬浮按钮（仅情绪消耗页出现）
import EmotionQuickRecord from '../components/EmotionQuickRecord';

// ★ 认知准备度（2026-10-05）：详情页日/周/月/年统一改用准备度口径
import ReadinessTrendChart, { readinessColor } from '../components/ReadinessTrendChart';
import { computeReadinessSeries, readinessLevel, readinessLevelLabel, READY_LOW } from '../lib/cognitiveReadiness';

type EnergyType = 'emotion' | 'cognitive' | 'activity';
interface RouteParams { type: EnergyType; }

const META: Record<EnergyType, { name: string; accent: string; sub: string }> = {
  emotion:   { name: '情绪洞察', accent: mm.colors.roseCore,    sub: '情绪消耗 + 唤醒分' }, // v16：情绪=Rose（旧 stateTense=honey 语义不符）
  cognitive: { name: '脑力消耗', accent: mm.colors.purpleCore, sub: '认知准备度 · 全天与区间趋势' },
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
    // ★ 2026-10-05 改准备度：Hero 与下方趋势图同源（同一份 computeReadinessSeries）
    const readyNow = report ? computeReadinessSeries(report).now : null;
    const map: Record<string, { text: string; color: string }> = {
      low: { text: '需要休息', color: theme.colors.danger },
      mid: { text: '状态中等', color: theme.colors.warn },
      high: { text: '状态充足', color: theme.colors.success },
    };
    const m = readyNow != null ? map[readinessLevel(readyNow)] : null;
    return (
      <View style={styles.hero}>
        {m ? (
          <>
            <Text style={[styles.heroVal, { color: m.color }]}>{readyNow}</Text>
            <Text style={styles.heroUnit}>/100 · {m.text}</Text>
          </>
        ) : (
          <Text style={styles.heroVal}>—</Text>
        )}
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
  const report = computeCognitiveLoadReport(reportNowMsForDay(anchorMs));
  // ★ 准备度序列：与 report 同源（同一小时是否有采样），只做反向映射 + 节律塑形
  const ready = computeReadinessSeries(report, reportNowMsForDay(anchorMs));
  const isToday = dayKey(reportNowMsForDay(anchorMs)) === dayKey(Date.now());

  const hasData = report.sampleCount >= 2;

  // 无真实数据 → 空骨架示意图：24 根空柱 + 三档坐标轴 + 「暂无数据」浮层（HourHistogram 内建），
  // 不放演示数据——示意图只说明「这里会有图表」，不冒充任何真实值。
  if (!hasData) {
    const skeletonPoints = Array.from({ length: 24 }, (_, h) => ({ hour: h, score: 0, hasData: false }));
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={[styles.chartTitle, { marginBottom: theme.sp(1.5) }]}>认知准备度 · 全天趋势</Text>
          <ReadinessTrendChart chartH={170} points={skeletonPoints} sleepWindow={null} />
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            连上戒指跑 2-3 轮自动监测后，这里将展示你的真实认知准备度曲线
          </Text>
        </View>
      </Card>
    );
  }

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

      {/* ② 中间：认知准备度 · 全天趋势（★ 替换原「认知疲劳度」半小柱图）
          柱状图 → 折线趋势：准备度是连续状态量（晨高晚低波形），柱图会把相邻两小时
          切成互不相干的两根，看不出「上午走高、傍晚回落」这个关键形态。 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1) }}>
            <Text style={styles.cardTitle}>认知准备度 · 全天趋势</Text>
            {(() => {
              // 徽章与曲线同源：用当天有数据小时的准备度均值分档
              const lv = readinessLevel(ready.avg);
              const map = {
                high: { text: '状态充足', color: theme.colors.success },
                mid: { text: '状态中等', color: theme.colors.warn },
                low: { text: '需要休息', color: theme.colors.danger },
              } as const;
              const m = map[lv];
              return (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: m.color + '20' }}>
                  <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: m.color }}>{m.text}</Text>
                </View>
              );
            })()}
          </View>
          <ReadinessTrendChart
            chartH={180}
            points={ready.points}
            sleepWindow={report.sleepWindow ?? null}
            nowHour={isToday ? new Date(reportNowMsForDay(anchorMs)).getHours() : null}
          />
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            横轴为一天时间（0–24 时），灰底为睡眠时段；分数越高表示此刻越「转得动」
          </Text>
        </View>
      </Card>

      {/* ③ 底部：准备度最佳 / 最低时段（★ 原「实际疲劳时段」，峰谷语义随准备度反转） */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>准备度时段</Text>
          <View style={{ flexDirection: 'row', gap: theme.sp(3) }}>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: mm.colors.limeSoft }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>状态最佳</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: mm.colors.limeDeep }}>
                {ready.peakHour != null ? `${String(ready.peakHour).padStart(2, '0')}:00` : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                最适合烧脑
              </Text>
            </View>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.danger + '14' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>需要休息</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.danger }}>
                {ready.troughHour != null ? `${String(ready.troughHour).padStart(2, '0')}:00` : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                轻度任务 / 休息
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
  /** 该周期内「每天准备度全天均值」再取平均（0–100） */
  readiness: number | null;
  /** 准备度三档小时占比（按佩戴且清醒的小时统计）：充足 / 中等 / 偏低 */
  highPct: number; midPct: number; lowPct: number;
  hasData: boolean;
}

/**
 * 单周期认知指标（★ 2026-10-05 改准备度口径）
 *  - readiness：每天走 `computeReadinessSeries(...).avg`（与日视图曲线、首页趋势同源），
 *    再对本周期内的天取平均。**不再用 brainRemaining**（那是脑力账户余额，量纲不同）。
 *  - 三档占比：按清醒佩戴小时统计准备度落在 充足(≥70)/中等(40–70)/偏低(<40) 的比例。
 *  - hasData 只认「该周期至少一天有 ≥2 个真实样本」。
 */
function computeCogRow(p: { dayKeys: string[] }): CogPeriodRow {
  let readySum = 0, readyCnt = 0, low = 0, mid = 0, high = 0, any = false;
  for (const dk of p.dayKeys) {
    const midMs = (parseDayKey(dk) || 0) + 12 * 3600 * 1000;
    const rep = computeCognitiveLoadReport(midMs);
    if (!rep || rep.sampleCount < 2) continue;
    any = true;
    const series = computeReadinessSeries(rep, midMs);
    if (series.avg != null) { readySum += series.avg; readyCnt++; }
    const sleep = rep.sleepWindow;
    for (const pt of series.points) {
      if (!pt.hasData) continue;
      if (isAsleep(pt.hour, sleep)) continue;
      const lv = readinessLevel(pt.score);
      if (lv === 'high') high++; else if (lv === 'mid') mid++; else low++;
    }
  }
  const tot = low + mid + high;
  return {
    readiness: readyCnt > 0 ? Math.round(readySum / readyCnt) : null,
    highPct: tot > 0 ? high / tot : 0,
    midPct: tot > 0 ? mid / tot : 0,
    lowPct: tot > 0 ? low / tot : 0,
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

      {/* 卡 ② 准备度趋势（★ 替换原「疲劳度高中低占比」堆叠柱）
          同量级比同量级：周视图按天、月视图按天、年视图按月；一条线看趋势，堆叠柱只看占比。 */}
      <Card padded={false} style={{ marginTop: theme.sp(2) }}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) }}>
            <Text style={styles.chartTitle}>认知准备度 · {RANGE_DEF[range].label}趋势</Text>
            <View style={{ flexDirection: 'row', gap: theme.sp(2) }}>
              {([['充足', theme.colors.success], ['中等', theme.colors.warn], ['偏低', theme.colors.danger]] as const).map(([t, c]) => (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
                  <View style={{ width: theme.sp(2.2), height: theme.sp(2.2), borderRadius: 2, backgroundColor: c }} />
                  <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{t}</Text>
                </View>
              ))}
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
            {/* 区间均值参考线 */}
            {meanReady != null && (
              <Line x1={AX_L} y1={yOf(meanReady)} x2={VW - AX_R} y2={yOf(meanReady)}
                stroke={theme.colors.accentSolid} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
            )}
            {/* 折线：连续有值的周期才连，缺口断开不插值 */}
            {(() => {
              const segs: number[][] = [];
              let cur: number[] = [];
              rows.forEach((r, i) => {
                if (r.readiness != null) cur.push(i);
                else { if (cur.length) segs.push(cur); cur = []; }
              });
              if (cur.length) segs.push(cur);
              const path = (idx: number[]) => idx.map((k, j) => `${j === 0 ? 'M' : 'L'} ${cxOf(k).toFixed(1)} ${yOf(rows[k].readiness!).toFixed(1)}`).join(' ');
              return segs.map((idx, i) => (
                <G key={'ln' + i}>
                  {idx.length > 1 && (
                    <Path d={path(idx)} fill="none" stroke={theme.colors.accentSolid}
                      strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {idx.map((k) => (
                    <Circle key={'p' + k} cx={cxOf(k)} cy={yOf(rows[k].readiness!)} r={2.6}
                      fill={readinessColor(rows[k].readiness)} stroke={theme.colors.cardBg} strokeWidth={1.2} />
                  ))}
                </G>
              ));
            })()}
            {periods.map((p, i) => (
              <SvgText key={i} x={cxOf(i)} y={chartH - 5} textAnchor="middle" fontSize={8.5} fill={theme.colors.textSub}>{showXLabel(range, i, p.label) ? p.label : ''}</SvgText>
            ))}
          </Svg>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            每个点 = 该{RANGE_DEF[range].label}内「每天准备度全天均值」再取平均；虚线 = 区间均值
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
              <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.success + '14' }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>状态充足占比</Text>
                <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.success }}>
                  {meanHigh != null ? `${meanHigh}%` : '—'}
                </Text>
                {highDelta != null && (
                  <Text style={{ fontSize: theme.fontSize.micro, color: highDelta >= 0 ? theme.colors.success : theme.colors.danger, marginTop: theme.sp(0.5) }}>
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
                    ? `状态充足时段占比上升 ${highDelta} 个百分点，可用脑时间变多。`
                    : highDelta! < 0
                      ? `状态充足时段占比下降 ${Math.abs(highDelta!)} 个百分点，试着提前安排重活。`
                      : `状态充足时段占比稳定。`)
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

  // ── 脑力消耗（认知准备度）──
  if (type === 'cognitive') {
    // ★ 与卡片大数字 / 趋势图同源：全部走 computeReadinessSeries（分数高 = 状态好）
    const ready = report ? computeReadinessSeries(report) : null;
    const readyNow = ready?.now ?? null;
    const readyAvg = ready?.avg ?? null;
    const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];

    const firstBody = readyNow == null
      ? '今日暂无脑力数据 · 连上戒指开启自动监测后开始生成。'
      : `此刻认知准备度 ${readyNow}（${readinessLevelLabel(readyNow)}），`
        + `全天均值 ${readyAvg ?? '—'}。`
        + (ready!.morning != null && ready!.nightLow != null
          ? `早上 ${ready!.morning}、夜间低谷 ${ready!.nightLow}，`
            + (ready!.morning - ready!.nightLow >= 15 ? '白天到夜里明显回落，属正常节律。' : '昼夜落差不大，今天状态比较平稳。')
          : '');

    if (ready?.peakHour != null) {
      rows.push({
        tone: 'good', title: '高效时段',
        body: `${String(ready.peakHour).padStart(2, '0')}:00–${String((ready.peakHour + 1) % 24).padStart(2, '0')}:00 准备度最高，适合安排深度工作。`,
      });
    }
    if (ready?.troughHour != null) {
      rows.push({
        tone: 'warn', title: '需要休息',
        body: `${String(ready.troughHour).padStart(2, '0')}:00 前后准备度最低，此时段更适合轻量任务或休息。`,
      });
    }
    if (readyNow != null && readyNow < READY_LOW) {
      rows.push({ tone: 'warn', title: '状态提醒', body: `当前准备度 ${readyNow} 偏低，${report?.sleepDebt != null && report.sleepDebt > 0.2 ? `叠加 ${report.sleepDebt.toFixed(1)}h 睡眠债，` : ''}建议先恢复再安排高强度用脑。` });
    }

    return (
      <InsightBanner
        rows={[{ tone: 'neutral', title: '', body: firstBody }, ...rows]}
        onMore={() => openChat('帮我分析今天的认知准备度')}
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


