/**
 * SunGlobe —— 日历下方的「太阳水晶球」收集瓶（2026-11-09，用户）
 *
 * ★ 2026-11-09(2)（用户反馈三连改）：
 *   1. 球放大：246 → 280（按屏宽自适应封顶，小屏不溢出）。
 *   2. 只留「白色磨砂边缘」：球内部完全透明（去掉 BlurView / 内部渐变 / 高光），
 *      边缘用多层同心白环向内渐变消隐，模拟磨砂玻璃沿口。
 *   3. 金币加大：24/21/18/16 dp（按枚数分档）。
 *   4. 【关键 bug 修复】金币晃手机不动：expo-sensors 的 Accelerometer 返回值单位是
 *      **g 力（1g ≈ 9.81 m/s²）**，之前误当 m/s² 又除以 9.8，倾斜 45° 时 0.7g 被
 *      算成 0.07 → 触发「平放兜底」→ 重力永远朝下，倾斜/摇动全部无效。
 *      现在直接使用 g 值，倾斜/摇动真实生效。
 *
 * ★ 2026-11-09(3)（用户参考图 + 补充）：
 *   5. 边缘渐变重做：参考图是「顶部几乎无白边、底部一条亮白弧」的不对称渐变——
 *      改用 react-native-svg 圆环描边 + 垂直 LinearGradient（上 0.05 → 下 0.72），
 *      外描边 + 两圈向内渐隐（strokeOpacity 0.55 / 0.26），模拟磨砂白边向里融开。
 *   6. 震感：金币互撞 / 撞壁（collisionStart，相对速度>2.2）→ 18ms 短震；
 *      滚动贴壁过程（collisionActive，速度>1.4）→ 每 110ms 一次 8ms 微震，
 *      静止金币不震。用 RN 内置 Vibration（expo-haptics 未装，离线构建禁加新原生包）。
 *
 * 物理：matter-js 在 JS 线程以固定步长步进，位置经 reanimated sharedValue 送到 UI 线程渲染
 *       （物理不卡 UI，页面滚动不受影响）。
 * 重力：加速度计（含重力，单位 g）→ 屏幕坐标：gravity.x = -gx · gravity.y = gy；
 *       竖直持机 ≈ (0, 1) 金币沉底；倾斜手机金币向低处滚动、互相碰撞；
 *       近乎平放（x/y 合量 < 0.35g）时兜底 y=1，金币贴底静止，不会飘起来。
 * 口径：金币数 = 当月所有「达标日」太阳数总和（与月历格子 SunMark 完全同源），不编数字。
 * 性能：金币上限 MAX_COINS 枚（物理 O(n²) 碰撞很轻）；超出的总数用 ×N 徽章表达。
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Vibration } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Accelerometer } from 'expo-sensors';
import Matter from 'matter-js';
import SunMark from './SunMark';
import { theme } from '../theme/theme';

// ★ 2026-11-10（用户：「如果这个月有多少颗，球里面就应该有多少颗，要累计逐渐增加」）：
//   上限 18 → 32。每天可有多枚达标（睡眠恢复≥85 + 步数达标），一个月很容易超过 18；
//   旧版封顶后球内金币就不再增加，只剩 ×N 徽章，观感就是「数不涨了」。
//   32 枚以内逐颗对应、随达标累计增长；超过 32 才用 ×N 徽章 + 球下「N 枚太阳」表达总数
//   （物理 O(n²) 碰撞，不做无上限渲染，避免 debug 包卡顿；金币休眠后跳过步进，静止零开销）。
const MAX_COINS = 32;
const WALL_DOTS = 44;      // ★ 2026-11-09(4) 48→44：debug 包 JS 慢，减壁点降每帧碰撞检测量（44 点 + 半径 7 仍无缝隙，金币 r≥16 钻不出去）
const WALL_DOT_R = 7;      // 壁点半径
const GLOBE_SIZE = 280;    // 球直径（dp）★ 2026-11-09(2) 用户要求放大

// ★ 2026-11-09(3) 震感（用户：碰撞 + 滑动过程都要有）：RN 内置 Vibration（expo-haptics 未安装，
//   离线构建不能加新原生包）。碰撞 = collisionStart 一次短震；滚动贴壁 = collisionActive 节流微震；
//   静止（速度 < 阈值）不震，避免金币静置时持续震动。
// ★ 2026-11-09(4)（用户：震感/晃动都「卡」）：滚动微震 110→150ms、碰撞节流 140→160ms——
//   震得太密本身就是「顿」感的来源之一；配合物理迭代降载一起改。
const BUZZ_IMPACT_MS = 18;        // 碰撞震动时长
const BUZZ_ROLL_MS = 8;           // 滚动微震时长
const BUZZ_ROLL_GAP = 150;        // 滚动微震最小间隔（ms）
const BUZZ_IMPACT_GAP = 160;      // 碰撞震动最小间隔（ms）
const BUZZ_IMPACT_SPEED = 2.2;    // 相对速度阈值：低于它的接触不算碰撞
const BUZZ_ROLL_SPEED = 1.4;      // 滚动速度阈值：静止金币贴壁不会触发

type CoinPos = { x: number; y: number; a: number };

/** 单枚金币：读共享位置数组里自己那一份，UI 线程渲染 transform */
function GlobeCoin({
  index,
  pos,
  coinR,
}: {
  index: number;
  pos: Animated.SharedValue<CoinPos[]>;
  coinR: number;
}) {
  const d = coinR * 2;
  const anim = useAnimatedStyle(() => {
    const p = pos.value[index];
    if (!p) return { opacity: 0, transform: [{ translateX: -9999 }, { translateY: -9999 }] };
    const deg = ((p.a * 180) / Math.PI) % 360;
    return {
      opacity: 1,
      transform: [
        { translateX: p.x - coinR },
        { translateY: p.y - coinR },
        { rotate: `${deg}deg` },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: d, height: d }, anim]}>
      <SunMark size={d} />
    </Animated.View>
  );
}

