/**
 * useMetricHeroAi —— 指标详情页 Hero 下方的「短分析」改成端侧模型生成（★ 2026-11-10 用户）。
 *
 * 背景：原 buildHeroAnalysis() 是纯阈值模板（按数值区间 switch 出固定中文句），
 * 不是 AI、也不随数据细变，用户反馈「很套模板、不像 AI 生成」。
 *
 * 本 hook 接入与首页/洞察页同源的端侧 Qwen2.5-1.5B（runOnModel），为当前指标生成一句
 * 自然、带 Mira 声线的短分析；buildHeroAnalysis 的模板作为**即时兜底**——
 * 模型未就绪 / 无数据 / 超时 / 输出不合法时一律回落模板，绝不让 Hero 空白。
 *
 * 约束（与全局诚实口径一致）：
 *  · 只把真实数值与「已知事实」喂给模型，模型不得编造数字；
 *  · Mira 声线：短、自然、不居高临下、不诊断、不评分、不用「我们」；
 *  · 输出仅取第一句（≤ 32 字），命中生造词/命令腔/乱码即丢弃、回落模板。
 *
 * 会话内按 `${key}|${range}|${band(value)}|${context}` 缓存，切指标/跨阈值/换时段才重新生成，
 * 重复查看同口径秒出，不反复打模型。
 */
import { useEffect, useRef, useState } from 'react';
import { runOnModel } from '../ai/model';

const cache = new Map<string, string>();

const SYSTEM = [
  '你是 Mira，用户的 AI 健康伙伴：说话短、自然，像闺蜜随手发来的一句话；不诊断、不评分、绝不编造数据。',
  '任务：为某个健康指标的详情页顶部写一句短分析。只输出一句中文（≤ 30 字），不要解释、不要 markdown、不要引号、不要冒号标题。',
  '规则：',
  '1. 只用我给你的真实数值与「已知事实」，不要自己编造数字；',
  '2. 不出现「我们」「诊断」「建议就医」「必须」这类居高临下的词；',
  '3. 像真人说话，有温度、不端着；',
  '4. 若我未给数值（无数据），直接输出空字符串。',
].join('\n');

/** 粗分桶：避免数值小幅抖动反复触发模型推理 */
function bandOf(key: string, v: number): number {
  const k = key.toLowerCase();
  if (['hr', 'spo2', 'hrv', 'bloodsugar', 'bpsys', 'bpdia', 'temp', 'skintemp'].includes(k)) return Math.round(v);
  return Math.round(v / 2) * 2;
}

const UNNATURAL = [
  /美容肌|美肌/,
  /要睡觉|去睡觉|快去睡|赶紧睡|睡觉哦|去睡哦/,
  /你该|你应该|必须|一定要|赶紧去/,
  /\uFFFD|[\uD800-\uDFFF]/,
];
function looksNatural(t: string): boolean {
  return !UNNATURAL.some((re) => re.test(t));
}

/** 取首句并做长度 / 人话护栏；不合法返回 null（回落模板） */
function parseHero(raw: string): string | null {
  const s = (raw || '')
    .replace(/```(?:json)?/g, '')
    .replace(/```/g, '')
    .replace(/^["'「『]|["'」』]$/g, '')
    .trim();
  if (!s) return null;
  const first = s.split(/[。！？!?\n]/)[0].trim();
  if (first.length < 4 || first.length > 32) return null;
  if (!looksNatural(first)) return null;
  return first;
}

const RANGE_LABEL: Record<string, string> = { day: '今日', week: '近一周', month: '近一月', year: '近一年' };

function buildPrompt(name: string, value: number, unit: string | null, rangeLabel: string, context: string): string {
  return [
    `指标：${name}`,
    `当前数值：${Math.round(value)}` + (unit ? ` ${unit}` : ''),
    `时间范围：${rangeLabel}`,
    context ? `已知事实：${context}` : '',
    '写一句顶部短分析（≤ 30 字，像闺蜜随口说的）：',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * @param key      指标 key（用于缓存 / 分桶）
 * @param name     指标中文名
 * @param value    当前 Hero 数值（null = 无数据，不调模型）
 * @param range    'day' | 'week' | 'month' | 'year'
 * @param unit     单位（'/100' 会被转成「分」；其余原样）
 * @param context  真实事实串（如「较上一周期 +5%」「日间均值 64 / 夜间 35」「当日峰值 78 bpm」），可选
 * @returns 模型生成的短句；未就绪/无数据/失败时返回 null（调用方回落模板）
 */
export function useMetricHeroAi(
  key: string,
  name: string,
  value: number | null,
  range: string,
  unit?: string | null,
  context?: string,
): string | null {
  const cleanUnit = unit && unit !== '/100' ? unit : unit === '/100' ? '分' : null;
  const cacheKey = value == null ? null : `${key}|${range}|${bandOf(key, value)}|${context ?? ''}`;
  const [ai, setAi] = useState<string | null>(cacheKey ? cache.get(cacheKey) ?? null : null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!cacheKey) {
      setAi(null);
      return;
    }
    const hit = cache.get(cacheKey);
    if (hit) {
      setAi(hit);
      return;
    }
    let cancelled = false;
    const rl = RANGE_LABEL[range] ?? range;
    const prompt = buildPrompt(name, value as number, cleanUnit, rl, context ?? '');
    const reqKey = `heroai@${cacheKey}`;
    const p = runOnModel(
      (ctx: any) =>
        ctx.completion({
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
          ],
          n_predict: 60,
          temperature: 0.6,
          top_p: 0.9,
          stop: ['<|im_end|>', 'User:', '用户：'],
        }) as Promise<any>,
      reqKey,
    );
    // ★ 15s 超时：模型未就绪/被相机等场景占用时，回落模板，不阻塞 UI
    Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 15000))])
      .then((res: any) => {
        if (cancelled || !alive.current) return;
        const txt = parseHero(String(res?.text ?? ''));
        if (txt) {
          cache.set(cacheKey, txt);
          setAi(txt);
        }
      })
      .catch(() => {
        /* 模型不可用 → 模板已在位 */
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
    // 仅 cacheKey 变化才重新生成；value/context 已编码进 key 内
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return ai;
}
