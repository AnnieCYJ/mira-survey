/**
 * toolRecommend.ts —— 工具页顶部「每日三张推荐卡」引擎（v18.39）
 *
 * 需求（用户 2026-09-28）：每天基于当天数据情况推荐三张卡片。
 *  - 候选池每项带优先级函数（0 = 不可选），全部用真实数据判定：今日状态档/睡眠评分/
 *    今日压力事件数/步数/周期相位/时段
 *  - 同分用「日期 hash」打散：同一天顺序稳定（刷新不变），跨天自然轮换
 *  - 优先级不足 3 张时从常青池（知识科普/呼吸/好气色）补齐，永远正好 3 张
 *  - 理由句（desc）嵌入当天真实数字，不用模板空话
 */
import * as FileSystem from 'expo-file-system';
import { dayKey, healthStore } from '../data/healthStore';
import type { TaskItem, TaskFlip } from '../data/tasks';
import { curveLevel, CURVE_DEFAULTS } from './dailyStatus';
import { computeStressReport } from './stressAlgorithm';

export interface ToolCtx {
  now: number;
  /** 今日状态档 0-3（充沛/平稳/偏低/不足）；null = 无数据 */
  levelIdx: number | null;
  /** 当前状态值 0-100 */
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
  /** v18.88 翻面科普：点击卡片翻到背面看「为什么」+ 出处，查看详情跳科普页 */
  flip?: TaskFlip;
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
    desc: (c) => `当前状态值 ${c.statusValue != null ? Math.round(c.statusValue) : '—'}，身体还绷着——10 分钟 4-7-8 呼吸把它松开，晚上更容易睡着。`,
    flip: {
      articleId: 'sigh',
      collection: 'emotion',
      articleTitle: '生理性叹息：最快的降温开关',
      tip: '今晚躺下后试三轮：吸 4 秒、停 7 秒、呼 8 秒。睡不着的核心原因是身体还停在「戒备」档，而呼气比吸气长时，身体会误以为安全了、该休息了，心率几分钟内就能真的降下来。「稳定睡眠」里的睡前呼吸就是这个节奏，跟着练不用自己数拍子。',
      src: 'Balban M.Y. et al., Cell Reports Medicine, 2023',
      do: { route: 'Breathing' },
    },
  },
  {
    id: 'rec-emotion-care',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '情绪急救三步',
    action: '开始 · 5 min',
    prio: (c) => (c.stressEventsToday >= 2 ? 85 : 0),
    desc: (c) => `今天已经 ${c.stressEventsToday} 次压力事件了，情绪还在高位。先花 5 分钟降降温，再回来处理事情也不迟。`,
    flip: {
      articleId: 'talkFriend',
      collection: 'emotion',
      articleTitle: '和朋友聊聊：倾诉是被研究过的方法',
      tip: '烦的事在脑子里打转时，越压越响。把情绪说出口或写下来的瞬间，大脑里管警报的部位会真的安静下来——这不是安慰话，是脑成像实验反复看到的。找个能放松的人说说，或者先写三行也行。',
      src: 'Lieberman M.D. et al., Psychol Sci, 2007',
      do: { route: 'EmotionLog' },
    },
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
    desc: (c) => `今天才 ${c.steps} 步，几乎没动——下午快走 15 分钟，情绪和恢复都会回来一点。`,
    flip: {
      articleId: 'cortisolcalm',
      collection: 'sport',
      articleTitle: '把皮质醇降下来的四件小事',
      tip: '坐了一下午，身体会以为你在省电，其实是在攒疲劳。快走十几分钟，肌肉帮血液把糖带走、血流回大脑，下午的困和闷会松开一大截。不用换运动服，下楼两圈就够。',
      src: 'DiPietro L. et al., Diabetes Care, 2013',
    },
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
      ? '经期铁流失加快，这餐把红肉或深绿叶菜安排上——拍一张看看搭配。'
      : '饭点前后记一餐最准，拍一张看搭配比例，不用算卡路里。',
    flip: {
      articleId: 'ironwomen',
      collection: 'nutrition',
      articleTitle: '铁：女性最容易缺的一样',
      tip: '经期的疲惫和气色差，很多时候是铁在悄悄流失——每次月经都会带走一批，身体自己补得很慢。这餐有红肉或深绿叶菜就拍下来看看；茶和咖啡隔开一小时再喝，不然铁等于白补。',
      src: 'Pasricha S.R. et al., Lancet, 2021',
      do: { route: 'FoodScan', autoCamera: true },
    },
  },
  {
    id: 'rec-cog',
    type: 1,
    badge: '今日推荐 · 认知提升',
    title: '工作记忆训练',
    action: '开始 · 15 min',
    prio: (c) => (c.sleepScore != null && c.sleepScore >= 80 && (c.levelIdx == null || c.levelIdx <= 1) ? 75 : 0),
    desc: (c) => `昨晚睡眠 ${c.sleepScore != null ? Math.round(c.sleepScore) : '—'} 分，大脑今天在状态——15 分钟训练放在现在，效果最好。`,
    flip: {
      articleId: 'hormCognition',
      collection: 'learn',
      articleTitle: '雌激素上行的那两周，脑子确实更好使',
      tip: '昨晚睡得好，大脑今天正好在「吸收档」——学新东西、记东西都比平时快，这是激素在给认知开绿灯。想学的、要背的，放到现在做，同样的时间能多拿不少收获。',
      src: 'McEwen B.S. & Alves S.E., Endocr Rev, 1999',
    },
  },
  {
    id: 'rec-focus',
    type: 2,
    badge: '今日推荐 · 专注',
    title: '25 分钟深度专注',
    action: '开始 · 25 min',
    prio: (c) => (c.levelIdx === 0 ? 70 : 0),
    desc: (c) => `今日状态 ${c.statusValue != null ? Math.round(c.statusValue) : '—'} 在高位，正是能沉下来的时候——把最难的事放进这 25 分钟。`,
    flip: {
      articleId: 'dopamine',
      collection: 'learn',
      articleTitle: '多巴胺基线：别喂廉价刺激',
      tip: '刷完手机再干正事，会觉得难事更难——不是你懒，是大脑的奖赏系统被廉价刺激抬高了胃口。先把最难的那件事做掉，再碰娱乐，同样的二十五分钟会值钱很多。',
      src: 'Schultz W., J Neurophysiol, 1998',
    },
  },
  {
    id: 'rec-glow',
    type: 3,
    badge: '今日推荐 · 提升颜值',
    title: '好气色养成',
    action: '开始 · 3 min',
    prio: (c) => (c.sleepScore != null && c.sleepScore >= 80 ? 55 : 0),
    desc: (c) => `睡眠 ${c.sleepScore != null ? Math.round(c.sleepScore) : '—'} 分 + ${c.phase}，皮肤正在修复期——今天少一杯奶茶，多一份气色。`,
    flip: {
      articleId: 'sleepskin',
      collection: 'glow',
      articleTitle: '睡眠是皮肤的夜间修复班',
      tip: '皮肤的修复班只在深睡时段开工，昨晚睡得不错，今天正是它交作业的时候。想守住这个状态，今晚同一时间上床比任何精华都管用——气色的差距，是几个好觉一点点攒出来的。',
      src: 'Van Cauter E. et al., JAMA, 2000',
    },
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
      ? '这段时间情绪本来就容易波动，5 分钟读懂压力反应的来路，下次就知道是为什么。'
      : '5 分钟读懂压力反应的来龙去脉，下次情绪波动就知道是为什么。',
    flip: {
      articleId: 'cortisol',
      collection: 'learn',
      articleTitle: '皮质醇的晨峰意义',
      tip: '压力大不是矫情，是身体在持续分泌「应战激素」——短期让你清醒，压久了就开始抢睡眠和食欲。今天给它一个出口：十分钟快走，或者几组慢呼吸，激素自己会降回正常轨道。',
      src: 'Fries E. et al., Psychoneuroendocrinology, 2009',
    },
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
    flip: {
      articleId: 'cycleskin',
      collection: 'glow',
      articleTitle: '周期与皮肤：跟着阶段换打法',
      tip: '皮肤是激素的显示屏：这段时间雌激素在高位，皮肤供血足、锁水好，是上妆最服帖的窗口。重要场合尽量往这几天排；等黄体期出油变多时，护肤品做减法就行。',
      src: 'Shah M.G. & Maibach H.I., Am J Clin Dermatol, 2001',
    },
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
    flip: {
      articleId: 'sigh',
      collection: 'emotion',
      articleTitle: '生理性叹息：最快的降温开关',
      tip: '紧张到手心出汗、心跳很明显的时候，别硬扛——长呼气就是身体自带的刹车。箱式呼吸把节奏定成 4-4-4-4，跟着引导走连数拍子都不用；配着白噪音做，几分钟心跳就会慢下来。斯坦福的实验里，这类慢呼吸比冥想见效还快。',
      src: 'Balban M.Y. et al., Cell Reports Medicine, 2023',
      do: { route: 'Breathing' },
    },
  },
  // ── v18.92 情绪练习卡（情绪页里的任务进牌堆，全部可翻面 + 去完成）──
  {
    id: 'rec-good3',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '三件好事 · 睡前记录',
    action: '记录 · 3 min',
    evergreen: true,
    prio: (c) => {
      const h = new Date(c.now).getHours();
      return h >= 19 ? 55 : 20;
    },
    desc: (c) => `现在是${new Date(c.now).getHours() >= 19 ? '睡前的好时段' : '适合回味的时候'}——想三件今天顺利的小事，一两句话就够。`,
    flip: {
      articleId: 'threeGood',
      collection: 'emotion',
      articleTitle: '三件好事：被验证最多的幸福练习',
      tip: '这不只是感恩鸡汤：睡前想三件今天顺利的小事、写一两句为什么，是积极心理学里被对照实验验证过最多的练习——坚持一周，情绪基线会慢慢上移。今晚睡前试试：今天的三件小事是什么？',
      src: 'Seligman M.E.P. et al., Am Psychol, 2005',
      do: { route: 'EmotionLog' },
    },
  },
  {
    id: 'rec-talk',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '和朋友聊聊 · 10 分钟',
    action: '开始 · 10 min',
    prio: (c) => (c.stressEventsToday >= 1 ? 62 : 0),
    desc: (c) => `今天有 ${c.stressEventsToday} 次压力事件压着——找个人说说，比一个人扛着管用。`,
    flip: {
      articleId: 'talkFriend',
      collection: 'emotion',
      articleTitle: '和朋友聊聊：倾诉是被研究过的方法',
      tip: '倾诉不是软弱，是大脑的降温手段：把情绪说出口的那个瞬间，管警报的脑区会真的安静下来；有朋友在身边时，连面对压力的心跳都会慢一些。今天给那个人发条消息吧，发语音也行。',
      src: 'Lieberman M.D. et al., Psychol Sci, 2007（UCLA）',
      do: { route: 'EmotionLog' },
    },
  },
  {
    id: 'rec-sigh',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '90 秒生理性叹息',
    action: '开始 · 2 min',
    prio: (c) => (c.levelIdx != null && c.levelIdx >= 2 ? 58 : 0),
    desc: (c) => `今日状态 ${c.statusValue != null ? Math.round(c.statusValue) : '—'}，身体绷着——90 秒生理性叹息，最快把心率压下来。`,
    flip: {
      articleId: 'sigh',
      collection: 'emotion',
      articleTitle: '生理性叹息：最快的降温开关',
      tip: '情绪上头的那几十秒，讲道理没用——身体先降温，脑子才听得进话。两次短吸、一口长呼，重复几分钟，心率自己往下走；斯坦福的对照实验里，这比同样时长的正念冥想见效更快。现在就可以试。',
      src: 'Balban M.Y. et al., Cell Reports Medicine, 2023（斯坦福）',
      do: { route: 'EmotionLog' },
    },
  },
  {
    id: 'rec-write',
    type: 0,
    badge: '今日推荐 · 情绪调节',
    title: '把烦心事写下来',
    action: '开始 · 10 min',
    evergreen: true,
    prio: (c) => (c.phase === '黄体期' ? 48 : 25),
    desc: (c) => c.phase === '黄体期'
      ? '这段时间容易多想——把烦的事写 10 分钟，脑子里的「待处理」就能清掉一批。'
      : '烦的事在脑子里盘旋？写 10 分钟，把它从「待处理」里清出去。',
    flip: {
      articleId: 'expressiveWrite',
      collection: 'emotion',
      articleTitle: '把烦心事写下来：最便宜的整理术',
      tip: '烦的事一直在脑子里转，是因为大脑把它当「待处理」。写 10 分钟——不用修辞、不用给谁看，只是把事和情绪摊开在纸上。这是心理学里被复现最多的练习之一：写完的人睡得更好，也更少反刍。',
      src: 'Pennebaker J.W. & Beall S.K., J Abnorm Psychol, 1986',
      do: { route: 'EmotionLog' },
    },
  },
  // ── v18.92 呼吸冥想练习卡（呼吸页里的任务进牌堆）──
  {
    id: 'rec-sleep-breath',
    type: 0,
    badge: '今日推荐 · 稳定睡眠',
    title: '睡前呼吸 · 4-7-8',
    action: '开始 · 5 min',
    prio: (c) => {
      const h = new Date(c.now).getHours();
      return h >= 21 ? 65 : 0;  // 21 点后限定：助眠窗口
    },
    desc: (c) => `已经 ${new Date(c.now).getHours()} 点了——关灯前做几轮 4-7-8 呼吸，给身体一个「该睡了」的信号。`,
    flip: {
      articleId: 'hormSleep',
      collection: 'learn',
      articleTitle: '为什么经前一周睡得特别差',
      tip: '躺下后心跳快、脑子停不下来？呼气比吸气长时，迷走神经会把「油门」松开——几轮 4-7-8 呼吸，心率就能真的降下来。黄体期体温偏高、入睡更难，这招正好对症。呼吸冥想里的「睡前呼吸」就是这个节奏，再配上白噪音，今晚关灯前试三轮。',
      src: 'Lancel M., Biol Psychiatry, 1999',
      do: { route: 'Breathing' },
    },
  },
  {
    id: 'rec-meditate',
    type: 0,
    badge: '今日推荐 · 稳定睡眠',
    title: '轻松冥想入门',
    action: '开始 · 5 min',
    evergreen: true,
    prio: () => 22,
    desc: () => '不用盘腿、不用清空大脑——5 分钟跟着引导走，给自主神经换个挡。',
    flip: {
      articleId: 'hormRecovery',
      collection: 'learn',
      articleTitle: 'HRV 的月度节奏：黄体期低一点是正常的',
      tip: '冥想不是玄学，是给自主神经换挡——练习时修复档会被打开，HRV 慢慢回来；黄体期 HRV 比平时低一截也别灰心，那是激素背景音，不是你没练对。「轻松冥想入门」5 分钟跟着音频走，静不下心就垫一层白噪音或自然声。',
      src: 'Yildirir A. et al., Gynecol Endocrinol, 2002',
      do: { route: 'Breathing' },
    },
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
    flip: cand.flip,
  }));
}
