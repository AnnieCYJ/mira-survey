import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Animated, PanResponder, TouchableOpacity,
  Platform, UIManager, Modal, useWindowDimensions, type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Icon from './Icon';
import Card from './Card';
import { TASK_ICONS, type TaskItem } from '../data/tasks';

// v16 五色系统：四类任务 = soft→mid 双档渐变（图标方块用），青 #CFFAFE/#67E8F9 已删
// v21 §4.3：四张卡统一「黄绿渐变圆角方块 + 深绿 icon」（原四类分色废弃）
const TYPE_GRADIENTS: Record<number, [string, string]> = {
  0: [mm.colors.limeCore, mm.colors.limeMid],
  1: [mm.colors.limeCore, mm.colors.limeMid],
  2: [mm.colors.limeCore, mm.colors.limeMid],
  3: [mm.colors.limeCore, mm.colors.limeMid],
};
const TYPE_ICON_COLORS: Record<number, string> = {
  0: mm.colors.limeDeep,
  1: mm.colors.limeDeep,
  2: mm.colors.limeDeep,
  3: mm.colors.limeDeep,
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
const CARD_W = 248;  // v18.72：宽收回（288 太扁），高度靠 padding/行距撑 → 竖长条

// pos=0 顶卡，pos=1 第二层（左倾），pos=2 第三层（右倾），pos=3 第四层（左倾）
// ★ 2026-10-08（用户：我要右图效果）→ 对齐参考图：
//   前排正立 + 大投影；后排左右对镜倾斜、同层等高、外扩到接近屏幕边；
//   后排**不再淡出**（参考图里后排是满色实卡，不是虚影），仅留一点点层次。
const SEED_ROTATE = [0, -9, 9, -6];
const SEED_TX = [0, -56, 56, -34];
const SEED_TY = [0, 14, 14, 28];
const SEED_SCALE = [1, 0.97, 0.97, 0.93];
const SEED_OPACITY = [1, 1, 0.99, 0.96];
const EXIT_THRESHOLD = 60;

interface Props {
  tools: TaskItem[];
  /** v18.93 主按钮「开始」→ 标记完成 + 跳对应功能页（传整卡供路由判断） */
  onComplete: (t: TaskItem) => void;
  /** v18.88 翻面「查看详情」→ 跳转科普阅读页 */
  onOpenArticle?: (articleId: string, collection?: 'learn' | 'glow' | 'emotion' | 'sport' | 'nutrition') => void;
  /** v18.91 背面「去完成」→ 跳对应实操页（有 flip.do 的卡才显示该按钮） */
  onDoTask?: (t: TaskItem) => void;
}

function seedAt(pos: number) {
  const i = Math.min(pos, SEED_ROTATE.length - 1);
  return { tx: SEED_TX[i], ty: SEED_TY[i], rot: SEED_ROTATE[i], sc: SEED_SCALE[i], op: SEED_OPACITY[i] };
}

export default function TaskDeck({ tools, onComplete, onOpenArticle, onDoTask }: Props) {
  const [topIdx, setTopIdx] = useState(0);
  const [baseH, setBaseH] = useState(0);
  const n = tools.length;
  const { width: winW, height: winH } = useWindowDimensions();
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const lastCount = useRef(n);
  const enterAnims = useRef<Record<string, Animated.Value>>({});
  const cardAnims = useRef<Record<string, {
    tx: Animated.Value; ty: Animated.Value; rot: Animated.Value; sc: Animated.Value;
  }>>({});
  const wrapRefs = useRef<Record<string, View | null>>({});

  // ── v18.88 翻面浮层 ──
  // 交互：点顶卡（无位移的 tap）→ 浮层从卡片原位 spring 到屏幕中央 + rotateY 翻面；
  // 背面 = 短科普「为什么」+ 一条出处 + 「查看详情」。点遮罩 / × / 完成按钮都回收。
  const FLIP_W = 320;
  const FLIP_H = 470;  // v18.89：背面科普加长（2-3 句），432 → 470 防溢出
  const [flip, setFlip] = useState<TaskItem | null>(null);
  const flipActive = useRef(false);
  useEffect(() => { flipActive.current = flip != null; }, [flip]);
  const maskV = useRef(new Animated.Value(0)).current;
  const flipV = useRef(new Animated.Value(0)).current;
  const mvTx = useRef(new Animated.Value(0)).current;
  const mvTy = useRef(new Animated.Value(0)).current;
  const mvSc = useRef(new Animated.Value(1)).current;
  const openOffset = useRef({ tx: 0, ty: 0 });

  const openFlip = useCallback((t: TaskItem) => {
    if (!t.flip || flipActive.current) return;
    const wrap = wrapRefs.current[t.id];
    if (!wrap) return;
    wrap.measureInWindow((wx, wy, ww, wh) => {
      const cardH = baseH || 420;
      const cx = wx + ww / 2;                 // wrap 是全宽，卡片居中 → 取中心即可
      const cy = wy + (wh || cardH) / 2;
      const tx0 = cx - winW / 2;
      const ty0 = cy - winH / 2;
      openOffset.current = { tx: tx0, ty: ty0 };
      mvTx.setValue(tx0);
      mvTy.setValue(ty0);
      mvSc.setValue(CARD_W / FLIP_W);
      flipV.setValue(0);
      maskV.setValue(0);
      setFlip(t);
      Animated.parallel([
        // 位移/缩放：spring（有物理感）；翻转：timing + 标准缓动，稍延迟让卡片先「起飞」
        Animated.spring(mvTx, { toValue: 0, friction: 9, tension: 68, useNativeDriver: true }),
        Animated.spring(mvTy, { toValue: 0, friction: 9, tension: 68, useNativeDriver: true }),
        Animated.spring(mvSc, { toValue: 1, friction: 9, tension: 68, useNativeDriver: true }),
        Animated.timing(maskV, { toValue: 1, duration: theme.motion.base, easing: theme.motion.easeEnter, useNativeDriver: true }),
        Animated.timing(flipV, { toValue: 1, duration: 420, delay: 80, easing: theme.motion.easeStandard, useNativeDriver: true }),
      ]).start();
    });
  }, [baseH, winW, winH, mvTx, mvTy, mvSc, flipV, maskV]);

  const closeFlip = useCallback(() => {
    if (!flipActive.current) return;
    const { tx, ty } = openOffset.current;
    Animated.parallel([
      Animated.spring(mvTx, { toValue: tx, friction: 8, tension: 90, useNativeDriver: true }),
      Animated.spring(mvTy, { toValue: ty, friction: 8, tension: 90, useNativeDriver: true }),
      Animated.spring(mvSc, { toValue: CARD_W / FLIP_W, friction: 8, tension: 90, useNativeDriver: true }),
      Animated.timing(maskV, { toValue: 0, duration: 200, easing: theme.motion.easeExit, useNativeDriver: true }),
      Animated.timing(flipV, { toValue: 0, duration: theme.motion.slow, easing: theme.motion.easeExit, useNativeDriver: true }),
    ]).start(() => setFlip(null));
  }, [mvTx, mvTy, mvSc, flipV, maskV]);

  // v18.90：跳转前瞬关。走 closeFlip 的收场动画时，若页面随即被导航分离（react-native-screens），
  // 原生动画永远不结束 → setFlip(null) 不执行 → Modal 悬在跳转后的页面上（Modal 压所有页面）。
  const closeFlipNow = useCallback(() => {
    maskV.setValue(0);
    setFlip(null);
  }, [maskV]);

  const handleDetail = useCallback((t: TaskItem) => {
    if (!t.flip || !onOpenArticle) { closeFlipNow(); return; }
    const { articleId, collection } = t.flip;
    closeFlipNow();
    onOpenArticle(articleId, collection);
  }, [closeFlipNow, onOpenArticle]);

  // v18.91 「去完成」：同样瞬关浮层再跳实操页（同 handleDetail 的 Modal 残留教训）
  const handleDoTask = useCallback((t: TaskItem) => {
    if (!onDoTask) return;
    closeFlipNow();
    onDoTask(t);
  }, [closeFlipNow, onDoTask]);

  // 保险：任何路径导致本页失焦（返回手势、外部导航）而翻面还开着 → 强制关，杜绝 Modal 残留
  const deckFocused = useIsFocused();
  useEffect(() => {
    if (deckFocused === false && flip != null) setFlip(null);
  }, [deckFocused, flip]);

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

  // tap（几乎无位移、低速度）→ 翻面；其余维持原有左滑换卡逻辑
  const handleDeckTap = useCallback(() => {
    if (flipActive.current || n === 0) return;
    const t = tools[topIdx];
    if (t) openFlip(t);
  }, [tools, topIdx, n, openFlip]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !flipActive.current,  // 子按钮优先 grant，不受影响；单卡也能收到 tap
    onMoveShouldSetPanResponder: (_, g) => !flipActive.current && n > 1 && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      const x = g.dx < 0 ? g.dx : g.dx * 0.3;
      dragX.setValue(x); dragY.setValue(g.dy < 0 ? g.dy : g.dy * 0.4);
    },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8 && Math.abs(g.vx) < 0.2) {
        handleDeckTap();
        return;
      }
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
  }), [dragX, dragY, n, advance, handleDeckTap]);

  const handleComplete = useCallback(
    (t: TaskItem) => { onComplete(t); advance(); },
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
          // ★ 2026-10-08：pa.sc 已 spring 到 s.sc，这里不能再乘一次 s.sc（否则后排 = s.sc²，明显偏小）
          const scAnim = Animated.multiply(pa.sc, enterSc as any);

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
              ref={(el: View | null) => { wrapRefs.current[t.id] = el; }}
              style={[styles.cardWrap, { zIndex: 40 - pos, opacity: enterOp, transform }]}
              pointerEvents={isTop ? 'auto' : 'none'}
              onLayout={i === 0 ? (e: LayoutChangeEvent) => setBaseH(e.nativeEvent.layout.height) : undefined}
            >
              <Card style={[styles.card, isTop ? styles.cardTop : styles.cardBack]}>
                <View style={styles.headerRow}>
                  <LinearGradient
                    colors={TYPE_GRADIENTS[t.type] || [mm.colors.limeCore, mm.colors.limeMid]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.ico}
                  >
                    <Icon
                      name={TASK_ICONS[t.type]}
                      size={theme.fs(26)}
                      color={TYPE_ICON_COLORS[t.type] ?? mm.colors.limeDeep}
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
                  onPress={() => handleComplete(t)}
                  activeOpacity={0.7}
                >
                  {/* v18.77：行动按钮回归全 App 主按钮标准——btnGradFrom→btnGradTo 紫渐变 + 白字
                      （与洞察页 ECG / MiraAI 发送 / 设置页连接同款）；
                      已完成=中性灰浅底 + inkSoft 字。Touchable 只留圆角+裁切，尺寸由渐变层撑起。 */}
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
          <Text style={styles.hint}>左滑 · 切换下一个　·　点卡片看「为什么」</Text>
        </View>
      ) : null}

      {/* ── v18.88 翻面浮层：卡片飞到屏幕中央 + 翻面展示短科普 ── */}
      <Modal transparent visible={flip != null} animationType="none" statusBarTranslucent onRequestClose={closeFlip}>
        <View style={{ flex: 1 }}>
          {/* 遮罩（可点击关闭） */}
          <Animated.View style={[styles.mask, { opacity: maskV }]} pointerEvents={flip ? 'auto' : 'none'}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeFlip} />
          </Animated.View>

          {/* 浮动卡：外层管位移/缩放，内层管 rotateY 翻面；正反两面 backfaceVisibility 互斥 */}
          <Animated.View
            style={[
              styles.flipWrap,
              { width: FLIP_W, height: FLIP_H, left: (winW - FLIP_W) / 2, top: (winH - FLIP_H) / 2 },
              { transform: [{ translateX: mvTx }, { translateY: mvTy }, { scale: mvSc }] },
            ]}
          >
            <Animated.View style={[styles.face, { transform: [{ rotateY: flipV.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }]} pointerEvents="none">
              {flip ? <FlipFront tool={flip} /> : null}
            </Animated.View>
            <Animated.View
              style={[styles.face, { transform: [{ rotateY: flipV.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] }) }] }]}
            >
              {flip ? (
                <FlipBack
                  tool={flip}
                  onDetail={handleDetail}
                  onDo={onDoTask ? handleDoTask : undefined}
                  onClose={closeFlip}
                />
              ) : null}
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
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

