/**
 * cycleLog —— 经期记录本地持久化
 *
 * 用项目已引入的 expo-file-system 写 JSON（不引新原生依赖，不影响 ⌘R）。
 * 仅存用户手动输入的「上次经期开始日 / 周期长度」，属隐私数据，仅存本机沙盒。
 */
import * as FileSystem from 'expo-file-system';
import type { CycleLog } from '../lib/cycleMath';

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
    };
  } catch {
    return null;
  }
}

export async function saveCycleLog(log: CycleLog): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(log));
  } catch {
    /* 写盘失败静默：绝不阻塞 App */
  }
}
