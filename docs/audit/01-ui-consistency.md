# Mira App · UI 一致性审查报告（维度 1）

> 审查日期：2026-11-06
> 审查范围：`src/` 下全部 **303** 个 `.ts` / `.tsx` 文件（排除 `src/theme/` 下 4 个 token 定义文件本身）
> 审查方式：AST 级静态扫描（正则提取全部样式字面量）+ 语义位归类（按样式名 / 布局角色聚类）+ 跨文件交叉比对
> 性质：**只读分析，未修改任何源码文件**

---

## 0. 结论速览

| 指标 | 数值 |
|---|---|
| 颜色字面量（hex + rgba） | **895 处**，分布在 **111** 个文件 |
| ├─ 与现有 token 值完全一致（可直接机械替换） | **384 处**（42.9%） |
| └─ token 表中查无此值（需新建 token 或改用语义 token） | **511 处**（57.1%） |
| 唯一色值 | hex 167 种 + rgba 170 种 = **337 种**（token 表只定义了约 120 种） |
| `borderRadius` 声明 | **786 处**，分布在 **137** 个文件 |
| `fontSize` 声明 | **1765 处**，分布在 **143** 个文件 |
| 间距声明（padding / margin / gap） | **3199 处**，分布在 **148** 个文件 |
| `fontWeight` 声明 | **936 处**，分布在 **132** 个文件 |
| **本次列出的具体问题条目** | **52 条**（🔴 12 · 🟡 21 · 🔵 19） |

**核心判断**：项目已有相当成熟的 token 体系（`theme.ts` 19 KB + `mindmate.ts` 8.5 KB），且 `theme.radius.card = mm.radius.card = 24` 在 2026-11-03 刚做过统一。**问题不在于缺少 token，而在于 token 体系存在「双轨制」（theme.* vs mm.*）且执行率不足** —— 大约 43% 的颜色字面量本可以零成本换成已有 token，却散落在 111 个文件里；另有 511 处是 2026-10-17「mira-ocean 白底→深海玻璃」换肤时**没有跟着迁移的历史遗留**（典型如 `rgba(31,29,26,*)` 墨色系残留在深色页面上）。

---

## 1. 现有 token 体系清单（实际数值）

### 1.1 `src/theme/theme.ts` — 主设计系统

#### 颜色（`colors`，line 20–226）

| 组 | Token | 值 | 说明 |
|---|---|---|---|
| 背景渐变 | `bgTop` / `bgTopAlt` | `#1F4C7E` / `#1D4876` | 深海顶部 |
| | `bgMid` / `bgMidAlt` | `#113861` / `#113861` | |
| | `bgBottom` | `#0A294F` | |
| | `bgGradStops` / `bgGradLocs` | `['#1F4C7E','#113861','#0A294F']` / `[0,0.46,1]` | 根渐变唯一真相源 |
| 主强调（紫） | `accent1` / `accent2` | `#9D8AF0` / `#7EA6F8` | 渐变两端 |
| | `accentSolid` | `#7C6AE0` | **色块/描边/图形专用**（小字用会低于 4.5:1） |
| | `accentText` | `#BFCBFF` | **小字专用**（长春花蓝，AA 达标） |
| | `accentSoft` | `rgba(160,178,255,0.16)` | |
| 登录页绿 | `accentGreen` / `accentGreenSoft` / `accentGreenText` | `#16A06A` / `rgba(22,160,106,0.20)` / `#79E0AE` | 仅 LoginScreen |
| 紫色渐变卡 | `gradCardFrom` / `gradCardTo` | `#6355B3` / `#7766D7` | 最浅端 `#7766D7` 是白字 4.51 的上限 |
| 五色状态 | `stateCalm` / `stateEnergy` / `stateTense` / `stateTired` | `#BCCB62` / `#9D8AF0` / `#F0C46E` / `#7EA6F8` | |
| 情绪 | `moodEnergy` / `moodGood` / `moodNeutral` / `moodRest` | `#F0C46E` / `#BCCB62` / `#9D8AF0` / `#F2A3C6` | |
| 文字 | `textWhite` / `textWhite80` / `textWhite70` | `#FFFFFF` / `rgba(255,255,255,0.82)` / `rgba(255,255,255,0.70)` | |
| | `textTitle` / `textBody` / `textSub` | `#FFFFFF` / `rgba(255,255,255,0.82)` / `rgba(255,255,255,0.74)` | 主文字层级 |
| | `textNavIdle` / `textNavOn` | `rgba(255,255,255,0.55)` / `#BFCBFF` | tab |
| | `trendUp` / `trendDown` | `#BCCB62` / `#F2A3C6` | 涨跌（配 ↑↓ 图标） |
| | `textInk` / `textInkSoft` | `#FFFFFF` / `rgba(255,255,255,0.78)` | |
| | `ringOnLight` | `rgba(191,203,255,0.55)` | |
| 头像 | `avatarBgLight` / `avatarBorderLight` | `rgba(255,255,255,0.14)` / `rgba(255,255,255,0.22)` | |
| 圆环内文字 | `orbTextInk` / `orbTextInkSub` / `orbTextInkFaint` | `#FFFFFF` / `rgba(255,255,255,0.72)` / `rgba(255,255,255,0.55)` | |
| 卡片面 | `cardBg` / `cardBgSoft` / `cardBgStrong` | `rgba(255,255,255,0.13)` / `0.08` / `0.16` | 玻璃卡三级底 |
| | `cardBorder` / `cardBorder2` | `rgba(255,255,255,0.22)` / `rgba(255,255,255,0.28)` | |
| 语义色 | `success` / `successSoft` | `#9BD37E` / `rgba(155,211,126,0.18)` | |
| | `danger` / `dangerSoft` | `#F2A3C6` / `rgba(242,163,198,0.18)` | |
| | `warn` | `#F0C46E` | |
| | `overlay` | `rgba(70,58,110,0.30)` | |
| 渐变组 | `celebrateGrad` / `aiBadgeGrad` | `['#F3D49B','#F6B3D0']` / `['#9D8AF0','#7EA6F8']` | |
| 首页色晕 | `cardGlowEmotion` / `cardGlowBrain` / `cardGlowSport` | `rgba(242,163,198,0.20)` / `rgba(157,138,240,0.22)` / `rgba(126,166,248,0.22)` | |
| 四小卡底 | `tileCog` / `tileEmo` / `tileAct` / `tileRec` | `rgba(157,138,240,0.22)` / `rgba(242,163,198,0.20)` / `rgba(126,166,248,0.22)` / `rgba(213,227,132,0.18)` | |
| | `tileRingTrack` | `rgba(255,255,255,0.14)` | 环底轨 |

#### `colors.ui` — 语义化界面令牌（line 165–225，共 28 项）

| Token | 值 |
|---|---|
| `tabBar` | `rgba(255,255,255,0.22)` |
| `scrim` / `scrimMid` / `scrimSoft` / `scrimDark` | `rgba(0,0,0,0.45)` / `0.35` / `0.30` / `0.42` |
| `white25` / `white55` / `white72` / `white92` | `rgba(255,255,255,0.25)` / `0.55` / `0.72` / `0.92` |
| `hazeWarm` / `panelHaze` / `panelGlass` | `rgba(160,178,255,0.14)` / `0.18` / `rgba(255,255,255,0.10)` |
| `accentSoft20` | `rgba(160,178,255,0.20)` |
| `offTrack` | `rgba(255,255,255,0.14)` |
| `glassBg` / `glassBorder` / `glassShadow` | `rgba(255,255,255,0.13)` / `0.28` / `rgba(0,0,0,0.28)` |
| `successText` | `#9BD37E` |
| `rhythmGood` / `rhythmWarn` / `rhythmCalm` | `#8FD6A4` / `#F5B97E` / `rgba(157,138,240,0.22)` |
| `chipText` / `chipGradEnd` / `chipNeutralBg` | `rgba(255,255,255,0.72)` / `#8FA6F0` / `rgba(255,255,255,0.14)` |
| `shadowBlack` / `shadowDeep` | `#000` / `#463A6E` |
| `borderSoft` | `rgba(255,255,255,0.10)` |
| `playScrim` / `playBadge` | `rgba(0,0,0,0.42)` / `rgba(255,255,255,0.10)` |
| `onGrad` | `#FFFFFF`（渐变卡上唯一允许的纯白） |

#### 尺寸 token

**`space`**（line 230–245）— 8 档，全部是 `sp(n) = n*4`：

| Token | 值 | Token | 值 |
|---|---|---|---|
| `screen` | 24 | `xs` | 8 |
| `card` | 16 | `sm` | 12 |
| `cardPad` | 20 | `md` | 16 |
| `cardPadCompact` | 12 | `lg` | 20 |
| | | `xl` | 24 |

> ⚠️ 注意：`space.card = space.md = 16`，`space.cardPad = space.lg = 20`，`space.screen = space.xl = 24` —— **存在同值不同名**。`card` 这个名字有歧义（是「卡片」还是「卡片间距」？实际值 16 是通用间距，不是 cardPad 20）。

**`radius`**（line 257）— 7 档：

| Token | 值 | 规定用途 |
|---|---|---|
| `phone` | 55 | 手机外框 |
| `xl` | 24 | 与 `card` 同值（别名残留） |
| `card` | 24 | 外层卡 + 卡内子卡 + 图表卡 |
| `lg` | 14 | 卡内分块、控件 |
| `md` | 11 | 控件（按钮、次级卡、ECG 按钮） |
| `sm` | 9 | 卡内小色块、行高亮 |
| `pill` | 999 | 胶囊（chip / tag / 头像） |

**`fontSize`**（line 263–279）— 12 档，`fs(n)` 按屏宽 0.88~1.22 缩放（基准 390pt）：

| Token | 基准值 | Token | 基准值 |
|---|---|---|---|
| `h1` | 36 | `body` | 15 |
| `h2` | 22 | `sm` | 13.5 |
| `stat` | 32 | `xs` | 13 |
| `hero` | 46 | `micro` | 11 |
| `orb` | 24 | `tiny` | 10 |
| `card` | 18 | `lg` | 20 |

**`weight`**（line 281–287）— 5 档：`light 300` / `regular 400` / `medium 500` / `semibold 600` / `bold 700`

#### 其他 token

- **`shadow`**（line 289–339）— 7 组：`card` / `hover` / `nav` / `center` / `deckTop` / `deckBack` / `sheet`
- **`motion`**（line 360–372）— `instant 100` / `quick 160` / `base 220` / `slow 320` / `sheet 440` / `sheetExit 350` + 3 条缓动曲线 + `breath` 动画周期
- **`press`**（line 379–386）— `scale 0.96` / `scaleCard 0.985` / `opacity 0.7`
- **`layout`**（line 388–399）— `maxWidth 500` / `tabBarHeight 48` / `tabCenterSize 48` / `moodWheelRatio 0.72` / `raised 16`
- **`glassMorph`**（line 412–422）— 拟态玻璃卡外观（`glassBg` + 1px `glassBorder` + 黑投影）

### 1.2 `src/theme/mindmate.ts` — 五色相系统（v16）

#### 颜色（`mm.colors`）— 五色相 × 5 档

| 色相 | tint | soft | mid | core | deep |
|---|---|---|---|---|---|
| 紫 Iris（认知） | `#F4EDFC` | `#E7E1FB` | `#C7B9F2` | `#9D8AF0` | `#6E58C8` |
| 粉 Rose（情绪） | `#FDF0F6` | `#FCE7F0` | `#F6B3D0` | `#F2A3C6` | `#C9598A` |
| 蓝 Sky（运动心肺） | `#F0F4FE` | `#E3EBFE` | `#B9CCF9` | `#7EA6F8` | `#4C74C9` |
| 黄绿 Lime（今日状态） | `#F6F7DC` | `#EAF0BE` | `#BCCB62` | `#D5E384` | `#6E7A24` |
| 黄 Honey（元气代谢） | `#FDF7E9` | `#FBEFD6` | `#F3D49B` | `#F0C46E` | `#B98A2E` |

