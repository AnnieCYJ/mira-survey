/**
 * homeStatusWord —— 首页圆环中心「状态词」的场景词引擎（2026-11-14，2026-11-15 修回落）
 *
 * 用户口径：
 *   · 底层四个档位词（元气满满 / 状态良好 / 平平静静 / 休息一下）是**常态展示**，按档位走；
 *   · 某些生活场景（刚醒 / 临近中午 / 午后久坐 / 傍晚下班 / 睡前）应有**场景词**
 *     （刚醒啦 / 吃点好的 / 摸个鱼吧 / 收个工 / 该歇了）；
 *   · 场景词**只在刚触发的那一小段时间出现**：触发后 30 分钟（一个半小时槽）就回落底层档位词，
 *     之后哪怕档位没变、还处在同一个时段，也不再挂「收个工」——不能从 18:00 一直挂到 21:00。
 *
 * 机制（2026-11-15 重写）：
 *   · 每个场景记「首次触发时刻 startedAt」，超过 SCENE_TTL_MS 即回落；
 *   · 回落时把该场景记入当天 done 集合，**不会重新武装**（旧版把 active 清空，下一帧又被当成
 *     「新场景」重新展示，导致「展示 2 槽 → 回落 1 帧 → 再展示 2 槽」死循环，实测 18:00–21:20
 *     24 个采样点里有 20 个还挂着「收个工」）；
 *   · 场景切换（evening→bedtime）可触发新场景词，旧场景同样记入 done；
 *   · 同一场景当天只触发一次（跨天清零）；档位变化不重置 done，底层词随 level 自己变；
 *   · 状态可注入持久化（prefs），App 重启后当天已展示过的场景不会又冒出来。
 *
 * 纯函数 + 模块状态，RN / IO 只通过注入的 persist 接口，可离线单测。
 */
import { dayPhase, type DayPhase } from './timePhase';

/** 底层档位词（按 level 0–3，与圆环 moodLabel 同源：元气满满/状态良好/平平静静/休息一下） */
const BASE_WORDS = ['元气满满', '状态良好', '平平静静', '休息一下'] as const;

export type ScenarioKey = 'woke' | 'preLunch' | 'sedentary' | 'offWork' | 'bedtime';
const SCENARIO_KEYS: readonly ScenarioKey[] = ['woke', 'preLunch', 'sedentary', 'offWork', 'bedtime'];

/** 场景词：短、口语、贴场景。 */
const SCENARIO_WORDS: Record<ScenarioKey, string> = {
  woke: '刚醒啦',
  preLunch: '吃点好的',
  sedentary: '摸个鱼吧',
  offWork: '收个工',
  bedtime: '该歇了',
};

/** 场景词展示时长：触发后一个半小时槽（30min）就回落到底层档位词 */
export const SCENE_TTL_MS = 30 * 60 * 1000;

/** 持久化键（与 QA 注入 / 排障共用） */
export const HOME_WORD_STORAGE_KEY = 'mira_home_word_v1';

export interface HomeWordPersistedState {
  /** 日期戳 dk()，跨天作废 */
  dk: string;
  /** 当天已经展示完毕、不再重新武装的场景 */
  done: ScenarioKey[];
  /** 正在展示（未到 TTL）的场景 */
  active: ScenarioKey | null;
  /** active 的首次触发时刻（ms） */
  startedAt: number;
}

/** 注入式持久化：保持本模块零 RN / 零 IO，离线可测 */
export interface HomeWordPersist {
  load(): Promise<unknown>;
  save(state: HomeWordPersistedState): void;
}

// ── 模块级记忆：会话内跨渲染保存 ──
let active: ScenarioKey | null = null;
let startedAt = 0;
let done: Set<ScenarioKey> = new Set();
let dayStamp = '';
let persist: HomeWordPersist | null = null;
let hydrated = false;
/** 恢复完成前不许写盘：否则首帧 render 会先覆盖掉磁盘里「今天已展示过」的记录 */
let ready = false;

export function configureHomeWordPersist(p: HomeWordPersist | null): void {
  persist = p;
  hydrated = false;
  ready = false;
}

