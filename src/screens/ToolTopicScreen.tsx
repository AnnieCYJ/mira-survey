/**
 * ToolTopicScreen —— 工具页通用内容页（v18.39）
 *
 * 承接工具页六宫格中尚无独立模块的三类：提升颜值 / 运动建议 / 知识科普。
 * 结构：标题 + 副标题 + 一条「今日状态」数据驱动提示 + 知识条目（ListCard）。
 * 内容口径：平实、带原因、不做诊断承诺（Mira 文案铁律）。
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import ListCard, { type ListItem } from '../components/ListCard';
import { healthStore, dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';

type TopicKey = 'glow' | 'sport' | 'learn';

const TOPIC_META: Record<TopicKey, { title: string; sub: string }> = {
  glow: { title: '提升颜值', sub: '跟着周期节奏，把气色养回来' },
  sport: { title: '运动建议', sub: '按今天的状态开运动处方' },
  learn: { title: '知识科普', sub: '读懂周期与身体信号的来龙去脉' },
};

const ACCENT: Record<TopicKey, string> = {
  glow: theme.colors.stateTense,
  sport: '#22C55E',
  learn: theme.colors.accent2,
};

export default function ToolTopicScreen() {
  const route = useRoute<{ key: string; name: string; params: { topic: TopicKey } }>();
  const navigation = useNavigation<CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>>();
  const topic: TopicKey = (route.params?.topic ?? 'learn') as TopicKey;
  const meta = TOPIC_META[topic] ?? TOPIC_META.learn;
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  // ── 当天数据（缺项静默降级，不编数字） ──
  const ring = RingBle.getState();
  const now = Date.now();
  const sleep = (() => {
    try { return healthStore.getSleep(dayKey(now)) ?? healthStore.getSleep(dayKey(now - 86400000)); } catch { return null; }
  })();
  const sleepScore = sleep && Number.isFinite(sleep.score) ? Math.round(sleep.score) : null;
  const steps = (() => { try { return ring?.stepDaily?.[dayKey(now)]?.steps ?? 0; } catch { return 0; } })();
  const phase = ring?.curveStatus?.phaseLabel ?? '未记录';
  const value = ring?.curveStatus?.value ?? null;
  const levelIdx = value != null ? (value >= 65 ? 0 : value >= 30 ? 1 : value >= 5 ? 2 : 3) : null;

  // ── 「今日」一条数据驱动提示 ──
  const today: ListItem = (() => {
    if (topic === 'glow') {
      if (sleepScore == null) return { dot: ACCENT.glow, title: '睡眠与气色', sub: '连续佩戴记录睡眠后，这里会告诉你昨晚的修复给气色加了多少分。' };
      return sleepScore >= 80
        ? { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: `${phase}期皮肤修复窗口在线——今天防晒做好，气色能保住。` }
        : { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: '皮肤屏障修复主要发生在深睡——今晚提前 30 分钟放下手机。' };
    }
    if (topic === 'sport') {
      if (levelIdx == null) return { dot: ACCENT.sport, title: '今日运动建议', sub: '佩戴后按实时电量与恢复状态给出运动强度建议。' };
      if (phase === '经期') return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '经期以低强度为主：散步、拉伸、温和瑜伽都合适。' };
      if (levelIdx === 0) return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量在高位，适合安排一次有强度训练，HRV 基线也会受益。' };
      return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量偏低，先快走 15 分钟恢复代谢，别硬扛高强度。' };
    }
    // learn
    return phase === '未记录'
      ? { dot: ACCENT.learn, title: '周期与大脑', sub: '记录经期后，科普内容会跟着你的周期阶段一起更新。' }
      : { dot: ACCENT.learn, title: `当前 ${phase}`, sub: '本阶段激素如何影响精力与情绪，下方条目按你的周期定制。' };
  })();

  // ── 静态知识条目 ──
  const items: ListItem[] = topic === 'glow'
    ? [
        { dot: ACCENT.glow, title: '卵泡期：皮肤血流量增加', sub: '雌激素上行让皮肤供血变好，是上妆最服帖的窗口。' },
        { dot: ACCENT.glow, title: '黄体期：出油与敏感上行', sub: '孕激素升高伴随体温上升，精简护肤、少叠加功效品。' },
        { dot: ACCENT.glow, title: '糖化是暗沉主因之一', sub: '高糖饮食后的糖化终产物让肤色发黄，先从含糖饮料下手。' },
        { dot: ACCENT.glow, title: '防晒是性价比最高的护肤', sub: '紫外线贡献了外源性衰老的大头，阴天也有 UVA。' },
      ]
    : topic === 'sport'
      ? [
          { dot: ACCENT.sport, title: '卵泡期：适合上强度', sub: '雌激素高位时肌肉恢复快、疼痛敏感低，力量训练安排在这里。' },
          { dot: ACCENT.sport, title: '黄体期后期：降强度提频次', sub: '核心体温升高、恢复变慢，把大重量换成中低强度多次数。' },
          { dot: ACCENT.sport, title: 'HRV 是强度调节器', sub: '晨间 HRV 明显低于基线时，把当天的强度课换成恢复课。' },
          { dot: ACCENT.sport, title: '步数是底线不是目标', sub: '每天 7000 步以上的日常活动量，比一周一次大练更养线粒体。' },
        ]
      : [
          { dot: ACCENT.learn, title: '雌激素与大脑敏感性', sub: '雌激素影响血清素与多巴胺通路，卵泡期精力上扬有生理基础。' },
          { dot: ACCENT.learn, title: '孕激素的镇静与代价', sub: '黄体期孕激素代谢物作用于 GABA 受体，嗜睡与情绪波动的来源。' },
          { dot: ACCENT.learn, title: '皮质醇的晨峰意义', sub: '晨起皮质醇高峰帮你清醒；节律偏晚，上午就没精神。' },
          { dot: ACCENT.learn, title: '为什么戒指测不了激素', sub: '激素分子需要生化检测；戒指测的是它们留下的生理足迹。' },
        ];

  return (
    <View style={styles.page}>
      <LinearGradient colors={[theme.colors.textWhite, theme.colors.textWhite]} style={StyleSheet.absoluteFill} />
      <ScreenContainer scrollY={scrollY} topFadeColor={theme.colors.textWhite}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>{meta.title}</Text>
          <Text style={styles.subtitle}>{meta.sub}</Text>
        </Animated.View>
        <ListCard title="今天" items={[today]} />
        <View style={{ height: theme.space.md }} />
        <ListCard title="为什么 & 怎么做" items={items} />
      </ScreenContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: mm.colors.inkSoft,
    marginBottom: theme.space.md,
  },
});