- `purpleBtn` `#7766D7`（按钮底专用，白字 4.51 上限）
- `ecgRed` `#E5484D` / `ecgRedSoft` `rgba(229,72,77,0.14)`
- 文字白阶：`ink` `#FFFFFF` / `inkSoft` `rgba(255,255,255,0.88)` / `inkFaint` `rgba(255,255,255,0.74)`
- `emptyFill` `rgba(255,255,255,0.08)` / `sleepDot` `rgba(255,255,255,0.22)`
- `cardBg` `rgba(255,255,255,0.13)` / `cardBorder` `rgba(255,255,255,0.22)` / `chipBorder` `rgba(255,255,255,0.28)` / `tabBorder` `rgba(255,255,255,0.22)`
- CTA：`btnGradFrom` `rgba(255,255,255,0.32)` / `btnGradTo` `rgba(255,255,255,0.14)` / `btnTextOnGrad` `#FFFFFF` / `btnBusyBg` `rgba(255,255,255,0.10)`
- Hero：`heroGradFrom` `rgba(9,28,48,0.52)` / `heroGradTo` `rgba(38,62,96,0.40)` / `heroBorder` / `heroTrack` / `heroPillGreen`
- `fabFrom` `#3A3644` / `fabTo` `#2E2A3A`

#### `mm.radius`（line 108–113）— 4 档

| Token | 值 | 与 `theme.radius` 对比 |
|---|---|---|
| `card` | 24 | ✅ 与 `theme.radius.card` 一致（2026-11-03 已对齐） |
| `chip` | 16 | ❌ `theme.radius` 无对应档，`theme.radius.lg = 14` 差 2px |
| `iconSq` | 9 | ✅ 等于 `theme.radius.sm` |
| `iconSqMd` | 10 | ❌ `theme.radius` 无对应档，介于 `sm 9` 与 `md 11` 之间 |

#### `mm.chipBg`（line 116–122）— 5 组图标方块 bg/fg

| key | bg | fg |
|---|---|---|
| `lav` | `rgba(157,138,240,0.22)` | `#D9CFF9` |
| `pink` | `rgba(242,163,198,0.20)` | `#F9D3E4` |
| `cyan` | `rgba(126,166,248,0.22)` | `#CFDEFB` |
| `lime` | `rgba(213,227,132,0.20)` | `#E9F3C0` |
| `butter` | `rgba(240,196,110,0.20)` | `#F8E3B8` |

#### `mm.shadow` / `mm.fabShadow`

`color #000000` / `opacity 0.28` / `height 8` / `radius 18` / `elevation 6`；FAB 光晕 `opacity 0.4` / `height 16` / `radius 15`

### 1.3 `src/theme/ocean.ts` / `src/theme/chart.ts`

存在但本轮未纳入主线（`ocean.ts` 为背景渐变归档，`chart.ts` 为图表专用色板）。**`chart.barRadius` 被 6 处直接引用**（见 C-04）。

### 1.4 双轨制现状（关键结论）

项目存在 **两套并行 token 空间**，语义高度重叠：

| 语义 | theme 轨 | mindmate 轨 | 使用文件数 |
|---|---|---|---|
| 卡片底 | `theme.colors.cardBg` (62) | `mm.colors.cardBg` (16) | **78** |
| 卡片描边 | `theme.colors.cardBorder` (64) | `mm.colors.cardBorder` (16) | **80** |
| 主文字 | `theme.colors.textTitle` (82) | `mm.colors.ink` (54) | **136** |
| 次文字 | `theme.colors.textSub` (113) | `mm.colors.inkFaint` (29) | **142** |
| 正文 | `theme.colors.textBody` (34) | `mm.colors.inkSoft` (23) | **57** |
| 卡片圆角 | `theme.radius.card` (48) | `mm.radius.card` (14) | **62** |

同时 **文字层级有 6 套**（`textSub 0.74` / `inkFaint 0.74` / `textBody 0.82` / `inkSoft 0.88` / `textInkSoft 0.78` / `textWhite80 0.82`），实际出现 620+250+171+95+87+51+35+34 处。

---

## 2. 漂移问题清单

### 🔴 Critical（12 条）

---

#### C-01 · 深色页面上残留白底时代的墨色系（511 处新色值中的最大一簇）

`rgba(31,29,26,0.0X)` 是**白底设计时代的正文墨色**（`#1F1D1A` 的半透明版）。mira-ocean 换肤（2026-10-17）把页面底色改成深海玻璃后，这些分隔线/轨道/底槽色**没有跟着迁移**，在深色背景上表现为「几乎看不见的暗线」或「深色空洞」。

**影响文件（12 个，43 处）**：`FoodScanScreen.tsx`(18)、`ToolTopicScreen.tsx`(4)、`HealthAgeDetailScreen.tsx`(5)、`TodayScreen.tsx`(1)、`HomeAiBubble.tsx`(2)、`EmotionQuickRecord.tsx`(4)、`CortisolRhythmCard.tsx`(1)、`SuggestionCard.tsx`(1)、`CortisolAnomalySheet.tsx`(1)、`SavedAdviceDeck.tsx`(1)、`MindWave.tsx`(1)

**典型位置**

`src/screens/FoodScanScreen.tsx:1121`
```ts
// 当前
track: { flex: 1, height: theme.sp(2), borderRadius: theme.radius.pill, backgroundColor: 'rgba(31,29,26,0.07)', overflow: 'hidden' },
```
```ts
// 建议
track: { flex: 1, height: theme.sp(2), borderRadius: theme.radius.pill, backgroundColor: theme.colors.ui.offTrack, overflow: 'hidden' },
```

`src/screens/FoodScanScreen.tsx:1249`
```ts
// 当前
ehint: { ..., borderTopWidth: 1, borderTopColor: 'rgba(31,29,26,0.07)' },
```
```ts
// 建议
ehint: { ..., borderTopWidth: 1, borderTopColor: theme.colors.ui.borderSoft },
```

`src/screens/ToolTopicScreen.tsx:1238`
```ts
// 当前
borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(31,29,26,0.08)',
```
```ts
// 建议
borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
```

`src/screens/HealthAgeDetailScreen.tsx:242`
```tsx
// 当前
<Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(31,29,26,0.06)" strokeWidth={1} />
```
```tsx
// 建议
<Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
```

`src/components/HomeAiBubble.tsx:39`
```ts
// 当前
const GLASS_BORDER = 'rgba(31,29,26,0.14)';       // 浅描边（同原版）
```
```ts
// 建议
const GLASS_BORDER = theme.colors.ui.glassBorder;  // 白玻璃描边，与 GlassCard 同源
```

> **替代映射表**：`rgba(31,29,26,0.05/0.06/0.07/0.08)` → `theme.colors.ui.borderSoft`（`rgba(255,255,255,0.10)`）；`0.10/0.14/0.16` → `theme.colors.ui.offTrack`（`rgba(255,255,255,0.14)`）；`0.32/0.35/0.42` → `theme.colors.ui.scrimSoft` / `scrim`。

---

#### C-02 · 深海主题里的「白底卡片」——最刺眼的视觉断裂

`src/components/EmotionInsightView.tsx:751-753`
```ts
// 当前
cycleCard: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
  backgroundColor: '#FDF4F9', borderWidth: 1, borderColor: '#F0DCEA', borderRadius: theme.radius.md, padding: theme.sp(2), marginTop: theme.sp(2) },
cycleText: { flex: 1, fontSize: theme.fontSize.xs, color: '#A8628C', lineHeight: theme.fontSize.xs * 1.5 },
```
```ts
// 建议
cycleCard: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(1.5),
  backgroundColor: theme.colors.cardBg, borderWidth: 1, borderColor: theme.colors.cardBorder, borderRadius: theme.radius.md, padding: theme.sp(2), marginTop: theme.sp(2) },
cycleText: { flex: 1, fontSize: theme.fontSize.xs, color: theme.colors.accentText, lineHeight: theme.fontSize.xs * 1.5 },
```

> 同文件 `:752` 的 `#FDF4F9`/`#F0DCEA`/`#A8628C` 三个色值在 token 表中**完全查无**，属于纯私造。

---

#### C-03 · 情绪点阵 6 色系统自成一套，绕过五色相 token

`src/components/EmotionInsightView.tsx:108-123`
```ts
// 当前
const DOT_BY_MOOD: Record<string, string> = {
  [COL_CALM]:     '#B8C86A',   // ≈ limeMid #BCCB62，但差 4 个色阶
  [COL_PLEASANT]: '#F2C35E',   // ≈ honeyCore #F0C46E
  [COL_EXCITED]:  '#F39A62',   // ✗ token 表中没有这个橙
  [COL_STRESSED]: '#D58AAE',   // ≈ roseMid #F6B3D0
  [COL_ANXIOUS]:  '#C9789F',   // ≈ roseDeep #C9598A
};
const DOT_EMPTY = 'rgba(255,255,255,0.25)';
const DOT_SLEEP  = 'rgba(255,255,255,0.35)';
```
```ts
// 建议 —— 复用 mm 五色相，色值全部来自 token
const DOT_BY_MOOD: Record<string, string> = {
  [COL_CALM]:     mm.colors.limeMid,    // #BCCB62
  [COL_PLEASANT]: mm.colors.honeyCore,  // #F0C46E
  [COL_EXCITED]:  mm.colors.honeyDeep,  // #B98A2E
  [COL_STRESSED]: mm.colors.roseMid,    // #F6B3D0
  [COL_ANXIOUS]:  mm.colors.roseDeep,   // #C9598A
};
const DOT_EMPTY = mm.colors.moodNone;   // rgba(255,255,255,0.25)
const DOT_SLEEP  = mm.colors.moodSleep;  // rgba(255,255,255,0.35)
```

**同文件重复出现**：`:119-123`（DOT_LEGEND 数组）、`:135-137`（反查函数 `if (c === '#F39A62')`）、`:207-210`（手动记录映射）—— 共 **17 处**同一组私有色值重复粘贴。
**风险**：`:135-137` 用字符串相等做反查。一旦颜色改成 token 引用（`mm.colors.honeyDeep`），`c === '...' if` 逻辑会**静默失效** —— 这是必须改的隐藏 bug。

---

#### C-04 · 圆角用了 spacing token（语义维度错配）

`theme.sp(n)` 是间距刻度（n×4），用在 `borderRadius` 上属于**语义维度错配** —— 改间距会连带改圆角。

**49 处，分布在 26 个文件**。典型：

`src/screens/FoodScanScreen.tsx:1195`
```ts
// 当前
adviceCard: { flex: 1, minWidth: 0, borderRadius: theme.sp(4), padding: theme.sp(3), ... },
```
```ts
// 建议
adviceCard: { flex: 1, minWidth: 0, borderRadius: theme.radius.md, padding: theme.sp(3), ... },
```

`src/screens/FoodScanScreen.tsx:1167`
```ts
// 当前
mmDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.75) },
```
```ts
// 建议
mmDot: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.pill },
```

`src/components/EmotionQuickRecord.tsx:684`
```ts
// 当前
customBtn: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.sp(4), backgroundColor: mm.colors.purpleSoft },
```
```ts
// 建议
customBtn: { paddingHorizontal: theme.sp(2.5), paddingVertical: theme.sp(1), borderRadius: theme.radius.md, backgroundColor: mm.colors.purpleSoft },
```

