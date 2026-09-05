<template>
	<view class="box">
		<view class="box-day">
			<!-- <text class="day-left" @click="reductionOf">上一天</text>
	    <text class="time">2024-05-15</text>
	    <text class="day-left" @click="addDay">下一天</text> -->
			<view class="day-item" @click="readData(0)">今天</view>
			<view class="day-item" @click="readData(1)">昨天</view>
			<view class="day-item" @click="readData(2)">前天</view>
		</view>

		<view class="box-content">
			<view class="content-item">
				<text>步数：</text>
				<text>{{device.step}} 步</text>
			</view>
			<view class="content-item">
				<text>距离：</text>
				<text>{{device.distance}} m</text>
			</view>
			<view class="content-item">
				<text>卡路里：</text>
				<text>{{device.calorie}} Kcal</text>
			</view>
		</view>
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
				day: 1,
				device: {}
			}
		},
		onLoad(options) {

		},
		onShow() {
			this.notifyMonitorValueChange()

			setTimeout(() => {
				this.readData(0);
			}, 500);
		},
		methods: {
			// 读取步数，卡路里，距离
			readData(index) {
				let day = index
				let data = {
					day: day
				}
				veepooFeature.veepooReadStepCalorieDistanceManager(data);
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" step 监听蓝牙回调=>", e);
					if (e.type == 9) {
						self.device = e.content
					}
				})
			},
		}
	}
</script>

<style>
	.time {
		margin: 0 40rpx;
	}

	.box {}

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

	.day-left {
		color: #00b0fb;
	}

	.box-content {
		margin: 70rpx;
	}

	.content-item {
		color: black;
		font-size: 18px;
		line-height: 80rpx;
	}
</style>
