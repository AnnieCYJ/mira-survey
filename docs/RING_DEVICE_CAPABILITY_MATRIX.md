# 戒指设备能力矩阵：全量版 vs LunaMira 精简版

> 2026-11-07 · **Android 真机实证** · 用户当前佩戴并连接的是 **LunaMira 精简版**
> 起因：此前所有协议/契约文档都按 **SDK 全量版** 写，没有区分两枚戒指，导致精简版的能力判断多处反了。
> 本文是「精简版到底有哪些数据」的唯一基准；`src/config/deviceModel.ts` 的 `BASE_UI` 已按本文重写。

---

## 0. 结论先说

| | 全量版（PRO_UI） | LunaMira 精简版（BASE_UI，当前在用） |
|---|---|---|
| 身份 | HK18 / LunaMira Pro，MAC `C9:00:9C:D7:C2:D8` | MAC `41:42:E7:17:9B:1C`，广播名 `Lunamira` |
| 固件 / 协议 | SDK 协议全集 | 固件 `00.12.09`，**原始协议版本 5**，存储 3 天 |
| 传感器 | 全（体温/血糖/血液成分/身体成分/ECG/皮电/呼吸率/疲劳…） | **只有 5 个逐点生命体征 + 血压 + 压力 + 精准睡眠 + 活动** |
| 文档口径 | `hband-sdk/` 与 `MIRA_RING_SYNC_CONTRACT_V2.md` 描述的是这一档 | 本文 §2/§3 |

**最关键的四个反转**（旧配置 → 真机）：

| 指标 | 旧配置（错） | 真机能力包 | 真机数据 |
|---|---|---|---|
| 体温 | ✅ 有 `temp_daily_mean` | ❌ `体温Type=0`、体温告警不支持 | `slot keys` 里没有 temp |
| 血脂四项 / 尿酸 | ✅ 有 | ❌ `血液成分=不支持 (CompTag=0)` | 无 |
| 血压 | ❌ Pro 专属 | ✅ `血压 BP : 支持 (BpTag=1)` | **逐点真实值 `bpSys=119 / bpDia=84`** |
| 疲劳 / 梅脱 | ✅ 保留 | ❌ `疲劳 Fatigue : 不支持` | slot 无 fatigue/met |

---

## 1. 设备身份与证据来源

```
真机 MAC        41:42:E7:17:9B:1C
广播名          Lunamira（无空格，JS 识别用 /luna|mira/i）
固件版本        00.12.09
原始协议版本    能力包=5 / VpSp=5   （不是 v3）
存储天数        watchDays=3
认证            passwordConfirmed=true
```

三类证据，互相独立：

1. **能力包**：Veepoo SDK `IDeviceFuctionDataListener.onFunctionSupportDataChange` 回包，
   已装 APK 原生桥把它打进 logcat（`[VeepooRing] 设备能力总览` / `能力包P2/P3/P4`）。
   这是「硬件有什么传感器」的真相源。
2. **真实数据流**：JS 侧 `[Batch.slots]` / `[Batch] ✅` 日志，是「设备实际吐了什么」的真相源。
3. **协议字段定义**：`hband-sdk/Android_Ble_SDK/.../apidoc/.../FunctionDeviceSupportData.html`
   getter 全集 + `iOS_Ble_SDK/.../VPPeripheralModel.h` 的 `*Type` 字段含义。
   ⚠️ 它描述的是**全量版能力全集**，不能当作精简版的清单。

复现命令：

```bash
adb logcat -d | grep -aE '设备能力总览|能力包P|心率\(HR\)|血氧 SpO2|HRV|血压 BP|体温 Temp|血糖 Glucose|血液成分|压力 Stress|疲劳 Fatigue|呼吸率|精准睡眠'
adb logcat -d | grep -aE 'Batch\.slots|Batch\.cadence|Batch\.daily'
```

---

## 2. LunaMira 精简版 · 设备声明的能力（能力包原文，2026-11-07 13:06:49）