`src/components/CognitiveLoadCard.tsx:385`
```ts
// 当前
legendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.sp(0.5), marginRight: theme.sp(0.75) },
```
```ts
// 建议
legendSwatch: { width: theme.sp(2), height: theme.sp(2), borderRadius: theme.radius.sm, marginRight: theme.sp(0.75) },
```

`src/components/EcgCard.tsx:341` / `:347`
```ts
// 当前
borderRadius: theme.sp(0.5),
```
```ts
// 建议
borderRadius: theme.radius.sm,
```

> **注意**：圆形点用 `theme.sp(w/2)` 是数学上正确的（`sp(2)/2 = sp(1)`），但仍应显式用 `theme.radius.pill` 表达「这是一个圆」的设计意图 —— 否则改 `sp` 刻度时圆点会变成椭圆。

---

#### C-05 · 页面级左右留白不一致（同一层级的 4 种值）

首页/详情页内容区左右留白应统一，但实测有 **16 / 18 / 20 / 24** 四种：

| 值 | Token 应为 | 出现位置 |
|---|---|---|
| 16（裸值） | `theme.space.screen` = 24 | `CardioDetailScreen.tsx:168` `wrap: { paddingHorizontal: 16, ... }` |
| 18（裸值） | `theme.space.screen` = 24 | `EcgDetailScreen.tsx:493`、`BpDetailScreen.tsx:869` |
| 20（裸值） | `theme.space.screen` = 24 | `MeditationScreen.tsx:467/521`、`HealthAgeDetailScreen.tsx:625`、`ProfileScreen.tsx:286` |
| 24（token） | ✅ | `TodayScreen` / `AccountHubScreen` / `MiraAIHomeScreen` / `PrivacyPolicyScreen` / `FoodScanScreen` / `ToolTopicScreen` / `MemberDetailScreen` / `EmotionInterveneScreen`（共 24 文件） |

`src/screens/CardioDetailScreen.tsx:168`
```ts
// 当前
wrap: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40 },
```
```ts
// 建议
wrap: { paddingHorizontal: theme.space.screen, paddingTop: theme.sp(4.5), paddingBottom: theme.sp(10) },
```

`src/screens/EcgDetailScreen.tsx:493`
```ts
// 当前
paddingHorizontal: 18,
```
```ts
// 建议
paddingHorizontal: theme.space.screen,
```

> **横向对比证据**：`CardioDetailScreen` 与 `MetricDetailScreen` / `SleepDetailScreen` 是同级的「指标详情页」，前者用 16 后者用 24 —— 用户在 tab 间切换时内容列宽会跳变。

---

#### C-06 · 卡片圆角三套标准并存

同是「详情页信息卡」，圆角有 **24 / 14 / 11** 三种：

| 圆角 | Token | 出现位置 |
|---|---|---|
| 24 | `theme.radius.card` / `mm.radius.card` | `MetricDetailScreen.tsx:2703` `chartCard`、`EnergyDetailScreen.tsx:1359/1420/1466/1494/1540`、`SleepDetailScreen.tsx:622/635/681`、`Card.tsx:23`、`GlassCard.tsx:22`（共 62 文件） |
| **14** | `theme.radius.lg` | `CardioDetailScreen.tsx:172` `hero`、`:184` `card` ← **详情页卡片用 14** |
| 11 | `theme.radius.md` | `CortisolDailyChart.tsx:551` `insightBox`、`:559` `persistenceCard`、`HealthAgeCard.tsx:380` `cardWrap`（共 44 文件） |

`src/screens/CardioDetailScreen.tsx:172,184`
```ts
// 当前
hero: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.lg,
  paddingVertical: 22, alignItems: 'center', marginBottom: 14,
},
card: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.lg,
  padding: 16, marginBottom: 14,
},
```
```ts
// 建议 —— 与其它详情页对齐到 radius.card(24)
hero: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.card,
  paddingVertical: 22, alignItems: 'center', marginBottom: theme.sp(3.5),
},
card: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.card,
  padding: theme.space.cardPad, marginBottom: theme.sp(3.5),
},
```

`src/components/CortisolDailyChart.tsx:551,559`
```ts
// 当前
insightBox: { ..., borderRadius: theme.radius.md },
persistenceCard: { ..., borderRadius: theme.radius.md },
```
```ts
// 建议
insightBox: { ..., borderRadius: theme.radius.card },
persistenceCard: { ..., borderRadius: theme.radius.card },
```

---

#### C-07 · 卡片内边距出现第 3、第 4 档密度

`theme.space` 注释（line 234–238）明确写着：**「卡片内边距只允许两级：外层卡 cardPad(20) 与紧凑卡 cardPadCompact(12)。不要再出现 sp(2.5)=10、sp(2)=8 这类第三、第四种密度。」**

实测违反 **51 处**：

| 值 | 出现位置 | 应为 |
|---|---|---|
| `theme.sp(2.5)` = 10 | `FoodScanScreen.tsx:1195/1242/1259`、`EmotionQuickRecord.tsx:684` 等 7 处 | `space.cardPadCompact` (12) |
| `theme.sp(2)` = 8 | `FoodScanScreen.tsx:1165/1167`、`TodayScreen` 等 6 处 | `space.cardPadCompact` (12) |
| `theme.sp(1)` = 4 | `FoodScanScreen.tsx:1195` 等 5 处 | `space.cardPadCompact` (12) |
| 裸 `16` | `CardioDetailScreen.tsx:186` `card: { padding: 16 }` | `space.cardPad` (20) |
| 裸 `12` | `CardioDetailScreen.tsx:193` `methodBlock` | `space.cardPadCompact` (12) ✅ 数值对但未走 token |
| 裸 `10` | `BpDetailScreen.tsx:812` | `space.cardPadCompact` (12) |

`src/screens/CardioDetailScreen.tsx:184-186`
```ts
// 当前
card: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.lg,
  padding: 16, marginBottom: 14,
},
```
```ts
// 建议
card: {
  backgroundColor: CARD, borderWidth: 1, borderColor: CARD_BORDER, borderRadius: theme.radius.card,
  padding: theme.space.cardPad, marginBottom: theme.sp(3.5),
},
```

---

#### C-08 · `lib/sportVisual.ts` —— 30+ 个运动项目色完全脱离 token

`src/lib/sportVisual.ts:23-51`
```ts
// 当前 —— 30 个运动项各写一个 hex
1:  { color: '#FF3B30', emoji: '🏃', group: 'cardio' },   // 跑步
2:  { color: '#4CA9FF', emoji: '🚶', group: 'cardio' },   // 快走
23: { color: '#34C759', emoji: '🚶', group: 'cardio' },   // 爬楼梯
...
const FALLBACK_VISUAL: SportVisual = { color: '#9A93A8', emoji: '🎯', group: 'other' };
```

`src/lib/sportVisual.ts:71-73`
```ts
// 当前 —— 心率区间色 + onColor 也是裸值
{ label: '热身', min: 0,   max: 99,  color: '#2F7BE8', onColor: '#FFFFFF' },
{ label: '有氧', min: 100, max: 124, color: '#22C55E', onColor: '#0F1A0C' },
{ label: '无氧', min: 125, max: 149, color: '#E0A33C', onColor: '#1F1608' },
```

**问题**：① `#FF3B30`（iOS 系统红）、`#34C759`（iOS 系统绿）、`#007AFF`（iOS 系统蓝）直接抄了 iOS 系统色，与五色相体系无关；② `#22C55E`（Tailwind green-500）、`#F5A623`、`#8B5CF6`（Tailwind violet-500）混入了第三方设计系统的色阶；③ `onColor` 各自为政。

**建议**：把这 30 个色归入「运动项目色」独立命名空间，与五色相解耦但仍走 token：

```ts
// src/theme/mindmate.ts 新增
export const sportPalette = {
  heart:  '#FF3B30',  // 心肺
  run:    '#FF6600',  // 力量/高强度
  walk:   '#4CA9FF',
  cycle:  '#007AFF',
  swim:   '#30B0C7',
  yoga:   '#7B61FF',
  ball:   '#E7B13A',
  other:  '#9A93A8',
} as const;
```
```ts
// src/lib/sportVisual.ts
import { sportPalette } from '../theme/mindmate';
1:  { color: sportPalette.run,   emoji: '🏃', group: 'cardio' },
2:  { color: sportPalette.walk,  emoji: '🚶', group: 'cardio' },
...
const FALLBACK_VISUAL: SportVisual = { color: sportPalette.other, emoji: '🎯', group: 'other' };
```

---

#### C-09 · 心电状态色自成一套（绿/黄/蓝），与 `success`/`warn`/`stateTired` 冲突

`src/screens/EcgDetailScreen.tsx:83`
```ts
// 当前
const STATUS_COLOR = { normal: '#3FB984', high: '#E8A23D', low: '#5AA9E6' } as const;
```
`src/screens/EcgDetailScreen.tsx:139`
```ts
// 当前
const color = level === 'high' ? '#E8A23D' : level === 'mid' ? '#9D8AF0' : '#3FB984';
```
```ts
// 建议 —— 复用已有语义 token
const STATUS_COLOR = {
  normal: theme.colors.success,   // #9BD37E
  high:   theme.colors.warn,      // #F0C46E
  low:    theme.colors.stateTired, // #7EA6F8
} as const;
```
```ts
const color = level === 'high' ? theme.colors.warn : level === 'mid' ? theme.colors.accentSolid : theme.colors.success;
```

> `#3FB984` 与 `theme.colors.success`（`#9BD37E`）在 App 内同时出现，同为「正常/成功」语义却是两个绿；`#E8A23D` 与 `theme.colors.warn`（`#F0C46E`）同理。

---

#### C-10 · `fontSize` 绕过 token 直接调 `theme.fs(裸数字)` —— 48 处

`theme.fontSize` 已定义 12 档，但 48 处直接写 `theme.fs(17)` / `theme.fs(20)` 这类裸数字，绕过了「字号语义位」。

**按文件分布**：`EmotionQuickRecord.tsx`(8)、`FoodScanScreen.tsx`(6)、`MonthDiscoveryView.tsx`(4)、`SavedAdviceDeck.tsx`(4)、`DayDrawer.tsx`(3)、`JourneyDayView.tsx`(3)、`MeditationScreen.tsx`(3)、`BentoCard.tsx`(2)、`CycleCalendarScreen.tsx`(2)、`EmotionInterveneScreen.tsx`(2)、`ToolTopicScreen.tsx`(2)，另 10 个文件各 1 处。

**最典型的语义漂移 —— 卡片标题 17 vs 18：**

`src/components/SavedAdviceDeck.tsx:241`
```ts
// 当前
fontSize: theme.fs(17),
```
`src/components/MonthDiscoveryView.tsx:1020`
```ts
// 当前
cardHeadTitle: { fontSize: theme.fs(17), fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3 },
```
```ts
// 建议 —— 与全库其它卡标题统一到 theme.fontSize.card(18)
cardHeadTitle: { fontSize: theme.fontSize.card, fontWeight: theme.weight.semibold, color: mm.colors.ink, letterSpacing: -0.3 },
```

`src/components/SavedAdviceDeck.tsx:321`
```ts
// 当前
fontSize: theme.fs(19),
```
```ts
// 建议 —— theme.fontSize.lg(20) 才是「小标题」语义档
fontSize: theme.fontSize.lg,
```

`src/components/SavedAdviceDeck.tsx:272`
```ts
// 当前
fontSize: theme.fs(14),
```
```ts
// 建议
fontSize: theme.fontSize.sm,   // 13.5
```

`src/screens/FocusScreen.tsx:136`
```ts
// 当前
fontSize: theme.fs(34),
```
```ts
// 建议
fontSize: theme.fontSize.hero,  // 46
```

