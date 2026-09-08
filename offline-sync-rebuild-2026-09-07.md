# 修复记录（2026-09-07）：状态趋势未来点 + 离线数据拉不回

## 用户反馈
- 下午 2 点多，首页「全天状态趋势」却展示了完整一天（含未来时段）。
- 洞察页很多卡片的时间戳稀疏/缺失。
- 离线数据（睡眠期等）没有拉回来。

## 根因

### 1. bucketDay 跨天陈旧 → 「今天」被当成历史日重建
`RingBleManager.loadPersisted()` 无条件恢复快照里的 `bucketDay`（注释说「仅当同一天」但代码没检查）。
冷启动时（戒指未连、无实时数据）`bucketDay` 是空串或昨天的值：
- `rebuildDayTimelineFromHealthStore` 的 `isToday = dayKey === this.bucketDay` 判错 → 今天按历史日生成 **48 个点（0:00~23:30）**，下午就把未来时段画出来；
- `recomputeDailyStatus` 用 `this.bucketDay || dayKeyOf(now)` → 今天的状态均值写进**昨天**的 `statusDaily` 归档；
- `rebuildHistoricalStatusImpl` 的 `todayKey = this.bucketDay` 同样判错。
另外：快照恢复的 `statusTimeline` 若含昨天的整条 48 点曲线，TrendChart 按 0–24 时比例把昨天曲线画到今天的坐标轴上 → 同样「完整一天」。

### 2. recoverOffline 读取链无超时 → recovering 永久卡 YES
`recoverOffline` 链：readAllData → readOxygen → readHrv → performBackfill。
部分固件 readOxygen/readHrv 永不回调 complete，`recovering` 一直为 YES，
之后每次「数据同步」都被「已在重拉中，跳过」拦截 → **离线数据永远拉不回**。
连接后的初始化链同样无兜底：链断掉时 performBackfill 永远不跑（30s 兜底只 markReady）。

### 3. 洞察页时间戳稀疏
是问题 2 的下游：healthStore intraday 里没有历史样本，`getTodaySeries` 只有当日实时几个点，
非实时卡片的「监测时间」自然稀疏。离线回填修好后自愈。

## 修复

### JS：`src/ble/RingBleManager.ts`
1. `rebuildDayTimelineFromHealthStore`：`isToday = dayKey === dayKeyOf(Date.now())`（墙钟今天）。
2. `rebuildHistoricalStatusImpl`：`todayKey = dayKeyOf(Date.now())`，`days.add(todayKey)`。
3. `recomputeDailyStatus`：`dayKey = dayKeyOf(now)`；`statusDaily[dayKey]`（不再写 bucketDay）。
4. `latestSleepDaily`：`todayKey = dayKeyOf(Date.now())`。
5. `loadPersisted`：
   - 仅当 `snap.bucketDay === dayKeyOf(Date.now())` 才恢复 bucketDay/时间槽；
   - 恢复的 `statusTimeline` 只保留今天的点（昨天的点已在 statusTimelineByDay）；
   - 末尾 `ensureDay(Date.now())` 把 bucketDay 对齐到今天。

### 原生：`ios/VeepooRing/VeepooRing.m`
6. `recoverOffline` 加 90s 看门狗（`recoverWatchdog`）：链没走完就强制 performBackfill（SDK 库有多少发多少）并解锁 `recovering`；链正常完成/中途失败均取消看门狗。
7. `onConnectState` 断连分支与 `cleanup` 统一解锁 `recovering`/`backfillRunning` 并取消看门狗。
8. `onPasswordVerified` 30s 兜底额外补跑一次 `performBackfill`（链断掉时 readAllData 已落库的数据照发）。

## 验证步骤
1. 日志服务已跑在 :8899（/tmp/mira-logs/collector.log）。
2. Xcode **Clean Build**（原生改了）→ ⌘R；Metro 重载。
3. 首页看「全天状态趋势」：曲线应只到当前时间（14 点只有 ~28 个点）。
4. 设置 → 数据同步 开 → 看 collector.log 里 `[RECOVER]`/`[BACKFILL]`：
   - 正常：readAllData → readOxygen → readHrv → `[BACKFILL] ✅ 完成`；
   - 卡链：90s 后应出现 `[RECOVER] ⏰ 读取链 90s 未完成，强制进入回填并解锁 recovering`。
5. 洞察页各卡片「监测时间」应出现 9/7 各时段样本。
