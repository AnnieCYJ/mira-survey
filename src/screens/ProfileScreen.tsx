import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Card from '../components/Card';
import CalendarGrid from '../components/CalendarGrid';
import Confetti from '../components/Confetti';
import Icon from '../components/Icon';
import RelaxCardDeck from '../components/RelaxCardDeck';
import RelaxVideoPlayer from '../components/RelaxVideoPlayer';
import { useAppState, PLAN_PER_DAY } from '../state/AppState';
import { CAL_YEAR, CAL_MONTH } from '../data/tasks';
import MonthDiscoveryView from '../components/MonthDiscoveryView';
import JourneyDayView from '../components/JourneyDayView';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CONFETTI_MS = 3000; // 礼花时长
const HOLD_MS = 700; // 礼花结束后卡片停留
const FLY_MS = 1100; // 卡片飞向日期的时长（拉长让路径更清晰）
const FADE_MS = 420; // 落点后整体淡出时长

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// ★ 2026-10-12（用户）：月视图改版（方案 A：卡片堆叠月历 + 本月的变化）。
//   true = 走新版 MonthDiscoveryView；false = 走旧版（CalendarGrid + RelaxCardDeck，代码保留不删）。
const USE_MONTH_DISCOVERY = true;

export default function ProfileScreen({ navigation }: any) {
  // ★ mira-ocean：深底 → 状态栏亮图标（失焦恢复，避免影响其它白底 tab）
  useFocusEffect(useCallback(() => {
    StatusBar.setBarStyle('light-content', true);
    return () => StatusBar.setBarStyle('light-content', true);
  }, []));
  // ★ 滚动联动：头部随滚动溶解（与首页同一套强度，数值含义见 TodayScreen）
  const scrollY = useRef(new Animated.Value(0)).current;
  const headOpacity = scrollY.interpolate({ inputRange: [0, 110], outputRange: [1, 0], extrapolate: 'clamp' });
  const headLift = scrollY.interpolate({ inputRange: [0, 110], outputRange: [0, -14], extrapolate: 'clamp' });

  const { tasks, celebration, triggerCelebration, dismissCelebration } = useAppState();
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current; // 0=居中, 1=飞到目标日期
  const dayRefs = useRef<Record<number, any>>({});
  const [flight, setFlight] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const cardSizeRef = useRef({ w: 300, h: 180 });

  // ★ 2026-11-05（用户）：日历区块改名为「回顾」，上方加「今日 / 本月」两个 tab；
  //   今日 = 当日行为流程（JourneyDayView，即点月历某一天弹出的那种图）；本月 = 月历网格。
  const [reviewTab, setReviewTab] = useState<'today' | 'month'>('month');

  // 庆祝自动流程：礼花 → 卡片停留 → 飞向对应日期格子 → 关闭
  useEffect(() => {
    if (!celebration.visible) {
      overlayOpacity.setValue(0);
      cardAnim.setValue(0);
      setFlight(null);
      return;
    }
    overlayOpacity.setValue(1);
    cardAnim.setValue(0);
    setFlight(null);

    const timer = setTimeout(() => {
      const targetDay = celebration.kind === 'task' ? celebration.targetDay : undefined;
      const node = targetDay != null ? dayRefs.current[targetDay] : undefined;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x: number, y: number, w: number, h: number) => {
          // web 端 measureInWindow 有时返回 0，回退淡出
          if (w === 0 && h === 0) {
            Animated.timing(overlayOpacity, { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true })
              .start(() => dismissCelebration());
            return;
          }
          const targetX = x + w / 2;
          const targetY = y + h / 2;
          const dx = targetX - SCREEN_W / 2;
          const dy = targetY - SCREEN_H / 2;
          const scale = Math.min(w / cardSizeRef.current.w, h / cardSizeRef.current.h) * 0.9;
          setFlight({ dx, dy, scale });
          // 阶段1：飞行，蒙层全程保持清晰
          // 阶段2：落点后整体淡出
          Animated.sequence([
            Animated.parallel([
              Animated.timing(cardAnim, {
                toValue: 1,
                duration: FLY_MS,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(overlayOpacity, {
                toValue: 0.96,
                duration: FLY_MS,
                easing: Easing.linear,
                useNativeDriver: true,
              }),
            ]),
            Animated.timing(overlayOpacity, {
              toValue: 0,
              duration: FADE_MS,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(() => dismissCelebration());
        });
        return;
      }
      // 无目标日期（月度庆祝）：直接淡出
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => dismissCelebration());
    }, CONFETTI_MS + HOLD_MS);

    return () => clearTimeout(timer);
  }, [celebration.visible, celebration.kind, celebration.targetDay, overlayOpacity, cardAnim, dismissCelebration]);

  const closeOverlay = () => {
    Animated.parallel([
      Animated.timing(overlayOpacity, { toValue: 0, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => dismissCelebration());
  };

  const { totalDone, totalPlanned, allDone } = useMemo(() => {
    let done = 0;
    let planned = 0;
    const days = new Date(CAL_YEAR, CAL_MONTH + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const count = (tasks[d] || []).length;
      if (count > 0) {
        done += Math.min(count, PLAN_PER_DAY);
        planned += PLAN_PER_DAY;
      }
    }
    return { totalDone: done, totalPlanned: planned, allDone: done >= planned && planned > 0 };
  }, [tasks]);

  useEffect(() => {
    if (allDone && totalPlanned > 0 && !celebration.visible) {
      triggerCelebration({ title: '本月所有任务已完成！', subtitle: '太棒了', footer: '继续加油', kind: 'monthly' });
    }
  }, [allDone, totalPlanned, celebration.visible, triggerCelebration]);

  const [relaxVisible, setRelaxVisible] = useState(false);

  // ★ 2026-10-12（用户）：「日 / 月」tab 已移除，Calendar 页固定「月」视图；
  //   「日」旅程视图改由点月历日期 → 下抽屉（DayDrawer）弹出。

  return (
    <View style={styles.root}>
      {/* ★ mira-ocean（2026-10-17）：日历页背景由白底改深海渐变（Calm 式钢蓝→蓝紫，同 App 根渐变） */}
      <LinearGradient
        colors={[...theme.colors.bgGradStops] as unknown as string[]}
        locations={[...theme.colors.bgGradLocs] as unknown as number[]}
        style={StyleSheet.absoluteFill}
      />
      <ScreenContainer compactTop scrollY={scrollY} topFadeColor={theme.colors.bgTop}>
        <Animated.View style={{ opacity: headOpacity, transform: [{ translateY: headLift }] }}>
          <Text style={styles.title}>回顾</Text>
        </Animated.View>

        {/* ★ 2026-11-05（用户）：今日 / 本月 两个 tab 置于时间选择器上方 */}
        <View style={styles.reviewTabs}>
          <TouchableOpacity
            style={[styles.reviewTab, reviewTab === 'today' && styles.reviewTabOn]}
            activeOpacity={0.7}
            onPress={() => setReviewTab('today')}
          >
            <Text style={[styles.reviewTabTxt, reviewTab === 'today' && styles.reviewTabTxtOn]}>今日</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewTab, reviewTab === 'month' && styles.reviewTabOn]}
            activeOpacity={0.7}
            onPress={() => setReviewTab('month')}
          >
            <Text style={[styles.reviewTabTxt, reviewTab === 'month' && styles.reviewTabTxtOn]}>本月</Text>
          </TouchableOpacity>
        </View>

        {reviewTab === 'today' ? (
          /* ★ 2026-11-05（用户）：今日 = 当日行为流程（睡眠 / 运动 / 情绪 / 压力 时间轴） */
          <View style={styles.reviewToday}>
            <JourneyDayView />
          </View>
        ) : USE_MONTH_DISCOVERY ? (
          /* ★ 2026-10-12（用户）：月视图改版方案 A —— 卡片堆叠月历 + 规律总结 */
          <MonthDiscoveryView
            tasks={tasks}
            onAskMira={(q) => navigation.navigate('VoiceChat', { question: q })}
          />
        ) : (
        <>
        {/* 旧版（CalendarGrid + RelaxCardDeck；仅 USE_MONTH_DISCOVERY = false 时启用，代码保留不删） */}

        {/* ★ 2026-10-08（用户）：原「已完成 / 计划任务 / 完成度%」统计卡整块移除 */}

        <Card>
          <View style={styles.calHead}>
            <Text style={styles.calTitle}>
              {MONTHS[CAL_MONTH]} {CAL_YEAR}
            </Text>
            <TouchableOpacity onPress={() => {}}>
              <Icon name="chevronRight" size={theme.fs(20)} color={theme.colors.textSub} />
            </TouchableOpacity>
          </View>
          <CalendarGrid
            year={CAL_YEAR}
            month={CAL_MONTH}
            tasks={tasks}
            dayRefs={dayRefs}
            onDayPress={(day) => console.log('Day', day)}
          />
        </Card>

        <RelaxCardDeck onPlayRelax={() => setRelaxVisible(true)} />
        </>
        )}
      </ScreenContainer>

      <Confetti visible={celebration.visible} duration={3000} count={120} />

      <RelaxVideoPlayer visible={relaxVisible} onClose={() => setRelaxVisible(false)} />

      {celebration.visible ? (
        <Animated.View style={[styles.celebrateOverlay, { opacity: overlayOpacity }]} pointerEvents="auto">
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeOverlay} activeOpacity={1} />
          <Animated.View
            style={[
              styles.celebrateCard,
              {
                transform: [
                  { translateX: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0, flight?.dx ?? 0] }) },
                  { translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0, flight?.dy ?? 0] }) },
                  { scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [1, flight?.scale ?? 1] }) },
                ],
              },
            ]}
            pointerEvents="none"
            onLayout={(e) => {
              cardSizeRef.current = {
                w: e.nativeEvent.layout.width,
                h: e.nativeEvent.layout.height,
              };
            }}
          >
            <View style={[styles.celebrateIconWrap, celebration.kind === 'monthly' && styles.celebrateIconWrapMonthly]}>
              <Icon
                name={celebration.kind === 'monthly' ? 'sparkle' : 'check'}
                size={theme.fs(28)}
                color={theme.colors.textWhite}
                strokeWidth={3}
              />
            </View>
            <Text style={styles.celebrateTitle}>{celebration.title || '太棒了！'}</Text>
            {celebration.subtitle ? (
              <Text style={styles.celebrateSubtitle}>{celebration.subtitle}</Text>
            ) : null}
            {celebration.footer ? (
              <Text style={styles.celebrateFooter}>{celebration.footer}</Text>
            ) : null}
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: {
    fontSize: theme.fontSize.h1,
    fontWeight: theme.weight.medium,
    color: mm.colors.ink,
    marginBottom: theme.space.md,
  },
  /* ★ 2026-11-06（用户）：回顾页 今日 / 本月 tab 加大字号、加宽（更醒目、更好点） */
  reviewTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(31,29,26,0.06)',
    borderRadius: theme.radius.pill,
    padding: theme.sp(2),
    marginBottom: theme.space.md,
    alignSelf: 'flex-start',
  },
  reviewTab: {
    paddingVertical: theme.sp(2.5),
    paddingHorizontal: theme.sp(11),
    borderRadius: theme.radius.pill,
  },
  reviewTabOn: {
    backgroundColor: mm.colors.cardBg,
    shadowColor: mm.shadow.color,
    shadowOpacity: mm.shadow.opacity,
    shadowRadius: mm.shadow.radius,
    shadowOffset: { width: 0, height: mm.shadow.height },
    elevation: 2,
  },
  reviewTabTxt: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.medium,
    color: mm.colors.inkFaint,
  },
  reviewTabTxtOn: {
    color: mm.colors.ink,
    fontWeight: theme.weight.semibold as never,
  },
  reviewToday: { marginTop: theme.sp(1) },
  calHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.space.sm,
  },
  calTitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  celebrateOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  celebrateCard: {
    backgroundColor: theme.colors.cardBgStrong,
    borderRadius: theme.radius.card,
    padding: theme.space.xl,
    alignItems: 'center',
    maxWidth: 300,
    ...theme.shadow.card,
  },
  celebrateIconWrap: {
    width: theme.sp(18),
    height: theme.sp(18),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space.md,
    shadowColor: theme.colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  celebrateIconWrapMonthly: {
    backgroundColor: theme.colors.accentSolid,
    shadowColor: theme.colors.accentSolid,
  },
  celebrateTitle: {
    fontSize: theme.fontSize.h2,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    textAlign: 'center',
    marginBottom: theme.space.sm,
  },
  celebrateSubtitle: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textBody,
    textAlign: 'center',
    marginBottom: theme.space.sm,
  },
  celebrateFooter: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginTop: theme.space.xs,
  },
});
