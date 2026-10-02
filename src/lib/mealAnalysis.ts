/**
 * mealAnalysis.ts — 单餐「元素分析」与「激素影响」的映射层。
 *
 * 输入为一餐的菜品（MealItem[]，含热量与三大宏量），输出：
 *  1) analyzeElements：基于菜品名关键词，估算这餐是否富含激素相关元素
 *     （镁 / 锌 / 铁 / 钙 / 维生素 B6 / 叶酸）—— 这些是戒指信号推算的激素（皮质醇、雌激素、孕激素）
 *     代谢所需的常见辅因子。
 *  2) analyzeHormoneImpact：结合当餐宏量结构 + 当前激素推算快照，给出这餐对激素的温和影响描述
 *     与「下一餐可留意补充什么」。
 *
 * 口径铁律（与 Mira 整体一致）：
 *  · 元素与影响均为「基于菜名的估算」，非化验/配方计算，明确标注「估算」；
 *  · 只做事实性描述 + 温和建议，不评分、不诊断、不评判用户吃得对不对。
 */

import type { MealItem } from './foodAi';
import type { HormoneNutritionSnapshot } from './hormoneNutrition';

export type ElementKey = 'mg' | 'zn' | 'fe' | 'ca' | 'b6' | 'fa' | 'se';

export const ELEMENT_META: Record<ElementKey, { label: string; foods: string; unit: string }> = {
  mg: { label: '镁', foods: '深绿菜 / 坚果 / 豆 / 黑巧', unit: 'mg' },
  zn: { label: '锌', foods: '贝类 / 瘦肉 / 坚果 / 种子', unit: 'mg' },
  fe: { label: '铁', foods: '红肉 / 菠菜 / 肝 / 蛋黄', unit: 'mg' },
  ca: { label: '钙', foods: '奶 / 酸奶 / 豆腐 / 小鱼', unit: 'mg' },
  b6: { label: '维生素 B6', foods: '鸡肉 / 鱼 / 土豆 / 香蕉', unit: 'mg' },
  fa: { label: '叶酸', foods: '绿叶菜 / 豆 / 肝', unit: 'μg' },
  se: { label: '硒', foods: '巴西坚果 / 海鲜 / 鸡蛋 / 大蒜', unit: 'μg' },
};

const ELEMENT_KEYWORDS: Record<ElementKey, string[]> = {
  mg: ['坚果', '菠菜', '西兰花', '青菜', '绿叶', '豆腐', '豆', '香蕉', '黑巧', '巧克', '藜麦', '南瓜子'],
  zn: ['贝', '蚝', '海鲜', '虾', '牛肉', '瘦肉', '坚果', '种子', '南瓜子', '腰果'],
  fe: ['牛肉', '红肉', '瘦肉', '菠菜', '肝', '蛋黄', '血块', '鸭血'],
  ca: ['牛奶', '奶', '酸奶', '奶酪', '芝士', '豆腐', '小鱼', '绿叶菜', '芥蓝'],
  b6: ['鸡肉', '鸡', '鱼', '土豆', '香蕉', '坚果', '三文鱼', '金枪鱼'],
  fa: ['菠菜', '西兰花', '青菜', '绿叶', '豆', '肝', '橙子', '柑橘', '芦笋'],
  se: ['巴西坚果', '海鲜', '金枪鱼', '三文鱼', '鸡蛋', '大蒜', '蘑菇', '燕麦', '全麦'],
};

export interface ElementResult {
  key: ElementKey;
  label: string;
  present: boolean;
  /** 命中的菜品名（关键词兜底时用于展示） */
  inFoods: string[];
  /** 模型估算的该元素总含量（毫克；叶酸为微克）。仅在识别模型返回时存在。 */
  mg?: number;
  /** 数据来源：model=拍照识别模型估算；keyword=菜名关键词兜底 */
  source: 'model' | 'keyword';
}

/**
 * 估算这餐的元素构成。
 * 优先级：若任一菜品带识别模型返回的元素估算（items[].elements），则以模型总和为准；
 * 否则退回「菜名关键词」兜底。无宏量数据也能跑（只看名字）。
 */
