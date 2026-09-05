<template>
	<view class="box">
		<view class="tongyong-blood">

			<view style="line-height: 70rpx;">进度：{{univerData.Progress}}</view>
			<view style="line-height: 70rpx;">高压：{{univerData.content.bloodPressureHigh}}</view>
			<view style="line-height: 70rpx;">低压：{{univerData.content.bloodPressureLow}}</view>
		</view>
		<view style="margin-bottom: 15rpx;"><button @click="startTest">开启通用血压测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopTest">关闭通用血压测量</button></view>

		<view style="padding: 20px;">
			<view><input style="padding: 10rpx; background-color: aliceblue; margin-bottom: 30rpx;" @input="value1"
					type="text" placeholder="高压" /></view>
			<view><input style="padding: 10rpx; background-color: aliceblue; margin-bottom: 30rpx;" @input="value2"
					type="text" placeholder="低压" /></view>
		</view>
		<view style="margin-bottom: 15rpx;"><button @click="startBlood">设置私人血压定制</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopBlood">关闭血压私人定制</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="readBlood">读取血压私人定制</button></view>

		<view style="height: 50rpx;"></view>
		<view style="margin-bottom: 15rpx;"><button @click="startPrivateTest">开启血压私人测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopPrivateTest">关闭血压私人测量</button></view>

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
				// 必须预置 content，否则 {{univerData.content.bloodPressureHigh}} 在 Vue3 下会因 content 为 undefined 抛错导致整页空白
				univerData: {
					Progress: 0,
					content: {}
				},
				high: 0,
				low: 0
			}
		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			startPrivateTest() {
				let data = {
					switch: 'start'
				}
				veepooFeature.veepooSendPrivateBloodPressureStupDataManager(data);
			},
			stopPrivateTest() {
				let data = {
					switch: 'stop'
				}
				veepooFeature.veepooSendPrivateBloodPressureStupDataManager(data);
			},

			startTest() {
				let data = {
					switch: 'start'
				}
				veepooFeature.veepooSendReadUniversalBloodPressureDataManager(data);
			},

			stopTest() {
				let data = {
					switch: 'stop'
				}
				veepooFeature.veepooSendReadUniversalBloodPressureDataManager(data);
			},

			startBlood() {
				let self = this;
				let data = {
					switch: 'start',
					bloodPressureHigh: self.high,
					bloodPressureLow: self.low
				}
				console.log('data==>', data)
				veepooFeature.veepooSendBloodPressurePrivateDataManager(data)
			},

			stopBlood() {
				let self = this;
				let data = {
					switch: 'stop',
					bloodPressureHigh: self.high,
					bloodPressureLow: self.low
				}
				veepooFeature.veepooSendBloodPressurePrivateDataManager(data)
			},

			readBlood() {
				let data = {
					switch: 'read',
					bloodPressureHigh: '0',
					bloodPressureLow: '0'
				}
				veepooFeature.veepooSendBloodPressurePrivateDataManager(data)
			},
			value1(e) {
				let self = this;
				self.high = e.detail.value
			},
			value2(e) {
				let self = this;
				self.low = e.detail.value
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
					if (e.type == 18) {
						self.univerData = e
					}
					if (e.type == 28) {

					}
				})
			},
		}
	}
</script>

<style>
	.tongyong-blood {
		padding-left: 20px;
	}
</style>
