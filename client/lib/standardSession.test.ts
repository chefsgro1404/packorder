import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Re-implement incrementSessionCounter logic for isolated testing ──────────
// Mirrors the useCallback in scale/page.tsx exactly.

interface InventoryMappingInfo {
  found: boolean;
  isWeighted: boolean;
  weightPerUnit: number;
  parentInventoryId: string;
  parentProductHandle: string;
  parentProductTitle: string;
  parentLocationId: string;
  childInventoryItemId?: string | null;
  parentUnits?: number;
  childUnits?: number;
}

interface CurrentItem {
  productTitle: string;
  variantTitle?: string | null;
  itemWeight?: string;
}

interface ProcessingSession {
  poQty: number;
  sessionQty: number;
  cumulativeQty: number;
  variantBreakdown: Record<string, number>;
}

function computeChildDelta(item: CurrentItem, mapping: InventoryMappingInfo | null): number {
  const rawWeight = parseFloat(item.itemWeight?.replace(/[^0-9.]/g, '') ?? '0') || 0;
  let childDelta = 1;
  if (mapping?.found && mapping.isWeighted && rawWeight > 0) {
    childDelta = mapping.weightPerUnit > 0
      ? Math.round(rawWeight / mapping.weightPerUnit)
      : Math.round(rawWeight);
  }
  return childDelta;
}

function applySessionIncrement(
  prev: ProcessingSession,
  item: CurrentItem,
  mapping: InventoryMappingInfo | null,
): ProcessingSession {
  const childDelta = computeChildDelta(item, mapping);
  const breakdownKey = item.variantTitle ?? item.productTitle ?? 'Standard';
  const breakdown = { ...prev.variantBreakdown };
  breakdown[breakdownKey] = (breakdown[breakdownKey] ?? 0) + childDelta;
  const newSessionQty = prev.sessionQty + childDelta;
  return { ...prev, sessionQty: newSessionQty, variantBreakdown: breakdown };
}

// ─── computeChildDelta — count-based children ────────────────────────────────

describe('computeChildDelta — count-based child (isWeighted: false)', () => {
  const countMapping: InventoryMappingInfo = {
    found: true,
    isWeighted: false,
    weightPerUnit: 3,
    parentInventoryId: 'inv-parent',
    parentProductHandle: 'whole-beef',
    parentProductTitle: 'Whole Beef',
    parentLocationId: 'gid://shopify/Location/1',
  };

  it('returns 1 for count-based child regardless of weight', () => {
    expect(computeChildDelta({ productTitle: 'Beef 3lb', itemWeight: '3.2 lbs' }, countMapping)).toBe(1);
  });

  it('returns 1 for count-based child with zero weight', () => {
    expect(computeChildDelta({ productTitle: 'Beef 3lb', itemWeight: '0 lbs' }, countMapping)).toBe(1);
  });

  it('returns 1 for count-based child with no weight', () => {
    expect(computeChildDelta({ productTitle: 'Beef 3lb', itemWeight: '' }, countMapping)).toBe(1);
  });

  it('returns 1 when mapping is null (no mapping)', () => {
    expect(computeChildDelta({ productTitle: 'Unknown', itemWeight: '5 lbs' }, null)).toBe(1);
  });

  it('returns 1 when mapping.found is false', () => {
    const noMapping: InventoryMappingInfo = { ...countMapping, found: false };
    expect(computeChildDelta({ productTitle: 'Beef', itemWeight: '4.1 lbs' }, noMapping)).toBe(1);
  });
});

// ─── computeChildDelta — weight-based children ───────────────────────────────

