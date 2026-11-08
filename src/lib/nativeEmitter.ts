/**
 * safeNativeEmitter —— 消灭「new NativeEventEmitter() was called with a non-null argument
 * without the required addListener/removeListeners method」dev 警告的统一入口。
 *
 * ★ 2026-11-07（用户）：真机上这两条警告反复弹红屏打断使用与验证。根因是 Veepoo/Voice
 *   原生模块没有实现 addListener / removeListeners（RCTEventEmitter 的 JS 侧计数接口），
 *   事件本身经原生 emit 正常到达，缺这两个方法只影响警告与卸载计数，不影响功能。
 *   处理：构造 emitter 前给模块对象补 no-op 存根 —— 已实现真方法的原生模块完全不受影响。
 */
import { NativeEventEmitter, NativeModules } from 'react-native';

export function safeNativeEmitter(moduleName: string): NativeEventEmitter | null {
  const mod = (NativeModules as any)[moduleName];
  if (!mod) return null;
  if (typeof mod.addListener !== 'function') {
    mod.addListener = () => {};
  }
  if (typeof mod.removeListeners !== 'function') {
    mod.removeListeners = () => {};
  }
  return new NativeEventEmitter(mod);
}