`src/screens/EmotionInterveneScreen.tsx:1247-1248`
```ts
// 当前
svRingNum:    { fontSize: theme.fs(40), fontWeight: theme.weight.bold as never, ... },
svRingNumBig: { fontSize: theme.fs(34), fontWeight: theme.weight.bold as never, ... },
```
```ts
// 建议
svRingNum:    { fontSize: theme.fontSize.hero, fontWeight: theme.weight.bold as never, ... },
svRingNumBig: { fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold as never, ... },
```

> **注意**：`theme.fs(n)` 不是「错误 API」—— 它保留了缩放能力，是**正确的**函数。但当 `fs(17)` 的语义就是「卡片标题」时，应当写 `theme.fontSize.card`（基准 18），因为 fontSize 表已经声明了「卡片内的标题 = card」这一档位。绕过表格直接写数字，就等于放弃了语义契约。

---

#### C-11 · `fontWeight` 裸字符串与 `as any` / `as never` 污染 —— 118 处

`theme.weight` 已定义 5 档，但仍有大量 `'600'` / `'700'` 字面量，外加 `as any` / `as never` 类型逃逸。

**裸字符串（74 处）**：
- `'600'` 37 处 · `'700'` 36 处 · `'500'` 3 处 · `'400'` 3 处 · `'300'` 5 处 · `'800'` 2 处

**`as any` / `as never` 逃逸（44 处）**：
```
src/screens/CycleCalendarScreen.tsx:1078   fontWeight: theme.weight.semibold as any,
src/screens/CycleCalendarScreen.tsx:1099   fontWeight: theme.weight.medium as any,
src/screens/FoodScanScreen.tsx:1128        fontWeight: '700' as never,
src/screens/FoodScanScreen.tsx:1159        fontWeight: '600' as never,
```

**根因**：`theme.weight` 的类型被声明为 `as const`，值是**字符串字面量类型**（`'300'`），而 RN 的 `TextStyle.fontWeight` 期望的是**联合字面量类型**（`'300' | '400' | ...`）。`as const` 让值变成 `readonly` 且被推断为单一字面量，导致赋值时 TS 报类型不匹配，于是开发者用 `as any` 绕过。

`src/theme/theme.ts:281-287`
```ts
// 当前
export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;
```
```ts
// 建议 —— 显式声明联合类型，as any / as never 全部可删
export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, '300' | '400' | '500' | '600' | '700'>;
```
> 改这一行可一次性消除 44 处 `as any` / `as never` 类型逃逸，并让后续 `fontWeight: '600'` 裸字符串也能被 TS 提示。

`src/screens/EcgDetailScreen.tsx:436`
```ts
// 当前
title: { fontSize: theme.fontSize.lg, fontWeight: '600', color: theme.colors.textTitle },
```
```ts
// 建议
title: { fontSize: theme.fontSize.lg, fontWeight: theme.weight.semibold, color: theme.colors.textTitle },
```

`src/screens/CycleCalendarScreen.tsx:1078`
```ts
// 当前
fontWeight: theme.weight.semibold as any,
```
```ts
// 建议
fontWeight: theme.weight.semibold,
```

---

#### C-12 · 同一语义副标题在 4 个文件里有 3 种字号

「详情页页头副标题」是明确的语义位（页面标题下方的说明文字）：

| 字号 | 位置 | 样式名 |
|---|---|---|
| `theme.fontSize.xs` (13) | `src/screens/BpDetailScreen.tsx:796` | `sub` |
| `theme.fontSize.xs` (13) | `src/screens/CardioDetailScreen.tsx:170` | `h2` |
| `theme.fs(18)` | `src/screens/MeditationScreen.tsx:457` | `subtitle` |
| `theme.fontSize.sm` (13.5) | `src/screens/OnboardingScreen.tsx` 等 | 多处 |

`src/screens/MeditationScreen.tsx:456-458`
```ts
// 当前
title: {
  fontSize: theme.fs(18),
```
```ts
// 建议
title: {
  fontSize: theme.fontSize.card,   // 18 —— 若这是页头主标题则保留 18 但走 token
```
```ts
// 若它是「副标题」则应为：
fontSize: theme.fontSize.xs,
```

`src/screens/BpDetailScreen.tsx:796`
```ts
// 当前
sub: { fontSize: theme.fontSize.xs, color: theme.colors.textSub, marginTop: 2 },
```
```ts
// 建议（作为统一基准，其余对齐此）
sub: { fontSize: theme.fontSize.sm, color: theme.colors.textSub, marginTop: theme.sp(0.5) },
```

**建议新增语义 token**（见 §4）：
```ts
fontSize.pageSub = fs(13.5)   // 详情页页头副标题
```

---

### 🟡 High（21 条）

---

#### H-01 · 白色 alpha 档位失控：**39 种**白透明度在流通

当前代码中 `rgba(255,255,255, α)` 出现了 **39 个不同的 α 值**，而 token 表只定义了 9 档（0.25 / 0.35 / 0.55 / 0.70 / 0.72 / 0.74 / 0.78 / 0.82 / 0.88 / 0.92）。

**token 表中查无的高频 α 值**：

| α | 出现次数 | 建议映射 |
|---|---|---|
| 0.85 | 10 | → `theme.colors.textWhite80` (0.82) 或新增 `ui.white85` |
| 0.95 | 10 | → `ui.white92` (0.92) |
| 0.62 | 6 | → `theme.colors.textSub` (0.74) |
| 0.60 | 7 | → `theme.colors.textSub` (0.74) |
| 0.45 | 4 | → 新增 `ui.white45` |
| 0.35 | 4 | → `mm.colors.moodSleep` (0.35) ✅ 已有 |
| 0.30 | 5 | → `ui.white25` (0.25) |
| 0.28 | 5 | → `mm.colors.chipBorder` (0.28) ✅ 已有 |
| 0.18 | 5 | → `mm.colors.sleepDot` (0.22) |
| 0.12 | 8 | → `ui.white25` (0.25) / `theme.colors.cardBgSoft` (0.08) |
| 0.17 | 1 | → `theme.colors.cardBgSoft` (0.08) |
| 0.06 | 5 | → `theme.colors.cardBgSoft` (0.08) |

`src/components/CalmWaveHome.tsx:754`
```ts
// 当前
gLabel: { fontSize: theme.fontSize.h1, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
```
```ts
// 建议
gLabel: { fontSize: theme.fontSize.h1, color: theme.colors.textWhite80, fontWeight: theme.weight.semibold },
```

`src/components/CalmWaveHome.tsx:724`
```ts
// 当前
chipLabel: { fontSize: theme.fontSize.xs, fontWeight: '500', color: 'rgba(255,255,255,0.62)', ... },
```
```ts
// 建议
chipLabel: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium, color: theme.colors.textSub, ... },
```

`src/components/CalmWaveHome.tsx:731`
```ts
// 当前
chipTag: { fontSize: theme.fontSize.tiny, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
```
```ts
// 建议
chipTag: { fontSize: theme.fontSize.tiny, color: theme.colors.orbTextInkFaint, marginTop: 3 },
```

---

#### H-02 · `theme.colors.textSub` vs `mm.colors.inkFaint` 同值不同名（106 + 29 文件）

两者都是 `rgba(255,255,255,0.74)`，却有两个名字，全库混用。

| Token | 值 | 使用文件数 |
|---|---|---|
| `theme.colors.textSub` | `rgba(255,255,255,0.74)` | **106** |
| `mm.colors.inkFaint` | `rgba(255,255,255,0.74)` | **29** |

**建议**：保留 `theme.colors.textSub`（覆盖更广），在 `mindmate.ts` 里改为 re-export 或标注 alias，逐步收敛：

`src/theme/mindmate.ts:39`
```ts
// 当前
inkFaint: 'rgba(255,255,255,0.74)', // ★ 2026-10-28：0.62 → 0.74（AA 仍达标，但发糊问题改善）
```
```ts
// 建议 —— 明确 alias 关系，避免两套命名
inkFaint: 'rgba(255,255,255,0.74)', // alias → theme.colors.textSub（同值，勿单独调）
```

---

#### H-03 · `mm.radius.card` 与 `theme.radius.card` 双入口（14 + 48 文件）

值都是 24，但两个入口。

`src/components/Card.tsx:23`
```ts
// 当前
borderRadius: mm.radius.card,
```
```ts
// 建议 —— 统一走 theme 轨
borderRadius: theme.radius.card,
```

**涉及 mm.radius.card 的 12 个文件**：`Card.tsx`、`AllDayRecoveryCard.tsx`、`HealthAgeCard.tsx`、`JourneyDayView.tsx`、`OxygenApneaSection.tsx`、`SleepRecoveryHero.tsx`、`MetricDetailScreen.tsx`、`EnergyDetailScreen.tsx`、`SleepDetailScreen.tsx`、`MonthDiscoveryView.tsx`、`FoodScanScreen.tsx`、`TaskDeck.tsx`

---

#### H-04 · `mm.radius.chip`(16) / `iconSqMd`(10) 在 `theme.radius` 无对应档

`theme.radius` 的 7 档里没有 16 和 10。开发者因此被迫用 `theme.radius.lg`(14) 或 `theme.radius.md`(11) 凑。

`src/screens/FoodScanScreen.tsx:1260`
```ts
// 当前
thumb: { width: theme.sp(9.5), height: theme.sp(9.5), borderRadius: mm.radius.iconSqMd, overflow: 'hidden', ... },
```
```ts
// 建议 —— theme.radius 补齐对应档后统一
thumb: { width: theme.sp(9.5), height: theme.sp(9.5), borderRadius: theme.radius.iconSqMd, overflow: 'hidden', ... },
```

**建议在 `theme.radius` 补**：`chip: 16` / `iconSq: 9` / `iconSqMd: 10`

---

#### H-05 · `theme.radius.xl`(24) 与 `theme.radius.card`(24) 同值不同名

`theme.radius.xl` 被 10 处 / 5 文件使用，与 `card` 完全同值。`theme.ts:255` 注释承认了这个历史：「`theme.radius.card` 与 `mm.radius.card` 现已对齐为 24（此前 14，2026-11-03 统一）」，但 `xl` 这个别名没清。

`src/components/BentoCard.tsx:157`
```ts
// 当前
card: { ..., borderRadius: theme.radius.xl },
```
```ts
// 建议
card: { ..., borderRadius: theme.radius.card },
```

**涉及**：`BentoCard.tsx:157`、`TaskDeck.tsx:511/573`、`breathing/BreathingPlayer.tsx:237/248/252`、`meditation/MeditationPlayer.tsx:217/229`、`screens/BindingRitualScreen.tsx:188`

---

#### H-06 · 图表卡与信息卡圆角不统一（24 vs 11）

`src/components/HealthAgeCard.tsx:365/380`
```ts
// 当前
cardShell: { ..., borderRadius: mm.radius.card },
cardWrap:  { ..., borderRadius: theme.radius.md },
```
```ts
// 建议 —— 内层不应比外层更圆，但也不应更「方」到失控；统一到 lg(14) 保持层级递减
cardShell: { ..., borderRadius: theme.radius.card },
cardWrap:  { ..., borderRadius: theme.radius.lg },
```

`src/components/HormoneStatusCard.tsx:317/335`
```ts
// 当前
healthBox: { ..., borderRadius: theme.radius.md },
rhythmBox: { ..., borderRadius: theme.radius.md },
```
```ts
// 建议
healthBox: { ..., borderRadius: theme.radius.lg },
rhythmBox: { ..., borderRadius: theme.radius.lg },
```

---

#### H-07 · `space` 档位存在同值不同名

| Token A | 值 | Token B | 值 |
|---|---|---|---|
| `space.card` | 16 | `space.md` | 16 |
| `space.cardPad` | 20 | `space.lg` | 20 |
| `space.screen` | 24 | `space.xl` | 24 |
| `space.cardPadCompact` | 12 | `space.sm` | 12 |

