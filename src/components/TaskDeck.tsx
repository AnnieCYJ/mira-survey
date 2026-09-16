import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
  Platform,
  UIManager,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon from './Icon';
import Card from './Card';
import { TASK_COLORS, TASK_ICONS, type TaskItem } from '../data/tasks';

// 每张卡不同的图标渐变色（引导页同款配色）
const TYPE_GRADIENTS: Record<number, [string, string]> = {
  0: ['#FCE7F3', '#F9A8D4'],
  1: ['#C4B5FD', '#A78BFA'],
  2: ['#CFFAFE', '#67E8F9'],
  3: ['#FEF3C7', '#FBBF24'],
};
const TYPE_LABEL = ['01', '02', '03', '04'];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * 纵向堆叠卡片（rotate 循环模式，参考 NFT gallery 切换动效）
 * - 顶卡不 fly-out 消失，而是沉到底层 + 循环
 * - 所有卡的 stack offset/rotate 都用 Animated.Value 驱动
 * - topIdx 变化时 spring 平滑重排，顶卡沉到最底，下面的升上来
 * - 左拖 / 点按钮 → drag 归零 → advance 切下一张
 */

const VISIBLE = 3;
const STACK_OFFSET_Y = 16;
const STACK_OFFSET_X = 10;
const ROTATION_DEG = [0, 1.6, 0.8, 0.4];
const EXIT_THRESHOLD = 60;
const ENTER_FROM_Y = 160;

interface Props {
  tools: TaskItem[];
  onComplete: (id: string) => void;
}

