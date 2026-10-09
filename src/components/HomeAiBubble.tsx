/**
 * HomeAiBubble —— 首页「全天状态趋势图」正下方常驻的 AI 对话气泡。
 *
 * 四种状态（2026-10-08 用户定稿）：
 *  · 常态(idle)：一句话「可以和我聊聊你的感受吗？」（= HABIT_QUESTION），
 *    右侧 4 根波形轻声跳动。**没有建议时展示的就是这一句**。
 *    ★ 八改后这句**只属于 idle** —— 有具体建议时不再补这句话（已给出建议就不必再问）。
 *  · 录音态(rec)：长按右下角 GROK 时**不弹浮层**，实时转写显示在气泡里（紫字 + 跳动波形）=「正在听你说」；
 *    松手即带转写跳转 VoiceChat，**不再回退到占位文案**（见 spokenText）。
 *  · 已说(spoke)：松手跳转后 / 从 VoiceChat 返回首页时，气泡显示**刚才那句转写**（紫字），
 *    而不再重复问「可以和我聊聊你的状态吗？」，避免占位闪现。
 *  · 建议态(sugg)：suggestionEngine **跟随圆环状态点**（墙钟 :00/:30，与「更新于 16:30」同一节拍）
 *    按今日状态给一条建议/反馈（基于 curveStatus.level 中文四档 / 相位），
 *    气泡就地展开为一张建议卡（主句 + 可选证据行 + 留下/没啥感觉，★ 八改后**不再**带反馈问句），
 *    **不另弹浮卡**。
 *
 * ★ 固定尺寸（2026-10-08）：气泡高度恒为 BUBBLE_H，不论 idle / sugg 都不变；
 *   建议态内容（标题最多 1 行、证据 1 行、按钮紧凑）被约束在固定框内（overflow hidden），
 *   所以出现建议时**整框大小不再变化**。
 *   ★ 2026-10-08 二改：BUBBLE_H 136 → 120（用户「对话框太大了」），配合 TodayScreen 底部预留加大，
 *     整框（含 9pt 小尾巴）稳定落在底部 Tab 栏**上方**。
 *   ★ 2026-10-08 三改（本轮回合）：
 *     ① BUBBLE_H 120 → 100（用户「高度再小一点」）——同时这也让第一屏不再溢出视口，
 *        TodayScreen 的 BUBBLE_RESERVE 预留才真正生效（气泡不再贴住/被 Tab 压住）；
 *     ② 建议卡**去掉左上角的圆圈**（用户：「不用展示那个圆圈，浪费距离」）→ 标题独占整行、字号放大；
 *     ③ 两个反馈按钮改**统一样式：白底 + 黄绿(brand green)外环**（不再一个紫底填充、一个透明描边）；
 *     ④ 点任意按钮 → 就地显示「已留作你的专属建议」→ 2.4s 后**自动收回**，
 *        回到常态占位文案「可以和我聊聊你的感受吗？」（建议随之消失）。
 *
 * ★ 2026-10-08 八改（本轮回合，用户附图反馈）：
 *   ① 建议文字**口径对齐首页正文**：气泡内那句话改用与圆环下方灰字（TodayScreen.statusNarr）
 *      同一套字体 —— textSub(#5F5F74) + regular，不再用浓黑 semibold；证据行同族更小字。
 *   ② **有具体建议时不再补一句「可以和我聊聊你的感受吗？」**（用户：「这已经给出具体的建议了」
 *      → 该问句只属于 idle 占位态，建议态删掉 question 行）。
 *   ③ 反馈按钮改**选中态**：选中 = 黄绿框（limeMid），未选中 = 黑框（textInk）；
 *      默认「留下建议 / 去看看」为主选（绿框），点另一个立即换绿再执行动作（180ms 让选中可见）。
 *      ★ 十改已把「未选中 = 黑框」改掉（用户：外圈太重）——见下。
 *
 * ★ 2026-10-08 十改（本轮回合，用户附图反馈）：
 *   ① 建议语言**活泼化 + 对齐 App 内 AI 声线**（character.ts 的 ENFP 闺蜜：短句、有活力、
 *      语气词「呀/哦/哎/啦」、先接住感受再给建议）—— 改了三处文案源：
 *      · habitSuggestions.habitHeadline / HABIT_QUESTION（气泡 idle 占位 = 同一句）
 *      · suggestionEngine 的 TIPS（状态建议四档）+ 三条行动引导型主句
 *      · 本文件 LISTEN_TEXT（「正在聆听…」→「我在听呢，你慢慢说～」）与确认/收起两句
 *   ② 反馈按钮两态**对齐洞察页 Tab 的选中语言**（昼夜节律 / 生理周期节律那两个）：
 *      未选中 = 极淡描边（cardBorder）+ 透明底 + 灰字（inkSoft）；
 *      选中  = 黄绿描边（limeMid）+ 浅黄绿填充（limeSoft）+ 深墨字（ink）+ semibold。
 *      描边 1.5 → 1，去掉「外圈太重」的观感。
 *
 * ★ 2026-10-08 十一改（本轮回合，用户从 A/B/C 三版设计稿中选 A + C 按钮）：
 *   ① 建议卡改**布局 A**：左图标（工具页同款 Icon：Breathing→breath / ToolTopic→learn / FoodScan→food，
 *      观察型默认 sparkle，浅黄绿底 34×34 圆角块）+ 右文案（标题 + 证据行）。
 *   ② 按钮改 **C 款**：主动作 = 绿底 pill（limeMid + ink 半粗）在右；次动作 = 安静下划线文字链接在左。
 *      行动型主按钮=CTA（去呼吸›），观察型主按钮=留下建议。删除两按钮「选中/未选中」框（C 款无歧义）。
 *   ③ 外框渐变描边 1.8 → **1px**（用户选「渐变减到 1px」，消掉四角偏重 —— 根因是对角渐变四角落在不同色标）。
 *   整体高度仍锁定 BUBBLE_H(100)，字号 14.5/20 + 证据 11.5/15 + pill 高约 22，2 行标题也不出框。
 *
 * ★ 2026-10-08 十二改（用户对十一改的追加反馈）：
 *   ① 左图标放大并**换成改善工具页同款图片资产**（不再用线框 Icon）：46×46 圆角图，
 *      映射 = MeditationScreen.TOOL_IMAGES 同源 —— Breathing→card_meditation.jpg（呼吸冥想）/
 *      ToolTopic→card_learn.png（知识科普）/ FoodScan→card_food.jpg（营养搭配）；
 *      观察型按 action/headline 关键词（呼吸冥想睡→meditation、散步运动→activity、吃喝餐→food、
 *      科普读知识→learn），兜底 card_emotion.jpg。
 *   ② 按钮改**右侧竖排**：主动作（绿 pill）在上、次动作（下划线文字链接）在下 —— B 位 + C 款式。
 *   ③ BUBBLE_H 100 → **92**（用户「整个卡片高度再缩一点点」）。高度预算：76 可用 vs 内容最高 57，富余。
 *
 * ★ 2026-10-08 十三改（用户定稿的完整交互闭环）：
 *   ① **✕ 整个去掉**（用户：「其实并不需要这个叉号」）——关闭职责由「不感兴趣」承担。
 *   ② 按钮语言统一：主 = **胶囊绿 pill**（行动型 = CTA「去呼吸›」直跳工具页；其余 = 心 +「有用」）；
 *      次 = 「**不感兴趣**」文字链接 —— 点了**立刻 force 换一条新建议**（被否的进 30 天冷却），
 *      不再显示「那就不打扰你啦」的收起动画。
 *   ③ 新增**回访卡（fb 态）**：点 CTA 去做 → 返回首页时弹「刚呼吸完，有没有帮到你呀？」，
 *      心+「有用」→ keepHabit 存进工具页「我的建议」；「不感兴趣」→ 换一条。
 *   ④ 发现型文案：habitHeadline → 「发现「{action}」之后，你的状态有变好哦」+ 真实 metric；
 *      非行动型卡片补一句「感觉确实不错？」小灰字。
 *   ⑤ 引擎换卡判据：半小时槽 → **状态签名**（level|phase，见 suggestionEngine）——
 *      修掉「20:00 槽位一翻、一分钟内换两张卡」的问题；气泡 marginBottom → 0（整体下贴 Tab）。
 *
 * ★ 2026-10-08 十五改（混合方案落地，用户定稿「默认 AI 生成，断网/太慢用引擎兜底」）：
 *   取建议改三层：① 同状态签名已有 AI 卡（内存/磁盘缓存）→ 直接用；
 *   ② 引擎候选**立即**上卡（永不空屏）；③ 无缓存才后台调端侧模型（aiSuggestion.ts，
 *   runOnModel 串行队列 + 签名去重 key），到货校验「签名没变 + 不在回访卡」→ 无缝换上。
 *   AI 的 metric 只许原样引用真实证据短语（evidenceBits 白名单校验）、CTA 只许三工具页白名单。
 *   「不感兴趣」→ force 同时触发引擎换新 + AI 重生成（避开刚被否那条）。
 *
 * · 四色渐变描边（紫→粉→黄绿→黄）+ 白底；彩色只落在边框与波形上。
 * · 左侧不放 Bot 头像（用户要求去掉「左边的表情」）。
 * · 底部靠右一个「对话气泡小尾巴」——小而浅，只描两条斜边，自然指向右下角的 GROK。
 * · 轻点常态/已说气泡 → 进入 MiraAI 对话首页；录音态/建议态轻点不跳转。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Defs, LinearGradient as SvgLinear, Stop } from 'react-native-svg';
import { theme } from '../theme/theme';
import { mm } from '../theme/mindmate';
import { useVoiceTrigger } from '../hooks/useVoiceTrigger';
import { pickSuggestion, type SuggestionCandidate } from '../lib/suggestionEngine';
import { requestAiSuggestion, aiCandidateFor, sigOf } from '../lib/aiSuggestion';
import { keepHabit, dismissSuggestion, habitHeadline, HABIT_QUESTION } from '../data/habitSuggestions';
import Icon from './Icon';

// ★ 固定气泡高度：idle / sugg 共用，大小从此不变（2026-10-08）。
//   2026-10-08 二改：136 → 120（用户「对话框太大了」偏大反馈）。
//   2026-10-08 三改：120 → 100（用户「高度再小一点」；同时让第一屏不再溢出视口，预留才生效）。
/** ★ 十二改：左图直接用**改善工具页同一套图片资产**（MeditationScreen.TOOL_IMAGES 同源）：
 *  行动型按 cta.screen 映射（呼吸冥想→稳定睡眠图 / 读科普→知识科普图 / 记饮食→营养搭配图）；
 *  观察型（习惯确认）按 action/headline 关键词映射，兜底「情绪调节」图。 */
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

