const { withDangerousMod, withAppBuildGradle, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: 在 prebuild 阶段把 Veepoo Android SDK（AAR + jar）、原生桥 Kotlin 源、
 * MainApplication 包注册、以及 BluetoothKit 所需的 Manifest 服务/feature 注入安卓工程。
 *
 * 与 iOS 的 withVeepooSDK.js 同构：所有资产从 <projectRoot>/veepoo-assets/android 与
 * <projectRoot>/hband-sdk/Android_Ble_SDK 拷入生成的 android/ 目录，因此 EAS 云端 prebuild 也生效。
 */

// 需要从 Demo libs 拷贝的 Veepoo 依赖（跳过 AMap 地图包，避免引入无关依赖导致编译失败）
function veepooLibFilter(name) {
  if (name.startsWith('AMap')) return false; // 地图相关，戒指用不到
  return name.endsWith('.aar') || name.endsWith('.jar');
}

function withVeepooSDKAndroid(config) {
  // 1) 拷贝 AAR/jar + Kotlin 源到 android/ 工程
  config = withDangerousMod(config, 'android', (c) => {
    const projectRoot = c.modRequest.projectRoot;
    const androidDir = path.join(projectRoot, 'android');
    const appDir = path.join(androidDir, 'app');

    // 1a) 拷贝 Veepoo AAR/jar（优先 vendor/veepoo-libs，回退到原始子模块路径）
    const libsCandidates = [
      path.join(projectRoot, 'vendor/veepoo-libs'),
      path.join(projectRoot, 'hband-sdk/Android_Ble_SDK/android_sdk_source/Demo/VpBluetoothSDK/app/libs'),
    ];
    const libsSrc = libsCandidates.find((p) => fs.existsSync(p));
    const libsDst = path.join(appDir, 'libs');
    if (fs.existsSync(libsSrc)) {
      fs.mkdirSync(libsDst, { recursive: true });
      for (const f of fs.readdirSync(libsSrc)) {
        if (!veepooLibFilter(f)) continue;
        const s = path.join(libsSrc, f);
        const d = path.join(libsDst, f);
        fs.copyFileSync(s, d);
        console.log('[withVeepooSDKAndroid] copied lib', f);
      }
    } else {
      console.warn('[withVeepooSDKAndroid] libs source not found:', libsSrc);
    }

    // 1b) 拷贝原生桥 Kotlin 源
    const kotlinSrc = path.join(projectRoot, 'veepoo-assets/android/app/src/main/java');
    const kotlinDst = path.join(appDir, 'src/main/java');
    if (fs.existsSync(kotlinSrc)) {
      copyDir(kotlinSrc, kotlinDst);
      console.log('[withVeepooSDKAndroid] copied kotlin sources');
    } else {
      console.warn('[withVeepooSDKAndroid] kotlin source not found:', kotlinSrc);
    }

    return c;
  });

  // 2) 注入 build.gradle 依赖（fileTree libs + nordic + androidx）
  config = withAppBuildGradle(config, (c) => {
    const gradle = c.modResults.contents;
    const depsBlock = gradle.includes('dependencies {')
      ? gradle
      : gradle;

    let patched = depsBlock;

    // fileTree 引入 libs 下所有 aar/jar（幂等）
    if (!patched.includes("fileTree(dir: 'libs'")) {
      patched = patched.replace(
        /dependencies\s*\{/,
        `dependencies {\n    // Veepoo SDK: 引入 libs 下所有 aar/jar\n    implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])`
      );
    }

    // nordic + androidx（幂等）
    const extraDeps = [
      "    implementation 'no.nordicsemi.android:mcumgr-core:2.7.4'",
      "    implementation 'no.nordicsemi.android:mcumgr-ble:2.7.4'",
      "    implementation 'no.nordicsemi.android.support.v18:scanner:1.4.2'",
      "    implementation 'androidx.localbroadcastmanager:localbroadcastmanager:1.1.0'",
    ];
    for (const d of extraDeps) {
      if (!patched.includes(d)) {
        patched = patched.replace(/dependencies\s*\{/, `dependencies {\n${d}`);
      }
    }

    // packagingOptions: 处理多 aar 重复的 LICENSE/png
    if (!patched.includes('android.packagingOptions.pickFirsts')) {
      patched = patched.replace(
        /android\s*\{/,
        `android {\n    packagingOptions {\n        pickFirsts += ['**/LICENSE', '**/NOTICE', 'META-INF/DEPENDENCIES', 'META-INF/LICENSE', 'META-INF/NOTICE']\n    }`
      );
    }

    c.modResults.contents = patched;
    return c;
  });

  // 3) 注册 VeepooRingPackage 到 MainApplication.getPackages()
  config = withMainApplication(config, (c) => {
    const src = c.modResults.contents;

    let patched = src;
    // import（稳健：在 package 声明后插入，不依赖具体 import 文本）
    if (!patched.includes('import com.miraringfashion.app.veepoo.VeepooRingPackage')) {
      patched = patched.replace(
        /package com\.miraringfashion\.app\n/,
        'package com.miraringfashion.app\n\nimport com.miraringfashion.app.veepoo.VeepooRingPackage'
      );
    }
    // 注册包（幂等）
    if (!patched.includes('VeepooRingPackage()')) {
      patched = patched.replace(
        /return PackageList\(this\)\.packages/,
        `packages.add(VeepooRingPackage())\n            return PackageList(this).packages`
      );
    }

    c.modResults.contents = patched;
    return c;
  });

  // 4) Manifest: BluetoothKit 的 BluetoothService + BLE feature
  config = withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    const app = manifest.application && manifest.application[0];
    if (!app) return c;

    const services = app.service || (app.service = []);
    const hasBtService = services.some(
      (s) => s.$ && s.$['android:name'] === 'com.inuker.bluetooth.library.BluetoothService'
    );
    if (!hasBtService) {
      services.push({ $: { 'android:name': 'com.inuker.bluetooth.library.BluetoothService' } });
    }

    // uses-feature bluetooth_le
    const features = manifest['uses-feature'] || (manifest['uses-feature'] = []);
    const hasLe = features.some((f) => f.$ && f.$['android:name'] === 'android.hardware.bluetooth_le');
    if (!hasLe) {
      features.push({
        $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'true' },
      });
    }

    return c;
  });

  return config;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = withVeepooSDKAndroid;
module.exports.name = 'withVeepooSDKAndroid';
