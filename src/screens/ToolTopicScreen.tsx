/**
 * ToolTopicScreen —— 工具页通用内容页（v18.41 按斯坦福平衡激素法则重做）
 *
 * 承接工具页六宫格中尚无独立模块的三类：提升颜值 / 运动建议 / 知识科普。
 * 结构：标题 + 副标题 + 一条「今日状态」数据驱动提示 + 知识条目（ListCard）。
 * 内容框架：斯坦福神经科学的激素平衡四杠杆——光（皮质醇/褪黑素节律）、
 * 睡（深睡修复）、压（皮质醇/多巴胺基线）、动（训练与恢复）；
 * 再叠上 Mira 的周期视角（雌/孕激素对每个杠杆的调制）。
 * 口径：平实、带原因、不做诊断承诺（Mira 文案铁律）。
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
  glow: { title: '提升颜值', sub: '斯坦福平衡激素法则 × 周期节奏：激素调顺，气色是结果' },
  sport: { title: '运动建议', sub: '按激素状态定强度：先看恢复，再看意志力' },
  learn: { title: '知识科普', sub: '平衡激素的四根杠杆：光 · 睡 · 压 · 动' },
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

  // ── 「今日」一条数据驱动提示（挂激素杠杆 + 周期视角） ──
  const today: ListItem = (() => {
    if (topic === 'glow') {
      if (sleepScore == null) return { dot: ACCENT.glow, title: '睡眠与气色', sub: '连续佩戴记录睡眠后，这里会告诉你昨晚的深睡修复给气色加了多少分。' };
      return sleepScore >= 80
        ? { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: `深睡修复到位，${phase}期皮肤修复窗口在线——今天防晒做好，气色能保住。` }
        : { dot: ACCENT.glow, title: `昨晚睡眠 ${sleepScore} 分`, sub: '生长激素主要在深睡分泌——今晚提前 30 分钟调暗灯光，把修复窗口找回来。' };
    }
    if (topic === 'sport') {
      if (levelIdx == null) return { dot: ACCENT.sport, title: '今日运动建议', sub: '佩戴后按实时电量与恢复状态（HRV）给出强度建议。' };
      if (phase === '经期') return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '经期激素在低位，以低强度为主：散步、拉伸、温和瑜伽都合适。' };
      if (levelIdx === 0) return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量在高位，适合安排一次有强度训练——力量课是胰岛素敏感性的杠杆。' };
      return { dot: ACCENT.sport, title: `今日 ${steps} 步 · 电量 ${Math.round(value!)}`, sub: '电量偏低，先快走 15 分钟（Zone 2 强度）恢复代谢，别硬扛高强度。' };
    }
    // learn
    return phase === '未记录'
      ? { dot: ACCENT.learn, title: '平衡激素法则', sub: '记录经期后，科普内容会跟着你的周期阶段与节律数据一起更新。' }
      : { dot: ACCENT.learn, title: `当前 ${phase}`, sub: '本阶段激素如何改写你的光-睡-压-动四根杠杆，下方条目按周期定制。' };
  })();

  // ── 静态知识条目（斯坦福平衡激素法则 × 周期） ──
  const items: ListItem[] = topic === 'glow'
    ? [
        { dot: ACCENT.glow, title: '晨光：免费的气色开关', sub: '起床 30-60 分钟内到户外见光 5-10 分钟，皮质醇准点爬升、褪黑素准点到来——节律顺了，气色是结果。' },
        { dot: ACCENT.glow, title: '深睡是修复窗口', sub: '生长激素主要在深睡分泌，皮肤屏障与胶原修复都在这里发生；睡眠债会直接写在脸上。' },
        { dot: ACCENT.glow, title: '压力皮质醇是暗沉推手', sub: '长期高压让皮质醇持续偏高，出油、爆痘、屏障变弱跟着来。两次短吸 + 一次长呼的「生理性叹息」能快速降温。' },
        { dot: ACCENT.glow, title: '黄体期：精简护肤', sub: '孕激素升高伴随核心体温上行，出油与敏感增加——精简护肤、少叠加功效品，把屏障养住。' },
      ]
    : topic === 'sport'
      ? [
          { dot: ACCENT.sport, title: '先看 HRV，再定强度', sub: '晨间 HRV 明显低于基线 = 交感还没退位，把当天的强度课换成恢复课，硬练只会加深疲劳。' },
          { dot: ACCENT.sport, title: '卵泡期上强度，黄体期降强度', sub: '雌激素高位时肌肉恢复快、疼痛敏感低，力量课安排在这里；黄体期核心体温升高、恢复变慢，降强度提频次。' },
          { dot: ACCENT.sport, title: 'Zone 2 是激素底盘', sub: '每周 2-3 次「还能对话」节奏的有氧，改善线粒体与胰岛素敏感性——这是所有激素平稳运转的地基。' },
          { dot: ACCENT.sport, title: '力量训练是激素杠杆', sub: '每周 2-4 次复合动作优先的力量训练，对胰岛素敏感性和情绪韧性都有长期回报。' },
        ]
      : [
          { dot: ACCENT.learn, title: '皮质醇不是敌人，时机才是', sub: '晨峰帮你清醒、动员能量；问题只出现在它出现在错误的时间。晨光是校准器，不靠咖啡硬拉。' },
          { dot: ACCENT.learn, title: '褪黑素怕光', sub: '夜间哪怕中等亮度也会压制褪黑素。睡前把灯调暗、屏幕拿远，比任何补剂都靠谱。' },
          { dot: ACCENT.learn, title: '多巴胺基线：别喂廉价刺激', sub: '刷手机、糖、频繁切换任务都在抬高多巴胺基线，难事显得无趣。早上第一个小时别喂手机，把动力留给正事。' },
          { dot: ACCENT.learn, title: 'NSDR：20 分钟快速回血', sub: '非睡眠深度休息（瑜伽休憩/身体扫描）能降低皮质醇、恢复多巴胺储备，午后低谷比咖啡更好用。' },
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