function thumbFor(c: SuggestionCandidate): number {
  if (c.cta && TOOL_THUMB[c.cta.screen]) return TOOL_THUMB[c.cta.screen];
  const s = `${c.action ?? ''}${c.headline ?? ''}`;
  if (/呼吸|冥想|睡/.test(s)) return THUMB_MED;
  if (/散步|运动|走|活动/.test(s)) return THUMB_ACT;
  if (/吃|饮食|餐|营养/.test(s)) return THUMB_FOOD;
  if (/科普|读|知识|激素/.test(s)) return THUMB_LEARN;
  return THUMB_DEFAULT;
}

const BUBBLE_H = 84; // ★ 十七改：92 → 84（用户「卡片下边缘被 Tab 挡上了，高度稍微小一点」——矮 8pt 让下边缘离开 Tab）
const TAIL_H = 9;   // 小尾巴向下延伸高度（刻意做小）
const R = 16;       // 气泡圆角
const TAIL_W = 16;  // 尾巴底边宽
const STROKE = 1; // 描边粗细（用户选「渐变减到 1px」，消掉四角偏重）
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

  useEffect(() => {
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
  }, [active]); // eslint-disable-line

  return (
    <View style={styles.waveRow}>
      {bars.map((v, i) => (
        <Animated.View key={i} style={[styles.waveBar, { transform: [{ scaleY: v }] }]} />
      ))}
    </View>
  );
}

