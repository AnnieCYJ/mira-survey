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
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import Card from '../components/Card';
import { useRingState } from '../hooks/useRingState';
import { healthStore, dayKey } from '../data/healthStore';
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
            <Icon name="back" size={theme.fs(22)} color="#FFFFFF" strokeWidth={2.2} />
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

        {range !== 'day' && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              {meta.name} · {RANGE_DEF[range].label}趋势分析（即将上线）
            </Text>
          </View>
        )}
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
      rested: { text: '低疲劳', color: '#22C55E' },
      light: { text: '低疲劳', color: '#22C55E' },
      moderate: { text: '中疲劳', color: '#F59E0B' },
      heavy: { text: '高疲劳', color: '#9D8AF0' },
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
                rested: { text: '低疲劳', color: '#22C55E' },
                light: { text: '低疲劳', color: '#22C55E' },
                moderate: { text: '中疲劳', color: '#F59E0B' },
                heavy: { text: '高疲劳', color: '#9D8AF0' },
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
          <CognitiveHistogram chartH={200}
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
            const ll = prep >= 70 ? { text: '准备好了', color: '#22C55E', tip: '起床即有清晰认知状态' }
                     : prep >= 45 ? { text: '一般', color: '#F59E0B', tip: '需要 30-60 分钟暖脑' }
                     : { text: '偏低', color: '#9D8AF0', tip: '建议先轻度活动，避免烧脑' };
            return (
              <View style={{ marginBottom: theme.sp(2.5), padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: ll.color + '12', borderLeftWidth: 3, borderLeftColor: ll.color }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: 4 }}>早起认知准备度</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5) }}>
                  <Text style={{ fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold as any, color: ll.color }}>{ll.text}</Text>
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
              <Text style={{ fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold as any, color: theme.colors.stateEnergy }}>
                {report.forecast?.peakSpan ? peakSpanText(report.forecast.peakSpan) : '--'}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, marginTop: theme.sp(0.5) }}>
                最适合烧脑
              </Text>
            </View>
            <View style={{ flex: 1, padding: theme.sp(2), borderRadius: theme.radius.sm, backgroundColor: theme.colors.stateTense + '18' }}>
              <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }}>认知低谷</Text>
              <Text style={{ fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold as any, color: theme.colors.stateTense }}>
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
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: '#FFFFFF' },
  sub: { fontSize: theme.fontSize.body, color: 'rgba(255,255,255,0.75)', marginTop: theme.sp(1) },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.sp(1) },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: '#FFFFFF' },
  heroUnit: { fontSize: theme.fontSize.body, color: 'rgba(255,255,255,0.75)', marginLeft: theme.sp(2) },
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
