# 维度 2 · 假数据与硬编码排查报告

> 审查对象：`/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`
> 审查时间：2026-11-06
> 审查范围：`src/**`（排除 `node_modules` / `*.bak`）
> 审查人：general-purpose-1（资深前端架构师视角）
> **审查性质：只读**（本轮未修改任何 `src/` 下文件；下文所有「建议修改后代码」均为待评审补丁）
> 判定铁律：**渠道商拿 App 演示时，任何看起来像「用户真实测量」的数字，都必须有真实来源或有明确的「推算 / 示意」标识。**

---

## 0. 结论速览

| 等级 | 数量 | 一句话说明 |
|---|---|---|
| 🔴 Critical | 5 | 写死值会**直接出现在正式展示路径**上，且无任何「模拟 / 推算」标识 |
| 🟡 High | 5 | 推算日未在部分 UI 标注，或历史迁移未打推算标，**存在被误读为实测的风险** |
| 🔵 Medium | 9 | 死代码 mock 生成器、写死身份文案、过期注释等**质量债与后续复发风险** |

**本轮已由前序提交修复并复核通过（3 项）**：`DEMO_PROFILE_AGE=30` 演示年龄兜底、`quickCheckStore` 的 seed 注释、`DemoBadge` 死代码 + `familyStore` 文件头措辞 —— 已在 `4b83d43` 落地，本报告已逐一复核当前代码状态确认。

---

## 1. 排查方法（可复现）

```bash
cd /Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app

# ① 演示 / 模拟 / 占位 字样（大小写不敏感）
grep -rniE "mock|seed|fake|demo|演示|假数据|placeholder|dummy|fixture|stub" src --include=*.ts --include=*.tsx -l

# ② Math.random() 全量用途分类
grep -rn "Math.random" src --include=*.ts --include=*.tsx

# ③ 定时器（伪造实时数据嫌疑）
grep -rnE "setInterval|setTimeout" src --include=*.ts --include=*.tsx

# ④ 写死生理数值（血压 / HRV / 血氧 / 睡眠分）
grep -rniE "(bpSys|bpDia|sleepScore|spo2|hrv|recoveryScore|sleepHours)\s*[:=]\s*[0-9]+" src --include=*.ts --include=*.tsx

# ⑤ 假曲线生成器 / 种子数据
grep -rnE "genSeries|SERIES_PARAM|TREND_SCRIPT" src scripts tools plugins --include=*.ts --include=*.tsx

# ⑥ 推算日标注覆盖率
grep -rnE "isDerivedDay|derivedDays|derived" src --include=*.ts --include=*.tsx

# ⑦ 空态里的假数值
grep -rnE "(暂无数据|无数据|尚未)[^\n]{0,60}[0-9]{2,3}" src --include=*.ts --include=*.tsx
grep -rnE "['\"]13['\"]|:\s*13\b|=\s*13\b" src/components src/screens src/data --include=*.ts --include=*.tsx
```

> ⚠️ 检索注意：macOS / zsh 下 `grep -rn "a\|b"` 的基本正则转义在部分 shell 下会静默返回空结果，**必须使用 `grep -E`**（ERE）。本轮已多次因该陷阱产生「零命中」误判，后续全部改用 `-E`。

---

## 2. 五大方向逐项结论

### 2.1 mock / seed / fake / demo 硬编码数值 —— 🔴 有问题（见 🔴#1 ~ 🔴#4、🔵#1）

`src/data/` 下逐 store 核查：`familyStore` / `quickCheckStore` / `healthStore` / `metrics` / `userStore` / `chat` / `patternStore` / `cycleLog` / `emotionLog` / `habitSuggestions`。

- ✅ `src/data/metrics.ts:47-454` —— `METRICS` / `BASIC_METRICS` / `EXTENDED_SIGNALS` / `BASICS_EXTRA_SIGNALS` 全部 `value: '—'`、`data: []`；`:104` 有硬约束注释「这里不许放示例数字」。
- ❌ `src/data/familyStore.ts:68` —— `self` 种子成员带**写死的健康结论值**（详见 🔴#1）。
- ❌ `src/data/familyStore.ts:91` —— `bindMember()` 给新绑定家人写死 `recoveryScore: 70` / `sleepHours: 7`（详见 🔴#2）。
- ❌ `src/data/metrics.ts:485-603` —— `SERIES_PARAM` + `genSeries()` 正弦波假曲线生成器仍留在仓内（详见 🔵#1）。
- ❌ `src/data/metrics.ts:20-29` —— `TREND_SCRIPT` 48 个写死状态值（详见 🔵#2）。
- ✅ `src/data/quickCheckStore.ts` —— 文件头 seed 注释已于 `4b83d43` 同步；全文件只有 `addQuickCheck()` 被 `assembleQuickCheckFromRealtime()`（`:437`）调用，**确无任何 seed 写入逻辑**。

### 2.2 `Math.random()` 生成测量值 / 定时器伪造实时数据 —— ✅ 已排查，未发现

**`Math.random()` 全量命中 30 处，逐条核对，零处生成测量值：**

| 文件:行 | 用途 | 是否伪造测量 |
|---|---|---|
| `src/screens/EmotionLogScreen.tsx:200-241` | 雨滴动效的半径 / 落点 / 物理扰动 | ❌ 纯装饰 |
| `src/components/OrbDots.tsx:38-46,164-170` | 光点抖动 / 时长 | ❌ 纯装饰 |
| `src/components/Confetti.tsx:36-76` | 撒花动画 | ❌ 纯装饰 |
| `src/components/MiraBot.tsx:65,86` | 机器人眼球游走 / 对话延迟 | ❌ 纯装饰 |
| `src/screens/FocusScreen.tsx:93` | 动效延迟 | ❌ 纯装饰 |
| `src/data/familyStore.ts:79` | 头像配色随机取色 | ❌ 仅颜色 |
| `src/data/examStore.ts:77`、`selfReportLog.ts:78`、`emotionLog.ts:260`、`quickCheckStore.ts:99`、`ai/memory.ts:62`、`ringIdentity.ts:107` | 生成记录 ID | ❌ 仅 ID |

> `src/data/chat.ts:98` 的建议问题洗牌用的是 `Math.sin(seed + i * 12.9898)` 确定性哈希，**不是** `Math.random()`，每次结果一致。

**定时器核查（`grep -rnE "setInterval|setTimeout"`）：**

| 位置 | 周期 | 是否伪造实时数据 |
|---|---|---|
| `src/ble/RingBleManager.ts:3200` `fallbackTimer` | 60s | ❌ 拉后端**真实**日值补齐器 |
| `src/ble/RingBleManager.ts:3226` `metricTimer` | 10s | ❌ 拉真实实时指标 |
| `src/ble/RingBleManager.ts:3229` `deviceTimer` | 30s | ❌ 刷新设备状态 |
| `src/ble/RingBleManager.ts:3654` `_emotionTimer` | 30s | ❌ 由真实曲线重算情绪 |
| `src/ble/RingBleManager.ts:862/875/901` | 蓝牙连接重试 | ❌ 连接管理 |
| `src/ble/RingBleManager.ts:3730` `scheduleStatusTick()` | 30min 边界 | ❌ 有**未佩戴守卫**：`hasFreshHr / hasFreshEda / hasFreshSteps` 全 false 时跳过累积，不伪造读数 |
| `src/screens/EcgDetailScreen.tsx:180`、`EmotionInterveneScreen.tsx:612/813/987` | UI 动画 / 计时 | ❌ 动效 |

**`TodayScreen` / `QuickCheck` 写死值专项核查**：
- `TodayScreen` / `CalmWaveHome` 历史上写死的 `82`（恢复分）/ `46` / `38` / `320`（活动消耗）**已全部移除**（`CalmWaveHome.tsx:244` 注释明确「一律显示『暂无数据』，不再写死兜底 82」）。
- `quickCheckStore.assembleQuickCheckFromRealtime()`（`:238-457`）口径正确：实测项只从 `RingBle.getState().daily` 读；估算项标 `source: 'estimated'` + `reason`；身体成分按用户档案推算并显式标「非戒指测量」。
- ⚠️ 残留：`src/screens/TodayScreen.tsx:1096,1098` 账号名写死（详见 🔵#5）。

### 2.3 7 天模拟传感器数据是否泄漏到正式展示路径 —— 🔴 有问题（见 🔴#3、🔴#4）

**先说结论：全仓不存在独立的「7 天 mock pipeline」模块。**

- 全仓搜 `mock|seed|fake|demo|模拟|7天|七天|7日|近7|sensorDay|synth|simulate|demo7|fake7`（范围 `src` / `scripts` / `tools` / `docs` / `plugins`）：**未发现任何造数脚本或 mock 数据源模块**；`scripts/`、`tools/` 内无造数工具；`git log --all --diff-filter=A` 搜 mock/seed/fake/demo 文件名仅命中 `hband-sdk/uni-appSDK-main/code/demo/**`（第三方 SDK 自带示例，不在 `src` 内，不参与编译）。
- `familyStore.ts:14-15` 文件头仍写着「全仓健康数据本就是 7 天模拟」—— 这是一句**过期且危险**的描述，会让后续开发者误以为造假数据是本仓惯例（详见 🔵#8）。

**但存在两条「近似泄漏通道」（已确认会进入正式展示路径）：**

