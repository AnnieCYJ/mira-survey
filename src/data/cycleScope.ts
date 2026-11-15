import { useEffect, useState } from 'react';
import { getCachedSession, onSessionChange } from './userStore';

/**
 * ★ 2026-11-14（用户：选了男性，饮食建议 / 报告里还会不会出现经期、雌激素内容）
 *
 * 统一性别闸门。此前只有 5 个 UI 组件各自写 `gender !== 'male'` 隐藏少数周期卡片，
 * 内容生成层（拍照识别营养建议、健康快照、一键体检报告、AI prompt、指标分析）
 * 完全没有 gender 分支 → 男性照样看到「经期补铁」「雌激素趋势」「她正处于黄体期」。
 *
 * 口径与既有 UI 保持一致：只有显式 gender === 'male' 才关闭；
 * undefined / 'undisclosed' 仍按女性周期产品展示（避免误伤潜在女性用户）。
 *
 * - 组件用 useShowCycle()：订阅会话变更，改性别即时生效。
 * - 纯数据层（lib / ai / data）用同步 showCycleContent()：不引入 React 依赖。
 *
 * 注意：只屏蔽「女性生理周期」相关内容；皮质醇、睡眠、压力、热量等男女通用指标保留。
 */
export function isMaleUser(): boolean {
  return getCachedSession()?.profile?.gender === 'male';
}

/** 是否应产出/展示女性生理周期相关内容（经期、排卵、黄体、雌激素、孕激素等）。 */
export function showCycleContent(): boolean {
  return !isMaleUser();
}

/** React hook 版：性别变化即时刷新。 */
export function useShowCycle(): boolean {
  const [show, setShow] = useState<boolean>(() => showCycleContent());
  useEffect(() => {
    const sync = () => setShow(showCycleContent());
    sync();
    return onSessionChange(sync);
  }, []);
  return show;
}

/** 男性用户展示用的中性阶段名。 */
export const GENERAL_PHASE_LABEL = '通用参考';

/**
 * 判断一段文案是否含「女性生理周期」语境的词（用于过滤科普、贴士、推荐池里无 gender 字段的条目）。
 *
 * ★ 2026-11-14 二次修正：上一版把裸词 `激素|荷尔蒙` 加了进来，结果误伤中性生理科普——
 *   《血糖过山车》讲「胰岛素和皮质醇波动」、《蛋白质》讲「激素的原料库」、
 *   《肠脑轴》讲「激素 + 免疫信号」，都是男女通用的代谢/生理内容，被一刀切判成周期内容，
 *   男性兜底文章池因此被清空（回归脚本报 nutrition:bloodsugar 命中「激素」）。
 *   用户要屏蔽的是**雌/孕激素、经期、周期相位**这类女性周期语境，不是所有激素。
 *   故改为只匹配带周期语义的复合词；明确的雌激素/孕激素/孕酮/雌二醇仍单列命中。
 *   文章级拦截另由 `CYCLE_ARTICLE_IDS` 按 id 精确兜底，不依赖这个正则。
 */
const CYCLE_WORDS = /经期|月经|排卵|黄体|卵泡|雌激素|孕激素|孕酮|雌二醇|经前|PMS|生理周期|周期第|周期阶段|周期相位|周期激素|性激素|激素波动|激素变化|激素节律|荷尔蒙节律|荷尔蒙波动|荷尔蒙变化|易孕期|备孕|怀孕|暖宫|补铁时机/i;
export function containsCycleCopy(text: string): boolean {
  return CYCLE_WORDS.test(text);
}

/**
 * ★ 2026-11-14（用户）：首页建议胶囊会「深链直达具体文章」，绕过文章列表的过滤，
 *   男性仍会被带到《孕激素的镇静与代价》《经期：屏障优先》这类内容。
 *   这里列出全部周期类文章 id，并在文章详情入口统一改投同库的中性文章。
 */
const CYCLE_ARTICLE_IDS = new Set([
  // 知识科普
  'levers', 'estrogen', 'progesterone', 'ring', 'hormCognition', 'hormEmotion',
  'hormMetabolism', 'hormSleep', 'hormRecovery',
  // 提升颜值
  'cycleskin', 'follicularskin', 'lutealskin', 'periodskin',
  // 运动科普
  'cycletraining', 'folliculartrain', 'lutealtrain', 'periodtrain',
  // 饮食营养
  'ironwomen', 'proteinhormone', 'cravings',
]);

/** 各文章库男性兜底用的中性文章 id（都是真实存在的通用科普）。 */
export const GENERAL_ARTICLE_ID: Record<string, string> = {
  learn: 'cortisol',
  glow: 'minimal',
  emotion: 'threeGood',
  sport: 'hrvtrain',
  nutrition: 'bloodsugar',
};

export function isCycleArticle(id?: string): boolean {
  return !!id && CYCLE_ARTICLE_IDS.has(id);
}

/** 男性深链到周期文章时改投同库中性文章；女性 / 未声明性别原样返回。 */
export function safeArticleId(id?: string, collection = 'learn'): string {
  const fallback = GENERAL_ARTICLE_ID[collection] ?? GENERAL_ARTICLE_ID.learn;
  if (!id) return fallback;
  if (!showCycleContent() && isCycleArticle(id)) return fallback;
  return id;
}
