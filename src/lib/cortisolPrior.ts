/**
 * cortisolPrior.ts —— 正常昼夜皮质醇节律先验 + 置信度收缩拟合
 * ---------------------------------------------------------------------------
 * ★ 2026-11-08（用户）：「现在少了些数据，趋势可能不是特别准确，需要拟合一个
 *   正常的昼夜节律皮质醇趋势，不要让它太夸张，可以参考一下开源算法」。
 *
 * 问题背景
 *   基础版戒指没有皮质醇 / EDA 皮电 / 独立体温传感器，lib/cortisolProxy.ts 的六路
 *   信号里实际只有 HRV + 静息心率 (+ 活动) 生效，有效权重和约 0.38。单路 z-score
 *   除以很小的 wsum 会被放大，再经 50+50·tanh(z/2) 打出去 → 曲线在 0~100 之间
 *   剧烈摆动、甚至顶格，和真实皮质醇「晨高夜低、平缓下降」的形状完全不像。
 *
 * 本模块的答案：**先给出生理学上「正常节律应该长什么样」，再用实测信号做温和修正**
 *   shaped[i] = prior[i] + w_i · clamp(measured[i] − prior[i], ±MAX_DEV)
 *   · w_i 由该槽的有效生理信号路数与个人基线天数决定 —— 数据越少 w 越小，
 *     越贴近正常形状；数据充分也封顶 0.70，不让单路噪声把曲线带飞。
 *   · 单槽偏离硬限幅 ±14（0–100 尺度），再叠 3 槽加权平滑，杜绝尖峰/锯齿。
 *   · 没有实测信号的槽 = 纯参考形状，并标 modeled=true（UI 必须浅色/虚线标注，
 *     绝不把它算进「节律正常/偏高/紊乱」的判定）。
 *   · 未来时段保持 null，不画未来。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 参考的开源算法 / 文献参数（本文件为独立 TS 实现，不引入任何依赖）
 * ════════════════════════════════════════════════════════════════════════
 *  1. CosinorPy — https://github.com/Mathias-Fuchs/CosinorPy
 *     单频 cosinor：y = MESOR + A·cos(2π(t−acrophase)/24)。项目 lib/cortisolRhythm.ts
 *     已有 fitCosinor 实现；这里用它的「相位」思想，但改为非对称相位映射。
 *  2. CortSineScore (Anza et al. 2025) — https://github.com/simone-anza/CortSineScore
 *     用正弦投影判断晨型/扁平/倒置；本模块的参考曲线即其 CSS>0 的「晨型正常」形状。
 *  3. Borbély–Achermann 谐波 / Postnova et al. 2012, Am J Physiol Endocrinol Metab
 *     「two-process model」C(t)=β(Σ aᵢ·sin(iπt/12−θ)+1)，a=[0.97,0.22,0.07,0.03]：
 *     晨峰陡、日间缓降、夜间低平 —— 纯对称余弦做不到，故这里用时间扭曲相位实现
 *     「谷→峰 8h 快升 / 峰→谷 16h 慢降」的非对称。
 *  4. mindful-coffee — https://github.com/aloth/mindful-coffee/blob/main/RESEARCH_BACKGROUND.md
 *     CAR 双指数：C(t)=C_base + A_CAR·(1−e^(−t/τ_rise))·e^(−t/τ_decay)。
 *     本模块 τ_rise=0.25h / τ_decay=1.8h → 峰值在醒后 ≈32min，对应
 *     Pruessner 1997 / Stalder 2016 的「醒后 30–45 分钟达峰」。
 *  5. Weitzman et al. 1971, J Clin Endocrinol Metab 33(1):14-22
 *     健康成人峰值 06:30–08:30、谷值午夜前后、峰/谷比 3–7。
 *     本模块 nadir=24 / peak=76 → 峰谷比 3.17，正落在该区间，且不顶 0/100。
 *
 * 诚实口径（不可突破）
 *   · 输出是 0–100 的「相对活性形状」，不是 μg/L、nmol/L 激素浓度，不做评分/诊断。
 *   · prior 是群体生理先验，不是这个人的测量结果；modeled 段必须在 UI 标注为参考。
 *   · 判定层（judgeCortisolRhythm / proxySummaryFromSlots / judgeCortisolRhythmForDay）
 *     必须继续只用 computeCortisolProxyDay 的原始 vals + real，绝不能吃 shaped 值，
 *     否则「用正常形状证明节律正常」就是循环论证。
 */

