import { veepooBle } from "../../common/index.js";
import { logd, loge } from "../utils/log";
import { UUID_NOTIFY } from "./rcsp-impl/bluetooth";

// OTA发送逐包日志开关：排查传输问题时改true，平时必须保持false。
// 3MB固件按244字节分包约1.3万包，逐包打日志会打出数万条——不只是撑爆鸿蒙console，
// 还会拖慢JS线程让写回调超过下面的3秒保护，触发"放弃当前包"的静默丢包，
// 固件流错一个字节设备CRC就过不了(queryUpdateResult=4 -> -105 upgrade file is damaged)。
const OTA_SEND_DEBUG = false
// 单包发送payload上限(字节)，全平台生效，不要按平台放开。
// 这是【设备侧】的接收上限，不是某款手机的毛病：设备会协商出 512(实测)，但固件的接收
// 缓冲吃不下那么大的包。按协商值发(509)的实测结果是——write 全部返回 success(底层收下了)、
// 丢包计数为 0，但设备根本收不到，反复重发 CmdReadFileBlock 请求同一块，最后
// -111 SDK timed out waiting for a command。写成功 ≠ 对端收到，别被 success 骗了。
// 244 对应协商MTU 247 - ATT头3字节，是已验证能被设备完整接收的值。
// (历史注释把这归因于 iPhone SE2，那只是最早发现问题的机型，与手机平台无关。)
const MAX_PACKET_PAYLOAD = 244
// 写失败重试次数与退避基数。write fail 绝大多数是底层发送队列瞬时满，
// 立即重发必然再失败——原来"3次立即重发"几乎在同一毫秒内用完，等于没有重试。
const MAX_WRITE_RETRY = 10  // iOS 队列溢出时需要更多重试机会
const WRITE_RETRY_BASE_DELAY = 50  // 退避基数增加到 50ms（原 20ms）
// iOS 开环发送的间隔(ms)。iOS 上写入无回调可用，只能靠固定间隔控制发送节奏，
// 每一包都吃这个间隔。调大会显著拉长升级耗时，调小可能导致设备收不全。
const IOS_WRITE_INTERVAL = 80
/** 处理收到数据 */
export var BleDataHandler = {
	callbacks: Array<BleDataCallback>(),
	_initialized: false,
	init() {
		if (this._initialized) return
		this._initialized = true
		// 修改注册方式，UUID_NOTIFY
		veepooBle.addBleNotificationListener(UUID_NOTIFY, (_ : string[], res : WechatMiniprogram.OnBLECharacteristicValueChangeListenerResult) => {
			// [诊断] 打印每个收到的 AE02 notify 包，用于判断设备是否有回包（认证/OTA 收不到数据时定位）
			console.log('[OTA收包] AE02 byteLength=', res && res.value ? res.value.byteLength : 0)
			this._handlerData(res);
		})
	},
	addCallbacks(callback : BleDataCallback) {
		if (this.callbacks.indexOf(callback) == -1) {
			this.callbacks.push(callback);
		}
	},
	removeCallbacks(callback : BleDataCallback) {
		var index = this.callbacks.indexOf(callback);
		if (index != -1) {
			this.callbacks.splice(index, 1);
		}
	},
	_handlerData(res : WechatMiniprogram.OnBLECharacteristicValueChangeListenerResult) {
		this._doAction({
			action: function (c) {
				if (c.onReceiveData) {
					c.onReceiveData(res);
				}
			}
		});
	},
	_doAction(obj : { action : (c : BleDataCallback) => void }) {
		this.callbacks.forEach(c => {
			obj.action(c)
		});
	},
}
export interface BleDataCallback {
	onReceiveData ?: (res : WechatMiniprogram.OnBLECharacteristicValueChangeListenerResult) => void
}

