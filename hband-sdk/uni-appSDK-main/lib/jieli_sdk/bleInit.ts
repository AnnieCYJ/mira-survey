// app.ts
import { getLogger } from "../jieli_sdk/utils/logger";
import { setLogger as setOTALogger } from "../jieli_sdk/jl_lib/jl-ota/jl_ota_2.1.0";
import { setLogger as setRCSPLogger } from "../jieli_sdk/jl_lib/jl-rcsp/jl_rcsp_watch_1.1.0";
import { setLogger as setAppLogger } from "../jieli_sdk/utils/log";
import { RCSPManager, RCSP, RCSPOpWatchDial } from "../jieli_sdk/lib/rcsp-impl/rcsp";
import { BleDataHandler, BleSendDataHandler } from "../jieli_sdk/lib/ble-data-handler";
import { Bluetooth, UUID_NOTIFY, UUID_SERVICE, UUID_WRITE, wxBluetooth } from "../jieli_sdk/lib/rcsp-impl/bluetooth";
import { DeviceBluetooth, DeviceManager } from "../jieli_sdk/lib/rcsp-impl/dev-bluetooth";
// import { CommandBase, Connection, Device, DeviceInfo, OnRcspCallback, OnSendDataCallback, RcspOpImpl } from "../jieli_sdk/jl_lib/jl-rcsp/jl_rcsp_watch_1.1.0"

export class veepooJLBle {
	// sdk初始化
	init : Function

	// 监听连接状态
	connectionStatus : Function

	constructor() {
		// 杰里sdk初始化
		this.init = function () {
			// 连接成功，属于杰里设备
			// 安卓 App 标准基座没有 uni.getBLEMTU（仅小程序提供），杰里 SDK 多处调用会抛
			// "getBLEMTU is not a function"，导致 OTA 接管时 MTU 协商中断、设备断开。
			// 这里做兜底：平台不支持时返回默认 MTU（安卓 512 / iOS 244）并走 success 分支。
			// 若以后基座自带 getBLEMTU，typeof 判断会自动让位给真实实现。
			if (typeof (uni as any).getBLEMTU !== 'function') {
				(uni as any).getBLEMTU = function (opts : any) {
					let mtu = 512
					try {
						const sys = uni.getSystemInfoSync()
						if (sys.platform === 'ios') mtu = 244
					} catch (e) { }
					if (opts && typeof opts.success === 'function') {
						opts.success({ mtu })
					}
				}
			}
			uni.setStorageSync('JLBleConnected', false)
			// 杰里连接成功
			uni.setStorageSync('getServiceStatus', false)
			const logger = getLogger()
			if (logger != null) {
				console.log('logger=>', logger)
				setOTALogger(logger)
				setRCSPLogger(logger)
				setAppLogger(logger)
			}
			{
				//蓝牙
				// var bluetooth = new Bluetooth()
				const bluetooth = wxBluetooth
				// bluetooth.bluetoothManager.openBluetoothAdapter()
				//RCSP协议
				RCSPManager.init({
					sendData: (deviceId, data) => {
						// console.log("发送数据deviceId,data", deviceId, data)
						// console.log("deviceId, UUID_SERVICE, UUID_WRITE, data=>", deviceId, UUID_SERVICE, UUID_WRITE, data)
						return BleSendDataHandler.sendData(deviceId, UUID_SERVICE, UUID_WRITE, data)
					}, getBleConnect: () => {
						return bluetooth.bleConnect
					}, getBleScan: () => {
						return bluetooth.bleScan
					}
				})
				//设备管理
				const bluetoothOption = new DeviceBluetooth.BluetoothOption()
				bluetoothOption.isUseMultiDevice = true
				bluetoothOption.bleScanStrategy = 0
				console.log("bluetoothOption=>", bluetoothOption)
				DeviceManager.init({
					bluetoothOption,
					iScan: bluetooth.bleScan,
					iConnect: bluetooth.bleConnect
				}).observe((event : any) => {
					switch (event.type) {
						case 'onBleDataBlockChanged'://调整mtu成功
							const eventInfo = event.onBleDataBlockChangedEvent;
							// console.log('eventInfo==>', eventInfo);

							console.log("调整mtu成功")
							if (eventInfo && eventInfo.status == 0) {
								BleSendDataHandler.setMtu(eventInfo.device.deviceId, eventInfo.block);
								console.log("eventInfo.device.deviceId, eventInfo.block=>", eventInfo.device.deviceId, eventInfo.block)
							}
							break;
						case 'onShowDialog'://弹窗
							break;
						default:
							break;
					}
				})
				//蓝牙收数据
				const bleDataCallback = {
					onReceiveData: (res : WechatMiniprogram.OnBLECharacteristicValueChangeListenerResult) => {
						// console.log("蓝牙收数据=================res=>========================", res)
						if (res.characteristicId.toLowerCase() === UUID_NOTIFY.toLowerCase() && res.serviceId.toLowerCase() === UUID_SERVICE.toLowerCase()) {
							RCSPManager.onReceiveData(res.deviceId, res.value)
						}
					}
				}
				BleDataHandler.init()
				BleDataHandler.addCallbacks(bleDataCallback)
			}
		}

		// 监听连接状态
		this.connectionStatus = function (callback : any) {
			let time = setInterval(() => {
				uni.getConnectedBluetoothDevices({
					services: [],
					success(res) {
						console.log('已经连接的蓝牙', res)
						callback(res)
					}
				})
			}, 500)
		}
	}
}