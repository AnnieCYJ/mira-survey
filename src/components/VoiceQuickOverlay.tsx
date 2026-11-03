import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal, Dimensions, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceTriggerApi, useVoiceTriggerLive } from '../hooks/useVoiceTrigger';

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
  // ★ 2026-10-12：直播态（visible/inlineMode/setLiveText）走 live context，
  //   onReleaseRef 走稳定 API context——浮层自己就是转写展示者，订阅 live 正合适。
  const { visible, inlineMode, setLiveText } = useVoiceTriggerLive();
  const { onReleaseRef } = useVoiceTriggerApi();
  const { state, transcript, start, stop, peek } = useVoiceInput();
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
        // ★ 2026-10-08：松手**即刻跳转**，不再等识别器收尾。
        //   旧实现 `stop().then(...)` 必须等原生 onSpeechEnd 才导航，而 useVoiceInput.stop()
        //   有 800ms 兜底 —— 那段「手已松开、界面纹丝不动」的空等，就是「跳转太慢/不丝滑」的根因。
        //   现在：stopSpeech 照常发出（录音立刻结束），但导航用**当下已有的实时转写**同步触发，
        //   延迟只取决于松手这一刻本身；只有实时转写为空（极端情况）才退回等 stop() 的最终结果。
        // ★ 2026-10-08 补丁：用 `peek()` 读同步 ref 的最新转写，而非 React state（state 在
        //   onSpeechResults/onSpeechEnd 同帧触发时可能仍是旧空串）→ 根治「松手后转写为空、跳转没文字」。
        const snapshot = (peek() || transcript || '').trim();
        const done = stop().catch(() => peek() || ''); // 异步收尾，不阻塞跳转
        if (snapshot) {
          console.log('[VoiceOverlay] 松手即跳（用实时转写）:', snapshot);
          if (onReleaseRef.current) onReleaseRef.current(snapshot);
        } else {
          done.then((t) => {
            const finalText = (t || peek() || '').trim();
            console.log('[VoiceOverlay] 兜底最终转写:', finalText);
            // ★ 即便最终仍为空（识别彻底失败），也照常跳转 VoiceChat，避免「松手后毫无反应」的死局；
            //   进入后用户可在 AI 页直接打字。
            if (onReleaseRef.current) onReleaseRef.current(finalText);
          });
        }
      }
    }

    // ★ 隐藏 / 卸载时真正停掉所有循环动画
    return stopAll;
  }, [visible]); // eslint-disable-line

  const pillBottom = theme.layout.tabBarHeight + theme.sp(4) + 4;
  const isRecording = state === 'listening';

  // ★ inlineMode（首页）：浮层不显示，实时转写改为推给常驻 AI 气泡（HomeAiBubble）显示。
  //   松手后（visible=false）**保留**最后一句转写（不再清空），供 close() 写入 spokenText，
  //   使「从 VoiceChat 返回首页」时气泡仍显示「你说的话」；下一次 open() 会主动清空 liveText。
  useEffect(() => {
    if (!inlineMode) return;
    setLiveText(transcript || '');
  }, [inlineMode, visible, transcript, setLiveText]);

  return (
    <Modal visible={visible && !inlineMode} transparent animationType="fade" statusBarTranslucent>
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
    backgroundColor: 'rgba(10, 8, 20, 0.55)', // mira-ocean：白雾 → 暗黑遮罩（对齐深色主题，不再把整屏洗白）
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
  title: { fontSize: theme.fontSize.body, fontWeight: '600', color: mm.colors.ink }, // 「正在聆听…」ink
  subtitle: { marginTop: 1, fontSize: theme.fontSize.xs, color: '#9C968C' }, // 「松开后发送给我」
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: mm.colors.purpleCore },
});
