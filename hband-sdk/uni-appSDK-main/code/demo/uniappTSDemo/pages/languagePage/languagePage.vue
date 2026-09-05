<template>
	<view>

		<view style="display: flex;">语言：<input type="text" style="background-color: aliceblue;padding: 10px;"
				placeholder="输入语言" @input="inputChange" /></view>

		<button style="margin-top: 20px;" @click="bindLanguage">设置</button>

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
				index: 1
			}
		},

		onLoad() {

		},

		onShow() {
			this.notifyMonitorValueChange();
			uni.getSystemInfo({
				success: function(res) {
					console.log('系统默认语言:', res.language);
				},
				fail: function(err) {
					console.error('获取系统信息失败:', err);
				}
			});
		},

		methods: {
			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;

				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function(e) {
					console.log("  监听蓝牙回调=>", e);
				});

			},

			inputChange(e) {
				console.log('e=>', e)
				this.index = e.detail.value;
			},

			bindLanguage() {
				let val = {
					language: this.index
				}
				console.log('val==>', val)
				veepooFeature.veepooSendLanguageSetupManager(val)
			}
		}
	}
</script>

<style>
	/* pages/languagePage/index.wxss */
</style>
