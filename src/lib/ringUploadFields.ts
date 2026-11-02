/** 云端 auto_data 的扩展指标；零值有效，缺失和非有限值不上传。 */
const EXT_KEYS = ['bloodSugar', 'bloodFat', 'triglyceride', 'hdl', 'ldl', 'uricAcid', 'bpSys', 'bpDia', 'ecg'] as const;
export function ringUploadExtFields(ext: unknown): Record<string, number> {
  if (!ext || typeof ext !== 'object') return {};
  const input = ext as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of EXT_KEYS) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}
