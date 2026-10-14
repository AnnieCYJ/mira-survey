# Git 状态巡检 Automation — 执行记录

## 2026-09-23 14:07（首次运行）
- 项目：mira-app（origin = gitcode.com:fairycyj/mira-app.git，SSH key gpushare）
- 发现：master 领先 origin/master 7 个提交；唯一未提交项为子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 内部脏改动（libs/vp_sdk/index.js，1 行压缩版 → 13454 行，疑为协议研究时替换/美化的 Veepoo SDK 文件）。
- 处理：
  - `git add -A` 后父仓库暂存区为空（子模块 HEAD 未变、仅工作区脏，父仓库无法暂存）→ 无新内容可 commit，跳过。
  - `git push origin master` 成功：6a77e1f..069aba8，7 个积压提交已推送到 gitcode。
- 决策默认值（无人值守）：不代用户在第三方上游子模块（github.com/HBandSDK）里做本地提交——会产生无法推送的悬空指针；子模块脏改动保持原样并报告。
- 遗留：子模块内 libs/vp_sdk/index.js 的本地修改未纳入任何版本控制。若需长期保存，建议把该文件复制到父仓库目录（如 tools/ 或 docs/）再提交。

## 2026-09-23 14:12（第二次运行）
- 发现：分支与 origin/master 同步（无积压）；新增未跟踪项 `.workbuddy/memory/automations/`（本 automation 首次运行时写入的记忆文件，上次 status 时尚未生成）。
- 处理：`git add -A` 仅暂存了该记忆文件（子模块脏改动依旧无法暂存，HEAD 未变）→ commit 3284f57「添加 Git 巡检自动化运行记录」→ push 成功 069aba8..3284f57。
- 说明：`.workbuddy/` 不在 .gitignore 中，按指令 add -A 一并入库；自动化记忆文件随仓库版本化，后续运行会在已跟踪文件上产生增量改动，可正常提交。
- 稳态预期：无新工作时，唯一持续的脏项仍是子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK（-dirty），将按首次运行的默认决策保持原样、仅报告。

## 2026-09-24 14:12（第三次运行）
- 发现：工作区无可暂存改动（唯一脏项仍为已知子模块 -dirty，add -A 暂存区为空）；但本地 master 领先 origin/master **12 个提交**（上次巡检后新产生的本地提交，为 MindMate v10 首页/洞察页 reskin 系列 + 若干红屏/塌陷修复）。
- 处理：无需新 commit，直接 `git push origin master` 成功：3284f57..df07a56，12 个积压提交已推送至 gitcode。
- 子模块脏改动维持既有决策：不动、仅报告。

## 2026-09-25 14:23（第四次运行）
- 发现：本地 master 领先 origin/master **2 个提交**（MindMate v16 样式对齐系列：0ec4ac9 长期健康 tab/详情页白底迁移、e121847 问答页紫按钮/气泡 token 统一）；未提交改动仅 automation 记忆文件（上次运行的追加）+ 已知子模块 -dirty。
- 处理：add -A 仅暂存记忆文件 → commit 26b32f9「chore: 更新 Git 巡检自动化运行记录（09-24）」→ push 成功 df07a56..26b32f9（连同 2 个 v16 样式提交一并推送，共 3 个）。
- 结果：master 与 origin/master 完全同步。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 脏改动维持既有决策：不动、仅报告。