export default function TaskDeck({ tools, onComplete }: Props) {
  const [topIdx, setTopIdx] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const n = tools.length;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lastCount = useRef(n);
  const enterAnims = useRef<Record<string, Animated.Value>>({});
  // ★ rotate 模式：每张卡自己的 stack offset / rotate Animated.Value
  const cardPosAnims = useRef<Record<string, { ox: Animated.Value; oy: Animated.Value }>>({});

  // 入场动画
  useEffect(() => {
    if (tools.length > lastCount.current) {
      const newestId = tools[0]?.id;
      if (newestId) {
        setTopIdx(0);
        tools.forEach((t, i) => {
          const v = new Animated.Value(0);
          enterAnims.current[t.id] = v;
          const delay = (n - 1 - i) * 60;
          Animated.spring(v, {
            toValue: 1,
            friction: 8,
            tension: 42,
            useNativeDriver: true,
            delay,
          }).start();
        });
      }
    }
    lastCount.current = tools.length;
  }, [tools.length, tools]);

  // ★ rotate 核心：topIdx 变化 → 所有卡 spring 到新 stack offset
  useEffect(() => {
    tools.forEach((t, i) => {
      const pos = (i - topIdx + n) % n;
      const ox = pos * STACK_OFFSET_X;
      const oy = pos * STACK_OFFSET_Y;
      const rot = ROTATION_DEG[Math.min(pos, ROTATION_DEG.length - 1)];

      // 首次初始化
      if (!cardPosAnims.current[t.id]) {
        cardPosAnims.current[t.id] = {
          ox: new Animated.Value(ox),
          oy: new Animated.Value(oy),
        };
        return;
      }

      // 已有 → spring 到新位置（rotate 动效就靠这个）
      const a = cardPosAnims.current[t.id];
      Animated.parallel([
        Animated.spring(a.ox, { toValue: ox, friction: 7, tension: 100, useNativeDriver: true }),
        Animated.spring(a.oy, { toValue: oy, friction: 7, tension: 100, useNativeDriver: true }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topIdx]);

  // rotate：循环切下一张（顶卡绕到底层）
  const advance = useCallback(() => {
    if (n <= 1) return;
    setTopIdx((t) => (t + 1) % n);
  }, [n]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => n > 1,
        onMoveShouldSetPanResponder: (_, g) =>
          n > 1 && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_, g) => {
          const x = g.dx < 0 ? g.dx : g.dx * 0.3;
          dragX.setValue(x);
          dragY.setValue(g.dy < 0 ? g.dy : g.dy * 0.4);
        },
        onPanResponderRelease: (_, g) => {
          const dx = g.dx;
          if (dx < -EXIT_THRESHOLD) {
            // 顶卡 drag 先 spring 归零 → 然后 advance 让所有卡重排
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
      }),
    [dragX, dragY, n, advance]
  );

  const handleComplete = useCallback(
    (id: string) => {
      onComplete(id);
      advance();
    },
    [onComplete, advance]
  );

  const maxVisible = Math.min(VISIBLE, n);
  const stackH = baseH + STACK_OFFSET_Y * Math.max(0, maxVisible - 1);
  const deckH = stackH + 36;

  return (
    <View style={[styles.deck, { height: deckH }]}>
      <View style={[styles.stack, { height: stackH }]} {...pan.panHandlers}>
        {tools.map((t, i) => {
          const pos = (i - topIdx + n) % n;
          const isTop = pos === 0;
          const baseOpacity = pos >= VISIBLE ? 0 : 1 - pos * 0.18;
          const enter = enterAnims.current[t.id];
          const enterY = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [ENTER_FROM_Y, 0] })
            : 0;
          const enterScale = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] })
            : 1;
          const opacity = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [0, baseOpacity] })
            : baseOpacity;

          // rotate 模式：所有卡的 stack offset / rotate 都用 cardPosAnims Animated.Value
          const pa = cardPosAnims.current[t.id];
          const rot = ROTATION_DEG[Math.min(pos, ROTATION_DEG.length - 1)];
          const stackOx = pa ? pa.ox : new Animated.Value(0);
          const stackOy = pa ? pa.oy : new Animated.Value(pos * STACK_OFFSET_Y);

          // translateX / translateY：顶卡额外叠加 drag 手势
          const tx = isTop
            ? Animated.add(stackOx, dragX as any)
            : stackOx;
          const tyBase = Animated.add(stackOy, enterY as any);
          const ty = isTop
            ? Animated.add(tyBase, dragY as any)
            : tyBase;

          const transform: any[] = [
            { translateX: tx },
            { translateY: ty },
            { scale: enterScale },
            { rotate: isTop
              ? dragY.interpolate({ inputRange: [-80, 0, 80], outputRange: ['-6deg', '0deg', '3deg'] })
              : `${rot}deg` },
          ];

          return (
            <Animated.View
              key={t.id}
              style={[
                styles.cardWrap,
                { zIndex: 40 - pos, opacity, transform },
              ]}
              pointerEvents={isTop ? 'auto' : 'none'}
              onLayout={i === 0 ? (e: LayoutChangeEvent) => setBaseH(e.nativeEvent.layout.height) : undefined}
            >
              <Card style={[styles.card, isTop && styles.cardTop]}>
                {/* 引导页同款：右上角大数字角标 */}
                <Text style={styles.cardNum}>{TYPE_LABEL[t.type] || '0'}</Text>
                <View style={styles.recTop}>
                  {/* 引导页同款：56×56 圆角 18 渐变方块图标容器 */}
                  <LinearGradient
                    colors={TYPE_GRADIENTS[t.type] || ['#C4B5FD', '#8B7CF6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.ico}
                  >
                    <Icon
                      name={TASK_ICONS[t.type]}
                      size={theme.fs(28)}
                      color="#FFFFFF"
                      strokeWidth={2.4}
                    />
                  </LinearGradient>
                  <Badge label={t.badge} />
                </View>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.desc}>{t.desc}</Text>
                <TouchableOpacity
                  style={[styles.btn, t.done && styles.btnDone]}
                  disabled={t.done}
                  onPress={() => handleComplete(t.id)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.btnText, t.done && styles.btnTextDone]}>
                    {t.done ? '已完成 · 已记录到日历' : t.action}
                  </Text>
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
                  <View style={[styles.stepLine, active && styles.stepLineActive]}>
                    <Animated.View
                      style={[
                        styles.stepLineFill,
                        { width: active ? '100%' : '0%' },
                      ]}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.hint}>左滑或点开始 · 切换下一个</Text>
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
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
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
  deck: { marginBottom: theme.space.card },
  stack: { position: 'relative' },
  cardWrap: { position: 'absolute', left: 0, right: 0, top: 0 },
  // 引导页同款卡壳：overflow visible（不裁角标数字）、padding 28/24
  card: {
    paddingVertical: 28,
    paddingHorizontal: 24,
    overflow: 'visible', // 覆盖 Card 默认的 overflow:hidden
  },
  // 顶卡双层紫阴影（引导页 feature-card shadow）
  cardTop: {
    shadowColor: '#8B7CF6',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.22,
    shadowRadius: 40,
    elevation: 10,
  },
  // 引导页同款：右上角 44px italic 半透明大数字
  cardNum: {
    position: 'absolute',
    top: 14,
    right: 18,
    fontSize: 44,
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#1F2937',
    opacity: 0.12,
    letterSpacing: -1,
  },
  recTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  // 引导页同款：56×56 圆角 18 渐变方块图标容器
  ico: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#8B7CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  badge: {
    paddingHorizontal: theme.space.sm - theme.sp(1),
    paddingVertical: theme.sp(1.5),
    borderRadius: theme.radius.pill,
  },
  badgePlain: { backgroundColor: theme.colors.accentSoft },
  badgeText: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.accentSolid,
  },
  badgeTextAi: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textWhite,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  desc: {
    fontSize: 14,
    lineHeight: 23.8,
    color: theme.colors.textSub,
    marginBottom: 18,
  },
  btn: {
    height: 44,
    paddingHorizontal: 22,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accent1,
    ...theme.shadow.card,
  },
  btnDone: { backgroundColor: 'rgba(111,207,180,0.18)', shadowOpacity: 0, elevation: 0 },
  btnText: { fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },
  btnTextDone: { color: theme.colors.ui.successText },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1.5), gap: theme.sp(1.5) },
  stepLine: {
    width: theme.sp(3),
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(139,124,246,0.18)',
    overflow: 'hidden',
  },
  stepLineActive: { width: theme.sp(5.5) },
  stepLineFill: {
    height: '100%',
    backgroundColor: theme.colors.accent1,
  },
  hint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.7 },
});