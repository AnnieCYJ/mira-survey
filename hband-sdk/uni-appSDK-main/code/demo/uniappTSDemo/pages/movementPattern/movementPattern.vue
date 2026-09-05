<template>
	<view class="box">

		<view class="box-btn"><button @click="startMovementPatternD5DataManager">开启运动模式</button></view>
		<view class="box-btn"><button @click="stopMovementPatternD5DataManager">关闭运动模式</button></view>
		<view class="box-btn"><button @click="readMovementPatternD5DataManager">读取运动模式</button></view>
		<view style="margin: 50rpx 20rpx;">
			<view>CRC0:{{crcData.CRC0}}</view>
			<view>CRC1:{{crcData.CRC1}}</view>
			<view>CRC2:{{crcData.CRC2}}</view>
		</view>
		<view class="box-btn"><button @click="startMovementPatternD3DataManager">读取运动模式校验值</button></view>
		<view v-if="crcData.CRC0" class="box-btn"><button @click="readMovementPatternD34DataManager">读取CRC0模式数据</button></view>
		<view v-if="crcData.CRC1" class="box-btn"><button @click="readMovementPatternD34DataManager2">读取CRC1模式数据</button></view>
		<view v-if="crcData" class="box-btn"><button @click="readMovementPatternD34DataManager3">读取CRC2模式数据</button></view>

		<view style="border-bottom: 1px solid #999;">
			<view>
				<text>开始时：</text>
				<view v-if="exerciseData.startTime">
					{{exerciseData.startTime.startYear + '-' + exerciseData.startTime.startMonth + '-' + exerciseData.startTime.startDay + '-' + exerciseData.startTime.startHour + '-' + exerciseData.startTime.startMinute}}
				</view>
			</view>

			<view>
				<text>结束时：</text>
				<view v-if="exerciseData.endTime">
					{{exerciseData.endTime.endYear + '-' + exerciseData.endTime.endMonth + '-' + exerciseData.endTime.endDay + '-' + exerciseData.endTime.endHour + '-' + exerciseData.endTime.endMinute}}
				</view>
			</view>
			<view v-if="exerciseData.movementData">CRC：{{exerciseData.movementData.crc}}</view>

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
				crcData: {},
				exerciseData: {}
			}
		},
		onLoad() {

		},
		onReady() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			startMovementPatternD5DataManager() {
				let value = {
					switch: 'start'
				}
				veepooFeature.veepooSendAppStartMovementPatternD5DataManager(value);
			},
			stopMovementPatternD5DataManager() {
				let value = {
					switch: 'stop'
				}
				veepooFeature.veepooSendAppStartMovementPatternD5DataManager(value);
			},
			readMovementPatternD5DataManager() {
				let value = {
					switch: 'read'
				}
				veepooFeature.veepooSendAppStartMovementPatternD5DataManager(value);
			},
			startMovementPatternD3DataManager() {
				veepooFeature.veepooSendAppStartMovementPatternD3DataManager();
			},
			readMovementPatternD34DataManager() {
				let data = {
					module: 1 //  1 2 3 模块，共三个
				}
				veepooFeature.veepooSendReadMovementPatternD4DataManager(data);
			},
			readMovementPatternD34DataManager2() {
				let data = {
					module: 2 //  1 2 3 模块，共三个
				}
				veepooFeature.veepooSendReadMovementPatternD4DataManager(data);
			},
			readMovementPatternD34DataManager3() {
				let data = {
					module: 3 //  1 2 3 模块，共三个
				}
				veepooFeature.veepooSendReadMovementPatternD4DataManager(data);
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("睡眠 监听蓝牙回调=>", e);
					if (e.type == 14) {
						self.crcData = e.content
					} else if (e.type == 16) {
						self.exerciseData = e.content
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
</style>
