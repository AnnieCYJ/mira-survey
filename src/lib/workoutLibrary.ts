/**
 * 今日运动建议库（周期阶段 × 强度 → 一套可执行方案）
 * ─────────────────────────────────────────────────────────────
 * ★ 这是「内容层」，不是 AI。要不要接模型另说，先把内容和逻辑拆开：
 *   · 逻辑（分档 / 拼分析 / 拼结论）→ todayWorkout.ts
 *   · 内容（练什么、做几段、为什么这么定）→ 本文件，纯数据，可整块替换
 *
 * ★ 内容的依据（写每一套方案时的口径，别在别处另起一套说法）：
 *   1. 皮质醇随强度非线性上升：过了「还能完整说话」这个强度（≈50–60% VO₂max），
 *      皮质醇跟着强度一起往上走；在这个强度以下，中等强度运动反而让皮质醇回落。
 *      → Stanford Lifestyle Medicine（运动生理学者 Anne Friedlander）关于皮质醇昼夜节律
 *        与训练时段的公开结论；DiPietro L. et al., Diabetes Care 2013（中等强度有氧降皮质醇）。
 *   2. 皮质醇有昼夜节律：晨间（醒来后）是自然峰值，上午晚些到下午早些（10–14 点）开始回落，
 *      傍晚（17–20 点）皮质醇低、力量/耐力/柔韧的体感最好，20 点之后心率与体温要很久才落下来，
 *      这时上高强度会压睡眠。→ 同上 Stanford Lifestyle Medicine。
 *   3. 月经周期改变运动体验：卵泡期雌激素上行（恢复快、耐力好），排卵期体感峰值，
 *      黄体期孕激素上行 + 核心体温高约 0.3–0.6 ℃（同等强度更累、出汗更多、恢复慢），
 *      经期激素与皮质醇都偏低（能量本来就少）。
 *      → Oosthuyse T. & Lisonek M., Sports Med 2008（周期与运动表现综述）；
 *        Cunningham J. et al., J Physiol 2019（雌激素与代谢/运动经济）。
 *   4. 经前一周高强度容易加重不适：皮质醇与孕激素走同一条原料通道，
 *      HPA 轴长期背负时，本就吃紧的黄体期更经不起再加码。→ 机制性表述，UI 上只说「留余力」。
 *   5. 收尾降唤醒用「循环叹气」（双吸长呼）：斯坦福 2023 随机对照里它比同时长正念冥想
 *      更快降负性唤醒。→ Balban M.Y. et al., Cell Reports Medicine 2023（Stanford）。
 *
 * 口径（Mira 铁律，写内容时守住）：
 *  · 温和优先、女性向：宁可少练一组，也不让人练透支。
 *  · 不给诊断、不承诺疗效、不点名竞品；说「适合/通常/可以」，不说「能治/防XX」。
 *  · 心率一律写区间（bpm），不做个体化医学建议；有不适立刻停，属常识性兜底。
 *  · 每套都是「热身 / 主项 / 收尾」三段，时长 18–30 分钟，随时可拆。
 *
 * sportType 用固件 VPDeviceRuningMode 枚举（对齐 sportLog.ts / sportVisual.ts）。
 */

import { HEART_ZONES } from './sportVisual';

/** 周期阶段：与 RingBleManager.PHASE_TEXT 取值保持一致 */
export type WorkoutPhase = '经期' | '卵泡期' | '排卵期' | '黄体期' | '未记录';
/** 强度三档（'unknown' 无数据档由 todayWorkout 归一成 recovery 再查库） */
export type WorkoutIntensity = 'recovery' | 'moderate' | 'intense';

/** 注意事项的一条：小标签 + 一句正文（小标签见 UI「注意这几点」） */
export interface Caution {
  /** 两字小标签（强度 / 空腹 / 收尾 …） */
  tag: string;
  text: string;
}

export interface LibraryStep {
  /** 段位：热身 / 主项 / 收尾 */
  phase: string;
  /** 具体做什么 */
  name: string;
  /** 时长（秒） */
  seconds: number;
  /** 动作要点 */
  note?: string;
}

