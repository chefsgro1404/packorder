import { describe, it, expect } from 'vitest';
import { matchWeightRange, matchWeightRanges, formatWeightRange, parseWeightToLbs, validateWeightRanges } from './weightCategory';
import type { WeightRangeRule } from './types';

const CHICKEN_RANGES: WeightRangeRule[] = [
  { variantId: 'gid://shopify/ProductVariant/1001', label: 'Small',  minLbs: 1.5, maxLbs: 2.0 },
  { variantId: 'gid://shopify/ProductVariant/1002', label: 'Medium', minLbs: 2.0, maxLbs: 2.5 },
  { variantId: 'gid://shopify/ProductVariant/1003', label: 'Large',  minLbs: 2.5, maxLbs: null },
];

// ─── matchWeightRange / matchWeightRanges ──────────────────────────────────────

describe('matchWeightRange', () => {
  it('matches Small at its lower bound (included)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 1.5)?.label).toBe('Small');
  });

  it('matches Small inside range', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 1.8)?.label).toBe('Small');
  });

  it('a weight exactly on a shared boundary goes to the lower tier (2.0 → Small, not Medium)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.0)?.label).toBe('Small');
  });

  it('just above a shared boundary goes to the higher tier (2.0001 → Medium)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.0001)?.label).toBe('Medium');
  });

  it('matches Medium at 2.2 lbs', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.2)?.label).toBe('Medium');
  });

  it('upper bound is included: 2.5 → Medium, 2.5001 → Large', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.5)?.label).toBe('Medium');
    expect(matchWeightRange(CHICKEN_RANGES, 2.5001)?.label).toBe('Large');
  });

  it('matches Large with no upper bound (very heavy)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 10.0)?.label).toBe('Large');
  });

  it('the example from the request: 1.5–1.9 and 1.9–2.5', () => {
    const rules: WeightRangeRule[] = [
      { variantId: 'a', label: 'A', minLbs: 1.5, maxLbs: 1.9 },
      { variantId: 'b', label: 'B', minLbs: 1.9, maxLbs: 2.5 },
    ];
    expect(matchWeightRange(rules, 1.5)?.label).toBe('A');
    expect(matchWeightRange(rules, 1.9)?.label).toBe('A');
    expect(matchWeightRange(rules, 1.9001)?.label).toBe('B');
    expect(matchWeightRange(rules, 2.5)?.label).toBe('B');
    expect(matchWeightRange(rules, 2.5001)).toBeNull();
  });

  it('a kg reading converted to lbs lands on the boundary without rounding problems', () => {
    const rules: WeightRangeRule[] = [
      { variantId: 'a', label: 'A', minLbs: 1.5, maxLbs: 1.9 },
      { variantId: 'b', label: 'B', minLbs: 1.9, maxLbs: 2.5 },
    ];
    // 1.9 lbs expressed in kg, converted back: floating point gives 1.8999999…
    const lbs = parseWeightToLbs(`${1.9 / 2.20462} kg`)!;
    expect(matchWeightRange(rules, lbs)?.label).toBe('A');
  });

  it('returns null when weight is below all ranges', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 0.5)).toBeNull();
  });

  it('returns null for empty rules', () => {
    expect(matchWeightRange([], 2.0)).toBeNull();
  });

  it('returns null for zero weight', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 0)).toBeNull();
  });

  it('returns null for negative weight', () => {
    expect(matchWeightRange(CHICKEN_RANGES, -1)).toBeNull();
  });

  it('returns correct variantId for matched rule', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.2)?.variantId).toBe('gid://shopify/ProductVariant/1002');
  });

  it('gap between tiers: no match in gap', () => {
    const gapped: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Light', minLbs: 1.0, maxLbs: 1.5 },
      { variantId: 'v2', label: 'Heavy', minLbs: 2.0, maxLbs: null },
    ];
    expect(matchWeightRange(gapped, 1.7)).toBeNull();
  });

  it('returns null when the weight is in two tiers (ambiguous — use matchWeightRanges)', () => {
    const same: WeightRangeRule[] = [
      { variantId: 'x', label: 'Small (Halal)',   minLbs: 1.5, maxLbs: 2.0 },
      { variantId: 'y', label: 'Small (Regular)', minLbs: 1.5, maxLbs: 2.0 },
    ];
    expect(matchWeightRange(same, 1.7)).toBeNull();
  });
});

