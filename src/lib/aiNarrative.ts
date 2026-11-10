/**
 * aiNarrative —— 圆环下「今日状态叙事」的 AI 生成层（2026-10-08 二十改）
 *
 * 用户定稿：**AI 为主、模板为辅** —— 状态分/相位/皮质醇/睡眠/近期行为（刚做完呼吸冥想等）
 * 综合喂给 Mira，生成一句更像人话、更鼓励的分析；AI 没生成（失败/超时/不可用）就显示
 * todayScene.ts 的确定性模板（秒出，永不空）。与建议卡（aiSuggestion）同一套混合架构。
 *
 * 工作方式：
 *  · 签名 = 档位|相位|皮质醇节律|睡眠桶|压力桶 —— 任一变化即重新生成（缓存未命中时）；
 *  · 缓存：内存 Map + 磁盘单条（mira_ai_narrative.json），重启同签名秒出；
 *  · 走 runOnModel 串行队列（去重 key `ainarr@{sig}`，与聊天/建议共用一条链，不撞 busy）；
 *  · 30s 超时 —— 用户口径「状态更新后几秒就要优化」：模板先在位，AI 到货即无声替换。
 *
 * 诚实口径：
 *  · 数字只能来自传入的真实事实（睡眠分/状态分），prompt 明令「没给就不写数字」；
 *  · 输出校验：8–44 字、单行、无 JSON 残留 —— 不合法直接丢弃，模板继续。
 */
import * as FileSystem from 'expo-file-system';
import { runOnModel } from '../ai/model';
import { ensureInterventionLogLoaded, allInterventionEntries, type InterventionKind } from '../data/interventionLog';
import { dayPhase, DAY_PHASE_META, padHour, type DayPhase } from './timePhase';

const STORE_PATH = (FileSystem.documentDirectory ?? '') + 'mira_ai_narrative.json';
/** 整体超时：模板已在位，AI 迟到也不阻塞 UI；稍后完成仍落缓存 */
const GEN_TIMEOUT_MS = 30_000;

/** 叙事上下文（全部为真实数据，由 TodayScreen 组装） */
export interface NarrCtx {
  /** 圆环当前档位：充沛/平稳/偏低/不足；null = 暂无状态 */
  level: string | null;
  /** 当前状态分 0-100（可空） */
  value: number | null;
  /** 经期/卵泡期/排卵期/黄体期/未记录 */
  phase: string;
  /** 皮质醇晨峰 '08:00' 或 '—' */
  cortisolPeak: string;
  /** 良好/偏晚/扁平/一般/'—' */
  cortisolRhythm: string;
  /** 昨晚睡眠分 0-100（可空） */
  sleepScore: number | null;
  /** 最近 1 小时压力事件数 */
  stressRecent1h: number;
  /** 最近 3 小时内完成的动作（如「呼吸冥想」「缓一缓」），无则 null */
  recentAction: string | null;
  /** ★ 2026-10-13：当前时段（决定叙事聚焦点，且进签名——跨时段即重生成，杜绝隔时段错配） */
  timePhase: DayPhase;
  /** ★ 2026-11-08：保留字段（仍由 TodayScreen 传入、进签名），但**不再喂给模型**——
   *   首页叙事只围绕「今日状态」讲，不再单独提「准备度」（用户：首页只有今日状态，没有准备度）。 */
  readinessNow: number | null;
  /** 同上：不再喂给模型（见上方说明）。 */
  readinessPeakHour: number | null;
}

/** 叙事签名：任一输入变化 → 重新生成。
 *  ★ 2026-10-13：把 `timePhase` 纳入签名——时段翻页即重算，
 *    早上生成的「睡眠恢复」不会在深夜被当成当下分析显示（用户反馈的「时间对不上」根因）。
 *  · readiness 相关数据**不进签名**（它随用脑分钟级波动，进签名会触发无意义重算/闪烁）。 */
export function narrSigOf(c: NarrCtx): string {
  const sleepB = c.sleepScore == null ? '' : c.sleepScore >= 60 ? 'sleepOk' : 'sleepLow';
  const stressB = c.stressRecent1h >= 3 ? 'hi' : c.stressRecent1h >= 1 ? 'some' : 'no';
  return [c.level ?? '', c.phase, c.cortisolRhythm, sleepB, stressB, c.timePhase, c.recentAction ?? ''].join('|');
}

// ── 缓存：内存 Map（sig → 文案） + 磁盘单条 ──
const cache = new Map<string, string>();
let diskLoaded = false;