export interface LibraryPlan {
  id: string;
  /** 适用周期阶段（含 null = 不限阶段）。查库时优先精确阶段，再回落不限阶段 */
  phases: (WorkoutPhase | null)[];
  /** 适用强度档，可多档共用一套 */
  intensities: WorkoutIntensity[];
  /** 主运动：固件枚举 type */
  sportType: number;
  sportName: string;
  /** 心率目标所在区间序号（HEART_ZONES 下标） */
  hrZone: number;
  /** 一句话方案。{{hr}} 由 todayWorkout 按实际心率区间替换 */
  headline: string;
  /**
   * 为什么今天这么定（一句）。会进分析卡，是「激素 / 皮质醇 / 状态」三行里的激素行，
   * 让用户看见这不是拍脑袋给的方案。
   */
  rationale: string;
  /** 依据短标签（UI 脚注用，完整出处见文件头 + WORKOUT_REFS） */
  refTag: string;
  steps: LibraryStep[];
  // 注意事项：跟方案联动（同一套方案给出不同的话），不是静态科普
  cautions: Caution[];
}

/** 分钟 → 秒。库里 seconds 一律是秒（UI 直接拿去算总时长），
 *  所以写时长都按「S(5) = 300 秒」来，别把分钟数直接塞进 seconds。 */
function S(minutes: number): number {
  return Math.round(minutes * 60);
}

/** ── 经期（激素与皮质醇都偏低，能量本来就少）──────────── */
const MENSTRUAL_RESTORE: LibraryPlan = {
  id: 'menstrual-restore',
  phases: ['经期'],
  intensities: ['recovery'],
  sportType: 16, // 瑜伽
  sportName: '瑜伽',
  hrZone: 0,
  headline: '慢慢来 · 温和瑜伽为主',
  rationale: '经期激素在低位，能量本来就少，今天只做把身体带活的事。',
  refTag: '经期 · 激素撤退期',
  steps: [
    { phase: '热身', name: '躺姿呼吸 + 猫牛式', seconds: S(5), note: '鼻吸口呼，先把呼吸放慢' },
    { phase: '主项', name: '支撑类体式（婴儿式 · 蛙式 · 靠墙倒 L）', seconds: S(12), note: '不倒立、不挤压腹盆腔' },
    { phase: '收尾', name: '髋部与腿后侧静态拉伸', seconds: S(5), note: '每侧 30 秒，不弹振' },
  ],
  cautions: [
    { tag: '强度', text: '出血量多的第 1–2 天直接休息，不勉强' },
    { tag: '动作', text: '别做腹压动作（卷腹 · 倒立 · 深度核心），会加重坠胀' },
    { tag: '拉伸', text: '拉伸保持静态 20–30 秒，不要抖着拉伸' },
    { tag: '保暖', text: '腰腹注意保暖，别吹冷风、别泡热水澡' },
  ],
};

const MENSTRUAL_WALK: LibraryPlan = {
  id: 'menstrual-walk',
  phases: ['经期'],
  intensities: ['moderate'],
  sportType: 2, // 快走
  sportName: '快走',
  hrZone: 0,
  headline: '稳着来 · 轻快走为主',
  rationale: '经期不冲强度，轻快走把身体带活就行，心率不用往上够。',
  refTag: '经期 · 轻活动',
  steps: [
    { phase: '热身', name: '原地踏步 + 肩颈绕环', seconds: S(5), note: '关节先活动开' },
    { phase: '主项', name: '平地快走', seconds: S(13), note: '还能正常说话的配速' },
    { phase: '收尾', name: '髋屈肌 + 小腿拉伸', seconds: S(5), note: '每侧 20 秒' },
  ],
  cautions: [
    { tag: '强度', text: '出血量太大或坠胀明显就停下，别追步数' },
    { tag: '恢复', text: '仍然避开倒立与深蹲到底这类腹压动作' },
    { tag: '状态', text: '穿支撑好的鞋，经期盆腔充血腿更容易酸' },
  ],
};

