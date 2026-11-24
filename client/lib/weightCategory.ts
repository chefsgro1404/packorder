import type { WeightRangeRule } from './types';

// Weights come from the scale with 2 decimals, or from kg/g conversions with many; compare with a
// tiny tolerance so 1.9 typed as "1.90 lb" and 0.8618 kg → 1.9000… lbs land on the same boundary.
const EPS = 1e-9;
const at = (a: number, b: number) => Math.abs(a - b) <= EPS;

/**
 * Every tier a weight falls in. Both ends of a range are included (1.5–1.9 contains 1.5 and 1.9);
 * maxLbs = null means no upper bound.
 *
 * A weight exactly on a shared boundary goes to the lower tier: with 1.5–1.9 and 1.9–2.5, 1.9 is the
 * first tier and 1.9001 the second. Any other overlap (two tiers with the same or overlapping ranges)
 * returns every tier it falls in, and staff are asked to choose.
 */
export function matchWeightRanges(rules: WeightRangeRule[], weightLbs: number): WeightRangeRule[] {
  if (rules.length === 0 || !(weightLbs > 0)) return [];
  const inRange = rules.filter(r => weightLbs >= r.minLbs - EPS && (r.maxLbs == null || weightLbs <= r.maxLbs + EPS));
  if (inRange.length <= 1) return inRange;
  // Drop a tier that the weight only touches at its start when another tier ends exactly there
  return inRange.filter(r =>
    !(at(weightLbs, r.minLbs) && inRange.some(o => o !== r && o.maxLbs != null && at(weightLbs, o.maxLbs))));
}

/**
 * The single tier a weight falls in, or null when it falls in none or in more than one
 * (use matchWeightRanges to tell those apart).
 */
export function matchWeightRange(rules: WeightRangeRule[], weightLbs: number): WeightRangeRule | null {
  const matches = matchWeightRanges(rules, weightLbs);
  return matches.length === 1 ? matches[0] : null;
}

/** "1.5–1.9 lbs", "2.5+ lbs" — how a tier's range is shown to staff. */
export function formatWeightRange(rule: Pick<WeightRangeRule, 'minLbs' | 'maxLbs'>): string {
  return rule.maxLbs == null ? `${rule.minLbs}+ lbs` : `${rule.minLbs}–${rule.maxLbs} lbs`;
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
 * Errors: missing fields, inverted bounds, and gaps between tiers (a weight in a gap would match
 * nothing — the next tier should start where the previous one ends).
 * Warnings: tiers whose ranges overlap (a weight in both asks staff to choose).
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

  // Overlap and gap detection — only run if per-tier checks pass
  if (errors.length === 0) {
    const sorted = [...rules].sort((a, b) => a.minLbs - b.minLbs || (a.maxLbs ?? Infinity) - (b.maxLbs ?? Infinity));
    const name = (r: WeightRangeRule) => `"${r.label}" (${formatWeightRange(r)})`;

    // Overlaps: any two tiers sharing more than a single boundary point
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        const aMax = a.maxLbs ?? Infinity;
        if (b.minLbs < aMax - EPS) {
          const to = Math.min(aMax, b.maxLbs ?? Infinity);
          warnings.push(
            `${name(a)} and ${name(b)} overlap: a weight from ${b.minLbs} to ${to === Infinity ? 'any higher weight' : to} matches both, and staff will be asked to choose`
          );
        }
      }
    }

    // Gaps: the highest end reached so far must reach the next tier's start
    let reach = sorted[0].maxLbs ?? Infinity;
    let reachRule = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (next.minLbs > reach + EPS) {
        errors.push(
          `Gap between ${name(reachRule)} and ${name(next)}: a weight between ${reach} and ${next.minLbs} would match no tier. ` +
          `Start "${next.label}" at ${reach} — a weight of exactly ${reach} goes to "${reachRule.label}".`
        );
      }
      const nextMax = next.maxLbs ?? Infinity;
      if (nextMax > reach) { reach = nextMax; reachRule = next; }
    }
  }

  return { errors, warnings };
}
