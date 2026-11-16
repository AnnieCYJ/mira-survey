package com.miraringfashion.app.keepalive

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log

/**
 * 戒指「掉线后冻结免疫」的唤醒守护（2026-11-16）。
 *
 * ★ 真因（OPPO PMA110 真机 logcat 实锤，见 QA 报告 9.19）：
 *   BLE 偶发 GATT status=8 超时断连 → 原生掉线监听正确上报、JS autoLink 也立刻发起扫描，
 *   但熄屏后 ColorOS 的 OplusHansManager 会 **freeze 整个 App 进程**（前台服务/connectedDevice
 *   类型都挡不住），JS 的 45s watchdog / 扫描兜底定时器全部停摆 → 实测 20 分 55 秒无人重连，
 *   直到用户点亮屏幕解冻，才在 24s 内连上。
 *
 * ★ 解法：把「掉线后的唤醒」交给 **系统 AlarmManager**，而不是 App 进程内的 JS/Handler 定时器。
 *   - 掉线时 VeepooRingModule 调 schedule() 排一个精确闹钟；闹钟由系统服务持有，
 *     进程被冻结/Doze 也能到点把进程唤醒（解冻）。
 *   - Receiver 到点后只做三件轻量事：拿 WakeLock 保持 CPU、拉起前台保活服务、
 *     重排下一个闹钟形成兜底链。进程一解冻，JS 定时器恢复运行，autoLink 即会补连。
 *   - **故意不在 Receiver 里碰 BLE / SDK**：进程可能是冷启动，SDK 单例与鉴权回调都在
 *     VeepooRingModule 里，重建极易连上却鉴权失败；且同名广播会形成循环。保持最小职责。
 *   - 连上后 VeepooRingModule 调 cancel() 撤闹钟，零额外耗电；用户主动断开同样 cancel()。
 *   - 跨进程状态全部存 SharedPreferences，不依赖单例内存态。
 */
object RingReconnectAlarm {

    private const val TAG = "RingReconnect"
    const val PREFS = "mira_ring_reconnect"
    const val KEY_MAC = "last_mac"
    const val KEY_ACTIVE = "auto_reconnect_active"

    const val ACTION_ALARM = "com.miraringfashion.app.RING_RECONNECT_ALARM"
    /** 唤醒后发给 VeepooRingModule 动态 receiver 的「立即原生重连」请求（与 ALARM 不同名，避免循环）。 */
    const val ACTION_RECONNECT_REQUEST = "com.miraringfashion.app.RING_RECONNECT_REQUEST"
    const val EXTRA_MAC = "mac"

    /** 掉线后首次唤醒延迟 20s；之后每轮重排，直到连上或用户主动断开。 */
    const val INTERVAL_MS = 20_000L

    private fun pendingIntent(ctx: Context, mac: String): PendingIntent {
        val intent = Intent(ctx, RingReconnectReceiver::class.java).apply {
            action = ACTION_ALARM
            putExtra(EXTRA_MAC, mac)
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(ctx, 0x5247, intent, flags)
    }

    /** 记住最近一次连接的 MAC，并标记「允许自动重连」。每次成功连接都刷新。 */
    fun rememberMac(ctx: Context, mac: String) {
        if (mac.isBlank()) return
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_MAC, mac)
            .putBoolean(KEY_ACTIVE, true)
            .apply()
    }

    /** 用户主动断开：关掉自动重连，避免「断开了又自己连回来」。 */
    fun setActive(ctx: Context, active: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ACTIVE, active)
            .apply()
        if (!active) cancel(ctx)
    }

    fun isActive(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ACTIVE, false)

    fun lastMac(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MAC, "") ?: ""

    /**
     * 排下一次唤醒闹钟。setAlarmClock 被系统视为「闹钟」，Doze/冻结下优先级最高；
     * setExactAndAllowWhileIdle 作为部分 ROM 的兜底。
     */
    fun schedule(ctx: Context, mac: String, delayMs: Long = INTERVAL_MS) {
        if (mac.isBlank()) return
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val pi = pendingIntent(ctx, mac)
        val trigger = System.currentTimeMillis() + delayMs
        try {
            val show = PendingIntent.getActivity(
                ctx, 0x5248,
                Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            am.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, show), pi)
        } catch (e: Throwable) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi)
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, trigger, pi)
                }
            } catch (e2: Throwable) {
                Log.w(TAG, "schedule failed: ${e2.message}")
            }
        }
        Log.i(TAG, "scheduled wake in ${delayMs / 1000}s mac=$mac")
    }

    /** 连上/主动断开时撤掉闹钟。PendingIntent 必须与 schedule 完全一致。 */
    fun cancel(ctx: Context) {
        val mac = lastMac(ctx)
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        try {
            am.cancel(pendingIntent(ctx, mac))
        } catch (e: Throwable) {
            Log.w(TAG, "cancel failed: ${e.message}")
        }
        Log.i(TAG, "alarm canceled")
    }
}

/**
 * 闹钟到点后由系统拉起（即使 App 进程被 ColorOS freeze）。
 * 只做「唤醒 + 保 CPU + 拉保活服务 + 重排」，不碰 BLE，不动 RN 状态。
 */
class RingReconnectReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != RingReconnectAlarm.ACTION_ALARM) return
        val app = context.applicationContext
        if (!RingReconnectAlarm.isActive(app)) {
            RingReconnectAlarm.cancel(app)
            return
        }
        val mac = intent.getStringExtra(RingReconnectAlarm.EXTRA_MAC)
            ?.takeIf { it.isNotBlank() } ?: RingReconnectAlarm.lastMac(app)
        if (mac.isBlank()) return

        val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val lock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mira:ring-reconnect")
        try { lock?.acquire(18_000L) } catch (_: Throwable) {}

        // 拉起前台保活服务：即使这次是冷启动，也能让进程拿到前台优先级、不被立刻冻回去
        try {
            val svc = Intent(app, RingKeepaliveService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(svc)
            else app.startService(svc)
        } catch (e: Throwable) {
            Log.w(TAG, "start keepalive failed: ${e.message}")
        }

        Log.i(TAG, "alarm fired → process awake mac=$mac")

        // ★ 直接请求原生层立即重连：进程虽被解冻，但 JS 定时器/ReactInstance 未必恢复，
        //   靠 watchdog 不可靠。发一条不同 action 的显式广播，VeepooRingModule 的动态
        //   receiver 收到后走完整 connect()（含鉴权 + ready + 回填），不依赖 JS。
        //   若模块还没注册（冷启动瞬间），这条广播自然丢失，靠下面的闹钟链兜底重排。
        try {
            app.sendBroadcast(Intent(RingReconnectAlarm.ACTION_RECONNECT_REQUEST).apply {
                setPackage(app.packageName)
                putExtra(RingReconnectAlarm.EXTRA_MAC, mac)
            })
        } catch (e: Throwable) {
            Log.w(TAG, "reconnect request failed: ${e.message}")
        }

        // 重排下一个闹钟，形成兜底链；连上后 VeepooRingModule 会 cancel()
        RingReconnectAlarm.schedule(app, mac)

        val pending = goAsync()
        Handler(Looper.getMainLooper()).postDelayed({
            try { lock?.release() } catch (_: Throwable) {}
            try { pending.finish() } catch (_: Throwable) {}
        }, 15_000L)
    }

    private companion object { const val TAG = "RingReconnect" }
}
