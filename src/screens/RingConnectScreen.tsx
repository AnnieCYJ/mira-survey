/**
 * RingConnectScreen —— 首次进入的「连接戒指」引导页（mira-ocean 深海玻璃风 · 精简版）
 * ---------------------------------------------------------------------------
 * 位置：登录 → AI 资料收集（OnboardingScreen）→ 【本页】→ 主界面。
 * 作用：在用户点「开始体验」之后、进主页之前，引导用户正确佩戴戒指并完成蓝牙连接。
 *
 * 精简布局（用户 2026-11-07 要求）：
 *   · 中间：金 / 银两枚戒指（透明 PNG，直接浮于蓝渐变，无外框）；
 *   · 图下方一句：怎么戴；
 *   · 再下方：直接「连接戒指」按钮（连接成功后变为「进入主界面」）—— 该按钮带磨砂玻璃框；
 *   · 底部常驻「稍后再连，先体验主界面」——任何状态下都可点（不再被连接中禁用）。
 *
 * 数据纪律：状态全部来自真实 BLE（RingBle / useRingState），绝不伪造连接成功。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';
import { useRingState } from '../hooks/useRingState';
import { RingBle } from '../ble/RingBleManager';
import { userStore } from '../data/userStore';
import Icon from '../components/Icon';

interface Props {
  /** 连接完成（或用户选择稍后连接）后回调，由 AuthGate 刷新会话并放行主页。 */
  onDone: () => void;
}

const RING_GOLD = require('../assets/ring_connect.png');
const RING_SILVER = require('../assets/ring_silver.png');

const STATUS_COLOR = {
  connected: theme.colors.success,
  scanning: theme.colors.warn,
  connecting: theme.colors.warn,
  error: theme.colors.danger,
  idle: theme.colors.textSub,
} as const;

