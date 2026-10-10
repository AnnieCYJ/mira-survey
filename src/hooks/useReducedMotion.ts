import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

/** Pause decorative loops in the background and honor the system motion preference. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
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
