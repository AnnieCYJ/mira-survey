// ota-rcsp.ts OTA库和Rcsp协议库连接类
import { CmdChangeCommunicationWay, ParamCommunicationWay, RcspOpImpl, RcspConstant, CommandCallback, ResponseBase, ErrorCode, CmdReadFileOffset, CmdRequestUpdate, ParamRequestUpdate, CmdEnterUpdateMode, CmdExitUpdateMode, CmdQueryUpdateResult, CmdRebootDevice, ParamRebootDevice, CmdControlADVStream, CommandBase, CmdReadFileBlock, OnRcspCallback, Connection, CmdNotifyUpdateFileSize, CmdNotifyADVInfo, CmdGetTargetInfo, ResponseResult, Device } from "../jl-rcsp/jl_rcsp_watch_1.1.0";

import { FileOffset, OTAConfig, OTAImpl, DeviceUpgradeInfo } from "./jl_ota_2.1.0";
import type { IOTAOp, OnResultCallback, OnUpgradeCallback } from "./jl_ota_2.1.0";

import { logv, logi, loge } from "../../utils/log";

export class RcspOTAManager {
	private mRcspOpImpl : RcspOpImpl;
	private mOTAImpl : OTAImpl
	private mRcspOTA : RcspOTA
	constructor(rcspOpImpl : RcspOpImpl) {
		this.mRcspOpImpl = rcspOpImpl
		this.mRcspOTA = new RcspOTA(this.mRcspOpImpl)
		this.mOTAImpl = this.mRcspOTA.getOTAImpl()
		if (rcspOpImpl != undefined) { //外部传递的需要判断是否已连接设备。已连接的话，需要把设备信息设置进OTAImpl
			const usingDevice = this.mRcspOpImpl.getUsingDevice()
			if (usingDevice != null) {
				const deviceInfo = this.mRcspOpImpl.getDeviceInfo(usingDevice)
				if (deviceInfo != undefined) {
					const upgradeInfo = new DeviceUpgradeInfo(deviceInfo.isSupportDoubleBackup, deviceInfo.isNeedBootLoader, deviceInfo.mandatoryUpgradeFlag == CmdGetTargetInfo.FLAG_MANDATORY_UPGRADE)
					this.mOTAImpl.onDeviceInit(upgradeInfo, true)
				}
			}
		}
	}
	/**
	 * releas
	 */
	public release() {
		this.mRcspOTA.release()
	}
	public startOTA(config : OTAConfig, callback : OnUpgradeCallback) {
		this.mRcspOTA.startOTA(config, callback)
	}
	public cancelOTA() {
		this.mRcspOTA.cancelOTA()
	}
	public getCurrentOTADevice() : Device | null {
		return this.mRcspOTA.getOTADevice()
	}
	public getCurrentOTADeviceMac() : string | undefined {
		return this.mRcspOTA.getOTADeviceMac()
	}
	//回连更新device
	public updateOTADevice(device : Device) {
		return this.mRcspOTA.setOTADevice(device)
	}
	public updateRcspOpImpl(rcspOpImpl : RcspOpImpl) {
		return this.mRcspOTA.updateRcspOpImpl(rcspOpImpl)
	}
}
/todo 要处理区分是不是同一个设备, 回连需要更新一下 mOTADevice/
export class RcspOTA implements IOTAOp {
	private cmdFileBlockCache : Array<CmdReadFileBlock> = new Array()
	private mRcspOpImpl : RcspOpImpl;
	private readonly cmdTimeout = OTAImpl.WAITING_CMD_TIMEOUT;
	private mOTAImpl : OTAImpl
	private mStopNotifyADV = false
	// queryUpdateResult 去重，解决"升级成功却被报 -35"的竞态（见 queryUpdateResult 注释）
	private mUpdateResultPending = false
	private mUpdateResultDone = false
	private mOnRcspCallback : OnRcspCallback
	private mOTADevice : Device | null = null
	private mOTADeviceMac : string | undefined = undefined
	constructor(rcspOpImpl : RcspOpImpl) {
		this.mOTAImpl = new OTAImpl(this)
		this.mRcspOpImpl = rcspOpImpl;
		const that = this
		this.mOnRcspCallback = {
			onRcspInit(device : Device | null, isInit : boolean) : void {
				logi("onRcspInit:1" + JSON.stringify(that.mOTADevice) + " :device " + JSON.stringify(device));
				if (device == undefined) return
				if (that.mOTADevice != null && !that.mOTADevice.equals(device)) return//不等于升级设备
				const deviceInfo = that.mRcspOpImpl.getDeviceInfo(device)
				logi("onRcspInit:2" + JSON.stringify(deviceInfo));
				that.mOTADeviceMac = deviceInfo?.bleAddr
				let upgradeInfo : DeviceUpgradeInfo | undefined = undefined
				if (deviceInfo != undefined) {
					upgradeInfo = new DeviceUpgradeInfo(deviceInfo.isSupportDoubleBackup, deviceInfo.isNeedBootLoader, deviceInfo.mandatoryUpgradeFlag == CmdGetTargetInfo.FLAG_MANDATORY_UPGRADE)
				}
				that.mOTAImpl.onDeviceInit(upgradeInfo, isInit)
			},
			onRcspCommand(device : Device | null, command : CommandBase) : void {
				// logv("onRcspCommand : " + command.getOpCode());
				if (device == null) return
				if (command instanceof CmdReadFileBlock) {//设备请求文件数据
					const readFileBlock = command as CmdReadFileBlock;
					const offset = readFileBlock.getParam().offset;
					const len = readFileBlock.getParam().len;
					// 带上 offset/len：offset 重复说明设备没完整收到上一块，递增则传输正常
					logv("onRcspCommand : 设备请求文件数据 offset=" + offset + " len=" + len);
					that.saveCacheCmdResponse(readFileBlock)
					that.mOTAImpl.gainFileBlock(offset, len)
				} else if (command instanceof CmdNotifyUpdateFileSize) {//设备通知文件升级大小
					const notifyUpdateFileSize = command as CmdNotifyUpdateFileSize;
					const totalOTaSize = notifyUpdateFileSize.getParam().totalSize;
					const currentOtaSize = notifyUpdateFileSize.getParam().currentSize;
					that.mOTAImpl.notifyUpgradeSize(totalOTaSize, currentOtaSize)
					if (notifyUpdateFileSize.getResponse() != undefined) {//回复命令
						notifyUpdateFileSize.getResponse()?.setStatus(ResponseBase.STATUS_SUCCESS)
						// notifyUpdateFileSize.response.sn = notifyUpdateFileSize.sn
						// notifyUpdateFileSize.isCommand = false
						notifyUpdateFileSize.getResponse()?.setSn(notifyUpdateFileSize.getSn())
						notifyUpdateFileSize.setCommand(false)
						that.mRcspOpImpl.sendRCSPCommand(device, notifyUpdateFileSize, that.cmdTimeout, new CmdBooleanCallback("Response ", null))
					}
				} else if (command instanceof CmdNotifyADVInfo) {//设备广播ADV信息 
					logv("onRcspCommand : 设备广播ADV信息");
					if (!that.mStopNotifyADV) {//停止推送广播包信息
						const cmdControlADVStream = new CmdControlADVStream(CmdControlADVStream.CTRL_OP_CLOSE)
						that.mRcspOpImpl.sendRCSPCommand(device, cmdControlADVStream, that.cmdTimeout, new CmdBooleanCallback("stopNotifyADV", null))
						that.mStopNotifyADV = true
					}
				}
			},
			onRcspDataCmd(_device : Device | null, _dataCmd : CommandBase) : void {
			},
			onConnectStateChange(device : Device | null, status : Connection) : void {
				if (device == null) return
				if (status == Connection.CONNECTION_DISCONNECT && true) {
					setTimeout(() => {
						if (that.mOTAImpl.isOTA()) {
							logi("onConnectStateChange: disconnect forwarded to onDeviceDisconnect")
							that.mOTAImpl.onDeviceDisconnect()
						} else {
							logi("onConnectStateChange: disconnect skipped, OTA already completed")
						}
					}, 200)
				}
			},
			onRcspError(_device : Device | null, _error : number, _message : string) : void { },
			onMandatoryUpgrade(_device : Device | null) : void { },
			onRcspResponse(_device, _command) : void { }
		}
		rcspOpImpl.addOnRcspCallback(this.mOnRcspCallback)
	}