/** 翻面正面：复刻卡面（仅展示，不可点） */
function FlipFront({ tool }: { tool: TaskItem }) {
  return (
    <View style={styles.flipShell}>
      <View style={styles.headerRow}>
        <LinearGradient
          colors={[mm.colors.limeCore, mm.colors.limeMid]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.ico}
        >
          <Icon name={TASK_ICONS[tool.type]} size={theme.fs(26)} color={mm.colors.limeDeep} strokeWidth={2.4} />
        </LinearGradient>
        <View style={styles.headerRight}>
          <Badge label={tool.badge} />
          <Text style={styles.cardNum}>{TYPE_LABEL[tool.type] || '0'}</Text>
        </View>
      </View>
      <Text style={styles.title}>{tool.title}</Text>
      <Text style={styles.desc}>{tool.desc}</Text>
      <View style={[styles.btn, styles.btnFull]}>
        <LinearGradient
          colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.btnGrad}
        >
          <Text style={styles.btnText}>{tool.action}</Text>
        </LinearGradient>
      </View>
    </View>
  );
}

/** 翻面背面：短科普「为什么」+ 一条出处 + 底部按钮区。
 *  有 flip.do（实操页）→ 双按钮：查看详情（灰底次要）+ 去完成（紫渐变主按钮）；
 *  纯科普任务 → 单个「查看详情」主按钮。 */