/** ── 卵泡期（雌激素上行，恢复快）──────────────────────── */
const FOLLICULAR_RECOVERY: LibraryPlan = {
  id: 'follicular-recovery',
  phases: ['卵泡期'],
  intensities: ['recovery'],
  sportType: 2, // 快走
  sportName: '快走',
  hrZone: 0,
  headline: '慢慢来 · 快走为主',
  rationale: '卵泡期雌激素上行，这阶段的耐力和恢复都比黄体期好，Zone 2 最划算。',
  refTag: '卵泡期 · 雌激素上行',
  steps: [
    { phase: '热身', name: '原地踏步 + 手臂绕环', seconds: S(5), note: '别一上来就提心率' },
    { phase: '主项', name: '慢走或轻快走', seconds: S(12), note: '微微发热就够' },
    { phase: '收尾', name: '腿后侧 + 髋部拉伸', seconds: S(6), note: '每侧 20 秒' },
  ],
  cautions: [
    { tag: '强度', text: '心率超过 100 就放慢——恢复日不是练心肺的日子' },
    { tag: '补水', text: '这阶段代谢偏高、出汗更早，别等口渴才补水' },
    { tag: '目标', text: '今天的目标是舒服，不是把消耗数字刷上去' },
  ],
};

const FOLLICULAR_MODERATE: LibraryPlan = {
  id: 'follicular-moderate',
  phases: ['卵泡期'],
  intensities: ['moderate'],
  sportType: 7, // 骑行
  sportName: '骑行',
  hrZone: 1,
  headline: '稳着来 · Zone 2 有氧（骑行 / 快走 / 椭圆机）',
  rationale: '卵泡期恢复好，Zone 2 最划算——还能说话的强度就不会把皮质醇顶上去。',
  refTag: '卵泡期 · 雌激素上行',
  steps: [
    { phase: '热身', name: '动态热身 + 高抬腿', seconds: S(5), note: '关节活动开再上心率' },
    { phase: '主项', name: '持续有氧（骑行 · 椭圆机 · 快走）', seconds: S(14), note: '全程还能说话——这个区间才不会把皮质醇顶上去' },
    { phase: '收尾', name: '全身拉伸 + 腹式呼吸', seconds: S(5), note: '呼比吸长一点，配 3 次循环叹气' },
  ],
  cautions: [
    { tag: '强度', text: '心率破区间上限就降速：过了「还能说话」这条线，皮质醇会跟着强度一起上' },
    { tag: '节奏', text: '这阶段更有劲，但别把「能练」当「要练满」' },
    { tag: '空腹', text: '别空腹练满 30 分钟以上，饿着练更容易把皮质醇顶高' },
    { tag: '恢复', text: '训练后 30 分钟内补点蛋白和碳水，女性的恢复窗口比男性短' },
  ],
};

const FOLLICULAR_INTENSE: LibraryPlan = {
  id: 'follicular-intense',
  phases: ['卵泡期'],
  intensities: ['intense'],
  sportType: 84, // 力量训练
  sportName: '力量训练',
  hrZone: 1,
  headline: '可以稍加一点 · 轻量力量循环',
  rationale: '这月身体最好的窗口，可以垫点强度；但要中等次数，别冲大重量。',
  refTag: '卵泡期 · 素质窗口',
  steps: [
    { phase: '热身', name: '动态热身（半程深蹲 · 弓步 · 肩外旋）', seconds: S(6), note: '先把关节活动开' },
    { phase: '主项', name: '复合动作循环（深蹲 / 弓步 / 划船 / 推举）', seconds: S(14), note: '中等次数 12–15 个做 3 轮，轮间歇 60 秒' },
    { phase: '收尾', name: '冷身慢走 + 大肌群拉伸', seconds: S(5), note: '结束后 30 分钟内补点蛋白和碳水' },
  ],
  cautions: [
    { tag: '次数', text: '中等次数比冲大重量更适合现在这个阶段' },
    { tag: '呼吸', text: '核心收紧但别憋气——憋气会让血压往上冲' },
    { tag: '状态', text: '状态一般就少做一轮，少练一组不算没练' },
  ],
};