	public getOTAImpl() : OTAImpl {
		return this.mOTAImpl
	}
	updateRcspOpImpl(rcspOpImpl : RcspOpImpl) {
		this.mRcspOpImpl = rcspOpImpl
		rcspOpImpl.addOnRcspCallback(this.mOnRcspCallback)
		const usingDevice = this.mRcspOpImpl.getUsingDevice()
		if (usingDevice != null) {
			const deviceInfo = this.mRcspOpImpl.getDeviceInfo(usingDevice)
			if (deviceInfo != undefined) {
				const upgradeInfo = new DeviceUpgradeInfo(deviceInfo.isSupportDoubleBackup, deviceInfo.isNeedBootLoader, deviceInfo.mandatoryUpgradeFlag == CmdGetTargetInfo.FLAG_MANDATORY_UPGRADE)
				this.mOTAImpl.onDeviceInit(upgradeInfo, true)
			}
		}
	}
	startOTA(config : OTAConfig, callback : OnUpgradeCallback) {
		this.mOTADevice = this.mRcspOpImpl.getUsingDevice()
		if (this.mOTADevice != null) {
			this.mOTADeviceMac = this.mRcspOpImpl.getDeviceInfo(this.mOTADevice)?.bleAddr
		}
		this.mOTAImpl.startOTA(config, callback)
	}
	cancelOTA() {
		this.mOTAImpl.cancelOTA()
	}
	getOTADevice() : Device | null {
		return this.mOTADevice
	}
	getOTADeviceMac() : string | undefined {
		return this.mOTADeviceMac
	}
	setOTADevice(device : Device | null) {
		this.mOTADevice = device
	}
	/** -----------IOTAOp实现--------------------- */
	release() {
		this.mOTAImpl.release()
		this.mRcspOpImpl.removeOnRcspCallback(this.mOnRcspCallback)
	}

