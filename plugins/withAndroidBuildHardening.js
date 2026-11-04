"use strict";
// 安卓构建加固（针对 EAS 免费档内存不足 / daemon 被 OOM 杀）：
//   1) 限制 ndk ABI 只打手机需要的 arm64-v8a + armeabi-v7a（减小最终 APK，
//      但注意：库模块的 native CMake 编译量不受此影响，仅 app 打包阶段生效）。
//   2) 关闭 Gradle 并行 + 限制 worker 数 + 收 JVM heap：让 native 编译与
//      Metro JS 打包【串行】执行，削平内存峰值，避免免费档构建机 OOM。
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

const withMemory = (config) => {
  return withGradleProperties(config, (c) => {
    // 串行执行，削平峰值内存（免费档关键）
    c.modResults["org.gradle.parallel"] = "false";
    c.modResults["org.gradle.workers.max"] = "1";
    // 适度 heap，给 native clang / node metro 留出内存
    c.modResults["org.gradle.jvmargs"] = "-Xmx2048m -XX:MaxMetaspaceSize=512m";
    c.modResults["kotlin.daemon.jvmargs"] = "-Xmx1024m";
    c.modResults["kotlin.parallel.threads"] = "1";
    c.modResults["org.gradle.caching"] = "true";
    return c;
  });
};

const withAndroidBuildHardening = (config) => {
  config = withMemory(config);
  config = withAbiFilters(config);
  return config;
};

module.exports = createRunOncePlugin(
  withAndroidBuildHardening,
  "android-build-hardening",
  "1.0.0"
);
