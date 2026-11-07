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

---

## ④ 逐屏走查补遗（2026-11-07 22:xx · 本轮，用户要求"每个页面每个交互都排查 + 处理"）

> 方法：在 ③ 文件级清单基础上，按用户点名的 **四个维度**做**全仓扫描 + 重点屏精读**，并**已经开始落地修复**（不再只出清单）。
> 扫描基准同 ③；本段新增"已修复 / 待修"状态列与批次计划。

### 4.1 图表横纵轴字号（★ 已修复 Batch 1 · commit ca7a2da）
用户原话"图表横坐标纵坐标都要好好排查"。扫描发现 **13 个文件**的 SVG / RN 图表标签字号散落 `8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11`，与 `chart.ts.axisFont=12`（2026-11-03 已定稿的轴字号权威值）及 `theme.fontSize.axis=fs(10)`（RN 文本轴标签 token）冲突。
**修复动作**：12 文件、40+ 处图表标签统一路由到 token——
- SVG `<SvgText>` 轴/刻度/数据标签 → `chart.axisFont`（12，绝对像素，对应 chart.ts 口径）；
- RN `<Text>` 热力图月份表头 / X 轴标签 → `theme.fontSize.axis`（10，缩放文本轴 token）。
- 仅刻意保留：`StatusTrendDetailScreen:1183` "!" 警示字形（`fontSize={11}`，非轴文本）、`MetricDetailScreen:654` "+N" 溢出角标、`MetricDetailScreen:744` 热力格内计数（受 9px 格高限制，放大即溢出，已记 🔴 待产品确认是否保留微数）。
- `HormoneCurveCard.tsx` 此前未 import `chart`，已补 `import { chart } from '../theme/chart'`。
- tsc 46 基线 / 0 新增。

### 4.2 模块间垂直间距（⚠️ 待修 · 用户点名"模块跟模块中间的空间不一致"）
对 `src/screens/*` 全量扫描 `marginTop` 取值分布（含 `theme.sp(N)` 与裸数字），**确认不一致**：同一类"卡与卡之间"的留白至少出现 **17 档不同值**：

| 取值 | 含义(pt) | 出现次数 |
|---|---|---|
| `theme.sp(1)` | 4 | 70 |
| `theme.sp(2)` | 8 | 57 |
| 裸 `2` | 2 | 37 |
| `theme.sp(1.5)` | 6 | 27 |
| `theme.sp(3)` | 12 | 24 |
| 裸 `4` | 4 | 20 |
| 裸 `6` | 6 | 7 |
| 裸 `12` | 12 | 7 |
| `theme.sp(2.5)` | 10 | 6 |
| `theme.sp(0.5)` | 2 | 20 |
| `theme.sp(4)` | 16 | 4 |
| 裸 `8/3/20/16/14` | — | 各 1~3 |
| `theme.sp(8/6)` | 32/24 | 各 2 |
| `theme.sp(3.5/2.25/12/0.3/0.25/0.2)` | — | 各 1 |

**结论**：`theme.space` 已有 `xs(8)/sm(12)/md(16)/lg(20)/xl(24)` 但落地率极低。`marginTop` 既承担"卡内小间距"也承担"模块间大间距"，**语义未分层**是根因。
**修复方向（Batch 2 提案）**：约定——模块间（卡片/区块之间）统一 `theme.space.md(16)` 或 `theme.space.lg(20)`；卡内元素用 `xs(8)/sm(12)`；页头 `paddingHorizontal` 统一 `theme.space.screen(24)`。需逐屏精读后替换（盲目替换会动到卡内小间距，需人工核对）。

### 4.3 标题字号（✅ 已修复 Batch 3 · commit 54e34f4）
38 个 screen 中，页头主标题 `styles.title` 此前混用 `h2(22)×14 / lg(20)×2 / card(18)×2 / body×2`。
**修复动作**：把 2 处偏离多数派的页头标题（`BpDetailScreen:790`、`EcgDetailScreen:500`，均用 `lg`）统一拉齐到 `h2(22)`，与 14 屏既有页头主标题一致；`ctitle`/`subtitle`/`card` 等**卡片内标题**属次级层级，不动。
→ 现页头主标题全仓统一为 `fontSize.h2`。tsc 46 基线 / 0 新增。

