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
				<view class="section__title">功能类型：</view>
				<picker @change="bindPickerChange" :value="index" :range="array">
					<view class="picker">
						{{array[index]}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">时间间隔：</view>
				<view style="height: 60rpx; margin-top: 25rpx; background-color: aliceblue;">
					<input @input="changeIntervalTime" :value="intervalTime" type="text" placeholder="30-240分钟" />
				</view>
			</view>
			<view class="section">
				<view class="section__title">开关：</view>
				<switch :checked="deviceSwitch" @change="bindSwitchChange" />
			</view>
			<text>目前测试手环只有久坐和喝水，其他功能暂不支持</text>

			<view style="margin-top: 50rpx;"><button @click="startTest">设置健康提醒功能</button></view>
			<view style="margin-top: 50rpx;"><button @click="readTest">读取健康提醒功能</button></view>
		</view>

	</view>
</template>

<script>
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
				array: ['所有', '久坐', '喝水', '远眺', '运动', '吃药', '看书', '出行', '洗手'], // 目前只有就做和喝水
				index: 0,
				deviceType: '',
			}
		},
		onLoad() {

		},
		onReady() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			// startTime
			// endTime
			// intervalTime
			// valSwitch
			// deviceControl
			// deviceType
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
				this.deviceType = array[e.detail.value]
			},
			bindSwitchChange(e) {
				let self = this;
				self.deviceSwitch = e.detail.value
			},

			startTest() {
				let self = this;
				let data = {
					switch: self.deviceSwitch ? 'start' : 'stop',
					startTime: self.startTime, // 开始时间
					endTime: self.endTime, // 结束时间
					intervalTime: self.intervalTime, //间隔时间
					deviceControl: 'setup',
					deviceType: self.deviceType
				}

				console.log("data==>", data)
				veepooFeature.veepooSendHealthToastFeatureDataManager(data);
			},
			stopTest() {
				let self = this;
				let data = {
					deviceControl: 'read',
				}
				console.log("data=>", data)
				veepooFeature.veepooSendHealthToastFeatureDataManager(data);
			},
			readTest() {
				let self = this;
				let data = {
					deviceControl: 'read',
				}
				veepooFeature.veepooSendHealthToastFeatureDataManager(data);
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
