# Mira App · Design Tokens（详情页统一规范 · 深海玻璃主题）

> **版本**：2026-11-03 · 基于 iOS 真机（Expo 51 / RN 0.74.5 Old Arch）当前实现逐文件核对
> **主题**：mira-ocean（2026-10-17 起，由白底改为深海玻璃）
> **用途**：所有新页面 / 新组件 / 改版的**唯一视觉参考**。做任何 UI 前先查本文档；本文档与代码冲突时，以 `src/theme/` 三个 token 文件为准并回写本文档。
>
> **Token 文件（唯一真相源，组件层禁止裸值）**：
> | 文件 | 管什么 |
> |---|---|
> | `src/theme/theme.ts` | 全局：颜色 / 间距 / 字号 / 字重 / 圆角 / 阴影 / 动效 / 按压 / 布局 |
> | `src/theme/mindmate.ts`（`mm`） | 五色相系统 / 玻璃卡规格 / 图标方块配色 / CTA 渐变 |
> | `src/theme/chart.ts` | 图表：语义色槽 / 线宽 / 圆点 / 高度 4 档 / **轴文字字号** |
>
> **换肤/移植须知**：组件层不写裸色值、裸尺寸、裸字体；全 App 不用自定义字体（iOS = SF Pro / PingFang，Android = Roboto / Noto）。

---

## 0. 2026-11-03 统一结论（本次重点）

| 问题 | 旧 | 新（统一后） |
|---|---|---|
| 卡片圆角 | `<Card>` 用 `mm.radius.card=24`，自绘卡用 `theme.radius.card=14` / `md=11` / `sm=9`（两套打架） | **全部卡片 = `radius.card=24`**；`theme.radius.card` 已对齐到 24 |
| 图表轴文字 | 写死 `9.5` / 散落 `11` | **`chart.axisFont=12`**（新增 token，AllDayBarsChart / TempCircadianChart 已切换） |
| 日期选择器中间日期背景 | 独立 `rgba(255,255,255,0.10)` 底 + `0.42` 亮边，与整页玻璃面不一致 | `cardBg` + `cardBorder`（与左右箭头同口径） |
| 散落裸值字体 | `10` / `12` / `theme.fs(15)` / `theme.sp(1.6)=6.4px` / `theme.sp(3.4)=13.6px` / `22` / `26` | 全部路由到 token（micro / sm / body / h2 / statValue） |

**对应 git tag**：`v-ui-20261103-2011`（字体 / 日期选择器修复）+ `theme.radius.card` token 对齐（同版内）。

---

## 1. 页面骨架（Screen 容器）

| 项 | 值 | Token |
|---|---|---|
| 页面根背景 | **深海渐变** `bgTop #3E627A → bgMid #2A4470 → bgBottom #2B3564`，stops `[0, 0.42, 1]` | `colors.bgTop/bgMid/bgBottom` + `bgGradStops/bgGradLocs`（由 ScreenContainer 铺） |
| 页面水平内边距 | **24pt**（= `space.screen`） | `space.screen` |
| 顶部留白 | `xl(24) + insets.top` | ScreenContainer |
| 底部留白 | `tabBarHeight(48) + insets.bottom + raised(16) + 20` | `layout.pageBottomPad(insets)` |
| 内容最大宽 | **500pt**，超宽屏居中 | `layout.maxWidth` |
| 顶边化入遮罩 | 内容滚到顶时溶入底色（渐变遮罩，高 `insets.top + 20`） | ScreenContainer `topFade` |
| 干预系列页（若有暖底） | `mm.colors.pageWarm #2B3564` | `mm.colors.pageWarm` |

> 注：mira-ocean 统一为深海玻璃，不再有白底页面；卡片一律「白 13% 玻璃 + 白 22% 描边」压在深底上。

---

## 2. 颜色系统（深底白阶）

### 2.1 文字色（深底上用白阶，AA ≥4.5）

