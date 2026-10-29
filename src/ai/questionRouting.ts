/** 长期数据分析与即时陪伴按提问意图区分，情绪词本身不排除分析。 */
const DATA = /睡眠|睡得|心率|hrv|压力|状态|恢复|身体|精力|数据|指标|周期|经期|月经|激素|皮质醇|孕激素|雌激素|体温|血氧|血糖|血压|活动量|步数|情绪|心情/i;
const STRONG = /规律|关系|关联|为什么|原因|趋势|综合|整体|总结|对比|影响/;
const WEAK = /变化|意味着|怎么办|怎么调|建议/;
const TIME = /最近|这段时间|过去|这个月|这一个月|这周|本周|一周|一直|以来|几天/;
const COMPANION = /陪我|陪陪我|抱抱|安慰我|听我说/;
const DECLINES_ANALYSIS = /(?:不想|不要|不用|别|不需要)(?:再|给我|帮我)?(?:分析|解释|讲道理|看数据)/;

export function shouldRouteToCloud(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 4 || DECLINES_ANALYSIS.test(t)) return false;
  if (!DATA.test(t)) return false;
  // 明确的数据分析问题优先，即使用户同时表达焦虑或难过。
  if (STRONG.test(t)) return true;
  if (COMPANION.test(t)) return false;
  return WEAK.test(t) && TIME.test(t);
}
