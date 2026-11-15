/**
 * aiSuggestion —— 首页建议卡的「AI 生成 + 引擎兜底」混合层（2026-10-08 十五改）
 *
 * 用户定稿的方案（★ 十六改反转）：**先等 AI（最多 60s），AI 没有才上引擎卡**；
 * 且**已显示的卡绝不被自动换掉**（同签名下 AI 迟到只进缓存，不顶屏）——
 * 用户：「引擎给 A、AI 连上又突然换 B，不可以；31 分给出来问题不大，太长不行。」
 * 让「圆环状态 → 原因分析 → 建议」三段出自同一个脑子（Mira），声线天然统一，且卡片永不空。
 *
 * 工作方式：
 *  · 本模块按「状态签名」（level|phase，与引擎十三改的换卡判据同口径）生成 AI 建议：
 *      - 命中缓存（内存 / 磁盘单条，重启后同签名秒出）→ 不调模型，直接复用；
 *      - 未命中 → 走 runOnModel 串行队列（自带去重 key，与聊天/洞察分析共用一条链，不会撞 busy），
 *        整体 60s 超时；超时后模型若稍后完成，结果仍落缓存、下个签名周期可用；
 *  · 引擎候选（suggestionEngine.pickSuggestion）只在 AI 失败/超时后由气泡上卡兜底；
 *  · 上卡与换卡时序由 HomeAiBubble 把关（candRef/shownSigRef），本模块只负责「生成 + 缓存」。
 *
 * 诚实口径（硬约束，写进 prompt + 代码双重把关）：
 *  · metric 只能**原样引用** suggestionEngine.evidenceBits() 的真实短语（代码里白名单校验，
 *    模型想编数字也过不去）；
 *  · cta 只能从四个深链 key（Breathing / BreathingSleep / LearnRead / FoodScan）里挑，不能发明页面；
 *    具体跳到哪个练习/哪篇文章由代码按状态与相位决定（十八改：深链直达具体内容，不落聚合页）；
 *  · level 为空（没采到状态）→ 不生成 —— 不让模型凭空谈状态。
 */
import * as FileSystem from 'expo-file-system';
import { runOnModel } from '../ai/model';
import { evidenceBits, pickReadTarget, type SuggestionCandidate } from './suggestionEngine';
import { dayPhase, DAY_PHASE_META, type DayPhase } from './timePhase';
import { showCycleContent, containsCycleCopy } from '../data/cycleScope';

const STORE_PATH = (FileSystem.documentDirectory ?? '') + 'mira_ai_suggestion.json';
/** 整体超时（★ 十六改 45s → 60s，用户：「31 分给出来问题不大，但时间太长就不行」——
 *  即状态更新后最多等 1 分钟，等不到就上引擎卡；超时后模型若稍后完成，结果进缓存、下次可用） */
const GEN_TIMEOUT_MS = 60_000;

/** 状态签名（与 suggestionEngine 同口径，包含时段边界——跨时段即重新评估建议） */
export function sigOf(cs?: any): string {
  const level = typeof cs?.level === 'string' ? cs.level : '';
  const phase = typeof cs?.phaseLabel === 'string' ? cs.phaseLabel : '';
  return `${level}|${phase}|${dayPhase()}`;
}

// ── 缓存：内存 Map（sig → 候选） + 磁盘单条（最近一次生成），重启同签名秒出 AI 卡 ──
const cache = new Map<string, SuggestionCandidate>();
let diskLoaded = false;

async function loadDisk(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const info = await FileSystem.getInfoAsync(STORE_PATH);
    if (info.exists) {
      const j = JSON.parse(await FileSystem.readAsStringAsync(STORE_PATH)) as any;
      if (j?.sig && j?.cand?.headline) cache.set(j.sig, j.cand);
    }
  } catch {
    /* 读失败当作没缓存 */
  }
}

async function saveDisk(sig: string, cand: SuggestionCandidate): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(STORE_PATH, JSON.stringify({ sig, cand }));
  } catch {
    /* 写失败不影响本次展示 */
  }
}

