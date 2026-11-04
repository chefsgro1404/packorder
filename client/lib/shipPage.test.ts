import { describe, it, expect } from 'vitest';

// ─── Inline helpers mirroring ship page parseQrLabel ─────────────────────────
// These replicate the logic from client/app/ship/page.tsx so it can be unit-tested.

interface QrLabel {
  plu: string;
  productTitle: string;
  itemWeight: string;
  printedAt: string;
  sn: string;
  weightGrams: number | null;
}

function parseQrLabel(value: string): QrLabel | null {
  const parts = value.split('|').map((p) => p.trim());
  if (parts.length < 3 || parts.length > 5) return null;

  const snPart = parts[parts.length - 1];
  const snMatch = snPart.match(/^SN:(.+)$/i);
  if (!snMatch) return null;

  const plu = parts[0];
  const productTitle = parts[1];
  if (!plu || !productTitle) return null;

  let itemWeight = '';
  let printedAt = '';

  if (parts.length === 5) {
    itemWeight = parts[2];
    printedAt  = parts[3];
  } else if (parts.length === 4) {
    const third = parts[2];
    if (/\d+\.?\d*\s*(kg|g|lb)\b/i.test(third)) {
      itemWeight = third;
    } else {
      printedAt = third;
    }
  }

  let weightGrams: number | null = null;
  const weightMatch = itemWeight.match(/(\d+\.?\d*)\s*(kg|g|lb)\b/i);
  if (weightMatch) {
    const val  = parseFloat(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    weightGrams = unit === 'kg' ? val * 1000 : unit === 'lb' ? val * 453.592 : val;
  }

  return { plu, productTitle, itemWeight, printedAt, sn: snMatch[1], weightGrams };
}

// ─── Inline helpers mirroring inventory delta logic ───────────────────────────
// Mirrors logPrintedLabel in client/app/scale/page.tsx.

interface MappingLike {
  found: boolean;
  isWeighted: boolean;
  weightPerUnit: number;
  parentUnits: number;
}

function computeDeltas(
  rawWeight: number,
  mapping: MappingLike,
  isCategorical: boolean,
): { parentDelta: number; childDelta: number } {
  let parentDelta = 0;
  let childDelta  = 0;

  if (isCategorical && rawWeight > 0) {
    const consumed = Math.round(rawWeight);
    parentDelta = -consumed;
    childDelta  =  consumed;
  } else if (mapping.isWeighted) {
    if (rawWeight > 0) {
      const consumed = mapping.weightPerUnit > 0
        ? Math.round(rawWeight / mapping.weightPerUnit)
        : Math.round(rawWeight);
      parentDelta = -consumed;
      childDelta  =  consumed;
    }
  } else {
    parentDelta = -(mapping.weightPerUnit || mapping.parentUnits || 1);
    childDelta  = 1;
  }

  return { parentDelta, childDelta };
}

// ─── Inline helper mirroring session counter increment ────────────────────────
// Mirrors setProcessingSession logic in scale page (auto-print + handleManualPrint).

function sessionIncrement(weightLbs: number, isCategorical: boolean): number {
  if (isCategorical && weightLbs > 0) return Math.round(weightLbs);
  return 1;
}

// ─── parseQrLabel — 5-part old format ────────────────────────────────────────

describe('parseQrLabel — 5-part (old with-weight format)', () => {
  it('parses all five fields', () => {
    const result = parseQrLabel('1234 | Red Chicken | 2.20 lb | 2024-01-01 | SN:chk-100001');
    expect(result).not.toBeNull();
    expect(result!.plu).toBe('1234');
    expect(result!.productTitle).toBe('Red Chicken');
    expect(result!.itemWeight).toBe('2.20 lb');
    expect(result!.printedAt).toBe('2024-01-01');
    expect(result!.sn).toBe('chk-100001');
  });

  it('computes weightGrams from lbs', () => {
    const result = parseQrLabel('1234 | Fish | 1.00 lb | 2024-01-01 | SN:fish-001');
    expect(result!.weightGrams).toBeCloseTo(453.592, 1);
  });
});

// ─── parseQrLabel — 4-part new with-weight format ────────────────────────────

describe('parseQrLabel — 4-part new with-weight format', () => {
  it('detects weight in 3rd slot (new format)', () => {
    const result = parseQrLabel('N/A | Red Chicken | 2.20 lb | SN:chk-100002');
    expect(result).not.toBeNull();
    expect(result!.itemWeight).toBe('2.20 lb');
    expect(result!.printedAt).toBe('');
    expect(result!.sn).toBe('chk-100002');
  });

  it('computes weightGrams from kg', () => {
    const result = parseQrLabel('N/A | Beef | 1.5 kg | SN:beef-001');
    expect(result!.weightGrams).toBeCloseTo(1500, 0);
  });

  it('computes weightGrams from grams', () => {
    const result = parseQrLabel('N/A | Fish | 500g | SN:fish-001');
    expect(result!.weightGrams).toBeCloseTo(500, 0);
  });
});

// ─── parseQrLabel — 4-part old no-weight format ──────────────────────────────

describe('parseQrLabel — 4-part old no-weight format', () => {
  it('treats non-weight 3rd field as printedAt', () => {
    const result = parseQrLabel('1234 | Red Chicken | 2024-06-01 | SN:chk-100003');
    expect(result).not.toBeNull();
    expect(result!.printedAt).toBe('2024-06-01');
    expect(result!.itemWeight).toBe('');
    expect(result!.weightGrams).toBeNull();
  });
});

// ─── parseQrLabel — 3-part new no-weight format ──────────────────────────────

describe('parseQrLabel — 3-part new no-weight format', () => {
  it('parses PLU + title + SN', () => {
    const result = parseQrLabel('N/A | Red Chicken | SN:chk-100004');
    expect(result).not.toBeNull();
    expect(result!.plu).toBe('N/A');
    expect(result!.productTitle).toBe('Red Chicken');
    expect(result!.sn).toBe('chk-100004');
    expect(result!.itemWeight).toBe('');
    expect(result!.weightGrams).toBeNull();
  });
});

// ─── parseQrLabel — invalid inputs ───────────────────────────────────────────

describe('parseQrLabel — invalid inputs', () => {
  it('returns null for a plain barcode (no SN: segment)', () => {
    expect(parseQrLabel('1234')).toBeNull();
  });

  it('returns null for 2-part string', () => {
    expect(parseQrLabel('1234 | SN:abc')).toBeNull();
  });

  it('returns null for 6-part string (too many)', () => {
    expect(parseQrLabel('a | b | c | d | e | SN:f')).toBeNull();
  });

  it('returns null when last segment does not match SN: pattern', () => {
    expect(parseQrLabel('1234 | Fish | 2.0 lb | 2024-01-01 | NOTASN')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseQrLabel('')).toBeNull();
  });

  it('extracts SN value correctly (case-insensitive prefix)', () => {
    const result = parseQrLabel('N/A | Fish | sn:fish-999');
    expect(result!.sn).toBe('fish-999');
  });

  it('allows SN value with hyphens and numbers', () => {
    const result = parseQrLabel('N/A | Chicken | SN:chk-100001-R1');
    expect(result!.sn).toBe('chk-100001-R1');
  });
});

// ─── Inventory delta — categorical products ──────────────────────────────────

describe('computeDeltas — categorical (isCategorical = true)', () => {
  const catMapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 1, parentUnits: 1 };

  it('1.8 lbs → round(1.8) = 2: parent −2, child +2', () => {
    const { parentDelta, childDelta } = computeDeltas(1.8, catMapping, true);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(2);
  });

  it('2.5 lbs → round(2.5) = 3 (rounds half-up): parent −3, child +3', () => {
    const { parentDelta, childDelta } = computeDeltas(2.5, catMapping, true);
    expect(parentDelta).toBe(-3);
    expect(childDelta).toBe(3);
  });

  it('3.0 lbs exactly: parent −3, child +3', () => {
    const { parentDelta, childDelta } = computeDeltas(3.0, catMapping, true);
    expect(parentDelta).toBe(-3);
    expect(childDelta).toBe(3);
  });

  it('1.4 lbs → round(1.4) = 1: parent −1, child +1', () => {
    const { parentDelta, childDelta } = computeDeltas(1.4, catMapping, true);
    expect(parentDelta).toBe(-1);
    expect(childDelta).toBe(1);
  });

  it('zero weight → falls through to count-based (categorical guard requires weight > 0)', () => {
    // rawWeight=0 fails the `isCategorical && rawWeight > 0` branch,
    // catMapping.isWeighted=false → else branch: parentDelta = -(weightPerUnit||parentUnits||1) = -1
    const { parentDelta, childDelta } = computeDeltas(0, catMapping, true);
    expect(parentDelta).toBe(-1);
    expect(childDelta).toBe(1);
  });

  it('categorical overrides isWeighted:false — still uses round(weight)', () => {
    const mapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 0, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(2.2, mapping, true);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(2);
  });

  it('categorical overrides isWeighted:true — still uses round(weight), not weightPerUnit ratio', () => {
    const mapping: MappingLike = { found: true, isWeighted: true, weightPerUnit: 0.5, parentUnits: 1 };
    // If NOT categorical with weightPerUnit 0.5: round(2.0/0.5) = 4
    // With isCategorical: round(2.0) = 2
    const { parentDelta, childDelta } = computeDeltas(2.0, mapping, true);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(2);
  });
});

