import type { ExamInputs, Sex } from '../data/examStore';

type ProfileDraft = { weight: string; height: string; age: string; sex: Sex };
type ProfileErrors = Partial<Record<'weight' | 'height' | 'age', string>>;

export function validateProfile(draft: ProfileDraft):
  | { ok: true; inputs: ExamInputs }
  | { ok: false; errors: ProfileErrors } {
  const errors: ProfileErrors = {};
  const numberOf = (text: string) => /^\d+(?:\.\d+)?$/.test(text.trim()) ? Number(text) : NaN;
  const weight = numberOf(draft.weight);
  const height = numberOf(draft.height);
  const age = numberOf(draft.age);
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) errors.weight = '请输入 20–300 kg 的体重';
  if (!Number.isFinite(height) || height < 80 || height > 250) errors.height = '请输入 80–250 cm 的身高';
  if (!Number.isInteger(age) || age < 18 || age > 120) errors.age = '此估算适用于成人，请输入 18–120 岁';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, inputs: { weight, height, age, sex: draft.sex } };
}
