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
import { computeCognitiveLoadReport, cogLevelLabel } from './cognitiveLoad';
import type { TimelineItem } from '../components/TodayTimelineCard';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '\u2014';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}小时${m > 0 ? `${m}分` : ''}` : `${m}分钟`;
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

/** 构建同步部分（条目 1–5），AI 相关由调用方通过 extras 注入 */
export function buildTodayTimeline(extras?: TimelineExtras): TimelineResult {
  const now0 = new Date();
  const curMin = now0.getHours() * 60 + now0.getMinutes();
  const dateLabel = `${now0.getMonth() + 1}月${now0.getDate()}日 · ${WEEKDAYS[now0.getDay()]}`;

  const ring = RingBle.getState();
  const dataStale = (ring?.curveStatus as any)?.dataStale === true;

  const dated: (TimelineItem & { k: number })[] = [];
  const pushItem = (it: TimelineItem, k: number) => dated.push({ ...it, k });

  // 1. 周期相位
  const cs = ring?.curveStatus;
  if (cs?.hasLog && cs.phaseLabel) {
    pushItem({
      time: '全天',
      color: theme.colors.accent1,
      title: cs.phaseLabel,
      sub: cs.phaseLabel === '黄体期'
        ? '激素回落，留意情绪与能量起伏'
        : cs.phaseLabel === '经期'
          ? '以温和舒缓为主，适合休息'
          : '激素节律影响今日状态节奏',
    }, -1);
  }

  // 2. 起床
  const todaySleep = healthStore.getSleep(dayKey(Date.now()));
  if (todaySleep?.wakeTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(todaySleep.wakeTime.trim());
    pushItem({
      time: todaySleep.wakeTime,
      color: theme.colors.stateTired,
      title: dataStale ? '起床' : `起床 · 睡眠评分 ${todaySleep.score ?? '\u2014'}`,
      sub: dataStale
        ? '戒指暂无新数据，昨夜睡眠明细暂不显示'
        : `睡眠 ${fmtMin(todaySleep.total)} · 深睡 ${fmtMin(todaySleep.deep)}`,
    }, m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60);
  }

  // 3. 情绪波动峰值
  try {
    const evs = computeStressReport()?.events ?? [];
    const peakEvent = evs.length > 0 ? evs.reduce((a: any, b: any) => (b.severity > a.severity ? b : a)) : null;
    if (peakEvent) {
      pushItem({
        time: `${pad2(peakEvent.hour)}:${pad2(peakEvent.minute)}`,
        color: theme.colors.stateTense,
        title: `情绪波动 ${evs.length} 次`,
        sub: `峰值强度 ${Math.round(peakEvent.severity)} \u00b7 前后可安排 5 分钟呼吸调整`,
      }, peakEvent.hour * 60 + peakEvent.minute);
    }
  } catch { /* ignore */ }

  // 4. 脑力消耗
  try {
    const cogReport = computeCognitiveLoadReport();
    if (cogReport?.avgFatigue != null) {
      const barsPast = (cogReport.hourly ?? []).filter((h: any) => h.hasData && h.hour * 60 <= curMin);
      const peakBar = barsPast.length > 0 ? barsPast.reduce((a: any, b: any) => (b.score > a.score ? b : a)) : null;
      pushItem({
        time: peakBar ? `${pad2(peakBar.hour)}:00` : '今日',
        color: theme.colors.stateTired,
        title: `脑力消耗 ${cogReport.avgFatigue} \u00b7 ${cogLevelLabel(cogReport.avgFatigue)}`,
        sub: '高峰时段安排专注任务更高效',
      }, peakBar ? peakBar.hour * 60 : curMin);
    }
  } catch { /* ignore */ }

  // 5. 步数
  const dkToday = dayKey(Date.now());
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
      sub: '保持轻量活动，助力晚间恢复',
    }, lastStepMin ?? curMin);
  }

  // 6. AI 对话（调用方从 SQLite listSince 拿到后注入）
  const chat = extras?.aiChat;
  if (chat) {
    const mm = chat.time.match(/(\d{1,2}):(\d{2})/);
    pushItem(chat, mm ? Number(mm[1]) * 60 + Number(mm[2]) : curMin);
  }

  // 7. AI 洞察（调用方从 getAiInsight + buildCauseNarrative 拿到后注入）
  const advice = extras?.aiAdvice;
  if (advice) pushItem(advice, 24 * 60);

  const items: TimelineItem[] = dated
    .sort((a, b) => a.k - b.k)
    .slice(0, 7)
    .map((it) => ({ time: it.time, color: it.color, title: it.title, sub: it.sub }));

  return { dateLabel, items };
}
