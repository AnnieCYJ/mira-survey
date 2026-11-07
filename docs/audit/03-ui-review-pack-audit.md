# Mira App · UI 走查报告（基于 ui-review-pack 方法）

> **声明**：本报告为**静态走查**（读代码 + token 对照），不替代真机可用性测试。目标平台 **iOS（React Native / Expo）**，对照基准为 `src/theme/theme.ts`、`src/theme/mindmate.ts`、`docs/audit/02-design-token-final.md`。
> **方法**：因 `lhg-ui-review` 在市场上无法安装（搜索能找到、安装/Skill 均报"不在目录"），改用市场上可装的、最接近的 `ui-review-pack`（UI 走查评审包）作为框架；其交付物为 ①分级问题清单 ②规范依据表 ③还原问题单 ④反馈话术 ⑤复验 checklist。

---

## ① 分级问题清单（五级严重度）

| 严重度 | 含义 | 本轮涉及 |
|---|---|---|
| 🔴 必须整改 | 违反无障碍/可读性硬指标，真机必现问题 | 6 处 <11sp 极小字 + 3 处唯一热区 <44pt + 低 alpha 白字对比 |
| 🟠 需完善 | 系统性一致性的"漂移"，影响整体质感 | ①B 浅色孤岛（11 文件 / 50+ 处）+ ①A 深底裸白黑（28 文件 / 90+ 处） |
| 🟡 需优化 | 单点裸值，收敛 token 即可 | ④裸间距（35 文件 / 120+ 处）②裸半径（28 文件 / 70+ 处）⑤裸阴影（15 文件 / 22 处）③`theme.fs(N)` 用于文字（12 文件 / 50+ 处） |
| 🟢 可优化 | 图表/品牌内部色，收口为 token 更稳 | ①C 渐变裸 hex（4 文件）+ SVG/图表内部色 |
| ⚪ 未能确定 | 需设计/人工确认是否刻意 | 浅色孤岛是否保留白底、`theme.fs` 用于图标尺寸、刻意间距、表情/Confetti 配色 |

### 🔴 必须整改（无障碍 / 可读性）
1. **`MetricDetailScreen.tsx:654` `fontSize:8`**（角标 "+N"）、`:714` `fontSize:9`、`:744` `fontSize:8`（环形内数字）、`:970` `heatXLabel fontSize:9` — 低于 token 最小档 `tiny(10)/micro(11)`。
2. **`StatusTrendDetailScreen.tsx:356` `fontSize:9`** 热力轴标签。
3. **`SettingsScreen.tsx:655` `headerBtn 28×28`** — 唯一热区 <44pt。
4. **`CycleCalendarScreen.tsx:1199` `pregToggle 48×28`** — 高度仅 28pt <44。
5. **`TodayScreen.tsx:1444` `30×30` 图标按钮** — 唯一热区 <44。
6. **低 alpha 白字**（深底发糊）：`CalmWaveHome.tsx:710/711/738/756/785` 白字 alpha 0.5–0.65 多档，应统一 `textSub(0.74)` / `ui.white65`；`EmotionQuickRecord.tsx:358` 深蓝图标 `#1F4C7E` 疑叠浅底，需确认背景。

### 🟠 需完善（系统性漂移）
- **①B 浅色孤岛组件**：`TaskDeck` / `CalendarGrid` / `MonthDiscoveryView` / `PeriodRecordPanel` / `CortisolTrendCard` / `ChatSheet` / `LunaMiraFace` / `EmotionQuickRecord` / `MeditationScreen` / `DateAnchorPicker` / `RangeSwitch` 共 11 文件，白底深字用了 **9+ 种互不相同的近黑/近蓝值**（`#1F2937` `#2A4470` `#1F1D1A` `#9CA3AF` `#6B7280` `#3E4A18` `#6E58C8` …）。`02-design-token-final.md` 目前只有 `ui.onGlassInk(#2E2A3A)` 一个"浅底深字"token → **建议新增 `onLight` / `onLightSub` / `onLightFaint` 系列再统一替换**。
- **①A 深底裸白黑**：`ProfileScreen` / `AccountHubScreen` / `MemberDetailScreen` / `CycleCalendarScreen` / `OnboardingScreen` / `MiraAIHomeScreen` / `CustomTabBar` / `FocusScreen` / `ToolTopicScreen` / `CalmWaveHome` / `HomeAiBubble` / `EnergyDetailScreen` / `MetricDetailScreen` / `StressRecoveryDetailScreen` / `StatusTrendDetailScreen` / `SleepDetailScreen` / `LoginScreen` / `EmotionInterveneScreen` 共 28 文件，`#fff` / `#FFFFFF` / `rgba(255,255,255,…)` / `shadowColor:'#000'` 未收敛。
- **页面级留白不统一**：`TodayScreen.tsx:1505` `paddingHorizontal:28` 与 `theme.space.screen(24)` 冲突；多处 `paddingHorizontal:16/10` 未走 token。