/todo 后续优化，1.阻塞式发送数据，2.区分设备/
/** 队列式-分包发送数据 */
export var BleSendDataHandler = {
	mtuMap: new Map<string, number>(),
	sendInfoArray: new Array<SendDataTask>(),
	retryNum: 0,
	_isSending: false,
	// 丢包计数。下面两处"放弃当前包、继续后续"的兜底是为了不卡死发送队列，但对OTA固件流
	// 来说丢一个包就等于把固件传坏了，设备侧校验必然失败(-105)，且现象跟"固件文件损坏"
	// 一模一样、极难区分。所以把丢包次数暴露给上层，让失败原因可判定。
	dropCount: 0,
	sentCount: 0,
	_loggedMTU: 0,
	// 本轮OTA开始时间，用于计算发包速率
	_startTime: 0,
	/** 每次开始OTA前调用，重置统计 */
	resetStats() {
		this.dropCount = 0
		this.retryNum = 0
		this.sentCount = 0
		this._loggedMTU = 0
		this._startTime = Date.now()
	},
	_platform: '',
	_getPlatform() : string {
		if (!this._platform) {
			try {
				this._platform = uni.getSystemInfoSync().platform || 'android'
			} catch (e) {
				this._platform = 'android'
			}
		}
		return this._platform
	},
	setMtu(deviceId : string, mtu : number) {
		this.mtuMap.set(deviceId, mtu)
	},
	sendData(deviceId : string, serviceId : string, characteristicId : string, data : Uint8Array) : boolean {
		const mtu = this.mtuMap.get(deviceId)
		let realMTU = 23;
		if (mtu != undefined) realMTU = mtu - 3
		// 全平台封顶，见 MAX_PACKET_PAYLOAD 说明——这是设备侧接收上限，放开会导致设备收不到。
		if (realMTU > MAX_PACKET_PAYLOAD) realMTU = MAX_PACKET_PAYLOAD
		// iOS 平台 uniapp 无相关API获取真实MTU，采用保险MTU
		if (this._getPlatform() === 'ios') {
			realMTU = 185
		}
		// 单包大小变化时打一条(不受 OTA_SEND_DEBUG 控制)：逐包日志关掉后就没法确认
		// 上面的平台封顶判断到底生效没有，而这个值直接决定包数和丢包概率。
		if (realMTU !== this._loggedMTU) {
			this._loggedMTU = realMTU
			console.log('[OTA发送] 单包payload=' + realMTU + ' 平台=' + this._getPlatform()
				+ ' 协商MTU=' + (mtu == undefined ? 'unknown' : mtu))
		}
		const dataLen = data.byteLength;
		const blockCount = Math.floor(dataLen / realMTU);
		if (OTA_SEND_DEBUG) console.log('[OTA发送] char=' + characteristicId.slice(0, 8) + ' len=' + dataLen + ' realMTU=' + realMTU + ' 包数=' + (blockCount + (dataLen % realMTU ? 1 : 0)))
		let ret = false;
		for (let i = 0; i < blockCount; i++) {
			const mBlockData = new Uint8Array(realMTU);
			mBlockData.set(data.slice(i * realMTU, i * realMTU + mBlockData.length))
			ret = this._addSendData(deviceId, serviceId, characteristicId, mBlockData);
		}
		if (0 != dataLen % realMTU) {
			const noBlockData = new Uint8Array(dataLen % realMTU);
			noBlockData.set(data.slice(dataLen - dataLen % realMTU, dataLen))
			ret = this._addSendData(deviceId, serviceId, characteristicId, noBlockData);
		}
		return ret
	},
	_addSendData(deviceId : string, serviceId : string, characteristicId : string, data : Uint8Array) : boolean {
		const sendDataTask = new SendDataTask(deviceId, serviceId.toUpperCase(), characteristicId.toUpperCase(), data)
		this.sendInfoArray.push(sendDataTask)
		// 用标志位确保只有一个发送流程在跑。之前用 length>1 判断，但 _writeDataToDevice 会立即 shift 清空队列，
		// 导致一帧多包同步连续入队时每次都误判为"无发送流程"而重复启动，实际变成并发写入。
		// 鸿蒙 BLE 不容忍并发写 -> 丢包 -> 设备收不全文件帧 -> 反复请求 -> OTA -111。
		if (this._isSending) {
			return true // 已有发送流程，入队即可，由它顺序取出
		}
		this._isSending = true
		this._writeDataToDevice()
		return true
	},
	_writeDataToDevice() {
		if (this.sendInfoArray.length === 0) {
			this._isSending = false
			return // 队列发送完毕
		}
		const dataInfo = this.sendInfoArray.shift()
		if (!dataInfo) {
			this._isSending = false
			return
		}
		if (OTA_SEND_DEBUG) console.log('[OTA发送] 发包 len=' + dataInfo.data.length + ' 剩余=' + this.sendInfoArray.length)
		// 关键：上一包写入完成(成功或放弃)后再发下一包，避免鸿蒙并发写入丢包导致 OTA -111 超时
		this._sendData(dataInfo, () => {
			this._writeDataToDevice()
		})
	},
	/** 发送进度日志，success 与 iOS 开环两条推进路径共用。每500包一条，不受 OTA_SEND_DEBUG 控制 */
	_logProgress() {
		if (this.sentCount % 500 !== 0) return
		const sec = this._startTime > 0 ? (Date.now() - this._startTime) / 1000 : 0
		console.log('[OTA发送进度] 已发=' + this.sentCount + '包 丢包=' + this.dropCount
			+ ' 队列剩余=' + this.sendInfoArray.length
			+ ' 耗时=' + sec.toFixed(1) + 's'
			+ ' 速率=' + (sec > 0 ? (this.sentCount / sec).toFixed(1) : '0') + '包/s')
	},
	_sendData(sendDataTask : SendDataTask, onComplete ?: () => void) {
		let done = false
		const t0 = Date.now()
		const finish = () => {
			if (done) return
			done = true
			onComplete?.()
		}
		// iOS 走开环发送：写入的 success/fail 不回调，无法用回调驱动队列，
		// 改为写完后按固定间隔推进下一包。无应答写本身也没有送达确认。
		const isIOS = this._getPlatform() === 'ios'

		// 超时兜底只对非 iOS 生效：鸿蒙上 success/fail 偶发不回调，需要它避免卡死整条队列。
		// iOS 是开环推进，不需要也不能挂这个定时器。
		let timer : any = undefined
		if (!isIOS) {
			// 注意这是在"卡死"和"丢包"之间取舍，对OTA而言丢包同样致命，所以计入 dropCount。
			// 5秒：写一个244字节包正常只需几毫秒，超时留足余量，避免误判成丢包。
			timer = setTimeout(() => {
				if (!done) {
					this.dropCount++
					// 裸 console.log：loge 走杰理 logger，logger 未挂载时这条诊断会静默消失
					console.log('[OTA写完成] 超时无回调 ' + (Date.now() - t0) + 'ms len='
						+ sendDataTask.data.length + ' 累计丢包=' + this.dropCount)
					loge('[OTA发送] 写包无回调超时，放弃该包 -> 数据流已损坏！累计丢包=' + this.dropCount
						+ ' len=' + sendDataTask.data.length)
					finish()
				}
			}, 5000)
		}
		const writeOption : any = {
			deviceId: sendDataTask.deviceId,
			serviceId: sendDataTask.serviceId,
			characteristicId: sendDataTask.characteristicId,
			value: sendDataTask.data.buffer as ArrayBuffer,
			success: () => {
				if (timer != undefined) clearTimeout(timer)
				this.retryNum = 0
				if (isIOS) {
					// 开环下队列已由下面的定时器推进，这里只记账不能再 finish()，
					// 否则一包会把队列推进两次，直接跳包
					if (OTA_SEND_DEBUG) console.log('[OTA发送] 包success(iOS迟到) ' + (Date.now() - t0) + 'ms len=' + sendDataTask.data.length)
					return
				}
				this.sentCount++
				if (OTA_SEND_DEBUG) console.log('[OTA发送] 包success ' + (Date.now() - t0) + 'ms len=' + sendDataTask.data.length)
				this._logProgress()
				finish()
			},
			fail: (err) => {
				if (timer != undefined) clearTimeout(timer)
				// 裸 console.log：同上，避免 logger 未挂载时诊断信息丢失
				console.log('[OTA写完成] fail ' + (Date.now() - t0) + 'ms len=' + sendDataTask.data.length
					+ ' err=' + JSON.stringify(err))
				loge("发送数据失败：->" + "\terr=" + JSON.stringify(err) + " retryNum = " + this.retryNum)

				// 检查是否是连接断开的错误（10003）
				// 如果设备已断开，继续重试毫无意义，直接放弃整个发送队列
				if (err.errCode === 10003 || err.errorCode === 10003) {
					loge('[OTA发送] 设备已断开，停止发送队列');
					uni.showToast({
						title: '设备已断开',
						icon: 'none'
					})
					this.retryNum = 0;
					this.dropCount++;
					this._isSending = false;
					// 清空发送队列
					this.sendInfoArray = [];
					return;
				}
				if (isIOS) {
					// 开环下不能重发：后续包已经发出去了，补发会让固件流乱序
					this.dropCount++
					loge('[OTA发送] iOS 开环写失败，无法按序重发 -> 数据流已损坏！累计丢包=' + this.dropCount
						+ ' len=' + sendDataTask.data.length)
					return
				}

				if (this.retryNum < MAX_WRITE_RETRY) {
					this.retryNum++
					// 退避后再重发。write fail 绝大多数是底层发送队列瞬时满，同一毫秒内立即重发
					// 必然再撞满——原来3次立即重发几乎瞬间用完，等于没重试，直接就丢包了。
					// 50/100/200/400/800/1600/3200/6400/12800/25600ms，累计约 50 秒。
					const delay = WRITE_RETRY_BASE_DELAY * Math.pow(2, this.retryNum - 1)
					logd("重发数据 retryNum = " + this.retryNum + " 退避 " + delay + "ms")
					setTimeout(() => {
						this._sendData(sendDataTask, onComplete) // 重发当前包
					}, delay)
				} else {
					this.retryNum = 0
					this.dropCount++
					loge('[OTA发送] 重试' + MAX_WRITE_RETRY + '次仍失败，放弃该包 -> 数据流已损坏！累计丢包=' + this.dropCount
						+ ' len=' + sendDataTask.data.length)
					finish() // 放弃当前包，继续后续，避免整条队列卡死
				}
			}
		}
		// 非 iOS 才显式指定无应答写：鸿蒙上 write(有应答写)对 AE01 数据设备不响应；
		// iOS 不传，交由平台默认处理。
		if (!isIOS) {
			writeOption.writeType = 'writeNoResponse'
		}
		uni.writeBLECharacteristicValue(writeOption)
		if (isIOS) {
			// 开环：不等回调，按固定间隔推进下一包
			this.sentCount++
			this._logProgress()
			setTimeout(finish, IOS_WRITE_INTERVAL)
		}
	}
}
class SendDataTask {
	public deviceId : string
	public serviceId : string
	public characteristicId : string
	public data : Uint8Array
	constructor(deviceId : string, serviceId : string, characteristicId : string, data : Uint8Array) {
		this.deviceId = deviceId
		this.serviceId = serviceId
		this.characteristicId = characteristicId
		this.data = data
	}
}