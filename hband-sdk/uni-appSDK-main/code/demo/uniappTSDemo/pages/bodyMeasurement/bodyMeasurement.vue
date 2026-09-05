<template>
	<view class="box">
		<view>测试进度：{{device.progress}}</view>
		<view class="body-item">
			<view class="item-left">BMI</view>
			<view class="item-left">{{device.content.BMI}}</view>
		</view>
		<view class="body-item">
			<view class="item-left"> 体脂率</view>
			<view class="item-left">{{device.content.bodyFatPercentage}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">脂肪量</view>
			<view class="item-left">{{device.content.fatMass}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">去脂体重</view>
			<view class="item-left">{{device.content.leanBodyMass}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">肌肉率</view>
			<view class="item-left">{{device.content.muscleRate}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">肌肉量</view>
			<view class="item-left">{{device.content.muscleMass}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">皮下脂肪</view>
			<view class="item-left">{{device.content.subcutaneousFat}}</view>
		</view>
		<view class="body-item">
			<view class="item-left"> 体内水分</view>
			<view class="item-left">{{device.content.bodyMoisture}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">含水量</view>
			<view class="item-left">{{device.content.waterContent}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">骨骼肌率</view>
			<view class="item-left">{{device.content.skeletalMuscleRate}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">骨量</view>
			<view class="item-left">{{device.content.boneMass}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">蛋白质占比</view>
			<view class="item-left">{{device.content.proportionOfProtein}}</view>
		</view>
		<view class="body-item">
			<view class="item-left"> 蛋白质量</view>
			<view class="item-left">{{device.content.proteinAmount}}</view>
		</view>
		<view class="body-item">
			<view class="item-left">基础代谢率</view>
			<view class="item-left">{{device.content.basalMetabolicRate}}</view>
		</view>

		<button style="margin: 30rpx auto;" @click="BodyCompositionTestStartDataManager">开始检测</button>
		<button @click="BodyCompositionTestStopDataManager">关闭检测</button>

		<view class="box-idType" style="margin-top: 50rpx;">

			<view>为空表示没有ID</view>
			<view v-for="(item, index) in deviceIdList" :key="index">数据ID：{{item.dataId}}</view>
			<button style="margin: 30rpx auto;" @click="startGetDataId">获取成分数据ID</button>
			<button style="margin: 30rpx auto;" @click="dataIdGetData">根据ID获取数据</button>


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
				// 必须预置 content，否则 {{device.content.BMI}} 在 Vue3 下会因 content 为 undefined 抛错导致整页空白
				device: {
					progress: 0,
					content: {}
				},
				deviceIdList: []
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange();
		},
		methods: {
			BodyCompositionTestStartDataManager() {
				veepooFeature.veepooSendBodyCompositionTestStartDataManager();
			},
			BodyCompositionTestStopDataManager() {
				veepooFeature.veepooSendBodyCompositionTestStopDataManager()
			},
			startGetDataId() {
				veepooFeature.veepooSendReadBodyCompositionTestIdDataManager()
			},
			dataIdGetData() {
				let self = this;
				let deviceIdList = this.deviceIdList[0];
				console.log("deviceIdList=>", deviceIdList)
				let data = {
					dataId: deviceIdList.dataId
				}
				veepooFeature.veepooSendBodyCompositionIdReadDataManager(data)
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("身体成分 监听蓝牙回调=>", e);
					if (e.type == 32) {
						if (e.name == '身体成分检测') {
							self.device = e;
						} else if (e.name == '根据Id获取身体成分数据') {
							self.device = e;
						} else if (e.name == '身体成分读取测量保存的数据ID') {
							self.deviceIdList = e.content;
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

	.body-item {
		display: flex;
		justify-content: space-between;
		line-height: 70rpx;
	}

	.box-idType {}
</style>
