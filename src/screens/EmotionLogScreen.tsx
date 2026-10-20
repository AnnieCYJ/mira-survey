/**
 * EmotionLogScreen —— 情绪记录页（Mooda 式 + 物理珠雨）
 *
 * v18.25 改版：
 *  - 情绪为 5 档愉悦度（兴奋/开心/平静/压力/难过，v19.00 从 12 档收敛）；去掉月历。
 *  - 选择方式改为 Matter.js 弹珠动效：5 颗情绪玻璃珠从顶部随机落下，重力下落、
 *    互相碰撞反弹、底部堆积，堆积后持续轻微摇晃；点一颗珠子=选中该情绪。
 *    物理由 matter-js 模拟，渲染 react-native-svg（每帧读 body 位置重绘）。
 *
 * 口径不变：情绪=用户自报（Mira 不做情绪推断/评分）。
 * 数据：data/emotionLog.ts（documentDirectory/emotionLog.json）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, LayoutChangeEvent, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Accelerometer } from 'expo-sensors';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import Matter from 'matter-js';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import {
  MOOD_ORDER, MOOD_LABEL, MOOD_EMOJI, MOOD_COLOR, type MoodKey,
  ensureEmotionLogLoaded, getLatestForDay, addEmotionEntry,
} from '../data/emotionLog';
import { dayKey } from '../data/healthStore';
import { EMOTION_ARTICLES } from '../lib/emotionArticles';
import EmotionFaceIcon from '../components/EmotionFaceIcon';

function faceMood(mood: MoodKey): 'excited' | 'happy' | 'calm' | 'stressed' | 'sad' {
  if (mood === 'excited') return 'excited';
  if (mood === 'happy' || mood === 'love' || mood === 'grateful' || mood === 'pleasant') return 'happy';
  if (mood === 'stressed' || mood === 'anxious' || mood === 'angry') return 'stressed';
  if (mood === 'sad' || mood === 'lonely') return 'sad';
  return 'calm';
}

/* ── v18.82 情绪调节的方法 · 文章版块（模块级：珠雨重渲染不重建） ── */
function EmotionArticlesSection() {
  const navigation = useNavigation<any>();
  return (
    <View style={eas.wrap}>
      <View style={eas.methodHead}>
        <Text style={eas.secTitle}>今天可以先做一件事</Text>
        <Text style={eas.secCount}>按当前感受挑一个</Text>
      </View>
      <View style={eas.methodRow}>
        {EMOTION_ARTICLES.slice(0, 2).map((a) => (
          <TouchableOpacity
            key={`method-${a.id}`}
            activeOpacity={theme.press.opacity}
            style={eas.methodCard}
            onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'emotion' })}
            accessibilityRole="button"
            accessibilityLabel={`开始 ${a.title}`}
          >
            <Image source={a.cover} style={eas.methodImage} resizeMode="cover" />
            <Text style={eas.methodTitle} numberOfLines={2}>{a.shortTitle ?? a.title}</Text>
            <Text style={eas.methodLink}>开始 →</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={eas.secHead}>
        <Text style={eas.secTitle}>情绪调节的方法</Text>
        <Text style={eas.secCount}>{EMOTION_ARTICLES.length} 篇</Text>
      </View>
      {EMOTION_ARTICLES.map((a) => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={theme.press.opacity}
          style={eas.card}
          onPress={() => navigation.navigate('LearnRead', { articleId: a.id, collection: 'emotion' })}
          accessibilityRole="button"
          accessibilityLabel={`阅读 ${a.title}`}
        >
          <Image source={a.cover} style={eas.thumb} resizeMode="cover" />
          <View style={eas.body}>
            <Text style={eas.eyebrow}>{a.eyebrow} · {a.minutes} 分钟</Text>
            <Text style={eas.cardTitle} numberOfLines={2}>{a.title}</Text>
            <Text style={eas.link}>阅读全文 →</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const eas = StyleSheet.create({
  wrap: { marginTop: theme.space.lg },
  secHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.sp(2),
  },
  secTitle: { fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold, color: mm.colors.ink },
  secCount: { fontSize: theme.fontSize.xs, color: mm.colors.inkFaint },
  methodHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: theme.sp(2) },
  methodRow: { flexDirection: 'row', gap: theme.sp(2), marginBottom: theme.space.lg },
  methodCard: { flex: 1, backgroundColor: mm.colors.cardBg, borderWidth: StyleSheet.hairlineWidth, borderColor: mm.colors.cardBorder, borderRadius: theme.radius.card, padding: theme.space.cardPadCompact },
  methodImage: { width: '100%', height: theme.sp(18), borderRadius: theme.radius.sm, marginBottom: theme.sp(1.5), backgroundColor: theme.colors.cardBgSoft },
  methodTitle: { color: mm.colors.ink, fontSize: theme.fontSize.sm, fontWeight: theme.weight.semibold as never, lineHeight: theme.fs(19) },
  methodLink: { color: mm.colors.purpleCore, fontSize: theme.fontSize.xs, marginTop: theme.sp(1) },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.card,
    padding: theme.space.cardPadCompact,
    marginBottom: theme.sp(2.5),
  },
  thumb: {
    width: theme.sp(14),
    height: theme.sp(14),
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.cardBgSoft,
  },
  body: { flex: 1, marginLeft: theme.sp(3) },
  eyebrow: {
    fontSize: theme.fontSize.micro,
    fontWeight: theme.weight.semibold,
    letterSpacing: 0.6,
    color: mm.chipBg.lav.fg,
    marginBottom: theme.sp(0.5),
  },
  cardTitle: {
    fontSize: theme.fontSize.body,
    lineHeight: theme.fs(19),
    fontWeight: theme.weight.semibold,
    color: mm.colors.ink,
    marginBottom: theme.sp(1),
  },
  link: { fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium, color: mm.colors.inkFaint },
});

/* ── 珠雨参数 ────────────────────────────────────────────── */
const RAIN_H = 430;             // 珠雨区高度（v18.27 加大）
const R_MIN = 30, R_MAX = 35;   // 珠半径（每情绪一颗，v18.27 再加大）
const SHAKE_EVERY = 80;         // 每 N 帧给珠堆一次轻摇晃
const TILT_GAIN = 0.22;         // 手机倾斜/摇晃 → 珠子水平速度增益
const TILT_DEAD = 0.08;         // 死区：小于该倾斜值不施力（防手抖误动）

/** 一颗情绪珠：物理 body + 显示属性 */
interface Bead {
  body: Matter.Body;
  mood: MoodKey;
  r: number;
}

/**
 * EmotionBeadRain —— Matter.js 情绪玻璃珠雨。
 * onLayout 实测容器宽度后建 engine（铁律：SVG 宽度必须实测，不估算）；
 * rAF 驱动 Engine.update，渲染节流 ~30fps；每 SHAKE_EVERY 帧随机扰动珠堆=轻微摇晃感。
 */
function EmotionBeadRain({ selected, onSelect }: { selected: MoodKey | null; onSelect: (m: MoodKey) => void }) {
  const [W, setW] = useState(0);
  const engineRef = useRef<Matter.Engine | null>(null);
  const beadsRef = useRef<Bead[]>([]);
  const rafRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const tiltRef = useRef(0);          // 加速度计 x（左负右正），主循环每帧读取
  const [, setTick] = useState(0);

  // 摇一摇联动：加速度计 60ms 采样，tilt 存 ref 供物理循环使用
  useEffect(() => {
    Accelerometer.setUpdateInterval(60);
    const sub = Accelerometer.addListener(({ x }) => { tiltRef.current = x; });
    return () => { sub.remove(); tiltRef.current = 0; };
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - W) > 1) setW(w);
  };

  useEffect(() => {
    if (W <= 0 || engineRef.current) return;
    const engine = Matter.Engine.create({ gravity: { x: 0, y: 1.1, scale: 0.001 } });
    engineRef.current = engine;

    // 容器四壁（地板带一点摩擦让珠子堆稳）
    const wallOpts: Matter.IChamferableBodyDefinition = { isStatic: true, restitution: 0.4 };
    Matter.World.add(engine.world, [
      Matter.Bodies.rectangle(W / 2, RAIN_H + 30, W + 200, 60, { ...wallOpts, friction: 0.6 }),   // 地板
      Matter.Bodies.rectangle(-30, RAIN_H / 2, 60, RAIN_H * 3, wallOpts),                          // 左墙
      Matter.Bodies.rectangle(W + 30, RAIN_H / 2, 60, RAIN_H * 3, wallOpts),                       // 右墙
    ]);

    // 5 颗情绪珠（5 档愉悦度，每种恰好一颗），位置随机错落下落
    const beads: Bead[] = [];
    for (let i = 0; i < MOOD_ORDER.length; i++) {
      const r = R_MIN + Math.random() * (R_MAX - R_MIN);
      const x = r + 4 + Math.random() * (W - 2 * (r + 4));
      const y = -40 - Math.random() * (RAIN_H * 2.2);
      const body = Matter.Bodies.circle(x, y, r, {
        restitution: 0.55,          // 玻璃珠弹性
        friction: 0.05,
        frictionAir: 0.012,
        frictionStatic: 0.4,
        density: 0.0012,
      });
      Matter.World.add(engine.world, body);
      beads.push({
        body,
        r,
        mood: MOOD_ORDER[i],
      });
    }
    beadsRef.current = beads;

    // rAF 主循环：物理 60fps，渲染节流 ~30fps
    let lastDraw = 0;
    const loop = (ts: number) => {
      const engine2 = engineRef.current;
      if (!engine2) return;
      Matter.Engine.update(engine2, 1000 / 60);
      frameRef.current++;
      // 摇一摇联动：手机倾斜/摇晃 → 给每颗珠子水平速度（限幅防爆）
      const tilt = tiltRef.current;
      if (Math.abs(tilt) > TILT_DEAD) {
        for (const b of beadsRef.current) {
          const vx = Math.max(-9, Math.min(9, b.body.velocity.x + tilt * TILT_GAIN));
          Matter.Body.setVelocity(b.body, { x: vx, y: b.body.velocity.y });
        }
      }
      // 轻微摇晃：随机扰动 2-3 颗珠子（主要打在堆积层，body.sleeping 会自然过滤）
      if (frameRef.current % SHAKE_EVERY === 0) {
        const live = beadsRef.current.filter((b) => b.body.position.y > RAIN_H * 0.4);
        for (let k = 0; k < 3 && live.length > 0; k++) {
          const b = live[Math.floor(Math.random() * live.length)];
          Matter.Body.setVelocity(b.body, {
            x: b.body.velocity.x + (Math.random() - 0.5) * 1.6,
            y: b.body.velocity.y - Math.random() * 1.4,
          });
        }
      }
      if (ts - lastDraw > 30) {
        lastDraw = ts;
        setTick((t) => (t + 1) % 100000);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
      beadsRef.current = [];
    };
  }, [W]);

  const beads = beadsRef.current;
  return (
    <View style={styles.rainWrap} onLayout={onLayout}>
      {W > 0 ? (
        <Svg width={W} height={RAIN_H}>
          {beads.map((b, i) => {
            const { x, y } = b.body.position;
            if (y < -30 || y > RAIN_H + 60) return null; // 屏外不画
            const isSel = selected === b.mood;
            const c = MOOD_COLOR[b.mood];
            return (
              <G key={i} onPress={() => onSelect(b.mood)}>
                <Circle cx={x} cy={y} r={b.r + 3} fill={c} opacity={0.14} />
                <Circle
                  cx={x} cy={y} r={b.r}
                  fill={c + (isSel ? 'D9' : '55')}
                  stroke={c}
                  strokeWidth={isSel ? 2.4 : 1}
                  opacity={isSel ? 1 : 0.92}
                />
                <G x={x - b.r} y={y - b.r} pointerEvents="none">
                  <EmotionFaceIcon mood={faceMood(b.mood)} color={c} size={b.r * 2} />
                </G>
              </G>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height: RAIN_H }} />
      )}
    </View>
  );
}

export default function EmotionLogScreen() {
  const navigation = useNavigation<any>();
  const [selected, setSelected] = useState<MoodKey | null>(null);
  const [note, setNote] = useState('');
  const [savedTick, setSavedTick] = useState(false);

  // 进页载入历史；今天已有记录 → 预填（珠雨仍从头落下，选中态只是高亮）
  useEffect(() => {
    let alive = true;
    ensureEmotionLogLoaded().then(() => {
      if (!alive) return;
      const latest = getLatestForDay(dayKey(Date.now()));
      if (latest) {
        setSelected(latest.mood);
        setNote(latest.note ?? '');
      }
    });
    return () => { alive = false; };
  }, []);

  const save = () => {
    if (!selected) return;
    addEmotionEntry(selected, note);
    setSavedTick(true);
    setTimeout(() => {
      setSavedTick(false);
      navigation.goBack();
    }, 700);
  };

  return (
    <ScreenContainer withGradient>
      <View style={styles.stack}>
        {/* 返回头（与详情页同构） */}
        <View style={styles.head}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.goBack()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="back" size={theme.fs(22)} color={mm.colors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headText}>
            <Text style={styles.title}>情绪记录</Text>
            <Text style={styles.sub}>接住一颗此刻的心情</Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces>
          {/* 情绪珠雨：Matter.js 掉落堆积，点珠选中 */}
          <EmotionBeadRain selected={selected} onSelect={(m) => setSelected(m)} />

          {/* 选中回显 */}
          <View style={styles.selectedRow}>
            {selected ? (
              <>
                <Text style={styles.selectedEmoji}>{MOOD_EMOJI[selected]}</Text>
                <Text style={styles.selectedLabel}>{MOOD_LABEL[selected]}</Text>
              </>
            ) : (
              <Text style={styles.selectedHint}>点一颗落下来的珠子，记下此刻的心情</Text>
            )}
          </View>

          {/* 一句话备注（选中后出现） */}
          {selected ? (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="记一句此刻的感受（可选）"
              placeholderTextColor={mm.colors.inkFaint}
              multiline
              maxLength={80}
              style={styles.noteInput}
            />
          ) : null}

          {/* ★ v18.82 情绪调节的方法（图文文章，点进阅读详情页） */}
          <EmotionArticlesSection />
        </ScrollView>

        {/* 保存固定在页面底部（滚动区之外） */}
        <TouchableOpacity
          disabled={!selected || savedTick}
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel="保存情绪记录"
          style={styles.saveWrap}
        >
          {selected ? (
            <LinearGradient
              colors={savedTick ? [mm.colors.limeDeep, mm.colors.limeDeep] : [mm.colors.btnGradFrom, mm.colors.btnGradTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveBtn}
            >
              <Text style={{ fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: savedTick ? mm.colors.limeSoft : mm.colors.btnTextOnGrad }}>
                {savedTick ? '已记录 ✓' : '记下此刻'}
              </Text>
            </LinearGradient>
          ) : (
            <View style={[styles.saveBtn, { backgroundColor: mm.colors.btnBusyBg }]}>
              <Text style={{ fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint }}>
                选一个心情
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, gap: theme.sp(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.sp(2) },
  back: { width: theme.sp(8), height: theme.sp(8), borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: mm.colors.cardBg, borderWidth: 1, borderColor: mm.colors.cardBorder },
  headText: { flex: 1 },
  title: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  sub: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint, marginTop: theme.sp(0.2) },

  rainWrap: {
    marginTop: theme.sp(1),
    backgroundColor: theme.colors.cardBgSoft + 'AA',
    borderRadius: theme.fs(14),
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    overflow: 'hidden',
  },

  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.sp(1.5),
    minHeight: theme.sp(9),
    marginTop: theme.sp(2),
  },
  selectedEmoji: { fontSize: theme.fs(24) },
  selectedLabel: { fontSize: theme.fontSize.h2, fontWeight: theme.weight.bold as never, color: mm.colors.ink },
  selectedHint: { fontSize: theme.fontSize.sm, color: mm.colors.inkFaint },

  noteInput: {
    marginTop: theme.sp(2),
    backgroundColor: mm.colors.cardBg,
    borderWidth: 1,
    borderColor: mm.colors.cardBorder,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.sp(3),
    paddingVertical: theme.sp(2.5),
    fontSize: theme.fontSize.body,
    color: mm.colors.ink,
    minHeight: theme.sp(11),
    textAlignVertical: 'top',
  },

  saveWrap: {
    alignSelf: 'stretch',
    paddingTop: theme.sp(1),
    paddingBottom: theme.sp(1),
  },
  saveBtn: {
    paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