## 2026-09-26 14:12（第五次运行）
- 发现：本地 master 领先 origin/master **3 个提交**（样式对齐系列：4110782 v16 全界面清零旧紫渐变白底迁移、9b5a9cc v21 卡片级对齐设计规范——血液指标身份色/周期域紫主控、1b32318 v20 语音录音浮框白雾遮罩+五色流动渐变）；未提交改动仅 automation 记忆文件（上次运行追加的 09-25 条目）+ 已知子模块 -dirty。
- 处理：add -A 仅暂存记忆文件 → commit 426aab9「chore: 更新 Git 巡检自动化运行记录（09-25）」→ push 成功 26b32f9..426aab9（连同 3 个样式提交一并推送，共 4 个）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-09-27 14:12（第六次运行）
- 发现：工作区存在未提交改动——src/ai/model.ts、src/lib/foodAi.ts、src/screens/FoodScanScreen.tsx（食物 AI 识别相关），新增未跟踪 generated-images/ 目录下 1 张 PNG，以及 automation 记忆文件本次追加条目；子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty 状态。
- 处理：执行 `git add -A` → commit 85a62e0「更新食物 AI 识别逻辑、生成图片资源并记录巡检」→ push 成功 426aab9..85a62e0。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-09-28 14:12（第七次运行）
- 发现：本地 master 领先 origin/master **29 个提交**（v17.3→v18.28 MindMate 迭代系列：情绪珠雨 Matter.js 动效、洞察页 tab 拆分、认知/运动/情绪卡改版、饮食识别卡底图定稿、expo-sensors 降级等）；新增未跟踪 `build/` 目录（3.0GB Xcode 构建中间产物，当天 11:15 生成，不在 .gitignore）；子模块仍为已知 -dirty。
- 关键决策：**未盲目 add -A**——build/ 为 3GB 构建产物，硬提交会污染仓库且推送必失败。将其加入 .gitignore（与已忽略的 ios/、dist/ 同类），属本次唯一源码外改动，已在 commit message 中注明。
- 处理：.gitignore 加 build/ → git add -A（暂存 .gitignore + 记忆文件）→ commit → push origin master（29 个积压提交 + 本次 1 个一并推送）。
- 结果：master 与 origin/master 同步。build/ 已被忽略不再出现在 status；子模块脏改动维持既有决策：不动、仅报告。

## 2026-09-29 14:12（第八次运行）
- 发现：本地 master 领先 origin/master **19 个提交**（v18.29→v18.47 MindMate 迭代系列：恢复程度 chip 提位、脑力账户/认知准备度定名、今日状态场景建议引擎、激素法则工具卡、首页单行头部与圆环改版等）；未提交改动：src/screens/TodayScreen.tsx（今日状态叙述文字 16px 墨色 medium + 两侧留白 28、经期 chip 去「第 X 天」tag，即 v18.48 选 A）+ 已知子模块 -dirty。
- 处理：git add -A 仅暂存 TodayScreen.tsx → commit 2394021「v18.48 首页今日状态叙述文字改 16px 墨色居中加留白 + 经期 chip 去天数 tag」→ push 成功 0ed8876..2394021（19 个积压提交 + 本次 1 个，共 20 个）。
- 结果：master 与 origin/master 完全同步。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 脏改动维持既有决策：不动、仅报告。

## 2026-09-30 14:12（第九次运行）
- 发现：本地与 origin/master 同步（0 领先），但工作区有大量未提交改动（66 项）——新增知识科普阅读功能（LearnReadScreen 阅读详情页 + learn/glow/emotion/sport/nutrition 5 个文章库 lib + BentoCard 组件 + 4 个分类配图目录约 3.5MB）+ 20 个源文件修改（TodayScreen/ToolTopicScreen 大改、mindmate.ts 加 moodNone 色），属 v18.5x–v18.8x 迭代系列；新增未跟踪 `build_fresh/`（3.3GB Xcode 构建产物，不在 .gitignore）+ automation 记忆文件；子模块仍为已知 -dirty。
- 关键决策：**build_fresh/ 未提交**——与 09-28 处理 build/ 同类（3.3GB 构建产物），按既有先例加入 .gitignore 而非提交，commit message 已注明。
- 处理：.gitignore 加 build_fresh/ → git add -A（66 文件，+3091/-425）→ commit 799323a「新增知识科普阅读功能：文章库×5 + 阅读详情页 + BentoCard 组件及首页/工具页迭代（v18.5x–v18.8x）；ignore build_fresh 构建产物」→ push 成功 2394021..799323a。
- 结果：master 与 origin/master 完全同步。剩余脏项仅已知子模块 -dirty，维持既有决策：不动、仅报告。