1. **合成睡眠分期**：`RingBleManager.synthesizeSleepStages()`（`:2633`）用真实总时长按典型睡眠周期**铺排**出整夜 hypnogram，写入 `sleepStagesDaily[dk]`（`:2745-2758`）→ 被 `SleepDetailScreen.tsx:351`、`InsightScreen.tsx:437`、`SleepAnalysisCard.tsx:144-146`、`SleepStructureCard.tsx:68/98` 直接画成分期图，**全程无「合成分期」标识**。详见 🔴#3。
2. **30 天离线推算回填**：`offlineEstimates.estimateOfflineMetricsRecent(30)` 由 `useEnsureDerivedMetrics(30)`（`InsightScreen.tsx:448`、`EmotionCognitiveDetailScreen.tsx:383`）触发，写入 `eda / sns / cortisol / emotion / skin / fatigue`。**该通道本身是合规的**（全部打 `derivedDays` 标，见 §2.4），但**部分消费端没读这个标**（详见 🟡#1 ~ 🟡#3）。

### 2.4 `healthStore.derivedDays` 推算日是否在 UI 正确标注「推算」 —— 🟡 有问题（覆盖不全）

**机制本身正确**（`src/data/healthStore.ts`）：

```ts
// :139
derivedDays?: Record<string, 1>;
// :434-439  upsertBackfillSamples(..., { derived: true }) → 只增不减
if (opts?.derived) {
  if (!store.derivedDays) store.derivedDays = {};
  store.derivedDays[dk] = 1;
}
// :583-587
isDerivedDay(key: MetricKey, dayKeyRaw: string): boolean {
  const store = this.stores[key];
  if (!store?.derivedDays) return false;
  return store.derivedDays[normalizeDayKey(dayKeyRaw)] === 1;
}
```

**已正确标注的消费端（✅ 保留）：**

| 位置 | 做法 |
|---|---|
| `src/screens/MetricDetailScreen.tsx:789-791` | 推算日 + `measuredOnly`（皮质醇）→ **一律走空态，不画线** |
| `src/screens/MetricDetailScreen.tsx:1522` | 日视图图注追加「（当日历史数据为推算值）」 |
| `src/lib/analysisFacts.ts:19-27,52-55,74-77` | AI 事实对象 `source='derived'` + `algorithmVersion='offline-estimate-v1'` |
| `src/ai/patterns.ts:96-100` | 皮电/压力规律显式排除 `isDerivedDay('sns', date)` |
| `src/ble/RingBleManager.ts:6606-6612` | 上传后端时标 `source='derived'` |

**未标注的消费端（🟡#1 ~ 🟡#4）：**
1. `MetricDetailScreen` **周 / 月 / 年**视图（`isSpecRange`，`:1556-1575`）—— 走 `buildHistorySeries` → `dailyValueFor` → `healthStore.getIntraday()`，**含推算日样本且无任何标注**。
2. `CortisolRhythmCard.collectSamples()`（`:34-45`）—— 14 天皮质醇基线**不过滤**推算日。
3. `src/ai/health.ts:50-58 / 355-364` —— `metricHistorySummary()` → `getMetricDailyMeans()`，**不区分 derived / measured**，AI 输出的「近 7 天均值」不标来源。
4. `healthStore.migrateFromV1()`（`:1027-1043`）—— v1 快照迁移写 `source: 'backfill'`，**不打 `derivedDays`**，迁移来的历史推算值会被当成实测。

### 2.5 空态是否显示假数值 —— ✅ 已排查，未发现

- `grep -rnE "['\"]13['\"]|:\s*13\b|=\s*13\b" src/components src/screens src/data` → **零命中**。**不存在写死的 `'13'` 压力值**（该值疑似来自历史版本的 `StressInsightCard` / `EnergyBall`，当前已无残留）。
- `grep -rnE "(暂无数据|无数据|尚未)[^\n]{0,60}[0-9]{2,3}" src` → 命中 8 条，逐条核对**全部是文案里的时长说明或注释**：
  - `MetricDetailScreen.tsx:1861` / `InsightScreen.tsx:1420` —— 「约 30 秒心电图测量」（是操作说明，不是指标值）
  - `CycleYearReviewCard.tsx:122` / `TrendAnalysis.tsx:253` / `TempBiphasicAnalysis.tsx:204` —— 注释与「连续佩戴 ≥12 天」提示
  - `CortisolRhythmCard.tsx:119` / `InsightScreen.tsx:532` / `CalmWaveHome.tsx:244` —— 注释
- `grep -rnE "value=\{[0-9]|value=\"[0-9]{2,}"` → 零命中。
- 空态机制总体良好：`formatValue(null)` → `'—'`、`emptyResult()`、`DailyStatusCard` 空态文案、`EnergyDetailScreen:692` / `CognitiveLoadCard:73` / `QuickCheckTab:11` 均明写「不放演示数据」。
- ⚠️ 但存在**同类风险**：不是空态假数值，而是「兜底假输入」。见 🟡#5 与 🔵#9。

---

## 3. 🔴 Critical（5 个）

### 🔴#1 · `familyStore` 的 `self` 种子成员带写死的健康结论值

**文件**：`src/data/familyStore.ts:62-69`

```ts
function seedMembers(): FamilyMember[] {
  /* ★ 2026-11-06（用户：「家人关怀这个添加家人这里面目前我其实还没添加任何家人呢，
     这两个演示的要不先去掉。」）
     → 移除 3 个演示成员（陈屿 / 妈妈 / 爸爸）。现在只有「本人」一条，
     家人一律由用户自己添加，避免给渠道商演示时看起来像已有真实家庭数据。 */
  return [
    { id: 'self', name: 'Kristina', relationship: 'self', avatarColor: AVATAR_COLORS[0], avatarLetter: 'K', bound: true, statusTone: 'good', statusLabel: '精力充沛', statusEmoji: '✨', mood: 'happy', recoveryScore: 82, sleepHours: 7.4, menstrualPhase: '排卵期', lastSyncLabel: '刚刚' },
  ];
}
```

**问题**：演示家人虽然删了，但**「本人」这一条仍带着一整套写死的健康结论**：`recoveryScore: 82`、`sleepHours: 7.4`、`statusLabel: '精力充沛'`、`mood: 'happy'`、`menstrualPhase: '排卵期'`。

这些值不是「无数据占位」，而是**看起来完全像真实测量**的健康结论：
- `recoveryScore: 82` —— 用户看到「恢复指数 82」，会以为戒指测出来的；
- `sleepHours: 7.4` —— 精确到小数点；
- `menstrualPhase: '排卵期'` —— 生理周期结论，渠道演示时最容易被当成真实数据讲解。

虽然 `getBoundMembers()` 过滤了 `relationship !== 'self'`（self 进不了 `MemberDetail`），但 `self` 记录**仍在 store 里**，任何后续新增的「本人健康概览」组件只要 `members.find(m => m.relationship === 'self')` 就会直接把这套假值渲染出去。此外 `AccountHubScreen.tsx:37` 的 `me` 也是这条记录。

**建议修改后代码**（完整可替换）：

```ts
/**
 * 家人种子：**只保留「本人」的最小身份信息**。
 *
 * ★ 2026-11-06 审查（docs/audit/02 🔴#1）：删除「本人」上的写死健康结论。
 *   旧实现给 self 写了 recoveryScore: 82 / sleepHours: 7.4 / statusLabel: '精力充沛' /
 *   mood: 'happy' / menstrualPhase: '排卵期' —— 这些不是「无数据占位」，而是**看起来
 *   完全像真实测量**的健康结论（恢复指数 82、精确到 0.1 的睡眠时长、排卵期结论）。
 *   渠道商演示时，渠道商会指着这些数字讲「看，戒指连她睡眠都测出来了」——
 *   但这些数字从未被测过。
 *   现在：本人条目的健康字段一律留空（undefined）→ UI 走空态（'—' / 「暂无数据」）。
 */
function seedMembers(): FamilyMember[] {
  return [
    {
      id: 'self',
      name: 'Kristina',
      relationship: 'self',
      avatarColor: AVATAR_COLORS[0],
      avatarLetter: 'K',
      bound: true,
      // ★ 健康结论字段一律不给：无真实测量来源 → 不给数。
      statusTone: 'good',
      statusLabel: '等待同步',
      statusEmoji: '⏳',
      // recoveryScore / sleepHours / mood / menstrualPhase 故意留空
      lastSyncLabel: '尚未同步',
    },
  ];
}
```

> 配套：`src/screens/MemberDetailScreen.tsx:65-66` 的 `value={m.recoveryScore != null ? \`${m.recoveryScore}\` : '—'}` 已有 null 守卫，`m.statusLabel` 会显示「等待同步 ⏳」。**不需要额外改 UI**。

---

### 🔴#2 · `bindMember()` 给新绑定家人写死「恢复指数 70 / 睡眠 7 小时」，详情页无任何标识

**文件**：`src/data/familyStore.ts:83-97`（写入） + `src/screens/MemberDetailScreen.tsx:59-73`（展示）

```ts
// src/data/familyStore.ts:83-97
  /** 模拟绑定：写入一位新家人并标记为已绑定（真实场景换成云端确认） */
  bindMember(rel: Relationship, name: string): string {
    const id = 'm' + Date.now();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    members = [
      ...members,
      {
        id, name, relationship: rel, avatarColor: color, avatarLetter: name.slice(0, 1),
        bound: true, boundAt: Date.now(),
        statusTone: 'good', statusLabel: '刚刚建立连接', statusEmoji: '💞',
        mood: 'happy', recoveryScore: 70, sleepHours: 7, lastSyncLabel: '刚刚',
      },
    ];
    emit();
    return id;
  },
```