/** ── 排卵期（体感峰值，也最容易跟着「最有劲」冲过头）──── */
const OVULATION_RECOVERY: LibraryPlan = {
  id: 'ovulation-recovery',
  phases: ['排卵期'],
  intensities: ['recovery'],
  sportType: 91, // 拉伸
  sportName: '拉伸',
  hrZone: 0,
  headline: '慢慢来 · 拉伸加慢走为主',
  rationale: '排卵期体感最旺，练中等刚好，不用为了「有反应」再加码。',
  refTag: '排卵期 · 体感峰值',
  steps: [
    { phase: '热身', name: '肩颈绕环 + 猫牛式', seconds: S(5), note: '呼吸带动动作' },
    { phase: '主项', name: '慢走 + 静态拉伸', seconds: S(13), note: '哪紧就停在哪个上，别硬掰' },
    { phase: '收尾', name: '腹式呼吸收尾', seconds: S(4), note: '呼比吸长，帮身体降下来' },
  ],
  cautions: [
    { tag: '身体', text: '部分人排卵当天会腰酸或下腹短暂抽痛，停一停就好，持续痛就别练' },
    { tag: '节奏', text: '这阶段体感两极，别拿别人的「最有劲」当标准' },
    { tag: '拉伸', text: '拉伸以不疼为界，疼了就是过了' },
  ],
};

const OVULATION_MODERATE: LibraryPlan = {
  id: 'ovulation-moderate',
  phases: ['排卵期'],
  intensities: ['moderate'],
  sportType: 9, // 椭圆机
  sportName: '椭圆机',
  hrZone: 1,
  headline: '稳着来 · Zone 2 有氧（椭圆机 / 快走 / 骑行）',
  rationale: '排卵期体感是这月最好的一段，保持中等就好，别被「今天最旺」带着冲。',
  refTag: '排卵期 · 雌激素峰',
  steps: [
    { phase: '热身', name: '开合跳 + 高抬腿 + 手臂绕环', seconds: S(5), note: '活动开关节再上心率' },
    { phase: '主项', name: '持续有氧（椭圆机 · 快走 · 骑行）', seconds: S(14), note: '全程还能说话' },
    { phase: '收尾', name: '髂腰肌 + 背部拉伸', seconds: S(5), note: '每侧 20 秒' },
  ],
  cautions: [
    { tag: '强度', text: '心率破区间上限就降速，别为了数字硬顶' },
    { tag: '状态', text: '今天有轻微坠胀或排卵痛就降一档，不算退步' },
    { tag: '空腹', text: '别空腹练满 30 分钟以上，饿着练更容易把皮质醇顶高' },
    { tag: '补水', text: '这阶段体温偏高，补水别等口渴' },
  ],
};

const OVULATION_INTENSE: LibraryPlan = {
  id: 'ovulation-intense',
  phases: ['排卵期'],
  intensities: ['intense'],
  sportType: 84, // 力量训练
  sportName: '力量训练',
  hrZone: 1,
  headline: '可以稍加一点 · 自重循环',
  rationale: '排卵期是力量表现最好的一天，把动作做标准，比堆重量值。',
  refTag: '排卵期 · 表现峰',
  steps: [
    { phase: '热身', name: '动态热身（弓步转体 + 臀桥 + 肩外旋）', seconds: S(6), note: '先把髋和肩活动开' },
    { phase: '主项', name: '自重循环（深蹲 / 臀桥 / 划船 / 推墙）', seconds: S(14), note: '12–15 个做 3 轮，轮间歇 60 秒' },
    { phase: '收尾', name: '冷身 + 髋屈肌拉伸', seconds: S(5), note: '每侧 20 秒' },
  ],
  cautions: [
    { tag: '身体', text: '下腹有坠胀感就换成散步，今天不做力量' },
    { tag: '安排', text: '中等次数、留两组余力——练完第二天不酸才是对的' },
    { tag: '重量', text: '重量宁轻勿重，技术稳定比冲重量重要' },
  ],
};