function FlipBack({ tool, onDetail, onDo, onClose }: {
  tool: TaskItem;
  onDetail: (t: TaskItem) => void;
  onDo?: (t: TaskItem) => void;
  onClose: () => void;
}) {
  const f = tool.flip;
  if (!f) return null;
  const hasDo = !!(f.do && onDo);
  return (
    <View style={styles.flipShell}>
      <TouchableOpacity style={styles.flipClose} onPress={onClose} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.flipCloseText}>✕</Text>
      </TouchableOpacity>

      <Text style={styles.flipEyebrow}>{tool.badge}</Text>
      <Text style={styles.flipTitle}>{f.articleTitle}</Text>
      <Text style={styles.flipTip}>{f.tip}</Text>

      <View style={{ flex: 1 }} />
      <Text style={styles.flipSrc} numberOfLines={2}>出处 · {f.src}</Text>
      <View style={hasDo ? styles.flipBtnRow : undefined}>
        {hasDo ? (
          <TouchableOpacity style={[styles.btn, styles.btnFull, styles.flipBtnHalf]} onPress={() => onDetail(tool)} activeOpacity={0.7}>
            <View style={[styles.btnGrad, styles.btnGhostBg]}>
              <Text style={styles.btnTextDone}>查看详情</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.btn, styles.btnFull, hasDo && styles.flipBtnHalf]}
          onPress={() => (hasDo ? onDo!(tool) : onDetail(tool))}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={[mm.colors.btnGradFrom, mm.colors.btnGradTo]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.btnGrad}
          >
            <Text style={styles.btnText}>{hasDo ? '去完成' : '查看详情'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ★ 2026-10-07（用户：工具页顶部推荐卡「位置靠下一点、相对居中一些」）：
  //   deck 高度 = stackH + 48（原末尾留白），卡片原本贴着顶部。现加 24pt 顶部留白，
  //   使上下留白近似对称（48-24=24），牌堆向下移且在自身高度内居中；总高不变，不影响页面其余布局。
  deck: { marginBottom: theme.space.card, alignItems: 'center', paddingTop: theme.sp(6) },
  stack: { position: 'relative', alignSelf: 'stretch' },
  cardWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },

  // 竖长条卡壳（v18.72：高>宽，视觉中心）
  card: {
    width: CARD_W,
    paddingVertical: 48, paddingHorizontal: 24,
    backgroundColor: '#FFFFFF', overflow: 'visible',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderRadius: 28,
  },
  // ★ 2026-10-08（用户参考图）：后排卡也要有接地投影，才不会「白卡贴白底」看不出层次
  cardBack: {
    shadowColor: mm.shadow.color, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 4,
  },
  cardTop: {
    // ★ 2026-10-08（用户参考图）：前排投影收敛一点，更接近参考图里柔和的悬浮感
    shadowColor: '#8B7CF6', shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16, shadowRadius: 30, elevation: 10,
  },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  headerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ico: {
    width: 54, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  cardNum: { fontSize: 13, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1 },

  badge: { paddingHorizontal: theme.sp(2), paddingVertical: theme.sp(0.75), borderRadius: theme.radius.pill },
  badgePlain: { backgroundColor: mm.colors.limeSoft },
  badgeText: { fontSize: 10.5, fontWeight: theme.weight.semibold, color: mm.colors.limeDeep },
  badgeTextAi: { fontSize: 10.5, fontWeight: theme.weight.semibold, color: theme.colors.textWhite },

  title: { fontSize: 20, fontWeight: '700', color: '#1F2937', marginBottom: 10, letterSpacing: -0.3 },
  desc: { fontSize: 13, lineHeight: 21, color: '#6B7280', marginBottom: 26 },

  // ★ v18.77 渐变按钮套路（同设置页铁律）：Touchable 只留圆角+裁切，尺寸全由渐变层撑起。
  //   渐变层若用 absoluteFillObject 绝对定位会不占布局宽 → 按钮塌成窄条（真机事故）。
  btn: {
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  btnGrad: {
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDone: {
    backgroundColor: mm.colors.btnBusyBg,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  btnText: { fontSize: 13, fontWeight: theme.weight.semibold, color: mm.colors.btnTextOnGrad },
  btnTextDone: { fontSize: 13, fontWeight: theme.weight.semibold, color: mm.colors.inkSoft },
  btnFull: { alignSelf: 'stretch' },

  // ── v18.88 翻面浮层 ──
  mask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(24, 22, 38, 0.42)',
  },
  flipWrap: {
    position: 'absolute',
  },
  face: {
    ...StyleSheet.absoluteFillObject,
    backfaceVisibility: 'hidden',
    borderRadius: 28,
    overflow: 'hidden',
  },
  flipShell: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 30,
    paddingHorizontal: 26,
  },
  flipClose: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: mm.colors.btnBusyBg,
  },
  flipCloseText: { fontSize: 13, color: mm.colors.inkSoft, lineHeight: 15 },
  flipEyebrow: {
    fontSize: 11,
    fontWeight: theme.weight.semibold,
    letterSpacing: 1.2,
    color: theme.colors.accentText,
    marginBottom: 12,
    marginTop: 6,
  },
  flipTitle: {
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '700',
    color: '#1F2937',
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  flipTip: { fontSize: 14, lineHeight: 24, color: '#6B7280' },
  // v18.91 背面双按钮：去完成（紫渐变主）+ 查看详情（灰底次要）
  flipBtnRow: { flexDirection: 'row', gap: 10 },
  flipBtnHalf: { flex: 1 },
  btnGhostBg: {
    backgroundColor: mm.colors.btnBusyBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipSrc: {
    fontSize: 11,
    lineHeight: 16,
    color: theme.colors.textSub,
    opacity: 0.75,
    marginBottom: 14,
  },

  foot: { marginTop: 16, alignItems: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.sp(1.5), gap: theme.sp(1.5) },
  stepLine: { width: theme.sp(3), height: 4, borderRadius: 2, backgroundColor: mm.colors.emptyFill },
  stepLineActive: { width: theme.sp(5.5), backgroundColor: mm.colors.limeCore },
  hint: { fontSize: theme.fontSize.micro, color: theme.colors.textSub, opacity: 0.7 },
});