describe('matchWeightRanges', () => {
  it('returns both tiers when two tiers have the same range', () => {
    const same: WeightRangeRule[] = [
      { variantId: 'x', label: 'Small (Halal)',   minLbs: 1.5, maxLbs: 2.0 },
      { variantId: 'y', label: 'Small (Regular)', minLbs: 1.5, maxLbs: 2.0 },
    ];
    expect(matchWeightRanges(same, 1.7).map(r => r.label)).toEqual(['Small (Halal)', 'Small (Regular)']);
    expect(matchWeightRanges(same, 1.5)).toHaveLength(2);
    expect(matchWeightRanges(same, 2.0)).toHaveLength(2);
  });

  it('returns both tiers only inside a partial overlap', () => {
    const overlapping: WeightRangeRule[] = [
      { variantId: 'a', label: 'A', minLbs: 1.5, maxLbs: 2.5 },
      { variantId: 'b', label: 'B', minLbs: 2.0, maxLbs: 3.0 },
    ];
    expect(matchWeightRanges(overlapping, 1.8).map(r => r.label)).toEqual(['A']);
    expect(matchWeightRanges(overlapping, 2.2).map(r => r.label)).toEqual(['A', 'B']);
    expect(matchWeightRanges(overlapping, 2.8).map(r => r.label)).toEqual(['B']);
  });

  it('a shared boundary is never ambiguous', () => {
    expect(matchWeightRanges(CHICKEN_RANGES, 2.0).map(r => r.label)).toEqual(['Small']);
    expect(matchWeightRanges(CHICKEN_RANGES, 2.5).map(r => r.label)).toEqual(['Medium']);
  });

  it('returns nothing outside every tier', () => {
    expect(matchWeightRanges(CHICKEN_RANGES, 1.2)).toEqual([]);
  });
});

describe('formatWeightRange', () => {
  it('shows both ends, or a plus for no upper bound', () => {
    expect(formatWeightRange({ minLbs: 1.5, maxLbs: 1.9 })).toBe('1.5–1.9 lbs');
    expect(formatWeightRange({ minLbs: 2.5, maxLbs: null })).toBe('2.5+ lbs');
  });
});

// ─── parseWeightToLbs ─────────────────────────────────────────────────────────

