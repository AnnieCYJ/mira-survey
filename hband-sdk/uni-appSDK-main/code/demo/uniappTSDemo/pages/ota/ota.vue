<template>
	<view class="box">
		<!-- <view>
			<button @click="setJLVerify">进行杰里认证</button>
		</view> -->

		<text class="tip-step">
			使用步骤
			1.读取升级文件(在微信聊天信息中读取文件)
			2.开始升级(升级过程中保持在该页面)
		</text>

		<view style="height: 100rpx;"></view>

		<view class="file-info">
			文件读取状态:
			<view v-if="fileStatus === 0" style="color: brown;">未读取</view>
			<view v-else-if="fileStatus === 1" style="color: chartreuse;">读取中</view>
			<view v-else-if="fileStatus === 2" style="color: blue;">已读取</view>
		</view>

		<view class="file-info">
			文件信息:{{ fileName }}
			<view style="color: blue;">{{ fileInfo }}</view>
		</view>

		<view style="height: 100rpx;"></view>

		<view class="blue-btn" @click="clickReadFile">读取升级文件</view>

		<view style="height: 100rpx;"></view>

		<view v-if="!isOTAing" class="blue-btn" @click="clickStartOTA">开始升级</view>
		<view v-else class="blue-btn" @click="">取消传输</view>

		<view>{{ otaProgressText }}</view>
	</view>

</template>

