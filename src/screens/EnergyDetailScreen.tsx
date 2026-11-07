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
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { LinearGradient as BgGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { previousPeriodLabel } from '../lib/periodLabels';
import { chart } from '../theme/chart';
import { mm } from '../theme/mindmate';
import Svg, { Rect, Text as SvgText, Line, G, Circle, Path } from 'react-native-svg';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import BackButton from '../components/BackButton';
import Card from '../components/Card';
import { useRingState } from '../hooks/useRingState';
import { healthStore, dayKey, parseDayKey } from '../data/healthStore';import { RANGE_DEF, type RangeKey } from '../data/metrics';
// ★ 情绪周/月/年：堆叠柱 + 周期标注（经期/经前），替代通用 RangeTrendBars
import EmotionRangeBars from '../components/EmotionRangeBars';
import InsightBanner from '../components/InsightBanner';
import ChatSheet from '../components/ChatSheet';
import { reportNowMsForDay } from '../lib/dayAnchor';
import { buildNaturalPeriods, buildPrevNaturalPeriods } from '../lib/periods';
import { isMonthTickDay, isYearTickMonth } from '../lib/chartAxis';
// ★ 统一三档（低<40 / 中40-70 / 高≥70）—— 与卡片大数字 avgFatigue、柱状图 LEVELS 同源
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';

// ★「情绪洞察」统一视图：与洞察页「情绪压力」tab 共用同一实现，保证两处内容完全一致
import EmotionInsightView, { StatCell } from '../components/EmotionInsightView';
// 底部常驻「记录此时心情」悬浮按钮（仅情绪消耗页出现）
import EmotionQuickRecord from '../components/EmotionQuickRecord';

// ★ 认知准备度（2026-10-05）：详情页日/周/月/年统一改用准备度口径
import ReadinessTrendChart, { readinessColor } from '../components/ReadinessTrendChart';
import { computeReadinessSeries, readinessLevelLabel, READY_LOW, dailyBrainUsed } from '../lib/cognitiveReadiness';
import { buildStressRangeSeries, rangeStressMean, dailyStressValue } from '../lib/stressDaily';
import { todaySportLogs } from '../lib/sportLog';
// ★ 2026-10-12：运动消耗·日视图「今日运动建议」——按当前周期相位给处方
import { buildWorkoutAdvice, buildPhaseAnalysis } from '../lib/phaseAdvice';
// ★ 2026-10-12：与工具页「运动建议」共用引擎，抽真实处方字段上卡（单一事实来源）
import { buildTodayWorkout, buildSportBrief } from '../lib/todayWorkout';
import { collectWorkoutInput } from '../lib/workoutInput';
import { useDeviceModel } from '../config/deviceModel'; // ★ 2026-11-05：运动建议合并只对基础版生效
import { useHealthStoreVersion } from '../hooks/useHealthStore';

type EnergyType = 'emotion' | 'cognitive' | 'activity';
interface RouteParams { type: EnergyType; }

/**
 * ★ 2026-11-07（用户）：运动消耗页加「梅脱（MET）」格 + 感叹号解释弹层。
 * LunaMira 精简版不回传 met（deviceModel 标 proOnly），因此：
 *   · 优先用真实 met 采样（未来硬件升级自动切换）；
 *   · 缺省按当日逐点心率映射粗档估算，诚实标注「心率估算」，绝不冒充实测。
 * 映射表为心率→强度的通用粗档（静止~1.3 → 高强度~9），只作参考。
 */
function estimateDayMet(dk: string): { value: number | null; source: 'met' | 'hr' | null } {
  try {
    const metPts = healthStore.getIntraday('met' as any, dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
    if (metPts.length > 0) return { value: metPts.reduce((a, p) => a + p.v, 0) / metPts.length, source: 'met' };
    const hrPts = healthStore.getIntraday('hr', dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
    if (hrPts.length === 0) return { value: null, source: null };
    const hrMet = (hr: number): number =>
      hr < 70 ? 1.3 : hr < 85 ? 1.8 : hr < 100 ? 3.0 : hr < 115 ? 4.5 : hr < 130 ? 6.0 : hr < 145 ? 7.5 : 9.0;
    return { value: hrPts.reduce((a, p) => a + hrMet(p.v), 0) / hrPts.length, source: 'hr' };
  } catch { return { value: null, source: null }; }
}

/**
 * ★ 2026-10-07（用户）：脑力消耗 / 心理压力 详情页的「AI 综合分析」先隐藏。
 *   保留组件与渲染开关，改回 true 即可恢复 —— 不要用删除的方式做临时下线。
 */
const SHOW_AI_BANNER = false;

const META: Record<EnergyType, { name: string; accent: string; sub: string }> = {
  emotion:   { name: '情绪压力', accent: mm.colors.roseCore, sub: '情绪压力' },
  cognitive: { name: '脑力消耗', accent: mm.colors.purpleCore, sub: '认知准备度 · 全天与区间趋势' },
  activity:  { name: '运动消耗', accent: mm.colors.skyCore,  sub: '步数 · 距离 · 活动消耗' },
};

export default function EnergyDetailScreen() {
  // ★ v18.134（审查 04 🟡-5）：订阅 healthStore 版本号 —— backfill 落库后本组件立即重算
  const hsVer = useHealthStoreVersion();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const type = route.params?.type ?? 'emotion';
  const meta = META[type];
  const [range, setRange] = useState<RangeKey>('day');
  const [anchor, setAnchor] = useState<Date>(new Date());
  // ★ 2026-10-09（psychological-stress-preview）：情绪页两个 tab —— 心理压力 / 情绪记录
  const [emoTab, setEmoTab] = useState<'stress' | 'emotion'>('stress');

  // ★ 脑力消耗 周/月/年：先算**一份**区间行数据，Hero 的「平均消耗」与区间卡共用它。
  //   旧写法在这里又手抄了一遍统计循环（且 require 了不存在的 ../lib/sleepPhase），
  //   两处口径一旦漂移就会出现「上面数字和下面图打架」——现在只留一处。
  //   weightedConsumption 与 CognitiveRangeView 内部是同一个函数，数字必然一致。
  const cogRangeRows = useMemo(() => {
    if (type !== 'cognitive' || range === 'day') return null;
    return buildPeriods(range, anchor.getTime()).map(computeCogRow);
  }, [type, range, anchor]);

  const meanCogConsumption = useMemo(() => {
    if (!cogRangeRows) return null;
    return weightedConsumption(cogRangeRows);
  }, [cogRangeRows]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatQuestion, setChatQuestion] = useState<string | undefined>(undefined);
  const openChat = (q: string) => { setChatQuestion(q); setChatVisible(true); };
  // ★ 节流订阅 BLE 状态（rAF 合并，详见 hooks/useRingState）
  const ring = useRingState();
  // ★ 2026-11-05（用户）：把工具页「今天适合短时发力」并进「今日运动建议」——只对 BASE_UI 生效，
  //   PRO_UI 保持原来的「强度 / 主项 / 时长」三格与周期分析文案。
  const { model: energyModel } = useDeviceModel();
  const isBase = energyModel.id === 'BASE_UI';

  // ★ 2026-10-12（用户）：运动消耗·日视图「今日运动建议」——按当前周期相位给处方（与 CyclePhaseCard 同源相位）。
  //   无经期记录（phaseLabel='未记录'）时返回引导语；绝不编造激素/数据。
  const phaseLabel = (ring as any)?.curveStatus?.phaseLabel ?? '未记录';
  const phaseKnown = phaseLabel !== '未记录';
  const workoutAdvice = buildWorkoutAdvice(phaseLabel);
  // ★ 2026-10-12：与工具页「运动建议」共用 collectWorkoutInput + buildTodayWorkout，
  //   抽真实处方（目标/强度/主项/时长）到卡片；无数据（dataDriven=false）时退回引导文案。
  const workoutPlan = useMemo(
    () => (type === 'activity' ? buildTodayWorkout(collectWorkoutInput(ring, Date.now())) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, ring]
  );
  const sportBrief = workoutPlan ? buildSportBrief(phaseLabel, workoutPlan.timeSlot) : null;
  // ★ 2026-11-05：工具页运动建议二级页的「今天适合短时发力 / 保持节奏 / 温和恢复」结论，
  //   与工具页共用 buildTodayWorkout(collectWorkoutInput(...)) 的同一份处方，不会出现两处口径打架。
  const workoutConclusion = workoutPlan
    ? workoutPlan.intensity === 'intense' ? '今天适合短时发力'
      : workoutPlan.intensity === 'moderate' ? '今天适合保持节奏'
        : workoutPlan.intensity === 'recovery' ? '今天适合温和恢复'
          : '今天先等数据同步'
    : '今天先等数据同步';
  const sleepSelForAdvice = useMemo(() => {
    try {
      return healthStore.getSleep(dayKey(Date.now()))
        ?? healthStore.getSleep(dayKey(Date.now() - 86400000)) ?? null;
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring, hsVer]);
  const workoutConclusionSub = sleepSelForAdvice?.score != null
    ? `昨晚睡眠恢复 ${Math.round(sleepSelForAdvice.score)} 分 · ${sportBrief?.reason ?? '按今天的身体状态安排'}`
    : (sportBrief?.reason ?? '睡眠数据待同步，先按今天的身体状态安排');
  // ★ 2026-10-12（用户：「加上你处于什么，比方说经期的什么时候或者什么状态，适宜练什么样的运动，
  //   这一小段分析，不要太多字」）：真实相位 + 周期天 + 今日状态 → 一小段处境分析；未记录经期为 null。
  const curveStatus = (ring as any)?.curveStatus;
  const phaseAnalysis = buildPhaseAnalysis(
    phaseLabel,
    curveStatus?.dayInCycle ?? null,
    curveStatus?.value ?? null,
  );

  // ★ 心理压力 Hero 的日/周/月/年均值（2026-10-07）
  //   与下面的折线图共用 lib/stressDaily 的同一个函数，保证「上面的数字」和「下面的图」不会打架。
  const stressSessionCount = ((ring as any)?.sportSessions?.length ?? 0) as number;
  const meanStress = useMemo(() => (
    // 只有情绪页需要；其余页面直接短路，避免年视图白算 365 天
    type !== 'emotion' ? null
      : rangeStressMean(range, anchor.getTime(), dayKey(anchor.getTime()), (ring as any)?.sportSessions ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [type, range, anchor, stressSessionCount]);

  return (
    <>
    <View style={{ flex: 1 }}>
      {/* v16：详情页全白底（与 Insight/Tools 同款做法），盖住 App 根渐变 */}
      <BgGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
    <ScreenContainer topFadeColor={theme.colors.bgTop}>
      <View style={styles.stack}>
        {/* 顶部返回 + 标题 */}
        <View style={styles.head}>
          {/* ★ 2026-11-07（用户）：运动/活动消耗详情页返回键与其余详情页统一为「圆形白底 + 左箭头」。
              旧写法只有光秃秃一个箭头（styles.back 没有背景色），视觉上像向右箭头、与其它页不一致。 */}
          <BackButton onPress={() => navigation.goBack()} />
          <View style={styles.headText}>
            <Text style={styles.title}>{meta.name}</Text>
          </View>
        </View>

        {/* ★ 2026-10-09（用户硬性要求）：**日/周/月/年切换上方不再放大数字**，
            总体数据改为「时间选择器下方的一张卡」，与预览稿顺序一致（切换 → 选择器 → 数据卡 → 图表）。 */}
        {/* ★ 2026-10-09（exercise-consumption-preview）：运动消耗同样有 日/周/月/年（原先被写死只留日） */}
        <RangeSwitch value={range} onChange={setRange} />
        <DateAnchorPicker value={anchor} onChange={setAnchor} range={range} />

        {/* ★ 2026-10-09（psychological-stress-preview）：情绪详情页两个 tab —— 心理压力 / 情绪记录 */}
        {type === 'emotion' && (
          <View style={styles.tabRow}>
            {(['stress', 'emotion'] as const).map((k) => {
              const on = emoTab === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.tab, on && styles.tabOn]}
                  activeOpacity={0.8}
                  onPress={() => setEmoTab(k)}
                  accessibilityRole="button"
                  accessibilityLabel={k === 'stress' ? '情绪压力' : '情绪记录'}
                >
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>
                    {k === 'stress' ? '情绪压力' : '情绪记录'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 总体数据卡（原 Hero）——
            ① 脑力日视图由下面的「认知准备度」卡承担，不重复显示；
            ② ★ 2026-10-09（用户）：切到「情绪记录」tab 时不显示那个平均分（情绪不做评分） */}
        {!(type === 'cognitive' && range === 'day') && !(type === 'emotion' && emoTab === 'emotion') && (
          <Card padded={false}>
            <View style={styles.pad}>
              <HeroRow type={type} accent={meta.accent} anchor={anchor} ring={ring} range={range} rangeMeanConsumption={range !== 'day' ? meanCogConsumption : null} rangeMeanStress={meanStress} />
            </View>
          </Card>
        )}

        {/* ★ 2026-10-12（用户）：运动消耗·日视图——Hero「整体卡路里」卡下方的「今日运动建议」，
            按当前周期相位给处方；周/月/年不显示（建议天然是「今日」口径）。
            ★ 整卡可点 → 跳工具页「运动建议」（ToolTopic/sport，进入后自动滚到方案卡）。 */}
        {type === 'activity' && range === 'day' && (
          <TouchableOpacity
            style={styles.waCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ToolTopic', { topic: 'sport' })}
            accessibilityRole="button"
            accessibilityLabel="查看今日运动方案"
          >
            <View style={styles.waHead}>
              <Text style={styles.waTitle}>今日运动建议</Text>
              {phaseKnown ? (
                <View style={styles.waPhase}>
                  <Text style={styles.waPhaseText}>{phaseLabel}</Text>
                </View>
              ) : null}
              <View style={{ marginLeft: phaseKnown ? theme.sp(1.5) : 'auto' }}>
                <Icon name="chevronRight" size={16} color={mm.colors.inkFaint} />
              </View>
            </View>
            <Text style={styles.waHeadline}>
              {isBase ? workoutConclusion : (workoutPlan?.dataDriven ? workoutPlan.headline : workoutAdvice.headline)}
            </Text>
            {isBase
              ? <Text style={styles.waAnalysis}>{workoutConclusionSub}</Text>
              : (phaseAnalysis ? <Text style={styles.waAnalysis}>{phaseAnalysis}</Text> : null)}
            {workoutPlan?.dataDriven ? (
              <View style={styles.waStats}>
                {isBase ? (
                  <>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>恢复</Text>
                      <Text style={styles.waStatV}>{sleepSelForAdvice?.score != null ? String(Math.round(sleepSelForAdvice.score)) : '—'}</Text>
                    </View>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>睡眠</Text>
                      <Text style={styles.waStatV}>{sleepSelForAdvice?.total != null ? `${Math.floor(sleepSelForAdvice.total / 60)}h${String(sleepSelForAdvice.total % 60).padStart(2, '0')}` : '—'}</Text>
                    </View>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>建议强度</Text>
                      <Text style={styles.waStatV}>{sportBrief?.gearName === '恢复' ? '低' : sportBrief?.gearName === '平稳' ? '中低' : '中'}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>强度</Text>
                      <Text style={styles.waStatV}>{sportBrief?.gearName ?? '—'}</Text>
                    </View>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>主项</Text>
                      <Text style={styles.waStatV}>{workoutPlan.primaryName}</Text>
                    </View>
                    <View style={styles.waStat}>
                      <Text style={styles.waStatK}>时长</Text>
                      <Text style={styles.waStatV}>{workoutPlan.totalMinutes} 分钟</Text>
                    </View>
                  </>
                )}
              </View>
            ) : (
              <Text style={styles.waDetail}>{workoutAdvice.detail}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* AI 分析：★ 2026-10-07（用户）脑力消耗 / 心理压力 详情页先隐藏，代码保留。
            要恢复：把 SHOW_AI_BANNER 改回 true（运动页本来就不显示）。 */}
        {SHOW_AI_BANNER && type !== 'activity' && <EnergyAiBanner type={type} ring={ring} openChat={openChat} anchor={anchor} />}

        {/* ===== 内容：图在上，数据在下（按锚定日取数） =====
            ★ 2026-10-09：情绪页按 tab 分流（心理压力 = 趋势；情绪记录 = 点阵 + 分布） */}
        {type === 'emotion' && range === 'day' && (
          <EmotionInsightView anchorMs={anchor.getTime()} variant={emoTab === 'emotion' ? 'emotion' : 'stress'} />
        )}
        {type === 'cognitive' && range === 'day' && <CognitiveDetail anchorMs={anchor.getTime()} />}
        {type === 'activity' && range === 'day' && <ActivityDetail ring={ring} navigation={navigation} anchor={anchor} />}

        {range !== 'day' && (type === 'emotion'
          ? emoTab === 'emotion'
            ? <EmotionRangeBars range={range} anchor={anchor} />
            : <StressRangeView range={range} anchor={anchor} ring={ring} />
          : type === 'activity'
            ? <RangeTrendBars type={type} range={range} anchor={anchor} ring={ring} />
            : <CognitiveRangeView range={range} anchor={anchor} rows={cogRangeRows ?? []} />)}

        {/* ★ 本轮（用户）：去掉情绪压力页底部的「行为关联」面板。
            给底部常驻「记录情绪」按钮留白，避免情绪洞察末尾（图例/分析卡）被遮挡 */}
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
/**
 * ★ 2026-10-09（设计稿统一要求）：所有趋势曲线都是**平滑弧线**（Catmull-Rom → 三次贝塞尔），
 *   不是折线。稿里 drawStress / drawStr / drawReadiness / drawCog 全部走 smooth()。
 */
function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** 当日运动会话（★ 真实数据：戒指 sportSessions，按 beginTime 的日期归到锚定日） */
function daySportSessions(ring: any, dk: string): any[] {
  const list = (ring?.sportSessions ?? []) as any[];
  return list.filter((s) => typeof s?.beginTime === 'string' && s.beginTime.slice(0, 10) === dk);
}

/**
 * ★ 2026-10-10（用户）：运动时长 / 运动时心率 的真实来源兜底。
 *   优先级：① 戒指固件自动识别的运动段（sportSessions）→ ② 用户在运动工具页手动记录（sportLog）
 *   → ③ 都没有时，从**当日真实心率 intraday** 推导「活跃分钟 / 运动时心率」（绝不编造运动记录）。
 *   返回 null 表示该日确实无任何运动信号（应显示「—」，不造假）。
 */
function dayExercise(ring: any, dk: string): { minutes: number | null; avgHr: number | null; source: 'ring' | 'manual' | 'hr' | 'steps' | null; count: number } {
  const ringSess = daySportSessions(ring, dk);
  const manual = (todaySportLogs(dk) ?? []) as any[];
  const sessMin =
    ringSess.reduce((a: number, s: any) => a + (s?.totalTime ?? 0), 0) / 60 +
    manual.reduce((a: number, s: any) => a + (s?.totalTime ?? 0), 0) / 60;
  const hrVals = ringSess.map((s: any) => s?.averHeart).filter((v: any) => Number.isFinite(v) && v > 0);
  const count = ringSess.length + manual.length;
  if (sessMin > 0) {
    return {
      minutes: Math.round(sessMin),
      avgHr: hrVals.length ? Math.round(hrVals.reduce((a: number, b: number) => a + b, 0) / hrVals.length) : null,
      source: ringSess.length ? 'ring' : 'manual',
      count,
    };
  }
  // ③ 兜底：真实心率 intraday 推导活跃分钟 + 运动时心率
  try {
    const hrPts = (healthStore.getIntraday('hr', dk) as any[]).filter((p: any) => Number.isFinite(p?.v) && p.v > 30 && p.v < 220);
    if (hrPts.length >= 30) {
      const vals = hrPts.map((p: any) => p.v);
      const resting = Math.min(...vals);
      const thr = Math.max(resting + 25, 90); // 活跃阈值：静息 +25 且不低于 90
      const active = vals.filter((v: number) => v >= thr);
      if (active.length > 0) {
        const spanMin = (hrPts[hrPts.length - 1].t - hrPts[0].t) / 60000;
        const frac = active.length / vals.length;
        const minutes = spanMin > 0 ? Math.round(spanMin * frac) : Math.round(active.length / 6);
        return { minutes: Math.max(1, minutes), avgHr: Math.round(active.reduce((a: number, b: number) => a + b, 0) / active.length), source: 'hr', count };
      }
    }
    // ④ 步数兜底：无任何运动信号但有步数/卡路里时，按步数估算活跃分钟（诚实估算，标注「步数估算」）
    const st = ring?.stepDaily?.[dk];
    const steps = st?.steps ?? 0;
    if (steps > 500) {
      const estMin = Math.max(1, Math.min(180, Math.round(steps / 120)));
      const meanHr = hrPts.length ? Math.round(hrPts.reduce((a: number, b: any) => a + b.v, 0) / hrPts.length) : null;
      return { minutes: estMin, avgHr: meanHr, source: 'steps', count };
    }
  } catch { /* 无数据 */ }
  return { minutes: null, avgHr: null, source: null, count };
}

/** ★ 2026-10-10（用户）：区间（周/月/年）运动聚合——逐日 dayExercise 再汇总，日均分钟 + 平均心率 + 次数 + 最长单次 + 消耗最高日。 */
function aggregateExercise(ring: any, dayKeys: string[]): {
  minutes: number | null; avgHr: number | null; count: number; maxSingleMin: number | null; topCalDay: { k: string; c: number } | null;
} {
  let totalMin = 0, hrSum = 0, hrDays = 0, count = 0, maxSingle = 0;
  let top: { k: string; c: number } | null = null;
  for (const k of dayKeys) {
    const ex = dayExercise(ring, k);
    if (ex.minutes != null) totalMin += ex.minutes;
    if (ex.avgHr != null) { hrSum += ex.avgHr; hrDays += 1; }
    count += ex.count;
    const ringSess = daySportSessions(ring, k);
    const manual = (todaySportLogs(k) ?? []) as any[];
    maxSingle = Math.max(maxSingle, ...ringSess.map((s: any) => (s?.totalTime ?? 0) / 60), ...manual.map((s: any) => (s?.totalTime ?? 0) / 60));
    const c = ring?.stepDaily?.[k]?.calorie ?? 0;
    if (c > 0 && (!top || c > top.c)) top = { k, c };
  }
  const days = dayKeys.length || 1;
  return {
    minutes: totalMin > 0 ? Math.round(totalMin / days) : null,
    avgHr: hrDays > 0 ? Math.round(hrSum / hrDays) : null,
    count,
    maxSingleMin: maxSingle > 0 ? Math.round(maxSingle) : null,
    topCalDay: top,
  };
}

function HeroRow({ type, accent, anchor, ring, range, rangeMeanConsumption, rangeMeanStress }: { type: EnergyType; accent: string; anchor: Date; ring: any; range: RangeKey; rangeMeanConsumption?: number | null; rangeMeanStress?: number | null }) {
  // ★ 2026-11-07（用户）：梅脱格的「!」解释弹层 + healthStore 版本订阅（心率水合后梅脱格立即重算）
  const [metInfoVisible, setMetInfoVisible] = useState(false);
  const hsVer = useHealthStoreVersion();
  // 梅脱今日估算（仅运动消耗页用；随数据水合 / 锚定日变化重算）
  const metEst = useMemo(
    () => (type === 'activity' ? estimateDayMet(dayKey(anchor.getTime())) : { value: null, source: null }),
    [type, anchor, hsVer],
  );
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
    const st = ring?.stepDaily?.[dk];
    // ★ 2026-10-27（用户）：与首页「活动消耗」卡同口径 —— 优先取当日运动段 totalCal 汇总，
    //   无运动段时回退计步 calorie；否则当天有运动时外卡（运动段 kcal）与详情（仅计步 kcal）会不一致。
    const daySport = ((ring as any)?.sportSessions ?? []).filter(
      (s: any) => dayKey(s.beginTime) === dk,
    );
    const daySportCal = daySport.reduce((a: number, s: any) => a + (s.totalCal || 0), 0);
    const cal = daySportCal > 0 ? Math.round(daySportCal) : Math.round(st?.calorie ?? 0);
    const prevCal = ring?.stepDaily?.[dayKey(anchor.getTime() - 86400000)]?.calorie ?? null;
    // ★ 2026-10-09（exercise-consumption-preview .hero .ctx）：↑ / ↓ N% 较昨日（无昨日数据则不显示）
    const delta = prevCal != null && prevCal > 0 ? Math.round(((cal - prevCal) / prevCal) * 100) : null;
    const unitStyle = { fontSize: theme.fontSize.micro, color: theme.colors.textSub };

    // ★ 2026-10-09（exercise-consumption-preview）：周 / 月 / 年 = 区间的**日均**（自然周期内的有效天）
    if (range !== 'day') {
      const todayK = dayKey(Date.now());
      // ★ 2026-10-10（用户·bug）：buildNaturalPeriods 返回的是**当前自然周期内的每一天**（周=7 天 / 月=逐日 / 年=12 个月），
      //   旧实现误取「最后一个子周期」（周=周日 / 月=月末 / 年=12 月），再与今天比较过滤 → 未来日全被滤掉 → curKeys 为空
      //   → Hero 卡的 消耗/步数/距离/运动时长 全「—」（而趋势图逐日取数，所以图有柱、卡没数）。
      //   正确做法：把当前自然周期的所有 dayKey 摊平，再截到「不晚于今天」。
      const curKeys = buildNaturalPeriods(range, anchor.getTime())
        .flatMap((p) => p.dayKeys)
        .filter((x) => x <= todayK);
      const prevKeys = buildPrevNaturalPeriods(range, anchor.getTime())
        .flatMap((p) => p.dayKeys)
        .filter((x) => x <= todayK);
      const mean = (keys: string[], pick: (s: any) => number) => {
        const vals = keys.map((k) => pick(ring?.stepDaily?.[k])).filter((v) => Number.isFinite(v) && (v as number) > 0);
        return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
      };
      const curCal = mean(curKeys, (s) => s?.calorie ?? 0);
      const prevCal = mean(prevKeys, (s) => s?.calorie ?? 0);
      const rangeDelta = curCal != null && prevCal != null && prevCal > 0
        ? Math.round(((curCal - prevCal) / prevCal) * 100)
        : null;
      const RL2: Record<RangeKey, string> = { day: '日均', week: '周', month: '月', year: '年' };
      const activityTitle = `${RL2[range]}平均活动消耗`;
      const activityAnalysis = (() => {
        if (curCal == null) return `这个${RL2[range]}还没有活动数据。戒指还在积累你的运动记录，继续佩戴几天，这里就会显示本${RL2[range]}的日均消耗，并和上个${RL2[range]}做对比。`;
        if (rangeDelta == null) return `这${RL2[range]}日均消耗 ${Math.round(curCal)} 卡路里，暂时还没有上个${RL2[range]}的数据做对比。建议保持每天 30 分钟以上的中低强度活动，让身体规律地动起来。`;
        if (rangeDelta > 0) return `这${RL2[range]}日均消耗 ${Math.round(curCal)} 卡路里，比上个${RL2[range]}多 ${rangeDelta}%，活动量明显上来了。建议顺势维持节奏，注意运动后的拉伸与补水，别一下子加量太多。`;
        if (rangeDelta < 0) return `这${RL2[range]}日均消耗 ${Math.round(curCal)} 卡路里，比上个${RL2[range]}少 ${Math.abs(rangeDelta)}%，近段时间动得偏少。建议从每天快走或居家训练开始，先把习惯捡回来，再慢慢加量。`;
        return `这${RL2[range]}日均消耗 ${Math.round(curCal)} 卡路里，和上个${RL2[range]}基本持平，节奏很稳。建议保持当前安排，穿插一些不同强度的活动，让身体持续有新鲜刺激。`;
      })();
      return (
        <View>
          <Text style={styles.heroTitle}>{activityTitle}</Text>
          <View style={styles.heroWrap}>
            <View style={styles.heroNumRow}>
              <Text style={[styles.heroVal, { color: mm.colors.honeyDeep }]}>
                {curCal != null ? Math.round(curCal) : '—'}
              </Text>
              <Text style={styles.heroUnit}>千卡</Text>
            </View>
            {rangeDelta != null ? (
              <Text style={[styles.heroCtx, { color: rangeDelta >= 0 ? theme.colors.success : theme.colors.danger }]}>
                {rangeDelta >= 0 ? '↑' : '↓'} {Math.abs(rangeDelta)}% 较上{RL2[range] === '周' ? '周' : RL2[range] === '月' ? '月' : '年'}
              </Text>
            ) : null}
          </View>
          {/* ★ 2026-11-06（用户）：①「周平均活动消耗」卡里不再写「运动消耗分析」标题，只留解读文字；
              ② 运动时长/步数/距离 三格移到底部「消耗分析」卡里（见下方 activity 分支）。 */}
          <View style={[styles.pad, { marginTop: theme.sp(2) }]}>
            <Text style={styles.heroAnalysis}>{activityAnalysis}</Text>
          </View>
        </View>
      );
    }

    const ex = dayExercise(ring, dk);
    const durMin = ex.minutes;
    const sessCount = ex.count;
    const activityDayTitle = '今日活动消耗';
    const activityDayAnalysis = (() => {
      if (cal === 0) return '今天还没有活动数据。出门走一走，或把戒指同步一下，这里就会显示你今天的消耗，并和昨天做对比。';
      if (prevCal == null || prevCal <= 0) return `今天消耗 ${cal} 卡路里，暂时还没有昨天的记录做对比。建议今天安排 30 分钟左右的活动，步数、心率都会被记下来。`;
      if (delta != null && delta > 0) return `今天消耗 ${cal} 卡路里，比昨天多 ${delta}%，动得比平时多。建议趁状态不错，把运动后的拉伸和补水安排上，给身体一个缓冲。`;
      if (delta != null && delta < 0) return `今天消耗 ${cal} 卡路里，比昨天少 ${Math.abs(delta)}%，活动量偏少。建议晚些时候补一段快走或居家训练，不用多，先把今天的量补回来。`;
      return `今天消耗 ${cal} 卡路里，和昨天差不多，节奏很稳。建议保持这个量级，明天可以换个强度或项目，让身体持续受益。`;
    })();
    return (
      <>
        <View>
          <Text style={styles.heroTitle}>{activityDayTitle}</Text>
        <View style={styles.heroWrap}>
          {/* ★ 2026-10-12（用户：「27 旁边写卡路里，去掉下面那个今日消耗 · kcal」）：
              单位并入大数字旁（基线对齐），原下方 heroLab「今日消耗 · kcal」标签行删除。 */}
          <View style={styles.heroNumRow}>
            <Text style={[styles.heroVal, { color: mm.colors.honeyDeep }]}>{cal}</Text>
            <Text style={styles.heroUnit}>卡路里</Text>
          </View>
          {delta != null ? (
            <Text style={[styles.heroCtx, { color: delta >= 0 ? theme.colors.success : theme.colors.danger }]}>
              {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% 较昨日
            </Text>
          ) : null}
        </View>
        <Text style={styles.heroAnalysis}>{activityDayAnalysis}</Text>
        {/* ★ 2026-11-07（用户）：运动时长这枚精简版戒指根本没有（无运动时段传感器，此前一直是「—/估算」），
            整格删掉；步数 / 距离 两格自动变宽，不再挤三列。
            ★ 同日：按用户要求加回第三格「梅脱」，右侧感叹号点开底部解释弹层。 */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>步数</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {((st?.steps ?? 0) / 1000).toFixed(1)}{<Text style={unitStyle}> k</Text>}
            </Text>
            <Text style={styles.statSub}>含日常</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>距离</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {(st?.distance ?? 0).toFixed(1)}{<Text style={unitStyle}> km</Text>}
            </Text>
            <Text style={styles.statSub}>今日累计</Text>
          </View>
          <View style={styles.statCell}>
            <View style={styles.statLabelRow}>
              <Text style={styles.statLabel}>梅脱</Text>
              <TouchableOpacity
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setMetInfoVisible(true)}
              >
                <View style={styles.metInfoDot}>
                  <Text style={styles.metInfoTxt}>!</Text>
                </View>
              </TouchableOpacity>
            </View>
            <Text style={styles.statValue} numberOfLines={1}>
              {metEst.value != null ? metEst.value.toFixed(1) : '—'}
            </Text>
            <Text style={styles.statSub}>
              {metEst.source === 'met' ? '戒指实测' : metEst.source === 'hr' ? '心率估算' : '暂无数据'}
            </Text>
          </View>
        </View>
        </View>

        {/* ★ 2026-11-07（用户）：点「梅脱」旁的感叹号，从底部拉起解释弹层 */}
        <Modal visible={metInfoVisible} transparent animationType="slide" onRequestClose={() => setMetInfoVisible(false)}>
          <TouchableOpacity style={styles.metSheetOverlay} activeOpacity={1} onPress={() => setMetInfoVisible(false)}>
            <TouchableOpacity style={styles.metSheet} activeOpacity={1}>
              <View style={styles.metSheetGrab} />
              <Text style={styles.metSheetTitle}>什么是「梅脱」？</Text>
              <Text style={styles.metSheetBody}>
                梅脱（MET，代谢当量）是衡量活动强度的通用单位：1 梅脱约等于安静坐着时的能量消耗强度，数值越高，活动越剧烈。
              </Text>
              <Text style={styles.metSheetBody}>
                {'· 1–3 梅脱：轻度（散步、家务）\n· 3–6 梅脱：中度（快走、骑行）\n· 6–9 梅脱：较高（跑步、爬楼）\n· 9 以上：高强度（冲刺、球类）'}
              </Text>
              <Text style={styles.metSheetNote}>
                当前精简版戒指不直接回传梅脱，这里的数值由当日心率变化估算，仅供参考。
              </Text>
              <TouchableOpacity style={styles.metSheetBtn} onPress={() => setMetInfoVisible(false)}>
                <Text style={styles.metSheetBtnTxt}>知道了</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </>
    );
  }

  // ★★ Hero：整个 App 里「脑力消耗」只有这一个定义（2026-10-07 用户定口径）
  //     **百分比** = (晨起准备度 − 睡前准备度) / 晨起准备度 × 100；
  //     无睡眠 → 回退 (当日峰 − 当日谷) / 峰 × 100，并在下方标注来源。
  //     日视图直接算当天；周/月/年由外层传入同一份 rows 的加权均值 —— 两处必然一致。
  //     ⚠ 不是点数：同样是掉 20 点，从 90→70 和从 40→20 完全不是一回事。
  if (type === 'cognitive') {
    const dayInfo = range === 'day' ? dailyBrainUsed(report, reportMs) : null;
    const consumedPct = range === 'day' ? dayInfo?.usedPct ?? null : rangeMeanConsumption;
    const basisPv = range === 'day' ? dayInfo?.basis === 'peakvalley' : false;
    // 消耗占比越大 = 越累 → 红；≤20% 轻松，20–35% 中等，>35% 偏重
    const conColor = consumedPct != null
      ? consumedPct <= 20 ? theme.colors.success
        : consumedPct <= 35 ? theme.colors.warn
          : theme.colors.danger
      : mm.colors.ink;
    const cogTitle = range === 'day' ? '今日脑力消耗' : `${RANGE_DEF[range].label}平均脑力消耗`;
    const cogAnalysis = (() => {
      if (consumedPct == null) return '今天还没有足够数据算出脑力消耗，多戴一段时间会更准。';
      if (consumedPct <= 20) return `脑力消耗 ${consumedPct}%，今天用得轻，状态还宽裕。`;
      if (consumedPct <= 35) return `脑力消耗 ${consumedPct}%，中等强度用脑，注意休息节奏。`;
      return `脑力消耗 ${consumedPct}%，今天用脑偏重，晚上早点歇一歇。`;
    })();
    return (
      <View>
        <Text style={styles.heroTitle}>{cogTitle}</Text>
        <View style={styles.hero}>
          {consumedPct != null ? (
            <>
              <Text style={[styles.heroVal, { color: conColor }]}>{consumedPct}</Text>
              <Text style={styles.heroUnit}>
                {range === 'day' ? '% · 今日脑力消耗' : `% · ${RANGE_DEF[range].label}平均脑力消耗`}
              </Text>
              {basisPv && (
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) }}>
                  无睡眠记录，按当日峰谷估算
                </Text>
              )}
            </>
          ) : (
            /* ★ 2026-10-10（用户）：无数据保留单位与说明，数字「—」，整卡不许消失 */
            <>
              <Text style={[styles.heroVal, { color: mm.colors.ink }]}>—</Text>
              <Text style={styles.heroUnit}>
                {range === 'day' ? '% · 今日脑力消耗' : `% · ${RANGE_DEF[range].label}平均脑力消耗`}
              </Text>
            </>
          )}
        </View>
        <Text style={styles.heroAnalysis}>{cogAnalysis}</Text>
      </View>
    );
  }
  // ★ 心理压力 Hero（2026-10-07 用户要求：日/周/月/年都有总体数据）
  //   数字 = lib/stressDaily 的日/周期均值，**与首页「心理压力」卡片同源**（stressScale.value）。
  //   口径必须写明「0-100 相对你自己平时」，否则会被读成绝对分数。
  if (type === 'emotion') {
    const RL: Record<RangeKey, string> = { day: '日均', week: '周平均', month: '月平均', year: '年平均' };
    const v = rangeMeanStress;
    const band = v == null ? null
      : v >= 67 ? { t: '压力偏高', c: theme.colors.danger }
        : v >= 34 ? { t: '压力中等', c: theme.colors.warn }
          : { t: '压力偏低', c: theme.colors.success };
    const emoTitle = range === 'day' ? '今日情绪压力' : '近期情绪压力';
    const emoAnalysis = (() => {
      if (v == null) return '今天还没有压力数据，同步后这里会显示你的压力水平。';
      if (v >= 67) return `压力偏高（${v}/100），今天节奏紧，找点空档缓一缓。`;
      if (v >= 34) return `压力中等（${v}/100），在正常范围，留意别让它往上走。`;
      return `压力偏低（${v}/100），状态松弛，保持就好。`;
    })();
    return (
      <View>
        <Text style={styles.heroTitle}>{emoTitle}</Text>
        {/* ★ 2026-10-09（psychological-stress-preview .hero）：大数字 + 右下状态语（压力中等）+ 下方标签 */}
        <View style={styles.heroWrap}>
          {v != null ? (
            <>
              <View>
                <Text style={[styles.heroVal, { color: band!.c }]}>{v}</Text>
                <Text style={styles.heroUnit}>/100 · 压力{RL[range]} · 50=平时</Text>
              </View>
              <Text style={[styles.heroCtx, { color: band!.c }]}>{band!.t}</Text>
            </>
          ) : (
            /* ★ 2026-10-10（用户）：无数据保留单位与基线说明，数字「—」 */
            <>
              <View>
                <Text style={styles.heroVal}>—</Text>
                <Text style={styles.heroUnit}>/100 · 压力{RL[range]} · 50=平时</Text>
              </View>
              <Text style={[styles.heroCtx, { color: theme.colors.textSub }]}>暂无数据</Text>
            </>
          )}
        </View>
        <Text style={styles.heroAnalysis}>{emoAnalysis}</Text>
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
  // ★ 2026-10-09（brain-readiness-preview）：趋势卡下方「详细数据」折叠，默认收起
  const [cogDetailsOpen, setCogDetailsOpen] = useState(false);

  const hasData = report.sampleCount >= 2;

  // ★ 2026-10-10（用户）：没数据也不能把「认知准备度」整卡吞掉 ——
  //   主卡照常渲染（大数字「—」、预测高峰/低谷「—」但标签与档位说明保留），
  //   趋势图用空骨架（24 根空柱 + 三档轴，HourHistogram/ReadinessTrendChart 内建空态），
  //   详细数据行全部「—」。不放演示数据——示意图只说明「这里会有图表」，不冒充任何真实值。
  const trendPoints = hasData
    ? ready.points
    : Array.from({ length: 24 }, (_, h) => ({ hour: h, score: 0, hasData: false }));

  const reserve = report.brainReserve;
  const used = report.brainUsed;
  const remain = report.brainRemaining;
  // ★ 2026-10-09（brain-readiness-preview）：准备度三档（与 ReadinessTrendChart 同源阈值 40 / 70）
  const band = remain == null
    ? null
    : remain >= 70
      ? { text: '充沛', short: '还能冲一会', color: theme.colors.success }
      : remain >= 40
        ? { text: '中等', short: '还有一半', color: theme.colors.warn }
        : { text: '偏低', short: '该歇会儿了', color: theme.colors.danger };
  const rhythmNote = report.forecast?.rhythmR2 != null
    ? (report.forecast.rhythmR2 >= 0.6 ? '节律稳，这两个时段基本准' : report.forecast.rhythmR2 >= 0.3 ? '节律还不够稳，这两个时段仅供参考' : '最近节律波动大，预测只能当个参考')
    : '再连续戴几天（满 7 天），就能摸出你的节律';

  return (
    <>
      {/* ① 认知准备度（★ 2026-10-09 按 brain-readiness-preview 重做：
            大数字 + 实际高峰/节律峰值 行 + 预测高峰/低谷 duo + 一句口径说明） */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={styles.ctitleRow}>
            <Text style={styles.ctitle}>认知准备度</Text>
            <Text style={styles.ctitleSmall}>{dayKeyOfLabel(anchorMs)}</Text>
          </View>

          <View style={styles.heroWrap}>
            <View>
              <Text style={[styles.heroBig, { color: band?.color ?? mm.colors.ink }]}>{remain ?? '—'}</Text>
              <Text style={styles.heroLab}>/100 · 当前认知准备度</Text>
            </View>
            <Text style={[styles.heroCtx, { color: band?.color ?? theme.colors.textSub }]}>
              {band ? `${band.text} · ${band.short}` : '暂无数据'}
            </Text>
          </View>

          {/* ★ 2026-11-03（用户·统一 hero 结构）：ctitle 已在上方，这里补数字下方的短 AI 分析 */}
          <Text style={styles.heroAnalysis}>
            {(() => {
              if (remain == null) return '今天还没有足够数据算出认知准备度，多戴一段时间会更准。';
              if (remain >= 70) return `认知准备度 ${remain}，现在精力充沛，适合安排烧脑的事。`;
              if (remain >= 40) return `认知准备度 ${remain}，还有一半左右，重要的事趁早做。`;
              return `认知准备度 ${remain}，偏低，简单任务或休息更合适。`;
            })()}
          </Text>

          {/* ★ 2026-10-09（用户）：不要多加的「实际高峰 / 节律峰值」两行，按稿只留 hero + duo + 说明 */}

          <View style={styles.duoRow}>
            <View style={[styles.duoCell, { backgroundColor: theme.colors.success + '1A' }]}>
              <Text style={styles.duoLab}>认知高峰 · 预测</Text>
              <Text
                style={[styles.duoTime, { color: report.forecast?.peakSpan ? theme.colors.success : theme.colors.textSub }]}
              >
                {report.forecast?.peakSpan ? peakSpanText(report.forecast.peakSpan) : '—'}
              </Text>
              <Text style={styles.duoSub}>最适合烧脑</Text>
            </View>
            <View style={[styles.duoCell, { backgroundColor: theme.colors.danger + '1A' }]}>
              <Text style={styles.duoLab}>认知低谷 · 预测</Text>
              <Text
                style={[styles.duoTime, { color: report.forecast?.troughSpan ? theme.colors.danger : theme.colors.textSub }]}
              >
                {report.forecast?.troughSpan ? peakSpanText(report.forecast.troughSpan) : '—'}
              </Text>
              <Text style={styles.duoSub}>轻度任务 / 休息</Text>
            </View>
          </View>

          <Text style={styles.axisNoteLeft}>
            早上储备 {reserve ?? '—'}，现在用掉 {used ?? '—'} · {rhythmNote}
          </Text>
        </View>
      </Card>

      {/* ② 认知准备度 · 全天趋势（折线 + 三档带 + 图例 + 轴说明 + 「详细数据」折叠） */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>认知准备度 · 全天趋势</Text>
          {/* ★ 2026-10-10（用户）：日视图与周/月/年图等高 —— 周/月/年（CognitiveRangeView）已是 L 档 240，
                日视图原先 180 差太多；详情页主趋势统一 L 档（chart-size-unified-spec 规则 1）。 */}
          <ReadinessTrendChart
            chartH={chart.h.l}
            points={trendPoints}
            sleepWindow={report.sleepWindow ?? null}
            nowHour={isToday ? new Date(reportNowMsForDay(anchorMs)).getHours() : null}
          />
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.danger }]} />
              <Text style={styles.legendText}>偏低</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.warn }]} />
              <Text style={styles.legendText}>适中</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: theme.colors.success }]} />
              <Text style={styles.legendText}>充沛</Text>
            </View>
          </View>
          <Text style={styles.axisNote}>
            纵轴 = 准备度 0–100（越高越转得动）· 横轴 = 一天 24h · 夜间为睡眠，不展示数据
          </Text>

          <TouchableOpacity
            style={styles.mhRow}
            activeOpacity={0.7}
            onPress={() => setCogDetailsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={cogDetailsOpen ? '收起详细数据' : '展开详细数据'}
          >
            <Text style={styles.mhLabel}>详细数据</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.mhCount}>3 项</Text>
              <View style={[styles.mhChev, cogDetailsOpen && styles.mhChevOpen]} />
            </View>
          </TouchableOpacity>
          {cogDetailsOpen ? (
            <View style={styles.rowsBox}>
              <View style={styles.rowItem}>
                <Text style={styles.rowK}>高峰时段</Text>
                <Text style={styles.rowV}>{ready.peakHour != null ? `${String(ready.peakHour).padStart(2, '0')}:00` : '—'}</Text>
              </View>
              <View style={styles.rowItem}>
                <Text style={styles.rowK}>低谷时段</Text>
                <Text style={styles.rowV}>{ready.troughHour != null ? `${String(ready.troughHour).padStart(2, '0')}:00` : '—'}</Text>
              </View>
              <View style={[styles.rowItem, styles.rowItemLast]}>
                <Text style={styles.rowK}>周期性强度</Text>
                <Text style={styles.rowV}>
                  {report.forecast?.rhythmR2 != null ? Number(report.forecast.rhythmR2).toFixed(2) : '—'}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </Card>
    </>
  );
}

/** 「今天 / 10月9日」——卡片副标题用（brain-readiness-preview .ctitle small） */
function dayKeyOfLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
    ? '今天'
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

// 周/月/年 分桶：★自然日历周期（周=本周一~周日 / 月=本月1号~月末 / 年=今年1月~12月）
// ★ 2026-10-07（用户实锤）：**横轴保持完整自然周期**（周=一~日 / 月=1~月末 / 年=1~12月），
//   仅周期内**未来的天不参与统计**（未来日无样本，hasData=false，不画柱子）。
//   不能把整个未来周期从横轴删掉 —— 否则横坐标就不是「自然的周/月/年」了。
function buildPeriods(range: RangeKey, anchorMs: number): { label: string; dayKeys: string[] }[] {
  if (range === 'day') return [];
  const todayK = dayKey(Date.now());
  return buildNaturalPeriods(range, anchorMs)
    .map((p) => ({ ...p, dayKeys: p.dayKeys.filter((dk) => dk <= todayK) }));
}

// 横轴刻度与 chartAxis 同源：月=1/5/10/15/20/25/30，年=1/3/5/7/9/11月，周全标
function showXLabel(range: RangeKey, i: number, label: string): boolean {
  if (range === 'week') return true;
  if (range === 'month') return isMonthTickDay(Number(label));
  if (range === 'year') return isYearTickMonth(i);
  return true;
}

interface CogPeriodRow {
  /**
   * ★ 本周期「日均脑力消耗百分比」= (晨起 − 睡前) / 晨起 × 100 —— **唯一主数字**（2026-10-07 用户口径）。
   *   与首页「脑力消耗」卡片同一个算式：`dailyBrainUsed().usedPct`。
   *   旧的点数口径（晨起 − 睡前的绝对差值）已废弃：同样是掉 20 点，
   *   从 90 掉到 70 和从 40 掉到 20 完全不是一回事，只有百分比才可比。
   */
  consumedPct: number | null;
  /** 点数差额（保留给柱状图取中位数用，UI 不再直接展示） */
  consumed: number | null;
  /** 参与该均值的有效天数（用于跨周期加权，避免月长短不同导致偏差） */
  days: number;
  /** 取数口径：sleep=有睡眠归档（晨起/睡前）· peakvalley=无睡眠（当日峰谷） */
  basis: 'sleep' | 'peakvalley' | null;
  /** 柱子上沿：有睡眠 = 当日晨起准备度均值；无睡眠 = 当日峰值均值 */
  hi: number | null;
  /** 柱子下沿：有睡眠 = 当日睡前准备度均值；无睡眠 = 当日谷值均值 */
  lo: number | null;
  hasData: boolean;
}

/**
 * 单周期认知指标（★ 2026-10-07 改「真正用了多少脑」口径）
 *  - consumed = 上沿 − 下沿，**点数**：
 *      有睡眠归档 → 晨起准备度 − 睡前准备度（dailyBrainUsed）
 *      无睡眠归档 → 当日峰 − 当日谷（回退，UI 需标注）
 *  - 同一周期内若混合：优先只用有睡眠的天，避免两种口径加在一起。
 *  - hasData 只认「该周期至少一天有 ≥2 个真实样本」。
 */
function computeCogRow(p: { dayKeys: string[] }): CogPeriodRow {
  type Day = { basis: 'sleep' | 'peakvalley'; hi: number | null; lo: number | null; pct: number | null };
  const days: Day[] = [];
  let any = false;
  for (const dk of p.dayKeys) {
    const midMs = (parseDayKey(dk) || 0) + 12 * 3600 * 1000;
    const rep = computeCognitiveLoadReport(midMs);
    if (!rep || rep.sampleCount < 2) continue;
    any = true;
    const d = dailyBrainUsed(rep, midMs);
    if (d.used == null || d.basis == null) continue;
    days.push(d.basis === 'sleep'
      ? { basis: 'sleep', hi: d.morning, lo: d.preSleep, pct: d.usedPct }
      : { basis: 'peakvalley', hi: d.peak, lo: d.valley, pct: d.usedPct });
  }
  if (days.length === 0) return { consumedPct: null, consumed: null, days: 0, basis: null, hi: null, lo: null, hasData: any };

  // 口径优先：有睡眠的天才用它；全都没有 → 才用峰谷天
  const sleepDays = days.filter((d) => d.basis === 'sleep');
  const src = sleepDays.length > 0 ? sleepDays : days;
  const mean = (pick: (d: Day) => number | null): number | null => {
    const v = src.map(pick).filter((x): x is number => x != null);
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  // ★ 百分比先按天算、再取平均（不是「用均值算一次」）——
  //   否则某天从 30 掉到 10（67%）会被另一天平掉，看不出真实强度。
  const meanPct = mean((d) => d.pct);
  const hi = mean((d) => d.hi);
  const lo = mean((d) => d.lo);
  return {
    consumedPct: meanPct != null ? Math.round(meanPct) : null,
    consumed: hi != null && lo != null ? Math.round(Math.max(0, hi - lo)) : null,
    days: src.length,
    basis: sleepDays.length > 0 ? 'sleep' : 'peakvalley',
    hi: hi != null ? Math.round(hi) : null,
    lo: lo != null ? Math.round(lo) : null,
    hasData: any,
  };
}

/** 跨周期加权平均消耗%（按有效天数加权，避免「月大/月小」把均值带偏） */
function weightedConsumption(rows: CogPeriodRow[]): number | null {
  let sum = 0, n = 0;
  for (const r of rows) {
    if (r.consumedPct == null) continue;
    sum += r.consumedPct * Math.max(1, r.days);
    n += Math.max(1, r.days);
  }
  return n > 0 ? Math.round(sum / n) : null;
}

/* ========== 脑力消耗：周/月/年 = 准备度趋势 + 疲劳三档占比 + 对比 ========== */
// ★ rows 由父组件传入：与 Hero 的「平均消耗」共用同一份统计，杜绝上下数字打架
function CognitiveRangeView({ range, anchor, rows }: { range: RangeKey; anchor: Date; rows: CogPeriodRow[] }) {
  const anchorMs = anchor.getTime();
  const periods = useMemo(() => buildPeriods(range, anchorMs), [range, anchorMs]);

  const prevPeriods = useMemo(() => buildPrevNaturalPeriods(range, anchorMs), [range, anchorMs]);
  const prevRows = useMemo(() => prevPeriods.map(computeCogRow), [prevPeriods]);

  // ★ 2026-11-03：上一周期标签统一走 lib/periodLabels（上周/上个月/去年，全 App 唯一口径）
  const prevLabel = previousPeriodLabel(range);

  // 布局：★与日视图 StressTrendChart 同款 —— onLayout 取真实卡片宽度，viewBox 按真实像素 1:1 画。
  //   旧做法：固定 viewBox(320) + 固定 height，默认 preserveAspectRatio 会按宽度缩进一个更高的盒子，
  //   上下各留一大块空白 → 图看着又小又空（用户实锤「周月年图太小，要跟日一样」）。
  const n = periods.length;
  const [chartW, setChartW] = useState(0);
  const VW = chartW > 0 ? chartW : 320;  // 真实卡片内宽（onLayout 前先给 320 兜底）
  const AX_L = 26, AX_R = 6;             // 左侧留纵轴刻度、右留边
  const plotTop = 16, xLabelH = 20;
  // ★ 2026-10-10（规范）：总高 280 → L 档 240（装饰带 36 ≤ 50 预算）
  const plotH = chart.h.l - plotTop - xLabelH;
  const chartH = plotTop + plotH + xLabelH;
  const step = (VW - AX_L - AX_R) / n;  // 每个周期格宽
  const cxOf = (i: number) => AX_L + i * step + step / 2;
  const yOf = (v: number) => plotTop + (1 - v / 100) * plotH;

  const hasAny = rows.some((r) => r.hasData);
  // ★ 主指标只剩一个：加权日均消耗点数（与顶部 Hero 同源，杜绝上下打架）
  const meanConsumed = weightedConsumption(rows);
  const prevMeanConsumed = weightedConsumption(prevRows);
  const consumedDelta = meanConsumed != null && prevMeanConsumed != null ? meanConsumed - prevMeanConsumed : null;
  // 有多少个周期是靠「无睡眠 → 峰谷」估出来的，脚注必须说实话
  const pvPeriods = rows.filter((r) => r.basis === 'peakvalley' && r.consumed != null).length;
  const dominantPv = rows.length > 0 && pvPeriods === rows.filter((r) => r.consumed != null).length;

  const grid = [0, 25, 50, 75, 100];

  return (
    <View style={{ gap: theme.space.md }}>
      {/* ★ 2026-11-07（间距统一·A 方案）：子组件内多卡包 gap:space.md，去掉零散 mt，与全屏模块间距一致 */}
      {/* 区间卡：每日脑力消耗（上沿 晨起 / 下沿 睡前，柱高 = 当天真正用掉的量） */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(1) }}>
            <Text style={styles.chartTitle}>脑力消耗趋势图</Text>
            <View style={{ flexDirection: 'row', gap: theme.sp(2) }}>
              {(dominantPv
                ? [['当日峰', mm.colors.limeMid], ['当日谷', mm.colors.purpleDeep]]
                : [['晨起', mm.colors.limeMid], ['睡前', mm.colors.purpleDeep]]).map(([t, c]) => (
                <View key={t as string} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
                  <View style={{ width: theme.sp(2.2), height: theme.sp(2.2), borderRadius: chart.barRadius, backgroundColor: c as string }} />
                  <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ width: '100%' }} onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
          <Svg viewBox={`0 0 ${VW} ${chartH}`} width={VW} height={chartH}>
            {grid.map((v) => {
              const y = yOf(v);
              return (
                <G key={v}>
                  <Line x1={AX_L} y1={y} x2={VW - AX_R} y2={y}
                    stroke={chart.grid} strokeWidth={chart.lw.grid}
                    strokeDasharray={v === 0 ? undefined : chart.dash.grid} />
                  <SvgText x={AX_L - 4} y={y + 3} textAnchor="end" fontSize={chart.axisFont} fill={theme.colors.textSub}>{v}</SvgText>
                </G>
              );
            })}
            {/* 消耗区间柱：每周期一根，柱高 = 该周期的日均消耗点数
                上沿 = 晨起准备度（无睡眠日时为当日峰），下沿 = 睡前准备度（无睡眠日时为当日谷） */}
            {rows.map((r, i) => {
              const x = cxOf(i) - step * 0.3;
              const bw = step * 0.6;
              if (r.hi == null || r.lo == null) {
                // ★ 无数据 / 未来周期（现在横轴保留完整自然周期，会出现今天之后的日子）：
                //   不画任何占位元素（用户口径：没数据就不画，不给看着像有数据的假值）
                return null;
              }
              const yTop = yOf(r.hi);
              const yBot = yOf(r.lo);
              return (
                <G key={i}>
                  <Rect x={x} y={yTop} width={bw} height={Math.max(1.5, yBot - yTop)}
                    fill={mm.colors.purpleCore} rx={chart.barRadius} />
                  <Circle cx={cxOf(i)} cy={yTop} r={chart.dot.radius} fill={mm.colors.limeMid} />
                  <Circle cx={cxOf(i)} cy={yBot} r={chart.dot.radius} fill={mm.colors.purpleDeep} />
                </G>
              );
            })}
            {periods.map((p, i) => (
              <SvgText key={i} x={cxOf(i)} y={chartH - 5} textAnchor="middle" fontSize={chart.axisFont} fill={theme.colors.textSub}>{showXLabel(range, i, p.label) ? p.label : ''}</SvgText>
            ))}
          </Svg>
          </View>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            {dominantPv
              ? `每根柱 = 该${RANGE_DEF[range].label}内「每天峰 − 谷」的均值 · 消耗 ${meanConsumed ?? '—'}% /天`
              : `每根柱 = 该${RANGE_DEF[range].label}内「每天晨起 − 睡前」的均值 · 消耗 ${meanConsumed ?? '—'}% /天`}
            {pvPeriods > 0 && !dominantPv ? `（其中 ${pvPeriods} 个${RANGE_DEF[range].label}无睡眠记录，按当日峰谷估算）` : ''}
            {dominantPv ? ' · 本区间没有睡眠记录，暂无法用「晨起−睡前」口径' : ''}
          </Text>
        </View>
      </Card>

      {/* 对比卡：只比「每天用了多少脑」这一个量（准备度均值已被否决，无意义） */}
      {hasAny && prevMeanConsumed != null && meanConsumed != null && (
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.chartTitle}>对比{prevLabel}</Text>
            {/* ★ 2026-10-09（brain-readiness-preview .cmpCard）：大数字 30 + 单位 + 右侧变化量 一行式 */}
            <View style={styles.cmpCardRow}>
              <Text style={styles.cmpBig}>{meanConsumed}</Text>
              <Text style={styles.cmpUnit}>% /天</Text>
              {consumedDelta != null && (
                // ★ 方向：消耗得越少越从容 → 占比上升（更累）才是红的那个
                <Text style={[styles.cmpDelta, { color: consumedDelta <= 0 ? theme.colors.success : theme.colors.danger }]}>
                  {consumedDelta > 0 ? '↑' : consumedDelta < 0 ? '↓' : '→'} {Math.abs(consumedDelta)}
                </Text>
              )}
            </View>
            <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.fontSize.micro * 1.55 }}>
              {consumedDelta! > 0
                ? `这个周期每天比上一个多用掉 ${consumedDelta} 个百分点的脑力，消耗在往上走，晚上记得把觉睡够。`
                : consumedDelta! < 0
                  ? `这个周期每天比上一个省下 ${Math.abs(consumedDelta!)} 个百分点的脑力，节奏更从容了。`
                  : `这个周期每天的脑力消耗和${prevLabel}差不多。`}
            </Text>
          </View>
        </Card>
      )}
    </View>
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

/* ========== 心理压力：周/月/年 折线趋势图（2026-10-07 新增）==========
 *  - 数据：lib/stressDaily.buildStressRangeSeries，**与首页「心理压力」卡片同源**
 *    （都读 computeEmotionalStress().stressScale.value），避免两处数字打架。
 *  - 周 → 7 个日点；月 → 每天一个点；年 → 12 个月点。
 *  - 背景带沿用 StressTrendChart 的低/中/高三档（34 / 67 分界），两图视觉一致。
 */
function StressRangeView({ range, anchor, ring }: { range: RangeKey; anchor: Date; ring: any }) {
  const anchorMs = anchor.getTime();
  const sessionCount = ((ring as any)?.sportSessions?.length ?? 0) as number;
  const rows = useMemo(
    () => buildStressRangeSeries(range, anchorMs, (ring as any)?.sportSessions ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, anchorMs, sessionCount],
  );

  const n = rows.length;
  const [chartW, setChartW] = useState(0);
  const VW = chartW > 0 ? chartW : 320;  // ★ 同 CognitiveRangeView：按真实卡片宽度 1:1 画
  const AX_L = 26, AX_R = 16;            // 右留多一点：放「高/中/低」标注
  // ★ 几何与 `CognitiveRangeView` 完全一致（总高 280 = 日视图同高），否则两页图高不一致。
  const plotTop = 16, xLabelH = 20;
  // ★ 2026-10-10（规范）：总高 280 → L 档 240
  const plotH = chart.h.l - plotTop - xLabelH;
  const chartH = plotTop + plotH + xLabelH;
  const step = (VW - AX_L - AX_R) / Math.max(1, n);
  const cxOf = (i: number) => AX_L + i * step + step / 2;
  const yOf = (v: number) => plotTop + (1 - v / 100) * plotH;

  const vals = rows.map((r) => r.value).filter((v): v is number => v != null);
  if (n === 0 || vals.length === 0) {
    return (
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.chartTitle}>情绪压力趋势图</Text>
          <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
            这{RANGE_DEF[range].label}还没有可用于判定的采样
          </Text>
        </View>
      </Card>
    );
  }
  const mean = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const max = Math.max(...vals), min = Math.min(...vals);
  const maxRow = rows.reduce((a, b) => ((b.value ?? -1) > (a.value ?? -1) ? b : a));
  const minRow = rows.reduce((a, b) => ((b.value ?? 999) < (a.value ?? 999) ? b : a));

  return (
    <Card padded={false}>
      <View style={styles.pad}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.sp(0.5) }}>
          <Text style={styles.chartTitle}>情绪压力趋势图</Text>
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>
            {RANGE_DEF[range].label}平均 {mean}
          </Text>
        </View>
        <View style={{ width: '100%' }} onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
        <Svg viewBox={`0 0 ${VW} ${chartH}`} width={VW} height={chartH}>
          {/* 三档背景带：★ 2026-10-09（psychological-stress-preview drawStr）阈值 40 / 70、
              opacity 0.07 —— 与日视图 StressTrendChart 同源（原先 34/67、0.08，跟日视图对不上） */}
          {[
            { hi: 100, lo: 70, color: theme.colors.danger },
            { hi: 70, lo: 40, color: theme.colors.warn },
            { hi: 40, lo: 0, color: theme.colors.success },
          ].map((b, i) => (
            <Rect key={'sband' + i} x={AX_L} y={yOf(b.hi)}
              width={VW - AX_L - AX_R} height={Math.max(0, yOf(b.lo) - yOf(b.hi))}
              fill={b.color} opacity={0.07} />
          ))}
          {[0, 25, 50, 75, 100].map((v) => (
            <G key={'sg' + v}>
              <Line x1={AX_L} y1={yOf(v)} x2={VW - AX_R} y2={yOf(v)}
                stroke={chart.grid}
                strokeWidth={chart.lw.grid} strokeDasharray={v === 0 ? undefined : chart.dash.grid} />
              <SvgText x={AX_L - 4} y={yOf(v) + 3} textAnchor="end" fontSize={chart.axisFont} fill={theme.colors.textSub}>{v}</SvgText>
            </G>
          ))}
          {/* 右侧档位标注 */}
          {[
            { label: '高', v: 84, color: theme.colors.danger },
            { label: '中', v: 50, color: theme.colors.warn },
            { label: '低', v: 17, color: theme.colors.success },
          ].map((b) => (
            <SvgText key={'slv' + b.label} x={VW - AX_R + 3} y={yOf(b.v) + 3}
              textAnchor="start" fontSize={chart.axisFont} fill={b.color} fontWeight="600">{b.label}</SvgText>
          ))}

          {/* 区间均值参考线：★ 稿里虚线是 bad 色（#C9598A dashed，opacity 0.7） */}
          <Line x1={AX_L} y1={yOf(mean)} x2={VW - AX_R} y2={yOf(mean)}
            stroke={theme.colors.danger} strokeWidth={chart.lw.ref} strokeDasharray="4 3" opacity={0.7} />

          {/* 折线：连续有值的段才连，缺口断开不插值 */}
          {(() => {
            const segs: number[][] = [];
            let cur: number[] = [];
            rows.forEach((r, i) => {
              if (r.value != null) cur.push(i);
              else { if (cur.length) segs.push(cur); cur = []; }
            });
            if (cur.length) segs.push(cur);
            return segs.map((idx, i) => (
              <G key={'sseg' + i}>
                {idx.length > 1 && (
                  /* ★ 平滑弧线（稿 drawStr）：原为 Polyline 折线 */
                  <Path
                    d={smoothLine(idx.map((k) => ({ x: cxOf(k), y: yOf(rows[k].value!) })))}
                    fill="none" stroke={theme.colors.accentSolid} strokeWidth={chart.lw.series}
                    strokeLinecap="round" strokeLinejoin="round" />
                )}
                {idx.map((k) => (
                  <Circle key={'sp' + k} cx={cxOf(k)} cy={yOf(rows[k].value!)} r={chart.dot.radius}
                    fill={theme.colors.accentSolid} stroke={theme.colors.cardBg} strokeWidth={chart.dot.stroke} />
                ))}
              </G>
            ));
          })()}

          {rows.map((r, i) => (
            <SvgText key={'sx' + i} x={cxOf(i)} y={chartH - 5} textAnchor="middle" fontSize={chart.axisFont}
              fill={theme.colors.textSub}>{showXLabel(range, i, r.label) ? r.label : ''}</SvgText>
          ))}
        </Svg>
        </View>
        <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) }}>
          每个点 = 该{RANGE_DEF[range].label}内「每天压力均值」再取平均 · 虚线 = {RANGE_DEF[range].label}平均 {mean}
        </Text>
        {maxRow.value != null && minRow.value != null && (
          <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) }}>
            最高 {maxRow.label} · {maxRow.value} · 最低 {minRow.label} · {minRow.value}
            {max - min >= 15 ? ' · 波动较大，看看高值那天发生了什么' : ' · 整体平稳'}
          </Text>
        )}
      </View>
    </Card>
  );
}

