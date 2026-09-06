# 图表/趋势图「看不到离线数据」排查结论

> 用户反馈：离线恢复（backfill 重下载）修完后，在图表和趋势图上仍看不到离线期间的历史数据。

## 一、结论（先说结果）

**JavaScript 数据层、渲染层、持久化层全链路逐环节核查，全部正确对齐、无 bug。**

"图表/趋势图看不到离线数据"在代码层面找不到原因——它只能来自**底层原生 backfill 没有在真机编译生效**（上一轮修的 `RCT_EXPORT_METHOD(backfill)` → `recoverOfflineNow` 等改动只存在于本地 `.m` 文件，而 `ios/` 目录被 `.gitignore` 忽略，不进 git，必须 Xcode `Clean Build + ⌘R` 才会进 App）。

## 二、逐环节核查记录（证明"JS 无 bug"）

| 环节 | 文件 | 结论 |
|---|---|---|
| 原生 emit ↔ JS 监听 | `VeepooRing.m` / `RingBleManager.ts` | 原生 emit 的 `onBackfillDaySlots`/`onSleepDay`/`onHrDay`/`onSpo2Day`/`onTempDay`/`onHrvDay`/`onStepDay`/`onBpDay` 与 JS `addListener` **一一对应**，无接缝断裂 |
| 时间戳生成 | `VeepooRing.m` `~1100` | 原生 `slotMs = 当天 00:00 + "HH:mm" 偏移`，按历史日基准，**正确** |
| JS 转发 | `handleBackfillDaySlots` (`RingBleManager.ts:868`) | 原样转发 `{t:slotMs, v}` 给 `upsertBackfillSamples(dk)`，未改时间戳 |
| 日期解析 | `dateKeyOfStr` (`RingBleManager.ts:328`) | 用正则 `parseYmd`（**不踩 `new Date(string)` 在 iOS 出 NaN 的坑**），与 `dayKey` 同源 |
| 写入归一 | `healthStore.upsertBackfillSamples` | 经 `normalizeDayKey` 归一为补零 `YYYY-MM-DD`，与 `getTimeRange` 查询 key 一致 |
| 持久化 | `healthStore.ts` + `RingBleManager.saveSnapshot` | **存在且完整**：`saveSnapshot` 调 `healthStore.serialize()` 写 `mira_health_store_v2.json`；启动 `loadV2` 恢复（非半成品，之前怀疑是误判） |
| 读取 | `realSeries.ts` → `healthStore.getTimeRange` | 跨天收集 intraday、按绝对时间戳升序拼接，逻辑正确 |
| 渲染 | `MetricDetailScreen.tsx` + `TrendChart.tsx` | 连续序列用 `tPoints.t/v` 按真实时间戳映射 x/y，字段名与 `TimePt{t,v}` 一致，正确 |

## 三、原生回补链路（已确认，但需真机编译）

`RCT_EXPORT_METHOD(backfill)` → `recoverOfflineNow` → `veepooSdkStartReadDeviceAllData`（从戒指 flash 重拉）→ 氧血/HRV 链路 → `backfillRecentDays`（逐日 emit，`finalMaxDays = MIN(deviceTotalDays, 7)`，覆盖最近 7 天）。**逻辑完整**，但只在真机编译后才生效。

## 四、本次交付：诊断面板升级（纯 JS，已 tsc 验证）

修改 `src/screens/SettingsScreen.tsx` 的「调试 · 数据诊断」卡片：

1. **直接展示 `healthStore.freshnessReport()`**（图表/趋势图的**唯一真实数据源**）：每个指标的覆盖天数、样本数、最近更新时间。
   - 若某指标「天数 > 0」但图表空 → 渲染问题（目前未发现）；
   - 若「天数 = 0」→ 离线数据未回传（原生 backfill 未生效/未编译）。
2. **「强制重新同步」后面板自动刷新**（延时 12s 触发重渲染，等 backfill 完成）。
3. 进入设置页自动刷新（`useFocusEffect`）。

> 原有面板读的是旧 `ring.hrDaily` 等 RingState 字段，与图表实际数据源（healthStore）不一致，会误导判断——本次一并纠正为同源于 healthStore。

## 五、请你在真机验证（关键下一步）

1. 打开 App → **设置 → 调试 · 数据诊断**：
   - 若看到 ⚠️「当前运行包缺少 forceResync，必须 Xcode Clean Build + ⌘R」→ **原生修复没编译进 App**，这就是看不到离线数据的根因。
   - 看「healthStore 真实状态」段落：HR / 睡眠 / 体温等「天数」是否为 0。
2. 点 **「强制重新同步」**，等约 10–15 秒，看「healthStore 真实状态」天数是否增加。
3. 若仍 0 天 → 戒指没把数据回传（当天没戴 / 已滚出缓冲 / backfill 异常），需看原生日志 `[Recovery] ★ 开始从戒指 flash 重新拉取`。
4. 点 **「导出诊断文件」**，隔空投送发我 → 我直接看 `freshness` / `sleepDays` / `last14DayKeys`，精确定位是「数据没回来」还是「图表 bug」。

**务必先 Clean Build**：iOS 原生 `.m` 改动不会热更新，Xcode → Product → Clean Build Folder → ⌘R。
