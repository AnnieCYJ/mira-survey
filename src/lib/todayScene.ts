/**
 * todayScene.ts —— 首页「今日状态」场景建议引擎（v18.37）
 *
 * 信息分工（用户 2026-09-28 拍板）：
 *  - 圆环中央 = 短建议词（≤6 字，场景触发时替换档位词；状态值/相位保留在圈内）
 *  - 圆环旁胶囊 = 具体解释（≤2 行，带原因；涉及周期相位/节律的场景可点击跳「周期和激素」页）
 *
 * 场景优先级链（同时命中取上面）：
 *   睡眠窗口 > 睡前1h(个人化) > 情绪尖峰 > 晨间满电 > 饭前低电量 > 久坐 > 午后低谷 > 傍晚收工
 *
 * 频控（用户要求：一个词一天 ≤3 次）：
 *  - 每个场景词有每日上限 + 最短冷却（持久化到 documentDirectory/today_scene_counter.json）
 *  - 触发窗口去重：饭前两窗口各一次、久坐每满 2h 重新武装、情绪尖峰每小时最多一次
 *  - 达上限/冷却中 → 该场景跳过，顺延下一优先级
 *
 * 诚实口径：所有场景只用真实数据判定（睡眠记录/事件数/步数/电量），不编造触发。
 */
import * as FileSystem from 'expo-file-system';
import { healthStore, dayKey } from '../data/healthStore';
import { parseClockMinutes } from './sleepTime';
import { curveLevel, CURVE_DEFAULTS } from './dailyStatus';

export type SceneKey =
  | 'asleep'
  | 'bedtime'
  | 'emotionSpike'
  | 'morningFull'
  | 'preMealLow'
  | 'sedentary'
  | 'afternoonTrough'
  | 'eveningWind';

export interface TodayScene {
  key: SceneKey;
  /** 圆环中央建议词（≤6 字） */
  word: string;
  /** 胶囊解释（≤2 行，带原因） */
  explain: string;
}

/** 每个场景词的每日上限与最短冷却 */
const SCENE_POLICY: Record<SceneKey, { dailyCap: number; cooldownMs: number }> = {
  asleep:          { dailyCap: 99, cooldownMs: 0 },            // 睡眠中持续显示
  bedtime:         { dailyCap: 1,  cooldownMs: 20 * 3600e3 },  // 每晚一次
  emotionSpike:    { dailyCap: 3,  cooldownMs: 60 * 60e3 },    // 每小时最多一次
  morningFull:     { dailyCap: 1,  cooldownMs: 20 * 3600e3 },  // 每天一次
  preMealLow:      { dailyCap: 3,  cooldownMs: 150 * 60e3 },   // 每饭点窗口一次
  sedentary:       { dailyCap: 3,  cooldownMs: 2 * 3600e3 },   // 每满 2h 重新武装
  afternoonTrough: { dailyCap: 1,  cooldownMs: 20 * 3600e3 },  // 每天一次
  eveningWind:     { dailyCap: 1,  cooldownMs: 20 * 3600e3 },  // 每晚一次
};

// ─────────────────────────────────────────────────────────────────────────────
// 频控计数器（进程内缓存 + 文件持久化）
// ─────────────────────────────────────────────────────────────────────────────

interface SceneCounter {
  dk: string;
  counts: Partial<Record<SceneKey, number>>;
  lastTs: Partial<Record<SceneKey, number>>;
}

let counter: SceneCounter | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function counterFileUri(): string {
  return `${(FileSystem.documentDirectory ?? '').replace(/\/$/, '')}/today_scene_counter.json`;
}

/** App 启动/首页挂载时调用一次：加载当日计数（跨重启有效） */
export async function initTodaySceneCounter(): Promise<void> {
  try {
    const raw = await FileSystem.readAsStringAsync(counterFileUri());
    const parsed = JSON.parse(raw) as SceneCounter;
    if (parsed && parsed.dk === dayKey(Date.now())) counter = parsed;
    else counter = { dk: dayKey(Date.now()), counts: {}, lastTs: {} };
  } catch {
    counter = { dk: dayKey(Date.now()), counts: {}, lastTs: {} };
  }
}

function persistCounter(): void {
  if (!counter || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    FileSystem.writeAsStringAsync(counterFileUri(), JSON.stringify(counter)).catch(() => {});
  }, 400);
}

/** 场景展示后调用（useEffect 中按 key 变化触发，避免 render 内重复计数） */
export function markSceneShown(key: SceneKey): void {
  if (!counter || counter.dk !== dayKey(Date.now())) counter = { dk: dayKey(Date.now()), counts: {}, lastTs: {} };
  counter.counts[key] = (counter.counts[key] ?? 0) + 1;
  counter.lastTs[key] = Date.now();
  persistCounter();
}