```
存储天数 watchDays=3  原始协议版本 能力包=5 / VpSp=5
心率(HR)         : 始终支持
血氧 SpO2        : 支持  呼吸暂停提醒=不支持
HRV              : 支持  全天HRV=支持  App测量=不支持
血压 BP          : 支持  (BpTag=1)
体温 Temp        : 不支持  (type=0)
血糖 Glucose     : 不支持  校准=不支持 多校准=不支持 风险评估=不支持 (GluTag=0)
血液成分(尿酸/血脂): 不支持  单次校准=不支持 (CompTag=0)
压力 Stress      : 支持  疲劳 Fatigue : 不支持
呼吸率 Breath    : 不支持
精准睡眠         : 支持  (sleepTag=6)

能力包P2 ─ HRV=支持  App测HRV=不支持 (HrvType=6)  ECG=不支持  呼吸率=不支持  精准睡眠=支持
能力包P3 ─ 体温Type=0  压力=支持 (StressType=2)  ★血糖Glucose=不支持 (GluTag=0)
能力包P4 ─ ★血液成分(尿酸/血脂)=不支持  单次校准=不支持  身体成分=不支持  体温告警=不支持
```

由此可确定的**精简版能力清单**：

### ✅ 有（硬件支持）
| 能力 | 值 | 备注 |
|---|---|---|
| 心率 HR | 始终支持 | 逐点 |
| 血氧 SpO2 | 支持 | 逐点；呼吸暂停提醒不支持 |
| HRV | 支持，`HrvType=6` | 全天 HRV 支持；**App 主动触发 HRV 测量不支持** |
| 血压 BP | 支持，`BpTag=1` | 逐点收缩压/舒张压（PPG 估计值，非医用） |
| 压力 Stress | 支持，`StressType=2` | 见 §4，需走手动测量记录通道 |
| 精准睡眠 | 支持，`sleepTag=6` | `sleepLine` = **1 字符 1 分钟**、0/1/2/3/4 五态 |
| 活动量 | 支持 | 步数/距离/卡路里为**日汇总**，非逐点 |

### ❌ 没有（硬件不支持，UI 不该出现）
体温（`type=0`）、血液成分 / 血脂四项 / 尿酸（`CompTag=0`）、身体成分、
血糖（`GluTag=0`，含校准/多校准/风险评估）、疲劳、呼吸率、ECG（`ecgType` 实测不存在）、
呼吸暂停提醒、体温告警、App 触发 HRV 测量、皮电 EDA / 独立皮肤温度、情绪、皮质醇实测、抑郁风险。

> ECG 不支持 → `resolveProfileByCapabilities` 的「ecgType>0 ⇒ Pro」分档方向正确，
> 但真机 `ready` 事件目前只透传 `{deviceVersion, passwordConfirmed}`，**没有 ecgType**，
> 所以分档实际由已知 MAC 兜底（`DEVICE_ID_PROFILES`）完成。见 §5。

---

## 3. LunaMira 精简版 · 实际回传的数据（onBatch 实证）

```
[Batch.slots] dk=2026-11-06 n=1440 keys=hr,bpDia,bpSys,spo2,hrv,t
[Batch.slots] sample0={"hr":75,"bpDia":84,"bpSys":119,"spo2":98,"hrv":64,"t":"00:00"}
[Batch.cadence] dk=2026-11-06 points=1440 日间=1.0min(840) 夜间=1.0min(599)
[Batch] ✅ hr n=39 / spo2 n=186 / hrv n=92 / bpSys n=39 / bpDia n=39
[Batch] ✅ steps n=4 / calorie n=4 / distance n=4
```

**逐点 slot 字段全集只有 6 个**：`hr, bpSys, bpDia, spo2, hrv, t`。
没有 `temp / stress / fatigue / met / eda / gsr / rr / sns / glucose / steps`（活动量是日汇总）。

### 采样频率：这枚精简版与协议文档不一样

| | 全量版协议口径（`samplingCadence.ts` / 契约文档） | **LunaMira 精简版实测** |
|---|---|---|
| 原始数据桶 | 5 分钟（或 10 分钟），一天最多 288 条 | **1 分钟，一天 1440 条** |
| 日间 | 自动监测稀疏点 / 5 分钟桶 | **1.0 min（840 个间隔）** |
| 夜间 | HRV / 血氧每分钟（洛伦兹 0–7 点），比白天密 | **1.0 min（599 个间隔）** |
| 日夜差异 | 夜间更密 | **无差异，全天等间隔** |

用户观察到的「有时夜间频率高、日间频率低」属于**全量版** HRV/血氧原始数据的口径；
这枚精简版（协议版本 5）是**全天 1 分钟等间隔**。
App 里的「采样频率」卡用 `computeMeasuredCadence()` 从真实时间戳算实测值，所以显示 `1.0min / 1.0min` 是对的；
卡片上的「协议口径」文字是全量版静态值，**按机型区分以本文为准**，不要拿它当成这枚戒指的规格。

