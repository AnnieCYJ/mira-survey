/**
 * quickCheckAi —— 微体检报告「每条指标解读」的 AI 生成层
 * ---------------------------------------------------------------------------
 * 复用端侧本地 Qwen2.5-1.5B（llama.rn，经由 ai/model.ts 的 runOnModel 串行队列）。
 * 与 aiNarrative 同一套安全架构：
 *   · 手写解读（quickCheckStore 里基于阈值的「意义·分析·建议」）先显示；
 *   · 本模块在详情页打开时按指标向本地模型请求一段更口语的解读，到货后静默替换；
 *   · 模型不可用 / 超时 / 输出不合法 → 返回 null，调用方保留手写解读，绝不空白或崩。
 *
 * 诚实口径（品牌铁律）：
 *   · 模型只能基于传入的真实数值与参考区间写解读，prompt 明令「没给的数字不写」；
 *   · 只描述、不诊断、不评分；命中诊断/说教/机器腔即丢弃，回落手写解读。
 */
import { runOnModel } from './model';
import * as FileSystem from 'expo-file-system';

const STORE_PATH = (FileSystem.documentDirectory ?? '') + 'mira_qc_ai_notes.json';
/** 整体超时：手写解读已在位，AI 迟到也不阻塞 UI；稍后完成仍落缓存 */
const GEN_TIMEOUT_MS = 25_000;

export interface MetricInterpretInput {
  name: string;
  value: string;
  unit?: string;
  ref?: string;
  status: 'ok' | 'high' | 'low' | 'risk';
  groupTitle?: string;
  phase?: string;
}

const STATUS_CN: Record<string, string> = { ok: '正常', high: '偏高', low: '偏低', risk: '风险' };

// ── Prompt（为 Qwen2.5-1.5B 小模型写的：指令极短、示例锚定格式与声线） ──
const SYSTEM = [
  '你是 Mira，用户的 AI 健康闺蜜。说话像朋友在解读体检数据：平实、具体、有温度；不喊口号、不夸张、不下诊断、不评分、绝不编造数据。',
  '任务：给用户体检报告里的某一项指标写一段「数据解读」（就是报告里那条数据下面那段话）。只写这段解读本身，不要标题、不要引号、不要 emoji、不要 markdown、不要分行。',
  '写法：',
  '1. 先点明这个数值意味着什么（正常 / 偏高 / 偏低 / 风险，结合参考区间说人话），再给一句可落地的日常建议；',
  '2. 像微信里发来的消息，口语自然；不要「检测到 / 数据显示 / 建议您 / 根据您的」这类机器腔；',
  '3. 只能用【给定信息】里出现过的数字和区间，没给的绝不写；某项缺数据就换一个有的讲；',
  '4. 只描述、不诊断、不评分；不出现「疾病 / 患病 / 异常危险」等吓人措辞，偏高或偏低也只说「值得留意 / 可关注趋势」；',
  '5. 控制在 18–48 字，一两句话。',
  '示例（BMI 22.6，参考 18.5–24 正常）→ BMI 22.6 落在正常区间，体型匀称，保持现在的饮食和运动节奏就挺好。',
  '示例（步数 25 步）→ 今天只走了 25 步，活动量明显太少，有空起来走动走动、接个水都算动一动。',
  '示例（HRV 38 毫秒，偏低）→ HRV 38 毫秒偏低，身体可能还在恢复，常跟熬夜或压力有关，先看几天趋势比单次更有意义。',
].join('\n');

function buildUserPrompt(i: MetricInterpretInput): string {
  return [
    `指标：${i.name}`,
    `测量值：${i.value}${i.unit ?? ''}`,
    `参考区间：${i.ref ?? '无'}`,
    `当前判定：${STATUS_CN[i.status] ?? i.status}`,
    i.phase ? `周期阶段：${i.phase}` : '',
    i.groupTitle ? `所属分组：${i.groupTitle}` : '',
    '只输出这段解读：',
  ]
    .filter(Boolean)
    .join('\n');
}

function sigOf(i: MetricInterpretInput): string {
  return [i.name, i.value, i.unit ?? '', i.ref ?? '', i.status, i.phase ?? '', i.groupTitle ?? ''].join('|');
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
      const obj = JSON.parse(await FileSystem.readAsStringAsync(STORE_PATH)) as Record<string, string>;
      if (obj && typeof obj === 'object') {
        for (const k of Object.keys(obj)) cache.set(k, obj[k]);
      }
    }
  } catch {
    /* 读失败当作没缓存 */
  }
}

async function saveDisk(): Promise<void> {
  try {
    const obj: Record<string, string> = {};
    cache.forEach((v, k) => {
      obj[k] = v;
    });
    await FileSystem.writeAsStringAsync(STORE_PATH, JSON.stringify(obj));
  } catch {
    /* 写失败不影响本次展示 */
  }
}

/** 人话护栏：小模型偶发生造诊断词 / 机器腔 / 乱码，命中即丢弃、退回手写解读 */
const UNNATURAL: RegExp[] = [
  /检测到|数据显示|建议您|根据您的|系统检测|据您/,
  /疾病|患病|异常危险|确诊|立刻就医|必须就医/,
  /必须|一定要|赶紧去|快去/,
  /\uFFFD|[\uD800-\uDFFF]/,
];
function looksNatural(t: string): boolean {
  for (const re of UNNATURAL) if (re.test(t)) return false;
  return true;
}

function parse(raw: string): string | null {
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
  if (text.length < 14 || text.length > 60) return null; // 太短/太长都丢（防截断或啰嗦）
  if (/[<>]/.test(text)) return null;
  if (!looksNatural(text)) return null; // 诊断/机器腔/乱码 → 丢弃，走手写解读
  return text;
}

/**
 * 请求某指标的 AI 解读（不阻塞 UI：手写解读先显示，AI 到货由调用方无声替换）。
 *  · 命中缓存 → 直接返回，不调模型；
 *  · 模型挂起/失败/超时/输出不合法 → 返回 null，手写解读继续。
 */
export async function requestMetricInterpretation(i: MetricInterpretInput): Promise<string | null> {
  const sig = sigOf(i);
  if (!sig || sig === '||||||') return null;
  await loadDisk();
  const hit = cache.get(sig);
  if (hit) return hit;
  try {
    const res: any = await Promise.race([
      runOnModel(
        (mctx) =>
          mctx.completion(
            {
              messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user', content: buildUserPrompt(i) },
              ],
              n_predict: 96,
              temperature: 0.6,
              top_p: 0.9,
              stop: ['<|im_end|>', 'User:', '用户：'],
            },
            () => {},
          ) as Promise<any>,
        `qcai@${sig}`,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEN_TIMEOUT_MS)),
    ]);
    if (!res) return null;
    const text = parse(String(res?.text ?? ''));
    if (!text) return null;
    cache.set(sig, text);
    saveDisk();
    return text;
  } catch {
    return null; // 模型不可用 → 手写解读兜底已在位
  }
}

/** 同步取缓存（用于先显示，无则回退手写解读） */
export function cachedMetricInterpretation(i: MetricInterpretInput): string | null {
  return cache.get(sigOf(i)) ?? null;
}
