#!/usr/bin/env bash
# 把端侧 Qwen2.5-1.5B gguf 模型推送到已连接的 Android 设备（P30 等），
# 供 llama.rn 在 Android 端加载（见 src/ai/model.ts 的 Android 分支）。
#
# 用法：bash scripts/push-model-android.sh
#
# 说明：
#   - iOS 走 app bundle 资源；Android 没有 bundle 概念，模型需预先推到
#     /data/data/com.miraringfashion.app/files/（app 私有 files 目录）。
#   - 模型约 1.0GB，首次推送较慢，请耐心等待。
#   - 仅调试/内测用；正式发布应把模型打进 android/app/src/main/assets/。

set -e
ADB="${ADB:-adb}"
PKG="com.miraringfashion.app"
MODEL="qwen2.5-1.5b-instruct-q4_k_m.gguf"
SRC="ios/miraringfashion/${MODEL}"

if [ ! -f "$SRC" ]; then
  echo "✗ 找不到模型文件：$SRC"
  echo "  请确认 iOS 资源目录下的 gguf 存在，或改为指向你的模型路径。"
  exit 1
fi

echo ">> 设备检测…"
"$ADB" devices -l | grep -qw device || { echo "✗ 未检测到已连接设备"; exit 1; }

echo ">> 推送 ${MODEL} 到设备临时目录 /data/local/tmp（shell 可写）…"
"$ADB" push "$SRC" "/data/local/tmp/${MODEL}"

echo ">> 以 app 身份（run-as）拷入私有 files 目录（/data/data/${PKG}/files/）…"
"$ADB" shell "run-as ${PKG} sh -c 'cat /data/local/tmp/${MODEL} > /data/data/${PKG}/files/${MODEL} && chmod 644 /data/data/${PKG}/files/${MODEL}'"

echo ">> 校验…"
"$ADB" shell "run-as ${PKG} ls -l /data/data/${PKG}/files/${MODEL}" | grep -q "${MODEL}" \
  && echo "✓ 推送完成。重启 App 即可在 P30 上跑端侧 AI。" \
  || { echo "✗ 推送校验失败（可改用 bundle 进 assets 的方式）"; exit 1; }
