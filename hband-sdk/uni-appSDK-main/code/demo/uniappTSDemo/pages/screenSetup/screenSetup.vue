<template>
	<view class="box">
		<view class="box-item">
			<view>时间: <input style="display: inline-block; background-color: aliceblue;" @input="inputValue" type="number" placeholder="3-60秒" /></view>
			<button style="margin-top: 50rpx; margin-bottom: 30rpx;" @click="LightUpTimeData">设置屏幕时间</button>
			<button style="margin-top: 50rpx; margin-bottom: 30rpx;" @click="readLightUpTimeData">读取屏幕时间</button>
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
				time: 0
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			inputValue(e) {
				console.log("e=>", e)
				this.time = e.detail.value
			},
			LightUpTimeData(e) {
				let data = {
					switch: 'setup',
					duration: this.time
				}
				veepooFeature.veepooSendLightUpTimeDataManager(data);
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
</style>
