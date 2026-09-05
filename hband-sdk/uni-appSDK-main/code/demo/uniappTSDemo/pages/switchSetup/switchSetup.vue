<template>
	<view class="box">
		<view class="tip">开关禁用表示设备不支持对应开关</view>
		<view class="box-item" v-for="(item, index) in switchList" :key="index">
			<view>{{item.label}}</view>
			<view>
				<switch :checked="item.checked" :disabled="item.disabled" @change="onSwitchChange(index, $event)" />
			</view>
		</view>
	</view>
</template>

<script>
	// 引入方式二：
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	// 开关配置：label(显示名称), sdkKey(下发指令key), responseKey(设备返回key), pkg(所属包序号)
	const SWITCH_CONFIG = [
		{ label: '心率自动检测', sdkKey: 'heartRate', responseKey: 'VPSettingAutomaticHRTest', pkg: 0 },
		{ label: '血压自动检测', sdkKey: 'bloodPressure', responseKey: 'VPSettingAutomaticBPTest', pkg: 0 },
		{ label: '科学睡眠', sdkKey: 'scientificSleep', responseKey: 'VPSettingAutomaticPPGTest', pkg: 0 },
		{ label: '体温自动检测', sdkKey: 'bodyTemperature', responseKey: 'VPSettingAutomaticTemperatureTest', pkg: 1 },
		{ label: '血糖自动检测', sdkKey: 'bloodGlucose', responseKey: 'VPSettingAutomaticBloodGlucoseTest', pkg: 1 },
		{ label: '血液自动检测', sdkKey: 'bloodComponents', responseKey: 'VPSettingAutomaticBloodCompTest', pkg: 1 },
		{ label: '压力自动检测', sdkKey: 'pressure', responseKey: 'VPSettingPressureFunctionSwitch', pkg: 1 },
		{ label: '跌倒提醒', sdkKey: 'fallWarning', responseKey: 'VPSettingFallWarning', pkg: 1 },
		{ label: '缺氧提醒', sdkKey: 'lowOxygen', responseKey: 'VPSettingOxygenLowerRemind', pkg: 0 },
		{ label: 'HRV自动检测', sdkKey: 'hrv', responseKey: 'VPSettingAutomaticHRVTest', pkg: 0 },
	]

	export default {
		data() {
			return {
				switchList: SWITCH_CONFIG.map(item => ({
					label: item.label,
					checked: false,
					disabled: true,
				})),
			}
		},
		onShow() {
			this.notifyMonitorValueChange()
			veepooFeature.veepooSendReadDeviceUnitSettingDataManager()
		},
		methods: {
			onSwitchChange(index, e) {
				const value = e.detail.value
				this.switchList[index].checked = value
				veepooFeature.veepooSendAutoTestSwitchDataManager({
					[SWITCH_CONFIG[index].sdkKey]: value ? 'start' : 'stop'
				})
			},
			notifyMonitorValueChange() {
				const self = this
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					if (e.type == 11) {
						console.log('公英制新增开关回调=>', e)
						const content = e.content
						if (!content) return

						SWITCH_CONFIG.forEach((item, index) => {
							if (item.pkg !== e.package) return
							const value = content[item.responseKey]
							if (value !== undefined) {
								self.switchList[index].checked = value === 'open'
								self.switchList[index].disabled = value === 'noThisFeature'
							}
						})
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

	.tip {
		text-align: center;
		font-size: 24rpx;
		color: #999;
		padding-bottom: 20rpx;
	}

	.box-item {
		display: flex;
		justify-content: space-between;
		line-height: 100rpx;
		border-bottom: 1px solid #d3d3d3;
	}
</style>
