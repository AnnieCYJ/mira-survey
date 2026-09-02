"use strict";
/**
 * cycleMath —— 女性周期推算（纯函数，无副作用、可单测）
 *
 * 设计原则：戒指硬件只能测皮肤体温（随激素波动、排卵后双相升高）；
 * 雌激素/孕激素/LH、排卵期、经期预测本身不是戒指直测，需要「用户记录上次经期」
 * + 「基于体温趋势与标准周期模型的算法」推算。本模块只做算法，不编任何数据。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDate = parseDate;
exports.dayKey = dayKey;
exports.addDays = addDays;
exports.daysBetween = daysBetween;
exports.computeCycle = computeCycle;
const MS_DAY = 86400000;
function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
/** 生成与 RingBleManager.dayKeyOf 同款的 key：'YYYY-M-D'（无前导零） */
function dayKey(d) {
    const dt = typeof d === 'number' ? new Date(d) : d;
    return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
}
function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return dayKey(d);
}
function daysBetween(a, b) {
    return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_DAY);
}
const PHASE_LABEL = {
    period: '经期',
    follicular: '卵泡期',
    ovulation: '排卵期',
    luteal: '黄体期',
};
function computeCycle(log, today = new Date()) {
    const tKey = dayKey(today);
    if (!log || !log.lastPeriodStart) {
        return {
            hasLog: false,
            dayInCycle: null,
            phase: 'unknown',
            phaseLabel: '未记录',
            ovulationDate: null,
            fertilityStart: null,
            fertilityEnd: null,
            nextPeriodDate: null,
            daysToNextPeriod: null,
            daysToOvulation: null,
        };
    }
    const cycleLength = Math.max(20, Math.min(45, log.cycleLength || 28));
    const luteal = Math.max(9, Math.min(20, log.lutealLength || 14));
    const periodLen = Math.max(2, Math.min(10, log.periodLength || 5));
    let offset = daysBetween(log.lastPeriodStart, tKey);
    // 若上次经期在未来（误输入），回退到一个周期内
    if (offset < 0)
        offset = ((offset % cycleLength) + cycleLength) % cycleLength;
    const dayInCycle = (offset % cycleLength) + 1;
    const ovulationOffset = cycleLength - luteal; // 排卵日 = 周期第 (cycleLength-luteal) 天
    const ovulationDate = addDays(log.lastPeriodStart, ovulationOffset);
    const fertilityStart = addDays(ovulationDate, -5);
    const fertilityEnd = addDays(ovulationDate, 1);
    // 阶段判定（优先级：经期 > 排卵期窗口 > 黄体期 > 卵泡期）
    let phase;
    if (offset >= 0 && offset < periodLen)
        phase = 'period';
    else if (Math.abs(daysBetween(ovulationDate, tKey)) <= 2)
        phase = 'ovulation';
    else if (daysBetween(ovulationDate, tKey) > 0)
        phase = 'luteal';
    else
        phase = 'follicular';
    // 下次经期：从 lastPeriodStart 累加 cycleLength 直到落在今天之后
    let next = log.lastPeriodStart;
    while (daysBetween(next, tKey) >= 0)
        next = addDays(next, cycleLength);
    const daysToNextPeriod = daysBetween(tKey, next);
    const daysToOvulation = daysBetween(tKey, ovulationDate);
    return {
        hasLog: true,
        dayInCycle,
        phase,
        phaseLabel: PHASE_LABEL[phase],
        ovulationDate,
        fertilityStart,
        fertilityEnd,
        nextPeriodDate: next,
        daysToNextPeriod,
        daysToOvulation,
    };
}
