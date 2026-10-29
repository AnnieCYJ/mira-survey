/**
 * patternSuggestion —— 首页建议卡的「人生上下文」内容源（Phase 2）
 *
 * ══ 为什么单独一个源 ══
 * 首页建议卡现在的内容源有两个：AI 生成（aiSuggestion，60s 超时）+ 引擎兜底
 * （suggestionEngine）。两者都是**当次状态驱动**的通用话术。
 * 但用户真正想被"懂"的地方是**只属于她的规律**：「我一到周一就睡不好」
 * 「睡够的那天 HRV 更高」——这些已经躺在人生上下文库里了。
 *
 * 所以这里把**用户点过「挺准」的规律**做成一张确定性的首页卡：
 * · 不调模型 → 瞬时出，不占 60s 等待；
 * · headline 用规律原话（不编、不夸张、不说教）；
 * · metric 带真实证据（多少天 / r）；
 * · 点「有用」→ 给这条规律确认次数 +1（加权）；
 * · 点「没啥感觉」→ 退出人生上下文，保留原始观察。
 *
 * ⚠ 口径：只做描述性观察，不诊断、不评分；CTA 只深链现有工具页（复用既有白名单）。
 */
import { peekLifeContext } from '../data/patternStore';
import type { SuggestionCandidate } from './suggestionEngine';

/** 规律标题里带这些词 → 给一个「睡前呼吸」类轻建议的跳转（复用现有工具页） */
const SLEEP_HINT = /睡|眠|入睡|起床|作息|HRV|心率变异性/;
const CALM_HINT = /压力|交感|心跳|心率/;

/**
 * 取一条人生上下文做成首页卡。
 * @param excludeId 已被否过的那条（避免立刻又推同一条）
 */
export function patternCandidateFor(excludeId?: string): SuggestionCandidate | null {
  const ctx = peekLifeContext();
  if (!ctx.length) return null;
  const p = excludeId ? ctx.find((x) => x.id !== excludeId) : ctx[0];
  if (!p) return null;

  const headline = (p.title || '').trim();
  if (!headline) return null;

  const metricBits: string[] = [];
  if (p.evidence?.detail) metricBits.push(p.evidence.detail);
  else if (p.evidence?.n) metricBits.push(`${p.evidence.n} 天`);
  if (typeof p.evidence?.r === 'number') metricBits.push(`r ${p.evidence.r}`);

  // 轻建议：复用现有工具页（呼吸 / 睡前呼吸），不发明新页面
  let cta: SuggestionCandidate['cta'];
  if (SLEEP_HINT.test(headline)) {
    cta = { label: '去呼吸 ›', screen: 'Breathing', params: { breath: 'sleep' } };
  } else if (CALM_HINT.test(headline)) {
    cta = { label: '去呼吸 ›', screen: 'Breathing', params: { breath: 'calm' } };
  }

  return {
    id: `pat-${p.id}`,
    saveId: `pat-${p.id}`,
    headline,
    ...(metricBits.length ? { metric: metricBits.join(' · ') } : {}),
    kind: 'reflection',
    // 规律卡不写进「我的建议」清单（那是行动型建议的地方），只做规律加权
    noPersist: true,
    patternId: p.id,
    ...(cta ? { cta } : {}),
  };
}
