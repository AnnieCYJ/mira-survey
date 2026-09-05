<template>
	<view>

		<button style="margin-top: 20px;" @click="heartRateStart" :disabled="isMeasuring">开始测量</button>
		<button style="margin-top: 20px;" @click="heartRateStop" :disabled="!isMeasuring">结束测量</button>

		<view style="padding: 20px;">
			<view>当前心率：{{heartRate}} bpm</view>
			<view v-if="statusMsg" style="color: #07c160; margin-top: 10px;">{{statusMsg}}</view>
			<view v-if="errorMsg" style="color: #fa5151; margin-top: 10px;">{{errorMsg}}</view>
			<view v-if="isMeasuring" style="color: #10aeff; margin-top: 10px;">正在测量中...</view>
		</view>
	</view>
</template>

<script>
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
	export default {
		data() {
			return {
				heartRate: '--', // 心率值，初始显示为 --
				isMeasuring: false,
				statusMsg: '', // 状态信息
				errorMsg: '' // 错误信息
			}
		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		onHide() {
			// 页面隐藏时可以停止监听
		},
		onUnload() {
			// 页面卸载时停止测量
			if (this.isMeasuring) {
				this.heartRateStop();
			}
		},
		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("[心率测量] 蓝牙回调=>", e);

					// type 51 为心率测量数据类型
					if (e.type == 51) {
						self.handleHeartRateCallback(e);
					}
				})
			},

			// 处理心率测量回调
			handleHeartRateCallback(e) {
				let self = this;
				const content = e.content || {};

				// 1. 优先判断设备是否正忙
				if (content.deviceBusy === true) {
					self.isMeasuring = false;
					self.errorMsg = '设备正忙，请稍后再试';
					self.statusMsg = '';
					console.log("[心率测量] 设备正忙");
					return;
				}

				// 2. 判断佩戴检测是否通过
				if (content.notWear === true) {
					self.isMeasuring = false;
					self.errorMsg = '佩戴检测未通过，请正确佩戴设备';
					self.statusMsg = '';
					console.log("[心率测量] 佩戴检测未通过");
					return;
				}

				// 3. 获取心率值并校验有效范围 [30, 250]
				const heartRate = content.heartRate;
				if (typeof heartRate !== 'number' || heartRate < 30 || heartRate > 250) {
					console.log("[心率测量] 心率值无效:", heartRate);
					// 不在有效范围内，过滤该结果
					return;
				}

				// 心率值有效，更新显示
				self.heartRate = heartRate;
				self.isMeasuring = false;
				self.errorMsg = '';
				self.statusMsg = '正在测量...';
				console.log("[心率测量] 正在测量...，心率值:", heartRate);
			},

			// 开始心率测量
			heartRateStart() {
				let self = this;

				// 重置状态
				self.isMeasuring = true;
				self.heartRate = '--';
				self.statusMsg = '正在测量...';
				self.errorMsg = '';

				// 发送开始心率测量指令
				veepooFeature.veepooSendHeartRateTestSwitchManager({
					switch: true
				});
				console.log("[心率测量] 开始测量");
			},

			// 停止心率测量
			heartRateStop() {
				let self = this;

				self.isMeasuring = false;
				self.statusMsg = '';

				// 发送停止心率测量指令
				veepooFeature.veepooSendHeartRateTestSwitchManager({
					switch: false
				});
				console.log("[心率测量] 停止测量");
			}
		}
	}
</script>

<style>
	/* pages/heartRateTest/index.wxss */
</style>
