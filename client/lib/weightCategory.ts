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

export interface WeightRangeValidation {
  errors: string[];    // must fix before saving
  warnings: string[];  // save is allowed but worth knowing
}

/**
 * Validates a set of weight range rules before saving.
 * Errors: missing fields, inverted bounds, overlapping ranges, multiple unbounded tiers.
 * Warnings: gaps between tiers (valid config, but weights in the gap will show "no match").
 */
export function validateWeightRanges(rules: WeightRangeRule[]): WeightRangeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rules.length === 0) return { errors, warnings };

  // Per-tier field checks
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const label = r.label?.trim() ? `"${r.label}"` : `Tier ${i + 1}`;
    if (!r.label?.trim())    errors.push(`Tier ${i + 1}: label is required`);
    if (!r.variantId?.trim()) errors.push(`${label}: Variant ID is required`);
    if (r.minLbs < 0)        errors.push(`${label}: min lbs cannot be negative`);
    if (r.maxLbs !== null && r.maxLbs !== undefined && r.maxLbs <= r.minLbs) {
      errors.push(`${label}: max lbs must be greater than min lbs`);
    }
  }

  // Multiple unbounded (maxLbs = null) tiers — ambiguous for heavy weights
  const unbounded = rules.filter(r => r.maxLbs === null || r.maxLbs === undefined);
  if (unbounded.length > 1) {
    errors.push(`Only one tier may have no upper bound (found ${unbounded.length}): ${unbounded.map(r => r.label || 'unnamed').join(', ')}`);
  }

  // Overlap and gap detection — only run if per-tier checks pass
  if (errors.length === 0) {
    // Sort by minLbs to check sequentially
    const sorted = [...rules].sort((a, b) => a.minLbs - b.minLbs);
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const currMax = curr.maxLbs ?? Infinity;

      if (next.minLbs < currMax) {
        // next starts before curr ends → overlap
        errors.push(
          `"${curr.label}" (${curr.minLbs}–${curr.maxLbs ?? '∞'}) and "${next.label}" (${next.minLbs}–${next.maxLbs ?? '∞'}) overlap`
        );
      } else if (next.minLbs > currMax) {
        // gap between curr end and next start
        warnings.push(
          `Gap between "${curr.label}" and "${next.label}": weights ${currMax}–${next.minLbs} lbs will show "no match"`
        );
      }
    }
  }

  return { errors, warnings };
}
