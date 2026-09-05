<template>
	<view class="container">

		<view class="title">微体检测量</view>

		<!-- 进度区域 -->
		<view class="progress-area" v-if="isMeasuring">
			<view class="progress-text">测量中...</view>
			<progress class="progress-bar" :percent="progress" show-info stroke-width="8" activeColor="#07c160" />
			<view class="progress-tip">请保持静止，正在检测多项健康指标...</view>
		</view>

		<!-- 结果区域 -->
		<view class="result-area" v-if="hasResult">
			<view class="result-title">检测结果</view>

			<view class="result-grid">
				<view class="result-item">
					<view class="item-value">{{microCheckData.heartRate}}</view>
					<view class="item-label">心率(bpm)</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.bloodOxygen}}</view>
					<view class="item-label">血氧(%)</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.pressure}}</view>
					<view class="item-label">压力</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.hrv}}</view>
					<view class="item-label">HRV(ms)</view>
				</view>
			</view>

			<view class="result-grid">
				<view class="result-item">
					<view class="item-value">{{microCheckData.highPressure}}/{{microCheckData.lowPressure}}</view>
					<view class="item-label">血压(mmHg)</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.bodyTemperature}}</view>
					<view class="item-label">体温(℃)</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.bloodSugar}}</view>
					<view class="item-label">血糖(mmol/L)</view>
				</view>
				<view class="result-item">
					<view class="item-value">{{microCheckData.emotion}}</view>
					<view class="item-label">情绪指数</view>
				</view>
			</view>

			<view class="result-grid">
				<view class="result-item">
					<view class="item-value">{{microCheckData.fatigueLevel}}</view>
					<view class="item-label">疲劳度</view>
				</view>
			</view>
		</view>

		<!-- 错误提示 -->
		<view class="error-area" v-if="errorMsg">
			<view class="error-text">{{errorMsg}}</view>
		</view>

		<!-- 按钮区域 -->
		<view class="btn-area">
			<button class="btn btn-start" @click="microCheckStart" :disabled="isMeasuring">开始测量</button>
			<button class="btn btn-stop" @click="microCheckStop" :disabled="!isMeasuring">结束测量</button>
		</view>

		<!-- 说明区域 -->
		<view class="info-area">
			<view class="info-title">微体检说明：</view>
			<view class="info-item">微体检是一次性检测多项健康指标的功能</view>
			<view class="info-item">检测项目包括：心率、血氧、压力、HRV、血压、体温、血糖、情绪、疲劳度</view>
			<view class="info-item">测量时请保持静止，确保设备贴合手腕</view>
			<view class="info-item">测量结果仅供参考，如有异常请咨询医生</view>
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
				isMeasuring: false,
				progress: 0,
				// 微体检数据
				microCheckData: {
					heartRate: 0, // 心率
					bloodOxygen: 0, // 血氧
					pressure: 0, // 压力
					emotion: 0, // 情绪
					fatigueLevel: 0, // 疲劳度
					bloodSugar: 0, // 血糖
					bodyTemperature: 0, // 体温
					highPressure: 0, // 高压
					lowPressure: 0, // 低压
					hrv: 0 // HRV
				},
				hasResult: false, // 是否有测量结果
				errorMsg: '' // 错误信息
			}
		},
		onLoad() {

		},
		onShow() {
			// 【排查日志】打印系统信息，区分平台
			const systemInfo = uni.getSystemInfoSync();
			console.log("[微体检] ========== 页面显示 ==========");
			console.log("[微体检] 系统信息:", JSON.stringify({
				platform: systemInfo.platform,
				system: systemInfo.system,
				brand: systemInfo.brand,
				model: systemInfo.model,
				SDKVersion: systemInfo.SDKVersion
			}));

			this.notifyMonitorValueChange();
		},
		onHide() {
			// 页面隐藏时可以停止监听
		},
		onUnload() {
			// 页面卸载时停止测量
			if (this.isMeasuring) {
				this.microCheckStop();
			}
		},
		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				console.log("[微体检] 开始注册蓝牙监听回调");

				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("[微体检] 蓝牙回调触发，原始数据:", JSON.stringify(e));
					console.log("[微体检] e.type:", e ?.type, "e.dataType:", e ?.dataType);

					// 检查数据是否有效
					if (!e || e.type === undefined) {
						console.warn("[微体检] 数据无效: e不存在或type未定义");
						return;
					}
					// type 53 为微体检测量数据类型
					if (e.type == 53) {
						console.log("[微体检] type=53，进入微体检处理");
						self.handleMicroCheckCallback(e);
					}
					// 其他类型数据忽略（由其他页面处理）
				})

				// ppg 的通道与常规数据通道不一样
				veepooBle.veepooUniAppSDKNotifyECGValueChange(function(e) {
					if (!e || e.type === undefined) {
						return;
					}
					if (e.type == 54) {
						console.log("[微体检] 蓝牙回调触发，ppg原始数据:", JSON.stringify(e))
					}
				})
			},

			// 处理微体检测量回调
			handleMicroCheckCallback(e) {
				let self = this;

				// 检查数据有效性
				if (!e) {
					console.warn("[微体检] 收到空数据");
					return;
				}

				// 【排查日志】打印完整回调数据
				console.log("[微体检] 完整回调数据:", JSON.stringify(e));
				console.log("[微体检] dataType:", e.dataType, "progress:", e.progress, "type:", e.type);

				// control: 1 开启 2 关闭
				// dataType: 0 进度包 1 测量成功报告数据 2 测量失败无结果数据 3 设备正忙 4 设备低电
				const dataType = e.dataType;
				const progress = e.progress || 0;

				switch (dataType) {
					case 0:
						// 进度包
						self.progress = progress;
						console.log("微体检测量进度:", progress);
						break;

					case 1:
						// 测量成功报告数据
						{
							const content = e.content || {};
							self.isMeasuring = false;
							self.hasResult = true;
							self.progress = 100;
							self.microCheckData = {
								heartRate: content.heartRate || 0,
								bloodOxygen: content.bloodOxygen || 0,
								pressure: content.pressure || 0,
								emotion: content.emotion || 0,
								fatigueLevel: content.fatigueLevel || 0,
								bloodSugar: content.bloodSugar || 0,
								bodyTemperature: content.bodyTemperature || 0,
								highPressure: content.highPressure || 0,
								lowPressure: content.lowPressure || 0,
								hrv: content.hrv || 0
							};
							console.log("微体检测量完成:", content);
						}
						break;

					case 2:
						// 测量失败无结果数据
						self.isMeasuring = false;
						self.hasResult = false;
						self.errorMsg = '测量失败，无结果数据';
						console.log("微体检测量失败");
						break;

					case 3:
						// 设备正忙
						self.isMeasuring = false;
						self.hasResult = false;
						self.errorMsg = '设备正忙，请稍后再试';
						console.log("设备正忙");
						break;

					case 4:
						// 设备低电
						self.isMeasuring = false;
						self.hasResult = false;
						self.errorMsg = '设备电量低，请充电后再试';
						console.log("设备低电");
						break;

					default:
						break;
				}
			},

			// 获取情绪描述
			getEmotionText(emotion) {
				if (emotion >= -10 && emotion <= -5) {
					return '情绪低落';
				} else if (emotion > -5 && emotion <= -2) {
					return '有些低落';
				} else if (emotion > -2 && emotion <= 2) {
					return '情绪平稳';
				} else if (emotion > 2 && emotion <= 5) {
					return '情绪较好';
				} else if (emotion > 5 && emotion <= 10) {
					return '情绪很好';
				}
				return '未知';
			},

			// 获取疲劳度描述
			getFatigueText(fatigue) {
				if (fatigue >= 0 && fatigue <= 2) {
					return '精力充沛';
				} else if (fatigue > 2 && fatigue <= 4) {
					return '轻度疲劳';
				} else if (fatigue > 4 && fatigue <= 6) {
					return '中度疲劳';
				} else if (fatigue > 6 && fatigue <= 8) {
					return '重度疲劳';
				} else if (fatigue > 8) {
					return '极度疲劳';
				}
				return '未知';
			},

			// 开始微体检测量
			microCheckStart() {
				let self = this;

				// 【排查日志】打印设备信息
				const bleInfo = uni.getStorageSync('bleInfo');
				console.log("[微体检] 当前蓝牙设备信息:", JSON.stringify(bleInfo));
				console.log("[微体检] 设备芯片类型 deviceChip:", bleInfo ?.deviceChip);

				// 重置数据
				self.isMeasuring = true;
				self.hasResult = false;
				self.progress = 0;
				self.errorMsg = '';
				self.microCheckData = {
					heartRate: 0,
					bloodOxygen: 0,
					pressure: 0,
					emotion: 0,
					fatigueLevel: 0,
					bloodSugar: 0,
					bodyTemperature: 0,
					highPressure: 0,
					lowPressure: 0,
					hrv: 0
				};

				// 发送开始微体检测量指令
				console.log("[微体检] 发送开始测量指令...");
				veepooFeature.veepooSendMicroCheckDataManager({
					switch: 'start'
				});
				console.log("[微体检] 开始测量指令已发送，等待蓝牙回调...");
			},

			// 停止微体检测量
			microCheckStop() {
				let self = this;
				self.isMeasuring = false;

				// 发送停止微体检测量指令
				veepooFeature.veepooSendMicroCheckDataManager({
					switch: 'stop'
				});
				console.log("停止微体检测量");
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
		margin-bottom: 20px;
	}

	/* 进度区域 */
	.progress-area {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 30px 20px;
		background-color: #f5f5f5;
		border-radius: 10px;
		margin-bottom: 20px;
	}

	.progress-text {
		font-size: 18px;
		color: #07c160;
		font-weight: bold;
		margin-bottom: 20px;
	}

	.progress-bar {
		width: 80%;
	}

	.progress-tip {
		margin-top: 15px;
		font-size: 14px;
		color: #999;
	}

	/* 结果区域 */
	.result-area {
		width: 100%;
		padding: 15px;
		background-color: #fff;
		border-radius: 10px;
		border: 1px solid #eee;
		margin-bottom: 20px;
	}

	.result-title {
		font-size: 16px;
		font-weight: bold;
		color: #333;
		margin-bottom: 15px;
		text-align: center;
	}

	.result-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.result-item {
		width: 48%;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 15px 10px;
		background-color: #f9f9f9;
		border-radius: 8px;
		margin-bottom: 10px;
	}

	.item-value {
		font-size: 24px;
		font-weight: bold;
		color: #07c160;
	}

	.item-label {
		font-size: 12px;
		color: #666;
		margin-top: 5px;
	}

	/* 错误提示 */
	.error-area {
		width: 100%;
		padding: 20px;
		background-color: #fff2f2;
		border-radius: 10px;
		border: 1px solid #ffcccc;
		margin-bottom: 20px;
	}

	.error-text {
		font-size: 14px;
		color: #fa5151;
		text-align: center;
	}

	/* 按钮区域 */
	.btn-area {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 15px;
		margin-bottom: 20px;
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

	/* 说明区域 */
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
