#!/usr/bin/env bash
# Mira App · 安卓开发模式（华为 P30 / 任意 Android 真机）
#
# 一次安装 debug APK 之后，所有 JS/TS 改动（前端 UI、算法、文案、样式）
# 由 Metro 热更新推送，保存即生效，不需要重新打包、不需要重新下载安装。
#
# 用法：
#   ./dev-p30.sh              # 装包 + 端口映射 + 启动 Metro（USB 连着电脑）
#   ./dev-p30.sh start        # 只启动 Metro（App 已装好）
#   ./dev-p30.sh install      # 只安装/覆盖 debug APK
#   ./dev-p30.sh wifi         # 打印无线模式设置指引（不连 USB）
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Expo SDK 51 / Metro 0.80 官方支持 Node 18/20，本机默认是 Node 22。
# 用独立安装的 Node 20 启动，避免运行时版本兼容问题（不改系统环境）。
NODE20_BIN="/Users/annie/.android-toolchain/node20/bin"
if [[ -x "$NODE20_BIN/node" ]]; then
  export PATH="$NODE20_BIN:$PATH"
fi
# 本地开发服务不需要 HTTP 代理，代理反而可能拖住 Expo CLI 启动。
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy || true

ADB="${ADB_PATH:-/opt/homebrew/bin/adb}"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
PKG="com.miraringfashion.app"
PORT=8081
MODE="${1:-all}"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '未获取')"

print_header() {
  echo ""
  echo "=========================================================="
  echo "  Mira App · 开发模式（改代码即时生效，免重新打包）"
  echo "  电脑 IP: $LAN_IP    Metro 端口: $PORT"
  echo "=========================================================="
}

check_apk() {
  if [[ ! -f "$APK" ]]; then
    echo "✗ 未找到 debug APK：$APK"
    echo "  先构建一次：cd android && ./gradlew :app:assembleDebug --no-daemon"
    exit 1
  fi
}

install_apk() {
  check_apk
  echo "→ 安装/覆盖 debug APK（与 release 同签名，可直接覆盖，数据保留）"
  "$ADB" install -r "$APK"
  echo "✓ 安装完成"
}

setup_usb() {
  echo "→ 建立 USB 端口映射：手机 $PORT → 电脑 $PORT"
  "$ADB" reverse --remove-all >/dev/null 2>&1 || true
  "$ADB" reverse "tcp:$PORT" "tcp:$PORT"
  echo "✓ 端口映射就绪"
}

launch_app() {
  echo "→ 启动 App"
  "$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
}

start_metro() {
  BUSY="$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$BUSY" ]]; then
    echo "⚠ 端口 $PORT 已被占用（PID: $BUSY）。"
    echo "  如果是上一次的 Metro，停掉它再跑： kill $BUSY"
    echo "  确认是别的服务则改本脚本的 PORT。"
    exit 1
  fi

  local NODE_BIN="$NODE20_BIN/node"
  local EXPO_CLI="$ROOT/node_modules/expo/bin/cli"
  [[ -x "$NODE_BIN" ]] || { echo "✗ 缺少 Node 20：$NODE_BIN"; exit 1; }
  [[ -f "$EXPO_CLI" ]] || { echo "✗ 缺少 Expo CLI：$EXPO_CLI"; exit 1; }

  echo "→ Node: $("$NODE_BIN" -v)   启动环境: 干净环境（env -i，隔离注入变量）"
  echo "→ 启动 Metro（保持这个终端不要关）"
  echo "  改完 .tsx / .ts 文件保存后，手机会自动 Fast Refresh（1~2 秒）"
  echo "  摇一摇手机 或 执行 $ADB shell input keyevent 82 打开开发者菜单"
  echo ""
  cd "$ROOT"

  # 【关键修复 2026-11-06】WorkBuddy / 各类 CLI 会往 shell 注入 120+ 个环境变量
  # （HTTP 代理、另一个 Node 22 的路径、NODE_DEBUG 等）。在这种环境里 Metro 的
  # `.bundle` 请求会永久挂起，且真实错误被吞掉，表现为「一直转圈 / 红屏」。
  # 用 env -i 起最小干净环境 + 独立 Node 20，实测首次打包 4 秒完成、HTTP 200。
  # 另外直接调用 expo/bin/cli（不用 npx），避免 npx 的 shebang 再挑错 Node。
  # 不要设 CI=1：CI 模式会关闭文件监听与 Fast Refresh。
  exec env -i \
    HOME="$HOME" \
    USER="$(id -un)" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-en_US.UTF-8}" \
    PATH="$NODE20_BIN:/usr/bin:/bin" \
    EXPO_NO_TELEMETRY=1 \
    EXPO_NO_BROWSER=1 \
    "$NODE_BIN" "$EXPO_CLI" start --host lan --port "$PORT"
}

print_wifi_guide() {
  cat <<EOF

无线模式（不插 USB，手机和电脑连同一个 WiFi）：
  1. 先跑一次 ./dev-p30.sh start 让 Metro 在电脑上跑起来
  2. 打开 App（会红屏，属正常）→ 摇一摇 → Dev Settings
     → 「Debug server host & port for device」填：  $LAN_IP:$PORT
     → 确认后返回，摇一摇 → Reload
  3. 这个 host 只需填一次，之后每次启动 App 都会自动连 Metro
  4. 换 WiFi / 电脑 IP 变了，重新填一次即可

注意：USB 模式更稳，且不影响蓝牙连戒指，测 BLE 推荐插线。
EOF
}

print_header

case "$MODE" in
  install)
    install_apk
    ;;
  start)
    start_metro
    ;;
  wifi)
    print_wifi_guide
    ;;
  all)
    if ! "$ADB" devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'; then
      cat <<EOF
⚠ 没有检测到 USB 连接的手机。Metro 仍会启动，可用无线模式连：
   ./dev-p30.sh wifi

手机端准备（只需做一次）：
  设置 → 关于手机 → 连点「版本号」7 次 → 开发者选项
  → 打开「USB 调试」，并关闭「监控 ADB 安装应用」
  → 数据线连接电脑，弹窗点「允许 USB 调试」

EOF
      start_metro
      exit 0
    fi
    install_apk
    setup_usb
    launch_app
    start_metro
    ;;
  *)
    echo "未知参数：$MODE（可用：all / start / install / wifi）"
    exit 1
    ;;
esac