async function loadDisk(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const info = await FileSystem.getInfoAsync(STORE_PATH);
    if (info.exists) {
      const j = JSON.parse(await FileSystem.readAsStringAsync(STORE_PATH)) as any;
      if (typeof j?.sig === 'string' && typeof j?.text === 'string') cache.set(j.sig, j.text);
    }
  } catch {
    /* 读失败当作没缓存 */
  }
}

async function saveDisk(sig: string, text: string): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(STORE_PATH, JSON.stringify({ sig, text }));
  } catch {
    /* 写失败不影响本次展示 */
  }
}

/** 当前签名是否已有 AI 叙事（TodayScreen 用它优先于模板） */
export function aiNarrativeFor(sig: string): string | null {
  return cache.get(sig) ?? null;
}

/** 最近 3 小时完成的动作（「呼吸冥想 · 做完」→ 取动作名）；模块内 await 加载后再取 */
async function recentActionLabel(): Promise<string | null> {
  await ensureInterventionLogLoaded();
  const nowMs = Date.now();
  const recent = allInterventionEntries().filter((e) => nowMs - e.ts <= 3 * 3600e3);
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  const NAMES: Record<InterventionKind, string> = {
    grounding: '缓一缓',
    reframe: '换个说法',
    activate: '动一动',
    gratitude: '睡前记两笔',
    compliment: '夸一个人',
    savoring: '品味小事',
    future: '给未来写信',
    outdoor: '到户外去',
    breath: '呼吸冥想',
    meditate: '冥想',
  };
  return NAMES[last.kind] ?? null;
}

// ── Prompt（为 Qwen2.5-1.5B 小模型写的：指令极短、示例锚定格式与声线） ──
const SYSTEM = [
  '你是 Mira，用户的 AI 健康闺蜜。说话像跟朋友复盘今天：平实、具体、有温度；不喊口号、不夸张、不下诊断、绝不编造数据。',
  '任务：为首页圆环下面写一句状态解读（就是 App 上圆环下那行分析）。只输出这一句话本身，不要引号、不要解释、不要 emoji、不要 markdown、不要分行：',
  '写法（学 Oura / ISHO 那种「人能看懂」的感觉）：',
  '1. 先讲一个具体事实——优先带真实数字或时刻（如「昨晚从 1:13 睡到 7:10」「睡眠 82 分」），再用一句人话解释它的意思；',
  '2. 就一句话，10 到 44 个字；可末尾带一个轻轻的反问（如「今天要是发沉，先别硬扛？」），引她多说两句；',
  '3. 只能用「给定信息」里出现过的数字，没给的数字一律不写；某项数据缺失就换一个有的讲，别硬提、别猜；',
  '4. 平实口语，像微信里发来的消息；不要「检测到 / 数据显示 / 建议您」这类机器腔，也不要堆夸张的褒义词；',
  '5. 状态好但相位不利 → 归因给身体底子稳，鼓励；状态差 → 先接住感受，再轻轻给个方向；',
  '6. 若只有一夜数据、还没多晚对照，老实补一句「先当今天参考就好」，别假装很准；',
  '7. 偶尔用一个轻比喻让画面感更强（如「作息像过山车」），但别硬凑。',
  '★ 时间感知（最重要）：以【当前时段】为唯一依据，绝不写与时段矛盾的内容——',
  '  晚上不要讲「早起/晨间/上午」的事，早晨不要讲「睡前/护肤/今晚」的事。',
  '  各时段该聚焦什么：',
  '  · 早晨：昨晚睡眠恢复得怎么样（带睡眠分/时长）+ 今天一整天的能量基调；',
  '  · 上午：今天状态正往上走，把费脑的事趁现在安排，别留到下午发沉；',
  '  · 临近中午：这顿饭的营养，结合周期阶段给一句饮食小提示；',
  '  · 午后：当前状态，若有压力或消耗偏大就说一下，以及雌激素/孕激素的变化；',
  '  · 傍晚：收工放松、轻量休息；',
  '  · 睡前：护肤休息、怎么睡好，睡好明天能量才稳。',
  '示例一（早晨，睡眠82分）→ 昨晚这一觉挺完整、拿到 82 分，今天能量在线，放心往前冲呀。',
  '示例二（上午）→ 现在脑子挺清楚，难啃的活趁上午搞定最划算。',
  '示例三（午后，状态偏低，黄体期）→ 黄体期下午容易发沉，刚才要是挺累，就先喘口气再继续？',
  '示例四（睡前）→ 这一天到这儿啦，收拾收拾早点躺平，明天才更有力气折腾呀。',
  '示例五（早晨，睡眠76，仅单夜）→ 昨晚是一觉连到底的完整睡眠，分数 76；就还缺一两晚对照，先当今天参考就好。',
].join('\n');