| Token | 值 | 用途 |
|---|---|---|
| `textInk` / `mm.colors.ink` | `#FFFFFF` | **最强文字**：卡片主数字、标题、白字（深底上即纯白） |
| `textTitle` | `#FFFFFF` | 卡片标题、数值 |
| `textBody` | `rgba(255,255,255,0.82)` | 正文、副标题 |
| `textSub` | `rgba(255,255,255,0.74)` | **次级文字唯一色**（说明、标签、坐标轴）。层次靠字号/字重区分 |
| `textInkSoft` | `rgba(255,255,255,0.78)` | 卡内说明文字 |
| `textWhite80` / `70` | `rgba(255,255,255,0.82/0.70)` | 兼容别名 |
| `textNavIdle` | `rgba(255,255,255,0.55)` | tab 未选中 |
| `textNavOn` / `accentText` | `#BFCBFF` | tab 选中 / 强调文字（长春花蓝，深底上 ≈7.4 对比） |
| `accentSolid` | `#7C6AE0` | **图形专用**（圆点、竖轨、进度、图标底）；当小字在玻璃卡上仅 3.06~3.91 不达标 → 改用 `accentText` |
| `accentSoft` | `rgba(160,178,255,0.16)` | 极浅紫底 |

### 2.2 强调 / 渐变

| Token | 值 | 用途 |
|---|---|---|
| `accent1 / accent2` | `#9D8AF0 / #7EA6F8` | 双色渐变端点（AI 徽章等） |
| `gradCardFrom / To` | `#6355B3 → #7766D7` | 紫渐变数据卡（血压/血糖）。**白字硬约束：最浅端 #7766D7 = 白字 4.51 是底线，卡上文字只能纯白 `ui.onGrad`，禁止半透明白** |
| `aiBadgeGrad` | `['#9D8AF0','#7EA6F8']` | AI 角标渐变 |
| `celebrateGrad` | `['#F3D49B','#F6B3D0']` | 庆祝渐变 |

### 2.3 五色相系统（`mm.colors`，v16 铁律 · 深底上改亮档）

