<template>
	<view style="margin-top: 40rpx;">
		<text></text>
		<button @click="setJLVerify">杰里认证</button>
	</view>

	<view style="margin-top: 40rpx;">
		<button @click="getDailList">获取表盘列表</button>
	</view>

	<view class="item-containt">
		<view class="item-line-view" @click="clickAddDial">
			<view class="l">
				<image class="item-icon" src="../../image/icon_setting.png"></image>
				<text>添加表盘</text>
			</view>
			<image class="item-icon-next" src="../../image/icon_return.png"></image>
		</view>
	</view>

	<view class="item-containt">
		<view class="item-line-view" @click="clickAddDialBackground">
			<view class="l">
				<image class="item-icon" src="../../image/icon_setting.png"></image>
				<text>添加表盘背景</text>
			</view>
			<image class="item-icon-next" src="../../image/icon_return.png"></image>
		</view>
	</view>

	<view class="item-containt">
		<view class="part-title">表盘列表</view>

		<view v-for="(item, index) in dialList" :key="index" class="item-line-view" @click="clickDialMoreOperate"
			:data-index="index">
			<view class="l">
				<image class="item-icon" src="../../image/icon_setting.png"></image>
				<text>{{ item.name }}</text>
			</view>
			<image v-if="item.name == useDial" class="item-icon-choose" src="../../image/icon_choose.png"></image>
		</view>
	</view>

	<view class="item-containt">
		<view class="part-title">自定义表盘背景列表</view>

		<view v-for="(item, index) in customBackgroundList" :key="index" class="item-line-view"
			@click="clickDialBackground" :data-index="index">
			<view class="l">
				<image class="item-icon" src="../../image/icon_setting.png"></image>
				<text>{{ item.name }}</text>
			</view>
		</view>
	</view>
</template>

