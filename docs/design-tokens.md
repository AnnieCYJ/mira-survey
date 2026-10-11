# Mira App · Design Token & 组件规范大全

> **版本**：2026-10-10 · 基于 iOS 真机（Expo 51 / RN 0.74.5 Old Arch）当前实现逐文件核对
> **用途**：所有新页面 / 新组件 / 改版的**唯一视觉参考**。做任何 UI 前先查本文档；本文档与代码冲突时，以 `src/theme/` 三个 token 文件为准并回写本文档。
>
> **Token 文件（唯一真相源，组件层禁止裸值）**：
> | 文件 | 管什么 |
> |---|---|
> | `src/theme/theme.ts` | 全局：颜色 / 间距 / 字号 / 字重 / 圆角 / 阴影 / 动效 / 按压 / 布局 |
> | `src/theme/mindmate.ts`（`mm`） | 五色相系统 / 白卡规格 / 图标方块配色 / CTA 渐变 |
> | `src/theme/chart.ts` | 图表：语义色槽 / 线宽 / 圆点 / 高度 4 档 |
>
> **换肤/移植须知**：组件层不写裸色值、裸尺寸、裸字体；全 App 不用自定义字体（iOS = SF Pro / PingFang，Android = Roboto / Noto）。

---

## 1. 页面骨架（Screen 容器）

| 项 | 值 | Token |
|---|---|---|
| 页面根背景 | 紫渐变 `#B5A9F2 → #CFC8F7 → #E6E3FB → #F7F5FE`，stops `[0, 0.34, 0.64, 1]`（上紫下白，由 App.tsx / ScreenContainer 铺） | `colors.bgGradStops / bgGradLocs` |
| 渐变端点色 | 顶 `bgTop #B5A9F2`、中 `bgMid #DED9FB`、底 `bgBottom #F7F5FE` | `colors.bgTop/bgMid/bgBottom` |
| 页面水平内边距 | **24pt** | `space.screen` |
| 顶部留白 | 常规 `xl(24) + insets.top`；紧凑页 `screen(24) + insets.top` | ScreenContainer `compactTop` |
| 底部留白 | `tabBarHeight(48) + insets.bottom + raised(16) + 20` | `layout.pageBottomPad(insets)` |
| 内容最大宽 | **500pt**，超宽屏居中 | `layout.maxWidth` |
| 顶边化入遮罩 | 内容滚到顶时溶入底色（渐变遮罩，高 `insets.top + 20`），不是硬切 | ScreenContainer `topFade` |
| 干预系列页暖白底 | `#F7F5F0`（区别于根紫渐变） | `mm.colors.pageWarm` |

---

## 2. 颜色系统

### 2.1 文字色（全部实测 WCAG AA ≥4.5，禁止再调浅）

| Token | 值 | 用途 |
|---|---|---|
| `textInk` | `#1A1A1A` | **最强文字**：折叠头左标签、关键标签 |
| `textTitle` | `#6C5647` | 卡片标题、数值、暖棕色标题系 |
| `textBody` | `#4A4A5C` | 正文、日历日期 |
| `textSub` | `#5F5F74` | **次级文字唯一色**（说明、标签、坐标轴）。层次感靠字号/字重区分，**不许调浅** |
| `textInkSoft` | `#4A4660` | chip 文字等 |
| `textWhite` | `#FFFFFF` | 深底/选中态文字 |
| `textNavIdle` | `#737086` | tab 未选中 |
| `textNavOn` | `#6C5FB5` | tab 选中 |
| `orbTextInk / Sub / Faint` | `#2E2A3A / #6B6480 / #453F5A` | 首页圆环中心（值 > 副文 > 时效 三层） |
| `accentText` | `#6153AF` | **小字强调色**（accentSolid 直接当小字在玻璃卡上只有 3.06~3.91，不达标） |

### 2.2 强调 / 渐变

| Token | 值 | 用途 |
|---|---|---|
| `accent1 / accent2` | `#9D8AF0 / #7EA6F8` | 双色渐变端点（AI 徽章等） |
| `accentSolid` | `#7C6AE0` | **图形专用**：圆点、竖轨、进度、图标底、选中底 |
| `accentSoft` | `rgba(124,106,224,0.12)` | 极浅紫底（sumCell 等浅底块；用户否决灰紫 `cardBgSoft` 后的替代） |
| `gradCardFrom / To` | `#6355B3 → #7766D7` | 紫渐变数据卡（血压/血糖）。**白字硬约束：最浅端 #7766D7 = 白字 4.51 是底线，卡上文字只能纯白 `ui.onGrad`，禁止半透明白** |
| `aiBadgeGrad` | `['#9D8AF0','#7EA6F8']` | AI 角标渐变 |
| `celebrateGrad` | `['#F3D49B','#F6B3D0']` | 庆祝渐变 |

