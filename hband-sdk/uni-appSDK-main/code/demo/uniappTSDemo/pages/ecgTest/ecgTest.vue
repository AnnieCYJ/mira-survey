<template>
	<view class="box">
		<view>
			<view>手环状态：{{device.content.wristbandStatus}}</view>
			<view>呼吸率HR1每秒：{{device.content.HR1PerSecond}}</view>
			<view>呼吸率HR2每分钟：{{device.content.HR2PerHour}}</view>
			<view>每秒Hrv: {{device.content.Hrv}}</view>
			<view>RR1每秒：{{device.content.RR1PerSecond}}</view>
			<view>RR2每6秒：{{device.content.RR2Per6Second}}</view>
			<view>BR2每分钟：{{device.content.BR2PerHours}}</view>
			<view>BR1每秒：{{device.content.BR2PerSecond}}</view>
			<view>导联佩戴：{{device.content.wearStatus}}</view>
			<view>M_ID：{{device.content.M_ID}}</view>
			<view>QTC：{{device.content.QTC}}</view>
			<view>PWV：{{device.content.PWV}}</view>
		</view>
		<view>

		</view>
		<view class="ecg-item">测试进度：{{device && device.progress}}%</view>



		<button class="btn" @click="ECGmeasureStartDataManager">开启测试</button>
		<button class="btn" @click="ECGmeasureStopDataManager">关闭测试</button>


		<scroll-view class="myScoll" scroll-x>
			<view>
				<view class="box1">
					<canvas canvas-id="ecg" id="ecg" style="width: 5000px; height: 300px;"></canvas>
				</view>
				<view class="box2">
					<canvas canvas-id="myCanvas" id="myCanvas" style="width: 5000px; height: 300px;"></canvas>

				</view>
			</view>
		</scroll-view>


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
	import {
		ab2hex
	} from '../../utils/util.js'
	let totalArray = []

	export default {
		data() {
			return {
				// 必须预置 content，否则 {{device.content.wristbandStatus}} 等在 Vue3 下会因 content 为 undefined 抛错导致整页空白
				device: {
					progress: 0,
					content: {}
				},
				list: [],
				// list: [],
				height: 300,
				width: 5000,
				centerY: 240 // y轴中心作为绘画点，
			}
		},
		onReady() {

			this.drawCurve();
			let data = veepooFeature.veepooGetDiseaseTextManager({
				heartRate: 77,
				diseaseResult: [0, 0, 0, 0, 0, 0, 0, 0]
			});

			console.log('data==>', data);
		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		methods: {
			// 无参数
			ECGmeasureStartDataManager() {
				this.notifyMonitorValueChange();
				veepooFeature.veepooSendECGmeasureStartDataManager();
			},
			ECGmeasureStopDataManager() {
				veepooFeature.veepooSendECGmeasureStopDataManager();
			},
			// 监听订阅 notifyMonitorValueChange
			//  veepooUniAppSDKNotifyECGValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {

					console.log(" ECG 监听蓝牙回调=>", e);
					if (e.name == 'ecg测量') {
						console.log("========================================================")
						self.device = e

						if (e.progress == 100) {
							console.log("totalArray=>", totalArray)
							self.list = totalArray
							self.drawCurve();
						}
					}
				})
				// 这里主要是获取的是波形的数据 为
				veepooBle.veepooUniAppSDKNotifyECGValueChange(function(e) {
					if (e.name == 'ecg波形数据') {
						totalArray.push(...e.content)
						console.log('ecg波形数据', e.content)
					}
				})
			},



			drawCurve() {

				let ctx = uni.createCanvasContext('myCanvas', this)
				let list = this.list;
				console.log("list==>", list)
				let centerY = this.centerY;
				let width = this.width;
				let xScale = width / (list.length - 1); // 计算每个数据点占据的宽度
				let yScale = centerY / (Math.max(...list) - Math.min(...list))
				let x = 0;
				let y = centerY / 2 - (list[0] * yScale)
				ctx.beginPath(); // 开始绘制
				ctx.moveTo(x, y);
				ctx.setStrokeStyle('#c96d79'); // 设置线条颜色
				ctx.setLineWidth(2); // 设置线条宽度
				for (let i = 1; i < list.length; i++) {
					let x = i * xScale;
					let y = centerY / 2 - ((list[i] / 2) * yScale); // 负数在中心下方，正数在中心上方
					ctx.lineTo(x, y);
				}
				ctx.stroke(); // 绘制线条
				ctx.draw(false); // 绘制到canvas上，不需要等待上一步绘制完成
			}
		}
	}
</script>

<style>
	.box {
		/* padding: 50rpx; */
	}

	.btn {
		margin: 20rpx 0;
	}

	.box1 {
		position: absolute;
		left: 0px;
		top: 50px;
		width: 3000rpx;
	}

	.box2 {
		position: absolute;
		left: 0px;
		top: 50px;
		width: 3000rpx;
	}

	.myScoll {
		width: 100%;
		height: 500rpx;
		white-space: nowrap;
		position: relative;
	}
</style>
