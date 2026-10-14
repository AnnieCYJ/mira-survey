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

/** 权重（计入时合计 = 实际权重和，不强制 1.0）。
 *  HRV 与 EDA 是最直接的两路交感证据，权重最高。
 *  ★ v-fix：移除 sleepDebt（原 0.08）——调用方从未传入 sleepDeficit，长期为死权重；
 *    睡眠债对 HPA 的影响已在「晨起认知准备度」中体现，intraday proxy 不再重复计入。
 *
 *  ★ 2026-10-08（融合设备真实皮质醇）：新增 `cortisol` 真值路，权重 0.30（金标准）。
 *    新增后，当某日有真实 `cortisol`(μg/L) 数据时，该路 z-score 直接并入合成；
 *    当**没有**真值数据（旧数据 / 不支持 GSR 的设备）时，该路自动不计入 wsum，
 *    且其余 5 路按 0.7 同比例缩放 → z = raw/wsum 数学上与原纯 proxy **完全等价**（向后兼容，零破坏）。
 *    原 5 路权重按 0.70 缩放：hrv 0.28→0.20 / eda 0.26→0.18 / temp 0.20→0.14 / rhr 0.16→0.11 / activity 0.10→0.07。 */
export const PROXY_WEIGHTS = {
  hrv: 0.20,
  eda: 0.18,
  temp: 0.14,
  rhr: 0.11,
  activity: 0.07,
  /** 设备真实皮质醇浓度(μg/L)，每 ~20s 点测一次。直接测量，比 HRV/EDA 反推更可信。 */
  cortisol: 0.30,
} as const;

/** 体温绝对参考：人体外周皮温正常带（℃）。偏离此带的幅度用于打分。 */
const TEMP_REF_LOW = 35.4;
const TEMP_REF_HIGH = 37.2;

/** 皮电/GSR 接入说明（重要）：App 经原生桥拿到的 `eda` 实际是 Veepoo GSR 的
 *  `skin_moisture`（厂商归一化值，量程 1~99，**不是** μS 电导，详见 HK18 协议逆向）。
 *  因此不再用「μS 量级绝对地板」假设，改为量程有效性判断：
 *  越界（脱戴 / 接触不良 / 未初始化）即剔除；量程内则按个人基线做相对 z-score。 */
const EDA_MIN = 1;   // skin_moisture 合法区间下限
const EDA_MAX = 99;  // skin_moisture 合法区间上限

/** 一个窗口（分钟）。与 App 内「全天 30min 曲线」一致。 */
export const WINDOW_MIN = 30;
/** 一天 48 个窗口。 */
export const SLOTS_PER_DAY = (24 * 60) / WINDOW_MIN;
/** 一天的毫秒数。 */
const DAY_MS = 86400000;

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
  bySlot: { hrv: (number | null)[]; eda: (number | null)[]; temp: (number | null)[]; rhr: (number | null)[]; cortisol: (number | null)[] };
  /** 48 长度，每槽的稳健尺度（该槽 MAD×1.4826） */
  scalesBySlot: { hrv: (number | null)[]; eda: (number | null)[]; temp: (number | null)[]; rhr: (number | null)[]; cortisol: (number | null)[] };
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

// ★ 2026-10-14：基线按「窗口天数|当日 dayKey」缓存（过去日期的 intraday 不可变 → 缓存安全）。
//   修复洞察页/昼夜节律详情页反复重扫 14 天 intraday 导致的进页卡顿：同一份基线只算一次，
//   后续刷新（每 ~700ms）与再次进入页面直接命中缓存。
const _baselineCache = new Map<string, ProxyBaseline>();
const _BASELINE_CACHE_MAX = 8;