/** 当前签名是否已有 AI 候选（气泡用它优先于引擎卡） */
export function aiCandidateFor(cs?: any): SuggestionCandidate | null {
  const sig = sigOf(cs);
  if (!sig || sig === '|') return null;
  return cache.get(sig) ?? null;
}

// ── CTA 白名单：AI 只能挑一个 key，label/params 由这里统一给（与引擎行动型完全一致）──
// ★ 十八改：全部深链到**具体内容**（指定节奏的呼吸练习 / 指定文章），不落聚合页；
//   LearnRead 的具体文章在 requestAiSuggestion 里按周期相位用 pickReadTarget 代码级补齐
//   （模型只选「要不要跳」，不选「跳到哪」——杜绝编造不存在的文章/练习）。
const CTA_WHITELIST: Record<string, { label: string; screen: string; params?: Record<string, any> }> = {
  Breathing: { label: '去呼吸 ›', screen: 'Breathing', params: { breath: 'calm' } },
  BreathingSleep: { label: '去呼吸 ›', screen: 'Breathing', params: { breath: 'sleep' } },
  LearnRead: { label: '去读 ›', screen: 'LearnRead' }, // params 由 pickReadTarget 按相位填充
  FoodScan: { label: '去记录 ›', screen: 'FoodScan' },
};

/** 稳定内容指纹（djb2）：headline 变了 id 就变 → 冷却/留存按内容生效 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** ★ 2026-10-13：人话护栏 —— 小模型偶发生造词 / 命令腔 / 乱码，命中即丢弃、退回引擎自然卡。
 *  用户实锤：「今晚要睡觉哦，多睡半小时美容肌」不是人话。 */
const UNNATURAL: RegExp[] = [
  /美容肌|美肌|护肤肌/, // 生造美容词
  /要睡觉|去睡觉|快去睡|赶紧睡|快睡|睡觉哦|去睡哦/, // 催睡命令腔
  /你该|你应该|必须|一定要|赶紧去/, // 说教命令
  /\uFFFD|[\uD800-\uDFFF]/, // 乱码 / 孤立代理对
];
function looksNatural(text: string): boolean {
  for (const re of UNNATURAL) if (re.test(text)) return false;
  return true;
}

/**
 * 解析模型输出 → 校验成合法候选。任何一步不合法都返回 null（引擎兜底已在位，不强求）。
 * 宽松取第一段 {...}：小模型偶发 markdown 代码块包裹 / 前后废话，都能兜住。
 */
