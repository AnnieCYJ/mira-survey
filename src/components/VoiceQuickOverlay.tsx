import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal, Dimensions, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';

const SCREEN_W = Dimensions.get('window').width;
const PILL_H = 72;
const PILL_R = 36;
// 固定宽度：不随文字变长横向拉伸到最大，长文本改为换行、胶囊纵向撑高
const PILL_W = SCREEN_W * 0.72;

/**
 * VoiceQuickOverlay — 内向光晕 AI 语音输入条
 * 结构：[左 mic + 5根声波] —— [右 hint+transcript]（麦克风在左，文字在右）
 * mic 极简：只有圆底+icon，无外环发光
 * 光晕：pill 内向渐变 + 呼吸 opacity 动画
 */
export default function VoiceQuickOverlay() {
  const { visible, onReleaseRef } = useVoiceTrigger();
  const { state, transcript, start, stop } = useVoiceInput();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const breatheAnim = useRef(new Animated.Value(0.7)).current;
  const startedRef = useRef(false);

  const wavesRef = useRef([
    new Animated.Value(0.6),
    new Animated.Value(0.6),
    new Animated.Value(0.6),
    new Animated.Value(0.6),
    new Animated.Value(0.6),
  ]).current;

  // 固定宽度，长文本换行撑高而非横向拉伸；移除"随字数变宽到最大"的旧逻辑
  const pillWidth = PILL_W;

  useEffect(() => {
    // ★ 动画生命周期：旧实现用递归 `.start(callback)` 起了 5 条**永不停**的声波循环
    //   + 1 条 `Animated.loop` 呼吸循环，且效果函数没有 cleanup —— 浮层隐藏后它们
    //   依旧在后台空转（每 800ms 一次 JS 回调 + 6 条常驻动画），持续抢 UI/JS 线程，
    //   是「松手跳转 AI 问答页时转场卡顿」的元凶之一。这里改为可停止的句柄 + cleanup。
    let cancelled = false;
    let breatheLoop: Animated.CompositeAnimation | null = null;
    const waveAnims: Animated.CompositeAnimation[] = [];

    const stopAll = () => {
      cancelled = true;
      breatheLoop?.stop();
      waveAnims.forEach((a) => a?.stop());
    };

    if (visible) {
      startedRef.current = true;
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();

      breatheLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(breatheAnim, { toValue: 0.7, duration: 1500, useNativeDriver: true }),
        ])
      );
      breatheLoop.start();

      [0, 150, 300, 450, 600].forEach((delay, i) => {
        const loopOne = () => {
          if (cancelled) return;
          const anim = Animated.sequence([
            Animated.delay(delay),
            Animated.sequence([
              Animated.timing(wavesRef[i], { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
              Animated.timing(wavesRef[i], { toValue: 0.6, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
            ]),
          ]);
          waveAnims[i] = anim;
          anim.start(() => loopOne());
        };
        loopOne();
      });

      start().catch(() => {});
    } else {
      breatheAnim.setValue(0.7);
      wavesRef.forEach((w) => w.setValue(0.6));
      if (startedRef.current) {
        startedRef.current = false;
        const snapshot = transcript;
        stop().then((t) => {
          const finalText = (t || snapshot).trim();
          console.log('[VoiceOverlay] final transcript:', finalText);
          if (finalText && onReleaseRef.current) {
            onReleaseRef.current(finalText);
          }
        });
      }
    }

    // ★ 隐藏 / 卸载时真正停掉所有循环动画
    return stopAll;
  }, [visible]); // eslint-disable-line

  const pillBottom = theme.layout.tabBarHeight + theme.sp(4) + 4;
  const isRecording = state === 'listening';

  // ★ 配色统一走设计 token 的紫色系（accent1 #9D8AF0 / accentSolid #7C6AE0）。
  //   录音态只叠加「更亮 / 更饱和」的强度差，**绝不换色相** ——
  //   此前录音态硬编码了一整套 fuchsia 品红（#F0ABFC / #E879F9 / #C026D3 /
  //   rgba(232,121,249,…) 等，theme 里根本没有这些 token），
  //   导致「一开口就变粉」，与 design token 不符。
  const pillBorder = isRecording ? 'rgba(157,138,240,0.55)' : 'rgba(196,181,253,0.30)';
  const glowColors = isRecording
    ? ['transparent', 'rgba(124,106,224,0.28)', 'rgba(157,138,240,0.55)']
    : ['transparent', 'rgba(124,106,224,0.18)', 'rgba(157,138,240,0.38)'];
  const micBgColors = isRecording
    ? ['#F5F3FF', '#DDD6FE', '#A78BFA', '#7C6AE0']
    : ['#EDE9FE', '#C4B5FD', '#A78BFA', '#8B5CF6'];
  const pillBgColors = isRecording
    ? ['rgba(72,48,142,0.72)', 'rgba(46,28,102,0.82)', 'rgba(28,16,66,0.90)']
    : ['rgba(80,55,150,0.55)', 'rgba(50,30,110,0.65)', 'rgba(30,18,75,0.85)'];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.mask} pointerEvents="none" />

      <View style={[styles.pillWrap, { bottom: pillBottom }]} pointerEvents="box-none">
        <Animated.View style={[styles.pillShell, { width: pillWidth, opacity: fadeAnim }]}>
          {/* 底色渐变 */}
          <LinearGradient
            colors={pillBgColors}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* ★ 内向光晕 — 呼吸动画 */}
          <Animated.View style={[styles.innerGlow, { opacity: breatheAnim }]} pointerEvents="none">
            <LinearGradient
              colors={glowColors}
              locations={[0.4, 0.75, 1]}
              start={{ x: 0.3, y: 0.4 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* 顶部高光 */}
          <LinearGradient
            colors={['rgba(221,214,254,0.12)', 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.topHighlight}
            pointerEvents="none"
          />

          {/* 边框发光层 */}
          <View style={[styles.borderGlow, { borderColor: pillBorder }]} pointerEvents="none">
            <LinearGradient
              colors={isRecording
                ? ['rgba(245,243,255,0.70)', 'transparent', 'rgba(157,138,240,0.50)', 'transparent', 'rgba(221,214,254,0.60)']
                : ['rgba(237,233,254,0.6)', 'transparent', 'rgba(167,139,250,0.3)', 'transparent', 'rgba(221,214,254,0.5)']
              }
              locations={[0, 0.2, 0.5, 0.7, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>

          {/* 内容：左 mic 声波 + 右文字（麦克风从右侧挪到左侧） */}
          <View style={[styles.content, { width: pillWidth - 16 }]}>
            <View style={styles.leftText}>
              <Text style={styles.hint}>{isRecording ? '按住说话' : '准备中…'}</Text>
              <Text
                style={[styles.transcript, transcript ? styles.transcriptHasText : undefined]}
                numberOfLines={4}
                ellipsizeMode="tail"
              >
                {transcript || (isRecording ? '松开发送' : '')}
              </Text>
            </View>

            <View style={styles.rightArea}>
              {/* 🎤 极简 mic：只有圆底+icon */}
              <View style={styles.micBtn}>
                <LinearGradient
                  colors={micBgColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                <Icon name="mic" size={18} color="#FFFFFF" strokeWidth={1.8} />
              </View>

              {/* 🎵 5 根声波 */}
              <View style={styles.waveform}>
                {[12, 20, 28, 20, 12].map((h, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: h,
                        backgroundColor: isRecording ? 'rgba(221,214,254,0.95)' : 'rgba(232,224,255,0.85)',
                        transform: [{ scaleY: wavesRef[i] }],
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 8, 20, 0.5)',
  },
  pillWrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', minHeight: PILL_H + 20,
  },
  pillShell: {
    minHeight: PILL_H, borderRadius: PILL_R,
    overflow: 'hidden', borderWidth: 1,
    borderColor: 'rgba(196, 181, 253, 0.3)',
    shadowColor: '#8B7CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  innerGlow: { ...StyleSheet.absoluteFillObject },
  topHighlight: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: PILL_H / 2,
    borderTopLeftRadius: PILL_R, borderTopRightRadius: PILL_R,
  },
  borderGlow: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: PILL_R, borderWidth: 1.5, overflow: 'hidden',
  },
  content: {
    flex: 1, flexDirection: 'row-reverse', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, gap: 12,
  },
  leftText: { flex: 1 },
  hint: { fontSize: 11, color: 'rgba(196,181,253,0.45)', letterSpacing: 0.5 },
  transcript: { marginTop: 2, fontSize: 14, color: 'rgba(221,214,254,0.45)' },
  transcriptHasText: { color: '#FFFFFF', fontWeight: '500', fontSize: 14 },
  rightArea: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#A78BFA', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28 },
  waveBar: { width: 3, borderRadius: 2 },
});
