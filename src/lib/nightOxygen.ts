/**
 * nightOxygen —— 从「已同步落库的夜间血氧逐样本」计算呼吸暂停卡的客观指标
 *
 * ★ 2026-11-14（用户）：睡眠呼吸暂停卡经常「没有数据」。
 *   根因不是戒指没测血氧：真机日志同日 `[Batch] ✅ spo2 n=160`，血氧逐样本一直在 healthStore 里。
 *   而是这张卡只认 `ring.oxygenAnalysis` —— 那条通道走原生 `readOriginDataBySetting`
 *   回读设备 SpO2 原始历史包，要求①戒指当时已连接 ②设备端「全天血氧自动监测」开着
 *   ③最近几夜真的落了原始点。任一不满足就 emit `no_data` / `ring_not_connected`，
 *   整张卡变空，而库里明明有 160 个真实血氧点。
 *
 * 本模块提供**兜底数据源**：不编造任何数值，只用 healthStore 里已经落库的真实样本，
 * 按与原生一致的口径（低氧 = 血氧 < 90，每点≈1 分钟）算出可直接展示的指标。
 * 设备原生分析（含 OSAHS 分级）仍优先；拿不到时用这里的结果，卡面如实标注来源。
 *
 * 数据纪律：
 *   - 0 是**合法结果**（整夜没有低氧事件 → 低氧时间 0 秒、占比 0%），绝不能当「无数据」显示成杠；
 *   - 只有在**一个有效样本都没有**时才返回 hasData=false，此时才允许 UI 显示空态；
 *   - 呼吸率 / 心脏负荷 / OSAHS 分级不是血氧样本能推出来的，一律留空交回设备侧，不硬算。
 */
import { healthStore, dayKey, type MetricKey } from '../data/healthStore';
import { sleepWindowMs } from './nightPhysiology';

/** 低氧判定阈值（与原生 VeepooRingModule.kt:1510、MetricDetailScreen 分档一致） */
export const LOW_OXYGEN_THRESHOLD = 90;
/** 单个血氧原始点代表的时长（秒）：原生注释「每点≈1分钟」 */
export const SECONDS_PER_SAMPLE = 60;

export interface NightOxygenResult {
  /** 平均血氧 %（1 位小数） */
  aveOxygen: number | null;
  /** 最低血氧 % */
  minOxygen: number | null;
  /** 呼吸率，次/分；血氧样本推不出，只有设备回传 rr 才有 */
  aveRespRate: number | null;
  /** 低氧时间（秒）：血氧 < 90 的点数 × 60。0 = 整夜无低氧，是真实结果 */
  lowOxygenSec: number;
  /** 夜间低氧时间百分比：低氧点数 / 有效样本数 × 100。0 = 无低氧，是真实结果 */
  lowOxygenPct: number;
  /** 有效血氧样本数 */
  samples: number;
  /** 是否至少有一个有效样本 —— 唯一允许 UI 显示空态的条件 */
  hasData: boolean;
  /** 来源说明，UI 直接展示 */
  sourceNote: string;
  /** 统计窗口（epoch ms），便于诊断 */
  window: { start: number; end: number } | null;
}

type TimePoint = { t: number; v: number };

function shiftDay(dk: string, delta: number): string {
  const d = new Date(dk + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return dayKey(d.getTime());
}

function samplesInWindow(key: MetricKey, dk: string, win: { start: number; end: number }): TimePoint[] {
  const out: TimePoint[] = [];
  for (const delta of [-1, 0, 1]) {
    const arr = healthStore.getIntraday(key as any, shiftDay(dk, delta)) ?? [];
    for (const p of arr) {
      if (p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.t >= win.start && p.t <= win.end) {
        out.push(p);
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  // 去重：同一时刻可能被多个归档日重复收录
  return out.filter((p, i) => i === 0 || p.t !== out[i - 1].t);
}

/** 只保留生理有效血氧值，避免把 0 / 1 / 255 这类脏值当真实读数 */
function validSpo2(pts: TimePoint[]): number[] {
  return pts.map((p) => p.v).filter((v) => v >= 70 && v <= 100);
}

/**
 * 主入口：算「某夜」的血氧客观指标。
 * @param dk 睡眠归属日（通常 = 起床那天）
 * @param opts 真实入睡/起床/总时长；拿不到时用默认夜间窗口 20:00→次日 10:00
 */
export function computeNightOxygen(
  dk: string,
  opts: {
    sleepTime?: string | null;
    wakeTime?: string | null;
    totalMin?: number | null;
    /** 覆盖默认窗口（诊断/测试用） */
    window?: { start: number; end: number } | null;
  } = {},
): NightOxygenResult {
  const empty = (win: { start: number; end: number } | null, note: string): NightOxygenResult => ({
    aveOxygen: null,
    minOxygen: null,
    aveRespRate: null,
    lowOxygenSec: 0,
    lowOxygenPct: 0,
    samples: 0,
    hasData: false,
    sourceNote: note,
    window: win,
  });

  let win = opts.window ?? sleepWindowMs(dk, opts.sleepTime, opts.wakeTime, opts.totalMin);
  let usedDefaultWindow = false;
  if (!win) {
    // 没记录睡眠时刻时不猜具体入睡点，用宽松夜间窗口覆盖「昨夜 20:00 → 今早 10:00」。
    // 只是取样本的时间范围，不写入任何指标值。
    const base = new Date(dk + 'T00:00:00').getTime();
    if (!Number.isFinite(base)) return empty(null, '日期无效，无法统计夜间血氧');
    win = { start: base - 4 * 3600_000, end: base + 10 * 3600_000 };
    usedDefaultWindow = true;
  }

  const spo2Pts = samplesInWindow('spo2', dk, win);
  const vals = validSpo2(spo2Pts);
  if (vals.length === 0) {
    return empty(win, '戒指还没同步这一夜的血氧样本；连接并完成一次同步后会自动补全。');
  }

  const sum = vals.reduce((a, b) => a + b, 0);
  const ave = Math.round((sum / vals.length) * 10) / 10;
  const min = Math.min(...vals);
  const lowCount = vals.filter((v) => v < LOW_OXYGEN_THRESHOLD).length;
  const lowOxygenSec = lowCount * SECONDS_PER_SAMPLE;
  // ★ 0 必须保持为 0：整夜无低氧是健康结果，不是「没数据」。
  const lowOxygenPct = Math.round((lowCount / vals.length) * 1000) / 10;

  // 呼吸率：设备若回传了 rr 逐样本就如实展示，推不出来则留空。
  const rrVals = samplesInWindow('rr', dk, win)
    .map((p) => p.v)
    .filter((v) => v >= 5 && v <= 40);
  const aveRespRate = rrVals.length
    ? Math.round((rrVals.reduce((a, b) => a + b, 0) / rrVals.length) * 10) / 10
    : null;

  return {
    aveOxygen: ave,
    minOxygen: min,
    aveRespRate,
    lowOxygenSec,
    lowOxygenPct,
    samples: vals.length,
    hasData: true,
    sourceNote: usedDefaultWindow
      ? `按夜间窗口统计 ${vals.length} 个已同步血氧样本（未记录睡眠时刻）`
      : `按睡眠窗口统计 ${vals.length} 个已同步血氧样本`,
    window: win,
  };
}
