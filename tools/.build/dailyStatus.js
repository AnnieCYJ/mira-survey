"use strict";
/**
 * dailyStatus —— 「今日状态」恢复就绪度算法（Phase 1 实现）
 *
 * 设计原则（来自 docs/daily-status-algorithm-spec-v1.md）：
 *  1. 恢复就绪度单轴：今日状态只回答"今天恢复得怎么样"，运动负荷独立成轴，不扣分。
 *  2. 晨间锚点 ± 日间修正（Phase 1 仅晨间锚点，日间修正为 Phase 2）。
 *  3. 相位专属基线：所有带周期波动的指标（HRV/RHR/sleep）相对"用户自己同相位历史中位"评分，
 *     相位差异被基线完全吸收，无显式 phase_adjustment 项（彻底避免双重惩罚）。
 *  4. 不造假：只使用戒指真测或可严谨推导的量；SDK sleep_score 量纲不明 → 自算。
 *  5. 展示层归一化：内部 raw_readiness 经经验 CDF 映射为均匀 0–100 展示分（=你在自身历史的百分位），
 *     档位切点设在百分位 65/30/5 → 不足≈5%（稀有且严肃）。
 *
 * 本模块为纯 TS、零 react-native 依赖，可被 node 直接单测。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaselineStore = exports.ALGO_DEFAULTS = void 0;
exports.isSameDay = isSameDay;
exports.computeSleepScore = computeSleepScore;
exports.mapLevel = mapLevel;
exports.computeDailyStatus = computeDailyStatus;
/** Phase 1 标定初值（依据 spec §12 真实回放方向：提高下行灵敏度 + 顶部阈值上调 + 归一化层） */
exports.ALGO_DEFAULTS = {
    ANCHOR: 70,
    K_HRV: 120,
    HRV_DOWN_GAIN: 1.6,
    K_RHR: 100,
    W_HRV: 0.4,
    W_RHR: 0.25,
    W_SLEEP: 0.35,
    TARGET_DURATION: 450, // 7.5h
    TARGET_DEEP_PCT: 20,
    TARGET_GETUP: 1,
    W_D: 0.35,
    W_DEEP: 0.35,
    W_G: 0.3,
    HRV_ARTIFACT_MAX: 120,
    HRV_ARTIFACT_MIN: 15,
    LEVEL_TOP: 65,
    LEVEL_MID: 30,
    LEVEL_LOW: 5,
    MIN_PHASE_SAMPLES: 8,
    MIN_GLOBAL_SAMPLES: 8,
    MIN_DAYS: 30,
};
const LIT = {
    follicular: { hrv: 50, rhr: 58, sleep: 75 },
    ovulation: { hrv: 55, rhr: 56, sleep: 76 },
    luteal: { hrv: 45, rhr: 62, sleep: 72 }, // 整段黄体期取晚期偏保守值
    period: { hrv: 47, rhr: 60, sleep: 70 },
    unknown: { hrv: 50, rhr: 59, sleep: 74 },
};
/** 判断两个时间戳是否同一天（本地时区） */
function isSameDay(t, now) {
    const a = new Date(t);
    const b = new Date(now);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// ─────────────────────────────────────────────────────────────────────────────
// 统计工具
// ─────────────────────────────────────────────────────────────────────────────
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function median(arr) {
    if (arr.length === 0)
        return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
/** 中位数 + MAD 过滤（剔除 |x−median| > k×MAD），再取过滤后中位。HRV 偏态稳健。 */
function madMedian(values, k = 3) {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length === 0)
        return NaN;
    const med = median(clean);
    const absdev = clean.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = absdev.length % 2 ? absdev[Math.floor(absdev.length / 2)] : (absdev[absdev.length / 2 - 1] + absdev[absdev.length / 2]) / 2;
    if (mad === 0)
        return med;
    const filtered = clean.filter((v) => Math.abs(v - med) <= k * 1.4826 * mad);
    return median(filtered.length ? filtered : clean);
}
function computeSleepScore(s, c) {
    var _a, _b;
    if (!s.sleepTotal || s.sleepTotal <= 0)
        return 0;
    const durNorm = clamp(s.sleepTotal / c.TARGET_DURATION, 0, 1);
    const total = s.sleepTotal;
    const deepPct = (((_a = s.sleepDeep) !== null && _a !== void 0 ? _a : 0) / total) * 100;
    const deepNorm = clamp(deepPct / c.TARGET_DEEP_PCT, 0, 1);
    const getUpNorm = clamp(1 - ((_b = s.getUp) !== null && _b !== void 0 ? _b : 0) / c.TARGET_GETUP, 0, 1);
    const v = 100 * (c.W_D * durNorm + c.W_DEEP * deepNorm + c.W_G * getUpNorm);
    return clamp(v, 0, 100);
}
// ─────────────────────────────────────────────────────────────────────────────
// 相位专属基线系统
// ─────────────────────────────────────────────────────────────────────────────
class BaselineStore {
    constructor(history, c) {
        var _a;
        this.c = c;
        const phases = ['follicular', 'ovulation', 'luteal', 'period', 'unknown'];
        this.byPhase = {};
        this.globalAll = { hrv: [], rhr: [], sleep: [] };
        for (const p of phases) {
            this.byPhase[p] = { hrv: [], rhr: [], sleep: [] };
        }
        // 发烧日永不计入基线（spec §9）
        for (const r of history) {
            if (r.fever)
                continue;
            const bucket = (_a = this.byPhase[r.phase]) !== null && _a !== void 0 ? _a : this.byPhase.unknown;
            if (r.hrv != null) {
                bucket.hrv.push(r.hrv);
                this.globalAll.hrv.push(r.hrv);
            }
            if (r.rhr != null) {
                bucket.rhr.push(r.rhr);
                this.globalAll.rhr.push(r.rhr);
            }
            if (r.sleepTotal != null && r.sleepTotal > 0) {
                const sv = computeSleepScore(r, c);
                if (sv > 0) {
                    bucket.sleep.push(sv);
                    this.globalAll.sleep.push(sv);
                }
            }
        }
        this.dayCount = history.filter((r) => !r.fever).length;
    }
    /** 返回某指标在某相位的基线值 + 来源（同相位个人 → 全局个人 → 文献群体） */
    baselineFor(metric, phase) {
        var _a, _b;
        const phaseArr = ((_a = this.byPhase[phase]) !== null && _a !== void 0 ? _a : this.byPhase.unknown)[metric];
        const globalArr = this.globalAll[metric];
        if (phaseArr.length >= this.c.MIN_PHASE_SAMPLES && this.dayCount >= this.c.MIN_DAYS) {
            return { value: madMedian(phaseArr), source: 'phase' };
        }
        if (globalArr.length >= this.c.MIN_GLOBAL_SAMPLES) {
            return { value: madMedian(globalArr), source: 'global' };
        }
        const lit = (_b = LIT[phase]) !== null && _b !== void 0 ? _b : LIT.unknown;
        return { value: metric === 'hrv' ? lit.hrv : metric === 'rhr' ? lit.rhr : lit.sleep, source: 'lit' };
    }
}
exports.BaselineStore = BaselineStore;
// ─────────────────────────────────────────────────────────────────────────────
// 单项评分
// ─────────────────────────────────────────────────────────────────────────────
function scoreHrv(hrv, base, c) {
    const ratio = hrv / base;
    const dev = ratio - 1;
    const gain = dev >= 0 ? 1 : c.HRV_DOWN_GAIN; // 低于基线不对称放大
    return clamp(c.ANCHOR + dev * c.K_HRV * gain, 0, 100);
}
function scoreRhr(rhr, base, c) {
    const ratio = rhr / base;
    // 静息比基线低 15%（ratio≈0.85）为最优区
    return clamp(c.ANCHOR - (ratio - 0.85) * c.K_RHR, 0, 100);
}
// ─────────────────────────────────────────────────────────────────────────────
// 归一化层（内部 raw → 均匀 0–100 展示分 = 自身历史百分位）
// ─────────────────────────────────────────────────────────────────────────────
function normalizeToScore(raw, historyRaw, phase, c) {
    const valid = historyRaw.filter((v) => Number.isFinite(v));
    if (valid.length >= 10) {
        const below = valid.filter((v) => v <= raw).length;
        return clamp((below / valid.length) * 100, 0, 100);
    }
    // 冷启动：用文献参考作为分布中心，按 ±1sd ≈ ±45 百分位映射
    const litMed = LIT[phase] ? (LIT[phase].hrv + LIT[phase].rhr + LIT[phase].sleep) / 3 : 70;
    const pct = 50 + ((raw - litMed) / 18) * 45;
    return clamp(pct, 2, 98);
}
// ─────────────────────────────────────────────────────────────────────────────
// 4 级映射
// ─────────────────────────────────────────────────────────────────────────────
function mapLevel(score, c) {
    if (score >= c.LEVEL_TOP) {
        return { level: '充沛', index: 0, advice: '状态良好，可安排重要工作' };
    }
    if (score >= c.LEVEL_MID) {
        return { level: '平稳', index: 1, advice: '处于正常波动，按节奏推进' };
    }
    if (score >= c.LEVEL_LOW) {
        return { level: '偏低', index: 2, advice: '需要主动休息，建议轻活动' };
    }
    return { level: '不足', index: 3, advice: '今日恢复差，优先休息' };
}
const PHASE_LABEL = {
    period: '经期',
    follicular: '卵泡期',
    ovulation: '排卵期',
    luteal: '黄体期',
    unknown: '未记录',
};
function computeDailyStatus(opts) {
    var _a, _b, _c;
    const c = (_a = opts.consts) !== null && _a !== void 0 ? _a : exports.ALGO_DEFAULTS;
    const { input, history, cycle } = opts;
    const phase = cycle.phase;
    const hasData = input.hrv != null || input.rhr != null || ((_b = input.sleep.sleepTotal) !== null && _b !== void 0 ? _b : 0) > 0;
    if (!hasData) {
        return {
            rawReadiness: null,
            score: null,
            level: null,
            levelIndex: null,
            advice: null,
            phaseLabel: PHASE_LABEL[phase],
            phaseBucket: phase,
            dayInCycle: cycle.dayInCycle,
            hasLog: cycle.hasLog,
            baselineSource: 'lit',
            hasData: false,
            narrative: cycle.hasLog ? '今日佩戴数据不足，暂无法评估恢复状态' : '记录经期并连续佩戴几天后，开启今日状态评估',
        };
    }
    const store = new BaselineStore(history, c);
    const parts = [];
    let baselineSource = 'lit';
    if (input.hrv != null) {
        const b = store.baselineFor('hrv', phase);
        baselineSource = b.source;
        parts.push({ w: c.W_HRV, v: scoreHrv(input.hrv, b.value, c) });
    }
    if (input.rhr != null) {
        const b = store.baselineFor('rhr', phase);
        if (b.source === 'lit' && baselineSource !== 'phase' && baselineSource !== 'global')
            baselineSource = 'lit';
        else if (b.source === 'global' && baselineSource === 'lit')
            baselineSource = 'global';
        else if (b.source === 'phase')
            baselineSource = 'phase';
        parts.push({ w: c.W_RHR, v: scoreRhr(input.rhr, b.value, c) });
    }
    if (((_c = input.sleep.sleepTotal) !== null && _c !== void 0 ? _c : 0) > 0) {
        const b = store.baselineFor('sleep', phase);
        if (b.source === 'phase')
            baselineSource = 'phase';
        else if (b.source === 'global' && baselineSource === 'lit')
            baselineSource = 'global';
        const sv = computeSleepScore(input.sleep, c);
        parts.push({ w: c.W_SLEEP, v: sv });
    }
    const wsum = parts.reduce((a, p) => a + p.w, 0);
    const rawReadiness = wsum > 0 ? parts.reduce((a, p) => a + p.w * p.v, 0) / wsum : 0;
    // 历史 rawReadiness（用于百分位归一化）
    const historyRaw = history
        .filter((r) => !r.fever && r.rawReadiness != null)
        .map((r) => r.rawReadiness);
    const score = normalizeToScore(rawReadiness, historyRaw, phase, c);
    const lvl = mapLevel(score, c);
    // 叙事：与过去同期的自己比（百分位语义）
    let narrative;
    const phaseText = cycle.hasLog ? `你目前处于${PHASE_LABEL[phase]}（周期第 ${cycle.dayInCycle} 天）` : '你目前尚未记录经期';
    if (baselineSource === 'lit') {
        narrative = `${phaseText}，今日状态基于群体基线估算`;
    }
    else {
        narrative = `${phaseText}，今日恢复水平优于过去约 ${Math.round(score)}% 的日子`;
    }
    return {
        rawReadiness,
        score,
        level: lvl.level,
        levelIndex: lvl.index,
        advice: lvl.advice,
        phaseLabel: PHASE_LABEL[phase],
        phaseBucket: phase,
        dayInCycle: cycle.dayInCycle,
        hasLog: cycle.hasLog,
        baselineSource,
        hasData: true,
        narrative,
    };
}
