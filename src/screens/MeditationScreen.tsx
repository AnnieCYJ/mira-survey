import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, Image, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import TaskDeck from '../components/TaskDeck';
import ListCard, { type ListItem } from '../components/ListCard';
import { TOOL_GRID } from '../data/tasks';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';


const TOOL_IMAGES: Record<string, number> = {
  '呼吸冥想': require('../assets/card_meditation.jpg'),
  '认知提升': require('../assets/card_cognitive.png'),
  '专注力提升': require('../assets/card_focus.jpg'),
  '知识学习': require('../assets/card_learn.png'),
  '饮食识别': require('../assets/card_food.jpg'),
};
import { useAppState } from '../state/AppState';


const RECENT: ListItem[] = [
  { dot: theme.colors.accent1, title: '4-7-8 呼吸法', sub: '昨天 · 8 分钟', right: '已完成' },
  { dot: theme.colors.accent2, title: '数字记忆广度训练', sub: '8 月 27 日 · 12 分钟', right: '已完成' },
  { dot: theme.colors.stateCalm, title: '深度专注 50 分钟', sub: '8 月 26 日 · 50 分钟', right: '已完成' },
];

export default function MeditationScreen() {
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  const { tools, completeTask } = useAppState();
  type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;
  const navigation = useNavigation<NavProp>();

  const handleComplete = useCallback(
    (id: string) => {
      completeTask(id);
      navigation.navigate('Profile');
    },
    [completeTask, navigation]
  );

  return (
    <View style={styles.page}>
      {/* v10：工具页背景全白（与首页/洞察页/日历页同款）；TOOL_GRID 图片卡保持原样 */}
      <LinearGradient
        colors={[theme.colors.textWhite, theme.colors.textWhite]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer compactTop scrollY={scrollY} topFadeColor={theme.colors.textWhite}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>Tools</Text>
          <Text style={styles.subtitle}>小的改变积累起来也很了不起</Text>
        </Animated.View>

      <TaskDeck tools={tools} onComplete={handleComplete} />

      <View style={styles.grid}>
        {TOOL_GRID.map((t) => (
          <TouchableOpacity
            key={t.name}
            activeOpacity={0.88}
            style={styles.gridCell}
            onPress={() => {
              if (t.name === '呼吸冥想') navigation.navigate('Breathing');
              if (t.name === '饮食识别') navigation.navigate('FoodScan', { autoCamera: true });
            }}
          >
            <ImageBackground
              source={TOOL_IMAGES[t.name]}
              style={styles.toolCard}
              imageStyle={{ borderRadius: theme.radius.md }}
              resizeMode="cover"
            >
              {/* v18.15：参考「Pick your Plan」四宫格 —— 图铺满整卡，蒙层只轻轻提亮底部，灰字居中 */}
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.86)']}
                locations={[0, 0.5, 1]}
                style={styles.toolMask}
              />
              <View style={styles.toolInner} pointerEvents="none">
                <Text style={styles.toolName}>{t.name}</Text>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        ))}
      </View>

      <ListCard title="最近使用" items={RECENT} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.sp(2) },
  gridCell: { width: '50%', padding: theme.sp(2) },
  toolCard: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    height: 180,
  },
  toolMask: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: '62%',
    borderBottomLeftRadius: theme.radius.md,
    borderBottomRightRadius: theme.radius.md,
  },
  toolInner: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: theme.space.md,
  },
  toolName: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkSoft,
    textAlign: 'center',
  },
});
