<template>
	<!--pages/YM28PROSendCommand/index.wxml-->
	<view>

		<button style="margin-top: 20px;" @click="readCurrentDevState">读取当前设备数据情况</button>


		<view class="section">
			<picker @change="bindPickerChange1" :value="index" :range="bloodPressureSwitchArray">
				<view class="picker">
					血压开关：{{bloodPressureSwitchArray[index]}}
				</view>
			</picker>
		</view>
		<view class="input">
			<text>白天间隔：</text>
			<input type="number" name="height" placeholder="传入要求[15/20/30/60]" @input="inputChange" />
			<text>默认30</text>
		</view>
		<view class="input">
			<text>夜间间隔：</text>
			<input type="number" name="height" placeholder="传入要求[30/60]" @input="inputChange1" />
			<text>默认60</text>
		</view>
		<view class="section">
			<picker mode="time" :value="nightRangeStartTime" @change="bindPickerChange2">
				<view class="picker">
					夜间范围开始时间选择: {{nightRangeStartTime}}
				</view>
			</picker>
		</view>
		<view class="section">
			<picker mode="time" :value="nightRangeEndTime" @change="bindPickerChange3">
				<view class="picker">
					夜间范围结束时间选择: {{nightRangeEndTime}}
				</view>
			</picker>
		</view>

		<button style="margin-top: 20px;" @click="setupCommandData">下发数据</button>
		<view style="padding: 20px;">
			<view>当前SN码：{{SNCode}}</view>
		</view>
		<button style="margin-top: 20px;" @click="readSNCode">读取SN码</button>
	</view>
</template>

<script>
	// pages/YM28PROSendCommand/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js';

	export default {
		data() {
			return {
				bloodPressureSwitch: 'close',
				dayTimeGap: 10,
				nightTimeGap: 10,
				nightRangeStartTime: '11:45',
				nightRangeEndTime: '14:19',
				index: 1,
				bloodPressureSwitchArray: ['open', 'close'],
				content: {},
				SNCode: '',
			}
		},

		onLoad() {},

		onShow() {
			let timestamp = Date.now();
			let date = new Date(timestamp);
			let hours = String(date.getHours()).padStart(2, '0');
			let minutes = String(date.getMinutes()).padStart(2, '0');
			this.nightRangeStartTime = `${hours}:${minutes}`
			this.nightRangeEndTime = `${hours}:${minutes}`

			this.notifyMonitorValueChange();
		},

		methods: {
			// 读取当前设备数据情况
			readCurrentDevState() {
				console.log('触发了读取当前设备数据情况')
				let data = {
					switch: 'read'
				}
				veepooFeature.veepooSetupSendYM28PROCommandManager(data);
			},

			// 下发数据
			setupCommandData() {
				console.log('触发下发数据操作')
				let data = {
					switch: 'setup',
					content: {
						bloodPressureSwitch: this.bloodPressureSwitchArray[this.index],
						dayTimeGap: this.dayTimeGap,
						nightTimeGap: this.nightTimeGap,
						nightRangeStartTime: this.nightRangeStartTime,
						nightRangeEndTime: this.nightRangeEndTime,
					}
				}
				console.log('下发数据传入参数=>', data.content);
				veepooFeature.veepooSetupSendYM28PROCommandManager(data);
			},

			// 读取SN码
			readSNCode() {
				console.log('触发读取SN码操作')
				let data = {
					switch: 'readSN'
				}
				veepooFeature.veepooSetupSendYM28PROCommandManager(data);
			},

			// 选择血压开关模式
			bindPickerChange1: function (e) {
				console.log('picker1发送选择改变，携带值为', e.detail.value)
				this.index = e.detail.value
			},
			// 夜间范围开始时间选择
			bindPickerChange2: function (e) {
				console.log('picker2发送选择改变，携带值为', e.detail.value)
				this.nightRangeStartTime = e.detail.value
			},
			// 夜间范围结束时间选择
			bindPickerChange3: function (e) {
				console.log('picker3发送选择改变，携带值为', e.detail.value)
				this.nightRangeEndTime = e.detail.value
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let that = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log(" YM28PRO设置数据读取及下发 监听蓝牙回调=>", e);
					if (e.type == 58) {
						if (e.control == '1' || e.control == '2') {
							that.content = e.content
						} else if (e.control == '3') {
							that.SNCode = e.SNCode
						}
					}
				})
			},

			// 获取白天时间间隔
			inputChange(e) {
				console.log('e=>', e)
				this.dayTimeGap = Number(e.detail.value)
			},

			// 获取夜间时间间隔
			inputChange1(e) {
				console.log('e=>', e)
				this.nightTimeGap = Number(e.detail.value)
			},
		}
	}
</script>

<style>
	/* pages/YM28PROSendCommand/index.wxss */
	.box-input {
		padding: 20rpx 50rpx;
	}

	.input {
		display: flex;
		height: 40px;
		line-height: 40px;
		align-items: center;
	}

	input {
		background-color: #e7e7e7;
	}

</style>
