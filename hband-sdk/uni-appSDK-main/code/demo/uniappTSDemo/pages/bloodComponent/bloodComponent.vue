<template>
	<view class="box">
		<view style="margin-bottom: 15rpx;"><button @click="startTest">校准开始测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="noCalibrationStartTest">不校准开始测量</button></view>
		<view style="margin-bottom: 15rpx;"><button @click="stopTest">结束测量</button></view>
		<view>
			<text>血液值看日志</text>
			<view>进度：{{Blood.Progress}}</view>

			<view style="height: 100rpx;"></view>

			<view class="box-input">
				<view class="input-item">
					<view>尿酸值</view>
					<view><input type="text" @input="inputValue1" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
							placeholder="90-1000 u mol/L" /></view>
				</view>
				<view class="input-item">
					<view>总胆固醇</view>
					<view><input type="text" @input="inputValue2" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
							placeholder="0.01-20 u mol/L" /></view>
				</view>
				<view class="input-item">
					<view>甘油三脂</view>
					<view><input type="text" @input="inputValue3" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
							placeholder="0.01-20 u mol/L" /></view>
				</view>
				<view class="input-item">
					<view>高密度脂蛋白</view>
					<view><input type="text" @input="inputValue4" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
							placeholder="0.01-20 u mol/L" /></view>
				</view>
				<view class="input-item">
					<view>低密度脂蛋白</view>
					<view><input type="text" @input="inputValue5" style="background-color: aliceblue; padding: 0 15rpx; margin-left: 20rpx;"
							placeholder="0.01-20 u mol/L" /></view>
				</view>

				<view class="section">
					<view class="section__title">开关：</view>
					<switch :checked="deviceSwitch" @change="bindSwitchChange" />
				</view>

			</view>

			<view style="margin-bottom: 15rpx;"><button @click="startCheckTest">设置血液校准测量</button></view>
			<view style="margin-bottom: 15rpx;"><button @click="readCheckTest">读取血液校准测量</button></view>
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
				Blood: '',
				value1: 0,
				value2: 0,
				value3: 0,
				value4: 0,
				value5: 0,
				deviceSwitch: false
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			bindSwitchChange(e) {
				let self = this;
				self.deviceSwitch = e.detail.value
			},

			inputValue1(e) {
				this.value1 = e.detail.value
			},
			inputValue2(e) {
				this.value2 = e.detail.value
			},
			inputValue3(e) {
				this.value3 = e.detail.value
			},
			inputValue4(e) {
				this.value4 = e.detail.value
			},
			inputValue5(e) {
				this.value5 = e.detail.value
			},
			// veepooSendBloodGlucoseMeasurementDataManager
			startTest() {
				let data = {
					switch: 'start',
					calibration: true, // true  使用校准模式 false 不适用校准模式
				}
				veepooFeature.veepooSendBloodComponentDataManager(data);
			},
			noCalibrationStartTest() {
				let data = {
					switch: 'start',
					calibration: false, // true  使用校准模式 false 不适用校准模式
				}
				veepooFeature.veepooSendBloodComponentDataManager(data);
			},
			stopTest() {
				let data = {
					switch: 'stop',
					calibration: true, // true  使用校准模式 false 不适用校准模式
				}
				veepooFeature.veepooSendBloodComponentDataManager(data);
			},

			startCheckTest() {
				let self = this;
				let data = {
					deviceControl: 'setup',
					switch: self.deviceSwitch ? 'start' : 'stop',
					uricAcidVal: self.value1,
					cholesterol: self.value2,
					triacylglycerol: self.value3,
					highDensity: self.value4,
					lowDensity: self.value5
				}

				console.log("data=>", data);

				veepooFeature.veepooSendBloodComponentCheckDataManager(data);
			},
			readCheckTest() {
				let self = this;
				let data = {
					deviceControl: 'read',
					switch: self.deviceSwitch,
					uricAcidVal: self.value1,
					cholesterol: self.value2,
					triacylglycerol: self.value3,
					highDensity: self.value4,
					lowDensity: self.value5
				}
				console.log("data==>", data)
				veepooFeature.veepooSendBloodComponentCheckDataManager(data);
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
					self.Blood = e
				})
			},

		}
	}
</script>

<style>
	.input-item {
		padding: 0 50rpx;
		display: flex;
		margin: 30rpx 0;
	}

	.section {
		display: flex;
		line-height: 100rpx;
		margin-left: 50rpx;
	}
</style>