```tsx
// src/screens/MemberDetailScreen.tsx:59-73
<Text style={[s.statusLabel, { color: TONE_COLOR[m.statusTone] }]}>TA今日 · {m.statusLabel} {m.statusEmoji}</Text>
<Text style={s.statusSub}>最近同步：{m.lastSyncLabel}</Text>
...
<Tile label="恢复指数" value={m.recoveryScore != null ? `${m.recoveryScore}` : '—'} sub="/100" />
<Tile label="睡眠" value={m.sleepHours != null ? `${m.sleepHours}` : '—'} sub="小时" />
<Tile label="心情" value={m.mood ? moodLabel(m.mood) : '—'} sub={m.mood ?? ''} />
```

**问题**（两条叠加）：

1. **写入即造假**：用户真实添加一位家人后，`bindMember()` 立刻给他/她写入 `recoveryScore: 70`、`sleepHours: 7`、`mood: 'happy'`。这不是「占位」，是**看起来像真实测量**的数字——尤其 `70`（正好在 0-100 中段）和 `7`（正好在正常睡眠区间）。
2. **展示无标识**：`MemberDetailScreen.tsx:6` 的文件头注释写着「家人数据均为模拟」，**但 UI 上一行标识都没有**。渠道商点进家人详情页，会看到「TA今日 · 刚刚建立连接 💞 / 恢复指数 70 /100 / 睡眠 7 小时 / 心情 开心」——「最近同步：刚刚」这句话更是**直接撒谎**（根本没有同步过）。

**建议修改后代码**：

`src/data/familyStore.ts`：

```ts
  /**
   * 绑定一位新家人。
   *
   * ★ 2026-11-06 审查（docs/audit/02 🔴#2）：**不再写入任何写死的健康数值**。
   *   旧实现绑定即写 recoveryScore: 70 / sleepHours: 7 / mood: 'happy'，
   *   且详情页把「最近同步：刚刚」当成真同步展示 —— 渠道商点进去看到
   *   「恢复指数 70 / 睡眠 7 小时」，会当成 TA 戒指的真实测量。
   *   现在：只写身份信息；健康字段留空 → UI 显示 '—' + 「等待 TA 授权同步」。
   */
  bindMember(rel: Relationship, name: string): string {
    const id = 'm' + Date.now();
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    members = [
      ...members,
      {
        id, name, relationship: rel, avatarColor: color, avatarLetter: name.slice(0, 1),
        bound: true, boundAt: Date.now(),
        statusTone: 'good', statusLabel: '等待授权同步', statusEmoji: '💞',
        // recoveryScore / sleepHours / mood 故意留空：无真实数据源 → 不给数。
        lastSyncLabel: '尚未同步',
      },
    ];
    emit();
    return id;
  },
```

`src/screens/MemberDetailScreen.tsx`（在状态卡下方补一行诚实说明）：

```tsx
          <View style={s.statusCard}>
            <EmotionFaceIcon mood={m.mood ?? 'calm'} color={m.avatarColor} size={40} />
            <Text style={[s.statusLabel, { color: TONE_COLOR[m.statusTone] }]}>TA今日 · {m.statusLabel} {m.statusEmoji}</Text>
            <Text style={s.statusSub}>最近同步：{m.lastSyncLabel}</Text>
            {/* ★ 2026-11-06 审查（docs/audit/02 🔴#2）：家人健康结论必须标明来源。
                本产品尚无跨设备数据同步链路，此处数值在接入真实授权前一律为空态，
                不得展示任何未经测量的数值。 */}
            <Text style={s.statusSub}>TA 的健康结论需 TA 本人授权后才会同步显示。</Text>
          </View>
```

> 注：`m.mood` 留空后 `moodLabel(m.mood)` 走 `'—'`，`EmotionFaceIcon` 已有 `?? 'calm'` 兜底，不会崩。

---

### 🔴#3 · 合成睡眠分期写入正式归档，UI 直接画成分期图且无「合成分期」标识

**文件**：`src/ble/RingBleManager.ts:2629-2633`（合成函数）、`:2738-2758`（写入归档）

```ts
// :2629-2633
  /** 用真实睡眠时长合成整夜分期图（hypnogram）。
   *  HK18/QH15 精准睡眠模型只返回各阶段「时长」，不返回逐分钟分期；
   *  故按实测时长占比铺排典型睡眠周期（浅→深→浅→REM→短暂清醒），
   *  各阶段「时长占比」严格等于戒指实测值，仅夜内顺序为可视化惯例，不虚构测量数据。 */
  private synthesizeSleepStages(s: SleepSummary): SleepSegment[] {
```

```ts
// :2738-2758
      let segs: SleepSegment[];
      if (Array.isArray(raw.curve) && raw.curve.length) {
        segs = mergeSleepCurve(raw.curve);
      } else if (Array.isArray(raw.segments) && raw.segments.length) {
        segs = raw.segments.map(...);
      } else {
        segs = this.synthesizeSleepStages(v);   // ★ 合成路径
      }
      const dk = dateKeyOfStr(String(raw.date));
      healthStore.recordSleep(dk, v);
      const patch: StatePatch = { sleepDaily: { ...cur, [dk]: v } };
      const prevStagesDaily = this.getState().sleepStagesDaily;
      const newStagesByDay = { ...prevStagesDaily };
      if (segs.length > 0) {
        newStagesByDay[dk] = segs;              // ★ 合成结果写入正式归档，与真实分段无差别
      }
      patch.sleepStagesDaily = newStagesByDay;
```

**泄漏路径（已逐个确认，全部是正式展示页面）**：

| 消费方 | 位置 | 展示形式 |
|---|---|---|
| `src/screens/SleepDetailScreen.tsx:351` | `ring.sleepStagesDaily?.[dk]` | 睡眠分期图（hypnogram） |
| `src/screens/InsightScreen.tsx:437` | `ring.sleepStagesDaily?.[dayKey(Date.now())] ?? ring.sleepStages` | 洞察页睡眠分期卡 |
| `src/components/SleepAnalysisCard.tsx:144-146` | `segments && segments.length > 0` → 画图 | 睡眠分析卡 |
| `src/components/SleepStructureCard.tsx:68,98` | `hasStages` → 画图 | 睡眠结构卡 |

**问题**：注释里说「不虚构测量数据」—— **这句在逻辑上不成立**。各阶段**时长**确实来自实测，但**夜内的时间轴分布（几点几分到几点几分处于深睡 / REM）是被编造的**。UI 画出来的 hypnogram 是一张**逐分钟的时间曲线**，观众（渠道商 / 用户）默认它每个点都是实测的。它与真实分期曲线在视觉上**完全无法区分**。

这不是「标注缺失」，是**「看起来像实测的编造曲线」**——正是本维度最核心的风险。

**建议修改后代码**：

`src/ble/RingBleManager.ts` —— 给归档加 `synthesized` 标记，并在 UI 标注：

```ts
// ── 1) State 类型：给 sleepStagesDaily 增加「哪几天是合成」的标记 ──
// :316-317
  /** 历史每天睡眠分期归档：dateKey('YYYY-MM-DD') → SleepSegment[]。backfill 逐日写入。 */
  sleepStagesDaily: Record<string, SleepSegment[]>;
  /**
   * ★ 2026-11-06 审查（docs/audit/02 🔴#3）：**哪些天的分期图是合成的**。
   *   HK18/QH15 只返回各阶段时长、不返回逐分钟分期，SDK 无 curve/segments 时
   *   会用 synthesizeSleepStages() 按典型睡眠周期铺排出一张 hypnogram。
   *   各阶段「时长占比」= 实测值，但**夜内时间轴分布是编造的**，
   *   与真实分期曲线在视觉上无法区分 → 必须标记并在 UI 显式告知。
   */
  sleepStagesSynthesizedDays?: Record<string, 1>;
```

```ts
// ── 2) 写入时打标 ──
// :2738-2758
      let segs: SleepSegment[];
      let synthesized = false;
      if (Array.isArray(raw.curve) && raw.curve.length) {
        segs = mergeSleepCurve(raw.curve);
      } else if (Array.isArray(raw.segments) && raw.segments.length) {
        segs = raw.segments
          .map((s: any) => ({ type: Number(s.type), start: Number(s.start), end: Number(s.end) }))
          .filter((s: any) => Number.isFinite(s.type) && Number.isFinite(s.start) && Number.isFinite(s.end));
      } else {
        segs = this.synthesizeSleepStages(v);
        synthesized = true;   // ★ 合成路径打标
      }
      const dk = dateKeyOfStr(String(raw.date));
      healthStore.recordSleep(dk, v);
      const patch: StatePatch = { sleepDaily: { ...cur, [dk]: v } };
      const prevStagesDaily = this.getState().sleepStagesDaily;
      const newStagesByDay = { ...prevStagesDaily };
      if (segs.length > 0) {
        newStagesByDay[dk] = segs;
      }
      patch.sleepStagesDaily = newStagesByDay;
      // ★ 2026-11-06 审查（docs/audit/02 🔴#3）：记录合成日，供 UI 标注。
      const prevSynthDays = this.getState().sleepStagesSynthesizedDays ?? {};
      const nextSynthDays = { ...prevSynthDays };
      if (synthesized) nextSynthDays[dk] = 1; else delete nextSynthDays[dk];
      patch.sleepStagesSynthesizedDays = nextSynthDays;
```

```ts
// ── 3) 对外暴露查询口（供 UI 判断）──
// 放在 getState() 附近
  /** 该天的睡眠分期图是否为「按时长合成」（非逐分钟实测）。 */
  isSleepStagesSynthesized(dayKey: string): boolean {
    return this.getState().sleepStagesSynthesizedDays?.[dayKey] === 1;
  },
```

`src/screens/SleepDetailScreen.tsx` / `src/components/SleepAnalysisCard.tsx` / `src/components/SleepStructureCard.tsx` —— 在分期图下方加免责说明：

