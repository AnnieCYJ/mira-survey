<template>
	<view class="box">
		<view class="unit-setting">
			<view class="unit-item">
				<view class="item-left">长度单位</view>
				<view class="item-left">
					<picker @change="bindPickerChange1" :value="index" :range="array1">
						<view class="picker">
							{{unitLength}}
						</view>
					</picker>
				</view>
			</view>
			<view class="unit-item">
				<view class="item-left">体温单位</view>
				<view class="item-left">
					<picker @change="bindPickerChange2" :value="index" :range="array2">
						<view class="picker">
							{{unitBodyTemperature}}
						</view>
					</picker>
				</view>
			</view>
			<view class="unit-item">
				<view class="item-left">血糖单位</view>
				<view class="item-left">
					<picker @change="bindPickerChange3" :value="index" :range="array3">
						<view class="picker">
							{{unitBloodSugar}}
						</view>
					</picker>
				</view>
			</view>
			<view class="unit-item">
				<view class="item-left">尿酸单位</view>
				<view class="item-left">
					<picker @change="bindPickerChange4" :value="index" :range="array4">
						<view class="picker">
							{{unitUricAcid}}
						</view>
					</picker>
				</view>
			</view>
			<view class="unit-item">
				<view class="item-left">血脂单位</view>
				<view class="item-left">
					<picker @change="bindPickerChange5" :value="index" :range="array5">
						<view class="picker">
							{{unitBloodLipid}}
						</view>
					</picker>
				</view>
			</view>
		</view>

		<button style="margin-top: 50rpx;" @click="settingData">更改</button>
		<button style="margin-top: 50rpx;" @click="unitReadData">读取单位</button>
	</view>
</template>

<script>
	// 引入方式二：
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {
				unitLength: '公制(米,千米)', // 长度 1，表示公制(默认) 2，表示英制
				unitBodyTemperature: '摄氏度', // 体温 1 摄氏度  2 华氏度
				unitBloodSugar: 'mmol/L', // 血糖 1 mmol/L  2 mg/dl
				unitUricAcid: 'μmol/L', // 尿酸 1 μmol/L  2 mg/dl
				unitBloodLipid: 'mmol/L', // 血脂 1 mmol/L  2 mg/dl
				array1: ['公制(米,千米)', '英制(英尺,英里)'],
				array2: ['摄氏度', '华氏度'],
				array3: ['mmol/L', 'mg/dl'],
				array4: ['μmol/L', 'mg/dl'],
				array5: ['mmol/L', 'mg/dl']
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange();

			this.unitReadData()
		},
		methods: {
			bindPickerChange1(e) {
				let index = Number(e.detail.value);
				this.unitLength = this.array1[index]
			},
			bindPickerChange2(e) {
				let index = Number(e.detail.value);
				this.unitBodyTemperature = this.array2[index]
			},
			bindPickerChange3(e) {
				let index = Number(e.detail.value);
				this.unitBloodSugar = this.array3[index]
			},
			bindPickerChange4(e) {
				let index = Number(e.detail.value);
				this.unitUricAcid = this.array4[index]
			},
			bindPickerChange5(e) {
				let index = Number(e.detail.value);
				this.unitBloodLipid = this.array5[index]
			},
			settingData() {
				let unitLength = this.unitLength == '公制(米,千米)' ? 'metricSystem' : 'english';
				let unitBodyTemperature = this.unitBodyTemperature == '摄氏度' ? 'degreeCelsius' : 'fahrenheit';
				let unitBloodSugar = this.unitBloodSugar;
				let unitUricAcid = this.unitUricAcid;
				let unitBloodLipid = this.unitBloodLipid;
				// 参数
				let data = {
					unitLength,
					unitBodyTemperature,
					unitBloodSugar,
					unitUricAcid,
					unitBloodLipid,
				}
				veepooFeature.veepooSendUnitSettingDataManager(data);
			},
			unitReadData() {
				veepooFeature.veepooSendReadDeviceUnitSettingDataManager();
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" 单位设置 监听蓝牙回调=>", e);
					if (e.type == 11) {
						if (e.settingStatus) {
							uni.showToast({
								title: '设置成功',
								icon: 'none'
							})
						}

					}

				})
			},
		}
	}
</script>

<style>
	.box {
		padding: 30rpx 40rpx;
	}

	.unit-item {
		display: flex;
		justify-content: space-between;
		border-bottom: 0.5px solid #d8d8d8;
		height: 35px;
		line-height: 35px;
	}
</style>
