import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { theme } from '../theme/theme';
import { RingBle, type SyncProgress } from '../ble/RingBleManager';

/**
 * 底部「离线数据同步中 x%」小浮层。
 *
 * 背景：离线同步（原生 backfill / recoverOffline）期间戒指会连续回传历史数据，
 * 界面可能有轻微卡顿且**没有任何反馈**，用户不知道 App 在忙什么。
 * 这里在底部悬浮一条轻提示，显示当前阶段与百分比。
 *
 * 设计要点：
 * - `pointerEvents="none"` —— 纯展示，绝不拦截任何触摸操作。
 * - 订阅 RingBle 的**独立进度通道**（onSyncProgress），不走 RingState，
 *   所以进度更新不会触发其它屏幕重渲染、不会加重同步时的卡顿。
 * - 同步结束（active=false）后停留 2.5s 显示「离线数据已同步」，再淡出。
 * - 视觉上是一枚明确的「状态胶囊」：旋转指示器 + 标题 + 百分比 + 进度条，
 *   与全局 white-card 设计语言一致，避免被误认成遮挡界面的白条。
 */
export default function SyncProgressBanner() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(10)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 淡出期间仍需要内容渲染，所以留一份「最后已知进度」
  const lastRef = useRef<SyncProgress>({ active: false, percent: 0, phase: '' });

  useEffect(() => {
    const off = RingBle.onSyncProgress((p) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!p) {
        setVisible(false);
        return;
      }
      lastRef.current = p;
      setProgress(p);
      setVisible(true);
      if (!p.active) {
        // 完成态：停留一会儿让用户看到 100%，再收起
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          setVisible(false);
        }, 2500);
      }
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: visible ? 220 : 320,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: visible ? 0 : 10,
        duration: visible ? 220 : 320,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, slide]);

  const data = progress ?? lastRef.current;
  const busy = !!data.active;
  const pct = busy ? Math.max(0, Math.min(100, Math.round(data.percent))) : 100;
  const showPhase = busy && !!data.phase;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity, transform: [{ translateY: slide }] }]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          {busy ? (
            <ActivityIndicator
              size="small"
              color={theme.colors.accent1}
              style={styles.spinner}
            />
          ) : (
            <View style={[styles.dot, styles.dotDone]} />
          )}
          <Text style={styles.label} numberOfLines={1}>
            {busy ? '离线数据同步中' : '离线数据已同步'}
          </Text>
          <Text style={[styles.pct, !busy && styles.pctDone]}>{pct}%</Text>
        </View>
        {showPhase && (
          <Text style={styles.phase} numberOfLines={1}>
            {data.phase}
          </Text>
        )}
        <View style={styles.track}>
          <View
            style={[styles.fill, !busy && styles.fillDone, { width: `${pct}%` }]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // 悬浮在底部 TabBar 之上，避免压住导航
    bottom: theme.layout.tabBarHeight + theme.sp(12),
    alignItems: 'center',
    paddingHorizontal: theme.sp(24),
    zIndex: 50,
  },
  card: {
    minWidth: theme.sp(220),
    maxWidth: '100%',
    paddingHorizontal: theme.sp(16),
    paddingVertical: theme.sp(10),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBgStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    shadowColor: 'rgba(74,58,132,0.45)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: theme.sp(8),
  },
  dot: {
    width: theme.sp(7),
    height: theme.sp(7),
    borderRadius: theme.sp(4),
    marginRight: theme.sp(8),
  },
  dotDone: { backgroundColor: theme.colors.success },
  label: {
    flex: 1,
    color: theme.colors.textBody,
    fontSize: theme.fs(13),
    fontWeight: theme.weight.semibold,
  },
  pct: {
    marginLeft: theme.sp(10),
    color: theme.colors.accent1,
    fontSize: theme.fs(13),
    fontWeight: theme.weight.semibold,
  },
  pctDone: { color: theme.colors.success },
  phase: {
    marginTop: theme.sp(2),
    marginLeft: theme.sp(15),
    color: theme.colors.textSub,
    fontSize: theme.fs(11),
  },
  track: {
    height: theme.sp(3),
    borderRadius: theme.sp(2),
    backgroundColor: theme.colors.accentSoft,
    marginTop: theme.sp(8),
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: theme.sp(2),
    backgroundColor: theme.colors.accent1,
  },
  fillDone: { backgroundColor: theme.colors.success },
});
