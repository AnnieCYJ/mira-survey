<template>
	<view>
		<view class="box-input">
			<form @submit="onSubmit">
				<view class="input">
					<text>身高：</text>
					<input type="number" name="height" placeholder="请输入身高！" />cm
				</view>
				<view class="input">
					<text>体重：</text>
					<input type="number" name="weight" placeholder="请输入体重！" />kg
				</view>
				<view class="input">
					<text>年龄：</text>
					<input type="number" name="age" placeholder="请输入年龄！" />
				</view>
				<view class="input">
					<text>性别：</text>
					<input type="number" name="sex" placeholder="0 女  1 男" />
				</view>
				<view class="input">
					<text>目标步数：</text>
					<input type="number" name="steps" placeholder="如4000步" />
				</view>
				<view class="input">
					<text>目标睡眠：</text>
					<input type="number" name="sleep" placeholder="如60分钟" />
				</view>
				<button form-type="submit">开始同步</button>
			</form>

		</view>

	</view>
</template>

<script>
	// pages/personalInfo/index.js
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

		onLoad() {

		},

		onShow() {
			this.notifyMonitorValueChange();
			let value = 123;
			let val = ''
			if (typeof value != 'string') {
				val = String(value)
			} else {
				val = value
			}

			let hex = value.toString(16);
		},

		methods: {
			onSubmit(e) {
				let info = e.detail.value;
				console.log(info);
				if (!info.height || !info.weight || !info.age || !info.sex || !info.steps || !info.sleep) {
					uni.showToast({
						title: '请输入完成相应值在提交！',
						icon: 'none'
					})
					return
				}

				let data = {
					height: info.height,
					weight: info.weight,
					age: info.age,
					sex: info.sex,
					steps: info.steps,
					sleep: info.sleep
				}
				veepooFeature.veepooSynchronizingPersonalInformationManager(data);
			},
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("同步个人信息 监听蓝牙回调=>", e);
					if (e.content.settingState) {
						uni.showToast({
							title: '同步成功',
							icon: 'none'
						})
					}
					if (e) {
						self.device = e;
					}
				})
			},
		}
	}
</script>

<style>
	.box-input {
		padding: 20rpx 50rpx;
	}

	.input {
		display: flex;
		height: 40px;
		line-height: 40px;
	}

	input {
		margin-top: 25rpx;
		background-color: #e7e7e7;
	}
</style>
