/**
 * cloudAsk.ts —— Phase 3：端云追问
 *
 * 端侧 Qwen2.5-1.5B 适合"接住情绪 + 给一两个小建议"，但做不了 30 天数据的综合归因。
 * 这个模块把问题交给云端 /v1/ring/ask：云端用自己的长窗口摘要 + 端侧的人生上下文
 * （用户点过"挺准"的个人规律）合成一段有依据的回答。
 *
 * ★ 边界（与后端 system prompt 一致）：
 *   · 云端送进模型的只有摘要，没有原始时序数据；
 *   · 回答是描述性观察，不是诊断；
 *   · 云端挂了 / 没网 / 没令牌 → 返回 null，**静默回落端侧**，聊天不能因此断掉。
 */
import { apiFetch, authHeaders, ensureDeviceToken, getLocalDeviceId } from '../data/ringIdentity';
import { listLifeContext } from '../data/patternStore';

export interface CloudAskResult {
  answer: string;
  model?: string;
  contextUsed?: { observations?: number; life_context?: number; has_today?: boolean; baseline_established?: number };
}

/** 端侧人生上下文 → 可传给云端的文本行（最多 12 条） */
async function lifeContextLines(): Promise<string[]> {
  try {
    const list = await listLifeContext();
    return list
      .slice(0, 12)
      .map((p) => p.title + (p.text ? `：${p.text}` : ''))
      .filter((s) => s.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * 问云端。失败返回 null（不抛）。
 * @param question 用户原话
 * @param days     云端分析窗口（天），默认 30
 */
export async function askCloud(
  question: string,
  opts?: { days?: number; timeoutMs?: number },
): Promise<CloudAskResult | null> {
  const q = (question || '').trim();
  if (!q) return null;
  try {
    const deviceId = await getLocalDeviceId();
    const token = await ensureDeviceToken(deviceId);
    const life = await lifeContextLines();
    const r = await apiFetch('/v1/ring/ask', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        device_id: deviceId,
        question: q.slice(0, 500),
        days: opts?.days ?? 30,
        life_context: life,
      }),
      timeoutMs: opts?.timeoutMs ?? 45000,
    });
    if (!r.ok || !r.data || typeof r.data.answer !== 'string' || !r.data.answer.trim()) {
      return null;
    }
    return {
      answer: r.data.answer.trim(),
      model: r.data.model,
      contextUsed: r.data.context_used,
    };
  } catch {
    return null;
  }
}

// 路由保持纯函数，便于对实际用户问法做回归验证。
export { shouldRouteToCloud } from './questionRouting';
