/**
 * 洞察页「AI 综合分析」+ 周期 tab「AI 分析」的**真实端侧大模型生成**通道。
 *
 * 与 chat 的 ask() 的关键区别：
 *  1. **只读不写**：不写 MemoryStore / ChatContextStore，避免洞察文案污染聊天记忆与上下文。
 *  2. **强格式约束**：提示词里写死了「案例格式」（见 OVERVIEW_SYS / CYCLE_SYS），
 *     保证输出与现有「AI 分析」外壳（InsightBanner / AiAnalysis + AiResultRow）对得上。
 *  3. **真实数据**：上下文直接复用 `buildHealthSnapshot()`（今日实时 / 皮质醇节律 /
 *     激素推断 / 情绪脑力 / 周期相位 / 近 7 天趋势），不编造、不硬编码。
 *  4. **结果缓存**：按 (kind, 日期, 数据指纹) 落盘；同一指纹 30 分钟内不重复调用
 *     （1.5B 端侧推理慢，且这些是「分析」不是实时读数）。
 *  5. **优雅降级**：模型未打包 / 无数据 / 解析失败 → 返回 null，由 UI 回落到规则文案。
 */
import * as FileSystem from 'expo-file-system';
import { getLlamaContext } from './model';
import { buildHealthSnapshot } from './health';
import { dayKey } from '../data/healthStore';
import { RingBle } from '../ble/RingBleManager';

export type InsightKind = 'overview' | 'cycle' | 'recovery';
export type AiTone = 'good' | 'warn' | 'neutral';
export interface AiInsightRow {
  tone: AiTone;
  title: string;
  body: string;
}

const FILE = (FileSystem.documentDirectory ?? '') + 'mira_ai_insight.json';
const MIN_REGEN_MS = 30 * 60 * 1000; // 同一数据指纹 30 分钟内不重复生成

interface CacheEntry {
  sig: string;
  day: string;
  text: string;
  at: number;
}
type CacheMap = Partial<Record<InsightKind, CacheEntry>>;

let memCache: CacheMap = {};
let cacheLoaded = false;
const inFlight: Partial<Record<InsightKind, Promise<string | null>>> = {};

// ── 缓存读写 ────────────────────────────────────────────────────────────────
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(FILE);
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') memCache = j as CacheMap;
    }
  } catch {
    /* 读失败当作空缓存 */
  }
  cacheLoaded = true;
}
async function saveCache(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(memCache));
  } catch {
    /* 写失败不影响使用（下次重算） */
  }
}

// 模块加载即预热缓存，让首帧就能命中（避免显示规则文案后又闪成 AI 文案）
void loadCache();

/** 同步读取今天已生成的文案（未生成/不是今天 → null），供首帧直接渲染。 */
export function peekInsight(kind: InsightKind): string | null {
  const c = memCache[kind];
  if (!c) return null;
  return c.day === dayKey(Date.now()) ? c.text : null;
}

// ── 真实数据 + 指纹 ────────────────────────────────────────────────────────
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** 取真实健康数据摘要（无任何数据时返回空串 → 调用方回落到规则文案） */
function buildFacts(): { facts: string; sig: string } {
  let facts = '';
  try {
    facts = buildHealthSnapshot() || '';
  } catch {
    facts = '';
  }
  return { facts, sig: simpleHash(facts) };
}

// ── 提示词（= 「案例格式」要求） ────────────────────────────────────────────
const OVERVIEW_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据给出的【用户健康数据】做解读，绝不编造数据，也不假设数据里没有的事。
输出要求（严格遵守）：
1. 只输出一段话，60–110 个汉字；不要换行、不要分点、不要 Markdown、不要 emoji、不要引号包裹。
2. 结构固定为三句：① 第 1 句说出最关键的数据事实（必须引用数据里的真实数值）→ ② 第 2 句解释它在生理/状态上意味着什么 → ③ 第 3 句给一条今天或这两天可执行的具体建议。
3. 用第二人称「你」，语气温和、口语化，像懂她的朋友在说话。
4. 若数据不足以支撑某项结论，就明确说"还缺哪项数据、继续佩戴多久可以生成"，不要硬编。
5. 不做医学诊断，不给药物剂量建议。`;

const CYCLE_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据给出的【用户健康数据】做解读，绝不编造数据。
输出要求（严格遵守）：
1. 输出 2–3 行文本，每行一条结论，行格式严格为：tone|标题|正文
2. tone 只能是 good、warn、neutral 三者之一（表示积极 / 需注意 / 中性）。
3. 标题不超过 10 个汉字；正文 30–60 个汉字，用第二人称「你」，口语化。
4. 内容要围绕【当前生理周期阶段】展开：阶段生理特征 → 与你实测数据（HRV/体温/睡眠/情绪等）的关系 → 注意事项。至少一行的正文里要引用数据里的真实数值。
5. 不要输出示例、不要输出解释、不要 Markdown、不要 emoji、不要编号前缀。
示例（仅示意格式）：
good|精力正在回升|你的 HRV 这几天在往上走，雌激素也在爬升，体力和情绪都会更好，适合安排重要的事。`;

const RECOVERY_SYS = `你是 Mira，一位温和、专业的女性健康伴侣。你只根据给出的【用户健康数据】做解读，绝不编造数据。
输出要求（严格遵守）：
1. 输出 3–4 行文本，每行一条结论，行格式严格为：tone|标题|正文
2. tone 只能是 good、warn、neutral 三者之一（表示积极 / 需注意 / 中性）。
3. 标题不超过 6 个汉字；正文 25–50 个汉字，用第二人称「你」，口语化。
4. 内容按维度展开：皮质醇节律（曲线形态/峰值时刻/是否偏高紊乱）→ 情绪消耗与压力事件 → 脑力负荷与恢复 → 睡眠恢复。至少两行正文要引用数据里的真实数值；数据里没有的维度直接跳过，不要硬编。
5. 不要输出示例、不要输出解释、不要 Markdown、不要 emoji、不要编号前缀。
示例（仅示意格式）：
warn|皮质醇节律|今天节律形态紊乱，峰值 13:00 偏晚，下午容易疲惫，建议上午多接触自然光。`;

