<template>
	<view class="box">

		<view class="box-item">
			<view>未知来电：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue1" type="text"
					placeholder="手机号码" :value="phone1" /></view>
		</view>
		<view><button @click="startPhone" style="margin-bottom: 40rpx;">未知来电通知</button></view>

		<view class="box-item">
			<view>联系人电话：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue1" type="text"
					placeholder="手机号码" :value="phone1" /></view>
		</view>
		<view class="box-item">
			<view>联系人：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue3" type="text"
					placeholder="名称" /></view>
		</view>
		<view><button @click="storagePhone" style="margin-bottom: 40rpx;">通讯录来电通知</button></view>

		<view class="box-item">
			<view>联系人电话：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue1" type="text"
					placeholder="手机号码" :value="phone1" /></view>
		</view>
		<view class="box-item">
			<view>发送的消息：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue2" type="text"
					placeholder="消息" /></view>
		</view>
		<view><button @click="sendSMS" style="margin-bottom: 40rpx;">未知短信通知</button></view>


		<view class="box-item">
			<view>联系人电话：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue1" type="text"
					placeholder="手机号码" :value="phone1" /></view>
		</view>
		<view class="box-item">
			<view>联系人：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" :value="name"
					@input="inputValue3" type="text" placeholder="名称" /></view>
		</view>
		<view class="box-item">
			<view>发送的消息：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue2" type="text"
					placeholder="消息" /></view>
		</view>
		<view><button @click="sendSMS2" style="margin-bottom: 40rpx;">通讯录短信通知</button></view>


		<view class="box-item">
			<view></view>
			<picker @change="bindPickerChange" :value="index - 2" :range="array">
				<view class="picker">
					应用名称： {{array[index-2]}}
				</view>
			</picker>
		</view>
		<view class="box-item">
			<view>发送的消息：</view>
			<view><input style="background-color: aliceblue; padding: 10rpx 15rpx;" @input="inputValue2" type="text"
					placeholder="消息" /></view>
		</view>
		<view><button @click="sendSMS3" style="margin-bottom: 40rpx;">应用通知</button></view>
	</view>
	<!-- 18588402715 -->
</template>

<script>
	// pages/screenSetup/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {
				time: 0,
				phone1: 0,
				name: '',
				message: '',
				array: ['微信', 'qq', '新浪微博', 'facebook', '推特', 'flickr', 'Linke', 'WhatsApp', 'Line'],
				index: 2,
				deviceType: ''
			}
		},

		onLoad() {

		},

		onShow() {
			let self = this;
			this.notifyMonitorValueChange();
			let str = ['E9', '99', '88', 'E6', '98', 'BE', 'E6', '96', '87', 'E8', '81', '94', 'E9', '80', '9A']
			let nameArray = []
			console.log
			str.forEach((item, index) => {
				nameArray.push(self.hexTo10(item));
			})
			console.log('nameArray=>', nameArray)

			console.log("uint8ArrayToNumber=>", this.uint8ArrayToString(nameArray))

		},

		onHide() {

		},

		onUnload() {

		},

		methods: {
			hexTo10(num) {
				return parseInt(num, 16);
			},
			bindPickerChange(e) {
				console.log("e=>", Number(e.detail.value) + 2)
				let array = this.array
				this.index = Number(e.detail.value) + 2;
				this.deviceType = array[e.detail.value];
			},
			uint8ArrayToString(bytes) {
				// 小程序不支持以下写法
				// const decoder = new TextDecoder();
				// const str = decoder.decode(new Uint8Array(bytes));
				const str = decodeURIComponent(escape(String.fromCharCode(...bytes)));
				return str
			},
			uint8ArrayToNumber(num) {
				const view = String.fromCharCode(num);
				return view
			},
			stringToUtf8Array(str) {
				const view = unescape(encodeURIComponent(str)).split("").map(val => val.charCodeAt());
				return view
			},
			inputValue1(e) {
				console.log("e=>", e)
				this.phone1 = e.detail.value;
			},
			inputValue2(e) {
				console.log("e=>", e)
				this.message = e.detail.value;
			},
			inputValue3(e) {
				console.log("e=>", e)
				this.name = e.detail.value;
			},
			startPhone(e) {
				let self = this;
				let data = {
					type: '02',
					phone: self.phone1
				}
				veepooFeature.veepooSendAndroidCodeDataManager(data);
			},

			storagePhone(e) {
				let self = this;
				let data = {
					type: '01',
					phone: self.phone1,
					name: self.name
				}
				veepooFeature.veepooSendAndroidCodeDataManager(data);
			},

			//

			sendSMS() {
				let self = this;
				let data = {
					type: '04',
					phone: self.phone1,
					message: self.message
				}
				veepooFeature.veepooSendAndroidCodeDataManager(data);
			},

			sendSMS2() {
				let self = this;
				let data = {
					type: '03',
					phone: self.phone1,
					message: self.message,
					name: self.name
				}

				veepooFeature.veepooSendAndroidCodeDataManager(data);
			},

			sendSMS3() {
				let self = this;
				console.log("self.data.index=>", self.index);
				let apply = self.index.toString(16).padStart(2, '0');
				console.log("apply=>", apply)
				let data = {
					type: '05',
					apply: self.index,
					message: self.message,
				}

				veepooFeature.veepooSendAndroidCodeDataManager(data);
			},
			readLightUpTimeData(e) {
				let data = {
					switch: 'read',
					duration: this.time
				}
				veepooFeature.veepooSendLightUpTimeDataManager(data);
			},

			// veepooBle
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" step 监听蓝牙回调=>", e);

				})
			},
		}
	}
</script>

<style>
	.box {
		padding: 40rpx;
	}

	.box-item {
		display: flex;
		margin-bottom: 40rpx;
	}
</style>
