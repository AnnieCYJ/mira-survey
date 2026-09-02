import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { theme } from '../theme/theme';
import Icon from './Icon';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const videoSource = require('../assets/relax.mp4');

// 容器用明确像素尺寸（不再用 aspectRatio + maxHeight，避免部分平台算错尺寸导致裁剪偏移）
const WRAP_W = SCREEN_W - theme.space.md * 2;
const WRAP_H = Math.min(Math.round(WRAP_W * 4 / 3), Math.round(SCREEN_H * 0.5));

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function RelaxVideoPlayer({ visible, onClose }: Props) {
  const videoRef = useRef<Video>(null);
  const [status, setStatus] = useState({ isPlaying: false, didJustFinish: false });
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(fade, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      videoRef.current?.playAsync?.();
    } else {
      Animated.timing(fade, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        videoRef.current?.pauseAsync?.();
        videoRef.current?.setPositionAsync(0);
      });
    }
  }, [visible, fade]);

  // 监听播放结束：直接暂停，视频已裁掉尾部黑帧，最后一帧就是小猫
  useEffect(() => {
    if (status.didJustFinish) {
      videoRef.current?.pauseAsync?.();
    }
  }, [status.didJustFinish]);

  const handleClose = () => {
    Animated.timing(fade, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(onClose);
  };

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]} pointerEvents="auto">
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          {
            opacity: fade,
            transform: [
              {
                scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
              },
            ],
          },
        ]}
        pointerEvents="auto"
      >
        <TouchableOpacity style={styles.close} onPress={handleClose} activeOpacity={0.7}>
          <Icon name="close" size={theme.fs(20)} color={theme.colors.textWhite} strokeWidth={2.5} />
        </TouchableOpacity>

        {/* 容器固定像素尺寸 + overflow:hidden；Video 用 COVER 填满（Web 端即 object-fit:cover）居中裁剪，无黑边 */}
        <View style={[styles.videoWrap, { width: WRAP_W, height: WRAP_H }]}>
          <Video
            ref={videoRef}
            source={videoSource}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            isLooping={false}
            shouldPlay
            useNativeControls={false}
            onPlaybackStatusUpdate={(s) => {
              if ('isPlaying' in s || 'didJustFinish' in s) {
                setStatus({
                  isPlaying: (s as any).isPlaying ?? false,
                  didJustFinish: (s as any).didJustFinish ?? false,
                });
              }
            }}
          />
        </View>

        <View style={styles.captionWrap}>
          <Text style={styles.caption}>悠然自得</Text>
          {status.didJustFinish ? (
            <Text style={styles.replayHint} onPress={() => videoRef.current?.replayAsync?.()}>
              播放完成 · 点击重播
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.ui.scrim,
    zIndex: 100,
  },
  card: {
    position: 'absolute',
    left: theme.space.md,
    right: theme.space.md,
    top: '22%',
    zIndex: 101,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.cardBgStrong,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  close: {
    position: 'absolute',
    top: theme.sp(2.5),
    right: theme.sp(2.5),
    zIndex: 102,
    width: theme.sp(8),
    height: theme.sp(8),
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.ui.scrimMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoWrap: {
    backgroundColor: theme.colors.ui.shadowBlack,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  captionWrap: {
    padding: theme.space.md,
    alignItems: 'center',
  },
  caption: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
  },
  replayHint: {
    marginTop: theme.sp(1.5),
    fontSize: theme.fontSize.sm,
    color: theme.colors.accentSolid,
  },
});
