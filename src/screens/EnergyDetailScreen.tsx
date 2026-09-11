/**
 * EnergyDetailScreen —— 详情页
 *
 * 顺序（对齐 MetricDetail + 用户要求）：
 *   返回头 → Hero → RangeSwitch → DateAnchorPicker → 图表(置顶) → 指标网格 → 其他内容 → 解读
 *
 * 情绪消耗: StressInsightCard 的数据，图=全天压力事件分布
 * 脑力消耗: CognitiveLoadCard 的数据，图=全天认知负荷分布
 * 运动消耗: 步数/距离/消耗 list + MetricDetail 跳转
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import RangeSwitch from '../components/RangeSwitch';
import DateAnchorPicker from '../components/DateAnchorPicker';
import Icon from '../components/Icon';
import Card from '../components/Card';
import Svg, { Line, Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

// StressInsightCard 导出的组件/函数
import { Metric, levelColor } from '../components/StressInsightCard';

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
  const [ring, setRing] = useState(() => RingBle.getState());

  useEffect(() => {
    const off = RingBle.onState(setRing);
    return off;
  }, []);

  return (
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

        {/* ===== 内容：图在上，数据在下 ===== */}
        {type === 'emotion' && range === 'day' && <EmotionDetail />}
        {type === 'cognitive' && range === 'day' && <CognitiveDetail />}
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
  );
}

/* ========== Hero ========== */
function HeroRow({ type, accent, anchor, ring }: { type: EnergyType; accent: string; anchor: Date; ring: any }) {
  const report = useMemo(() => {
    if (type === 'emotion') {
      const { computeStressReport } = require('../lib/stressAlgorithm');
      return computeStressReport();
    }
    if (type === 'cognitive') {
      const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
      return computeCognitiveLoadReport();
    }
    return null;
  }, [type]);

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
/** 今日皮质醇 0-24h 折线图（每小时聚合） */
function EmotionDetail() {
  // ★ 每次渲染都重算（依赖 ring state / 代码逻辑变更后立即生效）
  const { computeStressReport } = require('../lib/stressAlgorithm');
  const report = computeStressReport();

  const color = levelColor(report.level);
  const hasData = report.sampleCount >= 5;

  if (!hasData) {
    return (
      <Card>
        <Text style={styles.emptyText}>还没有足够的 EDA 数据。连上戒指后开启自动监测，约 30 分钟后开始生成个人基线。</Text>
      </Card>
    );
  }

  return (
    <>
      {/* ★ 图在最上面 —— 全天情绪事件分布 (竖线 + 彩色圆点) */}
      {report.events.length > 0 && (
        <Card>
          <Text style={[styles.chartTitle, { fontSize: theme.fontSize.card, marginBottom: theme.sp(2) }]}>全天情绪分布</Text>
          <StressEventStems events={report.events} chartH={200} />
        </Card>
      )}

      {/* 大分数 */}
      <Card padded={false}>
        <View style={styles.pad}>
          <Text style={styles.cardTitle}>情绪洞察</Text>
          {report.events.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>今日 {report.events.length} 次压力事件</Text>
            </View>
          )}
          {/* 4 子指标 — 等宽均分 (MetricDetail statGrid 同款) */}
          <View style={styles.statGrid}>
            <StatCell label="情绪消耗" value={report.emotionalLoad != null ? `${report.emotionalLoad}` : '—'}
              sub={report.emotionalLoad != null ? (report.emotionalLoad > 60 ? '高消耗 · 需要休息' : report.emotionalLoad > 30 ? '中等 · 恢复较快' : '低消耗 · 状态良好') : ''}
              valueColor={report.emotionalLoad != null && report.emotionalLoad > 60 ? theme.colors.danger : undefined} />
            <StatCell label="恢复时间" value={report.avgRecoverySec != null ? `${report.avgRecoverySec}s` : '—'}
              sub={report.avgRecoverySec != null && report.avgRecoverySec > 120 ? '偏慢' : '正常'} />
            <StatCell label="峰值时段" value={report.peakHour != null ? `${String(Math.floor(report.peakHour)).padStart(2,'0')}:00` : '—'}
              sub={report.peakHour != null ? '事件最多' : ''} />
            <StatCell label="唤醒分" value={
                report.level === 'calm' ? '平静' :
                report.level === 'mild' ? '轻度唤醒' :
                report.level === 'moderate' ? '中度唤醒' :
                report.level === 'high' ? '高度唤醒' : '—'
              } valueColor={color}
              sub={
                report.level === 'calm' ? '唤醒分<45 · 身心放松' :
                report.level === 'mild' ? '唤醒分 45–55 · 正常活动' :
                report.level === 'moderate' ? '唤醒分 55–65 · 有些紧张' :
                report.level === 'high' ? '唤醒分>65 · 焦虑/兴奋' : ''
              } />
          </View>
          
          {/* ★ 指标注释 */}
          <View style={{ marginTop: theme.sp(2), gap: theme.sp(1) }}>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: theme.fontSize.xs * 1.5 }}>
              {'● 情绪消耗（0–100）：0–30 低消耗 · 31–60 中等消耗 · 61–100 高消耗'}
            </Text>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: theme.fontSize.xs * 1.5 }}>
              {'● 唤醒分（0–100）：<45 平静 · 45–55 轻度唤醒 · 55–65 中度唤醒 · >65 高度唤醒'}
            </Text>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: theme.fontSize.xs * 1.5 }}>
              {'● 计算因子：事件密度 25% · 平均强度 25% · HRV 偏离 25% · SCR 恢复 25%（以个人基线为参考）'}
            </Text>
          </View>
          
          {/* ★ 5 档情绪说明 */}
          <View style={{ marginTop: theme.sp(1.5), gap: theme.sp(0.5) }}>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textInkSoft, fontWeight: theme.weight.medium as any }}>情绪分类（5 档）</Text>
            <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub, lineHeight: theme.fontSize.xs * 1.5 }}>
              {'🟡 兴奋 / 🟢 愉悦 / 🔵 平静 · 🟣 压力 / 🟠 焦虑'}
            </Text>
          </View>
        </View>
      </Card>


    </>
  );
}

