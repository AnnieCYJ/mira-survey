<template>
	<view>
		<view class="box-btn">
			<button @click="ReadContactPersonDataManager">读取联系人</button>
		</view>
		<view style="margin: 50rpx 30rpx;">
			<view class="ItemInput">
				<view>联系人姓名：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getName" type="text"
						placeholder="姓名" /></view>
			</view>
			<view class="ItemInput">
				<view>电话号码：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getPhone" type="text"
						placeholder="手机号码" /></view>
			</view>

			<view class="ItemInput">
				<view>是否设置为紧急联系人：</view>
				<switch :checked="sos" @change="getSOS" />
			</view>


			<view class="ItemInput">
				<view>被编辑联系人Id：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getPhoneId" type="number"
						placeholder="添加联系人可不填" /></view>
			</view>
		</view>
		<view class="box-btn">
			<button @click="SettingContactPersonDataManager">设置联系人</button>
		</view>
		<view class="box-btn">
			<button @click="editContactPerson">编辑联系人</button>
		</view>
		<view style="margin: 50rpx 20rpx;">
			<view class="ItemInput">
				<view>删除联系人ID：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="deleteId" type="text"
						placeholder="联系人id" /></view>
			</view>
		</view>
		<view class="box-btn">
			<button @click="deleteContactPersonDataManager">删除联系人</button>
		</view>
		<view style="margin: 50rpx 20rpx;">
			<view class="ItemInput">
				<view>需要调整的id：</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getFromId" type="text"
						placeholder="调整id" /></view>
			</view>
			<view class="ItemInput">
				<view>目标id:</view>
				<view><input style="background-color: aliceblue; padding: 15rpx;" @input="getToId" type="text"
						placeholder="目标id" /></view>
			</view>
		</view>
		<view class="box-btn">
			<button @click="AdjustContactPersonDataManager">调整联系人</button>
		</view>

		<view class="box-info">
			<view class="info-item" v-for="(item,index) in readList" :key="index">
				<view>手机号：{{item.phone}}</view> <text>id: {{item.id}}</text>
				<view>姓名：{{item.name}}</view>
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
				readList: [],
				sos: false,
				phone: '',
				name: '',
				delId: '',
				fromId: '',
				toId: '',
				phoneId: 0,
			}
		},
		onLoad(options) {

		},
		onReady() {

		},
		onShow() {
			this.notifyMonitorValueChange()
		},
		methods: {
			ReadContactPersonDataManager() {
				veepooFeature.veepooSendReadContactPersonDataManager();
			},
			SettingContactPersonDataManager() {
				let readList = this.readList;
				console.log("readList=>", readList.length + 1)

				// 注意：添加联系人，已有的联系人id 假设是1  那么在添加一个联系人的contactNumber 应该传入2
				let data = {
					isEdit: false,
					contactNumber: readList.length,
					name: this.name,
					phone: this.phone,
					sos: this.sos, // 设置为紧急联系人
				}
				console.log("data=>", data)
				if (!data.phone && !data.name) {
					uni.showToast({
						title: '填写手机号或名称',
						icon: 'none'
					})
					return
				}
				veepooFeature.veepooSendSettingContactPersonDataManager(data)

				setTimeout(() => {
					veepooFeature.veepooSendReadContactPersonDataManager();
				}, 1000);
			},

			editContactPerson() {
				let readList = this.readList;
				console.log("readList=>", readList.length + 1)

				// 注意：编辑联系人，因SDK内部做了自增，所以填入id需要减1，如id 是 2 则 填 1
				let data = {
					isEdit: true,
					contactNumber: Number(this.phoneId) - 1,
					name: this.name,
					phone: this.phone,
					sos: this.sos, // 设置为紧急联系人
				}
				console.log("data=>", data)
				if (!data.phone && !data.name) {
					uni.showToast({
						title: '填写手机号或名称',
						icon: 'none'
					})
					return
				}
				veepooFeature.veepooSendSettingContactPersonDataManager(data)

				setTimeout(() => {
					veepooFeature.veepooSendReadContactPersonDataManager();
				}, 1000);
			},


			deleteId(e) {
				let delId = e.detail.value;
				this.delId = delId
			},

			deleteContactPersonDataManager() {
				let data = {
					sosId: this.delId
				}
				veepooFeature.veepooSendDeleteContactPersonDataManager(data);
				setTimeout(() => {
					veepooFeature.veepooSendReadContactPersonDataManager();
				}, 1000);
			},
			AdjustContactPersonDataManager() {
				let readList = this.readList;
				console.log('readList.length=>', readList.length)
				if (readList.length == 1) {
					uni.showToast({
						title: '请先添加更多的联系人',
						icon: 'none'
					})
					return
				}
				let data = {
					fromId: this.fromId, // 需要调整的id
					toId: this.toId // 目标位置id
				}
				veepooFeature.veepooSendAdjustContactPersonDataManager(data)
				setTimeout(() => {
					veepooFeature.veepooSendReadContactPersonDataManager();
				}, 1000);
			},
			getFromId(e) {
				let fromId = e.detail.value;
				this.fromId = fromId
			},
			getToId(e) {
				let toId = e.detail.value;
				this.toId = toId
			},
			getSOS(e) {
				let sos = e.detail.value;
				this.sos = sos
			},

			getPhone(e) {
				let phone = e.detail.value;
				this.phone = phone
			},

			getPhoneId(e) {
				let phoneId = e.detail.value;
				this.phoneId = phoneId
			},

			getName(e) {
				let name = e.detail.value;
				this.name = name
			},
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" 读取联系人 监听蓝牙回调=>", e);

					if (!e) {
						return
					}

					if (e.name == '读取联系人') {
						self.readList = e.content
					}
				})
			},
		}
	}
</script>

<style>
	.box-btn {
		margin-bottom: 30rpx;
	}

	.box-info {
		padding: 50rpx;
	}

	.info-item {
		border-bottom: 1px solid #e4e4e4;
	}

	.ItemInput {
		display: flex;
		margin: 10rpx;
	}
</style>