### 🟡 需优化（单点裸值）
- **④ 裸间距**：约 35 文件 120+ 处 `padding/margin` 数字未走 `theme.space.*`（卡片内边距应统一 `cardPad(20)` / `cardPadCompact(12)`）。
- **② 裸半径**：约 28 文件 70+ 处 `borderRadius` 数字未走 `theme.radius.*`（小圆点→`xs(3)/sm(9)`、大圆→`pill(999)`、卡片→`card(24)`）。
- **⑤ 裸阴影**：约 15 文件 22 处 `shadowColor:'#000'` / 紫光晕未走 `theme.shadow.*` / `glassMorph`。
- **③ 文字 `theme.fs(N)`**：`FoodScanScreen` / `EmotionInterveneScreen` / `ToolTopicScreen` / `BentoCard` / `ConsumptionAnalyticsCard` / `EnergyBall` / `MonthDiscoveryView` / `SavedAdviceDeck` / `ProfileScreen` 等约 12 文件，Text 的 `fontSize:theme.fs(38/30/40/19/17…)` 绕过字号语义档（图标/图形尺寸用 `fs` 不计入，但**文字用 `fs(N)` 是确凿违规**）。

### 🟢 可优化
- **①C 渐变裸 hex**：`FoodScanScreen.tsx:545` `['#9D8AF0','#7EA6F8']` → `accent1/accent2`；`HomeAiBubble.tsx:548` 三色 → `aiBadgeGrad`；`ConsumptionAnalyticsCard.tsx:24-26` 柔光底 → 待确认品牌刻意。
- **SVG/图表内部色**：`SmileFace` 紫渐变、`CrownMark` 金 `#E6A94E`、`Confetti`/`OrbDots`/`MiraBot` 表情色板、`EmotionTimeline` 情绪色板、`TrendChart` fallback `#8B5CF6` — 数据/品牌驱动，建议收口到 `mood`/`sportPalette` 类 token（非紧急）。

### ⚪ 未能确定（需人工确认）
1. 浅色孤岛组件是**历史遗留未迁移**还是**刻意"白卡浮深底"**？决定统一成 `onGlassInk` 还是保留并补 light token。
2. `theme.fs(N)` 用于 **Icon 尺寸 / 图形尺寸** 是否算违规（文档主要针对文字字号）。
3. `#0A294F` / `#113861` / `#1F4C7E` 等深海底色散点是否全部走 `bg*` token。
4. 某些 `paddingHorizontal:28 > screen(24)` 是否刻意留白。
5. `<11sp` 的 SVG 轴标签在小屏真机是否可读。

---

## ② 规范依据表（标注平台 / 版本）

| 维度 | 规范条目 | 平台 / 版本 | 本工程结论 |
|---|---|---|---|
| 触控区最小尺寸 | 可点元素 ≥ 44×44 | Apple HIG「Controls / Layout」≥44pt；Material Design 3（2023）≥48dp；WCAG 2.1 SC 2.5.5（AAA）≥44×44 CSS px | 唯一热区 <44 必须整改 |
| 文字对比度 | 正文 4.5:1、大字 3:1 | WCAG 2.1 SC 1.4.3（AA） | 低 alpha 白字需复核对比 |
| 非文字对比度 | UI 部件 / 状态 3:1 | WCAG 2.1 SC 1.4.11（AA） | 图标/描边色需达标 |
| 最小字号 | 正文 ≥ 11pt 可读 | Apple HIG Dynamic Type；Material type scale | `tiny(10)/micro(11)` 为下限，禁用 8/9 |
| 间距栅格 | 8pt baseline grid | Apple HIG / Material spacing system | 页面留白统一 `screen=24`、卡片 `cardPad=20` |
| 颜色主题化 | 用语义 token 替代硬编码 | Apple HIG「Color」；Material「Theming」 | 全部 `#fff/#000/裸 rgba` → `theme.colors.*` |
| 组件状态 | enabled / disabled / focused / loading | Apple HIG「Controls」；Material states | 主 CTA 缺 disabled/loading 态 |