	/** 是否已连接设备 */
	isDeviceConnected() : boolean {
		//设备已连接且
		return this.mRcspOpImpl.isDeviceConnected() && this.mOTADevice != null && this.mOTADevice.equals(this.mRcspOpImpl.getUsingDevice())
	}

	/** 切换通讯方式 */
	changeCommunicationWay(communicationWay : number, isSupportNewRebootWay : boolean, callback : OnResultCallback<number>) : void {
		if (!this.isDeviceConnected()) return
		const param = new ParamCommunicationWay(communicationWay, isSupportNewRebootWay)
		const cmdResultCallback = new CmdResultCallback("changeCommunicationWay", callback, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdChangeCommunicationWay) : number | undefined {
				return command.getResponse()?.result;
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, new CmdChangeCommunicationWay(param), this.cmdTimeout, cmdResultCallback)
	}

	/** 读取文件头信息偏移 */
	readUpgradeFileFlag(callback : OnResultCallback<FileOffset>) : void {
		if (!this.isDeviceConnected()) return
		const cmdResultCallback = new CmdResultCallback("readUpgradeFileFlag", callback, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdReadFileOffset) : FileOffset | undefined {
				return new FileOffset(command.getResponse()?.offset, command.getResponse()?.len);
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, new CmdReadFileOffset(), this.cmdTimeout, cmdResultCallback)
	}

