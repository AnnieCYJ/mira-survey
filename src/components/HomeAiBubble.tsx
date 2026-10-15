/**
 * HomeAiBubble: inline voice state, evidence and actionable suggestions.
 * Keep the original 84-point height ceiling so the whole homepage fits.
 * Text stays inside a compact, viewport-budgeted frame.
 * Collection confirms only after local persistence succeeds.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Image, ImageBackground } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useVoiceTriggerLive, useVoiceTriggerApi } from '../hooks/useVoiceTrigger';
import { pickSuggestion, type SuggestionCandidate } from '../lib/suggestionEngine';
import { requestAiSuggestion, aiCandidateFor, sigOf } from '../lib/aiSuggestion';
import { keepHabit, dismissSuggestion, habitHeadline, HABIT_QUESTION } from '../data/habitSuggestions';
import { recordAnalysisFeedback } from '../data/analysisFeedback';
import Icon from './Icon';
import { useReducedMotion } from '../hooks/useReducedMotion';

const TOOL_THUMB: Record<string, number> = {
  Breathing: require('../assets/card_meditation.jpg'),
  ToolTopic: require('../assets/card_learn.png'),
  LearnRead: require('../assets/card_learn.png'), // ★ 十八改：读科普深链直达具体文章（LearnRead）
  FoodScan: require('../assets/card_food.jpg'),
};
const THUMB_MED = require('../assets/card_meditation.jpg');
const THUMB_ACT = require('../assets/card_activity.jpg');
const THUMB_FOOD = require('../assets/card_food.jpg');
const THUMB_LEARN = require('../assets/card_learn.png');
const THUMB_DEFAULT = require('../assets/card_emotion.jpg');
// ★ 2026-10-15：卡内自然海景拟态玻璃气泡（用户参考图定稿）—— 海滩风光图（天空 + 底部海浪）打底，
//   轻模糊保风光可辨 + 暮色压暗渐变 + 深色拟态玻璃层（V4 暮色款），文字浮在图上。
//   RN 0.74 无 backdrop-filter，磨砂感由图本身高斯模糊（8px，轻于旧版 22，风光要看得见）+ 半透明叠层合成。
const SEA_BG = require('../assets/bg_sea_nature.jpg');
// V4 暮色深玻璃三件套：暮色压暗渐变（上浅下深）+ 深玻璃层 + 亮边/尾巴
const SEA_DIM_TOP = 'rgba(24,22,40,0.10)';
const SEA_DIM_BOTTOM = 'rgba(24,22,40,0.42)';
const DARK_GLASS = 'rgba(26,24,42,0.40)';
const GLASS_BORDER_DARK = 'rgba(255,255,255,0.28)';
const TAIL_FILL_DARK = 'rgba(30,28,48,0.55)';
// 深玻璃上的文字色系：白主字 + 半白次字 + 深色柔光投影（保证压暗图上可读）
const TXT_ON_GLASS = '#FFFFFF';
const TXT_ON_GLASS_SUB = 'rgba(255,255,255,0.72)';
const TXT_ON_GLASS_FAINT = 'rgba(255,255,255,0.85)';
const GLASS_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.35)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 10,
};
// V4 浅色 pills（深玻璃上的行动按钮）
const PILL_LIGHT_BG = 'rgba(255,255,255,0.85)';
const PILL_LIGHT_TEXT = '#2C2A3E';

function thumbFor(c: SuggestionCandidate): number {
  if (c.cta && TOOL_THUMB[c.cta.screen]) return TOOL_THUMB[c.cta.screen];
  const s = `${c.action ?? ''}${c.headline ?? ''}`;
  if (/呼吸|冥想|睡/.test(s)) return THUMB_MED;
  if (/散步|运动|走|活动/.test(s)) return THUMB_ACT;
  if (/吃|饮食|餐|营养/.test(s)) return THUMB_FOOD;
  if (/科普|读|知识|激素/.test(s)) return THUMB_LEARN;
  return THUMB_DEFAULT;
}

// Original maximum body height; small screens may use a shorter frame.
// ★ 方案B（2026-10-14）：上限由 84 提到 118，让气泡容下「圆环下方移入的分析两行」+ 建议卡。
// ★ 2026-10-15：用户「卡片稍高一点、分析内容多一点」→ 118 → 144，分析允许 3 行。
// ★ 2026-10-15（v2）：海景拟态气泡 + 建议支持 2 条 → 144 → 224（分析3行 + 2 建议行的实高下限）。
// ★ 2026-10-15（V4 暮色深玻璃）：加标题行（34pt）+ 建议行 48pt×2 → 224 → 240。
const BUBBLE_H = 240;
const TAIL_H = 9;   // 小尾巴向下延伸高度（刻意做小）
const R = 16;       // 气泡圆角
const TAIL_W = 16;  // 尾巴底边宽
const STROKE = 1; // 描边粗细（用户选「渐变减到 1px」，消掉四角偏重）
// ★ v1012a · 玻璃磨砂气泡：半透明白底 + 中性淡描边 + 柔和投影，取代原四色彩虹描边。
//   白底上真正的 blur 无意义（背景即纯白），玻璃感靠「半透明 + 细描边 + 投影」立住。
// ★ 2026-10-15（V4）：改暮色深玻璃后白底常量（GLASS_FILL）已无人使用，移除；
//   现行色系统一走文件头 DARK_GLASS / GLASS_BORDER_DARK / TAIL_FILL_DARK。
// 轮询兜底：每 30s 检查一次半小时槽位是否已跨过（正常由「圆环状态点刷新」即时触发，见下方 effect）
const REFRESH_MS = 30 * 1000;
// 「已留作你的专属建议」停留时长：到点自动收回常态占位（用户：之后建议就没了，回到那句话）
const CONFIRM_MS = 2400;

// 常态占位：与建议卡里的反馈问句同一句（用户定稿口径；十改后已活泼化为 Mira 声线）
const IDLE_TEXT = HABIT_QUESTION;
// ★ 十改：录音态也改成 Mira 的口气（原「正在聆听…」是机器播报腔）
const LISTEN_TEXT = '我在听呢，你慢慢说～';

type BubbleMode = 'idle' | 'rec' | 'spoke' | 'sugg' | 'fb';

/** CTA screen → 中文短名（回访卡标题用：「刚呼吸完，有没有帮到你呀？」） */
const CTA_NAME: Record<string, string> = {
  Breathing: '呼吸',
  ToolTopic: '读科普',
  LearnRead: '读科普',
  FoodScan: '记饮食',
};

