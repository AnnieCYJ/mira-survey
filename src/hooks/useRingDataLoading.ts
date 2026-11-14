import { useEffect, useRef, useState } from 'react';
import { RingBle, type RingState } from '../ble/RingBleManager';

/**
 * ★ 2026-11-13（用户）：「戒指数据还在加载中」判定，供基础指标卡底部文案使用。
 *
 * 背景：戒指数据是按指标分批回来的——心率先到，HRV / 血氧还要再等一段。
 * 这段窗口里卡片数值是「—」，底部文案却写「今日暂未读到数据」，看起来像没连上或坏了。
 * 这里给出一个**只在真的有数据来源在跑时才为真**的信号，用来插入「正在加载中」。
 *
 * 判定口径（宁可少说，绝不误报）：
 *  1. BLE 链路必须处于忙态（scanning / connecting / connected），断开或报错一律 false；
 *  2. 且满足其一：
 *     a. 独立同步进度通道 active=true（原生 backfill / recoverOffline 正在回传）；
 *     b. 刚刚发生连接状态切换，处于一个**有限**的等待窗内（实时数据陆续到达的第一段）。
 *  3. 所有路径都有硬上限：同步进度通道本身带 90s 兜底；等待窗从首次进入忙态起算，
 *     连续 scanning → connecting → connected 不重复延长。超时后自动回落到「暂未读到数据」。
 *
 * 性能：同步进度 percent 的高频推送只搬一个布尔值进 state，
 * 同值会被 React 去重，不会让洞察页整屏重渲染（同步期间最忌这个）。
 */

/** 与 RingBleManager.pushSyncProgress 的 90s 兜底同源。 */
const LOADING_WINDOW_MS = 90_000;

function isLinkBusy(s: RingState['status']): boolean {
  return s === 'scanning' || s === 'connecting' || s === 'connected';
}

/** 返回 true = 「数据还在路上」，此时无读数的卡片应显示「正在加载中」。 */
export function useRingDataLoading(ring: RingState): boolean {
  // 初值直接读快照：页面若在同步进行中才挂载，也不会错过订阅建立前已发生的进度。
  const [syncActive, setSyncActive] = useState<boolean>(
    () => RingBle.getSyncProgress()?.active === true
  );
  const [inWindow, setInWindow] = useState(false);
  const prevStatus = useRef<RingState['status']>(ring.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 等待窗的绝对截止时间戳；0 = 未开始 / 已重置。 */
  const deadline = useRef(0);

  useEffect(() => {
    return RingBle.onSyncProgress((p) => setSyncActive(p?.active === true));
  }, []);

  useEffect(() => {
    const st = ring.status;
    const was = prevStatus.current;
    prevStatus.current = st;

    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!isLinkBusy(st)) {
      deadline.current = 0;
      setInWindow(false);
      return;
    }
    // 首次进入忙态才起算，连续的状态切换不重复延长窗口
    if (deadline.current === 0) deadline.current = Date.now() + LOADING_WINDOW_MS;
    // 页面挂载时若早已连着（was === st），不凭空宣称「正在加载」，
    // 此时只认真实的同步进度（syncActive）。
    if (was === st) return;

    const remain = Math.max(0, deadline.current - Date.now());
    if (remain <= 0) {
      setInWindow(false);
      return;
    }
    setInWindow(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setInWindow(false);
    }, remain);
  }, [ring.status]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return isLinkBusy(ring.status) && (syncActive || inWindow);
}

export default useRingDataLoading;
