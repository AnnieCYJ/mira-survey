/**
 * cortisolProxy.ts —— 皮质醇活性反推（多模态，纯前端 TS，可单测）
 *
 * ════════════════════════════════════════════════════════════════════════
 *  为什么是「反推活性」而不是「皮质醇值」
 * ════════════════════════════════════════════════════════════════════════
 *  戒指（Veepoo HK18）**没有皮质醇传感器**。消费级设备全部是反推的，业界口径一致：
 *   · Garmin（Firstbeat 专有算法）：HRV(RMSSD) + 呼吸率 + 活动上下文 → 0~100 压力分
 *   · Oura：HRV + **体温偏移** + 活动 → Readiness；夜间体温↑ + HRV↓ ⇒「生理唤醒升高」
 *   · WHOOP：HRV + RHR + 呼吸 + 睡眠分期 →「皮质醇模型」= 识别 HPA 轴激活的**模式**，不量化浓度
 *  学术验证的诚实数字（说明「绝对值不可信、趋势方向可用」）：
 *   · Garmin 压力分 vs 实测唾液皮质醇 r = 0.29~0.71（实验室环境上限）
 *   · Body Battery vs 晨起皮质醇 r = 0.52（n=127, 2024 Psychoneuroendocrinology）
 *  唯一能真测的方案是实验室级硬件（Nature Communications SQC-SAS 汗液 aptamer 生物传感器）。
 *
 *  ⇒ 结论（本模块的设计前提）：
 *    1. 输出**不叫「皮质醇值」**，叫「皮质醇活性」（0~100，**相对个人基线**）。
 *    2. 输出**全程由实测信号驱动**（HRV / EDA / 体温 / 静息心率 / 活动 / 睡眠结构），
 *       **不再用 cosinor 拟合曲线填补缺失时段**（v18.114 的虚线已废弃）。
 *    3. 某窗口缺信号 → 该窗口**没有值**（null），UI 显示空，不编造。
 *
 * ════════════════════════════════════════════════════════════════════════
 *  算法：z-score 加权合成 + 个人基线归一
 * ════════════════════════════════════════════════════════════════════════
 *  每个 30 分钟窗口，对六路信号各自算「相对个人基线的偏离」：
 *
 *    信号          方向    生理学依据                                采集率
 *    ─────────────────────────────────────────────────────────────────────
 *    HRV           反相     迷走张力↓ → 交感占优 → HPA 激活            每分钟（高）
 *    EDA/皮电      正相     汗腺受交感神经直接支配                      佩戴时（高）
 *    体温偏移      正相     下丘脑体温设定点上移 = 交感激活             5min（高）
 *    静息心率偏移  正相     交感激活 → 心率升高                         高
 *    活动强度      负相     运动会短暂压制 HPA，需从中扣除               高
 *    睡眠结构      晨间基线 深睡/REM 不足 → 次日晨间 HPA 失调          每日
 *
 *  每路信号 z = (窗口值 − 个人基线中位数) / (个人基线 MAD×1.4826)，并按方向取符号。
 *  合成：raw = Σ(wᵢ·zᵢ) / Σwᵢ，再压到 0~100：`50 + 50·tanh(raw/2)`
 *  （tanh 而非线性，保证「偏离越大增幅越缓」，不出现某一项极端时总分爆表）
 *
 *  为什么用 MAD 而不是标准差：中位数绝对偏差对生理信号的离群点（漏检/运动伪迹）稳健得多。
 *  为什么 z-score 直接相加：各信号量纲不同（HRV ms / 皮电 μS / 体温 ℃），
 *  归一化后加权和是标准的「多模态融合」做法（与 WHOOP/Garmin 的多输入模型同思路）。
 *
 *  体温为什么进模型：Oura 的 Readiness 明确把**体温偏移**作为主要权重之一，
 *  且有 2024 年研究显示夜间体温升高 + HRV 抑制对应皮质醇失调。
 */

import { healthStore, dayKey as hsDayKey } from '../data/healthStore';
// ★ v18.143：与 emotionalStress 共用同一套时间加权基线（口径必须一致，
//   否则「皮质醇说偏高、心理压力说正常」这类自相矛盾会再次出现）。
import {
  weightedCenter, weightedRobustScale, type WeightedSample,
} from './recencyBaseline';