function buildUserPrompt(c: NarrCtx): string {
  const meta = DAY_PHASE_META[c.timePhase];
  return [
    `当前状态：${c.level ?? '暂无'}${c.value != null ? `（${Math.round(c.value)} 分）` : ''}`,
    `周期阶段：${c.phase || '未记录'}`,
    `皮质醇：晨峰 ${c.cortisolPeak}，节律 ${c.cortisolRhythm}`,
    `昨晚睡眠：${c.sleepScore != null ? `${Math.round(c.sleepScore)} 分` : '暂无数据'}`,
    `近 1 小时压力事件：${c.stressRecent1h} 次`,
    `刚做完的动作：${c.recentAction ?? '无'}`,
    `当前时段：${meta.label}（应聚焦：${meta.focus}）`,
    '只输出一句话：',
  ].join('\n');
}

/** ★ 2026-10-13：人话护栏 —— 小模型偶发生造词 / 命令腔 / 乱码，命中即丢弃、退回模板 */
const UNNATURAL: RegExp[] = [
  /美容肌|美肌|护肤肌/, // 生造美容词（用户实锤「多睡半小时美容肌」）
  /要睡觉|去睡觉|快去睡|赶紧睡|快睡|睡觉哦|去睡哦/, // 催睡命令腔
  /你该|你应该|必须|一定要|赶紧去/, // 说教命令
  /\uFFFD|[\uD800-\uDFFF]/, // 乱码 / 孤立代理对
];
function looksNatural(text: string): boolean {
  for (const re of UNNATURAL) if (re.test(text)) return false;
  return true;
}

/** 校验模型输出：8–44 字、单行、无 JSON/引号残留。不合法 → null（模板兜底在位） */
function parseNarrative(raw: string): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/```(?:json)?/g, '')
    .replace(/[{}"\[\]]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('');
  const text = s.trim().replace(/^["']+|["']+$/g, '');
  if (!text) return null;
  if (text.length < 8 || text.length > 52) return null;
  if (/[<>]/.test(text)) return null;
  // ★ 2026-11-08（用户参照 Oura 文案逻辑）：首页叙事全篇无括号、不出现「准备度 / 深睡占比」等词。
  //   模型偶发夹带括号或把别的页面口径（占比/准备度）带进首页 → 直接丢弃，退回确定性模板。
  if (/[（）()[\]【】]/.test(text)) return null;
  if (/准备度|占比|深睡/.test(text)) return null;
  if (!looksNatural(text)) return null; // 生造词/命令腔/乱码 → 丢弃，走模板
  return text;
}

/**
 * 请求当前签名的 AI 叙事（不阻塞 UI：模板先显示，AI 到货由调用方无声替换）。
 *  · 命中缓存 → 直接返回，不调模型；
 *  · 模型挂起/失败/超时/输出不合法 → 返回 null，模板继续。
 */
export async function requestAiNarrative(ctx: NarrCtx): Promise<string | null> {
  if (!ctx.level || ctx.value == null) return null; // 没状态不生成（诚实口径）
  const sig = narrSigOf(ctx);
  if (!sig || sig === '|||||') return null;

  await loadDisk();
  const hit = cache.get(sig);
  if (hit) return hit;

  const recentAction = await recentActionLabel();
  const full: NarrCtx = { ...ctx, recentAction };

  try {
    const res: any = await Promise.race([
      runOnModel(
        (mctx) =>
          mctx.completion(
            {
              messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: buildUserPrompt(full) },
              ],
              n_predict: 70,
              temperature: 0.6, // ★ 2026-10-13：0.85→0.6，小模型高温易乱造词（用户实锤「美容肌」）
              top_p: 0.9,
              stop: ['<|im_end|>', 'User:', '用户：'],
            },
            () => {},
          ) as Promise<any>,
        `ainarr@${sig}`,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEN_TIMEOUT_MS)),
    ]);
    if (!res) return null;

    const text = parseNarrative(String(res?.text ?? ''));
    if (!text) return null;

    cache.set(sig, text);
    saveDisk(sig, text);
    return text;
  } catch {
    return null; // 模型不可用 → 模板兜底已在位
  }
}
