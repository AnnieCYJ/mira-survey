/** Existing wellness estimate; unknown inputs do not imply an older body age. */
export function estimateHealthAge(
  actualAge: number | null,
  overallScore: number | null,
  hormonalHealthy: boolean,
  hasHormonalData: boolean,
): number | null {
  if (actualAge == null || !Number.isInteger(actualAge) || actualAge < 18 || actualAge > 120 ||
      overallScore == null || !Number.isFinite(overallScore) || overallScore < 0 || overallScore > 100 ||
      !hasHormonalData) return null;
  const longTermHealthy = overallScore >= 65;
  const adjustment = hormonalHealthy
    ? (longTermHealthy ? -4.5 : -1.5)
    : (longTermHealthy ? 1.5 : 3.5);
  return Math.max(18, Math.round((actualAge + adjustment + (65 - overallScore) / 20) * 10) / 10);
}
