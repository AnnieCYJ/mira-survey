#!/usr/bin/env node
/**
 * BLE 连接链路 · 发布门禁
 * ---------------------------------------------------------------------------
 * 目的：把 2026-11-13 那批「换台手机就崩」的缺陷固化成静态不变量，
 *      发版前必须全绿，不允许靠人工记忆或"这台机上试过"来判断。
 *
 * 用法：
 *   node scripts/ble-release-gate.mjs              # 代码门禁（每次构建前跑）
 *   node scripts/ble-release-gate.mjs --release    # 追加校验 APK / update.json 一致性
 *
 * 退出码：0 = 全部通过；1 = 有 FAIL（禁止发版）
 *
 * 覆盖的失败模式（每一条都对应一次真实事故）：
 *   ① Android 12+ 运行时蓝牙权限没申请          → 全新安装必连不上
 *   ② 启动按硬编码/持久化 MAC 直连              → 换手机、换戒指、两枚戒指必连错
 *   ③ connect() 丢参 / 状态无超时               → 界面永久「连接中」，按钮被禁用
 *   ④ 调用了类上不存在的方法                    → undefined is not a function
 *   ⑤ 血氧落库无生理区间校验                    → 今日血氧 1%
 *   ⑥ 版本号三处不一致 / APK 与清单哈希不符     → 更新后仍是旧版本
 *   ⑦ 指标分批回来时无「正在加载中」提示        → 用户以为没连上 / App 坏了
 *   ⑧ 体检回退到 7 天前最后一次读数             → 老用户中途体检看到旧血压冒充今天
 */
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => {
  const f = join(ROOT, p);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const has = (src, re) => re.test(src);
/** 只保留可执行代码：剥掉块注释与行注释。
 *  用于「某段代码必须不存在」这类强约束，避免注释里的示例/说明字面量被误判成代码
 *  （2026-11-13 已踩过两次：注释里的「正在加载中」、注释里的 setAddOpen(true)）。 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── ① 版本号三处一致 ─────────────────────────────────────────────────────
const gradle = read('android/app/build.gradle');
const versionTs = read('src/version.ts');
const appJson = read('app.json');
const gCode = gradle.match(/\bversionCode\s+(\d+)/)?.[1];
const gName = gradle.match(/\bversionName\s+"([^"]+)"/)?.[1];
const tCode = versionTs.match(/APP_VERSION_CODE\s*=\s*(\d+)/)?.[1];
const tName = versionTs.match(/APP_VERSION_NAME\s*=\s*'([^']+)'/)?.[1];
let jCode, jName;
try {
  const j = JSON.parse(appJson);
  const e = j.expo ?? j; // Expo 项目字段在 expo 下：expo.version / expo.android.versionCode
  jCode = String(e.android?.versionCode ?? e.versionCode);
  jName = e.version;
} catch { /* ignore */ }
check(
  '版本号三处一致（build.gradle / version.ts / app.json）',
  !!gCode && gCode === tCode && gCode === jCode && gName === tName && gName === jName,
  `${gCode}/${gName} · ${tCode}/${tName} · ${jCode}/${jName}`,
);

// ── ② Android 权限声明 + 运行时闸门 ──────────────────────────────────────
const manifest = read('android/app/src/main/AndroidManifest.xml');
const permOk = ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'ACCESS_FINE_LOCATION',
  'android.permission.BLUETOOTH"', 'BLUETOOTH_ADMIN', 'neverForLocation']
  .every((p) => manifest.includes(p));
check('AndroidManifest 蓝牙权限齐全（12+ / <12 / neverForLocation）', permOk);

const ble = read('src/ble/RingBleManager.ts');
const permGate = read('src/ble/ensureBlePermissions.ts');
check(
  '运行时权限闸门存在且覆盖扫描 + 直连两条入口',
  has(permGate, /requestMultiple|PermissionsAndroid\.request/) &&
  (ble.match(/await ensureBlePermissions\(\)/g) || []).length >= 2,
  `闸门调用 ${(ble.match(/await ensureBlePermissions\(\)/g) || []).length} 处`,
);

