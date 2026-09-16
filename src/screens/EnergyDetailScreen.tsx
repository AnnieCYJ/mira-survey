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
  cognitive: { name: '脑力消耗', accent: theme.colors.accentSolid, sub: '基于认知负荷 & 疲劳' },
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
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.goBack()} style={styles.back}>
            <Icon name="back" size={theme.fs(22)} color={theme.colors.textTitle} strokeWidth={2.2} />
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

  // ★ Hero 左上角: emotion 显示情绪消耗分
  const heroVal = type === 'emotion' ? report?.emotionalLoad : report?.loadScore;
  return (
    <View style={styles.hero}>
      <Text style={[styles.heroVal, { color: accent }]}>{heroVal ?? '—'}</Text>
      <Text style={styles.heroUnit}>/ 100</Text>
    </View>
  );
}

/* ========== 情绪消耗：图在上 ========== */
/* ========== 脑力消耗：图在上 ========== */
function CognitiveDetail({ anchorMs }: { anchorMs: number }) {
  // ★ 每次渲染都重算；按「锚定日」取报告（今天=此刻 / 历史日=整天）
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

  return (
    <>
      {/* ★ 图在最上面 —— 全天认知负荷分布 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.chartTitle}>全天认知负荷分布</Text>
          <CognitiveHistogram chartH={240} 
            hourly={report.hourly}
            peakSpan={report.peakLoadSpan}
            bestSpan={report.bestSpan}
            sleepWindow={report.sleepWindow}
          />
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateCalm }]} />
              <Text style={styles.legendText}>放松</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.stateTense }]} />
              <Text style={styles.legendText}>中度</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.danger }]} />
              <Text style={styles.legendText}>高强度</Text>
            </View>
          </View>
        </View>
      </Card>

      {/* 大分数 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>认知负荷 & 疲劳</Text>
          <View style={styles.scoreRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.scoreLabel}>认知负荷</Text>
              <Text style={[styles.bigScore, { color: lCol }]}>{report.loadScore}</Text>
            </View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreBlock}>
              <Text style={styles.scoreLabel}>疲劳指数</Text>
              <Text style={[styles.bigScore, { color: fCol }]}>{report.fatigueIndex}</Text>
            </View>
          </View>
          {/* 4 子指标 — 等宽均分 */}
          <View style={styles.statGrid}>
            <StatCell label="负荷占比" value={`${report.highLoadRatio}%`} sub="高负荷时段" />
            <StatCell label="恢复能力"
              value={report.recoveryCapacity != null ? `${Math.round(report.recoveryCapacity * 100)}%` : '—'}
              sub="全天最低窗口" />
            <StatCell label="今日 HRV"
              value={report.baselines.hrv != null ? `${Math.round(report.baselines.hrv)}` : '—'}
              sub="迷走活力 ms" />
            <StatCell label="血管张力"
              value={report.baselines.vti != null ? `${Math.round(report.baselines.vti)}` : '—'}
              sub="脑力投入信号" />
          </View>
        </View>
      </Card>

      {/* 极值时段 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={styles.peakRow}>
            {report.peakLoadSpan != null && (
              <View style={styles.peakChip}>
                <Text style={styles.peakLabel}>最高负荷时段</Text>
                <Text style={[styles.peakTime, { color: theme.colors.danger }]}>{fmtRange(report.peakLoadSpan)}</Text>
                <Text style={styles.peakSub}>平均负荷 {report.peakLoadSpan.avgScore}</Text>
              </View>
            )}
            {report.bestSpan != null && (
              <View style={styles.peakChip}>
                <Text style={styles.peakLabel}>认知状态最佳</Text>
                <Text style={[styles.peakTime, { color: theme.colors.stateCalm }]}>{fmtRange(report.bestSpan)}</Text>
                <Text style={styles.peakSub}>平均负荷 {report.bestSpan.avgScore}</Text>
              </View>
            )}
          </View>
          <Text style={styles.reasonText}>{report.loadReason}</Text>
          <Text style={[styles.reasonText, { marginTop: theme.sp(1) }]}>{report.fatigueReason}</Text>
        </View>
      </Card>
    </>
  );
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
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
  sub: { fontSize: theme.fontSize.body, color: theme.colors.textSub, marginTop: theme.sp(1) },
  hero: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: theme.sp(1) },
  heroVal: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.medium as any, color: theme.colors.textTitle },
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
