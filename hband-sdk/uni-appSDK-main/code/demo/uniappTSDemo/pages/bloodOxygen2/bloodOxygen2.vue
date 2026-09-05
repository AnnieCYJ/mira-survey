<template>
	<view class="box">

		<view class="box-content">
			<view>血氧：{{bloodOxygen}} %</view>
			<view v-if="statusMsg" style="color: #07c160; margin-top: 10px;">{{statusMsg}}</view>
			<view v-if="errorMsg" style="color: #fa5151; margin-top: 10px;">{{errorMsg}}</view>
			<view v-if="isMeasuring" style="color: #10aeff; margin-top: 10px;">正在测量中...</view>
		</view>

		<view class="btn"><button @click="startTest" :disabled="isMeasuring">开启测量</button></view>
		<view class="btn"><button @click="stopTest" :disabled="!isMeasuring">关闭测量</button></view>

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
				bloodOxygen: '--', // 血氧值，初始显示为 --
				isMeasuring: false,
				statusMsg: '', // 状态信息
				errorMsg: '' // 错误信息
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		// 页面隐藏时可以停止监听
		onHide() {

		},
		// 页面卸载时停止测量
		onUnload() {
			if (this.isMeasuring) {
				this.stopTest();
			}
		},
		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("[血氧手动] 蓝牙回调=>", e);

					// type 31 为血氧手动测量数据类型
					if (e.type == 31) {
						self.handleBloodOxygenCallback(e);
					}
				})
			},

			// 处理血氧测量回调
			handleBloodOxygenCallback(e) {
				let self = this;
				const content = e.content || {};

				// 1. 优先判断设备是否正忙
				if (content.deviceBusy === true) {
					self.isMeasuring = false
					self.errorMsg = '设备正忙，请稍后再试'
					self.statusMsg = ''
					console.log("[血氧手动] 设备正忙");
					return;
				}

				// 2. 判断佩戴检测是否通过
				if (content.notWear === true) {
					self.isMeasuring = false
					self.errorMsg = '佩戴检测未通过，请正确佩戴设备'
					self.statusMsg = ''
					console.log("[血氧手动] 佩戴检测未通过");
					return;
				}

				// 3. 获取血氧值并校验有效范围 [70, 100]
				const bloodOxygen = content.bloodOxygen;
				if (typeof bloodOxygen !== 'number' || bloodOxygen < 70 || bloodOxygen > 100) {
					console.log("[血氧手动] 血氧值无效:", bloodOxygen);
					// 不在有效范围内，显示 --
					self.bloodOxygen = '--'
					self.isMeasuring = true
					self.errorMsg = '测量值无效'
					self.statusMsg = ''
					return;
				}

				// 血氧值有效，更新显示
				self.bloodOxygen = bloodOxygen
				self.isMeasuring = true
				self.errorMsg = ''
				self.statusMsg = '测量中...'
				console.log("[血氧手动] 测量中...，血氧值:", bloodOxygen);
			},

			// 开始血氧测量
			startTest() {
				let self = this;

				// 重置状态
				self.isMeasuring = true
				self.bloodOxygen = '--'
				self.statusMsg = '正在测量...'
				self.errorMsg = ''

				// 发送开始血氧测量指令
				veepooFeature.veepooSendBloodOxygenControlDataManager({
					switch: 'start'
				});
				console.log("[血氧手动] 开始测量");
			},

			// 停止血氧测量
			stopTest() {
				let self = this;

				self.isMeasuring = false
				self.statusMsg = ''
				self.errorMsg = ''

				// 发送停止血氧测量指令
				veepooFeature.veepooSendBloodOxygenControlDataManager({
					switch: 'stop'
				});
				console.log("[血氧手动] 停止测量");
			}
		}
	}
</script>

<style>
	.box {
		padding: 20rpx;
	}

	.btn {
		margin-top: 30rpx;
	}
</style>
