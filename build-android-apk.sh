#!/bin/bash
# 本地构建 Android APK 一键脚本（mira-app）
# 前置：JDK17 已装 / Android SDK cmdline-tools 已装 / build-tools·platform-tools·platforms 已装
# 本脚本负责：补装 NDK 26（项目 build.gradle 要求 26.1.10909125）-> 写 local.properties -> gradle 出 release APK

export JAVA_HOME="/Users/annie/.android-toolchain/jdk17/Contents/Home"
export ANDROID_HOME="$HOME/Android/Sdk"
# ★ 2026-11-22(v81)：后台/非交互 shell 的 PATH 常丢失 workbuddy 的 node →
#   gradle getRNVersion 调 `node -e` 失败（Process 'node' exit 1）。显式补 node bin 目录。
NODE_BIN_DIR="$(dirname "$(/usr/bin/which node 2>/dev/null || command -v node 2>/dev/null)")"
if [ -z "$NODE_BIN_DIR" ] || [ "$NODE_BIN_DIR" = "." ]; then
  # fallback：workbuddy 内置 node 固定路径（按实际版本目录）
  NODE_BIN_DIR="$(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/bin 2>/dev/null | tail -1)"
fi
echo "NODE_BIN_DIR=$NODE_BIN_DIR ($( "$NODE_BIN_DIR/node" --version 2>/dev/null ))"
export PATH="$NODE_BIN_DIR:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

PROJ=/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app
cd "$PROJ" || exit 1

echo "=== [1/4] accept licenses ==="
yes | sdkmanager --licenses >/dev/null 2>&1 || true

echo "=== [2/4] NDK 26.1.10909125 已装则跳过 ==="
# ★ 2026-11-13：sdkmanager 对已安装的 NDK 仍会尝试 side-by-side 再装一份，
#   下载到一半把磁盘写满 → Gradle 连缓存锁都写不进去，BUILD FAILED / No space left on device。
#   NDK 完整标记 = source.properties + 可执行 ndk-build，齐全就绝不重装。
NDK_DIR="$ANDROID_HOME/ndk/26.1.10909125"
if [ -f "$NDK_DIR/source.properties" ] && [ -x "$NDK_DIR/ndk-build" ]; then
  echo "NDK 已存在且完整，跳过安装：$NDK_DIR"
else
  sdkmanager "ndk;26.1.10909125" 2>&1 | tail -5
fi
echo "ndk dir check:"; ls "$ANDROID_HOME/ndk" 2>/dev/null

echo "=== [3/4] write android/local.properties ==="
cat > android/local.properties <<EOF
sdk.dir=$ANDROID_HOME
ndk.dir=$ANDROID_HOME/ndk/26.1.10909125
EOF
echo "local.properties:"; cat android/local.properties

echo "=== [4/4] gradle assembleRelease (no daemon, serialized) ==="
cd android
chmod +x gradlew
./gradlew assembleRelease --no-daemon --stacktrace 2>&1 | tail -80
echo "BUILD_EXIT=${PIPESTATUS[0]}"

echo "=== APK output ==="
ls -lh app/build/outputs/apk/release/*.apk 2>/dev/null && echo "APK_READY" || echo "NO_APK"
