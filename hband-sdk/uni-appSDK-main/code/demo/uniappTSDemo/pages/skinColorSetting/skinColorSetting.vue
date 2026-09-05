<template>
	<view>
		<view style="padding: 30rpx;">
			<view class="section">
				<view class="section__title">肤色类型：</view>
				<picker @change="bindPickerChange1" :value="index1" :range="array1">
					<view class="picker">
						{{array1[index1]}}
					</view>
				</picker>
			</view>
			<view class="section">
				<view class="section__title">肤色档位：</view>
				<picker @change="bindPickerChange2" :value="index2" :range="index1 == 0 ? array2 : array3">
					<view class="picker">
						{{ index1 == 0 ? array2[index2] : array3[index2]}}
					</view>
				</picker>
			</view>
		</view>
		<view class="box-btn" style="margin: 20rpx 0; ">
			<button @click="settingSkinColor">肤色设置</button>
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
				array1: ["肤色类型0", "肤色类型2"], // 根据功能类型  目前只有 0 与 2  1 废弃
				array2: ["档位1", "档位2"], // 肤色类型0  档位1  白人模式   档位2 黑人模式  默认白人模式
				array3: ['档位1', '档位2', '档位3', '档位4', '档位5', '档位6'], // 档位由黑到白 1-6; 6最黑 1最白
				index1: 0, // 肤色类型 数组下表 0 => 值0  下标1 => 值2
				index2: 0, // 档位数组下标
			}
		},
		onLoad() {

		},
		onShow() {

		},
		methods: {
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log(" 肤色 监听蓝牙回调=>", e);
				})
			},

			bindPickerChange1(e) {
				console.log("e=>", e.detail.value)
				this.index1 = e.detail.value;
			},

			bindPickerChange2(e) {
				console.log("e=>", e.detail.value)
				this.index2 = e.detail.value;
			},

			// 设置肤色
			settingSkinColor() {

				let skinColorType = this.index1 === 0 ? 0 : 2; // 肤色类型只有 0 与 2;
				let level = Number(this.index2) + 1; // 肤色档位

				veepooFeature.veepooSendSkinToneSettingDataManager({
					skinColorType: skinColorType, // 肤色类型
					level: level, // 肤色档位
				})
			}
		}
	}
</script>

<style>
	/* pages/skinColorSetting/index.wxss */
	.section {
		display: flex;
		line-height: 100rpx;
	}
</style>
