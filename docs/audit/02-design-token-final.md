# Mira App · 最终 Design Token（Single Source of Truth）

> 定稿日期：2026-11-07
> 对标设计语言：**Apple Liquid Glass（2025）** —— 当前最主流的 UI 设计体系，与本项目既有的「mira-ocean 深海玻璃」风格天然契合（半透玻璃层、白阶文字、层级靠模糊与描边而非重投影）。
> 依据：2026-11-06 全量一致性审查（`01-ui-consistency.md`，303 文件 / 895 处硬值）+ 2026-11-07 二次核查与收口。
> 性质：**规则文档 + 权威取值表**。组件层禁止写裸色值 / 裸尺寸 / 裸字号 / 裸字重，全部从本文件流经的 token 取用。

---

## 0. 单一真相源原则（铁律）

| 维度 | 真相源 | 说明 |
|---|---|---|
| 所有颜色 / 半径 / 间距 / 字号 / 字重 / 阴影 / 动效 / 按压 | `src/theme/theme.ts` | **主真相源**。新增/修改设计只动这里。 |
| 五色相（紫粉蓝黄绿）× 5 档、运动项目色板、心率区间色板 | `src/theme/mindmate.ts` | 仅保留这两个**领域 token**；不在此定义尺寸类。 |
| `mm.radius.card` / `mm.colors.ink*` / `mm.colors.cardBg*` | ⚠️ 已收敛为 `@deprecated` 别名 | `mm.radius.card` 现已 `= themeRadius.card`（24）；`ink*`/`cardBg*` 与 `theme.colors.*` 同值，**新代码一律用 theme 轨**。 |

**组件层违禁写法（lint 应拦截）**
- ❌ `color: '#xxx'` / `backgroundColor: 'rgba(...)'` 字面量
- ❌ `borderRadius: theme.sp(n)`（语义维度错配：间距刻度当圆角）
- ❌ `fontSize: theme.fs(裸数字)`（绕过字号语义位）
- ❌ `fontWeight: '600'`（绕过字重 token）；`as any` / `as never` 字重逃逸

---

## 1. 颜色 Token

### 1.1 背景渐变（深海）
| Token | 值 | 用途 |
|---|---|---|
| `bgTop` | `#1F4C7E` | 渐变顶 |
| `bgMid` | `#113861` | 渐变中 |
| `bgBottom` | `#0A294F` | 渐变底 / 深底同源色 |
| `bgGradStops` / `bgGradLocs` | `['#1F4C7E','#113861','#0A294F']` / `[0,0.46,1]` | 根渐变唯一出口 |

### 1.2 主强调（紫系）
| Token | 值 | 用途 |
|---|---|---|
| `accentSolid` | `#7C6AE0` | **色块/描边/图形**（小字会 <4.5，**不可作文字**） |
| `accentText` | `#BFCBFF` | **小字/点缀**（深底 AA 7.4） |
| `accentSoft` | `rgba(160,178,255,0.16)` | 紫玻璃底 |
| `accentGreen` / `accentGreenText` / `accentGreenSoft` | `#16A06A` / `#79E0AE` / `rgba(22,160,106,0.20)` | **仅 LoginScreen**（用户要求紫改绿） |

### 1.3 紫渐变卡（血压/血糖卡，紫底白字）
| Token | 值 | 约束 |
|---|---|---|
| `gradCardFrom` | `#6355B3` | 最浅端 `gradCardTo` 决定白字可读性上限 |
| `gradCardTo` | `#7766D7` | 纯白在此端 = 4.51（AA 临界），**卡上文字一律纯白** |

### 1.4 五色状态 / 情绪（语义色）
| Token | 值 |
|---|---|
| `stateCalm` / `moodGood` | `#BCCB62`（黄绿·恢复/平静） |
| `stateEnergy` / `moodNeutral` | `#9D8AF0`（紫·认知/元气） |
| `stateTense` / `moodEnergy` | `#F0C46E`（黄·张力/元气） |
| `stateTired` | `#7EA6F8`（蓝·疲惫/运动） |
| `moodRest` / `danger` | `#F2A3C6`（粉·情绪/警示） |

