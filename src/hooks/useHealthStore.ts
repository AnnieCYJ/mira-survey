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
import { useSyncExternalStore } from 'react';
import { healthStore, type HealthStore } from '../data/healthStore';

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
