import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal, Dimensions, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';

const SCREEN_W = Dimensions.get('window').width;
// v20 §4.7：高 58px、radius pill
const PILL_H = 58;
const PILL_R = 29;
// 固定宽度：不随文字变长横向拉伸到最大，长文本改为换行、胶囊纵向撑高
const PILL_W = SCREEN_W * 0.72;

// v20 §2.6/§9.9：外圈 = 品牌五色环绕渐变（紫→粉→蜜→黄绿→蓝→紫），边宽 2.5px、6s 流动。
// 实现 = 「渐变重复两遍 + translateX 流动」（规范 ⚠️ 禁止 conic+rotate：非正方形包围盒会剧变）：
// 渐变层宽 = pill 宽 ×2，11 个 stop（一个周期 = 5 色 + 回到起点紫），每 6s 平移一个周期，无缝循环。
const RIM_COLORS = [
  '#9D8AF0', '#F2A3C6', '#F0C46E', '#D5E384', '#7EA6F8',
  '#9D8AF0', '#F2A3C6', '#F0C46E', '#D5E384', '#7EA6F8',
  '#9D8AF0',
];
const RIM_W = 2.5;

/**
 * VoiceQuickOverlay — AI 语音录音浮框（v20 §4.7 `FloatingVoicePill`）
 * 全 App 唯一「五色环绕」元素：白雾遮罩 + 白底 pill + 五色流动外圈 + 紫 mic/波柱。
 */
export default function VoiceQuickOverlay() {
  const { visible, onReleaseRef } = useVoiceTrigger();
  const { state, transcript, start, stop } = useVoiceInput();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  // 外圈流动：0 → -PILL_W（一个周期），6s linear 循环
  const flowAnim = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);

  // 3 根紫波柱：scaleY 0.45↔1.35、1.05s 交替、错峰 0.18s
  const wavesRef = useRef([
    new Animated.Value(0.9),
    new Animated.Value(0.9),
    new Animated.Value(0.9),
  ]).current;

  useEffect(() => {
    // ★ 动画生命周期：全部可停止句柄 + cleanup（浮层隐藏后不空转）
    let cancelled = false;
    const flowLoop: Animated.CompositeAnimation = Animated.loop(
      Animated.timing(flowAnim, { toValue: -PILL_W, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    );
    const waveAnims: Animated.CompositeAnimation[] = [];

    const stopAll = () => {
      cancelled = true;
      flowLoop.stop();
      waveAnims.forEach((a) => a?.stop());
    };

    if (visible) {
      startedRef.current = true;
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      flowLoop.start();

      [0, 180, 360].forEach((delay, i) => {
        const loopOne = () => {
          if (cancelled) return;
          const anim = Animated.sequence([
            Animated.delay(delay),
            Animated.sequence([
              Animated.timing(wavesRef[i], { toValue: 1.35, duration: 525, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
              Animated.timing(wavesRef[i], { toValue: 0.45, duration: 525, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
            ]),
          ]);
          waveAnims[i] = anim;
          anim.start(() => loopOne());
        };
        loopOne();
      });

      start().catch(() => {});
    } else {
      flowAnim.setValue(0);
      wavesRef.forEach((w) => w.setValue(0.9));
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

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      {/* v20 §9.9：遮罩 = 白雾（全稿白底系统，留灰块会发闷；白雾下五色才鲜亮） */}
      <View style={styles.mask} pointerEvents="none" />

      <View style={[styles.pillWrap, { bottom: pillBottom }]} pointerEvents="box-none">
        <Animated.View style={[styles.pillShell, { width: PILL_W, opacity: fadeAnim }]}>
          {/* 五色流动外圈：渐变层宽 ×2，translateX 循环；内层白底 pill 内缩 2.5px 露出边缘 */}
          <Animated.View
            style={[styles.rimLayer, { width: PILL_W * 2, transform: [{ translateX: flowAnim }] }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={RIM_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* 白底内容层（inset 2.5px = 五色边宽） */}
          <View style={styles.inner}>
            {/* mic 34px 紫 tint 圆：#E7E1FB 底 / #6E58C8 icon（19px） */}
            <View style={styles.micBtn}>
              <Icon name="mic" size={19} color={mm.colors.purpleDeep} strokeWidth={1.9} />
            </View>

            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={1}>
                {isRecording ? (transcript || '正在聆听…') : '正在聆听…'}
              </Text>
              <Text style={styles.subtitle}>松开后发送给我</Text>
            </View>

            {/* 右侧 3 根紫波柱 */}
            <View style={styles.waveform}>
              {[10, 14, 10].map((h, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      height: h,
                      backgroundColor: mm.colors.purpleCore,
                      transform: [{ scaleY: wavesRef[i] }],
                    },
                  ]}
                />
              ))}
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
    backgroundColor: 'rgba(252, 251, 250, 0.58)', // v20：白雾（原暗黑 rgba(10,8,20,.5) 废弃）
  },
  pillWrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', minHeight: PILL_H + 20,
  },
  pillShell: {
    height: PILL_H, borderRadius: PILL_R,
    overflow: 'hidden',
    // 外发光：让 pill 从白雾里浮起来（§2.6：blur 7 / .55）
    shadowColor: '#9D8AF0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55, shadowRadius: 7, elevation: 8,
    backgroundColor: '#FFFFFF',
  },
  rimLayer: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
  },
  inner: {
    position: 'absolute', top: RIM_W, left: RIM_W, right: RIM_W, bottom: RIM_W,
    borderRadius: PILL_R - RIM_W,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  micBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: mm.colors.purpleSoft, // #E7E1FB
  },
  textCol: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: mm.colors.ink }, // 「正在聆听…」ink
  subtitle: { marginTop: 1, fontSize: 12.5, color: '#9C968C' }, // 「松开后发送给我」
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: mm.colors.purpleCore },
});
