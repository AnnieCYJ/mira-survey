import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, TouchableOpacity,
  Platform, UIManager, type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import Card from './Card';
import { TASK_ICONS, type TaskItem } from '../data/tasks';

// v16 五色系统：四类任务 = soft→mid 双档渐变（图标方块用），青 #CFFAFE/#67E8F9 已删
const TYPE_GRADIENTS: Record<number, [string, string]> = {
  0: [mm.colors.roseSoft, mm.colors.roseMid],     // 呼吸冥想 = 情绪·粉
  1: [mm.colors.purpleSoft, mm.colors.purpleMid], // 认知提升 = 认知·紫
  2: [mm.colors.skySoft, mm.colors.skyMid],       // 专注力提升 → 蓝（旧青语义由蓝接管）
  3: [mm.colors.honeySoft, mm.colors.honeyMid],   // 知识学习 = 代谢·黄
};
// 图标色 = 对应 deep 档（soft 底上白 icon 对比不足）
const TYPE_ICON_COLORS: Record<number, string> = {
  0: mm.colors.roseDeep,
  1: mm.colors.purpleDeep,
  2: mm.colors.skyDeep,
  3: mm.colors.honeyDeep,
};
const TYPE_LABEL = ['01', '02', '03', '04'];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * TaskDeck v4 — 竖长条 + 明显错落
 *
 * 核心变化：
 * ── 卡片固定宽 220px，居中（竖长条，高>宽）
 * ── 错落大幅加强：rotate ±8°，tx ±22px
 * ── 每层缩放/透明度递进
 */

const VISIBLE = 3;
const CARD_W = 220;  // 固定宽 → 竖长条

// pos=0 顶卡，pos=1 第二层（左倾），pos=2 第三层（右倾），pos=3 第四层（左倾）
const SEED_ROTATE = [0, -12, 11, -10];       // 大角度正负交替
const SEED_TX = [0, -48, 48, -32];        // 明显错落
const SEED_TY = [0, 4, 12, 20];          // 层叠深度
const SEED_SCALE = [1, 0.95, 0.90, 0.86];
const SEED_OPACITY = [1, 0.92, 0.82, 0.70];
const EXIT_THRESHOLD = 60;

interface Props {
  tools: TaskItem[];
  onComplete: (id: string) => void;
}

function seedAt(pos: number) {
  const i = Math.min(pos, SEED_ROTATE.length - 1);
  return { tx: SEED_TX[i], ty: SEED_TY[i], rot: SEED_ROTATE[i], sc: SEED_SCALE[i], op: SEED_OPACITY[i] };
}

