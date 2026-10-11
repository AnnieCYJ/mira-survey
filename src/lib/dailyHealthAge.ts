/**
 * dailyHealthAge —— 身体年龄「一天最多变一次」（2026-10-10 建立）
 *
 * ★ 为什么要冻结：
 *   身体年龄由「健康综合分 + 荷尔蒙节律 + 当日皮质醇」实时算出，而这些输入**每几十秒就会刷新**
 *   （戒指轮询 / 回填写入 / healthStore notify）。结果是卡片上的「低 5.4 岁」在一天里反复跳动
 *   ——用户体感是「这数字不可信、一直在变」。
 *
 * ★ 口径（用户定）：**同一天只算一次**。当天首次算出后即写入当日快照，全天复用；
 *   跨天（dayKey 变化）才重新计算。这样一天最多变一次。
 *
 * ★ 为什么连 overallScore 一起冻结：
 *   卡上的圆弧长度 = 综合分。如果只冻结身体年龄而综合分继续实时变，
 *   就会出现「数字不变但圆弧一直在跑」的分裂感 → 两者必须冻结在同一份快照里。
 *
 * ★ 存储：复用 `healthStore.saveAnalysis / getAnalysis`（该快照已持久化到磁盘），
 *   因此**重启 App 当天仍是同一个值**，而不是回到初始状态重新跳一次。
 */

import { healthStore, dayKey } from '../data/healthStore';

export interface FrozenHealthAge {
  healthAge: number;
  actualAge: number | null;
  delta: number | null;
  overallScore: number | null;
  frozenAt: number;
}

/** 读当日冻结值；没有（或跨天）返回 null */
export function readFrozenHealthAge(now: number = Date.now()): FrozenHealthAge | null {
  try {
    const rec = healthStore.getAnalysis(dayKey(now))?.healthAge;
    if (!rec) return null;
    if (!Number.isFinite(rec.healthAge)) return null;
    return rec;
  } catch {
    return null;
  }
}

/** 写当日冻结值（同一天重复写会被 saveAnalysis 的幂等短路吞掉，不会触发重渲染） */
export function writeFrozenHealthAge(v: Omit<FrozenHealthAge, 'frozenAt'>, now: number = Date.now()): void {
  try {
    healthStore.saveAnalysis(dayKey(now), 'healthAge', { ...v, frozenAt: now });
  } catch {
    /* 存储失败：退化成不冻结（本次渲染用新值），不影响出数 */
  }
}

/**
 * 取当日身体年龄：**有冻结值就直接返回，没有才计算并冻结**。
 *
 * @param compute 真正计算的函数（只在需要刷新时被调用）
 * @returns `{ value, frozen }` —— `frozen=true` 表示本次用的是当天早些时候算好的值
 */
export function resolveDailyHealthAge(
  compute: () => { healthAge: number | null; actualAge: number | null; overallScore: number | null },
  now: number = Date.now(),
): { value: FrozenHealthAge | null; frozen: boolean } {
  const cached = readFrozenHealthAge(now);
  // 已有冻结 → 直接复用（一天最多变一次）
  if (cached) return { value: cached, frozen: true };

  let fresh: { healthAge: number | null; actualAge: number | null; overallScore: number | null };
  try {
    fresh = compute();
  } catch {
    return { value: null, frozen: false };
  }
  if (fresh.healthAge == null || !Number.isFinite(fresh.healthAge)) {
    // 算不出来（年龄未填 / 数据不足）→ 不冻结，等下次有机会再算
    return { value: null, frozen: false };
  }
  const delta = fresh.actualAge != null ? Number((fresh.healthAge - fresh.actualAge).toFixed(1)) : null;
  const rec: FrozenHealthAge = {
    healthAge: Number(fresh.healthAge.toFixed(1)),
    actualAge: fresh.actualAge,
    delta,
    overallScore: fresh.overallScore,
    frozenAt: now,
  };
  writeFrozenHealthAge({
    healthAge: rec.healthAge,
    actualAge: rec.actualAge,
    delta: rec.delta,
    overallScore: rec.overallScore,
  }, now);
  return { value: rec, frozen: false };
}

/** 测试/调试用：清掉当日冻结值，强制下次重算 */
export function clearFrozenHealthAge(now: number = Date.now()): void {
  try {
    healthStore.saveAnalysis(dayKey(now), 'healthAge', undefined as any);
  } catch { /* noop */ }
}