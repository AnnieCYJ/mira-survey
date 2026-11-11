package com.miraringfashion.app

import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * App 内「下载并安装」原生桥（替代原来「跳系统浏览器下载」的中转方案）。
 * - downloadAndInstall(apkUrl)：下载 APK 到应用私有外部存储 Download 目录，
 *   用 FileProvider 生成 content:// URI，拉起系统安装器（ACTION_VIEW + apk mime）。
 * - 下载进度通过 RCTDeviceEventEmitter 周期性发 "AppUpdaterProgress" 事件（{progress,bytes,total}）。
 * 安装本身仍由系统弹一次用户确认（Android 8+ 安全要求，无法绕过）；覆盖安装保留 App 数据。
 */
class AppUpdaterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppUpdater"

    private fun emitProgress(percent: Int, bytes: Long, total: Long) {
        val map = Arguments.createMap()
        map.putInt("progress", percent)
        map.putDouble("bytes", bytes.toDouble())
        map.putDouble("total", total.toDouble())
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("AppUpdaterProgress", map)
    }

    @ReactMethod
    fun downloadAndInstall(apkUrl: String, promise: Promise) {
        val ctx = reactContext.applicationContext
        val dir = reactContext.applicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: reactContext.applicationContext.getExternalFilesDir(null)
        if (dir == null) {
            promise.reject("NO_STORAGE", "找不到可写存储目录")
            return
        }
        val outFile = File(dir, "mira-update.apk")
        try {
            val url = URL(apkUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 15_000
            conn.readTimeout = 5 * 60_000 // 大文件（~340MB）移动网络可能间隔较长
            conn.instanceFollowRedirects = true
            conn.connect()
            val code = conn.responseCode
            if (code !in 200..299) {
                promise.reject("HTTP_$code", "下载失败：HTTP $code")
                return
            }
            val total = conn.contentLength.toLong().coerceAtLeast(0)
            val input = BufferedInputStream(conn.inputStream)
            val output = FileOutputStream(outFile)
            val buffer = ByteArray(8192)
            var read: Int
            var downloaded: Long = 0
            var lastPct = -1
            while (input.read(buffer).also { read = it } != -1) {
                output.write(buffer, 0, read)
                downloaded += read
                if (total > 0) {
                    val pct = ((downloaded * 100) / total).toInt()
                    if (pct != lastPct) {
                        lastPct = pct
                        emitProgress(pct, downloaded, total)
                    }
                }
            }
            output.flush()
            output.close()
            input.close()
            conn.disconnect()
            emitProgress(100, downloaded, total)

            val uri = FileProvider.getUriForFile(
                ctx,
                "${reactContext.packageName}.fileprovider",
                outFile,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_FAILED", e.message ?: "下载失败")
        }
    }
}
