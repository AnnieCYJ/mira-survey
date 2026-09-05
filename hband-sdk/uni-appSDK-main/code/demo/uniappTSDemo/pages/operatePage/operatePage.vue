<template>
	<view class="main-box">
		<view class="top-buttom">
			<view class="buttom" @click="skipDeviceGet()">设备扫描</view>
		</view>
		<!-- 显示设备相关信息 -->
		<view class="deviceInfo">
			<view>
				<text>设备名称：{{device.name}}</text>
			</view>
			<view>
				<text>MAC地址：{{device.mac || device.deviceId}}</text>
			</view>
			<view>
				<text>固件版本：{{device.VPDeviceVersion}}</text>
			</view>
			<view>
				<text>电池电量：<text v-if="typeof device.VPDeviceElectricPercent === 'number'">{{device.VPDeviceElectricPercent}} %</text></text>
			</view>
			<view>
				<text>实时步数：<text v-if="typeof device.step === 'number'">{{device.step}}步 </text><text v-if="typeof device.distance === 'number'"> {{device.distance}}米 </text><text v-if="typeof device.calorie === 'number'"> {{device.calorie}}千卡</text></text>
			</view>
		</view>

		<!-- 页面渲染 -->
		<view class="page-box">
			<view v-for="(item,index) in listDate" :key="item.name || index " class="page-item"
				@click="skipPages(item.path)">
				{{item.name}}
			</view>
		</view>

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

	import {
		veepooJLAuthenticationManager,
		veepooJLDisconnectDevice
	} from "../../jieli_sdk/index"
	import {
		BleDataHandler
	} from '../../jieli_sdk/lib/ble-data-handler';
	import {
		veepooJLBle
	} from "../../jieli_sdk/bleInit"
	// const vpJLBle = new veepooJLBle();
	export default {
		data() {
			return {
				pairData: {},
				bleList: [],
				device: {},
				info: {},
				connected: false,
				// 与微信小程序 Demo 首页一致的全量功能入口；path 为 uniapp 路由（/pages/X/X），
				// 其中 switchServices / Reconnect / DisconnectBluetooth / resettingTheDevice / reset
				// 为动作型入口，由下方 skipPages 内联处理而非跳转。
				listDate: [{
					name: '蓝牙重连',
					path: 'Reconnect'
				},
				{
					name: '波形',
					path: '/pages/waveform/waveform'
				},
				{
					name: '断开连接',
					path: 'DisconnectBluetooth'
				},
				{
					name: '单位设置',
					path: '/pages/unitSetting/unitSetting'
				},
				{
					name: '天气设置',
					path: '/pages/weatherForecast/weatherForecast'
				},
				{
					name: '个人信息',
					path: '/pages/personalInfo/personalInfo'
				},
				{
					name: '开关设置',
					path: '/pages/switchSetup/switchSetup'
				},
				{
					name: '日常数据',
					path: '/pages/readDailyData/readDailyData'
				},
				{
					name: '睡眠',
					path: '/pages/sleep/sleep'
				},
				{
					name: '计步',
					path: '/pages/step/step'
				},
				{
					name: '体温手动',
					path: '/pages/bodyTemperature/bodyTemperature'
				},
				{
					name: 'ECG测量',
					path: '/pages/ecgTest/ecgTest'
				},
				{
					name: 'ECG读取',
					path: '/pages/ecgRead/ecgRead'
				},
				{
					name: '身体成分',
					path: '/pages/bodyMeasurement/bodyMeasurement'
				},
				{
					name: '体温自动',
					path: '/pages/bodyTemperatureAuto/bodyTemperatureAuto'
				},
				{
					name: '联系人',
					path: '/pages/contactPerson/contactPerson'
				},
				{
					name: 'SOS',
					path: '/pages/sos/sos'
				},
				{
					name: '闹钟',
					path: '/pages/alarmClock/alarmClock'
				},
				{
					name: '运动模式',
					path: '/pages/movementPattern/movementPattern'
				},
				{
					name: '查找手机',
					path: '/pages/lookPhone/lookPhone'
				},
				{
					name: '血压',
					path: '/pages/universalBlood/universalBlood'
				},
				{
					name: '屏幕设置',
					path: '/pages/screenSetup/screenSetup'
				},
				{
					name: '心率报警',
					path: '/pages/heartRateAlarm/heartRateAlarm'
				},
				{
					name: '血液成分',
					path: '/pages/bloodComponent/bloodComponent'
				},
				{
					name: '血糖测量',
					path: '/pages/bloodGlucose/bloodGlucose'
				},
				{
					name: 'ota',
					path: '/pages/ota/ota'
				},
				{
					name: '久坐提醒',
					path: '/pages/sedentaryToast/sedentaryToast'
				},
				{
					name: '拍照',
					path: '/pages/takeAPicture/takeAPicture'
				},
				{
					name: '抬手亮屏',
					path: '/pages/brightScreen/brightScreen'
				},
				{
					name: 'ANCS开关',
					path: '/pages/ANCSToast/ANCSToast'
				},
				{
					name: '健康提醒',
					path: '/pages/healthToast/healthToast'
				},
				{
					name: '血氧自动',
					path: '/pages/bloodOxygen/bloodOxygen'
				},
				{
					name: '血氧手动测量',
					path: '/pages/bloodOxygen2/bloodOxygen2'
				},
				{
					name: '女性经期',
					path: '/pages/female/female'
				},
				{
					name: '恢复出厂',
					path: 'resettingTheDevice'
				},
				{
					name: '复位',
					path: 'reset'
				},
				{
					name: 'android编码',
					path: '/pages/androidCode/androidCode'
				},
				{
					name: 'UI风格',
					path: '/pages/uiStyle/uiStyle'
				},
				{
					name: '同步时间',
					path: '/pages/syncTime/syncTime'
				},
				{
					name: '网络表盘',
					path: '/pages/networkDial/networkDial'
				},
				{
					name: '心率测量',
					path: '/pages/heartRateTest/heartRateTest'
				},
				{
					name: '语言切换',
					path: '/pages/languagePage/languagePage'
				},
				{
					name: '读取手动测量',
					path: '/pages/manualMeasurement/manualMeasurement'
				},
				{
					name: '肤色设置',
					path: '/pages/skinColorSetting/skinColorSetting'
				},
				{
					name: '微体检',
					path: '/pages/microCheck/microCheck'
				},
				{
					name: 'B3自动测量',
					path: '/pages/b3AutoTestFeature/b3AutoTestFeature'
				},
				{
					name: 'JH58',
					path: '/pages/JH58/JH58'
				},
				{
					name: 'ZT163常灭屏',
					path: '/pages/ZT163ScreenKillFunction/ZT163ScreenKillFunction'
				},
				{
					name: '4G服务',
					path: '/pages/4GService/4GService'
				},
				{
					name: '压力测量',
					path: '/pages/pressureTest/pressureTest'
				},
				{
					name: 'YM28PRO',
					path: '/pages/YM28PROSendCommand/YM28PROSendCommand'
				},
				// 表盘相关：dial 页为早期移植，依赖较多杰里 RCSP 流程，暂保留入口注释
				// {
				// 	name: '表盘相关',
				// 	path: '/pages/dial/dial'
				// }
				],
				valData: {
					heartRate: 'start',
					bloodPressure: 'stop',
				}
			}
		},
		onShow() {
			const vpJLBle = new veepooJLBle();
			this.stopScan()
			this.getPairData();
			const bleInfo = uni.getStorageSync('bleInfo');
			console.log('读取到的蓝牙信息：', bleInfo);
			if (bleInfo) {
				this.device = {
					name: bleInfo.name || '',
					mac: bleInfo.mac || '',
					deviceId: bleInfo.deviceId || '',
					// 以下字段由连接后的 notify 回调按 type 填充（见 bleDataParses）；
					// 数值字段用 typeof 守卫而非 || ''，保留已读到的 0（onShow 重建 device 时 || '' 会把 0 当假值清空）
					VPDeviceVersion: this.device.VPDeviceVersion || '',
					VPDeviceElectricPercent: typeof this.device.VPDeviceElectricPercent === 'number' ? this.device.VPDeviceElectricPercent : '',
					step: typeof this.device.step === 'number' ? this.device.step : '',
					calorie: typeof this.device.calorie === 'number' ? this.device.calorie : '',
					distance: typeof this.device.distance === 'number' ? this.device.distance : ''
				};
				// 覆盖式订阅 notify，绑定解析器
				this.notifyMonitorValueChange();
			} else {
				console.warn('未找到蓝牙设备信息');
			};



		},

		onHide() { },

		methods: {
			setJLVerify() {
				let self = this;
				// 初始化，接受杰里数据
				BleDataHandler.init()
				let device = uni.getStorageSync('bleInfo')
				// 杰里设备认证
				setTimeout(() => {
					// 杰里设备认证
					veepooJLAuthenticationManager(device, (res) => {
						console.log("杰理认证状态==>", res)
					})
				}, 2000);
			},
			getPairData() {
				let self = this;
				let res = uni.getStorageSync('pairData');
			},
			stopScan() {
				veepooBle.veepooUniAppSDKStopSearchBleManager(function (e) {
					console.log("停止蓝牙搜索=>", e)
				})
			},
			skipDeviceGet() {
				// console.log("a")
				uni.navigateTo({
					url: '/pages/index/index',
				})

			},
			// 跳转相关页面
			skipPages(e) {
				let path = e;
				let self = this;
				console.log(path)
				if (path == 'DisconnectBluetooth') {
					veepooFeature.veepooSendDisconnectBluetoothDataManager()
					return
				}
				if (path == 'resettingTheDevice') {
					veepooFeature.veepooSendResettingTheDeviceDataManager()
					return
				}
				if (path == 'reset') {
					veepooFeature.veepooSendResetDataManager()
					return
				}

				if (path == 'switchServices') {

					// 获取存储的蓝牙信息
					const device = uni.getStorageSync('bleInfo');

					// 交接服务（让 SDK 接管当前链路、发现服务）
					veepooBle.veepooUniAppSDKHandoverServiceManager({
						deviceId: device.deviceId
					}, (res) => {
						console.log("交接服务res=>", res)
					});

					return
				}

				if (path == "Reconnect") {
					let item = uni.getStorageSync('bleInfo');
					veepooBle.veepooUniAppSDKBleReconnectDeviceManager(item, function (result) {
						console.log('蓝牙重连result=>', result);
						// 获取当前服务，订阅监听
						self.notifyMonitorValueChange();
						// 蓝牙密码核准
						veepooFeature.veepooBlePasswordCheckManager({
							isPair: false
						});
					})
					return
				}


				// switchServices
				// Reconnect

				uni.navigateTo({
					url: path,
				})
			},
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log("蓝牙回调==>", e);
					self.bleDataParses(e);
				})
			},
			// 解析蓝牙监听返回数据，按 type 填充设备信息（参考 demo 首页 bleDataParses）
			bleDataParses(value) {
				if (!value) return;
				let device = this.device;
				if (value.type == 1) {
					// 蓝牙密码核准：固件版本、MAC
					device.VPDeviceVersion = value.content.VPDeviceVersion;
					device.VPDeviceMAC = value.content.VPDeviceMAC;
					this.ElectricQuantityManager();
					setTimeout(()=>{
						this.StepCalorieDistanceManager();
					}, 300)
				} else if (value.type == 2) {
					// 电池电量
					device.VPDeviceElectricPercent = value.content.VPDeviceElectricPercent;
				} else if (value.type == 9) {
					// 实时计步、距离、卡路里
					device.step = value.content.step;
					device.calorie = value.content.calorie;
					device.distance = value.content.distance;
				}
			},
			// 读取电池电量
			ElectricQuantityManager() {
				console.log("读取电量")
				veepooFeature.veepooReadElectricQuantityManager();
			},
			// 读取实时步数、卡路里、距离（day: 0 今天 1 昨天 2 前天）
			StepCalorieDistanceManager() {
				console.log("读取步数")
				veepooFeature.veepooReadStepCalorieDistanceManager({
					day: 0
				});
				// 非今天数据，步数等数据已归档，建议从日常数据中汇总计算
			},

		}
	}
</script>

<style>
	page {
		background-color: #efeff4;
	}

	.main-box {
		padding: 25rpx;

	}

	.buttom {
		background-color: #686868;
		height: 80rpx;
		width: 100%;
		text-align: center;
		line-height: 80rpx;
		font-size: 16px;
		color: #00b0fb;
	}

	.buttom-active {
		color: #999999;
	}

	.top-buttom {
		display: flex;
		justify-content: space-between;
	}

	.deviceInfo {
		background: white;
		margin-top: 20rpx;
		line-height: 70rpx;
		font-size: 16px;
		padding: 0 15rpx;
		box-sizing: border-box;
	}

	.page-box {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.page-item {
		width: 23%;
		background-color: #a8a8a8;
		margin-top: 20rpx;
		height: 80rpx;
		text-align: center;
		line-height: 80rpx;
		font-size: 12px;
		color: white;
	}

	.active {
		color: #00b0fb;
	}
</style>