/** ── 黄体期（孕激素上行、体温高、恢复慢）──────────────── */
const LUTEAL_RECOVERY: LibraryPlan = {
  id: 'luteal-recovery',
  phases: ['黄体期'],
  intensities: ['recovery'],
  sportType: 16, // 瑜伽
  sportName: '瑜伽',
  hrZone: 0,
  headline: '慢慢来 · 瑜伽与拉伸为主',
  rationale: '黄体期孕激素高、体温也高，身体在往内收，先做拉伸把气收回来。',
  refTag: '黄体期 · 孕激素上行',
  steps: [
    { phase: '热身', name: '猫牛式 + 站姿体侧伸展', seconds: S(5), note: '先让脊柱动起来' },
    { phase: '主项', name: '温和体式（猫牛 · 婴儿式 · 蛙式 · 仰卧扭转）', seconds: S(12), note: '躺姿居多，别硬撑' },
    { phase: '收尾', name: '腿后侧 + 背部静态拉伸', seconds: S(6), note: '每侧 30 秒，配合长呼气' },
  ],
  cautions: [
    { tag: '补水', text: '这阶段基础体温高、出汗多，补水别等口渴' },
    { tag: '经前', text: '月经来前这几天练得轻很正常，身体在攒劲，不是退步' },
    { tag: '状态', text: '困和渴都是信号，今天累了就 15 分钟收工' },
    { tag: '睡前', text: '睡前做几轮循环叹气（双吸长呼），比刷手机更睡不着这件事有用' },
  ],
};

const LUTEAL_MODERATE: LibraryPlan = {
  id: 'luteal-moderate',
  phases: ['黄体期'],
  intensities: ['moderate'],
  sportType: 2, // 快走
  sportName: '快走',
  hrZone: 1,
  headline: '稳着来 · 短时 Zone 2 有氧',
  rationale: '孕激素上去后体温更高，同样的强度也更累，短一点比硬撑好。',
  refTag: '黄体期 · 体温与疲劳',
  steps: [
    { phase: '热身', name: '原地踏步 + 髋绕环', seconds: S(5), note: '活动开再走' },
    { phase: '主项', name: '平地快走', seconds: S(12), note: '能说话的配速，宁短别拖长' },
    { phase: '收尾', name: '小腿 + 髋屈肌拉伸', seconds: S(6), note: '每侧 20 秒' },
  ],
  cautions: [
    { tag: '时长', text: '黄体期恢复慢：时长比平时短一点是合理的，不是偷懒' },
    { tag: '经前', text: '月经来前 4–5 天身体自己往下调，练得轻是顺着身体，不是退步' },
    { tag: '空腹', text: '别空腹练满 30 分钟以上，饿着练更容易把皮质醇顶高' },
    { tag: '补水', text: '训练后记得补水补电解质，这阶段出汗比你感觉到的多' },
  ],
};

const LUTEAL_INTENSE: LibraryPlan = {
  id: 'luteal-intense',
  phases: ['黄体期'],
  intensities: ['intense'],
  sportType: 84, // 力量训练
  sportName: '力量训练',
  hrZone: 1,
  headline: '可以稍加一点 · 中次数低负重',
  rationale: '黄体期孕激素一路走高，强度再加码恢复就追不上——这套已经留了余力，别再自己加。',
  refTag: '黄体期 · 皮质醇通道',
  steps: [
    { phase: '热身', name: '动态热身（半程深蹲 · 弓步 · 肩绕环）', seconds: S(6), note: '关节先活动开' },
    { phase: '主项', name: '复合动作循环（深蹲 / 划船 / 推举 / 臀桥）', seconds: S(13), note: '中等次数 12–15 个做 3 轮，轮间歇 90 秒' },
    { phase: '收尾', name: '冷身慢走 + 大肌群拉伸', seconds: S(6), note: '结束后补点蛋白和碳水' },
  ],
  cautions: [
    { tag: '余力', text: '这阶段留的余力要比卵泡期多一轮——恢复慢是真的' },
    { tag: '经前', text: '来月经前 4–5 天主动减量，这几天的重点是吸收前几周的训练，不是加码' },
    { tag: '节奏', text: '轮间休息给到 90 秒，别拿卵泡期的节奏练今天' },
    { tag: '状态', text: '睡不够就砍主项，只做热身 + 拉伸也说得过去' },
  ],
};

