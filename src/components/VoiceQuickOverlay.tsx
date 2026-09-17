import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal, Dimensions } from 'react-native';
import { theme } from '../theme/theme';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';

const SCREEN_W = Dimensions.get('window').width;

export default function VoiceQuickOverlay() {
  const { visible, onReleaseRef, close } = useVoiceTrigger();
  const { state, transcript, start, stop, isAvailable, error } = useVoiceInput();
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);

  useEffect(() => {
    if (visible) {
      console.log('[VoiceOverlay] 出现 → 开始录音');
      startedRef.current = true;
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80 }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      start().catch(() => {});
    } else {
      console.log('[VoiceOverlay] 关闭 → 停录+navigate');
      // 🔥 不等关闭动画，直接让 React Modal 瞬间消失（下一个 screen 盖上来）
      console.log("[PERF] T2 Overlay 关闭 effect fired");
      if (startedRef.current) {
        startedRef.current = false;
        const snapshot = transcript; // 先抓当前 partial transcript 做 fallback
        console.log("[PERF] T4 stop() 开始等待原生...");
        stop().then((t) => {
          console.log("[PERF] T4.5 stop() 返回 final transcript (耗时已算入)");
          const finalText = (t || snapshot).trim();
          console.log('[VoiceOverlay] final transcript:', finalText);
          if (finalText && onReleaseRef.current) {
            onReleaseRef.current(finalText);
          }
        });
      }
    }
  }, [visible]); // eslint-disable-line

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.mask}>
        <View style={styles.centerHint}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: fadeAnim }}>
            <LinearGradient
              colors={[theme.colors.accent1, theme.colors.accent2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.micCircle}
            >
              <Icon 
                name="mic" 
                size={theme.fs(48)} 
                color={theme.colors.textWhite} 
                strokeWidth={2} 
              />
            </LinearGradient>
          </Animated.View>

          <Animated.Text style={[styles.hint1, { opacity: fadeAnim }]}>
            {state === 'listening' ? '正在听你说...' : '准备中...'}
          </Animated.Text>

          <Animated.Text 
            style={[
              styles.transcript,
              transcript && styles.transcriptHasText,
              { opacity: fadeAnim },
            ]} 
            numberOfLines={3}
          >
            {transcript || (state === 'listening' ? '请开始说话' : '')}
          </Animated.Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!isAvailable && !error ? <Text style={styles.error}>语音识别不可用</Text> : null}

          <Animated.Text style={[styles.hint2, { opacity: fadeAnim }]}>
            松开发送
          </Animated.Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerHint: { alignItems: 'center' },
  micCircle: {
    width: theme.layout.tabCenterSize * 2.2,
    height: theme.layout.tabCenterSize * 2.2,
    borderRadius: theme.layout.tabCenterSize * 1.1,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadow.center,
  },
  hint1: {
    marginTop: theme.sp(4),
    fontSize: theme.fs(18),
    color: theme.colors.textWhite,
    fontWeight: '600',
  },
  transcript: {
    marginTop: theme.sp(2),
    fontSize: theme.fs(16),
    color: theme.colors.textWhite,
    textAlign: 'center',
    maxWidth: SCREEN_W * 0.75,
    opacity: 0.5,
  },
  transcriptHasText: { opacity: 1, fontWeight: '500' },
  hint2: {
    marginTop: theme.sp(4),
    fontSize: theme.fs(12),
    color: 'rgba(255,255,255,0.5)',
  },
  error: {
    marginTop: theme.sp(2),
    fontSize: theme.fs(13),
    color: '#ff6b6b',
  },
});
