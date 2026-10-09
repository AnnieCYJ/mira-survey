# mira-app 交互卡顿取证报告（2026-10-08）

> 方法：rn-motion-interaction-audit skill 取证命令 + 代码阅读。
> 结论先行：**卡顿主因不是缺动画库，而是 3 个工程问题**。按投入产出比排序如下。

## 取证数据（2026-10-08 快照）

| 维度 | 现状 | 判定 |
|---|---|---|
| 动画库 | 无 Reanimated / Moti / Skia，全部 RN 内置 Animated | 不是主因 |
| useNativeDriver:false | 仅 3 处 | ✅ 良好 |
| 滚动联动 | ScreenContainer 已用 Animated.event + 原生驱动 | ✅ 已做对 |
| 组件内部定义组件 | 0 处（宽松匹配） | ✅ 干净 |
| memo / useMemo / useCallback | 24 / 199 / 60 | ✅ 有意识 |
| **透明卡片转场** | **12+ 个 stack screen `cardStyle: transparent`** | ❌ 问题 1 |
| **导航器类型** | JS `createStackNavigator`（react-native-screens 已装但未用 native stack） | ❌ 问题 2 |
| **未 memo 化重计算** | 修正（21:30 复核）：`computeCognitiveLoadReport` / `computeStressReport` 内部有缓存（日期+版本+30s 窗），多亏调用无害；**真无缓存的是 `analyzeCortisol`（14 天 cosinor，causeNarrative 处每次渲染重跑）、`computeEmotionalStress`、`computeSleepPersonalized`** | ❌ 问题 3（范围比初判小） |
| 列表虚拟化 | 31 个 ScrollView，0 个 FlatList；BodyCompositionHistory 等全量 `.map()` | ⚠️ 次要 |
| duration 档位 | **34 种**（0–32000ms；UI 过渡约 20 种） | ❌ 不统一 |
| Easing | 9 种；进场疑似用 Easing.inOut（32 次） | ⚠️ |
| activeOpacity | **10 种**（0.6–1.0） | ❌ 手感不一 |
| 触感反馈 | **0 处 Haptics** | ❌ 缺失 |
| motion token | theme.motion 存在但仅 19 处使用 | ⚠️ 有 token 没用 |
| 物理引擎 | matter-js 在 EmotionLogCard / EmotionLogScreen（JS 线程逐帧物理） | ⚠️ |
| 死代码 | TodayScreen 前 ~1100 行为死组件（含 IIFE 重计算），徒增 bundle 与维护成本 | ⚠️ |
| 架构 | newArchEnabled: **false**（Paper） | 决定选型约束 |

## 三个根因与修法

### 1. 页面跳转卡 → 透明卡片 + JS 导航器（最高优先，改动最小）
- 你们已在 VoiceChat 上验证过：`cardStyle` 不透明 → 不再合成背后 TodayScreen → 「更丝滑」（RootStackNavigator.tsx:71 注释）。**把其余 12 个 transparent screen 全部改成不透明**（底色给 `theme.colors.bgTop` 或各自页面渐变底色即可）。
- `createStackNavigator` → `createNativeStackNavigator`（react-native-screens 3.31.1 已在依赖里）。iOS 转场由原生驱动，不再走 JS interpolator。注意：`CardStyleInterpolators` 在 native stack 下不可用，需删掉对应配置。
- 转场期间重页（TodayScreen 1971 行）首帧渲染重 → 进详情页先出骨架，`InteractionManager.runAfterInteractions` 再挂图表。

### 2. 滑动/图表切换卡 → 未缓存算法的重算（修正版）
- 复核结论：`computeCognitiveLoadReport`（cognitiveLoad.ts:690-697）与 `computeStressReport` **内部已有缓存**，TodayScreen 里的多次调用是命中缓存、代价小 —— 初判「×3 重算」不成立，在此更正。
- 真正每次渲染都重算的（均无内部缓存）：
  - `analyzeCortisol(collectSamples(), 14)` —— TodayScreen.tsx:1001-1002，多因分析胶囊的皮质醇段，14 天 cosinor 拟合
  - `computeEmotionalStress(Date.now(), sportSessions)` —— TodayScreen.tsx:1176，顶部「心理压力」chip
  - `computeSleepPersonalized()` —— TodayScreen.tsx:737，恢复圆环
