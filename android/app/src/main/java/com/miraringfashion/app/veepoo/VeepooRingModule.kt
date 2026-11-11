package com.miraringfashion.app.veepoo

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.veepoo.protocol.VPOperateManager
import com.veepoo.protocol.listener.base.IBleWriteResponse
import com.veepoo.protocol.listener.base.IConnectResponse
import com.veepoo.protocol.listener.base.INotifyResponse
import com.veepoo.protocol.listener.data.IAllHealthDataListener
import com.veepoo.protocol.listener.data.IBatteryDataListener
import com.veepoo.protocol.listener.data.IHeartDataListener
import com.veepoo.protocol.listener.data.ISpo2hDataListener
import com.veepoo.protocol.listener.data.IHRVOriginDataListener
import com.veepoo.protocol.listener.data.ISpo2hOriginDataListener
import com.veepoo.protocol.listener.data.IOriginData3Listener
import com.veepoo.protocol.listener.data.IAutoMeasureSettingDataListener
import com.veepoo.protocol.listener.data.IDeviceFuctionDataListener
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

    private val manager: VPOperateManager by lazy { VPOperateManager.getMangerInstance(reactContext.applicationContext) }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ready = AtomicBoolean(false)
    private var monitorOn = false
    // ★ 2026-11-10（用户：心率在图表上死活不更新，必须解决）：
    //   本固件 SpO2hData.rateValue（实时心率）恒为 0（原始 BLE 包 spo2h_read_oprate 里 HR 字节恒 00），
    //   实时流拿不到心率；PULSE_RATE 周期自动测量在 16:00 后也断流。心率唯一可靠来源是
    //   独占 PPG 通道的即时测量（startDetectHeart → HeartData.data）。
    //   解法：实时血氧常开，每 5 分钟抢 20 秒通道采一次心率，采完恢复血氧流 —— 心率稳定每 5 分钟更新一次。
    private val hrSampleHandler = Handler(Looper.getMainLooper())
    private var hrSampleArmed = false
    private val HR_SAMPLE_INTERVAL_MS = 5 * 60_000L
    private val hrSampleRunnable = object : Runnable {
        override fun run() {
            if (monitorOn && ready.get()) {
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
    private val scannedDevices = mutableListOf<JSONObject>()
    // ★ 2026-11-09：离线回填状态机——真正调 SDK 读历史，逐日 emit onBatch。
    private val backfillInProgress = AtomicBoolean(false)
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
            val safe: Any? = when (data) {
                null, is String, is Number, is Boolean, is WritableMap, is ReadableArray -> data
                is JSONObject -> jsonToWritable(data)
                else -> data.toString()
            }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(name, safe)
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
            }

            override fun onSearchCanceled() {
                log("[VeepooRing ANDROID] scan canceled")
            }
        }
        // TODO(veepoo): 部分 SDK 版本 startScanDevice 仅接受 SearchResponse；
        // 若编译报参数不匹配，改为 manager.startScanDevice(request, response) 或 manager.search(request, response)。
        manager.startScanDevice(response)
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
        manager.connectDevice(address,
            IConnectResponse { code, _, _ ->
                if (code == com.inuker.bluetooth.library.Code.REQUEST_SUCCESS) {
                    log("[VeepooRing ANDROID] BLE connected")
                } else {
                    emit("onState", JSONObject().apply {
                        put("status", "error")
                        put("reason", "connect_failed")
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
                    log("[VeepooRing ANDROID] pwd ok")
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
        startRealtimeIfNeeded()
        // 确保戒指端心率/HRV 自动测量开着，否则整夜只会采血氧，App 无数据可回填
        ensureAutoMeasure()
    }

    @ReactMethod
    fun disconnect() {
        ready.set(false)
        // SDK 方法名是 disconnectWatch（需传入写回调）
        manager.disconnectWatch(IBleWriteResponse { _ -> })
        log("[VeepooRing ANDROID] disconnected")
        emit("onState", JSONObject().apply { put("status", "disconnected") })
    }

    @ReactMethod
    fun setAutoMonitor(on: Boolean) {
        monitorOn = on
        if (on) startRealtimeIfNeeded() else stopRealtime()
        log("[VeepooRing ANDROID] autoMonitor=$on")
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
        // ★ 2026-11-09：本固件 PPG 通道一次只能跑一个检测。旧实现把
        //   startDetectHeart 与 startDetectSPO2H 连着发，SDK 写队列只保留后者 ——
        //   真机实证 heart_read_oprate 全程 0 次、spo2h_read_oprate 每秒一条。
        //   默认保持血氧连续流；心率改由 ensureAutoMeasure()（戒指端周期采集）
        //   与 measure("hr")（分时独占 PPG 的即时测量）两条路径提供。
        startSpo2hOnly()
    }

    private fun startSpo2hOnly() {
        if (spo2Listener == null) {
            spo2Listener = object : ISpo2hDataListener {
                override fun onSpO2HADataChange(data: Spo2hData?) {
                    data ?: return
                    val spo2 = data.value
                    val hr = data.rateValue
                    val ts = System.currentTimeMillis()
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
            manager.startDetectSPO2H(IBleWriteResponse { _ -> }, spo2Listener)
            startHrSampling()
        }
    }

    private fun stopRealtime() {
        stopHrSampling()
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
    private fun startSingleHeartDetect() {
        if (!ready.get()) { startRealtimeIfNeeded(); return }
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
            log("[VeepooRing ANDROID] single HR detect started (20s window)")
            Handler(Looper.getMainLooper()).postDelayed({
                try { manager.stopDetectHeart(IBleWriteResponse { _ -> }) } catch (_: Exception) {}
                hrListener = null
                if (monitorOn) startSpo2hOnly()
                log("[VeepooRing ANDROID] single HR detect done, spo2h resumed")
            }, 20_000L)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] single HR detect FAILED: ${e.message}")
            hrListener = null
            if (monitorOn) startSpo2hOnly()
        }
    }

    /**
     * ★ 2026-11-09（用户：夜间戴着戒指，为什么整夜只有血氧没有 HR/HRV）：
     * 戒指端「自动测量」是按指标开开关的（EAutoMeasureType.PULSE_RATE / HRV / BLOOD_OXYGEN…）。
     * 血氧夜间自动检测是开的（整夜 9876 条），而心率/HRV 若被关掉，戒指根本不采，
     * 于是 OriginData.rateValue 恒 0、HRVOrigin 返回空包 —— App 侧再怎么解析也拿不到。
     * 连接就绪后读回设置，把 PULSE_RATE 与 HRV 打开（保留原有间隔/时间窗）。
     */
    private fun ensureAutoMeasure() {
        if (!ready.get()) return
        try {
            val listener = object : IAutoMeasureSettingDataListener {
                override fun onSettingDataChange(list: MutableList<AutoMeasureData>?) {
                    val items = list ?: return
                    for (item in items) {
                        val type = item.funType
                        log("[VeepooRing ANDROID] autoMeasure type=$type open=${item.isSwitchOpen} interval=${item.measureInterval}")
                        if ((type == EAutoMeasureType.PULSE_RATE || type == EAutoMeasureType.HRV) && !item.isSwitchOpen) {
                            item.isSwitchOpen = true
                            if (item.measureInterval <= 0) item.measureInterval = 5
                            try {
                                manager.setAutoMeasureSettingData(IBleWriteResponse { _ -> }, item, this)
                                log("[VeepooRing ANDROID] autoMeasure ENABLED $type")
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
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] autoMeasure FAILED: ${e.message}")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 手动测量（对齐 iOS measure(key)）
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun measure(key: String) {
        log("[VeepooRing ANDROID] measure $key")
        when (key) {
            "hr" -> startSingleHeartDetect()
            "spo2" -> startRealtimeIfNeeded()
            "temp" -> triggerHealthGlance()
            "eda", "stress", "depression" -> triggerGSR()
            "hrv", "cortisol", "healthGlance", "sns", "emotion", "skin", "fatigue",
            "cholesterol", "triglyceride", "hdl", "ldl", "ua", "uricAcid" -> triggerHealthGlance()
            "ecg" -> startEcg()
            "rr" -> log("[VeepooRing ANDROID] rr: 本固件未开放（SDK NoFunction），以待接入呈现")
            else -> log("[VeepooRing ANDROID] 未知测量项: $key")
        }
    }

    private fun triggerHealthGlance() {
        // TODO(veepoo): 核对外层健康扫描方法名（startHealthGlance / startHealthGlanceTest）。
        // 回调走 IHealthGlanceDataListener，需注册到 manager。
        log("[VeepooRing ANDROID] healthGlance requested (verify listener wiring)")
    }

    private fun triggerGSR() {
        // TODO(veepoo): 核对 GSR 方法名（startGSRDetect / readGSR）。
        log("[VeepooRing ANDROID] GSR requested (verify listener wiring)")
    }

    @ReactMethod
    fun stopEcg() {
        // TODO(veepoo): 本 SDK 版本 ECG 检测走 multi-lead API（startDetectMultiECG），
        //   单导 stopECG 不存在；待接入 ECG 时按 IECGDetectListener 重写。
        log("[VeepooRing ANDROID] ecg stopped (stub)")
    }

    private fun startEcg() {
        // TODO(veepoo): 核对 ECG 方法名（startECGTest / startECG）与回调 IECGTestDataListener。
        log("[VeepooRing ANDROID] ecg start requested (verify listener wiring)")
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
            log("[VeepooRing ANDROID] backfill skipped: 设备未就绪（未 connected/ready）")
            emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 0) })
            emit("onState", JSONObject().apply { put("status", "backfillDone") })
            return
        }
        if (backfillInProgress.getAndSet(true)) {
            log("[VeepooRing ANDROID] backfill 已在进行，忽略重复请求")
            return
        }

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
                val pct = (p * 100).toInt().coerceIn(0, 100)
                emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", pct) })
            }

            override fun onSleepDataChange(day: String?, sleepData: SleepData?) {
                sleepData ?: return
                // 以 SleepData.Date 为准并归一化为 yyyy-MM-dd；异常时回落到 day 参数（"0"/"1"...）。
                val key = normDateKey(sleepData.date) ?: normDateKey(day) ?: return
                sleepByDate[key] = sleepData
                log("[VeepooRing ANDROID] sleep d=$key total=${sleepData.allSleepTime} deep=${sleepData.deepSleepTime} light=${sleepData.lowSleepTime}")
            }

            override fun onReadSleepComplete() {
                // 睡眠读完后才会进入原始数据段，无需动作。
            }

            override fun onOringinFiveMinuteDataChange(originData: OriginData?) {
                originData ?: return
                val key = normDateKey(originData.date) ?: return
                val list = originByDate.getOrPut(key) { mutableListOf() }
                list.add(originData)
            }

            override fun onOringinHalfHourDataChange(d: OriginHalfHourData?) {
                d ?: return
                val rates = d.halfHourRateDatas ?: return
                val key = normDateKey(d.date) ?: normDateKey(rates.firstOrNull()?.date) ?: return
                val list = halfHourByDate.getOrPut(key) { mutableListOf() }
                for (r in rates) if (r != null) list.add(r)
            }

            override fun onReadOriginComplete() {
                // 全部读完：按日期聚合并发出 onBatch。
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
                    val daily = buildDaily(sleepByDate[date])
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
                log("[VeepooRing ANDROID] backfill read timeout code=$code")
                emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 100) })
                // ★ 2026-11-11：超时同样要补 origin3，否则整条 HRV/血氧历史回读永远不会跑。
                startOrigin3ThenFinish(n)
            }
        }

        try {
            // day=0 表示从今天起、position=1 从第 1 条开始、watchday=n 读取 n 天。
            manager.readAllHealthDataBySettingOrigin(listener, 0, 1, n)
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] backfill read FAILED: ${e.message}")
            emit("onState", JSONObject().apply { put("status", "error"); put("reason", "backfill_failed") })
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
            log("[VeepooRing ANDROID] origin3 已在本次事务内，忽略重复启动")
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
        origin3InProgress.set(false)
        emit("onState", JSONObject().apply { put("status", "syncing"); put("progress", 100) })
        emit("onState", JSONObject().apply { put("status", "backfillDone") })
        log("[VeepooRing ANDROID] backfill transaction done (origin3 settled)")
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
        if (!ready.get()) { onDone(); return }
        try {
            val slotsByDate = mutableMapOf<String, MutableList<JSONObject>>()
            var hrHits = 0
            var hrvHits = 0
            var spo2Hits = 0
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
                            put("daily", JSONObject())
                        })
                        emittedDays++
                        emittedPts += merged.size
                    }
                    log("[VeepooRing ANDROID] origin3 emit days=$emittedDays points=$emittedPts hr=$hrHits hrv=$hrvHits spo2=$spo2Hits")
                    // ★ 历史回读收尾了，才允许整轮同步事务 emit backfillDone。
                    onDone()
                }
            }

            val listener = object : IOriginData3Listener {
                override fun onReadOriginProgress(p: Float) {}
                override fun onReadOriginProgressDetail(a: Int, b: String?, c: Int, d: Int) {}
                override fun onOriginFiveMinuteListDataChange(list: List<OriginData3>?) {
                    for (o in list.orEmpty()) {
                        add(o.date, o.getmTime()) { s ->
                            val hr = o.rateValue
                            if (hr in 30..200) { s.put("hr", hr); hrHits++ }
                            val step = o.stepValue
                            if (step > 0) s.put("step", step)
                        }
                    }
                }
                override fun onOriginHalfHourDataChange(d: OriginHalfHourData?) {
                    val rates = d?.halfHourRateDatas ?: return
                    for (r in rates) {
                        if (r == null) continue
                        val hr = r.rateValue
                        if (hr !in 30..200) continue
                        add(d.date ?: r.date, r.time) { s -> s.put("hr", hr); hrHits++ }
                    }
                }
                override fun onOriginHRVOriginListDataChange(list: List<HRVOriginData>?) {
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
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 45_000L)
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
    private fun buildDaily(s: SleepData?): JSONObject {
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
            val collected = mutableListOf<Spo2hOriginData>()
            val finished = AtomicBoolean(false)
            val finish: () -> Unit = lambda@{
                if (finished.compareAndSet(false, true)) {
                    if (collected.isEmpty()) {
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
            manager.readOriginDataBySetting(IBleWriteResponse { _ -> }, listener, ReadOriginSetting(0, 1, false, 2))
            Handler(Looper.getMainLooper()).postDelayed({ finish() }, 15_000L)
            log("[VeepooRing ANDROID] oxygenAnalysis reading days=2 (via readOriginDataBySetting/IOriginData3Listener)")
        } catch (e: Exception) {
            log("[VeepooRing ANDROID] oxygenAnalysis FAILED: ${e.message}")
            emit("onOxygenAnalysis", JSONObject().apply { put("error", "read_failed:${e.message}") })
        }
    }

    /** 一位小数四舍五入（避免 locale 问题，不用 String.format） */
    private fun r1(x: Double): Double = Math.round(x * 10) / 10.0

    @ReactMethod
    fun readRrAnalysis() {
        log("[VeepooRing ANDROID] rrAnalysis requested")
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