// ── 常量 ────────────────────────────────────────────────────────────────

/** 权重（合计 1.0）。HRV 与 EDA 是最直接的两路交感证据，权重最高。 */
export const PROXY_WEIGHTS = {
  hrv: 0.26,
  eda: 0.24,
  temp: 0.18,
  rhr: 0.14,
  activity: 0.10,
  sleepDebt: 0.08,
} as const;

/** 体温绝对参考：人体外周皮温正常带（℃）。偏离此带的幅度用于打分。 */
const TEMP_REF_LOW = 35.4;
const TEMP_REF_HIGH = 37.2;

/** 皮电/GSR 绝对参考（μS 量级）：低于 20 视为极静息。 */
const EDA_FLOOR = 20;

/** 一个窗口（分钟）。与 App 内「全天 30min 曲线」一致。 */
export const WINDOW_MIN = 30;
/** 一天 48 个窗口。 */
export const SLOTS_PER_DAY = (24 * 60) / WINDOW_MIN;

export interface CortisolProxySample {
  /** 绝对 epoch ms */
  t: number;
  /** 皮质醇活性 0~100（相对个人基线） */
  v: number;
  /** 该窗口参与合成的信号数（0~6），用于「数据够不够」的诚实标注 */
  n: number;
}

export interface ProxyBaseline {
  /** 全池中位（诊断/回退用；实际计算用 bySlot 的时段基线） */
  hrv: number | null;
  eda: number | null;
  temp: number | null;
  rhr: number | null;
  stepBaseline: number;
  /** 参与构建基线的天数（0 = 还没有） */
  days: number;
  /** ★ v18.117：是否达到最小天数门槛（≥3 天）。不足时 UI 应显示「建立基线中」而不是给假数 */
  ready: boolean;
  /** ★ v18.117：48 长度，每槽的时段基线（该槽在近 N 天的中位数）——皮质醇有强昼夜节律，必须同时段比较 */
  bySlot: { hrv: (number | null)[]; eda: (number | null)[]; temp: (number | null)[]; rhr: (number | null)[] };
  /** 48 长度，每槽的稳健尺度（该槽 MAD×1.4826） */
  scalesBySlot: { hrv: (number | null)[]; eda: (number | null)[]; temp: (number | null)[]; rhr: (number | null)[] };
  /** 实际参与基线的日期（诊断用） */
  daysUsed: string[];
}

// ── 统计工具 ────────────────────────────────────────────────────────────