```tsx
{/* ★ 2026-11-06 审查（docs/audit/02 🔴#3）：合成分期图必须告知用户。
    各阶段时长是戒指实测，但夜内的时间轴分布是按典型睡眠周期铺排的示意图。 */}
{synthesized ? (
  <Text style={styles.note}>
    分期时间轴为示意（各阶段总时长为戒指实测，逐分钟分布按典型睡眠周期铺排），仅供理解结构，不作逐点判读。
  </Text>
) : null}
```

---

### 🔴#4 · `refreshDevice()` / `backend.start()` 缺 `isBlockedRingDeviceId` 守卫，演示/诊断设备可进入正式链路

**文件**：`src/ble/RingBleManager.ts:2966-3000`（`refreshDevice`）、`:3204-3212`（`start`）、`:3023-3026`（`refreshMetrics`）

```ts
// :2966-2996  refreshDevice
  private async refreshDevice(silent = false) {
    const emit = (patch: StatePatch) => { if (!silent) this.push(patch); };
    try {
      const data = await this.getJSON(
        this.deviceId
          ? `/v1/ring/device?device_id=${encodeURIComponent(this.deviceId)}`
          : '/v1/ring/device'
      );
      const list: BackendDevice[] = Array.isArray(data?.devices) ? data.devices : [];
      const dev: BackendDevice | null = this.deviceId
        ? data?.bound === false
          ? null
          : (data as BackendDevice)
        : list.find((d) => d.bound) || list[0] || null;   // ★ 取列表第一台 —— 可能是 demo- / test-diag- 设备
      ...
      this.deviceId = dev.device_id;   // ★ 未过 isBlockedRingDeviceId
```

```ts
// :3204-3212  start
  async start() {
    this.stopTimers();
    await this.refreshDevice();      // ★ 无守卫
    if (this.deviceId) {
      await this.refreshMetrics();   // ★ 直接用该 deviceId 拉全部指标
      this.startTimers();
    }
  }
```

**对照组 —— 同一文件里已经做对的守卫（`:3184-3202`）**：

```ts
  async startDailyFallback() {
    this.stopTimers();
    // ★ 2026-11-05（用户：两套数据源不要混）：
    //   旧实现直接 refreshDevice(true)，后端在「没带 device_id」时返回设备列表第一台，
    //   很可能就是旧 HK18 的 C9:00:9C:D7:C2:D8 → 把旧戒指日值补进基础版 App。
    //   这里先锁定当前连接戒指的可信 MAC，再拉数据；拿不到身份就宁可不出值。
    const trusted = await trustedCurrentRingDeviceId();
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = null;
    if (!this.deviceId) this.deviceId = trusted;
    if (!this.deviceId) return;
    await this.refreshDevice(true);
    // refreshDevice 可能用后端返回的 bound 设备覆盖 deviceId，这里再兜一次黑名单
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = trusted;
    if (!this.deviceId) return;
    await this.refreshMetrics(true);
    ...
  }
```

**隔离规则定义**（`src/data/ringDataIsolation.ts:33-52`）：

```ts
export const CURRENT_BASE_RING_ID = '41:42:E7:17:9B:1C';
export const LEGACY_RING_IDS: readonly string[] = ['C9:00:9C:D7:C2:D8'];
/** 演示 / 诊断数据前缀，任何真机展示链路都不得读取 */
export const NON_REAL_DEVICE_PREFIXES: readonly string[] = ['demo-', 'test-diag-'];

export function isBlockedRingDeviceId(v: unknown): boolean {
  const id = normDeviceId(v);
  if (!id) return true;
  if (LEGACY_RING_IDS.some((x) => normDeviceId(x) === id)) return true;
  if (NON_REAL_DEVICE_PREFIXES.some((p) => id.startsWith(p.toUpperCase()))) return true;
  return false;
}
```

**问题**：`NON_REAL_DEVICE_PREFIXES` 的注释明写「**任何真机展示链路都不得读取**」，但守卫**只加在了 `startDailyFallback()` / `uploadRingData()` 两处**。而 `backend.start()`（`:6190` `startScan`、`:6205` `connectToId` 都会调）走的是 `refreshDevice()` —— 后端返回设备列表时执行 `list.find(d => d.bound) || list[0]`，**可能选中 `demo-xxx` / `test-diag-xxx` 设备**，随后 `refreshMetrics()`（`:3023`）会用这个 deviceId 去拉 `hr_realtime` / `spo2_realtime` / `hrv_history` 等全部通道，**直接进 `this.state.daily` 与 `healthStore`**。

即：**演示 / 诊断设备的数据，能通过 `start()` 这条路径泄漏到正式展示层**，绕过 `ringDataIsolation` 的全部约定。这直接命中排查方向 3。

**建议修改后代码**：

`src/ble/RingBleManager.ts` —— `refreshDevice()` 拿到设备后立刻过黑名单：

```ts
// :2978-2996  refreshDevice 内，dev 选定之后
      const list: BackendDevice[] = Array.isArray(data?.devices) ? data.devices : [];
      const dev: BackendDevice | null = this.deviceId
        ? data?.bound === false
          ? null
          : (data as BackendDevice)
        : list.find((d) => d.bound) || list[0] || null;

      // ★ 2026-11-06 审查（docs/audit/02 🔴#4）：**设备身份黑名单守卫**。
      //   后端返回的设备列表里可能含 demo- / test-diag- 前缀的演示/诊断设备，
      //   也可能含旧 HK18（LEGACY_RING_IDS）。ringDataIsolation 的约定是
      //   「任何真机展示链路都不得读取」—— 这里必须硬拦，
      //   否则 start() → refreshDevice() → refreshMetrics() 会把演示设备数据
      //   直接写进 state.daily 与 healthStore。
      if (dev && isBlockedRingDeviceId(dev.device_id)) {
        this.deviceId = null;
        emit({
          status: 'idle',
          error: '当前后端仅有演示 / 诊断设备，已阻止读取（不展示非真实测量数据）',
          devices: list.map((d) => ({
            id: d.device_id,
            name: d.name || 'Mira Ring Pro',
            rssi: null,
            recommended: !!d.bound,
          })),
        });
        return;
      }

      if (!dev) {
        emit({ /* 原有「后端暂无已绑定设备」分支保持不变 */ });
        return;
      }
      this.deviceId = dev.device_id;
```

`src/ble/RingBleManager.ts` —— `start()` 入口也加一道身份锁（与 `startDailyFallback` 同款）：

```ts
  async start() {
    this.stopTimers();
    // ★ 2026-11-06 审查（docs/audit/02 🔴#4）：与 startDailyFallback 同口径，
    //   先锁定当前可信戒指身份再拉数据；拿不到可信身份就宁可不出值。
    const trusted = await trustedCurrentRingDeviceId();
    if (isBlockedRingDeviceId(this.deviceId)) this.deviceId = null;
    if (!this.deviceId) this.deviceId = trusted;
    if (!this.deviceId) {
      this.push({ status: 'idle', error: '未识别到当前戒指，已阻止读取（不展示非真实测量数据）' });
      return;
    }
    await this.refreshDevice();
    // refreshDevice 可能用后端返回的 bound 设备覆盖 deviceId，这里再兜一次黑名单
    if (isBlockedRingDeviceId(this.deviceId)) {
      this.deviceId = null;
      this.push({ status: 'idle', error: '后端设备为演示 / 诊断设备，已阻止读取' });
      return;
    }
    if (this.deviceId) {
      await this.refreshMetrics();
      this.startTimers();
    }
  }
```

---

### 🔴#5 · 详情页 `HrZoneSection` 用 `age ?? 30` 兜底算出最大心率并在 UI 明写「基于 30 岁」

**文件**：`src/screens/MetricDetailScreen.tsx:642`、`:2090`、`:2140`

```ts
// :642
  const hrZoneExtra = useHrZoneStats(anchorKey, Math.round(211 - 0.64 * (RingBle.getUserProfile()?.age ?? 30)));
```

```ts
// :2088-2091  HrZoneSection
function HrZoneSection({ anchor, openChat }: { anchor: Date; openChat: (q: string) => void }) {
  const dk = dayKeyOf(anchor.getTime());
  const age = RingBle.getUserProfile()?.age ?? 30;      // ★ 假年龄兜底
  const mhr = Math.round(211 - 0.64 * age);
```

```tsx
// :2139-2141
            <Text style={styles.note}>基于 {age} 岁 · 公式 211 − 0.64 × 年龄</Text>
```

**问题**：用户没录入年龄时，App 拿**编造的 30 岁**算出 `MHR = 211 − 0.64 × 30 = 192 bpm`，然后：
1. 用这个 MHR 划分 5 个心率区间（`HR_ZONES`），给出「当前处于 Zone 2 有氧区间」这类**基于年龄的生理结论**；
2. UI 上明写「**基于 30 岁** · 公式 211 − 0.64 × 年龄」——渠道商看一眼就知道这是算出来的，**但用户可能直接相信**「我的最大心率是 192」。

注意：`src/screens/HealthAgeDetailScreen.tsx:389-406` 与 `src/screens/InsightScreen.tsx:203-218` 都**已经正确处理**（年龄缺失 → `null` → 空态），**只有 `MetricDetailScreen` 这两处还在用 `?? 30`**。这正是 🔴#1（`DEMO_PROFILE_AGE`）的同类漏网之鱼——上次修了一处，漏了两处。

**建议修改后代码**：