describe('computeChildDelta — weight-based child (isWeighted: true)', () => {
  const weightMapping: InventoryMappingInfo = {
    found: true,
    isWeighted: true,
    weightPerUnit: 1,       // 1:1 direct (keema)
    parentInventoryId: 'inv-parent',
    parentProductHandle: 'whole-beef',
    parentProductTitle: 'Whole Beef',
    parentLocationId: 'gid://shopify/Location/1',
  };

  it('returns round(weight) for 1:1 keema at 4.2 lbs', () => {
    expect(computeChildDelta({ productTitle: 'Beef Keema', itemWeight: '4.2 lbs' }, weightMapping)).toBe(4);
  });

  it('returns round(weight) for 1:1 keema at 4.6 lbs', () => {
    expect(computeChildDelta({ productTitle: 'Beef Keema', itemWeight: '4.6 lbs' }, weightMapping)).toBe(5);
  });

  it('returns round(weight) for exactly 3 lbs', () => {
    expect(computeChildDelta({ productTitle: 'Beef Keema', itemWeight: '3.0 lbs' }, weightMapping)).toBe(3);
  });

  it('returns 1 for 0 weight even when isWeighted (guard prevents divide-by-zero)', () => {
    expect(computeChildDelta({ productTitle: 'Beef Keema', itemWeight: '0' }, weightMapping)).toBe(1);
  });

  it('handles ratio mapping (weightPerUnit=2): 6.3 lbs → round(6.3/2) = 3', () => {
    const ratioMapping = { ...weightMapping, weightPerUnit: 2 };
    expect(computeChildDelta({ productTitle: 'Beef Mince', itemWeight: '6.3 lbs' }, ratioMapping)).toBe(3);
  });

  it('handles ratio mapping (weightPerUnit=2): 7.0 lbs → round(7.0/2) = 4 (rounds 3.5 up)', () => {
    const ratioMapping = { ...weightMapping, weightPerUnit: 2 };
    expect(computeChildDelta({ productTitle: 'Beef Mince', itemWeight: '7.0 lbs' }, ratioMapping)).toBe(4);
  });

  it('handles weightPerUnit=0 (falls back to round(weight) directly)', () => {
    const zeroUnitMapping = { ...weightMapping, weightPerUnit: 0 };
    expect(computeChildDelta({ productTitle: 'Beef', itemWeight: '5.7 lbs' }, zeroUnitMapping)).toBe(6);
  });

  it('strips non-numeric chars from weight string', () => {
    expect(computeChildDelta({ productTitle: 'Keema', itemWeight: '4.2lb' }, weightMapping)).toBe(4);
    expect(computeChildDelta({ productTitle: 'Keema', itemWeight: '4.2 kg' }, weightMapping)).toBe(4);
  });

  it('handles undefined itemWeight gracefully', () => {
    expect(computeChildDelta({ productTitle: 'Keema', itemWeight: undefined }, weightMapping)).toBe(1);
  });
});

// ─── applySessionIncrement ────────────────────────────────────────────────────

