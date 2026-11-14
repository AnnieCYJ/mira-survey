/**
 * physioRange.ts —— 生理指标有效范围（脏读数拦截）
 *
 * ★ 2026-11-13（用户实锤「今日血氧 1%」根因）：血氧落库全链路此前只校验 `> 0`，
 *   原生偶发回传脏值（如未佩戴 / 信号差的占位值 1%，或单位错乱的 186%），
 *   直接污染「今日血氧」大卡与首页今日状态卡；而趋势图因有 `v<50 || v>100` 剔除才显得正常，
 *   于是出现「大卡 1% 但趋势图 90+」的自相矛盾。
 *
 * 这里统一一份「绝对不可能是真实生理值」的硬边界（边界取宽，避免误删真实极值，
 * 如睡眠中心率 39、低血氧预警 70 仍放行），在所有落库点（handleSpo2Day /
 * handleBackfillDay / handleSpo2Samples / applyMetric）与读取兜底处
 * （quickCheckStore / MetricDetailScreen）复用，一处在源头、一处防存量污染。
 */
export const PHYSIO_RANGE: Record<string, [number, number]> = {
  // 血氧：仪器量程 0–100，<50 已无法存活 / 测量无效，>100 不可能
  spo2: [50, 100],
  // 心率：静息最低可至 25（重度运动员 / 睡眠），上限极高
  hr: [25, 260],
  // HRV（ms）：正常 1–300，0 为占位符
  hrv: [1, 300],
  // 收缩压 / 舒张压（mmHg）
  bpSys: [50, 280],
  bpDia: [30, 180],
  // 体表温度（℃）：环境 / 发烧极端也在此区间
  temp: [30, 45],
  // 呼吸率（次/分）
  rr: [3, 80],
  // 皮电（可低至 0）
  eda: [0, 200],
};

/** 判定一个读数是否为合法生理值。未知指标一律放行（不拦截）。 */
export function physioValid(key: string, v: number | null | undefined): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const r = PHYSIO_RANGE[key];
  if (!r) return true;
  return v >= r[0] && v <= r[1];
}