function medianOf(vals: number[]): number | null {
  const v = vals.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** MAD × 1.4826 ≈ 正态分布下的 σ；对离群点稳健。样本少时回退到 (P75−P25)/1.349。 */
function robustScaleOf(vals: number[]): number | null {
  const v = vals.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const med = medianOf(v)!;
  const mad = medianOf(v.map((x) => Math.abs(x - med)))!;
  const sigma = mad * 1.4826;
  if (sigma > 1e-6) return sigma;
  // MAD 退化（大量重复值）→ 用四分位距兜底
  const q1 = quantileOf(v, 0.25);
  const q3 = quantileOf(v, 0.75);
  const iqr = (q3 - q1) / 1.349;
  return iqr > 1e-6 ? iqr : null;
}

function quantileOf(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = (sorted.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 'YYYY-MM-DD' → 当天本地 0 点 ms。 */
function parseDayKeyMs(dk: string): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dk);
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

// ── 个人基线 ────────────────────────────────────────────────────────────

/**
 * 建立个人基线：默认近 14 天（业界通行窗口；Oura/Garmin 均以多日滚动个人基线为参照系）。
 * 只用**实测** HRV/EDA/体温/静息心率，不用任何推算值 —— 基线必须是真数据。
 *
 * ★ v18.117 三处修正（用户追问「基线算得对不对、多少天」后自查发现）：
 *  1. **窗口不含今天**（`i = 1..days`，起点是昨天）。皮质醇活性算的是「今天相对自己的偏离」，
 *     基准必须**排除今天**，否则今天的活动/压力会把自己的基线拉高，偏离被系统性低估。
 *  2. **加权到「时段中位数」而非全池中位数**：皮质醇本身有强昼夜节律（凌晨高、午后低），
 *     若把 24 小时的样本混在一起取中位数，得到的基线会被白天样本主导，
 *     凌晨窗口永远算成「偏高」。正确做法是**同一时段跨天比较**：
 *     对每个 30min 槽，取该槽在近 N 天的中位数作为该槽的基线。
 *  3. **最小天数门槛**：`MIN_BASELINE_DAYS = 3`。不足 3 天时 z-score 不可靠（尺度是 MAD 估的），
 *     返回 `ready:false` 让 UI 显示「建立基线中」而不是给一个假基线下的数。
 *
 *  返回的 `bySlot` 是 48 长度的每槽基线；`medianBySlot` 供诊断/回退用。
 */
export const MIN_BASELINE_DAYS = 3;

export function buildCortisolProxyBaseline(days = 14, now: number = Date.now()): ProxyBaseline {
  const N = Math.max(MIN_BASELINE_DAYS, days);
  // ★ v18.143：桶内存 `WeightedSample`（带 daysAgo）而不是裸 number，
  //   中心估计量改「截尾加权均值」—— 近 2–5 天的数据权重更高。
  //   依据：Garmin「rolling 25-night average, weighted toward recent values」/
  //        Oura「puts more weight on recent days」，详见 lib/recencyBaseline.ts。
  const hrvBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const edaBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const tempBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const rhrBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const hrvAll: WeightedSample[] = [];
  const edaAll: WeightedSample[] = [];
  const tempAll: WeightedSample[] = [];
  const rhrAll: WeightedSample[] = [];
  const stepAll: number[] = [];
  const dayHas = new Set<string>();
  let used = 0;

  for (let i = 1; i <= N; i++) {
    const dk = hsDayKey(now - i * 86400000);
    let dayHasReal = false;
    const midnight = parseDayKeyMs(dk);

    const push = (
      key: 'hrv' | 'eda' | 'temp' | 'hr',
      buckets: WeightedSample[][],
      pool: WeightedSample[],
      minSamples: number,
      useP10 = false,
    ) => {
      const arr = healthStore.getIntraday(key, dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
      if (arr.length < minSamples) return;
      for (const p of arr) {
        const slot = Math.floor((p.t - midnight) / (WINDOW_MIN * 60000));
        if (slot >= 0 && slot < SLOTS_PER_DAY) buckets[slot].push({ v: p.v, daysAgo: i });
        pool.push({ v: p.v, daysAgo: i });
      }
      dayHasReal = true;
    };

    push('hrv', hrvBySlot, hrvAll, 1);
    push('eda', edaBySlot, edaAll, 3);
    push('temp', tempBySlot, tempAll, 3);
    // 心率：静息近似取该槽内最低值，聚合成长度不足则跳过
    {
      const arr = healthStore.getIntraday('hr', dk).filter((p) => Number.isFinite(p.v) && p.v > 0);
      if (arr.length >= 10) {
        for (const p of arr) {
          const slot = Math.floor((p.t - midnight) / (WINDOW_MIN * 60000));
          if (slot >= 0 && slot < SLOTS_PER_DAY) rhrBySlot[slot].push({ v: p.v, daysAgo: i });
        }
        const sorted = arr.map((p) => p.v).sort((a, b) => a - b);
        const p10 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.1))];
        rhrAll.push({ v: p10, daysAgo: i });
        dayHasReal = true;
      }
    }

    const steps = healthStore.getIntraday('steps', dk).reduce((s, p) => s + p.v, 0);
    if (steps > 0) stepAll.push(steps);
    if (dayHasReal) { used++; dayHas.add(dk); }
  }

  // 每槽基线：该槽在近 N 天的**截尾加权均值**；该槽天数不足则回退到全池
  const perSlot = (buckets: WeightedSample[][], pool: WeightedSample[]): (number | null)[] => {
    const globalCenter = weightedCenter(pool);
    return buckets.map((arr) => {
      if (arr.length === 0) return globalCenter;
      // 该槽至少 2 天样本才用槽级基线，否则回退全局
      return arr.length >= 2 ? weightedCenter(arr) : globalCenter;
    });
  };

  const bySlot = {
    hrv: perSlot(hrvBySlot, hrvAll),
    eda: perSlot(edaBySlot, edaAll),
    temp: perSlot(tempBySlot, tempAll),
    rhr: perSlot(rhrBySlot, rhrAll),
  };

  // 尺度也按槽算（每槽的**加权** MAD），回退到全池尺度
  const scaleBySlot = (buckets: WeightedSample[][], pool: WeightedSample[]): (number | null)[] => {
    const globalScale = weightedRobustScale(pool);
    return buckets.map((arr) => {
      if (arr.length < 2) return globalScale;
      return weightedRobustScale(arr) ?? globalScale;
    });
  };
  const scalesBySlot = {
    hrv: scaleBySlot(hrvBySlot, hrvAll),
    eda: scaleBySlot(edaBySlot, edaAll),
    temp: scaleBySlot(tempBySlot, tempAll),
    rhr: scaleBySlot(rhrBySlot, rhrAll),
  };

  return {
    hrv: weightedCenter(hrvAll),
    eda: weightedCenter(edaAll),
    temp: weightedCenter(tempAll),
    rhr: weightedCenter(rhrAll),
    stepBaseline: stepAll.length > 0 ? stepAll.reduce((a, b) => a + b, 0) / stepAll.length : 4000,
    days: used,
    ready: used >= MIN_BASELINE_DAYS,
    bySlot,
    scalesBySlot,
    daysUsed: Array.from(dayHas).sort(),
  };
}

