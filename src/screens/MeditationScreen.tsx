import React, { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, Image, Animated, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect, CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import TaskDeck from '../components/TaskDeck';
import { TOOL_GRID } from '../data/tasks';
import type { RootStackParamList } from '../navigation/RootStackNavigator';
import type { TabParamList } from '../navigation/BottomTabNavigator';
import { RingBle } from '../ble/RingBleManager';
import { buildToolCtx, recommendTools, markRecDone, initRecDone } from '../lib/toolRecommend';


const TOOL_IMAGES: Record<string, number> = {
  '情绪调节': require('../assets/card_emotion.jpg'),
  '提升颜值': require('../assets/card_recovery.jpg'),
  '营养搭配': require('../assets/card_food.jpg'),
  '运动建议': require('../assets/card_activity.jpg'),
  '稳定睡眠': require('../assets/card_meditation.jpg'),
  '知识科普': require('../assets/card_learn.png'),
};
import { useAppState } from '../state/AppState';
import TodayTimelineCard from '../components/TodayTimelineCard';
import { buildTodayTimeline } from '../lib/buildTodayTimeline';
import SuggestionCard from '../components/SuggestionCard';
import { listHabits, undoHabit, type HabitEntry } from '../data/habitSuggestions';


export default function MeditationScreen() {
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  const { tools, completeTask } = useAppState();

  // ★ 2026-10-07（用户：牌堆下方加「改善工具箱 / 我的建议」两个 tab；留下的习惯放进「我的建议」）
  const [tab, setTab] = useState<'tools' | 'mine'>('tools');
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const refreshHabits = useCallback(() => {
    listHabits().then(setHabits).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { refreshHabits(); }, [refreshHabits]));

  // ★ 2026-10-08（用户：工具页中间 tab 与其他模块不一致）→ 统一为 App 通用分段控件
  //   轨道 = 中性灰浅底（mm.colors.btnBusyBg），滑块 = limeSoft，选中字 = limeDeep（同洞察页 Segmented）
  const [tabW, setTabW] = useState(0);
  const tabAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(tabAnim, { toValue: tab === 'tools' ? 0 : 1, duration: 240, useNativeDriver: false }).start();
  }, [tab, tabAnim]);
  const tabItemW = Math.max(0, (tabW - theme.sp(2)) / 2);
  const tabThumbLeft = tabAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.sp(1), theme.sp(1) + tabItemW],
  });

  // 今日旅程卡片（从首页 TodayScreen 迁到工具页最底部）
  const timelineCard = useMemo(() => {
    let result;
    try { result = buildTodayTimeline(); } catch { result = null; }
    if (!result) return null;
    return (
      <View style={{ marginTop: theme.sp(3) }}>
        <TodayTimelineCard title="今日旅程" dateLabel={result.dateLabel} items={result.items} />
      </View>
    );
  }, []);
  type NavProp = CompositeNavigationProp<BottomTabNavigationProp<TabParamList>, StackNavigationProp<RootStackParamList>>;
  const navigation = useNavigation<NavProp>();

  // ★ v18.39 每日三张推荐卡：基于当天真实数据（今日状态档/睡眠评分/压力事件/步数/相位/时段）
  //   从候选池评分排序取 3，理由句带当天数字；同日顺序稳定（日期 hash 打散），跨天自然轮换。
  //   v18.40 完成态持久化：doneTick 触发重算 recommendTools（内部读当日完成记录）。
  const [recDoneTick, setRecDoneTick] = useState(0);
  const dailyTools = useMemo(() => {
    try {
      const ring = RingBle.getState();
      return recommendTools(buildToolCtx(ring));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recDoneTick]);

  // 挂载时加载当日完成记录（跨重启恢复「已完成」态），加载完刷新牌堆一次
  useEffect(() => {
    let alive = true;
    initRecDone().then(() => { if (alive) setRecDoneTick((t) => t + 1); });
    return () => { alive = false; };
  }, []);

  // v18.93 主按钮「开始」：标记完成 + 跳到对应功能页（不再跳 Profile）。
  // 路由优先级：flip.do（呼吸/情绪/拍照）→ 有 flip 科普的卡直接读文章 → 无页卡（认知/专注/快走）只标记完成。
  const handleComplete = useCallback(
    (t: { id: string; title?: string; flip?: { articleId: string; collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition'; do?: { route: 'Breathing' | 'EmotionLog' | 'FoodScan'; autoCamera?: boolean } } }) => {
      if (t.id.startsWith('rec-')) {
        // 每日推荐卡：完成态按天持久化（tool_rec_done.json），当天按钮保持「已完成」
        markRecDone(t.id);
        setRecDoneTick((v) => v + 1);
      } else {
        // 固定任务（兜底牌堆）：走 AppState 原有完成逻辑
        completeTask(t.id);
      }
      const d = t.flip?.do;
      if (d) {
        if (d.route === 'FoodScan') navigation.navigate('FoodScan', { autoCamera: true });
        else navigation.navigate(d.route);
      } else if (t.flip) {
        // 纯科普任务：读文章即完成
        const { articleId, collection } = t.flip;
        navigation.navigate('LearnRead', collection ? { articleId, collection } : { articleId });
      }
      // 无对应页面的卡（认知训练/深度专注/快走）：只标记完成，留在工具页
    },
    [completeTask, navigation]
  );

  // v18.88 牌堆卡翻面「查看详情」→ 科普阅读页（learn/glow/emotion/sport/nutrition 五集合）
  const openArticle = useCallback(
    (articleId: string, collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition') => {
      navigation.navigate('LearnRead', collection ? { articleId, collection } : { articleId });
    },
    [navigation]
  );

  // v18.91 翻面「去完成」→ 对应实操页（呼吸/情绪记录/拍照记餐）
  const doTask = useCallback(
    (t: { flip?: { do?: { route: 'Breathing' | 'EmotionLog' | 'FoodScan'; autoCamera?: boolean } } }) => {
      const d = t.flip?.do;
      if (!d) return;
      if (d.route === 'FoodScan') navigation.navigate('FoodScan', { autoCamera: true });
      else navigation.navigate(d.route);
    },
    [navigation]
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

      {/* v18.39：顶部牌堆 = 每日数据驱动的三张推荐卡（原固定任务废弃）；v18.88 点卡片翻面看科普，查看详情跳阅读页 */}
      {dailyTools.length > 0 ? (
        <TaskDeck tools={dailyTools} onComplete={handleComplete} onOpenArticle={openArticle} onDoTask={doTask} />
      ) : (
        <TaskDeck tools={tools} onComplete={handleComplete} onOpenArticle={openArticle} onDoTask={doTask} />
      )}

      {/* ★ 2026-10-08（用户：工具页中间 tab 与其他模块不一致）→ 统一为 App 通用分段控件 */}
      <View style={styles.segTrack} onLayout={(e) => setTabW(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.segThumb, { width: tabItemW, left: tabThumbLeft }]} />
        <TouchableOpacity
          style={styles.segBtn}
          activeOpacity={theme.press.opacity}
          onPress={() => setTab('tools')}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'tools' }}
        >
          <Text style={[styles.segLabel, tab === 'tools' && styles.segLabelOn]}>改善工具箱</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.segBtn}
          activeOpacity={theme.press.opacity}
          onPress={() => setTab('mine')}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === 'mine' }}
        >
          <Text style={[styles.segLabel, tab === 'mine' && styles.segLabelOn]}>我的建议</Text>
        </TouchableOpacity>
      </View>

      {tab === 'tools' ? (
        <>
        <View style={styles.grid}>
          {TOOL_GRID.map((t) => (
            <TouchableOpacity
              key={t.name}
              activeOpacity={0.7}
              style={styles.gridCell}
              onPress={() => {
                // 营养搭配/稳定睡眠 = 原模块不变；情绪调节 → 情绪干预四方案（缓一缓/换个说法/动一动/记两笔）；其余 → 通用内容页
                if (t.name === '稳定睡眠') navigation.navigate('Breathing');
                if (t.name === '营养搭配') navigation.navigate('FoodScan'); // 进饮食首页（状态卡+相册+识别按钮），不再一进就弹相机
                if (t.name === '情绪调节') navigation.navigate('EmotionIntervene');
                if (t.name === '提升颜值') navigation.navigate('ToolTopic', { topic: 'glow' });
                if (t.name === '运动建议') navigation.navigate('ToolTopic', { topic: 'sport' });
                if (t.name === '知识科普') navigation.navigate('ToolTopic', { topic: 'learn' });
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

        {timelineCard}

        </>
      ) : (
        <View style={styles.mineWrap}>
          {/* 「我的建议」= 用户确认有效的好习惯（读本机 store，按确认次数排序） */}
          {habits.length === 0 ? (
            <Text style={styles.emptyText}>还没有留下的建议。当 Mira 发现某个做法对你有效时，在首页确认一下，它就会出现在这里。</Text>
          ) : (
            habits.map((h) => (
              <SuggestionCard
                key={h.id}
                id={h.id}
                action={h.action}
                metric={h.metric}
                headline={h.headline}
                cta={h.cta}
                saved
                onUndo={(id) => { undoHabit(id).then(refreshHabits).catch(() => Alert.alert('未能移除建议', '建议仍然保留，请稍后重试。')); }}
                onOpen={
                  h.cta
                    ? () => {
                        try {
                          (navigation as any).navigate(h.cta!.screen, h.cta!.params);
                        } catch {
                          /* 导航失败静默 */
                        }
                      }
                    : undefined
                }
                style={styles.mineCard}
              />
            ))
          )}
        </View>
      )}

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
  // ★ 2026-10-08（用户：工具页中间 tab 与其他模块不一致）→ 与洞察页 Segmented 同款
  segTrack: {
    position: 'relative',
    flexDirection: 'row',
    backgroundColor: mm.colors.btnBusyBg,
    borderRadius: theme.radius.pill,
    padding: theme.sp(1),
    marginTop: theme.space.sm,
    marginBottom: theme.space.md,
  },
  segThumb: {
    position: 'absolute',
    top: theme.sp(1),
    bottom: theme.sp(1),
    borderRadius: theme.radius.pill,
    backgroundColor: mm.colors.limeSoft,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: theme.sp(8),
    borderRadius: theme.radius.pill,
  },
  segLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.medium, color: mm.colors.inkSoft },
  segLabelOn: { color: mm.colors.limeDeep, fontWeight: theme.weight.semibold },
  mineWrap: { marginTop: theme.space.xs },
  mineCard: { marginBottom: theme.space.sm },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    lineHeight: theme.fs(21),
    textAlign: 'center',
    paddingVertical: theme.space.md,
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