// ── ③ 不再按硬编码/持久化 MAC 启动直连 ───────────────────────────────────
check(
  '启动不再按记住的/硬编码 MAC 直连',
  !has(ble, /已知 LunaMira MAC 兜底/) &&
  !has(ble, /\[autoLink\].*按已知 MAC 直连/) &&
  !has(ble, /void this\.connect\(mac\)/),
);
check(
  '不存在「扫到第一个就盲连」的旧逻辑',
  !has(ble, /onAutoLinkDevices\(/) && !has(ble, /立即自动连接/),
);

// ── ④ 扫描结果决策：单枚环境 1 枚直连 / 多枚环境一律列出 ────────────────
const decision = has(ble, /private decideAfterScan\(/) &&
  has(ble, /this\.multiRingKnown \|\| allIds\.length >= 2/) && has(ble, /allIds\.length === 1/) &&
  has(ble, /awaitingDeviceChoice = true/);
check('扫描决策存在（单枚环境 1 枚直连 / 多枚环境全部列出等用户选）', decision);

// ★ 2026-11-13 上线前真机验收实锤的事故：用户有两枚戒指（96% / 43%），某轮扫描只有
//   43% 那枚在广播，12s 兜底「只检测到 1 枚 → 自动直连」把用户切到另一枚并换了数据桶。
//   静态门禁原来只查「有没有 decideAfterScan」，查不出「按单帧台数误判」。这里锁死：
//   ① 跨帧累计 scanSeenThisRound；② 已知多枚环境跨会话持久化；③ 决策合并已知集合。
const bleCode = codeOnly(ble);
check(
  '多戒指环境绝不自动连到另一枚（跨帧累计 + 已知集合持久化 + 决策合并）',
  has(bleCode, /scanSeenThisRound\.add\(/) &&
  has(bleCode, /confirmMultiRing\(/) &&
  has(bleCode, /this\.multiRingKnown = true/) &&
  has(bleCode, /loadKnownRings\(\)/) &&
  has(bleCode, /mira_known_rings_v1\.json/) &&
  has(bleCode, /\[\.\.\.seen, \.\.\.this\.knownRingIds\]/) &&
  // 单枚直连分支必须处在「不是多戒指环境」的前提下（multiRingKnown 的或分支先返回）
  has(bleCode, /if \(this\.multiRingKnown \|\| allIds\.length >= 2\)/),
  '真机复现：只扫到 1 枚就自动切戒指',
);
check(
  '原生扫描窗口结束上报 final 帧 + JS 兜底决策',
  has(read('android/app/src/main/java/com/miraringfashion/app/veepoo/VeepooRingModule.kt'), /emitScanFinished\(\)/) &&
  has(ble, /raw\.final === true/) && has(ble, /armScanDecisionFallback\(/),
);
check(
  '原生 scan() 指向真实 VeepooNative.scan（不是不存在的 this.startScan）',
  has(ble, /scan\(\) \{ VeepooNative\?\.scan\(\); \}/) && !has(ble, /scan\(\) \{ void this\.startScan\(\); \}/),
);

// ── ⑤ 状态机不会死锁 ────────────────────────────────────────────────────
const timeoutOk = has(ble, /status: 'idle'/) &&
  has(ble, /20_000\)/) && has(ble, /10_500\)/) && has(ble, /12_000\)/);
check('scanning / connecting 有超时释放（按钮不会永久禁用）', timeoutOk);
const settingsCode = codeOnly(read('src/screens/SettingsScreen.tsx'));
check(
  '设置页提供「重新扫描全部戒指」逃生按钮 + 多设备列表显示完整 MAC 与固件',
  has(settingsCode, /重新扫描全部戒指/) &&
  has(settingsCode, /检测到 \$\{ring\.devices\.length\} 枚戒指/) &&
  has(settingsCode, /MAC \$\{String\(d\.id\)\}/) &&
  has(settingsCode, /固件 \$\{d\.firmware\}/),
);

// ── ⑥ 生理数据边界 ──────────────────────────────────────────────────────
const physio = read('src/lib/physioRange.ts');
check(
  '生理区间校验存在且接入血氧落库/读取',
  has(physio, /spo2: \[50, 100\]/) && has(ble, /physioValid\('spo2'/) &&
  has(read('src/screens/MetricDetailScreen.tsx'), /physioValid\('spo2'/),
);

// ── ⑦b 数据按戒指 MAC 分桶（两枚戒指绝不共用快照） ──────────────────────
check(
  '本地数据按戒指 MAC 分桶（换戒指不继承另一枚历史）',
  has(ble, /deviceBucketSuffix\(/) && has(ble, /initDeviceBucket\(/) &&
  has(ble, /switchDeviceData\(id\)/) && has(ble, /healthStore\.clear\(\)/) &&
  !has(ble, /\+ 'mira_ring_state_v1\.json'/),
);

// ── ⑦ tsc：类上不存在的方法 = 运行时必崩，必须 0 ─────────────────────────
let brokenRefs = [];
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`;
  brokenRefs = out.split('\n').filter((l) =>
    /does not exist on type '(NativeRingSource|RingConnectionImpl)'/.test(l));
}
check('关键链路无「调用了类上不存在的方法」（undefined is not a function）',
  brokenRefs.length === 0, brokenRefs.length ? brokenRefs.slice(0, 5).join(' | ') : '0 处');

// ── ⑧ 指标卡「正在加载中」（数据分批回来，别让用户以为坏了） ──────────────
const analysisLib = read('src/lib/metricAnalysis.ts');
const loadingHook = read('src/hooks/useRingDataLoading.ts');
const insight = read('src/screens/InsightScreen.tsx');
// 只数「真正会被渲染的 return 文案行」——注释里提到这个词不算。
const loadingReturnLines = analysisLib.split('\n').filter(
  (l) => l.includes('return') && l.includes('正在加载中')
).length;
check(
  '指标卡「正在加载中」仅在「无读数 + 真加载」时出现，且有 90s 硬上限',
  /buildMetricAnalysis\(m: M, value: number \| null, loading = false\)/.test(analysisLib) &&
  /if \(value == null\) \{[\s\S]{0,700}if \(loading\)/.test(analysisLib) &&
  loadingReturnLines === 1 &&
  has(loadingHook, /LOADING_WINDOW_MS\s*=\s*90_000/) &&
  has(loadingHook, /clearTimeout\(timer\.current\)/) &&
  has(loadingHook, /RingBle\.getSyncProgress\(\)/) &&
  has(ble, /getSyncProgress\(\): SyncProgress \| null/) &&
  has(insight, /const cardLoading = real == null/) &&
  has(insight, /buildMetricAnalysis\(m, real, cardLoading\)/),
  `文案 1 处 · 上限 90s · InsightScreen 已接入`,
);

// ── ⑨ 一键体检口径（现场测量 30–40s / 无数据不展示 / 激素只给方向） ────────
const qcStore = read('src/data/quickCheckStore.ts');
const qcTab = read('src/components/QuickCheckTab.tsx');
const qcHistory = read('src/screens/QuickCheckHistoryScreen.tsx');
// TS 数字字面量允许分隔符（35_000），先把下划线去掉再转数字
const qcDur = Number((qcStore.match(/QUICK_CHECK_DURATION_MS\s*=\s*([\d_]+)/)?.[1] ?? '0').replace(/_/g, ''));
check(
  '一键体检 30–40s 现场测量、两入口同口径、无数据不生成报告、激素只给方向',
  qcDur >= 30_000 && qcDur <= 40_000 &&
  has(qcStore, /RingBle\.measure\('hr'\)/) && has(qcStore, /RingBle\.measure\('spo2'\)/) &&
  // PPG 通道一次只能跑一个检测：hr / spo2 必须分时串行，不能同时下发
  has(qcStore, /HR_DETECT_WINDOW_MS/) &&
  has(qcStore, /setTimeout\(r, HR_DETECT_WINDOW_MS \+ 1_000\)/) &&
  has(qcStore, /assembleQuickCheckFromRealtime\(\{ since: startedAt \}\)/) &&
  has(qcTab, /runQuickCheckSession\(\)/) && has(qcHistory, /runQuickCheckSession\(\)/) &&
  has(qcStore, /if \(!hasRingReading\) return \{ ok: false, reason: 'no-data' \}/) &&
  has(qcStore, /trendLabel\(hl\.estrogenTrend\)/) && has(qcStore, /trendLabel\(hl\.progesteroneTrend\)/) &&
  !has(qcStore, /String\(Math\.round\(hl\.estrogen\)\)/) &&
  !has(qcStore, /黄体酮（周期建模）/),
  `${Math.round(qcDur / 1000)}s`,
);

// ── ⑩ 回顾页标题（原生驱动 scrollY 残留导致进入时透明） ────────────────────
const profileSrc = read('src/screens/ProfileScreen.tsx');
const screenContainer = read('src/components/ScreenContainer.tsx');
check(
  '回顾页标题：滚动值留 JS 侧 + 进入/切换时复位（不会突然消失）',
  has(screenContainer, /scrollYNativeDriver\s*=\s*true/) &&
  has(screenContainer, /useNativeDriver:\s*scrollYNativeDriver/) &&
  has(profileSrc, /scrollYNativeDriver=\{false\}/) &&
  (profileSrc.match(/scrollY\.setValue\(0\)/g) || []).length >= 2,
);

// ── ⑪ 添加家人入口暂缓（半成品表单不得暴露给真实用户） ────────────────────
// 用户 2026-11-13：「添加家人这个是先不做」。该表单点「添加」会直接 bindMember
// 写入一位模拟家人，发版前必须封住；恢复功能时要先换成真实云端绑定。
const accountHub = read('src/screens/AccountHubScreen.tsx');
const accountHubCode = codeOnly(accountHub);
check(
  '添加家人按钮只弹「敬请期待」，不打开写入模拟家人的表单',
  has(accountHubCode, /＋ 添加家人/) &&
  has(accountHubCode, /onPress=\{\(\) => Alert\.alert\('敬请期待'/) &&
  !has(accountHubCode, /setAddOpen\(true\)/),
);

// ── ⑫ 体检报告不展示 HRV、不解释固件限制（用户 2026-11-13） ───────────────
// 用户：「HRV 当场测不了，那也不展示 HRV 了吧……不用在报告里写当前固件没有
// 即时测量 HRV 的接口，这个用户不关心」。HRV 只在洞察页独立卡片看已同步日值。
const qcCode = codeOnly(qcStore);
check(
  '体检报告不展示 HRV、不写固件接口说明，估算也不吃 HRV 基线',
  !has(qcCode, /name: 'HRV'/) &&
  !has(qcCode, /当前固件没有即时测量 HRV 的接口/) &&
  !has(qcCode, /liveHrv/) &&
  !has(qcCode, /temp, hrv, steps/) &&
  has(qcCode, /hrv60: null, hrv30: null, hrvBaseline: null/),
  'HRV 只在洞察页独立卡片展示',
);

// ── ⑬ 体检「最近的数据」只到今天；首次自动收窄（用户 2026-11-13） ──────────
// 用户：「首次没那么多数据，展示现场测的 + 当场算的比较靠谱；戴了一段时间中途再测，
// 是不是用测量 + 最近的数据展示」。旧实现 healthStore.getLatest(k, 7) 会一路回退到
// 7 天前的最后一次读数，在老用户报告里冒充今天的数值 —— 必须锁死在「今天」。
// 首次不需要特殊分支：每一项都有「没读数就不展示」守卫，后两层天然为空。
const scopeLib = read('src/lib/quickCheckScope.ts');
const qcDetail = read('src/screens/QuickCheckDetailScreen.tsx');
const estimateLib = read('src/lib/quickCheckEstimate.ts');
// qcStore / qcTab / qcHistory 已在 ⑨ 声明，这里直接复用，避免重复 const 声明
const qcUserCopy = [qcTab, qcHistory, qcDetail, qcStore, estimateLib].map(codeOnly).join('\n');
check(
  '体检「最近的数据」只取当日；现场优先、无数据不展示，首次自动收窄且全仓无 HRV 字样',
  has(qcCode, /healthStore\.getTodayValue\(k, now\)/) &&
  !has(qcCode, /getLatest\(/) &&
  has(qcCode, /liveHr \?\? d\('hr'\)/) &&
  has(qcCode, /if \(!hasRingReading\) return \{ ok: false, reason: 'no-data' \}/) &&
  has(qcCode, /groups\[0\]\.basisNote = scopeNote\(scope\)/) &&
  has(scopeLib, /RHYTHM_MIN_DAYS = 7/) &&
  has(scopeLib, /export function classifyScope/) &&
  has(scopeLib, /export function scopeNote/) &&
  !has(qcUserCopy, /HRV/),
  '现场优先 / 当日闸门 / 三层依据说明 / 体检上下文无 HRV',
);

// ── ⑬-补 上线前真机验收：报告「本次依据说明」必须真显示出来 ──────────────
// 事故：1.4.2 静态门禁 21/21 全绿，真机报告却看不到任何「现场测得 / 今天已同步 /
//   当场重算」说明 —— refreshReportNotes() 把有内容分组的 note 一律清成 undefined，
//   而依据说明当时被拼进了 groups[0].note。门禁只查源码里有没有 scopeNote，查不到
//   「下游把它删了」。修复：独立字段 basisNote，解读引擎不碰，GroupBlock 置顶渲染。
const interpretCode = codeOnly(read('src/data/quickCheckInterpret.ts'));
const sharedCode = codeOnly(read('src/components/quickCheckShared.tsx'));
check(
  '报告依据说明独立字段贯通（组装 → 解读引擎不清 → 报告 UI 置顶渲染）',
  has(qcStore, /basisNote\?: string/) &&
  has(qcCode, /groups\[0\]\.basisNote = scopeNote\(scope\)/) &&
  has(interpretCode, /basisNote: g\.basisNote/) &&
  !has(interpretCode, /basisNote: undefined/) &&
  has(sharedCode, /g\.basisNote \?/),
  '真机复现：分层依据说明被解读引擎清空',
);

// ── ⑬+ 真机验收 2026-11-13 下午：SDK 英文 Toast 与固件不显示 ──────────────
// 事故：用户连上戒指仍看到 "This feature is not supported"（英文），且设置页「固件」
//   恒为「待同步」，选戒指时分不清两枚同名 Lunamira。
//   根因实证：反编译 vpprotocol aar，FunctionCheckUtil.vp_b() 只在
//   VPOperateManager.isShowFunctionNotSupportToast() 为 true 时弹该 Toast；
//   而 PwdData.getDeviceVersion() 早就在 confirmDevicePwd 回调里给了固件，
//   Kotlin 却只打了一句 pwd ok 就丢掉。两处都必须在原生层修，JS 层堵不住。
const ktCode = codeOnly(read('android/app/src/main/java/com/miraringfashion/app/veepoo/VeepooRingModule.kt'));
const cardLib = codeOnly(read('src/ble/ringDeviceCard.ts'));
const settingsUi = codeOnly(read('src/screens/SettingsScreen.tsx'));
const connectUi = codeOnly(read('src/screens/RingConnectScreen.tsx'));
check(
  'SDK 英文 Toast 从源头关闭（setShowFunctionNotSupportToast(false)）',
  has(ktCode, /VPOperateManager\.setShowFunctionNotSupportToast\(false\)/) &&
  !has(ktCode, /VPOperateManager\.setShowFunctionNotSupportToast\(true\)/),
  '真机复现：This feature is not supported',
);
check(
  '原生把 PwdData.deviceVersion 透传到 JS（固件不再恒为「待同步」）',
  has(ktCode, /data\?\.deviceVersion/) &&
  has(ktCode, /put\("firmware", fw\)/) &&
  has(ktCode, /put\("deviceAddress", connectedMac\)/),
);
check(
  '每枚戒指按 MAC 记住固件名片，扫描列表在点选前可区分',
  has(cardLib, /rememberRingDeviceCard/) &&
  has(cardLib, /ringDeviceCardOf/) &&
  has(codeOnly(read('src/ble/RingBleManager.ts')), /ringDeviceCardOf\(d\?\.id\)/) &&
  has(settingsUi, /MAC \$\{String\(d\.id\)\}/) &&
  has(settingsUi, /固件 \$\{d\.firmware\}/) &&
  has(connectUi, /固件 \$\{d\.firmware\}/),
  '真机复现：固件不显示，连的时候不知道连哪个戒指',
);

// ── ⑬++ 2026-11-13 傍晚：体检报告雌激素 / 孕激素分析对齐洞察页话术 ────────
// 事故：报告里这两条写满了「由经期记录与周期相位推算 / 与周期日历页同源 /
//   戒指不直接测量 / 不给浓度数值」，用户不关心；洞察页「生理周期节律」卡片底部
//   那段却是「激素现在处于什么情况 → 身体状态 → 一条具体建议」。
//   修复：四相文案抽到共享模块，两处同源；旧报告冻结的说明由解读引擎重写；
//   详情页端侧 AI 不得改写这两条，避免口径又漂回去。
const phaseLibCode = codeOnly(read('src/lib/phaseHormoneBrief.ts'));
const cycleCardCode = codeOnly(read('src/components/CyclePhaseCard.tsx'));
check(
  '雌激素/孕激素分析与洞察页「生理周期节律」卡片底部同源（四相共用一份文案）',
  has(phaseLibCode, /export const PHASE_BRIEF/) &&
  has(phaseLibCode, /export const HORMONE_BRIEF/) &&
  has(phaseLibCode, /export function hormoneBrief/) &&
  ['period', 'follicular', 'ovulation', 'luteal'].every((p) => new RegExp(`${p}:`).test(phaseLibCode)) &&
  has(cycleCardCode, /import \{ PHASE_BRIEF \} from '\.\.\/lib\/phaseHormoneBrief'/) &&
  has(qcCode, /hormoneBrief\(cycleInfo\.phase, 'estrogen'\)/) &&
  has(qcCode, /hormoneBrief\(cycleInfo\.phase, 'progesterone'\)/),
  '洞察页卡片 / 体检报告共用 lib/phaseHormoneBrief.ts',
);
const hormoneCopy = phaseLibCode.match(/(?:estrogen|progesterone): '[^']+'/g) ?? [];
const bannedHormoneCopy = /推算|化验值|戒指|浓度数值|与周期日历页同源|不给数值|同源/;
check(
  '激素分析只讲「当下状态 + 分析 + 建议」，不写推算方式与数据来源',
  hormoneCopy.length >= 8 && hormoneCopy.every((s) => !bannedHormoneCopy.test(s)) &&
  // 指标值是「水平在上升 / 下降 / 相对平稳」，文案只讲状态，不另写一套趋势动词打架
  !has(phaseLibCode, /正慢慢往上走/) && !has(phaseLibCode, /刚开始抬升/) &&
  !has(qcCode, /note: '只描述方向/) && !has(qcCode, /note: '黄体酮就是孕激素/) &&
  !has(qcCode, /戒指不测激素/),
  `${hormoneCopy.length} 条相位文案`,
);
check(
  '历史报告的推算说明会被重写，且激素文案不被端侧 AI 改写',
  has(interpretCode, /const HORMONE_KEYS = new Set\(\['estrogen', 'progesterone'\]\)/) &&
  has(interpretCode, /LEGACY_SOURCE\.test\(m\.note \?\? ''\)/) &&
  has(interpretCode, /由经期记录/) && has(interpretCode, /非激素化验值/) &&
  has(sharedCode, /FIXED_NOTE_KEYS\.has\(m\.key\)/),
  '新报告 / 历史报告 / 详情页 AI 三个入口口径一致',
);
check(
  '历史报告「生理周期阶段」也不再写推算，旧报告按本组相位取同源话术',
  has(interpretCode, /基于你记录的经期周期推算/) &&
  has(interpretCode, /const PHASE_BY_LABEL/) &&
  has(interpretCode, /hormoneBrief\(groupPhase, m\.key as HormoneKind\)/) &&
  !has(qcCode, /基于你记录的经期周期推算/) &&
  !has(qcCode, /戒指不测激素/),
  '同组相邻项的推算说明一并清掉',
);

// ── ⑭ --release：APK 与更新清单哈希一致 ──────────────────────────────────
if (process.argv.includes('--release')) {
  const apk = join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
  const manifestFile = join(ROOT, 'dist-update/update.json');
  if (!existsSync(apk) || !existsSync(manifestFile)) {
    check('APK 与 update.json 均存在', false);
  } else {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const size = statSync(apk).size;
    const hash = await new Promise((resolve, reject) => {
      const h = createHash('sha256');
      createReadStream(apk).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
    check('update.json 的 sizeBytes / sha256 与待发布 APK 一致',
      m.sizeBytes === size && m.sha256 === hash,
      `APK ${size}B / ${hash.slice(0, 12)}… · 清单 ${m.sizeBytes}B / ${String(m.sha256).slice(0, 12)}…`);
    check('update.json 版本号与源码一致',
      String(m.versionCode) === gCode && m.versionName === gName);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `❌ ${failed.length} 项未通过，禁止发版` : '✅ 全部通过，可以发版'} （${results.length} 项检查）`);
process.exit(failed.length ? 1 : 0);
