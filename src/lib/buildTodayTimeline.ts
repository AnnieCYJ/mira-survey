/**
 * buildTodayTimeline —— 构建「今日旅程」条目
 *
 * 独立成模块，避免 TodayScreen / MeditationScreen 各自维护一份。
 * 内部所有同步数据都从单例取（RingBle.getState / healthStore 等）。
 * AI 对话 / AI 洞察 因依赖 SQLite 异步查询 + AI 引擎，做成可选参数由调用方传入。
 */
import { theme } from '../theme/theme';
import { RingBle } from '../ble/RingBleManager';
import { healthStore, dayKey } from '../data/healthStore';
import { computeStressReport } from './stressAlgorithm';
import type { TimelineItem } from '../components/TodayTimelineCard';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 每日步数目标（与 metrics.ts 步数指标「目标 10000」文案同源；暂未开放设置页可调） */
const STEP_GOAL = 10000;
function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '\u2014';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ''}` : `${m}分钟`;
}
/** "HH:mm" → 小时（小数）；解析不了返回 null */
function parseClockH(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export interface TimelineResult {
  dateLabel: string;
  items: TimelineItem[];
}

export interface TimelineExtras {
  /** AI 对话条目（listSince 异步查询的结果，由调用方在 useEffect 里拿到后传入） */
  aiChat?: TimelineItem | null;
  /** AI 洞察条目（getAiInsight 异步结果 + narrative） */
  aiAdvice?: TimelineItem | null;
}

/** 构建同步部分（条目 1–5），AI 相关由调用方通过 extras 注入
 *  ★ 2026-10-10（用户：日 Tab 选历史日期）：新增可选 date 参数——
 *    睡眠/步数按天从 healthStore / ring.stepDaily 取；
 *    相位/情绪波动/脑力依赖当日实时报告，仅今天生成（历史日跳过，不做回溯臆测）。
 */
export function buildTodayTimeline(extras?: TimelineExtras, date?: Date): TimelineResult {
  const now0 = date ?? new Date();
  const T0 = new Date();
  const isToday =
    now0.getFullYear() === T0.getFullYear() &&
    now0.getMonth() === T0.getMonth() &&
    now0.getDate() === T0.getDate();
  const curMin = now0.getHours() * 60 + now0.getMinutes();
  const dateLabel = `${now0.getMonth() + 1}月${now0.getDate()}日 · ${WEEKDAYS[now0.getDay()]}`;
  const dayKeySel = dayKey(now0.getTime());

  const ring = RingBle.getState();
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;

  const dated: (TimelineItem & { k: number })[] = [];
  const pushItem = (it: TimelineItem, k: number) => dated.push({ ...it, k });

  // 1. 周期相位（依赖当日实时报告，仅今天生成）
  const cs = ring?.curveStatus;
  if (isToday && cs?.hasLog && cs.phaseLabel) {
    pushItem({
      time: '全天',
      color: theme.colors.accent1,
      title: cs.phaseLabel,
      emoji: '🌸',
      sub:
        cs.phaseLabel === '经期' ? '身体在经期，慢慢来就好'
        : cs.phaseLabel === '卵泡期' ? '新周期刚开始，状态在往上走'
        : cs.phaseLabel === '排卵期' ? '排卵期，精力和心情都不错'
        : cs.phaseLabel === '黄体期' ? '激素在回落，情绪体力容易波动'
        : '激素节律稳稳的，今天状态不错',
    }, -1);
  }

  // 2. 起床（历史日也能取到当天的睡眠）
  const todaySleep = healthStore.getSleep(dayKeySel);
  if (todaySleep?.wakeTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(todaySleep.wakeTime.trim());
    const sleepScore = todaySleep.score;
    const sleepScoreNum = typeof sleepScore === 'number' ? sleepScore : NaN;
    pushItem({
      time: todaySleep.wakeTime,
      color: theme.colors.stateTired,
      title: dataStale ? '起床' : `起床 · 睡眠评分 ${sleepScore ?? '\u2014'}`,
      emoji: '☀️',
      sub: dataStale
        ? '昨晚的睡眠还没同步，细节稍后能看到'
        : `睡眠 ${fmtMin(todaySleep.total)} · 深睡 ${fmtMin(todaySleep.deep)}`,
      // ★ 本轮（用户 #245）：睡眠评分 ≥ 85 视为达标（高质量睡眠），卡片右上角画星
      goalMet: !dataStale && Number.isFinite(sleepScoreNum) && sleepScoreNum >= 85,
      // ★ 本轮（用户 #248）：起床评分卡补一句分析（按评分分层，平实、不评分说教）
      analysis: dataStale
        ? undefined
        : !Number.isFinite(sleepScoreNum)
        ? '今晚的睡眠数据还不完整，等同步完再看恢复情况。'
        : sleepScoreNum >= 85
        ? '醒来状态不错，身体恢复得比较扎实，今天的精神底子很好。'
        : sleepScoreNum >= 70
        ? '昨晚恢复中等，今天节奏别排太满，留点余地给自己。'
        : '昨晚睡得偏浅，上午先缓一缓，重要的事往后挪挪。',
    }, m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60);
  }

  // 3. 情绪波动峰值（仅今天）
  try {
    if (!isToday) throw new Error('skip');
    // ★ 2026-10-12（用户：睡眠阶段不记录情绪）—— 睡眠窗内的 EDA 事件不计入：
    //   旅程里的"情绪波动 N 次"只数清醒时段（与详情页点阵/节律同口径）。
    const bedH = parseClockH(todaySleep?.sleepTime);
    const wakeH = parseClockH(todaySleep?.wakeTime);
    const inSleep = (hour: number) => bedH != null && wakeH != null
      && (bedH > wakeH ? (hour >= bedH || hour < wakeH) : (hour >= bedH && hour < wakeH));
    const evs = (computeStressReport()?.events ?? [])
      .filter((e: any) => !inSleep((e.hour ?? 0) + (e.minute ?? 0) / 60));
    const peakEvent = evs.length > 0 ? evs.reduce((a: any, b: any) => (b.severity > a.severity ? b : a)) : null;
    if (peakEvent) {
      pushItem({
        time: `${pad2(peakEvent.hour)}:${pad2(peakEvent.minute)}`,
        color: theme.colors.stateTense,
        title: `情绪波动 ${evs.length} 次`,
      emoji: '💗',
        sub: `峰值强度 ${Math.round(peakEvent.severity)} \u00b7 起伏大时，试试 5 分钟深呼吸`,
      }, peakEvent.hour * 60 + peakEvent.minute);
    }
  } catch { /* ignore */ }

  // 4. 脑力消耗条目已移除（★ 2026-10-12 用户：旅程里不显示脑力准备度/脑力消耗）

  // 4. 步数（历史日也能取到）
  const dkToday = dayKeySel;
  const stepsToday = ring?.stepDaily?.[dkToday]?.steps ?? 0;
  if (stepsToday > 0) {
    let lastStepMin: number | null = null;
    try {
      const pts: any[] = healthStore.getIntraday('steps' as any, dkToday) ?? [];
      const last = pts.length > 0 ? pts[pts.length - 1] : null;
      if (last && Number.isFinite(last.t)) {
        const d = new Date(last.t);
        const m = d.getHours() * 60 + d.getMinutes();
        if (m <= curMin) lastStepMin = m;
      }
    } catch { /* ignore */ }
    pushItem({
      time: lastStepMin != null ? `${pad2(Math.floor(lastStepMin / 60))}:${pad2(lastStepMin % 60)}` : '今日',
      color: theme.colors.stateCalm,
      title: `活动 ${stepsToday} 步`,
      emoji: '🏃‍♀️',
      sub: '今天走动了，都记在这里',
      // ★ 本轮（用户 #245）：步数达到当日目标则在卡片右上角画星
      goalMet: stepsToday >= STEP_GOAL,
    }, lastStepMin ?? curMin);
  }

  // 5. AI 对话（调用方从 SQLite listSince 拿到后注入）
  const chat = extras?.aiChat;
  if (chat) {
    const mm = chat.time.match(/(\d{1,2}):(\d{2})/);
    pushItem(chat, mm ? Number(mm[1]) * 60 + Number(mm[2]) : curMin);
  }

  // 6. AI 洞察（调用方从 getAiInsight + buildCauseNarrative 拿到后注入）
  const advice = extras?.aiAdvice;
  if (advice) pushItem(advice, 24 * 60);

  const items: TimelineItem[] = dated
    .sort((a, b) => a.k - b.k)
    .slice(0, 7)
    .map((it) => ({ time: it.time, color: it.color, title: it.title, sub: it.sub, emoji: it.emoji, goalMet: it.goalMet, analysis: it.analysis }));

  return { dateLabel, items };
}