<script lang="ts">
	import {
		RCSPOpWatchDial
	} from "../../jieli_sdk/lib/rcsp-impl/rcsp";
	import {
		RCSPManager,
		RCSP
	} from "../../jieli_sdk/lib/rcsp-impl/rcsp"
	import {
		OPWatchDial,
		OPDirectoryBrowse
	} from "../../jieli_sdk/jl_lib/jl-rcsp-op/jl_op_watch_1.1.0";

	import {
		BleDataHandler
	} from '../../jieli_sdk/lib/ble-data-handler'
	import {
		showActionSheet
	} from "../../jieli_sdk/utils/util";
	import {
		veepooJLGetDialListManager,
		veepooJLSetToCurrentUseManager,
		veepooJLDeleteDialManager,
		veepooJLGetDialVersionInfoManager,
		veepooJLGetDialBackgroundManager,
		veepooJLUseTheCurrentDialListManager,
		veepooJLAuthenticationManager
	} from '../../jieli_sdk/index';
	import {
		DeviceManager,
		DeviceBluetooth
	} from "../../jieli_sdk/lib/rcsp-impl/dev-bluetooth";
	export default {
		data() {
			return {
				dialList: new Array(),
				customBackgroundList: new Array(),
				useDial: OPDirectoryBrowse.File.prototype,
				RCSPOpWatchDialCallback: null,
				_RCSPWrapperEventCallback: null
			}
		},
		methods: {
			// var	RCSPOpWatchDialCallback: OPWatchDial.OperaterEventCallbackWatchDial,

			onLoad() {
				this.RCSPOpWatchDialCallback = OPWatchDial.OperaterEventCallbackWatchDial
				BleDataHandler.init();

				this._RCSPWrapperEventCallback = new RCSP.RCSPWrapperEventCallback()
				this._RCSPWrapperEventCallback.onEvent = (event) => {
					if (event.type === "onSwitchUseDevice") {
						const connectedDeviceId = event.onSwitchUseDeviceEvent?.device?.deviceId
						console.log(" onSwitchUseDevice111: " + connectedDeviceId);
						// this.setData({
						// 	connectedDeviceId: connectedDeviceId == undefined ? "" : connectedDeviceId
						// })
						this.connectedDeviceId = connectedDeviceId ?? ''
						if (connectedDeviceId != undefined) {
							setTimeout(() => {
								console.log(
									'==================================认证成功====================================='
								);
							}, 300);
						}
					}
				}
				RCSPManager.observe(this._RCSPWrapperEventCallback)

			},
			onUnload() {
				RCSPOpWatchDial?.unregisterEventCallback(RCSPOpWatchDialCallback);
			},
			/**
			 * 点击事件--添加表盘
			 */
			clickAddDial(e : WechatMiniprogram.BaseEvent) {
				console.log("添加表盘", e);
				uni.navigateTo({
					url: '/pages/dial/addDial/addDial'
				})
			},
			/**
			 * 获取表盘列表
			 */
			getDailList() {
				let self = this;
				// 获取表盘列表
				veepooJLGetDialListManager(function (result : any) {
					console.log("result=>", result)
					// this.setData({
					// 	dialList: result.dialList,
					// 	customBackgroundList: result.customBackgroundList
					// })
					self.dialList = result.dialList
					self.customBackgroundList = result.customBackgroundList
				})
				veepooJLUseTheCurrentDialListManager(function (result : any) {
					// this.setData({
					// 	useDial: result.useDial
					// })

					self.useDial = result.useDial
				})
			},

			/* 
			 * 杰里认证
			 */
			setJLVerify() {
				let self = this;
				let device = uni.getStorageSync('bleInfo');


				DeviceManager.connecDevice(device);

				// 杰里设备认证
				// veepooJLAuthenticationManager(device,(res:any)=>{
				//   console.log("杰理认证状态==>",res)
				// })


			},
			/**
			 * 点击事件--表盘操作  
			 */
			clickDialMoreOperate(e : WechatMiniprogram.BaseEvent) {
				console.log("表盘操作", e);
				const index = e.currentTarget.dataset.index;
				const file : OPDirectoryBrowse.File = this.dialList[index]
				//@ts-ignore
				const isUsing = file.name == this.useDial
				console.log("isUsing==>", isUsing)
				console.log("file===>", file)
				let menu : Array<string>;
				if (isUsing) {
					menu = ["设置自定义表盘背景", "获取表盘版本信息", "获取表盘背景", "删除表盘"]
				} else {
					menu = ["设置为当前使用", "获取表盘版本信息", "获取表盘背景", "删除表盘"]
				}

				console.log("file=ssssss==>", file)
				return uni.showActionSheet({
					alertText: "表盘:" + file.getName(),
					itemList: menu,
					success: (res) => {
						switch (res.tapIndex) {
							case 0:
								if (isUsing) {
									this._dialOperateSetDialCustomBackground(file)
								} else {
									this._dialOperateSetDialIsUsing(file)
								}
								break;
							case 1:
								this._dialOperateGetDialVersionInfo(file)
								break;
							case 2:
								this._dialOperateGetDialBackground(file)
								break;
							case 3:
								this._dialOperateDeleteDial(file)
								break;
						}
					}
				})
			},

			/**
			 * 点击事件--自定义表盘
			 */
			clickDialBackground(e : WechatMiniprogram.BaseEvent) {
				console.log("表盘操作", e);
				const index = e.currentTarget.dataset.index;
				const file : OPDirectoryBrowse.File = this.data.customBackgroundList[index]
				//@ts-ignore
				const isUsing = file.name == this.data.useDial;
				console.log("isUsing===>", isUsing)
				console.log("file=====>", file)

				let menu : Array<string>;
				if (isUsing) {
					menu = ["设置自定义表盘背景", "获取表盘版本信息", "获取表盘背景", "删除表盘"]
				} else {
					menu = ["设置为当前使用", "获取表盘版本信息", "获取表盘背景", "删除表盘"]
				}
				return uni.showActionSheet({
					alertText: "表盘:" + file.getName(),
					itemList: menu,
					success: (res) => {
						switch (res.tapIndex) {
							case 0:
								if (isUsing) {
									this._dialOperateSetDialCustomBackground(file)
								} else {
									this._dialOperateSetDialIsUsing(file)
								}
								break;
							case 1:
								this._dialOperateGetDialVersionInfo(file)
								break;
							case 2:
								this._dialOperateGetDialBackground(file)
								break;
							case 3:
								this._dialOperateDeleteDial(file)
								break;
						}
					}
				})
			},
			/**
			 * 表盘操作--设置自定义背景(仅限当前使用表盘)
			 */
			_dialOperateSetDialCustomBackground(file : OPDirectoryBrowse.File) {
				if (this.data.customBackgroundList.length == 0) {
					return uni.showToast({
						title: "表盘背景列表为空，请先添加表盘背景"
					})
				}
				RCSPOpWatchDial?.getDialCustomBackground(file).then((dialBackground) => {
					const menu = new Array<string>()
					menu.push("恢复默认背景")
					for (let index = 0; index < this.data.customBackgroundList.length; index++) {
						const element = this.data.customBackgroundList[index];
						menu.push(element.getName())
					}
					const config = {
						alertText: "当前表盘背景:" + dialBackground?.getName(),
						itemList: menu,
						success: (res : any) => {
							let backgroundFile : any
							if (res.tapIndex == 0) {
								backgroundFile = undefined
							} else {
								backgroundFile = this.data.customBackgroundList[res.tapIndex - 1]
							}
							if (!backgroundFile || backgroundFile.getName() != dialBackground?.getName()) {
								RCSPOpWatchDial?.setDialCustomBackground(backgroundFile).then((_res) => {
									if (backgroundFile) {
										uni.showToast({
											title: "设置自定义背景成功"
										})
									} else {
										uni.showToast({
											title: "恢复默认背景成功"
										})
									}
								}).catch((error) => {
									uni.showToast({
										title: "设置自定义背景失败," + error
									})
								})
							}
						}
					}
					showActionSheet(config)
				}).catch((error) => {
					uni.showToast({
						title: "获取当前表盘背景失败," + error
					})
					console.log("获取当前表盘背景失败,", error)
				})
				return
			},

			/**
			 * 表盘操作--设置为当前使用
			 */
			_dialOperateSetDialIsUsing(file : OPDirectoryBrowse.File) {
				let self = this;

				console.log("设置当前使用file==>", file)
				veepooJLSetToCurrentUseManager(file, function (e : any) {
					console.log("设置当前表盘e=>", e)
					veepooJLUseTheCurrentDialListManager(function (result : any) {
						console.log("result当前表盘==>", result)
						// self.setData({
						// 	useDial: result.useDial
						// })
						self.useDial = result.useDial
					})
				})
			},

			/**
			 * 表盘操作--获取表盘版本信息
			 */
			_dialOperateGetDialVersionInfo(file : OPDirectoryBrowse.File) {
				veepooJLGetDialVersionInfoManager(file, function (result : any) {
					console.log("获取表盘版本信息result=>", result)
				})
			},
			/**
			 * 表盘操作--获取表盘背景
			 */
			_dialOperateGetDialBackground(file : OPDirectoryBrowse.File) {
				veepooJLGetDialBackgroundManager(file, function (result : any) {
					console.log("获取表盘背景result=>", result)
				})
			},
			/**
			 * 表盘操作--设置自定义背景(仅限当前使用表盘)
			 */
			/**
			 * 表盘操作--删除表盘
			 */
			_dialOperateDeleteDial(file : OPDirectoryBrowse.File) {
				uni.showModal({
					title: "删除表盘:" + file.getName(),
					content: "确定要删除表盘文件?",
					confirmText: "删除",
					cancelText: "取消",
					success: (res) => {
						if (res.confirm) {
							console.log("删除表盘detele =>", file)
							veepooJLDeleteDialManager(file, function (result : any) {
								console.log("result删除表盘=>", result)
							})
						} else if (res.cancel) { }
					}
				})
			},
			/**
			 * 点击事件--自定义表盘背景操作
			 */
			clickAddDialBackground(e : WechatMiniprogram.BaseEvent) {
				console.log("添加表盘背景", e);
				uni.navigateTo({
					url: '/pages/dial/addBg/addBg'
				})
			},

			/**
			 * 表盘操作--删除表盘背景
			 */
			_dialOperateDeleteDialBackground(file : OPDirectoryBrowse.File) {
				uni.showModal({
					title: "删除表盘背景:" + file.getName(),
					content: "确定要删除表盘背景?",
					confirmText: "删除",
					cancelText: "取消",
					success: (res) => {
						if (res.confirm) {
							RCSPOpWatchDial?.deleteDialCustomBackground(file).then((_res) => {
								uni.showToast({
									title: "删除表盘背景成功"
								})
							}).catch((error) => {
								uni.showToast({
									title: "删除表盘背景失败," + error
								})
							})
						} else if (res.cancel) { }
					}
				})
			},
		}
	}
</script>

<style>
	.item-containt {
		height: max-content;
		background: #FFFFFF;
		box-shadow: 0rpx 2rpx 16rpx 0rpx rgba(205, 230, 251, 0.2);
		border-radius: 16rpx;
		border: 1rpx solid #F3F3F3;
		margin-left: 24rpx;
		margin-right: 24rpx;
		margin-top: 24rpx;

	}

	.item-line-view {
		height: 120rpx;
		display: flex;
		margin-left: 44rpx;
		margin-right: 44rpx;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	.item-line-view .l {
		display: flex;
		flex-direction: row;
		align-items: center;
	}

	.item-icon {
		width: 54rpx;
		height: 54rpx;
		margin-right: 32rpx;
	}

	.item-icon-next {
		width: 24rpx;
		height: 24rpx;
	}

	.item-icon-choose {
		width: 34rpx;
		height: 34rpx;
	}

	.part-title {
		font-size: 26rpx;
		font-family: PingFang SC;
		font-weight: 500;
		color: #242424;
		margin-top: 49rpx;
		margin-left: 29rpx;
	}
</style>