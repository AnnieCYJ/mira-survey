/**
 * quickCheckEstimate —— 「一键体检」估算领域层（纯函数，无 IO、无 store 依赖）
 * ---------------------------------------------------------------------------
 * 背景（2026-11-05 用户）：首次进入 App 时首页「今日状态」是空值，希望做一次
 * 一键体检后，基于「当前 1 分钟 / 30 秒的 HRV 读数」先估算出几个指标，
 * 让首页马上有当下的状态结果。
 *
 * ⚠ 口径铁律：估算就是估算，绝不冒充戒指实测。
 *   - `source: 'measured'`  = 戒指/后端真实回读（auto_data.status_score 等）
 *   - `source: 'estimated'` = 由 HRV 相对基线 + 心率 + 血氧 + 睡眠 + 交感推算
 *   每条结果都带 `reason`，界面必须据此标注来源。
 *
 * 本模块只做数值计算；数据读取（RingBle / healthStore）与持久化留在组装层。
 * ---------------------------------------------------------------------------
 */

export type QCSource = 'measured' | 'estimated';

export interface EstimateInput {
  /** 最近 60 秒 HRV 均值（ms，RMSSD 量级） */
  hrv60: number | null;
  /** 最近 30 秒 HRV 均值（ms） */
  hrv30: number | null;
  /** 近 7 天 HRV 基线（ms）；无基线时为 null */
  hrvBaseline: number | null;
  /** 当前/日均心率（次/分） */
  hr: number | null;
  /** 血氧（%） */
  spo2: number | null;
  /** 交感神经活跃度（gsr.sns 真实回读） */
  sns: number | null;
  /** 昨夜睡眠总时长（分钟） */
  sleepMin: number | null;
  /** 后端 auto_data.status_score：真实回读的今日状态分（0-100） */
  statusMeasured: number | null;
  /** Pro 健康一览实测压力（基础版无此通道 → null） */
  stressMeasured: number | null;
}

