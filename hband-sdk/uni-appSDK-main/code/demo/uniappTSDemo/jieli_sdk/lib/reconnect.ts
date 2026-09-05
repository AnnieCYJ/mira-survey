import { logi } from "../utils/log";
import { incrementMacAddress, getDeviceDataMac } from "../utils/util";
import { BluetoothDevice } from "./bluetooth";

/todo 不可以跟上层扫描冲突，所以要上层的扫描/
export class Reconnect {
  reconnectOp?: ReconnectOp;
  reconnectCallback?: ReconnectCallback;
  isFinished: boolean = false;
  connectingDevice: BluetoothDevice | undefined;
  timeoutNumber: number = -1;
  isFindDevice: boolean = false;
  constructor(op: ReconnectOp, callback: ReconnectCallback) {
    this.reconnectOp = op;
    this.reconnectCallback = callback;
  }
  startReconnect(timeout: number) {
    logi("startReconnect 启动回连 超时=" + timeout + "ms，开始扫描")
    this.timeoutNumber = setTimeout(() => {
      logi("startReconnect 回连超时(未在 " + timeout + "ms 内完成)，触发 onReconnectFailed")
      clearTimeout(this.timeoutNumber)
      this.reconnectCallback?.onReconnectFailed()
      this.reconnectOp = undefined
      this.reconnectCallback = undefined
      this.connectingDevice = undefined
      this.isFinished = true
      this.timeoutNumber = -1
    }, timeout);
    this.reconnectOp?.startScanDevice()
  }
  stopReconnect() {
    this.reconnectOp = undefined
    this.reconnectCallback = undefined
    this.connectingDevice = undefined
    this.isFinished = true
    clearTimeout(this.timeoutNumber)
    this.timeoutNumber = -1
  }
  //上层扫描暂停通知
  onScanStop() {
    // 仅在未锁定设备连接、未完成时重启扫描。否则 connectDevice 内部的 stopScan 会被这里再次重启扫描，
    // 鸿蒙 allowDuplicatesKey 反复上报同一设备 -> 反复触发 isReconnectDevice/connectDevice -> 死循环日志爆炸崩溃
    if (!this.isFinishedReconnect() && this.connectingDevice == undefined) {
      logi("onScanStop 扫描停止但回连未完成，重启扫描")
      this.reconnectOp?.startScanDevice();
    }
  }
  //上层扫描发现设备
  onDiscoveryDevices(devices: BluetoothDevice[]) {
    devices.forEach(device => {
      this.onDiscoveryDevice(device)
    });
  }
  //上层扫描发现设备
  onDiscoveryDevice(device: BluetoothDevice) {
    if (this.isFinishedReconnect()) return
    if (this.connectingDevice != undefined) return // 已锁定一个设备在连接，忽略后续重复扫描回调(鸿蒙会反复上报同一设备)
    if (this.reconnectOp?.isReconnectDevice(device)) {
      console.log("上层扫描发现设备device=>", device);
      this.connectingDevice = device
      this.reconnectOp?.connectDevice(device) // 内部会 stopScan，不再调 onScanStop(那会重启扫描形成死循环)
    }
  }
  //上层连接设备失败——解除锁定并重新扫描重试。
  //没有这个入口的话，一次连接失败后 connectingDevice 一直占着锁，
  //所有后续扫描回调都被忽略，只能干等 RECONNECT_DEVICE_TIMEOUT。
  onDeviceConnectFailed(deviceId: string) {
    if (this.isFinishedReconnect()) return
    if (this.connectingDevice != undefined && deviceId == this.connectingDevice.deviceId) {
      logi("onDeviceConnectFailed : " + deviceId + "，解除锁定重新扫描");
      this.connectingDevice = undefined
      this.reconnectOp?.startScanDevice()
    }
  }
  //上层连接设备成功-
  onDeviceConnected(deviceId: string) {
    if (!this.isFinishedReconnect()) {
      logi("onDeviceConnected : " + deviceId + " deviceId :" + this.connectingDevice?.deviceId);
      if (this.connectingDevice != null && this.connectingDevice != undefined && deviceId == this.connectingDevice.deviceId) {
        logi("onDeviceConnected 设备匹配，回连成功，清除超时定时器")
        clearTimeout(this.timeoutNumber)
        this.reconnectCallback?.onReconnectSuccess(deviceId)
        this.isFinished = true
        this.isFindDevice = false;
      } else {
        // 设备连上了但 deviceId 与锁定连接的设备不一致：常见于单备份升级换 BLE 地址、
        // 或 iOS 上 onRcspInit 上报的 deviceId 与扫描锁定时的不一致。这里不清超时，
        // Reconnect 会一直空等到 onReconnectFailed(-112)。打日志暴露这条静默分支。
        logi("onDeviceConnected deviceId 不匹配，忽略：上报=" + deviceId + " 锁定=" + this.connectingDevice?.deviceId + "，将继续等待直到超时")
      }
    }
  }

  private isFinishedReconnect(): boolean {
    return this.isFinished;
  }
}


//新回连方式解析器
export function parseReconnectNewWayMsg(rawData: ArrayBuffer) {

}

export interface ReconnectOp {
  startScanDevice(): any;//扫描设备
  isReconnectDevice(scanDevice: BluetoothDevice): boolean//判断是不是回连设备
  connectDevice(device: BluetoothDevice): any;//连接设备
}
export interface ReconnectCallback {
  onReconnectSuccess(deviceId: string): any;
  onReconnectFailed(): any;
}