export function buildCortisolProxyBaseline(days = 14, now: number = Date.now()): ProxyBaseline {
  const _bkey = `${days}|${hsDayKey(now)}`;
  const _cached = _baselineCache.get(_bkey);
  if (_cached) return _cached;
  const N = Math.max(MIN_BASELINE_DAYS, days);
  // ★ v18.143：桶内存 `WeightedSample`（带 daysAgo）而不是裸 number，
  //   中心估计量改「截尾加权均值」—— 近 2–5 天的数据权重更高。
  //   依据：Garmin「rolling 25-night average, weighted toward recent values」/
  //        Oura「puts more weight on recent days」，详见 lib/recencyBaseline.ts。
  const hrvBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const edaBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const tempBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const rhrBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const cortisolBySlot: WeightedSample[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  const hrvAll: WeightedSample[] = [];
  const edaAll: WeightedSample[] = [];
  const tempAll: WeightedSample[] = [];
  const rhrAll: WeightedSample[] = [];
  const cortisolAll: WeightedSample[] = [];
  const stepAll: number[] = [];
  const dayHas = new Set<string>();
  let used = 0;

  for (let i = 1; i <= N; i++) {
    const dk = hsDayKey(now - i * 86400000);
    let dayHasReal = false;
    const midnight = parseDayKeyMs(dk);

    const push = (
      key: 'hrv' | 'eda' | 'temp' | 'hr' | 'cortisol',
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
    // ★ 2026-10-08：设备真实皮质醇(μg/L)，每 ~20s 一个真值点，1 个样本即可计入
    push('cortisol', cortisolBySlot, cortisolAll, 1);
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
    cortisol: perSlot(cortisolBySlot, cortisolAll),
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
    cortisol: scaleBySlot(cortisolBySlot, cortisolAll),
  };

  const _result: ProxyBaseline = {
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
  _baselineCache.set(_bkey, _result);
  // 简单 FIFO：超出上限时删除最早插入的键（Map 保留插入顺序）
  if (_baselineCache.size > _BASELINE_CACHE_MAX) {
    const _first = _baselineCache.keys().next().value;
    if (_first !== undefined) _baselineCache.delete(_first);
  }
  return _result;
}

// ── 核心：反推全天皮质醇活性 ────────────────────────────────────────────

/**
 * 计算指定日期的 48 槽皮质醇活性曲线。
 * **每个槽独立由该窗口的实测信号算出**；没有实测信号 → null（不填补、不画虚线）。
 */
export function computeCortisolProxyDay(
  dk: string,
  baseline: ProxyBaseline,
  opts?: { now?: number },
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
  // ★ 2026-10-08：设备真实皮质醇(μg/L)，每 ~20s 一个真值点，由原生桥 upsertRealtime('cortisol') 写入
  const cortisolAll = healthStore.getIntraday('cortisol', dk).filter((p) => Number.isFinite(p.v) && p.v > 0);

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
    const cortisolWin = mean(inWin(cortisolAll));

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
    // EDA：正相（皮肤湿度/皮电反应高 → 交感皮肤反应活跃）
    // ⚠ 尺度下限 2（相对单位）：MAD 过小会放大噪声，必须达到最小离散度才纳入。
    const blEda = baseline.bySlot.eda[i] ?? baseline.eda;
    const scEda = baseline.scalesBySlot.eda[i] ?? null;
    if (edaWin != null && blEda != null && scEda != null && scEda >= 2) {
      // 量程有效性：skin_moisture 合法区间 [1,99]，越界视为脱戴/接触不良，不计入
      // （不再用绝对「地板」假设，避免把偏低但有效的读数整路剔除 → 解决 EDA 整路失效风险）
      if (edaWin >= EDA_MIN && edaWin <= EDA_MAX) {
        raw += PROXY_WEIGHTS.eda * ((edaWin - blEda) / scEda);
        wsum += PROXY_WEIGHTS.eda;
        physN++;
      }
    }
    // ★ 2026-10-08 修正（用户实锤「融合没生效 / 波形跟戒指对不上」）：
    //   原 `scCort >= 5` 尺度门槛太严——戒指每 20s 测一次、日内极稳，跨天同槽 MAD 通常只有 1~3 μg/L，
    //   门槛 5 几乎永远过不了 → 真实皮质醇**从未真正并入融合**，今天曲线其实只由 HRV/EDA/体温算出，
    //   自然跟戒指反馈的皮质醇波形对不上。现改为：
    //   · 有稳健尺度(>=1.5)就用它；否则回退到固定生理参考尺度 6 μg/L（≈一次典型昼夜摆幅的 1/3）。
    //   · 这样只要「有真实皮质醇值 + 该槽有基线」(≥1 个先前日样本) 就必定并入，且权重最高(0.30)。
    //   没有真值（旧数据 / 不支持 GSR 设备）时 blCort=null → 该路跳过 → 自然回退纯 proxy（数学等价）。
    const blCort = baseline.bySlot.cortisol[i] ?? null;
    const scCortRaw = baseline.scalesBySlot.cortisol[i] ?? null;
    const scCort = scCortRaw != null && scCortRaw >= 1.5 ? scCortRaw : 6;
    if (cortisolWin != null && blCort != null) {
      raw += PROXY_WEIGHTS.cortisol * ((cortisolWin - blCort) / scCort);
      wsum += PROXY_WEIGHTS.cortisol;
      physN++;
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
  opts?: { now?: number },
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
 * ★ 2026-10-08：14 天皮质醇「融合活性」基线（与今日曲线**同口径、同单位 0~100**）。
 *
 * 为什么需要（用户实锤「趋势图波形跟戒指反馈对不上」）：
 *   洞察页趋势图此前把「今天(融合活性 0~100)」和「14 天基线(原始 μg/L 均值)」画在同一张图——
 *   两套量纲、一把尺，基线(μg/L, 个位数)被压在底部、今天线占满高度，天然错位。
 *   本函数把基线也变成融合活性：逐天用统一基线算当日活性，跨天同槽取中位 → 48 长度基线。
 *   这样「今天 vs 14 天基线」才是同一把尺、可比，且今天的活性因皮质醇权重最高会直接跟随戒指波形。
 *
 * 实现：统一基线（过去 N 天、不含今天）算一次，再对过去 N 天各自算当日活性、按槽聚合中位。
 * 某槽若所有历史日都没数据 → null（断线，与今日一致，不编造）。
 */
export function buildCortisolBaselineActivity(days = 14, now: number = Date.now()): (number | null)[] {
  const N = Math.max(MIN_BASELINE_DAYS, days);
  const base = buildCortisolProxyBaseline(N, now); // 统一基线（过去 N 天，不含今天）
  const perSlot: (number | null)[][] = Array.from({ length: SLOTS_PER_DAY }, () => []);
  for (let i = 1; i <= N; i++) {
    const dk = hsDayKey(now - i * DAY_MS);
    const thatDayEnd = parseDayKeyMs(dk) + DAY_MS - 1; // 该日完整结束时刻 → 算满整天
    const { vals } = computeCortisolProxyDay(dk, base, { now: thatDayEnd });
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      if (vals[s] != null && Number.isFinite(vals[s])) perSlot[s].push(vals[s]);
    }
  }
  return perSlot.map((arr) => {
    const nums = arr.filter((x): x is number => x != null);
    return nums.length ? medianOf(nums) : null;
  });
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


/**
 * ★ 2026-10-08（用户实锤：洞察页「昼夜节律」卡片判「节律紊乱」，点进详情页大字却写「节律正常」）
 *   —— 两处各写了一套判定：卡片用 proxy 实测槽的「均值 / 振幅 / 峰值时刻」，
 *   详情页却拿 `proxySummaryFromSlots(...).mesor` 只分偏高/正常（永远判不出紊乱）。
 *   现收敛成**唯一入口**：卡片 tile、卡片 AI 分析、详情页 Hero、详情页区间聚合都调它，
 *   同一份 proxy 实测槽必得同一结论。
 */
export type CortisolRhythmLabel = '皮质醇偏高' | '节律紊乱' | '节律正常';

/** 判定所需的最少实测槽：4（与 cosinor 的 n>=4 同门槛），低于此值不下结论 */
export const MIN_RHYTHM_SLOTS = 4;

export interface CortisolRhythmJudgement {
  /** 实测槽是否够判 */
  ready: boolean;
  /** 实测槽均值（四舍五入），无数据 = null */
  avg: number | null;
  peakIdx: number;
  peakV: number;
  /** 峰值所在小时（0~24 小数） */
  peakH: number | null;
  /** 峰值时刻 HH:MM */
  peakClock: string;
  /** 峰值时段（>=峰值 90% 的连续实测槽）HH:MM–HH:MM；无 = null */
  peakWindow: string | null;
  label: CortisolRhythmLabel | null;
  /** 副文案：一句话说清凭什么这么判 */
  sub: string;
}

const _hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * 皮质醇节律判读（数据铁律：只依据实测槽，绝不编造）：
 *  - 有效实测槽 < minSlots → ready=false, label=null（UI 显「—」）
 *  - 均值 >= 62 → 「皮质醇偏高」
 *  - 昼夜振幅过小（峰值-谷值 < 12）→ 「节律紊乱」（全天平线，没有正常高低差）
 *  - 峰值时刻异常（< 5 点或 > 23 点）→ 「节律紊乱」（峰值不在正常清醒时段）
 *  - 其余 → 「节律正常」
 */
export function judgeCortisolRhythm(
  vals: (number | null)[],
  real: boolean[],
  minSlots: number = MIN_RHYTHM_SLOTS,
): CortisolRhythmJudgement {
  const idxs: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (real[i] && v != null && Number.isFinite(v)) idxs.push(i);
  }
  const empty: CortisolRhythmJudgement = {
    ready: false, avg: null, peakIdx: -1, peakV: -Infinity, peakH: null,
    peakClock: '—', peakWindow: null, label: null, sub: '暂无皮质醇数据',
  };
  if (idxs.length < minSlots) return empty;

  const vs = idxs.map((i) => vals[i] as number);
  const avgRaw = vs.reduce((a, b) => a + b, 0) / vs.length;
  const avg = Math.round(avgRaw);
  let peakIdx = idxs[0];
  let peakV = vs[0];
  idxs.forEach((i, k) => { if (vs[k] > peakV) { peakV = vs[k]; peakIdx = i; } });
  const trough = Math.min(...vs);
  const amp = peakV - trough;
  const peakH = peakIdx / 2;
  const peakClock = _hhmm(peakH * 60);

  // 峰值时段：>= 峰值 90% 且实测的连续槽段（槽 i 覆盖 [i*30, i*30+30) 分钟）
  const thr = peakV * 0.9;
  const near = (i: number) => i >= 0 && i < vals.length && real[i] && vals[i] != null && (vals[i] as number) >= thr;
  let s = peakIdx, e = peakIdx;
  while (near(s - 1)) s--;
  while (near(e + 1)) e++;
  const peakWindow = `${_hhmm(s * 30)}–${_hhmm((e + 1) * 30)}`;

  let label: CortisolRhythmLabel;
  if (avgRaw >= 62) label = '皮质醇偏高';
  else if (amp < 12) label = '节律紊乱';
  else if (peakH < 5 || peakH > 23) label = '节律紊乱';
  else label = '节律正常';

  let sub: string;
  if (label === '皮质醇偏高') sub = `全天均值 ${avg}/100 · 高于个人基线`;
  else if (label === '节律紊乱') sub = (peakH < 5 || peakH > 23) ? `峰值 ${peakClock} · 偏离正常时段` : '昼夜高低差不足 · 全天平线';
  else sub = `峰值时段 ${peakWindow}`;

  return { ready: true, avg, peakIdx, peakV, peakH, peakClock, peakWindow, label, sub };
}

// ── 单日皮质醇节律判读：跨页唯一入口（睡眠恢复页 & 洞察页昼夜节律详情页共用）──
const dayRhythmForDayCache = new Map<string, { abn: boolean; kind: 'normal' | 'high' | 'late' }>();

/**
 * ★ 2026-10-10（统一睡眠恢复页与洞察页「皮质醇异常日」口径）：
 *   单日判定唯一入口。睡眠恢复页（SleepDetailScreen）的周/月/年异常日标记与「异常天数」统计，
 *   以及洞察页昼夜节律详情页（EmotionCognitiveDetailScreen）的节律日历，全部调它 ——
 *   同一份 proxy 实测槽 + 同一套 judgeCortisolRhythm 阈值，两处异常天数必然逐位一致。
 *
 * 规则（与 judgeCortisolRhythm 完全同口径）：
 *   · 基线不足 3 天（days < MIN_BASELINE_DAYS）→ 判不出 → 视为正常（不标异常）；
 *   · 「节律紊乱」→ 异常（任何一天）；
 *   · 「皮质醇偏高」→ 仅**今天**算异常（历史日偏高不可信，与洞察页节律日历一致）；
 *   · 其余（节律正常）→ 正常。
 */
export function judgeCortisolRhythmForDay(
  dk: string,
  isToday: boolean,
): { abn: boolean; kind: 'normal' | 'high' | 'late' } {
  const key = `${dk}|${isToday}`;
  const hit = dayRhythmForDayCache.get(key);
  if (hit) return hit;
  let out: { abn: boolean; kind: 'normal' | 'high' | 'late' } = { abn: false, kind: 'normal' };
  try {
    const dayMs = parseDayKeyMs(dk) + DAY_MS - 1; // 该日完整结束时刻 → 算满整天
    const pbl = buildCortisolProxyBaseline(14, dayMs);
    if (pbl.days >= MIN_BASELINE_DAYS) {
      const px = buildCortisolProxyToday(pbl, { now: dayMs });
      const j = judgeCortisolRhythm(px.vals, px.real);
      if (j.label) {
        const kind: 'normal' | 'high' | 'late' =
          j.label === '皮质醇偏高' ? 'high' : j.label === '节律紊乱' ? 'late' : 'normal';
        out = {
          abn: j.label === '节律紊乱' || (isToday && j.label === '皮质醇偏高'),
          kind,
        };
      }
    }
  } catch {
    out = { abn: false, kind: 'normal' };
  }
  dayRhythmForDayCache.set(key, out);
  return out;
}
