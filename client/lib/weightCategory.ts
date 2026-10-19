import type { WeightRangeRule } from './types';

/**
 * Matches a weight (in lbs) against an ordered list of weight range rules.
 * minLbs is inclusive; maxLbs is exclusive. Last tier may have maxLbs=null (no upper bound).
 * Returns the matched rule or null if no range covers the weight.
 */
export function matchWeightRange(rules: WeightRangeRule[], weightLbs: number): WeightRangeRule | null {
  if (rules.length === 0 || weightLbs <= 0) return null;
  return rules.find(r => weightLbs >= r.minLbs && (r.maxLbs === null || weightLbs < r.maxLbs)) ?? null;
}

/**
 * Parses a weight string (e.g. "2.20 lbs", "2200g", "1.5 kg") into lbs.
 * Returns null if unrecognisable.
 */
export function parseWeightToLbs(raw: string): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  const num = parseFloat(lower.replace(/[^\d.]/g, ''));
  if (isNaN(num) || num <= 0) return null;
  if (lower.includes('kg'))  return num * 2.20462;
  if (lower.includes('g') && !lower.includes('lbs')) return num / 453.592;
  return num; // default: lbs
}
