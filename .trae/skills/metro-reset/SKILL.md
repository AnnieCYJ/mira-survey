---
name: "metro-reset"
description: "一键清 Metro 缓存 + 重启 + 验证 Bundle 200。Invoke when user says '清metro'、'清 metro'、'reset metro'、'重启 metro'、'metro 卡住' 或 App 红屏/Bundle 报错需要清缓存。"
---

# Metro Reset

React Native 开发中 Metro bundler 经常因为缓存、模块状态、HMR 状态乱掉导致红屏、旧代码不更新、甚至 crash。这个 skill 用一条命令链彻底清干净并重启，附带 Bundle 验证。

## 触发条件

用户说以下任意关键词时必须执行本 skill：
- "清metro" / "清 metro"
- "reset metro" / "重启 metro"
- "metro 卡住" / "metro 不对"
- App 红屏、Bundle 报错、旧代码不生效，怀疑缓存问题

## 执行步骤

在项目根目录（包含 `package.json` 和 `ios/` `android/` 子目录的那个目录）执行：

```bash
# 1. 杀掉所有 react-native start 进程
pkill -f "react-native start" 2>/dev/null

# 2. 释放 8081 端口（万一残留）
sleep 2
lsof -ti:8081 | xargs kill -9 2>/dev/null

# 3. 删 Metro 缓存 + 所有 RN 相关缓存
rm -rf node_modules/.cache

# 4. 带 --reset-cache 重启 Metro（输出到日志文件，方便查错）
npx react-native start --reset-cache 2>&1 > /tmp/metro.log &

# 5. 等 Metro 起来（冷启动约 12-18 秒）
sleep 15

# 6. 验证 Bundle 能否正常加载（HTTP 200 = 成功）
curl -s -o /dev/null -w "Bundle HTTP %{http_code}\n" "http://localhost:8081/index.bundle?platform=ios" --max-time 15
```

### 预期输出

成功时最后一行是 `Bundle HTTP 200`。如果是别的（4xx/5xx/空/超时）：
- 查 `/tmp/metro.log` 里的红色 ERROR
- 看是否有 TypeScript 编译错误
- 再跑一次 `rm -rf node_modules/.cache` 重试

### 失败兜底

如果上面的命令链执行后 Metro 还是不起来，执行更激进的清理：

```bash
rm -rf $TMPDIR/metro-* 2>/dev/null
rm -rf ~/.react-native-packager 2>/dev/null
rm -rf node_modules
npm install
# 然后重新走上面 1-6 步
```

## 注意事项

- **必须在项目根目录执行**（`npx react-native start` 依赖 package.json）
- `--reset-cache` 会让冷启动慢 5-10 秒（所有模块重新编译），但能彻底排除缓存问题
- Bundle 验证是 iOS，Android 同理用 `platform=android`
- 重启后记得让用户**强杀 App 重新打开**（HMR 状态已清，旧 App 进程连不上新 Metro）
