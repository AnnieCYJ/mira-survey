/**
 * habitSuggestions —— 「我的建议 / 我的好习惯」本地持久化
 *
 * 用户把 Mira 给出的改善建议（如「睡前 4-7-8 呼吸」）确认为「有效」后，
 * 记一条习惯：{ 动作, 证据指标, 确认次数, 首次确认时间 }，仅存本机沙盒（不外传）。
 *
 * 存储写法照抄 cycleLog.ts（expo-file-system + JSON），不引新依赖、不影响 ⌘R。
 *
 * 三个出口（见产品设计）：
 *   ① 建议优先推 —— 工具页「我的建议」按确认次数排序，已确认的排在通用建议前；
 *   ② Mira 引用真实证据 —— 把好习惯清单塞进 AI 的 snapshot，让建议提到用户自己的数字；
 *   ③ 复现追踪 ——（后置）每天看有没有做，缺席第 3 天才温和提醒一次。
 *
 * 另存 dismissed（负反馈）：用户点「没啥感觉 / ✕」的建议进入 30 天冷却，不再打扰。
 */
import * as FileSystem from 'expo-file-system';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_habits.json';

/** 冷却期：同一条建议被否后 30 天内不再出现（产品约束）。 */
export const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export interface HabitEntry {
  /** 动作 key（稳定标识，用于去重与冷却判定），如 'breathing-478' */
  id: string;
  /** 展示用动作名，如 '睡前 4-7-8 呼吸' */
  action: string;
  /** 证据指标短语（且必须是真实信号改善），如 'HRV 回升 8%，深睡连着 3 天变好' */
  metric: string;
  /** 建议原文（行动 / 状态型建议存这里；习惯确认型留空，渲染时回退 habitHeadline(action)） */
  headline?: string;
  /** 行动建议落地页：{ screen, params }（呼吸冥想 / 饮食记录 / 科普等） */
  cta?: { screen: string; params?: Record<string, any> };
  /** 建议种类：'action' 行动引导 / 'reflection' 观察反馈（仅用于「我的建议」卡片展示） */
  kind?: 'action' | 'reflection';
  /** 用户确认「有用」的次数 */
  count: number;
  /** 首次确认时间戳（epoch ms） */
  firstAt: number;
  /** 最近一次确认时间戳（epoch ms），用于排序 */
  lastAt: number;
}

export interface HabitFile {
  habits: HabitEntry[];
  /** 建议 id → 被否时间戳；30 天冷却 */
  dismissed: Record<string, number>;
}

let mem: HabitFile | null = null;

function emptyFile(): HabitFile {
  return { habits: [], dismissed: {} };
}

function normalize(j: any): HabitFile {
  const out = emptyFile();
  if (j && typeof j === 'object') {
    if (Array.isArray(j.habits)) {
      for (const h of j.habits) {
        if (!h || typeof h.id !== 'string') continue;
        const firstAt = Number(h.firstAt) || Date.now();
        out.habits.push({
          id: String(h.id),
          action: String(h.action ?? ''),
          metric: String(h.metric ?? ''),
          headline: typeof h.headline === 'string' ? h.headline : undefined,
          cta:
            h.cta && typeof h.cta === 'object'
              ? { screen: String(h.cta.screen ?? ''), params: (h.cta as any).params }
              : undefined,
          kind: h.kind === 'action' || h.kind === 'reflection' ? h.kind : undefined,
          count: Number(h.count) || 1,
          firstAt,
          lastAt: Number(h.lastAt) || firstAt,
        });
      }
    }
    if (j.dismissed && typeof j.dismissed === 'object') {
      for (const [k, v] of Object.entries(j.dismissed)) {
        const t = Number(v);
        if (Number.isFinite(t)) out.dismissed[k] = t;
      }
    }
  }
  return out;
}

let loading: Promise<HabitFile> | null = null;
let writes: Promise<void> = Promise.resolve();

function readHabits(): Promise<HabitFile> {
  if (mem) return Promise.resolve(mem);
  if (!loading) {
    loading = (async () => {
      const info = await FileSystem.getInfoAsync(PATH);
      const file = info.exists ? normalize(JSON.parse(await FileSystem.readAsStringAsync(PATH))) : emptyFile();
      mem = file;
      return file;
    })().finally(() => { loading = null; });
  }
  return loading;
}

