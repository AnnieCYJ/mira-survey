<template>
	<view>
		<view class="box-btn">
			<button @click="read4GService">读取4G服务信息</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GService">设置4G服务信息</button>
		</view>

		<view class="section">
			<view class="section__title">4G开关：</view>
			<switch :checked="switchStatus" @change="bindSwitchChange" />
		</view>

		<view class="box-btn">
			<button @click="setup4GSwitch">设置4G服务开关</button>
		</view>

		<view class="section">
			<view class="section__title">4G上传开关：</view>
			<switch :checked="dataUploadSwitch" @change="bindUploadSwitchChange" />
		</view>

		<view class="box-btn">
			<button @click="setup4GUploadSwitch">设置4G服务上传开关</button>
		</view>

		<view class="section">
			<view class="section__title">4G账号是否有效：</view>
			<switch :checked="accountStatus" @change="bindAccountStatusChange" />
		</view>

		<view class="box-btn">
			<button @click="setup4GAccountStatus">设置4G服务账号是否有效</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GServiceInterval">设置4G服务上传间隔</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GTimeStamp">设置4G服务时间戳</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GUserName">设置4G用户名称</button>
		</view>


		<view class="box-btn">
			<button @click="setup4GIpAddress">设置4G服务IP</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GPort">设置4G服务端口</button>
		</view>

		<view class="box-btn">
			<button @click="setup4GPassword">设置4G服务密码</button>
		</view>

	</view>
</template>

<script>
	// pages/4GService/Index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	export default {
		data() {
			return {
				switchStatus: false, // 4G开关
				dataUploadSwitch: false, // 4G上传开关
				accountStatus: false, // 账号是否有效
			}
		},

		onLoad() {},

		onShow() {
			this.notifyMonitorValueChange();
		},

		methods: {
			read4GService() {
				veepooFeature.veepooRead4GServiceDataManager();
			},

			setup4GService() {
				// 参数可选，
				veepooFeature.veepooSetup4GServiceInfoManager({
					ipAddress: "vphband.com", // ip地址
					port: 34421, // 端口
					userName: "你丫的我绑定账号了", // 用户名
					password: "YOUR_4G_PASSWORD", // 密码
					// switch: 1, // 开关  0 关闭 1 开启
					// dataUploadSwitch: 1, // 数据上传开关 0 关闭 1 开启
					// uploadInterval: 10, // 上传间隔 分钟
					// accountStatus: 1, // 账号是否有效 0 无效 1 有效
				});
			},

			// 更新用户名称
			setup4GUserName() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					userName: `绑定了账号${Math.floor(1000 + Math.random() * 9000)}`, // 用户名
				})
			},

			// 更新ip地址
			setup4GIpAddress() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					ipAddress: "vpgband.com", // ip地址
				})
			},

			// 端口
			setup4GPort() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					port: 34425, // 端口
				})
			},

			// 密码
			setup4GPassword() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					password: "YOUR_4G_PASSWORD", // 密码
				})
			},

			bindSwitchChange(e) {
				let self = this;
				console.log("e=>", e);
				self.switchStatus = e.detail.value
			},

			bindUploadSwitchChange(e) {
				let self = this;
				console.log("e=>", e);
				self.dataUploadSwitch = e.detail.value
			},

			// 4G开关设置
			setup4GSwitch() {
				let self = this;
				veepooFeature.veepooSetup4GServiceInfoManager({
					switch: self.switchStatus ? 1 : 0, // 0 关闭 1 开启
				})
			},

			// 4G上传开关设置
			setup4GUploadSwitch() {
				let self = this;
				veepooFeature.veepooSetup4GServiceInfoManager({
					dataUploadSwitch: self.dataUploadSwitch ? 1 : 0, // 0 关闭 1 开启
				})
			},

			bindAccountStatusChange(e) {
				let self = this;
				console.log("e=>", e);
				self.accountStatus = e.detail.value
			},

			// 4G账号是否有效
			setup4GAccountStatus() {
				let self = this;
				veepooFeature.veepooSetup4GServiceInfoManager({
					accountStatus: self.accountStatus ? 1 : 0, // 0 关闭 1 开启
				})
			},

			// 4G服务间隔设置
			setup4GServiceInterval() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					uploadInterval: 30, //
				})
			},

			// 设置时间戳相关
			setup4GTimeStamp() {
				veepooFeature.veepooSetup4GServiceInfoManager({
					lastTimeStamp: 1767606251, //  APP或设备最后一次同步服务器的时间戳  秒级
					restoreTimeStamp: 1767839964,
				})
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log(" ss 监听蓝牙回调=>", e);
				})
			},
		}
	}
</script>

<style>
	.box-btn {
		margin: 20rpx auto;
	}

	.box-info {
		padding: 50rpx;
	}

	.info-item {
		border-bottom: 1px solid #e4e4e4;
	}

	.ItemInput {
		display: flex;
		margin-top: 40rpx;
	}

	.box {
		padding: 50rpx;
	}

	.section {
		display: flex;
		line-height: 100rpx;
	}

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
		padding: 15rpx 30rpx;
	}

	.data-item {
		line-height: 30px;
	}

</style>
