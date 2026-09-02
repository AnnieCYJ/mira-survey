import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  TouchableOpacity,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme/theme';
import Icon from './Icon';
import Card from './Card';
import { TASK_COLORS, TASK_ICONS, type TaskItem } from '../data/tasks';

const VISIBLE = 3;
const DECK_TF = [
  { x: 0, y: -2, s: 1, r: '0deg' },
  { x: 13, y: 14, s: 0.95, r: '1.2deg' },
  { x: -10, y: 28, s: 0.9, r: '-1.8deg' },
];
const DECK_LIFT = [4, 22, 32];
const SWIPE = 56;

interface Props {
  tools: TaskItem[];
  onComplete: (id: string) => void;
}

export default function TaskDeck({ tools, onComplete }: Props) {
  const [top, setTop] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const drag = useRef(new Animated.ValueXY()).current;
  const n = tools.length;
  const lastCount = useRef(n);
  const enterAnims = useRef<Record<string, Animated.Value>>({});

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => n > 1,
        onMoveShouldSetPanResponder: (_, g) => n > 1 && Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          drag.setValue({ x: 0, y: g.dy < 0 ? g.dy : g.dy * 0.5 });
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy < -SWIPE) {
            Animated.timing(drag, { toValue: { x: 0, y: -400 }, duration: 260, useNativeDriver: true }).start(
              () => {
                drag.setValue({ x: 0, y: 0 });
                setTop((t) => (t + 1) % n);
              }
            );
          } else if (g.dy > SWIPE) {
            drag.setValue({ x: 0, y: 0 });
            setTop((t) => (t - 1 + n) % n);
          } else {
            Animated.spring(drag, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
          }
        },
      }),
    [drag, n]
  );

  useEffect(() => {
    if (tools.length > lastCount.current) {
      const newestId = tools[0]?.id;
      if (newestId) {
        setTop(0);
        enterAnims.current[newestId] = new Animated.Value(0);
        Animated.spring(enterAnims.current[newestId], {
          toValue: 1,
          friction: 8,
          tension: 42,
          useNativeDriver: true,
        }).start();
      }
    }
    lastCount.current = tools.length;
  }, [tools.length, tools]);

  const stackH = baseH + DECK_LIFT[Math.max(0, Math.min(n, VISIBLE) - 1)];
  const deckH = stackH + (n > 1 ? 28 : 0);

  return (
    <View style={[styles.deck, { height: deckH }]}>
      <View style={[styles.stack, { height: stackH }]} {...pan.panHandlers}>
        {tools.map((t, i) => {
          const pos = (i - top + n) % n;
          const tf = DECK_TF[Math.min(pos, DECK_TF.length - 1)];
          const isTop = pos === 0;
          const enter = enterAnims.current[t.id];
          const enterY = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] })
            : 0;
          const enterScale = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] })
            : 1;
          const baseOpacity = pos >= VISIBLE ? 0 : 1 - pos * 0.13;
          const opacity = enter
            ? enter.interpolate({ inputRange: [0, 1], outputRange: [0, baseOpacity] })
            : baseOpacity;
          const transform = isTop
            ? [
                { translateX: drag.x },
                {
                  translateY: Animated.add(
                    Animated.add(drag.y, tf.y),
                    enterY
                  ) as Animated.AnimatedInterpolation<string | number>,
                },
                { scale: Animated.multiply(tf.s, enterScale) as Animated.AnimatedMultiplication<string | number> },
                { rotate: tf.r },
              ]
            : [
                { translateX: tf.x },
                { translateY: Animated.add(tf.y, enterY) as Animated.AnimatedAddition<string | number> },
                { scale: Animated.multiply(tf.s, enterScale) as Animated.AnimatedMultiplication<string | number> },
                { rotate: tf.r },
              ];

          return (
            <Animated.View
              key={t.id}
              style={[
                styles.cardWrap,
                {
                  zIndex: 40 - Math.min(pos, 5),
                  opacity,
                  transform,
                },
              ]}
              pointerEvents={isTop ? 'auto' : 'none'}
              onLayout={i === 0 ? (e: LayoutChangeEvent) => setBaseH(e.nativeEvent.layout.height) : undefined}
            >
              <Card style={[styles.card, isTop && styles.cardTop]}>
                <View style={styles.recTop}>
                  <View style={[styles.ico, { shadowColor: TASK_COLORS[t.type] }]}>
                    <Icon
                      name={TASK_ICONS[t.type]}
                      size={theme.fs(20)}
                      color={TASK_COLORS[t.type]}
                      strokeWidth={2.4}
                    />
                  </View>
                  <Badge label={t.badge} />
                  <View style={styles.grip}>
                    <View style={[styles.gripBar, { width: theme.sp(4.5) }]} />
                    <View style={[styles.gripBar, { width: theme.sp(3) }]} />
                    <View style={[styles.gripBar, { width: theme.sp(1.5) }]} />
                  </View>
                </View>

                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.desc}>{t.desc}</Text>

                <TouchableOpacity
                  style={[styles.btn, t.done && styles.btnDone]}
                  disabled={t.done}
                  onPress={() => onComplete(t.id)}
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
            {tools.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => setTop(i)}>
                <View style={[styles.dot, i === top && styles.dotOn]} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>上滑查看下一个任务</Text>
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
  card: { padding: theme.space.md + theme.sp(1) },
  cardTop: {
    backgroundColor: theme.colors.cardBgStrong,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: theme.colors.ui.shadowDeep,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 44,
    elevation: 10,
  },
  recTop: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.space.sm },
  ico: {
    width: theme.sp(9),
    height: theme.sp(9),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.space.sm,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 3,
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
  grip: { marginLeft: 'auto', alignItems: 'center' },
  gripBar: { height: 2, borderRadius: 2, backgroundColor: theme.colors.textSub, marginBottom: 3, opacity: 0.4 },
  title: {
    fontSize: theme.fontSize.card,
    fontWeight: theme.weight.medium,
    color: theme.colors.textTitle,
    marginBottom: theme.sp(1.5),
  },
  desc: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.6,
    color: theme.colors.textSub,
    marginBottom: theme.space.md,
  },
  btn: {
    height: theme.sp(11),
    paddingHorizontal: theme.space.lg,
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
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1.5) },
  dot: {
    width: theme.sp(1.5),
    height: theme.sp(1.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(124,106,224,0.26)',
    marginHorizontal: theme.sp(1),
  },
  dotOn: { width: theme.sp(4.5), backgroundColor: theme.colors.accentSolid },
  hint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.7 },
});