`space.card` 最具误导性 —— 名字像「卡片间距」实际是 16，而真正的卡片内边距是 `cardPad` 20。

`src/theme/theme.ts:230-245`
```ts
// 建议 —— 去掉歧义别名，明确注释
export const space = {
  screen: sp(6),      // 24 —— 页面左右留白
  cardPad: sp(5),     // 20 —— 外层卡内边距（唯一允许的宽松密度）
  cardPadCompact: sp(3), // 12 —— 紧凑卡内边距（唯一允许的紧凑密度）
  xs: sp(2),          // 8
  sm: sp(3),          // 12 —— == cardPadCompact
  md: sp(4),          // 16
  lg: sp(5),          // 20 —— == cardPad
  xl: sp(6),          // 24 —— == screen
} as const;
```
> 保留别名（避免破坏 148 个文件的调用点），但注释里标注等价关系；`space.card` 建议标记 `@deprecated`。

---

#### H-08 · `theme.sp()` 出现 124 个文件的调用，但 24 处在做非间距用途

`theme.sp()` 是 4 点倍数刻度，允许 `sp(0.5)` / `sp(0.75)` / `sp(2.75)` 这类小数（`sp(0.75)` = 3px）。这些**不在任何 spacing 档位里**。

`src/screens/FoodScanScreen.tsx:1259`
```ts
// 当前
row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2.75), paddingVertical: theme.sp(2.75), ... },
```
```ts
// 建议 —— gap/padding 收敛到档位
row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(3), paddingVertical: theme.sp(3), ... },
```

**高密度非档位调用**：`theme.sp(2.75)`(4 处)、`theme.sp(2.25)`(4)、`theme.sp(1.75)`(3)、`theme.sp(3.25)`(2)、`theme.sp(1.25)`(6)、`theme.sp(0.75)`(10)、`theme.sp(0.5)`(6)、`theme.sp(9.5)`(3)、`theme.sp(8.5)`(2)、`theme.sp(3.5)`(9)、`theme.sp(5.5)`(3)

---

#### H-09 · `chart.barRadius` 引用散落 6 处，绕开 `theme.radius`

`src/components/charts/*` 与多个图表组件直接引用 `chart.barRadius`，但它不在 `theme.radius` 体系内，柱状图圆角与卡片圆角无关联。

**建议**：在 `theme.radius` 增加 `bar: 2`（或沿用现有 `sm` 语义），把 `chart.barRadius` 改为引用 `theme.radius`。

---

#### H-10 · `mm.colors.limeTint` / `limeSoft` 等浅色底用在深色主题上

`src/screens/FoodScanScreen.tsx:1176/1232`
```ts
// 当前
backgroundColor: mm.colors.limeTint,   // #F6F7DC —— 极浅黄绿底
// 与
backgroundColor: mm.colors.limeSoft,   // #EAF0BE —— 浅黄绿底
```
```ts
// 建议 —— 深底上改用玻璃底 + 亮档文字（与 chipBg.lime 同族）
backgroundColor: mm.chipBg.lime.bg,    // rgba(213,227,132,0.20)
```

`src/screens/FoodScanScreen.tsx:1232` 附近如果是白字，需要同时把文字色改为 `mm.chipBg.lime.fg`（`#E9F3C0`）。

---

#### H-11 · `EmotionInsightView` 睡眠格 / 点阵格的白阶绕过 token

`src/components/EmotionInsightView.tsx:722-724`
```ts
// 当前
sleepDot: { backgroundColor: 'rgba(255,255,255,0.30)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.50)' },
sleepGlyph: { fontSize: theme.fontSize.tiny, lineHeight: 10, color: 'rgba(255,255,255,0.75)', ... },
```
```ts
// 建议
sleepDot: { backgroundColor: mm.colors.sleepDot, borderWidth: 1, borderColor: theme.colors.ui.white25 },
sleepGlyph: { fontSize: theme.fontSize.tiny, lineHeight: 10, color: theme.colors.textSub, ... },
```

---

#### H-12 · `EmotionQuickRecord` 的 `rgba(31,29,26,0.16)` 选中态底色（深底上不可见）

`src/components/EmotionQuickRecord.tsx:642`
```ts
// 当前
backgroundColor: 'rgba(31,29,26,0.16)',
```
```ts
// 建议
backgroundColor: theme.colors.ui.offTrack,   // rgba(255,255,255,0.14)
```

---

#### H-13 · `MetricDetailScreen` 周期区间色自建四套

`src/screens/MetricDetailScreen.tsx:77-81`
```ts
// 当前
period:     'rgba(224,123,107,0.16)',
follicular: 'rgba(124,106,224,0.10)',
ovulation:  'rgba(111,207,180,0.20)',
luteal:     'rgba(157,138,240,0.13)',
unknown:    'rgba(138,138,168,0.05)',
```
**同组色值在 `src/components/HormoneEstrogenCard.tsx:38-42` 重复粘贴了一遍。**

```ts
// 建议 —— 提到 theme.colors 统一管理（周期四相属于语义色相）
period:     theme.colors.cyclePeriod,
follicular: theme.colors.cycleFollicular,
ovulation:  theme.colors.cycleOvulation,
luteal:     theme.colors.cycleLuteal,
unknown:    theme.colors.cardBgSoft,
```
> 需在 `theme.ts` 新增 `cyclePeriod` 等 4 个 token（见 §4）。

---

#### H-14 · `MetricDetailScreen` 引用了已不存在的 `theme.colors.danger` 兜底

`src/screens/EcgDetailScreen.tsx:464/469`
```ts
// 当前
backgroundColor: theme.colors.dangerSoft ?? 'rgba(229,57,53,0.10)',
// 与
color: theme.colors.danger ?? '#e53935',
```
> `theme.colors.danger` **存在**（`#F2A3C6`），`??` 兜底永远不会触发，但 `'#e53935'`（Material Red 500）留在代码里是误导 —— 阅读者会以为 danger 可能不存在。**建议直接删掉 `??` 兜底**。

---

#### H-15 · `MindWave` / `CortisolRhythmCard` 的图表描边用墨色

`src/components/MindWave.tsx:34`
```tsx
// 当前
stroke="rgba(31,29,26,0.18)"
```
```tsx
// 建议
stroke="rgba(255,255,255,0.18)"
```

`src/components/CortisolRhythmCard.tsx:631`
```ts
// 当前
trendLegendDash: { width: theme.sp(3), height: 1.5, borderRadius: 0.75, backgroundColor: 'rgba(31,29,26,0.35)' },
```
```ts
// 建议
trendLegendDash: { width: theme.sp(3), height: 1.5, borderRadius: theme.radius.sm, backgroundColor: theme.colors.ui.white25 },
```

---

#### H-16 · `SavedAdviceDeck` / `CortisolAnomalySheet` 的遮罩用墨色

`src/components/SavedAdviceDeck.tsx:306`
```ts
// 当前
backgroundColor: 'rgba(31,29,26,0.35)',
```
```ts
// 建议
backgroundColor: theme.colors.ui.scrimSoft,   // rgba(0,0,0,0.30)
```

`src/components/CortisolAnomalySheet.tsx:117`
```ts
// 当前
backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(31,29,26,0.42)' },
```
```ts
// 建议
backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.ui.scrim },   // rgba(0,0,0,0.45)
```

---

#### H-17 · `SuggestionCard` 分隔线用墨色

`src/components/SuggestionCard.tsx:284`
```ts
// 当前
borderTopColor: 'rgba(31,29,26,0.07)',
```
```ts
// 建议
borderTopColor: theme.colors.ui.borderSoft,
```

---

#### H-18 · `HomeAiBubble` 自建白玻璃色系（4 个常量）

`src/components/HomeAiBubble.tsx:38-43`
```ts
// 当前
const GLASS_FILL = 'rgba(255,255,255,0.82)';     // 白玻璃填充
const GLASS_BORDER = 'rgba(31,29,26,0.14)';       // 浅描边
const TXT_ON_GLASS = '#2E2A3A';                    // 深主字
const TXT_ON_GLASS_SUB = 'rgba(74,70,96,0.80)';    // 次字
const TXT_ON_GLASS_FAINT = 'rgba(74,70,96,0.55)';  // 弱字
```
```ts
// 建议 —— 归入 theme.colors.ui 的 onGlass 命名空间
const GLASS_FILL = theme.colors.ui.glassBgStrong;
const GLASS_BORDER = theme.colors.ui.glassBorder;
const TXT_ON_GLASS = theme.colors.textTitle;
const TXT_ON_GLASS_SUB = theme.colors.textSub;
const TXT_ON_GLASS_FAINT = theme.colors.orbTextInkFaint;
```

---

#### H-19 · `MetricDetailScreen` 的绿色柱状图用 `rgba(76,175,80,0.22)`（Material Green）

`src/screens/MetricDetailScreen.tsx:2228/2268`
```ts
// 当前
backgroundColor: 'rgba(76,175,80,0.22)',
// 与
backgroundColor: 'rgba(76,175,80,0.35)',
```
```ts
// 建议 —— 复用 mm.lime 系（黄绿 = 全 App 唯一绿）
backgroundColor: mm.chipBg.lime.bg,      // rgba(213,227,132,0.20)
```
> v16 铁律明确写「黄绿做控件，**全稿唯一的绿**」，`rgba(76,175,80,*)` 是 Material Green，违反该规则。

---

#### H-20 · `MetricDetailScreen` 用 `rgba(120,100,220,0.06/0.14)` 造紫色玻璃

`src/screens/MetricDetailScreen.tsx:2792/2794`
```ts
// 当前
backgroundColor: 'rgba(120, 100, 220, 0.06)',
borderColor: 'rgba(120, 100, 220, 0.14)',
```
```ts
// 建议 —— 与 accentText(160,178,255) 同源
backgroundColor: theme.colors.accentSoft,
borderColor: theme.colors.ui.accentSoft20,
```

---

#### H-21 · `HormoneEstrogenCard` 曲线用私有粉 `#e980a8`

`src/components/HormoneEstrogenCard.tsx:248/253/262`
```tsx
// 当前
<Path d={d} fill="none" stroke="#e980a8" strokeWidth={2.6} ... />
<Circle cx={markerX} cy={yAt(currentValue)} r={5.5} fill="#e980a8" stroke="#fff" ... />
```
```tsx
// 建议
<Path d={d} fill="none" stroke={mm.colors.roseCore} strokeWidth={2.6} ... />
<Circle cx={markerX} cy={yAt(currentValue)} r={5.5} fill={mm.colors.roseCore} stroke={theme.colors.textWhite} ... />
```
> `#e980a8` 与 `mm.colors.roseCore`（`#F2A3C6`）色相一致但明度不同，同一 App 内出现两个粉。

---

### 🔵 Medium（19 条）

---

#### M-01 · `borderRadius` 纯数字散落（96 处，21 种值）

**> 8 的裸圆角 21 处**：18(6)、20(4)、60(2)、12、14、15、17、19、26、27、36、48

`src/screens/OnboardingScreen.tsx:458`
```ts
// 当前
borderRadius: 15,
```
```ts
// 建议
borderRadius: theme.radius.lg,   // 14
```

`src/screens/OnboardingScreen.tsx:559`
```ts
// 当前
borderRadius: 27,
```
```ts
// 建议
borderRadius: theme.radius.card,   // 24
```

`src/screens/MetricDetailScreen.tsx:2134/2229/2240`
```ts
// 当前
borderRadius: 2,   // 小圆点
borderRadius: 6,   // 占位条
borderRadius: 3,
```
```ts
// 建议
borderRadius: theme.radius.sm,   // 9 —— 或对 2/3/6 这类微型圆角新增 radius.xs = 3
```

