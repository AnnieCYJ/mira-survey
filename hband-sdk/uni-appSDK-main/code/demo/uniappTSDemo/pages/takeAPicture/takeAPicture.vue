<template>
	<view>
		<view style="margin-top: 50rpx;"><button @click="startTest">进入拍照</button></view>
		<view style="margin-top: 50rpx;"><button @click="stopTest">退出拍照</button></view>
		<view style="margin-top: 50rpx;"><button @click="getProductInfo">获取生产信息</button></view>
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
			startTest() {
				let self = this;
				let data = {
					switch: 'start',
				}
				veepooFeature.veepooSendTakeAPictureDataManager(data);
			},
			stopTest() {
				let self = this;
				let data = {
					switch: 'stop',
				}
				veepooFeature.veepooSendTakeAPictureDataManager(data);
			},
			getProductInfo() {
				veepooFeature.veepooSendGetProductInfoManager();
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("拍照 监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	/* pages/takeAPicture/index.wxss */
</style>
