// ⚠ 待接入补丁 —— 放在 docs/native-patches/ 下，不参与 gradle 编译。
//
// 目的：补上「身心压力 stress / 活动消耗 met」的真实数据源。
//
// 背景（2026-11-07 协议审计结论）：
//   已装 APK 的 VeepooRingModule 只走 v3 5 分钟原始数据（OriginData3），
//   而 OriginData3 的 getter 全集里**没有** stress / met —— 因此 onBatch 的 slot
//   里永远不可能出现这两个字段，首页「身心压力」读 healthStore['stress'] 恒空。
//   SDK 里压力/MET 的真实来源是「读取设备手动测量数据」通道：
//     · VeepooSDK_Android_Api.md:10019-10085  readDeviceManualData(...)
//     · DeviceManualDataType.STRESS(3) / MET(6) / FATIGUE(11) / SKIN_CONDUCTANCE(12)
//     · PressureManualData.pressure [0-100]、MetoManualData.getMeto()
//     · 每条带 timeStamp（秒），是**设备端自动/手动测量的序列**，不是 5 分钟桶。
//     · 采样间隔由 AutoMeasureData.measureInterval 配置，可按时间段不同
//       （:10738）——这正是用户观察到的「夜间频率高、日间频率低」。
//
// 接入条件（重要，别跳过）：
//   磁盘上的 VeepooRingModule.kt 是 394 行旧桩，手机上能用的完整实现只存在于
//   已装 APK 的 classes4.dex；历史会话仅还原出第 300-1689 行
//   （见同目录 VeepooRingModule.recovered-lines-300-1689.kt.txt），前 299 行缺失。
//   **重编译前必须先补齐完整源码**，否则会把手机上的完整原生层编译倒退成空壳。
//   build-debug.sh 已加前置 guard 阻止误编译。
//
// 接入方式：把本文件放进
//   android/app/src/main/java/com/miraringfashion/app/veepoo/
// 并在完整 VeepooRingModule 的离线同步收尾处调用（伪代码，见文件末尾）。

package com.miraringfashion.app.veepoo

import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.veepoo.protocol.VPOperateManager
import com.veepoo.protocol.listener.base.IBleWriteResponse
import com.veepoo.protocol.listener.data.IDeviceManualDetectDataListener
import com.veepoo.protocol.model.datas.*
import com.veepoo.protocol.model.enums.DeviceManualDataType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 把「设备端测量记录」转成 App 已有的 onBatch slot 格式。
 *
 * 输出样例（JS 侧 handleBatch 可直接消费，无需改 JS）：
 * {
 *   date: "2026-11-07",
 *   source: "manualTest",
 *   cadenceMinutes: 30.0,          // 本批实测采样间隔中位数，供频率标注核对
 *   slots: [
 *     { ts: 1762483200000, t: "09:20", stress: 42, met: 1.2 },
 *     { ts: 1762485000000, t: "09:50", stress: 38 }
 *   ]
 * }
 *
 * 约定：
 *  · 只写真实测量点，不插值、不按 5 分钟补齐、不拿 HRV 反推压力。
 *  · 压力稀疏是设备协议决定的，App 侧「压力分布 / 压力时段」如实按稀疏点统计。
 *  · ts 用 epoch ms（parseSampleTs 同时支持秒与毫秒，见 RingBleManager.ts:687）。
 */
