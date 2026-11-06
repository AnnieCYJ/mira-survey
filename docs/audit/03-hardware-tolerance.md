# 维度 3 · 双硬件适配容错审查报告

> 项目：`/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`
> 审查维度：双硬件（PRO_UI = HK18 / LUNA-MIRA-PRO；BASE_UI = LUNA-MIRA 基础版）适配容错
> 审查方式：**只读**。本次审查**未修改任何 `src/` 下的文件**，所有修复均以「建议修改后代码」形式给出。
> 审查日期：2026-11-06

---

## 0. 背景与判定标准

### 0.1 两款硬件的能力差异（真相源：`src/config/deviceModel.ts`）

| 能力 | PRO_UI（HK18 / LunaMira Pro） | BASE_UI（LunaMira 基础版） |
|---|---|---|
| `ecg`（心电） | ✅ | ❌ |
| `temp`（体温，日均） | ✅ | ✅ |
| `eda`（EDA 皮电） | ✅ | ❌（协议无此指标，旧值实为 `skin_moisture`） |
| `skin`（独立皮肤温度） | ✅ | ❌ |
| `rr`（呼吸率，经 ECG） | ✅ | ❌ |
| `bp` / `glucose` / `cholesterol` / `uricAcid` / `emotion` / `cortisol` | ✅ | ❌ |
| `quickCheck`（一键体检） | ✅ | ✅（实测 + 估算） |
| `bodyComp`（身体成分） | ✅ | ✅（本地档案推算） |

硬件能力字段来源：
- iOS `ios/VeepooRing/VeepooRing.m:508-524` —— 在 `onPasswordVerified` 内透传 `capabilities = { temperatureType, gsrType, ecgType, bloodAnalysisType, healthGlanceType, bloodGlucoseType, skinType, deviceVersion, deviceNumber }`。
- Android `android/.../veepoo/VeepooRingModule.kt` —— **完全不透传 capabilities**（详见 🔵 #24）。

### 0.2 判定标准

需求原文：**基础版硬件缺血氧分析、身体年龄、EDA、ECG 等能力时，UI 必须优雅降级**——卡片隐藏或显示「该设备不支持」，**绝不能报错、白屏、NaN、undefined 崩溃**。

据此，本次审查把问题分为三级：

- 🔴 **Critical** = 会导致白屏 / TypeError 崩溃 / NaN 显示 / 基础版出现硬件不可能满足的功能入口且必然失败。
- 🟡 **High** = 不会立刻崩，但会导致「机型误判」「数据不一致」「静默失败无反馈」等用户可感知的错误行为。
- 🔵 **Medium** = 健壮性债 / 死代码 / 静默吞错导致反馈缺失，暂不触发线上事故但会拖垮后续维护。

### 0.3 审查覆盖面

| 项 | 覆盖情况 |
|---|---|
| `capabilities` / `deviceModel` 消费点 | ✅ 全量排查（见 §2） |
| `oxygenAnalysis` / `rrAnalysis` / `ecg` / `healthGlance` 为 null / 字段缺失时的 UI 安全性 | ✅ 全量排查（见 §3） |
| `a.aveRespRate` 等 0 值 / undefined 显示 | ✅ 逐项核对（见 §3.3） |
| `capabilities` 未返回时页面初始化是否崩溃 | ✅ 结论：安全（见 §4） |
| `!a` / `?? null` / `try-catch` 静默吞错清单 | ✅ 全量清单（见 §5） |

---

## 1. 结论摘要

| 级别 | 数量 | 核心风险 |
|---|---|---|
| 🔴 Critical | 5 | 白屏 / NaN / 基础版出现 ECG 测量入口 / 快照数据不一致 |
| 🟡 High | 10 | Pro 设备被永久降级成基础版 / 静默失败 UI 无反馈 / 机型识别无日志 |
| 🔵 Medium | 8 | 健壮性债 / 死代码 / 静默吞错 |

**一句话结论**：**UI 层的 null 防御整体是做得比较扎实的**（`useRingState()` 初始即返回完整 `RingState`，`EcgDetailScreen` 的 metrics 数组、`HrvLorenzSection` 的 `lorentz`、`MetricDetailScreen` 的体温 `.toFixed(2)` 均已加守卫）。**真正的缺口集中在两处**：

1. **能力判定链路没有闭环** —— `ring.deviceCapabilities` 恒为 `null`（`handleDeviceCapabilities` 从未被 `reg(...)` 注册），导致 `EcgCard` 的「不支持 ECG」分支永远走不到；`resolveProfileByCapabilities` 把「空 capabilities」等同于「基础版」，会让 Pro 设备被永久降级。
2. **快照落盘/恢复不对称** —— `oxygenAnalysis` / `rrAnalysis` 存都不存；`ecgHistory` 存了但不恢复；`ring.ecg` 恢复的是**上一枚戒指**的数据。

---

## 2. `capabilities` / `deviceModel` 的全部消费点

| # | 文件:行 | 读取内容 | 基础版走进会发生什么 | 判定 |
|---|---|---|---|---|
| 1 | `src/config/deviceModel.ts:268` `getProfile()` | profile 查找 | `?? DEVICE_PROFILES[DEFAULT_DEVICE_PROFILE]` 兜底 BASE_UI | ✅ 安全 |
| 2 | `src/config/deviceModel.ts:272-274` `hasCap()` | `features[feature] === true` | 未定义 feature 返回 false | ✅ 安全 |
| 3 | `src/config/deviceModel.ts:416-423` `resolveProfileByCapabilities()` | `caps.ecgType` | 空 caps → 判 BASE_UI 并**短路掉 MAC/广播名判定** | 🔴 见 🟡 #6 |
| 4 | `src/config/deviceModel.ts:460-475` `detectProfile()` | caps → MAC → 广播名 | 三层都拿不到时返回 null，保留上一档 | ✅ 设计正确，但被 #6 破坏 |
| 5 | `src/ble/RingBleManager.ts:1428-1438` | ready 分支 `applyProfileFromDevice` | 判定并持久化 Profile | 🟡 见 #12 |
| 6 | `src/ble/RingBleManager.ts:1490-1492` | connected 分支 `applyProfileFromDevice` | 用 MAC + 广播名识别 | 🟡 见 #13 |
| 7 | `src/components/EcgCard.tsx:69-71` | `ring.deviceCapabilities?.ecgType` | **恒 `undefined`** → `ecgUnsupported` 恒 `false` | 🔴 见 #2 |
| 8 | `src/components/QuickCheckTab.tsx:35-49` | `hasCap(profile,'bp'/'glucose'/'cortisol')` | 基础版无血压/血糖/健康一览信号 → 过滤掉 | ✅ 正确 |
| 9 | `src/data/quickCheckStore.ts:272-281` | `isPro && hasCap(profile, ...)` 双重门禁 | Pro 专属项全部为 null | ✅ 正确 |
| 10 | `src/components/EmotionCard.tsx:224-225` | `hasCap(dmModel,'eda')` | 基础版隐藏 EDA 诊断行 | ✅ 正确 |
| 11 | `src/components/SleepAnalysisCard.tsx:91-92` | `hasCap(dmModel,'temp')` | 条件渲染 | ✅ 正确 |
| 12 | `src/components/CalmWaveHome.tsx:392-393` | `homeModel.id === 'BASE_UI'` | 基础版去掉 recovery/emo/cycle chip | ✅ 正确 |
| 13 | `src/screens/EnergyDetailScreen.tsx:99-100` | `isBase` 分支 | ✅ 正确 |
| 14 | `src/screens/InsightScreen.tsx:242-259` | `useDeviceModel()` + `SUB_CAP` 过滤 + `effSub` 回落 | 基础版无 ecg/bp/sugar 子 tab；子 tab 被过滤后回落首项 | ✅ 正确 |
| 15 | `src/screens/InsightScreen.tsx:530-555` | `basicsSignals` + `BASIC_CAP` 过滤 | 基础版隐藏 eda/skinTemp/skin/emotion/cortisol/stress/fatigue/bp | ✅ 正确 |
| 16 | `src/screens/InsightScreen.tsx:892,957-958` | `BloodPanelTab` 的 `hasCap(bpModel,'uricAcid'/'cholesterol')` | 基础版隐藏尿酸/胆固醇卡 | ✅ 正确 |
| 17 | `src/screens/MetricDetailScreen.tsx:603-604` | `isBaseLayout` | 体温页改走云端日均（`saneBodyTemp`） | ✅ 正确 |
| 18 | `src/components/ProfileAwareHome.example.tsx:18,31` | `useDeviceModel()` + `hasCap(model,'ecg')` | **该文件未被任何地方 import**（死代码） | 🔵 见 #23 |

---

## 3. 关键数据字段的 null / undefined 安全性

### 3.1 `ring.oxygenAnalysis`

**唯一写入点**：`src/ble/RingBleManager.ts:1778-1807` `handleOxygenAnalysis()` —— 每次都写全字段，且 `freqTimes: Array.isArray(raw.freqTimes) ? raw.freqTimes.map(String) : []`（行 1800）已保证是数组。

**结论**：数据层已保证 `freqTimes` 一定是数组 → 🔴 #1 是「防御纵深」问题（当前不会崩，但任何未来新增写入路径 / 快照恢复路径一旦绕过 `handleOxygenAnalysis` 就会崩）。仍应修。

**UI 消费点**：
- `src/components/OxygenApneaSection.tsx:32` `const a = ring.oxygenAnalysis;`
- `:33` `const osahs = a ? (OSAHS_LEVELS[a.osahsResult] ?? OSAHS_LEVELS[-1]) : null;` ✅
- `:44-52` 空态三分支 ✅
- `:87` `a.freqTimes.length > 0` ← **无守卫** 🔴 #1
- `:57 / :61` `a.aveOxygen || '—'` / `a.minOxygen || '—'` ← 0 值无提示文案 🟡 #14

**渲染位置**：`MetricDetailScreen.tsx:1895`（血氧页）、`SleepDetailScreen.tsx:520`（睡眠恢复详情页）。

### 3.2 `ring.rrAnalysis`

- 写入点 `RingBleManager.ts:1810-1827`，`rr` 与 `lorentz` 均已 `Array.isArray` 守卫 ✅
- 消费点 `MetricDetailScreen.tsx:2636-2657` `HrvLorenzSection`：
  - `:2639` `const r = ring.rrAnalysis;`
  - `:2640` `const hrv = r ? computeRrHrv(r.rr) : null;`
  - `:2651` `if (r && r.lorentz.length) {` ✅ 有 `r &&` 守卫
  - `computeRrHrv`（`RingBleManager.ts:246`）内 `if (!rr || rr.length < 10) return null` ✅
- **结论：安全** ✅ 无问题。

### 3.3 `a.aveRespRate` 等 0 值 / undefined 显示（逐项核对）

| 字段 | 位置 | 当前写法 | 0 / undefined 时显示 | 判定 |
|---|---|---|---|---|
| `aveRespRate` | `OxygenApneaSection.tsx:73-74` | `a.aveRespRate \|\| '--'` + `!a.aveRespRate ? <Text style={styles.statHint}>需全天血氧监测数据</Text>` | `--` + 提示 | ✅ 已修 |
| `aveLowOxygenTime` | `:78-79` | 同款 | `--` + 提示 | ✅ 已修 |
| `aveCardiacLoad` | `:83-84` | 同款 | `--` + 提示 | ✅ 已修 |
| `aveOxygen` | `:57` | `a.aveOxygen \|\| '—'` | `—`，**无提示文案** | 🟡 #14 |
| `minOxygen` | `:61` | `a.minOxygen \|\| '—'` | `—`，**无提示文案** | 🟡 #14 |
| `osahsResult` | `:33, :65` | `OSAHS_LEVELS[a.osahsResult] ?? OSAHS_LEVELS[-1]` + `osahs?.label ?? '—'` | `—` | ✅ 安全 |

**结论**：题目中「已改为 `'--'` + 提示，验证无遗漏」——**3 项已修、2 项（`aveOxygen` / `minOxygen`）遗漏**，见 🟡 #14。

### 3.4 `ring.ecg` / `ring.ecgHistory`

