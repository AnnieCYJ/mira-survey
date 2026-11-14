/**
 * quickCheckInterpret —— 微体检报告「数值驱动」解读引擎
 * ---------------------------------------------------------------------------
 * 用户口径（2026-11-08 / 2026-11-08 续）：
 *  - 每条数据下方写「这个数值意味着什么、正常与否、可能原因、一句建议」，
 *    但控制在约两行（≤~40 汉字），不要又多又密。
 *  - 去掉「这一组是…会同步到首页」这类分组级说明（有内容的分组不再显示组说明）。
 *  - 不出现「戒指真实回读 / 按首次填写推算」等来源标注。
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
import { hormoneBrief, type HormoneKind } from '../lib/phaseHormoneBrief';

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

/**
 * 单条指标的解读：带具体数值 → 意味着什么 → 正常/异常 → 可能原因 → 一句建议。
 * ★ 2026-11-08 续：全部压到约两行，避免又多又密。
 */
export function interpretMetric(m: QCMetric): string | null {
  const v = num(m);
  const u = m.unit ?? '';
  const name = m.name;

  switch (m.key) {
    // ── 活动与睡眠 ────────────────────────────────────────────────────────
    case 'steps': {
      if (v == null) return null;
      if (v < 1000)
        return `今天仅 ${n1(v)} 步，活动明显偏少。每小时起身走两分钟，就算动一动了。`;
      if (v < 4000)
        return `今天 ${n1(v)} 步，离 6000–8000 建议还差一截。饭后散步十几分钟就能补上。`;
      if (v < 6000)
        return `今天 ${n1(v)} 步，中等偏少，还没到带动恢复的程度。傍晚多走一段更舒服。`;
      if (v < 12000)
        return `今天 ${n1(v)} 步，落在理想日常区间，身体没被久坐困住。记得配点拉伸。`;
      return `今天 ${n1(v)} 步，活动量很足。今晚补水、早点休息，让身体收回来。`;
    }
    case 'sleep': {
      const h = sleepHours(m);
      if (h == null) return null;
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      const dur = mm ? `${hh} 小时 ${mm} 分` : `${hh} 小时`;
      if (h < 6)
        return `昨晚 ${dur}，比 7–9 小时建议短约 ${n1(7 - h)} 小时，恢复不够。今晚提前半小时上床。`;
      if (h < 7)
        return `昨晚 ${dur}，略短，勉强够用。连几天这个长度 HRV 会往下走，固定起床时间。`;
      if (h <= 9)
        return `昨晚 ${dur}，在 7–9 小时里，恢复基础够。比时长更重要的是作息规律。`;
      return `昨晚 ${dur}，偏长。醒来仍发沉的话，留意睡眠质量与作息是否规律。`;
    }
    case 'calorie': {
      if (v == null) return null;
      if (v < 50)
        return `今天运动消耗仅 ${vu(v, u)}，基本没动起来。先增加几次短走动，更容易坚持。`;
      if (v < 200)
        return `今天运动消耗 ${vu(v, u)}，轻量活动，还没形成训练刺激。可逐步加快走或力量练习。`;
      return `今天运动消耗 ${vu(v, u)}，是当日额外活动消耗（不含基础代谢），身体已明显动起来。`;
    }

    // ── 核心体征 ──────────────────────────────────────────────────────────
    case 'hr': {
      if (v == null) return null;
      if (v > 100)
        return `心率 ${vu(v, u)}，高于静息 60–100。刚动过/紧张/咖啡都会这样，缓几分钟再看。`;
      if (v < 50)
        return `心率 ${vu(v, u)}，低于 60–100。规律运动者静息偏慢常见；伴头晕乏力就多留意。`;
      return `心率 ${vu(v, u)}，在 60–100 区间，负荷平稳。单次会波动，看几天静息趋势更准。`;
    }
    case 'hrv': {
      if (v == null) return null;
      if (v >= 60)
        return `HRV ${vu(v, u)} 偏高，自主神经弹性好，恢复底子不错。保持现在作息即可。`;
      if (v >= 30)
        return `HRV ${vu(v, u)} 中等，恢复尚可但不算充沛。熬夜压力会短期拉低，连看几天。`;
      return `HRV ${vu(v, u)} 偏低，可能还在恢复期。今天放慢节奏，优先把觉睡够。`;
    }
    case 'spo2': {
      if (v == null) return null;
      if (v < 95)
        return `血氧 ${n1(v)}%，低于 95–100。戴松/手冷/在动也会拉低，安静坐会儿再看。`;
      return `血氧 ${n1(v)}%，在 95–100 区间，供氧平稳。偶发偏低多和佩戴姿势有关。`;
    }
    case 'temp': {
      if (v == null) return null;
      return `体表温度 ${vu(v, u)}，属日常波动。受环境/活动/周期影响，单次略偏不必紧张。`;
    }
    case 'bp': {
      const p = bpParts(m);
      if (!p) return null;
      if (p.sys >= 140 || p.dia >= 90)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} 偏高，心血管负荷偏大。安静坐五分钟复看，留意几天走势。`;
      if (p.sys >= 120 || p.dia >= 80)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} 略高于理想 120/80，值得留意。多和近期压力睡眠有关。`;
      if (p.sys < 90)
        return `血压 ${n1(p.sys)}/${n1(p.dia)} 偏低，起身易发晕。平时一直这样且无不适多为个人基线。`;
      return `血压 ${n1(p.sys)}/${n1(p.dia)} 在理想范围，负荷平稳。固定时间安静测，趋势才可比。`;
    }

    // ── 血液指标 ──────────────────────────────────────────────────────────
    case 'tg': {
      if (v == null) return null;
      return v >= 1.7
        ? `甘油三酯 ${n1(v)} 高于 1.7 上限，近期油糖偏多、活动偏少。少油少甜、多走动。`
        : `甘油三酯 ${n1(v)} 在 1.7 以下，平稳。对饮食敏感，保持节奏就好。`;
    }
    case 'hdl': {
      if (v == null) return null;
      return v < 1.0
        ? `高密度脂蛋白 ${n1(v)} 偏低（“好胆固醇”）。有氧运动与均衡饮食对它帮助明显。`
        : `高密度脂蛋白 ${n1(v)} 达参考（>1.0），平稳。它对运动敏感，保持活动。`;
    }
    case 'ldl': {
      if (v == null) return null;
      return v > 3.4
        ? `低密度脂蛋白 ${n1(v)} 高于 3.4 上限，长期偏高留意心血管。少饱和脂肪多纤维。`
        : `低密度脂蛋白 ${n1(v)} 在参考内，平稳。变化慢，按季度看趋势。`;
    }
    case 'tc': {
      if (v == null) return null;
      return v > 5.2
        ? `总胆固醇 ${n1(v)} 高于 5.2 上限，整体偏高一点。温和调整饮食，隔段复查。`
        : `总胆固醇 ${n1(v)} 在 5.2 以下，整体平稳。受长期习惯影响，保持节奏。`;
    }
    case 'glucose': {
      if (v == null) return null;
      if (v > 6.1)
        return `血糖 ${n1(v)} 高于空腹 3.9–6.1。对进食时间敏感，先确认是否空腹再看趋势。`;
      if (v < 3.9)
        return `血糖 ${n1(v)} 低于空腹 3.9，能量偏低。久未进食/运动后常见，先吃点东西。`;
      return `血糖 ${n1(v)} 在空腹 3.9–6.1 区间，平稳。进食时间影响大，固定条件测才好比。`;
    }
    case 'uricAcid': {
      if (v == null) return null;
      if (v > 428)
        return `尿酸 ${n1(v)} 高于 428 上限，代谢偏重。多喝水、少高嘌呤，隔段看走势。`;
      if (v < 155)
        return `尿酸 ${n1(v)} 低于 155 下限，多为个人基线或近期清淡。单次意义有限，连看几次。`;
      return `尿酸 ${n1(v)} 在 155–428 区间，平稳。对饮水饮食敏感，规律喝水就好。`;
    }

    // ── 身体成分 ──────────────────────────────────────────────────────────
    case 'bmi': {
      if (v == null) return null;
      if (v < 18.5)
        return `BMI ${n1(v)} 低于 18.5–24，偏瘦，能量储备少些。留意三餐规律、蛋白质够不够。`;
      if (v < 24)
        return `BMI ${n1(v)} 在 18.5–24 正常区间，体型匀称。保持现在节奏，不必刻意增减。`;
      if (v < 28)
        return `BMI ${n1(v)} 在 24–28 超重范围，负担略大。从每天多走、晚餐轻一点开始。`;
      return `BMI ${n1(v)} 达 28 以上，负担明显。从可持续小改动入手，比短期猛减更稳。`;
    }
    case 'bodyFatPercentage':
      return v == null ? null : `体脂率 ${vu(v, u)} 反映脂肪占比，比体重更能说明体型。按月看趋势才有意义。`;
    case 'muscleMass':
      return v == null ? null : `肌肉量 ${vu(v, u)} 是代谢底子。规律力量练习+足量蛋白比有氧更关键。`;
    case 'basalMetabolicRate':
      return v == null ? null : `基础代谢约 ${vu(v, u)}，是静息维持所需热量，安排饮食的参照之一。`;

    // ── 状态与压力 ────────────────────────────────────────────────────────
    case 'todayStatus': {
      if (v == null) return null;
      if (v >= 76)
        return `今日状态 ${n1(v)}/100 较充沛，睡眠恢复与负荷配得不错。把要专注的事放今天。`;
      if (v >= 51)
        return `今日状态 ${n1(v)}/100 平稳，底子够用但不富余。手头事排先后，中间留空隙。`;
      if (v >= 26)
        return `今日状态 ${n1(v)}/100 偏低，常见于睡不够或连忙。今天把要求放低，先补觉。`;
      return `今日状态 ${n1(v)}/100 需休息，身体在提示收一收。优先睡眠轻活动，等状态回来。`;
    }
    case 'stress': {
      if (v == null) return null;
      if (v >= 60)
        return `身心压力 ${n1(v)}/100 偏高，自主神经还紧。找间隙慢呼吸或走一圈，比硬扛有效。`;
      if (v >= 30)
        return `身心压力 ${n1(v)}/100 平稳，有负荷没持续拉紧。保持节奏，别让忙碌叠起来。`;
      return `身心压力 ${n1(v)}/100 偏低，较放松，恢复条件不错。适合做需耐心的事。`;
    }
    case 'fatigue': {
      if (v == null) return null;
      return v >= 7
        ? `疲劳度 ${n1(v)} 偏高，消耗累积明显。今天优先补睡眠，非必要安排往后挪。`
        : `疲劳度 ${n1(v)} 在可接受范围，消耗恢复大致平衡。留意连续忙碌后的走向。`;
    }

    // ── 节律（有动态分析时保留原 note；这里是兜底解读）────────────────────
    case 'sleepRhythm':
      return `入睡稳定度反映生物钟规律。越稳 HRV 与白天状态越易保持；常差一两个小时就先固定起床时间。`;
    case 'circadian':
      return `昼夜节律看一天里的起伏，健康时通常白天高夜里低。峰值错位常和作息乱、夜光有关。`;
    case 'recovery':
      return `压力事件后回到基线的时间，反映自主神经弹性。恢复偏慢提示还紧绷，睡眠与放松有帮助。`;
    case 'cyclePhase': {
      // 历史报告只存了阶段名，这里也用「阶段 → 激素与身体状态 → 建议」的同款话术，
      //   不再出现「基于你记录的经期周期推算 / 结合静息心率交叉观察」这类来源说明。
      const p = String(m.value ?? '').trim();
      const label = m.label ? `、${m.label}` : '';
      return `当前处在${p || '本周期'}${label}，激素水平正走在这一阶段对应的变化里，精力、体温和情绪会跟着起伏。把这段当背景看其它数据，安排强度和休息会更贴合身体。`;
    }
    // ★ 2026-11-13（用户）：与洞察页「生理周期节律」卡片底部同一套话术 ——
    //   激素现在处于什么情况 → 由此带来的状态 → 一条具体建议；不提推算、来源、化验值。
    //   历史报告（只存了方向值）走这里重写，新报告由 quickCheckStore 按相位写入更精准的文案。
    case 'estrogen': {
      const d = String(m.value ?? '');
      if (d.includes('上升'))
        return '雌激素正在往上走，精力和情绪通常跟着变好，恢复能力也在增强。适合把高强度训练、重要任务和想启动的新计划放在这几天。';
      if (d.includes('下降'))
        return '雌激素从峰值回落，状态不像前两周那样顶，恢复也慢一些。把高强度换成中等强度有氧，别硬顶。';
      return '雌激素水平相对平稳，体感多半也比较稳。保持现在的作息和强度，连着看几天比盯单次更清楚。';
    }
    case 'progesterone': {
      const d = String(m.value ?? '');
      if (d.includes('上升'))
        return '孕激素正在上来，体温略升、身体偏沉，恢复也慢一些。把恢复留够，睡前放松，别把日程排太满。';
      if (d.includes('下降'))
        return '孕激素在回落，体感会慢慢轻快起来。顺着状态安排强度，重要决定尽量避开经前一周。';
      return '孕激素水平相对平稳，体感多半也比较稳。保持现在的作息，连着看几天比盯单次更清楚。';
    }

    // ── Pro 机组 ──────────────────────────────────────────────────────────
    case 'skin':
      return v == null ? null : `皮肤含水量 ${vu(v, u)} 反映屏障状态，干燥/少水会拉低。偏低时补水保湿，看几天更准。`;
    case 'mood':
      return `这条是今天情绪记录。连续记几天更易看出起伏与触发因素，单天当作当下注脚。`;
    case 'cortisol':
      return v == null ? null : `皮质醇 ${vu(v, u)} 是应激信号，正常应晨高夜低。持续偏高常和紧张作息乱有关。`;

    default:
      return null;
  }
}

