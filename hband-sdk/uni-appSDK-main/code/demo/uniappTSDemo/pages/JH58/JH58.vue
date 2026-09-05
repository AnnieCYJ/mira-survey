<template>
	<view class="box">


		<view class="box-mode-state">
			<view class="mode-state-item" @click="readTestModeSwitchState">读取模式开关</view>
			<view class="mode-state-item" @click="setupModeSwitchStop">设置模式全关</view>
		</view>
		<view class="box-mode-state">
			<view class="mode-state-item" @click="setupTestModeSwitchState1">设置模式1</view>
			<view class="mode-state-item" @click="setupTestModeSwitchState2">设置模式2</view>
		</view>
		<view class="box-mode-state">
			<view class="mode-state-item" @click="readOrigData1">读取模式1数据</view>
			<view class="mode-state-item" @click="readOrigData2">读取模式2数据</view>
		</view>
		<text>JH58 自动测量</text>
		<view class="box-mode-state">
			<view class="mode-state-item" @click="autoTest1">开启测量</view>
			<view class="mode-state-item" @click="autoTest2">断点读取</view>
			<view class="mode-state-item" @click="autoTest3">关闭测量</view>
		</view>

		<view class="box-mode-state">
			<view class="section">
				<picker mode="date" :value="date" :end="endDate" @change="bindDateChange">
					<view class="picker">
						日期选择: {{date}}
					</view>
				</picker>
			</view>
			<view class="section">
				<picker mode="time" :value="time" @change="bindTimeChange">
					<view class="picker">
						时间选择: {{time}}
					</view>
				</picker>
			</view>

		</view>


		<view class="btn"><button @click="openLog">分享日志</button></view>

		<view v-if="modet">当前模式：{{modeType}}</view>
		<view>读取进度：{{progress}}</view>
	</view>
</template>

