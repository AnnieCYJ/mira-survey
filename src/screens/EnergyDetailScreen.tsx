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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { theme } from '../theme/theme';
import Svg, { Rect, Text as SvgText, Line, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import Card from '../components/Card';
import { useRingState } from '../hooks/useRingState';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';
import { RANGE_DEF, type RangeKey } from '../data/metrics';
import InsightBanner from '../components/InsightBanner';
import ChatSheet from '../components/ChatSheet';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { parseClockMinutes } from '../lib/sleepTime';

// ★「情绪洞察」统一视图：与洞察页「情绪压力」tab 共用同一实现，保证两处内容完全一致
import EmotionInsightView, { StatCell } from '../components/EmotionInsightView';

// CognitiveLoadCard 导出的组件/函数
import {
  HourHistogram as CognitiveHistogram,
  loadColor,
  fatigueColor,
  loadLabel,
  fmtRange,
} from '../components/CognitiveLoadCard';

type EnergyType = 'emotion' | 'cognitive' | 'activity';
interface RouteParams { type: EnergyType; }

const META: Record<EnergyType, { name: string; accent: string; sub: string }> = {
  emotion:   { name: '情绪洞察', accent: theme.colors.stateTense,  sub: '情绪消耗 + 唤醒分' },
  cognitive: { name: '脑力消耗', accent: theme.colors.accentSolid, sub: '基于时序疲劳累积模型' },
  activity:  { name: '运动消耗', accent: theme.colors.stateEnergy,  sub: '步数 · 距离 · 活动消耗' },
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
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textWhite} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>{meta.name}</Text>
            <Text style={styles.sub}>{meta.sub}</Text>
          </View>
        </View>

        {/* Hero */}
        <HeroRow type={type} accent={meta.accent} anchor={anchor} ring={ring} />

        {/* RangeSwitch + DateAnchorPicker — activity 类型只保留日期选择器 */}
        {type !== 'activity' && <RangeSwitch value={range} onChange={setRange} />}
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={type === 'activity' ? 'day' : range} />

        {/* AI 分析：情绪洞察 & 脑力消耗（按锚定日取数） */}
        {type !== 'activity' && <EnergyAiBanner type={type} ring={ring} openChat={openChat} anchor={anchor} />}

        {/* ===== 内容：图在上，数据在下（按锚定日取数） ===== */}
        {type === 'emotion' && range === 'day' && <EmotionInsightView anchorMs={anchor.getTime()} />}
        {type === 'cognitive' && range === 'day' && <CognitiveDetail anchorMs={anchor.getTime()} />}
        {type === 'activity' && range === 'day' && <ActivityDetail ring={ring} navigation={navigation} anchor={anchor} />}

        {range !== 'day' && <RangeTrendBars type={type} range={range} anchor={anchor} />}
      </View>
    </ScreenContainer>
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
    const ll = report?.loadLevel;
    const map: Record<string, { text: string; color: string }> = {
      rested: { text: '低疲劳', color: theme.colors.success },
      light: { text: '低疲劳', color: theme.colors.success },
      moderate: { text: '中疲劳', color: theme.colors.warn },
      heavy: { text: '高疲劳', color: theme.colors.stateEnergy },
    };
    const m = ll ? map[ll] : null;
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
      <Text style={styles.heroUnit}>/ 100</Text>
    </View>
  );
}