<script lang="ts">
	import { RCSPManager, RCSP } from "../../jieli_sdk/lib/rcsp-impl/rcsp"
	import { BleDataHandler, BleSendDataHandler } from '../../jieli_sdk/lib/ble-data-handler';
	import { DeviceManager, DeviceBluetooth } from "../../jieli_sdk/lib/rcsp-impl/dev-bluetooth";
	import { BluetoothDevice } from "../../jieli_sdk/lib/rcsp-protocol/rcsp-util";
	import { RcspOTAManager } from "../../jieli_sdk/jl_lib/jl-ota/ota-rcsp"
	// const { OTAConfig, ReConnectMsg, UpgradeType, OTAImpl } = require("../../jieli_sdk/jl_lib/jl-ota/jl_ota_2.1.0");
	// import { OTAConfig, ReConnectMsg, UpgradeType, OTAImpl } from "../../jieli_sdk/jl_lib/jl-ota/jl_ota_2.1.0";
	import * as authModule from "../../jieli_sdk/jl_lib/jl-ota/jl_ota_2.1.0";
	const { OTAConfig, ReConnectMsg, UpgradeType, OTAImpl } = authModule as any;
	import { Device } from "../../jieli_sdk/jl_lib/jl-rcsp/jl_rcsp_watch_1.1.0";
	import { Reconnect, ReconnectCallback, ReconnectOp } from "../../jieli_sdk/lib/reconnect";
	import { getDeviceDataMac, incrementMacAddress } from "../../jieli_sdk/utils/util";

	export default {
		data() {
			return {
				isOTAing: false,
				otaProgressText: "",
				fileStatus: 0,
				fileInfo: "",
				fileName: "",
				rcspReady: false,
			}
		},

		onLoad() {
			// 私有属性
			this._Reconnect = null;
			this._reconnectPrintedDev = new Set<string>();
			this.otaData = new Uint8Array(0);
			this._RCSPWrapperEventCallback = null;
			this._rcspOTAWrapperEventCallback = null;
			this.reconnectingDeviceId = "";
			this.rcspOTAManager = null;

			BleDataHandler.init();

			// 监听 RCSP 接管成功
			this._RCSPWrapperEventCallback = new RCSP.RCSPWrapperEventCallback();
			this._RCSPWrapperEventCallback.onEvent = (event) => {
				if (event.type === "onSwitchUseDevice") {
					const id = event.onSwitchUseDeviceEvent?.device?.deviceId || event.onSwitchUseDeviceEvent?.deviceId;
					if (id) {
						this.rcspReady = true;
					}
				}
			};
			RCSPManager.observe(this._RCSPWrapperEventCallback);

			// 监听蓝牙事件
			DeviceManager.observe(this._onRCSPBluetoothEvent);

			// 注册 OTA 回连监听 —— 必须在 onLoad 就注册，不能等到开始 OTA 才注册。
			// 设备升级重启后回连、RCSP 重新握手时会发 onRcspInit，只有在那里调用
			// _Reconnect.onDeviceConnected() 才能清掉 Reconnect 的超时定时器。
			// 之前 initOTA() 只定义没调用，蓝牙即使连回来了 Reconnect 也无从知晓，
			// 一路空等到 onReconnectFailed -> OTA 报 -112 Waiting for reconnect device timeout。
			this.initOTA();

			// const bleInfo = uni.getStorageSync('bleInfo');
			// const sysInfo = uni.getSystemInfoSync();

			// const sysPLT = sysInfo.platform;
			// if (sysPLT === 'ios') {
			// 	uni.getBluetoothDevices({
			// 		success(res) {
			// 			const list = (res.devices || []) as Array<WechatMiniprogram.BlueToothDevice>;
			// 			console.log('[连接诊断] 已连接BLE设备', list.map(d => d.deviceId));

			// 			const cur = (bleInfo?.deviceId && list.find(d => d.deviceId === bleInfo.deviceId)) || list[0];
			// 			if (cur) {
			// 				this._takeOverDevice(cur.deviceId, cur.name || bleInfo?.name || '');
			// 			} else if (bleInfo?.deviceId) {
			// 				this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
			// 			} else {
			// 				uni.showToast({ title: '未找到已连接设备，请先连接' });
			// 			}
			// 		}, fail: (e) => {
			// 			console.error('[连接诊断] getConnectedBluetoothDevices 失败', e);
			// 			if (bleInfo?.deviceId) {
			// 				this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
			// 			} else {
			// 				uni.showToast({ title: '未找到已连接设备，请先连接' });
			// 			}
			// 		}
			// 	})
			// } else {
			// 	// 获取当前已连接设备，解决鸿蒙 deviceId 失效问题
			// 	uni.getConnectedBluetoothDevices({
			// 		services: [],
			// 		success: (res) => {
			// 			const list = (res.devices || []) as Array<WechatMiniprogram.BlueToothDevice>;
			// 			console.log('[连接诊断] 已连接BLE设备', list.map(d => d.deviceId));

			// 			const cur = (bleInfo?.deviceId && list.find(d => d.deviceId === bleInfo.deviceId)) || list[0];
			// 			if (cur) {
			// 				this._takeOverDevice(cur.deviceId, cur.name || bleInfo?.name || '');
			// 			} else if (bleInfo?.deviceId) {
			// 				this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
			// 			} else {
			// 				uni.showToast({ title: '未找到已连接设备，请先连接' });
			// 			}
			// 		},
			// 		fail: (e) => {
			// 			console.error('[连接诊断] getConnectedBluetoothDevices 失败', e);
			// 			if (bleInfo?.deviceId) {
			// 				this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
			// 			} else {
			// 				uni.showToast({ title: '未找到已连接设备，请先连接' });
			// 			}
			// 		}
			// 	});
			// }

			const bleInfo = uni.getStorageSync('bleInfo');
			const sysInfo = uni.getSystemInfoSync();

			// iOS下 getConnectedBluetoothDevices 可能返回空数组，直接用存储的设备信息接管
			if (sysInfo.platform === 'ios') {
				console.log('[连接诊断] iOS平台，直接使用存储的设备信息');
				uni.stopBluetoothDevicesDiscovery(); // 停止可能正在进行的搜索
				if (bleInfo?.deviceId) {
					this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
				} else {
					uni.showToast({ title: '未找到设备信息，请先连接' });
				}
			} else {
				// 非iOS平台仍使用原方式
				uni.getConnectedBluetoothDevices({
					services: [],
					success: (res) => {
						const list = (res.devices || []) as Array<WechatMiniprogram.BlueToothDevice>;
						console.log('[连接诊断] 已连接BLE设备', list.map(d => d.deviceId));

						const cur = (bleInfo?.deviceId && list.find(d => d.deviceId === bleInfo.deviceId)) || list[0];
						if (cur) {
							this._takeOverDevice(cur.deviceId, cur.name || bleInfo?.name || '');
						} else if (bleInfo?.deviceId) {
							this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
						} else {
							uni.showToast({ title: '未找到已连接设备，请先连接' });
						}
					},
					fail: (e) => {
						console.error('[连接诊断] getConnectedBluetoothDevices 失败', e);
						if (bleInfo?.deviceId) {
							this._takeOverDevice(bleInfo.deviceId, bleInfo.name || '');
						} else {
							uni.showToast({ title: '未找到已连接设备，请先连接' });
						}
					}
				});
			}
		},

		onShow() {
			BleDataHandler.init();
		},

		onUnload() {
			DeviceManager.removeObserve(this._onRCSPBluetoothEvent);
			RCSPManager.removeObserve(this._rcspOTAWrapperEventCallback);
		},

		methods: {
			// 杰理接管设备
			_takeOverDevice(deviceId : string, name : string) {
				console.log('[连接诊断] 杰理接管 deviceId=' + deviceId + ' name=' + name);
				const device = new BluetoothDevice();
				device.deviceId = deviceId;
				device.localName = name;
				DeviceManager.connecDevice(device);
			},

			// 读取升级文件
			clickReadFile() {
				const that = this;
				// 小程序：chooseMessageFile 选文件
				// #ifdef MP
				uni.chooseMessageFile({
					count: 1,
					success: (res : any) => { if (res.tempFiles && res.tempFiles[0]) that._processOtaFile(res.tempFiles[0]); }
				});
				// #endif
				// App：加载内置固件(static/ota/firmware.ufw，打包进 App)。最小验证用，绕过文件选择器。
				// #ifdef APP-PLUS
				that._loadBundledFirmware();
				// #endif
				// #ifdef H5
				uni.showToast({ title: 'H5 端请用真机运行读取内置固件', icon: 'none' });
				// #endif
			},
			// 读取打包进 App 的内置固件(_www/static/ota/firmware.ufw) -> otaData
			// 标准基座没有 uni.getFileSystemManager，所以走 plus.io。
			// 曾经先试 plus.android 反射(Files.readAllBytes + Java Base64)，但 Java 原生数组
			// 作为返回值跨不过 plus 桥：实测读完 3MB 耗时 5.9 秒后返回 null，必然降级——
			// 这不是"偶发失败的快路径"而是恒定失败，纯属白等 6 秒，已删除。
			// plus.io 读同一个文件只要 182ms，而且不依赖 plus.android，iOS 也能用。
			_loadBundledFirmware() {
				const that = this;
				// ⚠️注意ufw为固件解压之后的文件，跨项目/设备号 升级错误的文件
				// 会导致设备变转，如需验证升级，需配置指定项目匹配的固件
				const rel = '_www/static/ota/firmware.ufw';
				that.fileStatus = 1;
				uni.showLoading({ title: '读取固件中...', mask: true });
				// @ts-ignore
				plus.io.resolveLocalFileSystemURL(rel, (entry : any) => {
					entry.file((file : any) => {
						// file.size 就是权威长度，用它给 _onFirmwareLoaded 做字节数对账，
						// 不必再为了拿 length() 去碰 plus.android
						const expectSize = file.size || 0;
						console.log('[固件] ' + rel + ' size=' + expectSize);
						if (expectSize <= 0) {
							that._onFirmwareFailed('固件为空(size=0)，请确认 static/ota/firmware.ufw 已同步到手机');
							return;
						}
						// @ts-ignore
						const reader = new plus.io.FileReader();
						reader.onloadend = (evt : any) => {
							const result : string = (evt.target && evt.target.result) || '';
							// dataURL 形如 data:xxx;base64,AAAA...，只要逗号后面那段
							const comma = result.indexOf(',');
							const b64 = comma >= 0 ? result.substring(comma + 1) : result;
							console.log('[固件] base64 len=' + b64.length);
							that._onFirmwareLoaded(that._b64ToUint8(b64), expectSize);
						};
						reader.onerror = (e : any) => {
							that._onFirmwareFailed('FileReader 失败: ' + ((e && e.message) || JSON.stringify(e)));
						};
						reader.readAsDataURL(file);
					}, (e : any) => {
						that._onFirmwareFailed('entry.file 失败: ' + ((e && e.message) || JSON.stringify(e)));
					});
				}, (e : any) => {
					that._onFirmwareFailed('找不到固件文件 ' + rel + '：' + ((e && e.message) || JSON.stringify(e))
						+ '。请确认 static/ota/firmware.ufw 已同步到手机(重新运行到手机)');
				});
			},
			// 读取成功收口：只有真的拿到完整字节才算"已读取"。
			// 任何一项校验不过都必须硬失败——拿残缺/损坏的固件去刷设备可能直接刷坏硬件，
			// 设备侧的表现就是传完数据后 queryUpdateResult 返回 4(-105 upgrade file is damaged)。
			_onFirmwareLoaded(data : Uint8Array, expectSize : number) {
				uni.hideLoading();
				if (!data || data.length === 0) {
					this._onFirmwareFailed('解码后长度为 0');
					return;
				}
				// 字节数必须和 file.size 完全一致。原来这里只 warn 就继续用，
				// 等于把一份可能被截断的固件送去刷机，改为拒绝。
				if (expectSize > 0 && data.length !== expectSize) {
					this._onFirmwareFailed('字节数不符：读到 ' + data.length + '，文件实际 ' + expectSize
						+ '。读取链路(Base64 桥接/解码)丢数据了，已拒绝使用');
					return;
				}
				const fp = this._firmwareFingerprint(data);
				console.log('[固件] 指纹 size=' + data.length + ' head16=' + fp.head16
					+ ' tail16=' + fp.tail16 + ' sum32=' + fp.sum32);
				// .ufw 包在末尾 16 字节处带 "JLUFW" 魔数。读到的字节要是不带，说明拿到的
				// 根本不是一个完整的 ufw 包(截断/同步到手机的是旧文件/读错文件)，不必刷设备就能判定。
				if (fp.tail16.indexOf('4a4c554657') === -1) {
					this._onFirmwareFailed('不是完整的 ufw 包：末尾缺少 JLUFW 魔数(tail16=' + fp.tail16
						+ ')。请确认 static/ota/firmware.ufw 已重新同步到手机');
					return;
				}
				this.otaData = data;
				this.fileName = 'firmware.ufw（内置）';
				this.fileInfo = '文件大小：' + data.length;
				this.fileStatus = 2;
				console.log('[固件] 读取成功 size=', data.length);
			},
			// 固件指纹：拿来和电脑上的原文件逐项对比，确认字节没在读取链路里被改动
			_firmwareFingerprint(data : Uint8Array) {
				const hex = (arr : Uint8Array) => Array.from(arr)
					.map(b => ('0' + b.toString(16)).slice(-2)).join('');
				let sum = 0;
				for (let i = 0; i < data.length; i++) sum = (sum + data[i]) >>> 0;
				return {
					head16: hex(data.subarray(0, 16)),
					tail16: hex(data.subarray(Math.max(0, data.length - 16))),
					sum32: sum
				};
			},
			// 读取失败收口
			_onFirmwareFailed(msg : any) {
				uni.hideLoading();
				console.error('[固件] 读取失败', msg);
				this.otaData = new Uint8Array(0);
				this.fileStatus = 0;
				this.fileInfo = '';
				this.fileName = '';
				uni.showModal({ title: '固件读取失败', content: String(msg), showCancel: false });
			},
			// base64 字符串 -> Uint8Array（纯 JS 字符串操作，用 map 做 O(1) 查表，大文件也快）
			_b64ToUint8(b64 : string) : Uint8Array {
				const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
				const map : any = {};
				for (let i = 0; i < chars.length; i++) map[chars[i]] = i;
				const clean = (b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
				const len = clean.length;
				const out = new Uint8Array((len >> 2) * 3);
				let p = 0;
				for (let i = 0; i < len; i += 4) {
					const c1 = map[clean[i]], c2 = map[clean[i + 1]], c3 = map[clean[i + 2]], c4 = map[clean[i + 3]];
					if (c1 == null || c2 == null) break;
					out[p++] = (c1 << 2) | (c2 >> 4);
					if (c3 != null && clean[i + 2] !== '=') out[p++] = ((c2 & 15) << 4) | (c3 >> 2); else break;
					if (c4 != null && clean[i + 3] !== '=') out[p++] = ((c3 & 3) << 6) | c4; else break;
				}
				return out.subarray(0, p);
			},
			// 读取升级文件内容为 Uint8Array
			_processOtaFile(tempFile : any) {
				const that = this;
				that.fileStatus = 1;
				const fs = uni.getFileSystemManager();
				fs.getFileInfo({
					filePath: tempFile.path,
					success: (infoRes : any) => {
						const fd = fs.openSync({ filePath: tempFile.path });
						const uint8 = new Uint8Array(infoRes.size);

						fs.read({
							fd,
							arrayBuffer: uint8.buffer,
							length: infoRes.size,
							success: () => {
								that.otaData = uint8;
								console.log("文件读取成功 size=", uint8.length);
								that.fileStatus = 2;
								that.fileName = tempFile.name;
								that.fileInfo = "文件大小：" + infoRes.size;
							},
							complete: () => {
								fs.close({ fd });
							}
						});
					}
				});
			},

			// 开始OTA
			clickStartOTA() {
				// RCSPManager._AuthMap.clear();        // 清空残留认证
				BleDataHandler.init();               // 重置蓝牙监听
				const cur = RCSPManager.getCurrentRcspOperateWrapper();
				console.log('[连接诊断] OTA前连接状态', RCSPManager.isConnectedDevce(), cur?.deviceId);

				if (!RCSPManager.isConnectedDevce()) {
					uni.showToast({ title: "请先连接设备" });
					return;
				}

				if (this.fileStatus === 2 && this.otaData.length > 0) {
					this._startOTA();
				} else {
					uni.showToast({ title: "请先读取升级文件", icon: "none" });
				}
			},

			// 蓝牙状态监听
			_onRCSPBluetoothEvent(event : DeviceBluetooth.DeviceBluetoothEvent) {
				if (event.type === 'onConnection') {
					const st = event.onConnectionEvent?.status;
					const dev = event.onConnectionEvent?.device;
					// status: 0=已断开 1=连接中 2=已连接 3=连接失败
					const stLabel = st === 0 ? '已断开' : st === 1 ? '连接中' : st === 2 ? '已连接' : st === 3 ? '连接失败' : ('未知(' + st + ')');
					console.log('[连接诊断] onConnection status=' + st + '(' + stLabel + ') device=' + dev?.deviceId);
					// 回连期间连接失败(status=3)：通知 Reconnect 解锁并重新扫描重试，
					// 否则一次失败就只能干等 80s 超时(-112)
					if (st === 3 && dev?.deviceId) {
						this._Reconnect?.onDeviceConnectFailed(dev.deviceId);
					}
				} else if (event.type === 'onDiscoveryStatus') {
					const bStart = event.onDiscoveryStatusEvent?.bStart;
					console.log('[连接诊断] onDiscoveryStatus ' + (bStart ? '扫描开始' : '扫描停止'));
					if (!bStart) {
						this._Reconnect?.onScanStop();
					}
				} else if (event.type === 'onDiscovery') {
					const device = event.onDiscoveryEvent?.device;
					if (device) {
						// rawData 可能为空(系统已连接的设备被扫到时拿不到广播包)。旧回连方式只比对 deviceId，
						// 根本不需要广播包，所以不能因为没有 rawData 就把设备丢掉，否则回连永远匹配不上。
						const rawData = event.onDiscoveryEvent?.bleScanMessage?.rawData;
						if (rawData) device.advertisData = rawData;
						this._Reconnect?.onDiscoveryDevice(device);
					}
				}
			},

			// 注册 RCSP 重新初始化监听，服务于 OTA 回连。
			// 单备份升级会切换 BLE 地址，设备回连后 rcspOpImpl 是新的一份，必须在 onRcspInit 时换掉；
			// 同时通知 Reconnect「设备已连上」，否则它只会一直等到超时。
			initOTA() {
				this._rcspOTAWrapperEventCallback = {
					onEvent: (_res) => {
						if (_res.type !== "onRcspInit" || !_res.onRcspInitEvent) return;
						const devId = _res.onRcspInitEvent.device.deviceId;
						const isInit = _res.onRcspInitEvent.isInit;
						console.log('[回连] onRcspInit isInit=' + isInit + ' device=' + devId
							+ ' 期望=' + this.reconnectingDeviceId);
						if (!isInit) return;
						if (devId?.toUpperCase() !== this.reconnectingDeviceId?.toUpperCase()) {
							// 设备回连后 RCSP 握手上报的 deviceId 与扫描锁定时的不一致(iOS 的 deviceId 是 UUID，可能变)。
							// 这里不通知 Reconnect，超时定时器不会被清除，最终走到 onReconnectFailed(-112)。
							console.warn('[回连] onRcspInit deviceId 与回连设备不一致，忽略(继续等待匹配设备或超时)');
							return;
						}
						// 用原始 deviceId 查表，不要用大写后的：部分平台 deviceId 大小写敏感，查不到就白等超时
						const bleDev = RCSPManager.getBluetoothDeviceByDeviceId(devId);
						if (!bleDev) {
							console.warn('[回连] getBluetoothDeviceByDeviceId 没查到设备', devId);
							return;
						}
						const impl = RCSPManager.getRcspOperateWrapper(bleDev)?.getRcspOpImpl();
						if (!impl) {
							console.warn('[回连] 拿不到 rcspOpImpl', devId);
							return;
						}
						console.log('[回连] RCSP 重新握手完成，通知 Reconnect 并更新 rcspOpImpl');
						this._Reconnect?.onDeviceConnected(bleDev.deviceId);
						this.rcspOTAManager?.updateRcspOpImpl(impl);
					}
				};
				RCSPManager.observe(this._rcspOTAWrapperEventCallback);
			},

			// 杰里认证
			// setJLVerify() {
			// 	const info = uni.getStorageSync('bleInfo');
			// 	if (!info) {
			// 		uni.showToast({ title: "未获取到设备信息", icon: "none" });
			// 		return;
			// 	}
			// 	const device = info as BluetoothDevice;
			// 	DeviceManager.connecDevice(device);
			// },

			hex2Mac(buffer : ArrayBuffer) {
				return Array.from(new Uint8Array(buffer))
					.map(b => ('00' + b.toString(16)).slice(-2))
					.join(':');
			},

			// OTA 核心逻辑
			_startOTA() {
				const rcspOpImpl = RCSPManager.getCurrentRcspOperateWrapper()?.wrapper.getRcspOpImpl();
				if (!rcspOpImpl) return;

				const otaConfig : OTAConfig = new OTAConfig();
				otaConfig.isSupportNewRebootWay = true;
				otaConfig.updateFileData = this.otaData;

				this.rcspOTAManager = new RcspOTAManager(rcspOpImpl);
				this.isOTAing = true;
				const that = this;
				// 清零丢包统计，失败时用来区分"固件文件本身有问题"和"传输过程丢包传坏了"
				BleSendDataHandler.resetStats();

				this.rcspOTAManager.startOTA(otaConfig, {
					onStartOTA: () => {
						that.otaProgressText = "开始升级";
					},

					onNeedReconnect: (reConnectMsg : ReConnectMsg) => {
						// 记录回连策略输入：isSupportNewReconnectADV 决定走 MAC 匹配还是回退到 名称/deviceId 匹配；
						// platform 决定 iOS 走名称匹配、其它走 deviceId 匹配。这两个值是后续分支判定的根因。
						console.log('[回连] onNeedReconnect 触发 isSupportNewReconnectADV=' + reConnectMsg.isSupportNewReconnectADV
							+ ' platform=' + uni.getSystemInfoSync().platform
							+ ' 当前OTA设备MAC=' + that.rcspOTAManager.getCurrentOTADeviceMac());
						that._reconnectPrintedDev.clear();
						that.otaProgressText = "正在回连设备...";

						const op : ReconnectOp = {
							startScanDevice() {
								DeviceManager.starScan();
							},
							isReconnectDevice(scanDevice : BluetoothDevice) : boolean {
								const oldDevice = that.rcspOTAManager.getCurrentOTADevice();
								const oldMac = that.rcspOTAManager.getCurrentOTADeviceMac();

								let matched = false;
								let reason = '';
								if (reConnectMsg.isSupportNewReconnectADV && oldMac && scanDevice.advertisData) {
									// 新回连方式：单备份升级会换 BLE 地址，目标 MAC = 旧 MAC + 1
									const currMac = getDeviceDataMac(scanDevice);
									const targetMac = incrementMacAddress(oldMac);
									matched = currMac === targetMac;
									reason = '新回连MAC匹配 oldMac=' + oldMac + ' targetMac=' + targetMac + ' currMac=' + (currMac || '(空)');
								} else {
									const sysInfo = uni.getSystemInfoSync();
									const isIos = sysInfo.platform === 'ios';
									if (isIos) {
										// iOS：广播包/deviceId 都不可靠，只能靠设备名称子串匹配。
										// 若 bleInfo.name 为空会恒返回 false——表现就是"扫到设备却永不命中"，一路空等到超时(-112)。
										const bleInfo = uni.getStorageSync('bleInfo');
										const targetName = bleInfo?.name;
										const scanName = scanDevice.localName || '';
										matched = !!targetName && scanName.includes(targetName);
										reason = 'iOS名称匹配 targetName=' + (targetName || '(空)') + ' scanName=' + scanName
											+ (!targetName ? ' [bleInfo.name 为空，恒不命中]' : '');
									} else {
										const oldId = oldDevice?.deviceId?.toUpperCase();
										const scanId = scanDevice.deviceId?.toUpperCase();
										matched = oldId === scanId;
										reason = 'deviceId匹配 oldId=' + (oldId || '(空)') + ' scanId=' + (scanId || '(空)');
									}
								}

								// 每个设备每轮回连只打一次判定日志：onBluetoothDeviceFound 是高频回调，
								// 不去重会把日志冲爆(鸿蒙 allowDuplicatesKey 还会反复上报同一设备)。
								// advertisData 有无也要记录——它为空时新回连 MAC 分支会被跳过，回退到名称/deviceId 匹配。
								const devKey = (scanDevice.deviceId || '?') + '|' + (scanDevice.localName || '');
								if (!that._reconnectPrintedDev.has(devKey)) {
									that._reconnectPrintedDev.add(devKey);
									console.log('[回连] 扫描判定 ' + reason
										+ ' advertisData=' + (scanDevice.advertisData ? '有' : '无')
										+ ' -> ' + (matched ? '命中' : '跳过'));
								}
								return matched;
							},
							// 整个函数包 try/catch：这里是被 uni 的 onBluetoothDeviceFound 原生回调同步调进来的，
							// 异常抛出去会被原生桥吞掉，一行日志都看不到；而 Reconnect 在调本函数前就把
							// connectingDevice 锁上了(reconnect.ts:57)，之后所有扫描回调都 early-return，
							// 只能干等 80s 超时 —— 表现就是"扫到设备了但再无任何日志"。
							connectDevice(device : BluetoothDevice) {
								try {
									console.log('[回连] connectDevice 进入 ' + device.deviceId);
									// 单独兜住 stopScan：它内部 uni.stopBluetoothDevicesDiscovery() /
									// uni.offBluetoothDeviceFound() 都是无参调用(照搬微信小程序写法)，App 端
									// 这两个 API 签名不同，一抛就把整条回连链掐断。参考工程里能跑通的 otaNavite
									// 页压根不调 stopScan，所以这里失败也必须继续往下连。
									try {
										DeviceManager.stopScan();
									} catch (e1) {
										console.error('[回连] stopScan 异常(已忽略，继续连接)', (e1 && (e1 as any).message) || e1);
									}
									const dt = new BluetoothDevice();
									dt.RSSI = device.RSSI;
									dt.advertisData = device.advertisData;
									dt.advertisServiceUUIDs = device.advertisServiceUUIDs;
									dt.connectable = device.connectable;
									dt.deviceId = device.deviceId;
									dt.localName = device.localName;
									dt.serviceData = device.serviceData;
									that.reconnectingDeviceId = device.deviceId;

									// connecDevice 在 isConnected/isConnecting 为 true 时会直接 return 且不打日志，
									// 所以先把状态记下来。单独 try 兜住：这两个方法会遍历内部设备列表，
									// 列表里有脏数据(deviceId 为空)时 element.deviceId.toLowerCase() 会抛。
									let stateText = '';
									try {
										stateText = 'isConnected=' + DeviceManager.isConnected(dt)
											+ ' isConnecting=' + DeviceManager.isConnecting(dt);
									} catch (e2) {
										stateText = '读取连接状态异常: ' + ((e2 && (e2 as any).message) || e2);
									}
									console.log('[回连] 连接设备 ' + dt.deviceId + ' ' + stateText);

									DeviceManager.connecDevice(dt);
									console.log('[回连] connecDevice 已调用 ' + dt.deviceId);
								} catch (e) {
									console.error('[回连] connectDevice 异常', (e && (e as any).message) || e, e);
								}
							}
						};

						const callback : ReconnectCallback = {
							onReconnectSuccess(deviceId : string) {
								console.log("重连成功", deviceId);
								if (that.rcspOTAManager) {
									that.rcspOTAManager.updateOTADevice(new Device(deviceId));
								}
								that._Reconnect = null;
							},
							onReconnectFailed() {
								console.error("重连失败");
								that._Reconnect = null;
							}
						};

						this._Reconnect = new Reconnect(op, callback);
						this._Reconnect.startReconnect(OTAImpl.RECONNECT_DEVICE_TIMEOUT);
					},

					onProgress: (type : UpgradeType, progress : number) => {
						const msg = type === UpgradeType.UPGRADE_TYPE_FIRMWARE ? '发送sdk升级数据' : '发送uboot升级数据';
						that.otaProgressText = `正在${msg}...进度：${progress.toFixed(2)}%`;
					},

					onStopOTA: () => {
						that.isOTAing = false;
						that.otaProgressText = "升级成功";
						uni.showModal({
							title: '提示',
							content: '升级成功',
							showCancel: false,
							success: () => {
								uni.navigateBack({ delta: 2 });
							}
						});
						const devId = that.rcspOTAManager.getCurrentOTADevice()?.deviceId;
						if (devId) {
							const d = new BluetoothDevice();
							d.deviceId = devId;
							DeviceManager.disconnectDevice(d);
						}
						that.rcspOTAManager.release();
					},

					onCancelOTA: () => {
						that.isOTAing = false;
						that.otaProgressText = "升级取消";
						uni.showModal({ title: '提示', content: '升级取消' });
						const devId = that.rcspOTAManager.getCurrentOTADevice()?.deviceId;
						if (devId) {
							const d = new BluetoothDevice();
							d.deviceId = devId;
							DeviceManager.disconnectDevice(d);
						}
					},

					onError: (error : number, message : string) => {
						that.isOTAing = false;
						that._Reconnect?.stopReconnect();
						that.otaProgressText = `升级失败: code=${error} ${message}`;
						console.error(that.otaProgressText);
						// -105(固件损坏)/-102(数据校验错)这类"数据不对"的失败，先看是不是传输丢包造成的：
						// 丢包>0 说明固件文件没问题，是发送队列放弃了包把流传坏了，重试即可；
						// 丢包=0 才说明固件文件本身与设备不匹配。
						const drops = BleSendDataHandler.dropCount;
						const sent = BleSendDataHandler.sentCount;
						let hint : string;
						if (drops > 0) {
							// 发送队列放弃过包，固件流已经传坏，设备校验必然不过
							hint = '发送丢包，固件文件本身无问题，重试即可';
						} else if (error === -35 || error === -33) {
							// -35 I/O异常 / -33 设备离线：传输完整(0丢包)时，几乎都是升级成功后设备
							// 重启断链产生的噪声。正常情况下 queryUpdateResult 去重后不会再走到这里，
							// 真走到说明设备端可能确实没刷成功，请核对设备实际固件版本号确认。
							hint = '传输完整，-35/-33 多为升级成功后重启断链的噪声，请核对设备版本号确认';
						} else if (error === -111 || error === -109) {
							// 写全部 success 但设备收不到 -> 单包过大是首要嫌疑(写成功 ≠ 对端收到)
							hint = '无丢包但设备等不到数据，怀疑单包过大或链路异常，见上面"单包payload="';
						} else {
							hint = '传输完整，失败源自固件内容/设备不匹配';
						}
						console.error('[OTA诊断] 累计丢包=' + drops + ' 成功发包=' + sent
							+ ' 丢包率=' + (sent + drops > 0 ? (100 * drops / (sent + drops)).toFixed(3) : '0') + '%'
							+ ' —— ' + hint);
						uni.showModal({
							title: '升级失败',
							content: that.otaProgressText + (drops > 0 ? `\n\n(传输丢包 ${drops} 个，建议重试)` : ''),
							showCancel: false
						});
						const devId = that.rcspOTAManager.getCurrentOTADevice()?.deviceId;
						if (devId) {
							const d = new BluetoothDevice();
							d.deviceId = devId;
							DeviceManager.disconnectDevice(d);
						}
						that.rcspOTAManager.release();
					}
				});
			}
		}
	}
</script>

<style>
	.box {
		width: 100%;
		height: 100%;
		background-color: #F8FAFCFF;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.blue-btn {
		width: 686rpx;
		height: 96rpx;
		background: #398BFF;
		border-radius: 48rpx;
		font-size: 30rpx;
		font-weight: 500;
		color: #FFFFFF;
		line-height: 96rpx;
		text-align: center;
	}

	.tip-step {
		width: 100%;
		padding: 20rpx;
		box-sizing: border-box;
	}

	.file-info {
		display: flex;
		flex-direction: row;
		align-items: center;
		padding: 10rpx 20rpx;
	}
</style>