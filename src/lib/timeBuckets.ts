/**
 * timeBuckets —— 全 App「按固定时间桶聚合」的唯一出口（2026-10-10 建立）
 *
 * ★ 为什么建这个：改心率详情页为 Oura 风格全天柱状小条时发现，项目里有 **三处各自手写的分桶**，
 *   口径已经漂了：
 *   1. `screens/InsightScreen.tsx` 30 分钟分桶（组件内、未导出、t 取槽起点、空槽被 filter 掉）
 *   2. `lib/realSeries.ts` `bucketByHour` 1 小时分桶（空桶返回 null 保留槽位，但丢掉了时间戳）
 *   3. `components/CortisolRhythmCard.tsx` 48 槽（皮质醇专用 View 实现）
 *   叠加 `healthStore.getTimeRange` 的 `maxPoints` **等间隔 stride 抽稀**（会丢尖峰），
 *   导致「洞察页小卡 48 点 / 详情页约 375 点」密度不一致、横轴口径也不一致。
 *
 * ★ 三条纪律（对齐 Mira「不编造数据」铁律）：
 *   1. **固定槽位数**：返回数组长度恒等于 `slotCount`，空槽是 `v: null`，**绝不 filter**。
 *      空槽要留在数组里，图表层才能「刻度位照常、柱不画」（Oura 的 division 语义）。
 *   2. **`v <= 0` 视为无效样本**（0/负数在戒指协议里是占位符，见 `RingBleManager.handleHrvSamples`），
 *      不参与均值，也不该让整槽变成 0。
 *   3. **不做任何插值**：没样本就是 null，由图表层决定怎么表达缺口。
 *
 * 典型用法：
 *   // 全天 5 分钟一点（Oura 口径，288 槽）
 *   const bars = binByMinutes(healthStore.getIntraday('hr', dk), 5);
 *   // 全天 30 分钟一点（洞察页小卡口径，48 槽）
 *   const half = binByMinutes(raw, 30);
 *   // 自定义窗口（睡眠段 23:00→07:00）
 *   const sleep = binByMinutes(pts, 5, { dayStartMs: bedMs, slotCount: 96 });
 */

export interface TimePt {
  t: number;
  v: number;
}

export interface Bucket {
  /** 槽序号（0 = `dayStartMs` 对应的第一个槽） */
  slot: number;
  /** 槽**中点**的绝对时间戳（epoch ms）——画图用这个，横轴才不会整体偏移半个槽 */
  t: number;
  /** 槽内均值；无有效样本 = `null`（槽位仍然保留） */
  v: number | null;
  /** 槽内有效样本数（调试 / 「已抽样」提示用） */
  n: number;
}

/** 一天毫秒数 */
export const DAY_MS = 86_400_000;

export function dayStartOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 按固定时间桶聚合。**返回数组长度恒为 `slotCount`**，空槽 `v = null`。
 *
 * @param minutes 桶宽（分钟）。5 = Oura 心率全天口径；30 = 洞察页小卡口径。
 * @param opts.dayStartMs 窗口起点，默认取 `dayStartOf(第一个样本)`；传`Date.now()` 的今日零点可保证「今天」的轴从 0 点起。
 * @param opts.slotCount  槽位数，默认 `ceil(24h / minutes)`。
 * @param opts.roundDigits 均值保留小数位（默认 1，与历史 30 分钟分桶一致）。
 */
export function binByMinutes(
  pts: TimePt[] | null | undefined,
  minutes: number,
  opts?: { dayStartMs?: number; slotCount?: number; roundDigits?: number },
): Bucket[] {
  const spanMs = Math.max(1, minutes) * 60_000;
  const source = (pts ?? []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v));
  const dayStartMs = opts?.dayStartMs ?? (source.length ? dayStartOf(source[0].t) : dayStartOf(Date.now()));
  const slotCount = opts?.slotCount ?? Math.ceil(DAY_MS / spanMs);
  const digits = opts?.roundDigits ?? 1;

  const sum = new Array(slotCount).fill(0);
  const cnt = new Array(slotCount).fill(0);

  const sorted = source.slice().sort((a, b) => a.t - b.t);
  for (const p of sorted) {
    if (p.v <= 0) continue;                       // 纪律 2：0/负数是占位符
    const slot = Math.floor((p.t - dayStartMs) / spanMs);
    if (slot < 0 || slot >= slotCount) continue;
    sum[slot] += p.v;
    cnt[slot] += 1;
  }

  const out: Bucket[] = new Array(slotCount);
  for (let i = 0; i < slotCount; i++) {
    const n = cnt[i];
    const mid = dayStartMs + i * spanMs + spanMs / 2;
    out[i] = {
      slot: i,
      t: mid,
      v: n > 0 ? Number((sum[i] / n).toFixed(digits)) : null,
      n,
    };
  }
  return out;
}

/** 有数据的槽数（用于「已抽样 N/M」这类诚实提示） */
export function bucketFilledCount(buckets: Bucket[]): number {
  let c = 0;
  for (const b of buckets) if (b.v != null) c += 1;
  return c;
}

/** 有效槽的均值；无有效槽返回 null（不返回 0，避免「没数据」看起来像「值为 0」） */
export function bucketMean(buckets: Bucket[]): number | null {
  let sum = 0;
  let n = 0;
  for (const b of buckets) {
    if (b.v == null) continue;
    sum += b.v;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/** 有效槽的最小 / 最大值；不足一个有效槽返回 null */
export function bucketExtent(buckets: Bucket[]): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const b of buckets) {
    if (b.v == null) continue;
    if (b.v < lo) lo = b.v;
    if (b.v > hi) hi = b.v;
    n += 1;
  }
  return n > 0 ? { lo, hi } : null;
}