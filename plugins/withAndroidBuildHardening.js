"use strict";
// 安卓构建加固：解决 EAS 云构建 Gradle daemon 在重度原生/CMake 编译
// （expo-modules-core + expo-av，4 个 ABI 并行）时被压垮（OOM / 被杀）
// 导致 EAS_BUILD_UNKNOWN_GRADLE_ERROR 的问题。
//   1) 限制 ndk ABI 只打手机需要的 arm64-v8a + armeabi-v7a，
//      砍掉 x86 / x86_64 原生编译负担（内存/磁盘/时长约减半）。
//   2) 给 Gradle / Kotlin daemon 加大 JVM 堆，降低 native 编译 OOM 概率。
const {
  withAppBuildGradle,
  withGradleProperties,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const ABI_FILTERS = '"arm64-v8a", "armeabi-v7a"';

const withAbiFilters = (config) => {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (!g.includes("abiFilters")) {
      g = g.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ndk { abiFilters ${ABI_FILTERS} }`
      );
    }
    c.modResults.contents = g;
    return c;
  });
};

const withHeap = (config) => {
  return withGradleProperties(config, (c) => {
    c.modResults["org.gradle.jvmargs"] =
      "-Xmx4g -XX:MaxMetaspaceSize=512m -Dkotlin.daemon.jvmargs=-Xmx2g";
    c.modResults["org.gradle.parallel"] = "true";
    c.modResults["org.gradle.caching"] = "true";
    return c;
  });
};

const withAndroidBuildHardening = (config) => {
  config = withHeap(config);
  config = withAbiFilters(config);
  return config;
};

module.exports = createRunOncePlugin(
  withAndroidBuildHardening,
  "android-build-hardening",
  "1.0.0"
);
