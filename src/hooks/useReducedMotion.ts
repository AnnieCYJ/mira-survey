import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

/** Pause decorative loops in the background and honor the system motion preference. */
export function useReducedMotion() {
  // ★ 默认 false：未拿到系统偏好前，先允许动效（否则异步查询那几十毫秒 + 查询失败时，
  //   所有装饰动效会被永久跳过，用户完全看不到展开/堆叠/淡入）。
  //   只有用户真开了系统「减少动效」，异步结果才会把它翻成 true。
  const [reduced, setReduced] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      setReduced(value);
    });
    const activity = AppState.addEventListener('change', state => setActive(state === 'active'));
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !changed) setReduced(value);
    }).catch(() => { /* Keep a static fallback when the preference is unavailable. */ });
    return () => { mounted = false; motion.remove(); activity.remove(); };
  }, []);
  return reduced || !active;
}
