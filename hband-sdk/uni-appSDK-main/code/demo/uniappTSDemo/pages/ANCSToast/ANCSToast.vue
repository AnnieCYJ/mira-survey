<template>
	<view class="box">
		<view class="box-btn">
			<view class="btn-left" @click="allStart">全部打开</view>
			<view class="btn-left" @click="allStop">全部关闭</view>
		</view>

		<view class="content">
			<view class="content-item" v-for="(item,index) in toastList" :key="index">
				<view class="item-name">{{item.name}}</view>
				<view class="item-switch">
					<!-- 微信端原写法 bindchange="{{item.bindTap}}" 为动态方法名派发，迁移到 Vue 后统一改为单一处理函数 -->
					<switch :checked="item.status" @change="onSwitchChange(item, $event)" />
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	// pages/universalBlood/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'
	export default {
		data() {
			return {
				datas: {
					VPSettingCall: 'start',
					VPSettingSMS: 'stop',
					VPSettingWechat: 'stop',
					VPSettingQQ: 'stop',
					VPSettingSina: 'stop',
					VPSettingFaceBook: 'stop',
					VPSettingTwitter: 'stop',
					VPSettingFlickr: 'stop',
					VPSettingLinkedln: 'stop',
					VPSettingwhatsapp: 'stop',
					VPSettingLine: 'stop',
					VPSettingInstagram: 'stop',
					VPSettingSnapchat: 'stop',
					VPSettingSkype: 'stop',
					VPSettingGMail: 'stop',
					VPSettingDingTalk: 'stop',
					VPSettingWeChatWork: 'stop',
					VPSettingOtherTikTok: 'stop',
					VPSettingOtherTelegram: 'stop',
					VPSettingOtherConnected2: 'stop',
					VPSettingKakaoTalk: 'stop',
					VPSettingJingYou: 'stop',
					VPSettingMessenger: 'stop',
					VPSettingOthers: 'stop'
				},
				toastList: [{
						name: '来电',
						bindTap: 'bindLaidian',
						status: false,
					},
					{
						name: '短信',
						bindTap: 'bindDuanxing',
						status: false
					},
					{
						name: '微信',
						bindTap: 'bindWechat',
						status: false
					},
					{
						name: 'QQ',
						bindTap: 'bindQQ',
						status: false
					},
					{
						name: 'Sina',
						bindTap: 'bindSina',
						status: false
					},
					{
						name: 'FaceBook',
						bindTap: 'bindFaceBook',
						status: false
					},
					{
						name: 'Twitter',
						bindTap: 'bindTwitter',
						status: false
					},
					{
						name: 'Flickr',
						bindTap: 'bindFlickr',
						status: false
					},
					{
						name: 'Linkedln',
						bindTap: 'bindLinkedln',
						status: false
					},
					{
						name: 'whatsapp',
						bindTap: 'bindWhatsapp',
						status: false
					},
					{
						name: 'Line',
						bindTap: 'bindLine',
						status: false
					},
					{
						name: 'Instagram',
						bindTap: 'bindInstagram',
						status: false
					},
					{
						name: 'Snapchat',
						bindTap: 'bindSnapchat',
						status: false
					},
					{
						name: 'Skype',
						bindTap: 'bindSkype',
						status: false
					},
					{
						name: 'Gmail',
						bindTap: 'bindGmail',
						status: false
					},
					{
						name: '钉钉',
						bindTap: 'bindDingDing',
						status: false
					},
					{
						name: '企业微信',
						bindTap: 'bindQiyeweixin',
						status: false
					},
					{
						name: 'tiktok',
						bindTap: 'bindTiktok',
						status: false
					},
					{
						name: 'telegram',
						bindTap: 'bindTelegram',
						status: false
					},
					{
						name: 'connected2',
						bindTap: 'bindConnected2',
						status: false
					},
					{
						name: 'KakaoTalk',
						bindTap: 'bindKakaoTalk',
						status: false
					},
					{
						name: '警右',
						bindTap: 'bindJinyou',
						status: false
					},
					{
						name: 'Messenger',
						bindTap: 'bindMessenger',
						status: false
					},
					{
						name: '其他应用',
						bindTap: 'bindOthers',
						status: false
					},
				]
			}
		},
		onLoad() {

		},
		onReady() {

		},
		onShow() {
			this.notifyMonitorValueChange();
			// let str = 'ad010101010100010100010101010101010000'
			let str = 3
			console.log("this.judgePackage('01')=>", this.convertToBinaryAndShift(str))
		},
		methods: {
			convertToBinaryAndShift(input) {
				// 转换为二进制
				let binary = (input >>> 0).toString(2);
				return {
					binary: binary
				};
			},
			allStop() {
				let datas = {
					VPSettingCall: 'stop',
					VPSettingSMS: 'stop',
					VPSettingWechat: 'stop',
					VPSettingQQ: 'stop',
					VPSettingSina: 'stop',
					VPSettingFaceBook: 'stop',
					VPSettingTwitter: 'stop',
					VPSettingFlickr: 'stop',
					VPSettingLinkedln: 'stop',
					VPSettingwhatsapp: 'stop',
					VPSettingLine: 'stop',
					VPSettingInstagram: 'stop',
					VPSettingSnapchat: 'stop',
					VPSettingSkype: 'stop',
					VPSettingGMail: 'stop',
					VPSettingDingTalk: 'stop',
					VPSettingWeChatWork: 'stop',
					VPSettingOtherTikTok: 'stop',
					VPSettingOtherTelegram: 'stop',
					VPSettingOtherConnected2: 'stop',
					VPSettingKakaoTalk: 'stop',
					VPSettingJingYou: 'stop',
					VPSettingMessenger: 'stop',
					VPSettingOthers: 'stop'
				}
				veepooFeature.veepooSendANCSSwitchControlDataManager(datas)
			},
			allStart() {
				let datas = {
					VPSettingCall: 'start',
					VPSettingSMS: 'start',
					VPSettingWechat: 'start',
					VPSettingQQ: 'start',
					VPSettingSina: 'start',
					VPSettingFaceBook: 'start',
					VPSettingTwitter: 'start',
					VPSettingFlickr: 'start',
					VPSettingLinkedln: 'start',
					VPSettingwhatsapp: 'start',
					VPSettingLine: 'start',
					VPSettingInstagram: 'start',
					VPSettingSnapchat: 'start',
					VPSettingSkype: 'start',
					VPSettingGMail: 'start',
					VPSettingDingTalk: 'start',
					VPSettingWeChatWork: 'start',
					VPSettingOtherTikTok: 'start',
					VPSettingOtherTelegram: 'start',
					VPSettingOtherConnected2: 'start',
					VPSettingKakaoTalk: 'start',
					VPSettingJingYou: 'start',
					VPSettingMessenger: 'start',
					VPSettingOthers: 'start'
				}
				veepooFeature.veepooSendANCSSwitchControlDataManager(datas)
			},

			// 微信端 switch 的 bindchange 通过 item.bindTap 动态派发到下面各 bindXxx 方法，
			// 它们全部仅转发到 totalBindTap。Vue 中改为统一入口 onSwitchChange 直接传入 item。
			onSwitchChange(item, e) {
				this.totalBindTap(item, e);
			},

			totalBindTap(item, e) {
				let deviceSwitch = e.detail.value;
				let name = item.name
				let toastList = this.toastList;
				toastList.forEach((it) => {
					if (it.name == name) {
						it.status = deviceSwitch
					}
				})
				this.toastList = [...toastList]
				this.sendChangeValue()
			},

			getSwitchStatus(bool) {
				if (bool) {
					return 'start'
				} else {
					return 'stop'
				}
			},
			sendChangeValue() {
				let data = this.datas;
				let toastList = this.toastList;
				data.VPSettingCall = this.getSwitchStatus(toastList[0].status)
				data.VPSettingSMS = this.getSwitchStatus(toastList[1].status)
				data.VPSettingWechat = this.getSwitchStatus(toastList[2].status)
				data.VPSettingQQ = this.getSwitchStatus(toastList[3].status)
				data.VPSettingSina = this.getSwitchStatus(toastList[4].status)
				data.VPSettingFaceBook = this.getSwitchStatus(toastList[5].status)
				data.VPSettingTwitter = this.getSwitchStatus(toastList[6].status)
				data.VPSettingFlickr = this.getSwitchStatus(toastList[7].status)
				data.VPSettingLinkedln = this.getSwitchStatus(toastList[8].status)
				data.VPSettingwhatsapp = this.getSwitchStatus(toastList[9].status)
				data.VPSettingLine = this.getSwitchStatus(toastList[10].status)
				data.VPSettingInstagram = this.getSwitchStatus(toastList[11].status)
				data.VPSettingSnapchat = this.getSwitchStatus(toastList[12].status)
				data.VPSettingSkype = this.getSwitchStatus(toastList[13].status)
				data.VPSettingGMail = this.getSwitchStatus(toastList[14].status)
				data.VPSettingDingTalk = this.getSwitchStatus(toastList[15].status)
				data.VPSettingWeChatWork = this.getSwitchStatus(toastList[16].status)
				data.VPSettingOtherTikTok = this.getSwitchStatus(toastList[17].status)
				data.VPSettingOtherTelegram = this.getSwitchStatus(toastList[18].status)
				data.VPSettingOtherConnected2 = this.getSwitchStatus(toastList[19].status)
				data.VPSettingKakaoTalk = this.getSwitchStatus(toastList[20].status)
				data.VPSettingJingYou = this.getSwitchStatus(toastList[21].status)
				data.VPSettingMessenger = this.getSwitchStatus(toastList[22].status)
				data.VPSettingOthers = this.getSwitchStatus(toastList[23].status)
				console.log("data=====>", data)
				veepooFeature.veepooSendANCSSwitchControlDataManager(data)
			},


			// 保留各应用独立的转发方法（与微信端结构一致，均仅转发到 totalBindTap）
			bindLaidian(e) {
				this.totalBindTap(this.toastList[0], e);
			},
			bindDuanxing(e) {
				this.totalBindTap(this.toastList[1], e);
			},
			bindWechat(e) {
				this.totalBindTap(this.toastList[2], e);
			},
			bindQQ(e) {
				this.totalBindTap(this.toastList[3], e);
			},
			bindSina(e) {
				this.totalBindTap(this.toastList[4], e);
			},
			bindFaceBook(e) {
				this.totalBindTap(this.toastList[5], e);
			},
			bindTwitter(e) {
				this.totalBindTap(this.toastList[6], e);
			},
			bindLinkedln(e) {
				this.totalBindTap(this.toastList[8], e);
			},
			bindWhatsapp(e) {
				this.totalBindTap(this.toastList[9], e);
			},
			bindLine(e) {
				this.totalBindTap(this.toastList[10], e);
			},
			bindInstagram(e) {
				this.totalBindTap(this.toastList[11], e);
			},
			bindSnapchat(e) {
				this.totalBindTap(this.toastList[12], e);
			},
			bindSkype(e) {
				this.totalBindTap(this.toastList[13], e);
			},
			bindGmail(e) {
				this.totalBindTap(this.toastList[14], e);
			},
			bindDingDing(e) {
				this.totalBindTap(this.toastList[15], e);
			},
			bindQiyeweixin(e) {
				this.totalBindTap(this.toastList[16], e);
			},
			bindTiktok(e) {
				this.totalBindTap(this.toastList[17], e);
			},
			bindTelegram(e) {
				this.totalBindTap(this.toastList[18], e);
			},
			bindConnected2(e) {
				this.totalBindTap(this.toastList[19], e);
			},
			bindKakaoTalk(e) {
				this.totalBindTap(this.toastList[20], e);
			},
			bindJinyou(e) {
				this.totalBindTap(this.toastList[21], e);
			},
			bindMessenger(e) {
				this.totalBindTap(this.toastList[22], e);
			},
			bindOthers(e) {
				this.totalBindTap(this.toastList[23], e);
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
		padding: 20px;
	}

	.box-btn {
		display: flex;
		justify-content: space-around;
	}

	.btn-left {
		width: 40%;
		background-color: rgb(0, 102, 192);
		height: 80rpx;
		color: white;
		border-radius: 15rpx;
		text-align: center;
		line-height: 80rpx;
	}

	.content-item {
		height: 100rpx;
		display: flex;
		justify-content: space-between;
		line-height: 100rpx;
		border-bottom: 1px solid #d1d1d1;
	}
</style>
