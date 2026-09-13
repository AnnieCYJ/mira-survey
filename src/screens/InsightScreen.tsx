import React, { useEffect, useState, useMemo } from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path as SvgPath } from 'react-native-svg';
import BpCard from '../components/BpCard';
import EcgCard from '../components/EcgCard';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Chip from '../components/Chip';
import InsightBanner from '../components/InsightBanner';
import DimensionCard from '../components/DimensionCard';
import SleepStructureCard from '../components/SleepStructureCard';
import CyclePhaseCard from '../components/CyclePhaseCard';
import BasicMetricCard from '../components/BasicMetricCard';
import ManualMetricCard from '../components/ManualMetricCard';
import ListCard, { type ListItem } from '../components/ListCard';
import Card from '../components/Card';
import ExamTab from '../components/ExamTab';
import BloodComponentPanel from '../components/BloodComponentPanel';
import StressInsightCard from '../components/StressInsightCard';
import CognitiveLoadCard from "../components/CognitiveLoadCard";
import CortisolDailyChart from '../components/CortisolDailyChart';
import CortisolRhythmCard from '../components/CortisolRhythmCard';
import { METRICS, BASIC_METRICS, signalsForDimension, type MetricKey } from '../data/metrics';
import { getTodaySeries } from '../lib/realSeries';
import { RingBle, type RingState, type MetricKey as RingMetricKey, type EcgReading } from '../ble/RingBleManager';
import { dayKey } from '../data/healthStore';
import { useAppState } from '../state/AppState';
import { useHealthStoreVersion } from '../hooks/useHealthStore';

function formatValue(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 以 ima 归档（04-屏幕Screens）的权威洞察页设计为底：
// 5 个维度 chip（睡眠和激素/周期和激素/代谢/心脏健康/心理和压力）+ 选中后 DimensionCard + 本周关键变化。
// 新增「基础指标」tab 置顶：直连戒指真实信号（心率/血氧/体温/皮电/HRV/呼吸率）。
// 新增「一键体检」tab（置于中部）：本地估算身体成分并持久化记录，洞察页只展示最新、历史页按时间排列。
type TabKey = 'basics' | 'exam' | 'activity' | MetricKey;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basics', label: '基础指标' },
  { key: 'sleep', label: METRICS.sleep.name },
  { key: 'cycle', label: METRICS.cycle.name },
  { key: 'metabolism', label: METRICS.metabolism.name },
  { key: 'activity', label: '运动' },
  { key: 'exam', label: '体检' },
  { key: 'heart', label: METRICS.heart.name },
  { key: 'mind', label: METRICS.mind.name },
];

const CHANGES: ListItem[] = [
  { dot: theme.colors.stateCalm, title: 'HRV 基线 58 → 62 ms', sub: '连续 5 天高于个人基线' },
  { dot: theme.colors.stateTense, title: '午后压力峰值提前 40 分钟', sub: '与新增的晨会时段高度重合' },
  { dot: theme.colors.stateEnergy, title: '深睡占比 21% → 24%', sub: '入睡时间提前带来的直接改善' },
];

/**
 * 代谢 tab 允许下发的信号白名单（除独立的「血液成分」面板外）。
 * 只留血糖：血脂四项（总胆固醇/甘油三酯/HDL/LDL）与血液成分面板重复；
 * BMI/体脂率/脂肪量/肌肉量/骨量等身体成分需先录入身高体重档案，未录入时恒为占位空卡。
 */
const METABOLISM_VISIBLE_KEYS = new Set<string>(['bloodSugar']);

