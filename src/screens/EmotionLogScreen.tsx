/**
 * EmotionLogScreen —— 情绪记录页（Mooda 式 + 物理珠雨）
 *
 * v18.25 改版：
 *  - 情绪扩到 12 档；去掉月历（用户要求）。
 *  - 选择方式改为 Matter.js 弹珠动效：12 种情绪玻璃珠从顶部随机落下，重力下落、
 *    互相碰撞反弹、底部堆积，堆积后持续轻微摇晃；点一颗珠子=选中该情绪。
 *    物理由 matter-js 模拟，渲染 react-native-svg（每帧读 body 位置重绘）。
 *
 * 口径不变：情绪=用户自报（Mira 不做情绪推断/评分）。
 * 数据：data/emotionLog.ts（documentDirectory/emotionLog.json）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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

/* ── 珠雨参数 ────────────────────────────────────────────── */
const BEAD_COUNT = 34;          // 珠子数量（性能与观感平衡）
const RAIN_H = 330;             // 珠雨区高度
const R_MIN = 14, R_MAX = 20;   // 珠半径范围
const SHAKE_EVERY = 80;         // 每 N 帧给珠堆一次轻摇晃

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
  const [, setTick] = useState(0);

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

    // 34 颗情绪珠：emoji 按 12 档循环+抖动取，位置随机错落下落
    const beads: Bead[] = [];
    for (let i = 0; i < BEAD_COUNT; i++) {
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
        mood: MOOD_ORDER[(i + Math.floor(Math.random() * 3)) % MOOD_ORDER.length],
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
                <SvgText
                  x={x} y={y + b.r * 0.38}
                  fontSize={b.r * 1.05}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {MOOD_EMOJI[b.mood]}
                </SvgText>
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
    <ScreenContainer>
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

        <ScrollView showsVerticalScrollIndicator={false} bounces>
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

          {/* 保存（渐变按钮铁律：渐变层为正常流子元素、自带 padding/radius） */}
          <TouchableOpacity
            disabled={!selected || savedTick}
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="保存情绪记录"
            style={{ alignSelf: 'stretch', marginTop: theme.sp(2) }}
          >
            {selected ? (
              <LinearGradient
                colors={savedTick ? [mm.colors.limeDeep, mm.colors.limeDeep] : [mm.colors.btnGradFrom, mm.colors.btnGradTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveBtn}
              >
                <Text style={{ fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: savedTick ? mm.colors.limeSoft : mm.colors.btnTextOnGrad }}>
                  {savedTick ? '已记录 ✓' : '记下此刻'}
                </Text>
              </LinearGradient>
            ) : (
              <View style={[styles.saveBtn, { backgroundColor: mm.colors.btnBusyBg }]}>
                <Text style={{ fontSize: theme.fs(15), fontWeight: theme.weight.semibold as never, color: mm.colors.inkFaint }}>
                  选一个心情
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
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
    fontSize: theme.fs(14),
    color: mm.colors.ink,
    minHeight: theme.sp(11),
    textAlignVertical: 'top',
  },

  saveBtn: {
    paddingVertical: theme.sp(3.5),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