/* ========== 心理压力：周/月/年 ========== */
/* ========== 运动消耗：图在上 ========== */
function ActivityDetail({ ring, navigation, anchor }: { ring: any; navigation: any; anchor: Date }) {
  const dk = dayKey(anchor.getTime());  // ★ 跟随日期选择器
  const step = ring?.stepDaily?.[dk];
  const distance = step?.distance ?? 0;
  const calorie = step?.calorie ?? 0;

  const fmtKm = (km: number) => (km >= 10 ? km.toFixed(1) : km.toFixed(2));

  return (
    <>
      {/* ★ 2026-10-12（用户：「去掉运动消耗里面最下面的步数、步行距离和运动活动消耗」）：
          三行入口整体移除，只保留今日运动记录列表与一句事实说明。
          ActivityTile 组件保留（下方），日后要恢复把 chartCard 三行放回来即可。 */}
      {/* ★ 2026-10-09（exercise-consumption-preview「今日运动记录」）：
            统计格已并入上方 hero 卡，这里只放真实运动会话列表（无记录时不渲染） */}
      {(() => {
        const sess = daySportSessions(ring, dk);
        if (sess.length === 0) return null;
        return (
          <Card padded={false}>
            <View style={styles.pad}>
              <Text style={styles.cardTitle}>今日运动记录</Text>
              {sess.map((s: any, i: number) => {
                const mins = Math.round((s?.totalTime ?? 0) / 60);
                const timeTxt = typeof s?.beginTime === 'string' ? s.beginTime.slice(11, 16) : '';
                return (
                  <View key={`${s?.beginTime ?? i}`} style={[styles.sessRow, i === sess.length - 1 && styles.sessRowLast]}>
                    <View style={styles.sessIcon}>
                      <Text style={styles.sessIconText}>{String(s?.typeName ?? '运').slice(0, 1)}</Text>
                    </View>
                    <View style={styles.sessMid}>
                      <Text style={styles.sessName} numberOfLines={1}>{s?.typeName ?? '运动'}</Text>
                      {timeTxt ? <Text style={styles.sessTime}>{timeTxt}</Text> : null}
                    </View>
                    <View style={styles.sessRight}>
                      <Text style={styles.sessKcal}>{Math.round(s?.totalCal ?? 0)}</Text>
                      <Text style={styles.sessKcalSub}>kcal · {mins} 分</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        );
      })()}
    </>
  );
}


/* ★ 2026-10-12（用户）：三行入口（步数/步行距离/活动消耗）已从日视图移除，
   本组件暂时无引用；保留以便恢复（把 ActivityDetail 里的 chartCard 三行放回即可）。 */
function ActivityTile({ label, value, unit, color, onPress, last }: {
  label: string; value: string; unit: string; color: string; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[
      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.space.md },
      last && { borderBottomLeftRadius: mm.radius.card, borderBottomRightRadius: mm.radius.card },
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
  /**
   * ★ 2026-10-07（用户：脑力消耗 / 心理压力 两页「底下的图表和 Title 大小字体不一致」）：
   *   详情页的图表卡标题统一为 `fontSize.card`（18）。
   *   原先这里是 `fontSize.sm`（13.5），而情绪侧的两张卡（`EmotionRangeBars` / `EmotionInsightView`）
   *   一直是 `fontSize.card`（18）——同一屏里 13.5 和 18 混排，看着像两套设计。
   *   现在脑力/情绪/运动三页的卡片标题全部同一把尺。
   */
  chartTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, marginBottom: theme.sp(1) },

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
  // ★ 2026-10-09（brain-readiness-preview .legend 11px）：图例回到 micro 档
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },

  // ★ 2026-10-09（brain-readiness-preview .duo .cell）：预测高峰/低谷两格 = 圆角 11 + 内边距 10/11，
  //   标签与副文 11px、时间值 18px·600（预览 .lab/.s 11px · .t 17px）
  peakRow: { flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.sp(2) },
  peakChip: {
    flex: 1,
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(2.75),
    borderRadius: mm.radius.card,
    backgroundColor: theme.colors.cardBgSoft,
  },
  peakLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
  peakTime: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, marginTop: 2, lineHeight: theme.fontSize.card * 1.1 },
  peakSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: 2 },

  reasonText: { fontSize: theme.fontSize.sm, color: theme.colors.textInkSoft, lineHeight: theme.fontSize.sm * 1.5 },

  chartCard: {
    borderRadius: mm.radius.card, backgroundColor: theme.colors.cardBg,
    borderWidth: 1, borderColor: theme.colors.cardBorder, ...theme.shadow.card,
    paddingHorizontal: theme.space.cardPad,
  },
  /* ★ 2026-10-09（用户：统一成首页 / 洞察页「昼夜节律 · 生理周期节律」那套 tab）：
     **白底 + 外环描边** —— 未选中 = 极淡描边 + 灰字；选中 = 外环换成主色 + 浅色填充 + 深墨字。
     与 CycleCalendarScreen 的 SegTabs(ring) / InsightScreen 的 UnderlineTabs(large) 同一语言。 */
  tabRow: { flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.space.md },
  // 胶囊型：`borderRadius` 用 pill（全圆），**中间始终白色**，只有外环（描边）换色
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.25),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.cardBg,
  },
  tabOn: {
    borderColor: mm.colors.limeMid,
    backgroundColor: theme.colors.cardBg,
  },
  tabText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium as any, color: mm.colors.inkSoft },
  tabTextOn: { color: mm.colors.ink, fontWeight: theme.weight.semibold as any },

  /* ★ 2026-10-09（brain-readiness-preview 日视图）新增样式 */
  ctitleRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: theme.sp(1.5) },
  ctitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle },
  ctitleSmall: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginLeft: theme.sp(1.5) },
  // .hero：大数字 46 + 左侧标签 11px + 右侧状态语 13px·600（预览 .big/.lab/.ctx）
  // ★ 2026-10-10（用户）：去掉 heroWrap 额外的上下 padding（外层 pad 已是 cardPad），
  //   与睡眠详情页 SleepRecoveryHero 同口径，避免心理压力 Hero 比其它详情页 Hero 高太多。
  heroWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 0, paddingHorizontal: 0,
  },
  /* ★ 2026-10-12（用户：「27 旁边写卡路里」）：大数字 + 单位基线对齐一行 */
  heroNumRow: { flexDirection: 'row', alignItems: 'baseline' },
  heroBig: { fontSize: theme.fontSize.hero, fontWeight: theme.weight.semibold as any, lineHeight: theme.fontSize.hero },
  heroLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(1) },
  /* ★ 2026-11-03（用户·统一 hero 结构）：数字上方 title + 数字下方短 AI 分析（与 MetricDetail / SleepRecoveryHero 同款） */
  heroTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginBottom: theme.sp(1) },
  // ★ 2026-11-05（用户·统一）：区间分析卡标题（与 heroTitle 同语言）
  anaTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any, color: mm.colors.ink, marginBottom: theme.sp(1) },
  heroAnalysis: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: 21, marginTop: theme.sp(2) },
  /* ★ 2026-11-06（用户：今日运动建议卡太拥挤）：整卡 padding 与上方「今日活动消耗」hero 卡
     同为 cardPad；正文/分析行距与 heroAnalysis 同款（sm 字号、lineHeight 21、上距 sp(2)）。 */
  waCard: {
    backgroundColor: theme.colors.cardBg,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: mm.radius.card,
    padding: theme.space.cardPad,
    marginTop: theme.space.sm,
  },
  waHead: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1) },
  // ★ 2026-11-05（用户·统一）：今日运动建议抬头与「今日活动消耗」heroTitle 同字号/字重
  waTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold as any,
    color: mm.colors.ink,
  },
  waPhase: {
    marginLeft: 'auto',
    backgroundColor: mm.chipBg.cyan.bg,
    paddingHorizontal: theme.sp(2.5),
    paddingVertical: theme.sp(0.75),
    borderRadius: theme.radius.pill,
  },
  waPhaseText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold as never,
    color: mm.chipBg.cyan.fg,
  },
  waHeadline: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    marginBottom: theme.sp(1),
  },
  waDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: 20,
  },
  /* ★ 2026-10-12：处境分析一小段（相位 + 第几天 + 今日状态 → 适宜什么运动）
     ★ 2026-11-06（用户：太拥挤）：与 heroAnalysis 同款字号/行距 */
  waAnalysis: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: 21,
    marginTop: theme.sp(2),
  },
  waStats: { flexDirection: 'row', gap: theme.space.xs, marginTop: theme.sp(2) },
  waStat: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: theme.sp(1.2),
    paddingHorizontal: theme.sp(1),
    alignItems: 'center',
  },
  waStatK: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5) }, // ★ 2026-11-03（用户）：运动建议小卡文字改白（深玻璃卡上白字可读）
  waStatV: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textInk },
  /* ★ 2026-11-03（用户：「较昨日/较上周 字大一点、往上一点、和数值同一行」）：body(15) → card(18) */
  heroCtx: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold as any },
  // .rows / .row：margin-top 6px，13px 行，底线分隔，末行无底线
  rowsBox: { marginTop: theme.sp(1.5) },
  rowItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: theme.sp(2.25), borderBottomWidth: 1, borderBottomColor: theme.colors.ui.borderSoft,
  },
  rowItemLast: { borderBottomWidth: 0 },
  rowK: { fontSize: theme.fontSize.xs, color: theme.colors.textInk },
  rowV: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any, color: theme.colors.textInk },
  rowVSmall: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.regular as any, color: theme.colors.textSub, marginLeft: theme.sp(1) },
  // .duo：两块预测卡（圆角 11 · 内边距 10/11 · 标签/副文 11px · 时间 17px·600）
  // .duo：gap 10px
  duoRow: { flexDirection: 'row', gap: theme.sp(2.5), marginTop: theme.sp(1) },
  duoCell: {
    flex: 1,
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(2.75),
    borderRadius: mm.radius.card,
  },
  duoLab: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.75) },
  // .duo .t = 15px·650（★ 本轮 17→15 缩小学力峰谷时间数字，对齐用户"调小一点"）
  duoTime: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, lineHeight: theme.fontSize.body * 1.1 },
  duoSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.75) },
  // .axisnote：10.5px；日视图卡内左对齐版本
  axisNote: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, textAlign: 'center', marginTop: theme.sp(1), lineHeight: theme.fontSize.micro * 1.4 },
  axisNoteLeft: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(2), lineHeight: theme.fontSize.micro * 1.4 },
  // ★ 2026-10-10（用户选 G · 数量提示 pill）：去掉灰底描边盒，改为扁平行（顶部发丝线分隔）
  //   + 右侧「N 项」浅底 pill + chevron（pill 与 App 选中态同语言）
  mhRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: theme.space.sm,
    paddingVertical: theme.sp(2.25), paddingHorizontal: 0,
  },
  mhCount: {
    fontSize: theme.fontSize.micro, color: mm.colors.limeDeep,
    backgroundColor: mm.colors.limeSoft,
    paddingVertical: theme.sp(0.5), paddingHorizontal: theme.sp(1.5),
    borderRadius: theme.radius.pill, fontWeight: theme.weight.semibold as any,
    marginRight: theme.sp(2),
  },
  mhLabel: { fontSize: theme.fontSize.xs, color: theme.colors.textInk, fontWeight: theme.weight.semibold as any },
  mhChev: {
    width: theme.sp(2), height: theme.sp(2),
    borderRightWidth: 1.6, borderBottomWidth: 1.6, borderColor: theme.colors.textSub,
    transform: [{ rotate: '45deg' }], marginRight: theme.sp(0.75),
  },
  mhChevOpen: { transform: [{ rotate: '-135deg' }] },

  // ★ 2026-10-09（brain-readiness-preview .cmpCard / .cmpNote）
  cmpCardRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.sp(2), marginTop: theme.sp(2) },
  cmpBig: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.semibold as any, color: theme.colors.accentText, lineHeight: theme.fontSize.stat },
  cmpUnit: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, paddingBottom: theme.sp(1.25) },
  cmpDelta: { marginLeft: 'auto', fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any, paddingBottom: theme.sp(1.25) },

  // ★ 2026-11-05（用户）：三卡片与上方分析文字拉开距离
  statGrid: { flexDirection: 'row', gap: theme.space.xs, marginTop: theme.sp(2.5) },
  // ★ 2026-10-09（exercise/psychological-stress-preview .statRow .tile）：无底色描边小格
  //   （radius 11 / 内边距 9·10 / 标签 11px / 值 15px·650），替代原先的浅底大号格
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(2.25),
    paddingHorizontal: theme.sp(2.5),
    borderRadius: mm.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: 'transparent',
  },
  statSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5), textAlign: 'center', lineHeight: theme.fontSize.micro * 1.4 },
  statLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(0.5), textAlign: 'center' },
  // ★ 2026-11-07：梅脱格 —— 标签行（标签 + 感叹号）居中排布
  statLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  metInfoDot: {
    width: theme.fs(13), height: theme.fs(13), borderRadius: theme.fs(6.5),
    borderWidth: 1, borderColor: theme.colors.textSub, marginLeft: theme.sp(0.75),
    alignItems: 'center', justifyContent: 'center',
  },
  metInfoTxt: { fontSize: theme.fs(9), lineHeight: theme.fs(12), fontWeight: theme.weight.bold as any, color: theme.colors.textSub, marginTop: -theme.sp(0.4) },
  // ★ 2026-11-07：梅脱解释弹层（底部拉起，深海蓝底与详情页弹窗统一）
  metSheetOverlay: { flex: 1, backgroundColor: 'rgba(4,18,38,0.72)', justifyContent: 'flex-end' },
  metSheet: {
    backgroundColor: '#113861', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 26,
    borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.24)',
  },
  metSheetGrab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.30)', marginBottom: 12 },
  metSheetTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.bold as any, color: theme.colors.textTitle, marginBottom: 10 },
  metSheetBody: { fontSize: theme.fontSize.sm, color: theme.colors.textBody, lineHeight: 21, marginBottom: 8 },
  metSheetNote: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, opacity: 0.9, lineHeight: 17, marginTop: 2, marginBottom: 16 },
  metSheetBtn: { alignSelf: 'stretch', backgroundColor: mm.colors.purpleBtn, borderRadius: theme.radius.md, paddingVertical: 11, alignItems: 'center' },
  metSheetBtnTxt: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: '#FFFFFF' },
  statValue: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: theme.colors.textTitle, lineHeight: theme.fontSize.body * 1.15, textAlign: 'center' },
  insightText: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, lineHeight: theme.fontSize.sm * 1.55, paddingHorizontal: theme.space.xs },

  // ★ 2026-10-09（exercise-consumption-preview .sess）：今日运动记录行
  sessRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.5),
    paddingVertical: theme.sp(2.5), borderBottomWidth: 1, borderBottomColor: theme.colors.ui.borderSoft,
  },
  sessRowLast: { borderBottomWidth: 0 },
  sessIcon: {
    width: theme.sp(8.5), height: theme.sp(8.5), borderRadius: theme.radius.sm,
    backgroundColor: mm.colors.honeySoft, alignItems: 'center', justifyContent: 'center',
  },
  sessIconText: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as any, color: mm.colors.honeyDeep },
  sessMid: { flex: 1 },
  sessName: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.semibold as any, color: theme.colors.textInk },
  sessTime: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
  sessRight: { alignItems: 'flex-end' },
  sessKcal: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as any, color: mm.colors.honeyDeep },
  sessKcalSub: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginTop: theme.sp(0.5) },

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
    // ★ 2026-10-27（用户）：与首页「情绪」卡 + 详情 Hero + 折线图同口径 —— 用 stressScale.value
    //   （dailyStressValue，0–100、50=平时），不再用另一套 emotionalLoad，避免同一页冒出第二个数字。
    const load = dailyStressValue(dayKey(reportMs), (ring as any)?.sportSessions ?? null);
    const rows: { tone: 'good' | 'warn' | 'neutral'; title: string; body: string }[] = [];

    // 第一段：纯段落（InsightBanner 会自动处理）
    const firstBody = events === 0
      ? '今日暂无压力事件记录，状态保持平稳。'
      : events <= 3
        ? `今日共有 ${events} 次压力事件，情绪 ${load ?? '—'}，整体处于低压力区间。`
        : events <= 6
          ? `今日共有 ${events} 次压力事件，情绪 ${load ?? '—'}，处于中等压力水平。`
          : `今日共有 ${events} 次压力事件，情绪 ${load ?? '—'}，压力负荷较高，注意放松。`;

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
      ? '今天还没攒到脑力数据，戴上戒指自动跑几轮监测后就会长出来。'
      : `此刻准备度 ${readyNow}（${readinessLevelLabel(readyNow)}），全天均值 ${readyAvg ?? '—'}。`
        + (ready!.morning != null && ready!.nightLow != null
          ? `早上出门时是 ${ready!.morning}、夜里低谷 ${ready!.nightLow}，`
            + (ready!.morning - ready!.nightLow >= 15 ? '从早到晚慢慢回落，是正常的节律形状。' : '昼夜落差不大，今天状态走得比较平。')
          : '');

    if (ready?.peakHour != null) {
      rows.push({
        tone: 'good', title: '高效时段',
        body: `${String(ready.peakHour).padStart(2, '0')}:00–${String((ready.peakHour + 1) % 24).padStart(2, '0')}:00 你的脑子最转得动，最难的事放这段最划算。`,
      });
    }
    if (ready?.troughHour != null) {
      rows.push({
        tone: 'warn', title: '需要休息',
        body: `${String(ready.troughHour).padStart(2, '0')}:00 前后状态会落到最低，这段留给自己歇一歇，或只做轻巧的事。`,
      });
    }
    if (readyNow != null && readyNow < READY_LOW) {
      rows.push({ tone: 'warn', title: '状态提醒', body: `此刻准备度只剩 ${readyNow}，${report?.sleepDebt != null && report.sleepDebt > 0.2 ? `身上还压着 ${report.sleepDebt.toFixed(1)} 小时的睡眠债，` : ''}先歇一会儿，别硬撑。` });
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
function RangeTrendBars({ type, range, anchor, ring }: { type: EnergyType; range: RangeKey; anchor: Date; ring?: any }) {
  const anchorMs = anchor.getTime();
  const { axis } = RANGE_DEF[range];
  // ★ 2026-10-09（exercise-consumption-preview）：区间视图「详细数据」折叠，默认收起
  const [rangeDetailOpen, setRangeDetailOpen] = useState(false);

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
            // ★ 2026-10-27（用户）：与首页「情绪」卡 + 折线图同口径 —— 用 stressScale.value（dailyStressValue），
            //   不再用 computeStressReport().emotionalLoad（另一套数），保证「图」与「条」是同一个数。
            const v = dailyStressValue(dk, (ring as any)?.sportSessions ?? null);
            if (v != null) { sum += v; cnt++; }
          } else if (type === 'activity') {
            // ★ 2026-10-09：与**日视图同源**读 `ring.stepDaily[dk].calorie`（真实 kcal）。
            //   之前读 healthStore('calorie') 拿不到历史、还被归一化成 0–100 分数，导致周月年全 0。
            const c = ring?.stepDaily?.[dk]?.calorie;
            if (Number.isFinite(c) && (c as number) > 0) { sum += c as number; cnt++; }
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
  /** 纵轴上限：压力/脑力固定 0–100；运动消耗按真实 kcal 自适应（向上取整到 50 的倍数） */
  const yMax = type === 'activity' && hasAny
    ? Math.max(1, Math.ceil((Math.max(...validScores) * 1.3) / 50) * 50)
    : 100;

  const mean = hasAny ? Math.round(validScores.reduce((a,b)=>a+b,0) / validScores.length) : 0;
  const peak = hasAny ? Math.max(...validScores) : 0;
  const trough = hasAny ? Math.min(...validScores) : 0;
  const volatility = hasAny && validScores.length > 1
    ? Math.round(Math.sqrt(validScores.reduce((a,b)=>a+(b-mean)**2,0) / validScores.length))
    : 0;

  const prevMean = validPrev.length > 0 ? Math.round(validPrev.reduce((a,b)=>a+b,0) / validPrev.length) : null;
  const delta = prevMean != null ? mean - prevMean : null;
  const deltaPct = prevMean != null && prevMean > 0 ? Math.round((delta! / prevMean) * 100) : null;

  // ★ 2026-10-10（bar-design-unified-spec 规则1/5）：柱色 = 语义→色相唯一入口，柱体一律平涂、禁渐变
  //   cognitive 认知 → 紫 purpleCore；emotion 情绪 → 粉 roseCore；activity 运动 → 蓝 skyCore
  const barFill = type === 'cognitive' ? mm.colors.purpleCore
    : type === 'emotion' ? mm.colors.roseCore
    : mm.colors.skyCore;
  const refLine = type === 'activity' ? mm.colors.skyDeep : theme.colors.celebrateGrad[0];

  const lowerIsBetter = type === 'cognitive' || type === 'emotion';
  const trendBad = delta != null && ((lowerIsBetter && delta > 0) || (!lowerIsBetter && delta < 0));
  const trendColor = trendBad ? theme.colors.danger : delta != null && delta !== 0 ? theme.colors.success : theme.colors.textSub;
  const trendLabel = previousPeriodLabel(range);
  const trendArrow = delta == null ? '—' : delta > 0 ? '↑' : delta < 0 ? '↓' : '→';

  // 图表尺寸：★viewBox 固定坐标系(320 宽) + width 100% 自适应；月视图 28~31 柱自动收窄
  const VW = 320;
  const nP = periods.length;
  const AX_L2 = 30, AX_R2 = 6;
  const stepP = (VW - AX_L2 - AX_R2) / Math.max(1, nP);
  const barW = Math.min(24, Math.max(4, stepP * 0.6));
  // ★ 2026-10-10（chart-size-unified-spec）：L 档 = 总高 240、绘图区净高 190、装饰带 ≤ 50
  const plotTop = 18;
  const plotH = chart.plot.l;       // 190
  const chartH = chart.h.l;         // 240（原 194，且被 ×1.7 拉成 ≈330）
  const xOfP = (i: number) => AX_L2 + i * stepP + (stepP - barW) / 2;
  const cxOfP = (i: number) => AX_L2 + i * stepP + stepP / 2;

  return (
    <>
      {/* 卡 ① 趋势图 — SVG 始终渲染, 空数据画骨架 + 覆盖层 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={styles.chartTitle}>{META[type].name}趋势图</Text>
            {prevMean != null && deltaPct != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>vs {trendLabel}</Text>
                <Text style={{ fontSize: theme.fontSize.sm, fontWeight: '700', color: trendColor, marginLeft: 4 }}>
                  {trendArrow} {Math.abs(deltaPct!)}%
                </Text>
              </View>
            )}
          </View>

          <View style={{ position: 'relative' }}>
            {/* ★ 规则 3：禁止非等比拉伸 —— height 必须等于 viewBox 高度（去掉 ×1.7） */}
            <Svg viewBox={`0 0 ${VW} ${chartH}`} width="100%" height={chartH}>
              {/* Y 轴刻度 & 网格 — 始终渲染（★ 运动页按 kcal 自适应 yMax，不再写死 0–100） */}
              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                const v = f * yMax;
                const y = plotTop + plotH - f * plotH;
                return (
                  <G key={`y${f}`}>
                    <SvgText x={AX_L2 - 4} y={y + 3} textAnchor="end" fontSize={chart.axisFont} fill={theme.colors.textSub}>
                      {Math.round(v)}
                    </SvgText>
                    {f > 0 && f < 1 && (
                      <Line x1={AX_L2} y1={y} x2={VW - AX_R2} y2={y}
                        stroke={chart.grid} strokeWidth={chart.lw.grid} strokeDasharray={chart.dash.grid} />
                    )}
                  </G>
                );
              })}

              {/* 参考线：压力/脑力 = 50 分；运动 = 区间均值（稿里的虚线均值） */}
              <Line x1={AX_L2} y1={plotTop + plotH - ((type === 'activity' && hasAny ? mean : 50) / yMax) * plotH}
                    x2={VW - AX_R2} y2={plotTop + plotH - ((type === 'activity' && hasAny ? mean : 50) / yMax) * plotH}
                    stroke={refLine}
                    strokeWidth={chart.lw.ref} strokeDasharray={chart.dash.ref} />

              {/* 柱子 — 空数据画灰色 2px 底条 */}
              {scores.map((s, i) => {
                const h = s != null ? Math.max(3, (s / yMax) * plotH) : 0;
                const x = xOfP(i);
                const y = plotTop + plotH - h;
                const isPeak = hasAny && s != null && s === peak;
                return (
                  <G key={i}>
                    {s != null ? (
                      /* ★ 2026-10-10（bar-design-unified-spec 规则1/2/5）：平涂单色按语义取相
                         （cognitive 紫 / emotion 粉 / activity 蓝），rx 统一 3，禁渐变 */
                      <Rect x={x} y={y} width={barW} height={h} rx={chart.barRadius} ry={chart.barRadius}
                            fill={barFill} />
                    ) : (
                      /* ★ 规则6：空数据统一态 = emptyFill 2pt 圆角1 opacity1 */
                      <Rect x={x} y={plotTop + plotH - 2} width={barW} height={2} rx={1} ry={1}
                            fill={mm.colors.emptyFill} />
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
                    {showXLabel(range, i, periods[i].label) && (
                      <SvgText x={cxOfP(i)} y={chartH - theme.sp(1.5)} textAnchor="middle" fontSize={chart.axisFont} fill={theme.colors.textSub}>
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

      {/* ★ 2026-10-10（用户）：运动详情页的「周期均值 / 峰值 / 低谷 / 波动度」与
          「详细数据」合并到同一张卡里，不再分两张 */}
      {type === 'activity' && hasAny && (
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.anaTitle}>消耗分析</Text>
            <View style={styles.statGrid}>
              <StatCell label="周期均值" value={String(mean)} sub="kcal" />
              <StatCell label="峰值" value={String(peak)} sub="kcal" valueColor={theme.colors.celebrateGrad[0]} />
              <StatCell label="低谷" value={String(trough)} sub="kcal" valueColor={theme.colors.success} />
              <StatCell label="波动度" value={String(volatility)} sub="σ" />
            </View>
            {/* ★ 2026-11-07（用户）：周视图同样删掉「运动时长」格（精简版无此数据），步数/距离 两格日均 */}
            {(() => {
              const allKeys = periods.flatMap((p) => p.dayKeys).filter((x) => x <= dayKey(Date.now()));
              const meanOf = (pick: (s: any) => number): number | null => {
                const vals = allKeys.map((k) => pick(ring?.stepDaily?.[k])).filter((v) => Number.isFinite(v) && (v as number) > 0);
                return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
              };
              const steps = meanOf((s) => s?.steps ?? 0);
              const dist = meanOf((s) => s?.distance ?? 0);
              const unit = { fontSize: theme.fontSize.micro, color: theme.colors.textSub };
              return (
                <View style={[styles.statGrid, { marginTop: theme.sp(1.5) }]}>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>步数</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {steps != null ? (steps / 1000).toFixed(1) : '—'}{<Text style={unit}> k</Text>}
                    </Text>
                    <Text style={styles.statSub}>日均</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>距离</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {dist != null ? dist.toFixed(1) : '—'}{<Text style={unit}> km</Text>}
                    </Text>
                    <Text style={styles.statSub}>日均</Text>
                  </View>
                </View>
              );
            })()}
            <TouchableOpacity
              style={styles.mhRow}
              activeOpacity={0.7}
              onPress={() => setRangeDetailOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={rangeDetailOpen ? '收起详细数据' : '展开详细数据'}
            >
              <Text style={styles.mhLabel}>详细数据</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.mhCount}>4 项</Text>
                <View style={[styles.mhChev, rangeDetailOpen && styles.mhChevOpen]} />
              </View>
            </TouchableOpacity>
            {rangeDetailOpen ? (
              <View style={styles.rowsBox}>
                {(() => {
                  const allKeys = periods.flatMap((p) => p.dayKeys).filter((x) => x <= dayKey(Date.now()));
                  const agg = aggregateExercise(ring, allKeys);
                  const unit = { fontSize: theme.fontSize.micro, color: theme.colors.textSub };
                  return (
                    <>
                      <View style={styles.rowItem}>
                        <Text style={styles.rowK}>运动次数</Text>
                        <Text style={styles.rowV}>{agg.count > 0 ? agg.count : '—'}<Text style={unit}> 次</Text></Text>
                      </View>
                      <View style={styles.rowItem}>
                        <Text style={styles.rowK}>平均心率（运动时段）</Text>
                        <Text style={styles.rowV}>
                          {agg.avgHr != null ? agg.avgHr : '—'}
                          <Text style={unit}> bpm</Text>
                        </Text>
                      </View>
                      <View style={styles.rowItem}>
                        <Text style={styles.rowK}>最长单次</Text>
                        <Text style={styles.rowV}>
                          {agg.maxSingleMin != null ? agg.maxSingleMin : '—'}
                          <Text style={unit}> 分</Text>
                        </Text>
                      </View>
                      <View style={[styles.rowItem, styles.rowItemLast]}>
                        <Text style={styles.rowK}>消耗最高日</Text>
                        <Text style={styles.rowV}>{agg.topCalDay ? agg.topCalDay.k.slice(5).replace('-', '/') : '—'}</Text>
                      </View>
                    </>
                  );
                })()}
              </View>
            ) : null}
          </View>
        </Card>
      )}

      {/* 卡 ② 统计指标网格（★ 运动页已并入上面的「详细数据」卡，这里不再重复） */}
      {hasAny && type !== 'activity' && (
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.anaTitle}>消耗分析</Text>
            <View style={styles.statGrid}>
              <StatCell label="周期均值" value={String(mean)} sub="/ 100" />
              <StatCell label="峰值" value={String(peak)} sub="/ 100" valueColor={theme.colors.celebrateGrad[0]} />
              <StatCell label="低谷" value={String(trough)} sub="/ 100" valueColor={theme.colors.success} />
              <StatCell label="波动度" value={String(volatility)} sub="σ" />
            </View>
          </View>
        </Card>
      )}

      {/* 卡 ③ 对比上周期（★ 2026-11-03 用户：运动量对比已并入「周平均活动消耗」Hero 卡的分析文案，活动页不再单独成卡） */}
      {hasAny && prevMean != null && type !== 'activity' && (
        <Card padded={false}>
          <View style={styles.pad}>
            <Text style={styles.chartTitle}>对比{trendLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Text style={{ fontSize: theme.fontSize.h2, fontWeight: '800', color: trendColor }}>
                {delta == null ? '—' : (delta > 0 ? '+' : '') + delta}
              </Text>
              <Text style={{ fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginLeft: 6 }}>
                {deltaPct != null ? `(${trendArrow} ${Math.abs(deltaPct!)}%)` : ''}
              </Text>
              <View style={{ flex: 1 }} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: theme.fontSize.micro, color: theme.colors.textSub }}>{trendLabel}均值</Text>
                <Text style={{ fontSize: theme.fontSize.body, fontWeight: '700', color: theme.colors.textTitle }}>{prevMean}</Text>
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