export default function InsightScreen() {
  const navigation = useNavigation<any>();
  const { autoMonitor } = useAppState();
  // 直接订阅戒指实时状态：真实心率/血氧/体温/皮电/HRV/呼吸率都从这里来
  const [ring, setRing] = useState<RingState>(RingBle.getState());
  // 默认基础指标 tab：直连戒指真实信号；其余维度 tab 为周期-心理洞察（上线保留）
  const [tab, setTab] = useState<TabKey>('basics');

  // 趋势图可用性：连上戒指即视为「正在监测」（RingBleManager 连上会强制开启原生采集，
  // 与设置页总开关无关），不再被 autoMonitor 默认值 false 卡死——否则数据在采、数值有，
  // 但洞察页所有趋势图整体不渲染，造成「有数据没图」的观感。
  const trendOn = autoMonitor || ring.status === 'connected';

  // 直接订阅 healthStore 版本号：离线回填 / 实时写入 healthStore 后，本页所有卡片
  // 立即重渲染并重读 getTodaySeries（不再依赖间接的 ring.dataVersion 触发，杜绝
  // 「数据明明回了、卡片却一直空白」的时序卡死）。
  useHealthStoreVersion();

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  // ★ 已移除「挂载即下发 autoMonitor」的 effect：AppState.setAutoMonitor（设置页开关）
  // 已经直接转发给 RingBle，这里再转发一次是冗余的；且挂载时 AppState 初始值为 false，
  // 会把「连上戒指即自动开启监测」的设计推翻——一进洞察页原生 monitorOn 就被关掉，
  // 戒指实时数据（HealthGlance/GSR 轮询）全部停流（日志 15:04:58 on=0 → raw=0）。

  // 任意卡片点击 → 进入「指标历史详情」全屏页（日/周/月/年切换 + 真实数据）
  const openDetail = (
    key: string,
    name: string,
    unit: string,
    yMin: number,
    yMax: number,
    color?: string
  ) => {
    navigation.navigate('MetricDetail', { key, name, unit, yMin, yMax, color });
  };

  // ★ 缓存 getTodaySeries 结果，避免每次 render 都遍历 healthStore
  const _seriesCache = new Map<string, { arr: any[]; last: number | null }>();
  const getCachedSeries = (key: string) => {
    const cached = _seriesCache.get(key);
    if (cached) return cached.arr;
    const arr = getTodaySeries(key);
    _seriesCache.set(key, { arr, last: arr.length > 0 ? arr[arr.length - 1].t : null });
    return arr;
  };
  const todayLastT = (key: string): number | null => {
    const cached = _seriesCache.get(key);
    if (cached) return cached.last;
    const arr = getTodaySeries(key);
    const last = arr.length > 0 ? arr[arr.length - 1].t : null;
    _seriesCache.set(key, { arr, last });
    return last;
  };

  // 基础指标 tab：前 5 个是实时信号（读 ring.metrics/history），其余扩展信号读 ring.daily/dailyHistory
  const realtimeKeys = new Set(BASIC_METRICS.map((b) => b.key));
  const basicsSignals = signalsForDimension('basics');

  return (
    <ScreenContainer compactTop>
      <View style={styles.stack}>
        <Text style={styles.title}>Insights</Text>

        <InsightBanner onMore={() => navigation.navigate('Chat', { initialQuestion: '帮我详细分析今天的状态' })} />

        {/* 模块切换：基础指标为戒指真实信号；其余为周期-心理洞察（上线保留） */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipContent}
        >
          {TABS.map((t) => (
            <Chip key={t.key} label={t.label} active={t.key === tab} onPress={() => setTab(t.key)} />
          ))}
        </ScrollView>

        {tab === 'basics' ? (
          <>
          <View style={styles.grid}>
            {basicsSignals.map((m, idx) => {
              const isRealtime = realtimeKeys.has(m.key);
              const rk = m.key as RingMetricKey;
              const real = isRealtime ? (ring.metrics[rk] ?? null) : (ring.daily[m.key] ?? null);
              // 今日趋势统一走 getTodaySeries（与历史页面日视图同源同频）
              let hist = getCachedSeries(m.key);
              // 戒指实时信号（hr/spo2/temp/eda/hrv/cortisol 等）约 30min 出一点，统一按半小时均值聚合
              const HALF_HOUR_KEYS = new Set(['hr','spo2','temp','eda','hrv','rr','cortisol','stress','fatigue','emotion','skin','bpSys','bpDia']);
              if (HALF_HOUR_KEYS.has(m.key) && hist.length > 0) {
                const halfHour = 30 * 60 * 1000;
                const dayStart = new Date(); dayStart.setHours(0,0,0,0);
                const slots: { sum: number; n: number; t: number }[] = [];
                for (let i = 0; i < 48; i++) slots.push({ sum: 0, n: 0, t: dayStart.getTime() + i * halfHour });
                for (const pt of hist) {
                  const slot = Math.floor((pt.t - dayStart.getTime()) / halfHour);
                  if (slot >= 0 && slot < 48 && Number.isFinite(pt.v)) { slots[slot].sum += pt.v; slots[slot].n++; }
                }
                hist = slots.filter(s => s.n > 0).map(s => ({ t: s.t, v: +(s.sum / s.n).toFixed(1) }));
              }
              const measureTime = isRealtime ? ring.lastUpdated[rk] : todayLastT(m.key);
              const prevSection = idx > 0 ? basicsSignals[idx - 1].section : undefined;
              const showHeader = !!m.section && m.section !== prevSection;
              return (
                <React.Fragment key={m.key}>
                  {showHeader && <Text style={styles.sectionLabel}>{m.section}</Text>}
                  {m.manualOnly ? (
                    <ManualMetricCard
                      metric={m}
                      live={real != null}
                      value={real != null ? formatValue(real) : m.value}
                      measureTime={measureTime}
                      onMeasure={() => RingBle.measure(rk)}
                      onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
                    />
                  ) : (
                    <BasicMetricCard
                      metric={m}
                      auto={trendOn}
                      live={isRealtime ? ring.availability[rk] === 'live' : real != null}
                      syncing={isRealtime ? ring.availability[rk] === 'syncing' : false}
                      value={formatValue(real)}
                      data={hist}
                      onMeasure={() => RingBle.measure(rk)}
                      hideMeasure={m.hideMeasure ?? true}
                      measureTime={measureTime}
                      onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </View>
          </>
        ) : tab === 'exam' ? (
          <ExamTab />
        ) : tab === 'cycle' ? (
          <>
            {/* 周期 tab 不再放日/周/月/年切换：周期不是普通时间序列指标，
                当前卡片固定展示「本月/当前周期」视角，点击卡片进周期日历看月/年相位。 */}
            <CyclePhaseCard
              ring={ring}
              female={ring.female}
              onPress={() => navigation.navigate('CycleCalendar')}
            />
          </>
        ) : tab === 'activity' ? (
          <ActivityStatsTab ring={ring} />
        ) : (
          <View style={styles.stack}>
            {!['heart', 'sleep', 'metabolism', 'psychology', 'mind'].includes(tab) && (
              <DimensionCard metric={METRICS[tab]} onPress={() => {}} />
            )}
            {tab === 'metabolism' && (
              <BloodComponentPanel ring={ring} onOpenDetail={openDetail} />
            )}

            {tab === 'heart' && (
              <>
                <BpCard ring={ring} onPress={() => navigation.navigate('BpDetail')} />
                <EcgCard ring={ring} onPress={() => navigation.navigate('EcgDetail')} />
              </>
            )}
            {tab === 'sleep' && (
              <>
              <SleepStructureCard
                segments={ring.sleepStages}
                summary={ring.sleepSummary}
                sleepTime={ring.sleepTime}
                wakeTime={ring.wakeTime}
                deepPct={ring.daily['sleepDeep'] ?? null}
                remPct={ring.daily['sleepRem'] ?? null}
                score={ring.daily['sleepScore'] ?? null}
                fallbackTotalMinutes={ring.daily['sleepTotal'] ?? null}
                onPress={() => navigation.navigate('SleepDetail')}
              />
              <CortisolDailyChart />
              </>
            )}
            {tab === 'mind' && (
              <>
                <StressInsightCard />
                <View style={{ height: 16 }} />
                <CognitiveLoadCard />
              </>
            )}
            {(() => {
              let sigs = signalsForDimension(tab);
              // 代谢 tab 只保留「血液成分」面板 +「血糖」两张：
              //  · 血糖之后的总胆固醇/甘油三酯/HDL/LDL 与上方血液成分面板完全重复；
              //  · BMI/体脂率/脂肪量/肌肉量/骨量等身体成分需先录入身高体重档案，
              //    未录入时恒为占位空卡。按产品要求一并移除。
              // 用白名单而非 slice：不依赖 signalsForDimension 的返回顺序，
              // 即使后续往 metrics.ts 增删信号也不会误放开。
              if (tab === 'metabolism') {
                sigs = sigs.filter((s) => METABOLISM_VISIBLE_KEYS.has(s.key));
              }
              if (sigs.length === 0) {
                return (
                  <Card>
                    <Text style={styles.emptyNote}>
                      该维度暂无可直连的信号，等待原生接入。
                    </Text>
                  </Card>
                );
              }
              return (
                <View style={styles.grid}>
                  {sigs.map((m) => {
                    const real = ring.daily[m.key] ?? null;
                    // 今日趋势统一走 getTodaySeries（与历史页面日视图同源同频）
                    const hist = getCachedSeries(m.key);
                    const measureTime = todayLastT(m.key);
                    // 纯手动测量类信号：使用无趋势图的 ManualMetricCard（数值左 / 测量时间右 / 按钮置底）
                    if (m.manualOnly) {
                      return (
                        <ManualMetricCard
                          key={m.key}
                          metric={m}
                          live={real != null}
                          value={real != null ? formatValue(real) : m.value}
                          measureTime={measureTime}
                          onMeasure={() => RingBle.measure(m.key as RingMetricKey)}
                          onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
                        />
                      );
                    }
                    return (
                      <BasicMetricCard
                        key={m.key}
                        metric={m}
                        auto={trendOn}
                        live={real != null}
                        syncing={false}
                        value={real != null ? formatValue(real) : m.value}
                        data={hist}
                        onMeasure={() => RingBle.measure(m.key as RingMetricKey)}
                        hideMeasure={m.hideMeasure ?? true}
                        measureTime={measureTime}
                        onPress={() => openDetail(m.key, m.name, m.unit, m.yMin, m.yMax)}
                      />
                    );
                  })}
                </View>
              );
            })()}
            <ListCard title="本周关键变化" items={CHANGES} />
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

/** ECG 波形路径：原始 ADC/mV 点归一化到 320×80 视窗的折线。 */
function ecgWaveformPath(values: number[]): string {
  if (!values || values.length < 2) return '';
  const W = 320;
  const H = 80;
  const pad = 6;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) max = min + 1;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = pad + (i / (n - 1)) * (W - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** 心电图卡片：空状态 / 测量进度 / 最近一次波形 + 指标。 */
function EcgReadout({ ring }: { ring: RingState }) {
  const reading = ring.ecg;
  const progress = ring.ecgProgress;
  const caps = ring.deviceCapabilities;
  const ecgSupported = !caps || caps.ecgType > 0;
  const isMeasuring = progress != null;

  if (!ecgSupported) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图</Text>
        <Text style={styles.emptyNote}>当前戒指硬件不支持 ECG 测量</Text>
      </Card>
    );
  }

  const measureBtn = (
    <TouchableOpacity
      style={[styles.ecgBtn, isMeasuring && styles.ecgBtnDisabled]}
      onPress={() => RingBle.measure('ecg')}
      disabled={isMeasuring}
    >
      <Text style={styles.ecgBtnText}>
        {isMeasuring ? `测量中 ${progress?.progress ?? 0}%` : reading ? '重新测量' : '开始测量'}
      </Text>
    </TouchableOpacity>
  );

  if (!reading && !isMeasuring) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图</Text>
        <Text style={styles.emptyNote}>尚未测量，点击下方按钮启动 ECG（约 30 秒完成）</Text>
        {measureBtn}
      </Card>
    );
  }

  if (!reading) {
    return (
      <Card>
        <Text style={styles.profTitle}>心电图 · 测量中</Text>
        <View style={styles.ecgProgressBar}>
          <View style={[styles.ecgProgressFill, { width: `${progress?.progress ?? 0}%` }]} />
        </View>
        <Text style={styles.emptyNote}>
          {progress?.hr ? `当前心率 ${Math.round(progress.hr)} bpm · ` : ''}
          {progress?.progress ?? 0}% — 请保持手指稳定接触戒指
        </Text>
      </Card>
    );
  }

  const rows: [string, string][] = [
    ['平均心率', `${Math.round(reading.aveHeart)} bpm`],
    ['HRV', `${Math.round(reading.aveHrv)} ms`],
    ['呼吸率', `${Math.round(reading.aveResRate)} 次/分`],
    ['QT', `${Math.round(reading.aveQT)} ms`],
    ['PWV', `${Math.round(reading.avePWV)} cm/s`],
  ];
  return (
    <Card>
      <Text style={styles.profTitle}>心电图 · 最近一次测量</Text>
      <View style={styles.ecgChart}>
        <Svg width="100%" height={80} viewBox="0 0 320 80" preserveAspectRatio="none">
          <SvgPath
            d={ecgWaveformPath(reading.waveform)}
            fill="none"
            stroke={theme.colors.accent1}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      </View>
      <View style={styles.ecgGrid}>
        {rows.map(([k, v]) => (
          <View style={styles.ecgCell} key={k}>
            <Text style={styles.ecgLabel}>{k}</Text>
            <Text style={styles.ecgValue}>{v}</Text>
          </View>
        ))}
      </View>
      {isMeasuring ? (
        <Text style={styles.emptyNote}>测量中…（{progress?.progress ?? 0}%）</Text>
      ) : (
        measureBtn
      )}
    </Card>
  );
}

/** 运动统计 tab：展示今日步数/步行距离/活动消耗。
 * 数据来自 ring.stepDaily[今日 dateKey]，由原生 backfill + 实时计步累积。 */

/** 运动统计 tab：展示今日步数/步行距离/活动消耗。
 * 数据来自 ring.stepDaily[今日 dateKey]，由原生 backfill + 实时计步累积。
 * 点击任一项进入 MetricDetail 详情页，可切周/月/年查看历史趋势。 */
function ActivityStatsTab({ ring }: { ring: RingState }) {
  const navigation = useNavigation<any>();
  const today = new Date();
  const dk = dayKey(today.getTime());  // ★ 补零格式
  const step = ring.stepDaily?.[dk];
  const steps = step?.steps ?? 0;
  const distance = step?.distance ?? 0;
  const calorie = step?.calorie ?? 0;

  const fmtInt = (n: number) => n.toLocaleString('zh-CN');
  const fmtKm = (km: number) => km >= 10 ? km.toFixed(1) : km.toFixed(2);

  const openDetail = (key: string, name: string, unit: string, yMin: number, yMax: number) => {
    navigation.navigate('MetricDetail', { key, name, unit, yMin, yMax });
  };

  const StatTile = ({
    label, value, unit, color, onPress,
  }: { label: string; value: string; unit: string; color: string; onPress: () => void }) => (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      style={{ alignItems: 'center', flex: 1, paddingVertical: 8 }}
    >
      <Text style={{ fontSize: 13, color: theme.colors.textSub, marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontSize: 28, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 12, color: theme.colors.textSub, marginTop: 2 }}>{unit}</Text>
    </TouchableOpacity>
  );

  return (
    <Card style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.textInk }}>今日运动</Text>
        <Text style={{ fontSize: 12, color: theme.colors.textSub }}>{dk}</Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <StatTile
          label="步数"
          value={fmtInt(steps)}
          unit="步"
          color={theme.colors.accentSolid}
          onPress={() => openDetail('steps', '步数', '步', 0, Math.max(10000, Math.ceil(steps * 1.2)))}
        />
        <View style={{ width: 1, height: 60, backgroundColor: theme.colors.cardBorder }} />
        <StatTile
          label="步行距离"
          value={fmtKm(distance)}
          unit="km"
          color={theme.colors.stateEnergy}
          onPress={() => openDetail('distance', '步行距离', 'km', 0, Math.max(5, Math.ceil(distance * 1.5)))}
        />
        <View style={{ width: 1, height: 60, backgroundColor: theme.colors.cardBorder }} />
        <StatTile
          label="活动消耗"
          value={fmtInt(Math.round(calorie))}
          unit="kcal"
          color={theme.colors.stateTense}
          onPress={() => openDetail('calorie', '活动消耗', 'kcal', 0, Math.max(300, Math.ceil(calorie * 1.2)))}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space.xl },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
  },
  chipRow: { flexGrow: 0, marginLeft: -theme.space.screen },
  chipContent: { paddingHorizontal: theme.space.screen, paddingVertical: theme.sp(1) },
  grid: { gap: theme.space.lg },
  emptyNote: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
  },
  sectionLabel: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
    marginTop: theme.space.md,
    marginBottom: theme.space.xs,
  },
  ecgBtn: {
    marginTop: theme.space.md,
    backgroundColor: theme.colors.accent1,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    alignSelf: 'flex-start',
  },
  ecgBtnDisabled: { opacity: 0.5 },
  ecgBtnText: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.semibold,
  },
  ecgProgressBar: {
    height: 6,
    backgroundColor: theme.colors.textSub + '44',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: theme.space.sm,
  },
  ecgProgressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent1,
    borderRadius: 3,
  },
  profTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.space.xs,
  },
  profHint: {
    fontSize: theme.fontSize.micro,
    lineHeight: theme.fontSize.micro * 1.7,
    color: theme.colors.textSub,
    marginBottom: theme.space.sm,
  },
  profRow: { flexDirection: 'row', gap: theme.space.md, marginBottom: theme.space.sm },
  profField: { flex: 1 },
  profLabel: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.textSub,
    marginBottom: theme.space.xs,
  },
  profInput: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    fontSize: theme.fontSize.card,
    color: theme.colors.textTitle,
  },
  seg: { flexDirection: 'row', backgroundColor: theme.colors.ui.offTrack, borderRadius: theme.radius.card, padding: theme.sp(1) },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.card,
  },
  segBtnOn: { backgroundColor: theme.colors.accentSolid },
  segText: { fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold, color: theme.colors.textSub },
  segTextOn: { color: '#FFFFFF' },
  profSave: {
    marginTop: theme.space.xs,
    backgroundColor: theme.colors.accentSolid,
    borderRadius: theme.radius.card,
    paddingVertical: theme.sp(3),
    alignItems: 'center',
  },
  profSaveText: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: '#FFFFFF' },
  profSaved: { marginTop: theme.space.xs, fontSize: theme.fontSize.micro, color: theme.colors.success, textAlign: 'center' },
  ecgChart: {
    backgroundColor: theme.colors.ui.offTrack,
    borderRadius: theme.radius.card,
    padding: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  ecgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  ecgCell: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  ecgLabel: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, marginBottom: theme.sp(1) },
  ecgValue: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
});