**建议新增** `theme.radius.xs = 3`（微型标记点）

---

#### M-02 · `borderRadius` 半圆表达式

`src/screens/BpDetailScreen.tsx:416/420/745/794`
```ts
// 当前
borderRadius: 5,    // 10×10 的点
borderRadius: 6,    // 12 高的条
borderRadius: 18,   // 36×36 的返回按钮
```
```ts
// 建议
borderRadius: theme.radius.pill,          // 圆形点
borderRadius: theme.radius.pill,          // 胶囊条
back: { width: 36, height: 36, borderRadius: theme.radius.pill, ... },
```

---

#### M-03 · `InsightScreen` 的圆角 3 裸值

`src/screens/InsightScreen.tsx:1591/1598`
```ts
// 当前
borderRadius: 3,
```
```ts
// 建议
borderRadius: theme.radius.xs,   // 新增档位 = 3
```

---

#### M-04 · `HealthAgeDetailScreen` 的 1px / 2px 裸圆角

`src/screens/HealthAgeDetailScreen.tsx:720/731`
```ts
// 当前
borderRadius: 2,
borderRadius: 1,
```
```ts
// 建议
borderRadius: theme.radius.xs,   // 3
```

---

#### M-05 · `MetricDetailScreen` 占位骨架用 `#ECECEC`（Material Grey 200）

`src/screens/MetricDetailScreen.tsx:2220`
```tsx
// 当前
<View style={{ height: 12, borderRadius: 6, backgroundColor: '#ECECEC', position: 'relative' ... }} />
```
```tsx
// 建议
<View style={{ height: theme.sp(3), borderRadius: theme.radius.sm, backgroundColor: theme.colors.cardBgSoft, position: 'relative' ... }} />
```

---

#### M-06 · `EcgDetailScreen` 的 `rgba(255,240,243,0.6)` 淡粉底

`src/screens/EcgDetailScreen.tsx:63`
```ts
// 当前
style={{ backgroundColor: 'rgba(255,240,243,0.6)', borderRadius: theme.radius.sm }}
```
```ts
// 建议
style={{ backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.sm }}
```

---

#### M-07 · `EcgDetailScreen` 的 `rgba(229,80,138,0.1)` 私有粉底

`src/screens/EcgDetailScreen.tsx:479`
```ts
// 当前
backgroundColor: 'rgba(229,80,138,0.1)',
```
```ts
// 建议
backgroundColor: theme.colors.dangerSoft,   // rgba(242,163,198,0.18)
```

---

#### M-08 · `EcgDetailScreen` 的 `rgba(20,14,18,0.92)` 弹层底

`src/screens/EcgDetailScreen.tsx:485`
```ts
// 当前
backgroundColor: 'rgba(20,14,18,0.92)',
```
```ts
// 建议
backgroundColor: 'rgba(9,28,48,0.92)',   // 与 bgBottom #0A294F 同源；或新增 theme.colors.ui.sheetDeep
```

---

#### M-09 · `EcgDetailScreen` 的 `rgba(157,138,240,0.14/0.25/0.3)` 紫玻璃三档

`src/screens/EcgDetailScreen.tsx:119/122/539`
```tsx
// 当前
<Path ... stroke="rgba(157,138,240,0.25)" ... />
<Line ... stroke="rgba(157,138,240,0.3)" ... />
riskTrack: { height: 7, backgroundColor: 'rgba(157,138,240,0.14)', borderRadius: 4, ... }
```
```tsx
// 建议
<Path ... stroke={theme.colors.accentSoft} ... />          // 0.16
<Line ... stroke={theme.colors.ui.accentSoft20} ... />     // 0.20
riskTrack: { height: 7, backgroundColor: theme.colors.cardBgSoft, borderRadius: theme.radius.sm, ... }
```

---

#### M-10 · `EmotionInsightView` 的 `rgba(245,138,184,0.28)` 填充色

`src/components/EmotionInsightView.tsx:124`
```tsx
// 当前
<Path d={...} fill="rgba(245,138,184,0.28)" ... />
```
```tsx
// 建议
<Path d={...} fill={theme.colors.dangerSoft} ... />
```

---

#### M-11 · `CycleCalendarScreen` 的 `#2A4470`（白底上的深字）三处

`src/screens/CycleCalendarScreen.tsx:1081/1248/1251`
```ts
// 当前
segChipTextOn: { color: '#2A4470' },
chipTextOn: { color: '#2A4470', ... },
saveBtnText: { ..., color: '#2A4470' },
```
```ts
// 建议 —— 统一用 theme.colors.bgMid (#113861)，它是「白底上的深字」唯一 token
segChipTextOn: { color: theme.colors.bgMid },
chipTextOn: { color: theme.colors.bgMid, ... },
saveBtnText: { ..., color: theme.colors.bgMid },
```

`src/screens/EcgDetailScreen.tsx:516`
```ts
// 当前
segTxtOn: { color: '#2A4470' },
```
```ts
// 建议
segTxtOn: { color: theme.colors.bgMid },
```

---

#### M-12 · `CycleCalendarScreen` 的 `rgba(255,255,255,0.95)` 四处 —— 应改用已有 token

`src/screens/CycleCalendarScreen.tsx:1075/1096/1212/1246/1250/1256`
```ts
// 当前
segChipItemOn: { backgroundColor: 'rgba(255,255,255,0.95)' },
segRingItemOn: { borderColor: 'rgba(255,255,255,0.95)' },
dayToday: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)' },
chipOn: { backgroundColor: 'rgba(255,255,255,0.95)' },
saveBtn: { ..., backgroundColor: 'rgba(255,255,255,0.95)' },
endBtnOn: { backgroundColor: 'rgba(255,255,255,0.95)' },
```
```ts
// 建议
segChipItemOn: { backgroundColor: theme.colors.ui.white92 },
segRingItemOn: { borderColor: theme.colors.ui.white92 },
dayToday: { borderWidth: 2, borderColor: theme.colors.ui.white92 },
chipOn: { backgroundColor: theme.colors.ui.white92 },
saveBtn: { ..., backgroundColor: theme.colors.ui.white92 },
endBtnOn: { backgroundColor: theme.colors.ui.white92 },
```

---

#### M-13 · `CycleCalendarScreen` 的 `rgba(9,28,48,0.98)` 弹层底

`src/screens/CycleCalendarScreen.tsx:1222/1223`
```ts
// 当前
daySheetMask: { flex: 1, backgroundColor: 'rgba(9,28,48,0.98)' },
daySheet: { flex: 1, backgroundColor: 'rgba(9,28,48,0.98)' },
```
```ts
// 建议
daySheetMask: { flex: 1, backgroundColor: theme.colors.ui.sheetDeep },
daySheet: { flex: 1, backgroundColor: theme.colors.ui.sheetDeep },
```
> 需新增 `theme.colors.ui.sheetDeep = 'rgba(9,28,48,0.98)'`（`mm.colors.heroGradFrom` 已是 `rgba(9,28,48,0.52)`，同源）。

---

#### M-14 · `FoodScanScreen` 的 `rgba(10,18,34,0.82)` 全屏遮罩

`src/screens/FoodScanScreen.tsx:681`
```tsx
// 当前
<View style={{ flex: 1, backgroundColor: 'rgba(10,18,34,0.82)', ... }}>
```
```tsx
// 建议
<View style={{ flex: 1, backgroundColor: theme.colors.ui.sheetDeep, ... }}>
```

---

#### M-15 · `FoodScanScreen` 的 `rgba(0,0,0,0.5)` 遮罩

`src/screens/FoodScanScreen.tsx:1097`
```ts
// 当前
mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
```
```ts
// 建议 —— 遮罩已有 4 档 token，这里最接近 scrim(0.45)
mask: { flex: 1, backgroundColor: theme.colors.ui.scrim, justifyContent: 'flex-end' },
```

---

#### M-16 · `MetricDetailScreen` 的 `rgba(0,0,0,0.08)` 分隔线

`src/screens/MetricDetailScreen.tsx:2367/2445/2504`
```ts
// 当前
borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.08)',
```
```ts
// 建议
borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.ui.borderSoft,
```

---

#### M-17 · `ListCard` 的 `rgba(120,120,180,0.08)` 分隔线

`src/components/ListCard.tsx:55`
```ts
// 当前
borderBottomColor: 'rgba(120,120,180,0.08)',
```
```ts
// 建议
borderBottomColor: theme.colors.ui.borderSoft,
```

---

#### M-18 · `CardioDetailScreen` 的 `rgba(255,255,255,0.06)` 行分隔线

`src/screens/CardioDetailScreen.tsx:188`
```ts
// 当前
row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
```
```ts
// 建议
row: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.sp(1.75), borderTopWidth: 1, borderTopColor: theme.colors.ui.borderSoft },
```

---

#### M-19 · `CalmWaveHome` 的 `rgba(8,30,58,*)` 深海阴影系

`src/components/CalmWaveHome.tsx:492/610/670/777`
```ts
// 当前
colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)', 'rgba(8,30,58,0.05)', 'rgba(8,30,58,0.30)']}
// 与
colors={['rgba(8,30,58,0)', 'rgba(8,30,58,0.38)']}
textShadowColor: 'rgba(8,30,58,0.6)',
textShadowColor: 'rgba(8,30,58,0.5)',
```
```ts
// 建议 —— 与 bgBottom #0A294F 同源的新 token
colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)', 'rgba(10,41,79,0.05)', 'rgba(10,41,79,0.30)']}
```
> 需新增 `theme.colors.ui.deepScrim = 'rgba(10,41,79,0.35)'` 等。

---

## 3. 统计概览

### 3.1 硬编码色值

| 维度 | 数值 |
|---|---|
| 颜色字面量总数 | **895 处**（hex 541 + rgba 354） |
| 涉及文件数 | **111 / 299**（37%） |
| 与现有 token 值一致（可直接替换） | **384 处**（42.9%） |
| token 表中查无此值 | **511 处**（57.1%） |
| 唯一色值数 | **337 种**（hex 167 + rgba 170） |
| token 表已定义色值 | 约 **120 种** |
| 白色 alpha 档位 | **39 种**（token 只定义 9 档） |

**Top 10 硬编码色值密集文件**

| 文件 | 硬编码色值数 | 其中为新色值 |
|---|---|---|
| `components/CalmWaveHome.tsx` | 52 | 25 |
| `components/EmotionInsightView.tsx` | 37 | 27 |
| `lib/sportVisual.ts` | 36 | 33 |
| `screens/MetricDetailScreen.tsx` | 30 | 19 |
| `screens/EcgDetailScreen.tsx` | 28 | 17 |
| `screens/MeditationScreen.tsx` | 24 | 16 |
| `screens/CycleCalendarScreen.tsx` | 23 | 17 |
| `components/breathing/BreathingPlayer.tsx` | 22 | 14 |
| `components/meditation/MeditationPlayer.tsx` | 22 | 12 |
| `screens/FoodScanScreen.tsx` | 22 | 20 |

### 3.2 圆角

| 维度 | 数值 |
|---|---|
| `borderRadius` 声明总数 | **786 处 / 137 文件** |
| 走 `theme.radius.*` | 548 处（69.7%） |
| 走 `mm.radius.*` | 44 处（5.6%） |
| **`theme.sp()` 误用** | **49 处 / 26 文件** |
| 纯数字裸圆角 | 96 处 / 21 种值 |
| 表达式（`size/2` 等） | 22 处 |
| `chart.barRadius` | 6 处 |

