#!/usr/bin/env bash
# 本地 Android 构建环境变量（source 后使用）
export JAVA_HOME="/Users/annie/.android-toolchain/jdk17/Contents/Home"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# 降低 gradle 峰值内存（串行化已在插件中设置 org.gradle.parallel=false）
export GRADLE_OPTS="-Xmx2g -XX:MaxMetaspaceSize=512m"
echo "[local-build-env] JAVA_HOME=$JAVA_HOME"
echo "[local-build-env] ANDROID_HOME=$ANDROID_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1