> 另有 `v3 收到 279 条 5 分钟样本` 是另一条历史通道（v3 原始数据），
> 与上面的 v5 每分钟 slot 并存，两者不是同一份数据，不能混算频率。

### 睡眠分期
`sleepTag=6` = 精准睡眠 → `sleepLine` 必须按 **1 字符 = 1 分钟、0 深 / 1 浅 / 2 REM / 3 失眠 / 4 苏醒** 解析。
普通睡眠（1 字符 = 5 分钟、0 浅 / 1 深 / 2 苏醒）和 iOS 的 4-hex/点格式都不适用于这枚戒指。
`parseSleepLineHex(line, totalMin)` 已改为三候选自适应 + 用 `sleepTotalMin` 锚定，见 `RingBleManager.ts`。

---

## 4. 压力：设备支持，但不在逐点 slot 里

用户确认「首页身心压力图表用的就是压力」。链路已查清：

- 设备能力包：`压力 Stress : 支持 (StressType=2)` → **硬件确实有**。
- 但 `Batch.slots` 字段全集里**没有 stress** → 压力不是 1 分钟连续曲线，
  它是设备按 `measureInterval` 做的**自动压力监测记录**，存在设备里，
  由 SDK `readDeviceManualData(DeviceManualDataType.STRESS(3))` 批量回读（每条带 timeStamp）。
- 已装 APK 的原生桥只接了 v3/v5 原始数据桶，**没接这条手动测量记录通道** → JS 侧 `healthStore['stress']` 恒空。
- JS 侧所有入口（`onBatch` slot 别名、`onRealtime`、`handleBackfillDaySlots`、`handleHealthGlanceDay`、零值守卫）本轮已全部打通，
  一旦原生 emit stress 就能落库并让首页卡 / 详情页 / 压力分布 / 压力时段同时出数。
- 补丁：`docs/native-patches/VeepooManualTestReader.kt`。产物是**稀疏真实测量点**，不插值、不拿 HRV 反推。
- ⚠️ 前置红线：磁盘上 `VeepooRingModule.kt` 是 394 行旧桩，完整实现只在已装 APK 的 `classes4.dex`；
  已从历史会话还原第 300–1689 行（前 299 行仍缺），`build-debug.sh` 有 guard 阻止误编译。

---

## 5. 代码与文档已做的区分

| 位置 | 改动 |
|---|---|
| `src/config/deviceModel.ts` | `NATIVE_METRIC_CATALOG` 按能力包重标 `proOnly`：体温/血脂四项/疲劳/梅脱 → 精简版无；血压 → 精简版有 |
| 同上 | `BASE_UI.features`：`temp=false`、`bloodComponents=false`、`bodyComp=false`、`bp=true`；subtitle 改为精简版真实清单 |
| 同上 | 新增 `LUNAMIRA_BASE_CAPABILITY_FINGERPRINT`（真机能力指纹 + slotKeys）与 `RingCapabilities` 能力包字段 |
| 同上 | 顶部注释写明「SDK 协议是全量版，不能套到精简版」 |
| `MIRA_RING_SYNC_CONTRACT_V2.md` | 加 §0.5 设备分层声明 |
| `RING_METRIC_AUDIT_2026-11-07.md` | 加 §6 真机能力包修正（频率口径按机型区分） |
| `src/lib/samplingCadence.ts` | 顶部注明协议口径属全量版；UI 实测值永远优先 |

**待原生重编译**（否则下面两条只能靠兜底）：
1. `ready` 事件透传完整 `*Type` 能力字段 → 让 `resolveProfileByCapabilities` 真正生效，不必依赖硬编码 MAC。
2. 接入 `readDeviceManualData(STRESS)` → 压力出数。

---

## 6. 连接稳定性（同日修复，纯 JS）

用户反馈「有时搜得到有时搜不到 / 要自己找 / 连上又断断续续」。根因与修复：