| 位置 | 代码 | 判定 |
|---|---|---|
| `EcgDetailScreen.tsx:205-206` | `const history = ring.ecgHistory ?? []; const latest = history.length > 0 ? history[0] : null;` | ✅ |
| `EcgDetailScreen.tsx:208` | `const a: EcgAnalysis \| undefined = latest?.analysis;` | ✅ |
| `EcgDetailScreen.tsx:212-221` metrics 数组 | 全部 `Math.round(latest?.x ?? 0)` / `a?.x != null ? ... : '—'` | ✅ 安全 |
| `EcgDetailScreen.tsx:383-385` 历史列表 | `Math.round(r.aveHeart)` —— `r` 来自 `ring.ecgHistory` | 🔴 见 #4 / 🟡 #15 |
| `EcgDetailScreen.tsx:243` | 副标题硬编码 `'HK18 ECG 硬件'` | 🔴 见 #3 |
| `MetricDetailScreen.tsx:1847` | `new Date(ring.ecg.ts).toLocaleString()` | ✅ `ts` 一定存在（`handleEcg` 写 `Date.now()`） |
| `MetricDetailScreen.tsx:1863-1867` | `Math.round(ring.ecg.aveHeart)` 等 5 行 | 🔴 见 #4 |
| `MetricDetailScreen.tsx:1852` | `ecgWaveformPath(ring.ecg.waveform)` | ✅ `ecgWaveformPath` 内 `if (!values \|\| values.length < 2) return ''`（`:406`） |
| `InsightScreen.tsx:1377-1391` `EcgReadout` | `const ecgSupported = !caps \|\| caps.ecgType > 0;` | 🔵 见 #20（且已是死代码） |
| `EcgCard.tsx:174-176` | `Math.round(latest.aveHeart)` 等 | 🟡 见 #4 |

### 3.5 `healthGlance`

- `ring.deviceCapabilities.healthGlanceType` 在 `RingBleManager.ts:384` 有类型定义、`:2603` 有写入 —— 但 `handleDeviceCapabilities` 从未被调用（🔴 #2 同源）。
- `healthStore` 侧的 healthGlance 数据由 `RingBleManager.ts:3938` `healthStore.upsertManual(hk, bucketDay, m.value, t, 'healthGlance')` 写入 ✅ 有 `source` 标记。
- UI 层对健康一览族指标的隐藏走 `hasCap(profile,'cortisol')`（`InsightScreen.tsx:545-546`、`QuickCheckTab.tsx:42`、`quickCheckStore.ts:279-281`）✅ 基础版正确隐藏。
- **结论：healthGlance 本身的空值处理安全**；唯一问题是它依附的 `deviceCapabilities` 通道未打通。

---

## 4. `capabilities` 未返回时（连接中 / 老固件）页面初始化是否崩溃

**结论：不崩溃 ✅**，依据如下：

1. `src/hooks/useRingState.ts:16` —— `useState<RingState>(() => RingBle.getState())` 初始即拿到**完整默认对象**，不是 `undefined`。
2. `src/ble/RingBleManager.ts:3270 / 3291 / 3299-3300` —— 初始 state 明确包含 `deviceCapabilities: null`、`ecg: null`、`oxygenAnalysis: null`、`rrAnalysis: null`。
3. `src/config/deviceModel.ts:529` —— `useDeviceModel()` 初始 `useState(DEFAULT_DEVICE_PROFILE)`（BASE_UI），异步 `getDeviceProfileId()` 后再 `setId`。**不存在「model 为 undefined」的中间态**。
4. `src/config/deviceModel.ts:268` —— `getProfile()` 有 `?? DEVICE_PROFILES[DEFAULT_DEVICE_PROFILE]` 兜底。
5. `src/config/deviceModel.ts:272-274` —— `hasCap()` 对未定义 feature 返回 `false`（不会抛）。

**但**：正因为「caps 为 null → 视为支持」的默认策略（`InsightScreen.tsx:1381` `!caps || caps.ecgType > 0`、`EcgCard.tsx:71` `ecgType === 0`），**capabilities 缺失时 UI 会「假装支持」**，这正是 🔴 #2 / #3 的根因。

---

## 5. `!a` / `?? null` / `try-catch` 静默吞错全量清单

### 5.1 `try-catch` 静默吞错点（按「吞错后 UI 是否有反馈」评估）

| # | 文件:行 | 吞掉什么 | 吞错后 UI 是否有反馈 | 判定 |
|---|---|---|---|---|
| 1 | `src/ble/RingBleManager.ts:2845` | `triggerOxygenAnalysis()` 失败 | ❌ 无。`OxygenApneaSection` 永远停在「当天暂无血氧数据」空态 | 🟡 #10 |
| 2 | `src/ble/RingBleManager.ts:2849` | `readRrAnalysis()` 失败 | ❌ 无。`HrvLorenzSection` 同上 | 🟡 #10 |
| 3 | `src/ble/RingBleManager.ts:3361 / 3365` | 同上（另一处入口） | ❌ 无 | 🟡 #10（同源） |
| 4 | `src/ble/RingBleManager.ts:1806` | `handleOxygenAnalysis` 解析失败 | ❌ 无日志、无提示，state 保持旧值 | 🟡 #11 |
| 5 | `src/ble/RingBleManager.ts:1826` | `handleRrAnalysis` 解析失败 | ❌ 无 | 🟡 #11 |
| 6 | `src/ble/RingBleManager.ts:1739` | `handleEcg` 解析失败 | ❌ 无。**且不写 `ecgError`** → UI 停在「测量中」直到 120s 超时 | 🟡 #16 |
| 7 | `src/ble/RingBleManager.ts:1437` | `applyProfileFromDevice` 失败 | ❌ 无日志。机型识别失败完全不可见 | 🟡 #12 |
| 8 | `src/ble/RingBleManager.ts:1492` | 同上，**且未挂 `.catch`** | → unhandled rejection | 🟡 #13 |
| 9 | `src/config/deviceModel.ts:513` | `getDeviceProfileId()` 读盘失败 | ❌ 无日志，静默回落 BASE_UI | 🟡 #7 |
| 10 | `src/config/deviceModel.ts:330-332` | `readDeviceInformation()` 失败 | ❌ 无日志，静默返回 null | 🟡 #8 |
| 11 | `src/data/quickCheckStore.ts:316` | `userStore.loadSession()` 失败 | ❌ 无。体检报告里身体成分整项消失 | 🔵 #17 |
| 12 | `src/screens/InsightScreen.tsx:288` | `overallScoreFromReport` 计算失败 | ❌ 无。综合分恒 null → 弧长退化为 0 | 🔵 #18 |
| 13 | `src/screens/InsightScreen.tsx:318` | 皮质醇节律构建失败 | ❌ 无。身体年龄文案恒「数据不足」 | 🔵 #19 |
| 14 | `src/lib/healthAgeCurrent.ts:36-38` | `computeHormonalHealthyCurrent` 失败 | ❌ 恒 false（语义上可接受，但无日志） | 🔵 #21 |
| 15 | `src/lib/healthAgeCurrent.ts:64-66` | `computeCurrentHealthAge` 失败 | ❌ 恒 null | 🔵 #21 |
| 16 | `src/data/ringDataIsolation.ts:64-66` | `getStoredDeviceInfo()` 失败 | ❌ 静默回落 `CURRENT_BASE_RING_ID` | 🔵 #22（配合 #22 一起看） |

> 说明：`RingBleManager.ts` 中另有约 30 处 `/* 静默 */`（如 `:736` 日志转发、`:1666` 睡眠分期解析、`:1688` 经期解析、`:2052 / :2136` 等）属于**「单点失败不拖垮主链路」的刻意设计**，不属于本次双硬件容错范畴，故不逐条列问题。

### 5.2 `?? null` / `?? 0` / `!a` 守卫（复核为安全）

| 位置 | 代码 | 判定 |
|---|---|---|
| `InsightScreen.tsx:939` | `v == null ? '—' : v.toFixed(it.decimals)` | ✅ |
| `InsightScreen.tsx:1312-1314` | `(today?.distance ?? 0).toFixed(1)` | ✅ |
| `InsightScreen.tsx:1017-1018` | `pts[0].x.toFixed(1)` —— `smoothSpline` 在 `pts.length === 0` 时提前返回 | ✅ |
| `InsightScreen.tsx:1043 / 1149` | `catch { return []; }` / `catch { return { sysPts: [], diaPts: [] }; }` | ✅ 有空态 |
| `MetricDetailScreen.tsx:1362-1370` | `tempDay.summary.avg != null ? ... .toFixed(2)` | ✅ |
| `MetricDetailScreen.tsx:1913` | `edaDiagnostics.medianGapMin != null ? ... .toFixed(1) : '—'` | ✅ |
| `MetricDetailScreen.tsx:1810` | `m.v.toFixed(1)` —— `ManualMeasurement.v: number`（非可选） | ✅ |
| `EcgDetailScreen.tsx:207` | `latest?.waveform?.length ?? 0` | ✅ |
| `EcgDetailScreen.tsx:224-229` | `a?.arrhythmiaRisk ?? 0` | ✅ |
| `components/HealthAgeCard.tsx` | `healthAge == null`、`overallScore ?? 0`、`Number.isFinite` 守卫 | ✅ |
| `config/deviceModel.ts:273` | `profile.features[feature] === true` | ✅ |

---

## 6. 🔴 Critical 问题（5 个）

### 🔴 #1 · `OxygenApneaSection` 读取 `a.freqTimes.length` 无空值守卫 → 可白屏

**文件**：`src/components/OxygenApneaSection.tsx`
**行号**：87-91

```tsx
          {a.freqTimes.length > 0 ? (
            <View style={styles.note}>
              <Text style={styles.note}>呼吸暂停频现时段：{a.freqTimes.join('、')}</Text>
            </View>
          ) : null}
```

**问题**：`a` 本身有守卫（`:52` 的 `a ? (...)`），但 **`a.freqTimes` 没有**。`OxygenAnalysis` 类型声明 `freqTimes: string[]`（`RingBleManager.ts:233`），但：
- `ring.oxygenAnalysis` 是**可写字段**，任何新增写入路径（快照恢复 / healthStore 同步 / 后端回填）都可能塞进一个缺 `freqTimes` 的对象；
- 一旦 `freqTimes` 为 `undefined`，`a.freqTimes.length` 直接抛 `TypeError: Cannot read properties of undefined (reading 'length')` → **React 渲染期抛错 → 整页白屏**（血氧页 `MetricDetailScreen.tsx:1895` 与睡眠恢复页 `SleepDetailScreen.tsx:520` 同时中招）。

当前唯一写入点 `RingBleManager.ts:1800` 有 `Array.isArray` 守卫，所以**今天不崩**——但这是「靠单一写入点的纪律」在兜底，缺少渲染层自身的防御纵深。

**建议修改后代码**（`src/components/OxygenApneaSection.tsx`，替换 32-33 行与 87-91 行）：

```tsx
  const a = ring.oxygenAnalysis;
  // ★ 渲染层防御：oxygenAnalysis 虽由 handleOxygenAnalysis 全字段写入，但它是可写字段
  //   （快照恢复 / 未来新增写入路径都可能塞进缺字段的对象）。
  //   freqTimes 是数组，缺失时按空数组处理，绝不让 a.freqTimes.length 抛 TypeError 导致整页白屏。
  const freqTimes: string[] = Array.isArray(a?.freqTimes) ? a.freqTimes : [];
  const osahs = a ? (OSAHS_LEVELS[a.osahsResult] ?? OSAHS_LEVELS[-1]) : null;
```

```tsx
          {freqTimes.length > 0 ? (
            <View style={styles.note}>
              <Text style={styles.note}>呼吸暂停频现时段：{freqTimes.join('、')}</Text>
            </View>
          ) : null}
```

---

### 🔴 #2 · `EcgCard` 的「设备不支持 ECG」分支永远走不到 → 基础版仍显示「开始心电图测量」

**文件**：`src/components/EcgCard.tsx`
**行号**：69-71（判定）、218-222（分支）

```tsx
  // ★ 2026-10-16：设备能力门禁——ecgType=0 表示当前戒指固件不支持 ECG，提前告知而非盲目测量后卡死
  const ecgType = ring.deviceCapabilities?.ecgType;
  const ecgUnsupported = ecgType === 0;
```