/** ── 未记录周期（首次使用 / 还没填经期）──────────────── */
const ANY_RECOVERY: LibraryPlan = {
  id: 'any-recovery',
  phases: [null],
  intensities: ['recovery'],
  sportType: 2, // 快走
  sportName: '快走',
  hrZone: 0,
  headline: '慢慢来 · 慢走为主',
  rationale: '还没记周期，就按通用保守档来，先走 20 分钟感受一下。',
  refTag: '通用 · 保守档',
  steps: [
    { phase: '热身', name: '原地踏步 + 肩颈绕环', seconds: S(5), note: '呼吸放慢，别憋气' },
    { phase: '主项', name: '慢走或快走', seconds: S(12), note: '还能正常说话的强度' },
    { phase: '收尾', name: '腿后侧 + 髋部静态拉伸', seconds: S(6), note: '每侧 20 秒，不弹振' },
  ],
  cautions: [
    { tag: '强度', text: '心率超过 100 就放慢——恢复日不是练心肺的日子' },
    { tag: '强度', text: '把强度压在「还能说话」的范围，过了这条线皮质醇会跟着上' },
    { tag: '保暖', text: '出汗后及时擦干换衣，别带着湿衣服吹风' },
  ],
};

const ANY_MODERATE: LibraryPlan = {
  id: 'any-moderate',
  phases: [null],
  intensities: ['moderate'],
  sportType: 7, // 骑行
  sportName: '骑行',
  hrZone: 1,
  headline: '稳着来 · Zone 2 有氧（骑行 / 快走 / 椭圆机）',
  rationale: '没记周期也照给：强度压在能说话的范围，这个区间最划算。',
  refTag: '通用 · Zone 2',
  steps: [
    { phase: '热身', name: '开合跳 + 高抬腿 + 手臂绕环', seconds: S(5), note: '关节活动开再上心率' },
    { phase: '主项', name: '持续有氧（快走 / 骑行 / 椭圆机）', seconds: S(14), note: '全程还能说话——这个区间才不会把皮质醇顶上去' },
    { phase: '收尾', name: '全身拉伸 + 腹式呼吸', seconds: S(5), note: '呼比吸长，配 3 次循环叹气' },
  ],
  cautions: [
    { tag: '强度', text: '心率破区间上限就降速：过了「还能说话」这条线，皮质醇会跟着强度一起上' },
    { tag: '空腹', text: '别空腹练满 30 分钟以上，饿着练更容易把皮质醇顶高' },
    { tag: '恢复', text: '训练后 30 分钟内补点蛋白和碳水，恢复窗口比男性短' },
  ],
};

const ANY_INTENSE: LibraryPlan = {
  id: 'any-intense',
  phases: [null],
  intensities: ['intense'],
  sportType: 84, // 力量训练
  sportName: '力量训练',
  hrZone: 1,
  headline: '可以稍加一点 · 轻量循环训练',
  rationale: '今天状态不错，可以垫一点，但中等次数轻重量，留两组余力。',
  refTag: '通用 · 轻量循环',
  steps: [
    { phase: '热身', name: '动态热身（半程深蹲 + 弓步 + 肩外旋）', seconds: S(6), note: '把关节先活动开' },
    { phase: '主项', name: '循环训练（深蹲 / 弓步 / 划船 / 推举）', seconds: S(14), note: '轻重量 12–15 次做 3 轮，轮间休息 60 秒' },
    { phase: '收尾', name: '冷身慢走 + 大肌群拉伸', seconds: S(5), note: '结束后 30 分钟内补一点蛋白和碳水' },
  ],
  cautions: [
    { tag: '次数', text: '中等次数（12–15 次）比冲大重量更稳' },
    { tag: '呼吸', text: '核心收紧但别憋气——憋气会让血压往上冲' },
    { tag: '状态', text: '状态一般就少做一轮，少练一组不算没练' },
  ],
};