class VeepooManualTestReader(
    private val manager: VPOperateManager,
    private val emitBatch: (WritableMap) -> Unit,
    private val log: (String) -> Unit,
) {
    /** dateKey -> (tsMs -> (字段名 -> 值))，同一次测量的多个指标合并进同一 slot。 */
    private val byDate = LinkedHashMap<String, LinkedHashMap<Long, HashMap<String, Double>>>()
    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val hmFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    private fun put(tsSec: Long, field: String, value: Number) {
        val tsMs = if (tsSec > 1e11) tsSec else tsSec * 1000L
        val v = value.toDouble()
        if (!v.isFinite()) return
        val date = dayFmt.format(Date(tsMs))
        val day = byDate.getOrPut(date) { LinkedHashMap() }
        val slot = day.getOrPut(tsMs) { HashMap() }
        slot[field] = v
    }

    /** 发起读取。sinceSec=0 表示读全部；增量同步传上次读取的秒级时间戳。 */
    fun read(sinceSec: Long = 0L) {
        val wanted = listOf(
            DeviceManualDataType.STRESS,          // 压力（身心压力页）
            DeviceManualDataType.MET,             // 梅脱（活动消耗）
            DeviceManualDataType.FATIGUE,         // 疲劳度
            DeviceManualDataType.SKIN_CONDUCTANCE,// 皮电 / GSR
            DeviceManualDataType.HRV,             // HRV 测量点
            DeviceManualDataType.BLOOD_OXYGEN,    // 血氧测量点
            DeviceManualDataType.BODY_TEMPERATURE,// 体温测量点
        )
        // 设备能力门禁（:10024-10028）：接入方可用
        //   VpSpGetUtil.getVpSpVariInstance(ctx).supportReadDeviceManual
        // 过滤 wanted；SDK 对不支持的类型会自行忽略，这里先按全量请求。
        val types: List<DeviceManualDataType> = wanted
        log("[VeepooManualTest] readDeviceManualData since=$sinceSec types=$types")

        try {
            manager.readDeviceManualData(
                IBleWriteResponse { code -> log("[VeepooManualTest] write response=$code") },
                sinceSec,
                types,
                types,   // Demo 实证第 4 参传同一份 types（文档说可传空数组）
                object : IDeviceManualDetectDataListener {

                    // ── 压力：PressureManualData.pressure [0-100] ──
                    override fun onPressureManualDataChange(list: List<PressureManualData>) {
                        log("[VeepooManualTest] 压力 n=${list.size}")
                        for (d in list) put(d.timeStamp.toLong(), "stress", d.pressure)
                    }

                    // ── 梅脱 ──
                    override fun onMetoManualDataChange(list: List<MetoManualData>) {
                        log("[VeepooManualTest] MET n=${list.size}")
                        for (d in list) put(d.timeStamp.toLong(), "met", d.meto)
                    }

                    // ── 疲劳度 / 皮电：不同 SDK 版本 getter 名不一致，用反射兜底 ──
                    override fun onFatigueManualDataChange(list: List<FatigueManualData>) {
                        log("[VeepooManualTest] 疲劳 n=${list.size}")
                        for (d in list) reflectPut(d, "fatigue", "fatigueLevel", "fatigue", "value")
                    }
                    override fun onSkinConductanceManualDataChange(list: List<SkinConductanceManualData>) {
                        log("[VeepooManualTest] 皮电 n=${list.size}")
                        for (d in list) reflectPut(d, "eda", "gsr", "skinConductance", "value")
                    }
                    override fun onHrvManualDataChange(list: List<HrvManualData>) {
                        for (d in list) reflectPut(d, "hrv", "hrvValue", "hrv", "value")
                    }

                    // ── 其余类型本补丁不消费（v3 原始通道已有对应数据），空实现即可 ──
                    override fun onBloodPressureDataChange(list: List<BloodPressureManualData>) {}
                    override fun onHeartRateDataChange(list: List<HeartRateManualData>) {}
                    override fun onBloodGlucoseDataChange(list: List<BloodGlucoseManualData>) {}
                    override fun onBloodOxygenDataChange(list: List<BloodOxygenManualData>) {}
                    override fun onBodyTemperatureDataChange(list: List<BodyTemperatureManualData>) {}
                    override fun onBloodComponentManualDataChange(list: List<BloodComponentManualData>) {}
                    override fun onMiniCheckupManualDataChange(list: List<MiniCheckupManualData>) {}
                    override fun onEmotionManualDataChange(list: List<EmotionManualData>) {}
                    override fun onReadProgress(progress: Float) {
                        log("[VeepooManualTest] progress=$progress")
                    }
                    override fun onReadComplete() { flush() }
                    override fun onReadFail() {
                        log("[VeepooManualTest] ❌ readFail（设备可能不支持该通道）")
                        flush()   // 已收到的部分照样回传，不丢
                    }
                },
            )
        } catch (e: Throwable) {
            log("[VeepooManualTest] ❌ ${e.message}")
        }
    }

    /** 反射读取数值字段：兼容 SDK 版本间 getter 命名差异。 */
    private fun reflectPut(o: Any, field: String, vararg getterNames: String) {
        try {
            val ts = o.javaClass.getMethod("getTimeStamp").invoke(o) as Number
            for (g in getterNames) {
                val v = try {
                    o.javaClass.getMethod(g).invoke(o) as? Number
                } catch (e: Throwable) { null } ?: continue
                put(ts.toLong(), field, v)
                return
            }
        } catch (e: Throwable) { /* 单条失败不影响整批 */ }
    }

    /** 按日期 emit onBatch，并附上实测采样间隔。 */
    fun flush() {
        for ((date, slotsByTs) in byDate) {
            val tsList = slotsByTs.keys.sorted()
            val gaps = mutableListOf<Double>()
            for (i in 1 until tsList.size) {
                val g = (tsList[i] - tsList[i - 1]) / 60000.0
                if (g > 0 && g <= 120) gaps.add(g)
            }
            gaps.sort()
            val cadenceMin = if (gaps.isEmpty()) 0.0 else {
                val m = gaps.size / 2
                if (gaps.size % 2 == 1) gaps[m] else (gaps[m - 1] + gaps[m]) / 2.0
            }

            val arr = WritableNativeArray()
            for ((ts, fields) in slotsByTs) {
                val slot = WritableNativeMap()
                slot.putDouble("ts", ts.toDouble())
                slot.putString("t", hmFmt.format(Date(ts)))
                for ((k, v) in fields) slot.putDouble(k, v)
                arr.pushMap(slot)
            }
            val batch = WritableNativeMap()
            batch.putString("date", date)
            batch.putString("source", "manualTest")
            batch.putDouble("cadenceMinutes", cadenceMin)
            batch.putArray("slots", arr)
            log("[VeepooManualTest] ✅ onBatch date=$date slots=${slotsByTs.size} cadence=${cadenceMin}min")
            emitBatch(batch)
        }
        byDate.clear()
    }
}

/*
────────────────────────────────────────────────────────────────────────
接入到完整 VeepooRingModule（伪代码，放在 v3 原始读取收尾之后）：

    private val manualTestReader by lazy {
        VeepooManualTestReader(manager, { batch -> emit("onBatch", batch) }, { msg -> log(msg) })
    }

    // 在 readOriginDataAll / flushBatches 之后、backfillDone 之前：
    manualTestReader.read(sinceSec = lastManualTestReadSec)
    // onReadComplete 里会 flush；若 SDK 未回调 onReadComplete，用超时兜底：
    mainHandler.postDelayed({ manualTestReader.flush() }, 8000L)

    // lastManualTestReadSec 存 SharedPreferences，实现增量读取（:10047）。

JS 侧无需改动：RingBleManager.handleBatch 已认 slots 里的 stress / met /
fatigue / eda / hrv（见 METRIC_MAP 与 FIELD_ALIASES），parseSampleTs 支持 ts 毫秒。
────────────────────────────────────────────────────────────────────────
*/