// ─── Inventory delta — weighted transformation (fish/beef ratio) ──────────────

describe('computeDeltas — weighted transformation (isCategorical = false)', () => {
  it('weightPerUnit 2.0: 4.0 lbs → 4/2 = 2 units: parent −2, child +2', () => {
    const mapping: MappingLike = { found: true, isWeighted: true, weightPerUnit: 2.0, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(4.0, mapping, false);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(2);
  });

  it('weightPerUnit 1.0: 1.8 lbs → round(1.8/1) = 2: parent −2, child +2', () => {
    const mapping: MappingLike = { found: true, isWeighted: true, weightPerUnit: 1.0, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(1.8, mapping, false);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(2);
  });

  it('weightPerUnit 0 falls back to round(weight)', () => {
    const mapping: MappingLike = { found: true, isWeighted: true, weightPerUnit: 0, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(3.3, mapping, false);
    expect(parentDelta).toBe(-3);
    expect(childDelta).toBe(3);
  });

  it('zero weight → no delta', () => {
    const mapping: MappingLike = { found: true, isWeighted: true, weightPerUnit: 1.0, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(0, mapping, false);
    expect(parentDelta).toBe(0);
    expect(childDelta).toBe(0);
  });
});

// ─── Inventory delta — count-based transformation ────────────────────────────

describe('computeDeltas — count-based (isWeighted = false, isCategorical = false)', () => {
  it('uses weightPerUnit when set: parent −3, child +1', () => {
    const mapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 3, parentUnits: 1 };
    const { parentDelta, childDelta } = computeDeltas(0, mapping, false);
    expect(parentDelta).toBe(-3);
    expect(childDelta).toBe(1);
  });

  it('falls back to parentUnits when weightPerUnit is 0', () => {
    const mapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 0, parentUnits: 2 };
    const { parentDelta, childDelta } = computeDeltas(0, mapping, false);
    expect(parentDelta).toBe(-2);
    expect(childDelta).toBe(1);
  });

  it('falls back to 1 when both weightPerUnit and parentUnits are 0', () => {
    const mapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 0, parentUnits: 0 };
    const { parentDelta, childDelta } = computeDeltas(0, mapping, false);
    expect(parentDelta).toBe(-1);
    expect(childDelta).toBe(1);
  });

  it('childDelta is always 1 for count-based, regardless of weight', () => {
    const mapping: MappingLike = { found: true, isWeighted: false, weightPerUnit: 5, parentUnits: 1 };
    const { childDelta } = computeDeltas(10.5, mapping, false);
    expect(childDelta).toBe(1);
  });
});

// ─── Session counter increment logic ─────────────────────────────────────────

describe('sessionIncrement — categorical products use round(weight)', () => {
  it('1.8 lbs → increment 2', () => {
    expect(sessionIncrement(1.8, true)).toBe(2);
  });

  it('3.3 lbs → increment 3', () => {
    expect(sessionIncrement(3.3, true)).toBe(3);
  });

  it('2.5 lbs → increment 3 (rounds half-up)', () => {
    expect(sessionIncrement(2.5, true)).toBe(3);
  });

  it('1.4 lbs → increment 1', () => {
    expect(sessionIncrement(1.4, true)).toBe(1);
  });

  it('zero weight → increment 1 (guard: falls through to default)', () => {
    expect(sessionIncrement(0, true)).toBe(1);
  });

  it('negative weight → increment 1 (guard)', () => {
    expect(sessionIncrement(-1, true)).toBe(1);
  });
});

describe('sessionIncrement — non-categorical (beef/fish) always +1 per label', () => {
  it('3.5 lbs non-categorical → increment 1', () => {
    expect(sessionIncrement(3.5, false)).toBe(1);
  });

  it('zero weight non-categorical → increment 1', () => {
    expect(sessionIncrement(0, false)).toBe(1);
  });
});

// ─── Session counter cumulative math ─────────────────────────────────────────

describe('session counter cumulative math', () => {
  it('processes 5 items of 2 lbs each → sessionQty = 10', () => {
    let sessionQty = 0;
    const weights = [2.0, 2.0, 2.0, 2.0, 2.0];
    for (const w of weights) sessionQty += sessionIncrement(w, true);
    expect(sessionQty).toBe(10);
  });

  it('mixed weights: 1.8 + 3.3 + 2.5 → 2 + 3 + 3 = 8', () => {
    let sessionQty = 0;
    for (const w of [1.8, 3.3, 2.5]) sessionQty += sessionIncrement(w, true);
    expect(sessionQty).toBe(8);
  });

  it('closes when cumulativeQty + sessionQty >= poQty', () => {
    const poQty = 18;
    const priorCumulative = 10;
    let sessionQty = 0;
    const weights = [3.3, 2.5, 1.8]; // 3 + 3 + 2 = 8
    let shouldClose = false;
    for (const w of weights) {
      sessionQty += sessionIncrement(w, true);
      if (priorCumulative + sessionQty >= poQty) { shouldClose = true; break; }
    }
    expect(shouldClose).toBe(true);
    expect(priorCumulative + sessionQty).toBeGreaterThanOrEqual(poQty);
  });

  it('does not close early when cumulative total is still below poQty', () => {
    const poQty = 18;
    const priorCumulative = 0;
    let sessionQty = 0;
    for (const w of [1.8, 2.2, 1.4]) sessionQty += sessionIncrement(w, true); // 2 + 2 + 1 = 5
    expect(priorCumulative + sessionQty).toBeLessThan(poQty);
  });

  it('wastage = poQty − cumulativeQty − sessionQty', () => {
    const poQty = 18;
    const cumulativeQty = 10;
    const sessionQty = 5;
    const wastage = poQty - cumulativeQty - sessionQty;
    expect(wastage).toBe(3);
  });

  it('wastage = 0 when fully processed', () => {
    const poQty = 18;
    const cumulativeQty = 10;
    const sessionQty = 8;
    const wastage = Math.max(0, poQty - cumulativeQty - sessionQty);
    expect(wastage).toBe(0);
  });
});

// ─── SN lookup + mark-shipped integration shape ───────────────────────────────

describe('SN lookup + mark-shipped flow', () => {
  it('N/A PLU label still has extractable SN', () => {
    const result = parseQrLabel('N/A | Red Chicken | 2.20 lb | SN:chk-100042');
    expect(result!.plu).toBe('N/A');
    expect(result!.sn).toBe('chk-100042');
  });

  it('mark-shipped payload is constructed correctly from scan result', () => {
    const sn = 'chk-100042';
    const orderId = 'gid://shopify/Order/9876543210';
    const payload = JSON.stringify({ sn, orderId });
    const parsed = JSON.parse(payload);
    expect(parsed.sn).toBe(sn);
    expect(parsed.orderId).toBe(orderId);
  });

  it('mark-shipped is skipped when qr is null (barcode-only scan)', () => {
    const qr = null;
    const shouldStamp = qr !== null && (qr as QrLabel | null)?.sn != null;
    expect(shouldStamp).toBe(false);
  });

  it('mark-shipped fires when qr.sn is present', () => {
    const qr: QrLabel = { plu: 'N/A', productTitle: 'Fish', itemWeight: '2.0 lb', printedAt: '', sn: 'fish-001', weightGrams: 907 };
    const shouldStamp = qr !== null && qr.sn != null;
    expect(shouldStamp).toBe(true);
  });

  it('variantId-based line item match takes priority over PLU', () => {
    const snVariantId = 'gid://shopify/ProductVariant/999';
    const lineItems = [
      { variantId: 'gid://shopify/ProductVariant/999', productTitle: 'Red Chicken', barcode: null },
      { variantId: 'gid://shopify/ProductVariant/111', productTitle: 'Other Product', barcode: '0000' },
    ];
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const item = lineItems.find(li =>
      (li.variantId && norm(li.variantId) === norm(snVariantId)) ||
      norm(li.productTitle) === norm('Red Chicken'),
    );
    expect(item).toBeTruthy();
    expect(item!.variantId).toBe('gid://shopify/ProductVariant/999');
  });

  it('falls back to PLU match when SN lookup returns no variantId', () => {
    const snVariantId: string | null = null;
    const qrPlu = '1234';
    const lineItems = [
      { variantId: null, productTitle: 'Red Chicken', barcode: '1234' },
    ];
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const item = lineItems.find(li =>
      snVariantId
        ? li.variantId && norm(li.variantId) === norm(snVariantId)
        : (li.barcode && norm(li.barcode) === norm(qrPlu)),
    );
    expect(item).toBeTruthy();
    expect(item!.barcode).toBe('1234');
  });
});
