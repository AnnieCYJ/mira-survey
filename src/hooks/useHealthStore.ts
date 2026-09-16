/**
 * useHealthStore —— 订阅 healthStore 变更的 React hook
 *
 * healthStore 是同步单例，写入不经过 RingState，因此只订阅 RingState 的组件
 * 无法感知离线回填完成。本 hook 通过 subscribe/version 机制让组件直接订阅
 * healthStore，回填/实时数据落地后自动重渲染。
 *
 * 用法：
 *   const hrToday = useHealthStoreValue(s => s.getIntraday('hr', dayKeyOf(Date.now())));
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { healthStore, type HealthStore } from '../data/healthStore';
import { estimateOfflineMetricsRecent } from '../lib/offlineEstimates';

export function useHealthStoreValue<T>(selector: (store: HealthStore) => T): T {
  return useSyncExternalStore(
    (callback) => healthStore.subscribe(callback),
    () => selector(healthStore),
  );
}

/** 仅用于强制重渲染（返回一个每次写入后递增的版本号）。 */
export function useHealthStoreVersion(): number {
  return useSyncExternalStore(
    (callback) => healthStore.subscribe(callback),
    () => healthStore.getVersion(),
  );
}

/**
 * 确保派生指标（eda/cortisol/sns/emotion/skin/fatigue）的 intraday 被回填。
 *
 * 背景：这些指标协议无历史存储 API，本应由 offlineEstimates 用当日实测 stress 推算并落库，
 * 但 estimateOfflineMetricsRecent 一直**从未被接线上**（全局零调用）。结果历史日的
 * cortisol/eda intraday 永远为空 → 身体恢复详情页「今日皮质醇全天趋势」的 14 天聚合
 * 与「情绪消耗」历史日都画不出；洞察页皮质醇节律卡同理。
 *
 * 本 hook 在 healthStore 版本变化时（节流）触发回填：幂等（已有样本的日子跳过，不覆盖
 * 实时真值），且显式跳过今天（今天由实时流覆盖）。挂在消费这些指标的页面即可。
 */
export function useEnsureDerivedMetrics(days = 30): void {
  const lastRun = useRef(0);
  // ★ 手动订阅（不经由 useHealthStoreVersion），避免在实时高频写时强制宿主组件重渲染。
  //   healthStore 每次写入都 notify，若用 useSyncExternalStore 会让详情页每秒重渲染上百次。
  useEffect(() => {
    const unsub = healthStore.subscribe(() => {
      const now = Date.now();
      if (now - lastRun.current < 4000) return; // 节流：避免实时流高频写时反复跑
      lastRun.current = now;
      try {
        estimateOfflineMetricsRecent(days);
      } catch {
        /* 回填失败不影响正常读取 */
      }
    });
    return () => unsub();
  }, [days]);
}

/**
 * 防抖刷新键：订阅 healthStore，但只在写入「安静/稳定」一段时间（默认 700ms）后才让宿主组件
 * 重渲染一次。用于详情页——既要「实时/回填数据到达后刷新趋势」，又要避免实时流高频写导致
 * 整页每秒重渲染上百次（主线程被压满、返回键点不动）。返回的值变化即触发一次刷新。
 */
export function useDebouncedHealthStoreRefresh(ms = 700): number {
  const [refreshKey, setRefreshKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFire = useRef(0);
  useEffect(() => {
    const unsub = healthStore.subscribe(() => {
      const now = Date.now();
      // 连续高频写时，最多每 1500ms 强制刷新一次，保证「今日趋势」不会一直不更新
      if (now - lastFire.current >= 1500) {
        lastFire.current = now;
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        setRefreshKey((k) => k + 1);
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        lastFire.current = Date.now();
        setRefreshKey((k) => k + 1);
      }, ms);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ms]);
  return refreshKey;
}
