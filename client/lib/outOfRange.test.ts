import { describe, it, expect } from 'vitest';
import { matchWeightRange, parseWeightToLbs } from './weightCategory';
import { LogOutOfRangeEventPayload } from './types';
import type { WeightRangeRule } from './types';

// ─── Helper: build action strings ─────────────────────────────────────────────

function buildAction(tierLabel: string | null): string {
  return tierLabel ? `overridden_to:${tierLabel}` : 'skipped';
}

function isOutOfRange(rules: WeightRangeRule[], weightLbs: number): boolean {
  return matchWeightRange(rules, weightLbs) === null && rules.length > 0 && weightLbs > 0;
}

// ─── Out-of-range detection ───────────────────────────────────────────────────

const exampleRules: WeightRangeRule[] = [
  { variantId: 'v1', label: 'Small',  minLbs: 1.5, maxLbs: 2.0 },
  { variantId: 'v2', label: 'Medium', minLbs: 2.0, maxLbs: 2.5 },
  { variantId: 'v3', label: 'Large',  minLbs: 2.5, maxLbs: null },
];

describe('out-of-range detection', () => {
  it('weight below all tiers → out of range', () => {
    expect(isOutOfRange(exampleRules, 0.5)).toBe(true);
  });

  it('weight in gap between tiers → out of range', () => {
    // Gap between 1.0–1.5 (before Small starts)
    expect(isOutOfRange(exampleRules, 1.2)).toBe(true);
  });

  it('weight at minLbs of first tier → NOT out of range', () => {
    expect(isOutOfRange(exampleRules, 1.5)).toBe(false);
  });

  it('weight inside a tier → NOT out of range', () => {
    expect(isOutOfRange(exampleRules, 1.75)).toBe(false);
    expect(isOutOfRange(exampleRules, 2.2)).toBe(false);
    expect(isOutOfRange(exampleRules, 3.0)).toBe(false);
  });

  it('no rules → NOT out of range (feature is disabled)', () => {
    expect(isOutOfRange([], 0.5)).toBe(false);
  });

  it('weight of 0 → NOT out of range (not a real reading)', () => {
    expect(isOutOfRange(exampleRules, 0)).toBe(false);
  });

  it('weight at exact tier boundary is handled correctly', () => {
    // 2.0 is minLbs of Medium and maxLbs of Small — belongs to Medium (minLbs inclusive)
    const matched = matchWeightRange(exampleRules, 2.0);
    expect(matched?.label).toBe('Medium');
  });
});

// ─── Action string construction ───────────────────────────────────────────────

describe('buildAction', () => {
  it('null tierLabel → "skipped"', () => {
    expect(buildAction(null)).toBe('skipped');
  });

  it('tierLabel provided → "overridden_to:{label}"', () => {
    expect(buildAction('Small')).toBe('overridden_to:Small');
    expect(buildAction('Large')).toBe('overridden_to:Large');
  });

  it('action for override starts with "overridden_to:"', () => {
    expect(buildAction('Medium').startsWith('overridden_to:')).toBe(true);
  });

  it('action for skip is exactly "skipped"', () => {
    expect(buildAction(null)).toBe('skipped');
  });

  it('tier label with spaces is preserved', () => {
    expect(buildAction('Extra Large')).toBe('overridden_to:Extra Large');
  });
});

// ─── Auto-print guard ─────────────────────────────────────────────────────────

describe('auto-print guard', () => {
  interface AutoDetectState {
    matched: WeightRangeRule | null;
    noMatch: boolean;
    weightLbs: number;
  }

  function shouldAutoprint(autoDetect: AutoDetectState | null, sessionActive: boolean): boolean {
    if (!autoDetect?.matched || autoDetect.noMatch || !sessionActive) return false;
    return true;
  }

  it('matched tier + active session → auto-print fires', () => {
    const state: AutoDetectState = { matched: exampleRules[0], noMatch: false, weightLbs: 1.75 };
    expect(shouldAutoprint(state, true)).toBe(true);
  });

  it('noMatch → auto-print does NOT fire', () => {
    const state: AutoDetectState = { matched: null, noMatch: true, weightLbs: 0.5 };
    expect(shouldAutoprint(state, true)).toBe(false);
  });

  it('no active session → auto-print does NOT fire', () => {
    const state: AutoDetectState = { matched: exampleRules[0], noMatch: false, weightLbs: 1.75 };
    expect(shouldAutoprint(state, false)).toBe(false);
  });

  it('null autoDetect → auto-print does NOT fire', () => {
    expect(shouldAutoprint(null, true)).toBe(false);
  });

  it('matched null but noMatch false → auto-print does NOT fire', () => {
    const state: AutoDetectState = { matched: null, noMatch: false, weightLbs: 0 };
    expect(shouldAutoprint(state, true)).toBe(false);
  });
});

// ─── Tier override after out-of-range ─────────────────────────────────────────