// ── 推理 ───────────────────────────────────────────────────────────────────
async function runCompletion(
  messages: { role: string; content: string }[],
  nPredict: number,
  temperature: number
): Promise<string> {
  const ctx = await getLlamaContext();
  let full = '';
  const res: any = await ctx.completion(
    {
      messages,
      n_predict: nPredict,
      temperature,
      top_p: 0.9,
      stop: ['<|im_end|>', '用户：', 'User:', '\n\n'],
    },
    (data: any) => {
      const tok = (data && data.token) || '';
      if (tok) full += tok;
    }
  );
  return String((res && res.text) || full || '').trim();
}

/** 清洗：去掉被模型带出来的 Markdown/引号/多余空行 */
function cleanText(kind: InsightKind, raw: string): string {
  let s = (raw || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*["'“”‘’]\s*|\s*["'“”‘’]\s*$/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  if (kind === 'overview') {
    // 概述必须是一段话
    s = s.replace(/\s*\n+\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  } else {
    s = s
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join('\n');
  }
  return s;
}

// ── 对外：生成（带缓存 + 去重 + 降级） ──────────────────────────────────────
export async function getAiInsight(kind: InsightKind): Promise<string | null> {
  await loadCache();
  const { facts, sig } = buildFacts();
  if (!facts) return null; // 无任何真实数据 → 交给规则文案

  const today = dayKey(Date.now());
  const c = memCache[kind];
  if (c && c.day === today && (c.sig === sig || Date.now() - c.at < MIN_REGEN_MS)) {
    return c.text;
  }
  const running = inFlight[kind];
  if (running) return running;

  const task = (async (): Promise<string | null> => {
    try {
      const text =
        kind === 'overview'
          ? await runCompletion(
              [
                { role: 'system', content: OVERVIEW_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: '请按格式要求，输出今天的综合分析。' },
              ],
              190,
              0.55
            )
          : kind === 'recovery'
          ? await runCompletion(
              [
                { role: 'system', content: RECOVERY_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: '请按格式输出今天的身体恢复分析（3–4 行）。' },
              ],
              300,
              0.6
            )
          : await runCompletion(
              [
                { role: 'system', content: CYCLE_SYS },
                { role: 'system', content: facts },
                { role: 'user', content: '请按格式输出当前周期阶段的分析（2–3 行）。' },
              ],
              230,
              0.6
            );

      const clean = cleanText(kind, text);
      if (!clean) return null;

      memCache[kind] = { sig, day: today, text: clean, at: Date.now() };
      void saveCache();
      return clean;
    } catch (e) {
      // 模型未打包 / 设备不支持 / 推理异常 → 静默回落规则文案
      console.warn('[AI-Insight] 生成失败（回落到规则文案）:', e);
      return null;
    } finally {
      delete inFlight[kind];
    }
  })();

  inFlight[kind] = task;
  return task;
}

/** 把周期 tab 的多行结果解析成 AiResultRow 需要的结构（解析失败 → null，回落规则行） */
export function parseInsightRows(text: string | null): AiInsightRow[] | null {
  if (!text) return null;
  const out: AiInsightRow[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim().replace(/^[-•*\d.\s]+/, '');
    if (!line) continue;
    const parts = line.split(/\s*[|｜]\s*/);
    if (parts.length < 3) continue;
    const t = parts[0].toLowerCase();
    const tone: AiTone = t.includes('good') ? 'good' : t.includes('warn') ? 'warn' : 'neutral';
    const title = parts[1].trim().slice(0, 14);
    const body = parts.slice(2).join(' ').trim();
    if (title && body) out.push({ tone, title, body });
  }
  return out.length ? out.slice(0, 4) : null;
}

/** 无 AI 时的真实数据兜底文案（替代原来硬编码的假数据「58ms」） */
export function buildOverviewFallback(): string {
  const EMPTY = '开始佩戴戒指后，这里会结合你的 HRV、睡眠、体温与周期相位，生成属于你的综合分析。';
  try {
    const st: any = RingBle.getState();
    const d: any = (st && st.daily) || {};
    const num = (v: any): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;

    const hrv = num(d.hrv);
    const sleepMin = num(d.sleepTotal);
    const sleepScore = num(d.sleepScore);
    const temp = num(d.temp);

    const bits: string[] = [];
    if (hrv != null) bits.push(`HRV ${Math.round(hrv)}ms`);
    if (sleepMin != null && sleepMin > 0) bits.push(`睡眠 ${(sleepMin / 60).toFixed(1)} 小时`);
    if (temp != null) bits.push(`体温 ${temp.toFixed(1)}℃`);
    if (sleepScore != null) bits.push(`睡眠评分 ${Math.round(sleepScore)}`);
    if (bits.length === 0) return EMPTY;

    const head = `今天你的实测数据：${bits.join('、')}。`;
    const tail =
      sleepScore != null && sleepScore < 70
        ? '睡眠恢复偏慢，建议今晚提前 20 分钟入睡、睡前减少屏幕时间。'
        : hrv != null && hrv > 0
        ? '整体状态平稳，可以按计划推进；继续保持规律作息，分析会越来越贴合你。'
        : '继续全天佩戴，HRV 与睡眠基线稳定后，这里会给出更贴合你的建议。';
    return head + tail;
  } catch {
    return EMPTY;
  }
}
