<template>
	<view class="root-view" v-if="stats">
		<view class="top-content" id="test">
			<canvas style="width:100%;height:100%;" canvas-id="shareFrends" @touchstart="touchstart"
				@touchmove="touchmove" @touchend="touchend"></canvas>
		</view>
		<view class="bottom-content">
			<view class="btn-white" @click="clickCancel">取消</view>
			<view class="btn-white" @click="clickOverturn">翻转</view>
			<view class="btn-white" @click="clickSelect">选取</view>
		</view>
	</view>

	<canvas v-if="stats" :style="{ width: devScreenWidth + 'px', height: devScreenHeight + 'px' }"
		canvas-id="shareFrends2"></canvas>
	<canvas :style="{ width: smallDevScreenWidth + 'px', height: smallDevScreenHeight + 'px' }"
		canvas-id="shareFrends3"></canvas>

	<!-- 移除 type="2d"，改用 uni 标准 canvas，兼容 App/小程序/所有端 -->
	<canvas v-if="stats" canvas-id="myCanvas"
		style="position:fixed;top:-9999px;left:-9999px;width:172px;height:207px;"></canvas>
</template>

<script lang="ts">
	import { bmpConvert } from "../../../../jieli_sdk/jl_lib/jl_bmpConvert_1.0.0";
	import { veepooFeature } from '../../../../common/index.js'

	var lastTouchPoint = { x: 0, y: 0 };
	var oldDist = 0;
	var eventChannel : WechatMiniprogram.EventChannel;

	export default {
		data() {
			return {
				devScreenWidth: 240,
				devScreenHeight: 280,
				srcImagePath: '',
				ArrayValue: [],
				stats: true,

				smallDevScreenWidth: 172,
				smallDevScreenHeight: 207,
				devSmallBgWidth: 152,
				devSmallBgHeight: 187,
				devScale: 1,

				canvasHeight: 0,
				canvasWidth: 0,
				dpr: 1,
			}
		},

		onLoad(option) {
			// @ts-ignore
			this.imagePath = option.imagePath
			eventChannel = this.getOpenerEventChannel()

			// @ts-ignore
			this.devScreenWidth = parseInt(option.width)
			// @ts-ignore
			this.devScreenHeight = parseInt(option.height)

			console.log("devScreenWidth : " + this.devScreenWidth);
			console.log("devScreenHeight : " + this.devScreenHeight);
		},

		onReady() {
			this.screenWidth = uni.getSystemInfoSync().windowWidth;
			this.dpr = uni.getWindowInfo().pixelRatio

			uni.getImageInfo({
				// @ts-ignore
				src: this.imagePath,
				success: (e) => {
					this.baseWidth = e.width
					this.baseHeight = e.height
					this.imgLoad()
				}
			})
		},

		methods: {
			getDialInfo() {
				let self = this;
				let type = uni.getStorageSync('customType');
				let value = { type }

				veepooFeature.veepooSendGetCustomDialInfoManager(value, function (e : any) {
					console.log("屏幕信息=》", e)
					self.devScreenWidth = e.resolution[0]
					self.devScreenHeight = e.resolution[1]
					self.smallDevScreenWidth = e.border[0]
					self.smallDevScreenHeight = e.border[1]
					self.devSmallBgWidth = e.thumbnails[0]
					self.devSmallBgHeight = e.thumbnails[1]
				})
			},

			imgLoad() {
				const query = uni.createSelectorQuery();
				query.select('#test').boundingClientRect((res) => {
					console.log("this.canvasWidth " + res.width);

					this.devScale = (0.64 * res.width) / this.devScreenWidth
					this.canvasHeight = res.height / this.devScale
					this.canvasWidth = res.width / this.devScale
					this.boxWidth = this.devScreenWidth
					this.boxHeight = this.devScreenHeight

					if (this.baseHeight > this.baseWidth) {
						this.multiple = this.baseWidth / this.boxWidth
						this.initHeight = this.baseHeight / this.multiple
						this.initWidth = this.boxWidth
						this.transferOffset.x = (this.canvasWidth - this.boxWidth) / 2
						this.transferOffset.y = -(this.initHeight - this.canvasHeight) / 2
					} else {
						this.multiple = this.baseHeight / this.boxHeight
						this.initHeight = this.boxHeight
						this.initWidth = this.baseWidth / this.multiple
						this.transferOffset.x = -(this.initWidth - this.canvasWidth) / 2
						this.transferOffset.y = (this.canvasHeight - this.boxHeight) / 2
					}

					this.scaleHeight = this.initHeight
					this.scaleWidth = this.initWidth
					this.createImage(this.transferOffset)
				}).exec()
			},

			createImage(transfer : { x : number, y : number }) {
				const boxMarginHorizontal = (this.canvasWidth - this.boxWidth) / 2;
				const boxMarginVertical = (this.canvasHeight - this.boxHeight) / 2;
				const ctx = uni.createCanvasContext('shareFrends')

				ctx.scale(this.devScale, this.devScale)
				let translateX = 0
				let translateY = 0
				let rotateAngle = 0

				switch (this.direction) {
					case 0:
						break;
					case 1:
						translateX = 0.5 * (this.canvasWidth - this.canvasHeight)
						translateY = 0.5 * (this.canvasHeight + this.canvasWidth)
						rotateAngle = -90
						break;
					case 2:
						translateX = this.canvasWidth
						translateY = this.canvasHeight
						rotateAngle = -180
						break;
					case 3:
						translateX = 0.5 * (this.canvasHeight + this.canvasWidth)
						translateY = 0.5 * (this.canvasHeight - this.canvasWidth)
						rotateAngle = -270
						break;
					default:
						break;
				}

				ctx.translate(translateX, translateY);
				ctx.rotate(rotateAngle * Math.PI / 180)

				ctx.globalAlpha = 1
				ctx.drawImage(this.imagePath, transfer.x, transfer.y, this.scaleWidth, this.scaleHeight);

				ctx.rotate(-rotateAngle * Math.PI / 180)
				ctx.translate(-translateX, -translateY);

				ctx.drawImage('/image/img_bg_line.png', boxMarginHorizontal, boxMarginVertical, this.boxWidth, this.boxHeight);
				ctx.globalAlpha = 0.25
				ctx.drawImage('/image/gray.png', 0, 0, this.canvasWidth, boxMarginVertical);
				ctx.drawImage('/image/gray.png', 0, boxMarginVertical, boxMarginHorizontal, this.boxHeight);
				ctx.drawImage('/image/gray.png', boxMarginHorizontal + this.boxWidth, boxMarginVertical, boxMarginHorizontal, this.boxHeight);
				ctx.drawImage('/image/gray.png', 0, boxMarginVertical + this.boxHeight, this.canvasWidth, boxMarginVertical);
				ctx.draw()
			},

			touchstart(e : WechatMiniprogram.TouchEvent) {
				lastTouchPoint = { x: 0, y: 0 }
				if (e.touches.length > 1) {
					oldDist = this._spacing(e)
					this.lastTouchDetailArray = e.touches
				}
			},

			touchmove(e : WechatMiniprogram.TouchEvent) {
				switch (e.touches.length) {
					case 1:
						if (lastTouchPoint.x == 0 && lastTouchPoint.y == 0) {
							lastTouchPoint.x = e.touches[0].clientX
							lastTouchPoint.y = e.touches[0].clientY
						} else {
							var xOffset = e.touches[0].clientX - lastTouchPoint.x
							var yOffset = e.touches[0].clientY - lastTouchPoint.y
							lastTouchPoint.x = e.touches[0].clientX
							lastTouchPoint.y = e.touches[0].clientY

							switch (this.direction) {
								case 0:
									this.transferOffset.x += xOffset
									this.transferOffset.y += yOffset
									break;
								case 1:
									this.transferOffset.x += -yOffset
									this.transferOffset.y += xOffset
									break;
								case 2:
									this.transferOffset.x += -xOffset
									this.transferOffset.y += -yOffset
									break;
								case 3:
									this.transferOffset.x += yOffset
									this.transferOffset.y += -xOffset
									break;
							}
							this.createImage(this.transferOffset)
						}
						break;

					case 2:
						const dValueX0 = e.touches[0].clientX - this.lastTouchDetailArray[0].clientX
						const dValueY0 = e.touches[0].clientY - this.lastTouchDetailArray[0].clientY
						const dValueX1 = e.touches[1].clientX - this.lastTouchDetailArray[1].clientX
						const dValueY1 = e.touches[1].clientY - this.lastTouchDetailArray[1].clientY
						this.lastTouchDetailArray = e.touches

						const isSameDirectionX = (dValueX0 <= 0 && dValueX1 <= 0) || (dValueX0 >= 0 && dValueX1 >= 0)
						const isSameDirectionY = (dValueY0 <= 0 && dValueY0 <= 0) || (dValueY0 >= 0 && dValueY1 >= 0)
						let type = 1

						if (!((dValueX0 == 0 && dValueY0 == 0) || (dValueX1 == 0 && dValueY1 == 0)) && isSameDirectionX && isSameDirectionY) {
							type = 0
						}

						if (type == 1) {
							let distance = this._spacing(e);
							let distanceDiff = distance - oldDist;
							let newScale = this.scale + 0.0005 * distanceDiff;

							if (newScale >= this.multiple && this.multiple > 2) {
								newScale = this.multiple;
							} else if (this.multiple < 2 && newScale >= 2) {
								newScale = 2;
							}
							if (newScale <= 1) {
								newScale = 1;
							}

							this.scale = newScale
							this.scaleWidth = newScale * this.initWidth;
							this.scaleHeight = newScale * this.initHeight;
							this.createImage(this.transferOffset)
						} else {
							let xOffset = Math.abs(dValueX0) > Math.abs(dValueX1) ? dValueX0 : dValueX1
							let yOffset = Math.abs(dValueY0) > Math.abs(dValueY1) ? dValueY0 : dValueY1

							switch (this.direction) {
								case 0:
									this.transferOffset.x += xOffset
									this.transferOffset.y += yOffset
									break;
								case 1:
									this.transferOffset.x += -yOffset
									this.transferOffset.y += xOffset
									break;
								case 2:
									this.transferOffset.x += -xOffset
									this.transferOffset.y += -yOffset
									break;
								case 3:
									this.transferOffset.x += yOffset
									this.transferOffset.y += -xOffset
									break;
							}
							this.createImage(this.transferOffset)
						}
						break;
				}
			},

			touchend(_e : WechatMiniprogram.BaseEvent) { },

			clickCancel(_e : WechatMiniprogram.BaseEvent) {
				uni.navigateBack()
			},

			clickOverturn() {
				this.direction = (this.direction + 1) % 4
				this.createImage(this.transferOffset)
			},

			clickSelect() {
				let self = this
				const transfer = this.transferOffset
				const boxMarginHorizontal = (this.canvasWidth - this.boxWidth) / 2
				const boxMarginVertical = (this.canvasHeight - this.boxHeight) / 2
				const ctx = uni.createCanvasContext('shareFrends')

				ctx.scale(this.devScale, this.devScale)
				let translateX = 0
				let translateY = 0
				let rotateAngle = 0

				switch (this.direction) {
					case 0: break;
					case 1:
						translateX = 0.5 * (this.canvasWidth - this.canvasHeight)
						translateY = 0.5 * (this.canvasHeight + this.canvasWidth)
						rotateAngle = -90
						break;
					case 2:
						translateX = this.canvasWidth
						translateY = this.canvasHeight
						rotateAngle = -180
						break;
					case 3:
						translateX = 0.5 * (this.canvasHeight + this.canvasWidth)
						translateY = 0.5 * (this.canvasHeight - this.canvasWidth)
						rotateAngle = -270
						break;
				}

				ctx.translate(translateX, translateY);
				ctx.rotate(rotateAngle * Math.PI / 180)
				ctx.globalAlpha = 1
				ctx.drawImage(this.imagePath, transfer.x, transfer.y, this.scaleWidth, this.scaleHeight);

				ctx.rotate(-rotateAngle * Math.PI / 180)
				ctx.translate(-translateX, -translateY);

				ctx.drawImage('/image/black.png', 0, 0, this.canvasWidth, boxMarginVertical);
				ctx.drawImage('/image/black.png', 0, boxMarginVertical, boxMarginHorizontal, this.boxHeight);
				ctx.drawImage('/image/black.png', boxMarginHorizontal + this.boxWidth, boxMarginVertical, boxMarginHorizontal, this.boxHeight);
				ctx.drawImage('/image/black.png', 0, boxMarginVertical + this.boxHeight, this.canvasWidth, boxMarginVertical);
				ctx.draw()

				let translateX2 = 0
				let translateY2 = 0
				let rotateAngle2 = 0

				switch (this.direction) {
					case 0: break;
					case 1:
						translateX2 = 0.5 * (this.devScreenWidth - this.devScreenHeight)
						translateY2 = 0.5 * (this.devScreenHeight + this.devScreenWidth)
						rotateAngle2 = -90
						break;
					case 2:
						translateX2 = this.devScreenWidth
						translateY2 = this.devScreenHeight
						rotateAngle2 = -180
						break;
					case 3:
						translateX2 = 0.5 * (this.devScreenHeight + this.devScreenWidth)
						translateY2 = 0.5 * (this.devScreenHeight - this.devScreenWidth)
						rotateAngle2 = -270
						break;
				}

				const ctx2 = uni.createCanvasContext('shareFrends2')
				ctx2.scale(this.devScale, this.devScale)
				ctx2.translate(translateX2, translateY2);
				ctx2.rotate(rotateAngle2 * Math.PI / 180)

				switch (this.direction) {
					case 0:
						ctx2.drawImage(this.imagePath, ((transfer.x - boxMarginHorizontal) / this.devScale), ((transfer.y - boxMarginVertical) / this.devScale), (this.scaleWidth / this.devScale), (this.scaleHeight / this.devScale));
						break;
					case 1:
						ctx2.drawImage(this.imagePath, (transfer.x / this.devScale), 0, (this.scaleWidth / this.devScale), (this.scaleHeight / this.devScale));
						break;
					default:
						ctx2.drawImage(this.imagePath, (transfer.x / this.devScale), (transfer.y / this.devScale), (this.scaleWidth / this.devScale), (this.scaleHeight / this.devScale));
						break;
				}
				ctx2.draw()

				setTimeout(() => {
					let arr : any = []

					uni.canvasGetImageData({
						canvasId: 'shareFrends2',
						x: 0,
						y: 0,
						width: this.devScreenWidth,
						height: this.devScreenHeight,
						success: (res) => {
							const tempData = res.data
							const data = new Uint8Array(tempData.byteLength)
							for (let index = 0; index < tempData.byteLength; index += 4) {
								const r = tempData[index];
								const g = tempData[index + 1];
								const b = tempData[index + 2];
								const a = tempData[index + 3];
								data[index] = b
								data[index + 1] = g
								data[index + 2] = r
								data[index + 3] = a
							}
							let val = {
								data2: data,
								devScreenWidth: this.devScreenWidth,
								devScreenHeight: this.devScreenHeight
							}
							arr[0] = val
						},
						fail: (error) => {
							console.error("canvasGetImageData fail :", error);
						}
					})

					uni.canvasToTempFilePath({
						canvasId: 'shareFrends2',
						x: 0,
						y: 0,
						width: this.devScreenWidth,
						height: this.devScreenHeight,
						destWidth: this.devSmallBgWidth,
						destHeight: this.devSmallBgHeight,
						success(res) {
							let back = '../../../../image/555.png';
							let pic = res.tempFilePath
							self.frame(back, pic, arr)
						}
					})
				}, 150);
			},

			// ====================== 这里是修复后的核心方法 ======================
			frame(back : string, pic : string, arr : any) {
				let self = this;

				// 完全使用 UniApp 标准 API，不使用 getContext，兼容所有端
				const ctx = uni.createCanvasContext('myCanvas');

				// 先画缩略图
				ctx.drawImage(pic, 0, 0, 172, 207);
				// 再画覆盖图 555.png
				ctx.drawImage(back, 0, 0, 172, 207);

				ctx.draw(false, () => {
					setTimeout(() => {
						uni.canvasToTempFilePath({
							canvasId: 'myCanvas',
							width: 172,
							height: 207,
							destWidth: 172,
							destHeight: 207,
							success: (ress) => {
								self.smallData(ress.tempFilePath, arr);
							},
							fail: (err) => {
								console.error('frame canvasToTempFilePath fail', err);
							}
						}, self);
					}, 100);
				});
			},

			smallData(tempFilePath : any, arr : any) {
				let self = this;
				const ctx = uni.createCanvasContext('shareFrends3');
				ctx.drawImage(tempFilePath, 0, 0, self.smallDevScreenWidth, self.smallDevScreenHeight);
				ctx.draw();

				this.stats = false;

				uni.canvasGetImageData({
					canvasId: 'shareFrends3',
					x: 0,
					y: 0,
					width: self.smallDevScreenWidth,
					height: self.smallDevScreenHeight,
					success: (res) => {
						const tempData = res.data
						const data = new Uint8Array(tempData.byteLength)
						for (let index = 0; index < tempData.byteLength; index += 4) {
							const r = tempData[index];
							const g = tempData[index + 1];
							const b = tempData[index + 2];
							const a = tempData[index + 3];
							data[index] = b
							data[index + 1] = g
							data[index + 2] = r
							data[index + 3] = a
						}
						let val = {
							data1: data,
							smallDevScreenWidth: self.smallDevScreenWidth,
							smallDevScreenHeight: self.smallDevScreenHeight
						}
						arr[1] = val
						self._bmpConvert(arr)
					},
					fail: (error) => {
						console.error("canvasGetImageData fail :", error);
					}
				})
			},

			_bmpConvert(val : any) {
				let self = this;
				let obj : any = {}

				val.forEach((item : any) => {
					if (item.data1) {
						const result1 = bmpConvert(1, item.data1, Math.floor(item.smallDevScreenWidth), Math.floor(item.smallDevScreenHeight))
						obj.data1 = result1
					} else {
						const result2 = bmpConvert(1, item.data2, Math.floor(item.devScreenWidth), Math.floor(item.devScreenHeight))
						obj.data2 = result2
					}
				})

				eventChannel.emit('onDialBgData', { data: obj });
				uni.navigateBack()
			},

			_spacing(event : WechatMiniprogram.TouchEvent) {
				var x = event.touches[0].clientX - event.touches[1].clientX;
				var y = event.touches[0].clientY - event.touches[1].clientY;
				return Math.sqrt(x * x + y * y);
			}
		},

		created() {
			this.ni = 0
			this.direction = 0
			this.imagePath = ''
			this.transferOffset = { x: 0, y: 0 }
			this.scale = 1
			this.screenWidth = 100
			this.multiple = 1
			this.baseWidth = 100
			this.baseHeight = 100
			this.initWidth = 100
			this.initHeight = 100
			this.scaleWidth = 100
			this.scaleHeight = 100
			this.boxWidth = 100
			this.boxHeight = 100
			this.lastTouchDetailArray = []
		}
	}
</script>

<style>
	.root-view {
		display: flex;
		height: 100%;
		width: 100%;
		flex-direction: column;
	}

	.top-content {
		position: relative;
		flex: 1;
	}

	#select-box {
		width: 480rpx;
		height: 480rpx;
	}

	.bottom-content {
		display: flex;
		flex-direction: row;
		height: 204rpx;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		background: #131313;
	}

	.btn-white {
		font-size: 36rpx;
		font-family: PingFangSC-Medium, PingFang SC;
		font-weight: 500;
		color: #FFFFFF;
		line-height: 50rpx;
		margin-left: 40rpx;
		margin-right: 40rpx;
	}

	.imageScroll {
		width: 100%;
		height: 430rpx;
		position: fixed;
		background-color: #f0f1f3;
	}

	.img {
		display: block;
		background-color: #f0f1f3;
		text-align: center;
	}
</style>