**语义绑定（不可互换）**：紫=认知 · 粉=情绪 · 蓝=运动·心肺(血压·心电) · 黄=元气·能量·代谢 · **黄绿=主轴**（今日状态/恢复/睡眠/完成度/**一切交互选中**，全稿唯一的绿）。单屏色相 ≤4；饱和色面积 ≤2%。

| 色相 | tint | soft | mid | core | deep |
|---|---|---|---|---|---|
| 紫 Iris | `#F4EDFC` | `#E7E1FB` | `#C7B9F2` | `#9D8AF0` | `#6E58C8` |
| 粉 Rose | `#FDF0F6` | `#FCE7F0` | `#F6B3D0` | `#F2A3C6` | `#C9598A` |
| 蓝 Sky | `#F0F4FE` | `#E3EBFE` | `#B9CCF9` | `#7EA6F8` | `#4C74C9` |
| 黄绿 Lime | `#F6F7DC` | `#EAF0BE` | `#BCCB62` | `#D5E384` | `#6E7A24` |
| 黄 Honey | `#FDF7E9` | `#FBEFD6` | `#F3D49B` | `#F0C46E` | `#B98A2E` |

补充档位：
- `mm.colors.purpleBtn #7766D7`：紫按钮/气泡**压白字专用**。
- `mm.colors.ecgRed #E5484D`（soft `rgba(229,72,77,0.14)`）：心电波形线专用红，与异常红解耦。
- `mm.colors.inkSoft #FFFFFF(0.88)`、`inkFaint #FFFFFF(0.74)`：深底上白阶文字（旧文档的墨色已废弃）。

**图标方块 soft 底 + fg 配对**（`mm.chipBg`，26px 图标方块）：lav 紫 / pink 粉 / cyan 蓝 / lime 黄绿 / butter 黄，深底上 fg 用亮档。

### 2.4 状态 / 语义色（深底上改亮档）

| Token | 值 | 用途 |
|---|---|---|
| `success` | `#9BD37E` | 成功/正常态文字（深底亮档） |
| `successSoft` | `rgba(155,211,126,0.18)` | 成功浅底 |
| `danger` | `#F2A3C6` | 风险/疲劳 high 文字 |
| `dangerSoft` | `rgba(242,163,198,0.18)` | 风险浅底 |
| `warn` | `#F0C46E` | 警示 |
| `trendUp / trendDown` | `#BCCB62 / #F2A3C6` | 指标涨跌**文字专用**，必配 ↑/↓ 图标（不只靠颜色） |
| 图表异常红 | `#E2554E` | 图表异常点/异常段（`chart.anomaly`） |
| `ui.rhythmGood / rhythmWarn` | `#8FD6A4 / #F5B97E` | 节律大字·正常/偏高 |
| `ui.rhythmCalm` | `rgba(157,138,240,0.22)` | 节律日历「正常日」底（深底紫玻璃） |

### 2.5 卡片底 / 描边（玻璃体系）

| Token | 值 | 用途 |
|---|---|---|
| `cardBg`（`theme` 与 `mm` 同值） | `rgba(255,255,255,0.13)` | **玻璃卡底色（标准卡面）** |
| `cardBgSoft` | `rgba(255,255,255,0.08)` | 弱玻璃（次级块 / 列表行底色，深底上合规可用） |
| `cardBgStrong` | `rgba(255,255,255,0.16)` | 强玻璃（强调块） |
| `cardBorder`（`theme` 与 `mm` 同值） | `rgba(255,255,255,0.22)` | **玻璃卡描边（标准）** |
| `cardBorder2` | `rgba(255,255,255,0.28)` | 强描边（图标方块 / chip） |
| `ui.glassBg / glassBorder / glassShadow` | `rgba(255,255,255,0.13) / 0.28 / rgba(0,0,0,0.28)` | 拟态玻璃卡 |
| `ui.borderSoft` | `rgba(255,255,255,0.10)` | 列表细分隔线 / 图表网格（深底白阶） |
| `ui.offTrack` | `rgba(255,255,255,0.14)` | 开关未选轨道 / 次按钮浅底 |
| `ui.tabBar` / `mm.tabBg` | `rgba(255,255,255,0.22)` | 底栏胶囊 |
| `ui.onGrad` | `#FFFFFF` | 紫渐变卡上的文字（纯白，禁半透） |
| `overlay` | `rgba(70,58,110,0.30)` | 紫调遮罩 |
| `ui.scrim / Mid / Soft / Dark` | `rgba(0,0,0,0.45/0.35/0.30/0.42)` | 遮罩 |

---

## 3. 字体

无自定义字体。`fs(n)`：按屏宽 0.88~1.22 倍缩放（基准 390pt，iPhone 13 = 1.0）。

### 3.1 字号阶（禁止裸值）

| Token | pt（基准 390） | 角色 |
|---|---|---|
| `fontSize.hero` | **46** | **卡片 hero 主数字**（恢复分 / 压力值 / 情绪分）；600 |
| `fontSize.h1` | 36 | 页面特大标题 |
| `fontSize.stat` | 32 | 指标大数字（血压 118/76） |
| `fontSize.h2` | 22 | **详情页大标题 / 对比卡大数字** |
| `fontSize.orb` | 24 | 圆环中心数值 |
| `fontSize.card` | 18 | **卡片 / 区块标题 / 卡内子卡主数字**（600）；17–18 收口至此 |
| `fontSize.lg` | 20 | **小标题 / 中型强调**（19–21 收口，★ 2026-11-03 新增） |
| `fontSize.body` | 15 | 正文 / 单位 / 按钮文字（14.5–16 收口至此） |
| `fontSize.sm` | 13.5 | **分析正文 / 标签 / 图例 / delta 徽章**（13.5–14 收口至此） |
| `fontSize.xs` | 13 | 次要正文（12–13 收口至此） |
| `fontSize.micro` | 11 | **次级标签 / 副标题 / 轴说明 / 图例小字**（11–11.5 收口至此） |
| `fontSize.tiny` | 10 | **脚注 / 角标 / 免责小字**（8–10.5 收口，★ 2026-11-03 新增） |

行高惯例：副文 `lineHeight = 字号 × 1.4`（约 ×1.5）；大字 `lineHeight = 字号`；分析正文 `lineHeight 21`。

### 3.2 字重

`light 300 / regular 400 / medium 500 / semibold 600 / bold 700`。**只用 400/500/600/700**；标题类一律 600，选中态 600~700。

### 3.3 详情页排版角色映射（跨三页核对＝一致 ✓）

| 视觉角色 | Token | MetricDetailScreen | EnergyDetailScreen | SleepRecoveryHero |
|---|---|---|---|---|
| 页面大标题 | `h2` 22 | `title` ✓ | `title` ✓ | — |
| 卡片 / 区块标题 | `card` 18 | `specLab`/`chartTitle`/`heroTitle` ✓ | `cardTitle`/`chartTitle`/`heroTitle` ✓ | `title` ✓ |
| 卡片主数字 | `hero` 46 | `heroVal` ✓ | `heroVal`/`heroBig`/`bigScore` ✓ | 数字 ✓ |
| 主数字单位 | `body` 15 | `heroUnit` ✓ | `heroUnit`/`scoreUnit` ✓ | — |
| 分析正文 | `sm` 13.5 | `heroAnalysis` ✓ | `heroAnalysis`/`insightText` ✓ | `analysis` ✓ |
| 次级标签 / 副标题 | `micro` 11 | `heroTag`/`statLabel`/`specCount`/`sub` ✓ | `heroLab`/`peakLabel`/`axisNote` ✓ | `lab`/`brCellLab` ✓ |
| 状态 delta 徽章 | `sm` 13.5 semibold | `delta` ✓ | `cmpDelta`/`waStatV` ✓ | — |
| 图表轴文字 | `chart.axisFont` 12 | `AllDayBarsChart`/`TempCircadianChart` 12、`RangeBarsChart` 轴 = `micro` 11 | 趋势 SVG 轴 = 12 | — |
| 图例文字 | `sm` 13.5 | `legendText`/`DayBarsLegend` ✓ | `legendText` ✓ | — |

---

## 4. 间距（`sp(n) = n × 4pt`）

| Token | pt | 用途 |
|---|---|---|
| `space.screen` | 24 | 页面水平内边距 |
| `space.cardPad` | 20 | **外层卡内边距（第一级）** |
| `space.cardPadCompact` | 12 | 紧凑卡内边距（第二级）。★卡内边距**只允许这两级**，禁止第三种密度 |
| `space.xl` | 24 | 大区块间距 / Sheet 底 padding |
| `space.lg` | 20 | |
| `space.md` | 16 | sectionTitle 上间距、常规块间距 |
| `space.card` | 16 | 卡间距 |
| `space.sm` | 12 | 次级间距 |
| `space.xs` | 8 | title 下间距、chip 间距、列表小间距 |

常用直调：`sp(1)=4`、`sp(1.5)=6`、`sp(2)=8`、`sp(2.5)=10`、`sp(3)=12`、`sp(3.5)=14`。

---

## 5. 圆角（**单一标准：卡片 = 24**）

| Token | pt | 用途 |
|---|---|---|
| `radius.phone` | 55 | 手机框模拟 |
| `radius.xl` | 24 | 大表面（同 card）、弹层/大容器（22–32 收口至此） |
| `radius.card` | **24** | **外层卡 + 卡内子卡 + 图表卡（唯一卡圆角标准）**（`theme` 与 `mm` 现已对齐） |
| `radius.lg` | 14 | **内嵌卡 / 浮层内盒 / 中型圆角**（13–16 散值收口，★ 2026-11-03 新增） |
| `mm.radius.chip` | 16 | 四指标 chip |
| `radius.md` | 11 | 控件（按钮、次级卡、ECG 按钮）（10–12 收口至此） |
| `radius.sm` | 9 | 卡内分块、小色块、行高亮（8–10 收口至此） |
| `radius.iconSq`（mm） | 9 | 26px 图标方块 |
| `radius.iconSqMd`（mm） | 10 | 30px 卡角标方块 |
| `radius.pill` | 999 | 胶囊（chip / tag / 日期选择器 / 圆形头像 / 999·9999 收口至此） |

**纪律**：卡片四角一律 24；控件 / 小色块递减；胶囊全圆。禁止出现第三种卡圆角。
**收口白名单（★ 2026-11-03 全 App 搜口后保留）**：`borderRadius < 8`（进度条/小圆点/发丝装饰，属图形绘制非布局圆角）；圆头像/圆按钮（36×36 配 18 等半径=尺寸一半者，语义即「全圆」）。

---

## 6. 阴影

| Token | 参数 | 用途 |
|---|---|---|
| `shadow.card` | `#7878B4` y12 ·0.08 ·r30 ·elev4 | 常规浮起卡（深底上出层次） |
| `shadow.hover` | `#7878B4` y20 ·0.16 ·r44 ·elev8 | 强调浮起 |
| `shadow.nav` | `#8278B4` y**-4** ·0.08 ·r30 ·elev10 | 底栏上投影 |
| `shadow.center` | `#7C6AE0` y12 ·0.38 ·r32 ·elev12 | 中央凸起按钮紫色光晕 |
| `shadow.deckTop / deckBack` | `#463A6E` y20·0.17·r44 / y12·0.12·r26 | 卡叠上/下层 |
| `shadow.sheet` | `#463A6E` y24 ·0.26 ·r60 ·elev16 | Sheet |
| `mm.shadow` | `#000` ·0.28 ·y8 ·r18 ·elev6 | 玻璃卡（黑投影压深） |
| `mm.fabShadow` | `#000` ·0.40 ·y16 ·r15 ·elev6 | AI FAB 光晕 |

---

## 7. 动效（motion）与按压（press）

**时长（禁止裸 duration）**：`instant 100` / `quick 160` / `base 220` / `slow 320` / `sheet 440` / `sheetExit 350`。
**缓动三类**：`easeEnter` `bezier(0.05,0.7,0.1,1)`（进场）/ `easeExit` `bezier(0.3,0,0.8,0.15)`（离场）/ `easeStandard` `bezier(0.2,0,0,1)`（屏内）。
**按压**：`press.scale 0.96`（小控件）/ `scaleCard 0.985`（卡片）/ `opacity 0.7`（列表行/链接）。循环：`motion.breath.*`。

---

## 8. 布局（layout）

| Token | 值 | 用途 |
|---|---|---|
| `layout.maxWidth` | 500 | 内容最大宽 |
| `layout.tabBarHeight` | 48 | 悬浮 tab 胶囊高 |
| `layout.tabCenterSize` | 48 | 中央按钮 |
| `layout.raised` | 16 | 中央按钮超出胶囊高度 |
| `layout.moodWheelRatio` | 0.72 | 情绪轮盘比例 |
| `ui.tabBar` / `mm.tabBg` | `rgba(255,255,255,0.22)` | 底栏胶囊 |

---

## 9. 图表 Token（`chart.ts`，所有图表组件共用）

**语义色槽**：`series.primary = accentSolid 紫`（恢复分/心理压力/孕激素）、`series.secondary = limeMid 亮绿`（睡眠时长/雌激素）、`series.cortisol = limeMid`（皮质醇，用户定稿不用墨色）。异常 `chart.anomaly #E2554E`。

| 项 | 值 |
|---|---|
| 坐标轴文字色 | `axisText = textSub`（深底白阶）；双轴 `axis.left #D5E384`(黄绿) / `axis.right accentSolid`(紫) |
| **轴文字字号** | **`axisFont = 12`（绝对 px，SVG 内不随 viewBox 缩放）；2026-11-03 由 9.5 放大统一** |
| 网格 | `ui.borderSoft`，虚线 `'3 4'`；参考线虚线 `'5 4'` |
| 线宽 | 主线 `2.4`、参考线 `1.3`、网格 `1` |
| 圆点 | 常规 r3、异常 r6、描边 2 |
| 柱 | `radius 3`、`minWidth 4`、`maxWidth 24`、`slotRatio 0.6`、`minHeight 2`、`emptyH 2`、`emptyRadius 1`、`opacity{solid1,faint0.12}` |
| 切换动效 | fade 160ms |

**高度只分 4 档（由信息层级决定，与页面无关，同层级必须等高）**：

| 档 | 总高 | 绘图区净高 | 用途 |
|---|---|---|---|
| `chart.h.xs` | 64 | 44 | 迷你（洞察页双列小卡/今日状态条） |
| `chart.h.s` | 96 | 70 | 卡内嵌趋势（节律小卡） |
| `chart.h.m` | 180 | 140 | 详情单指标 |
| `chart.h.l` | 240 | 190 | 详情主趋势、双轴柱线组合 |

装饰带预算：`chrome.card 24` / `chrome.detail 50`。

---

## 10. 卡片规范（落地标准 · 玻璃体系）

| 属性 | 标准值 | 说明 |
|---|---|---|
| 背景 | `cardBg = rgba(255,255,255,0.13)` | 玻璃卡，压在深海渐变上 |
| 描边 | `cardBorder = rgba(255,255,255,0.22)` | 白 22% 细边 |
| 圆角 | `radius.card = 24` | 唯一卡圆角 |
| 阴影 | `shadow.card`（或 `mm.shadow` 黑投影） | 深底出层次 |
| 内边距 | `cardPad(20)` 或 `cardPadCompact(12)` | 两级 |
| 卡内子卡 | 同 `cardBg`/`cardBorder`/`radius.card` | 峰值低谷小卡、三格统计、图例块同口径 |
| 日期选择器（`DateAnchorPicker`） | 步进器箭头与中间日期 pill 统一 `cardBg`/`cardBorder`（2026-11-03 修复） | 此前中间日期用独立 `0.10` 底 + `0.42` 亮边，与整页玻璃面不一致 |

---

## 11. 组件模式规范（重点）

### 11.1 标准卡 `<Card>`（详情页主卡）
- 玻璃底 `cardBg` + 描边 `cardBorder` + 阴影；圆角 `radius.card 24`；`overflow hidden`。
- 内边距 `cardPad 20`（`padded` 默认开）；紧凑场景 12。
- 深底上文字走白阶 token；紫渐变卡（血压/血糖）文字一律纯白 `onGrad`。

### 11.2 区块标题
- `cardTitle` / `chartTitle` / `heroTitle`：`card 18 · 600 · textTitle · marginBottom 8`（卡标题）
- `sectionTitle`（若有）：`sm 13.5 · 600 · textTitle · marginTop 16 · marginBottom 8`
- `blockTitle`（卡内小块标题）：`micro 11 · textSub`

### 11.3 Hero（大状态字区，日视图）
- 卡标题 `ctitle`：`body 15 · 600 · textTitle · marginBottom 6`
- 大状态字 `heroBig` / `heroVal`：`hero 46 · 600 · lineHeight=字号`，**按状态着色**（rhythmGood / moodRest 等）
- 小标签 `heroLab`：`micro 11 · textSub · marginTop 4`；右上下文 `heroCtx`：`card 18 · 600` 状态色
- **duo 双格**（峰值时刻 + 作息类型）：`duoCell` `flex1 · paddingVertical 10 · paddingHorizontal 11 · borderRadius 24`（2026-11-03 已与卡同圆角）· 底用语义 soft 或 `cardBgSoft`；`duoTime` `body 15 · 600 · textTitle`

### 11.4 Pill / Chip（选择胶囊 · 日周月年 `RangeSwitch` / 日期选择）
```
pill：paddingHorizontal 16 · paddingVertical 9 · borderRadius pill 999
  默认底 rgba(255,255,255,0.95)（选中亮白） · 文字 textSub
  选中文字 #2A4470（深蓝，白底上可读）
```

### 11.5 月份日历选择器（`DateAnchorPicker` 弹窗）
- 头：`‹ 2026年10月 ›` 翻月钮 + 月份文字 `sm 13.5 · 600 · textTitle`；取消/今天 `sm 13.5`
- 星期行：一~日，`micro 11 · textSub · medium`
- 格子：`width '14.2857%'` + **显式 `height: 36`（禁 `aspectRatio`，Yoga 双遍 bug）**；`borderRadius sm 9`；统一透明边框
- 今天：描边 + 文字 `#2A4470 · 600`（白底深字）；选中：底白 95% + 深蓝字
- 日期文字 `xs 13 · lineHeight 18`（归一基线）

### 11.6 详情页通用
- 图表卡标题：`chartTitle`（`XXX趋势图` 统一，如 身体负荷趋势图 / 心率趋势图 / 体温趋势图…）
- 分析正文：`heroAnalysis` `sm 13.5 · textSub · lineHeight 21`
- 状态 delta 徽章：`delta` `sm 13.5 · 600`（涨绿 `trendUp` / 跌粉 `trendDown`，配 ↑/↓）

---

## 12. 禁止项清单（用户明确的红线）

1. ❌ 组件里写**裸色值 / 裸尺寸 / 裸字体 / 裸 duration / 裸 activeOpacity**——一律走 token。
2. ❌ 卡圆角出现**第三种值**——卡片只有 24，控件/小色块递减（11/9）。
3. ❌ 卡内边距出现**第三种密度**（只允许 20 / 12 两级）。
4. ❌ 图表轴文字再写 `9.5 / 10 / 11` 等裸值——统一 `chart.axisFont`（12）。
5. ❌ 紫渐变卡（血压/血糖）上用**半透明白**文字——只能纯白 `ui.onGrad`。
6. ❌ 日历/网格用 `aspectRatio`（Yoga 双重应用 bug）——显式像素宽高。
7. ❌ `textSub` 往浅调（深底上 0.74 已是 AA 达标的最浅解）；层次靠字号字重。
8. ❌ 品牌文案红线：不用"我们"居高临下、不做认知反馈/评分、用户自报为主、规避"监测/疗愈/诊断/激励"词。

---

## 13. 变更纪律

1. **改样式 = 改 token 或改统一模式**，一次规则全量生效；禁止一处一处补。
2. 全局类改动完成后 **grep 全量扫**验证，不要只看当前页。
3. 「编辑成功 ≠ 生效」：样式改动必须真机验证；SVG/部分组件需杀 App 重开；疑似旧 bundle 时 Metro `expo start -c` 清缓存。
4. tsc 基线有大量历史类型错误（集中于 RingBleManager 等），但 RN 走 Babel 不挡编译；任何改动不得**新增**与本次无关的报错。
5. 新模式先查本文档第 11 节；确需新增模式 → 先在 token 文件加 token + 回写本文档。