export interface EstimateValue {
  value: number;
  source: QCSource;
  /** 面向用户的来源说明（会直接显示在报告里） */
  reason: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function mean(nums: number[]): number | null {
  const ok = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** 计算 HRV 相对基线比：无基线时保守取 1.0（不虚高、不虚低）。 */
export function hrvRatio(i: EstimateInput): number | null {
  const now = i.hrv30 ?? i.hrv60;
  if (now == null || !Number.isFinite(now) || now <= 0) return null;
  if (i.hrvBaseline == null || i.hrvBaseline <= 0) return null;
  return clamp(now / i.hrvBaseline, 0.5, 1.6);
}

/**
 * 今日状态分（0-100）。
 * 优先用后端 status_score 实测；没有实测时，用本次现场心率 / 血氧 + 今天已同步的睡眠
 * 加权估算（★ 2026-11-13：体检报告不再引入当场测不了的 HRV）。
 * 全无输入则返回 null（界面显示「—」，绝不编数字）。
 */
export function estimateTodayStatus(i: EstimateInput): EstimateValue | null {
  if (i.statusMeasured != null && Number.isFinite(i.statusMeasured)) {
    return {
      value: Math.round(clamp(i.statusMeasured, 0, 100)),
      source: 'measured',
      reason: '综合多项生理信号给出的当下状态分；分数越高代表当前状态越平稳，看趋势比单次更有意义。',
    };
  }

  const ratio = hrvRatio(i);
  const hr = i.hr != null && i.hr > 0 ? i.hr : null;
  const spo2 = i.spo2 != null && i.spo2 > 0 ? i.spo2 : null;
  const sns = i.sns != null && i.sns > 0 ? i.sns : null;
  const sleep = i.sleepMin != null && i.sleepMin > 0 ? i.sleepMin : null;

  // 至少需要一项生理输入才敢给估算
  if (ratio == null && hr == null && spo2 == null && sns == null) return null;

  // 基准 55 分；HRV 相对基线贡献最大（±22），其余为小幅修正
  const hrvTerm = ratio != null ? (ratio - 1) * 44 : 0;
  const hrTerm = hr != null ? clamp((70 - hr) / 30, -1, 1) * 8 : 0;
  const spo2Term = spo2 != null ? clamp((spo2 - 97) / 3, -1, 1) * 6 : 0;
  const snsTerm = sns != null ? clamp((35 - sns) / 25, -1, 1) * 6 : 0;
  const sleepTerm = sleep != null ? clamp((sleep - 420) / 150, -1, 1) * 5 : 0;
  const shortTerm = i.hrv30 != null && i.hrv60 != null && i.hrv60 > 0
    ? clamp((i.hrv30 / i.hrv60 - 1) * 20, -5, 5)
    : 0;

  const raw = 55 + hrvTerm + hrTerm + spo2Term + snsTerm + sleepTerm + shortTerm;
  const value = Math.round(clamp(raw, 0, 100));

  const basis = [hr != null ? '心率' : null,
    spo2 != null ? '血氧' : null, sns != null ? '交感神经活跃度' : null,
    sleep != null ? '睡眠' : null].filter(Boolean).join(' / ');
  return {
    value,
    source: 'estimated',
    reason: `结合${basis}推算的当下状态分；分数反映当前恢复与平稳程度，连续佩戴几天后趋势会更稳定清晰。`,
  };
}

/**
 * 压力分（0-100，越高越紧张）。
 * Pro 有 healthGlance 实测压力 → 直接用；基础版该通道为空，
 * 用本次现场心率 + 交感活跃度推算，明确标注估算（不再引入 HRV）。
 */
export function estimateStress(i: EstimateInput): EstimateValue | null {
  if (i.stressMeasured != null && Number.isFinite(i.stressMeasured)) {
    return {
      value: Math.round(clamp(i.stressMeasured, 0, 100)),
      source: 'measured',
      reason: '戒指综合多项生理信号给出的压力分；分数越高代表越紧张，可结合当天节奏与放松安排观察。',
    };
  }

  const ratio = hrvRatio(i);
  const sns = i.sns != null && i.sns > 0 ? i.sns : null;
  const hr = i.hr != null && i.hr > 0 ? i.hr : null;
  if (ratio == null && sns == null && hr == null) return null;

  const hrvTerm = ratio != null ? (1 - ratio) * 40 : 0;
  const snsTerm = sns != null ? clamp((sns - 35) / 25, -1, 1) * 18 : 0;
  const hrTerm = hr != null ? clamp((hr - 70) / 30, -1, 1) * 8 : 0;
  const value = Math.round(clamp(45 + hrvTerm + snsTerm + hrTerm, 0, 100));

  const basis = [sns != null ? '交感神经活跃度' : null,
    hr != null ? '心率' : null].filter(Boolean).join(' / ');
  return {
    value,
    source: 'estimated',
    reason: `结合${basis}推算的压力分；分数越高代表越紧张，留意当天节奏、休息与放松安排。`,
  };
}

/** 把一组 TimePoint 按时间窗口取均值（用于 60s / 30s HRV 短窗）。 */
export function windowMean(points: { t: number; v: number }[] | null | undefined, windowMs: number, now = Date.now()): number | null {
  if (!points || !points.length) return null;
  const cut = now - windowMs;
  return mean(points.filter((p) => p.t >= cut && Number.isFinite(p.v)).map((p) => p.v));
}

/** 近 7 天 HRV 基线：给 daily 记录（dayKey -> value），忽略今天。 */
export function baselineFromDaily(daily: Record<string, number>, days = 7, now = Date.now()): number | null {
  const vals: number[] = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(now - d * 86400000);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const v = daily[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) vals.push(v);
  }
  return mean(vals);
}

/** 把状态分映射成首页同款档位词（与 CalmWaveHome 的 26/51/76 切点一致）。 */
export function statusLevel(v: number): string {
  if (v >= 76) return '元气满满';
  if (v >= 51) return '状态良好';
  if (v >= 26) return '平平静静';
  return '休息一下';
}