## 2026-10-01 14:12（第十次运行）
- 发现：工作区存在大量未提交改动（100 项）——40+ 图片资源被替换并保留 `_old.jpg` 备份、app.json 与多个源码文件修改、新增运动/饮食/睡眠相关 lib（workoutLibrary、todayWorkout、sportLog、sportVisual、cycleNutrition、hormoneNutrition、mealAnalysis 等）、新增 SleepHormoneCorrelation 组件与 5 个预览 HTML；子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A` → commit 4a0c864「更新图资与运动/饮食/睡眠模块：替换卡片与科普配图、新增运动库与营养分析 lib、预览 HTML 及备份图资」→ push 成功 799323a..4a0c864。
- 结果：master 与 origin/master 同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-02 14:12（第十一次运行）
- 发现：工作区 60 项未提交改动（本地与 origin 0 领先）——新增情绪干预功能全套（EmotionInterveneScreen 干预页、EmotionQuickRecord 快速记录、MoodBlob/MiraTag 组件、interventionLog/aiJumps/lastViewDate lib）；呼吸页 4 张底图替换并新增 thumb_* 缩略图与 *_old.jpg 备份；FoodScanScreen（±1281 行）与 ToolTopicScreen（±1127 行）大重构；另 40+ 组件/界面小幅迭代；含 10-01 记忆文件。子模块仍为已知 -dirty。
- 处理：git add -A（59 项，子模块无法暂存）→ commit 40f2421「新增情绪干预功能：干预页、快速记录、MoodBlob/MiraTag 组件与干预日志 lib；更新呼吸页图资缩略图并保留备份；重构食物扫描与工具话题页等多界面迭代」→ push 成功 4a0c864..40f2421（+4067/-1345）。
- 结果：master 与 origin/master 完全同步。剩余脏项仅已知子模块 -dirty，维持既有决策：不动、仅报告。

## 2026-10-03 14:12（第十二次运行）
- 发现：工作区存在 24 项未提交改动（本地与 origin 0 领先）——新增 11 个 preview/ 情绪页风格 HTML、EmotionRangeBars 组件、periods.ts 周期 lib；修改 12 个源文件（覆盖 BLE、情绪干预、睡眠结构、认知负荷、压力算法、今日/洞察/工具话题等屏幕与 lib）；automation 记忆文件仍为待提交修改。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A` → commit 37c32df「情绪与洞察模块迭代：新增情绪分布预览页、EmotionRangeBars 组件与周期 lib，优化压力算法与多个界面」→ push 成功 40f2421..37c32df（32 files, +4628/-794）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-04 14:12（第十三次运行）
- 发现：工作区存在 29 项未提交改动（本地与 origin 0 领先）——新建压力/睡眠/皮质醇算法体系：10 个新 lib（emotionalStress 764 行、cortisolProxy、stressFeatures、motionGate、selfReportCalibration、psychologicalStressScale、sleepBaseline、cortisolChartGeom、recencyBaseline、sleepPersonalized，合计约 3600 行）+ SleepCard 组件；修改 15 个源文件（RingBleManager +457 行大增强、cognitiveLoad/sleepScore 算法扩展、TodayScreen/AllDayRecoveryCard/CortisolRhythmCard 等界面迭代、theme 加色）；automation 记忆文件待提交修改。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：先追加本条记录 → 执行 `git add -A` → commit ed48e76「新增压力/睡眠/皮质醇算法体系：情绪压力、压力特征、运动门控、自报校准、睡眠基线等 10 个 lib 与 SleepCard 组件；增强 BLE 管理层并迭代认知负荷、睡眠评分与今日/能量等界面」→ push 成功 37c32df..ed48e76（28 files, +5053/-431）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-05 14:12（第十四次运行）
- 发现：工作区 9 项未提交改动（本地与 origin 0 领先）——状态趋势详情页 v18.147–153 大改版（StatusTrendDetailScreen ±646 行：月视图周期相位带+PMS、周视图皮质醇异常图标、散点/折线口径对齐首页 TrendChart、四等级图例与 StressWatch 式详细分析、删除激素均值三宫格）；AllDayRecoveryCard 睡眠分统一个人基线口径（v18.146，修「圆环 52 / 节律卡 94」两把尺问题）+ badge 档位词同源 + COR-PROBE 日志移入 useMemo；cycleMath 修跨周期日期相位判定（按周期内位置取模，月视图相位带修复）；TodayScreen 隐藏睡眠卡（SHOW_SLEEP_CARD 开关、代码保留）、移除「运动消耗」chip（4 张排满一行）、间距收紧；EnergyBall 画布底部空带负 margin 收回（图例不再被顶出屏）；MindChips 条目 5→4；新增 _design_preview/ 两个趋势图设计 HTML；另含 10-04 记忆文件哈希回填。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：git add -A → commit 7d41442「状态趋势详情页大改版（v18.147–153）：图表叠加周期相位带/皮质醇异常图标、口径对齐首页趋势图与四等级图例；睡眠分统一个人基线口径、修跨周期相位判定、隐藏睡眠卡并移除运动消耗 chip」→ push 成功 ed48e76..7d41442（9 files, +1215/-148）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-06 14:12（第十五次运行）
- 发现：本地 master 领先 origin/master **5 个提交**；工作区 14 项未提交改动——新增 3 个 docs/ HTML（皮质醇认知准备度评审、指标算法架构、科学依据）+ 1 个 preview/sleep-rhythm.html；修改 10 个源文件（plugins/withMetroScheme.js、AllDayRecoveryCard/BentoCard/SleepCard 组件、sleepPersonalized lib、InsightScreen/SleepDetailScreen/StatusTrendDetailScreen/TodayScreen 屏幕）+ automation 记忆文件。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A`（14 文件，子模块无法暂存）→ commit c4849bf「迭代睡眠与洞察模块：新增皮质醇认知准备度评审、指标算法架构与科学依据文档；睡眠节律预览页；优化恢复卡、BentoCard、SleepCard、睡眠个性化基线及今日/洞察/趋势详情/睡眠详情多屏」→ push 成功 6e49f80..c4849bf（5 个积压提交 + 本次 1 个，共 6 个）。
- 结果：master 与 origin/master 完全同步。剩余脏项仅已知子模块 -dirty，维持既有决策：不动、仅报告。

## 2026-10-07 14:12（第十六次运行）
- 发现：本地 master 领先 origin/master **1 个提交**（c657165 洞察页心理压力/脑力周月年横轴恢复自然周期；修记录心情时间选择器与表情闪动）；工作区存在大量未提交改动——**清理废弃 iOS 备份目录**（删除 ios-broken-20260830/ 与 ios-broken-3/ 两套完整 Xcode 工程备份，合计约 29K 行删除）+ **周期与洞察模块大迭代**：新增 10 个组件/文件（CycleRegularityCard、CycleYearReviewCard、HomeSuggestionFloat、SuggestionCard、SymptomPhaseMatrix、SymptomStatsPanel、habitSuggestions、buildTodayTimeline、suggestionEngine）+ MIRA_RING_SYNC_CONTRACT_V2.md 文档；修改 20 个源文件（覆盖 TodayScreen、CycleCalendarScreen、InsightScreen、MeditationScreen 等屏幕与 CortisolDailyChart、AllDayRecoveryCard、MindChips 等组件及 cortisolProxy、realSeries 等 lib）；automation 记忆文件待提交。
- 处理：执行 `git add -A`（355 文件，+3744/-29034，子模块无法暂存）→ commit f37fca0「周期与洞察模块大迭代：新增周期规律性/年度回顾/症状矩阵/建议引擎组件，优化皮质醇图表与日历屏；清理废弃 ios-broken 备份目录」→ push 成功 c4849bf..f37fca0（1 个积压提交 + 本次 1 个，共 2 个）。
- 结果：master 与 origin/master 完全同步。剩余脏项仅已知子模块 -dirty，维持既有决策：不动、仅报告。

## 2026-10-09 14:12（第十七次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区存在 69 项未提交改动——新增首页 AI 气泡（HomeAiBubble 组件 + preview/home-ai-bubble-preview.html）、AI 叙事与建议引擎（aiNarrative.ts、aiSuggestion.ts）、2 份交互评审/优化计划文档；删除 HomeSuggestionFloat.tsx（被 HomeAiBubble 替代）；修改 package.json/package-lock.json 及 62 个源文件（覆盖 AI 层 health/insight/miraAi、今日/洞察/日历/睡眠/能量/情绪干预/饮食/呼吸/专注等多屏，以及 RangeSwitch/SuggestionCard/SleepDualAxisChart/VoiceQuickOverlay 等组件）；automation 记忆文件（10-07 条目）待提交。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A`（74 文件，子模块无法暂存）→ commit ffe7415「新增首页 AI 气泡与 AI 叙事建议引擎，补充交互评审及优化计划文档，重构多屏组件」→ push 成功 f37fca0..ffe7415（+3063/-1258）。
- 结果：master 与 origin/master 完全同步。剩余脏项仅已知子模块 -dirty，维持既有决策：不动、仅报告。

