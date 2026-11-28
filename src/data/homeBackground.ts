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
 *  - 全尺寸图统一按真机 1080×2340 制作；首页恢复订阅切换。
 *
 * ★ 2026-11-26 v122：色调统一深蓝藏蓝（用户要求「要跟我们 APP 主题蓝色接近，不能搞别的颜色」）。
 * ★ 2026-11-26 v123：v122 的 deepwave/darkwave（海浪纹理）被用户否决（浪花太扎眼），
 *   换成 duskcoast / dusksea / mistmount 三张（共 6 张）；islet 原生粉霞无法压净弃用。
 *  - 淘汰跑色三张：alpine（色相 198° 偏青绿）、night（饱和度不足发灰）、reflection（偏亮蓝）。
 *  - 新增：coast（用户提供的深蓝海岸飞鸟图，裁水印+按 1080×2340 延展）、
 *          deepwave / darkwave（Pexels 15305602 / 15305609，深藏蓝海浪，免版权可商用）。
 *  - 全部候选整体色相 205-216°、深蓝调，与主题 #1F4C7E→#113861→#0A294F 同族。
 *  - 旧 id（snow→保留；alpine/night/reflection→迁移回默认 cabin）。
 */
import type { ImageSourcePropType } from 'react-native';
import { getItem, setItem } from '../utils/prefs';
import {
  HOME_BG_DATA_URI,
  HOME_BG_SNOW_URI,
  HOME_BG_COAST_URI,
  HOME_BG_DUSKCOAST_URI,
  HOME_BG_MISTMOUNT_URI,
  HOME_BG_DUSKSEA_URI,
  HOME_BG_STREET_URI,
  HOME_BG_SNOWCOAST_URI,
  HOME_BG_DUNE_URI,
} from '../assets/homeBgData';
import {
  HOME_BG_THUMB_CABIN_URI,
  HOME_BG_THUMB_SNOW_URI,
  HOME_BG_THUMB_COAST_URI,
  HOME_BG_THUMB_DUSKCOAST_URI,
  HOME_BG_THUMB_MISTMOUNT_URI,
  HOME_BG_THUMB_DUSKSEA_URI,
  HOME_BG_THUMB_STREET_URI,
  HOME_BG_THUMB_SNOWCOAST_URI,
  HOME_BG_THUMB_DUNE_URI,
} from '../assets/homeBgThumbData';

export type HomeBackgroundId =
  | 'cabin' | 'snow' | 'coast' | 'duskcoast' | 'dusksea' | 'mistmount'
  | 'street' | 'snowcoast' | 'dune';

export type HomeBackgroundOption = {
  id: HomeBackgroundId;
  label: string;
  desc: string;
  /** 首页全屏用（data URI 全图 1080×2340） */
  source: ImageSourcePropType;
  /** 设置页缩略图用（400×706 竖版清晰图，内联 data URI 绕开 require 映射错位；v140 起不去模糊） */
  thumb: ImageSourcePropType;
};

/** 显式 id→图 映射（data URI），避免从对象数组里 find 取 source 在 Metro 打包后引用错乱。 */
const SOURCE_MAP: Record<HomeBackgroundId, ImageSourcePropType> = {
  cabin: { uri: HOME_BG_DATA_URI },
  snow: { uri: HOME_BG_SNOW_URI },
  coast: { uri: HOME_BG_COAST_URI },
  duskcoast: { uri: HOME_BG_DUSKCOAST_URI },
  mistmount: { uri: HOME_BG_MISTMOUNT_URI },
  dusksea: { uri: HOME_BG_DUSKSEA_URI },
  street: { uri: HOME_BG_STREET_URI },
  snowcoast: { uri: HOME_BG_SNOWCOAST_URI },
  dune: { uri: HOME_BG_DUNE_URI },
};

// ★ v141：按用户要求隐藏「雪景塔屋」(snow)「冰川秘境」(mistmount)——仅从可选列表移除，
//   数据/缩略图/SURCE_MAP 保留，旧选择自动回落默认，随时可恢复。
export const HOME_BACKGROUNDS: HomeBackgroundOption[] = [
  {
    id: 'cabin',
    label: '藏蓝小屋',
    desc: '默认 · 雪坡小屋 · 底部小部分雪',
    source: SOURCE_MAP.cabin,
    thumb: { uri: HOME_BG_THUMB_CABIN_URI },
  },
  {
    id: 'coast',
    label: '海岸飞鸟',
    desc: '深蓝海岸 · 雪岸飞鸟',
    source: SOURCE_MAP.coast,
    thumb: { uri: HOME_BG_THUMB_COAST_URI },
  },
  {
    id: 'duskcoast',
    label: '孤帆远航',
    desc: '深蓝海面 · 白帆浅滩',
    source: SOURCE_MAP.duskcoast,
    thumb: { uri: HOME_BG_THUMB_DUSKCOAST_URI },
  },
  {
    id: 'dusksea',
    label: '雪夜孤树',
    desc: '深蓝夜空 · 弯月雪原',
    source: SOURCE_MAP.dusksea,
    thumb: { uri: HOME_BG_THUMB_DUSKSEA_URI },
  },
  {
    id: 'street',
    label: '蓝色街角',
    desc: '深蓝街景 · 橙色店铺灯光',
    source: SOURCE_MAP.street,
    thumb: { uri: HOME_BG_THUMB_STREET_URI },
  },
  {
    id: 'snowcoast',
    label: '雪山海岸',
    desc: '深蓝海湾 · 雪坡松林',
    source: SOURCE_MAP.snowcoast,
    thumb: { uri: HOME_BG_THUMB_SNOWCOAST_URI },
  },
  {
    id: 'dune',
    label: '雪丘曲径',
    desc: '深蓝海面 · 雪丘树林',
    source: SOURCE_MAP.dune,
    thumb: { uri: HOME_BG_THUMB_DUNE_URI },
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
 * 冷启动从 prefs 恢复上次选择；无记录/记录失效保持默认（藏蓝小屋）。
 * v122：v1/v2 里残留的已淘汰 id（alpine/night/reflection 等）一律回落 cabin。
 */
const V2_KEY = 'homeBackgroundId_v2';
export async function hydrateHomeBackground(): Promise<void> {
  try {
    const v2 = await getItem(V2_KEY);
    if (isHomeBackgroundId(v2)) {
      current = v2;
    } else {
      // v2 无记录或记录的是已淘汰 id：回落默认并覆写
      current = DEFAULT_ID;
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
