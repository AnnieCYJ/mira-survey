<template>
	<view class="box">
		<view class="startTime">
			<view class="section">
				<view class="section__title">开始时间：</view>
				<picker mode="time" :value="startTime" start="00:00" end="23:59" @change="bindStartTimeChange">
					<view class="picker">
						{{startTime}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">结束时间：</view>
				<picker mode="time" :value="endTime" start="00:00" end="23:59" @change="bindStopTimeChange">
					<view class="picker">
						{{endTime}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">时间间隔：</view>
				<view style="height: 60rpx; margin-top: 25rpx; background-color: aliceblue;"><input @input="changeIntervalTime" :value="intervalTime" type="text" placeholder="30-240分钟" /></view>
			</view>

			<view style="margin-top: 50rpx;"><button @click="startTest">开始久坐</button></view>
			<view style="margin-top: 50rpx;"><button @click="stopTest">关闭久坐</button></view>
			<view style="margin-top: 50rpx;"><button @click="readTest">读取久坐</button></view>
		</view>

	</view>
</template>

<script>
	// 引入方式二：
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {
				startTime: '00:00',
				endTime: '00:00',
				deviceSwitch: false,
				intervalTime: '30'
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			bindStartTimeChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.startTime = e.detail.value
			},
			bindStopTimeChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.endTime = e.detail.value
			},
			changeIntervalTime(e) {
				let self = this;
				self.intervalTime = e.detail.value
			},
			startTest() {
				let self = this;
				let data = {
					switch: 'start',
					startTime: self.startTime,// 开始时间
					endTime: self.endTime,// 结束时间
					intervalTime: self.intervalTime//间隔时间
				}
				if (!data.startTime) {
					uni.showToast({
						title: '请添加开始时间',
						icon: 'none'
					})
					return
				} else if (!data.endTime) {
					uni.showToast({
						title: '请添加结束时间',
						icon: 'none'
					})
					return
				}
				console.log("data=>", data)
				veepooFeature.veepooSendSetupSedentaryToastTimeDataManager(data);
			},
			stopTest() {
				let self = this;
				let data = {
					switch: 'stop',
					startTime: self.startTime,// 开始时间
					endTime: self.endTime,// 结束时间
					intervalTime: self.intervalTime//间隔时间
				}
				if (!data.startTime) {
					uni.showToast({
						title: '请添加开始时间',
						icon: 'none'
					})
					return
				} else if (!data.endTime) {
					uni.showToast({
						title: '请添加结束时间',
						icon: 'none'
					})
					return
				}
				console.log("data=>", data)
				veepooFeature.veepooSendSetupSedentaryToastTimeDataManager(data);
			},
			readTest() {
				let self = this;
				let data = {
					switch: 'read',
				}

				console.log("data=====", data)
				veepooFeature.veepooSendSetupSedentaryToastTimeDataManager(data);
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
					let content = e.content;

					if (e.type == 23) {
						self.startTime = content.startTime
						self.endTime = content.endTime
						self.intervalTime = content.intervalTime
						self.deviceSwitch = content.deviceControl
						console.log("content=>", content)
						console.log("endTime=>", self.endTime)
					}

				})
			},
		}
	}
</script>

<style>
	.box {
		padding: 50rpx;
	}

	.section {
		display: flex;
		line-height: 100rpx;
	}
</style>
