/**
 * quickCheckInterpret —— 微体检报告「数值驱动」解读引擎
 * ---------------------------------------------------------------------------
 * 用户口径（2026-11-08）：每条数据下面不要写「戒指真实回读 / 按首次填写推算」
 * 之类来源标注，要写**这个数值意味着什么、正常不正常、可能原因、可参考建议**。
 * 例：步数 25 → 「今天只走了 25 步，活动量明显偏少…」；BMI 22.6 → 落在正常区间。
 *
 * ★ 为什么单独一层：
 *   微体检记录把 groups 整个 JSON 序列化存进 SQLite（quickCheckStore.saveQuickCheck），
 *   旧记录里的 note 是生成当时冻结的文案，前端改代码改不到历史数据。
 *   所以本模块同时用于：
 *     ① 新报告生成时（addQuickCheck 前统一过一遍）；
 *     ② 读取历史记录时（parseRecord 里迁移），让旧报告打开即显示新解读，无需重做体检、不删数据。
 *
 * 品牌铁律：只描述、不诊断、不评分；建议是日常可落地的一句，不出现「就医/确诊/必须」。
 * ---------------------------------------------------------------------------
 */
import type { QCMetric, QCGroup } from './quickCheckStore';

/** 从 "5小时56分" / "113/82" / "22.6" 里取主数值 */
function num(m: QCMetric): number | null {
  const v = parseFloat(String(m.value).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

function sleepHours(m: QCMetric): number | null {
  const s = String(m.value);
  const h = /(\d+(?:\.\d+)?)\s*小时/.exec(s);
  const mm = /(\d+)\s*分/.exec(s);
  if (!h && !mm) return null;
  return (h ? parseFloat(h[1]) : 0) + (mm ? parseInt(mm[1], 10) / 60 : 0);
}

function bpParts(m: QCMetric): { sys: number; dia: number } | null {
  const p = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(String(m.value));
  return p ? { sys: parseFloat(p[1]), dia: parseFloat(p[2]) } : null;
}

const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** 数值 + 单位：中文单位留一个空格（「88 毫秒」），%/°C//100 这类紧贴（「98%」「22.6°C」「63/100」）。 */
function vu(v: number, u: string): string {
  if (!u) return n1(v);
  return /^[%/°]/.test(u) ? `${n1(v)}${u}` : `${n1(v)} ${u}`;
}

/** 单条指标的解读：带具体数值 → 意味着什么 → 正常/异常 → 可能原因 → 一句建议。 */
export function interpretMetric(m: QCMetric): string | null {
  const v = num(m);
  const u = m.unit ?? '';
  const name = m.name;

  switch (m.key) {
    // ── 活动与睡眠 ────────────────────────────────────────────────────────
    case 'steps': {
      if (v == null) return null;
      if (v < 1000)
        return `今天只走了 ${n1(v)} 步，活动量明显偏少，久坐久了循环和恢复都会变慢。不用一次补够，先每坐一小时起来走两分钟、接杯水也算动一动。`;
      if (v < 4000)
        return `今天走了 ${n1(v)} 步，离日常建议的 6000–8000 步还差一截，属于偏轻的一天。饭后散步十几分钟就能补上不少，别给自己加负担。`;
      if (v < 6000)
        return `今天走了 ${n1(v)} 步，活动量中等偏少，基础活动量算有，但还没到能明显带动恢复的程度。傍晚多走一段就会舒服些。`;
      if (v < 12000)
        return `今天走了 ${n1(v)} 步，落在比较理想的日常活动区间，说明白天的身体没有被久坐困住。保持这个节奏就好，记得配点拉伸。`;
      return `今天走了 ${n1(v)} 步，活动量很足，体能消耗也相应更大。今晚留意补水和早点休息，让身体有时间收回来。`;
    }
    case 'sleep': {
      const h = sleepHours(m);
      if (h == null) return null;
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      const dur = mm ? `${hh} 小时 ${mm} 分` : `${hh} 小时`;
      if (h < 6)
        return `昨晚睡了 ${dur}，比成人建议的 7–9 小时短了约 ${n1(7 - h)} 小时，恢复时间不太够，今天容易发沉、注意力也难集中。今晚试着把上床时间提前半小时。`;
      if (h < 7)
        return `昨晚睡了 ${dur}，略短于建议的 7–9 小时，属于勉强够用但不算充分。连着几天这个长度，HRV 和白天状态多半会往下走，尽量固定起床时间。`;
      if (h <= 9)
        return `昨晚睡了 ${dur}，落在成人建议的 7–9 小时里，恢复基础是够的。想让白天的状态更稳，比时长更重要的是每天差不多时间上床和起床。`;
      return `昨晚睡了 ${dur}，比常见建议的 7–9 小时更长，睡得久不一定等于恢复得更透。如果醒来还是发沉，可以留意睡眠质量与作息是否规律。`;
    }
    case 'calorie': {
      if (v == null) return null;
      if (v < 50)
        return `今天运动消耗只有 ${vu(v, u)}，基本等于没怎么动起来，能量支出偏低。不用一上来就安排大运动量，先增加几次短时间走动，身体更容易坚持。`;
      if (v < 200)
        return `今天运动消耗 ${vu(v, u)}，属于轻量活动水平，日常走动有，但还没形成明显的训练刺激。想提升体能，可以逐步加一点快走或力量练习。`;
      return `今天运动消耗 ${vu(v, u)}，能量支出比较可观，身体确实动起来了。运动后注意补水和休息，别连着几天高强度不给恢复时间。`;
    }

    // ── 核心体征 ──────────────────────────────────────────────────────────
    case 'hr': {
      if (v == null) return null;
      if (v > 100)
        return `当前心率 ${vu(v, u)}，高于静息常见的 60–100 区间，身体正处在比较高的负荷状态。刚活动过、情绪紧张或喝了咖啡都会这样，坐下来缓几分钟再看更准。`;
      if (v < 50)
        return `当前心率 ${vu(v, u)}，低于常见的 60–100 区间。规律运动的人静息偏慢很常见；如果同时觉得头晕、没力气，就多留意几天的趋势。`;
      return `当前心率 ${vu(v, u)}，在常见的 60–100 区间里，心脏负荷平稳。单次数值会随活动、情绪和咖啡因波动，看连续几天的静息趋势更有意义。`;
    }
    case 'hrv': {
      if (v == null) return null;
      if (v >= 60)
        return `HRV ${vu(v, u)} 偏高，说明自主神经弹性不错，身体恢复和应对压力的底子都比较好。保持现在的作息和睡眠节奏就行。`;
      if (v >= 30)
        return `HRV ${vu(v, u)} 处在中等水平，恢复能力尚可但不算充沛。短期走低常和熬夜、压力或饮酒有关，先别急着下结论，连着看几天趋势。`;
      return `HRV ${vu(v, u)} 偏低，身体可能还在恢复期，常见于睡眠不足、连续忙碌或压力偏大的时候。今天适合把节奏放慢一点，优先把觉睡够。`;
    }
    case 'spo2': {
      if (v == null) return null;
      if (v < 95)
        return `血氧 ${n1(v)}%，低于常见的 95–100% 区间，供氧略显不足。除了身体状态，戒指戴得松、手冷、测量时手在动也会拉低读数，安静坐一会儿再看看。`;
      return `血氧 ${n1(v)}%，在常见的 95–100% 区间里，供氧状况平稳。这个数值本身波动很小，偶尔一次偏低多与佩戴或测量姿势有关。`;
    }
    case 'temp': {
      if (v == null) return null;
      return `体表温度 ${vu(v, u)}，属于日常波动范围。体表读数受环境、活动、佩戴松紧和周期阶段影响明显，单次略高或略低都不必紧张，看趋势更可靠。`;
    }
    case 'bp': {
      const p = bpParts(m);
      if (!p) return null;
      if (p.sys >= 140 || p.dia >= 90)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} mmHg 偏高，心血管负荷比理想值大一些。高盐饮食、睡不好、连着紧张都会推高它，先安静坐五分钟再复看，并留意几天的走势。`;
      if (p.sys >= 120 || p.dia >= 80)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} mmHg 略高于理想的 120/80，属于值得留意的区间。多和近期压力、睡眠、饮食偏咸有关，规律作息比单次读数更值得关注。`;
      if (p.sys < 90)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} mmHg 偏低，起身时容易发晕。若平时一直这个水平且没有不适，多半是个人基线；刚站起来或没吃早饭时也常会偏低。`;
      return `血压 ${n1(p.sys)}/${n1(p.dia)} mmHg 在理想范围内，心血管负荷平稳。血压一天里本来就会起伏，固定时间、安静状态下测，趋势才可比。`;
    }

    // ── 血液指标 ──────────────────────────────────────────────────────────
    case 'tg': {
      if (v == null) return null;
      return v >= 1.7
        ? `甘油三酯 ${n1(v)} mmol/L 高于常见的 1.7 上限，说明近期油脂和精制碳水的摄入可能偏多、活动量偏少。先从少油少甜、饭后多走动调起，过段时间再看趋势。`
        : `甘油三酯 ${n1(v)} mmol/L 在常见的 1.7 以下，血脂这一项平稳。它对近期饮食很敏感，保持现在的饮食与活动节奏就好。`;
    }
    case 'hdl': {
      if (v == null) return null;
      return v < 1.0
        ? `高密度脂蛋白 ${n1(v)} mmol/L 偏低，这一种通常被叫作「好胆固醇」，偏低时身体清理血脂的能力会弱一些。规律有氧运动和均衡饮食对它帮助比较明显。`
        : `高密度脂蛋白 ${n1(v)} mmol/L 达到常见参考值（>1.0），这一项平稳。它对运动很敏感，保持规律活动有助于维持在这个水平。`;
    }
    case 'ldl': {
      if (v == null) return null;
      return v > 3.4
        ? `低密度脂蛋白 ${n1(v)} mmol/L 高于常见的 3.4 上限，长期偏高需要留意心血管负担。饮食里少一些饱和脂肪、多一些纤维，配合规律运动，过段时间再看变化。`
        : `低密度脂蛋白 ${n1(v)} mmol/L 在常见参考区间内，这一项平稳。它变化较慢，按季度看趋势比每天盯着更有意义。`;
    }
    case 'tc': {
      if (v == null) return null;
      return v > 5.2
        ? `总胆固醇 ${n1(v)} mmol/L 高于常见的 5.2 上限，说明血脂整体偏高一点。饮食结构和活动量都有关，先做温和调整，隔一段时间复查趋势。`
        : `总胆固醇 ${n1(v)} mmol/L 在常见的 5.2 以下，血脂整体平稳。它受长期习惯影响，保持现在的节奏即可。`;
    }
    case 'glucose': {
      if (v == null) return null;
      if (v > 6.1)
        return `血糖 ${n1(v)} mmol/L 高于空腹常见的 3.9–6.1 区间。这个数值对进食时间特别敏感，先确认是不是空腹状态，再看连续几次的走势会更清楚。`;
      if (v < 3.9)
        return `血糖 ${n1(v)} mmol/L 低于常见的空腹下限 3.9，身体可能正处在能量偏低的状态。长时间没进食、运动后都常见，先吃点东西、别硬撑。`;
      return `血糖 ${n1(v)} mmol/L 在空腹常见的 3.9–6.1 区间里，这一项平稳。它对进食时间很敏感，固定条件下测才好比较。`;
    }
    case 'uricAcid': {
      if (v == null) return null;
      if (v > 428)
        return `尿酸 ${n1(v)} μmol/L 高于常见的 428 上限，代谢负担偏重，常和饮食、饮水不足有关。先多喝水、减少高嘌呤食物，隔段时间看看走势。`;
      if (v < 155)
        return `尿酸 ${n1(v)} μmol/L 低于常见的 155 下限，多数时候是个人基线或近期饮食偏清淡，单次数值意义有限。连着看几次更稳妥。`;
      return `尿酸 ${n1(v)} μmol/L 在常见的 155–428 区间里，这一项平稳。它对饮水量和近期饮食很敏感，保持规律喝水就好。`;
    }

    // ── 身体成分 ──────────────────────────────────────────────────────────
    case 'bmi': {
      if (v == null) return null;
      if (v < 18.5)
        return `BMI ${n1(v)} 低于常见健康区间 18.5–24，体型偏瘦，能量储备相对少一些。可以留意三餐是否规律、蛋白质够不够，别靠节食再往下压。`;
      if (v < 24)
        return `BMI ${n1(v)} 落在常见的 18.5–24 正常区间，体型匀称，体重和身高的比例是合适的。保持现在的饮食与运动节奏就挺好，不必刻意增减。`;
      if (v < 28)
        return `BMI ${n1(v)} 高于 24、低于 28，属于超重范围，身体负担比正常区间略大。不用急着一刀切，先从每天多走一点、晚餐轻一点开始，慢慢看趋势。`;
      return `BMI ${n1(v)} 达到 28 以上，体重带来的负担比较明显。建议从可持续的小改动入手——规律三餐、每天固定一段走动，比短期猛减更容易稳住。`;
    }
    case 'bodyFatPercentage': {
      if (v == null) return null;
      return `体脂率 ${vu(v, u)} 反映脂肪在体重里的占比，比单看体重更能说明体型变化。它一天内波动不大，按月看趋势才有意义，配合规律活动和蛋白质摄入慢慢调。`;
    }
    case 'muscleMass': {
      if (v == null) return null;
      return `肌肉量 ${vu(v, u)} 反映身体的基础支撑与代谢底子。想让它稳住或往上走，规律的力量练习和足量蛋白质比有氧更关键，按月看变化就好。`;
    }
    case 'basalMetabolicRate': {
      if (v == null) return null;
      return `基础代谢约 ${vu(v, u)}，是身体安静状态下维持运转所需的热量，也是安排饮食时一个有用的参照。它会随肌肉量和作息小幅变化，不必当成精确刻度。`;
    }

    // ── 状态与压力 ────────────────────────────────────────────────────────
    case 'todayStatus': {
      if (v == null) return null;
      if (v >= 76)
        return `今日状态 ${n1(v)}/100 处在比较充沛的档位，说明睡眠、恢复和当下的负荷配得不错。适合把需要专注的事放在今天，别把节奏排得太满就好。`;
      if (v >= 51)
        return `今日状态 ${n1(v)}/100 属于平稳档，身体底子够用但没有特别富余。把手头的事排个先后，中间留点空隙，比一路绷着更稳。`;
      if (v >= 26)
        return `今日状态 ${n1(v)}/100 偏低，恢复或负荷里有一头没跟上，常见于睡不够、连着忙碌之后。今天适合把要求放低一点，先把觉补回来。`;
      return `今日状态 ${n1(v)}/100 处在需要休息的档位，身体明显在提示要收一收。别硬撑，优先睡眠和轻量活动，等状态回来再安排重活。`;
    }
    case 'stress': {
      if (v == null) return null;
      if (v >= 60)
        return `身心压力 ${n1(v)}/100 偏高，自主神经还处在比较紧的状态，连着紧绷会拖慢恢复。找个能打断的间隙——几分钟慢呼吸、出门走一圈，都比硬扛有效。`;
      if (v >= 30)
        return `身心压力 ${n1(v)}/100 处在平稳区间，有负荷但没有持续拉紧。保持现在的节奏就挺好，留意别让忙碌一段段叠起来。`;
      return `身心压力 ${n1(v)}/100 偏低，身体处在比较放松的状态，恢复条件不错。适合做点需要耐心的事，也别把空闲全填满。`;
    }
    case 'fatigue': {
      if (v == null) return null;
      return v >= 7
        ? `疲劳度 ${n1(v)} 偏高，身心消耗已经累积到比较明显的程度。今天优先补睡眠和休息，把非必要的安排往后挪，别靠咖啡硬顶。`
        : `疲劳度 ${n1(v)} 在可接受范围，消耗和恢复大致平衡。留意它在连续忙碌后的走向，比单次数值更能说明问题。`;
    }

    // ── 节律（有动态分析时保留原 note；这里是兜底解读）────────────────────
    case 'sleepRhythm':
      return `入睡时间的稳定程度反映生物钟是否规律。作息越稳，HRV 和白天的状态越容易保持；如果经常前后差一两个小时，先固定起床时间会最见效。`;
    case 'circadian':
      return `昼夜节律看的是身体一天里的活跃与回落是否正常，健康状态下通常白天高、夜里低。峰值错位或波动变平，常和作息不规律、夜间光照有关。`;
    case 'recovery':
      return `压力事件后回到基线所需的时间，反映自主神经的弹性。恢复偏慢说明身体还在紧绷，规律睡眠和白天的短暂放松都有帮助。`;
    case 'cyclePhase':
      return `这一项说明你当前处在周期的哪个阶段。不同阶段的精力、体温和情绪感受本来就会有起伏，把它当背景去看其它数据的变化会更清楚。`;
    case 'estrogen':
      return `雌激素的相对水平随周期阶段起伏，排卵前通常较高、经期前后较低。它只是帮你理解身体感受的趋势，不是激素化验数值。`;
    case 'progesterone':
      return `黄体酮的相对水平在排卵后走高、经期前回落，常与体感偏沉、体温略升同期出现。结合自己的感受看趋势，比看单次数值更有用。`;

    // ── Pro 机组 ──────────────────────────────────────────────────────────
    case 'skin':
      return v == null ? null : `皮肤含水量 ${vu(v, u)} 反映屏障状态，环境干燥、饮水少都会拉低它。偏低时留意补水和保湿，看几天趋势比一次更准。`;
    case 'mood':
      return `这条是今天的情绪记录。连续记几天更容易看出自己的情绪起伏和触发因素，单天的记录适合当作当下的一个注脚。`;
    case 'cortisol':
      return v == null ? null : `皮质醇 ${vu(v, u)} 是应激相关的信号，正常应呈晨高夜低。持续偏高或峰值后移常和连着紧张、作息乱有关，规律起床和晨间光照有帮助。`;

    default:
      return null;
  }
}

/** 分组级说明：只讲这一组怎么看、看什么趋势，不写数据来源。 */
export function interpretGroup(g: QCGroup): string | null {
  switch (g.key) {
    case 'today':
      return '这一组是身体当下整体状态的浓缩，会同步到首页。它随 sleep、HRV 和负荷一起变，连着看几天比盯某一次更能看出走势。';
    case 'core':
      return '这一组看身体最基础的运转状态：心率、HRV、血氧与体温。单次数值会随活动、情绪和佩戴状态波动，安静时测、看趋势更靠谱。';
    case 'activity':
      return '这一组把今天的消耗和昨晚的恢复放在一起看。步数、运动量与睡眠时长互相影响，能大致判断今天的体力底子够不够。';
    case 'blood':
      return '这一组反映血脂、血糖等代谢侧的趋势。它们对近期饮食、进食时间和饮水都很敏感，按周或按月比较，比单次读数更有意义。';
    case 'body':
      return '这一组看体型与基础代谢的大致水平，适合用来观察长期变化。想拿到精确数值，做一次专业体测会更合适。';
    case 'rhythm':
      return '这一组从节律角度解读身体状态：睡眠看规律性，昼夜节律看一天里的起伏，压力恢复看放松回来的速度，生理周期看阶段带来的变化。都是趋势性参考。';
    case 'hormone':
      return '这一组看周期阶段带来的身体变化趋势，用来理解不同阶段的感受差异，适合连着几个月对照着看。';
    case 'mental':
      return '这一组记录身心侧的即时信号。它们更受当天状态影响，连着记几天，比单次数值更容易看出自己的起伏规律。';
    default:
      return null;
  }
}

/** 旧版报告里冻结在数据库里的「来源标注」措辞。命中即替换，绝不再展示给用户。 */
const LEGACY_SOURCE =
  /戒指真实回读|真实回读|本组全部为|标「实测」|标「估算」|首次填写|非戒指测量|非戒指直接测量|非实测|本机历史测量记录|来自当前戒指|PPG 估算值|按公开公式估算|不是戒指测量/;

const NEUTRAL_FALLBACK =
  '这项数值反映身体当下的一个侧面，单次数值会随活动、睡眠和情绪波动。连着看几天的趋势，比盯着某一次更容易看出变化。';

/** 清理来源标注；没有来源词就原样保留（动态节律分析不能被抹掉）。 */
function sanitizeNote(note?: string): string | undefined {
  if (!note) return note;
  return LEGACY_SOURCE.test(note) ? NEUTRAL_FALLBACK : note;
}

/**
 * 刷新整份报告的文案（不改动数值、状态、刻度等任何测量结果）。
 *  - 新报告落库前调用、历史记录读出时调用，两处共用同一套解读；
 *  - 节律组里带具体数据的动态分析予以保留，只清掉来源标注；
 *  - 其余指标一律换成「带这个数值」的解读。
 */
export function refreshReportNotes(groups: QCGroup[]): QCGroup[] {
  return (groups ?? []).map((g) => {
    const rewrite = (m: QCMetric): QCMetric => {
      const generated = interpretMetric(m);
      // 节律组的 note 常含近 7 天标准差 / 峰值时刻 / 恢复秒数等真实分析，优先保留
      const keepDynamic = g.key === 'rhythm' && m.note && !LEGACY_SOURCE.test(m.note);
      return { ...m, note: keepDynamic ? sanitizeNote(m.note) : (generated ?? sanitizeNote(m.note) ?? NEUTRAL_FALLBACK) };
    };
    return {
      ...g,
      note: interpretGroup(g) ?? sanitizeNote(g.note),
      metrics: g.metrics?.map(rewrite),
      standalone: g.standalone?.map(rewrite),
      risk: g.risk
        ? { ...g.risk, note: sanitizeNote(g.risk.note), sub: g.risk.sub?.map(rewrite) }
        : undefined,
    };
  });
}