**圆角实际取值分布（前 10）**：`theme.radius.pill` 284 · `theme.radius.md` 95 · `theme.radius.card` 82 · `theme.radius.sm` 77 · `mm.radius.card` 32 · `theme.radius.xl` 10 · `theme.radius.lg` 10 · `mm.radius.iconSq` 8 · `mm.radius.iconSqMd` 2

**实际档位只有 11 种**：`pill 999` / `card 24` / `xl 24` / `lg 14` / `chip 16` / `md 11` / `iconSqMd 10` / `sm 9` / `iconSq 9` + 散落的 `2/3/5/6/15/18/20/26/27/36/48/60`

### 3.3 字号

| 维度 | 数值 |
|---|---|
| `fontSize` 声明总数 | **1765 处 / 143 文件** |
| 走 `theme.fontSize.*` | 1713 处（97.1%） |
| **`theme.fs(裸数字)`** | **48 处 / 20 文件** |
| 纯数字裸值 | 4 处 |

**字号实际取值分布**：`micro` 552 · `sm` 367 · `xs` 255 · `body` 185 · `card` 169 · `h2` 66 · `tiny` 29 · `hero` 20 · `stat` 17 · `lg` 16 · `h1` 13 · `orb` 6 —— **token 覆盖率很高（97%）**，主要问题在 `theme.fs()` 绕过。

### 3.4 间距

| 维度 | 数值 |
|---|---|
| 间距声明总数 | **3199 处 / 148 文件** |
| 走 `theme.sp()` / `theme.space.*` | 2480 处（77.5%） |
| **裸数字** | **626 处** |
| 表达式（`SP(...)` / `insets.bottom` 等） | 93 处 |
| 其中 **非 4 倍数**（不在 sp(n) 档位） | **378 处 / 78 文件** |

**间距实际取值分布（纯数字部分，前 15）**：`2` 98 · `4` 78 · `10` 62 · `6` 60 · `0` 47 · `8` 47 · `12` 46 · `3` 42 · `14` 24 · `1` 17 · `16` 15 · `9` 14 · `18` 9 · `22` 9 · `5` 8

> 12 档 `theme.space` 只覆盖了其中一部分；`2/6/10/14` 这类非档位值共 **208 处**，是最需要收敛的部分。

### 3.5 字重

| 维度 | 数值 |
|---|---|
| `fontWeight` 声明总数 | **936 处 / 132 文件** |
| 走 `theme.weight.*` | 822 处（87.8%） |
| 裸字符串 `'600'` / `'700'` 等 | **74 处** |
| `as any` / `as never` 类型逃逸 | **44 处** |

---

## 4. 统一方案

### 4.1 现有 token 收敛（不需要新增，直接改调用点）

| 现状 | 收敛到 | 影响面 |
|---|---|---|
| `mm.radius.card` | `theme.radius.card` | 14 文件 / 32 处 |
| `theme.radius.xl` | `theme.radius.card` | 5 文件 / 10 处 |
| `theme.radius.lg` 作卡片容器 | `theme.radius.card` | 7 文件 / 10 处 |
| `theme.radius.md` 作卡片容器 | `theme.radius.card`（外层）/ `theme.radius.lg`（内层） | 25 处 |
| `theme.sp()` 作圆角 | `theme.radius.*` | 26 文件 / 49 处 |
| `theme.fs(17)` | `theme.fontSize.card` | 3 处 |
| `theme.fs(19)` / `fs(20)` | `theme.fontSize.lg` | 8 处 |
| `theme.fs(14)` | `theme.fontSize.sm` | 1 处 |
| `theme.fs(34)` / `fs(40)` | `theme.fontSize.hero` / `theme.fontSize.stat` | 3 处 |
| `theme.fs(24)` / `fs(26)` / `fs(27)` / `fs(30)` | `theme.fontSize.orb` / `theme.fontSize.lg` / `theme.fontSize.h2` | 8 处 |
| 裸 `'600'` / `'700'` | `theme.weight.semibold` / `theme.weight.bold` | 74 处 |
| `mm.colors.inkFaint` | `theme.colors.textSub` | 29 文件 / 87 处 |
| `mm.colors.inkSoft` | `theme.colors.textBody` | 22 文件 / 95 处 |
| `mm.colors.ink` | `theme.colors.textTitle` | 46 文件 / 171 处 |
| `mm.colors.cardBg` | `theme.colors.cardBg` | 16 文件 |
| `mm.colors.cardBorder` | `theme.colors.cardBorder` | 16 文件 |
| `rgba(31,29,26,0.05~0.08)` | `theme.colors.ui.borderSoft` | 约 30 处 |
| `rgba(31,29,26,0.10~0.16)` | `theme.colors.ui.offTrack` | 约 10 处 |
| `rgba(31,29,26,0.32~0.42)` | `theme.colors.ui.scrimSoft` / `scrim` | 约 6 处 |
| `rgba(255,255,255,0.95)` | `theme.colors.ui.white92` | 6 处 |
| `rgba(255,255,255,0.85)` | `theme.colors.textWhite80` | 10 处 |
| `rgba(255,255,255,0.62/0.60)` | `theme.colors.textSub` | 13 处 |
| `rgba(0,0,0,0.08)` | `theme.colors.ui.borderSoft` | 4 处 |
| `rgba(157,138,240,0.13/0.14/0.16)` | `theme.colors.accentSoft` | 5 处 |
| `rgba(157,138,240,0.20/0.22)` | `theme.colors.ui.accentSoft20` | 4 处 |
| `rgba(255,255,255,0.25/0.30)` | `mm.colors.moodNone` / `theme.colors.ui.white25` | 8 处 |
| `rgba(255,255,255,0.35)` | `mm.colors.moodSleep` | 4 处 |
| `rgba(255,255,255,0.28)` | `mm.colors.chipBorder` | 5 处 |
| `rgba(255,255,255,0.22)` | `theme.colors.cardBorder` | 4 处 |
| `rgba(255,255,255,0.10)` | `theme.colors.cardBgSoft` / `ui.chipNeutralBg` | 7 处 |
| `rgba(255,255,255,0.14)` | `theme.colors.ui.offTrack` | 7 处 |
| `rgba(255,255,255,0.12)` | `theme.colors.cardBgSoft` | 8 处 |
| `rgba(255,255,255,0.06/0.08)` | `theme.colors.cardBgSoft` | 11 处 |
| `rgba(255,255,255,0.18)` | `theme.colors.cardBgStrong` | 5 处 |
| `rgba(255,255,255,0.16)` | `theme.colors.cardBgStrong` | 3 处 |
| `rgba(255,255,255,0.05)` | 新增 `ui.white05` | 5 处 |
| `rgba(255,255,255,0.45)` | 新增 `ui.white45` | 4 处 |
| `rgba(255,255,255,0.65)` | 新增 `ui.white65` | 4 处 |
| `rgba(255,255,255,0.75)` | `theme.colors.textSub` | 3 处 |
| `rgba(255,255,255,0.9)` | `theme.colors.ui.white92` | 3 处 |
| `rgba(255,255,255,0.5)` | 新增 `ui.white50` | 4 处 |
| `rgba(255,255,255,0.42)` | `theme.colors.ui.playScrim` | 2 处 |
| `rgba(255,255,255,0.46)` | 新增 `ui.white45` | 1 处 |
| `rgba(0,0,0,0.3)` | `theme.colors.ui.scrimSoft` | 4 处 |
| `rgba(0,0,0,0.08)` | `theme.colors.ui.borderSoft` | 4 处 |
| `rgba(0,0,0,0.42)` | `theme.colors.ui.playScrim` | 2 处 |
| `rgba(0,0,0,0.28)` | `theme.colors.ui.glassShadow` | 2 处 |
| `rgba(9,28,48,0.98)` | 新增 `ui.sheetDeep` | 4 处 |
| `rgba(9,28,48,0.52)` | `mm.colors.heroGradFrom` | 2 处 |
| `rgba(38,62,96,0.40)` | `mm.colors.heroGradTo` | 2 处 |
| `rgba(157,138,240,0.22)` | `mm.chipBg.lav.bg` | 2 处 |
| `rgba(242,163,198,0.20)` | `mm.chipBg.pink.bg` | 3 处 |
| `rgba(126,166,248,0.22)` | `mm.chipBg.cyan.bg` | 3 处 |
| `rgba(213,227,132,0.18/0.20)` | `mm.chipBg.lime.bg` | 3 处 |
| `rgba(240,196,110,0.20)` | `mm.chipBg.butter.bg` | 1 处 |
| `rgba(242,163,198,0.18)` | `theme.colors.dangerSoft` | 2 处 |
| `rgba(155,211,126,0.18)` | `theme.colors.successSoft` | 1 处 |
| `#9D8AF0` | `mm.colors.purpleCore` | 19 处 |
| `#7EA6F8` | `mm.colors.skyCore` | 14 处 |
| `#F0C46E` | `mm.colors.honeyCore` | 19 处 |
| `#BCCB62` | `mm.colors.limeMid` | 10 处 |
| `#F2A3C6` | `mm.colors.roseCore` | 8 处 |
| `#D5E384` | `mm.colors.limeCore` | 9 处 |
| `#7C6AE0` | `theme.colors.accentSolid` | 8 处 |
| `#F6B3D0` | `mm.colors.roseMid` | 5 处 |
| `#C7B9F2` | `mm.colors.purpleMid` | 3 处 |
| `#6E58C8` | `mm.colors.purpleDeep` | 4 处 |
| `#B98A2E` | `mm.colors.honeyDeep` | 4 处 |
| `#6E7A24` | `mm.colors.limeDeep` | 3 处 |
| `#BFCBFF` | `theme.colors.accentText` | 2 处 |
| `#FBEFD6` | `mm.colors.honeySoft` | 2 处 |
| `#2E2A3A` | `mm.colors.fabTo` | 2 处 |
| `#113861` | `theme.colors.bgMid` | 4 处 |
| `#0A294F` | `theme.colors.bgBottom` | 4 处 |
| `#1F4C7E` | `theme.colors.bgTop` | 2 处 |
| `#FFFFFF` / `#fff` / `#ffffff` | `theme.colors.textWhite` | 140 处 |
| `#000` / `#000000` | `theme.colors.ui.shadowBlack` | 21 处 |

### 4.2 需要新增的 token

#### `src/theme/theme.ts` — 颜色

```ts
export const colors = {
  // ... 现有 ...

  /**
   * ★ 2026-11-06 审查新增 —— 周期四相（MetricDetailScreen / HormoneEstrogenCard 重复定义两遍）
   */
  cyclePeriod:     'rgba(224,123,107,0.16)',
  cycleFollicular: 'rgba(124,106,224,0.10)',
  cycleOvulation:  'rgba(111,207,180,0.20)',
  cycleLuteal:     'rgba(157,138,240,0.13)',

  ui: {
    // ... 现有 ...

    /** 白阶补充档 —— 收口代码中流通的 39 种白色 alpha */
    white05: 'rgba(255,255,255,0.05)',
    white45: 'rgba(255,255,255,0.45)',
    white50: 'rgba(255,255,255,0.50)',
    white65: 'rgba(255,255,255,0.65)',
    white85: 'rgba(255,255,255,0.85)',
    white95: 'rgba(255,255,255,0.95)',

    /** 弹层深底（与 bgBottom #0A294F 同源） */
    sheetDeep: 'rgba(9,28,48,0.98)',
    /** 深海阴影系（与 bgBottom 同源，收口 rgba(8,30,58,*)） */
    deepScrim: 'rgba(10,41,79,0.35)',
  },
} as const;
```

#### `src/theme/theme.ts` — 圆角