/* ========== 脑力消耗：图在上 ========== */
function CognitiveDetail() {
  // ★ 每次渲染都重算
  const { computeCognitiveLoadReport } = require('../lib/cognitiveLoad');
  const report = computeCognitiveLoadReport();

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


/* ========== 情绪事件竖线图 (参考睡眠时长线图样式) ========== */
function StressEventStems({ events, chartH = 200 }: { events: any[]; chartH?: number }) {
  // ★ 5 档情绪分类
  const COL_EXCITED = theme.colors.moodEnergy;   // 兴奋 #F0C46E
  const COL_PLEASANT = theme.colors.moodGood;    // 愉悦 #6FCFB4
  const COL_CALM = theme.colors.stateTired;       // 平静 #7EA6F8
  const COL_STRESSED = theme.colors.stateEnergy;  // 压力 #9D8AF0
  const COL_ANXIOUS = theme.colors.danger;    // 焦虑 #E07B6B
  
  // ★ 睡眠过滤
  let bedHour: number | null = null;
  let wakeHour: number | null = null;
  try {
    const { healthStore } = require('../data/healthStore');
    const dk = new Date().toISOString().slice(0, 10);
    const sleepSum = healthStore.getSleep(dk);
    if (sleepSum && sleepSum.total > 0) {
      const parseHM = (s: string | null | undefined): number | null => {
        if (!s) return null;
        const m = s.match(/(\d{1,2}):(\d{2})/);
        return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : null;
      };
      const bH = parseHM(sleepSum.sleepTime);
      const wH = parseHM(sleepSum.wakeTime);
      if (bH != null && wH != null) { bedHour = bH; wakeHour = wH; }
      else if (bH != null) { bedHour = bH; wakeHour = (bH + sleepSum.total / 60) % 24; }
      else if (wH != null) { wakeHour = wH; bedHour = (wH - sleepSum.total / 60 + 24) % 24; }
    }
  } catch {}
  
  const isAsleep = (tMs: number): boolean => {
    if (bedHour == null || wakeHour == null) return false;
    const d = new Date(tMs);
    const h = d.getHours() + d.getMinutes() / 60;
    if (bedHour > wakeHour) return h >= bedHour || h < wakeHour;
    return h >= bedHour && h < wakeHour;
  };
  const filtered = events.filter((e) => !isAsleep(e.t));
  const useEvents = filtered.length > 0 ? filtered : events;
  
  // ★ 时间轴
  let axisStartH = 0, axisEndH = 24;
  if (bedHour != null && wakeHour != null) {
    if (bedHour > wakeHour) { axisStartH = wakeHour; axisEndH = bedHour; }
    else { axisStartH = wakeHour; axisEndH = 24; }
  }
  const hourCols: number[] = [];
  for (let h = Math.ceil(axisStartH); h <= Math.floor(axisEndH); h++) hourCols.push(h);
  if (hourCols.length === 0) hourCols.push(new Date().getHours());
  
  const COLS = hourCols.length;
  const ROWS = 4; // ★ 固定 4 行 = :00 / :15 / :30 / :45
  
  // ★ grid[col][row] = event (row 按分钟分配)
  const grid: (any|null)[][] = Array.from({ length: COLS }, () => Array(ROWS).fill(null));
  for (const e of useEvents) {
    const d = new Date(e.t);
    const h = d.getHours();
    const m = d.getMinutes();
    const col = hourCols.indexOf(h);
    if (col < 0) continue;
    const row = Math.min(3, Math.floor(m / 15)); // :00→0, :15→1, :30→2, :45→3
    // 同一格多个事件 → 保留 severity 更高的
    if (!grid[col][row] || (e.severity || 0) > (grid[col][row]?.severity || 0)) {
      grid[col][row] = e;
    }
  }
  
  // ★ 5 档情绪判定 (valenceLabel + severity 细分)
  const dotColor = (e: any): string => {
    if (!e) return 'transparent';
    const sev = e.severity || 50;
    if (e.valenceLabel === 'positive') return sev > 50 ? COL_EXCITED : COL_PLEASANT;
    if (e.valenceLabel === 'negative') return sev > 50 ? COL_ANXIOUS : COL_STRESSED;
    return COL_CALM;
  };
  const dotStyle = (e: any) => {
    const sev = e?.severity || 50;
    return {
      r: 6 + (sev / 100) * 7,
      opacity: 0.4 + (sev / 100) * 0.5,
    };
  };
  
  const CELL_H = theme.sp(5); const GAP = theme.sp(1);
  const LABEL_H = theme.sp(4);
// 左轴宽度
  
  return (
    <View style={{ width: '100%', paddingHorizontal: theme.space.xs, marginTop: theme.sp(2) }}>
      {/* ★ 固定 4 行格子 */}
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={{ flexDirection: 'row', marginBottom: row < ROWS - 1 ? GAP : 0 }}>
          {hourCols.map((h, col) => {
            const e = grid[col][row];
            const color = dotColor(e);
            const st = dotStyle(e);
            return (
              <View key={`${h}-${row}`} style={{
                flex: 1, aspectRatio: 0.7,
                marginRight: col < COLS - 1 ? GAP : 0,
                borderRadius: theme.radius.sm,
                backgroundColor: e ? theme.colors.ui.white25 : 'transparent',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: e ? 1 : 0,
                borderColor: theme.colors.ui.borderSoft,
              }}>
                {e && (
                  <Svg width="100%" height="100%" viewBox="0 0 40 20">
                    <Circle cx={20} cy={10} r={st.r + 6} fill={color} opacity={st.opacity * 0.15} />
                    <Circle cx={20} cy={10} r={st.r + 3} fill={color} opacity={st.opacity * 0.35} />
                    <Circle cx={20} cy={10} r={st.r} fill={color} opacity={st.opacity} />
                  </Svg>
                )}
              </View>
            );
          })}
        </View>
      ))}
      
      {/* ★ X 轴时间标签 (下) */}
      <View style={{ flexDirection: 'row', marginTop: theme.sp(1), height: LABEL_H }}>
        {hourCols.map((h, i) => (
          <Text key={h} style={{
            flex: 1,
            fontSize: theme.fontSize.sm,
            color: theme.colors.textSub,
            textAlign: 'center',
            fontWeight: theme.weight.medium,
            numberOfLines: 1,
            marginRight: i < COLS - 1 ? GAP : 0,
          }}>
            {h}
          </Text>
        ))}
      </View>
      
      {/* ★ 5 档情绪图例 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: theme.sp(2), gap: theme.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
          <Svg width={theme.sp(3)} height={theme.sp(3)}><Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={COL_EXCITED} opacity={0.9} /></Svg>
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>兴奋</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
          <Svg width={theme.sp(3)} height={theme.sp(3)}><Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={COL_PLEASANT} opacity={0.9} /></Svg>
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>愉悦</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
          <Svg width={theme.sp(3)} height={theme.sp(3)}><Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={COL_CALM} opacity={0.9} /></Svg>
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>平静</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
          <Svg width={theme.sp(3)} height={theme.sp(3)}><Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={COL_STRESSED} opacity={0.9} /></Svg>
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>压力</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.sp(0.5) }}>
          <Svg width={theme.sp(3)} height={theme.sp(3)}><Circle cx={theme.sp(1.5)} cy={theme.sp(1.5)} r={theme.sp(1)} fill={COL_ANXIOUS} opacity={0.9} /></Svg>
          <Text style={{ fontSize: theme.fontSize.xs, color: theme.colors.textSub }}>焦虑</Text>
        </View>
      </View>
    </View>
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


/** 等宽均分数据单元 (MetricDetail statCell 同款) */
function StatCell({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
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
