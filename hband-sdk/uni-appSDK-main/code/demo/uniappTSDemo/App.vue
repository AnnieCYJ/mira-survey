<script>
	import {
		veepooBle,
		veepooFeature
	} from './common/index.js'
	import {
		veepooJLBle
	} from "./jieli_sdk/bleInit"
	import {
		veepooLogger
	} from "./common/index.js";
	export default {
		onLaunch: function() {
			console.log('App Launch')
			const vpJLBle = new veepooJLBle();
			uni.setStorageSync('connectionStatus', true)
			vpJLBle.init();
			// 配置VPSDK打印等级
			veepooLogger.setLevel(veepooLogger.LEVEL.DEBUG)
			const currentLevel = veepooLogger.getLevel()
			console.log('当前日志级别:', currentLevel)
		},
		onShow: function() {
			console.log('App onShow')
		},
		onHide: function() {
			console.log('App Hide')

		},
	}
</script>

<style>
</style>