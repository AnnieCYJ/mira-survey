# mira-app 交互优化 · 改动清单（待 Annie 审批，未动任何代码）

> 2026-10-08。每项写明：改哪个文件哪一行、页面上是哪个东西、具体怎么改、视觉会不会变、风险。
> 你批哪项我做哪项。审批结果建议直接回编号：如「A1+B1 批，C3 再说」。

---

## A. 页面跳转卡 —— 只改 `navigation/RootStackNavigator.tsx` 一个文件

### A1. 15 个「透明卡片」改不透明 ⭐ 建议第一个做
**改哪**：RootStackNavigator.tsx，以下 screen 的 `cardStyle: { backgroundColor: 'transparent' }`：
MetricDetail / CycleCalendar / StatusTrendDetail / BodyCompositionHistory / SleepDetail / EcgDetail / BpDetail / EnergyDetail / EmotionCognitiveDetail / EmotionLog / EmotionIntervene / Breathing / FoodScan / ToolTopic / LearnRead / Settings（VoiceChat 已改好，不动）。

**页面上是哪个东西**：首页所有卡片点进去的详情页（心理压力、脑力、睡眠、血压、ECG、能量、情绪记录、呼吸、食物扫描、工具页、文章页、设置）——即你每次「点卡 → 推入新页」的那一下转场。

**怎么改**：这些详情页背景目前是「透明、透出 App 根渐变」。为保视觉 100% 不变，改法是：各屏的 ScreenContainer 打开 `withGradient`（组件已支持该参数），自己铺同一条 `theme.colors.bgGradStops` 渐变；navigator 里 `cardStyle` 改成不透明底色（`colors.bgTop`）。转场时系统不再合成背后的 TodayScreen。

**视觉**：不变（同一条渐变，只是从「透出」变「自己画」）。
**风险**：低。需逐屏确认没有别的元素依赖「透明透底」。
**预期**：跳转帧率提升最明显的一项——你们在 VoiceChat 已实测验证过同款改法（文件 ：71 注释「更丝滑」）。

### A2. JS 导航器 → 原生导航器（与 A1 同文件，一起做）
**改哪**：RootStackNavigator.tsx:2,56 `createStackNavigator` → `createNativeStackNavigator`。
**怎么改**：react-native-screens 3.31.1 已在依赖里但没用上。native stack 的推入/侧滑由 iOS 原生驱动。需同步删掉全部 `CardStyleInterpolators.forHorizontalIOS`（native stack 不支持，默认转场即 iOS 原生横滑）、`presentation: 'card'` 与 `gestureDirection` 按新 API 映射。
**视觉**：转场动画从「JS 模拟的 iOS 动画」变成「真 iOS 动画」，更跟手。
**风险**：中。API 有差异，需要真机把 16 个页面点一遍回归。gesture 返回侧滑行为需确认。

---

## B. 滑动 / 图表切换卡 —— 首页 TodayScreen + 详情页

### B1. 首页「多因分析胶囊」的皮质醇段：每次渲染重算 14 天 cosinor
**改哪**：TodayScreen.tsx:1001-1002（`causeNarrative` IIFE 内）。
**页面上是哪个东西**：首页周期卡下方的多因分析胶囊里「皮质醇晨峰 0X:00 · 节律良好/偏晚」那段小字。
**现状**：`collectSamples() + analyzeCortisol(samples, 14)` 没有 memo、算法内部也无缓存——TodayScreen 每渲染一次就全量重算一遍 14 天节律拟合（皮层醇样本逐日扫）。
**怎么改**：包 `useMemo`，key = `dayKey + healthStore.getVersion()`（与 cognitiveLoad.ts:693 的缓存 key 同款模式）。
**视觉**：零变化。**风险**：低。

### B2. 首页「心理压力 chip」与「恢复圆环」的两处无缓存计算
**改哪**：TodayScreen.tsx:1176（`computeEmotionalStress`，顶部情绪/压力 chip）与 :737（`computeSleepPersonalized`，恢复圆环分数）。
**怎么改**：同 B1 模式包 `useMemo`（emotionalStress 带 30s 窗口 key——它吃实时 EDA，key 太长会显得滞后；sleep 按 dayKey）。
**视觉**：零变化（30s 内的数值刷新粒度不变，它本来就不是秒级实时）。
**风险**：低。注意 ring 新同步进来时 healthStore 版本变化会自然击穿缓存。

### B3. 删除 TodayScreen 死代码（文件从 1971 行减到约 1000 行）
**改哪**：TodayScreen.tsx:97-265 的 `EnergyRowData`（代码注释自己已盖章：「从未被任何地方使用」「往那里加日志永远不打印」，:1204-1205）及 1-633 区间其它未被活代码引用的辅助组件（逐个 grep 引用验证后才删）。
**页面上是哪个东西**：不渲染任何东西——纯粹是历史遗留。它曾导致「改了半天不生效」的排查事故（文件头注释记录了连续两轮白排查）。
**怎么改**：逐段验证零引用后删除；`EnergyMiniCard`(:63) 需确认是否被活代码引用，引用则保留。
**视觉**：零变化。**风险**：低（删完跑 `npx tsc --noEmit` 对比 44 处基线错误数）。
**预期**：首页模块加载与编译更快，以后改首页不再有「改错作用域」陷阱。

