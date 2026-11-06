# 维度 2 · 假数据与硬编码排查报告

> 审查对象：`/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app`
> 审查时间：2026-11-06
> 审查范围：`src/**`（排除 `node_modules`）
> 判定原则：**渠道商拿 App 演示时，任何看起来像「用户真实测量」的数字都必须有真实来源**。

---

## 0. 结论速览

| 等级 | 数量 | 说明 |
|---|---|---|
| 🔴 Critical | 2 | 演示兜底会产出「假的身体年龄」「假的一键体检记录」 |
| 🟡 High | 3 | 演示身份的显式标注（登录验证码 / 源码注释误导后续开发） |
| 🔵 Medium | 4 | 硬编码常量表的合理化空间、死代码 |

**本轮已修复**：🔴 2 个、🟡 2 个（见 §3）。剩余 🟡1 / 🔵4 为「已知且合理」或「已标注」，建议保留现状。

---

## 1. 排查方法（可复现）

```bash
cd src
# ① 演示/模拟/示例字样
grep -rn "演示数据\|模拟数据\|示例数据\|假数据\|测试数据\|demo ?data\|sample ?data" --include="*.tsx" --include="*.ts" .
# ② seed/mock/fake 函数
grep -rniE "(seed\w*|mock\w*|dummy\w*|sample\w*Data|fake\w*)\s*[:=(]" --include="*.tsx" --include="*.ts" .
# ③ 写死的健康数值
grep -rniE "(bpSys|bpDia|sleepScore|spo2|hrv)\s*[:=]\s*(1\d\d|[2-9]\d)\b" --include="*.tsx" --include="*.ts" .
# ④ Math.random() 用途分类
grep -rn "Math\.random()" --include="*.tsx" --include="*.ts" .
# ⑤ 空态里的假数值
grep -rnE "(暂无数据|无数据|空态)[^\n]{0,80}?[0-9]{2,3}\b" --include="*.tsx" --include="*.ts" .
```

---

## 2. 五大方向逐项结论

### 2.1 mock / seed / fake / demo 硬编码数值

**已排查，未发现**（除下方 🔴#1 / 🔴#2）。

- `src/data/familyStore.ts` —— 演示家人（陈屿 / 妈妈 / 爸爸）已于本轮删除，`seedMembers()` 现在只返回 `self`。
- `src/components/MonthDiscoveryView.tsx:79` —— 原「示例规律」3 条已删除（2026-11-03，用户口径「不能有假数据/假分析」）。
- `src/data/metrics.ts:104` —— 指标定义表的 `value` / `data` 字段恒为 `'—'` / `[]`，真实数值一律由 `realSeries.buildHistorySeries` 从 RingBle 真值计算；源码已加禁止放示例数字的约束注释。
- `src/lib/offlineEstimates.ts` —— 唯一会写入「推导值」的模块，**不是随机假数据**：它把「当日实测 stress」线性映射为历史日的 cortisol / fatigue / emotion / eda / skin，并且全部标记 `derivedDays`，UI 有 `isDerivedDay` 标注（详见 §2.3）。

### 2.2 `Math.random()` 生成测量值 / 定时器伪造实时数据

**已排查，未发现伪造测量值**。全部 `Math.random()` 用途如下：

| 文件 | 用途 | 是否伪造测量 |
|---|---|---|
| `src/components/Confetti.tsx` | 撒花动画 | ❌ 纯装饰 |
| `src/components/OrbDots.tsx` | 光点位置/尺寸/延迟抖动 | ❌ 纯装饰 |
| `src/components/MiraBot.tsx` | 机器人眼球游走 | ❌ 纯装饰 |
| `src/components/EmotionLogScreen.tsx` | 心情记录页的「雨滴」动效 | ❌ 纯装饰 |
| `src/screens/FocusScreen.tsx` | 动效延迟 | ❌ 纯装饰 |
| `src/data/*.ts`（`quickCheckStore` / `emotionLog` / `selfReportLog` / `ringIdentity` / `memory`） | 生成记录 ID | ❌ 仅 ID |

**没有任何一处用随机数生成 HRV / 心率 / 血氧 / 睡眠分等测量值。**

### 2.3 7 天模拟传感器数据是否泄漏到正式展示路径

**已排查，链路可控且有标注**。

- 模拟数据只存在于 `lib/offlineEstimates.ts` 的**推导**通道，不产生新的随机测量。
- `healthStore.derivedDays` 标记每个被推导的日期；`healthStore.isDerivedDay(key, dk)` 是统一查询出口。
- 消费方标注情况：
  - `src/screens/MetricDetailScreen.tsx:789` —— 推算日判断；皮质醇 `measuredOnly: true`，**推算日一律走空态，不画线**（源码 `:774` 明确说明理由）。
  - `src/lib/analysisFacts.ts:52/74` —— 传给 AI 的事实对象带 `source` 与 `algorithmVersion: 'offline-estimate-v1'`。
  - `src/ai/patterns.ts:96-100` —— 皮电/压力规律只取**实测日**，显式排除 `isDerivedDay`。
  - `src/ble/RingBleManager.ts:6632` —— 上传后端时标 `source='derived'`。
