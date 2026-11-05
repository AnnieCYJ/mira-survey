/**
 * quickCheckResult —— 「一键体检 → 首页今日状态」结果缓存（数据层）
 * ---------------------------------------------------------------------------
 * 职责：把最近一次一键体检产出的「今日状态分 / 压力 / 身体成分摘要」独立落盘，
 *   并提供轻量订阅，让首页在体检完成后立刻刷新（不必等 RingBle 曲线模型凑够数据）。
 *
 * 为什么单独一层：
 *   - quickCheckStore 是体检记录库（SQLite，按条存 groups），首页不该去解析报告文案；
 *   - RingBle.curveStatus 是长周期曲线模型（需要连续真实采样才出值），首次进入为空；
 *   本缓存是两者之间的桥：体检给出「当下」的状态结果，首页在曲线无值/断流时回退到它。
 *
 * 持久化：prefs（expo-file-system KV），与 userStore / deviceModel 同源。
 * ---------------------------------------------------------------------------
 */
import { getItem, setItem } from '../utils/prefs';
import type { QCSource } from '../lib/quickCheckEstimate';

const KEY = 'mira_quickcheck_result_v1';

/** 结果 12 小时内有效：过期的体检不该继续当「今日状态」显示。 */
export const QC_RESULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface QuickCheckResultValue {
  value: number;
  source: QCSource;
  reason: string;
}

export interface QuickCheckResult {
  /** 体检完成时刻（ms） */
  createdAt: number;
  /** 对应的体检记录 id（可跳报告详情） */
  recordId: string;
  /** 今日状态分 0-100（null = 本次没算出） */
  status: QuickCheckResultValue | null;
  /** 压力分 0-100（null = 本次没算出） */
  stress: QuickCheckResultValue | null;
  /** 身体成分摘要（来自首次注册录入的身高/体重/年龄/性别） */
  body: { bmi: number; bodyFat: number; muscle: number; bmr: number } | null;
  /** 本次报告中「实测项 / 估算项」数量，供界面显示口径 */
  measuredCount: number;
  estimatedCount: number;
}

type Listener = (r: QuickCheckResult | null) => void;
const listeners = new Set<Listener>();
let cache: QuickCheckResult | null | undefined = undefined; // undefined = 尚未加载

export function getQuickCheckResultSync(): QuickCheckResult | null {
  return cache ?? null;
}

export function subscribeQuickCheckResult(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(r: QuickCheckResult | null) {
  cache = r;
  listeners.forEach((fn) => {
    try { fn(r); } catch { /* 单个监听者异常不影响其它页面 */ }
  });
}

/** 读取（带内存缓存）。无效/过期/损坏一律返回 null，不抛异常。 */
export async function loadQuickCheckResult(): Promise<QuickCheckResult | null> {
  try {
    const raw = await getItem(KEY);
    const r = raw ? (JSON.parse(raw) as QuickCheckResult) : null;
    const valid = r && typeof r.createdAt === 'number' && Date.now() - r.createdAt < QC_RESULT_TTL_MS;
    cache = valid ? r : null;
  } catch {
    cache = null;
  }
  return cache;
}

/** 写入并广播（首页订阅后即时刷新）。 */
export async function saveQuickCheckResult(r: QuickCheckResult): Promise<void> {
  try {
    await setItem(KEY, JSON.stringify(r));
  } catch {
    // 落盘失败仍要广播，让本次会话的首页能刷新
  }
  emit(r);
}

/** 取「当前有效」的结果：过期返回 null。 */
export function validQuickCheckResult(r: QuickCheckResult | null): QuickCheckResult | null {
  if (!r || typeof r.createdAt !== 'number') return null;
  return Date.now() - r.createdAt < QC_RESULT_TTL_MS ? r : null;
}
