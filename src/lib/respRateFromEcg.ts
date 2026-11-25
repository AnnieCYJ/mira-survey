/**
 * 从 ECG 波形估算呼吸率（BW 法：基线漂移 → 低通 → Goertzel 谱峰）。
 *
 * 背景：本机戒指固件在三条协议通道（EcgDetectState.br1/br2、EcgDetectResult.respRate、
 * Spo2hOriginData.respirationRate）均恒回 0，实测确认不是 App 没接。
 * 算法依据：Charlton et al. 2016 (RRest) 的 Baseline Wander 法——呼吸运动使 ECG
 * 基线产生 0.1~0.5Hz 的缓慢漂移，对波形低通后做该频段的谱分析即可得到呼吸率。
 * 本实现为独立实现（公开学术方法），未移植 GPL 开源代码，无第三方依赖。
 *
 * 验证：见 _qa/2026-11-18/rr_algorithm/rr_goertzel_proto.py（同流程 Python 原型）
 *   8 个场景（呼吸 10~24、心率 55~95、噪声 x3、弱调制、30s 短窗）误差全部 0 次/分。
 *   输入使用与原生 downsampleWave 相同的 min-max 保峰降采样 2000 点波形。
 */

export interface RespRateEstimate {
  /** 估算呼吸率（次/分），保留 1 位小数 */
  value: number;
  /** 谱峰显著度（峰值功率 / 频带功率中位数）；越高越可信，<2.5 视为不可信 */
  quality: number;
  /** 波形幅度标准差，用于判断导联/信号质量 */
  amplitudeStd: number;
  /** 调试信息 */
  debug: {
    points: number;
    sampleRate: number;
    durationSec: number;
    peakHz: number;
  };
}

const CFG = {
  /** 原生 ECG 固定测量 36 秒；波形经 min-max 降采样到 2000 点，等效采样率 = 点数/36 */
  defaultDurationSec: 36,
  minPoints: 400,
  /** 呼吸频段 0.10~0.50Hz = 6~30 次/分 */
  loHz: 0.1,
  hiHz: 0.5,
  scanStepHz: 0.0025,
  /** 一阶 RC 低通截止（Hz），级联 3 次；保留呼吸频段，削弱心电高频与噪点 */
  lowpassHz: 1.2,
  /** 输出合理区间（次/分） */
  minBpm: 5,
  maxBpm: 40,
  /** 质量阈值 */
  minQuality: 2.5,
  minAmplitudeStd: 0.01,
} as const;

/** 标准 Goertzel 算法：单频点归一化功率。无 FFT 依赖，仅需 0.1~0.5Hz 共 161 个频点。 */
function goertzelPower(x: Float64Array, freq: number, sampleRate: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (power * 4) / x.length;
}

/**
 * 从 ECG 波形估算呼吸率。
 * @param waveform 原生回传的 mV 波形（已降采样，min-max 保峰，通常 2000 点）
 * @param sampleRate 可选；默认按「波形点数 / 36 秒」推断（适配原生 downsampleWave）
 * @returns 估算结果；信号过短/幅度过小/谱峰不显著时返回 null（UI 应显示「—」）
 */
export function estimateRespRateFromEcg(
  waveform: number[] | Float64Array | null | undefined,
  sampleRate?: number,
): RespRateEstimate | null {
  if (!waveform || waveform.length < CFG.minPoints) return null;
  const n = waveform.length;

  // 1) 去均值 + 去除线性趋势（消除缓慢直流漂移）
  let mean = 0;
  for (let i = 0; i < n; i++) mean += Number(waveform[i]) || 0;
  mean /= n;
  let dot = 0;
  let t2 = 0;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (Number(waveform[i]) || 0) - mean;
    dot += i * x[i];
    t2 += i * i;
  }
  const slope = t2 > 0 ? dot / t2 : 0;
  let amplitudeSq = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= slope * i;
    amplitudeSq += x[i] * x[i];
  }
  const amplitudeStd = Math.sqrt(amplitudeSq / n);
  if (!Number.isFinite(amplitudeStd) || amplitudeStd < CFG.minAmplitudeStd) {
    if (typeof console !== 'undefined') {
      console.log(`[RR-EST-DIAG] reject LOW-AMP ampStd=${amplitudeStd.toFixed(5)} (thr ${CFG.minAmplitudeStd}) pts=${n}`);
    }
    return null;
  }

  // 2) 一阶 RC 低通级联 3 次（与 Python 原型逐行对齐）
  const fs = sampleRate && Number.isFinite(sampleRate) && sampleRate > 0
    ? sampleRate
    : n / CFG.defaultDurationSec;
  const dt = 1 / fs;
  const rc = 1 / (2 * Math.PI * CFG.lowpassHz);
  const a = dt / (rc + dt);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i];
  let prev = y[0];
  for (let pass = 0; pass < 3; pass++) {
    prev = y[0];
    for (let i = 0; i < n; i++) {
      prev += a * (y[i] - prev);
      y[i] = prev;
    }
  }
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += y[i];
  yMean /= n;
  for (let i = 0; i < n; i++) y[i] -= yMean;

  // 3) Goertzel 扫描呼吸频段
  const count = Math.floor((CFG.hiHz - CFG.loHz) / CFG.scanStepHz) + 1;
  const powers = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    powers[k] = goertzelPower(y, CFG.loHz + k * CFG.scanStepHz, fs);
  }

  // 4) 找谱峰 + 抛物线插值细化
  let peakIdx = 0;
  for (let k = 1; k < count; k++) if (powers[k] > powers[peakIdx]) peakIdx = k;
  let peakHz = CFG.loHz + peakIdx * CFG.scanStepHz;
  if (peakIdx > 0 && peakIdx < count - 1) {
    const p0 = powers[peakIdx - 1];
    const p1 = powers[peakIdx];
    const p2 = powers[peakIdx + 1];
    const denom = p0 - 2 * p1 + p2;
    if (denom < 0) {
      const delta = (0.5 * (p0 - p2)) / denom;
      if (Math.abs(delta) <= 1) peakHz += delta * CFG.scanStepHz;
    }
  }

  // 5) 质量判断：峰质比 + 结果区间
  const sorted = Array.from(powers).sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const quality = powers[peakIdx] / (median + 1e-12);
  const bpm = Math.round(peakHz * 60 * 10) / 10;
  if (quality < CFG.minQuality || bpm < CFG.minBpm || bpm > CFG.maxBpm) {
    if (typeof console !== 'undefined') {
      console.log(`[RR-EST-DIAG] reject bpm=${bpm} quality=${Math.round(quality * 10) / 10} ampStd=${amplitudeStd.toFixed(4)} peakHz=${peakHz.toFixed(4)} fs=${fs.toFixed(1)} (thr q>=${CFG.minQuality} bpm ${CFG.minBpm}-${CFG.maxBpm})`);
    }
    return null;
  }

  return {
    value: bpm,
    quality: Math.round(quality * 10) / 10,
    amplitudeStd: Math.round(amplitudeStd * 1000) / 1000,
    debug: {
      points: n,
      sampleRate: Math.round(fs * 10) / 10,
      durationSec: Math.round((n / fs) * 10) / 10,
      peakHz: Math.round(peakHz * 1000) / 1000,
    },
  };
}
