<template>
	<view class="box">
		<view style="margin-bottom: 15rpx;"><button @click="startTest">校准开始测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="noCalibrationStartTest">不校准开始测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopTest">结束测量</button></view>
		<view>
			<view>进度：{{bloodGlucoseData.Progress}}</view>
			<view>血糖：{{bloodGlucoseData.content.bloodGlucose}}</view>
		</view>

		<view style="margin: 40rpx; ">设置校准</view>

		<view class="input-item" style="display: flex; margin-bottom: 40rpx;">
			<view>血糖校准值：</view>
			<view><input type="text" @input="inputValue1" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
					placeholder="3-15" /></view>
		</view>
		<view>
			校准开关
			<switch :checked="verifySwitch" @change="bindVerifySwitch" />
		</view>
		<view style="margin-bottom: 15rpx;"><button @click="startBloodVerify">设置血糖校准</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopBloodVerify">读取血糖校准</button></view>
		<view>设置的血糖：{{bloodGlucoseData.content.bloodGlucoseValue}}</view>

		<view>六个血糖值在代码内部进行更改</view>
		<view style="margin-bottom: 15rpx;"><button @click="startBloodSixVerify">设置血糖6个校准</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopBloodSixVerify">读取血糖6个校准</button></view>
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
				// 必须预置 content，否则 {{bloodGlucoseData.content.bloodGlucose}} 在 Vue3 下会因 content 为 undefined 抛错导致整页空白
				bloodGlucoseData: {
					Progress: 0,
					content: {}
				},
				value1: 3,
				verifySwitch: false
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			bindVerifySwitch(e) {
				console.log('e==>', e);
				let val = e.detail.value
				let self = this;
				self.verifySwitch = val
			},

			// veepooSendBloodGlucoseMeasurementDataManager
			startTest() {
				let data = {
					switch: 'start',
					calibration: true, // true 开启校准模式  false 关闭校准模式
				}
				veepooFeature.veepooSendBloodGlucoseMeasurementDataManager(data);
			},

			inputValue1(e) {
				this.value1 = e.detail.value
			},
			noCalibrationStartTest() {
				let data = {
					switch: 'start',
					calibration: false, // true 开启校准模式  false 关闭校准模式
				}
				veepooFeature.veepooSendBloodGlucoseMeasurementDataManager(data);
			},
			stopTest() {
				let data = {
					switch: 'stop',
					calibration: true, // true 开启校准模式  false 关闭校准模式
				}
				veepooFeature.veepooSendBloodGlucoseMeasurementDataManager(data);
			},

			// 设置
			startBloodVerify() {
				// 注意：每次发送都需要将血糖转换为 mmol/L
				// mg/dl  转mmol/L 公式：血糖水平（mg/dl）= 血糖水平（mmol/L）× 18   血糖水平（mmol/L）= 血糖水平（mg/dl）/ 18
				let verifySwitch = this.verifySwitch;
				let data = {
					deviceControl: 'setup', // setup 设置  read 读取
					switch: verifySwitch ? 'start' : 'stop', // start 开启  stop 关闭
					bloodGlucoseValue: this.value1
				}
				console.log("data=>", data)
				veepooFeature.veepooSendBloodGlucoseCalibrateModuleDataManager(data);
			},
			// 读取
			stopBloodVerify() {
				let verifySwitch = this.verifySwitch;
				let data = {
					deviceControl: 'read', // setup 设置  read 读取
					switch: verifySwitch ? 'start' : 'stop', // start 开启  stop 关闭
					bloodGlucoseValue: this.value1
				}
				console.log("data=>", data)
				veepooFeature.veepooSendBloodGlucoseCalibrateModuleDataManager(data);
			},
			stopBloodSixVerify() {
				/*
				beforeBreakfast
				afterBreakfast
				beforeLunch
				afterLunch
				beforeDinner
				afterDinner
				*/
				let data = {
					conSwitch: 'start',
					switch: 'read', // setup 开启 read 关闭
				}
				veepooFeature.veepooSendSixBloodGlucoseCalibrateValueDataManager(data);
			},


			startBloodSixVerify() {
				let data = {
					conSwitch: 'start', // start 开启  stop 关闭
					switch: 'setup', // setup 设置 read 读取
					beforeBreakfast: {
						hour: '07',
						minute: '05',
						bloodGlucoseValue: 8.2
					},
					afterBreakfast: {
						hour: '10',
						minute: '55',
						bloodGlucoseValue: 8.2
					},
					beforeLunch: {
						hour: '14',
						minute: '00',
						bloodGlucoseValue: 8.2
					},
					afterLunch: {
						hour: '15',
						minute: '13',
						bloodGlucoseValue: 9.2
					},
					beforeDinner: {
						hour: '21',
						minute: '50',
						bloodGlucoseValue: 8.2
					},
					afterDinner: {
						hour: '21',
						minute: '46',
						bloodGlucoseValue: 8.2
					}
				}
				// uni.navigateBack()
				veepooFeature.veepooSendSixBloodGlucoseCalibrateValueDataManager(data);
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
					if (e.type) {
						self.bloodGlucoseData = e
					}
				})
			},
		}
	}
</script>

<style>
	/* pages/bloodGlucose/index.wxss */
</style>
