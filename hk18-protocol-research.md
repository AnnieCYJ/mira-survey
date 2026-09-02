# HK18 智能戒指（Veepoo / HBandSDK）BLE 协议研究 & mira-app 接入记录

> 最后更新：2026-08-30（逆向 HBandSDK 找私有 opcode + RingBleManager 实现状态）

## 1. GATT 层事实（已验证，真机连通）
- 主服务：`0000ae00-0000-1000-8000-00805f9b34fb`
- 写特征：`0000ae01-0000-1000-8000-00805f9b34fb`（命令下行）
- 通知特征：`0000ae02-0000-1000-8000-00805f9b34fb`（设备回包）
- 广播包**不携带** ae00 服务 UUID → 扫描**禁止用服务过滤**，必须不过滤扫全部 + 按设备名识别（实测设备名即 "HK18"）。
- 标准 Battery Service（`0x180F` / `0x2A19`）多数穿戴设备免认证可读，是电量最可靠的真实来源。

## 2. 私有协议层（Veepoo / Healeon）
- 设备来自 Veepoo，官方 SDK 在 `github.com/HBandSDK`（iOS_Ble_SDK / Android_Ble_SDK）。
- 用户给的 `uni-appSDK-main.zip` 实为**杰理(JL) RCSP 手表协议，与 HK18 无关**，排除。
- Android SDK 仅含编译产物 `vpprotocol-2.3.81.15.aar` + `vpbluetooth-1.20.aar`（无演示 java 源码）。
- 用 Python 解析 `vpprotocol` 的 `.class` 常量池，确认协议层包 `com.veepoo.protocol`：
  - 命令派发 `VPOperateManager`：`readFindDevice` / `readHealthLight` / `setHealthLight` / `getDeviceTestVersion` / `getOadVersion` / `getOriginProtocolVersion`。
  - `operate` 包含：`read_battery_oprate` / `spo2h_read_oprate`（血氧）/ `tempture_detect_oprate`（体温）/ `read_production_info_oprate`（固件）/ `find_watch_by_phon_oprate`（查找/点亮）。
- **关键限制**：命令字节是运行时动态构造的字节数组，常量池抓不到干净的单字节 opcode；且协议需「密码握手 + 带校验帧 + 通知回包」，**单凭反编译 + 无真机无法可靠定稿**。

## 3. 已实现（src/ble/RingBleManager.ts）
- 真扫描 / 真连接 / 真发现 ae00 服务 / 真使能 ae02 通知。
- 设备名、RSSI 来自系统（免认证）。
- **电量双轨**：① 标准 Battery Service(0x180F) 优先（免认证真值）；② 读不到再走 Veepoo 私有命令。
- **Veepoo 私有命令框架**：`buildVeepooFrame` 按公开 Healeon 帧格式构造
  `0xAB + LEN + CMD + PAYLOAD + XOR + 0x55`（XOR = LEN 起至 PAYLOAD 末逐字节异或）。
- 已实现命令：`CMD_BATTERY=0x14`、`CMD_DEVICE_INFO=0x15`（固件）、`CMD_FIND_DEVICE=0x09`（点亮/震动查找）。
- **详尽真机诊断日志**：每条 `→` 发送帧、`←` 收到的 ae02 回包都打印 hex，便于锁定真实 opcode。
- 任何命令无合法回包 → 安全回退「待同步」，绝不崩。
- 设置页新增「查找戒指」按钮（调用 `RingBle.flashRing()`）。

## 4. 待办（需真机回包日志定稿）
- [ ] 用真机实测，把 Metro 里 `[RingBle]` 日志贴回，校正 `CMD_BATTERY / CMD_DEVICE_INFO / CMD_FIND_DEVICE` 的真实字节，以及帧头（旧固件可能 `0xAA` 而非 `0xAB`）。
- [ ] 固件版本解析：确认 `read_production_info` 回包是 ASCII 串还是二进制结构。
- [ ] 若设备要求密码握手，需从 HBandSDK 协议层确认握手命令与默认密码/配对码。
- [ ] 基础指标（心率/血氧/体温/EDA）：在洞察页「基础指标」tab 下已规划卡片，数据需 Veepoo 实时/历史命令补齐（与电量同源）。

## 5. 复现命令（沙箱无蓝牙，仅本机 Xcode 真机可验证）
```bash
# Metro 常驻（不带 --ios）
npx expo start
# Xcode 打开 ios/miraringfashion.xcworkspace → 选真机 → ⌘R
# 设置 → 智能戒指 → 连接 → 点 HK18
# 看 Metro 控制台 [RingBle] 日志
```
