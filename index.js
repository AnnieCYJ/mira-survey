import { LogBox } from 'react-native';
import registerRootComponent from 'expo/build/launch/registerRootComponent';

// ★ 2026-11-07（用户）：真机上各类「设计内降级」的 console.warn 会弹 LogBox 红屏，
//   反复盖住页面打断使用与验证（NativeEventEmitter、AI-Insight 回落、MiraAI init 失败等）。
//   两道防线：
//   ① LogBox.ignoreLogs（官方通道）
//   ② console.warn 入口过滤 —— RN 桥在 JS 入口之前就把 console.warn 接到 LogBox，
//      这里再包一层，命中良性前缀的警告降级为 console.log（Metro 控制台仍可见、不进 LogBox）。
//      真实错误仍走 postLog(8899) / 错误上报，不影响排查。
LogBox.ignoreLogs([
  /new NativeEventEmitter\(\)` was called/,
  /\[AI-Insight\]/,
  /\[MiraAI\]/,
  /\[MemoryStore\]/,
  /\[ChatContext\]/,
]);

const BENIGN_WARN_PREFIXES = [
  '[AI-Insight]',
  '[MiraAI]',
  '[MemoryStore]',
  '[ChatContext]',
  '[deviceModel]',
  '[HealthStore] listener error',
  'new NativeEventEmitter()',
];
const origWarn = console.warn.bind(console);
console.warn = (...args) => {
  const first = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
  if (BENIGN_WARN_PREFIXES.some((p) => first.includes(p))) {
    console.log(...args);
    return;
  }
  origWarn(...args);
};

const App = require('./App').default;
registerRootComponent(App);
