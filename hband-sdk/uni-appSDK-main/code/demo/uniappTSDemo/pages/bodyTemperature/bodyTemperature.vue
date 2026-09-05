<template>
	<view class="box">
		<view class="item">体温：{{deviceInfo.content.bodyTemperature }}</view>
		<view class="item">体表温度：{{deviceInfo.content.bodySurfaceTemperature}}</view>
		<view class="item">测试进度：
			<text v-if="deviceInfo.progress">{{ deviceInfo.progress}}%</text>
		</view>
		<button class="btn" :disabled="isTest" @click="TemperatureMeasurementSwitchManager">开始测试</button>
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
				deviceInfo: {
					progress: 0,
					content: {}
				},
				isTest: false
			}
		},
		methods: {
			// onShow() {
			// 	this.notifyMonitorValueChange()
			// },
			TemperatureMeasurementSwitchManager() {
				let self = this;
				self.$set(self, 'isTest', true);
				let data = {
					switch: true
				}
				self.notifyMonitorValueChange()

				veepooFeature.veepooSendTemperatureMeasurementSwitchManager(data)

				// setTimeout(() => {
				// 	veepooFeature.veepooSendTemperatureMeasurementSwitchManager(data)
				// }, 100)

			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("体温手动测量=>", e)
					if (e.type == 6) {
						self.$set(self, 'isTest', false);
						self.$set(self, 'deviceInfo', e);
					}


				})
			},
		}
	}
</script>

<style>
	.box {
		margin: 50px;
	}

	.item {
		line-height: 80rpx;
		font-size: 18px;
	}

	.btn {
		margin-top: 50rpx;
		background-color: #a8a8a8;
		width: 100px;
		height: 35px;
		text-align: center;
		margin: 50px auto;
		font-size: 14px;
		color: white;
	}
</style>