function WaveBars({ active }: { active?: boolean }) {
  const v0 = useRef(new Animated.Value(0.35)).current;
  const v1 = useRef(new Animated.Value(0.35)).current;
  const v2 = useRef(new Animated.Value(0.35)).current;
  const v3 = useRef(new Animated.Value(0.35)).current;
  const bars = [v0, v1, v2, v3];
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const loops = bars.map((v, i) => {
      const d = (active ? 260 : 360) + i * 80;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: d, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: d, useNativeDriver: true }),
        ]),
      );
    });
    loops.forEach((a) => a.start());
    return () => loops.forEach((a) => a.stop());
  }, [active, reducedMotion]); // eslint-disable-line

  return (
    <View style={styles.waveRow}>
      {bars.map((v, i) => (
        <Animated.View key={i} style={[styles.waveBar, { transform: [{ scaleY: v }] }]} />
      ))}
    </View>
  );
}

// ★ 2026-10-15（V4）：玻璃卡标题行（参考图 Trip to Hawaii 同款）—— Mira 紫脸头像 + 标题 + 依据小字 + ♡ 角标。
const BubbleTitleRow = memo(function BubbleTitleRow({ subtitle }: { subtitle?: string }) {
  return (
    <View style={styles.gHead}>
      <View style={styles.gHeadAva}>
        <Text style={styles.gHeadAvaText}>✦</Text>
      </View>
      <View style={styles.gHeadTt}>
        <Text style={styles.gHeadT1}>Mira 的今日观察</Text>
        {subtitle ? (
          <Text style={styles.gHeadT2} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.gHeadMark}>
        <Icon name="heart" size={13} color={TXT_ON_GLASS} />
      </View>
    </View>
  );
});

// ★ 性能隔离：常驻气泡的 idle/rec/spoke 文案**自己订阅**语音直播态，
//   父组件 HomeAiBubble 不再订阅 liveText —— 否则录音时每 250ms 一次转写推进
//   会让整块气泡（含 SVG 路径 / 左图 / 按钮）全量重渲染，叠加 ASR 推理直接卡成幻灯片。
const BubbleIdleContent = memo(function BubbleIdleContent({ height, analysis }: { height?: number; analysis?: string }) {
  const { visible, inlineMode, liveText, spokenText } = useVoiceTriggerLive();
  const listening = visible && inlineMode;
  const title = listening ? liveText.trim() || LISTEN_TEXT : IDLE_TEXT;
  const spoke = !listening && !!spokenText.trim();
  const displayText = listening ? title : spoke ? spokenText : IDLE_TEXT;
  const showHint = !listening && !spoke;
  // ★ 2026-10-14：idle 文案容器补 height（与建议卡一致）→ 文字在气泡内垂直居中。
  // ★ 方案B（2026-10-14）：圆环下方原分析两行（analysis）移入气泡顶部。
  // ★ V4（2026-10-15）：标题行置顶（参考图结构），分析次之，占位文案与声波收尾。
  return (
    <View style={[styles.content, height ? { height } : null]}>
      <BubbleTitleRow />
      {analysis ? (
        <Text style={styles.analysisText} numberOfLines={3}>{analysis}</Text>
      ) : null}
      <View style={styles.idleRow}>
        <View style={styles.textCol}>
          {showHint ? (
            <>
              <Text numberOfLines={2} style={styles.titleText}>{IDLE_TEXT}</Text>
              <Text style={styles.idleHint} numberOfLines={1}>
                长按右下角的 AI 图标，就能直接语音跟我聊
              </Text>
            </>
          ) : (
            <Text
              numberOfLines={2}
              style={[styles.titleText, (listening || spoke) && styles.titleRecording]}
            >
              {displayText}
            </Text>
          )}
        </View>
        {!spoke ? <WaveBars active={listening} /> : null}
      </View>
    </View>
  );
});

// ★ 2026-10-14：首页常驻气泡的「录音中」浮层（与 idle 文案隔离，避免每 250ms 转写推进重渲染整块气泡）。
//   关键修复：首页**正在显示建议卡**(hasCard) 时，长按右下 GROK 触发的就地录音（inlineMode）
//   原本被建议卡盖住、且浮层在首页被刻意抑制 → 用户「长按没反应、语音输入没在了」。
//   现在录音态在此独立叶子渲染并覆盖在气泡之上，保证**任何状态**下长按都能看到「正在聆听…」。
const VoiceListeningView = memo(function VoiceListeningView() {
  const { visible, inlineMode, liveText } = useVoiceTriggerLive();
  if (!(visible && inlineMode)) return null;
  const text = (liveText || '').trim();
  return (
    <View style={styles.listeningOverlay} pointerEvents="none">
      <View style={styles.textCol}>
        <Text style={styles.listeningText} numberOfLines={2}>
          {text || LISTEN_TEXT}
        </Text>
      </View>
      <WaveBars active />
    </View>
  );
});

// ★ 2026-10-14：按用户要求**移除打字机**——直接用「滑出卡片」入场动画显示完整文字，
//   不再逐字推进（避免任何情况下观感卡顿）。入场见下方 enterAnim（右下展开 + 淡入）。

export default function HomeAiBubble({ navigation, status, width, height = BUBBLE_H, analysis }: { navigation?: any; status?: any; width: number; height?: number; analysis?: string }) {
  const w = width;
  const bubbleHeight = Math.min(BUBBLE_H, Math.max(76, height));
  const [savingHabit, setSavingHabit] = useState(false);
  const savingHabitRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // ★ 性能：父组件只拿「稳定 API」（clearSpoken 等），不再订阅 liveText ——
  //   否则录音时每 250ms 转写推进会让整块气泡全量重渲染。idle/rec/spoke 文案已抽到
  //   BubbleIdleContent 叶子组件自行订阅（见上方）。
  const { clearSpoken } = useVoiceTriggerApi();

  // 今日建议（每 30 分钟一条；基于今日状态生成；停留首页时靠轮询刷新）
  const [cand, setCand] = useState<SuggestionCandidate | null>(null);
  // ★ 2026-10-15：第二条建议（用户「下面 1~2 个建议」）——引擎候选池里再取一条不同 id 的，
  //   只作展示、不改换卡铁律（非 force 主流程不变；这里用一次性 force 取，取完即弃副作用可接受：
  //   markShown 只影响「同签名非 force 返回 null → 保留当前卡」，正是我们要的行为）。
  const [cand2, setCand2] = useState<SuggestionCandidate | null>(null);
  const [kept, setKept] = useState(false);
  // ★ 十改：确认/收起两句也换成 Mira 的口气（原「已留作你的专属建议 / 先不打扰你了」偏公文腔）
  const [keptMsg, setKeptMsg] = useState('已收进你的专属建议啦');
  // ★ 十三改：回访卡（fb）—— 用户点 CTA 去做（呼吸/读科普/记饮食）后返回首页时弹出，
  //   问「有没有帮到你」：有用（心）→ 存进工具页「我的建议」；不感兴趣 → 换一条新建议。
  const [fb, setFb] = useState<SuggestionCandidate | null>(null);
  const pendingCtaRef = useRef<SuggestionCandidate | null>(null);
  const shownIdRef = useRef<string | null>(null);
  const statusRef = useRef<any>(status);
  statusRef.current = status;
  // AI 生成期间用户可能点开回访卡/做别的 —— 换卡前用 ref 快照把关（state 的同步镜像）
  const fbRef = useRef<SuggestionCandidate | null>(null);
  fbRef.current = fb;
  const candRef = useRef<SuggestionCandidate | null>(null);
  candRef.current = cand;
  /** 当前显示的卡属于哪个状态签名：**签名没变就绝不自动换卡**（十六改铁律） */
  const shownSigRef = useRef<string | null>(null);
  /** 正在等 AI 的签名：30s 轮询在这里空转，防重复发起 */
  const pendingSigRef = useRef<string | null>(null);
  /** 刚被「不感兴趣」否掉的建议（id + 原文）：force 重取/AI 重生成时避开同一条（一次性） */
  const lastDismissedRef = useRef<{ id: string; headline?: string } | null>(null);

  /** 统一上卡：id 没变不重设（避免无谓重渲染），并记下这张卡属于哪个签名 */
  const applyCand = (c: SuggestionCandidate | null, sig?: string) => {
    if (savingHabitRef.current || !c || c.id === shownIdRef.current) return;
    setSaveError('');
    shownIdRef.current = c.id;
    shownSigRef.current = sig ?? sigOf(statusRef.current);
    setCand(c);
    setCand2(null); // 换主卡 → 第二条先清空，由 fetchSecond 异步补
    setKept(false);
  };

  /** 第二条建议：引擎候选池里再取一条（避开主卡 id）；主卡已换/被否 → 丢弃结果 */
  const fetchSecond = (cs: any, primaryId: string) => {
    pickSuggestion(cs, { force: true })
      .then((s) => {
        if (!s || s.id === primaryId || s.saveId === primaryId) { setCand2(null); return; }
        // 主卡已被换掉（用户操作/状态跨档）→ 第二条不硬上屏
        if (fbRef.current || candRef.current?.id !== primaryId) { setCand2(null); return; }
        setCand2(s);
      })
      .catch(() => { setCand2(null); });
  };

  /**
   * ★ 十六改换卡铁律（用户定稿）：**已经显示的卡绝不被自动换掉** ——
   *   用户「引擎给 A、AI 连上之后突然换成 B，不可以；用户正准备点呢」。
   *   流程反转 =「先等 AI，没有 → 引擎」：
   *  · force（用户点了「不感兴趣」）：引擎**立即**换新（用户操作必须即时），
   *    同时 AI 后台重生成 —— 结果只进缓存，不上屏；
   *  · 非 force（进首页 / 30s 轮询 / 圆环状态更新）：先等 AI（≤60s，用户「31 分给出来问题不大」），
   *    等待期间保留旧卡或 idle 占位；
   *    AI 到货 → 只在「当前无卡」或「显示的卡属于旧签名（状态跨档的合法换卡）」时上卡；
   *    同签名下 AI 迟到 → 只进缓存，绝不顶掉已显示的引擎卡；
   *    AI 失败/超时 → 引擎兜底上卡，卡片永不空。
   */
  const refresh = useCallback((force = false) => {
    const cs = statusRef.current;
    const sig = sigOf(cs);

    if (force) {
      pendingSigRef.current = null;
      const avoid = lastDismissedRef.current;
      lastDismissedRef.current = null;
      pickSuggestion(cs, { force: true })
        .then((e) => {
          if (fbRef.current) return;
          if (e) { applyCand(e, sig); fetchSecond(cs, e.id); }
          else setCand(null); // 池子空 → idle（AI 若稍后生成成功，下一轮轮询会补上）
        })
        .catch(() => {});
      requestAiSuggestion(cs, { force: true, avoidId: avoid?.id, avoidHeadline: avoid?.headline }).catch(() => {});
      return;
    }

    // ① 同签名 AI 卡在缓存 → 上卡（仅当当前无卡，或显示的卡属于旧签名）
    const cached = aiCandidateFor(cs);
    if (cached) {
      if (!candRef.current || shownSigRef.current !== sig) applyCand(cached, sig);
      return;
    }
    // ② 这个签名已在等 AI → 空转
    if (pendingSigRef.current === sig) return;
    pendingSigRef.current = sig;

    // ③ 先等 AI；失败/超时 → 引擎兜底
    requestAiSuggestion(cs)
      .then((c) => {
        if (pendingSigRef.current === sig) pendingSigRef.current = null;
        if (sigOf(statusRef.current) !== sig || fbRef.current) return;
        if (!c) {
          if (candRef.current) return; // 已有卡在显示（AI 极迟到/用户已操作）→ 不动
          pickSuggestion(statusRef.current)
            .then((e) => {
              if (fbRef.current || candRef.current) return;
              if (e) { applyCand(e, sig); fetchSecond(statusRef.current, e.id); }
              else setCand(null);
            })
            .catch(() => {});
          return;
        }
        // AI 到货：仅「无卡（idle）」或「旧签名的卡（跨档合法换卡）」可上；同签名绝不顶卡
        if (!candRef.current || shownSigRef.current !== sig) applyCand(c, sig);
      })
      .catch(() => {
        if (pendingSigRef.current === sig) pendingSigRef.current = null;
      });
  }, []);

  // 「已留作你的专属建议」的自动收回计时器
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  useEffect(() => clearHideTimer, []);

  // 进入首页立即取一次 + 每 30s 兜底轮询
  // ★ 离开首页（blur，如跳转 AI 页）时清空残留的录音转写 → 返回后气泡回到占位文案，
  //   不再显示上一次的语音结果（用户 2026-10-08 反馈）。
  // ★ 十三改：从 CTA 工具页（呼吸/读科普/记饮食）返回首页时，弹出「有没有帮到你」回访卡。
  useFocusEffect(
    useCallback(() => {
      refresh();
      if (pendingCtaRef.current) {
        setFb(pendingCtaRef.current);
        pendingCtaRef.current = null;
      }
      return () => {
        clearSpoken();
      };
    }, [refresh, clearSpoken]),
  );
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // ★ 跟随圆环状态点：圆环在 :00/:30 落一个状态点（curveStatus.lastPointAt 变化）时，
  //   立即重取建议 —— 于是「更新于 16:30」出现的那一刻，建议也同步换成新的那条。
  const lastPointAt = status?.lastPointAt ?? null;
  useEffect(() => {
    if (lastPointAt) refresh();
  }, [lastPointAt, refresh]);

  /**
   * 反馈确认：就地显示一行确认文案（msg），CONFIRM_MS 后自动收回常态占位。
   *  · 点「有用」（心）→ msg = 「已收进你的专属建议啦」→ 工具页「我的建议」里能看到；
   *  · 「不感兴趣」不再走这里（十三改：点了就 force 换一条新建议，见 onDismiss）。
   * 收回后气泡回到 idle 占位。
   */
  const confirmThenReset = (c: SuggestionCandidate, msg: string) => {
    clearHideTimer();
    setKeptMsg(msg);
    setKept(true);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setKept(false);
      setCand(null);      // 建议消失 → 回落到 idle 占位
      setCand2(null);     // 第二条建议一并收回
      setFb(null);        // 回访卡同样收掉
      clearSpoken();      // 同时清掉上一轮语音转写，确保显示的是占位那句话而不是残话
    }, CONFIRM_MS);
  };

  const saveSuggestion = async (candidate: SuggestionCandidate | null, persist = true) => {
    if (!candidate || savingHabitRef.current) return;
    savingHabitRef.current = true; setSavingHabit(true); setSaveError('');
    try {
      if (persist) {
        await keepHabit({
          id: candidate.saveId ?? candidate.id,
          action: candidate.action ?? '', metric: candidate.metric ?? '',
          headline: candidate.headline, cta: candidate.cta, kind: candidate.kind,
        });
      }
      if (mountedRef.current) {
        confirmThenReset(candidate, persist ? '已收进你的专属建议啦' : '收到，我会调整后面的判断');
      }
    } catch {
      if (mountedRef.current) setSaveError('没有保存成功，请点「有用」重试');
    } finally {
      savingHabitRef.current = false;
      if (mountedRef.current) setSavingHabit(false);
    }
  };
  // 观察/分析卡的认可只用于校准，不进入工具页；只有行动完成后的回访才保存为有效方法。
  const onKeep = () => {
    if (cand?.noPersist) void recordAnalysisFeedback(cand.id, 'accurate');
    void saveSuggestion(cand, !cand?.noPersist);
  };
  const onKeepFb = () => { void saveSuggestion(fb, true); };

  /**
   * ★ 十三改：不感兴趣 → **立刻换一条新建议**（force 重取；被否的进 30 天冷却不会马上回来）。
   *   池子空了（都被否/留存）→ 回落 idle 占位。不再显示「那就不打扰你啦」的收起动画。
   *   ★ 十七改：换卡逻辑统一收敛到 refresh(true)（引擎立即换新 + AI 避开刚被否那条重生成），
   *     这里只负责记下「刚被否的是哪条」——避免两套换卡代码并存、口径漂移。
   */
  const onDismiss = () => {
    if (savingHabitRef.current) return;
    setSaveError('');
    setFb(null);
    if (cand) {
      if (cand.noPersist) void recordAnalysisFeedback(cand.id, 'inaccurate');
      lastDismissedRef.current = { id: cand.saveId ?? cand.id, headline: cand.headline };
      dismissSuggestion(cand.saveId ?? cand.id).catch(() => {});
      setCand(null);
      setCand2(null);
    }
    clearSpoken();
    refresh(true);
  };
  /** 行动引导型主按钮：跳转对应工具页；★ 十三改：记住这条建议，返回首页后弹「有没有帮助」回访卡 */
  const onGoCta = () => {
    if (!cand?.cta) return;
    pendingCtaRef.current = cand;
    try {
      navigation?.navigate(cand.cta.screen, cand.cta.params);
    } catch {
      /* 导航失败静默 */
    }
    setCand(null);
    clearSpoken();
  };

  const hasCard = !!(fb || cand);

  // ★ 十二改：左图取改善工具页同款图片资产（行动型按 cta.screen 映射，观察型按关键词映射）
  const activeCard = fb ?? cand;
  // ★ 2026-10-15：建议行列表（用户「下面 1~2 个建议」）—— 回访卡只一条；否则主建议 + 第二条
  const suggestionRows: SuggestionCandidate[] = fb
    ? [fb]
    : ([cand, cand2].filter(Boolean) as SuggestionCandidate[]);

  // ★ 丝滑化：建议卡「从右下展开」入场（不动 SVG 尾巴，只动内容层）。
  //   入场用 useNativeDriver 跑原生线程，不占 JS 线程；打字机已按用户要求移除，直接显示完整文字。
  const enterAnim = useRef(new Animated.Value(0)).current;
  const reducedMotionBubble = useReducedMotion();
  const headlineText = useMemo(() => {
    if (fb) return `刚${CTA_NAME[fb?.cta?.screen ?? ''] ?? '完成'}完，有没有帮到你呀？`;
    return (cand?.headline ?? (cand?.action ? habitHeadline(cand.action) : '')) ?? '';
  }, [fb, cand]);

  // 入场：出现建议卡（hasCard）且标题变化时重放；减少动效则直接全显
  useEffect(() => {
    if (!hasCard) return;
    if (reducedMotionBubble) {
      enterAnim.setValue(1);
      return;
    }
    enterAnim.setValue(0);
    Animated.timing(enterAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [hasCard, headlineText, reducedMotionBubble, enterAnim]);

  const enterOpacity = enterAnim;
  const enterScale = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const enterShiftX = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  const enterShiftY = enterAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  const onPress = () => {
    // 有卡（建议/回访）时轻点不跳转，避免误触
    if (hasCard) return;
    try {
      navigation?.navigate('MiraAI');
    } catch {
      /* 无导航时静默 */
    }
  };

  // 尾巴靠右，tip 略右偏 → 指向右下角的 GROK
  const tailCx = Math.max(R + TAIL_W, w - 34);
  const b0 = tailCx - TAIL_W / 2;
  const b1 = tailCx + TAIL_W / 2;
  const tipX = tailCx + 4;
  const tipY = bubbleHeight + TAIL_H;

  const bodyPath =
    w > R * 2
      ? `M ${R} 0 H ${w - R} A ${R} ${R} 0 0 1 ${w} ${R} V ${bubbleHeight - R} A ${R} ${R} 0 0 1 ${w - R} ${bubbleHeight} H ${R} A ${R} ${R} 0 0 1 0 ${bubbleHeight - R} V ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`
      : '';

  return (
    <View style={[styles.wrap, { width: w }]}>
      <TouchableOpacity
        activeOpacity={hasCard ? 1 : 0.94}
        onPress={onPress}
        style={styles.touch}
        accessible={!hasCard}
        accessibilityRole={!hasCard ? 'button' : undefined}
        accessibilityLabel={!hasCard ? '打开 Mira AI 聊天' : undefined}
      >
        {/* 背景：卡内暮色海浪图 + 压暗渐变 + 深色拟态玻璃层（V4，用户 2026-10-15 参考图定稿） */}
        {w > 0 && (
          <ImageBackground
            source={SEA_BG}
            style={[StyleSheet.absoluteFill, { borderRadius: R }]}
            imageStyle={{ borderRadius: R }}
            resizeMode="cover"
          >
            {/* 暮色压暗：图上叠一层上浅下深渐变（只覆盖气泡本体，不含尾巴） */}
            <Svg style={StyleSheet.absoluteFill} width={w} height={bubbleHeight} viewBox={`0 0 ${w} ${bubbleHeight}`}>
              <Defs>
                <SvgLinearGradient id="bubbleSeaDim" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={SEA_DIM_TOP} />
                  <Stop offset="100%" stopColor={SEA_DIM_BOTTOM} />
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width={w} height={bubbleHeight} rx={R} ry={R} fill="url(#bubbleSeaDim)" />
            </Svg>
            {/* 深色拟态玻璃层（RN 无 backdrop-filter，用半透明深色叠层合成磨砂） */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: DARK_GLASS, borderRadius: R }]} />
          </ImageBackground>
        )}

        {/* 气泡描边 + 右下小尾巴（SVG 保证边框与尾巴同色同源；本体已由海景+玻璃层填充，path 只描边） */}
        {w > 0 && bodyPath && (
          <Svg style={StyleSheet.absoluteFill} width={w} height={bubbleHeight + TAIL_H} viewBox={`0 0 ${w} ${bubbleHeight + TAIL_H}`}>
            <Path d={bodyPath} fill="none" stroke={GLASS_BORDER_DARK} strokeWidth={STROKE} />
            <Path
              d={`M ${b0} ${bubbleHeight - 1} L ${tipX} ${tipY} L ${b1} ${bubbleHeight - 1}`}
              fill={TAIL_FILL_DARK}
              stroke={GLASS_BORDER_DARK}
              strokeWidth={STROKE}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
        )}

        {/* ===== 内容层：高度不超过原来的 84，长文案在框内限制行数 =====
            ★ 十三改：sugg（建议卡）与 fb（行动回来后的回访卡）共用同一套布局：
              左图（工具页同款资产）+ 中文案 + 右按钮竖排；✕ 整个去掉（用户：不需要）。
              按钮语言统一：主 = 胶囊绿 pill（行动型是 CTA「去呼吸›」，其余是 心+「有用」）；
              次 = 「不感兴趣」文字链接 —— 点了立刻换一条新建议（force 重取）。 */}
        {hasCard ? (
          <Animated.View style={[styles.suggContent, { height: bubbleHeight, opacity: enterOpacity, transform: [{ translateX: enterShiftX }, { translateY: enterShiftY }, { scale: enterScale }] }]}>
            {/* ★ V4（2026-10-15）：参考图标题行置顶；依据小字取当前卡的证据短语（真实数据） */}
            <BubbleTitleRow subtitle={(fb ?? cand)?.metric} />
            {analysis ? <Text style={styles.analysisText} numberOfLines={3}>{analysis}</Text> : null}
            {kept ? (
              /* ── 确认态：点了「有用」→ 只显示这一行（带心），2.4s 后自动收回 idle ── */
              <View style={styles.keptRow}>
                <Icon name="heart" size={theme.fs(15)} color={TXT_ON_GLASS} />
                <Text style={styles.keptText}>{keptMsg}</Text>
              </View>
            ) : (
              /* ── 建议行列表：主建议 + （可选）第二条建议；行间细分隔线 ── */
              suggestionRows.map((row, i) => {
                const isFb = !!fb && row.id === fb.id;
                const isSecond = !isFb && i > 0;
                const rowHeadline = isFb
                  ? `刚${CTA_NAME[row.cta?.screen ?? ''] ?? '完成'}完，有没有帮到你呀？`
                  : (row.headline ?? (row.action ? habitHeadline(row.action) : ''));
                return (
                  <View key={row.id} style={[styles.suggBody, i > 0 && styles.suggBodyGap]}>
                    <Image source={thumbFor(row)} style={styles.suggThumb} />
                    <View style={styles.suggText}>
                      <Text style={styles.suggHeadline} numberOfLines={2}>{rowHeadline}</Text>
                      {!!row.metric && (
                        <Text style={styles.suggEvidence} numberOfLines={1}>
                          {row.metric}
                        </Text>
                      )}
                      {row.kind !== 'action' && !row.metric && !saveError && (
                        <Text style={styles.suggAsk}>感觉确实不错？</Text>
                      )}
                    </View>
                    <View style={styles.suggBtnCol}>
                      {isSecond ? (
                        /* 第二条：只做轻量操作（去行动 / 有用），链接仅本席隐藏 */
                        <TouchableOpacity
                          onPress={() => {
                            if (row.cta) {
                              pendingCtaRef.current = row;
                              try { navigation?.navigate(row.cta.screen, row.cta.params); } catch { /* 静默 */ }
                            } else {
                              void saveSuggestion(row, true);
                            }
                            setCand2(null);
                          }}
                          activeOpacity={theme.press.opacity}
                          accessibilityRole="button"
                          accessibilityLabel={row.cta?.label ?? '去看看'}
                          style={styles.btnPill}
                        >
                          {row.cta ? (
                            <Text style={styles.btnPillText}>{row.cta.label ?? '去看看 ›'}</Text>
                          ) : (
                            <View style={styles.pillRow}>
                              <Icon name="heart" size={theme.fs(13)} color={mm.colors.ink} />
                              <Text style={styles.btnPillText}>有用</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      ) : isFb ? (
                        <TouchableOpacity
                          onPress={() => onKeepFb()}
                          disabled={savingHabit}
                          activeOpacity={theme.press.opacity}
                          accessibilityRole="button"
                          accessibilityLabel="有用，收进我的建议"
                          style={styles.btnPill}
                        >
                          <View style={styles.pillRow}>
                            <Icon name="heart" size={theme.fs(13)} color={mm.colors.ink} />
                            <Text style={styles.btnPillText}>{savingHabit ? '保存中…' : '有用'}</Text>
                          </View>
                        </TouchableOpacity>
                      ) : cand!.kind === 'action' ? (
                        <TouchableOpacity
                          onPress={() => onGoCta()}
                          disabled={savingHabit}
                          activeOpacity={theme.press.opacity}
                          accessibilityRole="button"
                          accessibilityLabel={cand!.cta?.label ?? '去看看'}
                          style={styles.btnPill}
                        >
                          <Text style={styles.btnPillText}>{cand!.cta?.label ?? '去看看 ›'}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => onKeep()}
                          disabled={savingHabit}
                          activeOpacity={theme.press.opacity}
                          accessibilityRole="button"
                          accessibilityLabel={cand!.noPersist ? '说得准，校准分析' : '有用，收进我的建议'}
                          style={styles.btnPill}
                        >
                          <View style={styles.pillRow}>
                            <Icon name="heart" size={theme.fs(13)} color={mm.colors.ink} />
                            <Text style={styles.btnPillText}>{savingHabit ? '保存中…' : cand!.noPersist ? '说得准' : '有用'}</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => { if (isSecond) { setCand2(null); return; } onDismiss(); }}
                        disabled={savingHabit}
                        activeOpacity={theme.press.opacity}
                        accessibilityRole="button"
                        accessibilityLabel={isFb ? '没感觉' : cand?.kind === 'action' ? '先不用' : '不太像'}
                        style={styles.btnLink}
                      >
                        <Text style={styles.btnLinkText}>{isFb ? '没感觉' : cand?.kind === 'action' ? '先不用' : '不太像'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </Animated.View>
        ) : (
          <BubbleIdleContent height={bubbleHeight} analysis={analysis} />
        )}
        {/* ★ 录音态浮层：覆盖在气泡之上，保证有建议卡时也看得见「正在聆听…」 */}
        <VoiceListeningView />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: 0,
    marginBottom: 0, // ★ 十三改：气泡整体往下贴一点，落在 Tab 栏正上方（用户「位置稍微往下一点点」）
  },
  touch: {
    width: '100%',
    position: 'relative',
    paddingBottom: TAIL_H,
    borderRadius: R,
    // ★ 2026-10-15（V4）：暮色深玻璃浮在页面上。投影已去掉——用户反馈「卡片背面还有一个灰色的」：
    //   圆角投影（y+6 / 0.22）在照片背景上看着像背后斜贴了一张灰卡。玻璃卡靠描边+玻璃层分层，不需要投影。
  },
  content: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  // ── V4 玻璃卡标题行（参考图：头像 + 标题 + 依据 + ♡ 角标） ──
  gHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  gHeadAva: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: mm.colors.purpleCore,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#7B68D8',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  gHeadAvaText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: theme.weight.semibold,
  },
  gHeadTt: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  gHeadT1: {
    fontSize: 15,
    fontWeight: theme.weight.semibold,
    color: TXT_ON_GLASS,
    lineHeight: 20,
    ...GLASS_TEXT_SHADOW,
  },
  gHeadT2: {
    fontSize: 11,
    fontWeight: theme.weight.regular,
    color: TXT_ON_GLASS_SUB,
    marginTop: 2,
    ...GLASS_TEXT_SHADOW,
  },
  gHeadMark: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  idleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: TXT_ON_GLASS,
    lineHeight: theme.fontSize.body * 1.35,
    // ★ 2026-10-15：V4 暮色深玻璃上垫深色柔光，保证压暗图上白字可读
    ...GLASS_TEXT_SHADOW,
  },
  titleRecording: {
    color: '#D9CCFF',
  },
  idleHint: {
    fontSize: theme.fontSize.micro,
    color: TXT_ON_GLASS_SUB,
    marginTop: theme.sp(1.5),
    lineHeight: theme.fs(15),
  },
  // ★ 方案B（2026-10-14）：圆环下方原分析两行移入气泡顶部，作为 Mira 的今日状态解读
  // ★ V4（2026-10-15）：深玻璃上白字 + 深色柔光投影
  analysisText: {
    fontSize: 14,
    fontWeight: theme.weight.regular,
    color: TXT_ON_GLASS,
    lineHeight: 20,
    marginBottom: 4,
    ...GLASS_TEXT_SHADOW,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 2,
  },
  waveBar: {
    width: 3,
    height: 20,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  // ★ 2026-10-14：录音态浮层（覆盖在气泡内容之上；深玻璃底与气泡同源，盖住下层的建议卡）
  listeningOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: TAIL_H,
    backgroundColor: DARK_GLASS,
    borderRadius: R,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  listeningText: {
    flex: 1,
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: TXT_ON_GLASS,
    lineHeight: theme.fontSize.body * 1.35,
    ...GLASS_TEXT_SHADOW,
  },

  // ── 建议态（就地展开的好习惯确认 / 状态建议卡） ──
  // ★ 全部收紧到固定框内：BUBBLE_H(100) − paddingVertical(8×2) = 84pt 可用高；
  //   常态（标题 1 行 + 问句 + 按钮）≈66pt；最坏（标题 2 行）≈84pt，正好不出框。
  suggContent: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    overflow: 'hidden',
    flexDirection: 'column',
    // ★ 2026-10-15：建议行 1~2 条自适应 → 内容垂直居中，一条建议时不在顶部堆叠
    justifyContent: 'center',
  },
  // 标题独占（★ 十三改：✕ 整个去掉，关闭职责由「不感兴趣」承担）
  suggAsk: {
    fontSize: 12,
    fontWeight: theme.weight.regular,
    color: TXT_ON_GLASS_SUB,
    lineHeight: 15,
    marginTop: 1,
  },
  /**
   * ★ 八改：建议标题**对齐首页正文口径** —— 与 TodayScreen.statusNarr（圆环下方那句灰字）
   *   同一套：textSub(#5F5F74) + regular。用户：「字体要和上边那些个保持一致，都是灰色」。
   *   字号取 body 级 15（statusNarr 是 16 居中大段，气泡宽度有限，取同级不取同值）。
   */
  suggHeadline: {
    // ★ 十八改：删掉残留的 flex:1 —— 它是早先「标题+✕ 同排」布局的遗产，✕ 删掉后
    //   headline 被塞进 suggText 竖排列，flex:1 让 Text 撑满列高、文字默认顶格渲染
    //   → 用户看到「文字跑到上面去了」。删掉后由 suggText 的 justifyContent:'center' 接管垂直居中。
    fontSize: 14.5,
    fontWeight: theme.weight.regular,
    color: TXT_ON_GLASS,
    lineHeight: 20,
    // ★ 2026-10-15：V4 暮色深玻璃上垫深色柔光，保证图上文字可读
    ...GLASS_TEXT_SHADOW,
  },
  /** 证据行（如「HRV 回升 8%」）：同族更小灰字，比标题再退一档 */
  suggEvidence: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.weight.regular,
    color: TXT_ON_GLASS_SUB,
    lineHeight: 15,
    marginTop: 2,
    ...GLASS_TEXT_SHADOW,
  },
  // ★ 十二改：左图 = 改善工具页同款图片资产；2026-10-10（用户：首页最下气泡卡左图稍放大）36 → 48
  suggThumb: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    flexShrink: 0,
  },
  suggBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  /** 第二条建议与第一条之间的分隔（细分隔线 + 呼吸位） */
  suggBodyGap: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
    marginTop: 6,
    paddingTop: 10,
  },
  suggText: {
    minWidth: 0,
    flex: 1,
    justifyContent: 'center',
  },
  // ★ 十二改：按钮竖排贴右 —— 主（绿 pill）在上、次（文字链接）在下
  suggBtnCol: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  // ★ 十三改：主按钮改**胶囊（椭圆）**、整体放大（用户：「去读按钮椭圆胶囊型，字大一点宽度大一点」）
  // ★ V4（2026-10-15）：深玻璃上改用浅色 pills（白 85% 底 + 深字），与暮色图对比清晰
  saveError: { fontSize: theme.fontSize.xs, color: '#FF9E94', marginTop: theme.sp(1) },
  btnPill: {
    minHeight: 32, justifyContent: 'center',
    backgroundColor: PILL_LIGHT_BG,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  btnPillText: {
    color: PILL_LIGHT_TEXT,
    fontSize: 13,
    fontWeight: theme.weight.semibold,
  },
  /** 心 + 「有用」横排（回访卡 / 发现型的主按钮） */
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  btnLink: {
    minHeight: 24, justifyContent: 'center',
    paddingVertical: 3,
  },
  btnLinkText: {
    color: TXT_ON_GLASS_FAINT,
    fontSize: 13,
    fontWeight: theme.weight.regular,
    textDecorationLine: 'underline',
  },
  keptRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  keptText: {
    fontSize: 14,          // ★ 12.5 → 14（确认态只有一行，放大更清楚）
    fontWeight: theme.weight.medium,
    color: TXT_ON_GLASS,
    ...GLASS_TEXT_SHADOW,
  },
});