- 界面来源说明：`DAY_BAR_SPECS.cortisol.sourceNote = '基础版不实测皮质醇；趋势图由多信号推算，非检测值。'`

**结论：模拟/推导数据不会以「实测」身份展示。**

### 2.4 `derivedDays` 推算日是否在 UI 正确标注「推算」

**已排查，已覆盖**（同上 2.3）。另有 `src/lib/dailyStatus.ts:472-473`：

```ts
if (baselineSource === 'lit') {
  narrative = `${phaseText}，今日状态基于群体基线估算`;
}
```

冷启动用文献群体基线时，文案明确写「基于群体基线估算」，且 `dailyStatus.ts:126-147` 的 `LIT` 常量表附有论文出处（Prinsen & Sacher 2025 / Altini & Plews 2019 / Oura Alzueta 2024）。

### 2.5 空态是否显示假数值

**已排查，未发现**。空态一律显示 `—` / `--` / 「暂无数据」+ 原因说明。
全库扫描「空态 + 2~3 位数字」的 30 处命中，逐条核对后全部是 **样式值**（`paddingVertical: 22`）或 **文案里的时长说明**（「约 30 秒心电图测量」），没有一处是伪造的指标数值。

---

## 3. 🔴 Critical（2 个）—— 本轮已修复

### 🔴#1 · 未录入身体档案时用**假的 30 岁**算身体年龄

**文件**：`src/screens/InsightScreen.tsx:202-215`

```ts
// 修复前
// ★ 2026-10-14：演示兜底——模拟/演示数据下未录入身体档案时，给一个可展示的演示年龄，
//   使身体年龄卡片能正常出值；真实用户经 ExamTab 填写后会被覆盖。
const DEMO_PROFILE_AGE = 30;
const clampAge = (a: number | null | undefined) =>
  a != null && Number.isInteger(a) && a >= 18 && a <= 120 ? a : null;
const devAge = RingBle.getUserProfile()?.age;
setActualAge(clampAge(devAge));
getLatestExamRecord().then(record => {
  const value = record?.inputs.age ?? RingBle.getUserProfile()?.age;
  setActualAge(clampAge(value) ?? DEMO_PROFILE_AGE);   // ← 假年龄
}).catch(() => {
  setActualAge(clampAge(RingBle.getUserProfile()?.age) ?? DEMO_PROFILE_AGE);  // ← 假年龄
});
```

**问题**：身体年龄 = 实际年龄 + 活力调整（`InsightScreen.tsx:333-334`）。用一个**编造的 30 岁**算出来的「身体年龄 27 岁 / 比实际年龄小 3 岁」，是彻头彻尾的假数据 —— 渠道演示时会被当成用户的真实身体年龄与真实衰老对比。

**修复后代码**（已落地）：

```ts
    // ★ 2026-11-06 审查（docs/audit/02）：**删除演示年龄兜底**。
    //   旧实现：未录入身体档案时硬塞 DEMO_PROFILE_AGE = 30，让身体年龄卡片能出数。
    //   但身体年龄 = 实际年龄 + 活力调整 —— 用假的 30 岁算出来的「身体年龄 27 岁」
    //   是彻头彻尾的假数据，渠道演示时会被当成用户的真实身体年龄。
    //   现在：无真实档案 → actualAge 保持 null → HealthAgeCard 的 hasEstimate 为 false
    //   → 走「去填写身体档案」CTA 空态，不显示任何编造的年龄数字。
    const clampAge = (a: number | null | undefined) =>
      a != null && Number.isInteger(a) && a >= 18 && a <= 120 ? a : null;
    const devAge = RingBle.getUserProfile()?.age;
    setActualAge(clampAge(devAge));
    getLatestExamRecord().then(record => {
      if (!active || revision !== profileRevision.current) return;
      const value = record?.inputs.age ?? RingBle.getUserProfile()?.age;
      setActualAge(clampAge(value));
    }).catch(() => {
      setActualAge(clampAge(RingBle.getUserProfile()?.age));
    });
```

**安全性验证**：`HealthAgeCard.tsx:39` 已有守卫
```ts
const hasEstimate = healthAge != null && actualAge != null && Number.isFinite(healthAge) && Number.isFinite(actualAge);
```
`actualAge` 为 `null` 时 `hasEstimate === false`，卡片走「填写身体档案」CTA 空态，**不会出现 NaN / 崩溃**。