<script>
	// pages/universalBlood/index.ts
	import {
		veepooBle,
		veepooFeature
	} from '../../common/index.js'

	// 日志读写：微信小程序用沙盒目录 + getFileSystemManager；
	// App 标准基座没有 uni.getFileSystemManager（顶层直接调用会抛错 → app-service.js 求值失败 → 白屏），
	// 因此按平台分别取 fs / logPath。顶层必须用条件编译，不能无条件调用 getFileSystemManager。
	const date = new Date().toISOString().slice(0, 10)
	const endDate = new Date().toISOString().slice(0, 10)

	// #ifdef MP
	const fs = uni.getFileSystemManager()
	const logPath = `${uni.env.USER_DATA_PATH}/${date}log.txt`
	// #endif
	// #ifdef APP-PLUS
	const logPath = `_doc/${date}log.txt`
	// #endif
	// #ifdef H5
	const logPath = ''
	// #endif

	console.log('endDate=>', endDate);

	export default {
		data() {
			return {
				device: null,
				progress: 0,
				modeType: 0,
				modet: false,
				date: endDate,
				time: "00:00",
				endDate: endDate
			}
		},

		onLoad() {},

		onShow() {
			this._readLog((data) => {
				console.log("读取的日志内容res.data=》", data)
			})

			this.notifyMonitorValueChange()
		},

		methods: {
			// 取得日志文件入口（App 端按需创建）；MP 端不需要，直接用模块级 fs。
			// #ifdef APP-PLUS
			_withLogEntry(cb) {
				// @ts-ignore
				plus.io.resolveLocalFileSystemURL('_doc/', (dirEntry) => {
					const name = logPath.split('/').pop()
					dirEntry.getFile(name, { create: true, exclusive: false }, (fileEntry) => {
						cb(fileEntry)
					}, () => cb(null))
				}, () => cb(null))
			},
			// #endif

			// 读整份日志文本（平台无关）。文件不存在则回调空串。
			_readLog(cb) {
				// #ifdef MP
				fs.readFile({
					filePath: logPath,
					encoding: 'utf8',
					success(res) { cb(res.data) },
					fail() { cb('') }
				})
				// #endif
				// #ifdef APP-PLUS
				this._withLogEntry((fileEntry) => {
					if (!fileEntry) { cb(''); return }
					fileEntry.file((file) => {
						// @ts-ignore
						const reader = new plus.io.FileReader()
						reader.onloadend = (e) => { cb((e.target && e.target.result) || '') }
						reader.onerror = () => { cb('') }
						reader.readAsText(file, 'utf8')
					}, () => { cb('') })
				})
				// #endif
				// #ifdef H5
				cb('')
				// #endif
			},

			// 覆盖写整份文本（用于清空日志）。
			_writeLogText(text, cb) {
				// #ifdef MP
				fs.writeFile({
					filePath: logPath,
					data: text,
					encoding: 'utf8',
					complete() { cb && cb() }
				})
				// #endif
				// #ifdef APP-PLUS
				this._withLogEntry((fileEntry) => {
					if (!fileEntry) { cb && cb(); return }
					fileEntry.createWriter((writer) => {
						writer.onwrite = () => { cb && cb() }
						writer.onerror = () => { cb && cb() }
						writer.write(text)
					}, () => { cb && cb() })
				})
				// #endif
				// #ifdef H5
				cb && cb()
				// #endif
			},

			// 追加一行（平台无关）。App 端没有 appendFile，先读旧内容再整体覆盖写回。
			_appendLog(text, cb) {
				// #ifdef MP
				fs.appendFile({
					filePath: logPath,
					data: text,
					encoding: 'utf8',
					success() { cb(true) },
					fail() { cb(false) }
				})
				// #endif
				// #ifdef APP-PLUS
				this._withLogEntry((fileEntry) => {
					if (!fileEntry) { cb(false); return }
					fileEntry.file((file) => {
						// @ts-ignore
						const reader = new plus.io.FileReader()
						const doWrite = (prev) => {
							fileEntry.createWriter((writer) => {
								writer.onwrite = () => { cb(true) }
								writer.onerror = () => { cb(false) }
								writer.write(prev + text)
							}, () => { cb(false) })
						}
						reader.onloadend = (e) => { doWrite((e.target && e.target.result) || '') }
						reader.onerror = () => { doWrite('') }
						reader.readAsText(file, 'utf8')
					}, () => { cb(false) })
				})
				// #endif
				// #ifdef H5
				cb(false)
				// #endif
			},

			openLog() {
				// #ifdef MP
				uni.openDocument({
					filePath: logPath,
					// fileType: 'txt',
					showMenu: true
				})
				// #endif
				// #ifdef APP-PLUS
				// @ts-ignore
				const abs = plus.io.convertLocalFileSystemURL(logPath)
				uni.openDocument({ filePath: abs, showMenu: true })
				// #endif
			},

			deleteLog() {
				this._writeLogText('', () => {})
			},

			writeLog(content) {
				const date = new Date().toISOString().slice(0, 10)
				const time = new Date().toISOString().slice(11, 23)
				const log = `[${date} ${time}] ${content}\n`

				return new Promise((resolve, reject) => {
					setTimeout(() => {
						this._appendLog(log, (ok) => {
							if (ok) {
								console.log('日志写入成功')
							} else {
								console.error('日志写入失败')
							}
							resolve(ok)
						})
					}, 3);
				})
			},

			bindDateChange: function (e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.date = e.detail.value
			},
			bindTimeChange: function (e) {
				console.log('picker发送选择改变，携带值为', e.detail.value)
				this.time = e.detail.value
			},

			stopTest() {
				let self = this;
				let data = {
					switch: 'stop',
				}
				veepooFeature.veepooSendBloodOxygenControlDataManager(data);
			},

			// 读取测量模式开关状态
			readTestModeSwitchState() {
				veepooFeature.veepooReadTestModeSwitchStateDataManager();
			},

			// 设置模式全关
			setupModeSwitchStop() {
				let data = {
					state: 1,
				}
				veepooFeature.veepooSetupTestModeOneSwitchStateDataManager(data);
			},

			// 设置测量模式开关状态1
			setupTestModeSwitchState1() {
				let data = {
					state: 2,
				}
				veepooFeature.veepooSetupTestModeOneSwitchStateDataManager(data);
			},

			// 设置测量模式开关状态2
			setupTestModeSwitchState2() {
				let data = {
					state: 3,
				}
				veepooFeature.veepooSetupTestModeOneSwitchStateDataManager(data);
			},

			// 读取原始数据
			readOrigData1() {
				let self = this;
				this.deleteLog();

				// 获取当前时间
				const now = new Date();
				// 创建一个新的日期对象，时间设为今天的 1 点整
				const oneAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
				// 秒级时间戳
				const timestampInSeconds = Math.floor(oneAM.getTime() / 1000);
				let txt = `${self.endDate} ${self.time}`
				let times = self.toTimestampSec(txt);
				console.log('times==》', times);
				console.log('timestampInSeconds=>', timestampInSeconds);
				let data = {
					mode: 1,
					timeStamp: times
				}
				console.log("data===>", data);
				veepooFeature.veepooReadTestModeOrigDataManager(data);
			},
			// 读取原始数据
			readOrigData3() {
				let self = this;
				this.deleteLog();

				// 获取当前时间
				const now = new Date();
				// 创建一个新的日期对象，时间设为今天的 1 点整
				const oneAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
				// 秒级时间戳
				const timestampInSeconds = Math.floor(oneAM.getTime() / 1000);
				let txt = `${self.endDate} ${self.time}`
				let times = self.toTimestampSec(txt);
				console.log('times==》', times);
				console.log('timestampInSeconds=>', timestampInSeconds);
				let data = {
					mode: 3,
					timeStamp: times
				}
				console.log("data===>", data);
				veepooFeature.veepooReadTestModeOrigDataManager(data);
			},
			// 读取原始数据
			readOrigData2() {
				let self = this;
				this.deleteLog();
				// 获取当前时间
				const now = new Date();
				// 创建一个新的日期对象，时间设为今天的 1 点整
				const oneAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
				// 秒级时间戳
				const timestampInSeconds = Math.floor(oneAM.getTime() / 1000);
				let txt = `${self.endDate} ${self.time}`
				let times = self.toTimestampSec(txt);
				let data = {
					mode: 2,
					timeStamp: times
				}
				console.log("data===>", data);
				veepooFeature.veepooReadTestModeOrigDataManager(data);
			},

			// 时间戳转日期
			formatTime(sec) {
				const d = new Date(sec * 1000);
				const Y = d.getFullYear();
				const M = String(d.getMonth() + 1).padStart(2, '0');
				const D = String(d.getDate()).padStart(2, '0');
				const h = String(d.getHours()).padStart(2, '0');
				const m = String(d.getMinutes()).padStart(2, '0');
				const s = String(d.getSeconds()).padStart(2, '0');
				return `${Y}-${M}-${D} ${h}:${m}:${s}`;
			},

			// 日期转时间戳
			toTimestampSec(dateStr) {
				// 把 "YYYY-MM-DD HH:mm" 转成 "YYYY-MM-DDTHH:mm"
				const safeStr = dateStr.replace(' ', 'T');
				return Math.floor(new Date(safeStr).getTime() / 1000);
			},

			// 日志处理
			handleLog(list) {
				let self = this;
				// writeLog
				let totalLength = `总组数：${list.length}`
				self.writeLog(totalLength)
				setTimeout(async () => {
					for (let i = 0; i < list.length; i++) {
						const item = list[i];
						for (let j = 0; j < item.array.length; j++) {
							const child = item.array[j];
							const ppgText = `PPG数据：${JSON.stringify(child.ppgData)}`
							const xText = `加速度X：${JSON.stringify(child.acceleration.x)}`
							const yText = `加速度Y：${JSON.stringify(child.acceleration.y)}`
							const zText = `加速度Z：${JSON.stringify(child.acceleration.z)}`
							const time = `数据时间：${self.formatTime(item.timeStamp)}`;
							const eachGroupText = `第${i + 1}组`
							const count = `第${j + 1}条`;
							const text = `${eachGroupText} ${count} ${time}\n${ppgText}\n${xText}\n${yText}\n${zText}\n`
							await self.writeLog(text)
						}
					}
				}, 200);
			},


			autoTest1() {
				let data = {
					state: 1
				};
				veepooFeature.veepooJH58AutoTestManager(data);
			},
			autoTest2() {
				let data = {
					state: 2
				};
				veepooFeature.veepooJH58AutoTestManager(data);
			},
			autoTest3() {
				let data = {
					state: 3
				};
				veepooFeature.veepooJH58AutoTestManager(data);
			},


			// 监听订阅 notifyMonitorValueChange
			notifyMonitorValueChange() {
				let self = this;
				veepooBle.veepooUniAppSDKNotifyMonitorValueChange(function (e) {
					console.log("监听蓝牙回调=>", e);
					if (!e) {
						return
					}
					if (e.type == 54) {
						self.modeType = e.content.state
						return;
					}
					if (e.type == 55 && e.progress == 100 && e.content.length != 0) {
						console.log('数据读取完成');
						self.handleLog(e.content);
					}
					self.device = e
					self.progress = e.progress
				});
			},
		}
	}
</script>

<style>
	.box {
		padding: 50rpx;
	}

	.box .box-mode-state {
		display: flex;
		justify-content: space-between;
		margin-bottom: 30rpx;
		gap: 10px;
	}

	.box .box-mode-state .mode-state-item {
		width: 45%;
		height: 70rpx;
		background-color: #494949;
		color: white;
		line-height: 70rpx;
		text-align: center;
	}

	.btn {
		margin-top: 30rpx;
	}

</style>
