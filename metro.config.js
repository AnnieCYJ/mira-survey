const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// llama.rn 模型权重为 .gguf，需被 Metro 当作资源处理（否则 require 解析失败）
if (!config.resolver.assetExts.includes('gguf')) {
  config.resolver.assetExts.push('gguf');
}

module.exports = config;
