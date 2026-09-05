<template>
	<view class="box">
		<view class="box-item"><button @click="start">开启常灭屏</button></view>
		<view class="box-item"><button @click="stop">关闭常灭屏</button></view>
		<view class="box-item"><button @click="read">读取常灭屏</button></view>
	</view>
</template>

<script>
	// pages/ZT163ScreenKillFunction/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	export default {
		data() {
			return {}
		},

		onLoad() {},

		onShow() {
			this.notifyMonitorValueChange();
		},

		methods: {
			start() {
				veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
					control: 1
				})
			},

			stop() {
				veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
					control: 2
				})
			},

			read() {
				veepooFeature.veepooSetupZT163ScreenKillFunctionManager({
					control: 3
				})
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log(" step 监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	.box {
		margin-top: 30rpx;
	}

	.box .box-item {
		margin-top: 30rpx;
	}

</style>
