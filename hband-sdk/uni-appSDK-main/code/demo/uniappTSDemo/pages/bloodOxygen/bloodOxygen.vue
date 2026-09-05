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
				<view class="section__title">开关：</view>
				<switch :checked="deviceSwitch" @change="bindSwitchChange" />
			</view>

			<view style="margin-top: 50rpx;"><button @click="startTest">设置血氧自动检测</button></view>
			<view style="margin-top: 50rpx;"><button @click="readTest">读取血氧自动检测</button></view>


			<view style="line-height: 100rpx;">读取血氧全天数据   :根据手环功能包，查看， 不同的类型血氧数据不同，常见的在日常数据</view>
			<view class="box-day">
				<view class="day-item" @click="readAllDayTest(0)">今天</view>
				<view class="day-item" @click="readAllDayTest(1)">昨天</view>
				<view class="day-item" @click="readAllDayTest(2)">前天</view>
			</view>
			<view class="box-data">
				<view>读取进度：{{device.Progress}}</view>
				<view>
					<view class="data-item" v-for="(item,index) in device.content" :key="index">
						<text>时间：{{item.time}}</text>
					</view>
				</view>
			</view>
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
				index: 0,
				deviceType: '',
				// 必须预置 content（数组），否则 {{device.Progress}} 与 v-for="item in device.content" 在 Vue3 下会因 device 为 null 抛错导致整页空白
				device: {
					Progress: 0,
					content: []
				}
			}
		},
		onLoad() {

		},
		// startTime
		// endTime
		// intervalTime
		// valSwitch
		// deviceControl
		// deviceType
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

			bindSwitchChange(e) {
				let self = this;
				self.deviceSwitch = e.detail.value
			},

			startTest() {
				let self = this;

				let data = {
					switch: self.deviceSwitch ? 'start' : 'stop', // 开关  start  开启  stop 关闭
					startTime: self.startTime, // 开始时间
					endTime: self.endTime, // 结束时间
					deviceControl: 'setup', // setup 设置 read 读取
				}
				console.log("data=>", data)
				veepooFeature.veepooSendBloodOxygenAutoTestDataManager(data);

			},

			readAllDayTest(index) {
				let data = {
					day: index, // 0 今天  1 昨天 2 前天
					package: '1'
				}
				console.log("data==>", data)
				veepooFeature.veepooSendReadAllDayBloodOxygenDataManager(data);
			},

			readTest() {
				let self = this;

				let data = {
					switch: self.deviceSwitch ? 'start' : 'stop',
					startTime: self.startTime, // 开始时间
					endTime: self.endTime, // 结束时间
					deviceControl: 'read'
				}

				console.log("data=>", data)

				veepooFeature.veepooSendBloodOxygenAutoTestDataManager(data);

			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);

					if (e.type == 29) {
						self.startTime = e.content.startTime
						self.endTime = e.content.endTime
						self.deviceSwitch = e.content.switch
					}

					if (e.type == 30) {
						self.device = e
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

	.box-day {
		font-size: 14px;
		margin: 30rpx auto;
		text-align: center;
		display: flex;
		justify-content: space-around;
	}

	.day-item {
		width: 25%;
		height: 70rpx;
		line-height: 70rpx;
		color: white;
		border-radius: 15rpx;
		background-color: #a8a8a8;
	}

	.box-data {
		padding: 15rpx 30rpx;
	}

	.data-item {
		line-height: 30px;
	}
</style>
