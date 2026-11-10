/**
 * homePolish —— 首页叙事的「AI 只润色」通道（2026-11-11）
 *
 * 用户口径：「规则加 AI，AI 这里面只是写一个润色的就行」。
 * 因此本模块**不生成任何事实、归因或建议** —— 事实全部由 `lib/homeNarrative.ts` 的规则引擎定好，
 * 这里只把那句规则中文换个更像朋友说话的说法。旧链路 `useAiInsight('overview')` 按天缓存、
 * 会把早上生成的睡眠叙事挂到深夜、还会吐提示词原文，首页已不再直接使用它。
 *
 * 三层保险：
 *  ① UI 首帧显示**规则句**（永不空、永不晚到）；润色到货才无声替换；
 *  ② `isSafePolish()` 同事实闸门：新增数字 / 具体事实 / 时段词 / 睡眠词 / 方向反转 / 机器腔
 *     一律判废，且最多比原句长 6 字；
 *  ③ 模型挂起 / 未打包 / 超时（12s） / 输出不合法 → 静默回落规则句，不抛错、不闪烁。
 *
 * 节拍：按 `narrative.signature` 缓存与去重。签名含半小时状态点、方向、时段、归因、事件 ——
 * 状态点一更新就重新润色；签名没变绝不重复推理（不占端侧模型队列）。
 */
import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import { runOnModel } from './model';
import { isSafePolish, type Direction, type ReasonKey } from '../lib/homeNarrative';
import type { DayPhase } from '../lib/timePhase';

const STORE_PATH = (FileSystem.documentDirectory ?? '') + 'mira_home_polish.json';
const GEN_TIMEOUT_MS = 12_000;
const START_DELAY_MS = 1_200;

/**
 * ★ 2026-11-11 真机验证后默认关闭润色通道：
 *   P30 上 1.5B 把规则句「晚上这会儿比先前低了一点，一天攒的紧还没散，慢慢收个尾。」
 *   润色成「…攒的紧一天还没散…」。事实、时段、方向、字数全部通过 isSafePolish 闸门，
 *   但**语序被改坏、成了病句** —— 反而违背用户「要讲人话」的核心诉求。
 *   用户已授权「AI 很难控制的话就用规则」；规则句本身是逐条人工写的人话、质量稳定，
 *   故首帧与后续一律显示规则句。润色通道、缓存、同事实闸门代码全部保留，
 *   把此常量改 true 即可重新启用（例如日后换成更大的端侧模型）。
 */
const POLISH_ENABLED = false;

export interface PolishCtx {
  phase: DayPhase;
  direction: Direction;
  reasonKey: ReasonKey;
}

// ── 缓存：内存 Map（sig → 已通过校验的润色句） + 磁盘单条 ──
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
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

/** 同步取已缓存的润色句（首帧用，避免规则句 → 润色句闪一下） */
export function peekHomePolish(sig: string): string | null {
  // 关掉润色后，连磁盘里残留的旧润色句也不再回填（避免重启又把病句显示出来）
  return POLISH_ENABLED ? (cache.get(sig) ?? null) : null;
}

const SYSTEM = [
  '你是 Mira，把用户给的一句中文换个更自然、更像朋友随口说的说法。',
  '只输出改写后的那一句话，不要引号、不要解释、不要分行、不要加任何新内容。',
].join('\n');

function buildUserPrompt(rule: string): string {
  return [
    '严格规则：',
    '1. 只换虚词和语序，意思完全不变；不新增任何事实、数字、时间、动作、原因、建议；',
    '2. 不许出现数字、冒号、括号、引号、书名号、破折号、emoji；',
    '3. 不许出现「数据」「检测」「建议」「评分」「准备度」「占比」这类词；',
    '4. 不许提睡眠、昨晚、饭点、早上、晚上等原句里没有的时段词；',
    '5. 字数不超过原句，一句话说完。',
    `原句：${rule}`,
    '改写：',
  ].join('\n');
}

/** 模型输出清洗：只取第一行、去包裹引号/破折号；不做任何「补全」，缺失即判废 */
function cleanRaw(raw: string): string {
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? ''
    .replace(/^[-–—•·*＋+\s>›»]+/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

/**
 * 请求当前签名的润色句。失败 / 超时 / 不合格一律返回 null —— 调用方保留规则句。
 * 同一签名并发只跑一次推理（inFlight 去重）。
 */
export async function requestHomePolish(
  rule: string,
  signature: string,
  ctx: PolishCtx,
): Promise<string | null> {
  if (!POLISH_ENABLED || !rule || !signature) return null;
  await loadDisk();
  const hit = cache.get(signature);
  if (hit) return isSafePolish(rule, hit, ctx) ? hit : null;

  const running = inFlight.get(signature);
  if (running) return running;

  const task = (async (): Promise<string | null> => {
    try {
      const res: any = await Promise.race([
        runOnModel(
          (mctx) =>
            mctx.completion(
              {
                messages: [
                  { role: 'system', content: SYSTEM },
                  { role: 'user', content: buildUserPrompt(rule) },
                ],
                n_predict: 60,
                temperature: 0.35, // 润色任务要稳，低温度少生造
                top_p: 0.85,
                stop: ['<|im_end|>', 'User:', '用户：', '\n'],
              },
              () => {},
            ) as Promise<any>,
          `homepolish@${signature}`,
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GEN_TIMEOUT_MS)),
      ]);
      if (!res) return null;
      const text = cleanRaw(String(res?.text ?? ''));
      // ★ 同事实闸门：AI 只允许换说法，任何新事实 / 时段错配 / 方向反转都判废
      if (!isSafePolish(rule, text, ctx)) return null;
      cache.set(signature, text);
      void saveDisk(signature, text);
      return text;
    } catch {
      return null;
    } finally {
      inFlight.delete(signature);
    }
  })();

  inFlight.set(signature, task);
  return task;
}

/**
 * 首页用 hook：规则句已在位，润色到货才替换。
 * 依赖只有 rule + signature（+ ctx 三元组），半小时节拍外不会重复推理。
 */
export function useHomePolish(
  rule: string | null,
  signature: string,
  ctx: PolishCtx,
): string | null {
  const [polished, setPolished] = useState<string | null>(() => peekHomePolish(signature));
  const ctxKey = `${ctx.phase}|${ctx.direction}|${ctx.reasonKey}`;

  useEffect(() => {
    let alive = true;
    if (!rule || !signature) {
      setPolished(null);
      return () => { alive = false; };
    }
    const cached = peekHomePolish(signature);
    setPolished(cached);

    const timer = setTimeout(() => {
      void requestHomePolish(rule, signature, ctx).then((v) => {
        if (alive) setPolished(v);
      });
    }, START_DELAY_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // ctxKey 代表 ctx 的语义值（调用方传的是 useMemo 产物，本身也稳定）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, signature, ctxKey]);

  return polished;
}

export default useHomePolish;