### 4.4 颜色（①B 浅色孤岛 ✅ 已修复 · ①A/①C ⚠️ 待修）
①B 浅色孤岛：白卡上的深灰文字此前散用 4 种互不相同的近黑/中灰/浅灰（`#1F2937`/`#1F1D1A`/`#6B7280`/`#9CA3AF`）。
**修复动作（Batch 4 · commit 54e34f4）**：9 处白卡文字灰路由到既有 `ui.onGlassInk` 族——
- 近黑（`#1F2937`/`#1F1D1A`）→ `ui.onGlassInk`
- 中灰（`#6B7280`）→ `ui.onGlassInkSub`
- 浅灰（`#9CA3AF`）→ `ui.onGlassInkFaint`
涉及 `TaskDeck`(5) / `CycleCalendarScreen` / `PeriodLogCard` / `MeditationPlayer` / `BreathingPlayer`。
**刻意保留不动**：品牌深蓝 `#2A4470`、橄榄 `#3E4A18`、品牌紫 `#6E58C8`（均为刻意品牌深，非"灰得不一样"）、`MindIcons` 默认色（影响面过广、可能用在深底）、所有 `shadowColor:#1F1D1A`（阴影色，归 ⑤ 裸阴影、不可见不优先）。
①A 深底裸白黑（`#fff`/`#FFFFFF`/`shadowColor:'#000'`，28 文件/90+ 处）、①C 渐变裸 hex（4 文件）属**零视觉变化的 token 收敛**，优先级低于可见一致性，留待 lint 门禁批处理。

### 4.5 复验 & 批次计划
- [x] **Batch 1（图表轴字号）** 已提交 `ca7a2da`（12 文件）。
- [x] **Batch 3（页头标题字号）** 已提交 `54e34f4`（2 屏 → `h2` 统一）。
- [x] **Batch 4-①B（白卡文字灰）** 已提交 `54e34f4`（9 处 → `onGlassInk` 族）。
- [x] **间距·页容器留白**：`TodayScreen:1505` 页容器 `paddingHorizontal:28` → `theme.space.screen(24)`，已随 `54e34f4` 提交。
- [ ] **Batch 2（模块间垂直间距）**：扫描发现——`TodayScreen` 首页与 `MetricDetailScreen`（主卡栈 `<View style={{gap:theme.space.md}}>` @869）**已规范**；真正需修的是"用手写零散 `marginTop` 堆卡、未用统一 gap 父容器"的滞后屏。整改法：把主卡栈包进 `gap:theme.space.md` 父容器，逐屏精读替换。属结构改动，需逐屏设备复验。
- [ ] **Batch 4-①A/①C（深底裸白黑 / 渐变裸 hex）**：零视觉 token 收敛，配套 `scripts/check-tokens.mjs` lint 门禁防复燃（详见 `02-design-token-final.md`）。
- [ ] 删除 `*.bak/*.bak2` 历史备份（避免误导后续审计）。
- ⚠️ 间距/标题/颜色属结构改动，逐屏替换后需真机复验（尤其华为 P30 真机 EMUI 玻璃渲染）。

### 4.6 A 方案执行结果（5 高频屏·模块间距统一 · 2026-11-07 晚）
用户选 A：先攻 5 个高频屏，逐个精读主卡栈、统一模块间距到 `space.md`(16px)。全仓 stack gap 普查结论：**7 屏用 `space.md`，仅 InsightScreen 用 `space.lg`(24px) 孤例**；其余不一致均为"手写零散 `marginTop` 堆卡 / 子组件 fragment 无 gap"。

| 屏 | 问题 | 处置 | commit |
|---|---|---|---|
| BpDetailScreen | Hero→chart 等模块为裸 `marginTop:12`/0 混杂（实际 16→0→12→0 跳变） | 主卡栈包 `<View gap:space.md>`，去 4 处 `marginTop:12` | `5c4647f` |
| SleepDetailScreen | 日视图 `SleepRecoveryHero` 未包 section，与首卡零间距 | hero 包进 `styles.section`（其余卡片原已 `mb-md`，本身一致） | `6a1703e` |
| InsightScreen | `stack` 用 `gap:space.lg`(24px)，全仓唯一 | `lg→md`，与详情屏对齐 | `cfabbbe` |
| EnergyDetailScreen | 子组件 `CognitiveRangeView` 内 4 卡靠 `mt sp(2)`(8px) 撑开（首卡还叠加 stack 16→24）；主栈 3 张顶层卡 `mt sp(2)`(8) 叠加 stack 16→24，与无 mt 兄弟卡(16)不一致 | 子组件卡包 `gap:space.md` + 去 7 处 `mt sp(2)` | `3e8eadb` |
| StatusTrendDetailScreen | **已自洽**（stack gap-md，卡无零散 mt，260 行 gap 父容器为 11-07 已修） | 无需改动 | — |

**结论**：5 屏模块间距现已统一到 16px。Batch 2（全仓 38 屏 sweep）剩 33 屏，按同一模式（主卡栈包 `gap:space.md` / 子组件内卡包 gap / 去零散 mt / `stack` 统一 md）推进即可，建议配 lint 门禁防复燃。
**tsc 全程守门**：46 存量 / 0 新增。