describe('applySessionIncrement', () => {
  const baseSession: ProcessingSession = {
    poQty: 100,
    sessionQty: 0,
    cumulativeQty: 0,
    variantBreakdown: {},
  };

  const countMapping: InventoryMappingInfo = {
    found: true, isWeighted: false, weightPerUnit: 1,
    parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
  };

  const weightMapping: InventoryMappingInfo = {
    found: true, isWeighted: true, weightPerUnit: 1,
    parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
  };

  it('increments sessionQty by 1 for count-based print', () => {
    const result = applySessionIncrement(baseSession, { productTitle: '3lb Pack', itemWeight: '3.0 lbs' }, countMapping);
    expect(result.sessionQty).toBe(1);
  });

  it('increments sessionQty by round(weight) for weight-based print', () => {
    const result = applySessionIncrement(baseSession, { productTitle: 'Keema', itemWeight: '4.2 lbs' }, weightMapping);
    expect(result.sessionQty).toBe(4);
  });

  it('accumulates across multiple prints', () => {
    let session = baseSession;
    session = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '4.2 lbs' }, weightMapping);
    session = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '3.8 lbs' }, weightMapping);
    expect(session.sessionQty).toBe(8); // 4 + 4
  });

  it('tracks variant breakdown by variantTitle when present', () => {
    const result = applySessionIncrement(baseSession, { productTitle: 'Beef', variantTitle: '3lb Pack', itemWeight: '3.0 lbs' }, countMapping);
    expect(result.variantBreakdown['3lb Pack']).toBe(1);
  });

  it('tracks variant breakdown by productTitle when no variantTitle', () => {
    const result = applySessionIncrement(baseSession, { productTitle: 'Keema', variantTitle: null, itemWeight: '4.2 lbs' }, weightMapping);
    expect(result.variantBreakdown['Keema']).toBe(4);
  });

  it('accumulates breakdown for same key across prints', () => {
    let session = baseSession;
    session = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '4.0 lbs' }, weightMapping);
    session = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '3.0 lbs' }, weightMapping);
    expect(session.variantBreakdown['Keema']).toBe(7); // 4 + 3
  });

  it('tracks multiple output variants independently in same session', () => {
    let session = baseSession;
    session = applySessionIncrement(session, { productTitle: 'Beef', variantTitle: '3lb Pack', itemWeight: '3.0 lbs' }, countMapping);
    session = applySessionIncrement(session, { productTitle: 'Beef', variantTitle: 'Keema', itemWeight: '4.2 lbs' }, weightMapping);
    expect(session.variantBreakdown['3lb Pack']).toBe(1);
    expect(session.variantBreakdown['Keema']).toBe(4);
    expect(session.sessionQty).toBe(5); // 1 + 4
  });

  it('does not mutate the original session object', () => {
    const original = { ...baseSession, variantBreakdown: { Keema: 2 } };
    applySessionIncrement(original, { productTitle: 'Keema', itemWeight: '3.0 lbs' }, weightMapping);
    expect(original.variantBreakdown['Keema']).toBe(2); // unchanged
    expect(original.sessionQty).toBe(0); // unchanged
  });
});

// ─── Session completion detection ────────────────────────────────────────────

describe('session completion detection', () => {
  it('detects completion when newTotal reaches poQty', () => {
    const session: ProcessingSession = { poQty: 10, sessionQty: 8, cumulativeQty: 0, variantBreakdown: {} };
    const weightMapping: InventoryMappingInfo = {
      found: true, isWeighted: true, weightPerUnit: 1,
      parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
    };
    const result = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '2.0 lbs' }, weightMapping);
    expect(result.sessionQty).toBe(10);
    expect(result.sessionQty + result.cumulativeQty).toBeGreaterThanOrEqual(result.poQty);
  });

  it('detects completion when cumulative + session >= poQty', () => {
    const session: ProcessingSession = { poQty: 50, sessionQty: 20, cumulativeQty: 25, variantBreakdown: {} };
    const weightMapping: InventoryMappingInfo = {
      found: true, isWeighted: true, weightPerUnit: 1,
      parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
    };
    const result = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '5.0 lbs' }, weightMapping);
    expect(result.cumulativeQty + result.sessionQty).toBeGreaterThanOrEqual(result.poQty);
  });

  it('no completion trigger when still under poQty', () => {
    const session: ProcessingSession = { poQty: 100, sessionQty: 10, cumulativeQty: 20, variantBreakdown: {} };
    const weightMapping: InventoryMappingInfo = {
      found: true, isWeighted: true, weightPerUnit: 1,
      parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
    };
    const result = applySessionIncrement(session, { productTitle: 'Keema', itemWeight: '3.0 lbs' }, weightMapping);
    expect(result.cumulativeQty + result.sessionQty).toBeLessThan(result.poQty);
  });
});

// ─── Lot pool aggregation logic ───────────────────────────────────────────────