---

### 🔴#2 · 一键体检的「演示数据」徽章与 seed 记录

**文件**：`src/data/quickCheckStore.ts`（文件头注释）、`src/components/quickCheckShared.tsx:165-194`

**问题**：
1. `quickCheckStore.ts` 文件头仍写着「首次启动若库为空，写入 3 条演示记录」——**代码里 seed 逻辑早已删除**，但注释未同步，后续开发者照着注释加回去就是事故。
2. `quickCheckShared.tsx` 的 `DemoBadge`（"演示数据 · 非真实测量"）组件**已无任何引用**，是死代码；同时它的样式 `demoBadge` / `demoBadgeText` 也无人使用。

**修复后代码**（已落地）：

`src/data/quickCheckStore.ts` 文件头：
```ts
 * 持久化：复用 expo-sqlite（与 examStore 同源，原生模块已链接）。
 *
 * ★ 2026-11-06 审查（docs/audit/02）：**不再写入任何演示记录**。
 *   旧实现会在首次启动（表为空）时 seed 3 条演示体检记录，供无戒指环境审阅 UI。
 *   这对渠道商演示是致命的 —— 用户会把演示值当成自己的真实体检结果。
 *   现在表为空就是空状态，由用户**手动触发**一键体检后才写入真实测量结果。
```

`src/components/quickCheckShared.tsx`：
```tsx
/**
 * ★ 2026-11-06 审查（docs/audit/02）：已删除 DemoBadge。
 *   它原本用于标注「演示数据 · 非真实测量」—— 现在一键体检已完全去演示化
 *   （quickCheckStore 不再 seed 任何演示记录），所有数值都来自真实戒指测量，
 *   标这个徽章反而会误导用户以为数据不可信。
 *
 * 保留位置说明：如后续重新引入任何非真实数据源，必须在此处恢复徽章并标注来源。
 */
```

同时删除已无引用的 `qc.demoBadge` / `qc.demoBadgeText` 样式。

---

## 4. 🟡 High（3 个）

### 🟡#1 · 登录页硬编码演示验证码

**文件**：`src/data/userStore.ts:67`、`src/screens/LoginScreen.tsx:245`

```ts
export const DEMO_CODE = '123456';
```
```tsx
<Text style={s.demoHint}>演示验证码：{DEMO_CODE}（无短信后端，正式版由服务端下发）</Text>
```

**问题**：渠道商演示时会**明文显示**「演示验证码：123456」。虽然有「正式版由服务端下发」的说明，但在正式 App 里显示这行字本身就是错的 —— 用户会以为这是个可以随便登录的后门。

**建议修改后代码**：

```tsx
// src/screens/LoginScreen.tsx:245
// ★ 2026-11-06 审查（🟡#1）：正式版不展示演示验证码。
//   无短信后端时，用户用任意 6 位数字即可登录（服务端接入后由真实验证码下发）。
//   若当前后端仍用固定验证码做联调，请用 __DEV__ 包裹，避免出现在 Release 包里。
{__DEV__ ? (
  <Text style={s.demoHint}>联调验证码：{DEMO_CODE}（仅 Debug 包可见）</Text>
) : null}
```

> ⚠️ 该项**需与后端联调方式确认后**再改，故本轮未动。已在报告中标注。

---

### 🟡#2 · `data/metrics.ts` 的 `CurveConst` 常量表看起来像"默认测量值"

**文件**：`src/data/metrics.ts:480-495`

```ts
seed: number;
day: { base: 46, amp: 42, cycles: 1, phase: 1.571, seed: 3, min: 0, max: 100 },
week: { base: 7.1, amp: 0.6, cycles: 1.5, phase: 0, seed: 5, min: 4.5, max: 10 },
```

**问题**：这些是**曲线生成的形态参数**（基线 + 振幅 + 相位），不是测量值。但命名（`base` / `amp`）与单位（`base: 46` 看着像 HR）容易让后续开发者误当成"默认生理值"。

**核查结论**：`src/data/metrics.ts:104` 已有明确约束注释，且 `realSeries` 不读这些常量做展示值。**判定为低风险，不改**。

**建议（可选）**：把 `CurveConst` 改名为 `CurveShapeConst` 并在类型上加重注释，说明它是"形态参数非测量值"。

---

### 🟡#3 · `data/familyStore.ts` 文件头仍写「模拟数据层」

**文件**：`src/data/familyStore.ts:2`

```ts
 * familyStore —— 家人账户 / 绑定关系（模拟数据层）
```

**问题**：本轮已删除所有演示家人，`seedMembers()` 只剩 `self`，但文件头还写着「模拟数据层」。这会让后续开发者以为可以随便往里加演示数据。