/** A failed read is a temporary empty view, never a replacement for stored habits. */
export async function loadHabits(): Promise<HabitFile> {
  try { return await readHabits(); } catch { return emptyFile(); }
}

/** Publish memory only after a successful, serialized write. Failed writes can be retried. */
function updateHabits<T>(change: (file: HabitFile) => T): Promise<T> {
  const update = writes.then(async () => {
    const previous = await readHabits();
    const next: HabitFile = {
      habits: previous.habits.map(habit => ({ ...habit })),
      dismissed: { ...previous.dismissed },
    };
    const result = change(next);
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(next));
    mem = next;
    return result;
  });
  writes = update.then(() => {}, () => {});
  return update;
}

/**
 * 同步快照（供 AI snapshot 拼接用）。
 * 尚未读盘时返回空，并顺带预热一次（下一次调用即可拿到真实数据），
 * 避免 AI 调用早于页面加载而永远读不到清单。
 */
export function peekHabits(): HabitFile {
  if (!mem) void loadHabits();
  return mem ?? emptyFile();
}

/**
 * 确认「有用」：同一动作累加确认次数；首次确认时间只记一次。
 * 可接受 headline / cta / kind —— 让行动型、状态型建议也能以「原文小卡片」形式存进「我的建议」。
 */
export async function keepHabit(input: {
  id: string;
  action?: string;
  metric?: string;
  headline?: string;
  cta?: { screen: string; params?: Record<string, any> };
  kind?: 'action' | 'reflection';
}): Promise<HabitEntry> {
  return updateHabits(f => {
    const now = Date.now();
    const exist = f.habits.find((h) => h.id === input.id);
    let entry: HabitEntry;
    if (exist) {
      exist.count += 1;
      if (input.action !== undefined) exist.action = input.action || exist.action;
      if (input.metric !== undefined) exist.metric = input.metric || exist.metric;
      if (input.headline !== undefined) exist.headline = input.headline;
      if (input.cta) exist.cta = input.cta;
      if (input.kind) exist.kind = input.kind;
      exist.lastAt = now;
      entry = exist;
    } else {
      entry = {
        id: input.id,
        action: input.action ?? '',
        metric: input.metric ?? '',
        headline: input.headline,
        cta: input.cta,
        kind: input.kind,
        count: 1,
        firstAt: now,
        lastAt: now,
      };
      f.habits.push(entry);
    }
    // 确认即撤销冷却：用户改主意时不该还被「负反馈」压着
    delete f.dismissed[input.id];
    return entry;
  });
}

/** 撤销「留下」（误点 / 改主意）：移出清单。 */
export async function undoHabit(id: string): Promise<void> {
  await updateHabits(f => { f.habits = f.habits.filter(h => h.id !== id); });
}

/** 负反馈：记录「没啥感觉 / ✕」，该建议进入 30 天冷却。 */
export async function dismissSuggestion(id: string): Promise<void> {
  await updateHabits(f => { f.dismissed[id] = Date.now(); });
}

/** 是否在冷却期内（30 天内被否过）。 */
export function isCoolingDown(id: string, now: number = Date.now()): boolean {
  const t = (mem ?? emptyFile()).dismissed[id];
  return !!t && now - t < DISMISS_COOLDOWN_MS;
}

/** 当前所有好习惯，按确认次数倒序（次数相同按最近确认倒序）。 */
export async function listHabits(): Promise<HabitEntry[]> {
  const f = await loadHabits();
  return [...f.habits].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/**
 * 文案模板（2026-10-08 十改：口径对齐 App 内 AI 的人设声线 —— character.ts 的 ENFP 闺蜜，
 * 「句子短、有活力、爱用语气词（呀/哦/哎/啦）」，先接住感受再给建议；不夸大、不诊断）。
 *   主句（★ 十三改，用户定稿「发现型」口径）：发现「{action}」之后，你的状态有变好哦
 *   证据：{metric}（数字保持事实口径，不加修饰）
 *   问句：今天过得怎么样呀？跟我说说～
 * ★ 长度纪律：主句控制在 ~22 字内（首页气泡固定高 92、标题最多 2 行，过长会挤掉证据行）。
 */
export function habitHeadline(action: string): string {
  return `发现「${action}」之后，你的状态有变好哦`;
}

export const HABIT_QUESTION = '今天过得怎么样呀？跟我说说～';