### 1.5 文字（深底白阶，层级从高到低）
| Token | 值 | 语义 |
|---|---|---|
| `textTitle` / `textWhite` | `#FFFFFF` | 主标题 / 主字 |
| `textBody` | `rgba(255,255,255,0.82)` | 正文 |
| `textSub` | `rgba(255,255,255,0.74)` | 次级（**统一用此，勿用 inkFaint**) |
| `textNavIdle` | `rgba(255,255,255,0.55)` | tab 未选中 |
| `textNavOn` | `#BFCBFF` | tab 选中 |
| `trendUp` | `#BCCB62` | 涨（配 ↑ 图标） |
| `trendDown` | `#F2A3C6` | 跌（配 ↓ 图标） |

### 1.6 卡片面（玻璃）
| Token | 值 | 用途 |
|---|---|---|
| `cardBg` | `rgba(255,255,255,0.13)` | 标准玻璃卡底 |
| `cardBgSoft` / `cardBgStrong` | `0.08` / `0.16` | 弱 / 强玻璃底 |
| `cardBorder` / `cardBorder2` | `rgba(255,255,255,0.22)` / `0.28` | 卡描边（标准 / 高光） |

### 1.7 语义色（成功/警示/渐变）
| Token | 值 |
|---|---|
| `success` | `#9BD37E`（亮档绿，深底可读） |
| `danger` | `#F2A3C6`（珊瑚粉，见 1.4） |
| `warn` | `#F0C46E`（黄） |
| `successSoft` / `dangerSoft` | `rgba(155,211,126,0.18)` / `rgba(242,163,198,0.18)` |
| `celebrateGrad` | `['#F3D49B','#F6B3D0']` |
| `aiBadgeGrad` | `['#9D8AF0','#7EA6F8']` |

### 1.8 `colors.ui` 语义界面令牌（28 项，高频裸值收口）
| Token | 值 | 用途 |
|---|---|---|
| `tabBar` | `rgba(255,255,255,0.22)` | 悬浮 tab 胶囊 |
| `scrim` / `scrimMid` / `scrimSoft` / `scrimDark` | `0.45` / `0.35` / `0.30` / `0.42` | 黑遮罩（深/中/浅/深） |
| `white05/25/45/50/55/65/72/85/92/95` | `rgba(255,255,255,α)` | 白阶 10 档（收口原 39 种 α） |
| `hazeWarm` / `panelHaze` / `panelGlass` | 蓝晕 / 蓝晕 / `rgba(255,255,255,0.10)` | 状态面板玻璃 |
| `glassBg` / `glassBorder` / `glassShadow` | `rgba(255,255,255,0.13)` / `0.28` / `rgba(0,0,0,0.28)` | 拟态玻璃卡 |
| `successText` | `#9BD37E` | 成功文字 |
| `rhythmGood` / `rhythmWarn` / `rhythmCalm` | `#8FD6A4` / `#F5B97E` / `rgba(157,138,240,0.22)` | 节律正常/偏高/正常日 |
| `chipText` / `chipGradEnd` / `chipNeutralBg` | `rgba(255,255,255,0.72)` / `#8FA6F0` / `rgba(255,255,255,0.14)` | chip 文字/渐变/中性底 |
| `shadowBlack` / `shadowDeep` | `#000` / `#463A6E` | 阴影色 |
| `borderSoft` | `rgba(255,255,255,0.10)` | 白阶分隔线（替代旧墨色 `rgba(31,29,26,*)`） |
| `sheetDeep` | `rgba(9,28,48,0.98)` | 弹层深底（与 bgBottom 同源） |
| `deepScrim` | `rgba(10,41,79,0.35)` | 深海阴影系（替代 `rgba(8,30,58,*)`） |
| `onGrad` | `#FFFFFF` | 紫渐变卡上唯一允许的纯白文字 |
| `onGlassInk` / `onGlassInkSub` / `onGlassInkFaint` | `#2E2A3A` / `rgba(74,70,96,0.80)` / `0.55` | **白玻璃气泡上的深字**（HomeAiBubble 等独立浅底场景，勿与深底白字混用） |

### 1.9 周期四相 + 情绪点阵（语义色，统一收口）
| Token | 值 |
|---|---|
| `cyclePeriod` / `cycleFollicular` / `cycleOvulation` / `cycleLuteal` / `cycleUnknown` | `rgba(224,123,107,0.16)` / `rgba(124,106,224,0.10)` / `rgba(111,207,180,0.20)` / `rgba(157,138,240,0.13)` / `rgba(138,138,168,0.05)` |
| `mood.excited/happy/calmDot/calm/stressed/anxious/sad` | `#F39A62` / `#F2C35E` / `#B8C86A` / `#6CC28E` / `#D58AAE` / `#C9789F` / `#7EA6F8` |

