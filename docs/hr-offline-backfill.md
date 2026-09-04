# HR 离线回填（backfill）实现说明

## 背景
用户反馈：今天 12–16 点佩戴戒指但那段时间 HR 没同步；此前误判「HR 只实时、戒指不存」是错的——核对 `VPDataBaseOperation.h` 后确认**戒指按天离线存心率**（原始数据每 5/10 分钟一格含 `heartValue`）。缺口真因是 backfill 只靠实时 `veepooSDKTestHeartStart:` 拉 HR，未从戒指本地库回填。

## 技术取舍
原方案用 `veepooSDK_readBasicDataWithDayNumber:`（BLE 实时逐包读）。但 HK18 上「按日号读」族 block 多固件不触发（与计步/睡眠同坑），故**改走 `VPDataBaseOperation` 本地库查库** `veepooSDKGetOriginalChangeHalfHourDataWithDate:andTableID:`（半小时心率均值，键 `heartValue`，兼容 `HeartValue` 两种写法）——与 HRV/睡眠/血氧/体温回填同一条已验证通路。功能等价、更稳。

## 原生改动（`ios/VeepooRing/VeepooRing.m`，需 ⌘R 才生效）
1. `supportedEvents` 加入 `onHrDay`。
2. 新增 `backfillDayHr:`：防御式 `NSClassFromString + respondsToSelector + @try`，遍历半小时槽取非 0 `heartValue` 均值 → `emit onHrDay @{date, value}`。
3. `backfill` 主循环 `dn=0..cap` 调用 `[self backfillDayHr:...]`（含今天，修「只戴不连」时段 HR 空白）。

## TS 改动（`src/ble/RingBleManager.ts`，Metro 热更即生效）
1. 构造函数注册 `onHrDay → handleHrDay`（镜像 `handleHrvDay`：写 `hrDaily[date]`，今日还置 `metrics.hr` / `daily['hr']`）。
2. `applyPatch` 触发 `syncExtendedDaily` 条件加 `patch.hrDaily !== undefined`。
3. `syncExtendedDaily` 加 `hrDaily` 拷贝 + `daily['hr']` / `dailyHistory['hr']` 投影 + 并入 `allDates` 跨天序列 + 终态写回 `hrDaily`。
4. `uploadRingData` 早已读 `hrDaily`（~line 2314），HR 历史一并上传云端。

## 验证
- `npx tsc --noEmit` → exit 0，类型无误。
- ⚠️ 原生 `.m` 改动必须 Xcode ⌘R 重编；TS 侧热更即可见，但 `onHrDay` 在 ⌘R 前不会触发（原生未含 `backfillDayHr` / `supportedEvents` 新项）。
- 含义：打开「数据同步」开关、连上戒指，即把「只戴不连」时段（如今天 12–16）的 HR 全天均值回填进 `hrDaily`，心率卡 / 趋势图 / 上传云端均有值。EDA 仍真·只实时、无历史（不改）。
