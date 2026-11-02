/**
 * cloudPatterns.ts —— 端云结合的「规律」编排层（Phase 1 + Phase 2 交界）
 *
 * 端云分工：
 * · **云端**（/v1/ring/patterns）：长窗口、跨设备连续的历史，跑确定性引擎；
 * · **端侧**（ai/patterns.ts）：本机更细的数据（分钟级睡眠、入睡时刻、自报记录）；
 * · **这一层**：把两边观察合并去重 → 写进本地「人生上下文库」（data/patternStore）。
 *
 * 拉取时机：
 * · App 启动后（夜间/冷启动都算一次，走缓存 TTL 兜底，不频繁打网络）；
 * · 每次云端上传成功之后（数据刚变，规律可能刚成立）。
 *
 * ⚠ 失败一律静默降级：拉不到云端就只用端侧观察，不影响任何已有功能。
 */
import { apiFetch, authHeaders, ensureDeviceToken, getLocalDeviceId } from '../data/ringIdentity';
import {
  upsertObservations,
  listVisiblePatterns,
  peekLifeContext,
  peekPendingObservations,
  type PatternEntry,
  type PatternObservation,
} from '../data/patternStore';
import { computeLocalPatterns, mergeObservations } from './patterns';

/** 云端观察缓存有效期（小时）—— 夜间一次，白天不重复打网络 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CloudCache {
  deviceId: string;
  days: number;
  at: number;
  observations: PatternObservation[];
}

let cache: CloudCache | null = null;
let inflight: Promise<PatternEntry[]> | null = null;
let inflightKey: string | null = null;

/** 只读缓存（同步） */
export function peekCloudCache(): CloudCache | null {
  return cache;
}

/**
 * 拉云端观察。失败返回 null（不抛）。
 * · 自动带上设备令牌（没有就先签一枚；签发失败就走无令牌模式，后端开发态放行）。
 */
export async function fetchCloudObservations(
  deviceId: string,
  days = 30,
): Promise<PatternObservation[] | null> {
  try {
    const token = await ensureDeviceToken(deviceId);
    const r = await apiFetch(`/v1/ring/patterns?device_id=${encodeURIComponent(deviceId)}&days=${days}`, {
      timeoutMs: 15000,
      headers: authHeaders(token),
    });
    if (!r.ok || !r.data || !Array.isArray(r.data.observations)) return null;
    const obs: PatternObservation[] = [];
    for (const o of r.data.observations) {
      if (!o || typeof o.id !== 'string') continue;
      obs.push({
        id: String(o.id),
        kind: o.kind === 'correlation' || o.kind === 'group_diff' || o.kind === 'rhythm' || o.kind === 'coverage'
          ? o.kind
          : 'rhythm',
        title: String(o.title ?? ''),
        text: String(o.text ?? ''),
        evidence: {
          n: Number(o?.evidence?.n) || 0,
          ...(o?.evidence?.r != null ? { r: Number(o.evidence.r) } : {}),
          ...(typeof o?.evidence?.detail === 'string' ? { detail: o.evidence.detail } : {}),
        },
        confidence:
          o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' || o.confidence === 'context'
            ? o.confidence
            : 'low',
        confidenceScore: Number(o.confidence_score) || 0,
        source: 'cloud',
        windowDays: Number(r.data.window_days) || days,
        observedAt: Number(r.data.generated_at) * 1000 || Date.now(),
      });
    }
    cache = { deviceId, days, at: Date.now(), observations: obs };
    return obs;
  } catch {
    return null;
  }
}

/**
 * 同步规律：云端 + 端侧 → 合并 → 写进人生上下文库。
 * @param opts.deviceId  云端身份（一般是戒指地址）
 * @param opts.force     忽略 TTL 强制重拉（上传成功后用）
 */
export async function syncPatterns(
  opts?: { deviceId?: string; days?: number; force?: boolean },
): Promise<PatternEntry[]> {
  const days = opts?.days ?? 30;
  let deviceId = opts?.deviceId;
  try { if (!deviceId) deviceId = await getLocalDeviceId(); } catch { deviceId = undefined; }
  const requestKey = JSON.stringify([deviceId, days]);
  if (inflight) {
    if (inflightKey === requestKey && !opts?.force) return inflight;
    await inflight;
    return syncPatterns(opts);
  }
  const run = (async (): Promise<PatternEntry[]> => {
    let cloud: PatternObservation[] | null = null;
    const fresh = cache && cache.deviceId === deviceId && cache.days === days && Date.now() - cache.at < CACHE_TTL_MS;
    if (opts?.force || !fresh) {
      if (deviceId) cloud = await fetchCloudObservations(deviceId, days);
    } else {
      cloud = cache?.observations ?? null;
    }

    let local: PatternObservation[] = [];
    try { local = computeLocalPatterns(days); } catch { local = []; }

    const merged = mergeObservations(cloud ?? [], local);
    if (merged.length) await upsertObservations(merged);
    return listVisiblePatterns();
  })().finally(() => { inflight = null; });

  inflightKey = requestKey;
  inflight = run;
  return run;
}

/**
 * 人生上下文块（给 AI prompt 用）。
 * · 第一段 = 用户点过「挺准」的规律（可引用）；
 * · 第二段 = 还没确认的观察（只能当"观察"提，不能当结论说）。
 * ⚠ 口径：AI 引用这些时**不得**说成诊断/评分，也不得替用户下结论。
 */
export function buildPatternContextBlock(): string {
  const ctx = peekLifeContext();
  const pending = peekPendingObservations();
  const lines: string[] = [];

  if (ctx.length) {
    lines.push('【用户已确认的个人规律（聊到相关话题时可自然引用，别逐条念）】');
    for (const e of ctx.slice(0, 3)) {
      lines.push(`- ${e.title}：${e.text}（${e.evidence?.detail || `${e.evidence?.n ?? 0} 天`}）`);
    }
  }
  if (pending.length) {
    lines.push('【最近观察到的规律（只是观察，不是结论；用户没确认前别说成定论）】');
    for (const e of pending.slice(0, 2)) {
      lines.push(`- ${e.title}（${e.evidence?.detail || `${e.evidence?.n ?? 0} 天`}）`);
    }
  }
  if (!lines.length) return '';
  return lines.join('\n');
}