```ts
// src/screens/MetricDetailScreen.tsx:640-644
  // ★ 2026-11-06 审查（docs/audit/02 🔴#5）：**删除 `?? 30` 年龄兜底**。
  //   用户未录入年龄时，用编造的 30 岁算出 MHR=192 会直接产出「你的最大心率是 192」
  //   「你在 Zone 2 有氧区」这类基于假年龄的生理结论，且 UI 明写「基于 30 岁」。
  //   现在：年龄缺失 → maxHr = null → 不出心率区间块（走空态 CTA）。
  const profileAge = RingBle.getUserProfile()?.age;
  const maxHr = profileAge != null && Number.isInteger(profileAge) && profileAge >= 18 && profileAge <= 120
    ? Math.round(211 - 0.64 * profileAge)
    : null;
  const hrZoneExtra = useHrZoneStats(anchorKey, maxHr);
```

```ts
// src/screens/MetricDetailScreen.tsx:2088-2095
function HrZoneSection({ anchor, openChat }: { anchor: Date; openChat: (q: string) => void }) {
  const dk = dayKeyOf(anchor.getTime());
  // ★ 2026-11-06 审查（docs/audit/02 🔴#5）：年龄缺失 → 不出 MHR / 心率区间。
  const rawAge = RingBle.getUserProfile()?.age;
  const age = rawAge != null && Number.isInteger(rawAge) && rawAge >= 18 && rawAge <= 120 ? rawAge : null;
  const mhr = age != null ? Math.round(211 - 0.64 * age) : null;
  if (mhr == null) {
    // 空态：引导填写年龄，不给编造的最大心率
    return (
      <View style={styles.card}>
        <Text style={styles.statLabel}>最大心率（MHR）</Text>
        <Text style={styles.note}>填写出生年龄后，按公式 211 − 0.64 × 年龄 计算最大心率与心率区间。</Text>
      </View>
    );
  }
  const { zones, activeTotal } = useHrZoneStats(dk, mhr);
  ...
```

---

## 4. 🟡 High（5 个）

### 🟡#1 · `MetricDetailScreen` 周 / 月 / 年视图的推算日无「推算」标注

**文件**：`src/screens/MetricDetailScreen.tsx:1522`（✅ 有标注，仅日视图）vs `:1556-1575`（❌ 无标注）

```tsx
// :1519-1523  日视图 ✅
                <Text style={styles.chartNote}>
                  {spec!.sourceNote}
                  {specDay.derived ? '（当日历史数据为推算值）' : ''}
```

```tsx
// :1556-1575  周 / 月 / 年视图 ❌ —— series 来自 buildHistorySeries → getIntraday，含推算日样本
        {isSpecRange && spec ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
            <RangeBarsChart
              points={series.points}
              labels={axisLabels}
              range={range}
              ...
            />
          </View>
        ) : null}
```

**问题**：`buildHistorySeries` → `dailyValueFor()` → `healthStore.getIntraday()`，**不区分推算日与实测日**。所以用户在「压力 / 皮质醇 / 皮电 / 疲劳」等指标的**周视图**上看到的柱子，可能整根来自 `offlineEstimates` 的线性推算，却和实测柱**长得一模一样、没有任何区分**。而「日视图」有「（当日历史数据为推算值）」提示——**同一屏内两种口径不一致，用户会以为周视图的数据更可靠**。

**建议修改后代码**：

```tsx
// src/screens/MetricDetailScreen.tsx:1556-1576
        {isSpecRange && spec ? (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{chartTitle}</Text>
            <RangeBarsChart
              points={series.points}
              labels={axisLabels}
              range={range}
              colorOf={specColorOf}
              yMin={params.yMin ?? 0}
              yMax={params.yMax ?? 100}
              unit={series.unit}
              valueFmt={fmtVal}
              showYAxis={!hideYAxis}
              emptyText={ring.status !== 'connected' ? '连接戒指以加载历史数据' : backfilling ? '正在补拉历史数据…' : '当前范围内暂无真实测量数据'}
              moodMarkers={rangeMoodMarkers}
            />
            {/* ★ 2026-11-06 审查（docs/audit/02 🟡#1）：周/月/年视图的数据里
                可能混入 offlineEstimates 的推算日（buildHistorySeries → getIntraday
                不区分 derived/measured）。必须显式告知，并把推算柱单独区分。 */}
            {(() => {
              const derivedDays = series.points.filter((p) => {
                const dk = p.dk ?? '';
                return !!dk && healthStore.isDerivedDay(spec.key as HSMetricKey, dk);
              });
              if (!derivedDays.length) return null;
              return (
                <Text style={styles.chartNote}>
                  本区间含 {derivedDays.length} 天为推算值（由压力值换算，非戒指实测），已用虚线/浅色标出。
                </Text>
              );
            })()}
          </View>
        ) : null}
```

> 配套：若 `RangeBarsChart` 的 `points` 结构里没有 `dk` 字段，需先在 `src/lib/realSeries.ts` 的 `buildHistorySeries()` 返回的 points 上补上 `dk`（每个桶对应日），并在 `RangeBarsChart` 里对 `derived` 桶改用虚线描边 / 降低不透明度。

---

### 🟡#2 · `CortisolRhythmCard` 的 14 天皮质醇基线未过滤推算日

**文件**：`src/components/CortisolRhythmCard.tsx:33-45`

```ts
/** 拉取近 14 天 cortisol 逐样本（已剔除零值），含离线回填日。 */
export function collectSamples(): CortisolSample[] {
  const out: CortisolSample[] = [];
  const now = Date.now();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const dk = dayKey(now - i * 86400000);
    const arr = healthStore.getIntraday('cortisol', dk);
    for (const p of arr) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
    }
  }
  return out;
}
```

**问题**：注释里的「**含离线回填日**」就是问题本身。`cortisol` 是 `offlineEstimates.STRESS_MAP` 的推算目标之一（`cortisol = stress × 1.6 + 20`），所以 `getIntraday('cortisol', dk)` 里**大量样本是推算值**。这段样本被拿去：
1. `analyzeCortisol(samples, 14)`（`:120`、`:158`）拟合 cosinor 基线 → 得出「晨峰时刻 08:00 / 节律良好 / 偏晚 / 扁平」；
2. `aggregate30m(collectSamplesForRange(...))`（`:353`）算 30 分钟窗基线；
3. 结论直接展示在皮质醇节律卡上。

也就是说，**一张完全由压力值线性换算出来的曲线，被当作「皮质醇昼夜节律」展示**。该文件 `:154` / `:195-196` 虽有免责文案「基于戒指压力代理值（非化验级皮质醇），仅供趋势参考」，但那句话讲的是**指标来源**，没讲**这些天的数据本身是推算的**——两者不是一回事。

**建议修改后代码**：

```ts
/** 拉取近 14 天 cortisol 逐样本（已剔除零值）。 */
export function collectSamples(): CortisolSample[] {
  const out: CortisolSample[] = [];
  const now = Date.now();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const dk = dayKey(now - i * 86400000);
    // ★ 2026-11-06 审查（docs/audit/02 🟡#2）：**过滤推算日**。
    //   cortisol 的历史样本大多来自 offlineEstimates 的 stress 线性换算
    //   （cortisol = stress × 1.6 + 20），不是戒指实测。
    //   把推算样本喂进 cosinor 拟合，会得出「晨峰 08:00 / 节律良好」这类
    //   基于编造数据的生理节律结论。现只保留实测日样本。
    if (healthStore.isDerivedDay('cortisol', dk)) continue;
    const arr = healthStore.getIntraday('cortisol', dk);
    for (const p of arr) {
      if (typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0) out.push({ t: p.t, v: p.v });
    }
  }
  return out;
}
```

> 同时建议在卡片底部把免责文案补全为：「基于戒指压力代理值（非化验级皮质醇），且仅使用实测日样本；仅供趋势参考。」

---

### 🟡#3 · AI 趋势摘要用 `getMetricDailyMeans()`，把推算日均值当实测报出

**文件**：`src/ai/health.ts:50-58`、`:355-364`；`src/data/healthStore.ts:969-982`

```ts
// src/ai/health.ts:50-58
function metricHistorySummary(metric: MetricKey, days = 7): string | null {
  try {
    const vals = healthStore.getMetricDailyMeans(metric, days);
    ...
```

```ts
// src/data/healthStore.ts:969-982
  /** 取某指标近 N 天的日均值数组（最新在前，旧的在后）。跳过没数据的日子。 */
  getMetricDailyMeans(metric: MetricKey, days = 7): number[] {
    const store = this.stores[metric];
    if (!store) return [];
    const out: number[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dk = dayKey(now - i * 86400000);
      const d = store.daily?.[dk];
      if (d && d.last != null && !Number.isNaN(d.last)) out.push(d.last);
      else if (d && d.mean != null && !Number.isNaN(d.mean)) out.push(d.mean);
    }
    return out;
  }
```

```ts
// src/ai/health.ts:355-364
function getTrendBlock(): string {
  ...
    const s = metricHistorySummary(k.key, 7);
```

**问题**：`getMetricDailyMeans` **只取 `store.daily[dk].last/mean`，完全不看 `store.derivedDays`**。而 `eda / sns / cortisol / emotion / skin / fatigue` 这 6 个指标的 `daily[dk]` 里**大量是推算日**（`offlineEstimates` 30 天回填的结果）。

于是 AI 会输出类似「近 7 天皮电均值 42.3」这种**看起来像实测统计**的话，而实际上 7 天里有 5 天是 `stress × 1.5 + 10` 算出来的。对比 `src/ai/health.ts:409-414` 的基础指标路径走了 `factsForDay()`，带 `sourceLabels = { measured:'设备记录', derived:'推算' }`——**同一份 AI 上下文里，基础指标标了来源，趋势摘要没标**。

