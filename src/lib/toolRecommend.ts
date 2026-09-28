/**
 * toolRecommend.ts —— 工具页顶部「每日三张推荐卡」引擎（v18.39）
 *
 * 需求（用户 2026-09-28）：每天基于当天数据情况推荐三张卡片。
 *  - 候选池每项带优先级函数（0 = 不可选），全部用真实数据判定：电量档/睡眠评分/
 *    今日压力事件数/步数/周期相位/时段
 *  - 同分用「日期 hash」打散：同一天顺序稳定（刷新不变），跨天自然轮换
 *  - 优先级不足 3 张时从常青池（知识科普/呼吸/好气色）补齐，永远正好 3 张
 *  - 理由句（desc）嵌入当天真实数字，不用模板空话
 */
import * as FileSystem from 'expo-file-system';
import { dayKey, healthStore } from '../data/healthStore';
import type { TaskItem } from '../data/tasks';
import { curveLevel, CURVE_DEFAULTS } from './dailyStatus';
import { computeStressReport } from './stressAlgorithm';

export interface ToolCtx {
  now: number;
  /** 电量档 0-3（充沛/平稳/偏低/不足）；null = 无数据 */
  levelIdx: number | null;
  /** 当前电量 0-100 */
  statusValue: number | null;
  /** 最近一晚睡眠评分 0-100 */
  sleepScore: number | null;
  /** 今日压力事件数 */
  stressEventsToday: number;
  /** 今日步数 */
  steps: number;
  /** 经期/卵泡期/排卵期/黄体期/未记录 */
  phase: string;
  dayInCycle: number | null;
}

interface Candidate {
  id: string;
  type: TaskItem['type'];
  badge: string;
  title: string;
  action: string;
  /** 优先级 0-100，0 = 今天不推荐 */
  prio: (c: ToolCtx) => number;
  desc: (c: ToolCtx) => string;
  /** 常青池：优先级不足 3 张时兜底补齐 */
  evergreen?: boolean;
}

const inRange = (h: number, a: number, b: number) => h >= a && h < b;

const POOL: Candidate[] = [
  {
    id: 'rec-breath-calm',
    type: 0,
    badge: '今日推荐 · 稳定睡眠',
    title: '4-7-8 呼吸放松',
    action: '开始 · 10 min',
    prio: (c) => {
      const h = new Date(c.now).getHours();
      let p = 0;
      if (c.levelIdx != null && c.levelIdx >= 2) p += 78;
      if (h >= 20) p += 18;
      return Math.min(96, p);
    },
    desc: (c) => `当前电量 ${c.statusValue != null ? Math.round(c.statusValue) : '—'}，10 分钟 4-7-8 呼吸把交感降下来，晚上更好入睡。`,
  },
  {
    id: 'rec-emotion-care',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '情绪急救三步',
    action: '开始 · 5 min',
    prio: (c) => (c.stressEventsToday >= 2 ? 85 : 0),
    desc: (c) => `今天已有 ${c.stressEventsToday} 次压力事件，交感还在高位——5 分钟给情绪降降温，再回来处理事情。`,
  },
  {
    id: 'rec-move',
    type: 5,
    badge: '今日推荐 · 运动建议',
    title: '快走 15 分钟',
    action: '开始 · 15 min',
    prio: (c) => {
      const h = new Date(c.now).getHours();
      if (c.steps < 3000 && inRange(h, 9, 21)) return 70;
      if (c.steps < 7000 && h >= 15) return 45;
      return 0;
    },
    desc: (c) => `今天 ${c.steps} 步，身体还在低功耗档——下午快走 15 分钟，HRV 和情绪都会回来一点。`,
  },
  {
    id: 'rec-food',
    type: 4,
    badge: '今日推荐 · 营养搭配',
    title: '拍照记一餐',
    action: '拍一餐',
    prio: (c) => {
      const h = new Date(c.now).getHours();
      if (c.phase === '经期') return 65;
      if (inRange(h, 10.5, 13) || inRange(h, 16.5, 19)) return 55;
      return 0;
    },
    desc: (c) => c.phase === '经期'
      ? '经期铁流失加快，红肉、深绿叶菜安排上——拍照看看这餐的搭配。'
      : '饭点前后是记录黄金窗口，拍一餐看搭配比例，不用算卡路里。',
  },
  {
    id: 'rec-cog',
    type: 1,
    badge: '今日推荐 · 认知提升',
    title: '工作记忆训练',
    action: '开始 · 15 min',
    prio: (c) => (c.sleepScore != null && c.sleepScore >= 80 && (c.levelIdx == null || c.levelIdx <= 1) ? 75 : 0),
    desc: (c) => `昨晚睡眠 ${c.sleepScore != null ? Math.round(c.sleepScore) : '—'} 分，认知窗口在线——15 分钟训练放在现在效果最好。`,
  },
  {
    id: 'rec-focus',
    type: 2,
    badge: '今日推荐 · 专注',
    title: '25 分钟深度专注',
    action: '开始 · 25 min',
    prio: (c) => (c.levelIdx === 0 ? 70 : 0),
    desc: (c) => `电量 ${c.statusValue != null ? Math.round(c.statusValue) : '—'} 在高位，正是心流窗口——把最难的事放进这 25 分钟。`,
  },
  {
    id: 'rec-glow',
    type: 3,
    badge: '今日推荐 · 提升颜值',
    title: '好气色养成',
    action: '开始 · 3 min',
    prio: (c) => (c.sleepScore != null && c.sleepScore >= 80 ? 55 : 0),
    desc: (c) => `睡眠 ${c.sleepScore != null ? Math.round(c.sleepScore) : '—'} 分 + ${c.phase}，皮肤修复黄金期——今天少一杯奶茶，多一份气色。`,
  },
  // ── 常青池：兜底补齐，保证每天恰好 3 张 ──
  {
    id: 'rec-learn',
    type: 3,
    badge: '知识科普',
    title: '《压力下的大脑》',
    action: '开始 · 5 min',
    evergreen: true,
    prio: (c) => (c.phase === '黄体期' ? 35 : 20),
    desc: (c) => c.phase === '黄体期'
      ? '黄体期应激更敏感，5 分钟读懂压力反应，帮你把波动翻译成原因。'
      : '5 分钟读懂压力反应的来龙去脉，把波动翻译成原因。',
  },
  {
    id: 'rec-glow-ever',
    type: 3,
    badge: '今日推荐 · 提升颜值',
    title: '周期好气色课',
    action: '开始 · 3 min',
    evergreen: true,
    prio: () => 30,
    desc: () => '雌激素走高时皮肤血流量增加、气色更亮——跟着周期节奏护肤，事半功倍。',
  },
  {
    id: 'rec-breath-ever',
    type: 0,
    badge: '今日推荐 · 稳定睡眠',
    title: '5 分钟盒式呼吸',
    action: '开始 · 5 min',
    evergreen: true,
    prio: () => 15,
    desc: () => '吸气 4 秒、停 4 秒、呼 4 秒、停 4 秒，快速把心率压回平静区。',
  },
];