/** App 启动/首页挂载时调用一次：恢复当天「已展示过」的场景，避免重启后又冒出场景词 */
export async function hydrateHomeWord(): Promise<void> {
  if (!persist || hydrated) return;
  hydrated = true;
  try {
    const raw = await persist.load();
    const s = raw as HomeWordPersistedState | null;
    if (!s || typeof s !== 'object' || s.dk !== dk(Date.now())) return; // 跨天 / 空 → 用当天新状态
    done = new Set((Array.isArray(s.done) ? s.done : []).filter(isScenarioKey));
    active = isScenarioKey(s.active) ? s.active : null;
    startedAt = Number.isFinite(s.startedAt) ? Number(s.startedAt) : 0;
    dayStamp = s.dk;
  } catch {
    // 读失败按「当天还没展示过」处理，不阻塞首页
  } finally {
    ready = true;
  }
}

function isScenarioKey(v: unknown): v is ScenarioKey {
  return typeof v === 'string' && (SCENARIO_KEYS as readonly string[]).includes(v);
}

function snapshot(): HomeWordPersistedState {
  return { dk: dayStamp || dk(Date.now()), done: [...done], active, startedAt };
}

function save(): void {
  if (!persist || !ready) return;
  try { persist.save(snapshot()); } catch { /* 持久化失败不影响展示 */ }
}

/** 由「时段 + 久坐信号」推导当前应展示的场景（无则返回 null → 用底层档位词） */
function detect(phase: DayPhase, sedentary: boolean): ScenarioKey | null {
  switch (phase) {
    case 'morning':
      return 'woke';
    case 'preNoon':
      return 'preLunch';
    case 'afternoon':
      return sedentary ? 'sedentary' : null;
    case 'evening':
      return 'offWork';
    case 'bedtime':
      return 'bedtime';
    default:
      return null; // lateMorning 不强行盖词
  }
}

function dk(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface HomeWordInput {
  /** 当前时段（与分析/建议共用 narrative.phase，避免跨边界错位） */
  phase: DayPhase;
  /** 圆环档位 0–3 */
  level: 0 | 1 | 2 | 3;
  /** 午后久坐信号（活动强度低）：仅 afternoon 用到 */
  sedentary?: boolean;
  /** 墙钟时间戳（ms） */
  now: number;
}

export interface HomeWordResult {
  word: string;
  /** true = 当前是场景词（短暂），false = 底层档位词（常态） */
  isScenario: boolean;
  /** 便于离线断言/排障：本次取词的原因 */
  reason: 'scenario-start' | 'scenario-showing' | 'scenario-expired' | 'scene-ended' | 'already-done' | 'base';
}

/** 回落到底层档位词：把场景记入当天 done，之后不再重新武装 */
function finish(key: ScenarioKey, input: HomeWordInput, reason: HomeWordResult['reason']): HomeWordResult {
  if (!done.has(key)) {
    done.add(key);
    save();
  }
  active = null;
  startedAt = 0;
  return { word: BASE_WORDS[input.level], isScenario: false, reason };
}

/**
 * 取首页圆环中心状态词。
 * 场景词只在「刚触发场景」的 30 分钟内出现，之后回落到底层档位词；
 * 同一场景当天不再重复（跨天清零），档位变化只影响底层词本身。
 */
export function pickHomeWord(input: HomeWordInput): HomeWordResult {
  const today = dk(input.now);
  if (dayStamp !== today) {
    active = null;
    startedAt = 0;
    done = new Set();
    dayStamp = today;
    save();
  }

  const cand = detect(input.phase, input.sedentary === true);
  const base = BASE_WORDS[input.level];

  // 场景结束（时段过去 / 久坐信号消失）→ 收尾并回落
  if (cand === null) {
    if (active !== null) return finish(active, input, 'scene-ended');
    return { word: base, isScenario: false, reason: 'base' };
  }

  // 当天已展示完毕 → 直接底层词，绝不重新武装
  if (done.has(cand)) {
    active = null;
    return { word: base, isScenario: false, reason: 'already-done' };
  }

  // 首次进入场景（含场景切换）→ 旧场景收尾，新场景记触发时刻并展示
  if (cand !== active) {
    if (active !== null && !done.has(active)) {
      done.add(active);
    }
    active = cand;
    startedAt = input.now;
    save();
    return { word: SCENARIO_WORDS[cand], isScenario: true, reason: 'scenario-start' };
  }

  // 同一场景：超过 TTL → 回落且当天不再出现
  if (input.now - startedAt >= SCENE_TTL_MS) {
    return finish(cand, input, 'scenario-expired');
  }

  return { word: SCENARIO_WORDS[cand], isScenario: true, reason: 'scenario-showing' };
}

/** 仅供测试/调试：清空记忆（保留已注入的 persist 配置） */
export function resetHomeWord(): void {
  active = null;
  startedAt = 0;
  done = new Set();
  dayStamp = '';
  hydrated = false;
  ready = false;
}