// ── 核心：反推全天皮质醇活性 ────────────────────────────────────────────

/**
 * 计算指定日期的 48 槽皮质醇活性曲线。
 * **每个槽独立由该窗口的实测信号算出**；没有实测信号 → null（不填补、不画虚线）。
 */
export function computeCortisolProxyDay(
  dk: string,
  baseline: ProxyBaseline,
  opts?: { now?: number; sleepDeficit?: number | null },
): { vals: (number | null)[]; counts: number[] } {
  const W = WINDOW_MIN * 60000;
  const [y, m, d] = dk.split('-').map((x) => parseInt(x, 10));
  const midnight = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const now = opts?.now ?? Date.now();

  const hrAll = healthStore.getIntraday('hr', dk).filter((p) => p.v > 0);
  const hrvAll = healthStore.getIntraday('hrv', dk).filter((p) => p.v > 0);
  const edaAll = healthStore.getIntraday('eda', dk).filter((p) => p.v > 0);
  const tempAll = healthStore.getIntraday('temp', dk).filter((p) => p.v > 0);
  const stepAll = healthStore.getIntraday('steps', dk).filter((p) => p.v > 0);

  const vals: (number | null)[] = [];
  const counts: number[] = [];
  const lastSlot = Math.floor((now - midnight) / W);

  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    // 未来槽位不产出
    if (i > lastSlot) { vals.push(null); counts.push(0); continue; }
    const wStart = midnight + i * W;
    const wEnd = wStart + W;
    const inWin = (arr: { t: number; v: number }[]) => arr.filter((p) => p.t >= wStart && p.t < wEnd);
    const mean = (arr: { t: number; v: number }[]) =>
      arr.length ? arr.reduce((a, p) => a + p.v, 0) / arr.length : null;

    const hrvWin = mean(inWin(hrvAll));
    const edaWin = mean(inWin(edaAll));
    const tempWin = mean(inWin(tempAll));
    const hrWin = mean(inWin(hrAll));
    const stepWin = inWin(stepAll).reduce((a, p) => a + p.v, 0);

    // 活动强度 0~1（相对个人日步量基线）
    const activity = baseline.stepBaseline > 0 ? clamp01(stepWin / (baseline.stepBaseline / 48)) : 0;

    // ── 逐路 z-score（已按生理方向取符号）──
    let raw = 0;
    let wsum = 0;
    // physN 只数「真实生理信号」（HRV/EDA/体温/心率），活动与睡眠债是行为项不算 ——
    // UI 用它标注「这个槽是实测的还是只有行为推断」。
    let physN = 0;

    // HRV：反相（HRV 低于个人基线 → 交感占优 → 活性↑）
    // ⚠ 尺度下限 3 ms：HRV 的 MAD 在佩戴稳定时可能很小，同样会放大噪声。
    // ★ v18.117：用**该时段**的基线（跨天同一槽比较），不是全池中位数
    const blHrv = baseline.bySlot.hrv[i] ?? baseline.hrv;
    const scHrv = baseline.scalesBySlot.hrv[i] ?? null;
    if (hrvWin != null && blHrv != null && scHrv != null && scHrv >= 3) {
      raw += PROXY_WEIGHTS.hrv * ((blHrv - hrvWin) / scHrv);
      wsum += PROXY_WEIGHTS.hrv;
      physN++;
    }
    // EDA：正相（皮电高 → 汗腺交感激活）
    // ⚠ 尺度下限 2 μS：同上，MAD 过小会放大噪声。
    const blEda = baseline.bySlot.eda[i] ?? baseline.eda;
    const scEda = baseline.scalesBySlot.eda[i] ?? null;
    if (edaWin != null && blEda != null && scEda != null && scEda >= 2) {
      // 低于 EDA_FLOOR 视为极静息/未佩戴，不计入（否则无佩戴时段会变成噪声）
      if (edaWin >= EDA_FLOOR) {
        raw += PROXY_WEIGHTS.eda * ((edaWin - blEda) / scEda);
        wsum += PROXY_WEIGHTS.eda;
        physN++;
      }
    }
    // 体温偏移：正相。
    // ⚠ v18.116 修正（实测发现值域整体顶到 63~99，几乎满分）：
    //   原实现拿**群体绝对参考带中线 36.3℃** 做基准，而实测个人基线中位是 **37.1℃**
    //   → 每个窗口都带 +5σ 固定正偏置，把整条曲线推到天花板。
    //   体温的个体差异远大于日内波动（有人常年 36.4、有人 37.2），所以**必须以个人基线为基准**，
    //   只把「相对自己偏高/偏低」当激活信号。绝对带只用于**兜底合理性检查**（超出生理范围才标记异常）。
    const blTemp = baseline.bySlot.temp[i] ?? baseline.temp;
    if (tempWin != null && blTemp != null) {
      const scT = baseline.scalesBySlot.temp[i];
      const scale = scT != null && scT >= 0.05 ? scT : 0.15;
      const devTemp = (tempWin - blTemp) / scale;
      // 超出生理带（35.4~37.4）时额外加压：明显偏离体温调节范围属于生理应激
      const outOfBand = tempWin < TEMP_REF_LOW || tempWin > TEMP_REF_HIGH + 0.2;
      raw += PROXY_WEIGHTS.temp * (devTemp + (outOfBand ? 1.5 : 0));
      wsum += PROXY_WEIGHTS.temp;
      physN++;
    }
    // 静息心率偏移：正相（相对个人基线偏高 → 交感激活）
    // ⚠ 尺度下限 2 bpm：实测 MAD 只有 0.185 bpm（近 4 天静息心率极稳），
    //   不设下限会把 1 bpm 的正常波动放大成 5 个 σ → 分数乱跳。
    const blRhr = baseline.bySlot.rhr[i] ?? baseline.rhr;
    if (hrWin != null && blRhr != null && hrWin > blRhr) {
      const scR = baseline.scalesBySlot.rhr[i];
      const scale = scR != null && scR >= 2 ? scR : 2;
      raw += PROXY_WEIGHTS.rhr * ((hrWin - blRhr) / scale);
      wsum += PROXY_WEIGHTS.rhr;
      physN++;
    }
    // 活动：负相（运动会短暂压制 HPA，活动中反而不应判为高活性）
    raw += PROXY_WEIGHTS.activity * (-activity * 1.2);
    wsum += PROXY_WEIGHTS.activity;

    // 睡眠债：晨间基线修正（深睡/REM 不足 → 次日 HPA 失调）。仅在 09:00 后生效
    const hourOfDay = (wStart - midnight) / 3600000;
    if (opts?.sleepDeficit != null && Number.isFinite(opts.sleepDeficit) && hourOfDay >= 9) {
      // sleepDeficit: 0 = 睡眠充足，1 = 严重不足
      raw += PROXY_WEIGHTS.sleepDebt * ((opts.sleepDeficit - 0.5) * 1.4);
      wsum += PROXY_WEIGHTS.sleepDebt;
    }

    // ★ 一路生理信号都没有 → 该窗口没有实测支撑 → null（不编造、不画虚线）
    if (physN === 0 || wsum <= 0) { vals.push(null); counts.push(0); continue; }

    const z = raw / wsum;
    // tanh 压缩：偏离越大增幅越缓，避免单项极端把总分打爆
    const v = 50 + 50 * Math.tanh(z / 2);
    vals.push(Math.max(0, Math.min(100, Math.round(v * 10) / 10)));
    counts.push(physN);
  }

  return { vals, counts };
}

