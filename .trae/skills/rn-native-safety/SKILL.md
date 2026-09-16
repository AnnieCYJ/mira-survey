---
name: "rn-native-safety"
description: "React Native/Expo 项目原生侧安全规范：cache 清理白名单 + iOS Pods 误删恢复。Invoke before running any cleanup/purge command in an RN project."
---

# RN Native Safety Guardrails

**本项目（mira-app）原生目录绝对不能瞎删。** 之前误执行 `rm -rf ios/Pods ios/Podfile.lock` 导致：
- Xcode 报 `Unable to open base configuration reference file`
- pod install 重下 hermes-engine 19.7MB（Maven 源网速 ~10KB/s → 预计 30min）
- 最终靠 `ios-broken-3/` 备份 `cp -R` 恢复

## 清 Cache 白名单

### ✅ 可以安全删除（纯 JS/Metro 缓存，随时能重建）

```bash
# Metro bundle cache
rm -rf node_modules/.expo
rm -rf node_modules/.cache
rm -rf .expo
rm -rf /tmp/metro-*
rm -rf /tmp/react-*

# Xcode Derived Data（iOS build 产物，不是源码）
rm -rf ~/Library/Developer/Xcode/DerivedData/*
rm -rf ~/Library/Caches/CocoaPods/
```

### ❌ 绝对不能碰（碰了要花 30min+ 恢复）

| 路径 | 为什么不能碰 |
|------|-------------|
| `ios/Pods/` | CocoaPods 安装的原生依赖，72 个 pod + hermes-engine |
| `ios/Podfile.lock` | pod install 的快照，没它 pod install 会 fetch 所有 spec |
| `ios/Podfile` | 原生依赖声明 |
| `ios/*.xcworkspace` | Xcode 工作区（Pods 链接） |
| `ios/*.xcodeproj` | Xcode 项目文件 |
| `android/.gradle/` | Android build cache（重装 gradle wrapper 极慢） |
| `android/app/build/` | Android build 产物 |

## iOS Pods 被误删后的恢复步骤

**不要直接跑 `pod install`**——它会重新拉 hermes-engine tarball（19.7MB，Maven 源极慢）。

### 方案 A：从项目备份目录恢复（最快，10 秒）

本项目根目录下有历史备份：
```
ios-broken-3/          # 最近的可用备份（含完整 Pods + Podfile.lock）
ios-broken-20260830/   # 更早的备份
```

```bash
cd mira-app/

# 1. 清掉被删空/半残的 Pods
rm -rf ios/Pods ios/Podfile.lock

# 2. 从备份直接 cp（293MB，本地磁盘 3-5 秒）
cp -R ios-broken-3/Pods ios/Pods
cp ios-broken-3/Podfile.lock ios/Podfile.lock

# 3. 跑一次 pod install 验证（有本地 Podfile.lock 时 10-20 秒完成）
cd ios && pod install --no-repo-update
```

### 方案 B：从 CocoaPods 本地 cache 恢复（备选）

如果备份目录也没了：
```bash
# 本地 cache 位置
ls ~/Library/Caches/CocoaPods/Pods/External/hermes-engine/

# 手动 pod install（会复用本地 cache，不会重新下载）
cd ios && pod install --no-repo-update
```

### 方案 C：实在没招了（Maven 源 10KB/s，30 分钟）

```bash
cd ios && pod install    # 不带 --no-repo-update 也会先查本地 cache
```
让它跑着，别 kill。

## 操作前自检清单

在执行任何 `rm -rf` 或 `pod install` 前，先确认：
- [ ] 目标路径是 `.expo`、`node_modules/.cache`、`node_modules/.expo` 之一
- [ ] **不包含** `ios/Pods`、`ios/Podfile.lock`、`android/.gradle`
- [ ] 如果不确定，`ls` 一下目标路径的父目录看结构

## 本项目特有约定

- 原生备份目录放在项目根 `ios-broken-*/` 下（不要 commit，也不要手动删）
- Pods 恢复后**不需要**再 `pod install --repo-update`，本项目不跑 `trunk` 更新
- Expo Go 扫码跑 Metro（不跑原生 build）的场景下，Pods 可以几个月不动
