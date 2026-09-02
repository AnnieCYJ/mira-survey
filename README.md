# miraringfashion

全球首款为女性周期-心理健康而生的 AI 戒指配套 App。基于 **Expo 51 / React Native 0.74**，一套代码同时跑 iOS 与 Android。

> 应用显示名：`miraringfashion` · iOS Bundle Id / Android package：`com.miraringfashion.app`

## 快速开始（Expo Go，不用 Xcode）

```bash
npm install
npm start          # 启动 Metro
# 终端按 i 开 iOS 模拟器（需本机装了 Xcode 才有模拟器）/ a 开 Android 模拟器
npm run typecheck  # TypeScript 校验
```

真机调试：安装 **Expo Go**，扫描终端里的二维码。

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

```
mira-app/
├── App.tsx                      入口：SafeArea → AppState → Navigation → 渐变背景
├── app.json                     iOS bundleId / Android package / 权限声明
└── src/
    ├── theme/theme.ts           设计系统（颜色 / 间距 / 字号 / 阴影 / 动效 / 布局）
    ├── data/
    │   ├── metrics.ts           指标定义、趋势脚本、日周月年序列生成器
    │   ├── tasks.ts             任务类型、工具宫格、日历初始数据
    │   └── chat.ts              AI 关键词路由回复库
    ├── state/AppState.tsx       全局 Context：任务 / 工具 / 待办 / 庆祝态
    ├── navigation/              BottomTabNavigator（自定义 TabBar）
    ├── components/              18 个通用组件
    └── screens/                 Today / Insight / Focus / Meditation / Profile
```

## 五个 Tab

| Tab | 内容 |
| --- | --- |
| Today | 能量球（四象限心情打卡）、全天状态趋势、今日建议 |
| Insight | AI 综合分析横幅、五维指标切换、指标详情面板（日/周/月/年） |
| Focus | Mira AI 对话入口、Orb 点阵动画、预置问题 |
| Meditation | 任务卡组（上滑切换）、工具宫格、最近使用 |
| Profile | 月历任务追踪、完成率进度环、全部完成彩带庆祝 |

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

## 接真实数据

所有数据集中在 `src/data/` 三个文件，替换为 API 返回即可，组件层无需改动。
设计变量集中在 `src/theme/theme.ts`，改色只改这一处。
