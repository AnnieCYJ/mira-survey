/**
 * motionGate.ts —— **运动门控**（v18.133）
 *
 * ══ 为什么要这个模块 ══
 * 旧 `lib/emotionalStress.ts` 判「运动中」靠三个**拍的**阈值：
 *   `MOVE_STEP_DELTA = 250`（30 分钟步数增量）、`MOVE_HR_PCT = 30`、`DRIFT_RATIO = 2.0`。
 * 步数增量在「散步 vs 通勤走路 vs 站着不动」之间根本分不开，
 * 而 EDA 恰恰**对运动和心理压力都敏感**——不剔除运动，「情绪压力」就是纯噪声。
 *
 * ══ 本模块的三个判定层（按证据强度排序）══
 * **L1 固件运动段（最强）**：Veepoo 固件已用真实加速度计 + 自家算法把运动段分好类，
 * 经 `VPDeviceSportModel`（`beginTime`/`endTime`/`type`/`averHeart`/`totalStep`）透传到 RN。
 * 这是**设备厂商自己的运动识别结果**，不是我们从步数猜的。
 * ⚠ 但它有两个硬限制，必须在消费时处理：
 *   ① **只在 App 连接时读一次**（`readStoredSportSessions` 在连接成功后调用），
 *      固件里存多少就返回多少 → 我们只能拿到「已记录的运动」，拿不到「没戴戒指时的运动」。
 *   ② **未佩戴期的运动不会被记录** —— 所以 L1 缺席**不等于**没运动。
 * **L2 连续活动量（补 L1 的时间盲区）**：MET（每 5/10 分钟）与步数增量来自固件原始数据桶，
 * 能覆盖「App 没连着但戒指在戴」的时段。MET 是**强度**、步数是**量**，两者互补。
 * **L3 生理残差（兜底）**：心率显著高于个人静息基线但活动量不高 → 体位变化/发热/咖啡因。
 *   这一层最弱，只在前两层都无信号时用，且**不作为「情绪压力」的正面证据**。
 *
 * ══ 恢复期为什么必须单独算 ══
 * 运动结束后，HRV/EDA 不会立刻回到基线——把它们算进「情绪压力」会持续假阳性：
 * · **Jalil et al. 2008（J Appl Physiol）**：无训练者高强度运动后
 *   lnHF/RMSSD 在 5–10min 仍显著低于基线；**hard/vigorous 到 15–20min 仍 depressed，30min 才回基线**。
 *   自主神经功能在**中强度运动后 5 分钟**内即恢复。
 * · **Vieluf et al. 2019（Front Physiol, 19 人 treadmill）**：高强度后 30min 手腕皮温仍高
 *   （34.11→35.09°C）、EDA 仍高（8.06→9.37 μS）⇒ **运动后 30 分钟的 EDA 抬升是运动，不是压力**。
 * · **Buchheit 2014（Sports Med）**：HR 的「恢复」应在运动后 1–2 分钟的早期窗口测量，
 *   而 5 分钟均值才是「次极量」稳定态——所以恢复期长短本身是**个体强度与训练水平的函数**。
 * ⇒ 结论：**恢复期长度按运动强度分档**，不设一个固定 30 分钟。
 *
 * ══ 诚实边界 ══
 * 本模块只回答「这段时间的生理唤醒**能不能被运动解释**」，**不回答**「用户有没有压力」。
 * 剔除运动后的残余唤醒 ≠ 心理压力（可能是体位、气温、咖啡因、疼痛、经期不适）。
 * 上层必须仍受「EDA 读不出情绪种类」这条边界约束。
 */

import { sportMetOf } from './veepooSportTypes';

// ══ 可调参数（每个都有出处，勿乱调）══

