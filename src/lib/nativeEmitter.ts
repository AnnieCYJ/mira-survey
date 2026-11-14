/**
 * safeNativeEmitter —— 消灭「new NativeEventEmitter() was called with a non-null argument
 * without the required addListener/removeListeners method」dev 警告的统一入口。
 *
 * ★ 2026-11-07（用户）：真机上这两条警告反复弹红屏打断使用与验证。根因是 Veepoo/Voice
 *   原生模块没有实现 addListener / removeListeners（RCTEventEmitter 的 JS 侧计数接口），
 *   事件本身经原生 emit 正常到达，缺这两个方法只影响警告与卸载计数，不影响功能。
 *   处理：构造 emitter 前给模块对象补 no-op 存根 —— 已实现真方法的原生模块完全不受影响。
 *
 * ★ 2026-11-12（用户「OPPO 打开变蓝屏」）：原生事件回调里若抛出同步错误，React 错误边界
 *   抓不到（错误边界只覆盖「渲染期」），会导致整棵 React 树被卸载、露出底层蓝底（蓝屏）。
 *   这里把所有 addListener 注册的回调统一包一层 try/catch，任何原生事件抛错都只记录、
 *   绝不向上冒泡，保护 App 不被单个事件拖垮。这是 OPPO/ColorOS 蓝屏最可疑的命中点。
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { postLog } from '../lib/logger';

export function safeNativeEmitter(moduleName: string): NativeEventEmitter | null {
  const mod = (NativeModules as any)[moduleName];
  if (!mod) return null;
  if (typeof mod.addListener !== 'function') {
    mod.addListener = () => {};
  }
  if (typeof mod.removeListeners !== 'function') {
    mod.removeListeners = () => {};
  }
  const real = new NativeEventEmitter(mod);
  return wrapSafeEmitter(real, moduleName);
}

/**
 * 用 Proxy 包裹真实 emitter：仅拦截 addListener，把每个回调包成 safe 版本；
 * 其余方法（removeAllListeners / removeSubscription 等）原样转发到真实实例（this 绑定到 target）。
 */
function wrapSafeEmitter(real: NativeEventEmitter, moduleName: string): NativeEventEmitter {
  const safeAddListener = (event: string, listener: (...args: any[]) => void) => {
    const safe = (...args: any[]) => {
      try {
        return listener(...args);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[safeNativeEmitter]', moduleName, event, 'listener threw:', e);
        try {
          postLog('NATIVE_LISTENER_ERROR', `${moduleName}.${event}: ${(e as Error)?.stack || String(e)}`);
        } catch { /* 静默 */ }
      }
    };
    return (real as any).addListener(event, safe);
  };

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'addListener') return safeAddListener;
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') return val.bind(target);
      return val;
    },
  }) as NativeEventEmitter;
}
