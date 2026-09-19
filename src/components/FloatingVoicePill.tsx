import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import Icon from './Icon';

const SCREEN_W = Dimensions.get('window').width;
const PILL_H = 52;

interface Props {
  onClose: () => void;
  onMicPress?: () => void;
  label?: string;
}

/**
 * 悬浮语音 Pill — Tab 栏紧贴 + 深底 + 紫色光晕
 */
export default function FloatingVoicePill({ onClose, onMicPress }: Props) {
  const insets = useSafeAreaInsets();
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (recording) {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.04, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      anim.start();
    } else {
      pulse.setValue(1);
    }
    return () => { anim?.stop(); };
  }, [recording]);

  const pillBottom = insets.bottom + theme.layout.tabBarHeight + 3;

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFillObject}
    >
      {/* 遮罩 */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.28)' }]}
      />

      {/* Pill — 紧贴 tab 上方 */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.wrap,
          {
            bottom: pillBottom,
            transform: [{ scale: pulse }],
          },
        ]}
      >
        {/* 向外大光晕 */}
        <View style={styles.outerGlow} pointerEvents="none" />

        {/* Pill 本体 */}
        <View style={styles.pill}>
          {/* 向内光晕层 (边框发光) */}
          <View style={styles.innerGlow} />

          {/* 内容 */}
          <View style={styles.content}>
            {/* 左：纯紫色 mic icon (无圆球) */}
            <Icon
              name="mic"
              size={theme.fs(26)}
              color="#C4B5FD"
              strokeWidth={2}
            />

            {/* 中：文字 */}
            <View style={styles.textArea}>
              <Text style={styles.hint}>
                {recording ? '正在聆听…' : '准备中…'}
              </Text>
              <Text style={[styles.transcript, text && styles.transcriptHasText]} numberOfLines={1}>
                {text || (recording ? '松开发送' : '')}
              </Text>
            </View>

            {/* 右：声波装饰 */}
            <View style={styles.waves}>
              <View style={[styles.waveBar, { height: 6 }]} />
              <View style={[styles.waveBar, { height: 12 }]} />
              <View style={[styles.waveBar, { height: 8 }]} />
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // 向外大光晕
  outerGlow: {
    position: 'absolute',
    width: SCREEN_W * 0.88 + 60,
    height: PILL_H + 60,
    borderRadius: theme.radius.pill,
    shadowColor: '#7C6AE0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1.0,
    shadowRadius: 32,
    elevation: 30,
    backgroundColor: 'transparent',
  },

  // Pill 本体
  pill: {
    width: SCREEN_W * 0.88,
    height: PILL_H,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    shadowColor: '#9D8AF0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 14,
  },

  // ★ 向内光晕：borderWidth + 深底 + 亮紫边框 = 边框发光
  innerGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#120E2A',
    borderWidth: 3,
    borderColor: '#9D8AF0',
    borderRadius: theme.radius.pill,
  },

  // 内容
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    top: 8, left: 8, right: 8, bottom: 8,
    paddingHorizontal: theme.sp(2.5),
  },

  textArea: { flex: 1, marginLeft: theme.sp(2) },
  hint: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.weight.medium,
    color: '#E8E0FF',
  },
  transcript: {
    marginTop: 1,
    fontSize: theme.fontSize.xs,
    color: 'rgba(232,224,255,0.55)',
    opacity: 0.7,
  },
  transcriptHasText: {
    color: '#FFFFFF',
    opacity: 1,
  },

  waves: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: '#9D8AF0', opacity: 0.85 },
});