/** 当日 30 分钟活性序列（UI 入口）。 */
export function buildCortisolProxyToday(
  baseline?: ProxyBaseline,
  opts?: { now?: number; sleepDeficit?: number | null },
): { vals: (number | null)[]; counts: number[]; real: boolean[]; baseline: ProxyBaseline } {
  const bl = baseline ?? buildCortisolProxyBaseline();
  const dk = hsDayKey(opts?.now ?? Date.now());
  const { vals, counts } = computeCortisolProxyDay(dk, bl, opts);
  // ★ 「实测」= 该槽真的有**生理信号**（HRV/EDA/体温/心率之一），不是只靠活动/睡眠债凑出来的。
  //   映射要按下标走（不能 counts.indexOf，值重复时会串位）。
  const real = counts.map((c, i) => c > 0 && vals[i] != null);
  return { vals, counts, real, baseline: bl };
}

/**
 * ★ v18.124：从 48 槽实测活性直接算「水平 / 峰值时刻 / 波动幅度」，**不做 cosinor 拟合**。
 *
 * 为什么需要（用户实锤「详情页下面的分析数据都是杠」）：
 *   详情页的「平均压力水平 / 平均峰值时刻」读的是 `r.cosinor.mesor` 与 `r.cosinor.acrophaseH`，
 *   而新算法（proxy）产出的活性曲线**没有做 cosinor 拟合** → 这两个字段是 NaN → 页面显示「—」。
 *   两种修法：① 硬把 proxy 结果硬塞进 cosinor（等于又拟合一次、且输入是反推值）；
 *   ② 承认「proxy 曲线不需要拟合也能给出水平与峰值」——**直接统计实测槽**即可，更诚实也更快：
 *     · mesor     = 实测槽的平均活性（就是「全天压力水平」）
 *     · acrophaseH= 活性最高那一槽的小时（就是「峰值时刻」，**实测值不是拟合值**）
 *     · amplitude = (max − min) / mesor（相对波动幅度）
 *   注意：这里的峰值是**实测槽的峰值**，样本稀疏时不如拟合平滑，但绝不含编造成分。
 */
export function proxySummaryFromSlots(
  vals: (number | null)[],
  real: boolean[],
): { mesor: number | null; acrophaseH: number | null; amplitudePct: number | null; n: number } {
  const pairs: { i: number; v: number }[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (real[i] && v != null && Number.isFinite(v)) pairs.push({ i, v });
  }
  if (pairs.length === 0) return { mesor: null, acrophaseH: null, amplitudePct: null, n: 0 };
  const vs = pairs.map((p) => p.v);
  const mesor = vs.reduce((a, b) => a + b, 0) / vs.length;
  const peak = pairs.reduce((a, b) => (b.v > a.v ? b : a), pairs[0]);
  const amplitudePct = mesor > 0 ? (Math.max(...vs) - Math.min(...vs)) / mesor : null;
  return {
    mesor: Math.round(mesor * 10) / 10,
    acrophaseH: Math.round((peak.i / 2) * 100) / 100,
    amplitudePct: amplitudePct != null ? Math.round(amplitudePct * 100) : null,
    n: pairs.length,
  };
}