export default function RingConnectScreen({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const ring = useRingState();
  const spin = useRef(new Animated.Value(0)).current;

  // 进入页面即尝试连接：后台扫描 + 自动连第一枚 LunaMira，不阻断阅读引导
  useEffect(() => {
    RingBle.autoConnect();
  }, []);

  const connected = ring.status === 'connected';
  const busy = ring.status === 'scanning' || ring.status === 'connecting';
  const failed = ring.status === 'error';
  const statusColor = STATUS_COLOR[ring.status];

  // 连接中转圈动画（仅搜索/连接中）
  useEffect(() => {
    if (!busy) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, spin]);

  const statusText = connected
    ? '已连接'
    : busy
      ? ring.status === 'scanning'
        ? '正在搜索戒指…'
        : '正在连接…'
      : failed
        ? '连接失败，请重试'
        : '未连接';

  const deviceName =
    ring.deviceBroadcastName?.trim() || ring.deviceName?.trim() || 'Luna Mira';

  const finish = async () => {
    // 用户选择「稍后再连」→ 主动断开并停掉常驻保活，避免离开后仍后台扫描
    try {
      await RingBle.disconnect();
    } catch {
      /* 忽略断开异常，不影响进入主页 */
    }
    await userStore.completeRingSetup();
    onDone();
  };

  const primaryPress = () => {
    if (connected) {
      finish();
    } else if (!busy) {
      RingBle.autoConnect();
    }
  };

  const primaryLabel = connected
    ? '进入主界面'
    : busy
      ? '连接中…'
      : failed
        ? '重新连接'
        : '连接戒指';

  return (
    <View style={s.root}>
      <LinearGradient
        colors={[...theme.colors.bgGradStops]}
        locations={theme.colors.bgGradLocs as unknown as number[]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <StatusBar barStyle="light-content" />

      {/* 顶部极简品牌 */}
      <View style={[s.brandRow, { marginTop: insets.top + theme.space.lg }]}>
        <Icon name="ring" size={theme.fontSize.h2} color={theme.colors.accentText} strokeWidth={1.8} />
        <Text style={s.brandName}>Luna Mira</Text>
      </View>

      {/* 中部：金 / 银两枚戒指（直接浮于蓝渐变，无外框）+ 佩戴说明 + 状态 */}
      <View style={s.center}>
        <View style={s.ringRow}>
          <Image source={RING_GOLD} style={s.ringImg} resizeMode="contain" />
          <Image source={RING_SILVER} style={s.ringImg} resizeMode="contain" />
        </View>
        <Text style={s.wearLine}>将戒指戴在食指或中指根部，传感器一面贴紧皮肤。</Text>

        {/* 连接状态（极简一行） */}
        <View style={s.statusRow}>
          <Animated.View
            style={[
              s.statusDot,
              { backgroundColor: statusColor },
              busy && {
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            {!busy ? (
              <Icon
                name={connected ? 'check' : failed ? 'close' : 'ring'}
                size={theme.fontSize.sm}
                color={theme.colors.bgBottom}
                strokeWidth={2.2}
              />
            ) : null}
          </Animated.View>
          <Text style={[s.statusText, { color: statusColor }]}>{statusText}</Text>
          {connected && ring.battery != null ? (
            <Text style={s.statusBattery}>· 电量 {ring.battery}%</Text>
          ) : null}
        </View>
        {!connected && !busy ? (
          <Text style={s.statusHint}>点击下方按钮，开始连接你的戒指</Text>
        ) : busy ? (
          <Text style={s.statusHint}>请保持手机靠近戒指，并在戒指上确认配对</Text>
        ) : null}
      </View>

      {/* 底部：直接连接 / 稍后再连 */}
      <View style={[s.footer, { paddingBottom: insets.bottom + theme.space.md }]}>
        <LinearGradient
          colors={['rgba(10,41,79,0)', theme.colors.bgBottom]}
          locations={[0, 0.5]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* ★ 主按钮带磨砂玻璃框（与 App 玻璃卡同款材质） */}
        <TouchableOpacity
          style={s.enterBtn}
          activeOpacity={0.85}
          disabled={busy && !connected}
          onPress={primaryPress}
        >
          {busy ? (
            <Animated.View
              style={[
                s.spinner,
                {
                  transform: [
                    {
                      rotate: spin.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : connected ? (
            <Icon name="chevronRight" size={theme.fontSize.lg} color={theme.colors.textWhite} strokeWidth={2.2} />
          ) : null}
          <Text style={s.enterTxt}>{primaryLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.skipBtn} activeOpacity={0.7} onPress={finish}>
          <Text style={s.skipTxt}>稍后再连，先体验主界面</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bgBottom },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space.md,
  },
  brandName: {
    fontSize: theme.fontSize.h2 * 1.4,
    color: theme.colors.textTitle,
    letterSpacing: 1,
    fontFamily: 'Caveat',
    marginLeft: theme.space.xs,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.card,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.lg,
  },
  ringImg: {
    width: 112,
    height: 142, // 209×266 等比（缩小）
  },
  wearLine: {
    fontSize: theme.fontSize.body,
    color: theme.colors.textBody,
    textAlign: 'center',
    marginTop: theme.space.lg,
    lineHeight: theme.fontSize.body * 1.5,
    maxWidth: 280,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space.xl,
  },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.xs,
  },
  statusText: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
  },
  statusBattery: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    marginLeft: theme.space.xs,
  },
  statusHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    textAlign: 'center',
    marginTop: theme.space.xs,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.space.card,
    paddingTop: theme.space.lg,
  },
  // ★ 主按钮磨砂玻璃框：复用 theme.glassMorph（白 13% 底 + 白 28% 高光描边），白字
  enterBtn: {
    ...theme.glassMorph,
    height: 54,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.card,
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
  enterTxt: {
    color: theme.colors.textWhite,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.weight.semibold,
    marginRight: theme.space.xs,
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    borderTopColor: theme.colors.textWhite,
    marginRight: theme.space.xs,
  },
  skipBtn: { alignItems: 'center', paddingVertical: theme.space.sm, marginTop: theme.space.xs },
  skipTxt: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textSub,
    textDecorationLine: 'underline',
  },
});
