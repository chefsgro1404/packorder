import { describe, it, expect } from 'vitest';

// ─── Inventory delta calculation (mirrors logPrintedLabel in page.tsx) ────────

function calcInventoryDelta(
  isWeighted: boolean,
  weightPerUnit: number,
  parentUnits: number,
  measuredWeightRaw: string,
): { parentDelta: number; childDelta: number } {
  const rawWeight = parseFloat(measuredWeightRaw.replace(/[^0-9.]/g, '') ?? '0') || 0;

  if (isWeighted) {
    if (rawWeight > 0 && weightPerUnit > 0) {
      const consumed = Math.round(rawWeight / weightPerUnit);
      return { parentDelta: -consumed, childDelta: consumed };
    }
    return { parentDelta: 0, childDelta: 0 };
  } else {
    // Count-based: parent loses weightPerUnit, output gains 1 per label
    return {
      parentDelta: -(weightPerUnit || parentUnits || 1),
      childDelta: 1,
    };
  }
}

describe('inventory delta calculation', () => {
  describe('count-based (isWeighted=false)', () => {
    it('weight_per_unit=3 → parent -3, child +1', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(false, 3, 1, '');
      expect(parentDelta).toBe(-3);
      expect(childDelta).toBe(1);
    });

    it('weight_per_unit=1 → parent -1, child +1', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(false, 1, 1, '');
      expect(parentDelta).toBe(-1);
      expect(childDelta).toBe(1);
    });

    it('falls back to parentUnits when weightPerUnit is 0', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(false, 0, 5, '');
      expect(parentDelta).toBe(-5);
      expect(childDelta).toBe(1);
    });

    it('defaults to -1 when both weightPerUnit and parentUnits are 0', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(false, 0, 0, '');
      expect(parentDelta).toBe(-1);
      expect(childDelta).toBe(1);
    });
  });

  describe('weight-based (isWeighted=true)', () => {
    it('9lbs / 3 wpu → -3 parent, +3 child', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(true, 3, 1, '9 lbs');
      expect(parentDelta).toBe(-3);
      expect(childDelta).toBe(3);
    });

    it('6.5lbs / 2 wpu → round(3.25)=3 → -3 parent, +3 child', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(true, 2, 1, '6.5 lbs');
      expect(parentDelta).toBe(-3);
      expect(childDelta).toBe(3);
    });

    it('no weight → 0 delta', () => {
      const { parentDelta, childDelta } = calcInventoryDelta(true, 3, 1, '');
      expect(parentDelta).toBe(0);
      expect(childDelta).toBe(0);
    });
  });
});

// ─── QR payload SN extraction (mirrors handleQrScan) ─────────────────────────

function extractSnFromPayload(plaintext: string): string | null {
  const parts = plaintext.split(' | ');
  const snPart = parts.find(p => p.startsWith('SN:'));
  return snPart ? snPart.replace('SN:', '').trim() : null;
}

describe('QR payload SN extraction', () => {
  it('extracts SN from standard payload', () => {
    expect(extractSnFromPayload('1234 | Chicken Breast | 2.50 lbs | SN:ABC123')).toBe('ABC123');
  });

  it('extracts SN when no weight part', () => {
    expect(extractSnFromPayload('N/A | Test Product A | SN:XY99')).toBe('XY99');
  });

  it('returns null when no SN in payload', () => {
    expect(extractSnFromPayload('1234 | Chicken Breast | 2.50 lbs')).toBeNull();
  });

  it('handles SN with dashes', () => {
    expect(extractSnFromPayload('5678 | Beef | SN:001-A-2')).toBe('001-A-2');
  });
});

// ─── TransformationOption title fallback ─────────────────────────────────────

function resolveDisplayTitle(variantTitle: string, productTitle: string): string {
  return !variantTitle || variantTitle === 'Default Title' ? productTitle : variantTitle;
}

describe('transformation option title fallback', () => {
  it('uses productTitle when variantTitle is Default Title', () => {
    expect(resolveDisplayTitle('Default Title', 'Test Product B')).toBe('Test Product B');
  });

  it('uses productTitle when variantTitle is empty', () => {
    expect(resolveDisplayTitle('', 'Test Product C')).toBe('Test Product C');
  });

  it('keeps variantTitle when it is meaningful', () => {
    expect(resolveDisplayTitle('500g Portion', 'Test Product B')).toBe('500g Portion');
  });
});
