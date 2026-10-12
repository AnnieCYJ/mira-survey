/**
 * toolTips.ts —— 工具卡「每日微文案」引擎（2026-10-11，用户方案 A）
 *
 * 需求：工具卡的插画是固定的（让用户一眼认出功能），但用户希望卡片「会说话」、
 *      每天给人不同的建议感，而不是永远同一句静态描述。
 *
 * 做法（与 toolRecommend 同口径）：
 *   · 主线按「周期阶段」给建议（经期/卵泡期/排卵期/黄体期）——这是 Mira 的核心逻辑，最有意义；
 *   · 同一阶段内用「日期 hash」在 2 条候选里轮换 → 即便阶段不变，相邻两天也不重样（每天不一样）；
 *   · 阶段未记录时退回中性候选（同样按日轮换），不编造周期信息；
 *   · 文案对齐 Mira 声线：短、暖、先接住感受再给一句可执行的 nudging，不诊断、不制造焦虑。
 *
 * 用法：getToolDailyTip(key, ctx) 返回 ≤2 行的短句；getToolPhaseLine(ctx) 返回可选的「阶段·周期第 N 天」。
 */
import type { ToolCtx } from './toolRecommend';

// 与 buildToolCtx 产出的 phase 取值对齐
type PhaseKey = '经期' | '卵泡期' | '排卵期' | '黄体期' | 'default';

function phaseBucket(phase: string): PhaseKey {
  if (phase === '经期' || phase === '卵泡期' || phase === '排卵期' || phase === '黄体期') return phase;
  return 'default';
}

/** 每张工具的每日文案池：按阶段分桶，每桶 2 条（相邻日轮换） */
const TIP_POOL: Record<string, Record<PhaseKey, string[]>> = {
  情绪调节: {
    经期: ['经期激素起浪，情绪也跟着晃——十分钟先松开它。', '身体在过经期，脾气容易炸，今天多给自己一点耐心。'],
    卵泡期: ['这周状态往上走，趁情绪轻快把难事处理了。', '卵泡期能量在涨，给心情也排一个松档。'],
    排卵期: ['能量在高位，今天状态轻快——把堵心事聊开。', '排卵期情绪亮，适合把攒的事一口气清掉。'],
    黄体期: ['黄体期容易闷，今天多留点喘息给自己。', '经前这几天情绪本就敏感，先照顾好自己。'],
    default: ['今天花十分钟，把紧绷的情绪松下来。', '心里有点堵？先缓一缓，再回来扛事。'],
  },
  提升颜值: {
    经期: ['经期气色容易垮，今天多睡半小时比精华管用。', '经期皮肤在低位，少折腾、多补水就对了。'],
    卵泡期: ['雌激素走高、供血好，这周是上妆最服帖的窗口。', '卵泡期气色在爬坡，护肤做加法最划算。'],
    排卵期: ['排卵期气色最亮，重要场合往这几天排。', '皮肤今天在发光，出门前简单打底就够。'],
    黄体期: ['黄体期出油变多，护肤品今天做减法。', '经前皮肤爱闹，清爽为主、别叠太多层。'],
    default: ['睡好是气色第一课，今晚同一时间上床。', '今天少一杯奶茶，多一份好气色。'],
  },
  营养搭配: {
    经期: ['经期铁流失快，这餐把红肉或深绿叶菜安排上。', '经期补铁正当时，拍一餐看看搭配。'],
    卵泡期: ['这周代谢轻快，多吃点蛋白也不怕。', '卵泡期胃口稳，趁机把饮食节奏调好。'],
    排卵期: ['排卵期血糖波动大，复合碳水别断。', '今天能量高，正适合拍一餐记录好搭配。'],
    黄体期: ['黄体期馋得快，复合碳水+蛋白稳住它。', '经前容易嘴馋，拍一餐看清楚再吃。'],
    default: ['饭点前后记一餐最准，拍一张看比例。', '不用算卡路里，拍一餐看看搭配就够。'],
  },
  运动建议: {
    经期: ['经期不冲强度，慢走十五分钟把身体带活。', '经期练轻一点，拉伸和慢走刚刚好。'],
    卵泡期: ['卵泡期恢复快，可以上点强度了。', '这周身体在回升，训练加量正合适。'],
    排卵期: ['排卵期状态顶，今天可以冲一组新目标。', '能量在峰值，把最难的训练放今天。'],
    黄体期: ['黄体期恢复慢，换拉伸慢走、练轻是攒劲。', '经前减载不是退步，今天慢走就好。'],
    default: ['今天还没动？快走十五分钟把状态唤醒。', '挑还有精力的时候，快走一圈就够。'],
  },
  稳定睡眠: {
    经期: ['经期睡不沉，今晚提前半小时关灯。', '经期身体累，睡前呼吸帮你沉下来。'],
    卵泡期: ['这周睡眠在恢复期，抓住节奏早点睡。', '卵泡期睡得稳，今晚别熬断它。'],
    排卵期: ['排卵期精力旺，更要把睡前仪式守住。', '今天状态好，别让熬夜偷走明天的劲。'],
    黄体期: ['黄体期体温高、入睡难，睡前呼吸刚好对症。', '经前睡眠容易差，今晚提前放松。'],
    default: ['睡好，恢复更快，状态更稳。', '关灯前几轮呼吸，给身体一个该睡的信号。'],
  },
  知识科普: {
    经期: ['经期为什么这么累？今天读一篇就懂。', '想读懂身体的经期信号，从这页开始。'],
    卵泡期: ['雌激素这周在涨，聊聊它对情绪的影响。', '卵泡期脑子好使，趁机读懂身体。'],
    排卵期: ['排卵期身体在说什么？三分钟看完。', '想搞懂自己的周期曲线？今天正好。'],
    黄体期: ['经前为什么情绪起伏大？这篇说清楚了。', '黄体期波动有来路，读一篇就安心。'],
    default: ['读懂身体的每个变化，从今天一篇开始。', '每周更新，今天挑一篇读懂自己。'],
  },
};