> ⚠️ `mood.*` 被 `faceMoodFromColor` 用**字符串相等反查**，改值时必须同步检查反查表。

### 1.10 五色相 × 5 档（mindmate，唯一来源）
| 相 | tint | soft | mid | core | deep |
|---|---|---|---|---|---|
| 紫 Iris（认知） | `#F4EDFC` | `#E7E1FB` | `#C7B9F2` | `#9D8AF0` | `#6E58C8` |
| 粉 Rose（情绪） | `#FDF0F6` | `#FCE7F0` | `#F6B3D0` | `#F2A3C6` | `#C9598A` |
| 蓝 Sky（运动·心肺） | `#F0F4FE` | `#E3EBFE` | `#B9CCF9` | `#7EA6F8` | `#4C74C9` |
| 黄绿 Lime（状态·恢复·唯一绿） | `#F6F7DC` | `#EAF0BE` | `#BCCB62` | `#D5E384` | `#6E7A24` |
| 黄 Honey（元气·代谢） | `#FDF7E9` | `#FBEFD6` | `#F3D49B` | `#F0C46E` | `#B98A2E` |

- `purpleBtn` `#7766D7`（按钮/气泡白字底专用）
- `ecgRed` `#E5484D`（心电波形线，生理惯例红，与异常语义解耦）
- `chipBg.{lav,pink,cyan,lime,butter}.{bg,fg}`（图标方块底/亮字对）

### 1.11 运动项目色板 + 心率区间（`sportPalette` / `hrZonePalette`，数据分类色，与五色相解耦）
> 运动色是「分类色」不是「状态色」，刻意脱离五色相；但全部走命名 token，不再裸 hex。心率区间 `onColor` 已核对比度，改 `color` 必同步核 `onColor`。

---

## 2. 半径 Token（圆角）
| Token | 值 | 规定用途 |
|---|---|---|
| `radius.phone` | 55 | 手机外框 |
| `radius.card` | **24** | 外层卡 + 卡内子卡 + 图表卡（唯一卡容器圆角） |
| `radius.lg` | 14 | 卡内分块、控件（已统一，不再作卡容器） |
| `radius.md` | 11 | 控件（按钮、次级卡、ECG 按钮） |
| `radius.chip` | 16 | 四指标 chip（对齐原 mm.radius.chip） |
| `radius.sm` | 9 | 卡内小色块、行高亮、微型圆点 |
| `radius.iconSq` / `iconSqMd` | 9 / 10 | 图标方块 |
| `radius.xs` | 3 | 微型标记点（2~3px） |
| `radius.pill` | 999 | 胶囊 / **圆形按钮 / 圆形点**（直径≥值时自动成圆，必须用此而非裸数字） |

**规则**：圆形一律 `radius.pill`；卡容器一律 `radius.card`（24）；内层分块 `lg`(14) 或 `md`(11)，**内层不得比外层更圆**。

---

## 3. 间距 Token
| Token | 值(px) | 用途 |
|---|---|---|
| `space.screen` | 24 | **页面左右留白（唯一标准）** |
| `space.cardPad` | 20 | 外层卡内边距（唯一宽松密度） |
| `space.cardPadCompact` | 12 | 紧凑卡内边距（唯一紧凑密度） |
| `space.xs` | 8 | |
| `space.sm` | 12（=cardPadCompact） | |
| `space.md` | 16 | |
| `space.lg` | 20（=cardPad） | |
| `space.xl` | 24（=screen） | |
| `sp(n)` | `n×4` | 4 点刻度；允许 `sp(0.5/0.75/2.75)` 等小数，但**非间距用途（如圆角）禁用** |

**规则**：卡片内边距只允许 `cardPad`(20) 与 `cardPadCompact`(12) 两级，不得出现 8/10/16 第三、第四档。

---

## 4. 字号 Token（fs 按屏宽 0.88~1.22 缩放，基准 390pt）
| Token | 基准值 | 语义位 |
|---|---|---|
| `h1` | 36 | 大标题 |
| `h2` | 22 | 页头标题 |
| `hero` | 46 | hero 大数字 |
| `stat` | 32 | 卡片内指标大数字 |
| `lg` | 20 | 小标题（统一 19~21 区间） |
| `card` | 18 | 卡片标题（统一 17~18 区间） |
| `body` | 15 | 正文 |
| `sm` | 13.5 | 次级正文 |
| `xs` | 13 | 说明 |
| `micro` | 11 | 角标/脚注 |
| `tiny` | 10 | 微型标注 |
| `orb` | 24 | 圆环中心字 |
| `pageSub` | 13.5 | **详情页页头副标题（统一 13/13.5/14 三档为这一档）** |
| `axis` | 10 | **图表轴标签（统一 fs(10)/fs(12)）** |

