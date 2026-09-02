#!/bin/zsh
# Mira App 一键启动 Metro（自动 cd 到工程目录 + 清缓存 + 启动）
# 用法 A：在 Finder 里双击本文件（会在 Terminal 打开并运行，请勿关闭窗口）
# 用法 B：终端里运行  bash /Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app/start-metro.command

# 1) 切到 mira-app 工程目录（之前 ConfigError 就是因为在 ~ 下跑，找不到 package.json）
cd /Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app || {
  echo "❌ 找不到 mira-app 工程目录，请检查路径"
  exit 1
}

# 2) 清 Metro / Expo 缓存（zsh 安全写法，无匹配文件也不报错）
echo "🧹 正在清除 Metro / Expo 缓存..."
setopt NULL_GLOB 2>/dev/null
rm -rf "$TMPDIR"/metro-* 2>/dev/null
rm -rf "$HOME/.expo" 2>/dev/null
echo "✅ 缓存已清"

# 3) 启动 Metro（-c 会再清一次缓存并重新打包 JS）
echo "🚀 启动 Metro（此窗口请勿关闭）..."
exec npx expo start -c
