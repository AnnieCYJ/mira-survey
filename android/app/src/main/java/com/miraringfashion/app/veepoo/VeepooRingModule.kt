package com.miraringfashion.app.veepoo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.veepoo.protocol.VPOperateManager
import com.veepoo.protocol.listener.base.IBleWriteResponse
import com.veepoo.protocol.listener.base.IConnectResponse
import com.veepoo.protocol.listener.base.INotifyResponse
// ★ 2026-11-15（用户：戒指一直戴着，但 App 很久不连上、数据断档）：
//   注册 SDK 的连接状态监听，戒指**被动掉线**（没电/离开范围/被旧手机占用/系统回收 GATT）时
//   SDK 会回调 STATUS_DISCONNECTED —— 旧代码只监听「连接成功/失败」，被动掉线全程无通知，
//   JS 假停在 connected → 既不重连也不回填。javap 核对：
//   VPOperateManager.registerConnectStatusListener(String, IABleConnectStatusListener) /
//   unregisterConnectStatusListener(...)；回调 onConnectStatusChanged(mac, status)；
//   常量 com.inuker.bluetooth.library.Constants.STATUS_CONNECTED / STATUS_DISCONNECTED。
import com.veepoo.protocol.listener.base.IABleConnectStatusListener
import com.inuker.bluetooth.library.Constants as BleConstants
import com.veepoo.protocol.listener.data.IAllHealthDataListener
import com.veepoo.protocol.listener.data.IBatteryDataListener
import com.veepoo.protocol.listener.data.IHeartDataListener
import com.veepoo.protocol.listener.data.ISpo2hDataListener
import com.veepoo.protocol.listener.data.IHRVOriginDataListener
import com.veepoo.protocol.listener.data.ISpo2hOriginDataListener
import com.veepoo.protocol.listener.data.IOriginData3Listener
import com.veepoo.protocol.listener.data.IAutoMeasureSettingDataListener
import com.veepoo.protocol.listener.data.IDeviceFuctionDataListener
// ★ 2026-11-14（用户拍板「一键体检加血压/HRV 主动测量」）：App 主动测量接线。
//   javap 核对 vpprotocol-2.3.81.15.aar：startDetectBP(IBleWriteResponse, IBPDetectDataListener, EBPDetectModel)
//   / startDetectHrv(BleWriteResponse, IHrvDetectListener) 均存在；真机 caps bp=true hrv=true。
//   注意 IBleWriteResponse 本身 extends BleWriteResponse，直接复用现有 SAM 写法。
import com.veepoo.protocol.listener.data.IBPDetectDataListener
import com.veepoo.protocol.listener.data.IHrvDetectListener
// ★ 2026-11-17（用户「补吧补吧」：把 Pro 的 ECG/血糖真接进原生桥）：
//   javap vpprotocol-2.3.81.15.aar 核对：
//   startDetectECG(IBleWriteResponse, boolean, IECGDetectListener)
//   / stopDetectECG(IBleWriteResponse, boolean, IECGDetectListener)
//   / startBloodGlucoseDetect(IBleWriteResponse, IBloodGlucoseChangeListener)
//   / stopBloodGlucoseDetect(IBleWriteResponse, IBloodGlucoseChangeListener) 均存在。
//   回调契约对齐 iOS VeepooRing.m 的 onEcg/onEcgProgress/血糖 onRealtime。
import com.veepoo.protocol.listener.data.IECGDetectListener
import com.veepoo.protocol.listener.data.AbsBloodGlucoseChangeListener
import com.veepoo.protocol.listener.data.IBloodComponentDetectListener
import com.veepoo.protocol.model.datas.BloodComponent
import com.veepoo.protocol.model.enums.EBloodComponentDetectState
import com.veepoo.protocol.model.datas.BpData
import com.veepoo.protocol.model.datas.EcgDetectInfo
import com.veepoo.protocol.model.datas.EcgDetectState
import com.veepoo.protocol.model.datas.EcgDetectResult
import com.veepoo.protocol.model.datas.EcgDiagnosis
import com.veepoo.protocol.util.EcgUtil
import com.veepoo.protocol.model.enums.EBPDetectModel
import com.veepoo.protocol.model.enums.EDeviceStatus
import com.veepoo.protocol.model.enums.EBloodGlucoseStatus
import com.veepoo.protocol.model.enums.HrvDetectState
import com.veepoo.protocol.shareprence.VpSpGetUtil
// ★ 2026-11-16（用户：戒指一直戴着、手机在旁边还断连）：ColorOS 熄屏会 freeze 整个进程，
//   掐死 JS 重连定时器。掉线后的唤醒改由系统 AlarmManager 托管（不依赖 App 进程内定时器）。
import com.miraringfashion.app.keepalive.RingReconnectAlarm
import com.veepoo.protocol.model.datas.BatteryData
import com.veepoo.protocol.model.datas.HeartData
import com.veepoo.protocol.model.datas.Spo2hData
import com.veepoo.protocol.model.datas.OriginData
import com.veepoo.protocol.model.datas.OriginHalfHourData
import com.veepoo.protocol.model.datas.HRVOriginData
import com.veepoo.protocol.model.datas.Spo2hOriginData
import com.veepoo.protocol.model.datas.HalfHourRateData
import com.veepoo.protocol.util.Spo2hOriginUtil
import com.veepoo.protocol.model.datas.OriginData3
import com.veepoo.protocol.model.settings.ReadOriginSetting
import com.veepoo.protocol.model.datas.TimeData
import com.veepoo.protocol.model.datas.AutoMeasureData
import com.veepoo.protocol.model.enums.EAutoMeasureType
// ★ 2026-11-18（用户：Pro 没看到血糖/血液成分）：接 readDeviceManualData 历史记录通道
import com.veepoo.protocol.model.enums.DeviceManualDataType
import com.veepoo.protocol.model.datas.BloodGlucoseManualData
import com.veepoo.protocol.model.datas.BloodComponentManualData
// ★ 2026-11-18(v61)（用户：EDA/压力/疲劳/情绪/皮肤含水量接上）：GSR 点测 + 微体检 + 历史记录
//   javap vpprotocol-2.3.81.15.aar 核对：
//   startDetectGsr(BleWriteResponse, IGsrDetectListener) / stopDetectGsr(BleWriteResponse)
//   startMiniCheckup(BleWriteResponse, IMiniCheckupOptListener) / stopMiniCheckup(...)
//   IGsrDetectListener: onGsrDetectProgress/onGsrDetectSuccess(GsrDetectResult)/onGsrDetectFailed/onGsrDetectStop
//   GsrDetectResult: getEmotionLevel/getSkinMoisture/getSnsActivation/getCortisolValue/getDepressionRisk
//   IMiniCheckupOptListener: onMiniCheckupSuccess(MiniCheckupResultData)/onMiniCheckupDetailTestSuccess(MiniCheckupDetailData)
//   历史: PressureManualData.getPressure / FatigueManualData.getFatigue / SkinConductanceManualData.getSkinMoisture 等
import com.veepoo.protocol.listener.data.IGsrDetectListener
import com.veepoo.protocol.model.datas.GsrDetectResult
import com.veepoo.protocol.model.enums.GsrDetectAck
import com.veepoo.protocol.listener.IMiniCheckupOptListener
import com.veepoo.protocol.model.datas.MiniCheckupResultData
import com.veepoo.protocol.model.datas.MiniCheckupDetailData
import com.veepoo.protocol.model.enums.EMiniCheckupTestErrorCode
import com.veepoo.protocol.model.datas.PressureManualData
import com.veepoo.protocol.model.datas.FatigueManualData
import com.veepoo.protocol.model.datas.SkinConductanceManualData
import com.veepoo.protocol.model.datas.EmotionManualData
import com.veepoo.protocol.model.datas.MetoManualData
import com.veepoo.protocol.listener.data.AbsDeviceManualDetectDataListener
import com.veepoo.protocol.model.enums.EFunctionStatus
import com.veepoo.protocol.model.datas.SleepData
import com.inuker.bluetooth.library.search.SearchRequest
import com.inuker.bluetooth.library.search.response.SearchResponse
import com.inuker.bluetooth.library.search.SearchResult
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android 原生桥：包裹 Veepoo Android SDK（VPOperateManager），暴露与 iOS `VeepooRing` 完全一致的
 * JS 接口与事件契约，使 RingBleManager.ts 在 Android 上无需改动即可直连戒指。
 *
 * 事件（与 iOS 对齐）：
 *   onLog       调试日志
 *   onRealtime  {metric,value,unit,ts} 实时单指标
 *   onBatch     {date,slots:[...]} 离线批量回填
 *   onState     {status:'scanResult'|'connected'|'ready'|'syncing'|'error',...}
 *   onEcg       {aveHeart,aveHrv,aveResRate,aveQT,avePWV,waveform}
 *   onEcgProgress {progress,hr} | {error}
 *   onRingShutter 戒指按钮/摇一摇触发快门
 *
 * 真机联调重点（务必逐项验证，见 TODO(veepoo) 标）：
 *   1) 扫描回调 wiring（startScanDevice 传入的 SearchResponse 是否能收到 onDeviceFounded）
 *   2) 连接后 confirmDevicePwd / syncPersonInfo 的回调签名与密码（默认 "0000"）
 *   3) 各实时监听器的数据字段名（HR/SpO2/体温/HRV 的取值字段）
 *   4) 离线历史 readHistory 的分页与回调（onBatch 的 slots 结构）
 */
class VeepooRingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        // ★ 2026-11-13（用户：「刚连上戒指 This feature is not supported 怎么还在」）：
        //   这句英文 Toast 不是 App 弹的，是 Veepoo SDK 的 FunctionCheckUtil 弹的。
        //   反编译 vpprotocol aar 实证：FunctionCheckUtil.vp_b() 会先读
        //   VPOperateManager.isShowFunctionNotSupportToast()，为 true 才 post 出
        //   "This feature is not supported" 的 Toast。之前只按能力跳过单个命令，堵不住其它入口。
        //   SDK 提供 public static setShowFunctionNotSupportToast(boolean)，这里从源头关掉，
        //   整类英文提示都不会再出现（能力门禁仍保留，避免无谓写命令）。
        try {
            VPOperateManager.setShowFunctionNotSupportToast(false)
            android.util.Log.i("VeepooRing", "[VeepooRing ANDROID] SDK unsupported-feature Toast disabled")
        } catch (e: Throwable) {
            android.util.Log.w("VeepooRing", "[VeepooRing ANDROID] disable SDK Toast failed: ${e.message}")
        }
    }

    /** 当前正在连接的戒指 MAC：PwdData 回调里带上它，JS 才能按 MAC 记住固件名片。 */
    private var connectedMac: String = ""

    /**
     * ★ 2026-11-15：SDK 连接状态监听（戒指被动掉线通知）。
     *   注册在 connect()，注销在 disconnect()；回调里只 emit，不做重型操作。
     *   STATUS_DISCONNECTED → JS 归位 idle → autoLink 自动重连 → ready 回填 HRV/BP。
     *   connectLifecycleLock 保证 register/unregister 串行，避免 SDK 内部 listener 集合并发改动。
     */
    private val connectLifecycleLock = Any()
    private var connectStatusRegisteredMac: String = ""

    // ★ 2026-11-16（冻结免疫重连）：系统闹钟唤醒后发来的「立即原生重连」请求。
    //   动态注册（不进 Manifest），只在模块存活期间有效；进程冷启动时 JS autoLink 自己会连。
    private var reconnectRequestReceiver: android.content.BroadcastReceiver? = null
    /** 防止一次掉线里 JS autoLink 与原生闹钟重复并发 connect。 */
    private var nativeReconnectAt = 0L
    private val NATIVE_RECONNECT_GUARD_MS = 12_000L

    private fun registerReconnectRequestReceiver() {
        if (reconnectRequestReceiver != null) return
        val r = object : android.content.BroadcastReceiver() {
            override fun onReceive(_ctx: android.content.Context?, intent: android.content.Intent?) {
                if (intent?.action != RingReconnectAlarm.ACTION_RECONNECT_REQUEST) return
                val mac = intent.getStringExtra(RingReconnectAlarm.EXTRA_MAC)
                    ?.takeIf { it.isNotBlank() } ?: return
                val appCtx = reactContext.applicationContext
                if (!RingReconnectAlarm.isActive(appCtx)) return
                val isHourly = intent.getBooleanExtra(RingReconnectAlarm.EXTRA_HOURLY, false)
                // ★ 2026-11-23：每小时这一路（含冷启动重连）回填收口后要补测压力/EDA。
                //   置位后由 finishBackfillTransaction 消费；普通掉线重连不置位。
                if (isHourly) nightlySnapPending = true
                // 已连上就别重复连；并撤掉掉线闹钟。
                // ★ 2026-11-18：来自「每小时同步」的请求，即使已经连着也要触发一次数据回填
                //   （用户要求「每个小时连接一次上次戒指 + 更新数据」）。用今天的日期做增量，
                //   backfillSince 内部有 ready 守卫 + 事务合并，不会重复下发写命令打爆通道。
                try {
                    if (manager.isDeviceConnected(mac)) {
                        RingReconnectAlarm.cancel(appCtx)
                        // ★ 2026-11-24（P0 状态卡死修复）：底层 BLE 已连（GATT link up + 实时数据
                        //   在进），但 JS 的 status 可能仍停在 idle——典型于「App 重启 / 闹钟原生
                        //   重连」场景：connect() 的 notify 回调 emit connected 发生在 JS listener
                        //   就绪之前而丢失。EcgCard/详情页测量入口检查 `status === 'connected'`，
                        //   status 卡 idle 会让所有手动测量（ECG/血液成分等）被误拦为「戒指未连接」。
                        //   这里在「确认底层已连」时幂等补发一次 connected，让上层状态机自愈。
                        //   JS 对重复 connected 幂等（仅刷新 lastConnectedAt / 机会式补测），无害。
                        emit("onState", JSONObject().apply {
                            put("status", "connected")
                            put("deviceAddress", mac)
                        })
                        if (isHourly && ready.get()) {
                            log("[VeepooRing ANDROID] ⏰ 每小时同步：已连接 → 触发增量回填更新数据")
                            // backfillFrom 自身会 emit syncing/onBatch/backfillDone，走既有通道，
                            // 无需额外状态；数据更新由这条完整链路覆盖。
                            try {
                                backfillFrom(todayDateKey())
                            } catch (e: Throwable) {
                                log("[VeepooRing ANDROID] 每小时回填触发失败: ${e.message}")
                            }
                        }
                        return
                    }
                } catch (_: Throwable) {}
                val now = android.os.SystemClock.elapsedRealtime()
                if (now - nativeReconnectAt < NATIVE_RECONNECT_GUARD_MS) return
                nativeReconnectAt = now
                log("[VeepooRing ANDROID] ⏰ 闹钟唤醒 → 原生立即重连 $mac")
                try { connect(mac) } catch (e: Throwable) {
                    log("[VeepooRing ANDROID] 原生重连触发失败: ${e.message}")
                }
            }
        }
        try {
            val filter = android.content.IntentFilter(RingReconnectAlarm.ACTION_RECONNECT_REQUEST)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(r, filter, android.content.Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                reactContext.registerReceiver(r, filter)
            }
            reconnectRequestReceiver = r
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] 注册重连 receiver 失败: ${e.message}")
        }
    }
    // ★ 2026-11-15（白屏修复）：必须用 by lazy，不能在模块构造期实例化。
    //   IABleConnectStatusListener 继承自 Inuker 库的 BleConnectStatusListener；某些机型上
    //   其父类静态初始化在 React 原生模块构造阶段抛异常（message=null），会让 ReactInstance
    //   task faulted → 整个 RN 白屏。改为首次 connect() 时才实例化，且registerConnectStatus
    //   已有 try-catch 兜底，构造失败只影响监听注册、不再拖垮 App 启动。
    private val connectStatusListener by lazy { object : IABleConnectStatusListener() {
        override fun onConnectStatusChanged(mac: String, status: Int) {
            log("[VeepooRing ANDROID] connStatus mac=$mac status=$status " +
                "(CONNECTED=${BleConstants.STATUS_CONNECTED} DISCONNECTED=${BleConstants.STATUS_DISCONNECTED})")
            when (status) {
                BleConstants.STATUS_DISCONNECTED -> {
                    // 戒指被动掉线：通知 JS 归位 idle → autoLink 立刻补连。
                    // 幂等：主动 disconnect() 已发过一次，这里可能再来一帧，重复 emit 无害（JS 归位 idle 本就幂等）。
                    ready.set(false)
                    stopPpgReleaseCycle()
                    stopChronicVitals()
                    // ★ 2026-11-22（P0 死锁）：掉线时强制清掉悬挂的同步事务锁 + 暂缓写队列，
                    //   否则重连后所有写命令被误判「同步在途」永久 defer → 连着但零数据。
                    forceReleaseSyncLocksOnDisconnect()
                    val target = if (mac.isNotBlank()) mac else connectedMac
                    val ctx = reactContext.applicationContext
                    // ★ 2026-11-16：用户主动断开时不再自动连回；被动掉线才排冻结免疫闹钟。
                    if (RingReconnectAlarm.isActive(ctx) && target.isNotBlank()) {
                        RingReconnectAlarm.schedule(ctx, target)
                        // 掉线这一瞬间进程还活着（还没被熄屏冻结），直接原生抢连一次，
                        // 不必等 20s 闹钟；带 12s 去重避免与 JS autoLink 并发重复 connect。
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - nativeReconnectAt >= NATIVE_RECONNECT_GUARD_MS) {
                            nativeReconnectAt = now
                            mainHandler.postDelayed({
                                try {
                                    if (!ready.get() && RingReconnectAlarm.isActive(ctx) &&
                                        !manager.isDeviceConnected(target)) {
                                        log("[VeepooRing ANDROID] ⚡ 掉线即时原生重连 $target")
                                        connect(target)
                                    }
                                } catch (e: Throwable) {
                                    log("[VeepooRing ANDROID] 掉线即时重连失败: ${e.message}")
                                }
                            }, 1_200L)
                        }
                    }
                    emit("onState", JSONObject().apply {
                        put("status", "disconnected")
                        put("deviceAddress", target)
                    })
                }
                BleConstants.STATUS_CONNECTED -> {
                    // GATT 真正连上（比 INotifyResponse 更早的一帧）：撤掉重连闹钟。
                    // 业务上的 connected/ready 仍由既有流程 emit，避免重复触发鉴权/回填。
                    RingReconnectAlarm.cancel(reactContext.applicationContext)
                    log("[VeepooRing ANDROID] connStatus STATUS_CONNECTED (GATT link up), 重连闹钟已撤")
                }
            }
        }
        } }

    /** 注册连接状态监听（connect 前调用；同 MAC 只注册一次）。 */
    private fun registerConnectStatus(mac: String) {
        if (mac.isBlank()) return
        synchronized(connectLifecycleLock) {
            try {
                if (connectStatusRegisteredMac.isNotBlank() && connectStatusRegisteredMac != mac) {
                    manager.unregisterConnectStatusListener(connectStatusRegisteredMac, connectStatusListener)
                }
                if (connectStatusRegisteredMac != mac) {
                    manager.registerConnectStatusListener(mac, connectStatusListener)
                    connectStatusRegisteredMac = mac
                    log("[VeepooRing ANDROID] connStatus listener registered mac=$mac")
                }
            } catch (e: Throwable) {
                log("[VeepooRing ANDROID] connStatus register FAILED: ${e.message}")
            }
        }
    }

    /** 注销连接状态监听（disconnect 时调用）。 */
    private fun unregisterConnectStatus() {
        synchronized(connectLifecycleLock) {
            try {
                if (connectStatusRegisteredMac.isNotBlank()) {
                    manager.unregisterConnectStatusListener(connectStatusRegisteredMac, connectStatusListener)
                    log("[VeepooRing ANDROID] connStatus listener unregistered mac=$connectStatusRegisteredMac")
                }
            } catch (e: Throwable) {
                log("[VeepooRing ANDROID] connStatus unregister FAILED: ${e.message}")
            } finally {
                connectStatusRegisteredMac = ""
            }
        }
    }

    private val manager: VPOperateManager by lazy { VPOperateManager.getMangerInstance(reactContext.applicationContext) }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ready = AtomicBoolean(false)
    private var monitorOn = false
    // ★ 2026-11-23（用户：夜间身心压力没数据）：后台每小时闹钟唤醒时，进程虽活但 JS 层
    //   snapshotRotation 的 30s Handler 可能被冻结停摆，导致夜间零点点测。此标志由后台
    //   回填收口处置起，让下一次 tickSnapshotRotation 即便 monitorOn 尚未恢复也能强制跑一轮。
    @Volatile private var nightlySnapPending = false
    // ★ 2026-11-18(v61)：GSR/微体检单测轮询（对齐 iOS startRotationIfNeeded）。
    //   EDA/情绪/皮肤含水量（GSR）与压力/疲劳度（微体检）都是「App 点测一次才出值」的快照指标，
    //   设备不会连续自动测。每 30s 交替触发一路（比 iOS 的 10s 更保守，避免抢 PPG 通道影响
    //   心率/血氧实时流与一键体检），单路在途时跳过，看门狗超时自动放行。
    private val snapshotRotationHandler = Handler(Looper.getMainLooper())
    private var snapshotRotationArmed = false
    private var snapshotRotationIdx = 0
    private var snapshotTestInProgress = false
    private val SNAPSHOT_ROTATION_INTERVAL_MS = 30_000L
    private val snapshotRotationRunnable = object : Runnable {
        override fun run() {
            if (!snapshotRotationArmed) return
            tickSnapshotRotation()
            snapshotRotationHandler.postDelayed(this, SNAPSHOT_ROTATION_INTERVAL_MS)
        }
    }
    // ★ 2026-11-10（用户：心率在图表上死活不更新，必须解决）：
    //   本固件 SpO2hData.rateValue（实时心率）恒为 0（原始 BLE 包 spo2h_read_oprate 里 HR 字节恒 00），
    //   实时流拿不到心率；PULSE_RATE 周期自动测量在 16:00 后也断流。心率唯一可靠来源是
    //   独占 PPG 通道的即时测量（startDetectHeart → HeartData.data）。
    //   解法：实时血氧常开，每 5 分钟抢 20 秒通道采一次心率，采完恢复血氧流 —— 心率稳定每 5 分钟更新一次。
    private val hrSampleHandler = Handler(Looper.getMainLooper())
    private var hrSampleArmed = false
    private val HR_SAMPLE_INTERVAL_MS = 5 * 60_000L
    // ★ 2026-11-13：设备能力缓存（来自 onFunctionSupportDataChange 的 FunctionDeviceSupportData）。
    //   null = 尚未拿到（保守按「支持」处理，避免误关功能）；false = 设备明确 UNSUPPORT → 跳过对应命令，
    //   从源头杜绝 SDK 内部弹 "This feature is not supported" Toast。
    private var capBp: Boolean? = null
    private var capHrv: Boolean? = null
    private var capSpo2: Boolean? = null
    private var capPulse: Boolean? = null
    // ★ 2026-11-17（用户：ECG 测到最后卡在「生成报告」）：VpSpGetUtil.isSupportECG() 读的是本地存的
    //   设备类型，PRO_UI 档位下恒 true，但真机能力包 FunctionDeviceSupportData.ecg=UNSUPPORT
    //   → 测量启动后只回 info 帧、永不出结果 → 99% 卡死。改用固件真实能力位做门禁。
    //   null=尚未拿到能力包（保守放行，交设备实测）；false=固件明确不支持 → 拒绝启动。
    private var capEcg: Boolean? = null
    private var capGlucose: Boolean? = null
    /** ★ 2026-11-18：血糖私有模式（多点校准固件）。私有模式固件对公开模式命令（vp_bs）不响应，
     *  必须发私有命令（vp_bt）；由能力包 bloodGlucoseMultipleAdjusting 位判定。 */
    private var glucosePrivateMode = false
    private var capBloodComponent: Boolean? = null

    // ★ 2026-11-16（用户：摘下戒指放桌上，数据还在更新）：
    //   戒指摘下后固件会关闭 PPG → 连续血氧流停止（真机实证：摘下后 12s 内 0 条 spo2h 包，
    //   但 BLE GATT 仍连接）。旧逻辑只看「连接没连接」，于是 5min HR 采样 / 30s 情绪重算 /
    //   10min 同步照跑，派生指标用 Date.now() 继续变 → 用户看到「摘了还在更新」。
    //   这里维护一个佩戴状态：null=未判定，true=佩戴，false=摘下。判定依据两条（见 onSpO2HADataChange）：
    //     ① SDK 的 Spo2hData.deviceState==UNPASS_WEAR（强信号，立即脱手）
    //     ② 血氧流静默超时（固件摘下后连 UNPASS_WEAR 包都不发，只能靠超时；阈值 > PPG 让出窗口 120s）
    //   状态变化经 onWear 事件发给 JS，JS 据此冻结实时写入与派生重算（冻结在最后一笔，不空态）。
    @Volatile private var worn: Boolean? = null
    /** 最近一次收到「有效血氧样本」的时刻（spo2>0 且非让出/测量窗口）。 */
    @Volatile private var lastSpO2SampleAt = 0L
    /** ★ 2026-11-18：最近一次收到「任意血氧帧」的时刻——不管 value 是不是 0，只要帧到了就刷新。
     *  「有没有戴戒指」的物理证据是**帧还在不在传**，不是读数是否有效。真机日志实锤：戴着戒指时
     *  spo2h 帧每秒都到，但读数会短时=0（测量恢复期/佩戴姿势/温度）；旧逻辑只看 spo2>0，把
     *  value=0 当成没数据 → 看门狗静默 20s 误判脱手 → 点快检被弹「未佩戴」。
     *  判脱手一律用这个字段；value>0 仍用于「从脱手恢复」的正向判定。 */
    @Volatile private var lastAnySpo2FrameAt = 0L
    /** ★ 2026-11-17：最近一次主动测量(ECG/BP/HRV/血糖)结束时刻。测量会停血氧流数十秒，
     *   结束后血氧流恢复需要时间；这段宽限期内不判脱手，否则戴着戒指做 ECG 后会被误判「未佩戴」。 */
    @Volatile private var lastMeasureEndAt = 0L
    /** 测量结束后的脱手判定宽限期：给血氧流重新启动 + 首批样本到达留足时间。 */
    private val WEAR_GRACE_AFTER_MEASURE_MS = 30_000L
    private val wearWatchdogHandler = Handler(Looper.getMainLooper())
    private var wearWatchdogArmed = false
    /** 静默判定阈值：正常佩戴时血氧流每秒一条，20s 无包即可判脱手（够快，体检时能及时提示）。
     *  PPG 让出窗口(ppgReleaseActive)、主动测量(measuring)、5 分钟 HR 采样窗口(hrListener)已在上游排除——
     *  ★ 2026-11-16 真机复验发现：HR 采样会停血氧流 20s，不排除的话每次采样都被误判脱手、
     *    采样刚出的合法心率读数又被 JS 冻结闸门丢弃（21:07/21:12/21:17/21:22 四次 false→true 抖动作证）。 */
    private val WEAR_OFF_SILENCE_MS = 20_000L
    /** 看门狗检查间隔 */
    private val WEAR_CHECK_INTERVAL_MS = 5_000L
    private val wearWatchdogRunnable = object : Runnable {
        override fun run() {
            // 仅在实时监控开启 + 已就绪时判佩戴；让出窗口 / 主动测量 / HR 采样期间流本就会停，不算脱手
            val measuring = bpDetectListener != null || hrvDetectListener != null || hrListener != null ||
                ecgDetectListener != null || glucoseListener != null || bloodComponentListener != null
            // ★ 2026-11-17：主动测量结束后血氧流要几十秒才恢复，宽限期内不判脱手
            val justFinishedMeasure = lastMeasureEndAt > 0 &&
                System.currentTimeMillis() - lastMeasureEndAt < WEAR_GRACE_AFTER_MEASURE_MS
            // ★ 2026-11-18：判脱手改用「帧是否还在到」(lastAnySpo2FrameAt)，
            //   不再用「有效读数是否出现」(lastSpO2SampleAt)。戴着但 value=0 时帧仍每秒到达，
            //   不会被误判脱手；真摘戒指时帧彻底停止，20s 后正常判脱手。
            if (monitorOn && ready.get() && !ppgReleaseActive && !measuring && !justFinishedMeasure && lastAnySpo2FrameAt > 0) {
                val silent = System.currentTimeMillis() - lastAnySpo2FrameAt
                if (silent >= WEAR_OFF_SILENCE_MS && worn != false) {
                    setWorn(false, "spo2 frame silent ${silent / 1000}s")
                }
            }
            if (wearWatchdogArmed) wearWatchdogHandler.postDelayed(this, WEAR_CHECK_INTERVAL_MS)
        }
    }

    /** 更新佩戴状态，仅在变化时 emit onWear 给 JS。 */
    private fun setWorn(next: Boolean?, reason: String) {
        if (worn == next) return
        val prev = worn
        worn = next
        try {
            emit("onWear", JSONObject().apply {
                put("worn", if (next == null) "unknown" else next.toString())
                put("prev", if (prev == null) "unknown" else prev.toString())
                put("reason", reason)
            })
        } catch (_: Throwable) {}
        log("[VeepooRing ANDROID] wear=$prev -> $next ($reason)")
    }

    private fun startWearWatchdog() {
        if (wearWatchdogArmed) return
        wearWatchdogArmed = true
        // ★ 2026-11-16：冷启动时戒指可能就是摘下的，从未收到过血氧包（lastSpO2SampleAt=0）。
        //   此时以「看门狗启动时刻」为锚点，25s 内仍无有效血氧 → 判脱手，避免摘着戒指却永远不冻结。
        if (lastAnySpo2FrameAt == 0L) lastAnySpo2FrameAt = System.currentTimeMillis()
        wearWatchdogHandler.postDelayed(wearWatchdogRunnable, WEAR_CHECK_INTERVAL_MS)
    }
    private fun stopWearWatchdog() {
        wearWatchdogArmed = false
        wearWatchdogHandler.removeCallbacks(wearWatchdogRunnable)
        lastSpO2SampleAt = 0L
        lastAnySpo2FrameAt = 0L
        setWorn(null, "watchdog stopped")
    }

    private val hrSampleRunnable = object : Runnable {
        override fun run() {
            // ★ 2026-11-12：让出 PPG 期间只跳过这一轮、不要停定时器。
            //   旧版 releasePpgForAutoMeasure() 直接 stopHrSampling()，恢复后又要等满 5 分钟才采第一次，
            //   加上每半小时让一次，心率节奏被无限推迟（真机 11/12 全天 hr=0 点、single HR detect 日志 0 条）。
            if (monitorOn && ready.get() && !ppgReleaseActive &&
                bpDetectListener == null && hrvDetectListener == null &&
                ecgDetectListener == null && glucoseListener == null && bloodComponentListener == null) {
                // 占用 PPG 通道 20s 采心率，startSingleHeartDetect 结束内部会恢复 spo2 流
                startSingleHeartDetect()
            }
            if (hrSampleArmed) hrSampleHandler.postDelayed(this, HR_SAMPLE_INTERVAL_MS)
        }
    }
    private fun startHrSampling() {
        if (hrSampleArmed) return
        hrSampleArmed = true
        hrSampleHandler.postDelayed(hrSampleRunnable, HR_SAMPLE_INTERVAL_MS)
    }
    private fun stopHrSampling() {
        hrSampleArmed = false
        hrSampleHandler.removeCallbacks(hrSampleRunnable)
    }

    // ★ 2026-11-21（用户拍板「除心电外全部自动测量，低频每2小时」）：
    //   戒指端血糖/血液成分自动测量开关功能表=UNSUPPORT（真机实锤：ensureAutoMeasure 只回报 PULSE_RATE），
    //   无法靠戒指自测，只能 App 侧定时主动测。每项每 2 小时一次、两项错开 3 分钟，避免同一 PPG 窗口互抢。
    //   约束：必须有佩戴（血氧帧活跃）、无任何测量 listener 占用、非 PPG 让出窗口，否则跳过本轮。
    private val chronicVitalsHandler = Handler(Looper.getMainLooper())
    private var chronicVitalsArmed = false
    private val CHRONIC_VITALS_INTERVAL_MS = 2 * 60 * 60_000L
    // ★ v91（用户 2026-11-24：「血液成分要自动测量，不要手动测」）：
    //   首轮改为血液成分优先——血糖有实时流持续回填（真机 glucose≈5.46 一直在回），不缺这一次点测；
    //   血液成分是纯点测项，不主动发起就永远是「—」。戴上戒指连上 App 约 30s 后即自动测尿酸/血脂。
    private var chronicVitalsNextGlucose = false // false = 首轮先血液成分；之后与血糖交替
    private val chronicVitalsRunnable = object : Runnable {
        override fun run() {
            if (!chronicVitalsArmed) return
            val key = if (chronicVitalsNextGlucose) "glucose" else "bloodcomp"
            // ★ v92（2026-11-24 真机时序实锤）：tryRunChronicVital 返回「建议重试毫秒」，
            //   -1 = 已成功发起；>0 = 按跳过原因重试。冷启动 PPG 窗口 5s 触发占 120s，
            //   旧版首轮 30s 必撞车 + 死等 5min → 血液成分长期出不来值。
            val retryMs = tryRunChronicVital(key)
            if (retryMs < 0) {
                // 成功发起：切到另一项，2 小时后再来
                chronicVitalsNextGlucose = !chronicVitalsNextGlucose
                if (chronicVitalsArmed) chronicVitalsHandler.postDelayed(this, CHRONIC_VITALS_INTERVAL_MS)
            } else {
                android.util.Log.e("AUTOVITAL", "retry $key in ${retryMs / 1000}s")
                if (chronicVitalsArmed) chronicVitalsHandler.postDelayed(this, retryMs)
            }
        }
    }
    private fun startChronicVitals() {
        if (chronicVitalsArmed) return
        chronicVitalsArmed = true
        // 首轮延后 30s：避开 connected 边沿的回填/实时流启动通道竞争
        chronicVitalsHandler.postDelayed(chronicVitalsRunnable, 30_000L)
        log("[VeepooRing ANDROID] chronicVitals auto-measure armed (glucose/bloodcomp every 2h, staggered)")
    }
    private fun stopChronicVitals() {
        chronicVitalsArmed = false
        chronicVitalsHandler.removeCallbacks(chronicVitalsRunnable)
    }
    /** 低频自动测量：佩戴 + 通道空闲才发起；发起后由 SDK 回调链路正常收口（出值即停、恢复血氧流）。
     *  ★ v92：返回 -1 = 已成功发起；>0 = 建议多少毫秒后重试（按跳过原因分级，避免通道竞争把血液成分饿死）。 */
    private fun tryRunChronicVital(key: String): Long {
        // 全部用 android.util.Log.e 直写，避开 onLog→postLog 250ms 节流吞日志（诊断刚需）
        val TAG = "AUTOVITAL"
        val now = System.currentTimeMillis()
        // 带小抖动的短重试：snapshot 轮询是 30s 周期，用 19~23s 错开，避免固定相位永远撞车
        val quickRetry = 19_000L + (Math.random() * 4000).toLong()
        if (!monitorOn || !ready.get()) {
            android.util.Log.e(TAG, "skip $key: monitorOn=$monitorOn ready=${ready.get()}")
            return 60_000L }
        // 佩戴判定：最近 90s 内有血氧帧才认为戴着（PPG 窗口会停血氧流最长 120s，
        //   旧 60s 阈值会把「窗口刚恢复、戴着戒指」误判成脱手 → 自动测量永远起不来）
        if (lastAnySpo2FrameAt <= 0L || now - lastAnySpo2FrameAt > 90_000L) {
            android.util.Log.e(TAG, "skip $key: ring not worn (lastSpo2FrameAge=${now - lastAnySpo2FrameAt}ms)")
            return 5 * 60_000L }
        // ★ v93（2026-11-24 真机死锁实锤）：用户已拍板「血液成分自动测量」= 用户意图，
        //   与手动 measure() 同优先级。旧版遇 PPG 窗口就 skip，而只有 measure() 内部才会
        //   cancelPpgRelease —— 形成「窗口挡住自动测量、自动测量够不到取消窗口」的死锁，
        //   真机连续数分钟全被挡、一次都出不来值。这里在发起前主动取消 PPG 让出窗口（与手动同款，
        //   安全无副作用：窗口本就每 30min 循环，下个整点照常让出）。
        //   注意：不 stopSnapshotRotation——那会导致压力/EDA/疲劳快照永久停更（只有连接边沿才重启）。
        if (ppgReleaseActive) {
            android.util.Log.e(TAG, "cancel PPG release for AUTO $key (user intent wins)")
            cancelPpgRelease("AUTO $key wins")
        }
        // 正在跑的实测（ECG/血糖/血液成分自身/snapshot的miniCheckup/GSR/HRV/BP）不抢占，
        // 等它自然收口后快速重试（20s 抖动），避免掐断别人的测量。
        if (ecgDetectListener != null || glucoseListener != null || bloodComponentListener != null
            || gsrDetectListener != null || miniCheckupListener != null || hrListener != null
            || hrvDetectListener != null || bpDetectListener != null) {
            android.util.Log.e(TAG, "skip $key: another measure running (mini=${miniCheckupListener != null} gsr=${gsrDetectListener != null} hr=${hrListener != null})")
            return quickRetry }
        android.util.Log.e(TAG, "AUTO $key fired (worn, channel cleared, spo2Age=${now - lastAnySpo2FrameAt}ms)")
        measure(key)
        return -1L
    }

    /** 诊断入口：真机立即触发一次低频自动测量（免等 2h），仅调试用。 */
    @ReactMethod
    fun debugRunChronicVital(key: String) {
        android.util.Log.e("AUTOVITAL", "debug trigger $key")
        tryRunChronicVital(key)
    }
    private val scannedDevices = mutableListOf<JSONObject>()
    /** ★ 2026-11-11：自动测量设置只写一次，防止 setAutoMeasureSettingData 回调本监听器造成循环写。 */
    private val autoMeasureWritten = java.util.Collections.newSetFromMap(
        java.util.concurrent.ConcurrentHashMap<EAutoMeasureType, Boolean>()
    )
    /**
     * ★ 2026-11-11（用户：HRV / 血压 20:00 后不再更新）：
     * App 常开 startDetectSPO2H 连续血氧 + 每 5 分钟抢 20s 采心率，把 PPG 通道反复占住；
     * 本固件「PPG 一次只能跑一个检测」，戒指端 30 分钟一轮的 HRV / 血压自动测量需要更长空闲。
     * 每 30 分钟整段让出 90s（血氧 + 心率采样都停），让戒指自己完成周期测量，再恢复。
     */
    private val ppgReleaseHandler = Handler(Looper.getMainLooper())
    private var ppgReleaseArmed = false
    @Volatile private var ppgReleaseActive = false
    private val PPG_RELEASE_HOLD_MS = 120_000L
    // ★ 2026-11-14（真机 17:29 实锤）：让出窗口的恢复任务必须是可取消的具名 Runnable ——
    //   用户点一键体检时若正好撞上 120s 窗口，重试/HRV/血氧全被静默吞掉
    //   （`BP detect skip: ppg release window` / `skip realtime restart`）。
    //   measure() 是用户主动行为，一律先 cancelPpgRelease 再测量，用户意图优先。
    private var ppgRestoreRunnable: Runnable? = null

    /** 取消进行中的 PPG 让出窗口（含未触发的恢复任务），让用户主动测量立即拿通道。 */
    private fun cancelPpgRelease(reason: String) {
        if (!ppgReleaseActive && ppgRestoreRunnable == null) return
        ppgRestoreRunnable?.let { mainHandler.removeCallbacks(it) }
        ppgRestoreRunnable = null
        ppgReleaseActive = false
        log("[VeepooRing ANDROID] PPG release canceled: $reason (user measure wins)")
    }
    private val ppgReleaseRunnable = object : Runnable {
        override fun run() {
            if (ready.get()) releasePpgForAutoMeasure()
            if (!ppgReleaseArmed) return
            val now = System.currentTimeMillis()
            val half = 30 * 60_000L
            // 对齐到下一个整点/半点，正好卡在戒指 30 分钟一轮的自动测量前
            val delay = ((now / half) + 1) * half - now
            ppgReleaseHandler.postDelayed(this, delay)
        }
    }
    private fun startPpgReleaseCycle() {
        if (ppgReleaseArmed) return
        ppgReleaseArmed = true
        // 先立刻让一次（装机后马上能看到有没有新读数），之后靠 runnable 自身对齐半点
        ppgReleaseHandler.postDelayed(ppgReleaseRunnable, 5_000L)
    }
    private fun stopPpgReleaseCycle() {
        ppgReleaseArmed = false
        ppgReleaseHandler.removeCallbacks(ppgReleaseRunnable)
    }
    private fun releasePpgForAutoMeasure() {
        val saved = spo2Listener
        try {
            ppgReleaseActive = true
            // 不再停 hrSampleHandler：定时器继续按 5 分钟节奏走，只是静默窗口内被 hrSampleRunnable 跳过。
            // 若此刻正在跑 20s 的即时心率检测，必须中止，否则它会占住 PPG 让戒指测不成 HRV/血压。
            try { manager.stopDetectHeart(IBleWriteResponse { _ -> }) } catch (_: Exception) {}
            hrListener = null
            saved?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            log("[VeepooRing ANDROID] PPG release: paused ${PPG_RELEASE_HOLD_MS / 1000}s for HRV/BP auto measure (HR timer kept)")
        } catch (e: Exception) {
            ppgReleaseActive = false
            log("[VeepooRing ANDROID] PPG release FAILED: ${e.message}")
            return
        }
        val restore = Runnable {
            ppgRestoreRunnable = null
            ppgReleaseActive = false
            if (!ready.get()) return@Runnable
            // ★ 2026-11-18：让出窗口刚结束、血氧流重启到首批帧到达有延迟，前移锚点避免误判脱手
            val restoreAt = System.currentTimeMillis()
            if (lastAnySpo2FrameAt < restoreAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = restoreAt
            if (spo2Listener == null) startSpo2hOnly()
            startHrSampling()
            // 恢复血氧后 25s 主动补一次心率，避免「等满 5 分钟才出第一个点」；
            // ★ BP/HRV 主动测量进行中不许抢 PPG（否则恰逢其时的一枪会把测量拦腰打断）
            mainHandler.postDelayed({
                if (monitorOn && ready.get() && !ppgReleaseActive &&
                    bpDetectListener == null && hrvDetectListener == null) startSingleHeartDetect()
            }, 25_000L)
            // ★ v80 修复（用户：身心压力没数据）：PPG 让出窗口结束后立即补一次微体检/GSR 轮询，
            //   不再空等下一个 30s tick（真机 SNAPDG 实锤：窗口 120s 吃掉多轮 tick 导致 EDA/stress 饿死）。
            //   延后 8s 让血氧流先稳住，避免刚恢复就抢通道。
            mainHandler.postDelayed({
                if (monitorOn && ready.get() && !ppgReleaseActive && snapshotRotationArmed &&
                    !snapshotTestInProgress) {
                    android.util.Log.e("SNAPDG", "PPG restore -> catch-up snapshot tick")
                    tickSnapshotRotation()
                }
            }, 8_000L)
            log("[VeepooRing ANDROID] PPG release: SPO2H restored, HR catch-up queued")
        }
        ppgRestoreRunnable = restore
        mainHandler.postDelayed(restore, PPG_RELEASE_HOLD_MS)
    }
    // ★ 2026-11-09：离线回填状态机——真正调 SDK 读历史，逐日 emit onBatch。
    private val backfillInProgress = AtomicBoolean(false)

    /**
     * ★ 2026-11-22（用户："数据量大就线性逐步回填，不要中间给卡死"）：
     * 原生回填事务级「无进展硬超时」看门狗。补 v77 死锁修复的最后一块短板——
     * v77 只修了「断连时清锁」，但若戒指一直连着、SDK 第一段 readAllHealthData
     * 静默不回调（既不 onReadOriginComplete 也不 onReadTimeout），回读锁仍会永久挂；
     * JS 侧 150s watchdog 只解 JS 标记、解不了原生锁（重发请求进原生被 getAndSet 合并丢弃）。
     *
     * 机制：回填有实质进展（进度推进 / 收到任一天批次 / origin3 回调）就 touch 续命；
     * 连续 BACKFILL_STALL_MS 无任何进展 → 强制走事务收口（清两把锁 + emit backfillDone +
     * flush 被暂缓的写命令），让整条链路从干净状态继续，而不是永久卡死。
     * 只要数据在持续回流（哪怕很慢、很多天），看门狗就一直不触发 → 实现"线性逐步回填"。
     */
    private var backfillLastProgressAt = 0L
    private val BACKFILL_STALL_MS = 45_000L   // 无进展 45s 判定卡死（正常回填每批间隔远小于此）
    private val BACKFILL_WD_TICK_MS = 15_000L // 每 15s 巡检一次
    private val backfillWatchdogRunnable = object : Runnable {
        override fun run() {
            if (!backfillInProgress.get()) return  // 事务已正常收口，看门狗自然熄灭
            val last = backfillLastProgressAt
            val idle = if (last <= 0L) 0L else System.currentTimeMillis() - last
            if (idle >= BACKFILL_STALL_MS) {
                android.util.Log.e("BACKFILL-WD", "stall ${idle / 1000}s no progress -> force finish transaction")
                finishBackfillTransaction()
                return
            }
            mainHandler.postDelayed(this, BACKFILL_WD_TICK_MS)
        }
    }
    private fun touchBackfillProgress() {
        backfillLastProgressAt = System.currentTimeMillis()
    }
    private fun armBackfillWatchdog() {
        backfillLastProgressAt = System.currentTimeMillis()
        mainHandler.removeCallbacks(backfillWatchdogRunnable)
        mainHandler.postDelayed(backfillWatchdogRunnable, BACKFILL_WD_TICK_MS)
        android.util.Log.e("BACKFILL-WD", "armed (stall threshold ${BACKFILL_STALL_MS / 1000}s)")
    }
    private fun clearBackfillWatchdog() {
        mainHandler.removeCallbacks(backfillWatchdogRunnable)
    }
    /**
     * ★ 2026-11-11（用户：连上戒指后夜间血氧/HRV 还是不回填）：
     * 主同步（readAllHealthDataBySettingOrigin）与历史原始回读（readOriginDataBySetting /
     * IOriginData3Listener）共用同一条 BLE 写通道，必须串行且算作**一次同步事务**。
     * 旧实现在主同步结束就 emit backfillDone + 解锁，JS 收到后立刻「排队补跑」再发一次
     * backfillSince，把 1.5s 后才启动的 origin3 读命令打断 —— 真机日志实证：
     *   origin3 requested → 188ms 后 backfillSince → origin3 emit days=0 points=0
     * 前两次全空，只有偶然不被打断的第三次才拿到 hr=59 hrv=116 spo2=155。
     * 现在只有 origin3 也收尾了，才 emit backfillDone 并释放 backfillInProgress。
     */
    private val origin3InProgress = AtomicBoolean(false)
    /** ★ 2026-11-15：事务期间到达的重复回填请求只挂起，不再向 BLE 通道发第二次全量读。 */
    private val pendingBackfillDuringTransaction = AtomicBoolean(false)
    /**
     * ★ 2026-11-15（上线测试 P0-1：连上 3 秒就掉线）：
     * 认证成功后同一条 BLE 写通道会被「对时 / 实时血氧 / 4 个自动测量开关 / PPG 让出循环 /
     * JS connected 边沿的 setAutoMonitor + setSyncEnabled + ready 分支的 ensureAutoMeasureNow /
     * 以及全量回填补跑」在 3s 内并发打爆；而 origin3 历史读取也在同一通道。
     * 这里把所有非必要写命令在同步事务期间排队，事务收口后错峰回放。
     */
    private val deferredWrites = java.util.concurrent.CopyOnWriteArrayList<Pair<String, () -> Unit>>()
    private fun runOrDeferWrite(tag: String, block: () -> Unit) {
        if (backfillInProgress.get() || origin3InProgress.get()) {
            log("[VeepooRing ANDROID] defer BLE write '$tag' until sync settles")
            deferredWrites.add(tag to block)
        } else {
            try { block() } catch (e: Exception) { log("[VeepooRing ANDROID] deferred write '$tag' failed: ${e.message}") }
        }
    }
    /**
     * ★ 2026-11-22（P0 死锁修复）：断连时强制收口悬挂的同步事务。
     *
     * 真机铁证：昨晚 21:12 戒指在 backfill 在途时掉线（status=8 监督超时），
     * SDK 回调再也不来 → backfillInProgress/origin3InProgress 两把锁永不释放。
     * App 进程 14h 未重启，今天 11:15 重连后所有写命令被 runOrDeferWrite 判定
     * 「同步在途」塞进 deferredWrites，而队列只在 backfillDone 时 flush → 死锁：
     * 戒指连着、握手正常、只回电量帧，实时 HR/血氧/历史回填全无。
     *
     * 本函数只做**本地状态清理**，刻意不 emit backfillDone（避免推进 JS 游标
     * 触发补跑/缺口自愈的空转）。下次重连从干净状态开始，写命令直接执行。
     */
    private fun forceReleaseSyncLocksOnDisconnect() {
        val wasInFlight = backfillInProgress.getAndSet(false) || origin3InProgress.getAndSet(false)
        clearBackfillWatchdog()  // v78：断连解锁同时熄灭看门狗，避免空转
        pendingBackfillDuringTransaction.set(false)
        val pending = deferredWrites.size
        if (wasInFlight || pending > 0) {
            android.util.Log.e("SYNCUNLOCK", "disconnect released stuck locks: wasInFlight=$wasInFlight pendingWrites=$pending")
            log("[VeepooRing ANDROID] 🔓 断连强制解锁同步事务 (wasInFlight=$wasInFlight, pendingWrites=$pending)")
        }
        // 丢弃所有暂缓写命令：它们属于已死的那次连接，重连后 JS 会重新下发整套。
        deferredWrites.clear()
    }

    private fun flushDeferredWrites() {
        if (deferredWrites.isEmpty()) return
        val list = ArrayList(deferredWrites)
        deferredWrites.clear()
        mainHandler.postDelayed({
            list.forEachIndexed { i, (tag, block) ->
                mainHandler.postDelayed({
                    try { block() } catch (e: Exception) { log("[VeepooRing ANDROID] deferred write '$tag' failed: ${e.message}") }
                }, i * 350L)
            }
            log("[VeepooRing ANDROID] flushed ${list.size} deferred BLE writes after sync settled")
        }, 600L)
    }
    // 设备可存储天数（来自 IDeviceFuctionDataListener 回调的 getWathcDay()，SDK 拼写如此）。
    private var deviceWatchday = 7

    override fun getName(): String = "VeepooRing"

    // React Native 要求主线程 setup（与 iOS requiresMainQueueSetup=YES 对齐）
    override fun initialize() {
        super.initialize()
    }

    private fun emit(name: String, data: Any?) {
        if (!reactContext.hasActiveReactInstance()) return
        mainHandler.post {
            // ★ 2026-11-08：Bridgeless 新架构下 RCTDeviceEventEmitter.emit 不再做 javaArgs 自动转换，
            //   直接传 org.json.JSONObject 会 RuntimeException 崩溃（真机 19:48 铁证）。
            //   统一转成 WritableMap / 原生可接受类型再 emit。
            // ★ 2026-11-17 二次修复：整段包 try-catch。此前 onEcg 携带超大波形数组时若转换/emit
            //   抛异常，会在主线程静默吞掉 → JS 收不到结果、UI 永久"生成报告"。现在异常必打日志。
            try {
                val safe: Any? = when (data) {
                    null, is String, is Number, is Boolean, is WritableMap, is ReadableArray -> data
                    is JSONObject -> jsonToWritable(data)
                    else -> data.toString()
                }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(name, safe)
            } catch (e: Throwable) {
                android.util.Log.e("VeepooRing", "[VeepooRing ANDROID] emit($name) FAILED: ${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    /** ★ 2026-11-18 修复：波形降采样改为「保峰」算法（min/max decimation）。
     *   原等间隔取样每 ~10 点只取 1 点，窄 QRS 尖峰常被整段跳过 → 波形变畸形锯齿（用户反馈"奇奇怪怪"）。
     *   保峰法把序列分成 max/2 段，每段取「最小值+最大值」一对（按原始时间序输出），
     *   这样每个 R 波尖峰/深 S 谷都被保留，且点数仍 ≤ max，不会撑爆 RN bridge。 */
    private fun downsampleWave(src: List<Double>, max: Int = 2000): JSONArray {
        val arr = JSONArray()
        if (src.isEmpty()) return arr
        if (src.size <= max) {
            for (v in src) arr.put(v)
            return arr
        }
        val buckets = max / 2
        val bucketSize = src.size.toDouble() / buckets
        var b = 0
        while (b < buckets) {
            val start = (b * bucketSize).toInt()
            val end = ((b + 1) * bucketSize).toInt().coerceAtMost(src.size)
            if (start >= end) { b++; continue }
            var minI = start
            var maxI = start
            for (i in start + 1 until end) {
                if (src[i] < src[minI]) minI = i
                if (src[i] > src[maxI]) maxI = i
            }
            // 按原始时间先后输出两个极值，保持波形相位正确
            if (minI <= maxI) { arr.put(src[minI]); arr.put(src[maxI]) }
            else { arr.put(src[maxI]); arr.put(src[minI]) }
            b++
        }
        return arr
    }

    /** ★ 2026-11-18：统一组装 ECG analysis。
     *  QTc / PWV 用 EcgDetectState 真实字段（本机一定持有），填进 analysis 供报告页 metrics 读取
     *  （报告页 QTc 读 analysis.qtc、PWV 读 analysis.pwvMeanVal，之前只放顶层导致显示「—」）。
     *  SDNN/RMSSD/QRS/ST/六风险来自设备多诊断报告 EcgDiagnosis —— 只有真的拿到才写，
     *  拿不到时一个字段都不写：绝不写 0（0 会被 UI 当成"正常值"展示，属编造）。 */
    private fun buildEcgAnalysis(hrv: Int, qtc: Int, pwv: Int, br: Int): JSONObject {
        val a = JSONObject()
        // 设备 state 自带的真实派生值（QT 原始值→JS 层按 Bazett 换算 QTc；PWV→m/s×10）
        if (qtc > 0) a.put("qtcRaw", qtc)
        if (pwv > 0) a.put("pwvMeanVal", pwv)
        if (br > 0) a.put("respRate", br)
        if (hrv > 0) a.put("hrv", hrv)
        // 多诊断报告（本机只在新回调真的回传时才持有）
        ecgDiagnosis?.let { d ->
            if (d.diseaseRisk > 0) a.put("arrhythmiaRisk", d.diseaseRisk)
            if (d.pressureIndex > 0) a.put("stressIndex", d.pressureIndex)
            if (d.fatigueIndex > 0) a.put("fatigueIndex", d.fatigueIndex)
            if (d.myocarditisRisk > 0) a.put("myocarditisRisk", d.myocarditisRisk)
            if (d.chdRisk > 0) a.put("chdRisk", d.chdRisk)
            if (d.angioscleroticRisk > 0) a.put("angiosclerosisRisk", d.angioscleroticRisk)
            if (d.qrsTime > 0) a.put("qrsTime", d.qrsTime)
            if (d.qrsAmp > 0) a.put("qrsAmp", d.qrsAmp)
            if (d.stMeanAmp != 0) a.put("stMeanAmp", d.stMeanAmp)
            if (d.pwvMeanVal > 0) a.put("pwvMeanVal", d.pwvMeanVal)
            if (d.diseaseSdnn > 0) a.put("sdnn", d.diseaseSdnn)
            if (d.diseaseRmssd > 0) a.put("rmssd", d.diseaseRmssd)
            if (d.qtTime > 0) a.put("qtcRaw", d.qtTime)
        }
        // ★ 2026-11-19(v62)：设备多诊断没回传 SDNN/RMSSD 时，用本次 RR 间期本地统计补齐。
        //   ≥10 个样本才算（30s 测量正常能收 20–30 个）；来源标注 'rr-local'，
        //   EcgDetailScreen 据此在页脚注明「本地计算」，与设备真值区分。
        if ((!a.has("sdnn") || !a.has("rmssd")) && ecgRrBuf.size >= 10) {
            val rr = ecgRrBuf.map { it.toDouble() }
            val mean = rr.average()
            val sdnn = Math.sqrt(rr.sumOf { (it - mean) * (it - mean) } / (rr.size - 1).coerceAtLeast(1))
            var sq = 0.0
            for (i in 1 until rr.size) { val d = rr[i] - rr[i - 1]; sq += d * d }
            val rmssd = Math.sqrt(sq / (rr.size - 1).coerceAtLeast(1))
            if (!a.has("sdnn") && sdnn > 0) { a.put("sdnn", Math.round(sdnn)); a.put("sdnnSource", "rr-local") }
            if (!a.has("rmssd") && rmssd > 0) { a.put("rmssd", Math.round(rmssd)); a.put("rmssdSource", "rr-local") }
            log("[VeepooRing ANDROID] ECG RR-local n=${rr.size} sdnn=${Math.round(sdnn)} rmssd=${Math.round(rmssd)}")
        }
        return a
    }

    /** ★ 2026-11-20(v69)：诊断回调一到就把完整诊断字段 emit 给前端局部合并。
     *  真机实证这枚戒指(ecgType=9)会回传完整 EcgDiagnosis，只是回调晚于结果帧；
     *  这条事件让已交付的报告补上 6 大风险指数 + QRS/ST/SDNN/RMSSD，无需读历史。 */
    private fun emitEcgDiagnosisUpdate(d: EcgDiagnosis) {
        try {
            val a = JSONObject()
            if (d.diseaseRisk > 0) a.put("arrhythmiaRisk", d.diseaseRisk)
            if (d.pressureIndex > 0) a.put("stressIndex", d.pressureIndex)
            if (d.fatigueIndex > 0) a.put("fatigueIndex", d.fatigueIndex)
            if (d.myocarditisRisk > 0) a.put("myocarditisRisk", d.myocarditisRisk)
            if (d.chdRisk > 0) a.put("chdRisk", d.chdRisk)
            if (d.angioscleroticRisk > 0) a.put("angiosclerosisRisk", d.angioscleroticRisk)
            if (d.qrsTime > 0) a.put("qrsTime", d.qrsTime)
            if (d.qrsAmp > 0) a.put("qrsAmp", d.qrsAmp)
            if (d.stMeanAmp != 0) a.put("stMeanAmp", d.stMeanAmp)
            if (d.pwvMeanVal > 0) a.put("pwvMeanVal", d.pwvMeanVal)
            if (d.diseaseSdnn > 0) a.put("sdnn", d.diseaseSdnn)
            if (d.diseaseRmssd > 0) a.put("rmssd", d.diseaseRmssd)
            if (d.qtTime > 0) a.put("qtcRaw", d.qtTime)
            if (d.hrv > 0) a.put("hrv", d.hrv)
            if (d.heartRate > 0) a.put("deviceHeartRate", d.heartRate)
            if (a.length() == 0) { android.util.Log.e("DIAGGATE", "DIAG-EMIT skip: all fields empty"); return }
            android.util.Log.e("DIAGGATE", "DIAG-EMIT emit onEcgDiagnosis fields=${a.length()} $a")
            emit("onEcgDiagnosis", a)
        } catch (e: Throwable) {
            android.util.Log.e("DIAGGATE", "DIAG-EMIT exception ${e.message}")
        }
    }

    /** ★ 2026-11-20(v64→v66)：主动读回设备端 ECG 多诊断报告，补齐实时回调不返回的风险指数/医学指标。
     *  竞品（用户截图同款）走 readECGId → readECGManuallyData 两步读历史诊断。
     *  测量结束时设备可能还在算，故延迟 6s 再读；ALL / MANUALLY 两种类型都试，定位设备究竟存哪种。
     *  读到后 emit onEcgDiagnosis 让前端局部更新最新一条报告（不新增记录、不改 ts）。 */
    private fun scheduleEcgDiagnosisRead() {
        mainHandler.postDelayed({
            if (!ready.get()) return@postDelayed
            tryEcgReadIds(com.veepoo.protocol.model.enums.EEcgDataType.ALL)
            // MANUALLY 类型隔 1s 再试，覆盖"仅手动测量存诊断"的固件
            mainHandler.postDelayed({
                if (ready.get()) tryEcgReadIds(com.veepoo.protocol.model.enums.EEcgDataType.MANUALLY)
            }, 1_000L)
        }, 6_000L)
    }

    /** 用指定类型读 ECG 历史 ID 列表。 */
    private fun tryEcgReadIds(typ: com.veepoo.protocol.model.enums.EEcgDataType) {
        // 起始时间放宽到 1 年前，排除时间窗口问题
        val start = TimeData(System.currentTimeMillis() - 365L * 86400 * 1000)
        var idSettled = false
        val idWd = Runnable { if (!idSettled) { idSettled = true; log("[VeepooRing ANDROID] ECG readId[$typ] timeout 8s") } }
        mainHandler.postDelayed(idWd, 8_000L)
        try {
            manager.readECGId(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] ECG readId[$typ] write resp=$code")
                if (code != 0) idWd.run()
            }, start, typ, object : com.veepoo.protocol.listener.data.IECGReadIdListener {
                override fun readIdFinish(ids: IntArray?) {
                    mainHandler.removeCallbacks(idWd)
                    if (idSettled) return
                    idSettled = true
                    log("[VeepooRing ANDROID] ECG readId[$typ] finish n=${ids?.size ?: 0} ids=${ids?.joinToString()}")
                    if (ids == null || ids.isEmpty()) { log("[VeepooRing ANDROID] ECG readId[$typ] 无历史诊断记录"); return }
                    readEcgDiagnosisByIds(ids)
                }
            })
        } catch (e: Throwable) {
            mainHandler.removeCallbacks(idWd)
            log("[VeepooRing ANDROID] ECG readId[$typ] EXCEPTION ${e.message}")
        }
    }

    /** 按 ECG 记录 ID 列表读回诊断报告（readECGManuallyData 第二步）。 */
    private fun readEcgDiagnosisByIds(ids: IntArray) {
        var settled = false
        val wd = Runnable { if (!settled) { settled = true; log("[VeepooRing ANDROID] ECG diagnosis data timeout 10s") } }
        mainHandler.postDelayed(wd, 10_000L)
        try {
            manager.readECGManuallyData(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] ECG diagnosis data write resp=$code")
                if (code != 0) wd.run()
            }, ids, object : com.veepoo.protocol.listener.data.IECGReadDataListener {
                override fun readDataFinish(list: MutableList<EcgDetectResult>?) {
                    log("[VeepooRing ANDROID] ECG diagnosis readDataFinish n=${list?.size ?: 0}")
                }
                override fun readDiagnosisDataFinish(list: MutableList<EcgDiagnosis>?) {
                    mainHandler.removeCallbacks(wd)
                    if (settled) return
                    settled = true
                    val items = list ?: run { log("[VeepooRing ANDROID] ECG diagnosis null list"); return }
                    if (items.isEmpty()) { log("[VeepooRing ANDROID] ECG diagnosis empty"); return }
                    val latest = items.maxByOrNull { it.timeBean?.getTimestampSeconds() ?: 0 } ?: return
                    ecgDiagnosis = latest
                    val d = latest
                    val a = JSONObject()
                    if (d.diseaseRisk > 0) a.put("arrhythmiaRisk", d.diseaseRisk)
                    if (d.pressureIndex > 0) a.put("stressIndex", d.pressureIndex)
                    if (d.fatigueIndex > 0) a.put("fatigueIndex", d.fatigueIndex)
                    if (d.myocarditisRisk > 0) a.put("myocarditisRisk", d.myocarditisRisk)
                    if (d.chdRisk > 0) a.put("chdRisk", d.chdRisk)
                    if (d.angioscleroticRisk > 0) a.put("angiosclerosisRisk", d.angioscleroticRisk)
                    if (d.qrsTime > 0) a.put("qrsTime", d.qrsTime)
                    if (d.qrsAmp > 0) a.put("qrsAmp", d.qrsAmp)
                    if (d.stMeanAmp != 0) a.put("stMeanAmp", d.stMeanAmp)
                    if (d.pwvMeanVal > 0) a.put("pwvMeanVal", d.pwvMeanVal)
                    if (d.diseaseSdnn > 0) a.put("sdnn", d.diseaseSdnn)
                    if (d.diseaseRmssd > 0) a.put("rmssd", d.diseaseRmssd)
                    if (d.qtTime > 0) a.put("qtcRaw", d.qtTime)
                    if (d.heartRate > 0) a.put("deviceHeartRate", d.heartRate)
                    log("[VeepooRing ANDROID] ECG diagnosis OK ts=${d.timeBean?.getTimestampSeconds()} risk=${d.diseaseRisk} chd=${d.chdRisk} qrs=${d.qrsTime} st=${d.stMeanAmp} sdnn=${d.diseaseSdnn}")
                    emit("onEcgDiagnosis", a)
                }
            })
        } catch (e: Throwable) {
            mainHandler.removeCallbacks(wd)
            log("[VeepooRing ANDROID] ECG diagnosis data EXCEPTION ${e.message}")
        }
    }

    /** org.json.JSONObject → WritableMap（Bridgeless emit 兼容转换） */
    private fun jsonToWritable(o: JSONObject): WritableMap {
        val m = Arguments.createMap()
        for (key in o.keys()) {
            when (val v = o.opt(key)) {
                null -> m.putNull(key)
                is Boolean -> m.putBoolean(key, v)
                is Int -> m.putInt(key, v)
                is Long -> m.putDouble(key, v.toDouble())
                is Double -> m.putDouble(key, v)
                is String -> m.putString(key, v)
                is JSONObject -> m.putMap(key, jsonToWritable(v))
                is JSONArray -> m.putArray(key, jsonToWritableArray(v))
                else -> m.putString(key, v.toString())
            }
        }
        return m
    }

    private fun jsonToWritableArray(a: JSONArray): WritableArray {
        val arr = Arguments.createArray()
        for (i in 0 until a.length()) {
            when (val v = a.opt(i)) {
                null -> arr.pushNull()
                is Boolean -> arr.pushBoolean(v)
                is Int -> arr.pushInt(v)
                is Long -> arr.pushDouble(v.toDouble())
                is Double -> arr.pushDouble(v)
                is String -> arr.pushString(v)
                is JSONObject -> arr.pushMap(jsonToWritable(v))
                is JSONArray -> arr.pushArray(jsonToWritableArray(v))
                else -> arr.pushString(v.toString())
            }
        }
        return arr
    }

    private fun log(msg: String) {
        emit("onLog", msg)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 扫描
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun scan() {
        log("[VeepooRing ANDROID] scan start")
        scannedDevices.clear()
        // TODO(veepoo): 验证 SearchRequest 的扫描参数（时长/类型）是否符合 HK18；
        // 若 startScanDevice 需要额外 setScanTime，请在此补充。
        val request = SearchRequest.Builder()
            .searchBluetoothLeDevice(Constants.SCAN_TIME)
            .build()
        // SearchResponse 是接口：object 表达式不能带括号
        val response: SearchResponse = object : SearchResponse {
            override fun onSearchStarted() {
                log("[VeepooRing ANDROID] scan started")
            }

            override fun onDeviceFounded(device: SearchResult) {
                val name = device.name ?: device.device?.name ?: ""
                val mac = device.device?.address ?: ""
                if (mac.isBlank()) return
                val obj = JSONObject().apply {
                    put("name", name)
                    put("address", mac)
                    put("rssi", device.rssi)
                }
                // 仅上报名字里带 ring/mira/hk 的设备，避免刷屏（可按需放宽）
                val lower = name.lowercase()
                if (lower.contains("ring") || lower.contains("mira") || lower.contains("hk")
                    || lower.contains("veepoo") || lower.contains("bp") || lower.contains("watch")) {
                    scannedDevices.removeAll { it.optString("address") == mac }
                    scannedDevices.add(obj)
                    emit("onState", JSONObject().apply {
                        put("status", "scanResult")
                        put("devices", JSONArray(scannedDevices))
                    })
                }
            }

            override fun onSearchStopped() {
                log("[VeepooRing ANDROID] scan stopped")
                emitScanFinished()
            }

            override fun onSearchCanceled() {
                log("[VeepooRing ANDROID] scan canceled")
                emitScanFinished()
            }
        }
        // TODO(veepoo): 部分 SDK 版本 startScanDevice 仅接受 SearchResponse；
        // 若编译报参数不匹配，改为 manager.startScanDevice(request, response) 或 manager.search(request, response)。
        manager.startScanDevice(response)
    }

    /**
     * ★ 2026-11-13（用户有两枚戒指）：扫描窗口结束后上报「最终设备列表」。
     *   onDeviceFounded 是流式的，第一枚出现时第二枚可能还没广播；JS 必须等这一帧
     *   final:true 才能按数量决策（1 枚直连 / ≥2 枚全部列出让用户选）。
     *   onSearchStopped 与 onSearchCanceled 可能都回调，JS 侧用 scanDecisionDone 去重。
     */
    private fun emitScanFinished() {
        val devices = JSONArray(scannedDevices.toList())
        emit("onState", JSONObject().apply {
            put("status", "scanResult")
            put("devices", devices)
            put("final", true)
        })
        log("[VeepooRing ANDROID] scan finished, devices=${devices.length()}")
    }

    @ReactMethod
    fun stopScan() {
        manager.stopScanDevice()
        log("[VeepooRing ANDROID] scan stopped by user")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 连接 + 鉴权
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun connect(address: String) {
        log("[VeepooRing ANDROID] connect $address")
        connectedMac = address
        // ★ 2026-11-16：记住 MAC 并开启「允许自动重连」（跨进程持久化，闹钟唤醒后要用）。
        RingReconnectAlarm.rememberMac(reactContext.applicationContext, address)
        // ★ 2026-11-18（用户）：启动「每小时主动连接上次戒指 + 更新数据」常驻闹钟。
        //   连上后不撤销，每小时到点唤醒进程；没连就直连、连着就回填数据。
        RingReconnectAlarm.startHourly(reactContext.applicationContext, address)
        registerReconnectRequestReceiver()
        // ★ 2026-11-15：连接前先注册掉线监听 —— 戒指被动断开（没电/离开范围/被旧手机占用）
        //   时 SDK 会回调 STATUS_DISCONNECTED → emit onState → JS autoLink 自动重连。
        //   必须在 connectDevice 之前注册，否则连接建立瞬间的掉线会漏掉。
        registerConnectStatus(address)
        // SDK 内部若重新 init，静态开关可能被重置；每次连接前再确认一次（开销为零）。
        try { VPOperateManager.setShowFunctionNotSupportToast(false) } catch (_: Throwable) {}
        manager.connectDevice(address,
            IConnectResponse { code, _, _ ->
                if (code == com.inuker.bluetooth.library.Code.REQUEST_SUCCESS) {
                    log("[VeepooRing ANDROID] BLE connected")
                } else {
                    emit("onState", JSONObject().apply {
                        put("status", "error")
                        put("reason", "connect_failed")
                        put("error", "connect_failed")
                    })
                }
            },
            INotifyResponse { state ->
                if (state == com.inuker.bluetooth.library.Code.REQUEST_SUCCESS) {
                    emit("onState", JSONObject().apply { put("status", "connected") })
                    // 通知打开成功后做密码校验 + 个人信息同步（与 iOS 流程一致）
                    confirmDevicePwdAndSync()
                } else {
                    emit("onState", JSONObject().apply {
                        put("status", "error")
                        put("reason", "notify_failed")
                        put("error", "notify_failed")
                    })
                }
            })
    }

    private fun confirmDevicePwdAndSync() {
        // TODO(veepoo): 默认密码 "0000"，若戒指改过密码需作为参数传入。
        val pwd = "0000"
        manager.confirmDevicePwd(
            IWriteResponseOk(),
            // IPwdDataListener 有两个抽象方法，SAM lambda 不适用，用 object 表达式
            object : com.veepoo.protocol.listener.data.IPwdDataListener {
                override fun onPwdDataChange(data: com.veepoo.protocol.model.datas.PwdData?) {
                    // ★ 2026-11-13（用户：「固件不显示，连的时候不知道要连哪个戒指」）：
                    //   PwdData 里就有 deviceVersion（固件版本）/ deviceTestVersion / deviceNumber，
                    //   旧实现只打了句 pwd ok 就丢掉，原生从没把固件传给 JS，
                    //   所以设置页「固件」恒为「待同步」，扫描列表也无从区分两枚同名戒指。
                    //   这里 emit 一帧 deviceInfo，JS 的通用 patch 分支会把 firmware 落到
                    //   RingState.firmware，并按 MAC 写入 ringDeviceCard 名片供选戒指时展示。
                    val fw = data?.deviceVersion?.takeIf { it.isNotBlank() }
                    log("[VeepooRing ANDROID] pwd ok, deviceNumber=${data?.deviceNumber} " +
                        "firmware=$fw testVersion=${data?.deviceTestVersion}")
                    if (fw != null) {
                        emit("onState", JSONObject().apply {
                            put("status", "deviceInfo")
                            put("firmware", fw)
                            put("deviceAddress", connectedMac)
                        })
                    }
                }
                override fun onConnectionConfirmTimeout() {
                    log("[VeepooRing ANDROID] pwd confirm timeout")
                }
            },
            object : IDeviceFuctionDataListener {
                override fun onFunctionSupportDataChange(support: com.veepoo.protocol.model.datas.FunctionDeviceSupportData?) {
                    log("[VeepooRing ANDROID] function support: ${support?.toString()}")
                    // ★ 2026-11-09：记下设备可存储天数，回填窗口据此收敛（默认 7）。
                    val wd = support?.wathcDay ?: 7
                    deviceWatchday = wd.coerceIn(1, 14)
                    log("[VeepooRing ANDROID] deviceWatchday=$deviceWatchday")
                    // ★ 2026-11-13：缓存设备能力，供 ensureAutoMeasure / startSpo2hOnly 做门禁
                    capBp = support?.bp?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    capHrv = support?.hrvFunction?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    capSpo2 = support?.spo2H?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    capPulse = support?.heartDetect?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    // ★ 2026-11-17：ECG/血糖用固件真实能力位（非 VpSpGetUtil 本地设备类型）
                    capEcg = support?.ecg?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    capGlucose = support?.bloodGlucose?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    // ★ 2026-11-18：血糖模式三态实测（决定 startBloodGlucoseDetect 用公开还是私有命令）。
                    //   Veepoo 血糖功能分级：基础=公开模式；MultipleAdjusting=SUPPORT → 私有模式+多点校准。
                    //   真机此前表现（公开命令后设备 1s 内 stop）高度疑似私有模式固件。
                    val gAdj = support?.bloodGlucoseAdjusting?.let { it != EFunctionStatus.UNSUPPORT } ?: false
                    val gMulti = support?.bloodGlucoseMultipleAdjusting?.let { it != EFunctionStatus.UNSUPPORT } ?: false
                    glucosePrivateMode = gMulti
                    capBloodComponent = support?.bloodComponent?.let { it != EFunctionStatus.UNSUPPORT } ?: true
                    log("[VeepooRing ANDROID] caps bp=$capBp hrv=$capHrv spo2=$capSpo2 pulse=$capPulse ecg=$capEcg glucose=$capGlucose adjusting=$gAdj multipleAdjusting=$gMulti (privateMode=$gMulti) bloodComponent=$capBloodComponent")
                    // 密码校验回调里做个人信息同步
                    syncPersonInfo()
                }
                override fun onDeviceFunctionPackage1Report(p0: com.veepoo.protocol.model.datas.DeviceFunctionPackage1?) {}
                override fun onDeviceFunctionPackage2Report(p0: com.veepoo.protocol.model.datas.DeviceFunctionPackage2?) {}
                override fun onDeviceFunctionPackage3Report(p0: com.veepoo.protocol.model.datas.DeviceFunctionPackage3?) {}
                override fun onDeviceFunctionPackage4Report(p0: com.veepoo.protocol.model.datas.DeviceFunctionPackage4?) {}
                override fun onDeviceFunctionPackage5Report(p0: com.veepoo.protocol.model.datas.DeviceFunctionPackage5?) {}
            },
            object : com.veepoo.protocol.listener.data.ISocialMsgDataListener {
                override fun onSocialMsgSupportDataChange(data: com.veepoo.protocol.model.datas.FunctionSocailMsgData?) {}
                override fun onSocialMsgSupportDataChange2(data: com.veepoo.protocol.model.datas.FunctionSocailMsgData?) {}
            },
            pwd,
            false
        )
    }

    private fun syncPersonInfo() {
        // TODO(veepoo): 核对 syncPersonInfo 的实际签名（部分版本需要 PersonInfoData 参数）。
        // 这里用最简重载；若编译失败请按 apidoc 补 PersonInfoData。
        try {
            manager.syncPersonInfo(IBleWriteResponse { _ -> }, null, null)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] syncPersonInfo fallback: ${e.message}")
        }
        ready.set(true)
        emit("onState", JSONObject().apply { put("status", "ready") })
        // ★ 2026-11-15（P0-1）：旧实现在认证成功的同一帧连发 4 组写命令，和 JS 的
        //   setAutoMonitor / ensureAutoMeasureNow / 全量回填读命令挤在 3 秒内打爆单通道
        //   → 真机表现为「刚连上 3 秒就掉线」。现在错峰 0.8/1.4/2.0/2.6s，且若同步
        //   事务已在途则统一排队到事务收口后回放（见 runOrDeferWrite / flushDeferredWrites）。
        val writes: List<Pair<String, () -> Unit>> = listOf(
            "syncDeviceTime" to { syncDeviceTime(true) },
            "startRealtimeIfNeeded" to { startRealtimeIfNeeded() },
            "ensureAutoMeasure" to { ensureAutoMeasure() },
            "startPpgReleaseCycle" to { startPpgReleaseCycle() },
        )
        writes.forEachIndexed { i, (tag, block) ->
            mainHandler.postDelayed({ runOrDeferWrite(tag, block) }, 800L + i * 600L)
        }
    }

    @ReactMethod
    fun disconnect() {
        ready.set(false)
        stopPpgReleaseCycle()
        stopSnapshotRotation()
        stopChronicVitals()
        // ★ 2026-11-22（P0 死锁）：主动断开也清锁，避免残留事务锁污染下次连接。
        forceReleaseSyncLocksOnDisconnect()
        autoMeasureWritten.clear()
        // ★ 2026-11-17：断连时归还 ECG/血糖通道，避免 listener 残留占着 PPG 或误回调
        stopEcgInternal("disconnect")
        stopGlucoseInternal("disconnect")
        // ★ 2026-11-16：用户在 App 内主动断开 → 关掉自动重连、撤闹钟，别自己又连回来。
        RingReconnectAlarm.setActive(reactContext.applicationContext, false)
        // SDK 方法名是 disconnectWatch（需传入写回调）
        manager.disconnectWatch(IBleWriteResponse { _ -> })
        // ★ 2026-11-15：主动断开时注销掉线监听，避免与 SDK 随后回调的 STATUS_DISCONNECTED
        //   重复 emit、也防止 listener 随连接反复累积造成泄漏。
        unregisterConnectStatus()
        log("[VeepooRing ANDROID] disconnected")
        emit("onState", JSONObject().apply { put("status", "disconnected") })
    }

    @ReactMethod
    fun setAutoMonitor(on: Boolean) {
        monitorOn = on
        // ★ 2026-11-15：connected 边沿 JS 会立刻调本方法，与 origin3 读命令抢通道。
        if (on) runOrDeferWrite("startRealtime(autoMonitor)") { startRealtimeIfNeeded() }
        else runOrDeferWrite("stopRealtime(autoMonitor)") { stopRealtime() }
        // ★ v61：GSR/微体检快照轮询随自动监测启停（对齐 iOS startRotationIfNeeded）
        if (on) startSnapshotRotation() else stopSnapshotRotation()
        // ★ 2026-11-21：血糖/血液成分低频自动测量（每2h交替）随自动监测启停
        if (on) startChronicVitals() else stopChronicVitals()
        log("[VeepooRing ANDROID] autoMonitor=$on")
    }

    private fun startSnapshotRotation() {
        if (snapshotRotationArmed) return
        snapshotRotationArmed = true
        snapshotRotationIdx = 0
        snapshotTestInProgress = false
        // 首轮延后 8s：避开 connected 边沿的 origin3 回填/实时流启动，防通道竞争
        snapshotRotationHandler.postDelayed(snapshotRotationRunnable, 8_000L)
        log("[VeepooRing ANDROID] snapshot rotation started (miniCheckup/GSR every ${SNAPSHOT_ROTATION_INTERVAL_MS/1000}s)")
    }

    private fun stopSnapshotRotation() {
        if (!snapshotRotationArmed) return
        snapshotRotationArmed = false
        snapshotTestInProgress = false
        snapshotRotationHandler.removeCallbacks(snapshotRotationRunnable)
        log("[VeepooRing ANDROID] snapshot rotation stopped")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 实时指标
    // ─────────────────────────────────────────────────────────────────────────
    private var hrListener: IHeartDataListener? = null
    private var spo2Listener: ISpo2hDataListener? = null
    private var batteryListener: IBatteryDataListener? = null

    private fun startRealtimeIfNeeded() {
        if (!ready.get()) {
            log("[VeepooRing ANDROID] 设备仍在初始化，稍后再开启实时")
            return
        }
        // 分时让出 PPG 通道期间不要被 ready 事件重新拉起血氧流，否则静默窗口失效
        if (ppgReleaseActive) {
            log("[VeepooRing ANDROID] PPG release in progress, skip realtime restart")
            return
        }
        // ★ 2026-11-09：本固件 PPG 通道一次只能跑一个检测。旧实现把
        //   startDetectHeart 与 startDetectSPO2H 连着发，SDK 写队列只保留后者 ——
        //   真机实证 heart_read_oprate 全程 0 次、spo2h_read_oprate 每秒一条。
        //   默认保持血氧连续流；心率改由 ensureAutoMeasure()（戒指端周期采集）
        //   与 measure("hr")（分时独占 PPG 的即时测量）两条路径提供。
        startSpo2hOnly()
        // ★ 2026-11-16：启动佩戴看门狗（摘下后流静默 → 判脱手 → JS 冻结数据）
        startWearWatchdog()
    }

    private fun startSpo2hOnly() {
        if (spo2Listener == null) {
            spo2Listener = object : ISpo2hDataListener {
                override fun onSpO2HADataChange(data: Spo2hData?) {
                    data ?: return
                    val spo2 = data.value
                    val hr = data.rateValue
                    val ts = System.currentTimeMillis()

                    // ★ 2026-11-16（用户：摘下戒指数据还在更新）：读 SDK 佩戴状态。
                    //   Spo2hData.getDeviceState() 枚举含 UNPASS_WEAR（设备佩戴不通过），
                    //   官方 Demo 的血氧页就用它拦「❌佩戴不通过」。用 name 字符串比较，
                    //   不 import 枚举类，避免不同 SDK 版本枚举常量差异导致编译失败。
                    val deviceStateName = try { data.deviceState?.name ?: "" } catch (_: Throwable) { "" }
                    if (deviceStateName == "UNPASS_WEAR") {
                        setWorn(false, "deviceState=UNPASS_WEAR")
                        // 佩戴不通过时的血氧/心率是接触性脏值，不上报（源头拦截）
                        return
                    }
                    // ★ 2026-11-18：任何血氧帧到达都刷新「帧锚点」（含 value=0 的帧），
                    //   这是判脱手的唯一依据。注意必须放在 UNPASS_WEAR return 之后——
                    //   佩戴不通过时 rings 虽仍发帧，但那是接触性脏值，不该算「戴着」。
                    lastAnySpo2FrameAt = ts

                    // 收到有效血氧（非让出/测量窗口）→ 判定已佩戴（从脱手态恢复的正向信号）
                    if (spo2 > 0 && !ppgReleaseActive && bpDetectListener == null && hrvDetectListener == null) {
                        lastSpO2SampleAt = ts
                        if (worn != true) setWorn(true, "valid spo2=$spo2")
                    }
                    if (spo2 > 0) {
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "spo2")
                            put("value", spo2)
                            put("unit", "%")
                            put("ts", ts)
                        })
                    }
                    // ★ 2026-11-09（用户：戴着戒指却没有实时心率）：
                    //   Spo2hData 自带 rateValue(心率)，但旧实现只取 value(血氧) 且 spo2<=0 直接 return，
                    //   把心率整个丢掉。真机日志实证 heart_read_oprate 全程 0 次、spo2h_read_oprate 每秒一条
                    //   ——本固件下 startDetectHeart 与连续 SPO2H 互斥，PPG 通道被 SPO2H 独占。
                    //   直接从这条已在跑的流里带出 HR，无需抢通道，实时心率与逐秒序列即可恢复。
                    if (hr in 30..200) {
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "hr")
                            put("value", hr)
                            put("unit", "bpm")
                            put("ts", ts)
                        })
                    }
                }
            }
            if (capSpo2 == false) {
                log("[VeepooRing ANDROID] spo2 unsupported by device, skip startDetectSPO2H (avoid SDK toast)")
            } else {
                manager.startDetectSPO2H(IBleWriteResponse { _ -> }, spo2Listener)
            }
            startHrSampling()
        }
    }

    private fun stopRealtime() {
        stopHrSampling()
        stopPpgReleaseCycle()
        stopWearWatchdog()
        // SDK 的 stop 方法都要求传入写回调；SpO2H 还需原监听器
        manager.stopDetectHeart(IBleWriteResponse { _ -> })
        spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
        hrListener = null
        spo2Listener = null
    }

    /**
     * ★ 2026-11-09（用户：现在戴着戒指，点心率却没值）：
     * 让 HR 检测独占 PPG 通道 20 秒——先停连续血氧检测，测完再恢复。
     * 这是本固件下唯一能拿到实时心率的办法（两个检测不能并存）。
     */
    /** ★ 2026-11-18：durationMs 可配（一键体检快速档用 12s 短窗口压总时长；5 分钟定时采样等
     *  其余调用不传 → 维持 20s 原窗口，行为不变）。 */
    private fun startSingleHeartDetect(durationMs: Long = 20_000L) {
        if (!ready.get()) { startRealtimeIfNeeded(); return }
        // 静默窗口内绝不抢 PPG，否则戒指的 HRV/血压自测又会被打断
        if (ppgReleaseActive) return
        // ★ 2026-11-14（真机 17:29:15 实锤）：5 分钟定时器在 BP 检测进行中也能开跑，
        //   两个「single HR detect started」叠着把 PPG 从血压手里抢走 → 血压 progress 卡中段。
        //   BP/HRV 主动测量独占期内心率采样必须让路。
        if (bpDetectListener != null || hrvDetectListener != null) {
            log("[VeepooRing ANDROID] single HR detect skip: BP/HRV detect in progress")
            return
        }
        try {
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            manager.stopDetectHeart(IBleWriteResponse { _ -> })
            hrListener = object : IHeartDataListener {
                override fun onDataChange(data: HeartData?) {
                    val hr = data?.data ?: return
                    if (hr <= 0) return
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "hr")
                        put("value", hr)
                        put("unit", "bpm")
                        put("ts", System.currentTimeMillis())
                    })
                }
            }
            manager.startDetectHeart(IBleWriteResponse { _ -> }, hrListener)
            log("[VeepooRing ANDROID] single HR detect started (${durationMs / 1000}s window)")
            Handler(Looper.getMainLooper()).postDelayed({
                try { manager.stopDetectHeart(IBleWriteResponse { _ -> }) } catch (_: Exception) {}
                hrListener = null
                // ★ 2026-11-18：HR 采样独占 PPG 20s，血氧流刚恢复时帧还没到。
                //   把帧锚点前移，给恢复期 20s 缓冲，否则采样结束瞬间静默已≈20s，
                //   看门狗立刻误判脱手（真机 20:38 null->false 实锤）。
                val hrDoneAt = System.currentTimeMillis()
                if (lastAnySpo2FrameAt < hrDoneAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = hrDoneAt
                // 让出窗口期间这个迟到的回调不能把血氧拉起来，静默必须由 releasePpgForAutoMeasure 统一收口
                if (monitorOn && !ppgReleaseActive) startSpo2hOnly()
                log("[VeepooRing ANDROID] single HR detect done, spo2h resumed")
            }, durationMs)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] single HR detect FAILED: ${e.message}")
            hrListener = null
            if (monitorOn && !ppgReleaseActive) startSpo2hOnly()
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ★ 2026-11-14（用户拍板「一键体检加 BP/HRV 主动测量」）：App 主动发起一次测量。
    //   结果按 onRealtime {metric: bpSys/bpDia/hrv, value, ts} 回流 —— 与现有
    //   handleRealtime → healthStore.upsertRealtime + scheduleRecompute 全链路同源，
    //   洞察页卡片 / 首页 / 体检报告自动一起刷新，不需要第二条通道。
    //   硬约束：PPG 一次只能跑一个检测（2026-11-09 实锤），进入前先停血氧流；
    //   出数即停归还通道；超时兜底 stop，绝不长期占着 PPG。
    // ─────────────────────────────────────────────────────────────────────────
    private var bpDetectListener: IBPDetectDataListener? = null
    private var hrvDetectListener: IHrvDetectListener? = null
    // ★ v81（用户：戒指戴着贴着传感器，但 GSR/微体检从不发起）：HRV listener 挂死自愈。
    //   startHrvDetect 兜底 stop 后未置 null、失败/停止回调也未置 null → listener 永久挂着。
    //   tickSnapshotRotation 见 hrvDetectListener!=null 就 return，导致 GSR/miniCheckup 永远轮不到。
    //   记录发起时刻，超过 STALE 阈值由 tick 强制归还通道。
    @Volatile private var hrvDetectStartedAt = 0L
    private val HRV_STALE_MS = 35_000L
    // ★ 2026-11-14（用户反馈血压主动测「不出值」）：JS 侧会自动重试一次 measure('bp')，
    //   startBpDetect 必须可重入 —— 重入时先取消上一次的兜底 stop，再停掉可能仍在跑的
    //   上一轮检测，从干净状态发起本轮；否则两个 startDetectBP 叠加、旧 stop 会误杀新一轮。
    private var bpPendingStop: Runnable? = null

    // ★ 2026-11-17：ECG / 血糖主动测量监听与兜底。与 BP/HRV 一样占用 PPG 通道，须串行、出值即停。
    private var ecgDetectListener: IECGDetectListener? = null
    private var ecgPendingStop: Runnable? = null
    /** ★ 2026-11-17：最后一次收到进度/波形帧的时间戳。停滞看门狗据此判断是否真卡住，
     *   避免"测量正常推进到 100%、结果帧还在算"时被固定超时误杀（曾导致卡在生成报告）。 */
    private var ecgLastActiveAt = 0L
    /** ECG 波形已回传给 JS 的采样数（增量 emit onEcgProgress.waveform，避免每帧重发整段）。 */
    private var ecgSentCount = 0
    /** ★ 2026-11-17：累积本次 ECG 波形(mV)，供 progress=100 从 state 兜底出结果时一并 emit。
     *   这台戒指固件的 onEcgDetectResultChange 从不触发，结果须像 iOS 一样从 state 帧取。 */
    private val ecgWaveBuf = mutableListOf<Double>()
    /** ★ 2026-11-19(v62)：本次 ECG 的 RR 间期序列(ms)，来自 EcgDetectState.rr1（每秒 RR）。
     *   设备多诊断报告只在「检出异常」时才回传 SDNN/RMSSD（协议行为），正常读数没有——
     *   本地用 RR 序列统计补齐 SDNN/RMSSD，sdnnSource='rr-local' 与设备真值区分。 */
    private val ecgRrBuf = mutableListOf<Int>()
    /** 结果是否已 emit（state 兜底 与 result 回调 双路去重，只认第一次）。 */
    private var ecgResultEmitted = false
    /** ★ 2026-11-17 二次修复：结果是否已真正交付给 JS。独立于 ecgResultEmitted，
     *   100% 兜底定时器只认这个标志——避免 result 回调把 ecgResultEmitted 提前置 true 后
     *   既没出值、又把 state 兜底挡死（本次卡死的直接原因）。 */
    private var ecgDelivered = false
    /** ★ 进度首次到 100% 的时刻（0=未到）。100% 视为"测量完成"权威信号，到点起算强制交付兜底。 */
    private var ecgReached100At = 0L
    /** ★ 100% 后 1.5s 仍未出值时的强制交付任务（用 state 快照 + 累积波形出值）。 */
    private var ecgFinishGuard: Runnable? = null
    /** ★ 最近一帧 state 的结果字段快照，供 100% 兜底出值（回调对象在延迟任务里可能已释放）。 */
    private var ecgSnapHr = 0
    private var ecgSnapHrv = 0
    private var ecgSnapQtc = 0
    private var ecgSnapPwv = 0
    private var ecgSnapBr = 0
    /** ECG 导联脱落连续计数（三振容忍：前 2 次只发 hint，第 3 次判失败，对齐 iOS）。 */
    private var ecgNotLeadCount = 0
    /** 诊断日志节流：避免 ECG 状态帧高频刷屏。 */
    private var ecgLastStateLog = ""
    /** ECG 多诊断报告缓存（onEcgDetectDiagnosisChange 先到，结果帧再一起 emit）。 */
    private var ecgDiagnosis: EcgDiagnosis? = null
    private var glucoseListener: AbsBloodGlucoseChangeListener? = null
    private var glucosePendingStop: Runnable? = null
    private var bloodComponentListener: IBloodComponentDetectListener? = null
    private var bloodComponentPendingStop: Runnable? = null
    // ★ v90：戒指点测跑满100%常只回 onDetectStop、不回 onDetectComplete，
    //   但 onDetecting(progress, data) 的 data 已含完整 BloodComponent 真值（aar 字节码实证
    //   vp_i.vp_a: setUricAcid/setTCHO/setTAG/setHDL/setLDL）。缓存进度帧里的有效值，
    //   stop/complete 时用缓存兜底 emit，避免重蹈 v84 压力漏读覆辙。
    private var bcLastValues: Map<String, Float>? = null
    private var bcResultEmitted = false

    /** App 主动发起一次血压测量（SDK startDetectBP，公开模式）。结果经 onRealtime 回流。 */
    private fun startBpDetect() {
        if (!ready.get()) { log("[VeepooRing ANDROID] BP detect skip: ring not ready"); return }
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] BP detect skip: ppg release window"); return }
        // ★ 2026-11-16（机会式补测引入，PPG 一次只能跑一个检测）：HR 采样 / HRV 检测进行中不开 BP。
        //   本固件 PPG 独占，叠加会静默互杀；BP 自身的重入（JS 60s 重试）由下方 bpPendingStop 逻辑处理，不在此挡。
        if (hrListener != null || hrvDetectListener != null) {
            log("[VeepooRing ANDROID] BP detect skip: HR sampling / HRV detect in progress"); return
        }
        // ★ 2026-11-21（用户纠正）：血压能力位 SUPPORT，但即便 false 也不再拒绝——继续真正发起测量。
        try {
            val support = VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportBp()
            if (!support) {
                log("[VeepooRing ANDROID] BP isSupportBp=false（记录但继续尝试测量）")
                android.util.Log.e("GATECAP", "bp isSupportBp=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] BP detect cap check failed: ${e.message}")
        }
        // 重入安全：取消上一次兜底 stop + 停掉上一轮检测（没在跑时 stop 是无害空操作）
        bpPendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        bpPendingStop = null
        try { manager.stopDetectBP(IBleWriteResponse { _ -> }, EBPDetectModel.DETECT_MODEL_PUBLIC) } catch (_: Throwable) {}
        try {
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            bpDetectListener = object : IBPDetectDataListener {
                override fun onDataChange(data: BpData?) {
                    val d = data ?: return
                    val sys = d.highPressure
                    val dia = d.lowPressure
                    log("[VeepooRing ANDROID] BP detect progress=${d.progress} sys=$sys dia=$dia")
                    if (sys > 0 && dia > 0) {
                        val ts = System.currentTimeMillis()
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "bpSys"); put("value", sys); put("unit", "mmHg"); put("ts", ts)
                        })
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "bpDia"); put("value", dia); put("unit", "mmHg"); put("ts", ts)
                        })
                        // 出数即停，归还 PPG 通道
                        try { manager.stopDetectBP(IBleWriteResponse { _ -> }, EBPDetectModel.DETECT_MODEL_PUBLIC) } catch (_: Throwable) {}
                        bpPendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
                        bpPendingStop = null
                        bpDetectListener = null
                    }
                }
            }
            manager.startDetectBP(IBleWriteResponse { _ -> }, bpDetectListener, EBPDetectModel.DETECT_MODEL_PUBLIC)
            log("[VeepooRing ANDROID] BP detect started (PUBLIC model)")
            // ★ 2026-11-14：兜底 stop 60s → 90s（第一轮 45s 没出值时 JS 会重试一轮，60s 会拦腰砍断第二轮）
            val stop = Runnable {
                try { manager.stopDetectBP(IBleWriteResponse { _ -> }, EBPDetectModel.DETECT_MODEL_PUBLIC) } catch (_: Throwable) {}
                bpDetectListener = null
            }
            bpPendingStop = stop
            Handler(Looper.getMainLooper()).postDelayed(stop, 90_000L)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] BP detect FAILED: ${e.message}")
            bpDetectListener = null
        }
    }

    /** App 主动发起一次 HRV 测量（SDK startDetectHrv）。需固件 isSupportHrvAppDetect=true（与全天自动 HRV 是两个能力位）。 */
    private fun startHrvDetect() {
        if (!ready.get()) { log("[VeepooRing ANDROID] HRV detect skip: ring not ready"); return }
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] HRV detect skip: ppg release window"); return }
        // ★ 2026-11-16（机会式补测引入）：HR 采样 / BP 检测进行中不开 HRV（PPG 独占，防静默互杀）。
        if (hrListener != null || bpDetectListener != null) {
            log("[VeepooRing ANDROID] HRV detect skip: HR sampling / BP detect in progress"); return
        }
        // ★ 2026-11-21（用户纠正）：HRV 历史回读每天有真值，不再用 app-detect 能力位拒绝——继续真正测量。
        try {
            val support = VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportHrvAppDetect()
            if (!support) {
                log("[VeepooRing ANDROID] HRV isSupportAppDetect=false（记录但继续尝试测量）")
                android.util.Log.e("GATECAP", "hrv isSupportAppDetect=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] HRV detect cap check failed: ${e.message}")
        }
        try {
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            hrvDetectListener = object : IHrvDetectListener {
                override fun onHrvDetect(value: Int) {
                    if (value <= 0) return
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "hrv"); put("value", value); put("unit", "ms"); put("ts", System.currentTimeMillis())
                    })
                    try { manager.stopDetectHrv(IBleWriteResponse { _ -> }, hrvDetectListener) } catch (_: Throwable) {}
                    hrvDetectListener = null
                    hrvDetectStartedAt = 0L
                }
                override fun onDetectFailed(state: HrvDetectState) {
                    log("[VeepooRing ANDROID] HRV detect failed: $state")
                    // ★ v81：失败也必须归还通道，否则 listener 挂死挡住 GSR/miniCheckup
                    android.util.Log.e("SNAPDG", "HRV onDetectFailed=$state -> release listener")
                    hrvDetectListener = null
                    hrvDetectStartedAt = 0L
                }
                override fun onDetectStop() {
                    log("[VeepooRing ANDROID] HRV detect stopped")
                    // ★ v81：停止回调归还通道
                    hrvDetectListener = null
                    hrvDetectStartedAt = 0L
                }
            }
            hrvDetectStartedAt = System.currentTimeMillis()
            manager.startDetectHrv(IBleWriteResponse { _ -> }, hrvDetectListener)
            log("[VeepooRing ANDROID] HRV detect started")
            Handler(Looper.getMainLooper()).postDelayed({
                try { manager.stopDetectHrv(IBleWriteResponse { _ -> }, hrvDetectListener) } catch (_: Throwable) {}
                // ★ v81（根因）：原实现此处 stop 后未置 null → listener 永久挂死。
                hrvDetectListener = null
                hrvDetectStartedAt = 0L
                android.util.Log.e("SNAPDG", "HRV 20s watchdog stop -> release listener")
            }, 20_000L)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] HRV detect FAILED: ${e.message}")
            hrvDetectListener = null
        }
    }

    /**
     * ★ 2026-11-09（用户：夜间戴着戒指，为什么整夜只有血氧没有 HR/HRV）：
     * 戒指端「自动测量」是按指标开开关的（EAutoMeasureType.PULSE_RATE / HRV / BLOOD_OXYGEN…）。
     * 血氧夜间自动检测是开的（整夜 9876 条），而心率/HRV 若被关掉，戒指根本不采，
     * 于是 OriginData.rateValue 恒 0、HRVOrigin 返回空包 —— App 侧再怎么解析也拿不到。
     * 连接就绪后读回设置，把 PULSE_RATE / HRV / BLOOD_PRESSURE 打开（保留原有间隔/时间窗）。
     *
     * ★ 2026-11-11（用户：「血压、心率变异性停在 20 点不更新，问题很大」）：
     * SDK 枚举里 BLOOD_PRESSURE(1) 是独立开关，旧实现只管 PULSE_RATE 与 HRV，
     * **血压自动测量从来没被 App 主动开启**；且本函数原本只在首次认证 syncPersonInfo() 里
     * 调一次，已配对设备重启后不再走认证 → logcat 里一条 autoMeasure 日志都没有。
     * 现补齐血压开关，并由 JS 在每次 ready 时通过 ensureAutoMeasureNow() 复核。
     */
    private fun ensureAutoMeasure() {
        if (!ready.get()) return
        try {
            val wanted = setOf(
                EAutoMeasureType.PULSE_RATE,
                EAutoMeasureType.HRV,
                EAutoMeasureType.BLOOD_PRESSURE,
                // ★ 2026-11-13（用户：呼吸暂停分析老是说没数据）：
                //   呼吸暂停/缺氧分析依赖戒指的 SpO2 原始历史（onOriginSpo2OriginListDataChange 回读的那一路）。
                //   该历史只有戒指端「全天血氧自动监测」开着才会持续落盘；旧实现漏开 BLOOD_OXYGEN，
                //   于是很多夜晚根本没有 SpO2 原始点 → triggerOxygenAnalysis 读到空 → 一直「没数据」。
                //   现在补齐该开关（受 capSpo2 能力门禁保护，设备不支持则跳过，避免 SDK 弹 Toast）。
                EAutoMeasureType.BLOOD_OXYGEN,
                // ★ 2026-11-18（用户：Pro 没看到血糖）：真机回报固件血糖自动测量本就
                //   open=true interval=30，这里纳入守护清单——被关掉时自动开回
                //   （受 capGlucose 能力门禁保护）。
                EAutoMeasureType.BLOOD_GLUCOSE,
                // ★ 2026-11-18(2)（用户：血液成分是不是也自动监测）：SDK 枚举里有
                //   EAutoMeasureType.BLOOD_COMPOSITION（血液成分自动测量开关），
                //   旧清单漏了它 → 无人开启也无从读到设备端状态。纳入守护清单，
                //   连接时读取设备回报即可实锤血糖/血液成分两个开关的真实状态
                //   （受 capBloodComponent 能力门禁保护）。
                EAutoMeasureType.BLOOD_COMPOSITION,
            )
            val listener = object : IAutoMeasureSettingDataListener {
                override fun onSettingDataChange(list: MutableList<AutoMeasureData>?) {
                    val items = list ?: return
                    for (item in items) {
                        val type = item.funType
                        // ★ 2026-11-11：之前只核对 open / interval，漏了 SDK 的「测量时间窗」。
                        //   20:00 = 1200min 极像窗口终点——开关全开也可能只在窗口内测量。
                        log("[VeepooRing ANDROID] autoMeasure type=$type open=${item.isSwitchOpen} " +
                            "interval=${item.measureInterval} " +
                            "window=[${item.currentStartMinute},${item.currentEndMinute}] " +
                            "support=[${item.supportStartMinute},${item.supportEndMinute}] " +
                            "slotModify=${item.isSlotModify} intervalModify=${item.isIntervalModify} " +
                            "step=${item.stepUnit} proto=${item.protocolType}")
                        if (!wanted.contains(type)) continue
                        // ★ 2026-11-21（用户第三次纠正「除心电外全部自动测量、戒指都支持」）：
                        //   与 v72 主动测量同类问题——cap=false 来自不可靠的 getFunctionSupport 功能位
                        //   （真机实测 HRV/血糖/血液成分功能位 UNSUPPORT，却能主动测出真值）。
                        //   不再因 cap=false 就跳过打开戒指端自动测量开关；改为留痕后继续尝试打开，
                        //   交戒指实测裁决。写失败有 onSettingDataChangeFail 日志 + try-catch 兜底，不编造数据。
                        if (type == EAutoMeasureType.BLOOD_PRESSURE && capBp == false) {
                            log("[VeepooRing ANDROID] autoMeasure BLOOD_PRESSURE capBp=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure bp capBp=false -> PROCEED")
                        }
                        if (type == EAutoMeasureType.HRV && capHrv == false) {
                            log("[VeepooRing ANDROID] autoMeasure HRV capHrv=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure hrv capHrv=false -> PROCEED")
                        }
                        if (type == EAutoMeasureType.PULSE_RATE && capPulse == false) {
                            log("[VeepooRing ANDROID] autoMeasure PULSE_RATE capPulse=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure pulse capPulse=false -> PROCEED")
                        }
                        if (type == EAutoMeasureType.BLOOD_OXYGEN && capSpo2 == false) {
                            log("[VeepooRing ANDROID] autoMeasure BLOOD_OXYGEN capSpo2=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure spo2 capSpo2=false -> PROCEED")
                        }
                        if (type == EAutoMeasureType.BLOOD_GLUCOSE && capGlucose == false) {
                            log("[VeepooRing ANDROID] autoMeasure BLOOD_GLUCOSE capGlucose=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure glucose capGlucose=false -> PROCEED")
                        }
                        if (type == EAutoMeasureType.BLOOD_COMPOSITION && capBloodComponent == false) {
                            log("[VeepooRing ANDROID] autoMeasure BLOOD_COMPOSITION capBloodComponent=false（记录但继续开自动测量）")
                            android.util.Log.e("GATECAP", "autoMeasure bloodcomp capBloodComponent=false -> PROCEED")
                        }
                        var changed = false
                        if (!item.isSwitchOpen) { item.isSwitchOpen = true; changed = true }
                        if (item.measureInterval <= 0) { item.measureInterval = 30; changed = true }
                        // 真机实证 window=[0,0] / support=[0,0] 表示「未启用时间窗限制」，
                        // 不是 20:00 截断的原因，故不改写设备窗口配置（避免改坏固件设置）。
                        if (changed && autoMeasureWritten.add(type)) {
                            try {
                                manager.setAutoMeasureSettingData(IBleWriteResponse { _ -> }, item, this)
                                log("[VeepooRing ANDROID] autoMeasure WRITTEN $type")
                            } catch (e: Exception) {
                                log("[VeepooRing ANDROID] autoMeasure set FAILED $type: ${e.message}")
                            }
                        }
                    }
                }
                override fun onSettingDataChangeFail() {
                    log("[VeepooRing ANDROID] autoMeasure read failed")
                }
                override fun onSettingDataChangeSuccess() {
                    log("[VeepooRing ANDROID] autoMeasure set success")
                }
            }
            manager.readAutoMeasureSettingData(IBleWriteResponse { _ -> }, listener)
            log("[VeepooRing ANDROID] autoMeasure read requested (wanted=$wanted)")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] autoMeasure FAILED: ${e.message}")
        }
    }

    /**
     * ★ 2026-11-12（用户：HRV 更新到 00:40 但实际才 00:24；洞察页趋势图全空）：
     * SDK 的 settingTime() 从来没被调过，戒指一直跑出厂/上次写入的 RTC，比手机快约 35 分钟。
     * 于是自动测量记录的时间戳超前，App 用 Date.now() 做查询上界时把今日数据全过滤掉。
     * 每次连接把手机时间写进戒指，从根上对齐；对已入库的错位样本由 JS 侧平移校正。
     */
    private var lastTimeSyncAt = 0L
    private fun syncDeviceTime(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastTimeSyncAt < 30 * 60_000L) return
        lastTimeSyncAt = now
        try {
            val c = Calendar.getInstance()
            val setting = com.veepoo.protocol.model.settings.DeviceTimeSetting(
                c.get(Calendar.YEAR),
                c.get(Calendar.MONTH) + 1,
                c.get(Calendar.DAY_OF_MONTH),
                c.get(Calendar.HOUR_OF_DAY),
                c.get(Calendar.MINUTE),
                c.get(Calendar.SECOND),
                // ★ 6 参构造把 eTimeMode 留成 null，SDK 内部 .ordinal() 直接 NPE —— 必须显式给 24 小时制
                com.veepoo.protocol.model.enums.ETimeMode.MODE_24,
            )
            manager.settingTime(
                IBleWriteResponse { _ -> },
                object : com.veepoo.protocol.listener.data.IResponseListener {
                    override fun response(code: Int) {
                        log("[VeepooRing ANDROID] device time SET resp=$code")
                    }
                },
                setting,
            )
            log("[VeepooRing ANDROID] device time synced -> ${c.get(Calendar.YEAR)}-${c.get(Calendar.MONTH) + 1}-${c.get(Calendar.DAY_OF_MONTH)} ${c.get(Calendar.HOUR_OF_DAY)}:${c.get(Calendar.MINUTE)}:${c.get(Calendar.SECOND)}")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] device time sync FAILED: ${e.message}")
        }
    }

    /** ★ 2026-11-11：供 JS 在每次 onState=ready 时复核自动测量开关（已配对设备重启后不再走首次认证）。 */
    @ReactMethod
    fun ensureAutoMeasureNow() {
        // ★ 2026-11-15（P0-1）：与 syncPersonInfo 原本重复下发同一批写命令；
        //   统一走事务感知队列，同步读取期间绝不并发写 BLE。
        runOrDeferWrite("ensureAutoMeasure(ready)") { ensureAutoMeasure() }
        // ★ 已配对设备重启不走 syncPersonInfo()，旧版只在那儿启动分时让通道 → 从未生效。
        //   JS 每次 onState=ready 都会调本方法，挂在这里才保证一定启动。
        runOrDeferWrite("startRealtime(ready)") { startRealtimeIfNeeded() }
        runOrDeferWrite("ppgRelease(ready)") { startPpgReleaseCycle() }
        // 每次 ready 都复核一次戒指时钟（内部 30 分钟节流，避免频繁写 BLE）
        runOrDeferWrite("syncDeviceTime(ready)") { syncDeviceTime() }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 前台保活（2026-11-14，用户：App 被杀掉戒指就断联，不行）
    // ─────────────────────────────────────────────────────────────────────────

    /** 戒指连上后由 JS 调用：启动前台服务常驻进程，BLE 不再随系统回收断开。
     *  幂等：重复调用只刷新通知。App 在后台时调用可能被 Android 12+ 限制，
     *  抛异常静默吞掉——JS 会在回前台时补调。 */
    @ReactMethod
    fun startKeepalive() {
        try {
            val ctx = reactApplicationContext
            val intent = android.content.Intent(ctx, com.miraringfashion.app.keepalive.RingKeepaliveService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            log("[VeepooRing ANDROID] keepalive started")
        } catch (e: Exception) {
            // 后台启动 FGS 受限（ForegroundServiceStartNotAllowedException）时走这里，
            // 由 JS 回前台补调；不影响连接本身
            log("[VeepooRing ANDROID] keepalive start failed: ${e.message}")
        }
    }

    /**
     * ★ 2026-11-16（真因修复）：引导用户把 App 加入系统电池优化白名单。
     *   OPPO ColorOS 熄屏后 OplusHansManager 会 freeze 整个进程，前台服务挡不住；
     *   实测加入 Doze 白名单后熄屏 90s 不再被冻结。adb 加的白名单重启会丢，
     *   必须由用户在系统对话框里确认一次才永久生效。只弹一次，避免反复打扰。
     */
    @ReactMethod
    fun requestBatteryExemption(promise: Promise) {
        try {
            val ctx = reactContext.applicationContext
            val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            val ignored = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                pm.isIgnoringBatteryOptimizations(ctx.packageName)
            } else true
            val sp = ctx.getSharedPreferences("mira_ring_reconnect", android.content.Context.MODE_PRIVATE)
            val asked = sp.getBoolean("battery_exemption_asked", false)
            if (ignored) {
                promise.resolve("already_exempt")
                return
            }
            sp.edit().putBoolean("battery_exemption_asked", true).apply()
            // 用户已拒绝过或已弹过一次 → 不再强弹，改为返回需要手动设置的提示
            if (asked) {
                promise.resolve("needs_manual")
                return
            }
            val intent = android.content.Intent(
                android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                android.net.Uri.parse("package:${ctx.packageName}"),
            ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve("dialog_shown")
        } catch (e: Throwable) {
            promise.resolve("unavailable: ${e.message}")
        }
    }

    /** 查询当前是否已被电池优化豁免（供设置页显示状态，不弹窗）。 */
    @ReactMethod
    fun isBatteryExempt(promise: Promise) {
        try {
            val ctx = reactContext.applicationContext
            val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
            promise.resolve(
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M)
                    pm.isIgnoringBatteryOptimizations(ctx.packageName) else true
            )
        } catch (e: Throwable) {
            promise.resolve(false)
        }
    }

    /** 用户在 App 内主动断开时由 JS 调用：停掉保活服务与常驻通知。 */
    @ReactMethod
    fun stopKeepalive() {
        try {
            reactApplicationContext.stopService(
                android.content.Intent(reactApplicationContext, com.miraringfashion.app.keepalive.RingKeepaliveService::class.java),
            )
            log("[VeepooRing ANDROID] keepalive stopped")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] keepalive stop failed: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 手动测量（对齐 iOS measure(key)）
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun measure(key: String, durationMs: Int = 0) {
        log("[VeepooRing ANDROID] measure $key durationMs=$durationMs")
        // ★ 2026-11-14（真机实锤：120s 让出窗口撞上一键体检 → 重试/HRV/血氧全被静默吞）：
        //   用户主动测量 = 用户意图优先，一律先取消进行中的 PPG 让出窗口再发测量。
        //   窗口的 30 分钟周期循环（ppgReleaseRunnable）不受影响，下个整点照常让出。
        cancelPpgRelease("measure $key")
        when (key) {
            "hr" -> startSingleHeartDetect(if (durationMs > 0) durationMs.toLong() else 20_000L)
            "spo2" -> startRealtimeIfNeeded()
            "temp" -> triggerHealthGlance()
            "eda", "stress", "depression" -> triggerGSR()
            // ★ 2026-11-14（用户拍板）：hrv / bp 从 triggerHealthGlance 组里拆出，接真正的
            //   App 主动测量（startDetectHrv / startDetectBP）；此前 hrv 指向的还是 TODO stub。
            "hrv" -> startHrvDetect()
            "bp" -> startBpDetect()
            "cortisol", "healthGlance", "sns", "emotion", "skin", "fatigue" -> triggerHealthGlance()
            // ★ 2026-11-18：血液成分（尿酸/血脂四项）接真实 SDK 测量，不再走空 stub
            "cholesterol", "triglyceride", "hdl", "ldl", "ua", "uricAcid", "bloodcomp" -> startBloodComponentDetect()
            "ecg" -> startEcg()
            // ★ 2026-11-17：血糖主动测量（仅 PRO_UI 会下发；SDK startBloodGlucoseDetect，结果经 onRealtime 回流）
            "glucose" -> startGlucoseDetect()
            "rr" -> log("[VeepooRing ANDROID] rr: 本固件未开放（SDK NoFunction），以待接入呈现")
            else -> log("[VeepooRing ANDROID] 未知测量项: $key")
        }
    }

    /**
     * ★ 2026-11-14（血压主动测不出值 → 体检里自动重试）：显式停止主动检测，归还 PPG 通道。
     *   体检会话在 BP 阶段结束（无论是否出值）时调用 stopMeasure('bp')：
     *   出值时 SDK 已自停（无害重复 stop），没出值时防止 90s 兜底未触发就长期占道，
     *   挡住后面的 HRV / 血氧流。与 measure(key) 成对，对齐 iOS 无此需求（iOS 走自己的桥）。
     */
    @ReactMethod
    fun stopMeasure(key: String) {
        log("[VeepooRing ANDROID] stopMeasure $key")
        when (key) {
            "bp" -> {
                bpPendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
                bpPendingStop = null
                try { manager.stopDetectBP(IBleWriteResponse { _ -> }, EBPDetectModel.DETECT_MODEL_PUBLIC) } catch (_: Throwable) {}
                bpDetectListener = null
                lastMeasureEndAt = System.currentTimeMillis()
            }
            "hrv" -> {
                try { manager.stopDetectHrv(IBleWriteResponse { _ -> }, hrvDetectListener) } catch (_: Throwable) {}
                hrvDetectListener = null
                lastMeasureEndAt = System.currentTimeMillis()
            }
            // ★ 2026-11-17：体检阶段结束归还通道（ECG/血糖出值即自停；此处兜底未出值场景）
            "ecg" -> stopEcgInternal("js stopMeasure")
            "glucose" -> stopGlucoseInternal("js stopMeasure")
            "cholesterol", "triglyceride", "hdl", "ldl", "ua", "uricAcid", "bloodcomp" -> stopBloodComponentInternal("js stopMeasure")
            else -> log("[VeepooRing ANDROID] stopMeasure: 未知项 $key")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ★ 2026-11-18(v61)（用户：EDA/压力/疲劳/情绪/皮肤含水量接上）：
    //   iOS VeepooRing.m 早已实现 healthGlance + GSR 点测，Android 侧此前是空 stub
    //   （只有 TODO 日志），导致 JS handleManualHealthGlance / onRealtime 链路全空转。
    //   现按 javap vpprotocol-2.3.81.15.aar 核对的真实签名接上，emit 字段名与 iOS 完全对齐。
    // ─────────────────────────────────────────────────────────────────────────
    private var gsrDetectListener: IGsrDetectListener? = null
    private var miniCheckupListener: IMiniCheckupOptListener? = null

    // ★ 2026-11-23(v89)（用户：休班后回来「修吧」，EDA 点测成功率仅~1/3）：
    //   真机铁证——戒指常在进度 83% 停发，既不回 success 也不回 failed/stop，
    //   原实现只能干等 150s 看门狗 + 下个 30s tick（且常被 HRV/HR/glucose 挡掉），
    //   导致 EDA 一天只出零星几个点。改为「进度停滞自愈」：进度 N 秒不推进即判定卡死，
    //   立即归还通道 + 短延迟快速重试（有限次数），不再空耗 150s。
    private var gsrLastProgressAt = 0L          // 最后一次进度回调时间戳
    private var gsrLastProgress = -1            // 最后一次进度值（诊断用）
    private var gsrRetryCount = 0              // 连续卡死重试计数（成功即清零）
    private var gsrStallChecker: Runnable? = null
    private var gsrWatchdog: Runnable? = null
    private val GSR_STALL_MS = 15_000L          // 进度 15s 不推进=卡死（正常每秒一步，全程约33s）
    private val GSR_STALL_CHECK_MS = 5_000L     // 每 5s 巡检一次进度
    private val GSR_RETRY_DELAY_MS = 4_000L     // 卡死后 4s 快速重试（让通道+血氧流稳定）
    private val GSR_MAX_RETRY = 3              // 连续卡死最多重试 3 次，避免无限循环

    /** 单测轮询：体温(GSP 微体检) 与 皮电(GSR) 交替，与 iOS tickRotation 对齐。 */
    private fun tickSnapshotRotation() {
        // ★ v79 诊断直写：轮询为什么不发测量，一次看清（避开 onLog 250ms 节流）
        val dtag = "SNAPDG"
        android.util.Log.e(dtag, "tick: monitorOn=$monitorOn ready=${ready.get()} inProg=$snapshotTestInProgress " +
            "ecg=${ecgDetectListener != null} glu=${glucoseListener != null} bc=${bloodComponentListener != null} " +
            "gsr=${gsrDetectListener != null} mini=${miniCheckupListener != null} " +
            "hr=${hrListener != null} hrv=${hrvDetectListener != null} bp=${bpDetectListener != null} ppgRel=$ppgReleaseActive")
        // ★ 2026-11-23：后台夜间补测——monitorOn 因 JS 冻结可能仍为 false，但回填收口已置
        //   nightlySnapPending，此时放行一轮并消费标志，让夜间也能产出压力/EDA 点。
        val forceNightly = nightlySnapPending && ready.get()
        if (forceNightly) nightlySnapPending = false
        if ((!monitorOn && !forceNightly) || !ready.get()) return
        if (forceNightly) android.util.Log.e(dtag, "NIGHTLY forced tick (monitorOn=$monitorOn)")
        // ★ v80 修复（用户：身心压力一直没数据）：PPG 让出窗口期间，trigger 内部会静默拒绝测量，
        //   若此处仍置 inProg=true 就会空耗 55s 看门狗 + 30s 轮询 → 微体检/GSR 长期饿死（真机 SNAPDG 实锤）。
        //   正确做法：窗口期间直接 return，不置 inProg、不消耗 idx；恢复时由 restore 立即补测。
        if (ppgReleaseActive) { android.util.Log.e(dtag, "tick SKIP: ppg release window (defer to restore)"); return }
        // ★ v81（根因自愈）：HRV listener 挂死会永久挡住下面这行 return，使 GSR/miniCheckup
        //   永远轮不到（真机 SNAPDG：tick 每 30s 都 hrv=true、GSR/mini STARTED=0）。
        //   正常 HRV 测量最长 20s 兜底即归还；超过 35s 仍挂着=回调丢失挂死，强制清理归还通道。
        if (hrvDetectListener != null && hrvDetectStartedAt > 0L &&
            System.currentTimeMillis() - hrvDetectStartedAt > HRV_STALE_MS) {
            val age = System.currentTimeMillis() - hrvDetectStartedAt
            android.util.Log.e(dtag, "STALE-HRV force release (age=${age}ms) -> unblock GSR/mini")
            try { manager.stopDetectHrv(IBleWriteResponse { _ -> }, hrvDetectListener) } catch (_: Throwable) {}
            hrvDetectListener = null
            hrvDetectStartedAt = 0L
        }
        if (snapshotTestInProgress) return
        // ECG/血糖/血成分等主动测量进行中时不抢通道（用户测量意图优先）
        if (ecgDetectListener != null || glucoseListener != null || bloodComponentListener != null
            || gsrDetectListener != null || miniCheckupListener != null) return
        if (hrListener != null || hrvDetectListener != null || bpDetectListener != null) return
        snapshotTestInProgress = true
        val idx = snapshotRotationIdx % 2
        snapshotRotationIdx++
        val name = if (idx == 0) "miniCheckup(压力/疲劳/情绪)" else "GSR(EDA/皮肤含水量/交感)"
        log("[VeepooRing ANDROID] SNAPSHOT ROTATION -> $name")
        if (idx == 0) triggerHealthGlance() else triggerGSR()
        // 看门狗：单路 55s 无回调强制放行（固件不支持/未佩戴不永久卡死）
        mainHandler.postDelayed({
            if (snapshotTestInProgress) {
                log("[VeepooRing ANDROID] SNAPSHOT ROTATION #$idx timeout → release")
                snapshotTestInProgress = false
            }
        }, 55_000L)
    }

    /** GSR 点测完成/失败后归还通道：停检测 + 恢复血氧流 + 前移脱手锚点（参考 HRV/BP 模板）。 */
    private fun finishGsrDetect(reason: String) {
        // ★ v89：先撤掉本轮的停滞巡检 + 150s 看门狗，避免旧定时器在快速重试的新一轮上误触发。
        gsrStallChecker?.let { mainHandler.removeCallbacks(it) }
        gsrStallChecker = null
        gsrWatchdog?.let { mainHandler.removeCallbacks(it) }
        gsrWatchdog = null
        gsrDetectListener?.let { l ->
            try { manager.stopDetectGsr(IBleWriteResponse { _ -> }) } catch (_: Throwable) {}
        }
        gsrDetectListener = null
        val doneAt = System.currentTimeMillis()
        if (lastAnySpo2FrameAt < doneAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = doneAt
        if (monitorOn && ready.get() && !ppgReleaseActive) startSpo2hOnly()
        snapshotTestInProgress = false
        log("[VeepooRing ANDROID] GSR detect finished ($reason), spo2h resumed")
    }

    /**
     * ★ v89：GSR 进度停滞自愈巡检。每 5s 看一次：若进度超过 GSR_STALL_MS 没推进，
     * 判定戒指静默卡死（进度停发、无 success/failed 回调）→ 立即归还通道并快速重试，
     * 而不是空耗 150s 看门狗。成功/明确失败由回调自己 finish，不计入重试。
     */
    private fun armGsrStallGuard() {
        gsrStallChecker?.let { mainHandler.removeCallbacks(it) }
        val checker = object : Runnable {
            override fun run() {
                if (gsrDetectListener == null) return  // 已结束（success/failed/stop 已收口）
                val idle = System.currentTimeMillis() - gsrLastProgressAt
                if (idle < GSR_STALL_MS) {
                    mainHandler.postDelayed(this, GSR_STALL_CHECK_MS)
                    return
                }
                // 进度停滞：戒指既没回结果也没回失败，主动收口
                android.util.Log.e("SNAPDG", "GSR STALL ${idle / 1000}s at ${gsrLastProgress}% -> release")
                finishGsrDetect("stall ${idle / 1000}s @${gsrLastProgress}%")
                if (gsrRetryCount < GSR_MAX_RETRY && monitorOn && ready.get() && !ppgReleaseActive) {
                    gsrRetryCount++
                    android.util.Log.e("SNAPDG", "GSR fast retry #$gsrRetryCount in ${GSR_RETRY_DELAY_MS / 1000}s")
                    mainHandler.postDelayed({
                        if (monitorOn && ready.get() && !ppgReleaseActive && gsrDetectListener == null) {
                            snapshotTestInProgress = true
                            triggerGSR(isRetry = true)
                        }
                    }, GSR_RETRY_DELAY_MS)
                } else {
                    android.util.Log.e("SNAPDG", "GSR retry budget exhausted ($gsrRetryCount) -> defer to next tick")
                }
            }
        }
        gsrStallChecker = checker
        mainHandler.postDelayed(checker, GSR_STALL_CHECK_MS)
    }


    /** @param isRetry true=停滞/失败后的快速重试（沿用重试预算）；false=新一轮测量（重置预算）。 */
    private fun triggerGSR(isRetry: Boolean = false) {
        if (!isRetry) gsrRetryCount = 0  // 新一轮满血复活的预算；快速重试则沿用累加计数
        if (!ready.get()) { log("[VeepooRing ANDROID] GSR detect skip: ring not ready"); return }
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] GSR detect skip: ppg release window"); return }
        try {
            val support = VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportGSR()
            if (!support) {
                // ★ 2026-11-21（用户纠正）：不再用 SP 能力位拒绝，记录后继续真正发起测量。
                log("[VeepooRing ANDROID] GSR isSupportGSR=false（记录但继续尝试测量）")
                android.util.Log.e("GATECAP", "gsr isSupportGSR=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] GSR cap check failed: ${e.message}")
        }
        if (gsrDetectListener != null) {
            log("[VeepooRing ANDROID] GSR detect already running, skip")
            return
        }
        // 先让出血氧流（本固件一次只跑一个检测），避免 GSR 测量被 PPG 干扰
        spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
        spo2Listener = null
        try {
            // ★ v89：本轮起始时间与进度复位（进度停滞巡检据此判定）
            gsrLastProgressAt = System.currentTimeMillis()
            gsrLastProgress = 0
            gsrDetectListener = object : IGsrDetectListener {
                override fun onGsrDetectProgress(progress: Int) {
                    gsrLastProgressAt = System.currentTimeMillis()
                    gsrLastProgress = progress
                    log("[VeepooRing ANDROID] GSR progress=$progress%")
                }
                override fun onGsrDetectSuccess(result: GsrDetectResult) {
                    gsrRetryCount = 0  // 出值即清零重试预算
                    val r = result
                    val ts = System.currentTimeMillis()
                    // 字段名与 iOS VeepooRing.m triggerGSRWithToken 完全对齐：
                    // skin_moisture → eda + skin（皮肤含水量，既进 EDA 卡也进皮肤含水量卡）
                    val map = mutableListOf<Pair<String, Number>>()
                    if (r.skinMoisture > 0) {
                        map.add("eda" to r.skinMoisture)
                        map.add("skin" to r.skinMoisture)
                    }
                    if (r.snsActivation > 0) map.add("sns" to r.snsActivation)
                    if (r.cortisolValue > 0) map.add("cortisol" to r.cortisolValue)
                    // emotion 值域 [-10,10]，0 是合法中性值；只在非 0 时写，避免伪造倾向
                    if (r.emotionLevel != 0) map.add("emotion" to r.emotionLevel)
                    // depressionRisk 是 enum（LOW/MEDIUM/HIGH），低风险=0 也合法 → 只取 ordinal
                    val depRisk = try { r.depressionRisk.ordinal } catch (_: Throwable) { -1 }
                    if (depRisk >= 0) map.add("depressionRisk" to depRisk)
                    for ((k, v) in map) {
                        emit("onRealtime", JSONObject().apply {
                            put("metric", k); put("value", v.toDouble()); put("unit", ""); put("ts", ts)
                            // ★ v82：标记为「主动测量结果帧」。测量 GSR 会停血氧流 → spo2 帧静默 23s
                            //   → App 误判脱手(worn=false) → 结果帧被 JS 脱手冻结丢弃（真机 22:56:37 实锤）。
                            //   JS 侧据此标记旁路脱手冻结，但正常实时流仍冻结防摘戒脏值。
                            put("source", "measurement")
                        })
                    }
                    log("[VeepooRing ANDROID] GSR ✅ eda=${r.skinMoisture} skin=${r.skinMoisture} " +
                        "sns=${r.snsActivation} cortisol=${r.cortisolValue} emotion=${r.emotionLevel} " +
                        "dep=$depRisk emitted=${map.size}")
                    android.util.Log.e("SNAPDG", "GSR SUCCESS eda=${r.skinMoisture} sns=${r.snsActivation} " +
                        "cortisol=${r.cortisolValue} emotion=${r.emotionLevel} dep=$depRisk emitted=${map.size}")
                    finishGsrDetect("success")
                }
                override fun onGsrDetectFailed(ack: GsrDetectAck) {
                    log("[VeepooRing ANDROID] GSR detect FAILED: $ack")
                    android.util.Log.e("SNAPDG", "GSR FAILED $ack")
                    // ★ v89：BUSY 等明确失败也走快速重试（成功才清零预算）
                    finishGsrDetect("failed $ack")
                    if (gsrRetryCount < GSR_MAX_RETRY && monitorOn && ready.get() && !ppgReleaseActive) {
                        gsrRetryCount++
                        android.util.Log.e("SNAPDG", "GSR fast retry #$gsrRetryCount after FAILED $ack")
                        mainHandler.postDelayed({
                            if (monitorOn && ready.get() && !ppgReleaseActive && gsrDetectListener == null) {
                                snapshotTestInProgress = true
                                triggerGSR(isRetry = true)
                            }
                        }, GSR_RETRY_DELAY_MS)
                    }
                }
                override fun onGsrDetectStop() {
                    log("[VeepooRing ANDROID] GSR detect STOP")
                    android.util.Log.e("SNAPDG", "GSR STOP")
                    finishGsrDetect("stop")
                }
            }
            manager.startDetectGsr(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] GSR start write resp=$code")
                android.util.Log.e("SNAPDG", "GSR start write resp=$code")
            }, gsrDetectListener)
            log("[VeepooRing ANDROID] GSR detect started")
            android.util.Log.e("SNAPDG", "GSR detect STARTED (waiting callback)")
            // ★ v89：启动 5s 粒度进度停滞巡检——卡住十几秒即快速收口重试，不用空耗 150s。
            armGsrStallGuard()
            // 兜底看门狗：150s 极端情况（连进度都没有）自动收口，绝不永久卡死通道。
            // ★ v89：改为可取消句柄，finishGsrDetect 会撤掉它，避免误杀快速重试的新一轮。
            val wd = Runnable {
                if (gsrDetectListener != null) {
                    android.util.Log.e("SNAPDG", "GSR watchdog 150s FIRED (no callback)")
                    finishGsrDetect("watchdog 150s")
                }
            }
            gsrWatchdog = wd
            Handler(Looper.getMainLooper()).postDelayed(wd, 150_000L)
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] GSR detect FAILED(exception): ${e.javaClass.simpleName}: ${e.message}")
            finishGsrDetect("exception")
        }
    }

    /** 微体检点测完成/失败后归还通道 + 恢复血氧流。 */
    private fun finishMiniCheckup(reason: String) {
        miniCheckupListener?.let { l ->
            try { manager.stopMiniCheckup(IBleWriteResponse { _ -> }, l) } catch (_: Throwable) {}
        }
        miniCheckupListener = null
        val doneAt = System.currentTimeMillis()
        if (lastAnySpo2FrameAt < doneAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = doneAt
        if (monitorOn && ready.get() && !ppgReleaseActive) startSpo2hOnly()
        snapshotTestInProgress = false
        log("[VeepooRing ANDROID] miniCheckup finished ($reason), spo2h resumed")
    }

    private fun triggerHealthGlance() {
        if (!ready.get()) { log("[VeepooRing ANDROID] miniCheckup skip: ring not ready"); return }
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] miniCheckup skip: ppg release window"); return }
        // 微体检独占 PPG：HR/HRV/BP/血糖/血成分任一在跑就跳过，避免静默互杀
        if (hrListener != null || hrvDetectListener != null || bpDetectListener != null
            || glucoseListener != null || bloodComponentListener != null) {
            log("[VeepooRing ANDROID] miniCheckup skip: other active detect")
            return
        }
        if (miniCheckupListener != null) {
            log("[VeepooRing ANDROID] miniCheckup already running, skip")
            return
        }
        try {
            val support = VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportMiniCheckup()
            if (!support) {
                // ★ 2026-11-21（用户纠正）：不再用 SP 能力位拒绝，记录后继续真正发起测量。
                log("[VeepooRing ANDROID] miniCheckup isSupportMiniCheckup=false（记录但继续尝试测量）")
                android.util.Log.e("GATECAP", "miniCheckup isSupportMiniCheckup=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] miniCheckup cap check failed: ${e.message}")
        }
        spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
        spo2Listener = null
        try {
            miniCheckupListener = object : IMiniCheckupOptListener {
                override fun onMiniCheckupTestProgress(progress: Int) {
                    log("[VeepooRing ANDROID] miniCheckup progress=$progress%")
                }
                override fun onMiniCheckupStopSuccess() {
                    log("[VeepooRing ANDROID] miniCheckup stop success")
                    finishMiniCheckup("stop success")
                }
                override fun onMiniCheckupTestFailed(code: EMiniCheckupTestErrorCode) {
                    log("[VeepooRing ANDROID] miniCheckup FAILED: $code")
                    finishMiniCheckup("failed $code")
                }
                override fun onMiniCheckupSuccess(data: MiniCheckupResultData) {
                    android.util.Log.e("SNAPDG", "mini V1 callback stress=${data.stress} fatigue=${data.fatigue} emotion=${data.emotion}")
                    emitMiniCheckup(data)
                }
                override fun onMiniCheckupDetailTestSuccess(data: MiniCheckupDetailData) {
                    // V2 详情优先：含皮电子对象（皮肤含水量/情绪/交感/皮质醇/抑郁风险）
                    android.util.Log.e("SNAPDG", "mini V2 callback stress=${data.stress} fatigue=${data.fatigue} emotion=${data.emotion}")
                    emitMiniCheckupDetail(data)
                }
            }
            manager.startMiniCheckup(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] miniCheckup start write resp=$code")
                android.util.Log.e("SNAPDG", "mini start write resp=$code")
            }, miniCheckupListener)
            log("[VeepooRing ANDROID] miniCheckup started")
            android.util.Log.e("SNAPDG", "miniCheckup STARTED (waiting callback)")
            Handler(Looper.getMainLooper()).postDelayed({
                if (miniCheckupListener != null) {
                    android.util.Log.e("SNAPDG", "mini watchdog 60s FIRED (no callback)")
                    finishMiniCheckup("watchdog 60s")
                }
            }, 60_000L)
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] miniCheckup FAILED(exception): ${e.javaClass.simpleName}: ${e.message}")
            finishMiniCheckup("exception")
        }
    }

    /** V1 微体检结果 → onRealtime。SDK 文档标注 emotion/fatigue @Deprecated 未赋值 → 只在非 0 时写，绝不写假数据。 */
    private fun emitMiniCheckup(data: MiniCheckupResultData?) {
        val d = data ?: run { finishMiniCheckup("null v1 result"); return }
        val ts = System.currentTimeMillis()
        val map = linkedMapOf<String, Number>()
        if (d.heartRate > 0) map["hr"] = d.heartRate
        if (d.bloodOxygen > 0) map["spo2"] = d.bloodOxygen
        if (d.hrv > 0) map["hrv"] = d.hrv
        // 压力是微体检真值（0-100），0 视为未测
        if (d.stress > 0) map["stress"] = d.stress
        if (d.fatigue > 0) map["fatigue"] = d.fatigue
        if (d.emotion != 0) map["emotion"] = d.emotion
        if (d.bodyTemperature > 0f) map["temp"] = (d.bodyTemperature * 100.0).toLong() / 100.0
        if (d.bloodGlucose > 0f) map["glucose"] = (d.bloodGlucose * 100.0).toLong() / 100.0
        if (d.systolicBloodPressure > 0) map["bpSys"] = d.systolicBloodPressure
        if (d.diastolicBloodPressure > 0) map["bpDia"] = d.diastolicBloodPressure
        for ((k, v) in map) {
            emit("onRealtime", JSONObject().apply {
                put("metric", k); put("value", v.toDouble()); put("unit", ""); put("ts", ts)
            })
        }
        log("[VeepooRing ANDROID] miniCheckup V1 ✅ stress=${d.stress} fatigue=${d.fatigue} emitted=${map.size}")
        finishMiniCheckup("v1 success")
    }

    /** V2 微体检详情 → onRealtime，含皮电子对象（与 iOS healthGlance 全字段对齐）。 */
    private fun emitMiniCheckupDetail(data: MiniCheckupDetailData?) {
        val d = data ?: run { finishMiniCheckup("null v2 result"); return }
        val ts = System.currentTimeMillis()
        val map = linkedMapOf<String, Number>()
        if (d.heartRate > 0) map["hr"] = d.heartRate
        if (d.bloodOxygen > 0) map["spo2"] = d.bloodOxygen
        if (d.hrv > 0) map["hrv"] = d.hrv
        if (d.stress > 0) map["stress"] = d.stress
        if (d.fatigue > 0) map["fatigue"] = d.fatigue
        if (d.emotion != 0) map["emotion"] = d.emotion
        if (d.bodyTemperature > 0f) map["temp"] = (d.bodyTemperature * 100.0).toLong() / 100.0
        if (d.bloodGlucose > 0f) map["glucose"] = (d.bloodGlucose * 100.0).toLong() / 100.0
        try { d.skinElectricity?.let { se ->
            if (se.skinMoistureContent > 0) {
                map["skin"] = se.skinMoistureContent
                map["eda"] = se.skinMoistureContent
            }
            if (se.sympatheticActivity > 0) map["sns"] = se.sympatheticActivity
            if (se.cortisolConcentration > 0) map["cortisol"] = se.cortisolConcentration
            if (se.emotion != 0) map["emotion"] = se.emotion
            if (se.depressionRisk in 0..2) map["depressionRisk"] = se.depressionRisk
        } } catch (e: Throwable) {
            log("[VeepooRing ANDROID] miniCheckup skinElectricity parse failed: ${e.message}")
        }
        for ((k, v) in map) {
            emit("onRealtime", JSONObject().apply {
                put("metric", k); put("value", v.toDouble()); put("unit", ""); put("ts", ts)
                // ★ v82：同 GSR，标记为主动测量结果帧 → JS 旁路脱手冻结（测量停血氧流致误判摘戒）
                put("source", "measurement")
            })
        }
        log("[VeepooRing ANDROID] miniCheckup V2 ✅ stress=${d.stress} fatigue=${d.fatigue} " +
            "skin=${d.skinElectricity?.skinMoistureContent} emitted=${map.size}")
        android.util.Log.e("SNAPDG", "mini V2 EMIT stress=${d.stress} fatigue=${d.fatigue} " +
            "skin=${d.skinElectricity?.skinMoistureContent} eda=${map["eda"]} emitted=${map.size}")
        finishMiniCheckup("v2 success")
    }

    @ReactMethod
    fun stopEcg() {
        stopEcgInternal("js stopEcg")
    }

    /** 归还 ECG 通道：清兜底定时器 + stopDetectECG + 复位监听/缓冲。可重入、幂等。 */
    private fun stopEcgInternal(reason: String) {
        ecgPendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        ecgPendingStop = null
        // ★ 2026-11-17 二次修复：正常交付路径里也会调 stop，此时 guard 已完成使命；
        //   但若因手动停止/断连/异常进入，须撤销兜底任务，避免停测后又吐出旧结果。
        //   emitEcgFromSnapshot 调用它时已经先撤过 guard，这里再撤一次是幂等的。
        ecgFinishGuard?.let { mainHandler.removeCallbacks(it) }
        ecgFinishGuard = null
        // ★ 2026-11-17 三次修复：stop 即终结本次测量，标记 delivered 防止 watchdog 在停止后
        //   又吐出旧快照结果（尤其手动停止/断连/异常路径）。正常出值路径本就已置 true，这里幂等。
        ecgDelivered = true
        val listener = ecgDetectListener
        ecgDetectListener = null
        if (listener != null) {
            try { manager.stopDetectECG(IBleWriteResponse { _ -> }, true, listener) } catch (_: Throwable) {}
        }
        ecgSentCount = 0
        ecgNotLeadCount = 0
        ecgDiagnosis = null
        // 注意：ecgResultEmitted 不在此重置——迟到的 result 回调要靠它去重，只在 startEcg 重置
        // 测量占用血氧流较久，结束时把锚点前移 + 置宽限期，避免血氧流恢复期被误判脱手
        lastMeasureEndAt = System.currentTimeMillis()
        if (lastSpO2SampleAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastSpO2SampleAt = lastMeasureEndAt
        if (lastAnySpo2FrameAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = lastMeasureEndAt
        // ★ 2026-11-18（根治）：startEcg 停掉了血氧流(spo2Listener=null)，以前这里只前移锚点、
        //   从不恢复 → 每次心电后血氧流永久停摆，几十秒后被看门狗误判脱手(worn=false)，
        //   用户接着点快检/体检就被弹「未佩戴」。测量结束必须把血氧连续流拉回来。
        if (monitorOn && ready.get() && !ppgReleaseActive && spo2Listener == null) {
            startSpo2hOnly()
            log("[VeepooRing ANDROID] ecg stopped: SPO2H stream resumed")
        }
        log("[VeepooRing ANDROID] ecg stopped ($reason)")
    }

    /**
     * ★ 2026-11-17：ECG 实时心电测量真实接线（此前是 stub，导致 JS onEcg 死代码）。
     *   SDK 状态机经 IECGDetectListener 回调：
     *     onEcgDetectInfoChange   → 采样率/增益（画波形参数）
     *     onEcgDetectStateChange  → 进度 + 实时心率 + 导联脱落(UNPASS_WEAR)/忙(BUSY)
     *     onEcgDetectResultChange → 最终结果（aveHeart/aveHrv/aveResRate/aveQT/PWV + 波形），emit onEcg
     *     onEcgDetectDiagnosisChange → 多诊断报告（缓存，随结果一起发）
     *     onEcgADCChange          → 增量 ADC 波形，转 mV 后随进度 emit onEcgProgress.waveform
     *   与 iOS startEcgTest / finishEcgWithModel 的 emit 契约完全一致。
     */
    private fun startEcg() {
        if (!ready.get()) {
            emit("onEcgProgress", JSONObject().apply { put("error", "戒指未连接，请先连接后再测") })
            return
        }
        if (ecgDetectListener != null) stopEcgInternal("reenter")
        // ★ 2026-11-24（真机实证 v95）：用户主动 ECG 优先。自动快照轮转的 miniCheckup/GSR
        //   独占 PPG，若在 ECG 之前已启动，会把 ECG 波形从半途掐断（实测采到 63% 后断流，
        //   ecg stopped(js stopEcg)）。启动 ECG 前先归还被自动快照占用的 PPG 通道。
        //   注意：不调用 stopSnapshotRotation()——轮转本身继续，后续 tick 因 ecgDetectListener!=null 自动跳过。
        if (miniCheckupListener != null) {
            log("[VeepooRing ANDROID] ECG preempts in-flight miniCheckup (PPG)")
            finishMiniCheckup("ecg preempts")
        }
        if (gsrDetectListener != null) {
            log("[VeepooRing ANDROID] ECG preempts in-flight GSR (PPG)")
            finishGsrDetect("ecg preempts")
        }
        // ★ 2026-11-17 二次修复：重进时清掉上一次可能残留的兜底任务/交付标志
        ecgFinishGuard?.let { mainHandler.removeCallbacks(it) }
        ecgFinishGuard = null
        ecgDelivered = false
        ecgReached100At = 0L
        if (ppgReleaseActive) {
            emit("onEcgProgress", JSONObject().apply { put("error", "设备正忙，请稍后再测") })
            return
        }
        // ★ 2026-11-21（用户纠正）：ECG 固件实测支持（v69 真机已出 6 项风险真值），能力位 capEcg=false
        //   是误判。不再用它拒绝测量——只记录日志，继续真正发起，交戒指裁决；看门狗兜底不卡死。
        if (capEcg == false) {
            log("[VeepooRing ANDROID] ECG capEcg=false（记录但按用户要求继续尝试测量）")
            android.util.Log.e("GATECAP", "ecg capEcg=false -> PROCEED")
        }
        try {
            if (!VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportECG()) {
                log("[VeepooRing ANDROID] ECG isSupportECG=false（记录但继续尝试）")
                android.util.Log.e("GATECAP", "ecg isSupportECG=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] ECG cap check failed: ${e.message}")
        }
        // ★ 2026-11-20 协议深挖：打印诊断字段填充的两道门的真实值（Log.e 直写，防被JS日志流冲掉）
        try {
            val sp = VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext)
            val ecgType = sp.getECGType()
            val multiDiag = sp.isSupportEcgMultiDiagnoses()
            val diseaseCap = manager.getFunctionCheck().checkEcgDisease()
            android.util.Log.e("DIAGGATE", "GATE ecgType=$ecgType multiDiag=$multiDiag checkEcgDisease=$diseaseCap")
        } catch (e: Throwable) {
            android.util.Log.e("DIAGGATE", "GATE probe failed: ${e.message}")
        }
        try {
            // ECG 与血氧共用 PPG：先停血氧流，出值/超时后由 stopEcgInternal 归还（JS measure 前 cancelPpgRelease 已调用）
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            ecgSentCount = 0
            ecgNotLeadCount = 0
            ecgDiagnosis = null
            ecgWaveBuf.clear()
            ecgRrBuf.clear()
            ecgResultEmitted = false // 每次新测量重置；不要在 stop 时重置（迟到的 result 回调会二次 emit）
            val ecgType = try { VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).getECGType() } catch (_: Throwable) { 1 }
            log("[VeepooRing ANDROID] ECG start (ecgType=$ecgType)")
            ecgDetectListener = object : IECGDetectListener {
                override fun onEcgDetectInfoChange(info: EcgDetectInfo?) {
                    log("[VeepooRing ANDROID] ECG info freq=${info?.frequency} draw=${info?.drawFrequency}")
                }

                override fun onEcgDetectStateChange(state: EcgDetectState?) {
                    val s = state ?: return
                    ecgLastActiveAt = SystemClock.elapsedRealtime() // 有任何状态推进=测量活着，喂狗
                    val hr = if (s.hr1 > 0) s.hr1 else 0
                    // ★ 2026-11-17 诊断：实测这台戒指 ECG 只回 info 帧、疑似无 state/结果帧 →
                    //   把进度/设备状态打出来确诊（节流： progress 或 deviceState 变化才打）
                    val dbgKey = "${s.progress}/${s.deviceState}/adc=$ecgSentCount"
                    if (dbgKey != ecgLastStateLog) {
                        ecgLastStateLog = dbgKey
                        log("[VeepooRing ANDROID] ECG state progress=${s.progress} devState=${s.deviceState} hr=$hr adcFrames=$ecgSentCount")
                    }
                    when (s.deviceState) {
                        EDeviceStatus.BUSY -> {
                            stopEcgInternal("device busy")
                            emit("onEcgProgress", JSONObject().apply { put("error", "设备正忙，请稍后再测") })
                            return
                        }
                        EDeviceStatus.UNPASS_WEAR -> {
                            ecgNotLeadCount += 1
                            log("[VeepooRing ANDROID] ECG 导联脱落 count=$ecgNotLeadCount")
                            if (ecgNotLeadCount >= 3) {
                                stopEcgInternal("not lead x3")
                                emit("onEcgProgress", JSONObject().apply {
                                    put("error", "导联脱落：请把戒指戴紧一点，用另一只手食指轻触戒指外侧电极再测")
                                })
                            } else {
                                emit("onEcgProgress", JSONObject().apply { put("hint", "请保持手指接触戒指外侧电极…") })
                            }
                            return
                        }
                        else -> { ecgNotLeadCount = 0 } // 已闭合回路 → 清零脱落计数
                    }
                    // ★ 2026-11-17 三次修复（真机 23:17 铁证）：progress=100 的日志能打出来，
                    //   但其后的快照读取(s.hrv/qtc/pwv/br1)或 emit 一旦在 SDK 反射回调里抛异常，
                    //   整个 onEcgDetectStateChange 会被静默中断 → guard/watchdog 都挂不上 → UI 永久卡住。
                    //   对策：整段 try-catch；任何异常都强制走 snapshot 兜底，绝不静默。
                    try {
                        emit("onEcgProgress", JSONObject().apply {
                            put("progress", s.progress); put("hr", hr)
                        })
                        // 快照逐字段 try：某个 getter 抛异常也不能挡住 100% 出值
                        ecgSnapHr = hr
                        try { ecgSnapHrv = s.hrv } catch (e: Throwable) { ecgSnapHrv = 0 }
                        try { ecgSnapQtc = s.qtc } catch (e: Throwable) { ecgSnapQtc = 0 }
                        try { ecgSnapPwv = s.pwv } catch (e: Throwable) { ecgSnapPwv = 0 }
                        try { ecgSnapBr = s.br1 } catch (e: Throwable) { ecgSnapBr = 0 }
                        // ★ v62：采集 RR 间期（合理区间 300–2000ms），供本地 SDNN/RMSSD 统计
                        try { val rr1 = s.rr1; if (rr1 in 300..2000) ecgRrBuf.add(rr1) } catch (_: Throwable) {}
                        // 100% = 测量完成权威信号。同步立即挂 guard + 出值。
                        if (s.progress >= 100 && hr > 0) {
                            if (ecgReached100At == 0L) {
                                ecgReached100At = SystemClock.elapsedRealtime()
                                log("[VeepooRing ANDROID] ECG reached 100%, schedule guard")
                                val guard = object : Runnable {
                                    override fun run() {
                                        if (ecgDelivered) return
                                        log("[VeepooRing ANDROID] ECG 100% guard fire — 强制兜底交付")
                                        emitEcgFromSnapshot("100%-guard")
                                    }
                                }
                                ecgFinishGuard = guard
                                mainHandler.postDelayed(guard, 1_500L)
                            }
                            if (!ecgDelivered) emitEcgFromState(s, hr)
                        }
                    } catch (e: Throwable) {
                        // 兜底：即使上面任何一步炸了，只要到 100% 就用快照强制出值
                        log("[VeepooRing ANDROID] ECG state handler EXCEPTION: ${e.javaClass.simpleName}: ${e.message}")
                        ecgSnapHr = if (ecgSnapHr > 0) ecgSnapHr else hr
                        if (s.progress >= 100 && ecgSnapHr > 0 && !ecgDelivered) {
                            emitEcgFromSnapshot("100%-catch-fallback")
                        }
                    }
                }

                /** 从 EcgDetectState 的结果字段组装 onEcg 出值（对齐 iOS finishEcgWithModel）。 */
                private fun emitEcgFromState(s: EcgDetectState, hr: Int) {
                    if (ecgDelivered) return
                    ecgDelivered = true
                    ecgResultEmitted = true
                    // 结果已交付，撤掉 100% 兜底任务
                    ecgFinishGuard?.let { mainHandler.removeCallbacks(it) }
                    ecgFinishGuard = null
                    log("[VeepooRing ANDROID] ECG result FROM STATE hr=$hr hrv=${s.hrv} qtc=${s.qtc} pwv=${s.pwv} br=${s.br1} wave=${ecgWaveBuf.size}")
                    val analysis = buildEcgAnalysis(s.hrv, s.qtc, s.pwv, s.br1)
                    // ★ 注意：SDNN/RMSSD/QRS/ST/风险指数来自设备多诊断报告 EcgDiagnosis；
                    //   这台戒指的 diagnosis 回调从未触发 → 这些字段本机无数据，
                    //   一律不写 0（0 会被 UI 误读成"正常"），交由前端显示"—/未获取"。
                    emit("onEcg", JSONObject().apply {
                        put("aveHeart", hr)
                        put("aveHrv", s.hrv)
                        put("aveResRate", if (s.br1 > 0) s.br1 else (ecgDiagnosis?.respRate ?: 0))
                        put("aveQT", s.qtc)
                        put("avePWV", if (s.pwv > 0) s.pwv else (ecgDiagnosis?.pwvMeanVal ?: 0))
                        put("waveform", downsampleWave(ecgWaveBuf))
                        // ★ 2026-11-24：波形真实采样率/原始帧数，供 JS 估算呼吸率时推算等效采样率
                        //   （downsampleWave 压到 2000 点，若按固定 36s 猜会因实际采样时长不同而算错频率）
                        put("waveHz", 500)
                        put("waveFrames", ecgWaveBuf.size)
                        put("analysis", analysis)
                    })
                    // ★ 2026-11-20(v64)：实时测量回调不带诊断报告，主动读回设备端存储的那份，
                    //   把 6 大风险指数 + QRS/ST/SDNN/RMSSD 补进报告页（竞品同款，读历史 ECG 诊断）。
                    scheduleEcgDiagnosisRead()
                    stopEcgInternal("result from state")
                }

                override fun onEcgDetectResultChange(result: EcgDetectResult?) {
                    val r = result ?: return
                    // ★ 双路去重（统一用 ecgDelivered）：若 state/兜底已交付，忽略这个迟到的结果回调
                    if (ecgDelivered) { log("[VeepooRing ANDROID] ECG result callback ignored (already delivered)"); return }
                    val aveHeart = r.aveHeart
                    if (aveHeart <= 0) {
                        stopEcgInternal("invalid result hr=$aveHeart")
                        emit("onEcgProgress", JSONObject().apply { put("error", "未获得有效读数，请重试") })
                        return
                    }
                    // 波形转 mV（对齐 iOS convertToMvWithValue）：优先 filterSignals，回退 originSign
                    val raw = if (r.filterSignals?.isNotEmpty() == true) r.filterSignals else r.originSign
                    val wave = mutableListOf<Double>()
                    if (raw != null) {
                        for (v in raw) {
                            if (v == Int.MAX_VALUE) continue
                            val mv = EcgUtil.convertToMvWithValue(v, ecgType, false, 20)
                            wave.add((mv * 100.0).toLong() / 100.0) // 保留 2 位
                        }
                    }
                    // 多诊断报告（设备返回，非本地测算）—— 仅透传数值，不本地诊断/评分
                    val analysis = JSONObject()
                    ecgDiagnosis?.let { d ->
                        analysis.put("arrhythmiaRisk", d.diseaseRisk)
                        analysis.put("stressIndex", d.pressureIndex)
                        analysis.put("fatigueIndex", d.fatigueIndex)
                        analysis.put("myocarditisRisk", d.myocarditisRisk)
                        analysis.put("chdRisk", d.chdRisk)
                        analysis.put("angiosclerosisRisk", d.angioscleroticRisk)
                        analysis.put("qrsTime", d.qrsTime)
                        analysis.put("qrsAmp", d.qrsAmp)
                        analysis.put("stMeanAmp", d.stMeanAmp)
                        analysis.put("pwvMeanVal", d.pwvMeanVal)
                        analysis.put("sdnn", d.diseaseSdnn)
                        analysis.put("rmssd", d.diseaseRmssd)
                    }
                    // javap 核对：EcgDetectResult 只有 aveHeart/aveHrv/aveResRate/aveQT；
                    //   PWV 在 EcgDiagnosis.pwvMeanVal（Device 多诊断报告）里，无报告则为 0。
                    val pwv = ecgDiagnosis?.pwvMeanVal ?: 0
                    ecgResultEmitted = true
                    ecgDelivered = true
                    ecgFinishGuard?.let { mainHandler.removeCallbacks(it) }
                    ecgFinishGuard = null
                    emit("onEcg", JSONObject().apply {
                        put("aveHeart", aveHeart)
                        put("aveHrv", r.aveHrv)
                        put("aveResRate", if (r.aveResRate > 0) r.aveResRate else (ecgDiagnosis?.respRate ?: 0))
                        put("aveQT", r.aveQT)
                        put("avePWV", pwv)
                        put("waveform", downsampleWave(wave))
                        put("waveHz", 500)
                        put("waveFrames", wave.size)
                        put("analysis", analysis)
                    })
                    // ★ 2026-11-20(v64)：同 state 路径，主动读回设备诊断报告补齐风险指数
                    scheduleEcgDiagnosisRead()
                    stopEcgInternal("result ok")
                }

                override fun onEcgDetectDiagnosisChange(diagnosis: EcgDiagnosis?) {
                    ecgDiagnosis = diagnosis
                    if (diagnosis == null) return
                    android.util.Log.e("DIAGGATE", "DIAG-CALLBACK risk=${diagnosis.diseaseRisk} chd=${diagnosis.chdRisk} angio=${diagnosis.angioscleroticRisk} myo=${diagnosis.myocarditisRisk} pressure=${diagnosis.pressureIndex} fatigue=${diagnosis.fatigueIndex} qrsT=${diagnosis.qrsTime} qrsA=${diagnosis.qrsAmp} st=${diagnosis.stMeanAmp} sdnn=${diagnosis.diseaseSdnn} rmssd=${diagnosis.diseaseRmssd} hr=${diagnosis.heartRate}")
                    // ★ 2026-11-20(v69) 真机实证：这枚戒指(ecgType=9, checkEcgDisease=true)确实回传完整诊断，
                    //   但该回调比结果帧晚到（或报告已先交付），导致 analysis 组装时 ecgDiagnosis 还是 null。
                    //   修复：诊断一到就立刻组装并 emit onEcgDiagnosis，让前端局部合并进最新报告（不新增记录）。
                    //   若报告尚未交付，前端 handler 会因「无当前报告」忽略——此时 emitEcgFromState 里的
                    //   buildEcgAnalysis 会直接从 ecgDiagnosis 读到值（因为回调已先写入），两条路都覆盖。
                    emitEcgDiagnosisUpdate(diagnosis)
                }

                override fun onEcgADCChange(data: IntArray?, power: IntArray?) {
                    val adc = data ?: return
                    if (adc.isEmpty()) return
                    ecgLastActiveAt = SystemClock.elapsedRealtime() // 波形持续到达=测量活着，喂狗
                    // ★ 2026-11-17 诊断：首帧波形到达 = 手指/导联已闭合、设备确在采样。
                    if (ecgSentCount == 0) log("[VeepooRing ANDROID] ECG first ADC frame len=${adc.size}（导联已闭合，开始采样）")
                    val delta = JSONArray()
                    for (i in adc.indices) {
                        val v = adc[i]
                        if (v == Int.MAX_VALUE) continue
                        val p = if (power != null && i < power.size) power[i] else 20
                        val mv = EcgUtil.convertToMvWithValue(v, ecgType, false, p)
                        val rounded = (mv * 100.0).toLong() / 100.0
                        delta.put(rounded)
                        ecgWaveBuf.add(rounded) // 缓存完整波形，供 progress=100 从 state 兜底出结果
                    }
                    ecgSentCount += adc.size
                    emit("onEcgProgress", JSONObject().apply {
                        put("progress", -1) // -1 = 纯波形增量帧，JS 侧不更新进度数字
                        put("waveform", delta)
                    })
                }
            }
            manager.startDetectECG(IBleWriteResponse { _ -> }, true, ecgDetectListener)
            // ★ 2026-11-17 修复「卡在生成报告」真因：
            //   原实现是固定 90s 硬超时，但实测这台戒指进度会正常走到 100、波形采满 18000+ 帧、
            //   心率都测到 82 了，结果帧还在设备端计算时——90s 到点直接 stopDetectECG，把结果掐死，
            //   UI 永远停在 99%。改为「停滞看门狗」：每 5s 检查一次，只要 state/波形还在推进就喂狗、
            //   绝不打断；只有连续 25s 无任何进展（真卡住/导联一直接触不上）才停并报错。
            //   另设 180s 绝对上限兜底，防止固件异常时无限等待。
            val startedAt = SystemClock.elapsedRealtime()
            ecgLastActiveAt = startedAt
            val watchdog = object : Runnable {
                override fun run() {
                    // ★ 2026-11-17 三次修复：只要结果还没交付就继续兜底，不再因 listener 被置 null 直接放弃。
                    //   原逻辑 `if (listener==null) return` 会在异常导致 listener 提前清空时误杀看门狗。
                    if (ecgDelivered) return // 唯一退出条件：结果已真正交付
                    val now = SystemClock.elapsedRealtime()
                    val idle = now - ecgLastActiveAt
                    // ★ 100% 后用独立计时，不受波形继续刷新喂狗影响。3s 强制兜底交付。
                    val since100 = if (ecgReached100At > 0L) now - ecgReached100At else -1L
                    when {
                        (since100 in 0 until 3_000L) -> {
                            // 已到 100% 但还没交付：短轮询给 guard 机会
                            Handler(Looper.getMainLooper()).postDelayed(this, 1_000L)
                        }
                        since100 >= 3_000L -> {
                            log("[VeepooRing ANDROID] ECG 100% waited ${since100/1000}s, force deliver (listener=${ecgDetectListener != null})")
                            emitEcgFromSnapshot("100%-watchdog")
                        }
                        now - startedAt >= 180_000L -> {
                            stopEcgInternal("absolute timeout 180s")
                            emit("onEcgProgress", JSONObject().apply { put("error", "心电测量超时，请重试") })
                        }
                        idle >= 25_000L -> {
                            log("[VeepooRing ANDROID] ECG stall ${idle/1000}s no progress, stop")
                            stopEcgInternal("stall ${idle/1000}s")
                            emit("onEcgProgress", JSONObject().apply { put("error", "心电信号中断，请确认手指持续按住电极后重试") })
                        }
                        else -> Handler(Looper.getMainLooper()).postDelayed(this, 5_000L)
                    }
                }
            }
            ecgPendingStop = watchdog
            Handler(Looper.getMainLooper()).postDelayed(watchdog, 5_000L)
        } catch (e: Throwable) {
            // ★ 2026-11-17：UnsatisfiedLinkError 等是 Error 不是 Exception，必须兜 Throwable，
            //   否则 SDK 内部 so 加载失败会直接杀掉整个 RN 进程（真机已复现闪退）。
            log("[VeepooRing ANDROID] ECG start FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopEcgInternal("start exception")
            emit("onEcgProgress", JSONObject().apply { put("error", "心电测量启动失败：${e.javaClass.simpleName}，请重试") })
        }
    }

    /** ★ 2026-11-17 二次修复：从快照强制交付 ECG 结果（100% 兜底任务 / 看门狗调用，类级别方法）。
     *   只读快照字段；整段 try-catch，任何异常都转成明确的 onEcgProgress.error，绝不静默卡住 UI。 */
    private fun emitEcgFromSnapshot(source: String) {
        if (ecgDelivered) return
        ecgDelivered = true
        ecgResultEmitted = true
        ecgFinishGuard?.let { mainHandler.removeCallbacks(it) }
        ecgFinishGuard = null
        val hr = ecgSnapHr
        log("[VeepooRing ANDROID] ECG result FROM $source hr=$hr hrv=$ecgSnapHrv qtc=$ecgSnapQtc pwv=$ecgSnapPwv br=$ecgSnapBr wave=${ecgWaveBuf.size}")
        if (hr <= 0) {
            stopEcgInternal("snapshot invalid hr")
            emit("onEcgProgress", JSONObject().apply { put("error", "心电测量未获得有效读数，请重试") })
            return
        }
        try {
            val analysis = buildEcgAnalysis(ecgSnapHrv, ecgSnapQtc, ecgSnapPwv, ecgSnapBr)
            android.util.Log.e("DIAGGATE", "DELIVER ecgDiagnosisPresent=${ecgDiagnosis != null} analysisLen=${analysis.length()} analysis=$analysis")
            emit("onEcg", JSONObject().apply {
                put("aveHeart", hr)
                put("aveHrv", ecgSnapHrv)
                put("aveResRate", if (ecgSnapBr > 0) ecgSnapBr else (ecgDiagnosis?.respRate ?: 0))
                put("aveQT", ecgSnapQtc)
                put("avePWV", if (ecgSnapPwv > 0) ecgSnapPwv else (ecgDiagnosis?.pwvMeanVal ?: 0))
                put("waveform", downsampleWave(ecgWaveBuf))
                put("waveHz", 500)
                put("waveFrames", ecgWaveBuf.size)
                put("analysis", analysis)
            })
            stopEcgInternal("result $source")
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] ECG snapshot deliver FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopEcgInternal("snapshot deliver failed")
            emit("onEcgProgress", JSONObject().apply { put("error", "心电结果处理失败，请重试") })
        }
    }

    /**
     * ★ 2026-11-17：血糖主动测量真实接线（此前无分支）。SDK startBloodGlucoseDetect 的
     *   onBloodGlucoseDetect(progress, value, level) 逐帧回传，value>0 即经 onRealtime 落库
     *   （metric=glucose，与 JS handleRealtime → healthStore → 体检报告同源）。
     */
    private fun startGlucoseDetect() {
        if (!ready.get()) { log("[VeepooRing ANDROID] Glucose detect skip: ring not ready"); return }
        if (glucoseListener != null) stopGlucoseInternal("reenter")
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] Glucose detect skip: ppg release window"); return }
        if (bpDetectListener != null || hrvDetectListener != null || hrListener != null || ecgDetectListener != null) {
            log("[VeepooRing ANDROID] Glucose detect skip: other measure in progress"); return
        }
        // ★ 2026-11-21（用户明确纠正）：不再用能力位拒绝测量。历史回传实证戒指能给出血糖真值
        //   （extValues.glucose=4.51），能力位来自 SP 默认 false / 能力包，不可靠。改为只记录、继续真正
        //   发起测量，交戒指实测裁决；真不支持时 SDK 会回 error 或走 150s 看门狗收口，不会卡死。
        if (capGlucose == false) {
            log("[VeepooRing ANDROID] Glucose capGlucose=false（记录但按用户要求继续尝试测量）")
            android.util.Log.e("GATECAP", "glucose capGlucose=false -> PROCEED")
        }
        try {
            if (!VpSpGetUtil.getVpSpVariInstance(reactContext.applicationContext).isSupportBloodGlucoseDetect()) {
                log("[VeepooRing ANDROID] Glucose isSupportDetect=false（记录但继续尝试）")
                android.util.Log.e("GATECAP", "glucose isSupportDetect=false -> PROCEED")
            }
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] Glucose cap check failed: ${e.message}")
        }
        try {
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            log("[VeepooRing ANDROID] Glucose detect started")
            glucoseListener = object : AbsBloodGlucoseChangeListener() {
                override fun onDetectError(opt: Int, status: EBloodGlucoseStatus?) {
                    log("[VeepooRing ANDROID] Glucose detect error opt=$opt status=$status")
                    // ★ 2026-11-18：错误必须反馈到 UI（此前静默 stop，用户感知「点了没反应」）
                    val msg = when (status) {
                        com.veepoo.protocol.model.enums.EBloodGlucoseStatus.WEARING_ERROR -> "未检测到正确佩戴，请调整戒指后重试"
                        com.veepoo.protocol.model.enums.EBloodGlucoseStatus.LOW_POWER -> "戒指电量不足，请充电后重试"
                        com.veepoo.protocol.model.enums.EBloodGlucoseStatus.BUSY -> "戒指繁忙（可能有其它测量），稍后重试"
                        com.veepoo.protocol.model.enums.EBloodGlucoseStatus.NONSUPPORT -> "当前戒指固件不支持血糖测量"
                        else -> "血糖检测出错($status)，请重试"
                    }
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "glucose"); put("error", msg); put("ts", System.currentTimeMillis())
                    })
                    stopGlucoseInternal("detect error")
                }
                override fun onBloodGlucoseDetect(progress: Int, bloodGlucose: Float, level: com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel?) {
                    log("[VeepooRing ANDROID] Glucose progress=$progress value=$bloodGlucose level=$level")
                    // ★ 2026-11-18（用户：血糖点了没反应）：progress 帧必须推到 JS 驱动 UI。
                    //   真机实锤：检测正常跑（0→6→12%，约 1.3s/6%），但此前 progress 只打日志不 emit，
                    //   界面毫无变化 → 用户连点 → 每次点击 reenter 清掉检测重来 → 永远到不了 100。
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "glucoseProgress")
                        put("value", progress.coerceIn(0, 100))
                        put("ts", System.currentTimeMillis())
                    })
                    if (bloodGlucose > 0 && bloodGlucose < 40f) {
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "glucoseProgress")
                            put("value", 100)
                            put("ts", System.currentTimeMillis())
                        })
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "glucose")
                            put("value", (bloodGlucose * 100.0).toLong() / 100.0) // mmol/L 保留 2 位
                            put("unit", "mmol/L")
                            put("ts", System.currentTimeMillis())
                        })
                        // ★ 2026-11-19(v62)：设备血糖风险等级真实回传（SDK 回调第 3 参此前只打日志）。
                        //   LOW=1 / MIDDLE=2 / HIGH=3 与 MetricDetailScreen.GLUCOSE_LEVELS 对齐；
                        //   NONE 不发（UI 显示"—"，绝不写假值）。
                        if (level != null) {
                            val lv = when (level) {
                                com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.LOW -> 1
                                com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.MIDDLE -> 2
                                com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.HIGH -> 3
                                else -> null
                            }
                            if (lv != null) emit("onRealtime", JSONObject().apply {
                                put("metric", "glucoseLevel")
                                put("value", lv)
                                put("ts", System.currentTimeMillis())
                            })
                        }
                        stopGlucoseInternal("value ok")
                    }
                }
                override fun onBloodGlucoseStopDetect() {
                    log("[VeepooRing ANDROID] Glucose detect stopped by device")
                    // ★ 2026-11-18：设备主动停止（多为佩戴不稳/条件不满足）——反馈到 UI，不再静默。
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "glucose"); put("error", "戒指中断了血糖检测，请保持佩戴静止后重试"); put("ts", System.currentTimeMillis())
                    })
                    // 设备已自行停止，不发 stopBloodGlucoseDetect（避免来回停）；
                    // 但要清兜底 + 复位通道状态（lastMeasureEndAt 宽限），走幂等清理。
                    glucosePendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
                    glucosePendingStop = null
                    glucoseListener = null
                    lastMeasureEndAt = System.currentTimeMillis()
                }
            }
            // ★ 2026-11-18（用户：血糖点了没反应）：换带模式的 3 参重载。
            //   血压当时就是换 DETECT_MODEL_PUBLIC（公开模式）才通的；此前 2 参重载用 SDK 默认
            //   模式，真机表现是设备立刻 onBloodGlucoseStopDetect / 90s 零回调。
            //   写响应码照 BP 的做法打日志，失败可见。
            // ★ 2026-11-18（用户：血糖点了没反应）：按能力位选命令。
            //   反编译实锤：2 参重载发公开命令字节（profile vp_bs）；3 参 PRIVATE 发 vp_bt。
            //   Veepoo 血糖分级固件（MultipleAdjusting=SUPPORT）只认私有命令，公开命令设备 1s 内 stop。
            val gModel = if (glucosePrivateMode)
                com.veepoo.protocol.model.enums.EBloodGlucoseDetectModel.DETECT_MODEL_PRIVATE
            else
                com.veepoo.protocol.model.enums.EBloodGlucoseDetectModel.DETECT_MODEL_PUBLIC
            log("[VeepooRing ANDROID] Glucose detect model=$gModel (privateMode=$glucosePrivateMode)")
            manager.startBloodGlucoseDetect(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] Glucose detect write resp=$code")
            }, glucoseListener, gModel)
            // ★ 2026-11-18：真机 progress 0→6→12% 约 1.3s/6% → 全程 ~130s，90s 兜底会在检测中途
            //   把检测杀掉（timeout 时 value 还没出）——改 150s 留足余量。
            val stop = Runnable { stopGlucoseInternal("timeout 150s") }
            glucosePendingStop = stop
            Handler(Looper.getMainLooper()).postDelayed(stop, 150_000L)
        } catch (e: Throwable) {
            // ★ 2026-11-17：同 ECG，兜 Throwable 防止 Error 杀进程
            log("[VeepooRing ANDROID] Glucose detect FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopGlucoseInternal("start exception")
            emit("onRealtime", JSONObject().apply {
                put("metric", "glucose"); put("error", "血糖测量启动失败：${e.javaClass.simpleName}")
            })
        }
    }

    /** 归还血糖通道：清兜底 + stop + 复位。幂等。 */
    private fun stopGlucoseInternal(reason: String) {
        glucosePendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        glucosePendingStop = null
        val listener = glucoseListener
        glucoseListener = null
        if (listener != null) {
            // ★ 2026-11-18：stop 命令同样分模式（反编译：PUBLIC 发 vp_bu、PRIVATE 发 vp_bv），
            //   私有模式固件对公开 stop 不响应 → 带模型参数下发。
            try {
                manager.stopBloodGlucoseDetect(IBleWriteResponse { _ -> }, listener,
                    if (glucosePrivateMode) com.veepoo.protocol.model.enums.EBloodGlucoseDetectModel.DETECT_MODEL_PRIVATE
                    else com.veepoo.protocol.model.enums.EBloodGlucoseDetectModel.DETECT_MODEL_PUBLIC)
            } catch (_: Throwable) {}
        }
        lastMeasureEndAt = System.currentTimeMillis()
        if (lastSpO2SampleAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastSpO2SampleAt = lastMeasureEndAt
        if (lastAnySpo2FrameAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = lastMeasureEndAt
        // ★ 2026-11-18(2)：超时兜底也要反馈到 UI（错误帧无 value，JS 已在 value 闸门前处理），
        //   否则用户会永远卡在「测量中 x%」。
        if (reason.startsWith("timeout")) {
            emit("onRealtime", JSONObject().apply {
                put("metric", "glucose"); put("error", "血糖检测超时，请保持佩戴静止后重试"); put("ts", System.currentTimeMillis())
            })
        }
        log("[VeepooRing ANDROID] glucose stopped ($reason)")
    }

    /**
     * ★ 2026-11-18：血液成分主动测量（尿酸 + 血脂四项）。
     *   此前 measure('ua'/'cholesterol'/...) 全落到 triggerHealthGlance() 空 stub，从不调 SDK、不 emit →
     *   洞察页血液成分 tab 永远无数据。这里接真实 SDK startDetectBloodComponent，
     *   onDetectComplete 拿到 BloodComponent（设备评估值）→ 逐项 emit onRealtime 落 healthStore。
     *   合规：仅透传设备返回值，不本地测算/诊断；能力位 capBloodComponent 门禁。
     */
    private fun startBloodComponentDetect() {
        if (!ready.get()) { log("[VeepooRing ANDROID] BloodComponent skip: not ready"); return }
        if (bloodComponentListener != null) stopBloodComponentInternal("reenter")
        if (ppgReleaseActive) { log("[VeepooRing ANDROID] BloodComponent skip: ppg release window"); return }
        if (bpDetectListener != null || hrvDetectListener != null || hrListener != null || ecgDetectListener != null || glucoseListener != null) {
            log("[VeepooRing ANDROID] BloodComponent skip: other measure in progress"); return
        }
        // ★ 2026-11-21（用户纠正）：不再用能力位拒绝。历史回传实证血脂真值在库（TG0.88/HDL1.02/LDL0.76），
        //   能力位不可靠 → 继续真正发起测量，戒指实测裁决；失败有 90s 看门狗兜底。
        if (capBloodComponent == false) {
            log("[VeepooRing ANDROID] BloodComponent capBloodComponent=false（记录但继续尝试测量）")
            android.util.Log.e("GATECAP", "bloodcomp capBloodComponent=false -> PROCEED")
        }
        // ★ v90：每次新测量重置结果状态，防止上一轮缓存/已发标志污染本轮
        bcLastValues = null
        bcResultEmitted = false
        try {
            spo2Listener?.let { manager.stopDetectSPO2H(IBleWriteResponse { _ -> }, it) }
            spo2Listener = null
            log("[VeepooRing ANDROID] BloodComponent detect started")
            bloodComponentListener = object : IBloodComponentDetectListener {
                override fun onDetectFailed(errorState: EBloodComponentDetectState) {
                    log("[VeepooRing ANDROID] BloodComponent detect failed: $errorState")
                    emit("onRealtime", JSONObject().apply { put("metric", "bloodcomp"); put("error", "血液成分测量失败，请重试") })
                    stopBloodComponentInternal("detect failed")
                }
                override fun onDetecting(progress: Int, data: BloodComponent) {
                    log("[VeepooRing ANDROID] BloodComponent detecting progress=$progress")
                    // ★ 2026-11-18：进度推到 JS（与血糖同通道），界面显示「测量中 x%」
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "bloodcompProgress")
                        put("value", progress.coerceIn(0, 100))
                        put("ts", System.currentTimeMillis())
                    })
                    // ★ v90 核心修复：进度帧 data 已携带完整 BloodComponent 真值
                    //   （aar 字节码 vp_i.vp_a 实证 setUricAcid/setTCHO/setTAG/setHDL/setLDL）。
                    //   戒指常在 96~100% 就填好真值、随后只回 onDetectStop 不回 complete，
                    //   所以每一帧都尝试提取，一旦有 >0 的值就缓存下来供 stop 兜底。
                    val vals = readBloodComponentValues(data)
                    if (vals != null && vals.values.any { it > 0f }) {
                        bcLastValues = vals
                        android.util.Log.e("SNAPDG", "BC progress=$progress cached ua=${vals["ua"]} tc=${vals["cholesterol"]} tg=${vals["triglyceride"]} hdl=${vals["hdl"]} ldl=${vals["ldl"]}")
                    }
                }
                override fun onDetectStop() {
                    log("[VeepooRing ANDROID] BloodComponent detect stopped by device")
                    // ★ v90 兜底：戒指跑满后只回 stop 不回 complete 是本机常态。
                    //   若进度帧已缓存真值 → 当作成功结果落库（这才是尿酸/胆固醇的真来源）；
                    //   没有缓存才报「中断」错误。
                    val cached = bcLastValues
                    if (cached != null && cached.values.any { it > 0f }) {
                        android.util.Log.e("SNAPDG", "BC onDetectStop -> flush cached as RESULT ua=${cached["ua"]} tc=${cached["cholesterol"]}")
                        flushBloodComponentResult(cached, "stop-cached")
                        stopBloodComponentInternal("stop-with-result")
                    } else {
                        emit("onRealtime", JSONObject().apply {
                            put("metric", "bloodcomp"); put("error", "戒指中断了血液成分检测，请保持佩戴静止后重试"); put("ts", System.currentTimeMillis())
                        })
                        stopBloodComponentInternal("device stop")
                    }
                }
                override fun onDetectComplete(data: BloodComponent) {
                    val ts = System.currentTimeMillis()
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "bloodcompProgress"); put("value", 100); put("ts", ts)
                    })
                    val map = readBloodComponentValues(data)
                    log("[VeepooRing ANDROID] BloodComponent complete $map")
                    if (map != null && map.values.any { it > 0f }) bcLastValues = map
                    flushBloodComponentResult(map ?: bcLastValues, "complete")
                    stopBloodComponentInternal("complete")
                }
            }
            manager.startDetectBloodComponent(IBleWriteResponse { _ -> }, true, bloodComponentListener)
            val stop = Runnable { stopBloodComponentInternal("timeout 90s") }
            bloodComponentPendingStop = stop
            Handler(Looper.getMainLooper()).postDelayed(stop, 90_000L)
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] BloodComponent detect FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopBloodComponentInternal("start exception")
            emit("onRealtime", JSONObject().apply { put("metric", "bloodcomp"); put("error", "血液成分测量启动失败：${e.javaClass.simpleName}") })
        }
    }

    /** 归还血液成分通道：清兜底 + stop + 复位。幂等。 */
    private fun stopBloodComponentInternal(reason: String) {
        bloodComponentPendingStop?.let { Handler(Looper.getMainLooper()).removeCallbacks(it) }
        bloodComponentPendingStop = null
        val listener = bloodComponentListener
        bloodComponentListener = null
        if (listener != null) {
            try { manager.stopDetectBloodComponent(IBleWriteResponse { _ -> }) } catch (_: Throwable) {}
        }
        lastMeasureEndAt = System.currentTimeMillis()
        if (lastSpO2SampleAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastSpO2SampleAt = lastMeasureEndAt
        if (lastAnySpo2FrameAt < lastMeasureEndAt - WEAR_OFF_SILENCE_MS) lastAnySpo2FrameAt = lastMeasureEndAt
        // ★ 2026-11-18(2)：超时兜底同样反馈到 UI，避免卡「测量中」。
        if (reason.startsWith("timeout")) {
            // ★ v90：超时也先试缓存真值（有值就当成功落库，不再误报超时）
            val cached = bcLastValues
            if (cached != null && cached.values.any { it > 0f } && !bcResultEmitted) {
                flushBloodComponentResult(cached, "timeout-cached")
            } else if (!bcResultEmitted) {
                emit("onRealtime", JSONObject().apply {
                    put("metric", "bloodcomp"); put("error", "血液成分检测超时，请保持佩戴静止后重试"); put("ts", System.currentTimeMillis())
                })
            }
        }
        log("[VeepooRing ANDROID] bloodComponent stopped ($reason)")
    }

    /** ★ v90：用反射从 BloodComponent 提取 5 项真值（Java 全大写 getter 名推断不稳，绕开编译期差异）。 */
    private fun readBloodComponentValues(data: BloodComponent): Map<String, Float>? {
        fun fv(getter: String): Float = try {
            val m = BloodComponent::class.java.getMethod(getter)
            (m.invoke(data) as Number).toFloat()
        } catch (_: Throwable) { 0f }
        val ua = fv("getUricAcid")
        val tc = fv("getTCHO")
        val tg = fv("getTAG")
        val hdl = fv("getHDL")
        val ldl = fv("getLDL")
        if (ua == 0f && tc == 0f && tg == 0f && hdl == 0f && ldl == 0f) return null
        return linkedMapOf(
            "ua" to ua, "cholesterol" to tc, "triglyceride" to tg,
            "hdl" to hdl, "ldl" to ldl,
        )
    }

    /** ★ v90：把血液成分真值逐项 emit 落库；bcResultEmitted 保证一轮测量只发一次。 */
    private fun flushBloodComponentResult(map: Map<String, Float>?, source: String) {
        if (map == null) return
        if (bcResultEmitted) {
            log("[VeepooRing ANDROID] BloodComponent flush skipped (already emitted, source=$source)")
            return
        }
        val ts = System.currentTimeMillis()
        var n = 0
        for ((k, v) in map) {
            if (v > 0f && v < 10000f) {
                emit("onRealtime", JSONObject().apply {
                    put("metric", k)
                    put("value", (v * 100.0).toLong() / 100.0)
                    put("unit", if (k == "ua") "μmol/L" else "mmol/L")
                    put("ts", ts)
                    put("historical", false)
                    put("source", "measurement")
                })
                n++
            }
        }
        if (n > 0) {
            bcResultEmitted = true
            android.util.Log.e("SNAPDG", "BC RESULT EMITTED source=$source n=$n ua=${map["ua"]} tc=${map["cholesterol"]} tg=${map["triglyceride"]}")
            log("[VeepooRing ANDROID] BloodComponent result emitted n=$n source=$source")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ★ 2026-11-18：血糖/血液成分历史记录回读（readDeviceManualData）
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * 真机实锤：戒指端血糖自动测量本来就是开的（autoMeasure type=BLOOD_GLUCOSE open=true
     * interval=30，固件每 30 分钟测一次并落盘），但 App 此前只接了「主动检测」通道
     * （startBloodGlucoseDetect / startDetectBloodComponent），从不回读戒指上存的测量记录
     * → 洞察页血糖/血液成分永远无值。
     *
     * 现接 SDK readDeviceManualData(IBleWriteResponse, long, ask, reply, listener)：
     * 按起始时间戳回读 BLOOD_GLUCOSE + BLOOD_COMPOSITION 记录，逐条经 onRealtime 回流
     * （metric=glucose/ua/cholesterol/triglyceride/hdl/ldl，ts=记录原始时间戳，historical=true），
     * 与主动检测同一落库链路（JS handleRealtime → healthStore.upsertRealtime(t=记录时间)）。
     *
     * 调用时机：finishBackfillTransaction 收口后错峰 2.5s —— 每次连接 ready / 每小时
     * 常驻闹钟同步都会触发一轮回填 → 本读取自然覆盖，无需额外定时器。
     * ABI 已 javap vpprotocol-2.3.81.15.aar 核对：BloodGlucoseManualData.getBloodGlucoseValue /
     * BloodComponentManualData.getUricAcid/gettCHO/gettAG/gethDL/getlDL 均存在。
     */
    private val manualDetectReadRunning = AtomicBoolean(false)
    /** ★ 2026-11-18：0xDE 历史记录读取在真机上偶发无任何回调（BLE 通道被排队回填占用/固件静默），
     *  允许自动重试一轮（最多 2 次发起），仍无回调则判定本固件不响应该读取协议。 */
    private var manualDetectAttempts = 0

    private fun readManualDetectHistory() {
        if (!ready.get()) return
        if (!manualDetectReadRunning.compareAndSet(false, true)) {
            log("[VeepooRing ANDROID] manualDetect read already running, skip")
            return
        }
        manualDetectAttempts++
        // 起始时间戳：回读最近 7 天（秒级；BloodGlucoseManualData.getTimeStamp 为 int 秒）
        val startSec = System.currentTimeMillis() / 1000 - 7L * 86400L
        // ★ 2026-11-18(v61)（用户：EDA/压力/疲劳/情绪/皮肤含水量接上）：
        //   除血糖/血液成分外，追加回读戒指端已落盘的 GSR/压力/疲劳/情绪/MET 测量记录，
        //   按记录原始时间戳写库（historical=true，不参与脱手冻结/现场证据判据）。
        val types = arrayListOf(
            DeviceManualDataType.BLOOD_GLUCOSE, DeviceManualDataType.BLOOD_COMPOSITION,
            DeviceManualDataType.STRESS, DeviceManualDataType.FATIGUE,
            DeviceManualDataType.SKIN_CONDUCTANCE, DeviceManualDataType.EMOTION,
            DeviceManualDataType.MET, DeviceManualDataType.MINI_CHECKUP,  // ★ v86：微体检历史也带皮电+压力
        )
        // ★ v86：SDK 文档明确第4参数 optionsList「传空数组即可」；此前误传 types 可能导致固件拒绝回读
        val emptyOptions = arrayListOf<DeviceManualDataType>()
        var settled = false
        fun settle(reason: String) {
            if (settled) return
            settled = true
            manualDetectReadRunning.set(false)
            log("[VeepooRing ANDROID] manualDetect read settled ($reason)")
            // 超时且还有重试额度：30s 后自动重试（避开可能的 BLE 通道占用窗口）
            if (reason == "timeout 15s" && manualDetectAttempts < 2) {
                Handler(Looper.getMainLooper()).postDelayed({
                    try { readManualDetectHistory() } catch (_: Throwable) {}
                }, 30_000L)
            }
        }
        // 看门狗：SDK 若静默不回调，15s 后释放占位（绝不阻塞后续轮次）。
        val watchdog = Runnable { settle("timeout 15s") }
        Handler(Looper.getMainLooper()).postDelayed(watchdog, 15_000L)
        try {
            manager.readDeviceManualData(IBleWriteResponse { code ->
                log("[VeepooRing ANDROID] manualDetect write resp=$code")
            }, startSec, types, emptyOptions,
                object : AbsDeviceManualDetectDataListener() {
                    override fun onBloodGlucoseDataChange(list: MutableList<BloodGlucoseManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val v = item.bloodGlucoseValue
                            val tsMs = item.timeStamp * 1000L
                            // 血糖 mmol/L，保留 2 位；0 为占位无效值，与主动检测同一闸门
                            if (v > 0f && v < 100f && tsMs > 0) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "glucose")
                                    put("value", (v * 100.0).toLong() / 100.0)
                                    put("unit", "mmol/L")
                                    put("ts", tsMs)
                                    put("historical", true)
                                })
                                // ★ 2026-11-19(v62)：历史记录同样回传设备风险等级（NONE 不发）
                                val lv = try {
                                    when (item.risk) {
                                        com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.LOW -> 1
                                        com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.MIDDLE -> 2
                                        com.veepoo.protocol.model.enums.EBloodGlucoseRiskLevel.HIGH -> 3
                                        else -> null
                                    }
                                } catch (_: Throwable) { null }
                                if (lv != null) emit("onRealtime", JSONObject().apply {
                                    put("metric", "glucoseLevel")
                                    put("value", lv)
                                    put("ts", tsMs)
                                    put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect glucose records=${items.size} emitted=$n")
                    }

                    override fun onBloodComponentManualDataChange(list: MutableList<BloodComponentManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val tsMs = item.timeStamp * 1000L
                            if (tsMs <= 0) continue
                            // Kotlin 对该 bean 的大小写混排 getter（gettCHO/gettAG/gethDL/getlDL）
                            // 属性名推断不稳定 —— 与检测通道一致，直接调用 Java getter 方法。
                            val ua = try { item.getUricAcid() } catch (_: Throwable) { 0f }
                            val tc = try { item.gettCHO() } catch (_: Throwable) { 0f }
                            val tg = try { item.gettAG() } catch (_: Throwable) { 0f }
                            val hdl = try { item.gethDL() } catch (_: Throwable) { 0f }
                            val ldl = try { item.getlDL() } catch (_: Throwable) { 0f }
                            // 单位与主动检测通道一致：尿酸 μmol/L、血脂 mmol/L；0 视为无效不写
                            val map: Map<String, Float> = linkedMapOf(
                                "ua" to ua, "cholesterol" to tc, "triglyceride" to tg,
                                "hdl" to hdl, "ldl" to ldl,
                            )
                            for ((k, v) in map) {
                                if (v > 0f && v < 10000f) {
                                    emit("onRealtime", JSONObject().apply {
                                        put("metric", k)
                                        put("value", (v * 100.0).toLong() / 100.0)
                                        put("unit", if (k == "ua") "μmol/L" else "mmol/L")
                                        put("ts", tsMs)
                                        put("historical", true)
                                    })
                                    n++
                                }
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect bloodcomp records=${items.size} emitted=$n")
                    }

                    // ★ v61：压力历史（PressureManualData.getPressure [0-100]）
                    override fun onPressureManualDataChange(list: MutableList<PressureManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val v = item.pressure
                            val tsMs = item.timeStamp * 1000L
                            if (v > 0 && tsMs > 0) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "stress"); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect stress records=${items.size} emitted=$n")
                    }

                    // ★ v61：疲劳度历史（FatigueManualData.getFatigue）
                    override fun onFatigueManualDataChange(list: MutableList<FatigueManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val v = item.fatigue
                            val tsMs = item.timeStamp * 1000L
                            if (v > 0 && tsMs > 0) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "fatigue"); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect fatigue records=${items.size} emitted=$n")
                    }

                    // ★ v61：皮电历史（SkinConductanceManualData：皮肤含水量/交感/皮质醇/情绪/抑郁风险）
                    override fun onSkinConductanceManualDataChange(list: MutableList<SkinConductanceManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val tsMs = item.timeStamp * 1000L
                            if (tsMs <= 0) continue
                            val map = linkedMapOf<String, Number>()
                            if (item.skinMoisture > 0) {
                                map["eda"] = item.skinMoisture
                                map["skin"] = item.skinMoisture
                            }
                            if (item.snsActivation > 0) map["sns"] = item.snsActivation
                            if (item.cortisolValue > 0) map["cortisol"] = item.cortisolValue
                            if (item.emotionLevel != 0) map["emotion"] = item.emotionLevel
                            if (item.depressionRisk in 0..2) map["depressionRisk"] = item.depressionRisk
                            for ((k, v) in map) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", k); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect skinConductance records=${items.size} emitted=$n")
                    }

                    // ★ v86：微体检历史（MiniCheckupManualData：压力 + 皮电子对象），带时间戳的历史快照
                    override fun onMiniCheckupManualDataChange(list: MutableList<com.veepoo.protocol.model.datas.MiniCheckupManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val tsMs = item.timeStamp * 1000L
                            if (tsMs <= 0) continue
                            val p = item.pressure
                            if (p in 1..100) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "stress"); put("value", p.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                }); n++
                            }
                            val se = item.skinElectricity
                            if (se != null) {
                                val map = linkedMapOf<String, Number>()
                                if (se.skinMoistureContent > 0) { map["eda"] = se.skinMoistureContent; map["skin"] = se.skinMoistureContent }
                                if (se.sympatheticActivity > 0) map["sns"] = se.sympatheticActivity
                                if (se.cortisolConcentration > 0) map["cortisol"] = se.cortisolConcentration
                                if (se.emotion != 0) map["emotion"] = se.emotion
                                if (se.depressionRisk in 0..2) map["depressionRisk"] = se.depressionRisk
                                for ((k, v) in map) {
                                    emit("onRealtime", JSONObject().apply {
                                        put("metric", k); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                    }); n++
                                }
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect miniCheckup records=${items.size} emitted=$n")
                    }

                    // ★ v61：MET 历史（MetoManualData.getMeto）
                    override fun onMetoManualDataChange(list: MutableList<MetoManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val v = item.meto
                            val tsMs = item.timeStamp * 1000L
                            if (v > 0 && tsMs > 0) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "met"); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect met records=${items.size} emitted=$n")
                    }

                    // ★ v61：情绪历史（EmotionManualData.getEmotion，[-10,10]）
                    override fun onEmotionManualDataChange(list: MutableList<EmotionManualData>?) {
                        val items = list ?: return
                        var n = 0
                        for (item in items) {
                            val v = item.emotion
                            val tsMs = item.timeStamp * 1000L
                            if (v != 0 && tsMs > 0) {
                                emit("onRealtime", JSONObject().apply {
                                    put("metric", "emotion"); put("value", v.toDouble()); put("unit", ""); put("ts", tsMs); put("historical", true)
                                })
                                n++
                            }
                        }
                        log("[VeepooRing ANDROID] manualDetect emotion records=${items.size} emitted=$n")
                    }

                    override fun onReadProgress(p: Float) {
                        log("[VeepooRing ANDROID] manualDetect read progress=${(p * 100).toInt()}%")
                    }

                    override fun onReadComplete() {
                        Handler(Looper.getMainLooper()).removeCallbacks(watchdog)
                        settle("complete")
                    }

                    override fun onReadFail() {
                        log("[VeepooRing ANDROID] manualDetect read FAIL")
                        Handler(Looper.getMainLooper()).removeCallbacks(watchdog)
                        settle("fail")
                    }
                })
            log("[VeepooRing ANDROID] manualDetect read started from=$startSec (7d, glucose+bloodcomp)")
        } catch (e: Throwable) {
            log("[VeepooRing ANDROID] manualDetect read FAILED: ${e.javaClass.simpleName}: ${e.message}")
            Handler(Looper.getMainLooper()).removeCallbacks(watchdog)
            settle("exception")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 电量 / 查找设备 / 相机
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun readBattery() {
        if (batteryListener == null) {
            batteryListener = object : IBatteryDataListener {
                override fun onDataChange(data: BatteryData?) {
                    data ?: return
                    // ★ 2026-11-09（用户：电量必须传对）：本固件下 SDK 把 batteryLevel 解析为 0，
                    //   真实百分比疑似在 batteryPercent（read_battery 响应 index 4 = 0x25=37）。
                    //   先把所有电量相关字段打到日志，便于真机核对，再优先取非 0 值下发。
                    val level = data.batteryLevel
                    val percent = data.batteryPercent
                    val state = data.state
                    val low = data.isLowBattery
                    log("[VeepooRing ANDROID] BatteryData -> level=$level percent=$percent state=$state lowBattery=$low")
                    val out = when {
                        percent > 0 -> percent
                        level > 0 -> level
                        else -> 0
                    }
                    emit("onRealtime", JSONObject().apply {
                        put("metric", "battery")
                        put("value", out)
                        put("unit", "%")
                        put("ts", System.currentTimeMillis())
                    })
                }
            }
        }
        // SDK 方法名是 readBattery（不是 readBatteryData）
        manager.readBattery(IBleWriteResponse { _ -> }, batteryListener)
    }

    @ReactMethod
    fun findDevice() {
        // TODO(veepoo): 核对查找设备方法名（findDevice / findPhone / startFindDevice）。
        log("[VeepooRing ANDROID] findDevice requested")
    }

    @ReactMethod
    fun enterCameraMode() {
        log("[VeepooRing ANDROID] enterCameraMode")
    }

    @ReactMethod
    fun exitCameraMode() {
        log("[VeepooRing ANDROID] exitCameraMode")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 离线回填
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun backfill() {
        backfillSince("")
    }

    /**
     * ★ 2026-11-11（用户：回填应断点续传，不每次重拉整段历史）：
     * 指定起始日期，只拉 [dateStr, 今天] 这段增量；dateStr='' 表示全量。
     * JS 侧用 lastBackfillDate 游标驱动，已在库的过去日期当快照不再重读。
     */
    @ReactMethod
    fun backfillFrom(dateStr: String) {
        backfillSince(dateStr)
    }

    /**
     * ★ 2026-11-09：真正实现离线回填。
     *
     * 早期 Android 构建曾 emit 历史，bridge 重写时被 stub 化（只发假进度、不调 SDK、不发 onBatch），
     * 导致每次重连后今天及之后的睡/HR/步数全空——这正是「之前版本都有数据、现在全空」的回归根因。
     *
     * 现按 Veepoo SDK 文档调用 readAllHealthDataBySettingOrigin，一次读取睡眠 + 5 分钟原始数据，
     * 按日期聚合为 JS handleBatch 期望的 {date, slots:[{ts, hr, step, cal, dist, temp, bpSys, bpDia}], daily:{...}}，
     * 逐日 emit onBatch，结束 emit backfillDone。
     *
     * 注意：基础版固件的 OriginData 只含 HR/步数/卡路里/距离/体温/血压，不含 SpO2/HRV 历史
     *（SpO2 走实时通道、HRV 历史此固件未下发），故历史回填不补 SpO2/HRV——这属于固件能力，非 bug。
     */
    @ReactMethod
    fun backfillSince(fromDateStr: String) {
        if (!ready.get()) {
            // ★ 2026-11-15（上线测试 P0-1）：掉线时绝不 emit backfillDone。
            //   旧实现直通 backfillDone → JS finishSyncAll 推进游标 + 800ms 补跑 →
            //   掉线态再直通 → 无限空转（真机 27 次扫描 / 12 次 watchdog 的起点）。
            //   改用独立状态：JS 只解锁、不推进游标、不补跑、不做缺口自愈。
            log("[VeepooRing ANDROID] backfill skipped: 设备未就绪（未 connected/ready）")
            emit("onState", JSONObject().apply {
                put("status", "backfillSkipped")
                put("reason", "not_ready")
            })
            return
        }
        if (backfillInProgress.getAndSet(true)) {
            // ★ 2026-11-15：重复请求绝不能再发一次全量 BLE 读（会打断在途 origin3），
            //   只记一个挂起标记，由事务唯一收口 finishBackfillTransaction 决定是否补跑。
            log("[VeepooRing ANDROID] backfill 已在进行，合并为事务内挂起请求（不重发 BLE 读）")
            pendingBackfillDuringTransaction.set(true)
            touchBackfillProgress()  // v78：重复请求本身也是链路存活的证据，续命看门狗
            return
        }

        armBackfillWatchdog()  // v78：事务启动即挂「无进展硬超时」看门狗
        emit("onState", JSONObject().apply {
            put("status", "syncing")
            put("progress", 0)
        })

        // 计算要读取的窗口天数：有锚点则取 [锚点, 今天] 跨度，否则全量（设备容量）。
        val todayKey = todayDateKey()
        var n = deviceWatchday
        if (fromDateStr.isNotBlank()) {
            val days = daysBetween(fromDateStr, todayKey)
            if (days >= 0) n = (days + 1).coerceIn(1, deviceWatchday)
        }
        log("[VeepooRing ANDROID] backfillSince from=$fromDateStr window=$n days (deviceWatchday=$deviceWatchday)")

        val sleepByDate = mutableMapOf<String, SleepData>()
        val originByDate = mutableMapOf<String, MutableList<OriginData>>()
        // ★ 2026-11-09：本固件的 5 分钟 OriginData.rateValue 恒 0，心率走的是
        //   onOringinHalfHourDataChange → HalfHourRateData.rateValue。旧实现直接忽略，
        //   导致 11-08 15:00 之后 HR/HRV 全部断流。这里按天收集并合并进 slots。
        val halfHourByDate = mutableMapOf<String, MutableList<HalfHourRateData>>()

        val listener = object : IAllHealthDataListener {
            override fun onProgress(p: Float) {
                touchBackfillProgress()  // v78：有进度推进→续命
                val pct = (p * 100).toInt().coerceIn(0, 100)
                emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", pct) })
            }

            override fun onSleepDataChange(day: String?, sleepData: SleepData?) {
                sleepData ?: return
                touchBackfillProgress()  // v78：收到数据批次→续命
                // ★ 2026-11-16（用户反馈）：戒指带历史睡眠数据、昨天寄出、今早新用户首次连上，
                //   App 立刻显示「今天」有一整晚睡眠。真因：Veepoo SDK 读「第 0 天 / 今天」时，
                //   若今天没有记录会回传设备里**最后一晚**并把 SleepData.date 标成请求日（今天），
                //   旧实现完全信任这个 date → 历史睡眠被写进今天。
                //   TimeData 自带 year/month/day，起床日才是这一觉真正的归档日，优先用它做真值。
                val up = sleepData.sleepUp
                val wakeKey = up?.let { t ->
                    val y = t.getYear(); val mo = t.getMonth(); val dd = t.getDay()
                    if (y in 2020..2030 && mo in 1..12 && dd in 1..31)
                        "%04d-%02d-%02d".format(y, mo, dd) else null
                }
                val sdkKey = normDateKey(sleepData.date)
                val key = wakeKey ?: sdkKey ?: normDateKey(day) ?: return
                if (wakeKey != null && sdkKey != null && wakeKey != sdkKey) {
                    log("[VeepooRing ANDROID] ⛔ sleep 日期错配: SDK date=$sdkKey 起床日=$wakeKey → 按起床日归档")
                }
                // ★ 2026-11-20(v64)：同一天可能回传多条记录（整夜睡眠 + 多段午睡）。
                //   旧实现 last-wins → 午睡（56min）把整夜主睡眠（615min）盖掉，
                //   健康档案里 11-19 的 sleep 变成 56 分钟。改为保留时长最长的一条做主睡眠。
                val existing = sleepByDate[key]
                if (existing == null || sleepData.allSleepTime > existing.allSleepTime) {
                    sleepByDate[key] = sleepData
                }
                // v64 诊断直写（不经 JS 节流）：验证 SDK 睡眠回调与归档键
                android.util.Log.e("DIAGGATE", "SLEEP-CB d=$key sdk=$sdkKey wake=$wakeKey total=${sleepData.allSleepTime} down=${sleepData.sleepDown?.getHour()}:${sleepData.sleepDown?.getMinute()} up=${sleepData.sleepUp?.getHour()}:${sleepData.sleepUp?.getMinute()}")
            }

            override fun onReadSleepComplete() {
                // 睡眠读完后才会进入原始数据段，无需动作。
            }

            override fun onOringinFiveMinuteDataChange(originData: OriginData?) {
                originData ?: return
                touchBackfillProgress()  // v78
                val key = normDateKey(originData.date) ?: return
                val list = originByDate.getOrPut(key) { mutableListOf() }
                list.add(originData)
            }

            override fun onOringinHalfHourDataChange(d: OriginHalfHourData?) {
                d ?: return
                touchBackfillProgress()  // v78
                val rates = d.halfHourRateDatas ?: return
                val key = normDateKey(d.date) ?: normDateKey(rates.firstOrNull()?.date) ?: return
                val list = halfHourByDate.getOrPut(key) { mutableListOf() }
                for (r in rates) if (r != null) list.add(r)
            }

            override fun onReadOriginComplete() {
                touchBackfillProgress()  // v78：主段读完进入 origin3，续命
                // 全部读完：按日期聚合并发出 onBatch。

                // ★ 2026-11-20(v64) 睡眠日期语义修正（用户实证确认）：
                //   本固件的睡眠记录日期 = 「这一觉所属的夜晚」（入睡当晚的日历日），
                //   不是起床日。实证：0:31→10:46（11-20 清晨醒）的整夜睡眠被标成 11-19，
                //   用户确认那就是昨晚的觉。而 App 全链路的归档口径是「起床日」
                //   （SleepDetailScreen 铁律：昨晚入睡→今早起床落在 today key）。
                //   → 把「标签 D + 清晨醒来」的整夜睡眠移到 D+1。
                //   三道门槛防误挪（尤其防 11-16 工厂历史睡眠重新混进今天）：
                //     ① 时长 ≥180min（真整夜睡眠；短打盹/久坐误判不动）
                //     ② 起床时刻在清晨窗口 [5:00, 12:00)（下午的午睡不挪）
                //     ③ D+1 的 5 分钟原始数据在 入睡→起床 时间窗内 ≥3 个点
                //        （证明那晚真的戴着；工厂测试的历史睡眠在 D+1 没有夜间数据，不会挪）
                run {
                    val todayKey = todayDateKey()
                    val cal = Calendar.getInstance()
                    val moved = mutableListOf<String>()
                    for ((dKey, sd) in sleepByDate.toList()) {
                        if (sd.allSleepTime < 180) continue
                        val up = sd.sleepUp ?: continue
                        val upMin = up.getHour() * 60 + up.getMinute()
                        if (upMin < 5 * 60 || upMin >= 12 * 60) continue
                        val (y, mo, dd) = parseYmd(dKey) ?: continue
                        cal.apply { set(y, mo - 1, dd, 12, 0, 0) ; add(Calendar.DAY_OF_YEAR, 1) }
                        val nextKey = "%04d-%02d-%02d".format(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
                        if (nextKey > todayKey) continue   // 不往今天之后挪
                        // 夜间原始数据验证：固件可能把整夜采样都打上「夜晚归属日 D」的标签，
                        //   也可能落在起床日 D+1 → 两天的 [入睡−30min, 起床+30min] 窗口点取并集。
                        val down = sd.sleepDown
                        val winStart = (down?.getHour() ?: 0) * 60 + (down?.getMinute() ?: 0) - 30
                        fun inWindowPts(key: String): Int = originByDate[key].orEmpty().count { o ->
                            val t = o.getmTime() ?: return@count false
                            val m = t.getHour() * 60 + t.getMinute()
                            m >= winStart && m <= upMin + 30
                        }
                        val inWin = inWindowPts(dKey) + inWindowPts(nextKey)
                        if (inWin < 3) {
                            android.util.Log.e("DIAGGATE", "SLEEP-SHIFT SKIP $dKey (win pts D=${inWindowPts(dKey)} D+1=${inWindowPts(nextKey)}, originDates=${originByDate.keys.joinToString(",")})")
                            continue
                        }
                        // 执行挪移：起床日语义 → D+1；若 D+1 已有记录，保留更长的那条
                        sleepByDate.remove(dKey)
                        val ex = sleepByDate[nextKey]
                        if (ex == null || sd.allSleepTime > ex.allSleepTime) sleepByDate[nextKey] = sd
                        // 起床时刻 TimeData 的年月日与固件标签同步修正（buildDaily 下发 sleepUpDate 用）
                        up.year = cal.get(Calendar.YEAR); up.month = cal.get(Calendar.MONTH) + 1; up.day = cal.get(Calendar.DAY_OF_MONTH)
                        moved.add("$dKey→$nextKey(total=${sd.allSleepTime},originPts=$inWin)")
                        android.util.Log.e("DIAGGATE", "SLEEP-SHIFT $dKey -> $nextKey total=${sd.allSleepTime} originPts=$inWin")
                    }
                    if (moved.isNotEmpty()) log("[VeepooRing ANDROID] 睡眠按起床日重归档: ${moved.joinToString()}")
                }

                val dates = (sleepByDate.keys + originByDate.keys + halfHourByDate.keys).toSortedSet()
                var emitted = 0
                var halfHourPts = 0
                for (date in dates) {
                    val slots = buildSlots(originByDate[date], date).toMutableList()
                    // 半小时聚合心率 → 补进同一天的 slots（JS parseSampleTs 需要 "HH:mm"）
                    for (r in halfHourByDate[date].orEmpty()) {
                        val hr = r.rateValue
                        if (hr !in 30..200) continue
                        val t = r.time
                        val hhmm = if (t != null) "%02d:%02d".format(t.getHour(), t.getMinute())
                                   else "00:00"
                        val ts = dateMidnightMs(date) +
                            (t?.getHour() ?: 0) * 3600_000L + (t?.getMinute() ?: 0) * 60_000L
                        slots.add(JSONObject().apply {
                            put("ts", ts)
                            put("time", hhmm)
                            put("hr", hr)
                        })
                        halfHourPts++
                    }
                    val daily = buildDaily(sleepByDate[date], date)
                    // ★ 2026-11-20(v73) 诊断：sleepByDate 实际收到了哪些日期、buildDaily 结果
                    android.util.Log.e("DIAGGATE", "EMIT d=$date sleepByDateKeys=${sleepByDate.keys.joinToString(",")} hasSleep=${sleepByDate.containsKey(date)} dailySleep=${daily.optInt("sleepTotalMin", -1)}")
                    val obj = JSONObject().apply {
                        put("date", date)
                        put("slots", JSONArray(slots))
                        put("daily", daily)
                    }
                    emit("onBatch", obj)
                    emitted++
                }
                log("[VeepooRing ANDROID] backfill emit days=$emitted (sleepDates=${sleepByDate.size}, originDates=${originByDate.size}, halfHourHr=$halfHourPts)")
                emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 100) })
                // ★ 2026-11-11：不在这里 emit backfillDone / 解锁。
                //   HRV/夜间血氧只能从 readOriginDataBySetting + IOriginData3Listener 拿到，
                //   它必须在同一事务里串行跑完，否则 JS 的排队补跑会把 BLE 通道抢走。
                startOrigin3ThenFinish(n)
            }

            override fun onReadTimeout(code: Int) {
                touchBackfillProgress()  // v78：收到 SDK 超时回调也算进展，续命
                log("[VeepooRing ANDROID] backfill read timeout code=$code")
                emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 100) })
                // ★ 2026-11-11：超时同样要补 origin3，否则整条 HRV/血氧历史回读永远不会跑。
                startOrigin3ThenFinish(n)
            }
        }

        try {
            // day=0 表示从今天起、position=1 从第 1 条开始、watchday=n 读取 n 天。
            android.util.Log.e("DIAGGATE", "BACKFILL-START days=$n")
            manager.readAllHealthDataBySettingOrigin(listener, 0, 1, n)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] backfill read FAILED: ${e.message}")
            emit("onState", JSONObject().apply { put("status", "error"); put("reason", "backfill_failed"); put("error", "backfill_failed") })
            finishBackfillTransaction()
        }
    }

    /**
     * ★ 2026-11-11：主同步收尾后，串行启动 HRV/夜间血氧历史回读。
     * 关键：**此时绝不 emit backfillDone**。JS 只有收到 backfillDone 才会解锁并派发
     * 「排队补跑」的第二次全量同步，那会立刻抢占 BLE 写通道，让 origin3 读成空包。
     */
    private fun startOrigin3ThenFinish(days: Int) {
        if (!origin3InProgress.compareAndSet(false, true)) {
            // ★ 2026-11-15（上线测试 P0-1）：旧实现直接 return，会让整轮事务永不 emit
            //   backfillDone（JS 等到 300s 超时后 disconnect）。重复启动一律收口，不再挂死。
            log("[VeepooRing ANDROID] origin3 已在本次事务内，重复启动改为直接收口事务")
            finishBackfillTransaction()
            return
        }
        // 只等 300ms 让 SDK 写队列释放尾包；不再等 1.5s，缩短整轮同步耗时。
        Handler(Looper.getMainLooper()).postDelayed({
            readOrigin3History(days, this::finishBackfillTransaction)
        }, 300L)
    }

    /** 一次同步事务的唯一收口：emit backfillDone + 释放两个在途锁。幂等，可安全重复调用。 */
    private fun finishBackfillTransaction() {
        if (!backfillInProgress.getAndSet(false)) return
        clearBackfillWatchdog()  // v78：事务收口，熄灭无进展看门狗
        origin3InProgress.set(false)
        // ★ 2026-11-15：事务期间的重复请求统一合并丢弃，绝不在 origin3 读取窗口内
        //   或收口瞬间再发一次全量 BLE 读命令。
        if (pendingBackfillDuringTransaction.getAndSet(false)) {
            log("[VeepooRing ANDROID] pending backfill merged into this transaction (no extra BLE read)")
        }
        emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 100) })
        emit("onState", JSONObject().apply { put("status", "backfillDone") })
        log("[VeepooRing ANDROID] backfill transaction done (origin3 settled)")
        // 事务收口、BLE 读通道释放后，才错峰回放被暂缓的写命令。
        flushDeferredWrites()
        // ★ 2026-11-18（用户：Pro 没看到血糖/血液成分）：回填收口后错峰 8s 回读
        //   戒指上的血糖/血液成分测量记录（血糖是固件每 30 分钟自动测的，之前从没读过）。
        manualDetectAttempts = 0
        Handler(Looper.getMainLooper()).postDelayed({
            try { readManualDetectHistory() } catch (e: Throwable) {
                log("[VeepooRing ANDROID] manualDetect hook failed: ${e.message}")
            }
        }, 2_500L)
        // ★ 2026-11-23（用户：夜间身心压力/EDA 没数据）：每小时后台唤醒的回填收口后，
        //   补跑一轮 miniCheckup/GSR 点测，覆盖 App 被冻结期间缺失的快照采样。
        //   只消费 nightlySnapPending（仅每小时分支置位），普通同步不触发。
        //   延迟 130s：跳过 connect 时启动的 120s PPG 让出窗口，避免被 SKIP 白等一轮。
        if (nightlySnapPending) {
            nightlySnapPending = false
            android.util.Log.e("NIGHTSNAP", "hourly backfill settled -> schedule nightly snap in 130s")
            Handler(Looper.getMainLooper()).postDelayed({
                if (!ready.get()) {
                    android.util.Log.e("NIGHTSNAP", "skip: ring not ready at fire time")
                    return@postDelayed
                }
                android.util.Log.e("NIGHTSNAP", "fire -> force 2 tick rounds (mini + GSR)")
                nightlySnapPending = true
                tickSnapshotRotation()
                // 第二路错开 75s（第一路 mini 看门狗 60s + 通道归还），保证 GSR 不被 inProg 挡掉
                Handler(Looper.getMainLooper()).postDelayed({
                    nightlySnapPending = true
                    tickSnapshotRotation()
                }, 75_000L)
            }, 130_000L)
        }
    }

    /**
     * ★ 2026-11-09（用户：夜间戴着戒指，HR/HRV 却全空）：
     * readAllHealthDataBySettingOrigin 的 OriginData 在本固件里不带 HR/HRV，
     * 但 SDK 另有 readHRVOrigin 一路，HRVOriginData 带 hrvValue / rate / rrValue，
     * 正是夜间睡眠分期、心率变异性、身体节律需要的逐点数据。
     *
     * 独立执行 + 12s 超时兜底：即使固件不响应也不会卡住 backfill 状态机。
     * 按日期聚合后再 emit 一次 onBatch（只带 hr/hrv 的 slots），由 JS 侧并入 healthStore。
     */
    private fun readHrvHistory(days: Int) {
        if (!ready.get()) return
        try {
            val byDate = mutableMapOf<String, MutableList<HRVOriginData>>()
            val finished = AtomicBoolean(false)
            val finish: () -> Unit = {
                if (finished.compareAndSet(false, true)) {
                    var emittedDays = 0
                    var emittedPts = 0
                    for ((date, list) in byDate.toSortedMap()) {
                        val slots = JSONArray()
                        var idx = 0
                        for (d in list) {
                            val t = d.getmTime()
                            val ts = if (t != null) {
                                val (y, m, dd) = parseYmd(date)
                                Calendar.getInstance().apply {
                                    set(y, m - 1, dd, t.getHour(), t.getMinute(), t.getSecond())
                                    set(Calendar.MILLISECOND, 0)
                                }.timeInMillis
                            } else {
                                dateMidnightMs(date) + idx * 5 * 60 * 1000L
                            }
                            // JS 侧 parseSampleTs 只接受 "HH:mm" 字符串（纯毫秒 ts 会被丢弃），
                            // 因此每条 slot 必须带 time，否则整批 HRV 点会被静默丢掉。
                            val hhmm = if (t != null) {
                                "%02d:%02d".format(t.getHour(), t.getMinute())
                            } else {
                                "%02d:%02d".format((idx / 12) % 24, (idx % 12) * 5)
                            }
                            val slot = JSONObject().apply {
                                put("ts", ts)
                                put("time", hhmm)
                            }
                            // rate 可能是 "76" 或 "76,77,78" 这类串，取首个有效心率
                            val hr = d.rate?.split(",")?.firstOrNull()?.trim()?.toIntOrNull() ?: 0
                            val hrv = d.hrvValue
                            val hasHr = hr in 30..200
                            val hasHrv = hrv > 0
                            if (hasHr) slot.put("hr", hr)
                            if (hasHrv) slot.put("hrv", hrv)
                            if (hasHr || hasHrv) { slots.put(slot); emittedPts++ }
                            idx++
                        }
                        if (slots.length() > 0) {
                            emit("onBatch", JSONObject().apply {
                                put("date", date)
                                put("slots", slots)
                                put("daily", JSONObject())
                            })
                            emittedDays++
                        }
                    }
                    log("[VeepooRing ANDROID] hrvHistory emit days=$emittedDays points=$emittedPts")
                }
            }
            val listener = object : IHRVOriginDataListener {
                override fun onReadOriginProgress(p: Float) {}
                override fun onReadOriginProgressDetail(a: Int, b: String?, c: Int, d: Int) {}
                override fun onHRVOriginListener(d: HRVOriginData?) {
                    d ?: return
                    val key = normDateKey(d.date) ?: return
                    byDate.getOrPut(key) { mutableListOf() }.add(d)
                }
                override fun onDayHrvScore(a: Int, b: String?, c: Int) {}
                override fun onReadOriginComplete() { finish() }
            }
            manager.readHRVOrigin(IBleWriteResponse { _ -> }, listener, days)
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 12_000L)
            log("[VeepooRing ANDROID] hrvHistory requested days=$days")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] hrvHistory FAILED: ${e.message}")
        }
    }

    /**
     * ★ 2026-11-09（最后一环：HRV / 心率变异性 / 压力恢复节律全空）：
     * SDK 字节码实证：readHRVOrigin(int) 只是 readHRVOriginBySetting 的空壳包装，
     * 而当前固件的原始协议版本是 v3/v5 —— readOriginDataBySetting 在该版本下
     * 要求 IOriginData3Listener，并同时回调：
     *   onOriginHRVOriginListDataChange(HRV 列表)、onOriginSpo2OriginListDataChange(血氧原始列表)、
     *   onOriginFiveMinuteListDataChange(OriginData3)、onOriginHalfHourDataChange。
     * 旧实现只走 IAllHealthDataListener（v1 老协议），HRV 整条链路从未被读取。
     * 独立执行 + 15s 超时兜底，失败不影响主同步。
     */
    private fun readOrigin3History(days: Int, onDone: () -> Unit) {
        if (!ready.get()) {
            // ★ 2026-11-15：异常收口也要留痕，别再静默 produce 一个「零数据成功事务」。
            log("[VeepooRing ANDROID] origin3 skipped: 设备未就绪（异常收口事务）")
            onDone()
            return
        }
        try {
            val slotsByDate = mutableMapOf<String, MutableList<JSONObject>>()
            var hrHits = 0
            var hrvHits = 0
            var spo2Hits = 0
            var bpHits = 0
            var stressHits = 0   // ★ v84：OriginData3.pressure 每5分钟压力历史命中数
            val finished = AtomicBoolean(false)

            /**
             * ★ 2026-11-11：时间戳补到「秒」，并允许调用方覆盖分钟。
             * 旧实现只写到分钟（"HH:mm"），而 JS healthStore 的 MERGE_MS=60s 会把
             * 同一分钟内的多个样本连锁合并成 1 个 —— 真机实证 155 个夜间血氧样本
             * 只落了 7 个整点，用户看到的「夜间血氧还是会丢数据」就是这里。
             */
            fun add(dateRaw: String?, t: TimeData?, minuteOverride: Int? = null, fill: (JSONObject) -> Unit) {
                val key = normDateKey(dateRaw) ?: return
                val hh = t?.getHour() ?: 0
                val mm = minuteOverride ?: (t?.getMinute() ?: 0)
                val ss = t?.getSecond() ?: 0
                val slot = JSONObject().apply {
                    put("ts", dateMidnightMs(key) + hh * 3600_000L + mm * 60_000L + ss * 1000L)
                    put("time", "%02d:%02d:%02d".format(hh, mm, ss))  // parseSampleTs 支持 HH:mm:ss
                }
                fill(slot)
                if (slot.length() > 2) slotsByDate.getOrPut(key) { mutableListOf() }.add(slot)
            }

            /** 同一时刻由不同回调（HRV 列表 / 血氧列表 / 5 分钟包）产生的 slot 合并字段，而不是互相覆盖。 */
            fun mergeSlotsByTs(list: MutableList<JSONObject>): List<JSONObject> {
                val map = LinkedHashMap<Long, JSONObject>()
                for (s in list) {
                    val ts = s.optLong("ts", 0L)
                    val dst = map[ts]
                    if (dst == null) {
                        map[ts] = s
                    } else {
                        val it = s.keys()
                        while (it.hasNext()) {
                            val k = it.next()
                            if (k == "ts" || k == "time") continue
                            if (!dst.has(k)) dst.put(k, s.get(k))
                        }
                    }
                }
                return map.values.sortedBy { it.optLong("ts", 0L) }
            }

            /**
             * ★ 2026-11-15（上线测试 P0-1）：origin3 批次原来 hardcode `daily = {}`，
             *   JS 只能靠 dailyMeanFromSlots 反算，一旦 slots 未到就是「今日 daily 0/8」。
             *   这里按已解析 slots 直接产出 6 个核心指标的当日均值，供 JS handleBatch
             *   的 SINGLE_MAP 直接落 *Daily（不编造数值，全来自 SDK 回读样本）。
             */
            fun dailyFromSlots(list: List<JSONObject>): JSONObject {
                val d = JSONObject()
                for (k in listOf("hr", "hrv", "spo2", "temp", "bpSys", "bpDia", "stress")) {
                    var sum = 0.0
                    var n = 0
                    for (s in list) {
                        val v = s.optDouble(k, Double.NaN)
                        if (!v.isNaN() && v > 0.0) { sum += v; n++ }
                    }
                    if (n > 0) d.put(k, Math.round(sum / n * 100.0) / 100.0)
                }
                return d
            }

            /** 只由 SDK 的 onReadOriginComplete / onReadTimeout 触发：正常 emit 全部批次再收口。 */
            val finish: () -> Unit = {
                if (finished.compareAndSet(false, true)) {
                    var emittedDays = 0
                    var emittedPts = 0
                    for ((date, list) in slotsByDate.toSortedMap()) {
                        if (list.isEmpty()) continue
                        val merged = mergeSlotsByTs(list)
                        emit("onBatch", JSONObject().apply {
                            put("date", date)
                            put("slots", JSONArray(merged))
                            put("daily", dailyFromSlots(merged))
                        })
                        emittedDays++
                        emittedPts += merged.size
                    }
                    log("[VeepooRing ANDROID] origin3 emit days=$emittedDays points=$emittedPts hr=$hrHits hrv=$hrvHits spo2=$spo2Hits bp=$bpHits stress=$stressHits")
                    // ★ 历史回读收尾了，才允许整轮同步事务 emit backfillDone。
                    onDone()
                }
            }

            /**
             * ★ 2026-11-15（上线测试 P0-1）：45s 守护定时器**不再抢占 finished**。
             *   旧实现里超时先跑 finish() → 打出 `days=0 points=0` 空批次并收口事务，
             *   随后 SDK 真正带回的 192 条数据被 finished 挡住，永久丢弃（真机实证）。
             *   现在超时只收口事务（避免死锁），不写 finished、不发空批次、不伪造统计行；
             *   晚到的数据仍可走 finish() emit onBatch 并落库。
             */
            val settleOnTimeout: () -> Unit = {
                if (!finished.get()) {
                    log("[VeepooRing ANDROID] origin3 settle by timeout (no empty batch; late SDK data still accepted)")
                    onDone()
                }
            }

            val listener = object : IOriginData3Listener {
                override fun onReadOriginProgress(p: Float) {}
                override fun onReadOriginProgressDetail(a: Int, b: String?, c: Int, d: Int) {}
                override fun onOriginFiveMinuteListDataChange(list: List<OriginData3>?) {
                    if (list.orEmpty().isNotEmpty()) touchBackfillProgress()  // v78
                    for (o in list.orEmpty()) {
                        add(o.date, o.getmTime()) { s ->
                            val hr = o.rateValue
                            if (hr in 30..200) { s.put("hr", hr); hrHits++ }
                            val step = o.stepValue
                            if (step > 0) s.put("step", step)
                            // ★ 2026-11-14（用户：血压长期不更新）：SDK 文档明确「五分钟原始数据中血压数据」
                            //   位于 OriginData.highValue / lowValue（OriginData3 继承它）。旧实现只读 hr/step，
                            //   把设备已经回传的血压整包丢掉了 —— 这才是 bpSys=0/bpDia=0 的直接原因之一。
                            //   仅做生理范围过滤（高压 60-300 / 低压 20-200），不编造任何数值。
                            val high = o.highValue
                            val low = o.lowValue
                            if (high in 60..300 && low in 20..200) {
                                s.put("bpSys", high); s.put("bpDia", low); bpHits++
                            }
                            // ★ 2026-11-23(v84) 夜间压力缺失真根因：
                            //   三端官方 SDK 证实压力是戒指「每5分钟自动记录、按天存储」的历史数据，
                            //   就藏在 OriginData3.pressure(int, [0,100]) 里（安卓 SDK 文档漏写该字段，
                            //   但 vpprotocol classes.jar 字节码明确有 pressure:I + getPressure():I；
                            //   iOS VPDataBaseOperation.h 原始数据 stress=1；小程序 veepooSendReadDailyDataManager
                            //   回调 pressure:[21]）。旧实现只解析 hr/step/bp，把这个字段整包丢弃，
                            //   导致夜间段（App 被冻结无法点测）压力永久为空。这里按真实回读值补齐。
                            //   不编造：仅当压力在 [1,100] 才写入；0 表示设备未测，跳过。
                            val stress = o.getPressure()
                            if (stress in 1..100) { s.put("stress", stress); stressHits++ }
                        }
                    }
                }
                override fun onOriginHalfHourDataChange(d: OriginHalfHourData?) {
                    if (d == null) return
                    touchBackfillProgress()  // v78
                    for (r in d.halfHourRateDatas.orEmpty()) {
                        if (r == null) continue
                        val hr = r.rateValue
                        if (hr !in 30..200) continue
                        add(d.date ?: r.date, r.time) { s -> s.put("hr", hr); hrHits++ }
                    }
                    // ★ 30 分钟汇总包里的 halfHourBps 同样带血压，一并解析（与五分钟包按 ts 合并去重）。
                    for (b in d.halfHourBps.orEmpty()) {
                        if (b == null) continue
                        val high = b.highValue
                        val low = b.lowValue
                        if (high !in 60..300 || low !in 20..200) continue
                        add(b.date ?: d.date, b.time) { s ->
                            s.put("bpSys", high); s.put("bpDia", low); bpHits++
                        }
                    }
                }
                override fun onOriginHRVOriginListDataChange(list: List<HRVOriginData>?) {
                    if (list.orEmpty().isNotEmpty()) touchBackfillProgress()  // v78
                    for (d in list.orEmpty()) {
                        add(d.date, d.getmTime()) { s ->
                            val hrv = d.hrvValue
                            if (hrv > 0) { s.put("hrv", hrv); hrvHits++ }
                            val hr = d.rate?.split(",")?.firstOrNull()?.trim()?.toIntOrNull() ?: 0
                            if (hr in 30..200) { s.put("hr", hr); hrHits++ }
                        }
                    }
                }
                override fun onOriginSpo2OriginListDataChange(list: List<Spo2hOriginData>?) {
                    if (list.orEmpty().isNotEmpty()) touchBackfillProgress()  // v78
                    // ★ 2026-11-11（用户：夜间血氧还是会丢数据）：
                    // 本固件 Spo2hOriginData.getmTime() 只有「小时」有效，minute/second 恒 0，
                    // 整夜样本全撞在 HH:00:00；JS healthStore MERGE_MS=60s 会把同小时 N 条
                    // 连锁合并成 1 条（真机实证：155 条血氧样本只落了 7 个整点）。
                    // SDK 没给精确分钟时，按列表顺序在该小时内均匀回放：不跨小时、不改数值，
                    // 只是把「同一小时内的先后」还原成可分辨的时间轴（与 evenSpreadDay 同语义）。
                    val byHour = list.orEmpty().groupBy { d ->
                        (normDateKey(d.date) ?: "") + "|" + (d.getmTime()?.getHour() ?: 0)
                    }
                    for ((_, items) in byHour) {
                        val n = items.size
                        items.forEachIndexed { idx, d ->
                            val mm = if (n > 1) (idx * 60 / n).coerceIn(0, 59) else null
                            add(d.date, d.getmTime(), mm) { s ->
                                val hr = d.heartValue
                                val hrv = d.gethRVariation()
                                val spo2 = d.oxygenValue
                                val rr = d.respirationRate
                                if (hr in 30..200) { s.put("hr", hr); hrHits++ }
                                if (hrv > 0) { s.put("hrv", hrv); hrvHits++ }
                                if (spo2 in 70..100) { s.put("spo2", spo2); spo2Hits++ }
                                if (rr in 5..40) s.put("rr", rr)
                            }
                        }
                    }
                }
                override fun onReadOriginComplete() { finish() }
                override fun onReadTimeout(code: Int) { finish() }
            }
            manager.readOriginDataBySetting(
                IBleWriteResponse { _ -> }, listener, ReadOriginSetting(0, 1, false, days)
            )
            // ★ 2026-11-11：增量回填每次只拉 [游标, 今天] 这几天，但仍保留充裕超时，
            // 避免多天 HRV/血氧历史回读被 15s 硬截断导致「很多数据没回填回来」。
            Handler(Looper.getMainLooper()).postDelayed({ settleOnTimeout() }, 45_000L)
            log("[VeepooRing ANDROID] origin3 requested days=$days")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] origin3 FAILED: ${e.message}")
            // 异常也必须收口，否则整轮同步事务永远不 emit backfillDone，后续同步全部卡死。
            onDone()
        }
    }

    /**
     * ★ 2026-11-09（用户：戴着戒指，心率/HRV/压力节律全空）：
     * 戒指整夜跑的是 spo2h 自动检测流，其原始包 Spo2hOriginData 同时带
     * heartValue(心率) / hRVariation(HRV) / oxygenValue / respirationRate，
     * 但旧实现只读 5 分钟 OriginData.rateValue（本固件恒 0），这一路从没读过。
     * 独立执行 + 12s 超时兜底，失败不影响主同步；按天 emit 一次只带 slots 的 onBatch。
     */
    private fun readSpo2hOriginHistory(days: Int) {
        if (!ready.get()) return
        try {
            val byDate = mutableMapOf<String, MutableList<Spo2hOriginData>>()
            val finished = AtomicBoolean(false)
            val finish: () -> Unit = {
                if (finished.compareAndSet(false, true)) {
                    var emittedDays = 0
                    var emittedPts = 0
                    var hrPts = 0
                    var hrvPts = 0
                    for ((date, list) in byDate.toSortedMap()) {
                        val slots = JSONArray()
                        var idx = 0
                        for (d in list) {
                            val t = d.getmTime()
                            val hh = t?.getHour() ?: (idx / 12) % 24
                            val mm = t?.getMinute() ?: (idx % 12) * 5
                            val hhmm = "%02d:%02d".format(hh, mm)
                            val ts = dateMidnightMs(date) + hh * 3600_000L + mm * 60_000L
                            val slot = JSONObject().apply {
                                put("ts", ts)
                                put("time", hhmm)   // JS parseSampleTs 只认 "HH:mm"
                            }
                            val hr = d.heartValue
                            val hrv = d.gethRVariation()
                            val spo2 = d.oxygenValue
                            val rr = d.respirationRate
                            val step = d.stepValue
                            if (hr in 30..200) { slot.put("hr", hr); hrPts++ }
                            if (hrv > 0) { slot.put("hrv", hrv); hrvPts++ }
                            if (spo2 in 70..100) slot.put("spo2", spo2)
                            if (rr in 5..40) slot.put("rr", rr)
                            if (step >= 0) slot.put("step", step)
                            if (slot.length() > 2) { slots.put(slot); emittedPts++ }
                            idx++
                        }
                        if (slots.length() > 0) {
                            emit("onBatch", JSONObject().apply {
                                put("date", date)
                                put("slots", slots)
                                put("daily", JSONObject())
                            })
                            emittedDays++
                        }
                    }
                    log("[VeepooRing ANDROID] spo2hOrigin emit days=$emittedDays points=$emittedPts hr=$hrPts hrv=$hrvPts")
                }
            }
            val listener = object : ISpo2hOriginDataListener {
                override fun onReadOriginProgress(p: Float) {}
                override fun onReadOriginProgressDetail(a: Int, b: String?, c: Int, d: Int) {}
                override fun onSpo2hOriginListener(d: Spo2hOriginData?) {
                    d ?: return
                    val key = normDateKey(d.date) ?: return
                    byDate.getOrPut(key) { mutableListOf() }.add(d)
                }
                override fun onReadOriginComplete() { finish() }
            }
            manager.readSpo2hOrigin(IBleWriteResponse { _ -> }, listener, days)
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 12_000L)
            log("[VeepooRing ANDROID] spo2hOrigin requested days=$days")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] spo2hOrigin FAILED: ${e.message}")
        }
    }

    // ── 回填辅助 ──────────────────────────────────────────────────────────────

    /** 把某天的 5 分钟原始点转为 JS slots。只保留佩戴/有量纲的点，丢弃未佩戴的垃圾值。 */
    private fun buildSlots(list: MutableList<OriginData>?, date: String): List<JSONObject> {
        if (list.isNullOrEmpty()) return emptyList()
        val out = mutableListOf<JSONObject>()
        var idx = 0
        for (o in list) {
            val hr = o.rateValue
            val step = o.stepValue
            val cal = o.calValue
            val dist = o.disValue
            val temp = o.temperature
            val high = o.highValue
            val low = o.lowValue
            val worn = o.wear == 1
            val anyMetric = hr in 30..200 || step > 0 || cal > 0 || dist > 0 || temp > 0 || high > 0 || low > 0
            if (!worn && !anyMetric) { idx++; continue }

            // 注意：SDK 中 mTime 是 private 字段，必须显式调 getmTime()（Kotlin 属性语法会解析到私有字段）。
            val t = o.getmTime()
            val ts = if (t != null) {
                val (y, m, d) = parseYmd(date)
                val c = Calendar.getInstance().apply {
                    set(y, m - 1, d, t.getHour(), t.getMinute(), t.getSecond())
                    set(Calendar.MILLISECOND, 0)
                }
                c.timeInMillis
            } else {
                // 时间点缺失时按序号均匀摊到当天（顺序即测量先后，符合回放语义）。
                dateMidnightMs(date) + idx * 5 * 60 * 1000L
            }

            val slot = JSONObject().apply {
                put("ts", ts)
                if (t != null) put("time", "%02d:%02d".format(t.getHour(), t.getMinute()))
                if (hr in 30..200) put("hr", hr)
                if (step >= 0) put("step", step)
                if (cal > 0) put("cal", cal)
                if (dist > 0) put("dist", dist)
                if (temp > 0) put("temp", temp)
                if (high > 0) put("bpSys", high)
                if (low > 0) put("bpDia", low)
            }
            out.add(slot)
            idx++
        }
        return out
    }

    /** 睡眠汇总 → JS daily。allSleepTime<=0 视为当天无睡眠记录，不写以免污染。 */
    private fun buildDaily(s: SleepData?, wakeKey: String? = null): JSONObject {
        val d = JSONObject()
        if (s != null && s.allSleepTime > 0) {
            d.put("sleepTotalMin", s.allSleepTime)
            d.put("sleepDeepMin", s.deepSleepTime)
            d.put("sleepLightMin", s.lowSleepTime)
            val line = s.sleepLine
            if (!line.isNullOrBlank()) d.put("sleepLine", line)
            d.put("sleepGetUp", s.wakeCount)
            d.put("sleepScore", s.sleepQulity)
            // ★ 2026-11-09：SDK 的 SleepData.sleepDown / sleepUp 带入睡/起床时刻，
            //   旧实现整个丢掉 → 睡眠详情页「入睡时刻 / 起床时刻」永远是「—」，
            //   睡眠窗口推不出，夜间静息心率 / HRV 也无从按窗口取样本。
            //   TimeData 的 hour/minute 是 public 字段；全 0 视为固件未下发，不写以免污染。
            fun hhmm(t: TimeData?): String? {
                if (t == null) return null
                val h = t.getHour()
                val m = t.getMinute()
                if (h == 0 && m == 0) return null
                if (h !in 0..23 || m !in 0..59) return null
                return "%02d:%02d".format(h, m)
            }
            hhmm(s.sleepDown)?.let { d.put("sleepTime", it) }
            hhmm(s.sleepUp)?.let { d.put("wakeTime", it) }
            // ★ 2026-11-16：把 TimeData 自带的完整年月日一并下发，JS 侧才能校验
            //   「这条睡眠到底属于哪一天」。旧实现只发 HH:mm，把日期丢了，导致
            //   lib/sleepTime.sleepSummaryDateOf 的「完整日期优先」分支在 Android 上永远失效。
            fun ymd(t: TimeData?): String? {
                if (t == null) return null
                val y = t.getYear(); val mo = t.getMonth(); val dd = t.getDay()
                if (y !in 2020..2030 || mo !in 1..12 || dd !in 1..31) return null
                return "%04d-%02d-%02d".format(y, mo, dd)
            }
            ymd(s.sleepDown)?.let { d.put("sleepDownDate", it) }
            // ★ 2026-11-20(v64)：sleepUpDate 必须等于归档键（起床日）。
            //   固件的 sleepUp 日期是「夜晚归属日」（比起床日早一天，见 onReadOriginComplete 的重归档），
            //   直接下发会让 JS 的 todaySleepMismatch 守卫把真睡眠整块拒掉。
            if (wakeKey != null) d.put("sleepUpDate", wakeKey) else ymd(s.sleepUp)?.let { d.put("sleepUpDate", it) }
        }
        return d
    }

    private fun todayDateKey(): String {
        val c = Calendar.getInstance()
        return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    private fun dateMidnightMs(date: String): Long {
        val (y, m, d) = parseYmd(date)
        val c = Calendar.getInstance().apply {
            set(y, m - 1, d, 0, 0, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return c.timeInMillis
    }

    /** 把 SDK 返回的日期（可能是 "yyyy-MM-dd" 或 "yyyy-MM-dd HH:mm:ss"）归一化为 yyyy-MM-dd。 */
    private fun normDateKey(s: String?): String? {
        if (s.isNullOrBlank()) return null
        val m = Regex("(\\d{4}-\\d{2}-\\d{2})").find(s)
        return m?.groupValues?.get(1)
    }

    private fun parseYmd(date: String): Triple<Int, Int, Int> {
        return try {
            val p = date.split("-")
            Triple(p[0].toInt(), p[1].toInt(), p[2].toInt())
        } catch (e: Exception) {
            val c = Calendar.getInstance()
            Triple(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
        }
    }

    private fun daysBetween(from: String, to: String): Int {
        return try {
            val (fy, fm, fd) = parseYmd(from)
            val (ty, tm, td) = parseYmd(to)
            val c1 = Calendar.getInstance().apply { set(fy, fm - 1, fd, 0, 0, 0); set(Calendar.MILLISECOND, 0) }
            val c2 = Calendar.getInstance().apply { set(ty, tm - 1, td, 0, 0, 0); set(Calendar.MILLISECOND, 0) }
            ((c2.timeInMillis - c1.timeInMillis) / 86400000L).toInt()
        } catch (e: Exception) {
            -1
        }
    }

    @ReactMethod
    fun triggerOxygenAnalysis() {
        if (!ready.get()) {
            emit("onOxygenAnalysis", JSONObject().apply { put("error", "ring_not_connected") })
            return
        }
        try {
            // ★ 2026-11-13：回读设备可存储天数（默认 7，下限 3），覆盖多个夜晚，提高 SpO2 原始命中率。
            val oxygenDays = deviceWatchday.coerceIn(3, 7)
            val collected = mutableListOf<Spo2hOriginData>()
            val finished = AtomicBoolean(false)
            val finish: () -> Unit = lambda@{
                if (finished.compareAndSet(false, true)) {
                    if (collected.isEmpty()) {
                        log("[VeepooRing ANDROID] oxygenAnalysis: no SpO2 origin collected in $oxygenDays days (device may not have all-day SpO2 monitoring on, or no nights worn)")
                        emit("onOxygenAnalysis", JSONObject().apply { put("error", "no_data") })
                        return@lambda
                    }
                    try {
                        val util = Spo2hOriginUtil(collected)
                        val spo2s = collected.mapNotNull { if (it.oxygenValue in 70..100) it.oxygenValue else null }
                        val rrs = collected.mapNotNull { if (it.respirationRate in 5..40) it.respirationRate else null }
                        val cls = collected.mapNotNull { if (it.cardiacLoad >= 0) it.cardiacLoad else null }
                        val hypPts = collected.filter { it.isHypoxia != 0 }
                        val apneaPts = collected.filter { it.apneaResult != 0 }

                        val aveOxygen = if (spo2s.isNotEmpty()) spo2s.sum().toDouble() / spo2s.size else 0.0
                        val minOxygen = spo2s.minOrNull() ?: 0
                        val aveRespRate = if (rrs.isNotEmpty()) rrs.sum().toDouble() / rrs.size else 0.0
                        val minRespRate = rrs.minOrNull() ?: 0
                        val maxRespRate = rrs.maxOrNull() ?: 0
                        val aveCardiacLoad = if (cls.isNotEmpty()) cls.sum().toDouble() / cls.size else 0.0
                        val minCardiacLoad = cls.minOrNull() ?: 0
                        val maxCardiacLoad = cls.maxOrNull() ?: 0

                        // 低氧时间：血氧 < 90 的分钟数（每点≈1分钟），换算成秒
                        val lowO2Min = collected.count { it.oxygenValue in 50..100 && it.oxygenValue < 90 }
                        val aveLowOxygenTime = lowO2Min * 60
                        val maxLowOxygenTime = aveLowOxygenTime

                        val isHypoxia = util.isHypoxia        // int：是否缺氧（D2 第10位）
                        val apneaList = util.apneaList        // List<Map>：呼吸暂停事件
                        val apneaCount = if (apneaList.isNotEmpty()) apneaList.size else apneaPts.size
                        val events = if (apneaCount > 0) apneaCount else hypPts.size
                        // ★ AHI 近似分级（仅参考，UI 已注明「不作为诊断依据」）
                        val grade = when {
                            isHypoxia == 0 && apneaCount == 0 && hypPts.isEmpty() -> 0
                            events < 5 -> 1
                            events < 15 -> 2
                            else -> 3
                        }
                        val gradeDes = when (grade) {
                            0 -> "正常"
                            1 -> "轻度"
                            2 -> "中度"
                            3 -> "重度"
                            else -> "—"
                        }

                        // 频现时段：把缺氧/呼吸暂停点按小时聚合
                        val hourCounts = sortedMapOf<Int, Int>()
                        for (d in (hypPts + apneaPts).distinct()) {
                            val h = d.getmTime()?.getHour() ?: continue
                            hourCounts[h] = (hourCounts[h] ?: 0) + 1
                        }
                        val freqTimes = hourCounts.keys.map { "%02d:00".format(it) }
                        val freqVals = hourCounts.keys.map { hourCounts[it] ?: 0 }

                        emit("onOxygenAnalysis", JSONObject().apply {
                            put("osahsResult", grade)
                            put("osahsResultDes", gradeDes)
                            put("aveOxygen", r1(aveOxygen))
                            put("minOxygen", minOxygen)
                            put("aveRespRate", r1(aveRespRate))
                            put("minRespRate", minRespRate)
                            put("maxRespRate", maxRespRate)
                            put("aveLowOxygenTime", aveLowOxygenTime)
                            put("maxLowOxygenTime", maxLowOxygenTime)
                            put("aveCardiacLoad", r1(aveCardiacLoad))
                            put("minCardiacLoad", minCardiacLoad)
                            put("maxCardiacLoad", maxCardiacLoad)
                            put("aveSleepActivity", 0)
                            put("freqTimes", JSONArray(freqTimes))
                            put("freqVals", JSONArray(freqVals))
                            put("ts", System.currentTimeMillis())
                        })
                        log("[VeepooRing ANDROID] oxygenAnalysis done grade=$grade pts=${collected.size} apnea=$apneaCount hyp=${hypPts.size}")
                    } catch (e: Exception) {
                        log("[VeepooRing ANDROID] oxygenAnalysis parse FAILED: ${e.message}")
                        emit("onOxygenAnalysis", JSONObject().apply { put("error", "parse_failed:${e.message}") })
                    }
                }
            }
            // ★ 2026-11-10 修正：本固件 readSpo2hOrigin 返回空包（见 readSpo2hOriginHistory 注释 L690），
            //   真实 SpO2 原始数据只能经 readOriginDataBySetting + IOriginData3Listener
            //   .onOriginSpo2OriginListDataChange 获取（与 readOrigin3History 同源，已实证 173 点）。
            //   故改用该路径收集 Spo2hOriginData，再喂给 Spo2hOriginUtil 做呼吸暂停/缺氧解析。
            val listener = object : IOriginData3Listener {
                override fun onReadOriginProgress(p: Float) {}
                override fun onReadOriginProgressDetail(a: Int, b: String?, c: Int, d: Int) {}
                override fun onOriginFiveMinuteListDataChange(list: List<OriginData3>?) {}
                override fun onOriginHalfHourDataChange(d: OriginHalfHourData?) {}
                override fun onOriginHRVOriginListDataChange(list: List<HRVOriginData>?) {}
                override fun onOriginSpo2OriginListDataChange(list: List<Spo2hOriginData>?) {
                    for (d in list.orEmpty()) collected.add(d)
                }
                override fun onReadOriginComplete() { finish() }
                override fun onReadTimeout(code: Int) { finish() }
            }
            // ★ 2026-11-13（用户：呼吸暂停分析老没数据）：旧实现只回读 2 天 SpO2 原始，
            //   若这 2 天恰好没戴 / 没落 SpO2 原始点就整段空 → 一直「没数据」。
            //   改成回读设备可存储天数（默认 7，下限 3，见上方 oxygenDays 声明），覆盖多个夜晚，命中率大幅提高；
            //   超时也从 15s 放宽到 25s，避免多天回读被硬截断。
            manager.readOriginDataBySetting(IBleWriteResponse { _ -> }, listener, ReadOriginSetting(0, 1, false, oxygenDays))
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 25_000L)
            log("[VeepooRing ANDROID] oxygenAnalysis reading days=$oxygenDays (via readOriginDataBySetting/IOriginData3Listener)")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] oxygenAnalysis FAILED: ${e.message}")
            emit("onOxygenAnalysis", JSONObject().apply { put("error", "read_failed:${e.message}") })
        }
    }

    /** 一位小数四舍五入（避免 locale 问题，不用 String.format） */
    private fun r1(x: Double): Double = Math.round(x * 10) / 10.0

    /**
     * RR/Lorenz 卡已按用户要求移除：这枚戒指不记录逐拍 RR 间期（反编译+真机探针实证），
     * 保留空 stub 仅为兼容旧 JS 调用，不再发任何 SDK 读取或诊断日志。
     */
    @ReactMethod
    fun readRrAnalysis() {
        log("[VeepooRing ANDROID] rrAnalysis requested (no-op: device has no per-beat RR)")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 常量
    // ─────────────────────────────────────────────────────────────────────────
    override fun getConstants(): MutableMap<String, Any>? {
        return hashMapOf("SCAN_TIME" to 10000)
    }

    private object Constants {
        const val SCAN_TIME = 10000
    }

    // 简易 IBleWriteResponse 实现（仅确认成功/失败日志）
    // ★ 2026-11-08：修复 stub 重写遗留的编译错误——SDK 里不存在 IWriteResponse，
    //   confirmDevicePwd 等接口要的是 IBleWriteResponse（唯一方法 onResponse(int)）。
    private class IWriteResponseOk : IBleWriteResponse {
        override fun onResponse(code: Int) {
            // no-op
        }
    }
}
