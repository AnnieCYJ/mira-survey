/**
 * cycleLog —— 经期记录本地持久化
 *
 * 用项目已引入的 expo-file-system 写 JSON（不引新原生依赖，不影响 ⌘R）。
 * 仅存用户手动输入的「上次经期开始日 / 周期长度」，属隐私数据，仅存本机沙盒。
 *
 * 另累积 history（历史经期开始日，旧→新）用于 Periodical 式统计预测：
 * 当累积 ≥3 次记录时，computeCycle 用历史周期长度的 均值±标准差 预测下次经期。
 */
import * as FileSystem from 'expo-file-system';
import { parseDate, type CycleLog } from '../lib/cycleMath';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_cycle_log.json';

export async function loadCycleLog(): Promise<CycleLog | null> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const j = JSON.parse(raw) as any;
    if (!j || !j.lastPeriodStart) return null;
    return {
      lastPeriodStart: String(j.lastPeriodStart),
      cycleLength: Number(j.cycleLength) || 28,
      lutealLength: Number(j.lutealLength) || 14,
      periodLength: Number(j.periodLength) || 5,
      history: Array.isArray(j.history) ? j.history.map(String) : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveCycleLog(log: CycleLog): Promise<void> {
  try {
    // 累积历史经期开始日：读取现有 history → 追加本次（去重）→ 升序 → 截断 24 条
    let history: string[] = [];
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const j = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as any;
        if (Array.isArray(j.history)) history = j.history.map(String);
      }
    } catch {
      /* 读旧 history 失败不阻塞 */
    }
    if (!history.includes(log.lastPeriodStart)) {
      history = [...history, log.lastPeriodStart]
        .sort((a, b) => parseDate(a).getTime() - parseDate(b).getTime())
        .slice(-24);
    }
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ ...log, history }));
  } catch {
    /* 写盘失败静默：绝不阻塞 App */
  }
}
