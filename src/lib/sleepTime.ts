/**
 * 睡眠时刻工具（纯函数、零依赖）——「HH:mm」入睡/起床时刻的**唯一**解析与归一实现。
 *
 * 归一的意义（一）：把凌晨 0–11 点视为 +24（00:30 → 24.5、23:30 → 23.5），
 * 这样「晚睡程度」可以单调比较（23:30 早于 00:30），睡眠负载/评分都依赖它。
 *
 * 归一的意义（二）：**统一口径**。入睡/起床串在数据链路上有三形态并存 ——
 *   · `"HH:mm"`（卡片展示形态）
 *   · `"yyyy-MM-dd HH:mm"`（原生 dayData 真实形态，真机实测 `"2026-09-18 01:38"`）
 *   · `"MM-DD-HH-mm"` / `"yyyy-MM-dd HH-mm"`（旧协议形态）
 * 各处自写正则必然漂移（本项目已实际踩到）：
 *   · `/^\d{1,2}:\d{2}/` 只能解析 `"HH:mm"`，遇到 `"2026-09-18 01:38"` 直接 null
 *     → 分期图时间轴退化成 `+0h / +2h` 相对刻度；
 *   · `Math.floor` 到整点 → 把 00:12 的压力事件误判进睡眠窗；
 *   · 纯位置式取段（不看段位语义）→ 把裸日期 `"9-8"` 当成 09:08、`"2026-09-18 10"`
 *     当成 18:10，静默臆造时刻（QA 独立复核实测）。
 * 故解析（parseClockMinutes）/ 归一（fmtClockHM）/ 跨天判定（isOvernight）/ 展示文案
 * （formatSleepClockText）**只此一份实现**，其余模块一律复用。
 *
 * 另含一对「睡眠数据**归属日**」判定（纯函数，供恢复期自愈/归位使用）：
 * `sleepSummaryDateOf`（这份摘要属于哪天）与 `sleepSegmentsDateOf`（这段分期曲线属于哪天）——
 * 顶层便捷字段 `sleepSummary/sleepStages` 与按天归档 `sleepDaily/sleepStagesDaily` 可能属于不同日，
 * 必须能把它们归位，否则会把旧曲线画在新标题下。
 */

/** 通用「HH:mm」匹配：搜索串内第一个时分（不是 ^ 锚定，故 "yyyy-MM-dd HH:mm" 也能命中）。 */
const CLOCK_RE = /(\d{1,2}):(\d{2})/;

/** "yyyy-MM-dd" 日期前缀（用于跨天/跨月/跨年判定）。 */
const DATE_RE = /(\d{4})-(\d{1,2})-(\d{1,2})/;