```ts
export const radius = {
  phone: 55,
  xl: 24,        // @deprecated —— 与 card 同值，请用 card
  card: 24,      // 外层卡 + 卡内子卡 + 图表卡
  lg: 14,        // 卡内分块、控件
  md: 11,        // 控件（按钮、次级卡）
  chip: 16,      // ★ 新增 —— 对齐 mm.radius.chip
  iconSq: 9,     // ★ 新增 —— 对齐 mm.radius.iconSq
  iconSqMd: 10,  // ★ 新增 —— 对齐 mm.radius.iconSqMd
  sm: 9,         // 卡内小色块、行高亮
  xs: 3,         // ★ 新增 —— 微型标记点（2~3px）
  pill: 999,
} as const;
```

#### `src/theme/theme.ts` — 字号

```ts
export const fontSize = {
  // ... 现有 ...
  /** ★ 新增 —— 详情页页头副标题的统一字号（收口 13 / 13.5 / 14 三种） */
  pageSub: fs(13.5),
  /** ★ 新增 —— 图表轴标签（收口 fs(10) / fs(12) 混用） */
  axis: fs(10),
} as const;
```

#### `src/theme/theme.ts` — 字重（修类型）

```ts
export const weight = {
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, '300' | '400' | '500' | '600' | '700'>;
```
> 这一处改动可让 44 处 `as any` / `as never` 全部删除，且 `fontWeight: '600'` 会被 TS 标记为应改用 token。

#### `src/theme/mindmate.ts` — 运动项目色

```ts
/**
 * 运动项目色板 —— 30+ 个运动项的识别色。
 * ★ 与五色相体系解耦（运动是「数据分类色」不是「状态色」），
 *   但不再允许直接写裸 hex。
 */
export const sportPalette = {
  heart:   '#FF3B30',  // 心肺 / 跑步 / HIIT
  run:     '#FF6600',  // 力量 / 高强度
  walk:    '#4CA9FF',  // 快走 / 椭圆机
  cycle:   '#007AFF',  // 骑行 / 动感单车
  swim:    '#30B0C7',  // 游泳
  water:   '#5AC8FA',
  strength:'#F5A623',  // 力量训练 / 核心
  ball:    '#E7B13A',  // 球类
  yoga:    '#7B61FF',  // 瑜伽 / 普拉提
  other:   '#9A93A8',  // 兜底
} as const;

/** 心率区间色（对应 Zone 1~5） */
export const hrZonePalette = {
  warmup:  { bg: '#2F7BE8', fg: '#FFFFFF' },
  aerobic: { bg: '#22C55E', fg: '#0F1A0C' },
  anaerobic:{ bg: '#E0A33C', fg: '#1F1608' },
} as const;
```

### 4.3 `space` 建议调整（保留别名，仅补注释 + 标 deprecated）

```ts
export const space = {
  screen: sp(6),        // 24 —— 页面左右留白
  cardPad: sp(5),       // 20 —— 外层卡内边距（唯一宽松密度）
  cardPadCompact: sp(3),// 12 —— 紧凑卡内边距（唯一紧凑密度）
  xs: sp(2),            // 8
  sm: sp(3),            // 12 == cardPadCompact
  md: sp(4),            // 16
  lg: sp(5),            // 20 == cardPad
  xl: sp(6),            // 24 == screen
  /** @deprecated —— 名字有歧义（值 16 是通用间距，不是 cardPad 20），请改用 md */
  card: sp(4),
} as const;
```

### 4.4 建议的收敛执行顺序

| 阶段 | 内容 | 预计消除 | 风险 |
|---|---|---|---|
| **P0 · 半天** | 修 `weight` 类型（1 行）→ 删 44 处 `as any`/`as never` | 44 处类型逃逸 | 极低（纯类型层） |
| **P0 · 半天** | `theme.sp()` 当圆角 49 处 → `theme.radius.*` | 49 处 | 低（视觉微变，需过一遍） |
| **P1 · 2 天** | `rgba(31,29,26,*)` 墨色残留 43 处 → 白阶 | 43 处 | **中**（深色页可见变化，需视觉回归） |
| **P1 · 2 天** | 白色 alpha 39 档 → 12 档（384 处机械替换） | ~250 处 | 低（值接近，差异细微） |
| **P2 · 3 天** | 卡片圆角统一（14→24）、卡片内边距统一（8/10/16→12/20） | ~60 处 | **中**（布局可见变化） |
| **P2 · 3 天** | 页面左右留白统一（16/18/20→24） | 8 文件 | **中高**（列宽跳变，需逐页看） |
| **P3 · 2 天** | `theme.fs(裸数字)` 48 处 → `fontSize.*` | 48 处 | 低 |
| **P3 · 2 天** | `mm.radius.card` → `theme.radius.card`、`mm.colors.*` → `theme.colors.*` | ~500 处 | 低（等值替换） |
| **P4 · 3 天** | `lib/sportVisual.ts` + `EmotionInsightView` 点阵色 → 新 token | 60 处 | 低 |

### 4.5 长期保障（防回归）

1. **加 lint 规则**（`eslint-plugin-design-tokens` 或自定义 `no-restricted-syntax`）：
   - 禁止 `style={{ color: '#xxx' }}` 字面量 → 提示用 `theme.colors.*`
   - 禁止 `borderRadius: theme.sp(` → 提示用 `theme.radius.*`
   - 禁止 `fontSize: theme.fs(<数字>)` → 提示用 `theme.fontSize.*`
   - 禁止 `fontWeight: '<数字>'` 字面量 → 提示用 `theme.weight.*`
2. **写 `scripts/check-tokens.mjs`**：扫描 `src/`，输出硬编码统计，CI 中设阈值（例如「新增硬编码色值 > 0 则 CI 失败」）。项目已有 `scripts/` 目录，接入成本低。
3. **明确单一真相源**：`theme.ts` 为主，`mindmate.ts` 只保留「五色相」与「运动色板」两块领域 token；`mm.colors.ink*` / `mm.colors.cardBg*` / `mm.radius.card` 逐步标记 `@deprecated` 并收敛。

---

## 附录 A · 硬编码色值密度 Top 30 文件

| # | 文件 | 色值数 | 新色值 | 主要问题类型 |
|---|---|---|---|---|
| 1 | `components/CalmWaveHome.tsx` | 52 | 25 | 白阶 alpha 混乱（0.05/0.12/0.17/0.30/0.5/0.6/0.62/0.65/0.75/0.85）、深海阴影系 |
| 2 | `components/EmotionInsightView.tsx` | 37 | 27 | 私有情绪 6 色、浅底卡、字符串反查 bug |
| 3 | `lib/sportVisual.ts` | 36 | 33 | 30+ 运动色脱离 token、混入 iOS/Tailwind 色系 |
| 4 | `screens/MetricDetailScreen.tsx` | 30 | 19 | 周期四相色、Material Green、紫玻璃私造 |
| 5 | `screens/EcgDetailScreen.tsx` | 28 | 17 | 状态色自成一套、紫玻璃三档、Material Red 兜底 |
| 6 | `screens/MeditationScreen.tsx` | 24 | 16 | `theme.fs(18/20/13)` 裸数字 |
| 7 | `screens/CycleCalendarScreen.tsx` | 23 | 17 | `#2A4470` 深字三处、`0.95` 白四处 |
| 8 | `components/breathing/BreathingPlayer.tsx` | 22 | 14 | |
| 9 | `components/meditation/MeditationPlayer.tsx` | 22 | 12 | |
| 10 | `screens/FoodScanScreen.tsx` | 22 | 20 | 墨色残留 18 处、浅色 limeTint、cardPad 第三档 |
| 11 | `screens/BindingRitualScreen.tsx` | 21 | 15 | `theme.sp(4.5)` 当圆角 |
| 12 | `components/HomeAiBubble.tsx` | 20 | 18 | 自建白玻璃 5 常量 |
| 13 | `screens/OnboardingScreen.tsx` | 20 | 11 | 裸圆角 15/27 |
| 14 | `components/VoiceQuickOverlay.tsx` | 19 | 12 | |
| 15 | `screens/CardioDetailScreen.tsx` | 18 | 12 | 卡片 radius.lg、padding 16、留白 16 |
| 16 | `components/HealthAgeCard.tsx` | 16 | 11 | `cardWrap` radius.md |
| 17 | `components/EnergyBall.tsx` | 15 | 11 | `theme.fs(28)` |
| 18 | `components/HormoneEstrogenCard.tsx` | 15 | 13 | 周期四相重复、粉色 `#e980a8` |
| 19 | `components/CortisolTrendCard.tsx` | 13 | 9 | |
| 20 | `components/EmotionTimeline.tsx` | 13 | 10 | |
| 21 | `components/HormoneCurveCard.tsx` | 13 | 11 | |
| 22 | `data/familyStore.ts` | 13 | 13 | **数据层混入样式色 —— 应移到 theme 或数据模型** |
| 23 | `screens/AccountHubScreen.tsx` | 13 | 8 | `theme.sp(5.5)` 当圆角 |
| 24 | `components/EmotionQuickRecord.tsx` | 12 | 11 | 墨色残留 4 处、`fs` 裸数字 8 处 |
| 25 | `components/MiraBot.tsx` | 12 | 8 | |
| 26 | `components/TaskDeck.tsx` | 12 | 9 | `radius.xl` 别名 |
| 27 | `screens/ToolTopicScreen.tsx` | 12 | 10 | 墨色残留 4 处 |
| 28 | `components/breathing/BreathingEngine.tsx` | 11 | 8 | |
| 29 | `components/AvatarStack.tsx` | 10 | 9 | |
| 30 | `components/EmotionTrendChart.tsx` | 10 | 7 | |

## 附录 B · 语义位漂移速查

### B.1 「详情页卡片容器」圆角三档并存

| 圆角 | Token | 典型位置 |
|---|---|---|
| 24 ✅ | `theme.radius.card` | `MetricDetailScreen.tsx:2703`、`EnergyDetailScreen.tsx:1359`、`SleepDetailScreen.tsx:622`、`Card.tsx:23`、`GlassCard.tsx:22` |
| **14** ❌ | `theme.radius.lg` | `CardioDetailScreen.tsx:172`（hero）、`:184`（card）、`BpDetailScreen.tsx:838`（entryBtn 按钮不该用 lg） |
| 11 ❌ | `theme.radius.md` | `CortisolDailyChart.tsx:551/559`、`HealthAgeCard.tsx:380`、`HormoneStatusCard.tsx:317/335`、`EmotionInsightView.tsx:751/776` |

### B.2 「详情页页头副标题」字号三档并存

| 字号 | Token | 位置 |
|---|---|---|
| 13 | `theme.fontSize.xs` | `BpDetailScreen.tsx:796`、`CardioDetailScreen.tsx:170` |
| 13.5 | `theme.fontSize.sm` | 多处 |
| **18** ❌ | `theme.fs(18)` | `MeditationScreen.tsx:457` |

### B.3 「页面左右留白」四档并存

| 值 | 位置 |
|---|---|
| 16 ❌ | `CardioDetailScreen.tsx:168` |
| 18 ❌ | `EcgDetailScreen.tsx:493`、`BpDetailScreen.tsx:869` |
| 20 ❌ | `MeditationScreen.tsx:467/521`、`HealthAgeDetailScreen.tsx:625`、`ProfileScreen.tsx:286` |
| 24 ✅ | `theme.space.screen`（24 文件） |

### B.4 「白色文字」6 套 token + 39 种裸 alpha

`textTitle` 250 处 · `textSub` 620 处 · `textBody` 51 处 · `textInk` 35 处 · `textWhite` 34 处 · `textInkSoft` 7 处 · `ink` 171 处 · `inkSoft` 95 处 · `inkFaint` 87 处 —— 合计 **1350 处**白色文字调用，分属 **9 个 token 名**。

---

*报告结束。所有行号基于 2026-11-06 的 `main` 工作区状态。*
