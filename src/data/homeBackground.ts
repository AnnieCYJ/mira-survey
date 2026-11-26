/**
 * 首页背景图选择（2026-11-26，用户要求「设置里加一个选择，换到首页背景上，整体看效果」）。
 *
 * 选型落 prefs（expo-file-system 版 KV，与设置页其它开关同源），
 * 用模块级订阅做即时生效：设置页点选 → emit → 首页 Image source 换图，
 * 不需要重启 App、也不需要重新进入首页。
 */
import type { ImageSourcePropType } from 'react-native';
import { getItem, setItem } from '../utils/prefs';

export type HomeBackgroundId = 'snow' | 'alpine' | 'night' | 'reflection';

export type HomeBackgroundOption = {
  id: HomeBackgroundId;
  label: string;
  desc: string;
  source: ImageSourcePropType;
};

export const HOME_BACKGROUNDS: HomeBackgroundOption[] = [
  {
    id: 'snow',
    label: '雪景小屋',
    desc: '默认 · 深蓝雪坡',
    source: require('../assets/home_bg.jpg'),
  },
  {
    id: 'alpine',
    label: '雪山木屋',
    desc: '夜空雪山 · 暖窗小屋',
    source: require('../assets/home_bg_alpine.jpg'),
  },
  {
    id: 'night',
    label: '深蓝夜湖',
    desc: 'Pexels · 夜色雪峰',
    source: require('../assets/home_bg_night.jpg'),
  },
  {
    id: 'reflection',
    label: '蓝调倒影',
    desc: 'Pexels · 湖面雪山',
    source: require('../assets/home_bg_reflection.jpg'),
  },
];

const STORAGE_KEY = 'homeBackgroundId';
const DEFAULT_ID: HomeBackgroundId = 'snow';
let current: HomeBackgroundId = DEFAULT_ID;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

export function isHomeBackgroundId(v: unknown): v is HomeBackgroundId {
  return typeof v === 'string' && HOME_BACKGROUNDS.some((b) => b.id === v);
}

export function getHomeBackgroundId(): HomeBackgroundId {
  return current;
}

export function getHomeBackgroundSource(): ImageSourcePropType {
  return (HOME_BACKGROUNDS.find((b) => b.id === current) ?? HOME_BACKGROUNDS[0]).source;
}

/** 冷启动从 prefs 恢复上次选择；无记录保持默认雪景。 */
export async function hydrateHomeBackground(): Promise<void> {
  try {
    const v = await getItem(STORAGE_KEY);
    if (isHomeBackgroundId(v)) {
      current = v;
      emit();
    }
  } catch { /* prefs 不可用时静默回落默认 */ }
}

export function setHomeBackground(id: HomeBackgroundId): void {
  if (!isHomeBackgroundId(id)) return;
  current = id;
  void setItem(STORAGE_KEY, id).catch(() => {});
  emit();
}

export function subscribeHomeBackground(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
