import React, { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import SuggestionCard from './SuggestionCard';
import { pickDailySuggestion, type SuggestionCandidate } from '../lib/suggestionEngine';
import { keepHabit, dismissSuggestion, undoHabit } from '../data/habitSuggestions';

/**
 * HomeSuggestionFloat —— 首页底部悬浮的 H1「好习惯确认」卡（2026-10-07）
 *
 * 位置：tab 栏正上方（与底部语音浮层同一层），从下往上推出；
 * 频控：一天最多一张（见 suggestionEngine.pickDailySuggestion）；
 * 无真实信号改善 → 不渲染任何东西，绝不打扰。
 */
export default function HomeSuggestionFloat() {
  const [cand, setCand] = useState<SuggestionCandidate | null>(null);
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  // 只在本组件生命周期内取一次（useFocusEffect 切 tab 会重跑，避免重复取数）
  const picked = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (picked.current) return () => { alive = false; };
      picked.current = true;
      pickDailySuggestion()
        .then((c) => {
          if (!alive || !c) return;
          setCand(c);
          Animated.timing(anim, {
            toValue: 1,
            duration: theme.motion.slow,
            easing: theme.motion.easeEnter,
            useNativeDriver: true,
          }).start();
        })
        .catch(() => {});
      return () => { alive = false; };
    }, [anim])
  );

  if (!cand) return null;

  const hide = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: theme.motion.base,
      easing: theme.motion.easeExit,
      useNativeDriver: true,
    }).start(() => setCand(null));
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: theme.layout.tabBarHeight + theme.sp(4) + insets.bottom,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [theme.sp(8), 0],
              }),
            },
          ],
        },
      ]}
    >
      <SuggestionCard
        id={cand.id}
        action={cand.action}
        metric={cand.metric}
        onKeep={(e) => { keepHabit(e).catch(() => {}); }}
        onDismiss={(id) => { dismissSuggestion(id).catch(() => {}); hide(); }}
        onUndo={(id) => { undoHabit(id).catch(() => {}); hide(); }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    zIndex: 20,
  },
});
