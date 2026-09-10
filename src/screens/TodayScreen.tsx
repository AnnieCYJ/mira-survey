import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, TouchableOpacity, Image, ImageBackground } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';

const IMG_EMOTION = require('../assets/card_focus.jpg');
const IMG_COG = require('../assets/card_cognitive.png');
const IMG_ACTIVITY = require('../assets/card_meditation.jpg');
import Card from '../components/Card';
import Icon from '../components/Icon';
import EnergyBall from '../components/EnergyBall';
import TrendChart, { TrendAxis } from '../components/TrendChart';
import ListCard, { type ListItem } from '../components/ListCard';
import { MOODS } from '../data/metrics';
import { computeStressReport } from '../lib/stressAlgorithm';
import { computeCognitiveLoadReport } from '../lib/cognitiveLoad';
import { RingBle } from '../ble/RingBleManager';
import { dayKey } from '../data/healthStore';
import { curveLevel, CURVE_DEFAULTS, type CurveStatus } from '../lib/dailyStatus';

const ADVICE_STATIC: ListItem[] = [
  {
    dot: theme.colors.stateTense,
    title: '14:00 会议前安排 5 分钟呼吸',
    sub: '该时段连续两天出现压力峰值',
  },
  {
    dot: theme.colors.stateTired,
    title: '入睡时间提前 20 分钟',
    sub: '深睡窗口稳定，可再争取一个完整周期',
  },
];

// 首条建议：跟随真实周期相位 + 雌激素建模指数（替代写死的「雌激素峰值窗口」）。
// 雌激素指数由 computeCycle 用真实排卵日（含体温确认覆盖）算出，非编数据。
function cycleAdviceItem(cs: CurveStatus | null): ListItem {
  if (!cs || !cs.hasLog || cs.dayInCycle == null) {
    return {
      dot: theme.colors.stateTired,
      title: '记录经期后开启周期建议',
      sub: '今天先以身体感受为准，灵活安排节奏',
    };
  }
  const e = cs.estrogenIndex;
  const eTxt = e != null ? `（指数 ${e}）` : '';
  switch (cs.phaseLabel) {
    case '经期':
      return {
        dot: theme.colors.stateTired,
        title: '今天以温和舒缓为主',
        sub: `经期第 ${cs.dayInCycle} 天，雌激素低位${eTxt}，适合休息与轻活动`,
      };
    case '卵泡期':
      return {
        dot: theme.colors.stateEnergy,
        title: '适合开启新计划与创造性工作',
        sub: `雌激素回升${eTxt}，精力逐步走高`,
      };
    case '排卵期':
      return {
        dot: theme.colors.stateEnergy,
        title: '状态活跃，适合社交与重要沟通',
        sub: `雌激素峰值${eTxt}，恢复能力处于本月高位`,
      };
    case '黄体期':
      return {
        dot: theme.colors.stateTense,
        title: '适合专注执行与收尾',
        sub: `雌激素回落${eTxt}，留意情绪与能量起伏`,
      };
    default:
      return {
        dot: theme.colors.stateTired,
        title: '记录经期后开启周期建议',
        sub: '今天先以身体感受为准',
      };
  }
}


function EnergyMiniCard({ title, subtitle, accent, icon, value, unit, onPress, image }: {
  title: string; subtitle: string; accent: string; icon: import('../components/Icon').IconName; value: string; unit: string; onPress: () => void; image?: number;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <ImageBackground
        source={image || require('../assets/card_stress.jpg')}
        style={styles.energyMini}
        imageStyle={styles.energyMiniImg}
        resizeMode="cover"
      >
        {/* 底部渐变遮罩 */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.6)']}
          style={styles.energyMiniOverlay}
        />
        <View style={styles.energyMiniLabel}>
          <Text style={styles.energyMiniTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.energyMiniValRow}>
            <Text style={styles.energyMiniVal}>{value}</Text>
            <Text style={styles.energyMiniUnit}> {unit}</Text>
          </View>
        </View>
      </ImageBackground>
    </TouchableOpacity>
  );
}


