# miraringfashion

全球首款为女性周期-心理健康而生的 AI 戒指配套 App。基于 **Expo 51 / React Native 0.74**，一套代码同时跑 iOS 与 Android。

> 应用显示名：`miraringfashion` · iOS Bundle Id / Android package：`com.miraringfashion.app`

## 当前归档版本（Android）

| 项目 | 值 |
| --- | --- |
| 平台 / 构建 | **Android**（Expo 51 · RN 0.74 · 真机开发构建） |
| 版本 | **1.4.7** · versionCode **36** |
| 归档时间 | **2026-11-16 00:00 (GMT+8)** |
| Git tag | `v-ui-20261115-2320`（对应 `src/version.ts`）· `v-android-1.4.7-20261116` |
| 安装包 | [mira-app-1.4.7-36.apk](https://app.lunamiraring.com/downloads/mira-app-1.4.7-36.apk)（78.9 MB · **正式签名 `CN=LunaMira`**） |
| SHA-256 | `30972ccb83a5b4bd26955e2f997bd8f4736feae3dbdf324be608a7a455d34159` |
| 真机验收 | OPPO PMA110（API 36）：冷启动重连 / 断连被动监听→自动重连→重连即回填闭环通过；白屏回归已修；`tsc` 0 错误、离线回归 11/11 |

> **升级注意**：1.4.6 及更早是 debug 签名，本版起切正式签名（`CN=LunaMira`）。已装旧版**无法覆盖安装，需先卸载再安装**；戒指端历史数据会在重连后自动回填，不会丢失。
> 仓库分支说明：`master` = App 线（本仓库），`main` = Mira 调研问卷（mira-survey），两者互不相干。

## 快速开始

项目包含原生 BLE、语音与本地 AI 模块，完整功能需要开发构建或 Xcode / Android Studio，Expo Go 无法提供这些模块。

```bash
npm install
npm start
npm run ios       # iOS 开发构建
npm run android   # Android 开发构建
npm run typecheck
node --test scripts/test-uiux.cjs  # 表单与本地收藏回归测试
```

## 在 Xcode 里原生运行（推荐真机/模拟器）

原生 iOS 工程已用 `npx expo prebuild --platform ios --no-install` 生成在 `ios/` 目录（含 `miraringfashion.xcworkspace` 所需的 `Podfile`）。`pod install` 需联网拉 RN/Expo 的 pods，请在**本机**执行：

```bash
# 1. 安装 CocoaPods（若尚未安装）
sudo gem install cocoapods      # 或：brew install cocoapods

# 2. 安装 pods（首次会拉取依赖，约几分钟~十几分钟，需要正常网络/VPN）
cd mira-app/ios
pod install

# 3. 用 Xcode 打开 workspace（注意是 .xcworkspace，不是 .xcodeproj）
open miraringfashion.xcworkspace
```

在 Xcode 中：
- 顶部设备菜单选 **iOS 模拟器**（如 iPhone 16）或连上的真机，按 **⌘R** 运行。
- **真机签名**：Targets → `miraringfashion` → Signing & Capabilities → Team 选你的 Apple ID（免费账号即可）；Bundle Id 保持 `com.miraringfashion.app`。
- 模拟器无需签名，选 Automatic 即可。

> 若 `pod install` 卡在拉 GitHub，请确认网络/VPN 正常——CocoaPods 源在 GitHub 上。

## 修改应用名 / Bundle Id

编辑 `app.json` 的 `name` / `slug` / `scheme` / `ios.bundleIdentifier` / `android.package`，然后重跑：
```bash
npx expo prebuild --platform ios --no-install --clean
cd ios && pod install && open miraringfashion.xcworkspace
```

## 目录结构

```text
mira-app/
├── App.tsx                  应用入口、全局状态、语音与导航
├── src/
│   ├── theme/               共享颜色、布局、动效与图表变量
│   ├── screens/             主页面与指标、周期、工具详情
│   ├── components/          指标卡、图表、表单、弹层、AI 建议
│   ├── navigation/          底部导航与原生详情页导航
│   ├── ble/                 戒指连接与同步
│   ├── data/                健康数据、周期记录与本地存储
│   ├── lib/                 评分算法、建议逻辑与档案校验
│   ├── ai/、hooks/          本地 AI、语音与状态订阅
│   └── assets/              内容图片、音频与视频
├── ios/、android/           原生工程
├── docs/                    设计规范、算法与改动记录
├── preview/                 历史 HTML 设计预览
└── scripts/                 运行、导出与回归检查
```

## 主导航

| 入口 | 内容 |
| --- | --- |
| 今日 | 今日状态、五项指标、状态趋势与 AI 建议 |
| 洞察 | 睡眠与周期、身体指标、参考估算及详细分析 |
| 工具 | 情绪调节、呼吸、冥想、营养与科普、我的建议 |
| 我的 | 日历与任务记录 |
| Mira AI | 点击进入聊天，长按说话，松手结束 |

主导航以 `src/navigation/BottomTabNavigator.tsx` 为准；HTML 预览是历史方案，不代表当前原生界面。

## 平台差异处理

- **安全区**：所有页面走 `react-native-safe-area-context`；TabBar 在 Android 上兜底 `max(insets.bottom, 8)`。
- **键盘**：ChatSheet 用 `KeyboardAvoidingView`，iOS `padding` / Android `height`，并按 insets 补底部内边距。
- **状态栏**：`translucent` + `light-content`，顶部渐变自然延伸。
- **手势**：任务卡组用 `PanResponder` + `useNativeDriver`，两端都是 60fps。
- **Android 边缘到边缘**：`app.json` 开启 `edgeToEdgeEnabled`。

## 已修复的原始文档缺陷

1. `ProfileScreen` 使用了 `celebration / triggerCelebration / dismissCelebration`，但原 `AppState` 未定义 → 已补齐。
2. `Chip` 选中态把 `onPress` 直接传给 `LinearGradient`，点击无效 → 改为 `TouchableOpacity` 包裹。
3. `Confetti` 在 render 里调 `Math.random()`，每次重渲染粒子位置都会跳变 → 参数改为一次性生成存 state。
4. `AppState.addToolTask` 依赖 `tools` 闭包、`completeTask` 读取过期 state → 改用 ref 读取最新值。
5. `chat.ts` 中「累/疲劳」规则包含 `sleep`/`睡眠`，导致所有睡眠问题都被疲劳话术拦截 → 独立出「入睡/深睡/失眠」规则。
6. `CalendarGrid` 从 `AppState` 导入常量形成循环依赖隐患 → 改为直接从 `data/tasks` 导入。

## 健康数据与设计变量

戒指同步由 `src/ble/` 管理，健康数据存储与衍生指标分别位于 `src/data/`、`src/lib/`。身体成分和身体年龄展示为参考估算；年龄缺失、节律或综合数据不足时不生成身体年龄差值。

基础变量位于 `src/theme/theme.ts`，五色系统位于 `src/theme/mindmate.ts`，图表变量位于 `src/theme/chart.ts`。修改颜色时应检查实际文字与背景的组合。

本轮优化与验证记录见 `docs/uiux-optimization-2026-10-10.md`。
