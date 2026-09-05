<template>
	<view class="box">
		<view style="padding: 50rpx;" class="box-item">
			<view><input style="padding: 10rpx; background-color: aliceblue; margin-bottom: 30rpx;" @input="value1"
					type="text" placeholder="最大心率" /></view>
			<view><input style="padding: 10rpx; background-color: aliceblue; margin-bottom: 30rpx;" @input="value2"
					type="text" placeholder="最小心率" /></view>

			<button style="margin-bottom: 20rpx;" @click="setHeartRateAlarm">设置心率报警</button>
			<button style="margin-bottom: 20rpx;" @click="stopHeartRateAlarm">关闭心率报警</button>
			<button style="margin-bottom: 20rpx;" @click="readHeartRateAlarm">读取心率报警</button>
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
				// 注：原 WeChat 源把 data 字段命名为 value1/value2，与方法重名。
				// Vue Options API 中 data 与 methods 同处一个 this，重名会冲突，
				// 因此把 data 字段重命名为语义更清晰的 maxHeartRate/minHeartRate。
				maxHeartRate: 100,
				minHeartRate: 40
			}
		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		onHide() {

		},
		onUnload() {

		},
		methods: {
			value1(e) {
				this.maxHeartRate = e.detail.value
			},
			value2(e) {
				this.minHeartRate = e.detail.value
			},
			setHeartRateAlarm() {
				let data = {
					maxHeartRate: this.maxHeartRate,
					minHeartRate: this.minHeartRate,
					switch: 'start',

				}
				veepooFeature.veepooSendHeartRateAlarmIntervalDataManager(data);
			},
			stopHeartRateAlarm() {
				let data = {
					maxHeartRate: '',
					minHeartRate: '',
					switch: 'stop',

				}
				veepooFeature.veepooSendHeartRateAlarmIntervalDataManager(data)
			},
			readHeartRateAlarm() {
				let data = {
					maxHeartRate: '',
					minHeartRate: '',
					switch: 'read',

				}
				veepooFeature.veepooSendHeartRateAlarmIntervalDataManager(data)
			},


			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("  监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	/* pages/heartRateAlarm/index.wxss */
</style>