## 2026-10-10 14:12（第十八次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区存在 94 项未提交改动——67 个修改文件 + 27 个新增文件（含 16 份 docs/ 预览 HTML、design-system-spec.html、uiux-optimization-2026-10-10.md、chart.ts 主题、chartAxis.ts/healthAgeEstimate.ts/profileForm.ts lib、useReducedMotion hook、test-uiux.cjs 脚本等）。核心迭代内容：首页 AI 气泡/建议卡重构（HomeAiBubble、aiNarrative、aiSuggestion、SuggestionCard）、图表体系统一（坐标轴/Bar/Token 规范，chartAxis.ts + chart.ts + 16 份预览 HTML）、洞察页卡片与指标对齐（InsightScreen + 多组件）、睡眠/压力/皮质醇/生理年龄多屏优化（SleepDetailScreen、CortisolRhythmCard、StressInsightCard、HealthAgeCard 等）、App.tsx 导航调整、README 更新。automation 记忆文件（10-09 条目）待提交。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A`（94 文件，子模块无法暂存）→ commit 2287b9d「v18.154–18.16x 全链路迭代：首页 AI 气泡/建议卡重构、图表体系统一（坐标轴/Bar/Token 规范）、洞察页卡片与指标对齐、睡眠/压力/皮质醇/生理年龄多屏优化，新增 design-system-spec 与 16 份预览 HTML」→ push 成功 ffe7415..2287b9d（+9120/-1757）。
- 结果：master 与 origin/master 完全同步。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 脏改动维持既有决策：不动、仅报告。