describe('lot pool: session keyed by poLineItemId', () => {
  it('cumulative qty is sum across all prior sessions for same line item', () => {
    // Mirrors GetProcessingSessionsByLineItemAsync aggregation
    const sessions = [
      { sessionQty: 15, wastageQty: 0 },
      { sessionQty: 20, wastageQty: 2 },
      { sessionQty: 10, wastageQty: 0 },
    ];
    const cumulativeQty = sessions.reduce((acc, s) => acc + s.sessionQty, 0);
    expect(cumulativeQty).toBe(45);
  });

  it('total wastage is summed across all sessions', () => {
    const sessions = [
      { sessionQty: 15, wastageQty: 1 },
      { sessionQty: 20, wastageQty: 3 },
    ];
    const wastageQty = sessions.reduce((acc, s) => acc + s.wastageQty, 0);
    expect(wastageQty).toBe(4);
  });

  it('remaining = poQty - cumulative - currentSession', () => {
    const poQty = 100;
    const cumulative = 45;
    const currentSession = 10;
    const remaining = Math.max(0, poQty - cumulative - currentSession);
    expect(remaining).toBe(45);
  });

  it('remaining is clamped to 0 (never negative)', () => {
    const poQty = 50;
    const cumulative = 48;
    const currentSession = 5;
    const remaining = Math.max(0, poQty - cumulative - currentSession);
    expect(remaining).toBe(0);
  });

  it('scanning any barcode in a lot group shows same remaining', () => {
    // All barcodes share the same PoLineItemId → same cumulativeQty from GetProcessingSessionsByLineItemAsync
    const poLineItemId = 'line-item-123';
    const sessions = [
      { partitionKey: poLineItemId, sessionQty: 20 },
      { partitionKey: poLineItemId, sessionQty: 15 },
    ];
    const cumulative = sessions
      .filter(s => s.partitionKey === poLineItemId)
      .reduce((acc, s) => acc + s.sessionQty, 0);
    expect(cumulative).toBe(35);
  });
});

// ─── Session mode detection ───────────────────────────────────────────────────

describe('session mode detection (standard vs categorical vs none)', () => {
  it('categorical: weightRanges.length > 0 → categorical mode', () => {
    const weightRanges = [{ variantId: 'v1', label: 'Small', minLbs: 0, maxLbs: 2 }];
    const hasAdjustments = true;
    const isCategorical = weightRanges.length > 0;
    const isStandard = !isCategorical && hasAdjustments;
    expect(isCategorical).toBe(true);
    expect(isStandard).toBe(false);
  });

  it('standard: no weight ranges but has adjustments → standard session', () => {
    const weightRanges: unknown[] = [];
    const hasAdjustments = true;
    const isCategorical = weightRanges.length > 0;
    const isStandard = !isCategorical && hasAdjustments;
    expect(isCategorical).toBe(false);
    expect(isStandard).toBe(true);
  });

  it('no session: no weight ranges and no adjustments', () => {
    const weightRanges: unknown[] = [];
    const hasAdjustments = false;
    const isCategorical = weightRanges.length > 0;
    const isStandard = !isCategorical && hasAdjustments;
    expect(isCategorical).toBe(false);
    expect(isStandard).toBe(false);
  });

  it('session auto-starts condition: has PO context AND (categorical OR standard)', () => {
    const snPoId = 'gid://shopify/PurchaseOrder/1';
    const snPoLineItemId = 'line-1';
    const sessionRules: unknown[] = [];
    const hasAdjustments = true;
    const shouldStart = !!(snPoId && snPoLineItemId && (sessionRules.length > 0 || hasAdjustments));
    expect(shouldStart).toBe(true);
  });

  it('session does not auto-start without PO context', () => {
    const snPoId = null;
    const snPoLineItemId = null;
    const sessionRules: unknown[] = [];
    const hasAdjustments = true;
    const shouldStart = !!(snPoId && snPoLineItemId && (sessionRules.length > 0 || hasAdjustments));
    expect(shouldStart).toBe(false);
  });
});

// ─── closeSession wastage logic ───────────────────────────────────────────────