/** 稳定打散：同一天同顺序，跨天轮换 */
function dayHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 17); // 0-16
}

// ─────────────────────────────────────────────────────────────────────────────
// 每日完成记录（进程内缓存 + 文件持久化 tool_rec_done.json）
// 推荐卡 id 不在 AppState 的 DEFAULT_TOOLS 里，completeTask 对它们是空操作；
// 完成态单独按天记录：当天完成 → 按钮变「已完成 · 已记录」，跨天自动清零重来。
// ─────────────────────────────────────────────────────────────────────────────

interface RecDone { dk: string; ids: string[]; }

let recDone: RecDone | null = null;
let recSaveTimer: ReturnType<typeof setTimeout> | null = null;

function recDoneFileUri(): string {
  return `${(FileSystem.documentDirectory ?? '').replace(/\/$/, '')}/tool_rec_done.json`;
}

/** App 启动/工具页挂载时调用一次：加载当日完成记录（跨重启有效） */
export async function initRecDone(): Promise<void> {
  const dk = dayKey(Date.now());
  try {
    const raw = await FileSystem.readAsStringAsync(recDoneFileUri());
    const parsed = JSON.parse(raw) as RecDone;
    recDone = parsed && parsed.dk === dk && Array.isArray(parsed.ids) ? parsed : { dk, ids: [] };
  } catch {
    recDone = { dk, ids: [] };
  }
}

function flushRecDone(): void {
  if (recDone == null) return;
  FileSystem.writeAsStringAsync(recDoneFileUri(), JSON.stringify(recDone)).catch(() => {});
}

/** 标记某张推荐卡今日已完成（跨重启有效） */
export function markRecDone(id: string): void {
  const dk = dayKey(Date.now());
  if (recDone == null || recDone.dk !== dk) recDone = { dk, ids: [] };  // 跨天清零
  if (!recDone.ids.includes(id)) recDone.ids.push(id);
  if (recSaveTimer) clearTimeout(recSaveTimer);
  recSaveTimer = setTimeout(flushRecDone, 300);  // 防抖落盘
}

/** 由真实数据构建推荐上下文；任何一环出错都退回安全默认值（不抛错） */
export function buildToolCtx(ring: any): ToolCtx {
  const now = Date.now();
  let statusValue: number | null = null;
  let phase = '未记录';
  let dayInCycle: number | null = null;
  try {
    statusValue = ring?.curveStatus?.value ?? null;
    phase = ring?.curveStatus?.phaseLabel ?? '未记录';
    dayInCycle = ring?.curveStatus?.dayInCycle ?? null;
  } catch {}
  const levelIdx = statusValue != null ? curveLevel(statusValue, CURVE_DEFAULTS).index : null;
  let sleepScore: number | null = null;
  try {
    const s = healthStore.getSleep(dayKey(now)) ?? healthStore.getSleep(dayKey(now - 86400000));
    if (s && Number.isFinite(s.score)) sleepScore = s.score;
  } catch {}
  let stressEventsToday = 0;
  try {
    stressEventsToday = computeStressReport()?.events?.length ?? 0;
  } catch {}
  let steps = 0;
  try {
    steps = ring?.stepDaily?.[dayKey(now)]?.steps ?? 0;
  } catch {}
  return { now, levelIdx, statusValue, sleepScore, stressEventsToday, steps, phase, dayInCycle };
}

/** 主入口：返回恰好 3 张推荐卡（完成态读当日记录，跨重启恢复） */
export function recommendTools(c: ToolCtx): TaskItem[] {
  const dk = dayKey(c.now);
  const doneIds = new Set(recDone && recDone.dk === dk ? recDone.ids : []);
  const scored = POOL.map((cand) => {
    const base = cand.evergreen ? cand.prio(c) : cand.prio(c);
    return { cand, score: base > 0 || cand.evergreen ? base + dayHash(dk + cand.id) : -1 };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, 3);
  // 兜底：常青池补齐（已入选的除外）
  if (picked.length < 3) {
    const used = new Set(picked.map((x) => x.cand.id));
    for (const cand of POOL.filter((p) => p.evergreen && !used.has(p.id))) {
      if (picked.length >= 3) break;
      picked.push({ cand, score: 0 });
    }
  }
  return picked.map(({ cand }) => ({
    id: cand.id,
    type: cand.type,
    badge: cand.badge,
    title: cand.title,
    desc: cand.desc(c),
    action: cand.action,
    done: doneIds.has(cand.id),
  }));
}
