# UniApp_Ble_SDK



UniApp项目可使用的SDK

## 文档导航

在开始接入开发前，建议先阅读以下文档，可以帮助你快速上手：

| 文档 | 说明 |
| --- | --- |
| [VeepooUniAppSDK 使用文档](docs/VeepooUniAppSDK使用文档.md) | 完整的 API 与功能说明，接入必读 |
| [照片表盘传输简易流程图](docs/照片表盘传输简易流程图.pdf) | 表盘图片传输的整体流程示意（PDF） |

> 提示：几乎所有功能在 [demo 示例工程](code/demo/uniappTSDemo) 中都有对应的示例页面，建议结合文档与 demo 一起参考。

### 1.概述



------

UniAppSDK是深圳维亿魄科技有限公司（以下简称"本公司"）开发，专门为本公司智能穿戴类产品提供蓝牙控制开发平台

#### 1.1 运行环境



| 类别     | 范围                     | 备注                                                         | 日期       |
| -------- | ------------------------ | ------------------------------------------------------------ | ---------- |
| 客户端   | Android，iOS，微信小程序 | 支持BLE功能，HarmonOS Next 因兼容问题不可用（可点击下方链接进行查看） | 2026/08/07 |
| 开发平台 | HBuilderX                | 建议使用最新版本开发                                         | 2026/08/07 |

Uniapp无法兼容HarmonOS Next文档链接：[uni-app官网](https://uniapp.dcloud.net.cn/api/system/bluetooth.html)

#### 1.2 快速使用



为了帮助开发者快速接入，使用UniAppSDK，请开发前详细阅读 **[VeepooUniAppSDK 使用文档](docs/VeepooUniAppSDK使用文档.md)**

备注：所有功能都可以在demo中找到相关示例，请开发功能前参考demo，表盘传输，OTA等功能目前只支持杰里类型设备，其他设备暂不支持。

#### 1.3 注意事项



⚠注意ufw为固件解压之后的文件，跨项目/设备号 升级错误的文件，会导致设备变转，如需验证升级，需配置指定项目匹配的固件



### 2.目录结构



```
|- code -- 演示代码（demo）
	|- demo
		|- uniappTSDemo
|- docs
	|- txt -- hrv，睡眠，相似度，ECG 文本
	    |- ECG_Text.json
		|- hrv_font_tips.js
		|- similarity_tips.js
		|- sleep_text.txt
	|- VeepooUniAppSDK使用文档.md
	|- 照片表盘传输简易流程图.pdf
|- lib --核心库
	|- jieli_sdk 
	|- vp_sdk 
```



### 3.版本



| SDK版本 | 日期       | 编辑   | 修改内容            |
| ------- | ---------- | ------ | ------------------- |
| V1.0.0  | 2026/08/07 | 孙晓武 | 1.初版UniAppSDK发布 |