/** 库顺序有讲究：同阶段时，靠前的方案优先命中（recovery 先行） */
export const WORKOUT_LIBRARY: LibraryPlan[] = [
  // 经期
  MENSTRUAL_RESTORE, MENSTRUAL_WALK,
  // 卵泡期
  FOLLICULAR_RECOVERY, FOLLICULAR_MODERATE, FOLLICULAR_INTENSE,
  // 排卵期
  OVULATION_RECOVERY, OVULATION_MODERATE, OVULATION_INTENSE,
  // 黄体期
  LUTEAL_RECOVERY, LUTEAL_MODERATE, LUTEAL_INTENSE,
  // 不限阶段（周期没记录时的兜底）
  ANY_RECOVERY, ANY_MODERATE, ANY_INTENSE,
];

/** UI 脚注用的依据行（完整出处见本文件头注释） */
export const WORKOUT_SOURCE_LINE =
  '依据 · Stanford Lifestyle Medicine（皮质醇昼夜节律与训练时段）／Balban et al., Cell Reports Medicine 2023（斯坦福）／Cunningham et al., J Physiol 2019';

/** 归一化阶段名（未知值一律当「未记录」，不去库里撞空） */
function normalizePhase(phase?: string | null): WorkoutPhase {
  const known: WorkoutPhase[] = ['经期', '卵泡期', '排卵期', '黄体期', '未记录'];
  const p = (phase ?? '未记录').trim();
  return (known as string[]).includes(p) ? (p as WorkoutPhase) : '未记录';
}

const ORDER: WorkoutIntensity[] = ['recovery', 'moderate', 'intense'];

/**
 * 查库：阶段优先，强度可降级，最后一次兜底到通用恢复档。
 * 例：经期 + intense（不匹配）→ 自动降级到 经期 + recovery，而不是跑去给一套通用力量训练。
 */
export function pickLibraryPlan(
  phase?: string | null,
  intensity?: WorkoutIntensity | null,
): LibraryPlan {
  const ph = normalizePhase(phase);
  const wanted: WorkoutIntensity[] = intensity
    ? [intensity, ...ORDER.filter((i) => i !== intensity)]
    : ORDER;

  // ① 同阶段 + 强度按「想要 → 降一档 → 降两档」找
  for (const it of wanted) {
    const hit = WORKOUT_LIBRARY.find((p) => p.phases.includes(ph) && p.intensities.includes(it));
    if (hit) return hit;
  }
  // ② 不限阶段 + 同样强度阶梯
  for (const it of wanted) {
    const hit = WORKOUT_LIBRARY.find((p) => p.phases.includes(null) && p.intensities.includes(it));
    if (hit) return hit;
  }
  // ③ 兜底：通用恢复档（库里一定存在）
  return ANY_RECOVERY;
}

/** 方案总时长（分钟，四舍五入） */
export function planMinutes(plan: LibraryPlan): number {
  return Math.round(plan.steps.reduce((a, s) => a + s.seconds, 0) / 60);
}

/** 心率区间文案替换：headline 里的 {{hr}} → 「100–124 bpm」 */
export function fillHeartRate(plan: LibraryPlan): { headline: string; hrTarget: string } {
  const zone = HEART_ZONES[plan.hrZone] ?? HEART_ZONES[0];
  const hrTarget = zone.min === 0 ? `< ${zone.max} bpm` : `${zone.min}–${zone.max} bpm`;
  return { headline: plan.headline.replace(/\{\{hr\}\}/g, hrTarget), hrTarget };
}