- 修法：以上三处包 `useMemo`（cortisol/emotionalStress 依赖 ring 版本与日期；sleepPersonalized 按 dayKey）。日级数据用日 key，分钟级更新场景给 30s/60s 窗口 key（与 cognitiveLoad 同款模式）。
- 图表组件本身（StressTrendChart 等）写得不错，切换卡是「整页重渲染」的连带症状，先修 1、2 再看。

### 3. 手感缺失 → token 化 + 触感
- 34 种 duration / 10 种 activeOpacity / 0 触感 = 「点了没反馈、每个页面手感不一样」的直接来源。
- 建 token（theme.motion 已有，推广使用）：
  - duration：instant 100 / quick 160 / base 220 / slow 320 / sheet 440（UI 上限 <300ms，长面板 ≤440）
  - easing：进场 `Easing.bezier(0.05,0.7,0.1,1)`，离场 `Easing.bezier(0.3,0,0.8,0.15)` 且比进场快 20%，屏内 `Easing.bezier(0.2,0,0,1)`；环境循环（呼吸/冥想 2000ms+）不算 UI 过渡、保留即可
  - press：全项目统一 `scale 0.96`（控件）/ `0.985`（大卡），activeOpacity 统一 1 个值
- 触感：加 `expo-haptics`（impact 轻 / success / warning 三档）。⚠️ 原生依赖，需要重跑 `expo run:ios` 重装真机——**不要在真机验收中途加，先确认窗口期**。

## 开源选型建议（结合 old-arch 约束）

| 方案 | 结论 |
|---|---|
| Reanimated 4 | ❌ 不可用：仅支持 New Architecture + RN ≥0.78 |
| **Reanimated 3.x（3.16+）** | ✅ 唯一可加的动效库：兼容 old arch + RN 0.74。用于手势驱动（拖拽卡组、滑切图表 tab）与图表 path 过渡。但不解决上面 3 个根因，**先修根因再上** |
| Moti | 可选：Reanimated 3 之上的声明式包装，省代码；需先装 Reanimated |
| RN Skia | 暂不需要：现有 react-native-svg 图表足够，换了反而重写 |
| matter-js → 替换 | 情绪日志的物理动画改 RN Animated spring 序列或 Reanimated，JS 线程物理引擎与滚动争抢主线程 |
| FlatList | 长列表页（BodyCompositionHistory / EmotionLog / CycleCalendar）从 ScrollView+map 迁移 |

## Skill 推荐

| Skill | 用途 |
|---|---|
| `rn-motion-interaction-audit`（已装） | 本报告方法论，修完可复跑回归 |
| `ui-craft-floor`（已装） | 视觉红线，与动效修复并行 |
| **emilkowalski/skills（GitHub 44.2k★，MIT）** | 推荐安装：`apple-design`（动效当物理、手势可打断）+ `animate`（单个动画该不该动、时长曲线怎么定），正对本项目「手感」问题 |
| taste-skill / impeccable（93.7k / 78.5k★） | 审美层「反 AI 味」，当前瓶颈不在此，缓装 |

## 修复顺序（建议）

1. **半天**：12 个透明卡片改不透明 + native stack 迁移 → 跳转立竿见影
2. **半天**：TodayScreen 死代码删除 + compute 系列 useMemo 化 → 滑动/切换掉帧大头
3. **一天**：motion/press token 落地（改 RangeSwitch、Card、BentoCard 等高频组件）
4. **窗口期**：expo-haptics + Reanimated 3 一次原生构建带上；长列表迁 FlatList
5. 复跑本审计命令回归对比
