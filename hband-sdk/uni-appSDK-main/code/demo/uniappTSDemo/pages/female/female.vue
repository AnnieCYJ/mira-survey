<template>
	<view class="box">
		<view class="box-container" style="margin-top: 100rpx;">
			<view class="container-item">
				<view>经期天数：</view>
				<view><input type="text" class="inputValue" @input="inputValue1" placeholder="经期长度" /></view>
			</view>
			<view class="container-item">
				<view>间隔长度：</view>
				<view><input type="text" class="inputValue" @input="inputValue2" placeholder="经期间隔" /></view>
			</view>
			<view class="section">
				<picker mode="date" :value="date" @change="bindDateChange">
					<view class="picker">
						最近一次月经时间: {{date}}
					</view>
				</picker>
			</view>
			<button @click="sendData">只记经期</button>
		</view>
		<view class="box-container" style="margin-top: 100rpx;">
			<view class="container-item">
				<view>经期天数：</view>
				<view><input type="text" class="inputValue" @input="inputValue1" placeholder="经期长度" /></view>
			</view>
			<view class="container-item">
				<view>间隔长度：</view>
				<view><input type="text" class="inputValue" @input="inputValue2" placeholder="经期间隔" /></view>
			</view>
			<view class="section">
				<picker mode="date" :value="date" @change="bindDateChange">
					<view class="picker">
						最近一次月经时间: {{date}}
					</view>
				</picker>
			</view>
			<button @click="sendData2">备孕期</button>
		</view>
		<view class="box-container" style="margin-top: 100rpx;">
			<view class="section">
				<picker mode="date" :value="YCdate" @change="bindYCDateChange">
					<view class="picker">
						预产期: {{YCdate}}
					</view>
				</picker>
			</view>
			<button @click="sendYCData">怀孕期</button>
		</view>
		<view class="box-container" style="margin-top: 100rpx;">
			<view class="container-item">
				<view>经期天数：</view>
				<view><input type="text" class="inputValue" @input="inputValue1" placeholder="经期长度" /></view>
			</view>
			<view class="container-item">
				<view>间隔长度：</view>
				<view><input type="text" class="inputValue" @input="inputValue2" placeholder="经期间隔" /></view>
			</view>
			<view class="section">
				<picker mode="date" :value="date" @change="bindDateChange">
					<view class="picker">
						最近一次月经时间: {{date}}
					</view>
				</picker>
			</view>
			<view class="section">
				<picker mode="date" :value="BabyDate" @change="bindBabyDateChange">
					<view class="picker">
						宝宝出生日期: {{BabyDate}}
					</view>
				</picker>
			</view>
			<view class="container-item">
				<view>宝宝性别：</view>
				<view><input type="text" class="inputValue" @input="inputValue3" placeholder="1 男  2 女" /></view>
			</view>
			<button @click="sendBMData">宝妈期</button>
			<button @click="readData" style="margin-top: 50rpx;">读取女性经期</button>
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
				value1: '',
				value2: '',
				value3: '',
				date: '',
				YCdate: '',
				BabyDate: ''
			}
		},
		onLoad() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			inputValue1(e) {
				let self = this;
				self.value1 = e.detail.value;
			},
			inputValue2(e) {
				let self = this;
				self.value2 = e.detail.value;
			},
			inputValue3(e) {
				let self = this;
				self.value3 = e.detail.value;
			},
			sendData() {
				let self = this;
				let data = {
					deviceControl: '01',
					menstruationTime: self.date,
					menstruationLength: self.value1,
					menstruationInterval: self.value2
				}
				console.log("data=>", data)
				veepooFeature.veepooSendFemaleInstructionsDataManager(data)
			},
			sendData2() {
				let self = this;
				let data = {
					deviceControl: '02',
					menstruationTime: self.date,
					menstruationLength: self.value1,
					menstruationInterval: self.value2
				}
				console.log("data=>", data)
				veepooFeature.veepooSendFemaleInstructionsDataManager(data)
			},
			sendYCData() {
				let self = this;
				let data = {
					deviceControl: '03',
					menstruationTime: self.YCdate
				}
				veepooFeature.veepooSendFemaleInstructionsDataManager(data)
			},
			readData() {
				let data = {
					deviceControl: '05',
				}
				let result = veepooFeature.veepooSendFemaleInstructionsDataManager(data);
				console.log('result==>', result)
			},
			sendBMData() {
				let self = this;
				let data = {
					deviceControl: '04',
					menstruationTime: self.date,
					menstruationLength: self.value1,
					menstruationInterval: self.value2,
					babySex: self.value3,
					babyDateBirth: self.BabyDate
				}
				console.log("data=>", data)
				veepooFeature.veepooSendFemaleInstructionsDataManager(data)
			},
			bindDateChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.date = e.detail.value;
			},
			bindYCDateChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.YCdate = e.detail.value;
			},
			bindBabyDateChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.BabyDate = e.detail.value;
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	.box {
		padding: 30rpx;
	}

	.box-container {
		line-height: 100rpx;
	}

	.container-item {
		display: flex;
	}

	.inputValue {
		background-color: aliceblue;
		padding: 10prx 20rpx;
		margin-top: 30rpx;
	}
</style>
