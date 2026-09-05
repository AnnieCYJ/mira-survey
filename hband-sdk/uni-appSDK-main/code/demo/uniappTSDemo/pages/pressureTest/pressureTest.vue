<template>
	<view class="container">

		<view class="title">压力测量</view>

		<view class="measure-area">
			<view class="stress-value" :class="{'measuring': isMeasuring}">
				<text class="value">{{stress}}</text>
				<text class="unit">分</text>
			</view>
			<view class="stress-level" v-if="stressLevel">
				压力等级：{{stressLevel}}
			</view>
			<view class="measuring-tip" v-if="isMeasuring">
				测量中，请保持静止...
			</view>
		</view>

		<view class="btn-area">
			<button class="btn btn-start" @click="stressStart" :disabled="isMeasuring">开始测量</button>
			<button class="btn btn-stop" @click="stressStop" :disabled="!isMeasuring">结束测量</button>
		</view>

		<view class="info-area">
			<view class="info-title">压力等级说明：</view>
			<view class="info-item">0-20：放松</view>
			<view class="info-item">21-40：正常</view>
			<view class="info-item">41-60：中等</view>
			<view class="info-item">61-80：偏高</view>
			<view class="info-item">81-100：很高</view>
		</view>

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
				stress: 0,
				stressLevel: '',
				isMeasuring: false
			}
		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		onHide() {
			// 页面隐藏时可以停止监听
		},
		onUnload() {
			// 页面卸载时停止测量
			if (this.isMeasuring) {
				this.stressStop();
			}
		},
		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("压力测量监听蓝牙回调=>", e);
					// type 52 为压力测量数据类型（根据实际SDK文档调整）
					if (e.type == 52) {
						let stressValue = e.content.stress || 0;
						let stressLevelText = self.getStressLevelText(stressValue);

						self.stress = stressValue;
						self.stressLevel = stressLevelText
					} else if (e.type == 53) {
						// 压力测量进度回调
						console.log("压力测量进度:", e.content);
					} else if (e.type == 54) {
						// 压力测量完成回调
						self.isMeasuring = false
						console.log("压力测量完成");
					}
				})
			},

			// 根据压力值获取压力等级描述
			getStressLevelText(stress) {
				if (stress >= 0 && stress <= 20) {
					return '放松';
				} else if (stress > 20 && stress <= 40) {
					return '正常';
				} else if (stress > 40 && stress <= 60) {
					return '中等';
				} else if (stress > 60 && stress <= 80) {
					return '偏高';
				} else if (stress > 80 && stress <= 100) {
					return '很高';
				}
				return '未知';
			},

			// 开始压力测量
			stressStart() {
				let self = this;
				self.isMeasuring = true;
				self.stress = 0;
				self.stressLevel = '';

				// 发送开始压力测量指令
				// API: veepooSendPressureTestManager (根据SDK文档)
				veepooFeature.veepooSendPressureTestManager({
					switch: true
				})
				console.log("开始压力测量");
			},

			// 停止压力测量
			stressStop() {
				let self = this;
				self.isMeasuring = false;

				// 发送停止压力测量指令
				veepooFeature.veepooSendPressureTestManager({
					switch: false
				})
				console.log("停止压力测量");
			},

			// 读取历史压力数据
			readStressHistory() {
				// 读取历史压力数据
				veepooFeature.veepooSendReadStressDataManager()
				console.log("读取历史压力数据");
			}
		}
	}
</script>

<style>
	.container {
		padding: 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.title {
		font-size: 18px;
		font-weight: bold;
		margin-bottom: 30px;
	}

	.measure-area {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 30px 0;
		background-color: #f5f5f5;
		border-radius: 10px;
		margin-bottom: 20px;
	}

	.stress-value {
		display: flex;
		align-items: baseline;
	}

	.stress-value .value {
		font-size: 60px;
		font-weight: bold;
		color: #333;
	}

	.stress-value .unit {
		font-size: 16px;
		color: #666;
		margin-left: 5px;
	}

	.stress-value.measuring .value {
		color: #07c160;
	}

	.stress-level {
		margin-top: 15px;
		font-size: 16px;
		color: #07c160;
		font-weight: 500;
	}

	.measuring-tip {
		margin-top: 10px;
		font-size: 14px;
		color: #999;
	}

	.btn-area {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 15px;
		margin-bottom: 30px;
	}

	.btn {
		width: 100%;
		height: 45px;
		line-height: 45px;
		border-radius: 8px;
		font-size: 16px;
	}

	.btn-start {
		background-color: #07c160;
		color: #fff;
	}

	.btn-start[disabled] {
		background-color: #a0e8b8;
		color: #fff;
	}

	.btn-stop {
		background-color: #fa5151;
		color: #fff;
	}

	.btn-stop[disabled] {
		background-color: #f8a8a8;
		color: #fff;
	}

	.info-area {
		width: 100%;
		padding: 15px;
		background-color: #fff;
		border-radius: 8px;
		border: 1px solid #eee;
	}

	.info-title {
		font-size: 14px;
		font-weight: bold;
		color: #333;
		margin-bottom: 10px;
	}

	.info-item {
		font-size: 13px;
		color: #666;
		line-height: 24px;
	}
</style>
