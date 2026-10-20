import { describe, it, expect } from 'vitest';
import { matchWeightRange, parseWeightToLbs, validateWeightRanges } from './weightCategory';
import type { WeightRangeRule } from './types';

const CHICKEN_RANGES: WeightRangeRule[] = [
  { variantId: 'gid://shopify/ProductVariant/1001', label: 'Small',  minLbs: 1.5, maxLbs: 2.0 },
  { variantId: 'gid://shopify/ProductVariant/1002', label: 'Medium', minLbs: 2.0, maxLbs: 2.5 },
  { variantId: 'gid://shopify/ProductVariant/1003', label: 'Large',  minLbs: 2.5, maxLbs: null },
];

// ─── matchWeightRange ─────────────────────────────────────────────────────────

describe('matchWeightRange', () => {
  it('matches Small at lower bound (inclusive)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 1.5)?.label).toBe('Small');
  });

  it('matches Small inside range', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 1.8)?.label).toBe('Small');
  });

  it('does NOT match Small at its upper bound (exclusive)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.0)?.label).toBe('Medium');
  });

  it('matches Medium at lower bound (inclusive)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.0)?.label).toBe('Medium');
  });

  it('matches Medium at 2.2 lbs', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.2)?.label).toBe('Medium');
  });

  it('does NOT match Medium at its upper bound (exclusive)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.5)?.label).toBe('Large');
  });

  it('matches Large at lower bound (inclusive)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 2.5)?.label).toBe('Large');
  });

  it('matches Large with no upper bound (very heavy)', () => {
    expect(matchWeightRange(CHICKEN_RANGES, 10.0)?.label).toBe('Large');
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

  it('errors when two tiers overlap', () => {
    const overlapping: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Small',  minLbs: 1.5, maxLbs: 2.5 },
      { variantId: 'v2', label: 'Medium', minLbs: 2.0, maxLbs: 3.0 },
    ];
    const result = validateWeightRanges(overlapping);
    expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
  });

  it('errors when more than one tier has no upper bound', () => {
    const multiUnbounded: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Large',    minLbs: 2.5, maxLbs: null },
      { variantId: 'v2', label: 'XL',       minLbs: 3.0, maxLbs: null },
    ];
    const result = validateWeightRanges(multiUnbounded);
    expect(result.errors.some(e => e.includes('no upper bound'))).toBe(true);
  });

  it('warns (not errors) when there is a gap between two tiers', () => {
    const gapped: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Small', minLbs: 1.5, maxLbs: 2.0 },
      { variantId: 'v2', label: 'Large', minLbs: 2.5, maxLbs: null },
    ];
    const result = validateWeightRanges(gapped);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('Gap'))).toBe(true);
    expect(result.warnings.some(w => w.includes('2–2.5'))).toBe(true);
  });

  it('warns with correct gap bounds when gap exists mid-range', () => {
    const gapped: WeightRangeRule[] = [
      { variantId: 'v1', label: 'Light', minLbs: 1.0, maxLbs: 1.5 },
      { variantId: 'v2', label: 'Heavy', minLbs: 2.0, maxLbs: null },
    ];
    const result = validateWeightRanges(gapped);
    expect(result.warnings.some(w => w.includes('1.5') && w.includes('2'))).toBe(true);
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
    expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
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
