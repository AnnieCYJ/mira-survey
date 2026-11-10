#!/usr/bin/env bash
# 重新构建 debug APK（仅在改动了原生层时才需要，见说明文档第三节）
# 自动带上本地 JDK17，并把成品拷到交付目录。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
JDK="/Users/annie/.android-toolchain/jdk17/Contents/Home"
OUT="${1:-/Users/annie/WorkBuddy/2026-11-04-11-40-45/mira-app-android-debug.apk}"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"

# ★ 2026-11-07 安全护栏（务必保留）
# 手机上已装的 debug APK 里，原生桥是完整实现（classes4.dex 内含 readOriginDataAll /
# mergeSlot / flushBatches / syncHealthData / VeepooAutoBridge），但磁盘上这份
# VeepooRingModule.kt 一度回退成 394 行旧桩：backfillSince 只打 log、不发 onBatch，
# 且磁盘缺 VeepooAutoBridge.kt。用这份桩重编译**能 BUILD SUCCESSFUL**，却会静默丢掉
# 全部 v3 离线数据读取 —— 是最危险的一种「编译通过但功能倒退」。
# 因此在恢复完整源码之前，一律拒绝重编译。
BRIDGE="$ROOT/android/app/src/main/java/com/miraringfashion/app/veepoo/VeepooRingModule.kt"
# ★ 2026-11-10：原生函数曾由 readOriginDataAll 改名 readOriginData（见当前 1246 行完整版，含 6 处
#   readOriginData / 12 处 onBatch / 3 处 backfillSince）。旧桩（.stub-20261107.bak，394 行）两者皆无。
#   判别式改用 readOriginData：完整版有、旧桩为 0，可正确放行真实桥体、继续拦住旧桩。
if ! grep -qE 'readOriginData' "$BRIDGE"; then
  echo "✗ 拒绝构建：$BRIDGE 是旧桩（缺 readOriginData）。"
  echo "  已装 APK 的完整原生实现只存在于 classes4.dex，重编译前必须先恢复完整 Kotlin 源码"
  echo "  和 VeepooAutoBridge.kt，否则会覆盖掉手机上正在工作的原生层。"
  exit 1
fi

echo "→ 本地增量构建 debug APK（JDK17，不走 EAS）"
cd "$ROOT/android"
./gradlew :app:assembleDebug --no-daemon

if [[ ! -f "$APK" ]]; then
  echo "✗ 构建结束但未找到 $APK"
  exit 1
fi
cp "$APK" "$OUT"
echo "✓ 完成：$OUT ($(du -h "$OUT" | awk '{print $1}'))"
echo "  装到手机：adb install -r \"$OUT\"   或 ./dev-p30.sh install"
