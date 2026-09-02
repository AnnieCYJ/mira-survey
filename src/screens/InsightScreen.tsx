import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Chip from '../components/Chip';
import InsightBanner from '../components/InsightBanner';
import DimensionCard from '../components/DimensionCard';
import HormoneEstrogenCard from '../components/HormoneEstrogenCard';
import SleepStructureCard from '../components/SleepStructureCard';
import CyclePhaseCard from '../components/CyclePhaseCard';
import BasicMetricCard from '../components/BasicMetricCard';
import ManualMetricCard from '../components/ManualMetricCard';
import ListCard, { type ListItem } from '../components/ListCard';
import Card from '../components/Card';
import { METRICS, METRIC_ORDER, BASIC_METRICS, signalsForDimension, type MetricKey } from '../data/metrics';
import { RingBle, type RingState, type MetricKey as RingMetricKey } from '../ble/RingBleManager';
import { useAppState } from '../state/AppState';

function formatValue(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 以 ima 归档（04-屏幕Screens）的权威洞察页设计为底：
// 5 个维度 chip（睡眠和激素/周期和激素/代谢/心脏健康/心理和压力）+ 选中后 DimensionCard + 本周关键变化。
// 新增「基础指标」tab 置顶：直连戒指真实信号（心率/血氧/体温/皮电/HRV/呼吸率）。
type TabKey = 'basics' | MetricKey;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basics', label: '基础指标' },
  ...METRIC_ORDER.map((k) => ({ key: k, label: METRICS[k].name })),
];

const CHANGES: ListItem[] = [
  { dot: theme.colors.stateCalm, title: 'HRV 基线 58 → 62 ms', sub: '连续 5 天高于个人基线' },
  { dot: theme.colors.stateTense, title: '午后压力峰值提前 40 分钟', sub: '与新增的晨会时段高度重合' },
  { dot: theme.colors.stateEnergy, title: '深睡占比 21% → 24%', sub: '入睡时间提前带来的直接改善' },
];

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

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  // 自动监测开关联动戒指轮询（设置页总开关 → 这里下发到原生桥）
  useEffect(() => {
    RingBle.setAutoMonitor(autoMonitor);
  }, [autoMonitor]);

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
          <View style={styles.grid}>
            {BASIC_METRICS.map((m) => {
              const rk = m.key as RingMetricKey;
              const realVal = ring.metrics[rk];
              const realHistory = ring.history[rk];
              return (
                <BasicMetricCard
                  key={m.key}
                  metric={m}
                  auto={trendOn}
                  live={ring.availability[rk] === 'live'}
                  syncing={ring.availability[rk] === 'syncing'}
                  value={formatValue(realVal)}
                  data={realHistory}
                  onMeasure={() => RingBle.measure(rk)}
                  measureTime={ring.lastUpdated[rk]}
                />
              );
            })}
          </View>
        ) : tab === 'cycle' ? (
          <>
            <CyclePhaseCard ring={ring} female={ring.female} />
            <HormoneEstrogenCard ring={ring} female={ring.female} />
          </>
        ) : (
          <View style={styles.stack}>
            <DimensionCard metric={METRICS[tab]} onPress={() => {}} />
            {tab === 'sleep' && (
              <SleepStructureCard
                segments={ring.sleepStages}
                summary={ring.sleepSummary}
                sleepTime={ring.sleepTime}
                wakeTime={ring.wakeTime}
                deepPct={ring.daily['sleepDeep'] ?? null}
                remPct={ring.daily['sleepRem'] ?? null}
                score={ring.daily['sleepScore'] ?? null}
                fallbackTotalMinutes={ring.daily['sleepTotal'] ?? null}
              />
            )}
            {(() => {
              const sigs = signalsForDimension(tab);
              if (sigs.length === 0) {
                return (
                  <Card>
                    <Text style={styles.emptyNote}>
                      该维度暂无可直连的信号，等待原生接入。
                    </Text>
                  </Card>
                );
              }
              // 扩展信号末次测量时间：取 dailyHistory 最后一个点的 t（原生每次读取写入一个今日时刻点）
              const lastTimeOf = (key: string): number | null => {
                const arr = ring.dailyHistory[key];
                if (arr && arr.length > 0) return arr[arr.length - 1].t;
                return null;
              };
              return (
                <View style={styles.grid}>
                  {sigs.map((m) => {
                    const real = ring.daily[m.key] ?? null;
                    const hist = ring.dailyHistory[m.key] ?? [];
                    const measureTime = lastTimeOf(m.key);
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
});
