import React, { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import Card from './Card';
import { computeSleepPersonalized, sleepRecoveryTag } from '../lib/sleepPersonalized';
import { healthStore } from '../data/healthStore';

/**
 * ══ SleepCard ══ 首页睡眠卡（v18.145）
 *
 * ══ 为什么单独一张卡（而不是塞进 AllDayRecoveryCard）══
 * `AllDayRecoveryCard` 回答的是「**全天**恢复节律」（睡眠恢复 + 皮质醇活性双曲线），
 * 它的时间轴是 00:00~24:00。本卡回答的是「**昨晚这一觉**」，两者信息层级不同：
 *  · 昨晚 = 一个具体事件（时长/深睡/几点睡几点起），用户能直接对照自己的记忆
 * · 全天 = 一条趋势曲线，用户看的是形状
 * 挤在一张卡里会互相干扰，且断流时两者的空态判据还不一样。
 *
 * ══ 三个必须显式呈现的口径问题 ══
 * ① **相对 vs 绝对**：基线不足 5 晚时用绝对分（对照 7.5h 目标），满 5 晚切相对分
 *    （对照自己，锚点 50）。两者不能共用同一句说明 —— 切换那天用户会以为分数崩了。
 * ② **规律性无数据要说「还在攒」**：`regularity.score === null` 时不能画 0，
 *    也不能留空白（用户会以为坏了）。
 * ③ **断流即空态**：`dataStale` 时数字、时长、规律性**全部**不给
 *    （与首页圆环同一判据，见 MEMORY「断流即空态」铁律）。
 */

interface Props {
  /** 断流判据：与首页圆环同一个字段，不另设口径 */
  dataStale?: boolean;
  onPress?: () => void;
}

/** 分钟 → "9h34m" */
function fmtDur(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

/** "±15 分" —— 规律性那一栏的波动幅度 */
function fmtJitter(sdMin: number | null | undefined): string {
  if (sdMin == null || !Number.isFinite(sdMin)) return '';
  return `±${Math.round(sdMin)} 分`;
}

/**
 * 规律性分 → 档位文案。
 * ⚠ 阈值围绕「中点 sd」而非分数：<30min 好、>60min 差（Windred 2024 的原始分组），
 *   这样文案与底层依据一致，不会出现「依据 30/60 分档、文案却按 70/85 切」的错位。
 */
function regLabel(score: number, sdMin: number | null): string {
  if (sdMin == null) return '还在攒';
  if (sdMin < 30) return '规律';
  if (sdMin < 60) return '一般';
  return '不规律';
}

const SleepCard = React.memo(function SleepCard({ dataStale = false, onPress }: Props) {
  // ★ 必须放模块作用域之外（组件内 useMemo 而不是模块级常量）：
  //   睡眠分每天变，若在模块顶层算一次就永远定格。
  const rep = useMemo(() => {
    try { return computeSleepPersonalized(); } catch { return null; }
  }, []);

  const s = useMemo(() => {
    try {
      const dk = rep?.sourceDayKey;
      return dk ? healthStore.getSleep(dk) : null;
    } catch { return null; }
  }, [rep?.sourceDayKey]);

  const empty = dataStale || rep == null || rep.score == null;

  // —— 断流/无数据：整卡空态，不挂任何数字 ——
  if (empty) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold }}>睡眠</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: theme.space.xs }}>
          <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold }}>—</Text>
        </View>
        <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: theme.space.xs }}>
          {dataStale ? '戒指暂无新数据' : '昨晚没有睡眠记录，戴上戒指睡一晚就有'}
        </Text>
      </Card>
    );
  }

  // ★ TS 收窄：早返回后 rep 仍被当成 possibly null，这里显式取两个局部常量，
  //   后面全部用它们，避免到处写 `!`（非空断言）—— 一旦以后条件变了 `!` 会静默炸掉。
  // ★ 早返回已保证 score != null，但 TS 收窄不跨 useMemo 的解构 ⇒ 这里显式断言**一次**，
  //   下面全部当它是 number 用（比散落 8 个 `!` 安全：断言集中在一处、条件改了一处就编译报错）。
  const score = rep.score as number;
  const mode = rep.mode;
  const baselineDays = rep.baselineDays;
  const daysToReady = rep.daysToReady;
  const relative = mode === 'relative';
  const reg = rep.regularity;
  const deepPct = s && s.total > 0 ? Math.round(((s.deep ?? 0) / s.total) * 100) : null;

  // ★ v18.156：档位词统一走 `sleepRecoveryTag`（与首页 chip / 睡眠节律卡 badge 同源）。
  //   此前这里自带 62/45 一套，而 chip 是 58/42 —— 同一张首页上「睡眠恢复」有四种说法。
  const recoveryLabel = sleepRecoveryTag(score, relative ? 'relative' : 'absolute') ?? '—';

  // 进度条锚点：相对口径锚在 50（和平时一样），绝对口径锚在「7.5h 达标≈80」
  const anchorPct = relative ? 75 : 80;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`睡眠 ${score} 分，${recoveryLabel}`}
    >
      <Card>
        {/* ── 标题行 + 恢复档位 ── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.body, fontWeight: theme.weight.semibold }}>睡眠</Text>
            {/* 副标写「口径」而不是「描述」—— 用户要的是对比自己的参照物 */}
            <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: 2 }}>
              {relative ? '对比你自己平时' : '对照 7.5 小时目标'}
            </Text>
          </View>
          <View style={{
            backgroundColor: mm.colors.limeSoft, borderRadius: theme.radius.pill,
            paddingHorizontal: theme.space.sm, paddingVertical: 3,
          }}>
            <Text style={{ color: mm.colors.limeDeep, fontSize: theme.fontSize.micro, fontWeight: theme.weight.semibold }}>
              {recoveryLabel}
            </Text>
          </View>
        </View>

        {/* ── 大数字 + 锚点说明 ── */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: theme.space.sm }}>
          <Text style={{ color: theme.colors.textInk, fontSize: theme.fontSize.stat, fontWeight: theme.weight.bold }}>{score}</Text>
          <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.xs, marginLeft: 3 }}>/ 100</Text>
        </View>

        {/* ★ 锚点必须写出来：不写的话 47 会被读成「睡眠 47 分」（绝对量） */}
        <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: 2 }}>
          {relative
            ? `50 = 和平时一样 · 来自 ${baselineDays} 晚个人基线`
            : `${daysToReady} 晚后改用个人基线对比`}
        </Text>

        {/* ── 进度条：轨道 + 填充 + 锚点刻度 ── */}
        <View style={{ marginTop: theme.space.sm }}>
          <View style={{
            height: 4, borderRadius: theme.radius.pill,
            backgroundColor: mm.colors.limeTint, overflow: 'hidden',
          }}>
            <View style={{
              height: '100%', borderRadius: theme.radius.pill,
              backgroundColor: mm.colors.limeMid,
              width: `${Math.max(0, Math.min(100, score))}%`,
            }} />
          </View>
          {/* 锚点刻度：相对口径 50、绝对口径 80，用一条深色竖线标出「基准在哪」 */}
          <View style={{
            position: 'absolute', left: `${anchorPct}%`, top: -2, bottom: -2, width: 1.5,
            backgroundColor: mm.colors.limeDeep,
          }} />
        </View>

        {/* ── 作息规律（★ Oura 的 Sleep Regularity，我们此前完全没有）── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginTop: theme.space.card, paddingTop: theme.space.sm,
          borderTopWidth: 1, borderTopColor: mm.colors.cardBorder,
        }}>
          <Text style={{ color: theme.colors.textTitle, fontSize: theme.fontSize.xs, fontWeight: theme.weight.medium }}>作息规律</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            {/* ★ 无数据时给 null 不给 0：0 分会被读成「极度不规律」，而实际是「样本不足」 */}
            {reg.score != null
              ? <Text style={{ color: theme.colors.textInk, fontSize: theme.fontSize.card, fontWeight: theme.weight.bold }}>{reg.score}</Text>
              : null}
            <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro }}>
              {reg.score != null ? regLabel(reg.score, reg.midSdMin) : `还需 ${Math.max(0, 5 - reg.days)} 晚`}
            </Text>
          </View>
        </View>

        {/* ── 三格明细：入睡 / 起床 / 时长（缺项显 '—'，不补不猜）── */}
        <View style={{ flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm }}>
          {[
            { label: '入睡', value: s?.sleepTime ?? '—', note: fmtJitter(reg.bedSdMin) },
            { label: '起床', value: s?.wakeTime ?? '—', note: fmtJitter(reg.wakeSdMin) },
            { label: '睡了', value: fmtDur(s?.total), note: deepPct != null ? `深睡 ${deepPct}%` : '' },
          ].map((it) => (
            <View
              key={it.label}
              style={{
                flex: 1, backgroundColor: mm.colors.limeTint,
                borderRadius: theme.radius.sm, paddingHorizontal: theme.space.sm, paddingVertical: theme.space.xs,
              }}
            >
              <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro }}>{it.label}</Text>
              <Text style={{
                color: theme.colors.textInk, fontSize: theme.fontSize.xs,
                fontWeight: theme.weight.semibold, marginTop: 1,
              }} numberOfLines={1}>
                {it.value}
              </Text>
              {!!it.note && (
                <Text style={{ color: theme.colors.textSub, fontSize: theme.fontSize.micro, marginTop: 1 }} numberOfLines={1}>
                  {it.note}
                </Text>
              )}
            </View>
          ))}
        </View>
      </Card>
    </Pressable>
  );
});

export default SleepCard;