**规则**：卡片标题统一 `card`(18)；小标题统一 `lg`(20)；页头副标题统一 `pageSub`(13.5)；图表轴统一 `axis`(10)。**禁止 `theme.fs(裸数字)`**。

---

## 5. 字重 Token
| Token | 值 |
|---|---|
| `weight.light` | 300 |
| `weight.regular` | 400 |
| `weight.medium` | 500 |
| `weight.semibold` | 600 |
| `weight.bold` | 700 |

> `weight` 已用 `satisfies Record<...>`，赋给 RN `fontWeight` 不再需要 `as any/as never` —— **全部裸 `'600'` 与类型逃逸已可删除**。

---

## 6. 阴影 / 动效 / 按压 Token
- **`shadow`**：`card` / `hover` / `nav` / `center` / `deckTop` / `deckBack` / `sheet`（7 组，颜色统一 `#7878B4`/`#463A6E`/`#7C6AE0`）。
- **`motion`**：`instant 100` / `quick 160` / `base 220` / `slow 320` / `sheet 440` / `sheetExit 350` + 3 缓动曲线 + `breath` 周期。**禁止裸 duration / Easing**。
- **`press`**：`scale 0.96`（小控件）/ `scaleCard 0.985`（大表面）/ `opacity 0.7`（非缩放）。
- **`glassMorph`**：深海玻璃卡外观（`glassBg` + 1px `glassBorder` + 黑投影）；⚠️ Android `elevation` 必须 0（P30 真机实证：半透明玻璃 + elevation>0 会画直角蓝方块）。

---

## 7. 本次（2026-11-07）收口记录
| 类别 | 改动 |
|---|---|
| 双轨收敛 | `mm.radius.card` 改为引用 `themeRadius.card`（24），消除半径双入口 |
| 颜色私有值收口 | `HormoneEstrogenCard` 私有粉 `#e980a8` → `theme.colors.danger`；`CardioDetailScreen.formula` 私有蓝 `#BFE3FF` → `theme.colors.accentText`；`RingConnectScreen` 私有 `#0A294F/#FFFFFF/rgba(255,255,255,0.92)/#000` → `bgBottom/textWhite/ui.white92/ui.shadowBlack` |
| 圆角裸值收口（M-02，零视觉变化） | 5 处 36~40px 圆形按钮 `borderRadius:18/20` → `theme.radius.pill`（BpDetailScreen/EcgDetailScreen/BindingRitualScreen/EmotionInterveneScreen/BreathingScreen）；RingConnectScreen 状态点 11→`radius.md`、spinner 9→`radius.sm` |
| 字重逃逸收口（C-11） | RingConnectScreen 2 处 `fontWeight ... as any` 删除（依赖 `weight satisfies`） |
| 内边距收口（C-07） | `CardioDetailScreen.methodBlock` 裸 `padding:12` → `space.cardPadCompact` |

> 审查中已确认**早已修复**（无需再动）：深色页墨色残留 `rgba(31,29,26,*)`（C-01）、详情页页面留白 16/18/20（C-05）、详情页卡片圆角 14（C-06）、卡片内边距第三档（C-07）、EcgDetailScreen 私造状态色（C-09）、MetricDetailScreen Material Green/紫玻璃（H-19/H-20）、白色 α 39 档（H-01）、`mm.radius.chip/iconSq/iconSqMd/xs`、`pageSub/axis`、`sportPalette/hrZonePalette`、`weight satisfies` 均已在 2026-11-06 审查后落入 token 文件。

---

## 8. 长期防回归
1. 加 lint：禁止裸色值 / `theme.sp(` 当圆角 / `theme.fs(裸数字)` / 裸 `fontWeight` / `as any` 字重。
2. `scripts/check-tokens.mjs` 扫描 `src/`，CI 设阈值（新增裸色值 > 0 即失败）。
3. `mm.colors.ink*` / `mm.colors.cardBg*` / `mm.radius.card` 标记 `@deprecated`，新代码强制 theme 轨。

*—— 本文件为 Mira App UI 设计唯一权威真相源，任何视觉改动须先改此处。*