/**
 * 运动后恢复期长度（毫秒），按**运动强度 MET** 分档。
 * 依据：Jalil 2008 观察到的「高强度 15–20min 仍 depressed、30min 回基线」+
 * Vieluf 2019「高强度后 30min 皮温与 EDA 仍高」+ Jalil「中强度 5min 即恢复」。
 * ⇒ 强度越高压制越长。这里按 MET 分三档线性插值，取的是**保守值**（宁可多剔除）。
 */
const RECOVERY_BY_MET: Array<{ met: number; ms: number }> = [
  { met: 2.0, ms: 5 * 60000 },   // 轻（步行/瑜伽/太极类）：中强度 5min 恢复 → 取 5min
  { met: 4.0, ms: 20 * 60000 },  // 中（快走/骑行/球类）：高强度 15-20min 仍低 → 取 20min
  { met: 6.5, ms: 40 * 60000 },  // 高（跑步/HIIT/力量）：高强度 30min 才回基线 → 取 40min
];

/** 单段运动短于此时长视为「误触发/日常活动误识别」，不进入恢复期计时。 */
const MIN_SESSION_MS = 3 * 60000;

/** 恢复期上限：再长的恢复期也只按 60min 算，避免一次长运动把整个下午废掉。 */
const RECOVERY_MAX_MS = 60 * 60000;

/**
 * L2：MET 门控下限。静息 MET ≈ 1.0；>1.5 视为「有活动」。
 * 固件 MET 每 5/10 分钟一点，粒度粗，所以阈值取得比连续测量保守。
 */
export const MET_ACTIVE = 1.5;

/**
 * L2：30 分钟步数增量门控（与旧 emotionalStress 的 250 一致，但**只作为 L1 的补盲**）。
 * ⚠ 这个数**没有文献来源**（旧代码拍的），保留仅为在无固件运动段时有个兜底，
 * 且**它只允许把槽标成 moving，不允许单独把槽标成 stress**。
 */
export const STEP_DELTA_ACTIVE = 250;

/**
 * L3：心率高于个人静息基线此比例（%）且 L1/L2 都没信号 → 体位/发热/咖啡因。
 * ⚠ 无来源。参照 Luma 的 MAR（motion artifact rejection）思路——宁可多剔。
 */
const HR_OVER_BASE_PCT = 25;

/** 恢复期向下取的分钟粒度（分钟级 MET 精度不配更细） */
const MINUTE = 60000;

// ══ 运动段结构 ══

/** 与 `RingBleManager.RingSportSession` 同形（避免反向 import 造成循环依赖） */
export interface SportSessionLike {
  type: number;
  typeName?: string;
  beginTime: string;   // "yyyy-MM-dd HH:mm:ss"
  endTime: string;
  totalStep: number;
  totalDis: number;    // m
  totalCal: number;    // kcal
  averHeart: number;
  totalTime: number;   // s
}

export interface MotionWindow {
  /** 运动开始（ms）。解析失败为 null */
  start: number;
  /** 运动结束（ms） */
  end: number;
  /** 固件运动类型 */
  type: number;
  /** 该段估算强度 MET */
  met: number;
  /** 固件记录的平均心率（bpm，可能为 0=缺失） */
  averHeart: number;
  /** 恢复期结束时刻 = end + 分档时长（已封顶 60min） */
  recoveryUntil: number;
}

export type MotionReason =
  | 'firmwareSession'   // L1 落在固件运动段内
  | 'recovery'          // L1 落在运动后恢复期
  | 'met'               // L2 连续活动量（MET 超阈）
  | 'steps'             // L2 步数增量兜底
  | 'hrResidual'        // L3 心率残差
  | null;

export interface MotionVerdict {
  /** 该时刻是否应被排除在「情绪压力」之外 */
  moving: boolean;
  reason: MotionReason;
  /** 命中的那一层说明（可直接进日志/诊断，不给用户看） */
  detail: string;
  /** 运动强度 MET（L1 命中才有值） */
  met: number | null;
}

// ══ 时间解析 ══

