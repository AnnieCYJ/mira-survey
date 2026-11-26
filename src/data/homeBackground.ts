/**
 * 首页背景图选择（2026-11-26，用户要求「设置里加一个选择，换到首页背景上，整体看效果」）。
 *
 * 选型落 prefs（expo-file-system 版 KV，与设置页其它开关同源），
 * 用模块级订阅做即时生效：设置页点选 → emit → 首页 Image source 换图，
 * 不需要重启 App、也不需要重新进入首页。
 *
 * ★ 2026-11-26 v120 定稿：
 *  - 全部图源改用内联 base64 data URI（homeBgData.ts），彻底绕开 Metro asset id 映射错位
 *    （真机曾出现 require 图片渲染成旧图，换文件名/清缓存均无效）。
 *  - 全尺寸图统一按真机 1080×2340 制作，构图 = 天空海面在上、雪/主体在底部小部分
 *    （用户指定「按之前版本」的自然构图）；设置页缩略图与首页共用同一 data URI。
 *  - 首页恢复订阅切换（此前因映射错位曾锁死为单张内联图）。
 */
import type { ImageSourcePropType } from 'react-native';
import { getItem, setItem } from '../utils/prefs';
import {
  HOME_BG_DATA_URI,
  HOME_BG_SNOW_URI,
  HOME_BG_ALPINE_URI,
  HOME_BG_NIGHT_URI,
  HOME_BG_REFLECTION_URI,
} from '../assets/homeBgData';

export type HomeBackgroundId = 'cabin' | 'snow' | 'alpine' | 'night' | 'reflection';

export type HomeBackgroundOption = {
  id: HomeBackgroundId;
  label: string;
  desc: string;
  /** 首页全屏用（data URI 全图 1080×2340） */
  source: ImageSourcePropType;
  /** 设置页缩略图用（本地 400×400 主体方图；小图 require 真机渲染正常） */
  thumb: ImageSourcePropType;
};

/** 显式 id→图 映射（data URI），避免从对象数组里 find 取 source 在 Metro 打包后引用错乱。 */
const SOURCE_MAP: Record<HomeBackgroundId, ImageSourcePropType> = {
  cabin: { uri: HOME_BG_DATA_URI },
  snow: { uri: HOME_BG_SNOW_URI },
  alpine: { uri: HOME_BG_ALPINE_URI },
  night: { uri: HOME_BG_NIGHT_URI },
  reflection: { uri: HOME_BG_REFLECTION_URI },
};

export const HOME_BACKGROUNDS: HomeBackgroundOption[] = [
  {
    id: 'cabin',
    label: '藏蓝小屋',
    desc: '默认 · 雪坡小屋 · 底部小部分雪',
    source: SOURCE_MAP.cabin,
    thumb: require('../assets/home_bg_cabin_new_thumb.jpg'),
  },
  {
    id: 'snow',
    label: '雪景塔屋',
    desc: '深蓝水面 · 塔屋炊烟',
    source: SOURCE_MAP.snow,
    thumb: require('../assets/home_bg_thumb.jpg'),
  },
  {
    id: 'alpine',
    label: '雪山木屋',
    desc: '夜空雪山 · 暖窗小屋',
    source: SOURCE_MAP.alpine,
    thumb: require('../assets/home_bg_alpine_thumb.jpg'),
  },
  {
    id: 'night',
    label: '深蓝夜湖',
    desc: 'Pexels · 夜色雪峰',
    source: SOURCE_MAP.night,
    thumb: require('../assets/home_bg_night_thumb.jpg'),
  },
  {
    id: 'reflection',
    label: '蓝调倒影',
    desc: 'Pexels · 湖面雪山',
    source: SOURCE_MAP.reflection,
    thumb: require('../assets/home_bg_reflection_thumb.jpg'),
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

export function getHomeBackgroundSource(): ImageSourcePropType {
  return SOURCE_MAP[current] ?? SOURCE_MAP.cabin;
}

/**
 * 冷启动从 prefs 恢复上次选择；无记录保持默认（藏蓝小屋）。
 * v120：切换已真正生效，legacy 迁移逻辑保留（旧测试残留一次性归到 cabin）。
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
