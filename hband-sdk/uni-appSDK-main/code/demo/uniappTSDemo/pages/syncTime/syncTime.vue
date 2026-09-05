<template>
	<view class="sync-time">

		<view class="box-mode-state">
			<view class="section">
				<picker mode="date" :value="date" @change="bindDateChange">
					<view class="picker">
						日期选择: {{date}}
					</view>
				</picker>
			</view>
			<view class="section">
				<picker mode="time" :value="time" @change="bindTimeChange">
					<view class="picker">
						时间选择: {{time}}
					</view>
				</picker>
			</view>

		</view>


		<button style="margin: 30rpx auto;" @click="bindSyncTime">同步时间</button>

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
				date: "00-00-00",
				time: "00:00",
			}
		},

		onLoad() {

		},

		onShow() {
			let timestamp = Date.now();
			let date = new Date(timestamp);
			let year = date.getFullYear();
			let month = String(date.getMonth() + 1).padStart(2, '0');
			let day = String(date.getDate()).padStart(2, '0');
			let hours = String(date.getHours()).padStart(2, '0');
			let minutes = String(date.getMinutes()).padStart(2, '0');
			let seconds = String(date.getSeconds()).padStart(2, '0');

			this.date = `${year}-${month}-${day}`;
			this.time = `${hours}:${minutes}`;
		},

		methods: {
			bindSyncTime() {
				let date = this.date.split("-");
				let year = date[0];
				let month = date[1];
				let day = date[2];
				const time = this.time.split(":");
				let hours = time[0]
				let minutes = time[1]
				let timestamp = Date.now();
				let now = new Date(timestamp);
				let seconds = String(now.getSeconds()).padStart(2, '0');

				let data = {
					year: year,
					month: month,
					day: day,
					hour: hours, // 这里小时+1 为了区分当前时间与同步时间
					minute: minutes,
					second: seconds,
					format: 2, //  1 12小时制 2 24小时制
				}

				veepooFeature.veepooSendSyncTimeManager(data);
			},

			bindDateChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.date = e.detail.value;
			},
			bindTimeChange(e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.time = e.detail.value;
			},
		}
	}
</script>

<style>
	.box-mode-state {
		display: flex;
		justify-content: space-between;
		margin-bottom: 30rpx;
		margin-top: 30rpx;
	}

	.mode-state-item {
		width: 45%;
		height: 70rpx;
		background-color: #494949;
		color: white;
		line-height: 70rpx;
		text-align: center;
	}
</style>
