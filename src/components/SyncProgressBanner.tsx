import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme/theme';
import { RingBle, type SyncProgress } from '../ble/RingBleManager';

/**
 * 底部「数据同步中 x%」小浮层。
 *
 * 背景：离线同步（原生 backfill / recoverOffline）期间戒指会连续回传历史数据，
 * 界面可能有轻微卡顿且**没有任何反馈**，用户不知道 App 在忙什么。
 * 这里在底部悬浮一条轻提示，显示当前阶段与百分比。
 *
 * 设计要点：
 * - `pointerEvents="none"` —— 纯展示，绝不拦截任何触摸操作。
 * - 订阅 RingBle 的**独立进度通道**（onSyncProgress），不走 RingState，
 *   所以进度更新不会触发其它屏幕重渲染、不会加重同步时的卡顿。
 * - 同步结束（active=false）后停留 1.6s 显示「数据已同步」，再淡出。
 */
export default function SyncProgressBanner() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
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
        }, 1600);
      }
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 320,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  const data = progress ?? lastRef.current;
  const done = !data.active;
  const pct = done ? 100 : Math.max(0, Math.min(100, Math.round(data.percent)));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity }]}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.dot, done ? styles.dotDone : styles.dotBusy]} />
          <Text style={styles.label} numberOfLines={1}>
            {done ? '数据已同步' : data.phase || '正在同步数据'}
          </Text>
          <Text style={[styles.pct, done && styles.pctDone]}>{pct}%</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, done && styles.fillDone, { width: `${pct}%` }]} />
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
    bottom: theme.layout.tabBarHeight + theme.sp(10),
    alignItems: 'center',
    paddingHorizontal: theme.sp(24),
  },
  card: {
    minWidth: theme.sp(196),
    maxWidth: '100%',
    paddingHorizontal: theme.sp(14),
    paddingVertical: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.cardBgStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    shadowColor: 'rgba(74,58,132,0.45)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: theme.sp(7),
    height: theme.sp(7),
    borderRadius: theme.sp(4),
    marginRight: theme.sp(8),
  },
  dotBusy: { backgroundColor: theme.colors.accent1 },
  dotDone: { backgroundColor: theme.colors.success },
  label: {
    flex: 1,
    color: theme.colors.textBody,
    fontSize: theme.fs(12),
  },
  pct: {
    marginLeft: theme.sp(10),
    color: theme.colors.accent1,
    fontSize: theme.fs(12),
    fontWeight: theme.weight.semibold,
  },
  pctDone: { color: theme.colors.success },
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
