<template>
	<view class="network-dial">
		<view class="get-custom-dial" @click="setJLVerify"><button style="margin: 30rpx  auto;background-color: white;">杰理认证</button></view>
		<view class="get-custom-dial" style="display: flex;">

			<!-- <view style="height: 30px; padding: 0 10px;background-color: #ffffff;" @click="removeGetIndex">Index - 1</view> -->
			<button style="margin: 30rpx  auto;background-color: white;" @click="getData">获取数据</button>
			<!-- <view style="height: 30px; padding: 0 10px;background-color: #ffffff;" @click="addGetIndex">Index + 1</view> -->


		</view>
		<view class="get-custom-dial" @click="clickStartTransferDialFile"><button style="margin: 30rpx  auto;background-color: white;">开始传输</button></view>

		<text>{{transferProgressText}}</text>

		<!-- <text>注意：传输完成后需刷新表盘列表，才能正常删除表盘</text> -->



		<view class="dial-box">
			<view class="box-item" v-for="(item,index) in resultList" :key="index">
				<view class="Image" @click="downloadDial(item.name)">
					<image style="width: 100%; height: 100%;" :src="item.previewUrl" mode="" />
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	// pages/networkDial/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js';
	import {
		veepooJLGetFileDataManager,
		veepooJLAddDialTransferStartManager,
		veepooJLAuthenticationManager,
		veepooJLGetDialListManager,
		veepooJLDeleteDialManager
	} from '../../jieli_sdk/index';
	import {
		BleDataHandler
	} from '../../jieli_sdk/lib/ble-data-handler';
	import {
		RCSPManager,
		RCSP
	} from "../../jieli_sdk/lib/rcsp-impl/rcsp";
	import {
		DeviceManager,
		DeviceBluetooth
	} from "../../jieli_sdk/lib/rcsp-impl/dev-bluetooth";
	import {
		BluetoothDevice
	} from "../../jieli_sdk/lib/rcsp-protocol/rcsp-util";


	export default {
		data() {
			return {
				device: {},
				dialInfo: {},
				resultList: [], // 表盘列表
				fileData: {},
				transferProgressText: '',
				dialList: {}, // 设备表盘列表
				getIndex: 1, // 请求的页数
				connectedDeviceId: '',
				// 杰里协议回调持有（原 WeChat 工程的 _RCSPWrapperEventCallback）
				_RCSPWrapperEventCallback: null,
				customBackgroundList: []
			}
		},

		onLoad() {
			let device = uni.getStorageSync('bleInfo');
			this.device = device;

			// 注意，需先订阅vp指令，在订阅杰里
			this.notifyMonitorValueChange();

			setTimeout(() => {
				BleDataHandler.init(); // 接受杰理数据
			}, 100);

			this._RCSPWrapperEventCallback = new RCSP.RCSPWrapperEventCallback()
			this._RCSPWrapperEventCallback.onEvent = (event) => {
				if (event.type === "onSwitchUseDevice") {
					const connectedDeviceId = event.onSwitchUseDeviceEvent && event.onSwitchUseDeviceEvent.device ?
						event.onSwitchUseDeviceEvent.device.deviceId : undefined
					console.log(" onSwitchUseDevice111: " + connectedDeviceId);
					this.connectedDeviceId = connectedDeviceId == undefined ? "" : connectedDeviceId

					if (connectedDeviceId != undefined) {
						setTimeout(() => {
							console.log('==================================认证成功=====================================');

						}, 300);
					}
				}
			}
			RCSPManager.observe(this._RCSPWrapperEventCallback)
		},

		onShow() {
			this.getCustomDial();
		},

		methods: {
			// 获取自定义背景表盘信息
			getCustomDial() {
				// 1 表盘市场ui信息  2 自定义表盘信息 3 全套ui信息
				let data = {
					type: 1
				}
				veepooFeature.veepooSendReadCustomBackgroundDailManager(data);
			},

			// 添加获取页数
			addGetIndex() {
				this.getIndex = this.getIndex + 1
				this.getData();
			},

			// 减少获取页数
			removeGetIndex() {
				if (this.getIndex != 1) {
					this.getIndex = this.getIndex - 1
				}
				this.getData();
			},

			// 接口
			getData() {
				let self = this;
				let device = self.device;
				let dialInfo = self.dialInfo;
				// dialInfo: { "dataAddress": 0, "writeDataLength": 532597, "binProtocol": 2, "dataUseType": 1, "dialShape": 48, "ImageId": 0 },
				// version: "00.77.02.05-5097",
				// dialInfo: { "dataAddress": dialInfo.dataAddress, "writeDataLength": dialInfo.writeDataLength, "binProtocol": dialInfo.binProtocol, "dataUseType": dialInfo.dataUseType, "dialShape": dialInfo.dialShape, "ImageId": dialInfo.ImageId },
				console.log('这个时获取的dailInfo==>', dialInfo)
				let data = {
					version: "11.95.01.00-6702",
					// version: "01.05.02.00-5376",
					// version: "01.05.02.00-5840",
					// dialInfo: { "dataAddress": 0, "writeDataLength": 614733, "binProtocol": 2, "dataUseType": 1, "dialShape": 56, "ImageId": 0 },
					// dialInfo: { "dataAddress": dialInfo.dataAddress, "writeDataLength": dialInfo.writeDataLength, "binProtocol": dialInfo.binProtocol, "dataUseType": dialInfo.dataUseType, "dialShape": dialInfo.dialShape, "ImageId": dialInfo.ImageId },
					// dialInfo: { "dataAddress": 0, "writeDataLength": 532597, "binProtocol": 2, "dataUseType": 1, "dialShape": 48, "ImageId": 0 },
					// version: "01.05.02.00-5840",
					// dialInfo: { "dataAddress": dialInfo.dataAddress, "writeDataLength": dialInfo.writeDataLength, "binProtocol": dialInfo.binProtocol, "dataUseType": dialInfo.dataUseType, "dialShape": dialInfo.dialShape, "ImageId": dialInfo.ImageId },
					dialInfo: {
						"dataAddress": 0,
						"writeDataLength": 614733,
						"binProtocol": 2,
						"dataUseType": 1,
						"dialShape": 53,
						"ImageId": 0
					},
					pageIndex: this.getIndex, // 当前页数
					pageSize: 24, // 数据条数
				}

				let resut = veepooFeature.veepooGetNetworDialManager(data);
				resut.then((result) => {
					console.log("resut==>", result.data)

					self.resultList = result.data.results

					// 获取杰理表盘列表
					veepooJLGetDialListManager(function (result) {
						console.log("result=>", result)
						self.dialList = result.dialList
						self.customBackgroundList = result.customBackgroundList
						console.log("手环表盘列表dialList=>", self.dialList)
					})
				}).catch((err) => {
					console.log("err=>", err);
				})


			},


			// 杰理认证
			setJLVerify() {
				let self = this;
				let info = uni.getStorageSync('bleInfo')
				// 杰里设备认证
				let device = info;

				DeviceManager.connecDevice(device);
			},

			// 开始传输
			clickStartTransferDialFile() {
				let self = this;
				let fileData = this.fileData;
				if (fileData.length <= 0) {
					uni.showToast({
						title: "请先下载表盘",
						icon: "none"
					})
					return
				}
				console.log("点击了开始传输");

				console.log("查看设备列表中是否存在已下载的设备")
				let deteleState = false;
				let deteleFile = {}
				// 获取表盘列表
				let dialList = self.dialList;
				let resultList = self.resultList;

				console.log("dialList==>", dialList);
				console.log("resultList==>", resultList)
				for (let i = 0; i < dialList.length; i++) {
					let Item = dialList[i];
					let fileName = (Item.name).toLowerCase();
					for (let j = 0; j < resultList.length; j++) {
						let JTem = resultList[j];
						let name = JTem.fileUrl.split("/");
						//  如此存在，那么先删除
						if (fileName == name[name.length - 1]) {
							console.log("fileName===>", fileName);
							console.log("name===>", name)
							deteleFile = Item
							deteleState = true
						}
					}
				}

				console.log("deteleState===>", deteleState)
				console.log("deteleFile===>", deteleFile)

				// 如果为真，删除，否则直接传输
				if (deteleState) {
					veepooJLDeleteDialManager(deteleFile, function (result) {
						console.log("result删除表盘=>", result)
						// 删除完成，传输数据
						veepooJLAddDialTransferStartManager(fileData, function (result) {
							console.log("传输进度result=>", result);
							self.transferProgressText = result.transferProgressText
							deteleState = false
							deteleFile = {}
						})
					})
				} else {
					veepooJLAddDialTransferStartManager(fileData, function (result) {
						console.log("传输进度result=>", result);
						self.transferProgressText = result.transferProgressText
					})
				}

			},

			downloadDial(name) {
				let self = this;
				console.log("name=>", name);
				let resultList = self.resultList;
				let currentItem = {}
				resultList.forEach((item, index) => {
					if (item.name == name) {
						console.log("item==>", item);
						currentItem = item;
					}
				})


				uni.downloadFile({
					url: currentItem.fileUrl,
					success: function (res) {
						if (res.statusCode === 200) {
							var tempFilePath = res.tempFilePath;
							console.log("res==>", res)
							console.log('文件下载成功，临时路径为：', tempFilePath);
							let Time = Date.now(); // 记录下载开始时间
							let names = currentItem.fileUrl.split("/");
							console.log("name==>", names[names.length - 1])
							console.log("Time=>", Time)
							let tempFilePaths = {
								path: tempFilePath,
								size: res.dataLength,
								name: names[names.length - 1],
								time: Time
							}
							veepooJLGetFileDataManager(tempFilePaths, function (fileResult) {
								console.log("获取文件成功==>", fileResult);
								self.fileData = fileResult
							})

							return
							// 保存到磁盘
							let dialStorageList = uni.getStorageSync("dialStorageList");
							if (!dialStorageList) {
								let obj = {
									name: currentItem.name,
									path: tempFilePath
								}
								let arr = [obj]
								uni.setStorageSync("dialStorageList", arr)
							} else {
								let obj = {
									name: currentItem.name,
									path: tempFilePath
								}
								dialStorageList.push(obj);
								uni.setStorageSync("dialStorageList", dialStorageList)
							}

							// 在成功回调中可以继续其他操作，比如保存文件或者展示文件等
						} else {
							console.log('文件下载失败，HTTP 状态码：', res.statusCode);
						}
					},
					fail: function (err) {
						console.log('文件下载失败：', err);
					}
				})
			},


			readDownLoadData() {
				let self = this;
				let dialStorageList = uni.getStorageSync("dialStorageList");
				console.log("dialStorageList==>", dialStorageList);
				const fs = uni.getFileSystemManager()
				fs.readFile({
					filePath: `${dialStorageList[0].path}`,
					success(res) {
						console.log(res);
						const uint8Array = new Uint8Array(res.data); // 将ArrayBuffer转换为Uint8Array
						console.log('Uint8Array 数据:', uint8Array);
					},
					fail(res) {
						console.error(res)
					}
				})

			},


			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log("e=>", e);
					console.log("表盘信息===e==>", e)
					if (e.type == 46) {
						self.dialInfo = e.content
					}
				})
			},
		}
	}
</script>

<style>
	page {
		background-color: #f6f6f6;
	}

	.dial-box {
		width: 686rpx;
		margin: 60rpx auto;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
	}

	.dial-box .box-item {
		width: 328rpx;
		height: 328rpx;
		margin: 20rpx 0;
		background-color: white;
		position: relative;
	}

	.dial-box .box-item .Image {
		width: 200rpx;
		height: 240rpx;
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
	}
</style>