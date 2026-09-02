const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// GGUF 模型权重走 iOS app bundle 原生资源（withLlamaRN 插件处理），
// 不再经 Metro asset 管道加载，避免 1.1GB 二进制触发 JS 字符串长度限制。
// 这里显式从 assetExts 移除，若代码里还 require .gguf 会直接报错，防止误用。
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'gguf');

module.exports = config;
