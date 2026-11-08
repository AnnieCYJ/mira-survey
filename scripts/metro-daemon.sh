#!/usr/bin/env bash
# Metro 常驻守护（由 com.mira.metro LaunchAgent 托管）
# ---------------------------------------------------------------------------
# 背景：debug APK 不含 JS bundle，界面代码全靠电脑上的 Metro 实时下发。
# 之前 Metro 挂在终端/会话后台，会话一结束就被回收 → 手机只能显示缓存的旧 JS，
# 表现为「代码明明改了、手机却一直是旧版」。
# 本脚本交给 launchd 托管：开机自启、崩溃自动拉起、不依赖任何对话会话。
# ---------------------------------------------------------------------------
PORT=8081
ROOT="/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app"

# 端口已被占用 = 已有 Metro 在跑（例如手动 ./dev-p30.sh start），正常退出，
# 且 SuccessfulExit=true 不会触发 launchd 的异常重启风暴。
if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT" || exit 1
# dev-p30.sh 内部用 env -i 干净环境 + Node 20，绕开注入变量导致 .bundle 挂起的问题。
exec ./dev-p30.sh start