```tsx
      ) : ecgUnsupported ? (
        // 状态 3b：设备不支持 ECG → 禁用按钮 + 提示（ecgType=0）
        <View style={[styles.btn, { backgroundColor: theme.colors.ui.offTrack }]}>
          <Text style={[styles.btnLabelGrad, { color: theme.colors.textSub }]}>当前设备不支持 ECG 测量</Text>
        </View>
      ) : (
```

**问题（两层）**：

1. **`ring.deviceCapabilities` 恒为 `null`**。`RingBleManager.ts:2595-2607` 定义了 `handleDeviceCapabilities`，但 **`reg(...)` 注册列表（`RingBleManager.ts:843-859`）里没有它**，iOS/Android 原生也没有任何 `onDeviceCapabilities` 事件（已全局搜索确认）。唯一会写 `deviceCapabilities` 的地方是 `RingBleManager.ts:5979` 的快照恢复，而快照里存的 `deviceCapabilities` 本身也永远是 `null`（初始 state `:3270`）。
   → `ecgType` 恒为 `undefined` → `ecgUnsupported` 恒为 `false`。

2. **判定语义错**：`ecgType === 0` 只在「明确读到 0」时判不支持，但 **`undefined`（未上报 / 未注册通道）被当成支持**。按「无证据证明有 ECG，就不展示 ECG」的既定原则（`deviceModel.ts:236-243`），`undefined` 应判**不支持**或至少**未知态**。

**后果**：基础版戒指（BASE_UI，`ecg: false`）在洞察页心电子 tab（`InsightScreen.tsx:788-793` 渲染 `<EcgCard>`）里**照常显示「开始心电图测量」按钮**，点击后 `RingBle.measure('ecg')`（`EcgCard.tsx:116`）→ 基础版无 ECG 传感器 → 原生无回包 → 用户盯着「测量中 0%」直到 **120 秒超时**才被 `EcgCard.tsx:76-85` 的兜底 Alert 打断。**这是「基础版走进 ECG 页会发生什么」的直接答案：必然失败，且失败得非常慢。**

**建议修改后代码**（`src/components/EcgCard.tsx`，替换 69-71 行；需新增 import）：

```tsx
import { useDeviceModel, hasCap } from '../config/deviceModel';
```

```tsx
  // ★ 设备能力门禁 —— 双保险：
  //   ① 机型档位（权威）：BASE_UI 无 ECG 传感器 → 直接判不支持。
  //   ② 固件能力字段（补充）：ring.deviceCapabilities 目前**恒为 null**
  //      （RingBleManager.handleDeviceCapabilities 从未被 reg(...) 注册，见 🔴 #2），
  //      故 ecgType 只有在明确为 0 时才算「固件说不支持」；
  //      undefined = 未知，**绝不能当成支持**（否则基础版会点出一次必然超时的 ECG 测量）。
  const { model: dmModel } = useDeviceModel();
  const ecgType = ring.deviceCapabilities?.ecgType;
  const ecgUnsupported = !hasCap(dmModel, 'ecg') || ecgType === 0;
```

> 附带的配套修复（数据侧）：在 `src/ble/RingBleManager.ts:843-859` 的注册列表中补上通道，并让原生上报：

```ts
      reg('onDeviceCapabilities', (raw: any) => this.handleDeviceCapabilities(raw));
```

> 同时在 iOS `ios/VeepooRing/VeepooRing.m` 的 `onPasswordVerified` 中把 capabilities 同时 emit 成独立事件（当前只随 `onState` 的 `status:"ready"` 发出，而 `handleStateV2` 的 ready 分支只用于 `applyProfileFromDevice`，**没有写入 `state.deviceCapabilities`**）：

```objc
  // 在 [self emit:@"onState" body:@{@"status": @"ready", ...}] 之后补一行：
  [self emit:@"onDeviceCapabilities" body:caps];
```

---

### 🔴 #3 · `EcgDetailScreen` 整页无 `hasCap(profile,'ecg')` 门禁，副标题硬编码「HK18 ECG 硬件」

**文件**：`src/screens/EcgDetailScreen.tsx`
**行号**：242-243（副标题）、194-198（测量入口）

```tsx
            <Text style={styles.title}>心电图</Text>
            <Text style={styles.sub}>{ring.status === 'connected' ? 'HK18 ECG 硬件' : '连接戒指后测量'}</Text>
```

```tsx
  const measureEcg = useCallback(() => {
    if (measuring) return;
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring]);
```

**问题**：
1. **整页没有任何机型门禁**。`EcgDetailScreen` 与 `EcgCard` 一样没有 `hasCap(profile, 'ecg')` 判断，基础版只要通过导航进入（`InsightScreen.tsx:789` `navigation.navigate('EcgDetail')`、或深链 / 残留导航栈）就会看到「HK18 ECG 硬件 + 开始测量」的完整 ECG 界面。
2. **副标题硬编码机型名** `'HK18 ECG 硬件'`——基础版（`Luna Mira`）连接成功后也会显示这句话，**属于把「不支持」说成了「支持」**。这与 `EcgCard.tsx:221` 已有的「当前设备不支持 ECG 测量」文案直接矛盾。
3. `measureEcg`（`:194-198`）**没有「未连接」前置检查**（对比 `EcgCard.tsx:113-115` 有 `if (!st.deviceId)` / `if (st.status !== 'connected')` 的 Alert）。基础版点击后连「请先连接戒指」都得不到，直接进入无限「测量中」。

**建议修改后代码**（`src/screens/EcgDetailScreen.tsx`）：

```tsx
import { useDeviceModel, hasCap } from '../config/deviceModel';
```

```tsx
  const { model: dmModel } = useDeviceModel();
  const ecgSupported = hasCap(dmModel, 'ecg');
```

```tsx
  const measureEcg = useCallback(() => {
    if (measuring) return;
    const st = RingBle.getState();
    if (!st.deviceId) { Alert.alert('提示', '请先连接戒指'); return; }
    if (st.status !== 'connected') { Alert.alert('提示', '戒指未连接（当前: ' + st.status + '）'); return; }
    if (!ecgSupported) { Alert.alert('提示', '当前戒指硬件不支持 ECG 测量'); return; }
    setMeasuring(true);
    RingBle.measure('ecg');
  }, [measuring, ecgSupported]);
```

```tsx
            <Text style={styles.sub}>
              {!ecgSupported
                ? '当前设备不支持 ECG 测量'
                : ring.status === 'connected'
                  ? (dmModel.id === 'PRO_UI' ? 'HK18 ECG 硬件' : 'ECG 硬件')
                  : '连接戒指后测量'}
            </Text>
```

> 并在整页最外层加早退门禁（`return` 前置于图表渲染），避免基础版看到空壳界面：

```tsx
  if (!ecgSupported) {
    return (
      <View style={{ flex: 1 }}>
        <BgGradient colors={[...theme.colors.bgGradStops] as unknown as string[]}
          locations={[...theme.colors.bgGradLocs] as unknown as number[]} style={StyleSheet.absoluteFill} />
        <ScreenContainer compactTop topFadeColor={theme.colors.bgTop}>
          <View style={styles.head}>
            <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
              <Text style={{ fontSize: theme.fontSize.lg }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>心电图</Text>
              <Text style={styles.sub}>当前设备不支持 ECG 测量</Text>
            </View>
          </View>
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>当前这枚戒指没有心电传感器，无法进行心电图测量。</Text>
          </View>
        </ScreenContainer>
      </View>
    );
  }
```

---

### 🔴 #4 · `MetricDetailScreen` ECG 区块用 `Math.round(ring.ecg.x)` → 快照恢复的旧数据缺字段时显示 `NaN`

**文件**：`src/screens/MetricDetailScreen.tsx`
**行号**：1860-1874

```tsx
            <View style={styles.ecgGrid}>
              {(
                [
                  ['平均心率', ring.ecg ? `${Math.round(ring.ecg.aveHeart)} bpm` : '—'],
                  ['HRV', ring.ecg ? `${Math.round(ring.ecg.aveHrv)} ms` : '—'],
                  ['呼吸率', ring.ecg ? `${Math.round(ring.ecg.aveResRate)} 次/分` : '—'],
                  ['QT', ring.ecg ? `${Math.round(ring.ecg.aveQT)} ms` : '—'],
                  ['PWV', ring.ecg ? `${Math.round(ring.ecg.avePWV)} cm/s` : '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
```

**问题**：这里的守卫只判了 **`ring.ecg` 是否为 null**，**没有判字段本身是否存在**。`ring.ecg` 的来源有两个：
- `handleEcg`（`RingBleManager.ts:1714-1723`）—— 全字段写入（`num(raw.x) ?? 0`）✅；
- **快照恢复**（`RingBleManager.ts:5994` `if (snap.ecg) patch.ecg = snap.ecg;`）—— 直接把磁盘上的旧 JSON 原样灌回来 ⚠️。

旧版本 App 写出的 `ecg` 对象可能不含 `aveQT` / `avePWV`（这两个字段是后加的），此时 `Math.round(undefined)` → **`NaN`**，界面上直接显示 `NaN ms` / `NaN cm/s`。这正是任务要求重点排查的「`Math.round(undefined)`」类问题。

**同时受影响**（同一根因，建议一并修）：
- `src/components/EcgCard.tsx:174-176` —— `Math.round(latest.aveHeart)` / `aveHrv` / `aveResRate`
- `src/screens/EcgDetailScreen.tsx:383-385` —— `Math.round(r.aveHeart)` / `aveHrv` / `aveResRate`（`r` 来自 `ring.ecgHistory`）

**建议修改后代码**（`src/screens/MetricDetailScreen.tsx`，替换 1860-1875 行）：

```tsx
            <View style={styles.ecgGrid}>
              {(
                [
                  ['平均心率', ecgNum(ring.ecg?.aveHeart, 'bpm')],
                  ['HRV', ecgNum(ring.ecg?.aveHrv, 'ms')],
                  ['呼吸率', ecgNum(ring.ecg?.aveResRate, '次/分')],
                  ['QT', ecgNum(ring.ecg?.aveQT, 'ms')],
                  ['PWV', ecgNum(ring.ecg?.avePWV, 'cm/s')],
                ] as [string, string][]
              ).map(([k, v]) => (
                <View style={styles.ecgCell} key={k}>
                  <Text style={styles.ecgLabel}>{k}</Text>
                  <Text style={styles.ecgValue}>{v}</Text>
                </View>
              ))}
            </View>
```

> 并在同文件 `ecgWaveformPath`（`:405`）附近新增工具函数：

