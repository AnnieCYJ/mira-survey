<template>
	<view class="box">
		<view style="margin-bottom: 30rpx;"><button @click="startBraceletSearch">手机开始查找手环</button></view>
		<view style="margin-bottom: 30rpx;"><button @click="stopBraceletSearch">手机退出查找手环</button></view>
	</view>
</template>

<script>
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {}
		},
		onLoad() {

		},
		onReady() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			braceletSearch() {
				console.log('aaa')
				veepooFeature.veepooSendFindYourPhoneDataManager(function(e) {
					console.log("e=>", e)
				});
			},
			startBraceletSearch() {
				let data = {
					switch: 'start'
				}
				veepooFeature.veepooSendPhoneLookBraceletDataManager(data, function(e) {
					console.log("e=>", e)
				});
			},
			stopBraceletSearch() {
				let data = {
					switch: 'stop'
				}
				veepooFeature.veepooSendPhoneLookBraceletDataManager(data, function(e) {
					console.log("e=>", e)
				});
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" 监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	/* pages/lookPhone/index.wxss */
</style>