function parseAiJson(raw: string, allowedBits: string[]): SuggestionCandidate | null {
  if (!raw) return null;
  const s = raw.replace(/```(?:json)?/g, '').replace(/```/g, '');
  const m = s.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  let o: any;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const headline = typeof o.headline === 'string' ? o.headline.trim().replace(/^["'「]|["'」]$/g, '') : '';
  // 长度纪律（★ 十七改澄清）：4–8 字限制属**圆环中央状态词**；建议卡 headline 仍是 AI 语气完整句（4–24 字）
  if (headline.length < 4 || headline.length > 24) return null;
  // ★ 2026-10-13：人话护栏 —— 生造词/命令腔/乱码直接丢弃，退回引擎自然卡
  if (!looksNatural(headline)) return null;

  // 诚实口径：metric 只能原样取自真实证据短语，否则一律丢弃
  const metricRaw = typeof o.metric === 'string' ? o.metric.trim() : '';
  const metric = allowedBits.includes(metricRaw) ? metricRaw : '';

  // CTA 白名单：不在四个深链 key 里 → 视为无跳转（观察反馈型）。
  // ★ 十八改：**必须克隆** —— requestAiSuggestion 会按相位给 LearnRead 补 params，
  //   直接引用会污染共享白名单（第二张卡的 params 会继承第一张的文章）。
  const ctaKey = typeof o.cta === 'string' ? o.cta.trim() : '';
  const wl = CTA_WHITELIST[ctaKey] ?? null;
  const cta = wl ? { label: wl.label, screen: wl.screen, ...(wl.params ? { params: { ...wl.params } } : {}) } : null;

  return {
    id: `ai-${djb2(headline)}`,
    saveId: `ai-${djb2(headline)}`,
    headline,
    ...(metric ? { metric } : {}),
    kind: cta ? 'action' : 'reflection',
    ...(cta ? { cta } : {}),
    noPersist: true,
  };
}

// ── Prompt（为 Qwen2.5-1.5B 小模型写的：指令极短、示例锚定格式与声线） ──
const SYSTEM = [
  '你是 Mira，用户的 AI 健康闺蜜：说话短、活泼、带语气词（呀/哦/哎/啦），先接住感受再给建议；不是医生，不下诊断，绝不编造数据。',
  '任务：为首页建议卡写一条建议。只输出一行 JSON，不要解释、不要 markdown：',
  '{"headline":"建议正文","metric":"证据或空","cta":"跳转或空"}',
  '规则：',
  '1. headline 不超过 20 个字，像闺蜜随手发来的一句话；',
  '2. metric 只能原样抄「可选证据」里的一条，没有就填空字符串；',
  '3. cta 只能填 Breathing / BreathingSleep / LearnRead / FoodScan 之一，不需要跳转就填空字符串；',
  '4. 不说教、不下命令；除「可选证据」外不出现任何数字。',
  '5. 像真人闺蜜发微信：口语、有温度、不端着；严禁生造词（不要写「美容肌」这类词，用「皮肤/气色」等日常说法）。',
  '6. 严禁命令式说教：不要写「你要X哦」「今晚要睡觉哦」这种居高临下的话，用「一起/可以/要不要」的陪伴口吻。',
  '7. 睡前只讲放松/轻读/明天会更好，不要催人「去睡觉」（对方可能已躺下）；不要写「美容/护肤」推销感的话。',
  '★ 时间感知（最重要）：与【当前时段】呼应，绝不写与时段矛盾的内容——',
  '  晚上不讲「早起/上午」的事，早晨不讲「睡前/护肤」的事。各时段建议倾向：',
  '  · 早晨 → 睡眠恢复/今日能量（可 LearnRead 科普）；',
  '  · 上午 → 脑力在线，把难活趁高峰做（可 LearnRead）；',
  '  · 临近中午 → 引导记这一餐（cta: FoodScan）；',
  '  · 午后 → 状态/压力/激素变化，累了就呼吸（cta: Breathing）；',
  '  · 傍晚 → 收工放松、轻量休息；',
  '  · 睡前 → 读篇科普或睡前呼吸（cta: LearnRead / BreathingSleep）。',
  '示例一：状态=不足，相位=黄体期，时段=睡前 → {"headline":"今天累啦，做个睡前呼吸放空吧","metric":"","cta":"BreathingSleep"}',
  '示例二：状态=偏低，相位=黄体期，时段=午后 → {"headline":"午后有点沉，3 分钟呼吸缓一缓呀","metric":"","cta":"Breathing"}',
  '示例三：状态=平稳，相位=卵泡期，时段=临近中午 → {"headline":"快吃饭啦，拍张照记一下这餐呗","metric":"","cta":"FoodScan"}',
].join('\n');

function buildUserPrompt(level: string, phase: string, bits: string[], avoidHeadline?: string): string {
  const tp = dayPhase();
  const meta = DAY_PHASE_META[tp];
  return [
    `今日状态：${level}`,
    `周期相位：${phase || '未记录'}`,
    `当前时段：${meta.label}（建议倾向：${meta.focus}）`,
    `可选证据：${bits.length ? bits.join('；') : '无'}`,
    avoidHeadline ? `刚给过这条建议（换一个角度）：${avoidHeadline}` : '',
    '只输出一行 JSON：',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 请求当前签名的 AI 建议（气泡在引擎卡出完后调用；不阻塞 UI）。
 *  · 命中缓存 → 直接返回，不调模型；
 *  · force（用户点了「不感兴趣」）→ 无视缓存重新生成，avoidId/avoidHeadline 用于避开刚被否那条；
 *  · 模型挂起（相机场景）/ 失败 / 超时 / 输出不合法 → 返回 null，引擎卡继续在位。
 */
export async function requestAiSuggestion(
  cs?: any,
  opts?: { force?: boolean; avoidId?: string; avoidHeadline?: string },
): Promise<SuggestionCandidate | null> {
  const level: string | null = typeof cs?.level === 'string' && cs.level ? cs.level : null;
  if (!level) return null; // 没状态不生成（诚实口径）

  await loadDisk();
  const sig = sigOf(cs);
  if (!sig || sig === '|') return null;
  if (!opts?.force) {
    const hit = cache.get(sig);
    if (hit) return hit;
  }

  const bits = evidenceBits();
  const phase = typeof cs?.phaseLabel === 'string' ? cs.phaseLabel : '';
  const key = `aisugg@${sig}`; // runOnModel 内置去重：同签名并发请求复用同一次推理
  // ★ 2026-11-14（用户）：小模型会照抄 prompt 示例里的「黄体期 / 激素变化 / 闺蜜」，
  //   男性用户在模板层先脱敏，输出层再兜一道，避免建议胶囊冒出周期话术。
  const cycleOn = showCycleContent();
  const sys = cycleOn ? SYSTEM : SYSTEM
    .replace(/状态\/压力\/激素变化/g, '状态与压力变化')
    .replace(/相位=黄体期/g, '状态=平稳')
    .replace(/相位=卵泡期/g, '状态=平稳')
    .replace(/AI 健康闺蜜/g, 'AI 健康伙伴')
    + '\n【重要】当前用户为男性。不要提及经期、月经、排卵、黄体期、卵泡期、雌激素、孕激素、孕酮、生理周期，也不要用「闺蜜」称呼；只依据给出的事实写一句日常建议。';
  const user = cycleOn
    ? buildUserPrompt(level, phase, bits, opts?.avoidHeadline)
    : buildUserPrompt(level, '未记录', bits, opts?.avoidHeadline)
        .replace('周期相位：未记录', '当前状态：按今天的实测数据');

  try {
    const res: any = await Promise.race([
      runOnModel(
        (ctx) =>
          ctx.completion(
            {
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user },
              ],
              n_predict: 80,
              temperature: 0.55, // ★ 2026-10-13：0.9→0.55，小模型高温易乱造词/说教腔（用户实锤「美容肌」）
              top_p: 0.9,
              stop: ['<|im_end|>', 'User:', '用户：'],
            },
            () => {}, // 不需要流式：小 JSON 一次取全文
          ) as Promise<any>,
        key,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEN_TIMEOUT_MS)),
    ]);
    if (!res) return null; // 超时（后台推理若稍后完成，结果仍会落缓存）

    const cand = parseAiJson(String(res?.text ?? ''), bits);
    if (!cand) return null;
    // 男性：模型照抄了周期词就丢弃这条，回落到规则建议（绝不展示给用户）。
    if (!cycleOn && containsCycleCopy(String(cand.headline ?? ''))) return null;
    if (opts?.avoidId && cand.id === opts.avoidId) return null; // 刚被否的那条别再给

    // ★ 十八改：LearnRead 深链的具体文章由代码按周期相位挑（模型只决定「跳不跳」），
    //   保证 headline/CTA 指向一篇真实存在的文章，不落聚合页。
    if (cand.cta?.screen === 'LearnRead') {
      const r = pickReadTarget(phase);
      cand.cta.params = { articleId: r.articleId, collection: 'learn' };
    }

    cache.set(sig, cand);
    saveDisk(sig, cand); // 不 await：写失败无碍
    return cand;
  } catch {
    return null; // 模型不可用 → 引擎兜底已在位
  }
}