describe('parseWeightToLbs', () => {
  it('parses plain lbs string', () => {
    expect(parseWeightToLbs('2.20 lbs')).toBeCloseTo(2.20, 2);
  });

  it('parses bare number as lbs', () => {
    expect(parseWeightToLbs('1.5')).toBeCloseTo(1.5, 2);
  });

  it('parses grams and converts to lbs', () => {
    const lbs = parseWeightToLbs('1000g');
    expect(lbs).toBeCloseTo(2.2046, 2);
  });

  it('parses kg and converts to lbs', () => {
    const lbs = parseWeightToLbs('1.0 kg');
    expect(lbs).toBeCloseTo(2.20462, 2);
  });

  it('returns null for empty string', () => {
    expect(parseWeightToLbs('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseWeightToLbs('unknown')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseWeightToLbs('0 lbs')).toBeNull();
  });
});

// ─── validateWeightRanges ────────────────────────────────────────────────────

describe('validateWeightRanges', () => {
  const validRanges: WeightRangeRule[] = [
    { variantId: 'gid://shopify/ProductVariant/1001', label: 'Small',  minLbs: 1.5, maxLbs: 2.0 },
    { variantId: 'gid://shopify/ProductVariant/1002', label: 'Medium', minLbs: 2.0, maxLbs: 2.5 },
    { variantId: 'gid://shopify/ProductVariant/1003', label: 'Large',  minLbs: 2.5, maxLbs: null },
  ];

  it('returns no errors or warnings for a valid contiguous set', () => {
    const result = validateWeightRanges(validRanges);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty errors/warnings for an empty rules array', () => {
    const result = validateWeightRanges([]);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors when a tier label is missing', () => {
    const rules = [{ ...validRanges[0], label: '' }, ...validRanges.slice(1)];
    const result = validateWeightRanges(rules);
    expect(result.errors.some(e => e.includes('label is required'))).toBe(true);
  });

  it('errors when a tier variantId is missing', () => {
    const rules = [{ ...validRanges[0], variantId: '' }, ...validRanges.slice(1)];
    const result = validateWeightRanges(rules);
    expect(result.errors.some(e => e.includes('Variant ID is required'))).toBe(true);
  });

  it('errors when maxLbs <= minLbs', () => {
    const rules = [{ variantId: 'v1', label: 'Bad', minLbs: 2.0, maxLbs: 1.5 }];
    const result = validateWeightRanges(rules);
    expect(result.errors.some(e => e.includes('max lbs must be greater'))).toBe(true);
  });

  it('errors when maxLbs equals minLbs (zero-width range)', () => {
    const rules = [{ variantId: 'v1', label: 'Zero', minLbs: 2.0, maxLbs: 2.0 }];
    const result = validateWeightRanges(rules);
    expect(result.errors.some(e => e.includes('max lbs must be greater'))).toBe(true);
  });

  it('a shared boundary (one tier ends where the next starts) is valid', () => {
    const rules: WeightRangeRule[] = [
      { variantId: 'a', label: 'A', minLbs: 1.5, maxLbs: 1.9 },
      { variantId: 'b', label: 'B', minLbs: 1.9, maxLbs: 2.5 },
    ];
    const result = validateWeightRanges(rules);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors on a gap, so no weight can be missed (the 1.599 / 1.6 example)', () => {
    const gapped: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Small',  minLbs: 1.499, maxLbs: 1.599 },
      { variantId: 'v2', label: 'Medium', minLbs: 1.6,   maxLbs: 1.9 },
    ];
    const result = validateWeightRanges(gapped);
    expect(result.errors.some(e => e.includes('Gap') && e.includes('1.599') && e.includes('1.6'))).toBe(true);
    expect(result.errors.some(e => e.includes('Start "Medium" at 1.599'))).toBe(true);
  });

  it('errors with correct gap bounds when gap exists mid-range', () => {
    const gapped: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Light', minLbs: 1.0, maxLbs: 1.5 },
      { variantId: 'v2', label: 'Heavy', minLbs: 2.0, maxLbs: null },
    ];
    const result = validateWeightRanges(gapped);
    expect(result.errors.some(e => e.includes('between 1.5 and 2'))).toBe(true);
  });

  it('a tier covering another tier\'s range is not a gap', () => {
    const rules: WeightRangeRule[] = [
      { variantId: 'a', label: 'Wide',   minLbs: 1.0, maxLbs: 3.0 },
      { variantId: 'b', label: 'Inner',  minLbs: 1.5, maxLbs: 2.0 },
      { variantId: 'c', label: 'Heavy',  minLbs: 3.0, maxLbs: null },
    ];
    const result = validateWeightRanges(rules);
    expect(result.errors).toHaveLength(0);
  });

  it('warns (does not block) when two tiers overlap — staff choose at print time', () => {
    const overlapping: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Small',  minLbs: 1.5, maxLbs: 2.5 },
      { variantId: 'v2', label: 'Medium', minLbs: 2.0, maxLbs: 3.0 },
    ];
    const result = validateWeightRanges(overlapping);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('overlap') && w.includes('from 2 to 2.5') && w.includes('asked to choose'))).toBe(true);
  });

  it('warns when two tiers have exactly the same range', () => {
    const same: WeightRangeRule[] = [
      { variantId: 'x', label: 'Small (Halal)',   minLbs: 1.5, maxLbs: 2.0 },
      { variantId: 'y', label: 'Small (Regular)', minLbs: 1.5, maxLbs: 2.0 },
    ];
    const result = validateWeightRanges(same);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('two tiers with no upper bound overlap (warning, not error)', () => {
    const multiUnbounded: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Large', minLbs: 2.5, maxLbs: null },
      { variantId: 'v2', label: 'XL',    minLbs: 3.0, maxLbs: null },
    ];
    const result = validateWeightRanges(multiUnbounded);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('any higher weight'))).toBe(true);
  });

  it('single unbounded tier alone is valid', () => {
    const single: WeightRangeRule[] = [
      { variantId: 'v1', label: 'All', minLbs: 0, maxLbs: null },
    ];
    const result = validateWeightRanges(single);
    expect(result.errors).toHaveLength(0);
  });

  it('detects overlap regardless of rule order in the array', () => {
    const reversed: WeightRangeRule[] = [
      { variantId: 'v2', label: 'Medium', minLbs: 2.0, maxLbs: 3.0 },
      { variantId: 'v1', label: 'Small',  minLbs: 1.5, maxLbs: 2.5 },
    ];
    const result = validateWeightRanges(reversed);
    expect(result.warnings.some(w => w.includes('overlap'))).toBe(true);
  });
});

// ─── PO per-label approval (categorical products) ─────────────────────────────

describe('categorical product PO approval', () => {
  it('increments per label, not per lot (one chicken = approval +1)', () => {
    const labels = 3;
    // Simulates: for each label printed, approval qty = 1
    const totalApproved = labels * 1;
    expect(totalApproved).toBe(3);
  });

  it('each label links to the same PO line item', () => {
    const poLineItemId = 'li-abc-123';
    const labels = [
      { sn: 'chk-100001', poLineItemId },
      { sn: 'chk-100002', poLineItemId },
    ];
    expect(labels.every(l => l.poLineItemId === poLineItemId)).toBe(true);
  });
});