/**
 * ★ 2026-11-08 续：分组级说明已不再展示（有内容的分组不再显示「这一组是…」类文案）。
 * 保留函数仅为兼容，统一返回 null；空状态分组的功能性提示在 quickCheckStore 里单独维护。
 */
export function interpretGroup(_g: QCGroup): string | null {
  return null;
}

/** 旧版报告里冻结在数据库里的「来源标注」措辞。命中即替换，绝不再展示给用户。 */
const LEGACY_SOURCE =
  /戒指真实回读|真实回读|本组全部为|标「实测」|标「估算」|首次填写|非戒指测量|非戒指直接测量|非实测|本机历史测量记录|来自当前戒指|PPG 估算值|按公开公式估算|不是戒指测量|由经期记录|周期相位推算|与周期日历页同源|戒指不直接测量|不给浓度数值|黄体酮就是孕激素|由黄体分泌|只描述方向|非激素化验值|基于你记录的经期周期推算|结合静息心率等信号/;

/** 雌激素 / 孕激素两条：旧报告的推算说明一律重写，新报告按相位写入的文案原样保留。 */
const HORMONE_KEYS = new Set(['estrogen', 'progesterone']);

/** 旧报告里「生理周期阶段」存的是中文阶段名，用它换回相位 key 取同源话术。 */
const PHASE_BY_LABEL: Record<string, string> = {
  经期: 'period', 卵泡期: 'follicular', 排卵期: 'ovulation', 黄体期: 'luteal',
};

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
 *  - 其余指标一律换成「带这个数值」的解读；
 *  - ★ 2026-11-08 续：有指标内容的分组，note 强制清空（不再显示分组说明）；
 *    空状态分组（身体成分未填 / 节律数据不足）才保留功能性提示。
 */
