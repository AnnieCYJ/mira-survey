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

/**
 * 云端同步后端（Cloudflare Workers + D1，新项目 mira-ring-sync，契约对齐 backend_write_skeleton.json）。
 * ⚠️ 首次 `wrangler deploy` 后，请把下面地址替换为终端实际输出的 `https://mira-ring-sync.<子域>.workers.dev`。
 * 本地调试阶段可临时改回 http://192.168.1.2:3000（需手机与 Mac 同一 Wi-Fi）。
 */
export const BACKEND_BASE_URL = 'https://data.lunamiraring.com';

/** 上传云端时的 Bearer 令牌；为空则不带鉴权（与本地 :3000 dev 行为一致）。生产用 `wrangler secret put API_TOKEN` 设好后端令牌后，填此处即可自动带上。 */
export const RING_SYNC_TOKEN = '';

/** 当前真实数据来源：'native'（直连戒指）或 'backend'（读后端） */
export const RING_DATA_SOURCE: 'backend' | 'native' = 'native';

/**
 * ★ 2026-11-09：App 内「检查更新」的版本清单地址。
 * 清单只有几百字节，放任意公网可读静态托管即可；推荐复用已有 Worker：
 *   ../mira-ring-sync/public/mira-app/update.json → https://data.lunamiraring.com/mira-app/update.json
 * APK 本体（体积大）不放这里，由清单里的 apkUrl 指向对象存储 / 本地 HTTP 服务。
 * 生成清单与 APK：node scripts/publish-apk-update.mjs --apk-url <APK 公网地址>
 */
// 生产清单地址：复用已上线的 mira-ring-sync Worker 静态资源（国内直连可读）。
// ★ 2026-11-11 修正：原先写的 app.lunamiraring.com（Cloudflare R2 自定义域）DNS 不存在、
//   R2 也尚未在 Dashboard 开通，手机每次检查都要白等 10s 超时才回退，故改为已部署的 Worker 路径。
// 工程期本地验证仍可走 src/data/appUpdate.ts 的 DEV_FALLBACK_URL（127.0.0.1:8765 + adb reverse）。
export const UPDATE_MANIFEST_URL = 'https://data.lunamiraring.com/mira-app/update.json';