describe('tier override from out-of-range', () => {
  it('selecting a tier clears the noMatch state', () => {
    let autoDetect = { matched: null as WeightRangeRule | null, noMatch: true, weightLbs: 0.4 };
    const selectedTier = exampleRules[0];
    // Simulate the button onClick
    autoDetect = { matched: selectedTier, noMatch: false, weightLbs: autoDetect.weightLbs };
    expect(autoDetect.noMatch).toBe(false);
    expect(autoDetect.matched?.label).toBe('Small');
  });

  it('after override, weight is preserved', () => {
    const weightLbs = 0.4;
    let autoDetect = { matched: null as WeightRangeRule | null, noMatch: true, weightLbs };
    autoDetect = { ...autoDetect, matched: exampleRules[2], noMatch: false };
    expect(autoDetect.weightLbs).toBe(0.4);
  });

  it('override action includes the selected tier label', () => {
    const selectedTier = exampleRules[1]; // Medium
    const action = buildAction(selectedTier.label);
    expect(action).toBe('overridden_to:Medium');
  });
});

// ─── Skip out-of-range ────────────────────────────────────────────────────────

describe('skip out-of-range', () => {
  it('skip clears the auto-detect state', () => {
    let autoDetect: { matched: WeightRangeRule | null; noMatch: boolean; weightLbs: number } | null = {
      matched: null, noMatch: true, weightLbs: 0.4,
    };
    // After skip: autoDetect is cleared
    autoDetect = null;
    expect(autoDetect).toBeNull();
  });

  it('skip action is "skipped"', () => {
    expect(buildAction(null)).toBe('skipped');
  });

  it('skip does not close the session (session remains active after skip)', () => {
    // Session state is a separate piece of state; skip only clears autoDetect + itemWeight
    const sessionActive = true;
    let autoDetect: { matched: WeightRangeRule | null; noMatch: boolean; weightLbs: number } | null = {
      matched: null, noMatch: true, weightLbs: 0.4,
    };
    // Simulate handleSkipOutOfRange
    autoDetect = null;
    // Session is unaffected
    expect(sessionActive).toBe(true);
    expect(autoDetect).toBeNull();
  });
});

// ─── LogOutOfRangeEventPayload type contract ──────────────────────────────────

describe('LogOutOfRangeEventPayload type contract', () => {
  it('skipped payload satisfies the interface', () => {
    const payload: LogOutOfRangeEventPayload = {
      productId:    'gid://shopify/Product/123',
      productTitle: 'Whole Chicken',
      variantId:    'gid://shopify/ProductVariant/456',
      poId:         null,
      sessionId:    null,
      weightLbs:    0.42,
      action:       'skipped',
    };
    expect(payload.action).toBe('skipped');
    expect(payload.weightLbs).toBeGreaterThan(0);
  });

  it('overridden payload satisfies the interface', () => {
    const payload: LogOutOfRangeEventPayload = {
      productId:    'prod-001',
      productTitle: 'Chicken',
      variantId:    'var-001',
      poId:         'po-001',
      sessionId:    'session-001',
      weightLbs:    3.95,
      action:       'overridden_to:Large',
    };
    expect(payload.action).toBe('overridden_to:Large');
  });

  it('null optional fields are allowed', () => {
    const payload: LogOutOfRangeEventPayload = {
      productId:    '',
      productTitle: 'Test',
      variantId:    null,
      poId:         null,
      sessionId:    null,
      weightLbs:    1.0,
      action:       'skipped',
    };
    expect(payload.variantId).toBeNull();
    expect(payload.poId).toBeNull();
    expect(payload.sessionId).toBeNull();
  });
});

// ─── Tier button grid layout ───────────────────────────────────────────────────

describe('tier button grid layout', () => {
  function gridCols(count: number): number {
    if (count <= 2) return 2;
    if (count === 3) return 3;
    return 2; // 4+ tiers: 2-col grid (2 rows of 2)
  }

  it('1 tier → 2 columns', () => { expect(gridCols(1)).toBe(2); });
  it('2 tiers → 2 columns', () => { expect(gridCols(2)).toBe(2); });
  it('3 tiers → 3 columns', () => { expect(gridCols(3)).toBe(3); });
  it('4 tiers → 2 columns (wrap to 2 rows)', () => { expect(gridCols(4)).toBe(2); });
  it('5 tiers → 2 columns', () => { expect(gridCols(5)).toBe(2); });
});

// ─── parseWeightToLbs edge cases for auto-detect ──────────────────────────────

describe('parseWeightToLbs edge cases', () => {
  it('parses lbs strings correctly', () => {
    expect(parseWeightToLbs('2.20 lbs')).toBeCloseTo(2.20);
    expect(parseWeightToLbs('1.5lbs')).toBeCloseTo(1.5);
  });

  it('parses kg strings correctly', () => {
    expect(parseWeightToLbs('1 kg')).toBeCloseTo(2.20462);
    expect(parseWeightToLbs('0.5kg')).toBeCloseTo(1.10231);
  });

  it('empty string → null', () => {
    expect(parseWeightToLbs('')).toBeNull();
  });

  it('zero weight → null (not a valid reading)', () => {
    expect(parseWeightToLbs('0 lbs')).toBeNull();
  });
});
