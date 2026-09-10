import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { theme } from '../theme/theme';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import TaskDeck from '../components/TaskDeck';
import Icon from '../components/Icon';
import ListCard, { type ListItem } from '../components/ListCard';
import { TOOL_GRID } from '../data/tasks';

const TOOL_IMAGES: Record<string, number> = {
  '呼吸冥想': require('../assets/card_meditation.jpg'),
  '认知提升': require('../assets/card_cognitive.png'),
  '专注力提升': require('../assets/card_focus.jpg'),
  '知识学习': require('../assets/card_learn.png'),
};
import { useAppState } from '../state/AppState';
import type { TabParamList } from '../navigation/BottomTabNavigator';

const RECENT: ListItem[] = [
  { dot: theme.colors.accent1, title: '4-7-8 呼吸法', sub: '昨天 · 8 分钟', right: '已完成' },
  { dot: theme.colors.accent2, title: '数字记忆广度训练', sub: '8 月 27 日 · 12 分钟', right: '已完成' },
  { dot: theme.colors.stateCalm, title: '深度专注 50 分钟', sub: '8 月 26 日 · 50 分钟', right: '已完成' },
];

export default function MeditationScreen() {
  const { tools, completeTask } = useAppState();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();

  const handleComplete = useCallback(
    (id: string) => {
      completeTask(id);
      navigation.navigate('Profile');
    },
    [completeTask, navigation]
  );

  return (
    <ScreenContainer compactTop>
      <Text style={styles.title}>Tools</Text>

      <TaskDeck tools={tools} onComplete={handleComplete} />

      <View style={styles.grid}>
        {TOOL_GRID.map((t) => (
          <TouchableOpacity key={t.name} activeOpacity={0.88} style={styles.gridCell}>
            <ImageBackground
              source={TOOL_IMAGES[t.name]}
              style={styles.toolCard}
              imageStyle={{ borderRadius: theme.radius.md }}
              resizeMode="cover"
            >
              <View style={styles.toolOverlay} />
              <View style={styles.toolIco}>
                <Icon name={t.icon} size={theme.fs(22)} color="#fff" strokeWidth={1.8} />
              </View>
              <Text style={styles.toolName}>{t.name}</Text>
              <Text style={styles.toolSub}>{t.sub}</Text>
            </ImageBackground>
          </TouchableOpacity>
        ))}
      </View>

      <ListCard title="最近使用" items={RECENT} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: theme.colors.textWhite,
    marginBottom: theme.space.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.sp(2) },
  gridCell: { width: '50%', padding: theme.sp(2) },
  toolCard: {
    alignItems: 'center',
    paddingVertical: theme.space.lg,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    height: 180,
    justifyContent: 'center',
  },
  toolOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: theme.radius.md,
  },
  toolIco: {
    width: theme.sp(12),
    height: theme.sp(12),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space.sm,
  },
  toolName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.semibold,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  toolSub: {
    fontSize: theme.fontSize.micro,
    color: 'rgba(255,255,255,0.85)',
    marginTop: theme.sp(1),
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 3,
  },
});
