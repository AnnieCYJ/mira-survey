<template>
	<view>
		<view class="box-btn">
			<button @click="ReadAlarmClockDataManager">读取文字闹钟</button>
		</view>
		<view style="margin: 50rpx 30rpx;">
			<view class="ItemInput">
				<view>闹钟ID：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getId" type="text" placeholder="填写闹钟ID" /></view>
			</view>
			<view class="ItemInput">
				<view>闹钟时间：</view>
				<picker mode="time" :value="startTime" start="00:00" end="23:59" @change="bindStartTimeChange">
					<view class="picker">
						{{startTime}}
					</view>
				</picker>
			</view>
			<view class="ItemInput">
				<view>闹钟标签：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getLabel" type="text" placeholder="填写闹钟标签" /></view>
			</view>
			<view class="ItemInput">
				<view>是否开启：</view>
				<switch :checked="alarmSwitch" @change="getalarmSwitch" />
			</view>
		</view>
		<view class="box-btn">
			<button @click="SetAlarmClockDataManager">设置文字闹钟</button>
		</view>

		<view style="margin: 50rpx 30rpx;">
			<view class="ItemInput">
				<view>删除闹钟的ID：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="deleteAlId" type="text" placeholder="删除闹钟的ID" /></view>
			</view>

		</view>
		<view class="box-btn">
			<button @click="deleteAlarmClockDataManager">删除文字闹钟</button>
		</view>
		<view style="margin: 50rpx 30rpx;">
			<view class="ItemInput">
				<view>闹钟ID：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="UPgetId" type="text" placeholder="填写闹钟ID" /></view>
			</view>
			<view class="ItemInput">
				<view>闹钟时间：</view>
				<picker mode="time" :value="UPstartTime" start="00:00" end="23:59" @change="UPbindStartTimeChange">
					<view class="picker">
						{{UPstartTime}}
					</view>
				</picker>
			</view>
			<view class="ItemInput">
				<view>是否开启：</view>
				<switch :checked="UPalarmSwitch" @change="UPgetalarmSwitch" />
			</view>
		</view>

		<view class="box-btn">
			<button @click="updateAlarmClockDataManager">修改文字闹钟</button>
		</view>

		<view style="margin: 50rpx 20rpx;">

			<view class="Item" style="border-bottom: 1px solid rgb(214, 214, 214); margin-bottom: 30rpx;" v-for="(item, index) in alarmList" :key="index">
				<view>闹钟ID：{{item.alarmId}}</view>
				<view>闹钟时间：{{item.time}}</view>
				<view>闹钟开关：{{item.alarmSwitch}}</view>
			</view>

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
				index: 1,
				startTime: '00:00',
				alarmSwitch: false,
				alarmId: '',
				deleteAlarmId: '',
				UPstartTime: '00:00',
				UPalarmSwitch: false,
				UPalarmId: '',
				alarmList: [],
				lable: ""
			}
		},
		onLoad(options) {
			let check = [0xB9, 0x02, 0x01, 0x01, 0xA0, 0x02, 0x60, 0x55, 0xA1, 0x12, 0xB1, 0x08, 0x02, 0x01, 0x21, 0x09, 0x2E, 0x00, 0x00, 0x00, 0xB2, 0x06, 0xE5, 0x93, 0x88, 0xE5, 0x93, 0x88]


			let arr = [160, 33, 0, 161, 1, 1, 162, 9, 233, 153, 136, 230, 152, 190, 230, 150, 135, 163, 11, 49, 53, 50, 56, 57, 53, 57, 54, 50, 52, 50, 164, 1, 1];
			// ["b9", "02", "01", "01", "a0", "02", "07", "bc", "a1", "24", "b1", "08", "03", "01", "1f", "15", "00", "00", "00", "00", "b2", "18", "e6", "96", "87", "e5", "ad", "97", "e9", "97", "b9", "e9", "92", "9f", "e6", "b5", "8b", "e8", "af", "95", "e6", "a0", "87", "e7", "ad", "be"];

			let hex = [];
			for (let i = 0; i < arr.length; i++) {
				let item = arr[i];
				hex.push(item.toString(16).padStart(2, '0'))
			}
			console.log("hex====>", hex);
			this.notifyMonitorValueChange();
		},
		onShow() {

		},
		methods: {
			// 读取
			ReadAlarmClockDataManager() {
				veepooFeature.veepooSendReadAlarmClockDataManager();
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" ss 监听蓝牙回调=>", e);
					self.alarmList = e.content
				})
			},
			bindStartTimeChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.startTime = e.detail.value
			},
			getId(e) {
				let alarmId = e.detail.value;
				this.alarmId = alarmId
			},
			getLabel(e) {
				let lable = e.detail.value;
				this.lable = lable
			},
			getalarmSwitch(e) {
				let alarmSwitch = e.detail.value;
				this.alarmSwitch = alarmSwitch
			},
			UPbindStartTimeChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.UPstartTime = e.detail.value
			},
			UPgetId(e) {
				let UPalarmId = e.detail.value;
				this.UPalarmId = UPalarmId
			},
			UPgetalarmSwitch(e) {
				let UPalarmSwitch = e.detail.value;
				this.UPalarmSwitch = UPalarmSwitch
			},
			deleteAlId(e) {
				let deleteAlarmId = e.detail.value;
				this.deleteAlarmId = deleteAlarmId
			},
			deleteAlarmClockDataManager() {
				let data = {
					alarmId: this.deleteAlarmId,
					switch: true,
					time: '08:00',
					alarmRepeat: {
						"Monday": true,
						"Tuesday": true,
						"Wednesday": true,
						"Thursday": true,
						"Friday": true,
						"Saturday": false,
						"Sunday": false
					}
				}
				veepooFeature.veepooSendDeleteAlarmClockDataManager(data);
			},
			SetAlarmClockDataManager() {
				let data = {
					alarmId: this.alarmId,
					switch: this.alarmSwitch,
					time: this.startTime,
					alarmRepeat: {
						"Monday": true,
						"Tuesday": true,
						"Wednesday": true,
						"Thursday": true,
						"Friday": true,
						"Saturday": false,
						"Sunday": false
					},
					name: this.lable
				}
				console.log("data=>", data)
				veepooFeature.veepooSendSetAlarmClockDataManager(data);
			},
			updateAlarmClockDataManager() {
				let data = {
					alarmId: this.UPalarmId,
					switch: this.UPalarmSwitch,
					time: this.UPstartTime,
					alarmRepeat: {
						"Monday": true,
						"Tuesday": false,
						"Wednesday": true,
						"Thursday": true,
						"Friday": true,
						"Saturday": false,
						"Sunday": false
					},
					name: "猪猪小猪猪"
				}
				console.log("data=>", data)
				veepooFeature.veepooSendSetAlarmClockDataManager(data);
				this.index = this.index + 1
			},
		}
	}
</script>

<style>
	.box-btn {
		margin: 20rpx auto;
	}

	.box-info {
		padding: 50rpx;
	}

	.info-item {
		border-bottom: 1px solid #e4e4e4;
	}

	.ItemInput {
		display: flex;
		margin-top: 40rpx;
	}
</style>