function sceneEligible(key: SceneKey, now: number): boolean {
  if (!counter || counter.dk !== dayKey(Date.now())) return true;
  const pol = SCENE_POLICY[key];
  const n = counter.counts[key] ?? 0;
  if (n >= pol.dailyCap) return false;
  const last = counter.lastTs[key] ?? 0;
  return now - last >= pol.cooldownMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// 个人入睡习惯：近 7-14 天 sleepTime 中位数（分钟数，跨午夜按 <12h 记为 +24h 语义）
// ─────────────────────────────────────────────────────────────────────────────

/** 返回习惯入睡时刻（当天墙钟分钟，如 23.5h → 1410）；样本不足返回 null */
export function habitBedtimeMinutes(now: number): number | null {
  const mins: number[] = [];
  for (let di = 1; di <= 14 && mins.length < 7; di++) {
    try {
      const s = healthStore.getSleep(dayKey(now - di * 86400000));
      const m = parseClockMinutes(s?.sleepTime);
      if (m != null) mins.push(m);
    } catch {}
  }
  if (mins.length < 3) return null;
  mins.sort((a, b) => a - b);
  return mins[Math.floor(mins.length / 2)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景判定主入口
// ─────────────────────────────────────────────────────────────────────────────

export interface SceneCtx {
  now: number;
  isAsleep: boolean;
  /** 当前电量 0-100（curveStatus.value）；null = 无数据 */
  statusValue: number | null;
  /** 最近一晚睡眠评分 0-100 */
  sleepScore: number | null;
  /** 今日晨起时刻 HH:mm（来自昨晚睡眠记录） */
  wakeTimeStr: string | null;
  /** 最近 1h 压力事件数 */
  stressRecent1h: number;
  /** 最近 2h 步数增量 */
  stepsLast2h: number;
  /** 最近一次血氧 %（近 3h 内）；null = 无新样本 */
  spo2Latest: number | null;
}

const inRange = (h: number, a: number, b: number) => h >= a && h < b;

export function evaluateTodayScene(ctx: SceneCtx): TodayScene | null {
  const { now, isAsleep, statusValue, sleepScore, wakeTimeStr, stressRecent1h, stepsLast2h, spo2Latest } = ctx;
  const d = new Date(now);
  const h = d.getHours() + d.getMinutes() / 60;
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const low = statusValue != null && curveLevel(statusValue, CURVE_DEFAULTS).index >= 2;
  const ok = (k: SceneKey) => sceneEligible(k, now);

  // 1. 睡眠窗口：持续显示，不受频控
  if (isAsleep) return { key: 'asleep', word: '安心休息', explain: '睡眠是唯一回血方式，恢复都在这里发生' };

  // 2. 睡前 1h（个人化）：习惯入睡时刻前 60 分钟起；无习惯史回退 22:30
  const bedMin = habitBedtimeMinutes(now) ?? 22 * 60 + 30;
  const inBedWindow = nowMin >= bedMin - 60 && nowMin <= bedMin + 30;
  if (inBedWindow && ok('bedtime')) {
    return { key: 'bedtime', word: '该睡了', explain: '按你的节奏，快到入睡时间了——电量充电只在睡眠里发生' };
  }

  // 3. 情绪尖峰：最近 1h 压力事件 ≥2（与情绪负荷柱状图着色同口径：≥2 黄、≥4 红）
  if (stressRecent1h >= 2 && ok('emotionSpike')) {
    return { key: 'emotionSpike', word: '先缓一缓', explain: '刚才一小时情绪消耗偏高，离开环境几分钟，喝口水再回来' };
  }

  // 4. 晨间满电：起床后 90 分钟内 且 睡眠评分 ≥85
  const wakeMin = parseClockMinutes(wakeTimeStr);
  if (wakeMin != null && sleepScore != null && sleepScore >= 85
      && nowMin >= wakeMin && nowMin <= wakeMin + 90 && ok('morningFull')) {
    return { key: 'morningFull', word: '满电开局', explain: '昨晚恢复到位，早上的认知窗口最值钱，把难的事放这里' };
  }

  // 5. 饭前电量低：10:30-12 / 16:30-18 且偏低/不足
  const preMeal = inRange(h, 10.5, 12) || inRange(h, 16.5, 18);
  if (preMeal && low && ok('preMealLow')) {
    return { key: 'preMealLow', word: '饭前记一下', explain: '快到饭点了，拍张照片记下这一餐，之后能看出饮食和状态的关系' };
  }

  // 6. 久坐：清醒时段（8-22）近 2h 步数 <100；血氧只在偏低时才提（正常时不占字数）
  if (inRange(h, 8, 22) && stepsLast2h < 100 && ok('sedentary')) {
    const spo2Low = spo2Latest != null && spo2Latest < 95;
    return {
      key: 'sedentary',
      word: '摸个鱼吧',
      explain: spo2Low
        ? `快两小时没动了，血氧 ${Math.round(spo2Latest)}% 偏低——起来走两分钟会回来`
        : '快两小时没动了，走两分钟，情绪也会回来一点',
    };
  }

  // 7. 午后低谷：13-15 且偏低（节律低谷 × 电量——与皮质醇节律相关，解释挂「周期和激素」页）
  if (inRange(h, 13, 15) && low && ok('afternoonTrough')) {
    return { key: 'afternoonTrough', word: '眯一会儿', explain: '节律低谷碰上电量偏低，20 分钟小睡刚好，超过 30 分钟醒来更昏' };
  }

  // 8. 傍晚收工：18-22（睡前窗口未激活时才会落到这里）
  if (inRange(h, 18, 22) && ok('eveningWind')) {
    return { key: 'eveningWind', word: '收工放松', explain: '今天够多了，别再安排烧脑的事，留点电量给晚上心情' };
  }

  return null; // 无场景 → 常规多因分析（buildCauseNarrative，TodayScreen 兜底）
}

// ─────────────────────────────────────────────────────────────────────────────
// 多因分析段（无场景触发时的胶囊文案）
// 内容挂钩「周期和激素」数据（不跳转）：相位 → 雌激素/孕激素 → 皮质醇节律 → 睡眠恢复。
// 逐条拼接、缺数据静默跳过；结果 ≤3 行。
// ─────────────────────────────────────────────────────────────────────────────

export interface CauseCtx {
  /** 经期/卵泡期/排卵期/黄体期/未记录 */
  phaseLabel: string;
  dayInCycle: number | null;
  /** 当前雌激素指数 0-100（建模估算，CurveStatus.estrogenIndex） */
  estrogenIndex: number | null;
  /** 皮质醇晨峰时刻字符串（如 '08:00'）或 '—' */
  cortisolPeak: string;
  /** 皮质醇节律评价：良好/偏晚/扁平/一般/'—' */
  cortisolRhythm: string;
  /** 最近一晚睡眠评分 0-100 */
  sleepScore: number | null;
  /** ★ 十九改：圆环当前状态档（充沛/平稳/偏低/不足）——把实时分值缝进分析，消除「激素低位 vs 状态良好」的观感矛盾 */
  level?: string | null;
}

const HORMONE_TXT: Record<string, string> = {
  // ★ 十九改（用户参考 ISHO 句式：「你可以说处于经期阶段，雌激素、孕激素落在低点，情绪怎么样」）：
  //   每条 = 点名阶段 + 点名激素 + 什么状态；不再回避相位开头（用户明确要这个）。
  经期: '处于经期，雌激素和孕激素都落在低点',
  卵泡期: '卵泡期，雌激素正一天天往上走',
  排卵期: '排卵期前后，雌激素到了本月高点',
  黄体期: '黄体期，孕激素升高，身体容易倦',
};

export function buildCauseNarrative(c: CauseCtx): string {
  // 胶囊限 1.5 行：最多 2 条、逐条压短。
  // ★ 十九改：句式 = 「阶段+激素事实」×「圆环当前状态」→
  //   · 低相位（经期/黄体期）× 状态好 → 归因给「底子稳」，鼓励；
  //   · 低相位 × 状态差 → 先接住（累很正常），有真实异常（皮质醇/睡眠）则点名原因；
  //   · 高相位 × 状态好 → 顺势鼓励去用这份状态；高相位 × 状态差 → 提醒恢复没跟上。
  //   两套系统不再各说各话：分析文案永远与圆环档位自洽。
  const parts: string[] = [];
  const known = c.phaseLabel !== '未记录' && HORMONE_TXT[c.phaseLabel] != null;
  const good = c.level === '充沛' || c.level === '平稳';
  const low = c.level === '偏低' || c.level === '不足';
  const lowPhase = c.phaseLabel === '经期' || c.phaseLabel === '黄体期';
  const cortLate = c.cortisolRhythm === '偏晚' && c.cortisolPeak !== '—';
  const cortFlat = c.cortisolRhythm === '扁平';
  const badSleep = c.sleepScore != null && c.sleepScore < 60;

  if (known) {
    parts.push(HORMONE_TXT[c.phaseLabel]);
    if (good) {
      parts.push(
        lowPhase
          ? '但身体底子稳，状态照样在线呀'
          : '激素正给力，放心把想做的安排上',
      );
    } else if (low) {
      if (cortLate) {
        parts.push(`皮质醇高峰拖到 ${c.cortisolPeak}，上午会慢一些`);
      } else if (cortFlat) {
        parts.push('皮质醇曲线偏平，能量起不来');
      } else if (badSleep) {
        parts.push(`昨晚睡眠 ${Math.round(c.sleepScore!)} 分，恢复没跟上`);
      } else {
        parts.push(
          lowPhase
            ? '赶上激素低位，累很正常，对自己温柔点'
            : '激素本该在上行，别硬撑，早点歇',
        );
      }
    }
  } else {
    // 相位未记录：报真实异常（皮质醇/睡眠），与旧口径一致
    if (cortLate) {
      parts.push(`皮质醇高峰拖到 ${c.cortisolPeak}，上午进入状态慢`);
    } else if (cortFlat) {
      parts.push('皮质醇曲线偏平，一天里能量起不来');
    }
    if (badSleep) {
      parts.push(`昨晚睡眠只有 ${Math.round(c.sleepScore!)} 分，恢复没跟上`);
    }
  }

  if (parts.length === 0) {
    // 无相位也无异常 → 报唯一可说的好消息，一句话
    return c.sleepScore != null ? `昨晚睡眠 ${Math.round(c.sleepScore)} 分，身体恢复得不错。` : '';
  }
  return parts.slice(0, 2).join('；') + '。';
}
