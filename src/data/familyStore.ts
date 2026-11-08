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
 * 现状：Mira 硬件尚未出货；本 store 不接后端 / 不接真实账号体系，
 *   也**不提供任何写死的健康结论**。后续接真实账号时，只需把 seedMembers /
 *   bindMember 换成云端读写，UI 层不变。
 *
 * 隐私铁律（沿用 App 口径）：家人只看"状态结论"，不曝光原始指标。
 *   · statusLabel / statusEmoji = 给结论（精力充沛 ✨ / 恢复略慢 🌙）；
 *   · 仅 MemberDetail 展示有限的恢复指数 / 睡眠 / 心情，**不**给逐点原始曲线。
 *   · 缺省（undefined）= 「暂无数据」，UI 必须走空态，禁止填默认值兜底。
 */
import { useSyncExternalStore } from 'react';
import type { EmotionFaceMood } from '../components/EmotionFaceIcon';
import { theme } from '../theme/theme';

/**
 * 家人状态色（good=绿 / fair=黄 / low=红）
 *
 * ★ 2026-11-06：原先 AccountHubScreen / TaTodayRow / AvatarStack / MemberDetailScreen
 *   **各自定义了一份同名 TONE_COLOR**，色值散落 4 处、其中 AvatarStack 一份的
 *   `TONE_COLOR[m.statusTone]` 在 statusTone 为 undefined 时会静默得到 undefined
 *   （渲染成无色文字/无色描边）。现在统一收口到这里，并提供类型安全的取色函数。
 */
export const FAMILY_TONE_COLOR = {
  good: theme.colors.ui.status.good,
  fair: '#F0C46E',
  low: theme.colors.ui.status.danger,
} as const;

export type FamilyTone = keyof typeof FAMILY_TONE_COLOR;

/**
 * 取家人状态色。
 * @returns 有结论时返回色值；**没有结论（undefined）时返回 undefined** ——
 *          UI 必须据此走空态，禁止兜底成 'good'（那等于凭空说 TA 状态良好）。
 */
export function familyToneColor(tone?: FamilyTone): string | undefined {
  return tone ? FAMILY_TONE_COLOR[tone] : undefined;
}

/** 空态文案：没有真实数据接入时统一显示这句，而不是编一个结论 */
export const FAMILY_NO_DATA_LABEL = '等待数据';

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
  /**
   * 隐私受限的健康结论（只给结论，不给原始数据）
   *
   * ★ 2026-11-06 审查（docs/audit/02 🔴#1/#2）：改为**可选** ——
   *   没有真实数据接入时不得填写写死的结论（此前 self 写死「精力充沛 / 恢复分 82 /
   *   睡眠 7.4h / 心情开心 / 排卵期」，bindMember 写死「恢复分 70 / 睡眠 7h」）。
   *   现在这三项缺省即表示「暂无数据」，UI 走空态文案。
   */
  statusTone?: 'good' | 'fair' | 'low';
  statusLabel?: string;
  statusEmoji?: string;
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
     家人一律由用户自己添加，避免给渠道商演示时看起来像已有真实家庭数据。
   *
   * ★ 2026-11-06 审查（docs/audit/02 🔴#1）：**本人条目也不再写死健康数值**。
     旧实现给 self 写死了 recoveryScore: 82 / sleepHours: 7.4 / mood: 'happy' /
     menstrualPhase: '排卵期' / statusLabel: '精力充沛' —— 这些都不是测量值，
     却会在「账户/家人」页与「TA 的今日」卡上被当成真数据展示。
     现在：只有身份字段（名字/头像/关系），健康结论一律留空，
     等真实数据接入后再由 healthStore 回填。 */
  return [
    { id: 'self', name: 'Kristina', relationship: 'self', avatarColor: AVATAR_COLORS[0], avatarLetter: 'K', bound: true },
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
    // ★ 2026-11-06 审查（docs/audit/02 🔴#2）：绑定即写死 recoveryScore:70 /
    //   sleepHours:7 / mood:'happy' —— 这三个是**假健康数据**，UI 上零标识，
    //   用户与渠道商都会当成 TA 的真实测量。
    //   现在：绑定只建立身份关系，健康结论全部留空 → UI 显示「等待数据」。
    members = [
      ...members,
      {
        id, name, relationship: rel, avatarColor: color, avatarLetter: name.slice(0, 1),
        bound: true, boundAt: Date.now(),
        lastSyncLabel: '刚刚',
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
      // ★ 2026-11-06 审查（docs/audit/02 🔴#1/#2）：这里曾写死
      //   statusTone:'good' / statusLabel:'刚刚建立连接' / statusEmoji:'💞' ——
      //   「刚刚建立连接」是**连接状态**，不是健康结论，却挂在状态位上被当成
      //   "TA 状态良好" 展示。现在：只标记连接状态，健康结论留空 → UI 走空态。
      return {
        ...x, bound: true, boundAt: Date.now(),
        lastSyncLabel: '刚刚',
      };
    });
    if (found) emit();
  },
};

export function useFamilyMembers(): FamilyMember[] {
  return useSyncExternalStore(familyStore.subscribe, familyStore.getMembers);
}
