const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// GGUF 模型权重走 iOS app bundle 原生资源（withLlamaRN 插件处理），
// 不再经 Metro asset 管道加载，避免 1.1GB 二进制触发 JS 字符串长度限制。
// 这里显式从 assetExts 移除，若代码里还 require .gguf 会直接报错，防止误用。
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'gguf');

// ★ 2026-11-06（P30 真跑端侧 AI）修复 Metro 500：
//   llama.rn 的 package.json 用 "react-native": "src/index" 把 RN 入口指向 TypeScript
//   源码 node_modules/llama.rn/src/index.ts。Metro 的 bundle 解析会把这个 .ts 当源码
//   交给 Node 直接加载，触发 `SyntaxError: Unexpected token 'typeof'`（node:internal/modules
//   原生加载栈，不是 Babel），dev server 返回 500、App 白屏/红屏。
//   解决：把裸 `llama.rn` 重定向到它已编译好的 CommonJS 产物 lib/commonjs/index.js（纯 JS），
//   既绕开 ts 源码、又保留完全一致的导出（initLlama / LlamaContext / NativeRNLlama 等）。
//   其内部 require('./jsi')、require('./NativeRNLlama') 会解析到同目录的 .js，无需额外处理。
const path = require('path');
const fs = require('fs');
const LLAMA_CJS = path.resolve(__dirname, 'node_modules/llama.rn/lib/commonjs/index.js');
if (fs.existsSync(LLAMA_CJS)) {
  const prevResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'llama.rn') {
      return { filePath: LLAMA_CJS, type: 'sourceFile' };
    }
    return prevResolveRequest
      ? prevResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
}

// 说明（2026-11-06）：这里曾加过一版 resolver.blockList，用
// /\/ios\/.*/ 、 /\/dist\/.*/ 这类宽泛正则排除原生目录，想给首次索引提速。
// 实测证明：① 索引慢的根因是运行环境变量污染（见 dev-p30.sh 的干净环境），
// 与排除规则无关；② 这些正则会误伤 node_modules 里以 dist/ 为入口的第三方包
// （典型：memoize-one 的 main = dist/memoize-one.cjs.js），导致
// "Unable to resolve module"。因此整段移除，保持 Metro 默认解析行为。
// 原生目录由 Gradle / Xcode 各自处理，Metro 不会把它们编进 JS 依赖图。

module.exports = config;
