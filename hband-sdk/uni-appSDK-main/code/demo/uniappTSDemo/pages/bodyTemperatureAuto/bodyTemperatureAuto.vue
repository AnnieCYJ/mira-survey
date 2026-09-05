<template>
	<view class="box">
		<view class="box-day">
			<view class="day-item" @click="readData(0)">今天</view>
			<view class="day-item" @click="readData(1)">昨天</view>
			<view class="day-item" @click="readData(2)">前天</view>
		</view>
		<view class="box-data">
			<view>读取进度：{{device.Progress}}</view>
			<view v-if="device.content">
				<view class="data-item" v-for="(item,index) in device.content.totalData" :key="index">
					<text>体温：{{item.bodyTemperature}}</text>
					<text>体表温度：{{item.bodySurfaceTemperature}}</text>
					<text>时间：{{item.time}}</text>
				</view>
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
				device: {}
			}
		},
		onLoad(options) {

		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		methods: {
			readData(index) {
				let data = {
					day: index, // 0 今天  1 昨天 2 前天
					package: 1, // 读取报数，从第一个开始
				}
				console.log("data==>", data)
				veepooFeature.veepooReadAutoTemperatureMeasurementDataManager(data);
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" ss 监听蓝牙回调=>", e);
					if (e.name = '体温自动检测读取') {
						self.device = e
					} else if (e.name == '体温自动检测') {
						self.device = e
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
		margin: 40rpx;
	}

	.data-item {
		font-size: 14px;
		line-height: 30px;
	}
</style>