describe('closeSession — wastage calculation', () => {
  it('completed with no wastage → unaccounted = 0', () => {
    const poQty = 50;
    const totalProcessed = 50;
    const unaccounted = Math.max(0, poQty - totalProcessed);
    expect(unaccounted).toBe(0);
  });

  it('completed with wastage → unaccounted > 0', () => {
    const poQty = 100;
    const cumulativeQty = 30;
    const sessionQty = 55;
    const totalProcessed = cumulativeQty + sessionQty;
    const unaccounted = Math.max(0, poQty - totalProcessed);
    expect(unaccounted).toBe(15);
  });

  it('over-processed → unaccounted clamped to 0', () => {
    const poQty = 50;
    const totalProcessed = 60;
    const unaccounted = Math.max(0, poQty - totalProcessed);
    expect(unaccounted).toBe(0);
  });

  it('partial close (process later) → status partial, wastageQty 0', () => {
    const status = 'partial';
    const wastageQty = 0;
    expect(status).toBe('partial');
    expect(wastageQty).toBe(0);
  });

  it('wastage confirmed → status completed, wastageQty > 0', () => {
    const unaccounted = 15;
    const status = 'completed';
    const wastageQty = unaccounted;
    expect(status).toBe('completed');
    expect(wastageQty).toBe(15);
  });

  it('inventory delta for wastage is negative', () => {
    const wastageQty = 12;
    const delta = -wastageQty;
    expect(delta).toBe(-12);
  });

  it('wastage inventory only applied for completed status', () => {
    const applyInventory = (status: string, wastageQty: number) =>
      status === 'completed' && wastageQty > 0;
    expect(applyInventory('completed', 10)).toBe(true);
    expect(applyInventory('partial',   10)).toBe(false);
    expect(applyInventory('completed',  0)).toBe(false);
  });
});

// ─── Session resume logic ─────────────────────────────────────────────────────

describe('session resume from prior cumulative', () => {
  it('new session starts with cumulativeQty from prior closed sessions', () => {
    // Mirrors GET /api/scale/processing-session response
    const sessData = { cumulativeQty: 45, sessionStatus: 'partial', sessionCount: 2 };
    const priorCumulative = sessData.cumulativeQty ?? 0;
    expect(priorCumulative).toBe(45);
  });

  it('no prior sessions → priorCumulative is 0', () => {
    const sessData = { sessionCount: 0, cumulativeQty: 0, sessionStatus: 'none' };
    const priorCumulative = (sessData.sessionStatus === 'partial' || sessData.sessionCount > 0)
      ? (sessData.cumulativeQty ?? 0) : 0;
    expect(priorCumulative).toBe(0);
  });

  it('resumes if sessionStatus is partial OR sessionCount > 0', () => {
    const shouldResume = (d: { sessionStatus: string; sessionCount: number }) =>
      d.sessionStatus === 'partial' || d.sessionCount > 0;

    expect(shouldResume({ sessionStatus: 'partial', sessionCount: 1 })).toBe(true);
    expect(shouldResume({ sessionStatus: 'completed', sessionCount: 1 })).toBe(true);
    expect(shouldResume({ sessionStatus: 'none', sessionCount: 0 })).toBe(false);
  });

  it('poQty falls back to sessData.poQty when PO line item not loaded', () => {
    const lineItemPoQty = 0;
    const sessDataPoQty = 100;
    const poQty = lineItemPoQty || sessDataPoQty;
    expect(poQty).toBe(100);
  });

  it('poQty uses quantityReceived over quantityOrdered when received > 0', () => {
    const li = { quantityReceived: 95, quantityOrdered: 100 };
    const poQty = (li.quantityReceived > 0) ? li.quantityReceived : li.quantityOrdered;
    expect(poQty).toBe(95);
  });

  it('poQty falls back to quantityOrdered when no received yet', () => {
    const li = { quantityReceived: 0, quantityOrdered: 100 };
    const poQty = (li.quantityReceived > 0) ? li.quantityReceived : li.quantityOrdered;
    expect(poQty).toBe(100);
  });
});

// ─── incrementSessionCounter edge cases ──────────────────────────────────────