> ⚠️ 部分版本号与精确阈值**需以官方文档核对**（WCAG 2.1 2.5.5 为 AAA 级，非 AA 强制；Apple HIG 阈值随版本微调）。

---

## ③ 还原问题单（Top 10 文件，逐行 file:line + 建议 token）

> 已验证（本次交叉复扫确认）：上一轮"清理过"的 `BpDetailScreen` / `EcgDetailScreen` / `BindingRitualScreen` / `CardioDetailScreen` / `BreathingScreen` **仍有大量残留裸值** —— 上一轮只做了针对性收口（圆形按钮半径、个别色值），未全文件 token 化，故这批文件**重回待修列表**。

| # | 文件 | 关键位点（已验证） | 修复建议 |
|---|---|---|---|
| 1 | `components/HomeAiBubble.tsx` | `:52 PILL_LIGHT_BG='#FFFFFF'`、`:660 shadowColor:'#2E2A3A'`、`:742 borderRadius:2`、`:864 color:'#FFFFFF'` | `#FFFFFF`→`textTitle`；shadow→`ui.shadowDeep`；`borderRadius:2`→`radius.xs` |
| 2 | `screens/CalmWaveHome.tsx` | `:710/711/738/756/785` 白字 alpha 0.5–0.65、`:704` `#fff`、`:658/768` `borderRadius:19/20` | 白字统一 `textSub`/`ui.white65`；半径→`md/lg` |
| 3 | `components/MonthDiscoveryView.tsx` | `:74/111 #F6F4F1`、`:447 #1F1D1A`、`:1033/1041` 裸 shadow/半径 | 浅底→`onGlassInk` 系；shadow/半径→token |
| 4 | `screens/FoodScanScreen.tsx` | `:1116–1359` 大量 `theme.fs(38/30/40/19/17)`、`honeyDeep` 深字 | 文字 `fs(N)`→`theme.fontSize.*`；深字→`onGlassInk` |
| 5 | `screens/EmotionInterveneScreen.tsx` | `:1118–1276` `theme.fs(40/34/19/17)`、`:1194 rgba(151,111,26,0.9)`、裸 shadow | 同 FoodScan；honey 压浅色→`honeyDeep` token |
| 6 | `components/TaskDeck.tsx` | `:530/537/538 #1F2937/#6B7280/#9CA3AF`、`:507/548/555` 裸间距、`:509/520` 裸 shadow | 深字三件套→`onGlassInk/onLightSub/onLightFaint` |
| 7 | `components/PeriodRecordPanel.tsx` | `:432/519 #3E4A18/#2A4470`、`:402/438/449` 裸间距、`:480/499` 裸半径、CTA 缺态 | 深字→`onGlassInk`；间距/半径→token |
| 8 | `screens/AccountHubScreen.tsx` | `:197/201/207/211/220/242/246` `#fff/#FFFFFF` + 裸 `fontWeight` + 裸 `rgba(255,255,255,0.08~0.14)` | `#fff`→`textWhite`；alpha→`ui.whiteNN`；字重→`theme.weight.*` |
| 9 | `screens/BpDetailScreen.tsx` | `:668 #fff`、`:843 borderColor rgba(255,255,255,0.26)`、`:845 shadowColor:'#000'`、`:849/754/737` 裸半径、`:874 #FFFFFF` | 白字→`textWhite`；shadow→`shadow.*`；半径→`radius.*` |
| 10 | `screens/CardioDetailScreen.tsx` | `:89/118/143/153/154 #fff`、`:172/184 CARD_BORDER` 常量、`:178` 裸 padding | 白字→`textWhite`；`CARD_BORDER` 改 `theme.colors.cardBorder` |