/** 稳定打散：同一天同顺序，跨天轮换（与 toolRecommend.dayHash 同源思路，但本文件独立实现以免耦合） */
function dayHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 9973);
}

/** 返回某张工具卡的今日微文案（≤2 行短句） */
export function getToolDailyTip(key: string, ctx: ToolCtx): string {
  const pool = TIP_POOL[key];
  if (!pool) return '';
  const bucket = phaseBucket(ctx.phase);
  const arr = pool[bucket] ?? pool.default;
  const idx = dayHash(ctx.now + '|' + key) % arr.length;
  return arr[idx];
}

/** 千分位分组（不依赖 Intl，Hermes 各版本行为一致）：6240 → "6,240" */
function group(n: number): string {
  const s = `${Math.abs(n)}`;
  return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * ★ 2026-10-12（用户：卡面上要写「你最近是什么时期，然后情绪是怎么样的」）——
 * 返回该工具当下最相关的**真实状态短句**（一律取 ToolCtx 的实际值，不编造、不放大）。
 * 没有可用数据时返回空串，由调用方显示「—」（空态铁律：数字位不消失）。
 */
export function getToolStateLine(key: string, ctx: ToolCtx): string {
  // ⚠️ statusValue 是浮点（如 76.69），上卡必须取整 —— 曾直接拼进文案显示成「今日状态 76.69」
  const status = ctx.statusValue != null ? Math.round(ctx.statusValue) : null;
  const steps = group(Math.round(ctx.steps));          // 6240 → 6,240
  const events = Math.round(ctx.stressEventsToday);
  switch (key) {
    case '情绪调节':
      return events > 0 ? `今日情绪波动 ${events} 次` : '今天情绪很平稳';
    case '提升颜值':
    case '稳定睡眠':
      return ctx.sleepScore != null
        ? `${ctx.sleepIsStale ? '最近一晚' : '昨晚'}睡眠 ${Math.round(ctx.sleepScore)}`
        : '';
    case '运动建议':
      return ctx.steps > 0 ? `今日 ${steps} 步` : '今天还没怎么动';
    case '营养搭配':
    case '知识科普':
      return status != null ? `今日状态 ${status}` : '';
    default:
      return status != null ? `今日状态 ${status}` : '';
  }
}

/** 返回可选的阶段行（如「经期 · 周期第 12 天」）；未记录或无天数时返回空串 */
export function getToolPhaseLine(ctx: ToolCtx): string {
  if (!ctx.phase || ctx.phase === '未记录') return '';
  if (ctx.dayInCycle != null && ctx.dayInCycle > 0) {
    return `${ctx.phase} · 周期第 ${ctx.dayInCycle} 天`;
  }
  return ctx.phase;
}