**建议修改后代码**：

`src/data/healthStore.ts` —— 增加一个区分推算的取数口（保留原方法以免破坏调用方）：

```ts
  /** 取某指标近 N 天的日均值数组（最新在前）。**跳过推算日**。
   *  ★ 2026-11-06 审查（docs/audit/02 🟡#3）：给 AI 趋势摘要用的版本。
   *    eda / sns / cortisol / emotion / skin / fatigue 的 daily 里混有
   *    offlineEstimates 的推算日，若不剔除，AI 会把 stress 线性换算出来的值
   *    当作实测统计报出（「近 7 天皮电均值 42.3」）。
   */
  getMetricDailyMeansMeasured(metric: MetricKey, days = 7): number[] {
    const store = this.stores[metric];
    if (!store) return [];
    const out: number[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dk = dayKey(now - i * 86400000);
      if (store.derivedDays?.[dk] === 1) continue;   // ★ 跳过推算日
      const d = store.daily?.[dk];
      if (d && d.last != null && !Number.isNaN(d.last)) out.push(d.last);
      else if (d && d.mean != null && !Number.isNaN(d.mean)) out.push(d.mean);
    }
    return out;
  }
```

`src/ai/health.ts:52` —— 改用实测版，并补来源说明：

```ts
function metricHistorySummary(metric: MetricKey, days = 7): string | null {
  try {
    // ★ 2026-11-06 审查（docs/audit/02 🟡#3）：只用实测日样本。
    //   推算日（offlineEstimates 的线性换算）不参与统计，避免把换算值当实测报出。
    const vals = healthStore.getMetricDailyMeansMeasured(metric, days);
```

---

### 🟡#4 · `migrateFromV1()` 迁移历史时不写 `derivedDays`，迁移来的推算值会被当成实测

**文件**：`src/data/healthStore.ts:1027-1043`

```ts
  /** 从旧 v1 快照（RingState 的 *Daily/seriesByDay/extDaily/ecgDaily）迁移。 */
  migrateFromV1(snap: any): void {
    if (!snap || typeof snap !== 'object') return;
    const moveDaily = (src: Record<string, any> | undefined, key: MetricKey) => {
      if (!src) return;
      const store = this.stores[key];
      for (const rawK of Object.keys(src)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue; // 丢弃 NaN-* 等非法 key
        const v = clampValid(Number(src[rawK]));
        if (v == null) continue;
        // ★ 仅补 v2 缺失的历史日，绝不覆盖 v2 已有的当日数据（避免旧快照覆盖新值）
        if (store.daily[dk] && store.daily[dk].samples > 0) continue;
        store.daily[dk] = {
          mean: v, min: v, max: v, last: v, samples: 1, source: 'backfill', updatedAt: Date.now(),
        };
      }
    };
```

**问题**：v1 快照里混着两类值——**实测值**与**旧版本的离线推算值**。迁移时统一写 `source: 'backfill'`，**但 `derivedDays` 完全没有标记**。

后果：这些迁移来的推算值，在 `isDerivedDay()` 眼里是「实测日」：
- `MetricDetailScreen` 的「皮质醇 `measuredOnly` → 推算日不出曲线」保护**失效**（这些日不再是推算日，会画线）；
- `ai/patterns.ts:96-100` 的「皮电/压力规律只取实测日」**失效**；
- `analysisFacts.ts` 会给 AI 标 `source: 'measured'`。

也就是说，**v1 迁移是一条能让推算值「洗白」成实测值的通道**。由于 `Source` 类型里已有 `'backfill'` 这个语义（`healthStore.ts:112`），迁移时至少应该区分「v1 的实测日」与「v1 的推算日」。

**建议修改后代码**：

```ts
  /** 从旧 v1 快照（RingState 的 *Daily/seriesByDay/extDaily/ecgDaily）迁移。 */
  migrateFromV1(snap: any): void {
    if (!snap || typeof snap !== 'object') return;
    // ★ 2026-11-06 审查（docs/audit/02 🟡#4）：v1 快照里混着「实测」与「离线推算」两类值。
    //   旧实现统一写 source:'backfill' 且**不打 derivedDays**，等于给推算值做了洗白：
    //   isDerivedDay() 会把它们当成实测日 → measuredOnly 保护失效、
    //   patterns 的实测过滤失效、AI 会标 source:'measured'。
    //   现在：能判定为推算来源的指标（eda/sns/cortisol/emotion/skin/fatigue）
    //   一律打 derivedDays 标；快照里带明确推算标记（derivedDays / derived）的日也打标。
    const DERIVED_ONLY_KEYS = new Set<MetricKey>(['eda', 'sns', 'cortisol', 'emotion', 'skin', 'fatigue']);
    const moveDaily = (src: Record<string, any> | undefined, key: MetricKey) => {
      if (!src) return;
      const store = this.stores[key];
      for (const rawK of Object.keys(src)) {
        const dk = normalizeDayKey(rawK);
        if (Number.isNaN(parseDayKey(dk))) continue; // 丢弃 NaN-* 等非法 key
        const v = clampValid(Number(src[rawK]));
        if (v == null) continue;
        // ★ 仅补 v2 缺失的历史日，绝不覆盖 v2 已有的当日数据（避免旧快照覆盖新值）
        if (store.daily[dk] && store.daily[dk].samples > 0) continue;
        store.daily[dk] = {
          mean: v, min: v, max: v, last: v, samples: 1, source: 'backfill', updatedAt: Date.now(),
        };
        // ★ 打推算标：v1 里这些指标本就只有推算来源，或快照自带 derived 标记。
        const rawMarked = (snap.derivedDays && snap.derivedDays[rawK]) || (snap.derived && snap.derived[rawK]);
        if (rawMarked || DERIVED_ONLY_KEYS.has(key)) {
          if (!store.derivedDays) store.derivedDays = {};
          store.derivedDays[dk] = 1;
        }
      }
    };
```

---

### 🟡#5 · `familyStore` 文件头仍宣称「全仓健康数据本就是 7 天模拟」

**文件**：`src/data/familyStore.ts:13-16`

```ts
 * 现状：Mira 硬件尚未出货，全仓健康数据本就是 7 天模拟；本 store 不接后端 /
 *   不接真实账号体系。后续接真实账号时，只需把 seedMembers / bindMember 换成云端读写，
 *   UI 层不变。
```

**问题**：这句「**全仓健康数据本就是 7 天模拟**」是本仓**最危险的一句注释**。它给后续开发者发出了一个明确的许可：「这里造假数据没关系，反正全仓都是模拟的」。本轮审查发现的 🔴#1 / 🔴#2（familyStore 写死恢复指数 82 / 70、睡眠 7.4 / 7）正是这句话的**直接产物**。

而事实上，全仓真实测量链路（`RingBleManager` 原生直连 / 后端回读 / `realSeries.buildHistorySeries`）**已经是真数据**，写死的部分只是**残留**。注释描述的是旧状态，与现状相反。

**建议修改后代码**（完整可替换文件头第 13-16 行）：

```ts
 * 现状：本 store **不接后端 / 不接真实账号体系**，成员与健康结论均为本地占位；
 *   后续接真实账号时，只需把 seedMembers / bindMember 换成云端读写，UI 层不变。
 *
 * ★ 2026-11-06 审查（docs/audit/02 🟡#5）：**删除「全仓健康数据本就是 7 天模拟」这句**。
 *   它与现状相反 —— 全仓真实测量链路（RingBleManager 原生直连 / 后端回读 /
 *   realSeries.buildHistorySeries）已走真实数据，写死部分只是残留。
 *   保留这句话等于给后续开发者发「这里造假数据没关系」的许可，
 *   而本轮的 🔴#1 / 🔴#2（写死恢复指数 82 / 70、睡眠 7.4 / 7）正是它的产物。
 *   铁律：**任何看起来像真实测量的数值，都必须来自真实测量。**
```

---

## 5. 🔵 Medium（9 个）

### 🔵#1 · `metrics.ts` 保留完整的假曲线生成器（`SERIES_PARAM` + `genSeries`）

**文件**：`src/data/metrics.ts:485-589`（参数表）、`:591-604`（生成器）

```ts
// :485-503
export const SERIES_PARAM: Record<MetricKey, Record<RangeKey, SeriesParam>> = {
  sleep: {
    day: { base: 46, amp: 42, cycles: 1, phase: 1.571, seed: 3, min: 0, max: 100 },
    week: { base: 7.1, amp: 0.6, cycles: 1.5, phase: 0, seed: 5, min: 4.5, max: 10 },
    ...
  metabolism: {
    week: { base: 1842, amp: 90, cycles: 1.5, phase: 0, seed: 2, min: 1400, max: 2400 },
```

```ts
// :591-604
export function genSeries(p: SeriesParam, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const s = Math.sin(t * p.cycles * 2 * Math.PI + p.phase);
    const noise = (((i * 13 + p.seed * 7) % 7) - 3) * (p.amp / 14);
    let v = p.base + p.amp * s + noise;
    if (p.min !== undefined) v = Math.max(p.min, v);
    if (p.max !== undefined) v = Math.min(p.max, v);
    out.push(v);
  }
  return out;
}
```

**核查结论**：`grep -rnE "genSeries|SERIES_PARAM" src scripts tools plugins` **仅命中 `metrics.ts` 自身定义**，当前**零外部引用** → **尚未泄漏到 UI**。但它是一个**完整的假测量值生成器**（`base: 1842` 的基础代谢、`base: 7.1` 的睡眠时长），任何人一行 `genSeries(SERIES_PARAM.hr.week, 7)` 就能造出 7 天假心率曲线。

