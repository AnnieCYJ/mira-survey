import * as FileSystem from 'expo-file-system';
import { apiFetch, authHeaders, ensureDeviceToken } from './ringIdentity';
import { emotionEntriesForSync } from './emotionLog';

function date(value: string): string {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) throw new Error('记录日期无效');
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}
async function read(name: string): Promise<any | undefined> {
  const path = (FileSystem.documentDirectory ?? '') + name;
  if (!(await FileSystem.getInfoAsync(path)).exists) return undefined;
  return JSON.parse(await FileSystem.readAsStringAsync(path));
}
export async function uploadSelfReports(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const capturedAt = Date.now();
    const [emotions, cycle, period] = await Promise.all([read('emotionLog.json'), read('mira_cycle_log.json'), read('mira_period_log.json')]);
    const body: Record<string, unknown> = { schema_version: 1, device_id: deviceId, captured_at: capturedAt, utc_offset_minutes: -new Date().getTimezoneOffset() };
    const liveEmotions = await emotionEntriesForSync();
    if (liveEmotions !== null) {
      if (emotions !== undefined && !Array.isArray(emotions.entries)) throw new Error('情绪记录格式无效');
      body.emotions = liveEmotions.map(e => ({ id: e.id, date: date(e.dk), t: e.t, mood: e.mood }));
    }
    if (cycle !== undefined) {
      body.cycle = cycle === null ? null : { lastPeriodStart: date(cycle.lastPeriodStart), cycleLength: cycle.cycleLength, periodLength: cycle.periodLength, history: (cycle.history ?? []).map(date) };
    }
    if (period !== undefined) {
      if (!period || typeof period !== 'object' || Array.isArray(period)) throw new Error('经期记录格式无效');
      body.period_days = Object.values(period).map((e: any) => ({ date: date(e.date), flow: e.flow, pain: e.pain, periodEnd: e.periodEnd === true }));
    }
    if (Object.keys(body).length === 4) return { ok: true };
    const token = await ensureDeviceToken(deviceId);
    const result = await apiFetch('/v1/ring/self-reports', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) });
    return result.ok && result.data?.ok === true ? { ok: true } : { ok: false, error: '情绪和周期记录未同步成功，请稍后重试' };
  } catch { return { ok: false, error: '无法读取或同步自报记录，云端原记录保留' }; }
}
