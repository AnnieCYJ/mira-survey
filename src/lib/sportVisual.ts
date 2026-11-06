/**
 * 运动视觉与指标解析（参考 Apple Fitness / Garmin Connect / Keep 的运动记录卡范式）
 * ─────────────────────────────────────────────────────────────
 * 1. 每类运动一个「类别色 + 图标」，和固件 VPDeviceRuningMode 枚举值对齐
 *    （与 sportLog.ts 的 SPORT_KINDS 同一套 type 口径）。
 * 2. 心率区间（4 段）+ 区间内文字色 onColor —— ★ 配色已核对比度：
 *    饱和色块上用白字会挂（#22C55E 白字仅 2.3:1），故每个 zone 自带 onColor。
 * 3. 时长/距离/配速/时间的展示格式（成熟运动 App 统一用 MM:SS、3.21 km、6'12"/km）。
 * 数据层只放「值 + 语义色」，不碰布局，RN 组件层仍走 theme token。
 */

import { sportPalette, hrZonePalette } from '../theme/mindmate';

export interface SportVisual {
  /** 类别主色（色块/圆点用，文字一律用深 ink，色块上不放小字） */
  color: string;
  /** 运动图标（emoji，随系统字体渲染，无需额外资产） */
  emoji: string;
  /** 运动大类（给首页卡文案、未来分组用） */
  group: 'cardio' | 'strength' | 'mind' | 'ball' | 'water' | 'other';
}

/** type = 固件 VPDeviceRuningMode 枚举值 → 视觉 */
export const SPORT_VISUALS: Record<number, SportVisual> = {
  1: { color: sportPalette.run, emoji: '🏃', group: 'cardio' },   // 跑步
  2: { color: sportPalette.walk, emoji: '🚶', group: 'cardio' },   // 快走
  63: { color: sportPalette.treadmill, emoji: '🏃', group: 'cardio' },  // 跑步机
  23: { color: sportPalette.stairs, emoji: '🚶', group: 'cardio' },  // 爬楼梯
  7: { color: sportPalette.cycle, emoji: '🚴', group: 'cardio' },   // 骑行
  77: { color: sportPalette.spin, emoji: '🚴', group: 'cardio' },  // 动感单车
  15: { color: sportPalette.rope, emoji: '🤸', group: 'cardio' },  // 跳绳
  32: { color: sportPalette.hiit, emoji: '🔥', group: 'cardio' },  // HIIT
  38: { color: sportPalette.aerobics, emoji: '🤸', group: 'cardio' },  // 有氧操
  83: { color: sportPalette.boxing, emoji: '🥊', group: 'cardio' },  // 搏击操
  97: { color: sportPalette.zumba, emoji: '💃', group: 'cardio' },  // 尊巴
  31: { color: sportPalette.dance, emoji: '💃', group: 'cardio' },  // 舞蹈
  12: { color: sportPalette.swim, emoji: '🏊', group: 'water' },   // 游泳
  9: { color: sportPalette.elliptical, emoji: '🚶', group: 'cardio' },   // 椭圆机
  10: { color: sportPalette.rowing, emoji: '🚣', group: 'cardio' },  // 划船机
  33: { color: sportPalette.climbing, emoji: '🧗', group: 'cardio' },  // 攀岩
  84: { color: sportPalette.strength, emoji: '🏋️', group: 'strength' },// 力量训练
  86: { color: sportPalette.core, emoji: '💪', group: 'strength' },// 核心训练
  13: { color: sportPalette.situp, emoji: '💪', group: 'strength' },// 仰卧起坐
  16: { color: sportPalette.yoga, emoji: '🧘', group: 'mind' },    // 瑜伽
  89: { color: sportPalette.pilates, emoji: '🧘', group: 'mind' },    // 普拉提
  91: { color: sportPalette.stretch, emoji: '🦵', group: 'mind' },    // 拉伸
  109: { color: sportPalette.taiji, emoji: '☯️', group: 'mind' },   // 太极
  17: { color: sportPalette.pingpong, emoji: '🏓', group: 'ball' },    // 乒乓球
  21: { color: sportPalette.badminton, emoji: '🏸', group: 'ball' },    // 羽毛球
  18: { color: sportPalette.basketball, emoji: '🏀', group: 'ball' },    // 篮球
};

const FALLBACK_VISUAL: SportVisual = { color: sportPalette.other, emoji: '🎯', group: 'other' };

/** 取运动视觉：未知类型回落到中性色，不显示空 */
export function sportVisualOf(type?: number): SportVisual {
  if (type == null) return FALLBACK_VISUAL;
  return SPORT_VISUALS[type] ?? FALLBACK_VISUAL;
}

/* ── 心率区间（按女性常模，略低于男标）──────────────────────── */
export interface HeartZone {
  label: string;
  min: number;
  max: number;
  /** 区间色（进度条 / 标签底色） */
  color: string;
  /** 区间色块上的文字色（★ 已核对比度：浅色区间用深墨，饱和区间用白） */
  onColor: string;
}

export const HEART_ZONES: HeartZone[] = [
  { label: '热身', min: 0, max: 99, color: hrZonePalette.warmup.color, onColor: hrZonePalette.warmup.onColor },
  { label: '有氧', min: 100, max: 124, color: hrZonePalette.aerobic.color, onColor: hrZonePalette.aerobic.onColor },
  { label: '无氧', min: 125, max: 149, color: hrZonePalette.anaerobic.color, onColor: hrZonePalette.anaerobic.onColor },
  { label: '极限', min: 150, max: 255, color: hrZonePalette.extreme.color, onColor: hrZonePalette.extreme.onColor },
];

/** 平均心率 → 所在区间；无心率返回 null（不让 UI 编一个区间） */
export function heartZoneOf(bpm?: number): { index: number; zone: HeartZone } | null {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;
  const i = HEART_ZONES.findIndex((z) => bpm >= z.min && bpm <= z.max);
  if (i < 0) return null;
  return { index: i, zone: HEART_ZONES[i] };
}

/* ── 指标格式化 ────────────────────────────────────────────── */

/** 时长的运动 App 写：MM:SS（<1h）/ H:MM:SS（≥1h） */
export function formatClock(sec?: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 时长的中文读法（首页小卡/汇总用）：1 小时 20 分 / 32 分钟 / 45 秒 */
export function formatMinutes(sec?: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
}

/** 距离：固件单位 m → 820 m / 3.21 km */
export function formatDistance(meters?: number): string {
  const m = Math.max(0, Math.round(meters || 0));
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** 配速（秒/km）→ 6'12"/km */
export function formatPace(secPerKm?: number): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '';
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

/** 由距离+时长反推配速（固件 averPace 没透传时自算，等价） */
export function paceOf(distanceM?: number, seconds?: number): number | null {
  if (!distanceM || distanceM < 100 || !seconds || seconds <= 0) return null;
  const km = distanceM / 1000;
  if (km < 0.5) return null; // 太短不谈配速（室内/力量类）
  return seconds / km;
}

/** 固件 beginTime："2023-03-24 14:38:42" → 「今天 14:38」/「10月1日 08:20」 */
export function sportTimeLabel(beginTime?: string): string {
  if (!beginTime) return '';
  const d = new Date(beginTime.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `今天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