export function refreshReportNotes(groups: QCGroup[]): QCGroup[] {
  return (groups ?? []).map((g) => {
    const hasContent = !!(g.metrics?.length || g.risk || g.standalone?.length);
    // ★ 历史报告只存了中文阶段名（如「经期」），用它换回相位 key，
    //   让旧报告也能取到与洞察页同一套按相位的激素话术，而不是按方向的通用兜底。
    const phaseLabel = (g.metrics ?? []).find((m) => m.key === 'cyclePhase')?.value;
    const groupPhase = PHASE_BY_LABEL[String(phaseLabel ?? '').trim()];
    const rewrite = (m: QCMetric): QCMetric => {
      const generated = interpretMetric(m);
      // ★ 2026-11-13：历史报告里冻结的激素说明写满了「由经期记录推算 / 戒指不直接测量 /
      //   不给浓度数值 / 非激素化验值」，用户不关心这些。命中即换成本组相位对应的同源话术；
      //   新报告由 quickCheckStore 按当前相位写入的文案不含来源词，原样保留不被覆盖。
      if (HORMONE_KEYS.has(m.key)) {
        return LEGACY_SOURCE.test(m.note ?? '')
          ? { ...m, note: hormoneBrief(groupPhase, m.key as HormoneKind) }
          : m;
      }
      // 节律组的 note 常含近 7 天标准差 / 峰值时刻 / 恢复秒数等真实分析，优先保留
      const keepDynamic = g.key === 'rhythm' && m.note && !LEGACY_SOURCE.test(m.note);
      return { ...m, note: keepDynamic ? sanitizeNote(m.note) : (generated ?? sanitizeNote(m.note) ?? NEUTRAL_FALLBACK) };
    };
    return {
      ...g,
      // ★ 2026-11-13 真机验收：basisNote 是「本次依据说明」，属于用户必须看到的口径，
      //   绝不随 note 一起被清掉；解读引擎只负责指标文案，不碰这一层。
      basisNote: g.basisNote,
      // ★ 有内容分组：清掉「这一组是…」类说明；空状态分组：保留功能性提示
      note: hasContent ? undefined : sanitizeNote(g.note),
      metrics: g.metrics?.map(rewrite),
      standalone: g.standalone?.map(rewrite),
      risk: g.risk
        ? { ...g.risk, note: sanitizeNote(g.risk.note), sub: g.risk.sub?.map(rewrite) }
        : undefined,
    };
  });
}
