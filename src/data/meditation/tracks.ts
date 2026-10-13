// 冥想音频素材 — CC0 / Public Domain
// 白/粉/棕噪声由 Python 生成；细雨/海浪为 sfxmint.com CC0 正版循环音（2026-10-13 替换 archive.org 坏文件）
// 背景图 v2 = Unsplash 真实自然风景（2026-10-13 替换 AI 流体图）

export type MeditationType = 'whitenoise' | 'pinknoise' | 'brownnoise' | 'nature' | 'guided' | 'music';

export interface MeditationTrack {
  id: string;
  title: string;
  subtitle: string;
  type: MeditationType;
  duration: number;  // 秒，0 = 循环无限制
  uri: number;       // require() 音频
  bg: number;        // require() 全屏背景图
  thumb: number;     // require() 卡片缩略图
  loop: boolean;
}

export const MEDITATION_TRACKS: MeditationTrack[] = [
  {
    id: 'whitenoise',
    title: '白噪声',
    subtitle: '稳定注意力 · 屏蔽干扰',
    type: 'whitenoise',
    duration: 0,
    uri: require('../../assets/meditation/whitenoise.wav'),
    bg: require('../../assets/meditation/bg_whitenoise_v2.jpg'),
    thumb: require('../../assets/meditation/thumb_whitenoise_v2.jpg'),
    loop: true,
  },
  {
    id: 'pinknoise',
    title: '粉噪声',
    subtitle: '柔和放松 · 适合阅读',
    type: 'pinknoise',
    duration: 0,
    uri: require('../../assets/meditation/pinknoise.wav'),
    bg: require('../../assets/meditation/bg_pinknoise_v2.jpg'),
    thumb: require('../../assets/meditation/thumb_pinknoise_v2.jpg'),
    loop: true,
  },
  {
    id: 'brownnoise',
    title: '棕噪声',
    subtitle: '深沉助眠 · 掩盖低频噪音',
    type: 'brownnoise',
    duration: 0,
    uri: require('../../assets/meditation/brownnoise.wav'),
    bg: require('../../assets/meditation/bg_brownnoise_v2.jpg'),
    thumb: require('../../assets/meditation/thumb_brownnoise_v2.jpg'),
    loop: true,
  },
  {
    id: 'rain',
    title: '细雨',
    subtitle: '雨天氛围 · 平静心绪',
    type: 'nature',
    duration: 0,
    uri: require('../../assets/meditation/rain_v2.mp3'),
    bg: require('../../assets/meditation/bg_rain_v2.jpg'),
    thumb: require('../../assets/meditation/thumb_rain_v2.jpg'),
    loop: true,
  },
  {
    id: 'waves',
    title: '海浪',
    subtitle: '潮汐节奏 · 深度放松',
    type: 'nature',
    duration: 0,
    uri: require('../../assets/meditation/waves_v2.mp3'),
    bg: require('../../assets/meditation/bg_waves_v2.jpg'),
    thumb: require('../../assets/meditation/thumb_waves_v2.jpg'),
    loop: true,
  },
];