export default function HomeAiBubble({ navigation, status }: { navigation?: any; status?: any }) {
  const [w, setW] = useState(0);
  const { visible, inlineMode, liveText, spokenText, clearSpoken } = useVoiceTrigger();

  const listening = visible && inlineMode;
  const title = listening ? liveText.trim() || LISTEN_TEXT : IDLE_TEXT;

  // 今日建议（每 30 分钟一条；基于今日状态生成；停留首页时靠轮询刷新）
  const [cand, setCand] = useState<SuggestionCandidate | null>(null);
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
    if (!c || c.id === shownIdRef.current) return;
    shownIdRef.current = c.id;
    shownSigRef.current = sig ?? sigOf(statusRef.current);
    setCand(c);
    setKept(false);
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
          if (e) applyCand(e, sig);
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
              if (e) applyCand(e, sig);
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
      setFb(null);        // 回访卡同样收掉
      clearSpoken();      // 同时清掉上一轮语音转写，确保显示的是占位那句话而不是残话
    }, CONFIRM_MS);
  };

  /** 有用（心）→ 存进「我的建议」卡片清单（含行动/状态型原文），并就地确认 */
  const onKeep = () => {
    if (!cand) return;
    const saveId = cand.saveId ?? cand.id;
    keepHabit({
      id: saveId,
      action: cand.action ?? '',
      metric: cand.metric ?? '',
      headline: cand.headline,
      cta: cand.cta,
      kind: cand.kind,
    }).catch(() => {});
    confirmThenReset(cand, '已收进你的专属建议啦');
  };
  /** 回访卡上的「有用」（心）→ 把刚才做的那个行动存进「我的建议」 */
  const onKeepFb = () => {
    const c = fb;
    if (!c) return;
    keepHabit({
      id: c.saveId ?? c.id,
      action: c.action ?? '',
      metric: c.metric ?? '',
      headline: c.headline,
      cta: c.cta,
      kind: c.kind,
    }).catch(() => {});
    confirmThenReset(c, '已收进你的专属建议啦');
  };
  /**
   * ★ 十三改：不感兴趣 → **立刻换一条新建议**（force 重取；被否的进 30 天冷却不会马上回来）。
   *   池子空了（都被否/留存）→ 回落 idle 占位。不再显示「那就不打扰你啦」的收起动画。
   *   ★ 十七改：换卡逻辑统一收敛到 refresh(true)（引擎立即换新 + AI 避开刚被否那条重生成），
   *     这里只负责记下「刚被否的是哪条」——避免两套换卡代码并存、口径漂移。
   */
  const onDismiss = () => {
    setFb(null);
    if (cand) {
      lastDismissedRef.current = { id: cand.saveId ?? cand.id, headline: cand.headline };
      dismissSuggestion(cand.saveId ?? cand.id).catch(() => {});
      setCand(null);
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

  const spoke = !listening && !cand && !fb && !!spokenText.trim();
  const mode: BubbleMode = fb ? 'fb' : listening ? 'rec' : cand ? 'sugg' : spoke ? 'spoke' : 'idle';

  // ★ 十二改：左图取改善工具页同款图片资产（行动型按 cta.screen 映射，观察型按关键词映射）
  const activeCard = fb ?? cand;
  const thumb = activeCard ? thumbFor(activeCard) : THUMB_DEFAULT;

  const onPress = () => {
    // 录音态/建议态：轻点不跳转，避免打断识别或误触
    if (mode !== 'idle' && mode !== 'spoke') return;
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
  const tipY = BUBBLE_H + TAIL_H;

  const bodyPath =
    w > R * 2
      ? `M ${R} 0 H ${w - R} A ${R} ${R} 0 0 1 ${w} ${R} V ${BUBBLE_H - R} A ${R} ${R} 0 0 1 ${w - R} ${BUBBLE_H} H ${R} A ${R} ${R} 0 0 1 0 ${BUBBLE_H - R} V ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`
      : '';

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        activeOpacity={mode === 'idle' || mode === 'spoke' ? 0.94 : 1}
        onPress={onPress}
        style={styles.touch}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
      >
        {/* 背景：渐变描边气泡 + 右下小尾巴（SVG 保证边框与尾巴同色同源） */}
        {w > 0 && bodyPath && (
          <Svg style={StyleSheet.absoluteFill} width={w} height={BUBBLE_H + TAIL_H} viewBox={`0 0 ${w} ${BUBBLE_H + TAIL_H}`}>
            <Defs>
              <SvgLinear id="bubbleBorder" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={mm.colors.purpleCore} />
                <Stop offset="0.4" stopColor={mm.colors.roseCore} />
                <Stop offset="0.72" stopColor={mm.colors.limeMid} />
                <Stop offset="1" stopColor={mm.colors.honeyCore} />
              </SvgLinear>
            </Defs>
            <Path d={bodyPath} fill={theme.colors.cardBg} stroke="url(#bubbleBorder)" strokeWidth={STROKE} />
            <Path
              d={`M ${b0} ${BUBBLE_H - 1} L ${tipX} ${tipY} L ${b1} ${BUBBLE_H - 1}`}
              fill={theme.colors.cardBg}
              stroke="url(#bubbleBorder)"
              strokeWidth={STROKE}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
        )}

        {/* ===== 内容层（固定高度，建议态 overflow hidden 不撑高） =====
            ★ 十三改：sugg（建议卡）与 fb（行动回来后的回访卡）共用同一套布局：
              左图（工具页同款资产）+ 中文案 + 右按钮竖排；✕ 整个去掉（用户：不需要）。
              按钮语言统一：主 = 胶囊绿 pill（行动型是 CTA「去呼吸›」，其余是 心+「有用」）；
              次 = 「不感兴趣」文字链接 —— 点了立刻换一条新建议（force 重取）。 */}
        {mode === 'sugg' || mode === 'fb' ? (
          <View style={[styles.suggContent, { height: BUBBLE_H }]}>
            {kept ? (
              /* ── 确认态：点了「有用」→ 只显示这一行（带心），2.4s 后自动收回 idle ── */
              <View style={styles.keptRow}>
                <Icon name="heart" size={theme.fs(15)} color={mm.colors.limeDeep} />
                <Text style={styles.keptText}>{keptMsg}</Text>
              </View>
            ) : (
              <View style={styles.suggBody}>
                <Image source={thumb} style={styles.suggThumb} />
                <View style={styles.suggText}>
                  <Text style={styles.suggHeadline} numberOfLines={2} ellipsizeMode="tail">
                    {mode === 'fb'
                      ? `刚${CTA_NAME[fb!.cta?.screen ?? ''] ?? '完成'}完，有没有帮到你呀？`
                      : cand!.headline ?? (cand!.action ? habitHeadline(cand!.action) : '')}
                  </Text>
                  {mode === 'sugg' && !!cand!.metric && (
                    <Text style={styles.suggEvidence} numberOfLines={1} ellipsizeMode="tail">
                      {cand!.metric}
                    </Text>
                  )}
                  {/* 发现型（非行动引导）才补一句问句；行动型 CTA 本身就是问题，不再啰嗦 */}
                  {mode === 'sugg' && cand!.kind !== 'action' && (
                    <Text style={styles.suggAsk}>感觉确实不错？</Text>
                  )}
                </View>
                {/* 按钮竖排贴右：主（胶囊）在上、次「不感兴趣」在下 */}
                <View style={styles.suggBtnCol}>
                  {mode === 'fb' ? (
                    <TouchableOpacity
                      onPress={() => onKeepFb()}
                      activeOpacity={theme.press.opacity}
                      accessibilityRole="button"
                      accessibilityLabel="有用，收进我的建议"
                      style={styles.btnPill}
                    >
                      <View style={styles.pillRow}>
                        <Icon name="heart" size={theme.fs(13)} color={mm.colors.ink} />
                        <Text style={styles.btnPillText}>有用</Text>
                      </View>
                    </TouchableOpacity>
                  ) : cand!.kind === 'action' ? (
                    <TouchableOpacity
                      onPress={() => onGoCta()}
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
                      activeOpacity={theme.press.opacity}
                      accessibilityRole="button"
                      accessibilityLabel="有用，收进我的建议"
                      style={styles.btnPill}
                    >
                      <View style={styles.pillRow}>
                        <Icon name="heart" size={theme.fs(13)} color={mm.colors.ink} />
                        <Text style={styles.btnPillText}>有用</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => onDismiss()}
                    activeOpacity={theme.press.opacity}
                    accessibilityRole="button"
                    accessibilityLabel="不感兴趣，换一个建议"
                    style={styles.btnLink}
                  >
                    <Text style={styles.btnLinkText}>不感兴趣</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.content, { height: BUBBLE_H }]}>
            <View style={styles.textCol}>
              <Text
                style={[
                  styles.titleText,
                  (listening || spoke) && styles.titleRecording,
                ]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {mode === 'rec' || mode === 'idle' ? title : spokenText}
              </Text>
              {/* idle 占位下方小字提示：长按右下角 AI 图标可直接语音（用户 2026-10-08） */}
              {mode === 'idle' && (
                <Text style={styles.idleHint} numberOfLines={1} ellipsizeMode="tail">
                  长按右下角的 AI 图标，就能直接语音跟我聊
                </Text>
              )}
            </View>
            {mode === 'idle' || mode === 'rec' ? <WaveBars active={listening} /> : null}
          </View>
        )}
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
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: theme.fontSize.body,
    fontWeight: theme.weight.semibold,
    color: theme.colors.textInk,
    lineHeight: theme.fontSize.body * 1.35,
  },
  titleRecording: {
    color: mm.colors.purpleDeep,
  },
  idleHint: {
    fontSize: theme.fontSize.micro,
    color: mm.colors.inkFaint,
    marginTop: theme.sp(1.5),
    lineHeight: theme.fs(15),
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
    backgroundColor: mm.colors.purpleCore,
  },

  // ── 建议态（就地展开的好习惯确认 / 状态建议卡） ──
  // ★ 全部收紧到固定框内：BUBBLE_H(100) − paddingVertical(8×2) = 84pt 可用高；
  //   常态（标题 1 行 + 问句 + 按钮）≈66pt；最坏（标题 2 行）≈84pt，正好不出框。
  suggContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  // 标题独占（★ 十三改：✕ 整个去掉，关闭职责由「不感兴趣」承担）
  suggAsk: {
    fontSize: 12,
    fontWeight: theme.weight.regular,
    color: mm.colors.inkSoft,
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
    color: theme.colors.textSub,
    lineHeight: 20,
  },
  /** 证据行（如「HRV 回升 8%」）：同族更小灰字，比标题再退一档 */
  suggEvidence: {
    fontSize: 11.5,
    fontWeight: theme.weight.regular,
    color: mm.colors.inkFaint,
    lineHeight: 15,
    marginTop: 2,
  },
  // ★ 十二改：左图 = 改善工具页同款图片资产（46×46，比原 34 图标块明显大一号）
  suggThumb: {
    width: 46,
    height: 46,
    borderRadius: theme.radius.md,
    flexShrink: 0,
  },
  suggBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  suggText: {
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
  btnPill: {
    backgroundColor: mm.colors.limeMid,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  btnPillText: {
    color: mm.colors.ink,
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
    paddingVertical: 3,
  },
  btnLinkText: {
    color: mm.colors.inkSoft,
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
    color: theme.colors.textBody,
  },
});
