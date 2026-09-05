<template>
	<view>
		<view class="box-btn">
			<button @click="readSos">读取sos</button>
		</view>
		<view style="margin: 50rpx 30rpx;">
			<view class="ItemInput">
				<view>sos次数：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getSos" type="number"
						placeholder="sos次数" /></view>
			</view>
		</view>
		<view class="box-btn">
			<button @click="setupSos">设置sos</button>
		</view>
		<view>当前的times: {{times}}</view>
	</view>
</template>

<script>
	// 引入方式一:
	// // 整体引入
	// import sdk from '../../common/index.js'

	// // // 然后自己解构出来
	// const {
	// 	veepooBle,
	// 	veepooFeature
	// } = sdk;

	// 引入方式二：
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {
				times: 0,
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			getSos(e) {
				this.times = e.detail.value;
			},

			readSos() {
				veepooFeature.veepooSendReadSOSDataManager();
			},

			setupSos() {

				let data = {
					times: this.times,
				}
				console.log('data=>', data);
				veepooFeature.veepooSendSettingSOSDataManager(data)
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" sos 监听蓝牙回调=>", e);
					if (e.type === 12) {
						self.times = e.content.times;
					}

				})
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
		margin: 10rpx;
	}
</style>
