#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# BLE 连接链路 · 真机冒烟测试（任意 Android 手机一键验证）
# ---------------------------------------------------------------------------
# 用法：
#   ./scripts/ble-smoke.sh                          # 用当前 adb 连接的手机，验证已装 App
#   ./scripts/ble-smoke.sh <serial>                # 指定设备
#   ./scripts/ble-smoke.sh <serial> <apk路径>       # 先装指定 APK 再验证
#
# 验证链路：冷启动 → 运行时权限 → 扫描全量戒指 → 按数量决策
#           → (1 枚) 自动直连 / (≥2 枚) 列出待选 → 连接成功 → 数据回流
# 退出码：0 = 全绿；1 = 有 FAIL（日志路径会打印出来供排查）
#
# 为什么需要它：发给用户前，换任何一台手机跑一遍就知道连不连得上，
#              不用靠"我这台 OPPO 试过没问题"来赌。
# ---------------------------------------------------------------------------
set -u
export PATH="/opt/homebrew/bin:$PATH"

SERIAL="${1:-}"
APK="${2:-}"
if [ -n "$SERIAL" ]; then ADB="adb -s $SERIAL"; else ADB="adb"; fi
PKG="com.miraringfashion.app"
WAIT="${SMOKE_WAIT:-26}"
LOG="/tmp/mira-ble-smoke-$(date +%Y%m%d-%H%M%S).log"

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
say()  { echo; echo "== $1 =="; }

assert_log() {
  local pattern="$1" label="$2"
  if grep -qE "$pattern" "$LOG"; then ok "$label"; else bad "$label"; fi
}
assert_no_log() {
  local pattern="$1" label="$2"
  if grep -qE "$pattern" "$LOG"; then bad "$label（日志里出现了）"; else ok "$label"; fi
}

say "0/5 设备与安装"
if ! $ADB devices | grep -qw "device"; then
  echo "  ❌ 没有 adb 设备，先连上手机并打开 USB 调试"; exit 1
fi
ok "adb 设备已连接：$($ADB get-serialno 2>/dev/null)"
if [ -n "$APK" ]; then
  if $ADB install -r "$APK" 2>&1 | grep -q "Success"; then ok "APK 安装成功"; else bad "APK 安装失败"; fi
fi
$ADB logcat -G 16M >/dev/null 2>&1

say "1/5 冷启动并抓日志（${WAIT}s）"
$ADB shell am force-stop "$PKG"
$ADB logcat -c
$ADB shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep "$WAIT"
$ADB logcat -d -v time > "$LOG" 2>&1
echo "  日志 $(wc -l < "$LOG" | tr -d ' ') 行 → $LOG"

say "2/5 运行时蓝牙权限"
PERMS=$($ADB shell dumpsys package "$PKG" 2>/dev/null)
for P in BLUETOOTH_SCAN BLUETOOTH_CONNECT; do
  if echo "$PERMS" | grep -q "$P: granted=true"; then ok "$P 已授予"; else bad "$P 未授予（全新安装必连不上）"; fi
done
assert_no_log "permission_denied" "没有出现权限被拒"

say "3/5 扫描 → 最终数量决策"
assert_log "\[autoLink\].*扫描全部戒指" "启动改为先扫描（不再按 MAC 直连）"
assert_log "\[VeepooRing ANDROID\] scan start" "原生 BLE 扫描真的启动"
assert_log "scan finished, devices=" "原生上报扫描结束 final 帧"
assert_log "\[Scan\] 扫描结束，最终 [0-9]+ 台" "JS 收到最终设备列表"
if grep -qE "检测到 [2-9][0-9]* 枚戒指 → 全部列出" "$LOG"; then
  N=$(grep -oE "检测到 [0-9]+ 枚戒指" "$LOG" | tail -1 | grep -oE "[0-9]+")
  ok "检测到 $N 枚戒指 → 全部列出等用户选（符合规则，不自动连）"
elif grep -qE "只检测到 1 枚戒指" "$LOG"; then
  ok "只检测到 1 枚戒指 → 自动直连（符合规则）"
  assert_log "\[VeepooRing ANDROID\] connect [0-9A-Fa-f:]{17}" "发起了真实 GATT 直连"
  assert_log "BLE connected" "戒指连接成功"
  assert_log "applyPatch status:', 'connected'" "状态机落到 connected"
else
  bad "没有出现任何决策结果（扫描链路可能断了）"
fi
assert_no_log "undefined is not a function" "无 JS 运行时断链"
assert_no_log "connect_failed|notify_failed" "无连接失败回调"

say "4/5 数据能读出来（仅自动直连时要求）"
if grep -qE "只检测到 1 枚戒指" "$LOG"; then
  if grep -qE "origin3 requested|oxygenAnalysis reading|sleep d=|function support:" "$LOG"; then
    ok "戒指已开始回传真实数据（功能表/睡眠/历史读数至少一项）"
  else
    bad "连上了但没有数据回流（等 30s 后可重跑确认）"
  fi
else
  ok "多设备待选场景，跳过（用户点选后才连）"
fi

say "5/5 汇总"
echo "  PASS=$PASS  FAIL=$FAIL  日志=$LOG"
if [ "$FAIL" -gt 0 ]; then echo "  ❌ 冒烟未通过，禁止发版"; exit 1; fi
echo "  ✅ 冒烟通过"
exit 0
