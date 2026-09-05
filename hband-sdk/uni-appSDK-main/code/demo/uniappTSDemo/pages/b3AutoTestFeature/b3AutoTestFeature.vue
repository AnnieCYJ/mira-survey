<template>
	<view class="box">
		<button class="btn" @click="startRead">开始读取</button>
		<button class="btn" @click="startSetup">开始设置</button>

		<picker @change="bindPickerChange" :value="index" :range="array">
			<view class="picker">
				当前选择类型：{{array[index]}}
			</view>
		</picker>

		<view>

			<view style="margin-top: 50rpx;">
				<view class="section__title">开关：</view>
				<view class="body-view">
					<switch type="switch" :checked="switch2Checked" @change="switch2Change" />
				</view>
			</view>

		</view>
	</view>
</template>

<script>
	// pages/b3AutoTestFeature/b3AutoTestFeature.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	export default {
		data() {
			return {
				array: [0, 1, 2, 3, 4, 5, 6, 7, 8],
				index: 0,
				switch2Checked: false
			}
		},

		onLoad() {},

		onShow() {
			this.notifyMonitorValueChange();
		},

		methods: {
			switch2Change(e) {
				console.log('开关e==>', e);

				this.switch2Checked = e.detail.value
			},

			bindPickerChange(e) {
				console.log('e=>', e);

				this.index = e.detail.value
			},

			startRead() {
				console.log('开始读取');
				veepooFeature.veepooSendReadB3AutoTestFeatureDataManager();
			},

			startSetup() {
				// 开始设置
				veepooFeature.veepooSendSetupB3AutoTestFeatureDataManager({
					"p_protocol_type": 0, // 不可修改
					"p_fun_type_content": this.index, // 功能类型 0~8数据对应 脉率、血压、血糖、压力、血氧、体温、洛伦兹散点图、HRV、血液成分  可修改
					"p_fun_switch": this.switch2Checked ? 1 : 0, // 0 关闭 1 开启  可修改
					"p_step_unit": 30, // 支持最小的步进，分 不可修改
					"p_time_slot_modify": 1, // 不可修改
					"p_time_interval_modify": 1, // 不可修改
					"p_support_time_slot": { // 支持测试的时间段  不可修改
						"startTime": "00:00", // 开始时间
						"stopTime": "00:00" // 结束时间
					},
					"p_meas_inv": 60, // 测量间隔 可修改  根据p_step_unit 大小  如30，那么间隔30
					"p_cur_time_slot": { // 当前的测试时间段 可修改
						"startTime": "00:00", // 开始时间
						"stopTime": "00:00" // 结束时间
					}
				})
			},

			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log("监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	.box {
		margin: 50px;
	}

	.item {
		line-height: 80rpx;
		font-size: 18px;
	}

	.btn {
		margin-top: 50rpx;
		background-color: #000000;
		width: 100px;
		height: 35px;
		text-align: center;
		margin: 50px auto;
		font-size: 14px;
		color: white;
	}

</style>