export const CORTISOL_PRIOR_SLOTS = 48;
const WINDOW_MIN = 30;
const DAY_MS = 86_400_000;

export interface CortisolPriorConfig {
  /** 一天拆成多少个槽（默认 48 = 30min） */
  slots: number;
  /** 晨峰时刻（小时，默认 8.0；随起床时间浮动 wakeHour+1） */
  acrophaseH: number;
  /** 起床时刻（小时，默认 7.0） */
  wakeHour: number;
  /** 参考曲线的谷值 / 峰值（0–100 相对活性） */
  nadir: number;
  peak: number;
  /** 单槽相对参考形状的最大偏离（0–100 尺度），防止实测噪声把曲线带飞 */
  maxDeviation: number;
  /** CAR（皮质醇觉醒反应）上冲幅度，归一化尺度 */
  carGain: number;
}

export const DEFAULT_CORTISOL_PRIOR: CortisolPriorConfig = {
  slots: CORTISOL_PRIOR_SLOTS,
  acrophaseH: 8.0,
  wakeHour: 7.0,
  nadir: 24,
  peak: 76,
  maxDeviation: 14,
  carGain: 0.10,
};

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function startOfToday(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/**
 * 正常昼夜皮质醇节律参考曲线（0–100 相对活性，长度 = slots）。
 *
 * 形状：00:00 最低 → 04:00 起 anticipatory rise → 醒后 ~30min CAR 上冲 →
 *       08:00 晨峰 → 全天缓慢下降 → 24:00 回到低谷。峰谷比 ≈ 3.2。
 * 非对称来自「谷→峰 8 小时、峰→谷 16 小时」的相位扭曲（Postnova 2012 两过程模型
 * 的谐波形状），而不是对称余弦 —— 对称余弦会把谷值错放到 20:00。
 */
export function normalCortisolPrior(opts: Partial<CortisolPriorConfig> = {}): number[] {
  const c = { ...DEFAULT_CORTISOL_PRIOR, ...opts };
  const acro = c.acrophaseH;
  const out: number[] = [];
  for (let i = 0; i < c.slots; i++) {
    const h = (i * 24) / c.slots;

    // ① 非对称昼夜主波：h=acro → +1（晨峰），h=0/24 → −1（午夜低谷）
    let phase: number;
    if (h >= acro) {
      phase = ((h - acro) / (24 - acro)) * Math.PI;       // 峰→谷 16h 慢降
    } else {
      phase = Math.PI + (h / acro) * Math.PI;              // 谷→峰 8h 快升
    }
    const wave = Math.cos(phase);                          // −1 .. +1

    // ② CAR 双指数上冲（mindful-coffee / Pruessner 1997），醒后 30–45min 达峰
    const dt = h - c.wakeHour;
    let car = 0;
    if (dt >= 0 && dt < 6) {
      // (1−e^(−t/0.25))·e^(−t/1.8) 峰值 ≈ 0.656 @ t≈0.53h（32min）
      car = c.carGain * (1 - Math.exp(-dt / 0.25)) * Math.exp(-dt / 1.8);
    }

    // ③ 归一到 [nadir, peak]，全程不顶 0/100（用户：不要让它太夸张）
    const x = clamp((wave + 1) / 2 + car, 0, 1);
    out.push(Math.round((c.nadir + (c.peak - c.nadir) * x) * 10) / 10);
  }
  return out;
}

export interface CortisolShapeOptions extends Partial<CortisolPriorConfig> {
  /** 指定日的本地 0 点 ms；默认按今天算（用于历史日整天不截断） */
  dayStartMs?: number;
  /** 当前时刻 ms，默认 Date.now()；落在 dayStartMs 当天时截断未来槽 */
  now?: number;
  /** 个人基线天数（≥3 才可信），用于置信度 */
  baselineDays?: number;
}

export interface ShapedCortisolSeries {
  /** 拟合后的展示曲线；modeled[i]=true 的槽是「参考形状」而非实测；未来槽 = null */
  vals: (number | null)[];
  /** 完整的正常节律参考曲线（供 UI 画浅色参考线） */
  prior: number[];
  /** 原始实测驱动值（判定层用这个，不是 vals） */
  raw: (number | null)[];
  /** true = 该槽没有任何实测信号，只有参考形状 */
  modeled: boolean[];
  /** 每槽的数据置信度 0–1 */
  confidence: number[];
  /** 全局置信度（UI 标注「数据充分 / 参考形状为主」用） */
  overallConfidence: number;
}

/**
 * 用正常节律先验对实测 proxy 曲线做置信度收缩拟合。
 *
 *  @param measured computeCortisolProxyDay(...) 的 vals（原始 0–100 活性）
 *  @param counts   同函数的 counts（该槽有效生理信号路数 0–6）
 *  @param baselineDays 个人基线天数
 */
export function shapeCortisolSeries(
  measured: (number | null)[],
  counts: number[],
  baselineDays = 0,
  opts: CortisolShapeOptions = {},
): ShapedCortisolSeries {
  const c = { ...DEFAULT_CORTISOL_PRIOR, ...opts };
  const n = c.slots;
  const prior = normalCortisolPrior(c);
  const now = opts.now ?? Date.now();
  const dayStart = opts.dayStartMs ?? startOfToday(now);
  const todayMode = now >= dayStart && now < dayStart + DAY_MS;
  const lastSlot = todayMode
    ? Math.floor((now - dayStart) / (WINDOW_MIN * 60_000))
    : n - 1;

  const baselineFactor = clamp((baselineDays ?? 0) / 14, 0, 1);
  const vals: (number | null)[] = [];
  const modeled: boolean[] = [];
  const confidence: number[] = [];
  const raw: (number | null)[] = [];

  for (let i = 0; i < n; i++) {
    const m = i < measured.length ? measured[i] : null;
    const cnt = i < counts.length ? counts[i] : 0;
    raw.push(m ?? null);

    if (i > lastSlot) {
      // 未来时段：不画、不编造
      vals.push(null); modeled.push(false); confidence.push(0);
      continue;
    }

    const hasReal = m != null && Number.isFinite(m) && cnt > 0;
    if (!hasReal) {
      // 无实测信号 → 只给参考形状，明确标记为 modeled（UI 必须浅色/虚线）
      vals.push(prior[i]); modeled.push(true); confidence.push(0);
      continue;
    }

    // 置信度：数据越少越贴近先验；即使信号满 + 基线满也只给 0.70
    const w = clamp(0.20 + 0.20 * Math.min(cnt, 3) + 0.10 * baselineFactor, 0.18, 0.70);
    const dev = clamp((m as number) - prior[i], -c.maxDeviation, c.maxDeviation);
    vals.push(Math.round((prior[i] + w * dev) * 10) / 10);
    modeled.push(false);
    confidence.push(Math.round(w * 100) / 100);
  }

  // ③ 3 槽 (1,2,1) 加权平滑：只平滑「有值且非未来」的相邻槽，消除单槽锯齿
  const smoothed = vals.slice();
  for (let i = 1; i < n - 1; i++) {
    const a = vals[i - 1], b = vals[i], d = vals[i + 1];
    if (a == null || b == null || d == null) continue;
    // 参考形状段不参与平滑，避免把已知的生理形状抹平
    if (modeled[i - 1] || modeled[i] || modeled[i + 1]) continue;
    smoothed[i] = Math.round(((a + 2 * b + d) / 4) * 10) / 10;
  }

  const validW = confidence.filter((w) => w > 0);
  const overallConfidence = validW.length
    ? Math.round((validW.reduce((a, b) => a + b, 0) / validW.length) * 100) / 100
    : 0;

  return {
    vals: smoothed,
    prior,
    raw,
    modeled,
    confidence,
    overallConfidence,
  };
}

/** 供 UI 复用的口径说明（避免每个卡片各写一套、措辞打架）。 */
export const CORTISOL_PRIOR_DISCLAIMER =
  '以健康成人正常昼夜节律为参考形状，再用你的实测信号做温和修正；浅色段为参考形状，不是检测值。';

export const CORTISOL_PRIOR_SHORT_NOTE =
  '晨间偏高、日间缓降、夜间回落是常见的节律形状，非激素浓度检测值。';
