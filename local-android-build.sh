#!/usr/bin/env bash
# 本地 Android APK 构建（一条龙）：解压 SDK → 装组件 → prebuild → gradle 出包
# 前置：source local-build-env.sh 已设好 JAVA_HOME / ANDROID_HOME
set -e
cd "$(dirname "$0")"
source ./local-build-env.sh

SDK_ZIP=/tmp/cmdtools.zip
DEST="$HOME/Android/Sdk"

echo "===== [1/5] 解压 Android cmdline-tools ====="
rm -rf /tmp/cmdline-extract
mkdir -p /tmp/cmdline-extract "$DEST/cmdline-tools"
unzip -q -o "$SDK_ZIP" -d /tmp/cmdline-extract
rm -rf "$DEST/cmdline-tools/latest"
mv /tmp/cmdline-extract/cmdline-tools "$DEST/cmdline-tools/latest"
echo "cmdline-tools -> $DEST/cmdline-tools/latest"

echo "===== [2/5] 安装 SDK 组件（platform-tools / android-34 / build-tools 34 / ndk 25） ====="
export PATH="$DEST/cmdline-tools/latest/bin:$PATH"
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;25.1.8937393"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
echo "SDK 组件就绪"

echo "===== [3/5] expo prebuild（应用 app.json 里的加固插件） ====="
npm install --no-audit --no-fund 2>&1 | tail -3 || true
npx expo prebuild --platform android --clean
echo "prebuild 完成"

echo "===== [4/5] gradle assembleRelease（串行化 + 单 worker + 收 heap，压低峰值内存） ====="
cd android
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40
echo "gradle 完成"

echo "===== [5/5] 产物 ====="
APK=$(find "$PWD" -name "*.apk" -path "*release*" | head -1)
if [ -n "$APK" ]; then
  echo "APK -> $APK"
  ls -lh "$APK"
else
  echo "未找到 release APK，列出所有 apk："
  find "$PWD" -name "*.apk" | head
fi
