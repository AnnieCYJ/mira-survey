/**
 * aiJumps —— Mira AI 回复下方的「跳转按钮」挑选逻辑（v18.94）
 * ─────────────────────────────────────────────────────────────
 * 端侧模型（Qwen 1.5B）不负责输出跳转标记——1.5B 稳定性不够，让它输出
 * 结构化标记容易漏、容易编。这里用关键词命中（同 pickReply 的思路）：
 * 用户问什么域，就在 AI 回复下挂什么工具入口，最多 2 个。
 * 知识内容（怎么说）在 ai/character.ts 世界书里；跳哪里在这里，职责分开。
 */

import type { RootStackParamList } from '../navigation/RootStackNavigator';

export interface AiJump {
  label: string;
  route: keyof RootStackParamList;
  params?: RootStackParamList[keyof RootStackParamList];
}

const JUMP_RULES: { keys: string[]; jump: AiJump }[] = [
  {
    keys: ['运动', '锻炼', '健身', '跑步', '拉伸', '练什么', '怎么练', '撸铁', '力量', 'HIIT', '瑜伽', '走路', '散步'],
    jump: { label: '看今日运动方案', route: 'ToolTopic', params: { topic: 'sport' } },
  },
  {
    keys: ['吃', '饮食', '热量', '馋', '碳水', '蛋白', '餐', '减肥', '卡路里', '暴食', '饿'],
    jump: { label: '记一餐 · 看热量', route: 'FoodScan' },
  },
  {
    keys: ['情绪', '烦', '焦虑', '压力', '低落', '难过', '静一静', '调节', '崩溃', '委屈'],
    jump: { label: '情绪调节小练习', route: 'EmotionIntervene' },
  },
  {
    keys: ['睡不着', '失眠', '睡前', '放松', '呼吸', '冥想'],
    jump: { label: '做一次呼吸冥想', route: 'Breathing' },
  },
];

/** 按用户文本挑跳转按钮：命中即收，去重，最多 max 个 */
export function pickJumps(text: string, max = 2): AiJump[] {
  const t = (text || '').trim();
  if (!t) return [];
  const out: AiJump[] = [];
  for (const rule of JUMP_RULES) {
    if (rule.keys.some((k) => t.includes(k))) {
      if (!out.some((j) => j.route === rule.jump.route)) out.push(rule.jump);
      if (out.length >= max) break;
    }
  }
  return out;
}