**建议**：**删除**（零引用，删除零风险）。

```ts
// src/data/metrics.ts —— 删除 :485-589 的 SERIES_PARAM 与 :591-604 的 genSeries
// ★ 2026-11-06 审查（docs/audit/02 🔵#1）：**删除假曲线生成器**。
//   SERIES_PARAM + genSeries() 是一套完整的假测量值生成器（基础代谢 base: 1842、
//   睡眠 base: 7.1、心率 base: 60 …），用正弦波 + 伪随机噪声造出「看起来像测量」的曲线。
//   全仓零引用（grep -rnE "genSeries|SERIES_PARAM" src scripts tools plugins
//   仅命中本文件定义），**尚未泄漏**，但留着就是一个随时可被接上的造假后门。
//   真实曲线一律由 realSeries.buildHistorySeries 从 RingBle 真值计算。
```

> 同时删除 `SeriesParam` 类型定义（若仅被这两者引用）。**保留** `SERIES_PARAM` 中确实被图表参数复用的部分需先确认引用，**当前确认为零引用**。

---

### 🔵#2 · `TREND_SCRIPT` 写死的 48 个状态值数组

**文件**：`src/data/metrics.ts:20-29`

```ts
export const TREND_SCRIPT: [StateKey, number][] = [
  ['tired', 30], ['tired', 26], ['calm', 24], ['calm', 22], ['calm', 24], ['calm', 28],
  ['calm', 32], ['calm', 40], ['energy', 52], ['energy', 64], ['energy', 72], ['energy', 70],
  ...
  ['tired', 22], ['tired', 24],
];
```

**问题**：这是为「情绪趋势图」预先写死的 48 点状态脚本（`tired/calm/energy/tense` + 数值）。**全仓零引用**（`grep -rnE "TREND_SCRIPT" src scripts tools plugins` 仅命中定义处）→ 未泄漏。但它是「一条看起来像真实情绪记录」的假数据序列，一旦被接到 `EmotionTrendChart` 就会展示。

**建议修改后代码**：

```ts
// src/data/metrics.ts —— 删除 :20-29 的 TREND_SCRIPT
// ★ 2026-11-06 审查（docs/audit/02 🔵#2）：**删除写死的情绪状态脚本**。
//   48 个 ('tired'|'calm'|'energy'|'tense', 数值) 组成一条「看起来像真实情绪记录」
//   的假序列。全仓零引用，尚未泄漏；但留着随时可能被接到情绪趋势图上。
//   真实情绪曲线由 emotionLog / healthStore 的实测与推算（标 derived）数据提供。
```

---

### 🔵#3 · `TodayScreen` 账号名与头像字母写死 `Kristina` / `K`

**文件**：`src/screens/TodayScreen.tsx:1092-1099`

```tsx
            <View style={styles.head} onLayout={measureSection('head')}>
              <TouchableOpacity style={styles.avatarName} onPress={() => navigation.navigate('AccountHub')} activePress={...}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>K</Text>
                </View>
                <Text style={styles.name}>Kristina</Text>
              </TouchableOpacity>
```

**问题**：`userStore` **已经存了真实的 `accountName`**（`src/data/userStore.ts:25/59/124/134/149`），但 `TodayScreen` 没接，仍写死 `Kristina`。演示时若渠道商用别的名字讲，首页仍显示 `Kristina` —— 属于**演示身份泄漏到正式 UI**，同时也是**真实用户信息没接上**。

**建议修改后代码**：

```tsx
// src/screens/TodayScreen.tsx
// ★ 2026-11-06 审查（docs/audit/02 🔵#3）：接真实 accountName，不再写死 Kristina / K。
//   userStore 已持久化 accountName（注册 / 登录时写入），首页应展示当前账号。
const account = userStore.getAccount?.();   // 按 userStore 实际导出名调整
const displayName = account?.accountName || '我';
const displayLetter = displayName.slice(0, 1).toUpperCase() || '我';
```

```tsx
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{displayLetter}</Text>
                </View>
                <Text style={styles.name}>{displayName}</Text>
```

> 落地前需确认 `userStore` 的读取 API 名（`getAccount` / `getSession` / `getCurrentAccount`），以及 `TodayScreen` 是否已订阅 `userStore`（若未订阅需补 `useSyncExternalStore` 或直接同步读一次）。

---

### 🔵#4 · `AccountHubScreen` 写死「Mira 会员 · 第 2 个月」

**文件**：`src/screens/AccountHubScreen.tsx:83`

```tsx
            <Text style={s.profileSub}>Mira 会员 · 第 2 个月</Text>
```

**问题**：「第 2 个月」是**写死的会员时长**，与真实订阅状态无关。新用户（0 个月）、老用户（18 个月）看到的一模一样，且这是一个**看起来像真实账户状态**的字段——渠道演示时很容易被当作产品能力讲解。

**建议修改后代码**：

```tsx
// src/screens/AccountHubScreen.tsx:83
            {/* ★ 2026-11-06 审查（docs/audit/02 🔵#4）：会员时长不得写死。
                无真实订阅数据时只展示会员标识，不编造「第 N 个月」。 */}
            <Text style={s.profileSub}>Mira 会员</Text>
```

> 若确有订阅信息源（如 `userStore.subscriptionSince`），可改为按真实起始时间计算：
> `const months = Math.max(1, Math.floor((Date.now() - since) / (30 * 86400000)));` —— 无数据源时**保持不带时长**。

---

### 🔵#5 · `BindingRitualScreen` 的姓名兜底写死 `'陈屿'`（已删除的演示家人）

**文件**：`src/screens/BindingRitualScreen.tsx:49`、`:54`

```tsx
  const name = params.name ?? '陈屿';
  ...
  const ownerName = selfMember?.name ?? 'Kristina';
```

**问题**：`陈屿` 是**本轮刚被删除的演示家人**（`familyStore` 已无此人）。它作为 `params.name` 的兜底值留在了代码里——一旦某个绑定流程没传 `name`，界面就会凭空出现一个叫「陈屿」的人，**且这个演示身份会随演示者的手滑被展示出来**。`ownerName ?? 'Kristina'` 同理。

**建议修改后代码**：

```tsx
// src/screens/BindingRitualScreen.tsx:48-55
  // ★ 2026-11-06 审查（docs/audit/02 🔵#5）：**删除写死的演示姓名兜底**。
  //   '陈屿' 是本轮已删除的演示家人（familyStore 中已无此人），
  //   留在 params.name 的兜底位上，一旦某条流程没传 name 就会凭空冒出这个人。
  //   'Kristina' 同样写死 —— 本人姓名应取 familyStore 的 self 成员。
  const name = params.name?.trim() || '家人';
  ...
  const ownerName = selfMember?.name || '我';
```

---

### 🔵#6 · `userStore` 的演示验证码在登录页明文展示

**文件**：`src/data/userStore.ts:66-67`、`src/screens/LoginScreen.tsx:245`

```ts
// src/data/userStore.ts:66-67
/** 演示验证码（无短信后端，仅 MVP 占位；真实环境由服务端下发）。 */
export const DEMO_CODE = '123456';
```

```tsx
// src/screens/LoginScreen.tsx:245
              <Text style={s.demoHint}>演示验证码：{DEMO_CODE}（无短信后端，正式版由服务端下发）</Text>
```

**问题**：Release 包里**明文显示**「演示验证码：123456」。即使有「正式版由服务端下发」的说明，这行字本身就在告诉用户「这是个可以随便登录的后门」。渠道商演示时更会被截图传播。

**建议修改后代码**：

```tsx
// src/screens/LoginScreen.tsx:245
              {/* ★ 2026-11-06 审查（docs/audit/02 🔵#6）：Release 包不展示演示验证码。
                  联调期只在 __DEV__ 下展示，避免正式包被截图传播。 */}
              {__DEV__ ? (
                <Text style={s.demoHint}>联调验证码：{DEMO_CODE}（仅 Debug 包可见）</Text>
              ) : null}
```

**同时建议**：`src/data/userStore.ts` 的常量改名，避免「demo」措辞强化「这是演示逻辑」的印象：

```ts
/** 联调用短信验证码（无短信后端时的固定码；Release 包不展示，见 LoginScreen）。 */
export const DEV_SMS_CODE = '123456';
```

> ⚠️ 改名会波及 `LoginScreen.tsx:27` 的 import，需一并改。**需与后端联调方式确认后**再动，故本轮未落地。

---

### 🔵#7 · `BasicMetricCard` 注释称「未收到则回退到 mock」，与实现不符

**文件**：`src/components/BasicMetricCard.tsx:160`

```ts
  /** 当前数值（优先真实值，未收到则回退到 mock） */
  value: string;
```

**问题**：实际调用方 `InsightScreen` 传的是 `formatValue(real)`，`real` 为 `null` → `'—'`，**并没有任何 mock 回退**。这行注释是**过期描述**，会让人以为「卡片里会自动填一个假值」，从而不敢去修真实的空态问题。

**建议修改后代码**：

```ts
  /** 当前数值（由调用方从真实测量格式化；无真实数据时传 '—'，本组件不做任何 mock 回退） */
  value: string;
```

---

### 🔵#8 · `MetricDetailScreen` 的 `?? 30` 阈值兜底（与 🔴#5 同源的残留）

**文件**：`src/screens/MetricDetailScreen.tsx:269`、`:813`、`:2407`

```ts
// :269
  const b0 = th[0] ?? 30, b1 = th[1] ?? b0, b2 = th[2] ?? b1;
// :813
  const lo = b0 ?? 30, hi = b1 ?? 55;
// :2407
  const b0 = STRESS_BANDS[0] ?? 30, b1 = STRESS_BANDS[1] ?? 60, b2 = STRESS_BANDS[2] ?? 80;
```

