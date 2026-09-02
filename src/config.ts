// mira-app 运行配置
//
// 真实数据来源说明（重要）：
//   HK18 戒指的权威协议是 Veepoo 官方 iOS SDK（VeepooBleSDK.framework，预编译原生
//   framework）。mira-app 通过一层 ObjC 原生桥 `VeepooRing`（见 ios/VeepooRing/ +
//   plugins/withVeepooSDK.js）包裹该 SDK，让 App 自己直连戒指、读取心率/血氧/体温/
//   皮电(EDA)/HRV/呼吸率 —— 这才是上架产品该走的「App 直连戒指」正路。
//
//   RING_DATA_SOURCE：
//     'native'  = 走 VeepooRing 原生桥直连戒指（默认，上架形态）；若原生模块因故不可用
//                 （如非 iOS 真机、或尚未 npx expo prebuild），自动回退 'backend'。
//     'backend' = 始终读后端 :3000 已存的真实 ring 数据（原型期可用，或作为兜底）。
//
//   注意：原生桥的 framework 仅含 arm64，必须连 iPhone 真机构建运行（模拟器会报架构
//   不匹配）；且需在 Xcode 里 ⌘R 一次（plugin 会在 prebuild 时把 framework 嵌入并签名）。

/** 后端基址（仅 native 不可用时作回退；iPhone 真机需与 Mac 同一 WiFi 的局域网 IP） */
export const BACKEND_BASE_URL = 'http://192.168.1.5:3000';

/** 当前真实数据来源：'native'（直连戒指）或 'backend'（读后端） */
export const RING_DATA_SOURCE: 'backend' | 'native' = 'native';
