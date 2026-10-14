module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // ★ reanimated v3：babel 插件必须是最后一个 plugin（顺序不可改）
      'react-native-reanimated/plugin',
    ],
  };
};