export default function SunGlobe({ count, monthLabel }: { count: number; monthLabel?: string }) {
  // 小屏保护：球最大 280，屏太窄时按「屏宽 - 72」收缩
  const { width: winW } = useWindowDimensions();
  const size = Math.min(GLOBE_SIZE, Math.max(200, winW - 72));
  const R = size / 2;
  const n = Math.min(count, MAX_COINS);
  // ★ 2026-11-09(2)：金币加大（枚数越少越大，拥挤时自动缩小防重叠）
  // ★ 2026-11-10：上限提到 32 后补两档小半径，保证 20~32 枚仍能沉底不重叠；
  //   壁点缝隙 ≈6dp，最金币 r=12（直径 24）仍远大于缝隙，不会钻出球外。
  const coinR = n <= 6 ? 24 : n <= 10 ? 21 : n <= 14 ? 18 : n <= 20 ? 16 : n <= 26 ? 14 : 12;

  /** 全部金币的位置数组（JS 线程每帧整体写入，UI 线程逐枚读取） */
  const pos = useSharedValue<CoinPos[]>([]);

  const engineRef = useRef<Matter.Engine | null>(null);
  const coinBodiesRef = useRef<Matter.Body[]>([]);
  const gravRef = useRef({ gx: 0, gy: 1 });

  useEffect(() => {
    // ── 建世界：一圈壁点构成球形碗 ───────────────────────────────
    // ★ 2026-11-09(4)（用户：晃动「卡」）：debug 包 JS 慢，降物理迭代 ——
    //   positionIterations 6→4、velocityIterations 4→3（默认值），视觉差异很小、每帧 CPU 省约 1/3。
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1, scale: 0.0011 },
      positionIterations: 4,
      velocityIterations: 3,
      // ★ 2026-11-09(4)：开启休眠 —— 金币静止后引擎近乎零开销；
      //   倾斜手机（重力变化）时在加速度计回调里手动唤醒。
      enableSleeping: true,
    });
    engineRef.current = engine;
    const walls: Matter.Body[] = [];
    for (let i = 0; i < WALL_DOTS; i++) {
      const a = (i / WALL_DOTS) * Math.PI * 2;
      const wr = WALL_DOT_R;
      walls.push(
        Matter.Bodies.circle(R + Math.cos(a) * (R - wr - 1), R + Math.sin(a) * (R - wr - 1), wr, {
          isStatic: true,
        }),
      );
    }
    Matter.World.add(engine.world, walls);

    // ── 金币：随机散布在球内偏上位置 → 开场自然掉落沉底 ──────────
    coinBodiesRef.current = [];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.random() * Math.max(6, R - coinR - WALL_DOT_R - 14);
      const body = Matter.Bodies.circle(
        R + Math.cos(ang) * rr,
        R + Math.sin(ang) * rr - R * 0.35,
        coinR,
        { restitution: 0.42, friction: 0.05, frictionAir: 0.010, density: 0.0009 },
      );
      coinBodiesRef.current.push(body);
    }
    Matter.World.add(engine.world, coinBodiesRef.current);

    // ── 震感：碰撞短震 + 滚动持续微震（★ 2026-11-09(3) 用户）────────
    // 碰撞：collisionStart + 相对速度 > 2.2 → 一次 18ms 短震（节流 140ms）。
    // 滚动：collisionActive（贴壁/贴币持续接触）+ 速度 > 1.4 → 每 110ms 一次 8ms 微震，
    //       形成滚动时的「沙沙」触感；金币静止时速度≈0 不震。
    let lastImpactBuzz = 0;
    let lastRollBuzz = 0;
    const relSpeed = (pair: Matter.Pair) => {
      const a = pair.bodyA;
      const b = pair.bodyB;
      return Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
    };
    Matter.Events.on(engine, 'collisionStart', (e) => {
      const now = Date.now();
      if (now - lastImpactBuzz < BUZZ_IMPACT_GAP) return;
      for (const pair of e.pairs) {
        if (relSpeed(pair) > BUZZ_IMPACT_SPEED) {
          lastImpactBuzz = now;
          Vibration.vibrate(BUZZ_IMPACT_MS);
          break;
        }
      }
    });
    Matter.Events.on(engine, 'collisionActive', (e) => {
      const now = Date.now();
      if (now - lastRollBuzz < BUZZ_ROLL_GAP) return;
      for (const pair of e.pairs) {
        if (relSpeed(pair) > BUZZ_ROLL_SPEED) {
          lastRollBuzz = now;
          Vibration.vibrate(BUZZ_ROLL_MS);
          break;
        }
      }
    });

    // ── 重力感应：加速度计（含重力）→ 屏幕坐标重力 ──────────────
    // ★ 单位修正：expo-sensors 返回 **g 力**（1g ≈ 9.81 m/s²），直接使用。
    //   之前 /9.8 是把它当 m/s²，倾斜信号被缩小近 100 倍 → 金币永远不动（用户反馈）。
    Accelerometer.setUpdateInterval(66);
    const clampG = (v: number) => Math.max(-1.6, Math.min(1.6, v));
    let lastWokeGx = 0;
    let lastWokeGy = 1;
    // ★ 2026-11-09(5)（用户：还是有点卡）：全休眠时连 Engine.update 也一并跳过——
    //   重力变化（倾斜/摇晃）唤醒时置 needSim，恢复模拟。
    let needSim = true;
    const sub = Accelerometer.addListener(({ x, y }) => {
      const gx = clampG(-x);
      let gy = clampG(y);
      // 近乎平放兜底：x/y 合量极小（重力几乎全在 z 轴）→ 金币贴底静止，不飘
      if (Math.hypot(gx, gy) < 0.35) gy = 1;
      gravRef.current = { gx, gy };
      // ★ 休眠唤醒：重力方向明显变化（倾斜/摇晃）→ 唤醒全部金币恢复模拟
      if (Math.abs(gx - lastWokeGx) + Math.abs(gy - lastWokeGy) > 0.06) {
        for (const b of coinBodiesRef.current) Matter.Sleeping.set(b, false);
        lastWokeGx = gx;
        lastWokeGy = gy;
        needSim = true;
      }
    });

    // ── 主循环：固定步长步进 → 位置写入 sharedValue ─────────────
    let alive = true;
    let rafId = 0;
    // ★ 全部休眠且无唤醒时：跳过物理步进与 sharedValue 写入（近零开销），金币静置省电顺滑
    let pendingPush = true;
    const loop = () => {
      if (!alive || !engineRef.current) return;
      const e = engineRef.current;
      const bodies = coinBodiesRef.current;
      let allAsleep = bodies.length > 0;
      for (const b of bodies) {
        if (!b.isSleeping) { allAsleep = false; break; }
      }
      if (!allAsleep || needSim) {
        e.gravity.x = gravRef.current.gx * 1.25;
        e.gravity.y = gravRef.current.gy * 1.25;
        // 限速：防甩手机太快隧穿壁点
        for (const b of bodies) {
          const v = b.velocity;
          const sp = Math.hypot(v.x, v.y);
          if (sp > 30) Matter.Body.setVelocity(b, { x: (v.x / sp) * 30, y: (v.y / sp) * 30 });
        }
        Matter.Engine.update(e, 16.667);
        needSim = false;
        pos.value = bodies.map((b) => ({
          x: b.position.x,
          y: b.position.y,
          a: b.angle,
        }));
        pendingPush = true;
      } else if (pendingPush) {
        // 刚睡着的下一帧：补写一次最终静止位置，之后不再写
        pos.value = bodies.map((b) => ({
          x: b.position.x,
          y: b.position.y,
          a: b.angle,
        }));
        pendingPush = false;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      sub.remove();
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      engineRef.current = null;
    };
    // 金币数 / 半径 / 球大小变化（切月、新增达标）→ 重建世界，新金币重新掉落
  }, [n, coinR, R, pos]);

  const overCapacity = count > MAX_COINS;

  return (
    <View style={s.wrap}>
      {/* 球体：内部完全透明，边缘 = 一整条平滑渐变带（★ 2026-11-09(4) 用户：v3 的三圈描边
          看起来是「三个环」——改为单个径向渐变填充（中心透明 → 边缘平滑爬升），
          再用垂直渐变蒙版做「上淡下浓」，整条带子连续无分段。 */}
      <View style={[s.globe, { width: size, height: size, borderRadius: R }]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            {/* 径向渐变：球心 78% 半径内全透明，78%→100% 平滑爬升到 0.55（一整条带，无硬边） */}
            <RadialGradient id="rimRadial" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.78" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="0.85" stopColor="#FFFFFF" stopOpacity={0.08} />
              <Stop offset="0.92" stopColor="#FFFFFF" stopOpacity={0.22} />
              <Stop offset="0.97" stopColor="#FFFFFF" stopOpacity={0.40} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.55} />
            </RadialGradient>
            {/* 垂直渐变蒙版：顶部 30% 亮度 → 底部 100%，实现「上淡下浓」 */}
            <LinearGradient id="vertFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.30} />
              <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={1} />
            </LinearGradient>
            <Mask id="vertMask" maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
              <Rect x={0} y={0} width={size} height={size} fill="url(#vertFade)" />
            </Mask>
          </Defs>
          {/* 一个填充圆搞定整条渐变带：内部透明、边缘平滑、亮度上淡下浓 */}
          <Circle cx={R} cy={R} r={R} fill="url(#rimRadial)" mask="url(#vertMask)" />
        </Svg>
        {Array.from({ length: n }, (_, i) => (
          <GlobeCoin key={i} index={i} pos={pos} coinR={coinR} />
        ))}
        {count === 0 ? (
          <View style={s.emptyWrap} pointerEvents="none">
            <Text style={s.emptyText}>达标一天，收一枚太阳</Text>
          </View>
        ) : null}
      </View>
      {/* 总数徽章（超过球内容量时） */}
      {overCapacity ? (
        <View style={s.badge} pointerEvents="none">
          <Text style={s.badgeText}>×{count}</Text>
        </View>
      ) : null}
      {/* 球下一行小说明（诚实口径：就是当月日历里那些太阳） */}
      <Text style={s.note}>
        {count > 0 ? `${monthLabel ?? '本月'}收下 ${count} 枚太阳` : '这个月还没有太阳'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 14, marginBottom: 6 },
  globe: {
    overflow: 'hidden',
    // 内部透明、不铺底色；边缘交给 SVG 渐变描边（上淡下浓），容器不再加均匀白边
    backgroundColor: 'transparent',
    // 玻璃球的柔和投影（让透明球在卡片上「立」得住）
    shadowColor: 'rgba(58,70,140,0.30)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.30,
    shadowRadius: 18,
    elevation: 8,
  },
  emptyWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, color: 'rgba(88,96,138,0.55)', fontWeight: '500' },
  badge: {
    position: 'absolute',
    right: '12%',
    bottom: 26,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#B98A1F' },
  note: { marginTop: 10, fontSize: 12.5, color: theme.colors.textSub, fontWeight: '500' },
});