	/** 查询设备是否可升级 */
	inquiryDeviceCanOTA(data : Uint8Array, callback : OnResultCallback<number>) : void {
		if (!this.isDeviceConnected()) return
		const command = new CmdRequestUpdate(new ParamRequestUpdate(data))
		const cmdResultCallback = new CmdResultCallback("inquiryDeviceCanOTA", callback, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdRequestUpdate) : number | undefined {
				return command.getResponse()?.result;
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 非RCSP库不用实现该方法————调整RCSP库的设备收数据的MTU(App的缓存)，让数据可以成功发出 */
	changeReceiveMtu() : void {
		if (!this.isDeviceConnected()) return
		const deviceInfo = this.mRcspOpImpl.getDeviceInfo(this.mOTADevice!);
		if (deviceInfo == undefined) return
		if (deviceInfo.receiveMtu < RcspConstant.DEFAULT_PROTOCOL_MTU) {
			deviceInfo.receiveMtu = RcspConstant.DEFAULT_PROTOCOL_MTU
			this.mRcspOpImpl.getDeviceInfoManager().updateDeviceInfo(this.mOTADevice!, deviceInfo);
		}
	}

	/** 进入升级模式 */
	enterUpdateMode(callback : OnResultCallback<number>) : void {
		if (!this.isDeviceConnected()) return
		const command = new CmdEnterUpdateMode()
		const cmdResultCallback = new CmdResultCallback("enterUpdateMode", callback, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdEnterUpdateMode) : number | undefined {
				return command.getResponse()?.result;
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 退出升级模式 */
	exitUpdateMode(callback : OnResultCallback<number>) : void {
		if (!this.isDeviceConnected()) return
		const command = new CmdExitUpdateMode()
		const cmdResultCallback = new CmdResultCallback("exitUpdateMode", callback, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdExitUpdateMode) : number | undefined {
				return command.getResponse()?.result;
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 读取设备升级状态 */
	queryUpdateResult(callback : OnResultCallback<number>) : void {
		if (!this.isDeviceConnected()) return
		// 去重：设备接收完升级数据后会连发多次 offset=0,len=0 的文件请求，每次都触发
		// OTAImpl._queryUpgradeResult -> 本方法，于是发出多条 CmdQueryUpdateResult。第一条
		// 拿到 result=0(UPGRADE_RESULT_COMPLETE 升级成功)后设备立刻 rebootDevice 断链重启，
		// 其余几条撞上断链被 RCSP 回调成 ERROR_IO_EXCEPTION(-35)，并抢在 OTAImpl 挂的
		// 100ms _callbackOTAStop 之前触发 onError，把"升级成功"的 onStopOTA 吞掉，界面只剩
		// "升级失败: code=-35"——固件其实已刷好(本会话 13089 包 0 丢包、result=0、设备重启均印证)。
		// 保证同一时刻只有一条查询在飞；拿到 result=0 后设备将重启，后续查询全是噪声，直接挡掉。
		if (this.mUpdateResultDone) {
			logi("queryUpdateResult: 已收到升级完成结果(0)，忽略设备重启前的重复查询")
			return
		}
		if (this.mUpdateResultPending) {
			logi("queryUpdateResult: 已有一条查询在飞，忽略重复请求(避免重启断链产生 -35)")
			return
		}
		this.mUpdateResultPending = true
		const self = this
		const wrapped : OnResultCallback<number> = {
			onResult: (result : number) => {
				self.mUpdateResultPending = false
				// 0 = UPGRADE_RESULT_COMPLETE(见 jl_ota_2.1.0)。128=DOWNLOAD_BOOT_LOADER_SUCCESS
				// 会触发回连，是非终结态，不能置 done，否则回连后的第二阶段查询会被挡掉。
				if (result === 0) self.mUpdateResultDone = true
				callback.onResult(result)
			},
			onError: (code : number, message : string) => {
				self.mUpdateResultPending = false
				callback.onError(code, message)
			}
		}
		const command = new CmdQueryUpdateResult()
		const cmdResultCallback = new CmdResultCallback("queryUpdateResult", wrapped, {
			hasResult() : number {
				return 0;
			},
			handleResult(_device : Device, command : CmdQueryUpdateResult) : number | undefined {
				return command.getResponse()?.result;
			}
		});
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 重启或关闭设备 */
	rebootDevice(callback : OnResultCallback<boolean> | null) : void {
		if (!this.isDeviceConnected()) return
		const command = new CmdRebootDevice(new ParamRebootDevice(ParamRebootDevice.OP_REBOOT))
		const cmdResultCallback = new CmdBooleanCallback("rebootDevice", callback);
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 设置TWS设备通知 */
	stopNotifyADV(callback : OnResultCallback<boolean>) : void {
		if (!this.isDeviceConnected()) return
		const command = new CmdControlADVStream(CmdControlADVStream.CTRL_OP_CLOSE)
		const cmdResultCallback = new CmdBooleanCallback("stopNotifyADV", callback);
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 回复发送升级固件数据块 */
	receiveFileBlock(offset : number, len : number, data : Uint8Array, callback : OnResultCallback<boolean>) : void {
		if (!this.isDeviceConnected()) return
		const command = this.getCacheCmdResponse(offset, len)
		if (command == null) return
		let status = ResponseResult.STATUS_SUCCESS;
		if (data.length == 0 && offset > 0 && len > 0) {
			status = ResponseResult.STATUS_INVALID_PARAM;
		}
		const response = command.getResponse()
		if (response != undefined) {
			response.setSn(command.getSn())
			response.block = data;
			response.setStatus(status);
			// command.isCommand = false
			command.setCommand(false)
		}
		const cmdResultCallback = new CmdBooleanCallback("receiveFileBlock", callback);
		this.mRcspOpImpl.sendRCSPCommand(this.mOTADevice!, command, this.cmdTimeout, cmdResultCallback)
	}

	/** 获取缓存的命令 */
	private getCacheCmdResponse(offset : number, len : number) : CmdReadFileBlock | null {
		for (let index = 0; index < this.cmdFileBlockCache.length; index++) {
			const cmd = this.cmdFileBlockCache[index];
			if (cmd.getParam().offset == offset && cmd.getParam().len == len) {
				this.cmdFileBlockCache.splice(index, 1)
				return cmd
			}
		}
		return null
	}

	/** 添加缓存的命令 */
	private saveCacheCmdResponse(cmd : CmdReadFileBlock) {
		this.cmdFileBlockCache.push(cmd)
	}
}
// class OTAOnRcspCallback extends OnRcspCallback {

// }
/**处理结果 */
interface IHandleResult<T, C extends CommandBase> {
	hasResult(device : Device, command : C) : number;
	handleResult(device : Device, command : C) : T;
}
/** 命令结果处理 */
class CmdResultCallback<T, C extends CommandBase> implements CommandCallback<C> {
	protected readonly funcName : string;
	protected readonly callback : OnResultCallback<T> | null;
	protected readonly handle : IHandleResult<T, C>;
	// 一条命令只有一个结局。结果已经回调过之后，迟到的错误不再往上传。
	// 场景：queryUpdateResult 返回 0(UPGRADE_RESULT_COMPLETE 升级完成)后，OTA 库立刻
	// rebootDevice 并挂一个 100ms 的 _callbackOTAStop；设备重启断链，RCSP 会把这条命令的
	// callback 再用 ERROR_IO_EXCEPTION(-35) 回调一次。OTAImpl._callbackOTAError 会把
	// mUpgradeCbHelper.callback 置 null，于是 100ms 后本该到达的 onStopOTA(升级成功)被
	// 静默丢弃，界面只看到"升级失败: code=-35"——固件其实已经刷好了。设备重启越快越必中。
	// 下面 onError 里对 changeCommunicationWay 的特殊放行是 vendor 针对同类问题(命令成功后
	// 设备故意断链)打的单点补丁，这里做成通用的一次性回调。
	private mResponded : boolean = false;

	constructor(funcName : string, callback : OnResultCallback<T> | null, handle : IHandleResult<T, C>) {
		if (null == handle) {
			loge("IHandleResult is null.");
		}
		this.funcName = funcName;
		this.callback = callback;
		this.handle = handle;
	}

	public onCmdResponse(device : Device, command : C) : void {
		if (this.mResponded) {
			logi(this.funcName + ": 结果已回调过，忽略重复响应");
			return;
		}
		let code : number;
		let explain : string;
		if (command.getStatus() == ResponseBase.STATUS_SUCCESS) {
			const ret = this.handle.hasResult(device, command);
			if (ret == 0) {
				// 只在真正把结果交出去时才置位。走下面 onError 的分支时不能置位，
				// 否则紧接着的 this.onError 会被自己的守卫拦掉。
				this.mResponded = true;
				const result = this.handle.handleResult(device, command);
				this.callback?.onResult(result);
				return;
			}
			code = ErrorCode.ERROR_REPLY_BAD_RESULT;
			explain = "" + ret;
		} else {
			code = ErrorCode.ERROR_REPLY_BAD_STATUS;
			explain = "" + command.getStatus();
		}
		this.onError(device, code, ErrorCode.getErrorDesc2(code, explain));
	}

	public onError(_device : Device, code : number, message : string) : void {
		if (this.mResponded) {
			logi(this.funcName + ": 结果已回调过，忽略迟到的错误 code=" + code + " " + message);
			return;
		}
		this.mResponded = true;
		message = this.funcName + ":" + message;
		if (this.funcName !== "changeCommunicationWay") {
			this.callback?.onError(code, message);
		}
	}
}
/**  通用结果解析 */
class CmdBooleanCallback extends CmdResultCallback<Boolean, CommandBase> {
	constructor(funcName : string, callback : OnResultCallback<Boolean> | null) {
		const iHandle : IHandleResult<Boolean, CommandBase> = {
			hasResult() : number {
				return 0;
			},
			handleResult() : boolean {
				return true;
			}
		}
		super(funcName, callback, iHandle);
	}
}