<template>
	<view class="box">
		<view class="box-day">
			<view class="day-item" @click="readData(0)">今天</view>
			<view class="day-item" @click="readData(1)">昨天</view>
			<view class="day-item" @click="readData(2)">前天</view>
		</view>
		<view class="box-data">
			<view>读取进度：{{device.Progress}}</view>
			<view>
				<view class="data-item" v-for="item in device.content" :key="item.date">
					<text>时间：{{item.date}}</text>
				</view>
			</view>
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
				device: {}
			}
		},
		methods: {
			onLoad() {
				let data = {
					status: true
				}
				veepooBle.veepooUniAppSDKRawDataShowStatus(data)
			},
			onShow() {
				this.notifyMonitorValueChange()
			},

			readData(e) {
				let self = this;
				let index = e
				let data = {
					day: index, // 0 今天  1 昨天 2 前天
					package: 0
				}

				self.notifyMonitorValueChange();

				veepooFeature.veepooSendReadDailyDataManager(data);
				console.log('实现了读取日常的数据接口')

			},

			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("日常数据 监听蓝牙回调=>", e);
					// 睡眠数据
					if (e && e.type == 5) {
						self.$set(self, 'device', e);
						if (e && e.type == 5 && e.Progress == 100) {
							console.log("日常数据====》", e.content.reverse())
							let content = e.content.reverse();
							let arr = []
							let rr50Array = [];
							content.forEach((item) => {
								let obj = item.bloodPressure
								let date = item.date.split("-");
								// 获取7小时rr50值
								if (Number(date[3]) < 7) {
									// console.log("item.rr50=>", item.rr50)
									rr50Array.push(...item.rr50)
								}
								arr.push(obj)
							});
							console.log('rr50Array==>', rr50Array);
							console.log('rr50Array.length==>', rr50Array.length);

							let drawArr = veepooFeature.veepooGetLorentzScatterPlotData(rr50Array);
							console.log("洛伦兹散点图==>", drawArr)
							let starIndexs = veepooFeature.veepooGetLorentzScatterPlotStarIndex(rr50Array);
							console.log("洛伦兹星级starIndexs==>", starIndexs);
							console.log("arr=>", arr)
							let similarity = veepooFeature.VeepooGetLorentzScatterPlotSimilarity(rr50Array);
							console.log("洛伦兹相似度similarity=>", similarity)
						}
					}
				})
			},
		}
	}
</script>

<style>
	.box-day {
		font-size: 14px;
		margin: 30rpx auto;
		text-align: center;
		display: flex;
		justify-content: space-around;

	}

	.day-item {
		width: 25%;
		height: 70rpx;
		line-height: 70rpx;
		color: white;
		border-radius: 15rpx;
		background-color: #a8a8a8;
	}

	.box-data {
		padding: 15rpx 30rpx;
	}

	.data-item {
		line-height: 30px;
	}
</style>