**结论**：这三处兜底的是**阈值常量**（压力档位边界、温度区间），不是测量值，**判定为低风险、不改**。但它们与 🔴#5 的 `age ?? 30` 混在同一个文件里，**极易让后续开发把「年龄兜底」误认为「同类无害写法」而保留下来**。

**建议**：在文件头加一条约束注释（不改逻辑）：

```ts
// ★ 2026-11-06 审查（docs/audit/02 🔵#8）：本文件里的 `?? 30` / `?? 55` 等兜底
//   **只允许用于阈值常量**（压力档位边界、温度区间等静态参数）。
//   **严禁用于年龄 / 体重 / 身高等生理输入** —— 那会产出基于编造输入的生理结论
//   （见 🔴#5：age ?? 30 曾导致 MHR 算出 192 并在 UI 明写「基于 30 岁」）。
```

---

### 🔵#9 · `src/data/userStore.ts` 顶部注释自述「本地 mock 账号」+ 明文密码

**文件**：`src/data/userStore.ts:5`、`:10-14`

```ts
 *   「本地 mock 账号」。接口与真实后端对齐，后续接入云端时只需把 store 内部
 *   ...
 *                           仅用于「注册 / 登录校验」，密码为本地明文占位，**非生产级**。
 *
 * ⚠️ 安全说明：本地明文存密码只是 MVP 演示；上线前必须替换为：
```

**结论**：**保留**。这三行注释**写得比代码更诚实**——明确标出「mock 账号」「本地明文」「非生产级」「上线前必须替换」，是本仓少见的**主动披露型注释**。与 🔵#5 / 🔵#7（过期且误导的注释）正好相反。

**建议**：**不改**。仅记录在此，供审核时区分「诚实披露的 mock」与「伪装成真实的 mock」。

---

## 6. ✅ 已排查，未发现（逐条附排查方式）

### 6.1 `Math.random()` 生成测量值 —— 未发现

- **排查方式**：`grep -rn "Math.random" src --include=*.ts --include=*.tsx` → 30 处命中，**逐行阅读上下文确认用途**。
- **结论**：全部为动效物理量（雨滴、撒花、光点抖动、眼球游走）或记录 ID 生成。**无一处生成 HRV / 心率 / 血氧 / 睡眠分 / 压力值等测量值**。
- **附带确认**：`src/data/chat.ts:98` 的建议问题洗牌用 `Math.sin(seed + i * 12.9898)`（确定性哈希），非随机。

### 6.2 定时器伪造实时数据 —— 未发现

- **排查方式**：`grep -rn "setInterval" src --include=*.ts --include=*.tsx` → 12 处命中，逐个看用途。
- **结论**：
  - `RingBleManager` 的 4 个定时器（60s 日值补齐 / 10s 指标 / 30s 设备 / 30s 情绪）**全部拉取或重算真实数据**；
  - `scheduleStatusTick()`（`:3730`）每 30 分钟边界重算状态，但有**未佩戴守卫**（`hasFreshHr / hasFreshEda / hasFreshSteps` 全 false 则跳过累积），不伪造读数；
  - 其余 7 处均为 UI 动画 / 蓝牙重试 / ECG 采样计时。
- **附带确认**：`TodayScreen` / `CalmWaveHome` 历史上写死的 `82`（恢复分）、`46`、`38`、`320`（活动消耗）**已全部移除**（`CalmWaveHome.tsx:244` 注释明示「不再写死兜底 82」）。

### 6.3 独立的「7 天 mock pipeline」模块 —— 未发现

- **排查方式**：
  1. `grep -rniE "mock|seed|fake|demo|模拟|7天|七天|7日|近7|sensorDay|synth|simulate|demo7|fake7" src scripts tools docs plugins` —— 全范围扫描；
  2. `git log --all --diff-filter=A --name-only | grep -iE "mock|seed|fake|demo"` —— 查历史新增文件；
  3. 逐一阅读 `src/data/` 下 10 个 store + `src/lib/` 下 12 个工具模块。
- **结论**：
  - **没有**独立的 mock 数据源模块或造数脚本；`scripts/`、`tools/` 内无造数工具。
  - `git log` 唯一命中是 `hband-sdk/uni-appSDK-main/code/demo/**`（第三方 SDK 自带示例代码，不在 `src` 内，不参与编译）。
  - **但**存在两条「近似泄漏通道」，已分别立为 🔴#3（合成睡眠分期）与 🟡#1~#3（30 天离线推算回填的未标注消费端）。

### 6.4 空态显示写死的 `'13'` 压力值 —— 未发现

- **排查方式**：
  1. `grep -rnE "['\"]13['\"]|:\s*13\b|=\s*13\b" src/components src/screens src/data --include=*.ts --include=*.tsx` → **零命中**；
  2. `grep -rnE "value=\{[0-9]|value=\"[0-9]{2,}" src` → 零命中；
  3. `grep -rnE "(暂无数据|无数据|尚未)[^\n]{0,60}[0-9]{2,3}" src` → 8 处命中，逐条核对**全部是文案里的时长说明（「约 30 秒心电图测量」）或注释**，无一是伪造指标值；
  4. `grep -rnE ">[0-9]{2,}<" src/components src/screens --include=*.tsx` → 命中全为坐标轴刻度（100 / 20 / 30 / 40）。
- **结论**：**未发现写死的 `'13'` 压力值**。该值疑似来自历史版本的 `StressInsightCard` / `EnergyBall`，当前代码已无残留。
- **空态机制复核（正面）**：`formatValue(null)` → `'—'`、`emptyResult()`、`DailyStatusCard` 空态文案、`EnergyDetailScreen:692`（「不放演示数据——示意图只说明这里会有图表」）、`CognitiveLoadCard:73`（「绝不放演示数据」→ 24 根空柱 + 档位轴 + 「暂无数据」浮层）、`QuickCheckTab:11`（「无演示数据；从未体检过则为空状态」）——**空态纪律良好**。
- **同类风险（不属于空态，但性质相同）**：`age ?? 30` 系列（🔴#5、🔵#8）、`DEMO_PROFILE_AGE`（已修）。

### 6.5 `metrics.ts` 指标定义表放示例数字 —— 未发现

- **排查方式**：逐行读 `src/data/metrics.ts:47-454`（`METRICS` / `BASIC_METRICS` / `EXTENDED_SIGNALS` / `BASICS_EXTRA_SIGNALS`）的 `value` / `data` 字段。
- **结论**：**全部**为 `value: '—'`、`data: []`。`:104` 有硬约束注释：「value/data 仅作元数据占位（恒为 '—' / []），真实数值一律由 realSeries.buildHistorySeries 从 RingBle 真值计算——**这里不许放示例数字**」。
- **例外**：`SERIES_PARAM` / `genSeries` / `TREND_SCRIPT` 三处 mock 残留 → 已分别立为 🔵#1 / 🔵#2。

### 6.6 文献基线（`dailyStatus.ts` 的 `LIT` 常量）—— 判定为「有文献依据的群体参考」，非假数据

- **文件**：`src/lib/dailyStatus.ts:135-147`
- **结论**：**保留**。该常量表附完整引文注释（Prinsen & Sacher 2025 / Altini & Plews 2019 / Oura Alzueta 2024），仅在个人样本 < 30 天时用于冷启动；`baselineSource: 'lit'` 明确标记来源；UI 文案「今日状态基于群体基线估算」诚实告知。**这是有出处的参考值，不是编造数据。**

---

## 7. 修复优先级建议

| 优先级 | 项 | 说明 |
|---|---|---|
| **P0** | 🔴#1 familyStore `self` 写死健康值 | 一行改动，删除即止 |
| **P0** | 🔴#2 `bindMember` 写死 + 详情页无标识 | 一行改动 + 一行 UI 说明 |
| **P0** | 🔴#3 合成睡眠分期打标 + UI 标注 | 需 State / 写入 / UI 三处联动，改动面最大 |
| **P0** | 🔴#4 `refreshDevice` / `start` 补黑名单守卫 | 与 `startDailyFallback` 已有守卫对齐 |
| **P0** | 🔴#5 `age ?? 30` 兜底 | 与已修的 `DEMO_PROFILE_AGE` 同源，属漏网 |
| **P1** | 🟡#1 周/月/年推算日标注 | 需 `realSeries` points 补 `dk` |
| **P1** | 🟡#2 皮质醇基线过滤推算日 | 一行 `continue` |
| **P1** | 🟡#3 AI 趋势只用实测日 | 新增 `getMetricDailyMeansMeasured` |
| **P1** | 🟡#4 `migrateFromV1` 打推算标 | 防止推算值「洗白」 |
| **P2** | 🟡#5 familyStore 文件头措辞 | 防后续复发 |
| **P2** | 🔵#1 / 🔵#2 删除假曲线生成器 | 零引用，删除零风险 |
| **P3** | 🔵#3 ~ 🔵#8 写死文案 / 过期注释 | 批量顺手做 |
| **—** | 🔵#9 `userStore` 顶部注释 | **判定保留**（诚实披露型注释） |

---

**共 22 个问题（🔴 5 / 🟡 5 / 🔵 9）。另已复核通过前序提交 `4b83d43` 修复的 3 项（`DEMO_PROFILE_AGE=30` 演示年龄兜底、`quickCheckStore` 的 seed 注释、`DemoBadge` 死代码 + `familyStore` 文件头部分措辞）。本轮为只读审查，未修改任何 `src/` 下文件。**