/** 时/分文本 → 自 0 点分钟数（越界返回 null）。 */
function minutesFromParts(hh: string, mm: string): number | null {
  if (!/^\d{1,2}$/.test(hh) || !/^\d{1,2}$/.test(mm)) return null;
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** 取串内的 "yyyy-MM-dd" 前缀（零填充 ISO 形态，便于字典序比较）；无则 null。 */
function datePrefixOf(s?: string | null): string | null {
  if (s == null) return null;
  const m = DATE_RE.exec(String(s));
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** dash 串的单个段位 → 数字（仅接受 1–4 位纯数字）；否则 NaN。 */
function numSeg(x: string | undefined): number {
  return typeof x === 'string' && /^\d{1,4}$/.test(x) ? parseInt(x, 10) : NaN;
}

/**
 * 月/日是否在合法范围。用于确认 dash 串**确实是「日期 + 时刻」**，
 * 避免把裸日期串当成时刻而臆造出一个时间（见 parseClockMinutes 回退分支的说明）。
 */
function isMonthDay(mo: number, da: number): boolean {
  return (
    Number.isInteger(mo) && Number.isInteger(da) &&
    mo >= 1 && mo <= 12 && da >= 1 && da <= 31
  );
}

/**
 * 稳健取「自 0 点分钟数」（保留分钟精度，不做 Math.floor）。
 *
 * 支持 `"01:38"` / `"2026-09-18 01:38"` / `"2026-09-18 01:38:00"`（均 → 98）、
 * 以及无冒号的旧协议串 `"09-18-01-38"`（MM-DD-HH-mm）、`"2026-09-18 01-38"`（yyyy-MM-dd HH-mm）。
 *
 * ★ 无法解析（含「只有日期、没有时刻」）→ 一律返回 null，调用方必须按「无时刻」处理，
 *   绝不允许臆造成 00:00 或别的时刻。
 */
export function parseClockMinutes(s?: string | null): number | null {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  // ① 首选：搜索第一个 "HH:mm"
  const m = CLOCK_RE.exec(str);
  if (m) return minutesFromParts(m[1], m[2]);
  // ② 兼容无冒号的旧协议 dash 串：段位必须**同时通过日期语义校验**才算「日期+时刻」。
  //    纯位置式取段会把裸日期串当成时刻 → 静默臆造时间（QA 复核实测）：
  //      · "9-8"（月-日）被 2 段分支当成 "HH-mm" → 09:08；
  //      · "2026-09-18 10"（日期+裸小时）被 4 段分支当成 "MM-DD-HH-mm" → 18:10。
  //    现在：段数=5 要求「4 位年 + 合法月日」；段数=4 要求「合法月日」；
  //    段数=2（旧 "HH-mm"）**已移除** —— 该形态全仓及真机数据均无来源，
  //    且裸 "M-D"/"MM-DD" 本质是日期（如 "12-25"），绝不能被解释成时刻。
  const parts = str.split(/[-:\s]/).filter((p) => p.length > 0);
  if (parts.length === 5) {
    const yy = numSeg(parts[0]);
    const mo = numSeg(parts[1]);
    const da = numSeg(parts[2]);
    if (yy >= 1970 && yy <= 2999 && isMonthDay(mo, da)) {
      return minutesFromParts(parts[3], parts[4]); // yyyy-MM-dd HH-mm
    }
    return null;
  }
  if (parts.length === 4) {
    const mo = numSeg(parts[0]);
    const da = numSeg(parts[1]);
    if (isMonthDay(mo, da)) return minutesFromParts(parts[2], parts[3]); // MM-DD-HH-mm
    return null;
  }
  return null;
}

/** 归一输出 `"HH:mm"`（24:00 → "00:00"）；无法解析返回 null。 */
export function fmtClockHM(s?: string | null): string | null {
  const abs = parseClockMinutes(s);
  if (abs == null) return null;
  const h = Math.floor(abs / 60) % 24;
  const m = abs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 入睡 → 起床是否跨天（用于「次日」标注与跨天分支）。
 *
 * 判定顺序：
 *  ① 两侧都带完整日期且日期不同 → 直接比日期（跨月/跨年天然正确，如
 *     `"2026-09-30 23:10"` → `"2026-10-01 07:20"`）；
 *  ② 否则比时刻：起床时刻**不晚于**入睡时刻即视为跨天（与 `lib/sleepWindow.ts`、
 *     `EmotionInsightView` 既有分支口径一致）。缺任一侧 → false（不臆造跨天）。
 */
export function isOvernight(sleepTime?: string | null, wakeTime?: string | null): boolean {
  const bd = datePrefixOf(sleepTime);
  const wd = datePrefixOf(wakeTime);
  if (bd && wd && bd !== wd) return wd > bd;
  const b = parseClockMinutes(sleepTime);
  const w = parseClockMinutes(wakeTime);
  if (b == null || w == null) return false;
  return b > w;
}

/**
 * 睡眠时刻串 → **本地绝对毫秒时间戳**（跨天/跨月/跨年/闰日的唯一实现）。
 *
 * · 串内带完整日期（`"2026-09-30 23:10"`）→ 以该日期为真值，交给 `Date` 原生进位，
 *   不手写跨月/跨年判断（`"2026-12-31 22:50"` → `"2027-01-01 06:40"` 天然正确）；
 * · 只有 `"HH:mm"` → 以 `baseMs` 所在日为基准（`baseMs` 传当日 00:00 本地时刻）；
 * · 无法解析 → null，调用方不得臆造成 00:00。
 *
 * @param s 入睡/起床时刻串（"HH:mm" 或 "yyyy-MM-dd HH:mm" 等）
 * @param baseMs 无日期部分时的基准时刻（通常为该日 00:00 的绝对 ms）
 */
export function sleepClockToMs(s?: string | null, baseMs?: number): number | null {
  const clock = parseClockMinutes(s);
  if (clock == null) return null;
  const base = Number.isFinite(baseMs as number) ? (baseMs as number) : Date.now();
  const dm = datePrefixOf(s);
  if (dm) {
    const [y, mo, da] = dm.split('-').map((x) => parseInt(x, 10));
    if (y >= 1970 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return new Date(y, mo - 1, da, 0, 0, 0, 0).getTime() + clock * 60 * 1000;
    }
  }
  return base + clock * 60 * 1000;
}

/** 入睡/起床展示文案。 */
export interface SleepClockText {
  /** 入睡 `"HH:mm"`；无法解析 → null（调用方显示占位符） */
  bed: string | null;
  /** 起床 `"HH:mm"`；跨天时已带「次日 」前缀；无法解析 → null */
  wake: string | null;
  /** 是否跨天 */
  overnight: boolean;
}

/**
 * 睡眠时刻展示文案（**唯一**实现）：归一为 `HH:mm`，跨天时给起床侧加「次日」标注。
 *
 * 为什么必须在这里归一：`sleepSummary.sleepTime` 存的是原生完整 datetime
 * （真机实测 `"2026-09-18 01:38"`），界面若直接插值就会印出
 * 「入睡 2026-09-18 01:38 · 起床 2026-09-18 10:19」。
 */
export function formatSleepClockText(
  sleepTime?: string | null,
  wakeTime?: string | null,
): SleepClockText {
  const bed = fmtClockHM(sleepTime);
  const wakeHM = fmtClockHM(wakeTime);
  const overnight = isOvernight(sleepTime, wakeTime);
  return {
    bed,
    wake: wakeHM != null && overnight ? `次日 ${wakeHM}` : wakeHM,
    overnight,
  };
}

/** "HH:mm" / "yyyy-MM-dd HH:mm" → 归一化小时（凌晨 +24）。解析失败返回 null。 */
export function bedtimeHour(sleepTime?: string | null): number | null {
  const min = parseClockMinutes(sleepTime);
  if (min == null) return null;
  const h = min / 60;
  if (!Number.isFinite(h)) return null;
  return h < 12 ? h + 24 : h;
}

/** 入睡时刻是否偏晚（晚于 23:30 视为偏晚）。无时刻返回 false。 */
export function isLateBedtime(sleepTime?: string | null): boolean {
  const h = bedtimeHour(sleepTime);
  return h != null && h > 23.5;
}

/** 睡眠摘要（推导归属日期所需的最小字段集）。 */
export interface SleepSummaryLike {
  /** 入睡时刻；原生完整 datetime 时自带日期 */
  sleepTime?: string | null;
  total?: number | null;
  deep?: number | null;
  rem?: number | null;
}

/** 按天归档的睡眠副本（推导归属日期所需的最小字段集）。 */
export interface SleepDailyLike {
  total?: number | null;
  deep?: number | null;
  light?: number | null;
  rem?: number | null;
}

/** 分期段（推导归属日期所需的最小字段集；start/end 为自入睡起的分钟数）。 */
export interface SleepSegmentLike {
  type: number;
  start: number;
  end: number;
}

/**
 * 推导「睡眠摘要归属哪一天」（旧快照缺 `sleepSummaryDate` 时的**自愈**）。
 *
 * 为什么需要：`sleepSummaryDate` 是「sleepSummary 属于哪一天」的唯一凭据。真机快照
 * `mira_ring_state_v1.json` 实测该字段为 `undefined`（历史版本从未持久化）→ 恒为 null 会让
 * 「当日 summary」判断恒失效、历史日误用今日分期段。缺失时按下列优先级自愈：
 *  ① `sleepSummary.sleepTime` 自带的完整日期（原生真实形态 `"2026-09-18 01:38"` → `2026-09-18`），最准；
 *  ② `sleepDaily` 中 total/deep/rem 与摘要**全等**的归档日（同一份摘要的按天副本），取最新一天；
 * ③ 都推不出 → null（**不臆造**，调用方退回「当日 sleepDaily」兜底）。
 *
 * 日期一律归一为零填充 ISO（与 `healthStore.dayKey` / `RingBleManager.dayKeyOf` 的 key 口径一致），
 * 否则 `sleepSummaryDate === dayKey(now)` 这类比较会永远不成立。
 */
export function sleepSummaryDateOf(
  summary?: SleepSummaryLike | null,
  dailyByDay?: Record<string, SleepDailyLike | undefined> | null,
): string | null {
  if (!summary) return null;
  const dm = String(summary.sleepTime ?? '').match(DATE_RE);
  if (dm) {
    const y = parseInt(dm[1], 10);
    const mo = parseInt(dm[2], 10);
    const da = parseInt(dm[3], 10);
    if (y >= 1970 && y <= 2999 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    }
  }
  if (!dailyByDay) return null;
  const total = Number(summary.total) || 0;
  if (total <= 0) return null;
  const matches = Object.keys(dailyByDay).filter((k) => {
    const d = dailyByDay[k];
    return (
      !!d &&
      (Number(d.total) || 0) === total &&
      (Number(d.deep) || 0) === (Number(summary.deep) || 0) &&
      (Number(d.rem) || 0) === (Number(summary.rem) || 0)
    );
  });
  if (matches.length === 0) return null;
  // 零填充 ISO key 可直接字典序排序 → 取最新一天
  return matches.sort().pop() ?? null;
}

/**
 * 推导「一段**分期曲线**归属哪一天」（用于识别顶层 `sleepStages` 是不是另一晚的旧曲线）。
 *
 * 为什么需要：`ring.sleepStages` 是「最新一次」便捷字段，可能与 `sleepSummary` 属于**不同**的一晚。
 * 真机快照实测：顶层曲线跨度 540 / 深睡 180 / 浅睡 231，与 `sleepDaily['2026-09-16']`
 * （total 540 / deep 180 / light 231）完全吻合，而 `sleepSummary` 已是 09-18（521 / 130 / 282）。
 * 仅凭「轴长」无法发现这种事 —— 只有把曲线自身的**分期组成**与按天归档比对才能定性。
 *
 * 判定规则（宁缺勿滥，认不出就返回 null，调用方保持原行为）：
 *  ① 曲线跨度（最大 end，分钟）必须与归档 `total` 吻合（±1 分钟，容忍取整）；
 *  ② 分期组成逐项比对：**只比对归档里有值（>0）的阶段**（本项目 `sleepDaily.rem` 恒为 0，
 *     不能当作判据），任一有值阶段与曲线不符即淘汰该天；
 *  ③ 多天同时成立 → 取 `(命中的阶段数, 日期)` 最大者（零填充 ISO key 可直接比较）。
 *
 * @param segments 分期段（`type`: 0深睡/1浅睡/2REM/3失眠/4清醒，`end` 为自入睡起分钟数）
 * @param dailyByDay 按天归档（`sleepDaily`）：dateKey → { total, deep, light, rem }
 */
export function sleepSegmentsDateOf(
  segments?: SleepSegmentLike[] | null,
  dailyByDay?: Record<string, SleepDailyLike | undefined> | null,
): string | null {
  if (!segments || segments.length === 0 || !dailyByDay) return null;
  const keys = Object.keys(dailyByDay);
  if (keys.length === 0) return null;

  const span = segments.reduce((mx, s) => (Number.isFinite(s.end) && s.end > mx ? s.end : mx), 0);
  if (span <= 0) return null;
  const tally: Record<number, number> = {};
  for (const s of segments) {
    const len = Math.max(0, (Number(s.end) || 0) - (Number(s.start) || 0));
    tally[s.type] = (tally[s.type] ?? 0) + len;
  }
  const mine: [number, number, number] = [tally[0] ?? 0, tally[1] ?? 0, tally[2] ?? 0]; // deep/light/rem

  let best: { dk: string; score: number } | null = null;
  for (const dk of keys) {
    const d = dailyByDay[dk];
    if (!d) continue;
    const total = Number(d.total) || 0;
    if (total <= 0) continue;
    if (Math.abs(total - span) > 1) continue;            // ① 跨度必须吻合
    const archived = [Number(d.deep) || 0, Number(d.light) || 0, Number(d.rem) || 0];
    let checks = 0;
    let score = 0;
    for (let i = 0; i < 3; i++) {
      if (archived[i] <= 0) continue;                    // 归档缺该阶段 → 不作为判据
      checks++;
      if (archived[i] === mine[i]) score++;
    }
    if (checks > 0 && score < checks) continue;          // ② 组成有明确冲突 → 不是这一晚
    if (!best || score > best.score || (score === best.score && dk > best.dk)) {
      best = { dk, score };
    }
  }
  return best?.dk ?? null;
}
