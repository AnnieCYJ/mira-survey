/**
 * FadeInImage —— 图片加载后淡入，平滑首帧解码卡顿（避免大图「啪」地弹出来）。
 * 跨平台（iOS 无 Image.fadeDuration，这里用 Animated 统一）。
 * 用法与 <Image> 基本一致，额外可选 duration。
 */
import React, { useRef, useState } from 'react';
import { Image, Animated, Easing } from 'react-native';
import type { ImageSourcePropType, ImageResizeMode, ViewStyle } from 'react-native';

interface Props {
  source: ImageSourcePropType;
  style?: ViewStyle | any;
  resizeMode?: ImageResizeMode;
  duration?: number;
}

export default function FadeInImage({ source, style, resizeMode, duration = 260 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(false);

  const fade = () => {
    if (done) return;
    setDone(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.Image
      source={source}
      style={[style, { opacity }]}
      resizeMode={resizeMode}
      onLoad={fade}
      onLoadEnd={fade}
    />
  );
}