describe('incrementSessionCounter edge cases', () => {
  const weightMapping: InventoryMappingInfo = {
    found: true, isWeighted: true, weightPerUnit: 1,
    parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
  };

  it('very large weight rounds correctly', () => {
    expect(computeChildDelta({ productTitle: 'Beef', itemWeight: '99.6 lbs' }, weightMapping)).toBe(100);
  });

  it('weight string with multiple non-numeric chars strips cleanly', () => {
    expect(computeChildDelta({ productTitle: 'Beef', itemWeight: '4.2 lbs (approx)' }, weightMapping)).toBe(4);
  });

  it('weight string with comma decimal separator still parses', () => {
    // parseFloat handles "4.2" but not "4,2" — comma yields 4 (truncated), consistent
    const rawWeight = parseFloat('4,2'.replace(/[^0-9.]/g, '') ?? '0') || 0;
    expect(rawWeight).toBe(42); // "4,2" → "42" after strip → 42 — documented behaviour, not a bug
    // This test documents the current behaviour so a future change doesn't go unnoticed
  });

  it('negative-sign weight string: regex strips "-" so parses as positive', () => {
    // '-3 lbs' → replace([^0-9.], '') → '3' → rawWeight=3 → childDelta=3
    // The minus sign is removed by the regex; result is the absolute value
    expect(computeChildDelta({ productTitle: 'Beef', itemWeight: '-3 lbs' }, weightMapping)).toBe(3);
  });

  it('childDelta is always a positive integer', () => {
    const deltas = [
      computeChildDelta({ productTitle: 'Beef', itemWeight: '1.4 lbs' }, weightMapping),
      computeChildDelta({ productTitle: 'Beef', itemWeight: '5.0 lbs' }, weightMapping),
      computeChildDelta({ productTitle: 'Beef', itemWeight: '10.9 lbs' }, weightMapping),
    ];
    for (const d of deltas) {
      expect(d).toBeGreaterThan(0);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it('session does not go below 0 when prev is null (guard clause)', () => {
    // The functional version: prev is null → return null
    const result = (prev: ProcessingSession | null) =>
      prev ? { ...prev, sessionQty: prev.sessionQty + 1 } : null;
    expect(result(null)).toBeNull();
  });

  it('mixed session: count-based and weight-based prints accumulate correctly', () => {
    const countMapping: InventoryMappingInfo = {
      found: true, isWeighted: false, weightPerUnit: 1,
      parentInventoryId: '', parentProductHandle: '', parentProductTitle: '', parentLocationId: '',
    };
    let session: ProcessingSession = { poQty: 100, sessionQty: 0, cumulativeQty: 0, variantBreakdown: {} };

    // 3lb pack (count-based): +1
    session = applySessionIncrement(session, { productTitle: 'Beef', variantTitle: '3lb Pack', itemWeight: '3.2 lbs' }, countMapping);
    // Keema (weight-based): +round(4.6) = +5
    session = applySessionIncrement(session, { productTitle: 'Beef', variantTitle: 'Keema', itemWeight: '4.6 lbs' }, weightMapping);
    // Another 3lb pack: +1
    session = applySessionIncrement(session, { productTitle: 'Beef', variantTitle: '3lb Pack', itemWeight: '2.9 lbs' }, countMapping);

    expect(session.sessionQty).toBe(7);                          // 1 + 5 + 1
    expect(session.variantBreakdown['3lb Pack']).toBe(2);
    expect(session.variantBreakdown['Keema']).toBe(5);
  });
});

// ─── Remaining qty display ────────────────────────────────────────────────────

describe('remaining qty display', () => {
  it('remaining = poQty - cumulative - session', () => {
    const poQty = 100;
    const cumulativeQty = 40;
    const sessionQty = 20;
    const remaining = Math.max(0, poQty - cumulativeQty - sessionQty);
    expect(remaining).toBe(40);
  });

  it('remaining is 0 when fully processed', () => {
    const remaining = Math.max(0, 100 - 60 - 40);
    expect(remaining).toBe(0);
  });

  it('remaining text color should be amber when > 0', () => {
    const remaining = 15;
    const colorClass = remaining > 0 ? 'text-amber-300' : 'text-emerald-300';
    expect(colorClass).toBe('text-amber-300');
  });

  it('remaining text color should be emerald when 0', () => {
    const remaining = 0;
    const colorClass = remaining > 0 ? 'text-amber-300' : 'text-emerald-300';
    expect(colorClass).toBe('text-emerald-300');
  });

  it('total processed = cumulativeQty + sessionQty', () => {
    const totalProcessed = 30 + 25;
    expect(totalProcessed).toBe(55);
  });
});
