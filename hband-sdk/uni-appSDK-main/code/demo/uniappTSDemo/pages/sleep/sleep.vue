<template>
	<view class="box">
		<view class="box-day">
			<view class="day-item" @click="ReadPreciseSleepManager(0)">今天</view>
			<view class="day-item" @click="ReadPreciseSleepManager(1)">昨天</view>
			<view class="day-item" @click="ReadPreciseSleepManager(2)">前天</view>
		</view>
		<view class="steep-date">

			<view class="title">读取进度:<!-- {{device.readPercent}} --></view>
			<text>只显示第一段数据，剩余数据查看日志</text>
			<view class="steep-item">
				<view class="item-left">入睡时间</view>
				<view class="item-left">{{device.content[0].fallAsleepTime}}</view>
			</view>
			<view class="steep-item">
				<view class="item-left">起床时间</view>
				<view class="item-left">{{device.content[0].exitSleepTime}}</view>
			</view>
			<view class="steep-item">
				<view class="item-left">深睡时间</view>
				<view class="item-left">{{device.content[0].deepSleepTime}}</view>
			</view>
			<view class="steep-item">
				<view class="item-left">浅睡时间</view>
				<view class="item-left">{{device.content[0].lightSleepTime}}</view>
			</view>
			<view class="steep-item">
				<view class="item-left">苏醒时间</view>
				<view class="item-left">{{device.content[0].nightTotalTime}}</view>
			</view>
			<view class="steep-line">
				<view>睡眠曲线:</view>
				<view>{{device.content.sleepCurve}}</view>
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
				device: {
					content: [{
						fallAsleepTime: '--',
						exitSleepTime: '--',
						deepSleepTime: 0,
						lightSleepTime: 0,
						nightTotalTime: 0,
						sleepQuality: 0,
						sleepCurve: []
					}]
				}
			}
		},
		onShow() {
			this.notifyMonitorValueChange();
		},


		methods: {
			ReadPreciseSleepManager(e) {
				// let index = e.currentTarget.dataset.index
				console.log('day:', e)
				let data = {
					day: e
				}
				veepooFeature.veepooSendReadPreciseSleepManager(data)
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" 睡眠 监听蓝牙回调=>", e);
					if (e) {
						if (e.name == '精准睡眠数据') {
							self.device = e
						}
					}


				})
			},
		}
	}
</script>

<style>
	.box {
		padding: 50rpx;
	}

	.box-day {
		display: flex;
		justify-content: space-around;
	}

	.day-item {
		width: 25%;
		background-color: #a8a8a8;
		height: 30px;
		line-height: 30px;
		text-align: center;
		color: white;
		border-radius: 15rpx;

	}

	.steep-date {
		margin-top: 20px;

	}

	.steep-item {
		display: flex;
		justify-content: space-between;
		height: 40px;
		line-height: 40px;
		border-bottom: 1px solid #dadada;
	}

	.steep-line {
		line-height: 40px;
	}
</style>