export function analyzeElements(items: MealItem[]): ElementResult[] {
  const names = items.map((it) => it.name);
  const hasModel = items.some((it) => it.elements && Object.keys(it.elements).length > 0);
  return (Object.keys(ELEMENT_META) as ElementKey[]).map((key) => {
    const kws = ELEMENT_KEYWORDS[key];
    const inFoods = names.filter((n) => kws.some((k) => n.includes(k)));
    let modelMg = 0;
    if (hasModel) {
      for (const it of items) {
        const v = it.elements?.[key];
        if (typeof v === 'number') modelMg += v;
      }
    }
    const present = hasModel ? modelMg > 0 : inFoods.length > 0;
    const mg = hasModel && modelMg > 0 ? Math.round(modelMg) : undefined;
    return {
      key,
      label: ELEMENT_META[key].label,
      present,
      inFoods: hasModel ? [] : inFoods,
      mg,
      source: hasModel ? 'model' : 'keyword',
    };
  });
}

export interface HormoneImpactResult {
  /** 2–3 条温和的影响描述 */
  impacts: string[];
  /** 下一餐可留意的补充方向（一句话） */
  nextTip: string;
  /** 是否给出过任何与激素相关的具体建议（决定空态文案） */
  hasHint: boolean;
}

/**
 * 结合当餐宏量 + 元素 + 当前激素推算快照，给出这餐对激素的影响与下一餐建议。
 * 所有结论均为估算参考，非诊断。
 */
export function analyzeHormoneImpact(
  items: MealItem[],
  hormone: HormoneNutritionSnapshot | null,
): HormoneImpactResult {
  const macros = items.reduce(
    (a, it) => {
      a.protein += it.protein ?? 0;
      a.carbs += it.carbs ?? 0;
      a.fat += it.fat ?? 0;
      a.kcal += it.kcal ?? 0;
      return a;
    },
    { protein: 0, carbs: 0, fat: 0, kcal: 0 },
  );
  const els = analyzeElements(items);
  const present = (k: ElementKey) => els.find((e) => e.key === k)?.present ?? false;

  const impacts: string[] = [];

  // 宏量结构
  if (macros.protein >= 30) {
    impacts.push('蛋白较充足，是激素合成（尤其孕酮）所需的底物。');
  }
  if (macros.carbs >= 60 && macros.protein < 20) {
    impacts.push('以碳水为主、蛋白偏少，餐后皮质醇可能小幅波动，可搭配蛋奶豆平衡。');
  } else if (macros.carbs > 0) {
    impacts.push('碳水能提供平稳能量，温和支撑血清素，对情绪与皮质醇偏友好。');
  }

  // 元素
  if (present('mg')) {
    impacts.push('含镁，有助于放松与黄体期孕酮的支持。');
  }
  if (present('zn')) {
    impacts.push('含锌，参与雌激素代谢与免疫调节。');
  }
  if (present('fe') && hormone?.estrogen?.status === 'reference') {
    impacts.push('含铁，适合经期前后补铁。');
  }

  // 结合激素快照
  const cortisolHigh = hormone?.cortisol?.level === 'high' || hormone?.cortisol?.level === 'dysregulated';
  if (cortisolHigh) {
    impacts.push('今天皮质醇偏高，下一餐少咖啡因与高糖、多选含镁食物更稳。');
  }
  if (hormone?.progesterone?.status === 'insufficient') {
    impacts.push('孕激素偏弱时，镁与 B6 对它的支持更值得留意。');
  }

  // 下一餐建议：优先补「当餐缺失且激素相关」的元素
  let nextTip = '';
  if (!present('zn')) nextTip = '下一餐可补锌：贝类 / 瘦肉 / 坚果。';
  else if (!present('mg')) nextTip = '下一餐可留意镁：深绿菜 / 坚果 / 黑巧。';
  else if (!present('fe') && hormone?.estrogen?.status === 'reference') nextTip = '下一餐可补铁：红肉 / 菠菜 / 蛋黄。';
  else if (impacts.length === 0) nextTip = '记录更多菜品后，这里会给出更贴合的营养素参考。';

  return { impacts: impacts.slice(0, 3), nextTip, hasHint: impacts.length > 0 || nextTip.length > 0 };
}
