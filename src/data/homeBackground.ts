/**
 * 首页背景图选择（2026-11-26，用户要求「设置里加一个选择，换到首页背景上，整体看效果」）。
 *
 * 选型落 prefs（expo-file-system 版 KV，与设置页其它开关同源），
 * 用模块级订阅做即时生效：设置页点选 → emit → 首页 Image source 换图，
 * 不需要重启 App、也不需要重新进入首页。
 */
import type { ImageSourcePropType } from 'react-native';
import { getItem, setItem } from '../utils/prefs';

export type HomeBackgroundId = 'cabin' | 'snow' | 'alpine' | 'night' | 'reflection';

export type HomeBackgroundOption = {
  id: HomeBackgroundId;
  label: string;
  desc: string;
  source: ImageSourcePropType;
};

export const HOME_BACKGROUNDS: HomeBackgroundOption[] = [
  {
    // ★ 2026-11-26 v2：用户反馈「颜色不对、小屋看不见」。按原图色板重新调色（天空 32,72,123 / 海 9,41,80），
    //   并把小屋从原图 73% 高度上移到 20-40%（真机 cover 后落在圆环内可见区，不被卡片遮挡）。
    id: 'cabin',
    label: '藏蓝小屋',
    desc: '深蓝 · 小屋在圆环内',
    source: require('../assets/home_bg_main_20261126.jpg'),
  },
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
const DEFAULT_ID: HomeBackgroundId = 'cabin';
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

/** 显式 id→图 映射，避免从对象数组里 find 取 source 在 Metro 打包后引用错乱。 */
const SOURCE_MAP: Record<HomeBackgroundId, ImageSourcePropType> = {
  cabin: require('../assets/home_bg_main_20261126.jpg'),
  snow: require('../assets/home_bg.jpg'),
  alpine: require('../assets/home_bg_alpine.jpg'),
  night: require('../assets/home_bg_night.jpg'),
  reflection: require('../assets/home_bg_reflection.jpg'),
};

export function getHomeBackgroundSource(): ImageSourcePropType {
  return SOURCE_MAP[current] ?? SOURCE_MAP.cabin;
}

/**
 * 冷启动从 prefs 恢复上次选择；无记录保持默认（藏蓝小屋）。
 * ★ 2026-11-26：用户反馈旧四张「颜色不对、小屋看不见」。用新 key 存选择，
 *   旧 key（STORAGE_KEY）里的 snow/alpine/night/reflection 一律迁移到 cabin。
 *   之后用户主动选哪张就存新 key，冷启动照常恢复——不会被强制回 cabin。
 */
const V2_KEY = 'homeBackgroundId_v2';
const LEGACY_IDS: ReadonlySet<string> = new Set(['snow', 'alpine', 'night', 'reflection']);
export async function hydrateHomeBackground(): Promise<void> {
  try {
    const v2 = await getItem(V2_KEY);
    if (isHomeBackgroundId(v2)) {
      current = v2;
    } else {
      // 新 key 无记录：迁移旧选择（旧 id 或首次都归到 cabin）
      const old = await getItem(STORAGE_KEY);
      current = isHomeBackgroundId(old) && !LEGACY_IDS.has(old) ? old : 'cabin';
      void setItem(V2_KEY, current).catch(() => {});
      void setItem(STORAGE_KEY, current).catch(() => {});
    }
    emit();
  } catch { /* prefs 不可用时静默回落默认 */ }
}

export function setHomeBackground(id: HomeBackgroundId): void {
  if (!isHomeBackgroundId(id)) return;
  current = id;
  void setItem(V2_KEY, id).catch(() => {});
  void setItem(STORAGE_KEY, id).catch(() => {});
  emit();
}

export function subscribeHomeBackground(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