**通用修复动作（一次性）**：
- 新增 `theme.colors` 浅底深字族：`onLight`/`onLightSub`/`onLightFaint`（默认 `#2E2A3A` / `#6B7280` / `#9CA3AF`），替换 ①B 的 9+ 种散值。
- 为 `Button`/`Pressable` 基类补 token 化 `disabled`（`ui.white45` 降透明 + 禁点）与 `loading` 态，在 `LoginScreen` / `OnboardingScreen` / `EnergyDetailScreen:1630` / `PeriodRecordPanel:517` / `CycleCalendarScreen:1253` / `CalmWaveHome:765` 引用。
- 配 `scripts/check-tokens.mjs` + lint 规则（禁 `#fff/#000/裸 rgba/裸数字半径`）才能真正止血（详见 `02-design-token-final.md` 反回归指引）。

---

## ④ 反馈话术（给设计 / 产品）

- **给设计**：「App 已建好 Design Token 体系，但组件层仍有 ~150 处裸色、~120 处裸间距未收敛，尤其 11 个白底卡片用了 9 种不同深灰字。建议：(1) 确认浅色孤岛是保留还是统一成深色玻璃风；(2) 批准新增 `onLight` 深字族 token；(3) 定稿后我跑 lint 门禁防复燃。」
- **给产品**：「无障碍有硬伤：6 处字号 <11sp（最小 8sp）在手机上几乎看不清；3 处按钮热区 <44pt 点不准。这些不影响功能但影响可用性与上架评审，建议排进下个迭代。」
- **给开发**：「统一用 `theme.*`，别再手写 `#fff/#000/裸数字`。新增 `onLight` 系列后，浅底深字一律走它。CTA 按钮补 disabled/loading 态。」

---

## ⑤ 复验 checklist（整改后逐条打勾）

- [ ] 全仓无 `#fff` / `#FFFFFF` / `#000` / `shadowColor:'#000'` 裸值（图表/品牌色除外）
- [ ] `theme.fs(N)` 不再出现在任何 Text 的 `fontSize` / `lineHeight`
- [ ] 浅底深字全部收敛到 `onLight` / `onGlassInk` 系列（9+ 散值清零）
- [ ] 页面级 `paddingHorizontal` 统一 `theme.space.screen(24)`
- [ ] 所有 `borderRadius` 数字映射到 `theme.radius.*`
- [ ] 所有 `shadowColor` 映射到 `theme.shadow.*` / `glassMorph`
- [ ] 无 `fontSize < 11`（图表轴标签统一 `axis=10`）
- [ ] 唯一可点热区 ≥ 44pt（或确认是导航键边缘 44）
- [ ] 主 CTA 均有 disabled / loading 视觉态
- [ ] `tsc` 基线 46 零新增，`lint` token 规则通过
- [ ] 删除源码树内 `*.bak` / `*.bak2` 备份文件（避免误导后续审计）

---

## 附录：统计 & 备注

| 类别 | 涉及文件（约） | 违规处（约） |
|---|---|---|
| ① 裸颜色（A深底 + B浅岛 + C渐变） | 32 | 150+ |
| ② 裸半径 | 28 | 70+ |
| ③ 裸字号（含文字 `fs(N)`） | 17 | 60+ |
| ④ 裸间距 | 35 | 120+ |
| ⑤ 裸阴影 | 15 | 22 |
| ⑥ 无障碍/对比度 | 10 | 20+ |
| ⑦ 触控区 <44 | 8 | 12 |
| ⑧ 状态缺失 | 10 | 普遍 |

- **历史备份残留**：`TodayScreen.tsx.bak.20260922-155654`、`InsightScreen.tsx.bak`、`InsightScreen.tsx.bak2`、`EmotionTimeline.tsx.bak` 含旧裸值，不计入统计但应删除以免误导。
- **本审计未改动任何文件**，仅作清单输出。需要我直接按 Top 10 出可执行的修改补丁（先改安全零视觉变化的 token 收敛）时告诉我即可。
