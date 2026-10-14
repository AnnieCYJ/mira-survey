import * as FileSystem from 'expo-file-system';

const PATH = (FileSystem.documentDirectory ?? '') + 'mira_analysis_feedback.json';
export type AnalysisFeedbackValue = 'accurate' | 'inaccurate';
export interface AnalysisFeedback { id: string; value: AnalysisFeedbackValue; at: number; version: string; }
let mem: AnalysisFeedback[] | null = null;

async function load(): Promise<AnalysisFeedback[]> {
  if (mem) return mem;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    const raw = info.exists ? JSON.parse(await FileSystem.readAsStringAsync(PATH)) : [];
    mem = Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string' && (x.value === 'accurate' || x.value === 'inaccurate')) : [];
  } catch { mem = []; }
  return mem;
}

export async function recordAnalysisFeedback(id: string, value: AnalysisFeedbackValue, version = 'analysis-v1'): Promise<void> {
  const list = await load();
  list.push({ id, value, at: Date.now(), version });
  mem = list.slice(-200);
  try { await FileSystem.writeAsStringAsync(PATH, JSON.stringify(mem)); } catch { /* feedback is best effort */ }
}

export function peekAnalysisFeedback(): AnalysisFeedback[] { return mem ?? []; }