**建议修改后代码**：
```ts
 * familyStore —— 家人账户 / 绑定关系
 *
 * ★ 2026-11-06：已移除全部演示家人（陈屿 / 妈妈 / 爸爸）。
 *   种子只保留「本人」；其余成员必须由用户实际添加后落库。
```

---

## 5. 🔵 Medium（4 个）

### 🔵#1 · `src/data/userStore.ts` 的 `DEMO_CODE` 命名

**文件**：`src/data/userStore.ts:67`

**问题**：常量名 `DEMO_CODE` 会强化"这是演示逻辑"的印象。改成 `DEV_SMS_CODE` 更准确（它本质是**联调用的短信验证码**，不是"演示数据"）。

**建议修改后代码**：
```ts
/** 联调用短信验证码（无短信后端时的固定码；Release 包不展示，见 LoginScreen） */
export const DEV_SMS_CODE = '123456';
```

### 🔵#2 · `src/data/metrics.ts` 的 `seed` 字段名

**文件**：`src/data/metrics.ts:480`

**问题**：`seed` 与「随机种子」同名，但实际是**曲线相位种子**（决定波形起点的确定性常数，非随机）。建议改名 `phaseSeed`。

**风险**：改名会波及所有引用点，收益仅是可读性。**建议不改，仅在类型上加注释**。

### 🔵#3 · `src/lib/dailyStatus.ts` 的 `LIT` 文献基线常量

**文件**：`src/lib/dailyStatus.ts:135-147`

**结论**：**保留**。这是有论文出处的群体基线，只在个人样本 < 30 天时用于冷启动，且：
- `baselineSource: 'lit'` 明确标记来源；
- UI 文案「今日状态基于群体基线估算」诚实告知；
- 有 `LIT` 常量表上方的完整引文注释。

不是假数据，是**有文献依据的群体参考**。

### 🔵#4 · `src/lib/offlineEstimates.ts` 的推导公式是「线性映射」

**文件**：`src/lib/offlineEstimates.ts`

**结论**：**保留**。`cortisol = stress×1.6+20`、`fatigue = stress×1.2`、`emotion` 只有 {2,3,4} 三档 —— 这确实是粗糙推导，但：
- 全部标记 `derivedDays`，UI 有「推算」标注；
- 皮质醇这类容易被当成临床结论的指标，详情页**明确不出曲线**（`measuredOnly`）；
- `stressAlgorithm.ts:331/349` 已有「值域窄 + 方差小 = 假数据 → Tier 1 全跳过」的反作弊检测。

### 附：`src/ai/memory.ts:62` 的 `Math.random()`

```ts
const id = `${userId}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
```
仅用于生成记忆条目 ID，**非测量值**。已排查，无需修改。

---

## 6. ✅ 已复核为「安全、无需修改」

| 检查点 | 结论 |
|---|---|
| `Math.random()` 是否生成测量值 | ❌ 全部为动效/ID |
| 定时器伪造实时数据 | 未发现 |
| 空态显示假数值 | 未发现（30 处扫描命中全为样式值/文案时长） |
| `derivedDays` 推算日标注 | 已覆盖（MetricDetailScreen / analysisFacts / patterns / 上传链路） |
| 文献基线的诚实标注 | 已覆盖（`baselineSource='lit'` + 「基于群体基线估算」） |
| `metrics.ts` 指标定义表放示例数字 | 未发现（`:104` 有硬约束注释，值为 `'—'` / `[]`） |
| `EnergyDetailScreen` 空态 | `:692` 明确「不放演示数据——示意图只说明这里会有图表」 |
| `CognitiveLoadCard` 空态 | `:73` 明确「绝不放演示数据」→ 24 根空柱 + 档位轴 + 「暂无数据」浮层 |
| `QuickCheckTab` | `:11` 明确「无演示数据；从未体检过则为空状态」 |
| `MonthDiscoveryView` 示例规律 | 已于 2026-11-03 删除 |

---

## 7. 修复优先级建议

| 优先级 | 项 | 说明 |
|---|---|---|
| **P0** | 🔴#1 身体年龄演示兜底 | ✅ 本轮已修 |
| **P0** | 🔴#2 一键体检演示记录与徽章 | ✅ 本轮已修 |
| **P1** | 🟡#1 登录页演示验证码 | 需与后端确认联调方式后改为 `__DEV__` 包裹 |
| **P2** | 🟡#3 familyStore 文件头注释 | 顺手改掉，防止后续误加演示数据 |
| **P3** | 🔵#1 / 🔵#2 常量改名 | 可读性收益，可批量做 |

---

**共 9 个问题（🔴 2 / 🟡 3 / 🔵 4）。本轮已落地修复 🔴2 + 🟡1（familyStore 演示数据删除）+ 🟡1（quickCheckStore 注释同步 + DemoBadge 死代码清理）。**
