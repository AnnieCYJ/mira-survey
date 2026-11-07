import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { theme } from '../theme/theme';
import { RANGE_DEF, type RangeKey } from '../data/metrics';

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  exclude?: RangeKey[];
}

const RANGES: RangeKey[] = ['day', 'week', 'month', 'year'];

/**
 * 日/周/月/年 分段切换。
 *
 * ★ 2026-10-08 交互优化（B4-手感）：此前高亮（pill + 文字颜色）完全依赖父级 re-render ——
 *   详情页在 BLE 回填期 ~500ms 整页重渲染一次，按压后高亮要等到下一次 render 才出现，
 *   手感就是「点了不动」。现在改为：
 *   ① onPressIn **立即**启动原生驱动动画（pill 淡入 + 文字高亮 crossfade + 按压缩放），
 *      JS 线程再忙动画照常播（只动 transform / opacity）；
 *   ② 松手若未确认（拖出取消）自动回弹到当前生效档；
 *   ③ 外部 value 变化时 useEffect 对齐一次（慢速），双保险。
 */
export default function RangeSwitch({ value, onChange, exclude }: Props) {
  const ranges = exclude ? RANGES.filter((r) => !exclude.includes(r)) : RANGES;
  const effectiveValue = ranges.includes(value) ? value : ranges[0];

  type ChipAnim = { pill: Animated.Value; txt: Animated.Value; scale: Animated.Value };
  const animsRef = useRef<Record<string, ChipAnim>>({});
  ranges.forEach((r) => {
    if (!animsRef.current[r]) {
      animsRef.current[r] = {
        pill: new Animated.Value(r === effectiveValue ? 1 : 0),
        txt: new Animated.Value(r === effectiveValue ? 1 : 0),
        scale: new Animated.Value(1),
      };
    }
  });
  // onPressIn 预览过的 chip（松手时若未确认则回弹）
  const previewedRef = useRef<string | null>(null);

  const setChip = (r: string, on: boolean, fast = false) => {
    const a = animsRef.current[r];
    if (!a) return;
    const dur = fast ? theme.motion.instant : theme.motion.quick;
    Animated.parallel([
      Animated.timing(a.pill, { toValue: on ? 1 : 0, duration: dur, easing: theme.motion.easeStandard, useNativeDriver: true }),
      Animated.timing(a.txt, { toValue: on ? 1 : 0, duration: dur, easing: theme.motion.easeStandard, useNativeDriver: true }),
    ]).start();
  };
  const scaleTo = (r: string, v: number) => {
    const a = animsRef.current[r];
    if (!a) return;
    Animated.timing(a.scale, { toValue: v, duration: theme.motion.instant, easing: theme.motion.easeStandard, useNativeDriver: true }).start();
  };

  // 外部 value 变化 → 对齐（慢速；多数场景 onPressIn 的快速预览已就位，这里只兜底）
  useEffect(() => {
    previewedRef.current = null;
    ranges.forEach((r) => setChip(r, r === effectiveValue));
  }, [effectiveValue]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.row}>
      {ranges.map((r) => {
        const a = animsRef.current[r];
        return (
          <Pressable
            key={r}
            style={styles.chipWrap}
            onPressIn={() => {
              if (r === effectiveValue) return;
              // ★ 修复竞态（2026-10-08 用户实测「点了月再点年，两个都亮」）：
              //   快速连点时先收回上一个 chip 的预览高亮，再点亮当前 chip ——
              //   否则两个预览态会同时存在，直到父级慢渲染的 useEffect 才纠正。
              if (previewedRef.current && previewedRef.current !== r) {
                setChip(previewedRef.current, false, true);
              }
              previewedRef.current = r;
              setChip(r, true, true);
              scaleTo(r, theme.press.scale);
            }}
            onPress={() => {
              // 已确认：清掉预览标记，防止随后的 onPressOut 误回弹
              previewedRef.current = null;
              if (r !== effectiveValue) onChange(r);
            }}
            onPressOut={() => {
              scaleTo(r, 1);
              // 拖出取消（onPress 未发生）→ 回弹到当前生效档
              if (previewedRef.current === r) {
                previewedRef.current = null;
                if (r !== effectiveValue) setChip(r, false, true);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={RANGE_DEF[r].label}
            accessibilityState={{ selected: r === effectiveValue }}
          >
            {/* 背景 pill（Fabric 安全：正常 child + absoluteFillObject，不 absolute 定位 Animated.View） */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                { opacity: a.pill, transform: [{ scale: a.scale }] },
              ]}
            />
            {/* 文字双层 crossfade：灰色常驻，白色高亮层由动画驱动（不依赖父级 render） */}
            <View pointerEvents="none" style={styles.textStack}>
              <Text style={styles.text}>{RANGE_DEF[r].label}</Text>
              <Animated.View pointerEvents="none" style={[styles.textOverlay, { opacity: a.txt }]}>
                <Text style={[styles.text, styles.textOn]}>{RANGE_DEF[r].label}</Text>
              </Animated.View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginBottom: theme.space.md,
    backgroundColor: 'transparent',
    borderRadius: theme.radius.pill,
    padding: 3,
  },
  chipWrap: {
    flex: 1,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.sp(2),
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    // ★ mira-ocean（2026-10-17 用户「日周月年按钮变紫改白」）：选中 pill 紫 → 近白
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: theme.radius.pill,
    shadowColor: theme.colors.ui.shadowBlack,
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
  textStack: { alignItems: 'center', justifyContent: 'center' },
  textOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textSub,
  },
  // ★ mira-ocean：白 pill 上的选中文字改深蓝（原白字白底不可见）
  textOn: { color: '#2A4470' },
});
