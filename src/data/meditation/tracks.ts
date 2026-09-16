// 冥想音频素材 — CC0 / Public Domain
// 白/粉/棕噪声由 Python 生成；细雨/海浪来自 archive.org
// 背景图 AI 生成（流体艺术风格）

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
  accent: string;    // 强调色
}

export const MEDITATION_TRACKS: MeditationTrack[] = [
  {
    id: 'whitenoise',
    title: '白噪声',
    subtitle: '稳定注意力 · 屏蔽干扰',
    type: 'whitenoise',
    duration: 0,
    uri: require('../../assets/meditation/whitenoise.wav'),
    bg: require('../../assets/meditation/thumb_whitenoise.jpg'),
    thumb: require('../../assets/meditation/thumb_whitenoise.jpg'),
    loop: true,
    accent: '#A78BFA',
  },
  {
    id: 'pinknoise',
    title: '粉噪声',
    subtitle: '柔和放松 · 适合阅读',
    type: 'pinknoise',
    duration: 0,
    uri: require('../../assets/meditation/pinknoise.wav'),
    bg: require('../../assets/meditation/thumb_pinknoise.jpg'),
    thumb: require('../../assets/meditation/thumb_pinknoise.jpg'),
    loop: true,
    accent: '#F472B6',
  },
  {
    id: 'brownnoise',
    title: '棕噪声',
    subtitle: '深沉助眠 · 掩盖低频噪音',
    type: 'brownnoise',
    duration: 0,
    uri: require('../../assets/meditation/brownnoise.wav'),
    bg: require('../../assets/meditation/thumb_brownnoise.jpg'),
    thumb: require('../../assets/meditation/thumb_brownnoise.jpg'),
    loop: true,
    accent: '#7C6AE0',
  },
  {
    id: 'rain',
    title: '细雨',
    subtitle: '雨天氛围 · 平静心绪',
    type: 'nature',
    duration: 0,
    uri: require('../../assets/meditation/rain.mp3'),
    bg: require('../../assets/meditation/thumb_rain.jpg'),
    thumb: require('../../assets/meditation/thumb_rain.jpg'),
    loop: true,
    accent: '#60A5FA',
  },
  {
    id: 'waves',
    title: '海浪',
    subtitle: '潮汐节奏 · 深度放松',
    type: 'nature',
    duration: 0,
    uri: require('../../assets/meditation/waves.mp3'),
    bg: require('../../assets/meditation/thumb_waves.jpg'),
    thumb: require('../../assets/meditation/thumb_waves.jpg'),
    loop: true,
    accent: '#34D399',
  },
];