## 2026-10-11 14:12（第十九次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区存在 91 项未提交改动——64 个修改文件 + 27 个新增文件。核心迭代：新增 HealthAgeDetailScreen 健康年龄详情页、JourneyDayView 旅程日视图、ArcGauge 弧形仪表盘、charts/ 目录（AllDayBarsChart/TempCircadianChart）、dailyHealthAge/smoothPath/tempBaseline/timeBuckets 4 个 lib；MetricDetailScreen 大幅扩展（±465 行），CortisolDailyChart（±353）、EmotionCognitiveDetailScreen（±293）、EnergyDetailScreen（±166）、InsightScreen（±142）、ProfileScreen（+54）等多屏迭代；新增 design-tools/、ui-review/、多份预览 HTML 与设计 token 文档；automation 记忆文件（10-10 条目）待提交。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 仍维持已知 -dirty。
- 处理：执行 `git add -A`（91 文件，子模块无法暂存）→ commit 5afd4c5「新增健康年龄详情、旅程日与弧形仪表盘组件，优化指标详情/皮质醇/情绪认知/能量/洞察多屏及图表规范」→ push 成功 2287b9d..5afd4c5（+9171/-878）。
- 结果：master 与 origin/master 完全同步。子模块 hband-sdk/WeChat_Mini_Program_Ble_SDK 脏改动维持既有决策：不动、仅报告。

