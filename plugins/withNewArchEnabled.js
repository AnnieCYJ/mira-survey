const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 2026-11-06：llama.rn@0.10 是纯 TurboModule，其 Android 原生工程只有在 New Architecture
 * 开启时才会 apply `com.facebook.react` 插件并执行 `react { codegenConfig }` 代码生成
 * （由 src/NativeRNLlama.ts 生成 NativeRNLlamaSpec）。Old Arch 下该 spec 永不生成 → 编译失败。
 * 因此必须让全 app 开启 New Arch。Expo SDK 51 的 prebuild 模板已内建 New Arch 支持，
 * 仅需在 android/gradle.properties 把 newArchEnabled 置 true 即可（与 iOS 的
 * RCT_NEW_ARCH_ENABLED=1 同理，本插件只改 Android，因为当前只构建 Android）。
 *
 * 已知安全前提：本 app 的其它原生依赖（Reanimated 3.10 / Gesture Handler 2.16 / Screens 3.31 /
 * SVG 15.2 / SafeArea 4.10 / ble-plx 3.5.1 / Expo 51 各模块）均支持 New Arch；Veepoo SDK 以
 * AAR+JAR+legacy ReactPackage 形式接入（Java），New Arch 的 interop 层可兼容，戒指 BLE 不受影响。
 */
module.exports = function withNewArchEnabled(config) {
  config = withDangerousMod(config, ['android', (c) => {
    const gradleProps = path.join(c.modRequest.projectRoot, 'android', 'gradle.properties');
    if (!fs.existsSync(gradleProps)) {
      console.warn('[withNewArchEnabled] android/gradle.properties not found, skipping');
      return c;
    }
    let s = fs.readFileSync(gradleProps, 'utf8');
    if (/^\s*newArchEnabled\s*=/m.test(s)) {
      s = s.replace(/^\s*newArchEnabled\s*=.*$/m, 'newArchEnabled=true');
    } else {
      s += '\nnewArchEnabled=true\n';
    }
    fs.writeFileSync(gradleProps, s);
    console.log('[withNewArchEnabled] android newArchEnabled=true');
    return c;
  }]);

  return config;
};