### 2.3 五色相系统（`mm.colors`，v16 铁律）

**语义绑定（不可互换）**：紫=认知 · 粉=情绪 · 蓝=运动·心肺(血压·心电) · 黄=元气·能量·代谢 · **黄绿=主轴**（今日状态/恢复/睡眠/完成度/**一切交互选中**，全稿唯一的绿）。单屏色相 ≤4；饱和色面积 ≤2%。

| 色相 | tint | soft | mid | core | deep |
|---|---|---|---|---|---|
| 紫 Iris | `#F4EDFC` | `#E7E1FB` | `#C7B9F2` | `#9D8AF0` | `#6E58C8` |
| 粉 Rose | `#FDF0F6` | `#FCE7F0` | `#F6B3D0` | `#F2A3C6` | `#C9598A` |
| 蓝 Sky | `#F0F4FE` | `#E3EBFE` | `#B9CCF9` | `#7EA6F8` | `#4C74C9` |
| 黄绿 Lime | `#F6F7DC` | `#EAF0BE` | `#BCCB62` | `#D5E384` | `#6E7A24` |
| 黄 Honey | `#FDF7E9` | `#FBEFD6` | `#F3D49B` | `#F0C46E` | `#B98A2E` |

补充档位：
- `mm.colors.purpleBtn #7766D7`：紫按钮/气泡**压白字专用**（紫按钮一律取这档，core 白字仅 2.9）。
- `mm.colors.ecgRed #E5484D`（soft `rgba(229,72,77,0.14)`）：心电波形线专用红，与异常红解耦。

**图标方块 soft 底 + deep 图标配对**（`mm.chipBg`，26px 图标方块）：

| tone | bg | fg |
|---|---|---|
| lav 紫 | `#E7E1FB` | `#6E58C8` |
| pink 粉 | `#FCE7F0` | `#C9598A` |
| cyan 蓝 | `#E3EBFE` | `#4C74C9` |
| lime 黄绿 | `#EAF0BE` | `#6E7A24` |
| butter 黄 | `#FBEFD6` | `#B98A2E` |

指标卡无固定色相时用 `pastelFamilyFor(key)` 稳定哈希取一族。

### 2.4 状态 / 语义色

| Token | 值 | 用途 |
|---|---|---|
| `success` | `#6E7A24`（= limeDeep） | 成功/正常（v16 起只做文字与标记） |
| `successSoft` | `rgba(188,203,98,0.18)` | 成功浅底 |
| `danger` | `#C9598A`（= roseDeep） | 危险/疲劳 high |
| `dangerSoft` | `rgba(224,123,107,0.14)` | 危险浅底 |
| `warn` | `#F0C46E`（= honeyCore） | 警示 |
| `trendUp / trendDown` | `#0A6F4D / #B13232` | 指标涨跌**文字专用**，必配 ↑/↓ 图标（不只靠颜色） |
| 图表异常红 | `#E2554E` | 图表异常点/异常段（chart.anomaly） |
| `ui.rhythmGood / rhythmWarn` | `#1E8E5A / #C2571A` | 节律大字·正常/偏高、紊乱 |
| `ui.rhythmCalm` | `#D9D2F8` | 节律日历「正常日」底（异常日 = roseCore 粉） |

### 2.5 卡片底 / 描边

| Token | 值 | 用途 |
|---|---|---|
| `mm.colors.cardBg` | `#FFFFFF` | **数据卡一律白底**，颜色只上图形 |
| `mm.colors.cardBorder` | `rgba(31,29,26,0.09)` | 白卡描边（0.05 看不见，用户实测后提到 0.09） |
| `colors.cardBgSoft` | `#F7F6FC` | ⚠️ **历史遗留，用户明确否决灰底**——折叠头/列表一律禁用（仅 duoCell「作息类型」格暂用） |
| `colors.cardBorder` | `#E8E6F2` | 紫系控件描边 |
| `ui.glassBg / glassBorder / glassShadow` | `rgba(255,255,255,0.55) / rgba(255,255,255,0.7) / rgba(80,60,140,0.12)` | 拟态玻璃卡 |
| `ui.panelGlass` | `rgba(255,255,255,0.72)` | 全天状态面板玻璃底 |
| `ui.hazeWarm / panelHaze` | `#F5EEDD / #EDE4CB` | 面板下缘暖黄弥散（后者是加深可用档） |
| `ui.borderSoft` | `rgba(120,120,180,0.08)` | 列表细分隔线（图表网格同源） |
| `ui.offTrack` | `rgba(120,120,140,0.28)` | 开关未选轨道 / 次按钮浅底 |
| `mm.colors.btnBusyBg` | `rgba(31,29,26,0.06)` | 未选中 pill/chip 浅底 |
| `tileCog/Emo/Act/Rec` | `#E4E1F8 / #F8E6EC / #DFE9F9 / #F6EFE0` | 首页四小卡底（与对应大卡同色相，同亮度档 S≈20/L≈93） |
| `cardGlowEmotion/Brain/Sport` | `#F5E8E0 / #E0F1F5 / #E0E2F5` | 消耗卡单侧色晕 |
| `tileRingTrack` | `rgba(26,26,26,0.10)` | 指标环底轨 |
| `ui.scrim / Mid / Soft / Dark` | `rgba(0,0,0,0.45/0.35/0.30/0.42)` | 遮罩 |
| `overlay` | `rgba(70,58,110,0.30)` | 紫调遮罩 |

---

## 3. 字体

无自定义字体。`fs(n)`：按屏宽 0.88~1.22 倍缩放（基准 390pt）。

### 3.1 字号阶（10 档，禁止裸值）

| Token | pt（基准 390） | 用途 |
|---|---|---|
| `fontSize.hero` | **46** | 详情页大状态字（节律"正常"、认知准备度），600，状态着色，`lineHeight = 字号` |
| `fontSize.h1` | 36 | 页面特大标题 |
| `fontSize.stat` | 32 | 卡内指标大数字（血压 118/76） |
| `fontSize.h2` | 22 | 页标题 / 睡眠总时长大字（600） |
| `fontSize.orb` | 24 | 圆环中心数值 |
| `fontSize.card` | 18 | **卡片标题**（600 · textTitle · marginBottom 8）；详情卡标题 `cardTitle` 同款 |
| `fontSize.body` | 15 | 正文 / 折叠头标题（rhythmCollapsedTitle） / `ctitle`（600 · textTitle · marginBottom 6） |
| `fontSize.sm` | 13.5 | sectionTitle（600 · textTitle）、pill 文字、次级正文 |
| `fontSize.xs` | 13 | **列表行主力字号**：折叠头左标签(600·textInk)、列表行 K/V、日历日期、chip 文字 |
| `fontSize.micro` | 11 | 最小档：副文、标签、时效、duo 标签、日历星期头、`blockTitle`（睡眠卡块标题 11px 对齐预览稿） |

行高惯例：副文 `lineHeight = 字号 × 1.4`；大字 `lineHeight = 字号`；日历日期**固定 `lineHeight: 18`**（归一不同字重的基线，防止"今天"数字下沉）。

### 3.2 字重

`light 300 / regular 400 / medium 500 / semibold 600 / bold 700`。
**只用 400/500/600/700 四档**；标题类一律 600，选中态文字 600~700。

---

## 4. 间距（sp(n) = n × 4pt）

| Token | pt | 用途 |
|---|---|---|
| `space.screen` | 24 | 页面水平内边距 |
| `space.cardPad` | 20 | **外层卡内边距（第一级）** |
| `space.cardPadCompact` | 12 | 紧凑卡内边距（第二级）。★卡内边距**只允许这两级**，禁止第三种密度 |
| `space.xl` | 24 | 大区块间距 / Sheet 底 padding |
| `space.lg` | 20 | |
| `space.md` | 16 | sectionTitle 上间距、常规块间距 |
| `space.card` | 16 | |
| `space.sm` | 12 | 折叠头 marginTop、次级间距 |
| `space.xs` | 8 | title 下间距、chip 间距、列表小间距 |

常用 sp() 直调值：`sp(1)=4`、`sp(1.5)=6`、`sp(2)=8`、`sp(2.25)=9`（折叠头/列表行 paddingVertical）、`sp(2.5)=10`、`sp(2.75)=11`、`sp(3)=12`（展开列表行 paddingVertical）、`sp(3.5)=14`、`sp(7)=28`（日历翻月按钮 28×28）。

---

## 5. 圆角（两套体系并存，按卡片归属选用）

**theme 体系**（紫系页面 / 控件，2026-09-20 收紧：外层卡 > 控件 > 卡内分块）：

| Token | pt | 用途 |
|---|---|---|
| `radius.phone` | 55 | 手机框模拟 |
| `radius.xl` | 24 | 特大面板 |
| `radius.card` | 14 | 外层卡（Card/GlassCard/Sheet） |
| `radius.md` | 11 | 控件、次级卡、duoCell |
| `radius.sm` | 9 | 卡内分块、小色块、日历格 |
| `radius.pill` | 999 | 胶囊 |

**mm 体系**（白数据卡）：`mm.radius.card = 24`（标准白卡）、`chip = 16`（四指标 chip）、`iconSq = 9`（26px 图标方块）、`iconSqMd = 10`（30px 卡角标方块）。

⚠️ `<Card>` 用 `mm.radius.card = 24`；`<GlassCard>` 用 `theme.radius.card = 14`。新卡片按视觉归属选容器，不要混。

---

## 6. 阴影

| Token | 参数 | 用途 |
|---|---|---|
| `shadow.card` | `#7878B4` y12 ·0.08 ·r30 ·elev4 | 常规浮起卡 |
| `shadow.hover` | `#7878B4` y20 ·0.16 ·r44 ·elev8 | 强调浮起 |
| `shadow.nav` | `#8278B4` y**-4** ·0.08 ·r30 ·elev10 | 底栏上投影 |
| `shadow.center` | `#7C6AE0` y12 ·0.38 ·r32 ·elev12 | 中央凸起按钮紫色光晕 |
| `shadow.deckTop / deckBack` | `#463A6E` y20·0.17·r44 / y12·0.12·r26 | 卡叠上层/下层 |
| `shadow.sheet` | `#463A6E` y24 ·0.26 ·r60 ·elev16 | Sheet |
| `mm.shadow` | `#1F1D1A` ·0.14 ·y7 ·r17 ·elev2 | **白数据卡**（= CSS `0 14px 34px -18px rgba(31,29,26,.14)`） |
| `mm.fabShadow` | `#9D8AF0` ·0.6 ·y16 ·r15 ·elev6 | AI FAB 紫光晕（= CSS `0 16px 30px -12px rgba(157,138,240,.6)`） |

---

## 7. 动效（motion）与按压（press）

**时长 5+1 档（禁止裸 duration）**：

| Token | ms | 用途 |
|---|---|---|
| `motion.instant` | 100 | 开关、状态点、按压反馈 |
| `motion.quick` | 160 | 颜色/透明度、小位移、图表 fade |
| `motion.base` | 220 | 默认：卡片入场、列表项、普通过渡 |
| `motion.slow` | 320 | 大位移、局部展开 |
| `motion.sheet` | 440 | 整屏面板 / 大表面 |
| `motion.sheetExit` | 350 | 离场 = 进场 ×0.8（消失要更快） |

**缓动三类（按物理语义选，不要默认 inOut）**：
- `easeEnter` `bezier(0.05,0.7,0.1,1)` 进场减速 → 元素出现
- `easeExit` `bezier(0.3,0,0.8,0.15)` 离场加速 → 元素消失
- `easeStandard` `bezier(0.2,0,0,1)` 屏内标准 → 已在屏上的移动/变色

**按压反馈（替代 9 种裸 activeOpacity）**：
- `press.scale 0.96` 小控件（图标按钮、chip）；`press.scaleCard 0.985` 卡片大表面
- `press.opacity 0.7` 非缩放场景（列表行、链接）统一 activeOpacity
- 原则：反馈必须在 `motion.instant`(100ms) 内完成

循环动画周期（非过渡）：`motion.breath.dot 3000 / dotActive 2600 / halo 4600 / orbRotate 120000`。

---

## 8. 布局（layout）

| Token | 值 | 用途 |
|---|---|---|
| `layout.maxWidth` | 500 | 内容最大宽 |
| `layout.tabBarHeight` | 48 | 悬浮 tab 胶囊高 |
| `layout.tabCenterSize` | 48 | 中央按钮 |
| `layout.raised` | 16 | 中央按钮超出胶囊高度 |
| `layout.moodWheelRatio` | 0.72 | 情绪轮盘比例 |
| `ui.tabBar` | `rgba(250,250,254,0.96)` | tab 胶囊底 |
| `mm.colors.tabBg` | `rgba(255,255,255,0.96)` | 底栏 |
| `mm.colors.fabFrom/To` | `#A98FE8 → #9D8AF0` | FAB 紫渐变 |

---

## 9. 图表 Token（`chart.ts`，所有图表组件共用）

**语义色槽**：`series.primary = accentSolid 紫`（恢复分/心理压力/孕激素）、`series.secondary = limeMid 亮绿`（睡眠时长/雌激素）、`series.cortisol = limeMid 亮绿`（皮质醇，用户定稿不用墨色）。异常统一 `chart.anomaly #E2554E`。

| 项 | 值 |
|---|---|
| 坐标轴文字色 | 左轴深绿 `#5C7A1E`（区别于亮绿柱）、右轴紫 accentSolid；`axisText = textSub` |
| 网格 | `ui.borderSoft`，虚线 `'3 4'`；参考线虚线 `'5 4'`、色 `rgba(31,29,26,0.32)` |
| 线宽 | 主线 `2.4`、参考线 `1.3`、网格 `1` |
| 圆点 | 常规 r3、异常 r6、描边 2 |
| 柱圆角 | 3 |
| 切换动效 | fade 160ms |

**高度只分 4 档（由信息层级决定，与页面无关，同层级必须等高）**：

| 档 | 总高 | 绘图区净高 | 用途 |
|---|---|---|---|
| `chart.h.xs` | 64 | 44 | 迷你（洞察页双列小卡/今日状态条） |
| `chart.h.s` | 96 | 70 | 卡内嵌趋势（节律小卡） |
| `chart.h.m` | 180 | 140 | 详情单指标 |
| `chart.h.l` | 240 | 190 | 详情主趋势、双轴柱线组合 |

装饰带预算（从总高剥离）：`chrome.card 24`（卡内）/ `chrome.detail 50`（详情页：轴标题带 + X 轴标签带 + 图例带）。
皮质醇图**无纵轴**（预览稿铁律）。

---

## 10. 组件模式规范（重点）

### 10.1 标准白卡 `<Card>`（数据卡唯一形态）
- 白底 `mm.colors.cardBg` + 描边 1 `mm.colors.cardBorder` + 阴影 `mm.shadow`；圆角 `mm.radius.card 24`；`overflow hidden`
- 内边距 `space.cardPad 20`（`padded` 默认开）；紧凑场景 12
- **数据卡一律白底，颜色只上图形**；卡语义靠图形 + soft/deep 角标

### 10.2 玻璃卡 `<GlassCard>`（首页消耗卡/概览卡）
- `glassMorph`：底 `rgba(255,255,255,0.55)` + 白高光描边 1 + 紫投影 `rgba(80,60,140,0.12)` y8 r20；圆角 `theme.radius.card 14`
- 内边距同 cardPad 20

### 10.3 折叠头「查看详情」（全 App 统一，9 处已对齐）★ 最高频模式

**结构**：`TouchableOpacity` 整行可点 → 行内 `左标签 + 右箭头`，两端对齐。

**收起态（mhRow，EnergyDetailScreen 为基准实现）**：
```
flexDirection row · alignItems center · justifyContent space-between
marginTop: 12 (space.sm) · paddingVertical: 9 (sp 2.25) · paddingHorizontal: 0
背景：无（禁止 cardBgSoft 灰底！） · 边框：无（禁止 borderTop 横线！）
```
- 左标签 `mhLabel`：`xs 13 · 600 · textInk`
- 右箭头 `mhChev`（CSS 自绘，不用图标字体）：
```
width/height: 8 (sp 2) · borderRightWidth 1.6 · borderBottomWidth 1.6
borderColor textSub · transform rotate 45deg（= 指向下）· marginRight 3
```
- **展开态箭头 `rotate -135deg`（指向右上）**——不是 90/-90 体系（SleepAnalysisCard 的旧 90/-90 属历史遗留，新代码一律 45/-135）
- 计数徽章 `mhCount`（可选）：`micro 11 · limeDeep 字 · limeSoft 底` 胶囊

**变体 rhythmCollapsedRow（CortisolDailyChart，图表下方的折叠行）**：
- `marginTop sp(2)=8 · paddingVertical sp(1)=4`，其余同上
- 左标题 `rhythmCollapsedTitle`：`body 15 · 600 · textTitle`（比 mhLabel 大一档，因为它是卡片标题级）
- 紫提示字 `rhythmCollapsedHint`：`micro 11 · accentSolid`，在箭头左侧 `marginRight 8`

**展开容器**：`marginTop sp(1.5)=6 · paddingTop sp(2.5)=10`（rhythmCollapsedRowOpen / rowsBox）。

### 10.4 展开列表行（MetricRow / RhythmListRow，纵向列表，禁止 2×2 格子/表格元素/横线）
```
行：flexDirection row · alignItems center · justifyContent space-between
    paddingVertical sp(2.25)=9（metricRow）或 sp(3)=12（rhythmListRow）
    无 borderBottom！行距拉开靠 paddingVertical，不用分隔线
左 K：xs 13 · textSub · flexShrink 1 · marginRight 8
右 V：xs 13 · 600 · textTitle · 右对齐（rhythmListR/metricR alignItems flex-end）
副行 S（可选）：micro 11 · textSub · lineHeight 11×1.4 · textAlign right · marginTop 2
分节小标题 rhythmListSection：sm 13.5 · 600 · textTitle · marginTop 14 · marginBottom 4
```

### 10.5 详情页 Hero（大状态字区，日视图）
- 卡标题 `ctitle`：`body 15 · 600 · textTitle · marginBottom 6`
- `heroWrap`：`row · alignItems flex-end · space-between`（左大字，右上下文）
- 大状态字 `heroBig`：`hero 46 · 600 · lineHeight=字号`，**按状态着色**（rhythmGood/rhythmWarn/moodRest 等）
- 小标签 `heroLab`：`micro 11 · textSub · marginTop 4`；右上下文 `heroCtx`：`xs 13 · 600` 状态色
- **duo 双格**（仅日视图，峰值时刻 + 作息类型）：
```
duoRow: row · gap 10 (sp2.5) · marginTop 8
duoCell: flex1 · paddingVertical 10 · paddingHorizontal 11 · borderRadius md 11
  底色：语义格用 limeSoft（如峰值时刻），中性格 cardBgSoft
duoLab: micro 11 · textSub · marginBottom 3
duoTime: fs(17) · 600 · textTitle · lineHeight 17×1.1
duoSub: micro 11 · textSub · lineHeight 11×1.4 · marginTop 3
```

### 10.6 区块标题
- `sectionTitle`：`sm 13.5 · 600 · textTitle · marginTop 16 · marginBottom 8`（表单/面板分节）
- `cardTitle`：`card 18 · 600 · textTitle · marginBottom 8`（卡标题）
- `blockTitle`：`micro 11 · textSub`（卡内小块标题，对齐预览稿 11px）

### 10.7 Pill / Chip（选择胶囊）
```
pill：paddingHorizontal 16 · paddingVertical 9 · borderRadius pill 999
  默认底 mm.colors.btnBusyBg rgba(31,29,26,0.06) · 文字 sm 13.5 · inkSoft
  选中底 accentSolid · 文字 textWhite · 600
  margin：右 8 / 下 8（wrap 布局）
chip（描边款，FoodScan）：paddingHorizontal 16 · paddingVertical 6 · pill · border 1 cardBorder · 白底 · 文字 xs 13
```

### 10.8 Sheet / Modal（底部弹层，以经期记录为例）
```
遮罩：ui.scrim rgba(0,0,0,0.45)，justifyContent flex-end
Sheet：白底 cardBgStrong · 顶部圆角 radius.card 14 · padding cardPad 20 · paddingBottom xl 24 · maxHeight '88%'
  阴影 shadow.sheet；顶部 grabber 横条 sheetHandle
头部：row · space-between —— 左标题（如「经期记录」）+ 右 ✕ 关闭钮（hitSlop 12，必须给，不能只靠保存退出）
内容：ScrollView（style: marginTop 8 · flexShrink 1 · minHeight 0 —— 保证封顶时能滚、按钮不被顶出）
```

### 10.9 月份日历选择器（PeriodRecordPanel，2026-10-10 定稿）
- **头**：`‹ 2026年10月 ›`——翻月钮 28×28（`sp(7)`，字符 ‹ › · `card 18` · 600 · textTitle，禁用时 cardBorder 色）；月份文字 `sm 13.5 · 600 · textTitle`；头 `marginBottom 6`
- **星期行**：一~日，`micro 11 · textSub · medium`，周末 `limeDeep`；`marginBottom 3`
- **格子**：`width '14.2857%'`（7 列）+ **显式 `height: 36`（sp 9）——禁止 aspectRatio**（iOS 旧架构 Yoga 会把比例应用两遍：50÷1.35÷1.35≈27pt，且容器按单遍预留 → 底部出空腔，2026-10-10 实测确诊）
  - `borderRadius sm 9`；**所有格子统一 `borderWidth 1 + borderColor transparent`**（今天只换 `limeDeep` 描边）——保证内容盒一致，数字不下沉
  - 今天：描边 `limeDeep` + 文字 `limeDeep · 600`；选中：底 `limeMid` + 文字 `#3E4A18 · bold`；未来日：禁点 + 文字 `cardBorder` 置灰
  - 日期文字 `xs 13 · lineHeight 18`（归一基线）
  - 周一为首列；首行空位用空 `View`（同样式）补位；**尾部不补空格子**
  - 可前翻 24 个月，不可翻未来
- 默认定位：已选日期所在月 / 今天

### 10.10 其他已定稿的小模式
- 首页 AI 建议气泡缩略图 `suggThumb`：**48×48**（2026-10-10 由 36 调大）
- 空状态 `histEmpty`：`micro 11 · textSub`
- 历史列表行：`row · center · gap 8 · paddingH 12 · paddingV 8`；描边框（`border 1 cardBorder · radius sm 9`），不铺灰底
- 方法与依据卡（页面底部常显）：白底描边卡 + `methodTitle body 600` + `methodItem micro · lineHeight ×1.6`
- 睡眠大时长：`h2 22 · 600 · mm.colors.ink` + 单位 `micro · textSub`（baseline 对齐，`durRow alignItems baseline`）

---

## 11. 禁止项清单（用户明确的红线）

1. ❌ 折叠头/展开区**灰底**（`cardBgSoft`）——折叠头一律透明无底。
2. ❌ 展开区**上方的横线**（`borderTopWidth`）——全 App 已删 9 处，新代码禁止再加。
3. ❌ 展开列表里的**行间分隔线**（`borderBottomWidth`）——行距用 `paddingVertical` 拉开。
4. ❌ 展开内容用 **2×2 格子 / 表格 / Tile 方块**——一律纵向列表行。
5. ❌ **无意义的展开区**（如"逐周期明细"已整段删除）——展开必须有信息增量。
6. ❌ 组件里写**裸色值 / 裸尺寸 / 裸字体 / 裸 duration / 裸 activeOpacity**。
7. ❌ 卡内边距出现**第三种密度**（只允许 20 / 12 两级）。
8. ❌ 紫渐变卡上用**半透明白**文字（只能纯白 `ui.onGrad`）。
9. ❌ 日历/网格用 `aspectRatio`（Yoga 双重应用 bug）——显式像素宽高。
10. ❌ 单个格子单独加边框（内容盒不一致 → 数字下沉）——全格统一透明边框，选中/今天只换色。
11. ❌ `textSub` 往浅调（#5F5F74 是 AA 达标的最浅解）；层次靠字号字重。
12. ❌ 品牌文案红线（非视觉但同源）：不用"我们"居高临下、不做认知反馈/评分、用户自报为主、规避"监测/疗愈/诊断/激励"词。

---

## 12. 变更纪律（工作方式约定）

1. **改样式 = 改 token 或改统一模式**，一次规则全量生效；禁止一处一处补。
2. 全局类改动（折叠头、灰底、横线）完成后 **grep 全量扫**验证，不要只看当前页。
3. 「编辑成功 ≠ 生效」：样式改动必须真机验证；SVG/部分组件不热重载，需杀 App 重开；疑似旧 bundle 时 Metro 用 `expo start -c` 清缓存重启。
4. tsc 基线 **42 errors**：任何改动不得新增。
5. 新模式先查本文档第 10 节；确需新增模式 → 先在 token 文件加 token + 回写本文档。