export default function TaskDeck({ tools, onComplete }: Props) {
  const [topIdx, setTopIdx] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const n = tools.length;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lastCount = useRef(n);
  const enterAnims = useRef<Record<string, Animated.Value>>({});
  const cardAnims = useRef<Record<string, {
    tx: Animated.Value; ty: Animated.Value; rot: Animated.Value; sc: Animated.Value;
  }>>({});

  useEffect(() => {
    if (n === 0) return;
    tools.forEach((t) => {
      if (!cardAnims.current[t.id]) {
        cardAnims.current[t.id] = {
          tx: new Animated.Value(0), ty: new Animated.Value(0),
          rot: new Animated.Value(0), sc: new Animated.Value(1),
        };
      }
    });
    tools.forEach((t, i) => {
      const pos = (i - topIdx + n) % n;
      const s = seedAt(pos);
      const pa = cardAnims.current[t.id];
      Animated.parallel([
        Animated.spring(pa.tx, { toValue: s.tx, friction: 7, tension: 120, useNativeDriver: true }),
        Animated.spring(pa.ty, { toValue: s.ty, friction: 7, tension: 120, useNativeDriver: true }),
        Animated.spring(pa.rot, { toValue: s.rot, friction: 7, tension: 120, useNativeDriver: true }),
        Animated.spring(pa.sc, { toValue: s.sc, friction: 7, tension: 120, useNativeDriver: true }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topIdx, tools]);

  useEffect(() => {
    if (tools.length > lastCount.current) {
      const newestId = tools[0]?.id;
      if (newestId) {
        setTopIdx(0);
        tools.forEach((t, i) => {
          const v = new Animated.Value(0);
          enterAnims.current[t.id] = v;
          const delay = (n - 1 - i) * 60;
          Animated.spring(v, { toValue: 1, friction: 8, tension: 42, useNativeDriver: true, delay }).start();
        });
      }
    }
    lastCount.current = tools.length;
  }, [tools.length, tools]);

  const advance = useCallback(() => { if (n > 1) setTopIdx(t => (t + 1) % n); }, [n]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => n > 1,
    onMoveShouldSetPanResponder: (_, g) => n > 1 && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      const x = g.dx < 0 ? g.dx : g.dx * 0.3;
      dragX.setValue(x); dragY.setValue(g.dy < 0 ? g.dy : g.dy * 0.4);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -EXIT_THRESHOLD) {
        Animated.parallel([
          Animated.spring(dragX, { toValue: 0, friction: 6, tension: 180, useNativeDriver: true }),
          Animated.spring(dragY, { toValue: 0, friction: 6, tension: 180, useNativeDriver: true }),
        ]).start(() => advance());
      } else {
        Animated.parallel([
          Animated.spring(dragX, { toValue: 0, friction: 6, tension: 120, useNativeDriver: true }),
          Animated.spring(dragY, { toValue: 0, friction: 6, tension: 120, useNativeDriver: true }),
        ]).start();
      }
    },
  }), [dragX, dragY, n, advance]);

  const handleComplete = useCallback(
    (id: string) => { onComplete(id); advance(); },
    [onComplete, advance]
  );

  const maxVisible = Math.min(VISIBLE, n);
  const stackH = baseH + SEED_TY[Math.min(maxVisible - 1, SEED_TY.length - 1)];
  const deckH = stackH + 48;

  return (
    <View style={[styles.deck, { height: deckH }]}>
      <View style={[styles.stack, { height: stackH }]} {...pan.panHandlers}>
        {tools.map((t, i) => {
          const pos = (i - topIdx + n) % n;
          const isTop = pos === 0;
          const s = seedAt(pos);

          const enter = enterAnims.current[t.id];
          const enterY = enter ? enter.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) : 0;
          const enterSc = enter ? enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) : 1;
          const enterOp = enter ? enter.interpolate({ inputRange: [0, 1], outputRange: [0, s.op] }) : s.op;

          let pa = cardAnims.current[t.id];
          if (!pa) {
            pa = { tx: new Animated.Value(0), ty: new Animated.Value(0), rot: new Animated.Value(0), sc: new Animated.Value(1) };
            cardAnims.current[t.id] = pa;
          }

          const txAnim = isTop ? Animated.add(pa.tx, dragX as any) : pa.tx;
          const tyBase = Animated.add(pa.ty, enterY as any);
          const tyAnim = isTop ? Animated.add(tyBase, dragY as any) : tyBase;
          const scAnim = Animated.multiply(Animated.multiply(pa.sc, s.sc), enterSc as any);

          const rotStr = pa.rot.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });
          const topRotStr = dragY.interpolate({ inputRange: [-80, 0, 80], outputRange: ['-6deg', '0deg', '4deg'] });

          const transform: any[] = [
            { translateX: txAnim },
            { translateY: tyAnim },
            { scale: scAnim },
            { rotate: isTop ? topRotStr : rotStr },
          ];

          return (
            <Animated.View
              key={t.id}
              style={[styles.cardWrap, { zIndex: 40 - pos, opacity: enterOp, transform }]}
              pointerEvents={isTop ? 'auto' : 'none'}
              onLayout={i === 0 ? (e: LayoutChangeEvent) => setBaseH(e.nativeEvent.layout.height) : undefined}
            >
              <Card style={[styles.card, isTop && styles.cardTop]}>
                <View style={styles.headerRow}>
                  <LinearGradient
                    colors={TYPE_GRADIENTS[t.type] || [mm.colors.purpleSoft, mm.colors.purpleMid]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.ico}
                  >
                    <Icon
                      name={TASK_ICONS[t.type]}
                      size={theme.fs(24)}
                      color={TYPE_ICON_COLORS[t.type] ?? mm.colors.purpleDeep}
                      strokeWidth={2.4}
                    />
                  </LinearGradient>
                  <View style={styles.headerRight}>
                    <Badge label={t.badge} />
                    <Text style={styles.cardNum}>{TYPE_LABEL[t.type] || '0'}</Text>
                  </View>
                </View>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.desc}>{t.desc}</Text>
                <TouchableOpacity
                  style={[styles.btn, t.done && styles.btnDone]}
                  disabled={t.done}
                  onPress={() => handleComplete(t.id)}
                  activeOpacity={0.85}
                >
                  {t.done ? (
                    <Text style={styles.btnTextDone}>已完成 · 已记录</Text>
                  ) : (
                    <LinearGradient
                      colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={styles.btnGrad}
                    >
                      <Text style={styles.btnText}>{t.action}</Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              </Card>
            </Animated.View>
          );
        })}
      </View>

      {n > 1 ? (
        <View style={styles.foot}>
          <View style={styles.dots}>
            {tools.map((_, i) => {
              const active = i <= topIdx;
              return (
                <TouchableOpacity key={i} onPress={() => setTopIdx(i)}>
                  <View style={[styles.stepLine, active && styles.stepLineActive]} />
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>左滑 · 切换下一个</Text>
        </View>
      ) : null}
    </View>
  );
}

function Badge({ label }: { label: string }) {
  const isAi = label.includes('AI');
  return isAi ? (
    <LinearGradient
      colors={theme.colors.aiBadgeGrad as unknown as string[]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.badge}
    >
      <Text style={styles.badgeTextAi}>{label}</Text>
    </LinearGradient>
  ) : (
    <View style={[styles.badge, styles.badgePlain]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { marginBottom: theme.space.card, alignItems: 'center' },
  stack: { position: 'relative', alignSelf: 'stretch' },
  cardWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },

  // 竖长条卡壳
  card: {
    width: CARD_W,
    paddingVertical: 24, paddingHorizontal: 20,
    backgroundColor: '#FFFFFF', overflow: 'visible',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderRadius: 28,
  },
  cardTop: {
    shadowColor: '#8B7CF6', shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.20, shadowRadius: 36, elevation: 10,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ico: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  cardNum: { fontSize: 13, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1 },

  badge: { paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  badgePlain: { backgroundColor: mm.colors.limeSoft },
  badgeText: { fontSize: 10, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep },
  badgeTextAi: { fontSize: 10, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },

  title: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginBottom: 5, letterSpacing: -0.3 },
  desc: { fontSize: 12, lineHeight: 19, color: '#6B7280', marginBottom: 14 },

  // ★ 渐变按钮套路（同设置页）：Touchable 只留圆角+裁切，尺寸全由渐变层撑起。
  //   此前渐变用 absoluteFillObject 绝对定位 → 不占布局宽，按钮塌成 32px 窄条（真机 bug）。
  btn: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  btnGrad: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDone: {
    backgroundColor: mm.colors.limeSoft,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  btnText: { fontSize: 12, fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad },
  btnTextDone: { fontSize: 12, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep },

  foot: { marginTop: 16, alignItems: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1.5), gap: theme.sp(1.5) },
  stepLine: { width: theme.sp(3), height: 4, borderRadius: 2, backgroundColor: mm.colors.emptyFill },
  stepLineActive: { width: theme.sp(5.5), backgroundColor: mm.colors.limeCore },
  hint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.7 },
});
