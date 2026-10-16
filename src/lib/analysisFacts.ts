import { dayKey, healthStore, type MetricKey, type Source, type TimePoint } from '../data/healthStore';

export type FactSource = 'measured' | 'self_reported' | 'derived' | 'snapshot' | 'unknown';
export type FactQuality = 'good' | 'limited' | 'missing';

export interface FactWindow { start: number; end: number; }

export interface AnalysisFact {
  date: string;
  window: FactWindow;
  metric: string;
  value: number | string | null;
  source: FactSource;
  sampleCount: number;
  quality: FactQuality;
  algorithmVersion?: string;
}

function sourceOf(source: Source | undefined, derived: boolean, metric: MetricKey, dk: string): FactSource {
  if (derived) return 'derived';
  if (source === 'manual') {
    const records = healthStore.getManualMeasurements(metric).filter((p) => dayKey(p.t) === dk);
    if (records.length && records.every((p) => p.source === 'healthGlance' || p.source === 'backfill')) return 'measured';
    if (records.length && records.every((p) => p.source === 'manual')) return 'self_reported';
  }
  if (source === 'backfill' || source === 'realtime') return 'measured';
  // Mixed buckets and unspecified provenance cannot establish a single source.
  return 'unknown';
}

function qualityOf(samples: number, value: number | null): FactQuality {
  if (value == null || !Number.isFinite(value) || samples <= 0) return 'missing';
  // Sample count alone does not establish coverage or measurement quality.
  return 'limited';
}

function dayWindow(dk: string): FactWindow {
  const start = new Date(`${dk}T00:00:00`).getTime();
  return { start, end: start + 86400000 - 1 };
}

export function factForDay(metric: MetricKey, date: Date = new Date()): AnalysisFact {
  const dk = dayKey(date.getTime());
  const day = healthStore.getDay(metric, dk);
  const points = healthStore.getIntraday(metric, dk);
  const value = day?.mean ?? null;
  return {
    date: dk,
    window: dayWindow(dk),
    metric,
    value,
    source: sourceOf(day?.source, healthStore.isDerivedDay(metric, dk), metric, dk),
    sampleCount: day?.samples ?? points.length,
    quality: qualityOf(day?.samples ?? points.length, value),
    algorithmVersion: healthStore.isDerivedDay(metric, dk) ? 'offline-estimate-v1' : undefined,
  };
}

export function factsForDay(metrics: MetricKey[], date: Date = new Date()): AnalysisFact[] {
  return metrics.map((metric) => factForDay(metric, date));
}

export function intradayFact(metric: MetricKey, date: Date = new Date()): AnalysisFact {
  const dk = dayKey(date.getTime());
  const points: TimePoint[] = healthStore.getIntraday(metric, dk);
  const first = points[0]?.t ?? date.getTime();
  const last = points[points.length - 1]?.t ?? first;
  const value = points.length ? points[points.length - 1].v : null;
  return {
    date: dk,
    window: { start: first, end: last },
    metric,
    value,
    source: sourceOf(healthStore.getDay(metric, dk)?.source, healthStore.isDerivedDay(metric, dk), metric, dk),
    sampleCount: points.length,
    quality: qualityOf(points.length, value),
    algorithmVersion: healthStore.isDerivedDay(metric, dk) ? 'offline-estimate-v1' : undefined,
  };
}

export function factsForAgent(date: Date = new Date()): AnalysisFact[] {
  return factsForDay(['hr', 'hrv', 'eda', 'sns', 'emotion', 'temp', 'rr', 'glucose', 'bpSys', 'bpDia'], date);
}

export function sleepFactForDay(date: Date = new Date()): AnalysisFact {
  const dk = dayKey(date.getTime());
  const sleep = healthStore.getSleep(dk);
  const hasSleep = !!sleep && Number.isFinite(sleep.total) && sleep.total > 0;
  return {
    date: dk,
    window: dayWindow(dk),
    metric: 'sleep',
    value: hasSleep ? sleep!.score : null,
    source: hasSleep ? 'measured' : 'unknown',
    sampleCount: hasSleep ? 1 : 0,
    quality: hasSleep ? 'limited' : 'missing',
    algorithmVersion: hasSleep ? 'sleep-summary-v1' : undefined,
  };
}
