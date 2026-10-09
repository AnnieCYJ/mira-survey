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
}

/** 叙事签名：任一输入变化 → 重新生成 */
export function narrSigOf(c: NarrCtx): string {
  const sleepB = c.sleepScore == null ? '' : c.sleepScore >= 60 ? 'sleepOk' : 'sleepLow';
  const stressB = c.stressRecent1h >= 3 ? 'hi' : c.stressRecent1h >= 1 ? 'some' : 'no';
  return [c.level ?? '', c.phase, c.cortisolRhythm, sleepB, stressB, c.recentAction ?? ''].join('|');
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
  '你是 Mira，用户的 AI 健康闺蜜：说话短、温暖、鼓励人；不是医生，不下诊断，绝不编造数据。',
  '任务：为首页圆环下面写一句状态解读。只输出这一句话本身，不要引号、不要解释、不要 emoji、不要 markdown：',
  '规则：',
  '1. 一句话，10 到 38 个字；',
  '2. 必须用上「给定信息」里至少一个具体事实（周期阶段/激素/皮质醇/睡眠/当前状态/刚做完的动作）；',
  '3. 只能用给定信息里出现过的数字，没给的数字一律不写；',
  '4. 状态好但相位不利 → 归因给身体底子稳，鼓励；状态差 → 先接住感受，再轻轻给个方向；',
  '5. 说人话，像闺蜜发来的消息，不要「检测到」「数据显示」这类机器词。',
  '示例一：状态=良好，相位=经期 → 经期激素虽然在低点，但你底子稳，状态照样在线呀。',
  '示例二：状态=偏低，相位=黄体期，睡眠=52分 → 黄体期激素压着能量，昨晚又没睡够，对自己温柔点。',
  '示例三：状态=平稳，相位=卵泡期，刚做完=呼吸冥想 → 刚做完呼吸冥想，状态稳稳的，继续保持这个节奏哦。',
].join('\n');

function buildUserPrompt(c: NarrCtx): string {
  return [
    `当前状态：${c.level ?? '暂无'}${c.value != null ? `（${Math.round(c.value)} 分）` : ''}`,
    `周期阶段：${c.phase || '未记录'}`,
    `皮质醇：晨峰 ${c.cortisolPeak}，节律 ${c.cortisolRhythm}`,
    `昨晚睡眠：${c.sleepScore != null ? `${Math.round(c.sleepScore)} 分` : '暂无数据'}`,
    `近 1 小时压力事件：${c.stressRecent1h} 次`,
    `刚做完的动作：${c.recentAction ?? '无'}`,
    '只输出一句话：',
  ].join('\n');
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
  if (text.length < 8 || text.length > 44) return null;
  if (/[<>]/.test(text)) return null;
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
              temperature: 0.85,
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
