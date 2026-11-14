/**
 * ensureBlePermissions —— Android 蓝牙运行时权限闸门
 * ─────────────────────────────────────────────────────────────────────────────
 * 根因：mira-app 的 Android 端（targetSdk=34，且真机多为 Android 12+）只会在
 * AndroidManifest 声明 BLUETOOTH_SCAN / BLUETOOTH_CONNECT（Android <12 还需
 * ACCESS_FINE_LOCATION），但**从不运行时申请**。Android 6+ 的危险权限仅靠声明
 * 不会授予，于是原生扫描拿不到设备 MAC/名称（被空值过滤丢弃）、connectDevice
 * 因缺 BLUETOOTH_CONNECT 静默失败 —— 戒指永远搜不到也连不上（全新安装必现）。
 *
 * 本文件提供唯一出口：每次真正要扫描/连接前调用一次；已授予则立即返回 true
 * （不会重复弹窗），未授予则弹系统授权框。iOS 由 CoreBluetooth 系统自动授权，直接放行。
 *
 * 调用点：RingBleManager.connect() / startScan()（覆盖自动保活、设置页手动连接、
 * 连接页自动连接全部路径）。
 */
import { Platform, PermissionsAndroid } from 'react-native';

/** 解析 Android SDK 版本号（Platform.Version 在 Android 上是字符串，如 "34"） */
const ANDROID_SDK = (() => {
  if (Platform.OS !== 'android') return 0;
  const v = parseInt(String(Platform.Version), 10);
  return Number.isFinite(v) ? v : 0;
})();

/**
 * 申请蓝牙所需运行时权限。
 * @returns 是否「已满足连接所需的最小权限集」
 *   - Android 12+（API≥31）：需 BLUETOOTH_SCAN + BLUETOOTH_CONNECT 都 granted
 *   - Android <12（API<31）：需 ACCESS_FINE_LOCATION granted
 *   - 非 Android：true（iOS 不需要）
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    if (ANDROID_SDK >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      const scan = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
      const connect = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
      const ok = scan === 'granted' && connect === 'granted';
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ensureBlePermissions] Android ${ANDROID_SDK} 蓝牙权限未全部授予：` +
            `SCAN=${scan}, CONNECT=${connect}`,
        );
      }
      return ok;
    }

    // Android 6–11：BLE 扫描/连接依赖定位权限
    const loc = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (loc !== 'granted') {
      // eslint-disable-next-line no-console
      console.warn(`[ensureBlePermissions] Android ${ANDROID_SDK} 定位权限未授予（BLE 需要）`);
    }
    return loc === 'granted';
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ensureBlePermissions] 请求权限异常：', e);
    return false;
  }
}
