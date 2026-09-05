<template>
	<view>
		<view style="padding: 30rpx;">
			<view class="section">
				<view class="section__title">时间上方：</view>
				<picker @change="bindPickerChange1" :value="index1" :range="array1">
					<view class="picker">
						{{array1[index1]}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">时间下方：</view>
				<picker @change="bindPickerChange2" :value="index2" :range="array2">
					<view class="picker">
						{{array2[index2]}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">时间位置：</view>
				<picker @change="bindPickerChange3" :value="index3" :range="array3">
					<view class="picker">
						{{array3[index3]}}
					</view>
				</picker>
			</view>
			<view>
				<view class="view-color-slider">
					<view :style="'width:160rpx;height:160rpx;border-radius:80rpx;background:' + blockColor"></view>
					<slider class="slider-color-picker"
						:style="'width:500rpx;height:30rpx;border-radius:10rpx;margin-left:30rpx'" activeColor="transparent"
						backgroundColor="transparent" @change="changeCorlor" block-size="24" :value="sliderValue"></slider>
					<slider class="slider-color-picker-gamut"
						:style="'width:500rpx;height:30rpx;border-radius:10rpx;margin-left:30rpx;background:' + colorGamut"
						activeColor="transparent" backgroundColor="transparent" @change="changeCorlorGamut" block-size="24"
						:value="sliderValue"></slider>
					<slider class="slider-color-picker-gray"
						:style="'width:500rpx;height:30rpx;border-radius:10rpx;margin-left:30rpx;background:' + colorGray"
						activeColor="transparent" backgroundColor="transparent" @change="changeCorlorGray" block-size="24"
						:value="sliderValue"></slider>
				</view>

			</view>
		</view>
		<view class="box-btn" style="margin: 20rpx 0; ">
			<button @click="SetCustomBackground">设置自定义背景样式</button>
		</view>
		<view class="box-btn" style="margin: 20rpx 0; ">
			<button @click="switchCustomBg">切换自定义背景</button>
		</view>
		<view class="box-btn" style="margin: 20rpx 0; ">
			<button @click="readCustomBackground">读取自定义背景</button>
		</view>

		<view class="box-btn" style="margin: 20rpx 0;">
			<button @click="getDialInfo">获取屏幕信息</button>
		</view>

		<view style="padding: 30rpx;">
			<view>边框：{{border}}</view>
			<view>屏幕大小：{{resolution}}</view>
			<view>缩略图大小：{{thumbnails}}</view>
		</view>
	</view>
</template>

<script>
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js';
	export default {
		data() {
			return {
				index: 1,
				index1: 1,
				index2: 1,
				index3: 1,
				customType: '',
				border: [],
				resolution: [],
				thumbnails: [],
				array1: ['关闭', '日期样式1', '日期样式2', '计步', '睡眠', '心率', '卡路里', '距离'],
				array2: ['关闭', '日期样式1', '日期样式2', '计步', '睡眠', '心率', '卡路里', '距离'],
				array3: ['左上', '右上', '左下', '右下'],
				array4: ['4', '5', '6', '7'],
				timePosition: '0',
				timeTop: '0',
				timeButtom: '0',
				blockColor: "#000000",
				colorGamut: "-webkit-linear-gradient(left, #ffffff 0%, #ff0000 100%)",
				colorGray: "-webkit-linear-gradient(left, #000000 0%, #ffffff 100%)",
				colorGamutTip: "#ff0000",
				colorGrayTip: "#ffffff",
				colorValue: 0,
				colorGamutValue: 0,
				colorGrayValue: 0,
				sliderValue: 0,
				// 原 Page 在 data 之外的实例属性，一并无脑保留（未参与逻辑）
				dialData: Uint8Array.prototype,
				lastModifyTime: 0,
			}
		},

		onLoad() {
			let value = {
				timePosition: 5,
				timeTopPosition: 4,
				timeButtomPosition: 3,
				isDefaultBg: '0',
				timeColor: [255, 255, 255]
			}
			let isDefaultBg = this.decimalToBinary(value.isDefaultBg); // 是否使用默认表盘 1 是默认  0 非默认
			let timePosition = this.decimalToBinary(value.timePosition); // 圆屏： 1 上 2 中 3 下    方屏： 4 左上 5 右上 6左下 7 右下
			console.log('isDefaultBg=>', isDefaultBg)
			console.log('timePosition=>', timePosition)

			let defaultBg_timePosision = this.binaryToDecimal(isDefaultBg + timePosition)
			console.log('defaultBg_timePosision=>', defaultBg_timePosision)

			// 0 关闭  1 日期样式1  2 日期样式2  3 计步 4 睡眠 5 心率  6 卡路里 7 距离（历程）
			let timeTopPosition = this.decimalToBinary(value.timeTopPosition); // 上方位 高四位
			console.log('timeTopPosition=>', timeTopPosition)
			let timeButtomPosition = this.decimalToBinary(value.timeButtomPosition); // 下方位 低四位
			console.log('timeButtomPosition=>', timeButtomPosition)
			let timeTop_timeButtom = this.binaryToDecimal(timeTopPosition + timeButtomPosition)
			console.log('timeTop_timeButtom=>', timeTop_timeButtom)
		},

		onShow() {
			this.notifyMonitorValueChange()
		},

		methods: {
			// 十进制转二进制
			decimalToBinary(decimalNumber) {
				// 将十进制数转换为二进制字符串
				let binaryString = decimalNumber.toString(2);

				// 使用padStart方法在前面补零，直到达到minLength的长度
				return binaryString.padStart(4, '0');
			},
			// 二进制转十进制
			binaryToDecimal(binaryString) {
				// 使用parseInt函数将二进制字符串转换为十进制数
				// 第二个参数指定基数为2，表示二进制
				return parseInt(binaryString, 2);
			},

			ReadUIStyleDataManager(e) {
				veepooFeature.veepooSendReadUIStyleDataManager()
			},
			SetUIStyleDataManager() {
				let data = {
					type: this.index
				}
				veepooFeature.veepooSendSetUIStyleDataManager(data);
			},
			SetCustomBackground() {
				let timePosition = this.timePosition;
				let timeTop = this.timeTop;
				let timeButtom = this.timeButtom;
				let blockColor = this.blockColor;
				console.log("blockColor=>", blockColor)

				var r = parseInt(blockColor.substring(1, 3), 16);
				var g = parseInt(blockColor.substring(3, 5), 16);
				var b = parseInt(blockColor.substring(5, 7), 16);
				let value = {
					timePosition: timePosition,
					timeTopPosition: timeTop,
					timeButtomPosition: timeButtom,
					isDefaultBg: '0',
					timeColor: [r, g, b]
				}
				console.log("value=>", value)
				veepooFeature.veepooSendSetupCustomBackgroundDialDataManager(value)
			},
			readCustomBackground() {
				let data = {
					type: 2
				}
				veepooFeature.veepooSendReadCustomBackgroundDailManager(data)
			},
			getDialInfo() {
				let self = this;
				let type = this.customType;
				console.log("type==>", type)
				let value = {
					type
				}
				veepooFeature.veepooSendGetCustomDialInfoManager(value, function(e) {
					console.log("屏幕信息=》", e)
					self.border = e.border;
					self.resolution = e.resolution;
					self.thumbnails = e.thumbnails;
				})
			},

			// 切换自定义背景
			switchCustomBg() {
				let value = {
					control: 1, // 设置 1 读取
					style: 0, // 风格
					styleType: 2 // 0 默认表盘 1 表盘市场  2 自定义表盘
				}
				console.log("value=>", value)
				veepooFeature.veepooSendSwitchCustomBGUIDialManager(value);
			},
			//

			bindPickerChange1(e) {
				console.log("e=>", e.detail.value)
				let array1 = this.array1
				this.index1 = e.detail.value;
				this.timeTop = e.detail.value;
			},
			bindPickerChange2(e) {
				console.log("e=>", e.detail.value)
				let array2 = this.array2
				this.index2 = e.detail.value;
				this.timeButtom = e.detail.value;
			},
			bindPickerChange3(e) {
				console.log("e=>", e.detail.value)
				let array4 = this.array4
				this.index3 = e.detail.value;
				this.timePosition = array4[e.detail.value];
				console.log(this.timePosition)
			},
			changeCorlor(e) {
				var value = e.detail.value
				var colors = []
				if (value >= 0 && value < 17) {
					colors = this.gradientColors("#ff0000", "#ffff00", 17, 2.2)
					value = value
				} else if (value >= 17 && value < 33) {
					colors = this.gradientColors("#ffff00", "#00ff00", 17, 2.2)
					value = value - 17
				} else if (value >= 33 && value < 50) {
					colors = this.gradientColors("#00ff00", "#00ffff", 17, 2.2)
					value = value - 33
				} else if (value >= 50 && value < 67) {
					colors = this.gradientColors("#00ffff", "#0000ff", 17, 2.2)
					value = value - 50
				} else if (value >= 67 && value < 83) {
					colors = this.gradientColors("#0000ff", "#ff00ff", 17, 2.2)
					value = value - 67
				} else {
					colors = this.gradientColors("#ff00ff", "#ff0000", 17, 2.2)
					value = value - 83
				}
				if (value >= colors.length) {
					value = value - 1
				}
				this.colorValue = value;
				this.colorGamutTip = colors[value];
				this.colorGamut = "-webkit-linear-gradient(left, #ffffff 0%," + colors[value] + " 100%)";

				var colorGamuts = []
				colorGamuts = this.gradientColors("#ffffff", this.colorGamutTip, 100, 2.2)
				this.colorGrayTip = colorGamuts[this.colorGamutValue];
				this.colorGray = "-webkit-linear-gradient(left, #000000 0%," + colorGamuts[this.colorGamutValue] +
					" 100%)";

				var colorGrays = []
				colorGrays = this.gradientColors("#000000", this.colorGrayTip, 100, 2.2)
				this.blockColor = colorGrays[this.colorGrayValue]
			},
			changeCorlorGamut(e) {
				var value = e.detail.value
				var colorGamuts = []
				colorGamuts = this.gradientColors("#ffffff", this.colorGamutTip, 100, 2.2)
				if (value >= colorGamuts.length) {
					value = value - 1
				}
				this.colorGamutValue = value;
				this.colorGrayTip = colorGamuts[value];
				this.colorGray = "-webkit-linear-gradient(left, #000000 0%," + colorGamuts[value] + " 100%)";

				var colorGrays = []
				colorGrays = this.gradientColors("#000000", this.colorGrayTip, 100, 2.2)
				this.blockColor = colorGrays[this.colorGrayValue]
			},
			changeCorlorGray(e) {
				var value = e.detail.value
				var colorGrays = []
				colorGrays = this.gradientColors("#000000", this.colorGrayTip, 100, 2.2)
				if (value >= colorGrays.length) {
					value = value - 1
				}
				this.colorGrayValue = value;
				this.blockColor = colorGrays[value];
			},

			parseColor(hexStr) {
				return hexStr.length === 4 ? hexStr.substr(1).split('').map(function(s) {
					return 0x11 * parseInt(s, 16);
				}) : [hexStr.substr(1, 2), hexStr.substr(3, 2), hexStr.substr(5, 2)].map(function(s) {
					return parseInt(s, 16);
				})
			},

			// zero-pad 1 digit to 2
			pad(s) {
				return (s.length === 1) ? '0' + s : s;
			},

			gradientColors(start, end, steps, gamma) {
				var i, j, ms, me, output = [],
					so = [];
				gamma = gamma || 1;
				var normalize = function(channel) {
					return Math.pow(channel / 255, gamma);
				};
				start = this.parseColor(start).map(normalize);
				end = this.parseColor(end).map(normalize);
				for (i = 0; i < steps; i++) {
					ms = i / (steps - 1);
					me = 1 - ms;
					for (j = 0; j < 3; j++) {
						so[j] = this.pad(Math.round(Math.pow(start[j] * me + end[j] * ms, 1 / gamma) * 255)
							.toString(16));
					}
					output.push('#' + so.join(''));
				}
				return output;
			},

			updateFlash() {
				veepooFeature.veepooSendChangeFlashChannelToInsideManager()
			},

			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;

				// veepooBle.veepooUniAppSDKUpdateDeviceDialServiceManager(function (e) {
				//   console.log(" ui风格 监听蓝牙回调=>", e);
				//   if (e.type == 46) {
				//     self.customType = e.content.customDialType;
				//   }
				// })
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" ui风格 监听蓝牙回调=>", e);
					if (e.type == 46) {
						self.customType = e.content.customDialType;
					}
				})
			},

			radioChange(e) {
				console.log('e=>', e)
				let index = e.detail.value
				this.index = index;
			},
		}
	}
</script>

<style>
	.section {
		display: flex;
		line-height: 100rpx;
	}

	.view-color-slider {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.slider-color-picker {
		background: -webkit-linear-gradient(left, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);
		border: 1px solid gainsboro;
	}

	.slider-color-picker-gamut {
		border: 1px solid gainsboro;
	}

	.slider-color-picker-gray {
		border: 1px solid gainsboro;
	}
</style>