| 根因 | 修复 |
|---|---|
| 系统 BLE 扫描固定 10s 窗口、不设 `ScanSettings`，戒指广播间隔长时整轮落空（12:58 真机 `[Scan] 0 台`） | **按已知 MAC 直开 GATT**（原生 `connect(address)` 不依赖广播），扫描只作无 MAC 时的兜底 |
| 旧 `autoConnectOnLaunch` 只扫一次、8s 没命中就永久放弃 | 改为常驻保活状态机 `startAutoLink()` |
| 原生自动重连 **3 次上限**后放弃 | JS 每次 `native.connect(mac)` 会把原生 `reconnectTries` 清零 → 无限补连 |
| 掉线后 JS 直接置 `idle`，无任何恢复动作 | `idle/error` 触发退避重连（2s→…→30s），外加 30s watchdog 覆盖静默掉线 |
| 用户主动点「断开」后仍被自动连回 | `userStoppedLink` 标志 + `stopAutoLink()` 拆订阅；再次主动连接才恢复 |

真机验收（13:06:40–13:06:48）：

```
[autoLink] 保活已启动 knownMac=41:42:E7:17:9B:1C
[autoLink] 链路断开 → 按已知 MAC 直连 41:42:E7:17:9B:1C（不依赖广播）
✅ SDK GATT 已连接 41:42:E7:17:9B:1C，准备 Veepoo 密钥认证
[autoLink] ✅ 已连接 Mira Ring@41:42:E7:17:9B:1C，保活待命
```

> 注：上面日志里的 `Mira Ring` 是**原生桥拿不到广播名时的历史占位字符串**（按 MAC 直连绕过了广播），
> 不是产品名、也不是本次改动起的名。产品名始终是 **Luna Mira**，广播名是 `Lunamira`。
> 已在 JS 侧 `displayRingName()` 统一收敛为 `Luna Mira`，界面不会再显示占位名。

全程 **0 次扫描**，8 秒内连上；随后 13:07 持续同步（1440 slot / 天）无掉线。

---

## 7. App 上怎么看「连的是哪枚、传了什么、频率多少」（2026-11-07 13:40）

用户反馈「设置页显示不出来、显示不对」，根因有三处，均已修：

| 旧问题 | 修正 |
|---|---|
| 卡片标题是品牌占位名 `Luna Mira`，下面又写一行 `Lunamira · 本机记录` | 标题**直接显示固件广播名** `Lunamira`；下面那行换成「机型 / 协议」，不再重复占位文案 |
| 「自动监测」说明写的是 HK18 全量版口径（体温 / 血脂 / 身体成分、20 秒一次、全天 96 点） | 按 `useDeviceModel()` 分档：精简版写全天 1 分钟等间隔、1440 时间点/天、5 个逐点生命体征 + 日汇总 + 精准睡眠 |
| 旧「数据覆盖诊断」默认收起，只给「N/7 天」，看不出频率，还混着旧戒指归档 | 换成默认展开的 **「当前戒指 · 数据实况」** 卡片 |

数据实况卡（`src/components/DeviceRealityCard.tsx` + `src/lib/deviceReality.ts`）：

- **身份**：机型（按 profile 分档）、固件广播名、固件版本、协议版本 / 存储天数、设备身份尾段。
- **实收证据**：BLE 层新增 `BatchDaySummary`（`RingState.batchSummaries`），每次 `onBatch`
  记录当日 slot 条数、**固件原始字段名全集**、真实时间戳算出的日/夜间隔、实际写入 healthStore 的指标与点数。
  摘要带 `deviceId`，换戒指立即清空；设置页只显示与当前 MAC 一致的摘要。
- **两层频率必须分开写**（否则用户会以为「1440 点」和「hr 只有 39 点」自相矛盾）：
  1. 设备采样节奏：全天 1 分钟等间隔、1440 时间点/天（来自 slot 时间戳）；
  2. 有效读数间隔：slot 里多数生理字段是 0 占位，App 只落库有效值
     （`[Batch] ✅ hr 39 / spo2 186 / hrv 92 / bpSys 39 / bpDia 39`），
     按这些点算出的间隔会大于 1 分钟，**不是丢包**。
- **指标分三类**：已真实落库（逐点 5 项 / 日汇总 / 睡眠分期）、
  设备支持但通道未接入（压力，见 §4）、硬件不支持（体温/血糖/血液成分/ECG/皮电/呼吸率/疲劳…，附能力包证据）。
- **与 HK18 的分界**写在卡片上：全量版 5 分钟桶、夜间 HRV·血氧每分钟（洛伦兹 0–7 点）
  是另一枚戒指的口径，本页不统计它的数据。统计窗口只取设备能存的 3 天 + 本次实收日期。

---

## 8. 压力同步 / 血压卡 / 柱状图按真实频率（2026-11-07 14:00，**仅 BASE_UI**）