## 2026-10-12 14:12（第二十次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区 93 项未提交改动——工具卡图资体系：新增 toolImageData.ts + 6 张 tool_*.jpg、preview/assets/ 6 张、SavedAdviceDeck 组件、EmotionFaceIcon 组件、toolTips lib；替换 4 张卡片图并删除 *_old 备份；修改 35 个源文件（TodayScreen/InsightScreen/FoodScanScreen/MetricDetailScreen/SleepDetailScreen 等多屏 + stressAlgorithm/suggestionEngine/todayScene 等 lib）+ 16 份 preview HTML + design-tools/p3p4-real 迭代（含 _orig 原图、多版 tool_cards_v1011 截图、verify_cards）；automation 记忆文件待提交。子模块仍为已知 -dirty。
- 处理：git add -A（93 文件，子模块无法暂存）→ commit 1757c63「工具卡图资与设计稿迭代：新增工具卡图库 toolImageData 与 6 张卡片图、保存建议卡 SavedAdviceDeck 与情绪表情组件，更新首页 AI 气泡/压力/情绪/睡眠等多屏及预览 HTML」→ push 成功 5afd4c5..1757c63（+4859/-674）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-13 14:12（第二十一次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区 66 项未提交改动——呼吸/冥想图资 v2 全套替换（5 张呼吸 bg + 5 张 thumb、5 张冥想 bg/thumb、rain_v2/waves_v2 mp3 新音轨）、新增月相发现视图 MonthDiscoveryView + DayDrawer 组件、phaseAdvice/workoutInput/analysisFeedback lib、5 个预览 HTML（breathing-redesign/glass/nature、month-discovery-*）与 preview-nature/ 5 张配图；修改 30 个源文件（BreathingEngine/Player、MeditationPlayer、CycleMoonPhase/CyclePhaseCard、HomeAiBubble、HormoneDualTrend/EstrogenCard、JourneyDayView、cycleMath、sleepPersonalized、健康与周期多屏等）+ automation 记忆文件。子模块仍为已知 -dirty。
- 处理：git add -A（66 文件，子模块无法暂存）→ commit 5aa537e「呼吸与冥想模块迭代：替换呼吸/冥想背景图 v2 与新音轨，新增月相发现视图 MonthDiscoveryView/DayDrawer 与相位建议、运动输入 lib，更新周期/睡眠/情绪等多屏组件及呼吸再设计预览 HTML」→ push 成功 1757c63..5aa537e（+4206/-592）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。

## 2026-10-14 14:12（第二十二次运行）
- 发现：本地与 origin/master 同步（0 领先）；工作区 65 项未提交改动——冥想音轨替换（删 rain/rain_v2，新增 rain_v4.mp3）、新增 FadeInImage/TabFade 组件与 analysisFacts/timePhase lib；修改 30+ 源文件（breathing 引擎/播放器、MeditationPlayer、HomeAiBubble、MonthDiscoveryView、SavedAdviceDeck、TodayScreen/InsightScreen/CycleCalendarScreen 及 ai 层/cognitiveLoad/cortisolProxy/suggestionEngine 等）；新增 preview-glass/（7 文件）与 preview-tools/（12 文件）设计稿目录；另出现未跟踪 hermes-engine/（54MB Hermes 引擎构建产物头文件）与 .last_build_configuration（Xcode 构建配置）。
- 关键决策：hermes-engine/（54MB）与 .last_build_configuration 属构建产物，按 build/build_fresh 先例加入 .gitignore 而非提交。
- 处理：git add -A（65 文件，子模块无法暂存）→ commit c515851「迭代呼吸/冥想与工具卡设计：替换冥想音轨为 rain_v4、新增 FadeInImage/TabFade 组件与 analysisFacts/timePhase lib，更新首页 AI 气泡、月相发现与多屏；新增 preview-glass/preview-tools 设计稿并 ignore hermes-engine 构建产物」→ push 成功 5aa537e..c515851（+3842/-3226）。
- 结果：master 与 origin/master 完全同步。子模块脏改动维持既有决策：不动、仅报告。