```tsx
/**
 * ECG 派生指标取数：字段缺失 / NaN / 非有限 一律显示 '—'。
 * 背景：ring.ecg 可能来自旧版快照（字段不全）→ Math.round(undefined) = NaN 会直接显示给用户。
 */
function ecgNum(v: number | undefined | null, unit: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} ${unit}`;
}
```

> 同步修 `src/components/EcgCard.tsx:171-185`：

```tsx
      {latest ? (
        <View style={{ flexDirection: 'row', marginTop: 10, gap: 12 }}>
          {[
            ['心率', typeof latest.aveHeart === 'number' && Number.isFinite(latest.aveHeart) ? `${Math.round(latest.aveHeart)}` : '—', 'bpm'],
            ['HRV', typeof latest.aveHrv === 'number' && Number.isFinite(latest.aveHrv) ? `${Math.round(latest.aveHrv)}` : '—', 'ms'],
            ['呼吸', typeof latest.aveResRate === 'number' && Number.isFinite(latest.aveResRate) ? `${Math.round(latest.aveResRate)}` : '—', '次/分'],
          ].map(([k, v, u]) => (
```

> 同步修 `src/screens/EcgDetailScreen.tsx:382-386`：

```tsx
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                  <Text style={styles.hStat}>心率 <Text style={styles.hStatVal}>{fmtNum(r.aveHeart)}</Text> bpm</Text>
                  <Text style={styles.hStat}>HRV <Text style={styles.hStatVal}>{fmtNum(r.aveHrv)}</Text> ms</Text>
                  <Text style={styles.hStat}>呼吸 <Text style={styles.hStatVal}>{fmtNum(r.aveResRate)}</Text></Text>
                </View>
```

```tsx
/** 历史 ECG 记录的字段兜底：缺失 → '—'，绝不出现 NaN */
function fmtNum(v: number | undefined | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}` : '—';
}
```

---

### 🔴 #5 · 快照落盘/恢复不对称：`oxygenAnalysis` / `rrAnalysis` 不落盘，`ecgHistory` 存了不恢复，`ring.ecg` 恢复的是**上一枚戒指**的数据

**文件**：`src/ble/RingBleManager.ts`
**行号**：落盘 `5507-5570`；恢复 `5994-5995`

**落盘侧（`saveSnapshot`，`:5507-5570`）**：
```ts
        deviceCapabilities: this.state.deviceCapabilities,   // :5529 —— 恒为 null（见 🔴 #2）
        ...
        ecg: this.state.ecg,                                // :5556
        ecgDaily: this.state.ecgDaily,                      // :5557
        ecgHistory: this.state.ecgHistory,                  // :5558
```
→ **`oxygenAnalysis` / `rrAnalysis` 两个字段完全没有出现在快照里**。

**恢复侧（`loadPersisted`，`:5994-5995`）**：
```ts
      if (snap.ecg) patch.ecg = snap.ecg;
      if (snap.ecgDaily) patch.ecgDaily = snap.ecgDaily;
```
→ **`ecgHistory` 存了但没有恢复**（快照里有，恢复时不读回）。

**三个具体故障**：

1. **血氧分析 / HRV Lorenz 每次冷启动必为空**：`oxygenAnalysis` / `rrAnalysis` 不落盘 → 冷启动后 `ring.oxygenAnalysis === null`、`ring.rrAnalysis === null` → `OxygenApneaSection` / `HrvLorenzSection` 必须重新 `triggerOxygenAnalysis()` / `readRrAnalysis()` 拉一次；在设备离线时会永远停在「当天暂无血氧数据」空态。

2. **ECG 历史跨重启丢失**：`ecgHistory` 存了不恢复 → `EcgDetailScreen.tsx:364` 的「历史测量 · {history.length} 次」在冷启动后恒为 **0 次**，而同一时刻 `MetricDetailScreen.tsx:1847` 仍能读到 `ring.ecg`（恢复了）→ **同一份数据在两个页面显示矛盾**。

3. **🔴 最严重：`ring.ecg` 恢复的是「上一枚戒指」的 ECG 读数**。基础版替换掉 HK18 后，磁盘快照里的 `ecg` 仍是 HK18 时期写入的 `{ aveHeart, waveform: [...] }`。恢复后：
   - `MetricDetailScreen.tsx:1863-1867` → 基础版用户看到**别人的心率/HRV/波形**；
   - `EcgCard.tsx:154-163` → 画出 HK18 的波形；
   - `EcgDetailScreen.tsx:248-254` → 展示 HK18 的「最新一次」。
   
   这与 `src/data/ringDataIsolation.ts` 建立的「旧 HK18 数据不得混入当前戒指」铁律**直接冲突**——隔离只做了 `daily` / `healthStore` 层，**漏了 `ecg` / `ecgHistory` 这两个原样搬运的字段**。

**建议修改后代码**：

**（a）`src/ble/RingBleManager.ts` 落盘侧**，在 `saveSnapshot` 的 `snap` 对象中（`:5558` 之后）补齐：

```ts
        ecgHistory: this.state.ecgHistory,
        // ★ v18.134 补：血氧分析 / RR 间期分析也要落盘。
        //   否则冷启动后 oxygenAnalysis / rrAnalysis 恒为 null，
        //   血氧页与 HRV 页每次冷启动都必须重新连设备拉一次，离线时永远空态。
        oxygenAnalysis: this.state.oxygenAnalysis,
        rrAnalysis: this.state.rrAnalysis,
```

**（b）恢复侧**，在 `loadPersisted` 中（`:5994-5995` 之后）补齐，并**加设备隔离**：

```ts
      if (snap.ecg) patch.ecg = snap.ecg;
      if (snap.ecgDaily) patch.ecgDaily = snap.ecgDaily;
      // ★ v18.134 补：ecgHistory 存了就要恢复，否则 EcgDetailScreen 的「历史测量 N 次」
      //   冷启动后恒为 0，而同一份 ring.ecg 却在 MetricDetailScreen 有值 → 两页自相矛盾。
      if (Array.isArray(snap.ecgHistory)) patch.ecgHistory = snap.ecgHistory;
      if (snap.oxygenAnalysis) patch.oxygenAnalysis = snap.oxygenAnalysis;
      if (snap.rrAnalysis) patch.rrAnalysis = snap.rrAnalysis;
```

**（c）🔴 关键隔离补丁** —— 恢复 ECG 读数前必须校验「这份 ECG 是当前这枚戒指测的」，否则会把 HK18 的心电数据灌给基础版用户。放在 `loadPersisted` 中 `patch.ecg = snap.ecg` 之前：

```ts
      // ★ v18.134（双硬件隔离）：ECG 读数必须校验来源戒指。
      //   快照里的 ecg / ecgHistory 是「上次 App 运行时那枚戒指」测的。
      //   换了戒指（HK18 → Luna Mira 基础版）后原样恢复 = 把旧戒指的心电图展示给新用户。
      //   依据：src/data/ringDataIsolation.ts 已把旧 HK18 的 device_id 拉黑，
      //   这里复用同一套判定（快照里的 deviceId 若是旧设备 / 未知设备 → 不恢复 ECG）。
      const snapEcgDeviceId = normDeviceId((snap as any).deviceId);
      const ecgBelongsToCurrentRing =
        !!snapEcgDeviceId && !isBlockedRingDeviceId(snapEcgDeviceId) && snapEcgDeviceId === normDeviceId(this.state.deviceId);
      if (ecgBelongsToCurrentRing) {
        if (snap.ecg) patch.ecg = snap.ecg;
        if (Array.isArray(snap.ecgHistory)) patch.ecgHistory = snap.ecgHistory;
      } else if (snap.ecg || snap.ecgHistory) {
        postLog('RingBle', `[loadPersisted] 跳过 ECG 恢复：快照来源设备 ${snapEcgDeviceId || '(未知)'} 与当前戒指不一致`);
      }
```

> 并在 `src/ble/RingBleManager.ts` 顶部补 import：

```ts
import { isBlockedRingDeviceId, normDeviceId } from '../data/ringDataIsolation';
```

---

## 7. 🟡 High 问题（10 个）

### 🟡 #6 · `resolveProfileByCapabilities` 把「空 capabilities」等同于「基础版」→ Pro 设备被永久降级

**文件**：`src/config/deviceModel.ts`
**行号**：416-423

```ts
export function resolveProfileByCapabilities(
  caps: RingCapabilities | null | undefined,
): DeviceProfileId | null {
  if (!caps) return null;
  // ECG 是 Pro 与基础版的唯一硬件硬区分（基础版无 ECG 传感器）
  if (Number(caps.ecgType) > 0) return 'PRO_UI';
  return 'BASE_UI';
}
```

**问题**：`caps` 为 **`{}`（空字典，字段全缺）** 时，`Number(undefined) > 0` → `false` → **返回 `'BASE_UI'`**。

而 iOS 端确实会发出空字典：`ios/VeepooRing/VeepooRing.m:511-523`
```objc
  NSMutableDictionary *caps = [NSMutableDictionary dictionary];
  VPPeripheralModel *pm = self.connectedModel;
  if (pm) {
    caps[@"temperatureType"] = @(pm.temperatureType);
    ...
  }
```
→ **`pm` 为 nil 时（`connectedModel` 尚未就绪 / SDK 自动重连路径）`caps` 就是空字典 `{}`**，随 `onState{status:"ready"}` 发出。

再看 `detectProfile`（`:460-475`）的优先级：**能力字段 → MAC → 广播名**，且 `:466-467`
```ts
  const byCaps = resolveProfileByCapabilities(opts.capabilities);
  if (byCaps) return byCaps;
```
→ **空字典让 caps 层直接返回 `BASE_UI`，把后续的 MAC 判定（`DEVICE_ID_PROFILES` 里 `C9:00:9C:D7:C2:D8 → PRO_UI`）和广播名判定（`guessModelFromName`）全部短路**。

**后果**：一台 HK18 / Pro 设备，只要某次连接的 `ready` 事件里 `connectedModel` 还没就绪 → **被永久持久化为 `BASE_UI`**（`persistProfile` 落盘）→ 用户的所有 ECG / 血压 / 血糖 / 血液成分入口全部消失，且**下次启动仍读盘得到 BASE_UI**，直到下一次连接才可能纠正（但纠正的路径同样会被空 caps 打断）。

**建议修改后代码**（`src/config/deviceModel.ts`，替换 416-423 行）：

```ts
export function resolveProfileByCapabilities(
  caps: RingCapabilities | null | undefined,
): DeviceProfileId | null {
  if (!caps) return null;
  // ★ 只有在**确实读到 ecgType** 时才下结论。
  //   旧实现里 caps.ecgType 缺失（undefined）时 Number(undefined) > 0 → false → 判 BASE_UI，
  //   而 detectProfile 的 caps 层优先级最高 → 会把 MAC / 广播名判定整个短路掉。
  //   实锤：iOS VeepooRing.m 在 connectedModel 尚未就绪时透传的是**空字典 {}**（pm 为 nil），
  //   那样一台 Pro 设备会被永久持久化成 BASE_UI（用户侧：ECG/血压/血糖入口全部消失）。
  //   修正：ecgType 缺失 → 返回 null，交回 MAC / 广播名判定；三条线索都拿不到时由调用方保留上一档。
  const ecgType = caps.ecgType;
  if (typeof ecgType !== 'number' || !Number.isFinite(ecgType)) return null;
  if (ecgType > 0) return 'PRO_UI';
  return 'BASE_UI';
}
```

---

### 🟡 #7 · `getDeviceProfileId()` 读盘失败静默吞错 → 机型静默降级为 BASE_UI，无任何日志

**文件**：`src/config/deviceModel.ts`
**行号**：509-515

```ts
export async function getDeviceProfileId(): Promise<DeviceProfileId> {
  try {
    const v = await Prefs.getItem(PROFILE_KEY);
    if (v === 'PRO_UI' || v === 'BASE_UI') return v;
  } catch {}
  return DEFAULT_DEVICE_PROFILE;
}
```

**问题**：`catch {}` **完全吞错且无日志**。`Prefs.getItem` 内部（`src/utils/prefs.ts:18-25`）本身已有 try/catch 返回 null，所以外层这个 `catch {}` **几乎永远不会触发**——真正的信息（读盘失败 vs 首次运行）被彻底丢弃。读盘失败 → 静默回落 `DEFAULT_DEVICE_PROFILE`（BASE_UI）→ Pro 用户的 ECG 入口静默消失，**用户与开发者都无法定位**。

**建议修改后代码**（`src/config/deviceModel.ts`，替换 509-515 行）：

```ts
export async function getDeviceProfileId(): Promise<DeviceProfileId> {
  try {
    const v = await Prefs.getItem(PROFILE_KEY);
    if (v === 'PRO_UI' || v === 'BASE_UI') return v;
    // 落盘值非法（老版本残留 / 手工改坏）→ 回落安全默认，但留痕
    console.warn(`[deviceModel] 落盘 Profile 值非法：${JSON.stringify(v)} → 回落 ${DEFAULT_DEVICE_PROFILE}`);
  } catch (e) {
    // ★ 不再静默：读盘失败会让 Pro 用户静默降级成基础版（ECG/血压/血糖入口全消失），
    //   必须在日志里留痕，否则线上无法定位。
    console.warn('[deviceModel] 读取 Profile 失败，回落安全默认：', e);
  }
  return DEFAULT_DEVICE_PROFILE;
}
```

---

### 🟡 #8 · `readDeviceInformation()` 静默吞错 → 老固件未实现原生方法时无任何线索

**文件**：`src/config/deviceModel.ts`
**行号**：320-333

```ts
export async function readDeviceInformation(): Promise<DeviceInformation | null> {
  try {
    if (!VeepooNative || typeof VeepooNative.readDeviceInformation !== 'function') return null;
    const raw = await VeepooNative.readDeviceInformation();
    if (!raw) return null;
    return {
      modelNumber: raw.modelNumber ?? raw.model_number ?? raw.model ?? null,
      firmware: raw.firmware ?? raw.firmwareRevision ?? null,
      serialNumber: raw.serialNumber ?? raw.serial_number ?? null,
    };
  } catch {
    return null;
  }
}
```

**问题**：两种完全不同的失败被合并成同一个 `null`，**都不留日志**：
- 「原生没有这个方法」（老固件 / Android 未实现）→ 属预期；
- 「原生方法抛异常」（真机通信失败）→ 属故障。

调用方 `applyProfileFromDis`（`:373-385`）拿到 null 后 `return null`，**上层完全无法区分「设备不支持」与「读取失败」**。这让「连上 Pro 设备却识别成基础版」这类问题**永远无法自证**。

**建议修改后代码**（`src/config/deviceModel.ts`，替换 320-333 行）：

```ts
export async function readDeviceInformation(): Promise<DeviceInformation | null> {
  try {
    if (!VeepooNative || typeof VeepooNative.readDeviceInformation !== 'function') {
      // 老固件 / Android 未实现 → 属预期路径，但留一行日志方便区分「未实现」与「读取失败」
      console.info('[deviceModel] 原生未实现 readDeviceInformation（老固件 / Android），跳过型号读取');
      return null;
    }
    const raw = await VeepooNative.readDeviceInformation();
    if (!raw) {
      console.warn('[deviceModel] readDeviceInformation 返回空');
      return null;
    }
    return {
      modelNumber: raw.modelNumber ?? raw.model_number ?? raw.model ?? null,
      firmware: raw.firmware ?? raw.firmwareRevision ?? null,
      serialNumber: raw.serialNumber ?? raw.serial_number ?? null,
    };
  } catch (e) {
    // ★ 读取失败 ≠ 设备不支持：必须留痕，否则「Pro 被识别成基础版」无法定位。
    console.warn('[deviceModel] readDeviceInformation 调用失败：', e);
    return null;
  }
}
```

---

### 🟡 #9 · 固件能力屏蔽机制 `FIRMWARE_BUG_SHIELDS` / `getEffectiveFeatures()` 在生产代码中**完全未被调用**

**文件**：`src/config/deviceModel.ts`
**行号**：284-300

```ts
export const FIRMWARE_BUG_SHIELDS: Record<string, ProFeature[]> = {
  // '00.12.09-2526': ['ecg'], // 示例：该固件 ECG 异常，临时屏蔽（修复后删除此行）
};

/** 叠加固件屏蔽后的有效能力（前端实际应使用的 features） */
export function getEffectiveFeatures(profile: DeviceProfile, firmware: string | null | undefined): DeviceCapabilities {
  const shield = firmware ? FIRMWARE_BUG_SHIELDS[firmware] : undefined;
  if (!shield || shield.length === 0) return profile.features;
  const out: DeviceCapabilities = { ...profile.features };
  for (const f of shield) out[f] = false;
  return out;
}
```

**问题**：全局搜索确认，`getEffectiveFeatures` **只被 `src/components/ProfileAwareHome.example.tsx` 引用，而该文件未被任何地方 import**（死代码）。生产代码里所有 `hasCap(profile, feature)` 调用**全部直接读 `profile.features`，绕过了固件屏蔽**。

**后果**：一旦按注释示例填入 `'00.12.09-2526': ['ecg']`，**实际不会生效** —— 该固件的 ECG 入口照样展示、照样能被点开卡死。这是一颗「看起来有保护、实际没有」的定时炸弹。

**建议修改后代码**（`src/config/deviceModel.ts`，替换 271-279 行，把固件屏蔽接进统一出口）：

```ts
/** 能力判断统一出口：入口处一句 `hasCap(profile, 'ecg')`。
 *  ★ 注意：固件屏蔽（getEffectiveFeatures）必须在这里生效，
 *    否则 FIRMWARE_BUG_SHIELDS 只是注释里的假保护（当前生产代码从未调用它）。 */
export function hasCap(
  profile: DeviceProfile,
  feature: ProFeature,
  firmware?: string | null,
): boolean {
  const features = getEffectiveFeatures(profile, firmware);
  return features[feature] === true;
}
```

> 并把 `getEffectiveFeatures` 的实现调整为「始终返回副本」，避免调用方误改原对象：

```ts
export function getEffectiveFeatures(profile: DeviceProfile, firmware: string | null | undefined): DeviceCapabilities {
  const out: DeviceCapabilities = { ...profile.features };
  const shield = firmware ? FIRMWARE_BUG_SHIELDS[firmware] : undefined;
  if (shield && shield.length > 0) {
    for (const f of shield) out[f] = false;
  }
  return out;
}
```

> 同时在 `src/config/deviceModel.ts` 的 `DeviceProfile` 上补充固件透传能力（若当前类型没有 `firmware` 字段，可在 `useDeviceModel()` 中一并返回固件）：

```ts
export function useDeviceModel(): {
  model: DeviceProfile;
  firmware: string | null;
  setModelId: (id: DeviceProfileId) => Promise<void>;
} {
  // …现有逻辑不变…
  return { model: getProfile(id), firmware, setModelId };
}
```

---

### 🟡 #10 · `triggerOxygenAnalysis()` / `readRrAnalysis()` 静默吞错 → UI 永远停在「暂无数据」，用户无法区分「设备不支持」与「读取失败」

**文件**：`src/ble/RingBleManager.ts`
**行号**：2844-2850（另见 3361-3365）

```ts
  async triggerOxygenAnalysis(): Promise<void> {
    try { await VeepooNative?.triggerOxygenAnalysis?.(); } catch { /* 静默 */ }
  }
  async readRrAnalysis(): Promise<void> {
    try { await VeepooNative?.readRrAnalysis?.(); } catch { /* 静默 */ }
  }
```

**问题**：这两个是 `OxygenApneaSection.tsx:37` 与 `MetricDetailScreen.tsx:2644` 的 `reload()` 唯一依赖。吞错后：
- `OxygenApneaSection` 的空态恒为「当天暂无血氧数据，请先佩戴一段时间或测量血氧后再查看。」—— **失败与「确实没数据」文案完全一样**；
- `HrvLorenzSection` 同理（「当天暂无 RR 间期数据」）；
- 且 `RingBleManager.ts:1806 / 1826` 的事件处理 catch 也会把 state 置为 null（`:1783` `push({ oxygenAnalysis: null })`），**错误原因同样被吞**。

Android 端更彻底：`VeepooRingModule.kt:367-375` 的 `triggerOxygenAnalysis()` / `readRrAnalysis()` **只打日志、没有任何实现** → Android 上这两页**永远是空态**。

**建议修改后代码**（`src/ble/RingBleManager.ts`，替换 2843-2850 行）：

```ts
  /** ★ 2026-10-16：触发呼吸暂停（OSAHS）分析——原生读设备血氧历史 → VPOxygenAnalysisModel 解析。结果经 onOxygenAnalysis 事件写入 RingState.oxygenAnalysis。
   *  ★ v18.134（双硬件容错）：不再静默吞错。失败原因写入 state，
   *    由 UI（OxygenApneaSection / HrvLorenzSection）显示「读取失败」，
   *    否则用户看到的永远是「暂无数据」，无法区分「设备不支持」与「读取失败」。 */
  async triggerOxygenAnalysis(): Promise<void> {
    try {
      await VeepooNative?.triggerOxygenAnalysis?.();
    } catch (e) {
      postLog('O2-ANALYSIS', ` ❌ 触发失败：${e}`);
      this.push({ oxygenAnalysisError: '血氧历史读取失败，请确认戒指已连接并佩戴' } as any);
    }
  }
  /** ★ 2026-10-16：触发 HRV Lorenz 散点读取——原生读 RR 间期历史 → Lorenz 散点。结果经 onRrAnalysis 事件写入 RingState.rrAnalysis。 */
  async readRrAnalysis(): Promise<void> {
    try {
      await VeepooNative?.readRrAnalysis?.();
    } catch (e) {
      postLog('RR-ANALYSIS', ` ❌ 读取失败：${e}`);
      this.push({ rrAnalysisError: 'RR 间期历史读取失败，请确认戒指已连接并佩戴' } as any);
    }
  }
```

> 并在 `src/ble/RingBleManager.ts` 的 `RingState` 中补两个字段（`:397` 附近）：

```ts
  oxygenAnalysis: OxygenAnalysis | null;
  /** ★ v18.134：读取失败原因（区别于「暂无数据」），供 UI 展示 */
  oxygenAnalysisError: string | null;
  rrAnalysis: RrAnalysis | null;
  /** ★ v18.134：读取失败原因（区别于「暂无数据」），供 UI 展示 */
  rrAnalysisError: string | null;
```

> 并在初始 state（`:3299-3300`）补默认值：

```ts
    oxygenAnalysis: null,
    oxygenAnalysisError: null,
    rrAnalysis: null,
    rrAnalysisError: null,
```

> UI 侧 `src/components/OxygenApneaSection.tsx` 的空态分支改为区分「失败」与「无数据」：

```tsx
      {!a && !loading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {ring.oxygenAnalysisError ?? '当天暂无血氧数据，请先佩戴一段时间或测量血氧后再查看。'}
          </Text>
        </View>
      ) : !a && loading ? (
```

---

### 🟡 #11 · `handleOxygenAnalysis` / `handleRrAnalysis` 的 catch 静默吞错 → 解析失败时 state 保持旧值且无日志

**文件**：`src/ble/RingBleManager.ts`
**行号**：1806、1826

```ts
      this.push({ oxygenAnalysis: analysis });
    } catch { /* 单事件失败不中断 */ }
```

```ts
      this.push({ rrAnalysis: { rr, lorentz, ts: num(raw.ts) ?? Date.now() } });
    } catch { /* 单事件失败不中断 */ }
```

**问题**：「不中断」是对的（单次事件失败不该崩掉 BLE 状态机），但**完全不留痕**：解析失败时用户看到的是「暂无数据」，开发者也无法判断是「原生没发」还是「解析炸了」。对比同文件 `:1804` / `:1824` 成功路径都有 `postLog`，失败路径一条都没有。

**建议修改后代码**（`src/ble/RingBleManager.ts`，替换 1805-1806 与 1825-1826 行）：

```ts
      this.push({ oxygenAnalysis: analysis, oxygenAnalysisError: null });
    } catch (e) {
      // ★ v18.134：单事件失败不中断 BLE 状态机，但必须留痕 —— 否则用户看到「暂无数据」，
      //   开发者无法区分「原生没发」与「解析炸了」。
      postLog('O2-ANALYSIS', ` ❌ 解析失败：${e}`);
      this.push({ oxygenAnalysisError: '血氧分析数据解析失败' } as any);
    }
```

```ts
      this.push({ rrAnalysis: { rr, lorentz, ts: num(raw.ts) ?? Date.now() }, rrAnalysisError: null });
    } catch (e) {
      postLog('RR-ANALYSIS', ` ❌ 解析失败：${e}`);
      this.push({ rrAnalysisError: 'RR 间期数据解析失败' } as any);
    }
```

---

### 🟡 #12 · `applyProfileFromDevice(...).catch(() => {})` 完全静默 → 机型识别失败无日志

**文件**：`src/ble/RingBleManager.ts`
**行号**：1429-1437

```ts
        void applyProfileFromDevice({
          capabilities: raw.capabilities,
          deviceName: this.getState().deviceName,
          deviceId: this.getState().deviceId,
        })
          .then((p) => {
            if (p) postLog('RingBle', `[DeviceProfile] 真机识别 → 应用 ${p}（ecgType=${raw.capabilities?.ecgType}，mac=${this.getState().deviceId}）`);
          })
          .catch(() => {});
```

**问题**：`.catch(() => {})` 吞掉一切。`applyProfileFromDevice` 内部会调 `persistProfile` → `Prefs.setItem` → `FileSystem.writeAsStringAsync`（`src/utils/prefs.ts:27-30`，**该处没有 try/catch**）→ **写盘失败会真的抛**。一旦抛错：机型识别结果**没有落盘**，下次启动读回旧档位；而且**日志里什么都没有**，无法定位。

**建议修改后代码**（`src/ble/RingBleManager.ts`，替换 1429-1438 行）：

```ts
      if (raw.capabilities || this.getState().deviceId || this.getState().deviceName) {
        void applyProfileFromDevice({
          capabilities: raw.capabilities,
          deviceName: this.getState().deviceName,
          deviceId: this.getState().deviceId,
        })
          .then((p) => {
            if (p) postLog('RingBle', `[DeviceProfile] 真机识别 → 应用 ${p}（ecgType=${raw.capabilities?.ecgType}，mac=${this.getState().deviceId}）`);
            else postLog('RingBle', `[DeviceProfile] 真机识别失败：caps=${JSON.stringify(raw.capabilities)} mac=${this.getState().deviceId} name=${this.getState().deviceName}`);
          })
          .catch((e) => {
            // ★ v18.134：机型识别失败必须留痕。
            //   persistProfile → Prefs.setItem → writeAsStringAsync 没有 try/catch，写盘失败会真的抛；
            //   静默吞掉的话「Pro 被识别成基础版」这类问题在线上完全无法定位。
            postLog('RingBle', `[DeviceProfile] 真机识别异常（机型可能未持久化）：${e}`);
          });
      }
```

> 配套：`src/utils/prefs.ts:27-30` 的 `setItem` 也应自行兜底，避免写盘失败把异常抛到上层：

```ts
export async function setItem(key: string, value: string): Promise<void> {
  await ensureDir();
  try {
    await FileSystem.writeAsStringAsync(DIR + key, value);
  } catch (e) {
    // 写盘失败不阻塞调用方（调用方通常已有 catch），但必须留痕
    console.warn(`[prefs] 写入 ${key} 失败：`, e);
  }
}
```

---

### 🟡 #13 · connected 分支的 `applyProfileFromDevice` 未挂 `.catch` → 可能产生 unhandled rejection

**文件**：`src/ble/RingBleManager.ts`
**行号**：1490-1492

```ts
    if (status === 'connected' && (raw.deviceName || raw.deviceAddress)) {
      // ★ 2026-11-05（用户：连上戒指就识别 Pro/基础版）：用 MAC + 广播名做真机识别（能力字段在 ready 分支补充）。
      void applyProfileFromDevice({ deviceName: raw.deviceName, deviceId: raw.deviceAddress });
    }
```

**问题**：`void` 只标记「不 await」，**不会**吞掉 rejection。此处**没有 `.catch`**，而 `applyProfileFromDevice` → `persistProfile` → `Prefs.setItem` → `writeAsStringAsync` 是会抛的（见 🟡 #12）。→ **unhandled promise rejection**。在 React Native / Metro 环境下这会触发全局红屏或至少污染日志。

**建议修改后代码**（`src/ble/RingBleManager.ts`，替换 1490-1493 行）：

```ts
    if (status === 'connected' && (raw.deviceName || raw.deviceAddress)) {
      // ★ 2026-11-05（用户：连上戒指就识别 Pro/基础版）：用 MAC + 广播名做真机识别（能力字段在 ready 分支补充）。
      // ★ v18.134：必须挂 .catch —— void 只标记不 await，不会吞 rejection；
      //   persistProfile 写盘失败会真的抛 → 变成 unhandled rejection。
      void applyProfileFromDevice({ deviceName: raw.deviceName, deviceId: raw.deviceAddress }).catch((e) => {
        postLog('RingBle', `[DeviceProfile] connected 分支识别异常：${e}`);
      });
    }
```

---

### 🟡 #14 · `OxygenApneaSection` 的 `aveOxygen` / `minOxygen` 为 0 时显示 `—` 且**无提示文案**（与 `aveRespRate` 等已修风格不一致）

**文件**：`src/components/OxygenApneaSection.tsx`
**行号**：54-62

```tsx
          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均血氧</Text>
              <Text style={[styles.statValue, { color: mm.colors.skyDeep }]}>{a.aveOxygen || '—'}<Text style={styles.statLabel}> %</Text></Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低血氧</Text>
              <Text style={[styles.statValue, { color: a.minOxygen > 0 && a.minOxygen < 90 ? mm.colors.roseMid : theme.colors.textTitle }]}>{a.minOxygen || '—'}<Text style={styles.statLabel}> %</Text></Text>
            </View>
```

**问题（题目第 3 项「验证无遗漏」的结论）**：
- `aveRespRate`（`:73-74`）、`aveLowOxygenTime`（`:78-79`）、`aveCardiacLoad`（`:83-84`）**已按 `'--'` + `statHint`「需全天血氧监测数据」修好** ✅；
- 但 **`aveOxygen`（`:57`）与 `minOxygen`（`:61`）漏了**。这两项为 0 时同样只显示一个 `—`，**没有任何说明** → 用户无法区分「设备不支持血氧分析」「今天还没数据」「数据异常为 0」。

另外 `a.aveOxygen || '—'` 用的是 `||` 而非 `??`：**合法值 0 会被当成缺失**（虽然 0% 血氧在生理上无意义，但语义上 `0` 与 `undefined` 应当分开处理）。

**建议修改后代码**（`src/components/OxygenApneaSection.tsx`，替换 54-66 行）：

```tsx
          <View style={[styles.statGrid, { marginTop: theme.sp(2) }]}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>平均血氧</Text>
              <Text style={[styles.statValue, { color: mm.colors.skyDeep }]}>
                {a.aveOxygen > 0 ? a.aveOxygen : '—'}<Text style={styles.statLabel}> %</Text>
              </Text>
              {!a.aveOxygen ? <Text style={styles.statHint}>需全天血氧监测数据</Text> : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>最低血氧</Text>
              <Text style={[styles.statValue, { color: a.minOxygen > 0 && a.minOxygen < 90 ? mm.colors.roseMid : theme.colors.textTitle }]}>
                {a.minOxygen > 0 ? a.minOxygen : '—'}<Text style={styles.statLabel}> %</Text>
              </Text>
              {!a.minOxygen ? <Text style={styles.statHint}>需全天血氧监测数据</Text> : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>呼吸暂停</Text>
              <Text style={[styles.statValue, { color: osahs?.color, fontSize: theme.fontSize.body }]}>{osahs?.label ?? '—'}</Text>
            </View>
          </View>
```

---

### 🟡 #15 · `ecgHistory` 不恢复 + `ring.ecg` 恢复 → 「历史测量 N 次」与详情页自相矛盾

**文件**：`src/screens/EcgDetailScreen.tsx`
**行号**：205-206、364

```tsx
  const history = ring.ecgHistory ?? [];
  const latest = history.length > 0 ? history[0] : null;
```

```tsx
        <Text style={styles.sectionTitle}>历史测量 · {history.length} 次</Text>
```

**问题**：与 🔴 #5 同源，但聚焦 UI 表现。冷启动后：
- `ring.ecgHistory` **未被恢复**（`RingBleManager.ts:5994-5995` 只恢复 `ecg` / `ecgDaily`）→ `history.length === 0` → 标题显示 **「历史测量 · 0 次」**，页面显示「还没有心电图测量记录。」；
- 但同一时刻 `MetricDetailScreen.tsx:1847` 通过 `ring.ecg`（已恢复）**照常渲染心电图波形和 5 项派生指标**。

→ **用户在两个页面看到互相矛盾的事实**，且 `EcgDetailScreen` 的「最新一次」区块（`:248-254`）因为 `latest === null` 而整块消失，与 `EcgCard` 里显示的「已测」状态也矛盾。

**建议修改后代码**（修复方式见 🔴 #5 的 (b)(c) 段，此处补 UI 兜底）：

`src/screens/EcgDetailScreen.tsx`，替换 205-208 行：

```tsx
  const history = ring.ecgHistory ?? [];
  const latest = history.length > 0 ? history[0] : (ring.ecg ?? null);
  // ★ v18.134：ecgHistory 冷启动不恢复（见审计 🔴 #5）时，至少用 ring.ecg 兜底，
  //   否则本页显示「历史测量 · 0 次 / 还没有记录」，而 MetricDetailScreen 却能读到 ring.ecg —— 两页自相矛盾。
  const a: EcgAnalysis | undefined = latest?.analysis;
```

> 并同步修正标题的计数口径（避免「0 次」误导）：

```tsx
        <Text style={styles.sectionTitle}>历史测量 · {history.length || (ring.ecg ? 1 : 0)} 次</Text>
```

---

### 🟡 #16 · `handleEcg` 解析失败静默吞错，**且不写 `ecgError`** → UI 卡在「测量中」直到 120s 超时

**文件**：`src/ble/RingBleManager.ts`
**行号**：1738-1740

```ts
    } catch {
      /* ECG 解析失败静默 */
    }
```

**问题**：对比同文件其它解析路径：`handleEcgProgress`（`:1749-1753`）在收到 `raw.error` 时会 `push({ ecgProgress: null, ecgLiveWaveform: null, ecgError: raw.error })`，**UI 有明确的失败原因**。但 `handleEcg` 抛异常时**什么都不写**：
- `ecgProgress` 保持原值 → `EcgCard.tsx:53-54` 的 `isMeasuring` 恒为 true → 按钮永远显示「测量中 N%」；
- `ecgError` 为 null → `EcgCard.tsx:238-242` 的常驻错误块不显示；
- 用户唯一出路是等 `EcgCard.tsx:76-85` 的 120 秒超时 Alert。

**这就是「基础版/异常固件下 ECG 测量必然失败且反馈极慢」的第二个来源**（第一个来源是 🔴 #2 的入口未拦截）。

**建议修改后代码**（`src/ble/RingBleManager.ts`，替换 1738-1740 行）：

```ts
    } catch (e) {
      // ★ v18.134：ECG 解析失败必须写 ecgError 并清进度，
      //   否则 UI 会一直停在「测量中 N%」，用户只能等 120s 超时才知道失败。
      //   对齐 handleEcgProgress 的失败处理口径（:1749-1753）。
      postLog('RingBle', `[handleEcg] ❌ 解析失败：${e}`);
      this._ecgLiveBuf = [];
      this.push({
        ecgProgress: null,
        ecgLiveWaveform: null,
        ecgError: '心电图数据解析失败，请重新测量',
      });
    }
```

---

## 8. 🔵 Medium 问题（8 个）

### 🔵 #17 · `quickCheckStore` 静默吞错 → 体检报告里身体成分整项消失且无解释

**文件**：`src/data/quickCheckStore.ts`
**行号**：307-316

```ts
  try {
    const session = await userStore.loadSession();
    const p = session.profile;
    if (p && typeof p.height === 'number' && typeof p.weight === 'number' && p.height > 0 && p.weight > 0) {
      const age = typeof p.age === 'number' && p.age > 0 ? p.age : 30;
      const sex: 'female' | 'male' = p.gender === 'male' ? 'male' : 'female';
      bodyMetrics = computeBodyComposition({ weight: p.weight, height: p.height, age, sex });
      bodyNote = `按你首次填写的身高 ${p.height}cm / 体重 ${p.weight}kg${typeof p.age !== 'number' ? '（年龄未填，按 30 岁估算）' : ''}推算，非戒指测量。`;
    }
  } catch { /* 档案读取失败 → 不展示身体成分，不编数字 */ }
```

**问题**：注释写的是对的（「不编数字」是正确取舍），但**「档案读取失败」与「用户从未填过身高体重」在 UI 上完全一样** —— 体检报告里身体成分整项凭空消失，用户不知道是自己没填还是 App 读失败了。

**建议修改后代码**（`src/data/quickCheckStore.ts`，替换 307-316 行）：

```ts
  try {
    const session = await userStore.loadSession();
    const p = session.profile;
    if (p && typeof p.height === 'number' && typeof p.weight === 'number' && p.height > 0 && p.weight > 0) {
      const age = typeof p.age === 'number' && p.age > 0 ? p.age : 30;
      const sex: 'female' | 'male' = p.gender === 'male' ? 'male' : 'female';
      bodyMetrics = computeBodyComposition({ weight: p.weight, height: p.height, age, sex });
      bodyNote = `按你首次填写的身高 ${p.height}cm / 体重 ${p.weight}kg${typeof p.age !== 'number' ? '（年龄未填，按 30 岁估算）' : ''}推算，非戒指测量。`;
    } else {
      bodyNote = '填写身高体重后可推算身体成分（当前戒指不支持实测）。';
    }
  } catch (e) {
    // ★ v18.134：读取失败与「未填写」必须区分 —— 否则用户看到身体成分凭空消失却不知原因。
    console.warn('[quickCheckStore] 读取用户档案失败：', e);
    bodyNote = '身体成分档案读取失败，可稍后重试或检查设置。';
  }
```

---

### 🔵 #18 · `overallScoreFromReport` 的 `catch { return null; }` → 综合分恒 null，弧长退化为 0

**文件**：`src/screens/InsightScreen.tsx`
**行号**：277-289

```ts
  const overallScoreFromReport = useMemo(() => {
    try {
      const fatigue = computeCognitiveLoadReport();
      const stress = computeStressReport();
      const sleep = ring.daily['sleepScore'];
      const scores: number[] = [];
      ...
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a,b) => a+b,0) / scores.length);
    } catch { return null; }
  }, [ring]);
```

**问题**：抛异常与「数据不足」返回同一个 `null`。`:320-322` 的 `longTermLabel` 会显示「数据不足」，但**无法区分是算法异常还是真的没数据**。且 `overallScoreFromReport` 还被 `:695` 用作 `overallScore` 兜底 → 异常时弧长直接为 0。

**建议修改后代码**（`src/screens/InsightScreen.tsx`，替换 277-289 行）：

```ts
  const overallScoreFromReport = useMemo(() => {
    try {
      const fatigue = computeCognitiveLoadReport();
      const stress = computeStressReport();
      const sleep = ring.daily['sleepScore'];
      const scores: number[] = [];
      if (fatigue?.sampleCount > 0 && fatigue.loadScore != null && Number.isFinite(fatigue.loadScore)) scores.push(100 - fatigue.loadScore * 0.6);
      if (stress?.sampleCount > 0 && stress.emotionalLoad != null && Number.isFinite(stress.emotionalLoad)) scores.push(100 - stress.emotionalLoad * 0.5);
      if (sleep != null && Number.isFinite(sleep) && sleep >= 0 && sleep <= 100) scores.push(sleep);
      if (scores.length === 0) return null;
      return Math.round(scores.reduce((a,b) => a+b,0) / scores.length);
    } catch (e) {
      // ★ v18.134：算法异常与「数据不足」区分开，前者要留痕（否则综合分恒 0、弧长退化且无人知晓）。
      console.warn('[InsightScreen] overallScoreFromReport 计算异常：', e);
      return null;
    }
  }, [ring]);
```

---

### 🔵 #19 · 皮质醇节律 `catch { /* 保持数据不足 */ }` 静默吞错 → 身体年龄文案恒「数据不足」

**文件**：`src/screens/InsightScreen.tsx`
**行号**：302-318

```ts
    try {
      const pbl = buildCortisolProxyBaseline(14);
      const _usedDays = pbl.daysUsed;
      const _recentDk = _usedDays.length ? _usedDays[_usedDays.length - 1] : null;
      const _recentMs = _recentDk ? new Date(`${_recentDk}T00:00:00`).getTime() : Date.now();
      const px = buildCortisolProxyToday(pbl, { now: _recentMs });
      const j = judgeCortisolRhythm(px.vals, px.real);
      if (j.label) {
        hormonalHealthy = j.label === '节律正常';
        hormonalLabel = j.label === '节律紊乱' ? '节律紊乱' : j.label === '皮质醇偏高' ? '持续偏高' : '节律平稳';
      }
    } catch { /* 保持数据不足 */ }
```

**问题**：基础版没有实测皮质醇（`BASE_UI.cortisol = false`），「数据不足」本身是**预期结果**；但 `buildCortisolProxyBaseline` / `judgeCortisolRhythm` 抛异常时也是同一个结果 —— **算法坏了和硬件没有，用户看到的文案一模一样**，且无日志。

**建议修改后代码**（`src/screens/InsightScreen.tsx`，替换 318 行）：

```ts
    } catch (e) {
      // ★ v18.134：基础版无实测皮质醇 → 「数据不足」是预期；
      //   但算法异常同样是「数据不足」，必须留痕以区分「硬件没有」与「算崩了」。
      console.warn('[InsightScreen] 皮质醇节律构建异常：', e);
      hormonalLabel = '数据不足';
    }
```

---

### 🔵 #20 · `InsightScreen` 的 `EcgReadout` 是死代码，且能力判定逻辑写成「caps 为 null 即支持」

**文件**：`src/screens/InsightScreen.tsx`
**行号**：1377-1391

```tsx
function EcgReadout({ ring }: { ring: RingState }) {
  const reading = ring.ecg;
  const progress = ring.ecgProgress;
  const caps = ring.deviceCapabilities;
  const ecgSupported = !caps || caps.ecgType > 0;
  const isMeasuring = progress != null;
```

**问题**：
1. **`EcgReadout` 在当前 `InsightScreen.tsx` 中已无任何渲染点** —— 实际渲染的是 `EcgCard`（`:791`）。`EcgReadout` 仅在 `InsightScreen.tsx.bak` / `.bak2` 里被使用。→ **死代码**。
2. 判定逻辑 `!caps || caps.ecgType > 0` 意为「**caps 为 null → 判支持**」。结合 🔴 #2（caps 恒为 null）→ 该判定**永远返回 true**，即使被启用也起不到门禁作用。
3. 这段代码的存在会**误导后续开发者**以为「ECG 不支持」的提示逻辑已经存在。

**建议修改后代码**（`src/screens/InsightScreen.tsx`）：

**方案 A（推荐）**：删除死代码 `EcgReadout`（`:1376-1443` 整段）。当前页面已由 `EcgCard` 承担 ECG 展示，`EcgCard` 的门禁按 🔴 #2 修好即可。

**方案 B（若要保留）**：把判定改成机型档位优先，并明确 `undefined` 为未知：

```tsx
function EcgReadout({ ring }: { ring: RingState }) {
  const reading = ring.ecg;
  const progress = ring.ecgProgress;
  const { model: dmModel } = useDeviceModel();
  // ★ 机型档位才是权威；deviceCapabilities 目前恒为 null（审计 🔴 #2），
  //   不能用 `!caps || ...` 这种「null 即支持」的判定。
  const ecgSupported = hasCap(dmModel, 'ecg');
  const isMeasuring = progress != null;
```

---

### 🔵 #21 · `healthAgeCurrent` 的两处 catch 静默吞错，且 `hasHormonalData` 被硬编码为 `true`

**文件**：`src/lib/healthAgeCurrent.ts`
**行号**：36-38、64-66（另见 `:62`）

```ts
  } catch {
    return false;
  }
```

```ts
  } catch {
    return null;
  }
```

```ts
    const healthAge = estimateHealthAge(actualAge, overallScore, hormonalHealthy, true);
```

**问题**：
1. `:36-38` `computeHormonalHealthyCurrent` 异常 → 恒 `false`；`:64-66` `computeCurrentHealthAge` 异常 → 恒 `null`。**两处都无日志**，异常不可观测。
2. `:62` 的第四个参数 `hasHormonalData` **硬编码为 `true`**。但基础版**没有实测皮质醇** → `hormonalHealthy` 恒为 `false`（不是「测了但不健康」，而是「根本没测」）→ `estimateHealthAge` 会按「荷尔蒙失衡 → 偏老」计算，与 `healthAgeEstimate.ts` 设计的「`hasHormonalData=false` 时走中性 ±1.5」**设计意图相悖**。

**建议修改后代码**（`src/lib/healthAgeCurrent.ts`，替换 26-39 行与 47-67 行）：

```ts
/** 当日皮质醇节律是否健康（与详情页同源）：≥4 个有效实测槽才判定，否则 false
 *  ★ v18.134：新增「是否有实测数据」出口 —— 基础版没有皮质醇实测通道，
 *    「没测」和「测了不健康」必须区分，否则身体年龄会被当成荷尔蒙失衡而偏老。 */
export function computeHormonalHealthyCurrent(dk: string = dayKey(Date.now())): {
  hormonalHealthy: boolean;
  hasHormonalData: boolean;
} {
  try {
    const samples: CortisolSample[] = healthStore
      .getIntraday('cortisol', dk)
      .filter((p: any) => typeof p.v === 'number' && Number.isFinite(p.v) && p.v > 0)
      .map((p: any, i: number) => ({ t: Number.isFinite(p.t) ? p.t : i * 3600 * 1000, v: p.v }));
    if (samples.length < 4) return { hormonalHealthy: false, hasHormonalData: false };
    const a = analyzeCortisol(samples) as any;
    return { hormonalHealthy: a?.status?.level === 'normal', hasHormonalData: true };
  } catch (e) {
    // ★ v18.134：异常必须留痕 —— 否则「算崩了」与「没数据」在 UI 上完全一致。
    console.warn('[healthAgeCurrent] 皮质醇节律计算异常：', e);
    return { hormonalHealthy: false, hasHormonalData: false };
  }
}
```

```ts
  try {
    const fatigue = computeCognitiveLoadReport();
    const stress = computeStressReport();
    const sleep = RingBle.getState()?.daily?.['sleepScore'];
    const scores: number[] = [];
    if (fatigue?.sampleCount > 0 && fatigue.loadScore != null && Number.isFinite(fatigue.loadScore)) {
      scores.push(100 - fatigue.loadScore * 0.6);
    }
    if (stress?.sampleCount > 0 && stress.emotionalLoad != null && Number.isFinite(stress.emotionalLoad)) {
      scores.push(100 - stress.emotionalLoad * 0.5);
    }
    if (sleep != null && Number.isFinite(sleep) && sleep >= 0 && sleep <= 100) scores.push(sleep);
    if (scores.length === 0) return null;
    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const { hormonalHealthy, hasHormonalData } = computeHormonalHealthyCurrent(dayKey(Date.now()));
    // ★ hasHormonalData 不再硬编码 true：基础版没有皮质醇实测通道时走「中性 ±1.5」，
    //   不会被误判成「荷尔蒙失衡 → 偏老」。
    const healthAge = estimateHealthAge(actualAge, overallScore, hormonalHealthy, hasHormonalData);
    return { healthAge, overallScore };
  } catch (e) {
    console.warn('[healthAgeCurrent] 身体年龄计算异常：', e);
    return null;
  }
```

> ⚠️ 兼容性提示：`computeHormonalHealthyCurrent` 的返回类型从 `boolean` 变为对象，**需同步检查所有调用点**（本次审查已确认 `src/lib/healthAgeCurrent.ts` 内 `computeCurrentHealthAge` 与 `src/screens/HealthAgeDetailScreen.tsx` 均有使用，需一并改）。

---

### 🔵 #22 · `LEGACY_HISTORY_BLOCKED_KEYS` 是硬编码常量，新增指标时容易漏加 → 旧设备脏值可能重新混入

**文件**：`src/data/ringDataIsolation.ts`
**行号**：86-88

```ts
export const LEGACY_HISTORY_BLOCKED_KEYS: readonly string[] = [
  'temp', 'skinTemp', 'eda', 'skin',
];
```

**问题**：这份黑名单是**手写常量**，与 `src/config/deviceModel.ts` 的 `BASE_NATIVE_METRICS`（`proOnly` 自动派生）**没有联动**。将来新增一个 Pro 专属指标（如 `bloodGlucose`）并把它写进 `BASIC_EXTRA_SIGNALS`，若忘记同步加进这个黑名单，**HK18 时期写入的该指标历史值就会重新混入基础版展示** —— 这正是 39℃ 体温脏值事故的成因（见本文件头部注释 82-85 行）。

**建议修改后代码**（`src/data/ringDataIsolation.ts`，替换 86-88 行）：

```ts
/**
 * 基础版禁止回退到本机 healthStore 历史归档的指标。
 * healthStore 里混着 HK18 时期写入的 temp / skinTemp / eda 值（详情页曾显示 39℃），
 * 与当前戒指无关。这些指标只允许用 ring.metrics / ring.daily 的当前戒指日值。
 *
 * ★ v18.134：改为**从 deviceModel 的 BASE_NATIVE_METRICS 自动派生**，
 *   避免以后新增 Pro 专属指标时漏加黑名单（39℃ 体温脏值事故的根因）。
 */
export const LEGACY_HISTORY_BLOCKED_KEYS: readonly string[] = (() => {
  // 显式保留的历史键（协议语义上属于「只此一路、别处兜底」）
  const manual = ['temp', 'skinTemp', 'eda', 'skin'] as const;
  // 基础版原生不支持的指标（nativeMetrics 里没有）全部拉黑
  const auto = ALL_NATIVE_METRIC_KEYS.filter((k) => !BASE_NATIVE_METRICS.includes(k));
  return Array.from(new Set<string>([...manual, ...auto]));
})();
```

> 需要在 `src/data/ringDataIsolation.ts` 顶部补 import（若 `deviceModel.ts` 尚未导出这两个符号）：

```ts
import { ALL_NATIVE_METRIC_KEYS } from '../config/metricCatalog';
import { BASE_NATIVE_METRICS } from '../config/deviceModel';
```

---

### 🔵 #23 · `ProfileAwareHome.example.tsx` 是未被引用的示例文件，却引用了「看起来已生效」的 `getEffectiveFeatures` / `hasMetric`

**文件**：`src/components/ProfileAwareHome.example.tsx`
**行号**：18、31

```tsx
  const { model, setModelId } = useDeviceModel();
  ...
      {hasCap(model, 'ecg') && (
```

**问题**：全局搜索确认**该文件未被任何地方 import**（`ProfileAwareHome` 只在文件自身出现一次）。它是**死代码**，但会：
1. 让开发者误以为「固件屏蔽 / 指标门禁」已在生产链路生效（实际只有 `getEffectiveFeatures` 在这里被调用，见 🟡 #9）；
2. `hasMetric` 在生产代码中同样**从未被调用**（`hasMetric` 的门禁效果未落地到任何 UI）。

**建议修改后代码**：二选一。

**方案 A（推荐）**：删除该示例文件（`src/components/ProfileAwareHome.example.tsx`），并在 `src/config/deviceModel.ts` 的 `getEffectiveFeatures` 上加注释说明「生产链路请用 `hasCap(profile, feature, firmware)`」。

**方案 B（若要保留作参考）**：在文件头加显著警告，避免被误当作生效实现：

```tsx
/**
 * ⚠️ 本文件是**示例**，未被任何地方 import（生产代码不经过这里）。
 *    生产链路的机型门禁统一走 src/config/deviceModel.ts 的 hasCap(profile, feature, firmware)。
 *    getEffectiveFeatures / hasMetric 的固件屏蔽与指标白名单请以 deviceModel.ts 为准。
 *    （参见 docs/audit/03-hardware-tolerance.md 🔵 #23）
 */
```

---

### 🔵 #24 · Android 原生完全不透传 `capabilities` → Android 上永远无法通过能力字段识别机型

**文件**：`android/app/src/main/java/com/miraringfashion/app/veepoo/VeepooRingModule.kt`
**行号**：193（ready 分支）、36（事件契约注释）

```kotlin
                    emit("onState", JSONObject().apply { put("status", "ready") })
```

```kotlin
 *   onState     {status:'scanResult'|'connected'|'ready'|'syncing'|'error',...}
```

**问题**：iOS 端在 `onPasswordVerified` 里组装并透传 `capabilities`（`ios/VeepooRing/VeepooRing.m:508-524`），**Android 端的 `ready` 事件只有 `status`，没有任何能力字段**。同时 `measure("ecg")` / `triggerOxygenAnalysis()` / `readRrAnalysis()` 在 Android 端**只有日志、没有实现**（`:267-268`、`:367`、`:372`）。

**后果**（Android 平台）：
1. `RingBleManager.ts:1428-1438` 的 ready 分支拿到的 `raw.capabilities` 恒为 `undefined` → `resolveProfileByCapabilities(undefined)` 返回 `null`（这是**正确的**）→ 落到 MAC / 广播名判定 → **只能识别已在 `DEVICE_ID_PROFILES` 里登记过的 2 台设备**，其他 Pro 机型在 Android 上永远识别不出来。
2. `EcgCard` / `EcgDetailScreen` 在 Android 上点击 ECG → 原生只打日志 → **UI 永远卡在「测量中 0%」直到 120s 超时**（比 iOS 的失败路径还彻底）。

**建议修改后代码**（`android/app/src/main/java/com/miraringfashion/app/veepoo/VeepooRingModule.kt`，替换 193 行）：

```kotlin
                    // ★ v18.134（双硬件容错）：ready 事件必须带上硬件能力字段，
                    //   否则 JS 侧无法通过能力判定识别 Pro / 基础版（只能靠已登记的 MAC 兜底）。
                    //   capabilityJson() 需按 Veepoo SDK 的 VPPeripheralModel 实际字段实现。
                    emit("onState", JSONObject().apply {
                        put("status", "ready")
                        put("capabilities", capabilityJson())
                    })
```

> 并新增辅助方法（字段需按 Android SDK 实际 API 名称对齐）：

```kotlin
    /**
     * 组装硬件能力字段，字段名与 iOS 端 VeepooRing.m 保持一致，
     * 保证 JS 侧 resolveProfileByCapabilities / EcgCard 的门禁在两端行为一致。
     */
    private fun capabilityJson(): JSONObject {
        val caps = JSONObject()
        try {
            val pm = peripheralModel
            if (pm != null) {
                caps.put("temperatureType", pm.temperatureType)
                caps.put("gsrType", pm.gsrType)
                caps.put("ecgType", pm.ecgType)
                caps.put("bloodAnalysisType", pm.bloodAnalysisType)
                caps.put("healthGlanceType", pm.healthGlanceType)
                caps.put("bloodGlucoseType", pm.bloodGlucoseType)
                caps.put("skinType", pm.skinType)
                caps.put("deviceVersion", pm.deviceVersion ?: "")
                caps.put("deviceNumber", pm.deviceNumber)
            }
        } catch (e: Throwable) {
            android.util.Log.w("VeepooRing", "[capabilities] 读取硬件能力失败", e)
        }
        return caps
    }
```

> 同时 Android 端 `measure("ecg")` / `triggerOxygenAnalysis()` / `readRrAnalysis()` 必须**明确回报不支持**，而不是静默打日志 —— 否则 JS 侧无法区分「不支持」与「还没实现」。最小改动：

```kotlin
    fun measure(key: String) {
        log("[VeepooRing ANDROID] measure $key")
        if (key == "ecg") {
            // 本固件未开放 ECG：回一个明确的错误事件，让 UI 显示「当前设备不支持 ECG 测量」
            emit("onEcgProgress", JSONObject().apply { put("error", "当前设备不支持 ECG 测量") })
        }
    }
```

---

## 9. 已复核为安全、无需修改的点（供回归对照）

| 场景 | 位置 | 结论 |
|---|---|---|
| `capabilities` 未返回时页面初始化 | `useRingState.ts:16` + `RingBleManager.ts:3270/3291/3299-3300` | ✅ 初始即完整 `RingState`，不会崩 |
| `useDeviceModel()` 中间态 | `deviceModel.ts:529` | ✅ 初始 `DEFAULT_DEVICE_PROFILE`，无 undefined 中间态 |
| `getProfile()` 未知 id | `deviceModel.ts:268` | ✅ 有 `?? DEFAULT_DEVICE_PROFILE` 兜底 |
| `hasCap()` 未定义 feature | `deviceModel.ts:273` | ✅ 返回 false |
| `ring.rrAnalysis` 为 null | `MetricDetailScreen.tsx:2639-2657` | ✅ `r && r.lorentz.length` + `computeRrHrv` 内 `rr.length < 10` 双重守卫 |
| `EcgDetailScreen` 的 metrics 数组 | `EcgDetailScreen.tsx:212-221` | ✅ 全部 `latest?.x ?? 0` / `a?.x != null` |
| `ecgWaveformPath(undefined)` | `MetricDetailScreen.tsx:406` | ✅ `if (!values || values.length < 2) return ''` |
| 体温 `.toFixed(2)` | `MetricDetailScreen.tsx:1362-1370` | ✅ `!= null` 守卫 |
| `edaDiagnostics.medianGapMin.toFixed(1)` | `MetricDetailScreen.tsx:1913` | ✅ `!= null` 守卫 |
| BloodPanelTab `v.toFixed` | `InsightScreen.tsx:939` | ✅ `v == null ? '—'` |
| `smoothSpline` 的 `pts[0].x.toFixed(1)` | `InsightScreen.tsx:1017` | ✅ 空数组提前返回 |
| `HealthAgeCard` 的 null 处理 | `components/HealthAgeCard.tsx` | ✅ `Number.isFinite` + `?? 0` |
| 基础版血压/血糖/尿酸/胆固醇隐藏 | `quickCheckStore.ts:272-281`、`QuickCheckTab.tsx:40-42`、`InsightScreen.tsx:957-958` | ✅ `isPro && hasCap(...)` 双重门禁 |
| 基础版 EDA / 皮肤温度 / 皮质醇 / 压力 / 疲劳隐藏 | `InsightScreen.tsx:531-554`、`EmotionCard.tsx:225`、`SleepAnalysisCard.tsx:92` | ✅ `hasCap` 过滤 |
| 基础版首页 chip 收敛 | `CalmWaveHome.tsx:392-393`、`EnergyDetailScreen.tsx:99-100` | ✅ `BASE_UI` 分支 |
| 洞察页子 tab 被过滤后回落 | `InsightScreen.tsx:259` | ✅ `effSub` 回落首项，不会空屏 |
| 基础版体温脏值隔离 | `ringDataIsolation.ts:75-79` `saneBodyTemp` + `quickCheckStore.ts:258` | ✅ `34–42℃` 之外判脏 |
| 旧 HK18 设备 ID 拉黑 | `ringDataIsolation.ts:33-52` | ✅ `isBlockedRingDeviceId` |

---

## 10. 修复优先级建议

**P0（必须修，否则线上可复现故障）**
1. 🔴 #2 —— `EcgCard` 的 `ecgUnsupported` 判定（基础版点出必然超时的 ECG 测量）
2. 🔴 #5(c) —— 快照 ECG 恢复的设备隔离（**把旧戒指的心电图展示给新用户**，数据正确性问题）
3. 🔴 #1 —— `a.freqTimes.length` 守卫（白屏）
4. 🟡 #6 —— `resolveProfileByCapabilities` 空 caps 判定（**Pro 设备被永久降级**）

**P1（强烈建议，影响用户可感知的一致性）**
5. 🔴 #3 —— `EcgDetailScreen` 机型门禁 + 副标题硬编码「HK18 ECG 硬件」
6. 🔴 #4 —— ECG 派生指标 NaN 兜底
7. 🟡 #16 —— `handleEcg` 失败写 `ecgError`（否则用户等 120s）
8. 🟡 #15 —— `ecgHistory` 恢复 + UI 计数一致
9. 🟡 #14 —— `aveOxygen` / `minOxygen` 提示文案（题目第 3 项的遗漏项）

**P2（可观测性与健壮性）**
10. 🟡 #7 / #8 / #12 / #13 —— 静默吞错补日志
11. 🟡 #10 / #11 —— 读取失败与「无数据」区分
12. 🟡 #9 / 🔵 #20 / 🔵 #23 —— 固件屏蔽接线 + 死代码清理
13. 🔵 #17 / #18 / #19 / #21 / #22 —— 其余静默吞错与常量派生
14. 🔵 #24 —— Android 端 capabilities 透传

---

## 11. 审查声明

- 本次审查为**只读审查**，**未修改 `src/` 下任何文件**；本报告中的所有代码均为**建议**。
- 报告中所有行号基于审查当日（2026-11-06）的工作区状态，行号可能随其他并行改动漂移。
- 所有「文件:行」引用均已逐条回到源码核对。

---

共 23 个问题（🔴 5 / 🟡 10 / 🔵 8）
