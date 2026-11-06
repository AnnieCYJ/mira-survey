/**
 * familyStore —— 家人账户 / 绑定关系
 *
 * ★ 2026-10-19（用户需求）：首页"账户"详情 + 绑定家人（爸爸/妈妈/老公/孩子…）。
 *   绑定后首页头像叠加绑定人头像；首页出现"TA的今日"状态卡；点卡片看家人健康结论。
 *
 * ★ 2026-11-06（审查 docs/audit/02 🟡#3）：**已移除全部演示家人**（陈屿 / 妈妈 / 爸爸）。
 *   种子只保留「本人」；其余成员必须由用户实际添加（addMember）后才落库。
 *   文件头不再写「模拟数据层」—— 避免后续开发者误以为可以随手往里加演示数据。
 *   （渠道商演示时，任何看起来像真实家人的条目都必须是用户自己加的。）
 *
 * 现状：Mira 硬件尚未出货，全仓健康数据本就是 7 天模拟；本 store 不接后端 /
 *   不接真实账号体系。后续接真实账号时，只需把 seedMembers / bindMember 换成云端读写，
 *   UI 层不变。
 *
 * 隐私铁律（沿用 App 口径）：家人只看"状态结论"，不曝光原始指标。
 *   · statusLabel / statusEmoji = 给结论（精力充沛 ✨ / 恢复略慢 🌙）；
 *   · 仅 MemberDetail 展示有限的恢复指数 / 睡眠 / 心情，**不**给逐点原始曲线。
 */
import { useSyncExternalStore } from 'react';
import type { EmotionFaceMood } from '../components/EmotionFaceIcon';

export type Relationship =
  | 'self' | 'spouse' | 'father' | 'mother' | 'child' | 'sibling' | 'other';

export const REL_LABEL: Record<Relationship, string> = {
  self: '我', spouse: '老公', father: '爸爸', mother: '妈妈',
  child: '孩子', sibling: '兄弟姐妹', other: '家人',
};

export const REL_EMOJI: Record<Relationship, string> = {
  self: '🙂', spouse: '💍', father: '👨', mother: '👩', child: '🧒', sibling: '🤝', other: '👤',
};

/** 绑定仪式里" incoming orb"的配色（按关系给色，呼应头像） */
export const REL_COLOR: Record<Relationship, string> = {
  self: '#9D8AF0', spouse: '#7EA6F8', father: '#F0C46E', mother: '#9BD37E',
  child: '#F2A3C6', sibling: '#F39A62', other: '#9D8AF0',
};

const AVATAR_COLORS = ['#9D8AF0', '#7EA6F8', '#F0C46E', '#9BD37E', '#F2A3C6', '#F39A62'];

export interface FamilyMember {
  id: string;
  name: string;
  relationship: Relationship;
  avatarColor: string;
  avatarLetter: string;
  bound: boolean;
  boundAt?: number;
  /** 隐私受限的健康结论（只给结论，不给原始数据） */
  statusTone: 'good' | 'fair' | 'low';
  statusLabel: string;
  statusEmoji: string;
  mood?: EmotionFaceMood;
  recoveryScore?: number;   // 0-100 恢复指数
  sleepHours?: number;
  menstrualPhase?: string;
  lastSyncLabel?: string;
}

function seedMembers(): FamilyMember[] {
  /* ★ 2026-11-06（用户：「家人关怀这个添加家人这里面目前我其实还没添加任何家人呢，
     这两个演示的要不先去掉。」）
     → 移除 3 个演示成员（陈屿 / 妈妈 / 爸爸）。现在只有「本人」一条，
     家人一律由用户自己添加，避免给渠道商演示时看起来像已有真实家庭数据。 */
  return [
    { id: 'self', name: 'Kristina', relationship: 'self', avatarColor: AVATAR_COLORS[0], avatarLetter: 'K', bound: true, statusTone: 'good', statusLabel: '精力充沛', statusEmoji: '✨', mood: 'happy', recoveryScore: 82, sleepHours: 7.4, menstrualPhase: '排卵期', lastSyncLabel: '刚刚' },
  ];
}

let members: FamilyMember[] = seedMembers();
const listeners = new Set<() => void>();
function emit() { members = [...members]; listeners.forEach((l) => l()); }

export const familyStore = {
  getMembers: () => members,
  getBoundMembers: () => members.filter((m) => m.bound && m.relationship !== 'self'),
  getMember: (id: string) => members.find((m) => m.id === id),
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** 模拟绑定：写入一位新家人并标记为已绑定（真实场景换成云端确认） */
  bindMember(rel: Relationship, name: string): string {
    const id = 'm' + Date.now();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    members = [
      ...members,
      {
        id, name, relationship: rel, avatarColor: color, avatarLetter: name.slice(0, 1),
        bound: true, boundAt: Date.now(),
        statusTone: 'good', statusLabel: '刚刚建立连接', statusEmoji: '💞',
        mood: 'happy', recoveryScore: 70, sleepHours: 7, lastSyncLabel: '刚刚',
      },
    ];
    emit();
    return id;
  },
  /** 把已存在但"待绑定"的成员标记为已绑定（用于第二枚戒指激活的演示流程） */
  markBound(id: string) {
    let found = false;
    members = members.map((x) => {
      if (x.id !== id) return x;
      found = true;
      return {
        ...x, bound: true, boundAt: Date.now(),
        statusTone: 'good', statusLabel: '刚刚建立连接', statusEmoji: '💞', lastSyncLabel: '刚刚',
      };
    });
    if (found) emit();
  },
};

export function useFamilyMembers(): FamilyMember[] {
  return useSyncExternalStore(familyStore.subscribe, familyStore.getMembers);
}