### B4. 详情页「日/周/月/年」切换的图表过渡
**改哪**：各详情页（StatusTrendDetailScreen 等）+ RangeSwitch.tsx 配合。
**页面上是哪个东西**：详情页顶部的 日/周/月/年 分段器，点它切换下方的趋势图。
**现状**：点一下 → 整页 setState 重渲染 → 所有卡+图重算重画，旧图直接消失新图直接出现，视觉上「顿一下」。
**怎么改**：① 趋势图组件包 `React.memo`（TodayScreen 内 MiniReadinessTrend 等已经是 memo 的，详情页的对齐）；② 切换的数据变换包 `useMemo`；③ 切换瞬间给图表区加 160ms opacity 交叉淡入（RN Animated，原生驱动，只动 opacity）。
**视觉**：数据完全同源不变，只多一个轻淡入，消除「闪变」感。
**风险**：低-中。淡入参数需真机看手感（我会先做 ①②，③ 看效果再定）。

---

## C. 手感与审美统一（配合刚装的 taste skill）

### C1. 动效时长收敛：34 种 → 6 档 token
**改哪**：theme/theme.ts 的 `motion` token 扩全（instant 100 / quick 160 / base 220 / slow 320 / sheet 440 + 三条标准曲线），然后**只先改高频 10 个组件**的硬编码 duration：RangeSwitch、Card、BentoCard、CustomTabBar、Sheet、EmotionQuickRecord、TaskDeck、HomeAiBubble、MiraBot、SuggestionCard。
**不改**：呼吸/冥想引擎的 2000-32000ms 循环——那是环境律动不是 UI 过渡，保留。
**视觉**：个别动画快慢有微调（向 6 档靠拢），整体更一致。
**风险**：低-中（面广，分两批，每批真机过一遍）。

### C2. 按压反馈统一：10 种 activeOpacity → 1 种
**改哪**：全项目 96 处 `activeOpacity={0.6~1.0}`，统一为 `0.7`（或升级为 scale 0.985 按压方案，二选一，你定）。重灾区：ToolTopicScreen(18)、EmotionInterveneScreen(14)、CycleCalendarScreen(12)、EmotionQuickRecord(11)。
**视觉**：按压变暗程度统一——这正是「统不统一」的直接来源之一。
**风险**：低，纯数值替换，可一次批量做。

### C3. 触感反馈（expo-haptics）⚠️ 需要你确认窗口期
**改哪**：点按卡片轻触感、同步成功/记录成功 success 触感、错误 warning 触感。
**为什么单独列**：原生依赖，装完必须重跑 `expo run:ios` 并重装真机。**你正在真机验收的话这事会打断你**——所以等你给窗口。
**现状**：全项目 0 处触感，是「点了没反馈」的一半原因。

---

## D. 情绪记录页的 matter-js 雨滴（EmotionLogScreen）
**改哪**：EmotionLogScreen.tsx:129-220。
**页面上是哪个东西**：情绪记录页的「雨滴落下堆积」物理动画——你滑动/点选情绪时，它还在 JS 线程上以 60fps 跑物理引擎 + 每帧重绘 SVG，两者抢同一条线程。
**方案 D1（保守，推荐先做）**：粒子全部静止后自动休眠引擎（检测 sleep 阈值），手指交互期间暂停物理、抬起后恢复。视觉几乎不变。
**方案 D2（彻底）**：整个雨滴换成预烘焙的 Animated 下落+弹跳，删掉 matter-js 依赖。视觉有差异，需你看过才做。
**风险**：D1 低，D2 中。

---

## 建议执行顺序

| 批次 | 内容 | 量级 | 真机验证点 |
|---|---|---|---|
| 1 | A1 + A2 | 半天 | 16 个页面逐个推入/侧滑返回 |
| 2 | B1 + B2 + B3 | 半天 | 首页滑动跟手度、tsc 基线对比 |
| 3 | C2 + C1 | 1 天 | 全 App 按压手感一致性 |
| 4 | B4 + D1 | 半天 | 图表切换、情绪记录页 |
| 5 | C3（需窗口期） | 半天+构建 | 触感分级 |

---

## 执行记录（2026-10-08 21:30–22:00，Annie 批准「改吧」后）

| 项 | 状态 | 说明 |
|---|---|---|
| A2 native stack | ✅ | 装 @react-navigation/native-stack@6.9，RootStackNavigator 整体重写；Main 显式 transparent |
| A1 不透明卡片 | ✅（改白） | 15 屏 contentStyle 全部不透明。**首版误铺根紫渐变（withGradient），用户指正主题已改白 → 已全部撤销渐变、统一 cardBg 纯白** |
| B1 皮质醇 memo | ✅ | cortisolSummary useMemo（healthVer+dayKeyStr） |
| B2 esReport/sleepPers memo | ✅ | 加 healthVer/dayKeyStr/esWindow(30s) key |
| B3 死代码 | ✅ | 1971→1518 行；删 EnergyMiniCard/EnergyRowData/MiniStressBars/MiniCognitiveBars/MiniActivityCurve/BigStatCard + mini chart 常量；**ARC_FEATHER 被 live 引用、误删后已恢复**（tsc 抓到） |
| C2 按压统一 | ✅ | 99 处硬编码 → 0.7（= theme.press.opacity token 现值）；7 处 `onPress?0.92:1` 接入 token；保留 10 处 {1}（配自定义缩放）与 HomeAiBubble 0.94 特例 |
| B4 图表淡入 / C1 duration 收敛 / D1 matter-js / C3 触感 | ⏳ 未做 | 等真机验证本轮效果后继续 |

验证：`npx tsc --noEmit` = 42 处错误，与基线完全一致，本次触碰文件 0 错误。
真机验证清单：① 16 个页面逐个推入/侧滑返回，看转场与白底；② 首页滑动跟手度；③ 全 App 按压手感一致性；④ reload Metro 即可（无原生依赖变更）。