function EnergyRowData({ ring, onNav }: { ring: any; onNav: (type: 'emotion' | 'cognitive' | 'activity') => void }) {
  const _dk = (() => {
    try {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch { return ''; }
  })();
  // 情绪消耗 = 今日压力事件数
  const stress = (() => {
    try {
      const r = computeStressReport();
      return r?.events?.length > 0 ? String(r.events.length) : '—';
    } catch { return '—'; }
  })();
  // 脑力消耗 = 认知负荷分 0-100
  const cognitive = (() => {
    try {
      const r = computeCognitiveLoadReport();
      return r?.loadScore != null ? String(Math.round(r.loadScore)) : '—';
    } catch { return '—'; }
  })();
  // 运动消耗 = 今日步数
  const step = (() => {
    try {
      const s = ring?.stepDaily?.[_dk]?.steps;
      return s ? s.toLocaleString('zh-CN') : '—';
    } catch { return '—'; }
  })();
  const card = (img: number, title: string, val: string, unit: string, onPress: () => void) => (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={{ flex: 1 }}>
      <ImageBackground
        source={img}
        style={{ height: 160, borderRadius: theme.radius.card, overflow: 'hidden' }}
        resizeMode="cover"
      >
        {/* 底部渐暗遮罩，让文字可读 */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.75)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 }}
        />
        {/* 标题 + 值 */}
        <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
          <Text style={{
            color: '#fff',
            fontSize: theme.fontSize.micro,
            fontWeight: theme.weight.medium,
            letterSpacing: 0.5,
            opacity: 0.92,
          }}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
            <Text style={{
              color: '#fff',
              fontSize: theme.fontSize.h2,
              fontWeight: theme.weight.bold,
            }}>{val}</Text>
            <Text style={{
              color: 'rgba(255,255,255,0.8)',
              fontSize: theme.fontSize.micro,
              marginLeft: 2,
            }}>{unit}</Text>
          </View>
        </View>
      </ImageBackground>
    </TouchableOpacity>
  );
  return (
    <View style={{ flexDirection: 'row', gap: theme.sp(3) }}>
      {card(IMG_EMOTION, '情绪消耗', stress, '次', () => onNav('emotion'))}
      {card(IMG_COG, '脑力消耗', cognitive, '/100', () => onNav('cognitive'))}
      {card(IMG_ACTIVITY, '运动消耗', step, '步', () => onNav('activity'))}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// 相位 + 能量状态 → 一句今日分析建议
function phaseAdvice(phase: string, statusIdx: number | null): string {
  const low = statusIdx != null && statusIdx >= 2; // 平平静静 / 休息一下
  const map: Record<string, { ok: string; low: string }> = {
    经期: { ok: '适合放缓节奏、做温和的整理与复盘', low: '以休息为主，避免高强度安排' },
    卵泡期: { ok: '精力回升，适合开启新计划与创造性工作', low: '适合轻度规划，别给自个太大压力' },
    排卵期: { ok: '状态活跃，适合社交、沟通与重要决策', low: '适合一对一沟通，重大决策可稍缓' },
    黄体期: { ok: '适合专注执行与收尾，留意情绪起伏', low: '以收尾和轻松事务为主' },
  };
  const entry = map[phase];
  if (!entry) return '记录经期后，为你提供周期专属建议';
  return low ? entry.low : entry.ok;
}

export default function TodayScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const [chartW, setChartW] = useState(0);
  const [ring, setRing] = useState(() => RingBle.getState());
  useEffect(() => RingBle.onState(setRing), []);
  const cardWidth =
    Math.min(width, theme.layout.maxWidth) - theme.space.screen * 2 - theme.space.cardPad * 2;

  // 圆环下方分析胶囊：状态胶囊（跟随心情色）+ 相位标签（软底彩字）+ 建议（描述文字），统一走 design token
  const status = ring.curveStatus;
  const statusIdx = status && status.value != null ? curveLevel(status.value, CURVE_DEFAULTS).index : null;
  const mood = statusIdx != null ? MOODS[statusIdx] : null;
  const phase = status?.phaseLabel ?? '未记录';
  const phaseKnown = phase !== '未记录';
  const advice = phaseAdvice(phase, statusIdx);
  const hasStatus = !!mood;
  const showPill = hasStatus || phaseKnown;
  const narrative = showPill ? advice : '佩戴并连续记录后，为你生成今日状态分析';

  // 今日建议：首条跟随真实周期相位 + 雌激素指数，其余为通用建议
  const ADVICE: ListItem[] = [cycleAdviceItem(ring.curveStatus), ...ADVICE_STATIC];

  return (
    <View style={styles.page}>
      {/* 仅 Today 页：上白下紫的分屏背景，其他页面保留 App 根渐变 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite, theme.colors.bgMidAlt, theme.colors.bgTop]}
        locations={[0, 0.42, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer>
        <View style={styles.head}>
          <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>K</Text>
            </View>
            <Text style={styles.name}>Kristina</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Today</Text>
        </View>

        <View style={styles.energyWrap}>
          <EnergyBall status={ring.curveStatus} />
          <View style={styles.statusPill}>
            {showPill && (
              <View style={styles.statusChipRow}>
                {mood && (
                  <View style={[styles.statusChip, { backgroundColor: mood.color }]}>
                    <Text style={styles.statusChipText}>{mood.label}</Text>
                  </View>
                )}
                {phaseKnown && (
                  <View style={styles.phaseChip}>
                    <Text style={styles.phaseChipText}>{phase}</Text>
                  </View>
                )}
              </View>
            )}
            <Text style={styles.statusNarr}>{narrative}</Text>
          </View>
        </View>

        <TouchableOpacity activeOpacity={0.92} onPress={() => navigation.navigate('StatusTrendDetail')}>
          <Card style={styles.trendCard}>
            <View style={styles.trendHead}>
              <Text style={styles.cardTitle}>全天状态趋势</Text>
              <Icon name="chevronRight" size={theme.fs(18)} color={theme.colors.textSub} />
            </View>
            <Text style={styles.axisY}>纵轴：状态指数 0–100（越高越有活力）</Text>
          <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
            {chartW > 0 ? <TrendChart width={chartW} timeline={ring.statusTimeline} /> : null}
          </View>
          {chartW > 0 ? <TrendAxis width={chartW} /> : null}
          <View style={styles.legend}>
            {MOODS.map((m) => (
              <LegendDot key={m.key} color={m.color} label={m.label} />
            ))}
          </View>
          </Card>
        </TouchableOpacity>


        {/* 情绪消耗 / 脑力消耗 / 运动消耗 */}
        <EnergyRowData ring={ring} onNav={(type) => navigation.navigate('EnergyDetail', { type })} />

        <View style={styles.adviceWrap}>
          <ListCard title="今日建议" items={ADVICE} />
        </View>
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%' },
  head: { marginBottom: theme.space.xl * 1.5 },
  avatarName: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.space.xs },
  avatar: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.avatarBgLight,
    borderWidth: 1,
    borderColor: theme.colors.avatarBorderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.sm,
  },
  avatarLetter: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
  },
  name: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
  },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textInk,
    marginTop: theme.space.xs,
  },
  energyWrap: { marginBottom: theme.space.sm, alignItems: 'center' },
  statusPill: {
    marginTop: theme.space.sm,
    alignSelf: 'center',
    width: '92%',
    backgroundColor: theme.colors.cardBg,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    ...theme.shadow.card,
  },
  statusChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: theme.space.xs,
  },
  statusChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  statusChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.orbTextInk,
  },
  phaseChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accentSoft,
    marginRight: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  phaseChipText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  statusNarr: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.55,
    color: theme.colors.textSub,
    textAlign: 'center',
  },
  trendCard: { marginTop: theme.space.md, marginBottom: theme.space.lg },

  energyCol: {
    flexDirection: 'row',
    gap: theme.space.sm,
    marginTop: theme.space.md,
  },
  energyMini: {
    flex: 1,
    height: 130,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  energyMiniImg: {
    borderRadius: theme.radius.md,
  },
  energyMiniOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 70,
  },
  energyMiniLabel: {
    position: 'absolute', left: 10, right: 10, bottom: 10,
  },
  energyMiniTitle: {
    fontSize: theme.fontSize.micro,
    color: '#fff',
    fontWeight: theme.weight.medium,
  },
  energyMiniValRow: {
    flexDirection: 'row', alignItems: 'baseline',
    marginTop: 2,
  },
  energyMiniVal: {
    fontSize: theme.fontSize.card,
    color: '#fff',
    fontWeight: theme.weight.semibold,
  },
  energyMiniUnit: {
    fontSize: theme.fontSize.micro,
    color: 'rgba(255,255,255,0.85)',
  },
  adviceWrap: { marginTop: theme.space.md },
  cardTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  trendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.sm,
  },
  axisY: {
    fontSize: theme.fontSize.micro,
    color: theme.colors.accentSolid,
    fontWeight: theme.weight.medium,
    marginBottom: theme.sp(1),
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.space.sm,
    gap: theme.space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: theme.sp(2.5), height: theme.sp(2.5), borderRadius: theme.sp(1.25), marginRight: theme.sp(1) },
  legendText: { fontSize: theme.fontSize.micro, color: theme.colors.textSub },
});