用户要求：① 把压力同步补上；② 洞察页「身体指标」下加一张血压卡；③ 详情页柱状图
按当前戒指的实际更新频率分柱（例如 30 分钟就 30 分钟一根柱）；④ **全部改动只作用于
LunaMira 精简版（BASE_UI），不得影响另一档机型的 UI**。

### 8.1 压力：设备直传 vs App 推算，必须分开

| 层 | 现状 | 证据 |
|---|---|---|
| 设备硬件 | **支持压力** `StressType=2` | 能力包 P2/P3 |
| 已装 APK 原生桥 | **未接** `readDeviceManualData(STRESS)` | 反编译 classes4.dex 无该方法；`collectOrigin3()` 只 put hr/spo2/step/bp/temp/cal/dist；SDK Demo `DeviceManualTestDataActivity.java:205/285` 才是压力真实通道 |
| onBatch slot | 只有 `hr, bpDia, bpSys, spo2, hrv, t` | `[Batch.slots] keys=...` + 数据实况卡 |
| App | **现在有压力点了**，但由同一次同步的 HRV/心率/血压真实读数推算，标 `derived` | `src/lib/baseStressSync.ts` |

- 触发：`RingBleManager` 在 `backfillDone` 收尾 + `onBatch` 防抖兜底（1.5s）各跑一次，
  放在 `estimateOfflineMetricsRecent` 之前，保证派生指标用上新 stress 样本。
- 算法：近 3 天 HR/HRV/收缩压建个人基线（均值 ± 标准差），只在**真实读数时刻**取
  配对窗口内最近值，心率↑ / HRV↓ / 收缩压↑ → 压力↑，0–100；不插值、不补点、不外推。
- 诚实口径：`upsertBackfillSamples(..., { derived: true })` 打 `derivedDays` 标记；
  详情页自动显示「当日历史数据为推算值」；设置页数据实况卡把压力行写成
  「App 推算 · 非设备直传」并注明设备 slot 无 pressure 字段。
- **设备实测优先**：原生一旦补上 STRESS 通道（slot 出现 stress/pressure），
  `syncBaseStress` 整体让位，不覆盖任何非 derived 的实测样本。
- 要拿到**设备直测压力**，仍需原生重编译接 `readDeviceManualData(STRESS)`；
  `build-debug.sh` 的护栏仍在（磁盘 VeepooRingModule.kt 是 394 行旧桩，缺前 299 行源码），
  补丁见 `docs/native-patches/VeepooManualTestReader.kt`。

### 8.2 UI 改动与机型隔离

| 改动 | 文件 | 门禁 |
|---|---|---|
| 洞察页「身体指标」基础指标列表下新增「戒指实测血压」卡（点进 BpDetail） | `src/screens/InsightScreen.tsx` | `isBaseLayout` 分支内；PRO_UI 仍走原「血压」子 tab |
| 详情页日视图柱状图按真实有效读数间隔自适应柱宽（5/10/15/30/60 分钟档） | `src/lib/baseChartCadence.ts` + `MetricDetailScreen.tsx` | `isBaseLayout ? resolveBaseBin(...) : DEFAULT_BIN_MIN(5)`；PRO_UI 分桶、槽数、时长折算、文案全部不变 |
| 柱宽同步到「紧张/放松时长」「压力分布/时段」「恢复力」的分钟折算 | `MetricDetailScreen.tsx`（stressDaySummary / stressResilience / specZoneHours / 两个子组件 prop） | 同上，默认参数 5 分钟 |

`resolveBaseBin()` 只读 healthStore 真实样本时间戳取间隔中位数，取「≥ 中位数」的最小标准档：
心率/血压实测 ~30 分钟 → 30 分钟一柱（48 槽）；血氧实测 1 分钟 → 下限 5 分钟（288 槽，
并在图表说明里写明为控制密度做了合并）。统计窗口 = anchor 当天 + 设备可存近 3 天。

### 8.3 验证状态

`npx tsc --noEmit` 保持基线 46、本轮改动零错误；Metro 已把新代码编入 bundle。
⚠ 本轮推包时 `adb devices` 为空（手机与电脑断开），**真机截图验证未完成**；
插回手机后重启 App 即可生效，验收点：洞察页血压卡、心率详情页 30 分钟一柱、
`adb logcat | grep STRESS-SYNC` 看到 `days=/points=`、设置页压力行显示「App 推算」。
