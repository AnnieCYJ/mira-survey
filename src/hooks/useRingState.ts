import { useEffect, useState } from 'react';
import { RingBle, type RingState } from '../ble/RingBleManager';

/**
 * 订阅 RingState（BLE 连接状态 + 派生数据），并把**同一帧内的多次推送合并为一次 setState**。
 *
 * 为什么要节流：回填/同步期原生约 ≥500ms emit 一次（RingBleManager.scheduleEmitThrottled），
 * 每次 emit 都会让订阅屏幕整屏重渲染；而这些屏幕的 render 里往往还要跑
 * computeStressReport / computeCognitiveLoadReport / 皮质醇分析等重计算。
 * 直接 `RingBle.onState(setRing)` 会让短时间内多次重渲染叠加 → 点击 / 切 Tab 卡顿。
 * 用 requestAnimationFrame 合并成「每帧最多一次」，肉眼无差别但显著降低负载。
 *
 * 用法：`const ring = useRingState();`（替代 `useState + useEffect(onState)` 那两行）
 */
export function useRingState(): RingState {
  const [ring, setRing] = useState<RingState>(() => RingBle.getState());

  useEffect(() => {
    let pending: RingState | null = null;
    let scheduled = false;
    const throttled = (s: RingState) => {
      pending = s;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          if (pending) setRing(pending);
        });
      }
    };
    return RingBle.onState(throttled);
  }, []);

  return ring;
}

export default useRingState;