/**
 * 解析固件的 `"yyyy-MM-dd HH:mm:ss"` 为本地时间戳。
 * ⚠ **不能用 `new Date(str)`**：iOS Hermes 对带空格的非 ISO 串解析结果不可靠，
 * 而且会被当成本地/UTC 混着解释。必须自己拆。
 */
export function parseSportTime(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 按 MET 插值出恢复期长度（毫秒） */
export function recoveryMsFor(met: number): number {
  const m = Math.max(0, met);
  if (m <= RECOVERY_BY_MET[0].met) return RECOVERY_BY_MET[0].ms;
  const last = RECOVERY_BY_MET[RECOVERY_BY_MET.length - 1];
  if (m >= last.met) return last.ms;
  for (let i = 1; i < RECOVERY_BY_MET.length; i++) {
    const a = RECOVERY_BY_MET[i - 1];
    const b = RECOVERY_BY_MET[i];
    if (m <= b.met) {
      const r = (m - a.met) / (b.met - a.met);
      return Math.round(a.ms + (b.ms - a.ms) * r);
    }
  }
  return last.ms;
}

// ══ L1：固件运动段 ══

/**
 * 把 `sportSessions` 解析成带恢复期的运动窗口列表，按开始时间升序。
 * 无法解析时间的段**直接丢弃**（宁可没有运动段，也不能拿一条错的去污染整天）。
 */
export function buildMotionWindows(
  sessions: SportSessionLike[] | null | undefined,
): MotionWindow[] {
  if (!sessions || !sessions.length) return [];
  const out: MotionWindow[] = [];
  for (const s of sessions) {
    const start = parseSportTime(s?.beginTime);
    const end = parseSportTime(s?.endTime);
    if (start == null || end == null) continue;
    if (end <= start) continue;
    // 固件时长优先（更可信），异常时用时间差
    const durMs = s.totalTime > 0 ? s.totalTime * 1000 : end - start;
    if (durMs < MIN_SESSION_MS) continue;   // 太短 = 误触发
    const met = sportMetOf(s.type);
    out.push({
      start,
      end,
      type: s.type,
      met,
      averHeart: s.averHeart > 0 ? s.averHeart : 0,
      recoveryUntil: end + Math.min(recoveryMsFor(met), RECOVERY_MAX_MS),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** 一次性预索引，供 48 槽快速查（Windows 数量级是 0~几十，线性扫足够） */
export class MotionGate {
  readonly windows: MotionWindow[];
  /** 预展开的「占用区间」= 运动段 ∪ 恢复期，避免每次判定重算 */
  private readonly blocked: Array<{ from: number; to: number; w: MotionWindow; isRecovery: boolean }>;

  constructor(windows: MotionWindow[]) {
    this.windows = windows;
    this.blocked = [];
    for (const w of windows) {
      this.blocked.push({ from: w.start, to: w.end, w, isRecovery: false });
      if (w.recoveryUntil > w.end) {
        this.blocked.push({ from: w.end, to: w.recoveryUntil, w, isRecovery: true });
      }
    }
    this.blocked.sort((a, b) => a.from - b.from);
  }

  /** 由 `RingBleManager.getState().sportSessions` 一步构造 */
  static fromSessions(sessions: SportSessionLike[] | null | undefined): MotionGate {
    return new MotionGate(buildMotionWindows(sessions));
  }

  /** 空门控：没有任何运动段信息（固件没记录 / 未连接） */
  static empty(): MotionGate {
    return new MotionGate([]);
  }

  get hasFirmwareSessions(): boolean {
    return this.windows.length > 0;
  }

  /** 查某个时刻是否落在固件运动段或恢复期 */
  lookup(t: number): { window: MotionWindow; isRecovery: boolean } | null {
    for (const b of this.blocked) {
      if (b.from <= t && t < b.to) return { window: b.w, isRecovery: b.isRecovery };
      if (b.from > t) break;   // 已排序，后面的都不会命中
    }
    return null;
  }

  /**
   * L1 + L2 组合判定。
   * @param t         时刻（ms）
   * @param met       该时刻的 MET（可为 null）
   * @param stepDelta 该 30 分钟槽的步数增量（可为 null）
   * @param hrOverBasePct 心率高于个人静息基线的百分比（可为 null）
   */
  verdictAt(
    t: number,
    opts: { met?: number | null; stepDelta?: number | null; hrOverBasePct?: number | null } = {},
  ): MotionVerdict {
    // ── L1：固件运动段 / 恢复期 ──
    const hit = this.lookup(t);
    if (hit) {
      return {
        moving: true,
        reason: hit.isRecovery ? 'recovery' : 'firmwareSession',
        detail: hit.isRecovery
          ? `恢复期（${hit.window.met.toFixed(1)}MET 运动 ${hit.window.type} 结束后 ${
              Math.round((hit.window.recoveryUntil - hit.window.end) / MINUTE)
            }min 内）`
          : `固件运动段 type=${hit.window.type} averHR=${hit.window.averHeart || '—'}`,
        met: hit.window.met,
      };
    }

    // ── L2a：连续活动量 MET ──
    if (opts.met != null && opts.met > MET_ACTIVE) {
      return {
        moving: true,
        reason: 'met',
        detail: `MET=${opts.met.toFixed(1)} > ${MET_ACTIVE}（活动量高，唤醒可被运动解释）`,
        met: opts.met,
      };
    }

    // ── L2b：步数增量兜底（无文献来源，只做补盲，不做正面证据）──
    if (opts.stepDelta != null && opts.stepDelta >= STEP_DELTA_ACTIVE) {
      return {
        moving: true,
        reason: 'steps',
        detail: `步数增量 ${Math.round(opts.stepDelta)} ≥ ${STEP_DELTA_ACTIVE}（兜底补盲，无来源阈值）`,
        met: null,
      };
    }

    // ── L3：心率残差（最弱，只在前两层都无信号时）──
    if (opts.hrOverBasePct != null && opts.hrOverBasePct >= HR_OVER_BASE_PCT) {
      return {
        moving: true,
        reason: 'hrResidual',
        detail: `心率高于个人静息 ${opts.hrOverBasePct.toFixed(0)}% 但活动量不高（体位/发热/咖啡因）`,
        met: null,
      };
    }

    return { moving: false, reason: null, detail: '无运动信号', met: null };
  }

  /**
   * 给定 30min 槽起点与长度，返回该槽**任一时刻**是否被判为运动。
   * 保守取向：槽内任一时刻命中即整槽剔除（宁可少报，不可把运动算成压力）。
   */
  slotMoving(
    slotStart: number,
    slotMs: number,
    opts: { met?: number | null; stepDelta?: number | null; hrOverBasePct?: number | null } = {},
  ): MotionVerdict {
    // 先用槽中点试一次（大多数情况命中即可返回，避免 6 次采样扫描）
    const mid = slotStart + slotMs / 2;
    const midHit = this.verdictAt(mid, opts);
    if (midHit.moving) return midHit;
    // 运动段可能只覆盖槽的一部分（如 15:40–16:10）→ 再扫 6 个点
    for (let i = 0; i < 6; i++) {
      const t = slotStart + (slotMs * (i + 0.5)) / 6;
      if (t === mid) continue;
      const v = this.verdictAt(t, opts);
      if (v.moving) return v;
    }
    return midHit;
  }

  /** 诊断摘要（进 Metro 日志，不给用户看） */
  summary(): string {
    if (!this.windows.length) return '无固件运动段';
    const parts = this.windows.map(
      (w) =>
        `${new Date(w.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}-` +
        `${new Date(w.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` +
        ` ${w.met.toFixed(1)}MET→恢复${Math.round((w.recoveryUntil - w.end) / MINUTE)}min`,
    );
    return `${this.windows.length} 段: ${parts.join(' | ')}`;
  }
}
