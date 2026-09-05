<template>
	<view class="content">
		<view class="scan-tip">下拉可重新搜索设备</view>
		<scroll-view class="ble-scroll" scroll-y="true" refresher-enabled="true" :refresher-triggered="refreshing"
			@refresherrefresh="onRefresh">
			<view v-for="(item, index) in bleList" :key="item.deviceId || index" class="ble_item"
				@click="connectBle(item)">
				<text>名称：{{ item.name }}</text>
				<text>mac：{{ item.mac }}</text>
				<text>信号：{{ item.RSSI }}</text>
			</view>
		</scroll-view>
	</view>
</template>

<script lang="ts">
	// 引入方式一:
	// // 整体引入
	// import sdk from '../../common/index.js'

	// // // 然后自己解构出来
	// const {
	// 	veepooBle,
	// 	veepooFeature
	// } = sdk;

	// 引入方式二：
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	// SDK 不会注销 onBluetoothDeviceFound 监听，二次进入页面时仍会回调第一次注册的旧闭包，
	// 而旧闭包指向已销毁的旧页面实例，导致新页面列表拿不到数据（表现为：扫描有打印、列表空）。
	// 用模块级中转：无论 SDK 命中哪个旧闭包，都路由到当前活跃页面的处理函数。
	let activeScanReceiver : ((res : any) => void) | null = null

	export default {
		data() {
			return {
				title: 'Hello',
				bleList: [],
				connectionState: false,
				refreshing: false,

			}
		},
		onShow() {
			// 进入页面即开始扫描（首次进入与每次返回都会触发）
			this.startScan();
		},
		onHide() {
			this.stopScan();
		},
		onPullDownRefresh() {
			// 下拉触发重新搜索
			this.startScan();
			// 扫描持续进行，触发后即结束下拉动画，设备会陆续进入列表
			uni.stopPullDownRefresh();
		},
		onUnload() {
			// 页面销毁时停止扫描
			this.stopScan();
		},
		methods: {

			onRefresh() {
				// 下拉刷新：触发重新搜索，稍后关闭刷新指示器（扫描持续进行，设备会陆续进入列表）
				this.refreshing = true;
				this.startScan();
				setTimeout(() => {
					this.refreshing = false;
				}, 1000);
			},

			startScan() {
				const MAX_DEVICES = 20;   // 扫满 20 个自动停止，避免列表过长
				const MIN_RSSI = -80;    // 信号弱于 -80dBm 的设备视为噪声，过滤掉
				this.bleList = [];
				const tempMap = new Map();
				// 把“拿到设备后怎么处理”挂到模块级中转上，供 SDK 可能残留的旧回调调用
				activeScanReceiver = (res : any) => {
					console.log('res111=>', res)
					const device = res[0];
					if (!device || !device.deviceId || !device.mac) return;

					// 过滤信号过弱的设备（< -100dBm）
					if (device.RSSI != null && device.RSSI < MIN_RSSI) return;

					// 使用 deviceId 去重，保持唯一
					tempMap.set(device.deviceId, device);

					// 将 map 转成数组，按信号强度排序（强信号在前）
					this.bleList = Array.from(tempMap.values()).sort((a, b) => b.RSSI - a.RSSI);

					// 扫满上限自动停止扫描
					if (tempMap.size >= MAX_DEVICES) {
						this.stopScan();
					}
				}
				veepooBle.veepooUniAppSDKStartScanDeviceAndReceiveScanningDevice((res : any) => {
					// SDK 可能仍持有旧闭包；统一经模块级中转，保证数据落到当前页面实例
					if (activeScanReceiver) activeScanReceiver(res);
				})
			},

			stopScan() {
				// 解绑当前接收器，防止离开页面后 SDK 残留的旧回调继续往列表里写
				activeScanReceiver = null;
				veepooBle.veepooUniAppSDKStopSearchBleManager(function (e : any) {
					console.log("停止蓝牙搜索=>", e)
				})
			},

			connectBle(e : any) {

				console.log("点击了连接");
				let self = this;
				let deviceList = self.bleList;

				if (this.connectionState) {
					return
				}
				this.connectionState = true;


				this.stopScan();

				console.log("e====>", e)
				deviceList.forEach((item : any) => {
					if (item.mac == e.mac) {
						uni.setStorageSync('bleInfo', item);
						veepooBle.veepooUniAppSDKBleConnectionServicesCharacteristicsNotifyManager(item, function (result : any) {
							console.log("result=>", result)
							if (result.connection) {
								// 获取当前服务，订阅监听
								self.notifyMonitorValueChange();
								uni.showToast({
									icon: 'success',
									title: '连接成功'
								})


								setTimeout(() => {
									let data = {
										isPair: false
									}
									veepooFeature.veepooBlePasswordCheckManager(data)
								}, 500)


								uni.navigateBack({
									delta: 1
								})

							}


						})
					}
				})
			},


			notifyMonitorValueChange() {
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e : any) {
					console.log("蓝牙回调==>", e);
				})
			},


		}
	}
</script>

<style>
	.content {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	.scan-tip {
		text-align: center;
		padding: 20rpx 0;
		color: #8f8f94;
		font-size: 28rpx;
	}

	.ble-scroll {
		flex: 1;
		width: 100%;
	}

	.logo {
		height: 200rpx;
		width: 200rpx;
		margin-top: 200rpx;
		margin-left: auto;
		margin-right: auto;
		margin-bottom: 50rpx;
	}

	.text-area {
		display: flex;
		justify-content: center;
	}

	.title {
		font-size: 36rpx;
		color: #8f8f94;
	}

	.ble_item {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 3rpx;
		border: 1px solid gray;
		padding: 16rpx;
	}
</style>