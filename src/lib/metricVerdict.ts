/**
 * 指标「正常 / 偏高 / 偏低」判定 —— 全 App 单一真相源（2026-11-25）
 *
 * 口径纪律：
 *  - 有临床通用标准的，按临床标准：血压 WHO/ISH 六档、空腹血糖 3.9–6.1、
 *    血脂 TC<5.2 / TG<1.7 / HDL≥1.0 / LDL<3.4、尿酸 155–428、
 *    静息心率 60–100、血氧 ≥95/90–94/<90、BMI 中国成人 18.5–23.9、
 *    体脂率女 20–30%（男 10–20%）、身体水分 50–65%、静息呼吸 12–20。
 *  - 没有临床统一线的设备指数（压力/疲劳/皮肤含水量/交感/HRV/身体年龄等）
 *    沿用工程既有分档，标为「状态词」而不是医学正常异常；不确定的一律不标。
 *  - 只输出短标签 + 语义色（好/警示/异常/中性），颜色统一走 theme.colors.ui.status。
 */

export type VerdictTone = 'good' | 'warn' | 'danger' | 'neutral';

export interface Verdict {
  label: string;
  tone: VerdictTone;
}

const good = (label: string): Verdict => ({ label, tone: 'good' });
const warn = (label: string): Verdict => ({ label, tone: 'warn' });
const danger = (label: string): Verdict => ({ label, tone: 'danger' });

/** 血压 WHO/ISH 六档：收缩压/舒张压取更重的一档。 */
export function bpStageOf(sys: number, dia: number): Verdict {
  const s = sys >= 180 ? 6 : sys >= 160 ? 5 : sys >= 140 ? 4 : sys >= 130 ? 3 : sys >= 120 ? 2 : 1;
  const d = dia >= 110 ? 6 : dia >= 100 ? 5 : dia >= 90 ? 4 : dia >= 85 ? 3 : dia >= 80 ? 2 : 1;
  const stage = Math.max(s, d);
  switch (stage) {
    case 1: return good('理想');
    case 2: return good('正常');
    case 3: return warn('正常高值');
    case 4: return danger('高血压 1 级');
    case 5: return danger('高血压 2 级');
    default: return danger('高血压 3 级');
  }
}

/** 由指标 key + 数值取判定；无标准或无效值返回 null（卡片上就不显示标记）。 */
export function verdictFor(key: string, raw: number | null | undefined): Verdict | null {
  const v = typeof raw === 'number' ? raw : Number(raw);
  if (raw == null || !Number.isFinite(v)) return null;

  switch (key) {
    // 静息心率 60–100（<60 常见于运动员/深度睡眠，标「偏低」但不做异常结论）
    case 'hr':
    case 'ecg':
      if (v < 60) return warn('偏低');
      if (v > 100) return danger('偏高');
      return good('正常');

    case 'spo2':
      if (v >= 95) return good('正常');
      if (v >= 90) return warn('偏低');
      return danger('偏低');

    // 血糖：空腹 3.9–6.1；不知道是否空腹时，6.1–7.8 只提示「高于空腹值」，≥7.8 才标偏高。
    // 按卡片显示的一位小数判定，避免「显示 6.1、标高于空腹值」这种自相矛盾。
    case 'glucose':
    case 'bloodSugar': {
      const r = Math.round(v * 10) / 10;
      if (r < 3.9) return danger('偏低');
      if (r <= 6.1) return good('正常');
      if (r < 7.8) return warn('高于空腹值');
      return danger('偏高');
    }

    case 'cholesterol':
      return v < 5.2 ? good('正常') : warn('偏高');
    case 'triglyceride':
      return v < 1.7 ? good('正常') : warn('偏高');
    case 'hdl':
      return v >= 1.0 ? good('正常') : warn('偏低');
    case 'ldl':
      return v < 3.4 ? good('正常') : warn('偏高');
    case 'ua':
    case 'uricAcid':
      if (v < 155) return warn('偏低');
      if (v <= 428) return good('正常');
      return warn('偏高');

    case 'bpSys':
      if (v < 90) return warn('偏低');
      if (v < 120) return good('正常');
      if (v < 130) return good('正常');
      if (v < 140) return warn('正常高值');
      return danger('偏高');
    case 'bpDia':
      if (v < 60) return warn('偏低');
      if (v < 80) return good('正常');
      if (v < 85) return good('正常');
      if (v < 90) return warn('正常高值');
      return danger('偏高');

    // 中国成人 BMI：18.5–23.9 正常，24–27.9 超重，≥28 肥胖
    case 'bmi':
      if (v < 18.5) return warn('偏瘦');
      if (v <= 23.9) return good('正常');
      if (v < 28) return warn('超重');
      return danger('肥胖');
    case 'bodyFatPercentage':
      // 产品面向女性；男性口径由 examStore.statusFor 按性别处理
      if (v < 20) return warn('偏低');
      if (v <= 30) return good('正常');
      return warn('偏高');
    case 'waterContent':
      if (v < 50) return warn('偏低');
      if (v <= 65) return good('正常');
      return warn('偏高');

    // 静息呼吸率 12–20 次/分（来自 ECG 附带值）
    case 'respRate':
    case 'rr':
      if (v < 12) return warn('偏低');
      if (v <= 20) return good('正常');
      return warn('偏高');

    // 以下为设备自身分档，不是临床正常线
    case 'stress':
      if (v < 30) return good('放松');
      if (v < 60) return good('正常');
      if (v < 80) return warn('中等');
      return danger('偏高');
    case 'fatigue':
      if (v < 30) return good('较低');
      if (v < 55) return good('适中');
      return warn('偏高');
    case 'skin':
      if (v < 40) return warn('偏干');
      if (v <= 65) return good('适中');
      return good('润泽');
    case 'sns':
      if (v < 30) return good('较低');
      if (v < 55) return good('正常');
      return warn('偏高');

    default:
      return null;
  }
}

/** 指标 key → 说明弹窗 key；返回 null 表示该指标没有说明入口。 */
export function infoKeyFor(key: string): string | null {
  const map: Record<string, string> = {
    hr: 'hrDay', ecg: 'ecg', rr: 'respRate', respRate: 'respRate',
    spo2: 'spo2Day', hrv: 'hrvDay', temp: 'temp',
    bloodSugar: 'glucose', glucose: 'glucose',
    cholesterol: 'cholesterol', triglyceride: 'triglyceride', hdl: 'hdl', ldl: 'ldl',
    uricAcid: 'uricAcid', ua: 'uricAcid',
    bpSys: 'bp', bpDia: 'bp', bp: 'bp',
    stress: 'stress', fatigue: 'fatigue', emotion: 'emotion', skin: 'skin', sns: 'sns',
    cortisol: 'cortisolIndex', depressionRisk: 'depressionRisk',
    bmi: 'bmi', bodyFatPercentage: 'bodyFat', waterContent: 'water',
    fatMass: 'fatMass', leanBodyMass: 'leanBodyMass', muscleMass: 'muscleMass',
    muscleRate: 'muscleRate', skeletalMuscleRate: 'skeletalMuscleRate',
    subcutaneousFat: 'subcutaneousFat', boneMass: 'boneMass',
    proteinAmount: 'proteinAmount', basalMetabolicRate: 'basalMetabolicRate',
    sleepScore: 'sleepScore', steps: 'activity', distance: 'activity', calorie: 'activity',
    eda: 'eda', sleepTotal: 'duration', sleepDeep: 'deep', sleepRem: 'rem',
  };
  return map[key] ?? null;
}
