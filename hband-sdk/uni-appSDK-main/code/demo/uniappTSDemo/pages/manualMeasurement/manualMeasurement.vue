<template>
	<view>
		<button style="margin-top: 20px;" @click="readManualTestData">开始读取手动测量</button>
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
				progress: 0
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
				});
			},

			// 读取手动测量
			readManualTestData() {
				// 获取当前时间
				const now = new Date();
				// 创建一个新的日期对象，时间设为今天的 1 点整
				const oneAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0, 0);
				// 秒级时间戳
				const timestampInSeconds = Math.floor(oneAM.getTime() / 1000);
				console.log('timestampInSeconds==>', timestampInSeconds);
				// dataType 数据类型   0 血压 1 心率 2 血糖 3 压力 4 血氧 5 体温 6 梅拖 7 hrv 8 血液成分 9 微体检 10 情绪 11 疲劳度 12 皮电
				veepooFeature.veepooSendManualMeasurementDataReadManager({
					timestamp: timestampInSeconds,
					dataType: 0
				});

			}
		}
	}
</script>

<style>
	/* pages/manualMeasurement/index.wxss */
</style>
