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
				<view class="section__title">灵敏等级：</view>
				<picker @change="bindPickerChange" :value="index" :range="array">
					<view class="picker">
						{{deviceLevel}}
					</view>
				</picker>
			</view>

			<view style="margin-top: 50rpx;"><button @click="startTest">开始翻腕亮屏</button></view>
			<view style="margin-top: 50rpx;"><button @click="stopTest">关闭翻腕亮屏</button></view>
			<view style="margin-top: 50rpx;"><button @click="readTest">读取翻腕亮屏</button></view>
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
				intervalTime: '30',
				deviceLevel: 5,
				array: [1, 2, 3, 4, 5, 6, 7, 8, 9]
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
			bindPickerChange(e) {
				console.log("e=>", e.detail.value)
				let array = this.array
				this.index = e.detail.value
				this.deviceLevel = array[e.detail.value]
			},
			startTest() {
				let self = this;
				let data = {
					switch: 'start',
					startTime: self.startTime,// 开始时间
					endTime: self.endTime,// 结束时间
					deviceLevel: self.deviceLevel
				}
				console.log("data==>", data)
				veepooFeature.veepooSendTurnWristBrightScreenDataManger(data);
			},
			stopTest() {
				let self = this;
				let data = {
					switch: 'stop',
					startTime: self.startTime,// 开始时间
					endTime: self.endTime,// 结束时间
					deviceLevel: self.deviceLevel
				}
				veepooFeature.veepooSendTurnWristBrightScreenDataManger(data);
			},
			readTest() {
				let self = this;
				let data = {
					switch: 'read',
					startTime: self.startTime,// 开始时间
					endTime: self.endTime,// 结束时间
					deviceLevel: self.deviceLevel
				}
				console.log("data=>", data)
				veepooFeature.veepooSendTurnWristBrightScreenDataManger(data);
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);

					if (e.type == 25) {
						self.startTime = e.content.startTime
						self.endTime = e.content.endTime
						self.deviceLevel = e.content.deviceLevel
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