/* ========== 情绪消耗：图在上 ========== */
/* ========== 脑力消耗：图在上 ========== */
function CognitiveDetail({ anchorMs }: { anchorMs: number }) {
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  const report = computeCognitiveLoadReport(reportNowMsForDay(anchorMs));

  const hasData = report.sampleCount >= 2;
  const lCol = loadColor(report.loadLevel);
  const fCol = fatigueColor(report.fatigueLevel);

  if (!hasData) {
    return (
      <Card>
        <Text style={styles.emptyText}>暂无足够的生理数据，连上戒指跑 2-3 轮自动监测后自动生成报告</Text>
      </Card>
    );
  }

  const rhythmChip = (() => {
    if (report.rhythmStatus === 'sustained_high') return { text: '节律偏高', color: theme.colors.danger };
    if (report.rhythmStatus === 'dysregulated') return { text: '节律紊乱', color: theme.colors.stateTense };
    if (report.rhythmStatus === 'normal') return { text: '节律正常', color: theme.colors.stateCalm };
    return null;
  })();

  const { sleepRecovery, sleepDebt } = report;
  const recoveryPenalty = Math.round((1 - sleepRecovery) * 35);
  const debtScore = Math.round(Math.min(sleepDebt * 6, 30));
  const recoveryLabel = sleepRecovery >= 0.75 ? '恢复良好' : sleepRecovery >= 0.55 ? '恢复一般' : sleepRecovery >= 0.35 ? '恢复不足' : '严重不足';

  return (
    <>
      {/* 全天趋势图 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5), marginBottom: theme.sp(1.5) }}>
            <Text style={styles.chartTitle}>认知疲劳度</Text>
            {/* 当前负荷 chip: 高/中/低 */}
            {(() => {
              const ll = report.loadLevel;
              const map = {
                rested: { text: '低疲劳', color: theme.colors.success },
                light: { text: '低疲劳', color: theme.colors.success },
                moderate: { text: '中疲劳', color: theme.colors.warn },
                heavy: { text: '高疲劳', color: theme.colors.stateEnergy },
              } as const;
              const m = map[ll as keyof typeof map];
              return (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: m.color + '20' }}>
                  <Text style={{ fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: m.color }}>
                    {m.text}
                  </Text>
                </View>
              );
            })()}
            {/* 节律 chip */}
            {rhythmChip && (
              <View style={{ paddingHorizontal: theme.sp(1.5), paddingVertical: 2, borderRadius: 10, backgroundColor: rhythmChip.color + '22' }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: rhythmChip.color }}>{rhythmChip.text}</Text>
              </View>
            )}
          </View>
          <CognitiveHistogram chartH={160}
            hourly={report.hourly}
            peakSpan={report.peakLoadSpan}
            bestSpan={report.bestSpan}
            sleepWindow={report.sleepWindow}
          />
        </View>
      </Card>

      {/* 今日认知窗口 — 人话 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>今日认知窗口</Text>

          {/* 早起认知准备度 — 最上面一行, 早上看最有用 */}
          {(() => {
            const wakeH = (() => {
              try {
                const dk = dayKey(anchorMs);
                const sl = healthStore.getSleep(dk);
                const m = parseClockMinutes(sl?.wakeTime);
                return m != null ? m / 60 : null;
              } catch { return null; }
            })();
            const rec = report.sleepRecovery ?? 0.6;
            const debt = report.sleepDebt ?? 0;
            const peak = report.circadianPeakH ?? 8;
            // 早起准备度 (0-100): 睡眠恢复基础分 - 债扣分 + 节律相位加分
            const circAdj = wakeH != null ? (Math.max(0, Math.min(100, 50 + 50 * Math.sin(2 * Math.PI * (wakeH - peak + 6) / 24))) / 100) : 0.5;
            const clamp2 = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
            const prep = Math.round(clamp2(rec * 80 + 20 - debt * 8, 0, 100) * 0.7 + circAdj * 100 * 0.3);
            const ll = prep >= 70 ? { text: '准备好了', color: theme.colors.success, tip: '起床即有清晰认知状态' }
                     : prep >= 45 ? { text: '一般', color: theme.colors.warn, tip: '需要 30-60 分钟暖脑' }
                     : { text: '偏低', color: theme.colors.stateEnergy, tip: '建议先轻度活动，避免烧脑' };
            return (
              <View style={{ marginBottom: theme.sp(2.5), padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: ll.color + '12', borderLeftWidth: 3, borderLeftColor: ll.color }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 4 }}>早起认知准备度</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) }}>
                  <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: ll.color }}>{ll.text}</Text>
                  <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft }}>· {prep}/100</Text>
                </View>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 4 }}>
                  {ll.tip}
                  {rec < 0.6 ? ' · 昨晚恢复不足' : ''}
                  {debt > 1.5 ? ' · 累计睡眠债 ' + debt.toFixed(1) + 'h' : ''}
                  {wakeH != null ? ' · 起床 ' + fmtHM(wakeH) : ''}
                </Text>
              </View>
            );
          })()}

          <View style={{ flexDirection: 'row', gap: theme.sp(3), marginBottom: theme.sp(2) }}>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.stateEnergy + '18' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>认知高峰</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.stateEnergy }}>
                {report.forecast?.peakSpan ? peakSpanText(report.forecast.peakSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                最适合烧脑
              </Text>
            </View>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.stateTense + '18' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>认知低谷</Text>
              <Text style={{ fontSize: theme.fontSize.orb, fontWeight: theme.weight.semibold as any, color: theme.colors.stateTense }}>
                {report.forecast?.troughSpan ? peakSpanText(report.forecast.troughSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                轻度任务 / 休息
              </Text>
            </View>
          </View>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
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
        <ActivityTile label="步数" value={fmtInt(steps)} unit="步" color={theme.colors.accentSolid}
          onPress={() => openDetail('steps', '步数', '步', 0, Math.max(10000, Math.ceil(steps * 1.2)))} />
        <View style={{ height: 1, backgroundColor: theme.colors.ui.borderSoft }} />
        <ActivityTile label="步行距离" value={fmtKm(distance)} unit="km" color={theme.colors.stateEnergy}
          onPress={() => openDetail('distance', '步行距离', 'km', 0, Math.max(5, Math.ceil(distance * 1.5)))} />
        <View style={{ height: 1, backgroundColor: theme.colors.ui.borderSoft }} />
        <ActivityTile label="活动消耗" value={fmtInt(Math.round(calorie))} unit="kcal" color={theme.colors.stateTense} last
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
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: theme.colors.textWhite },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textWhite70, marginTop: theme.sp(1) },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.sp(1) },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: theme.colors.textWhite },
  heroUnit: { fontSize: theme.fontSize.body, color: theme.colors.textWhite70, marginLeft: theme.sp(2) },
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
    const loadScore = report?.loadScore;
    const fatigueScore = report?.fatigueIndex;
    const bestSpan = report?.bestSpan;
    const peakSpan = report?.peakLoadSpan;
    const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];

    const firstBody = loadScore == null
      ? '今日暂无脑力数据。'
      : loadScore >= 70
        ? `今日脑力负荷 ${loadScore}，处于高位，建议安排适当休息。`
        : loadScore >= 40
          ? `今日脑力负荷 ${loadScore}，处于中等区间，可持续工作。`
          : `今日脑力负荷 ${loadScore}，处于低位，精力较充裕。`;

    if (peakSpan) {
      rows.push({ tone: 'neutral', title: '负荷高峰', body: `${String(peakSpan.startHour).padStart(2, '0')}:00–${String(peakSpan.endHour).padStart(2, '0')}:00 为今日脑力负荷集中时段。` });
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
    const out: { label: string; dayKeys: string[] }[] = [];
    if (range === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(anchorMs); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
        out.push({ label: axis[6-i] ?? '', dayKeys: [dayKey(d.getTime())] });
      }
    } else if (range === 'month') {
      for (let g = 5; g >= 0; g--) {
        const days: string[] = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(anchorMs); d.setHours(0,0,0,0); d.setDate(d.getDate() - (g*5 + i));
          days.push(dayKey(d.getTime()));
        }
        const firstD = new Date(anchorMs); firstD.setHours(0,0,0,0); firstD.setDate(firstD.getDate() - (g*5 + 4));
        out.push({ label: String(firstD.getDate()), dayKeys: days });
      }
    } else if (range === 'year') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(anchorMs); d.setDate(1); d.setHours(0,0,0,0); d.setMonth(d.getMonth() - i);
        const y = d.getFullYear(), m = d.getMonth();
        const days: string[] = [];
        const dim = new Date(y, m+1, 0).getDate();
        for (let dd = 1; dd <= dim; dd++) days.push(dayKey(new Date(y, m, dd).getTime()));
        out.push({ label: axis[11-i] ?? '', dayKeys: days });
      }
    }
    return out;
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

  const scores = computeScores(periods);

  const prevAnchor = new Date(anchorMs);
  if (range === 'week') prevAnchor.setDate(prevAnchor.getDate() - 7);
  else if (range === 'month') prevAnchor.setMonth(prevAnchor.getMonth() - 1);
  else if (range === 'year') prevAnchor.setFullYear(prevAnchor.getFullYear() - 1);

  const prevPeriods: { dayKeys: string[] }[] = (() => {
    const out: { dayKeys: string[] }[] = [];
    if (range === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(prevAnchor.getTime()); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
        out.push({ dayKeys: [dayKey(d.getTime())] });
      }
    } else if (range === 'month') {
      for (let g = 5; g >= 0; g--) {
        const days: string[] = [];
        for (let i = 0; i < 5; i++) {
          const d = new Date(prevAnchor.getTime()); d.setHours(0,0,0,0); d.setDate(d.getDate() - (g*5 + i));
          days.push(dayKey(d.getTime()));
        }
        out.push({ dayKeys: days });
      }
    } else if (range === 'year') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(prevAnchor.getTime()); d.setDate(1); d.setHours(0,0,0,0); d.setMonth(d.getMonth() - i);
        const y = d.getFullYear(), m = d.getMonth();
        const days: string[] = [];
        const dim = new Date(y, m+1, 0).getDate();
        for (let dd = 1; dd <= dim; dd++) days.push(dayKey(new Date(y, m, dd).getTime()));
        out.push({ dayKeys: days });
      }
    }
    return out;
  })();
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
    else { top = theme.colors.stateEnergy; bot = theme.colors.accentSolid; }
    return [top, bot];
  };

  const lowerIsBetter = type === 'cognitive' || type === 'emotion';
  const trendBad = delta != null && ((lowerIsBetter && delta > 0) || (!lowerIsBetter && delta < 0));
  const trendColor = trendBad ? theme.colors.danger : delta != null && delta !== 0 ? theme.colors.success : theme.colors.textSub;
  const trendLabel = range === 'week' ? '上周' : range === 'month' ? '上月' : '去年同期';
  const trendArrow = delta == null ? '—' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

  // 图表尺寸用主题间距
  const barW = theme.sp(5);         // 20
  const gap = theme.sp(2);          // 8
  const chartW = periods.length * barW + (periods.length - 1) * gap + theme.sp(9); // +36
  const plotTop = theme.sp(4.5);    // 18
  const plotH = theme.sp(37.5);     // 150
  const chartH = plotTop + plotH + theme.sp(6.5); // +26

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
            <Svg width={chartW} height={chartH}>
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
                    <SvgText x={theme.sp(7)} y={y + theme.sp(0.75)} textAnchor="end" fontSize={theme.fontSize.xs} fill={theme.colors.textSub}>
                      {v}
                    </SvgText>
                    {v > 0 && v < 100 && (
                      <Line x1={32} y1={y} x2={chartW - 4} y2={y}
                        stroke={theme.colors.cardBorder + '50'} strokeWidth={0.5} strokeDasharray="2 3" />
                    )}
                  </G>
                );
              })}

              {/* 50 分参考线 (加粗) */}
              <Line x1={32} y1={plotTop + plotH - 50 / 100 * plotH}
                    x2={chartW - 4} y2={plotTop + plotH - 50 / 100 * plotH}
                    stroke={theme.colors.celebrateGrad[0]} strokeWidth={1.2} strokeDasharray="4 3" />

              {/* 柱子 — 空数据画灰色 2px 底条 */}
              {scores.map((s, i) => {
                const h = s != null ? Math.max(3, (s / 100) * plotH) : 0;
                const x = 36 + i * (barW + gap);
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
                    {s != null && (
                      <SvgText x={x + barW/2} y={y - theme.sp(1)} textAnchor="middle" fontSize={theme.fontSize.xs}
                               fontWeight={isPeak ? '700' : '500'}
                               fill={isPeak ? theme.colors.celebrateGrad[0] : theme.colors.textSub}>
                        {s}
                      </SvgText>
                    )}
                    {isPeak && validScores.filter(v => v === peak).length === 1 && (
                      <SvgText x={x + barW/2} y={y - theme.sp(4)} textAnchor="middle" fontSize={theme.fontSize.micro}
                               fill={theme.colors.celebrateGrad[0]}>▲</SvgText>
                    )}
                    <SvgText x={x + barW/2} y={chartH - theme.sp(1.5)} textAnchor="middle" fontSize={theme.fontSize.sm} fill={theme.colors.textSub}>
                      {periods[i].label}
                    </SvgText>
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


