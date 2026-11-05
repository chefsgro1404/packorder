import { describe, it, expect } from 'vitest';

// ─── Discrepancy logic helpers (mirrors applyBulkApprovalAndInventory) ─────────

function computeDiscrepancy(
  quantityOrdered: number,
  printedCount: number,
  isLotMethod: boolean,
): { discrepancyQty: number | null; discrepancyType: string | null } {
  const hasDiscrepancy = printedCount !== quantityOrdered;
  if (!hasDiscrepancy) return { discrepancyQty: null, discrepancyType: null };
  if (isLotMethod) return { discrepancyQty: 0, discrepancyType: 'lot_method' };
  return {
    discrepancyQty: Math.abs(quantityOrdered - printedCount),
    discrepancyType: printedCount < quantityOrdered ? 'short' : 'over',
  };
}

function computeInventoryDelta(
  quantityOrdered: number,
  printedCount: number,
  isLotMethod: boolean,
  lotTotalWeightLbs?: number,
): number {
  if (lotTotalWeightLbs !== undefined) return lotTotalWeightLbs;
  return isLotMethod ? quantityOrdered : printedCount;
}

function computeApprovalQty(
  quantityOrdered: number,
  printedCount: number,
  isLotMethod: boolean,
  lotTotalWeightLbs?: number,
): number {
  if (lotTotalWeightLbs !== undefined) return lotTotalWeightLbs;
  return isLotMethod ? quantityOrdered : printedCount;
}

// ─── Discrepancy computation — standard method ─────────────────────────────────

describe('computeDiscrepancy — standard method', () => {
  it('returns null fields when printed === ordered', () => {
    const result = computeDiscrepancy(100, 100, false);
    expect(result.discrepancyQty).toBeNull();
    expect(result.discrepancyType).toBeNull();
  });

  it('short: printed < ordered', () => {
    const result = computeDiscrepancy(100, 90, false);
    expect(result.discrepancyQty).toBe(10);
    expect(result.discrepancyType).toBe('short');
  });

  it('over: printed > ordered', () => {
    const result = computeDiscrepancy(50, 55, false);
    expect(result.discrepancyQty).toBe(5);
    expect(result.discrepancyType).toBe('over');
  });

  it('short by 1 unit', () => {
    const result = computeDiscrepancy(10, 9, false);
    expect(result.discrepancyQty).toBe(1);
    expect(result.discrepancyType).toBe('short');
  });

  it('over by 1 unit', () => {
    const result = computeDiscrepancy(10, 11, false);
    expect(result.discrepancyQty).toBe(1);
    expect(result.discrepancyType).toBe('over');
  });

  it('discrepancyQty is always absolute (never negative)', () => {
    const shortResult = computeDiscrepancy(100, 60, false);
    const overResult = computeDiscrepancy(60, 100, false);
    expect(shortResult.discrepancyQty).toBeGreaterThan(0);
    expect(overResult.discrepancyQty).toBeGreaterThan(0);
  });

  it('short by large amount', () => {
    const result = computeDiscrepancy(1000, 1, false);
    expect(result.discrepancyQty).toBe(999);
    expect(result.discrepancyType).toBe('short');
  });
});

// ─── Discrepancy computation — lot method ─────────────────────────────────────

describe('computeDiscrepancy — lot method', () => {
  it('lot_method type with discrepancyQty=0 when printed !== ordered', () => {
    const result = computeDiscrepancy(1, 3, true);
    expect(result.discrepancyQty).toBe(0);
    expect(result.discrepancyType).toBe('lot_method');
  });

  it('lot_method: single barcode for a lot (most common)', () => {
    const result = computeDiscrepancy(1, 1, true);
    // printed === ordered so no discrepancy
    expect(result.discrepancyQty).toBeNull();
    expect(result.discrepancyType).toBeNull();
  });

  it('lot_method: 2 barcodes for 1 ordered — still lot_method not over', () => {
    const result = computeDiscrepancy(1, 2, true);
    expect(result.discrepancyType).toBe('lot_method');
    expect(result.discrepancyQty).toBe(0);
  });

  it('lot_method: 0 discrepancyQty regardless of printed amount', () => {
    for (const printed of [2, 5, 10, 50]) {
      const result = computeDiscrepancy(1, printed, true);
      expect(result.discrepancyQty).toBe(0);
    }
  });
});

// ─── Inventory delta ───────────────────────────────────────────────────────────

describe('computeInventoryDelta', () => {
  it('standard: uses printedCount', () => {
    expect(computeInventoryDelta(100, 90, false)).toBe(90);
  });

  it('standard: full quantity — printed === ordered', () => {
    expect(computeInventoryDelta(50, 50, false)).toBe(50);
  });

  it('standard: over quantity', () => {
    expect(computeInventoryDelta(50, 55, false)).toBe(55);
  });

  it('lot method: uses quantityOrdered regardless of printedCount', () => {
    expect(computeInventoryDelta(1, 3, true)).toBe(1);
  });

  it('lot method: quantityOrdered always wins over printedCount', () => {
    expect(computeInventoryDelta(1, 10, true)).toBe(1);
  });

  it('weight-based lot: uses lotTotalWeightLbs', () => {
    expect(computeInventoryDelta(1, 3, true, 420.5)).toBe(420.5);
  });

  it('weight-based standard: lotTotalWeightLbs overrides printedCount', () => {
    expect(computeInventoryDelta(100, 90, false, 350)).toBe(350);
  });
});

// ─── Approval qty ─────────────────────────────────────────────────────────────

describe('computeApprovalQty', () => {
  it('standard no weight: approval qty = printedCount', () => {
    expect(computeApprovalQty(100, 90, false)).toBe(90);
  });

  it('lot method no weight: approval qty = quantityOrdered', () => {
    expect(computeApprovalQty(1, 3, true)).toBe(1);
  });

  it('weight-based: approval qty = lotTotalWeightLbs', () => {
    expect(computeApprovalQty(1, 2, true, 400)).toBe(400);
  });

  it('weight-based standard: approval qty = lotTotalWeightLbs', () => {
    expect(computeApprovalQty(100, 90, false, 350)).toBe(350);
  });
});

// ─── Lot product set membership ───────────────────────────────────────────────

describe('lot product set membership', () => {
  const makeSet = (ids: string[]) => new Set<string>(ids);

  it('detects configured lot product', () => {
    const lotSet = makeSet(['7654321', '8001234']);
    expect(lotSet.has('7654321')).toBe(true);
  });

  it('returns false for unconfigured product', () => {
    const lotSet = makeSet(['7654321']);
    expect(lotSet.has('9999999')).toBe(false);
  });

  it('empty set — no lot products', () => {
    const lotSet = makeSet([]);
    expect(lotSet.has('7654321')).toBe(false);
  });

  it('productId is string key (not numeric)', () => {
    const lotSet = makeSet(['12345']);
    expect(lotSet.has('12345')).toBe(true);
    // numeric 12345 is not the same key
    expect(lotSet.has(String(12345))).toBe(true); // coerced to string
  });

  it('null productId — not in lot set', () => {
    const lotSet = makeSet(['7654321']);
    const productId: string | null = null;
    expect(productId !== null && lotSet.has(productId)).toBe(false);
  });

  it('adding a product to the set works correctly', () => {
    const lotSet = makeSet(['7654321']);
    lotSet.add('8001234');
    expect(lotSet.has('8001234')).toBe(true);
    expect(lotSet.size).toBe(2);
  });
});

// ─── First-discrepancy modal trigger condition ────────────────────────────────

describe('first-discrepancy modal trigger', () => {
  function shouldShowPrompt(
    isLotMethod: boolean,
    printedCount: number,
    quantityOrdered: number,
    productId: string | null,
  ): boolean {
    return !isLotMethod && printedCount !== quantityOrdered && productId !== null;
  }

  it('shows prompt when standard method, discrepancy, productId known', () => {
    expect(shouldShowPrompt(false, 90, 100, 'gid://shopify/Product/123')).toBe(true);
  });

  it('no prompt when already a lot product', () => {
    expect(shouldShowPrompt(true, 3, 1, 'gid://shopify/Product/123')).toBe(false);
  });

  it('no prompt when no discrepancy (printed === ordered)', () => {
    expect(shouldShowPrompt(false, 100, 100, 'gid://shopify/Product/123')).toBe(false);
  });

  it('no prompt when productId is null (no Shopify lookup)', () => {
    expect(shouldShowPrompt(false, 90, 100, null)).toBe(false);
  });

  it('shows prompt on over-received too', () => {
    expect(shouldShowPrompt(false, 110, 100, 'gid://shopify/Product/123')).toBe(true);
  });

  it('no prompt: lot method + no discrepancy + no productId (all false)', () => {
    expect(shouldShowPrompt(true, 1, 1, null)).toBe(false);
  });
});

// ─── Lot product API response shaping ─────────────────────────────────────────

describe('lot product API response shaping', () => {
  interface LotProductDto {
    productId: string;
    productTitle: string;
    configuredAt: string;
  }

  function buildSet(dtos: LotProductDto[]): Set<string> {
    return new Set(dtos.map(d => d.productId));
  }

  it('builds Set from DTO array', () => {
    const dtos: LotProductDto[] = [
      { productId: '111', productTitle: 'Beef', configuredAt: '' },
      { productId: '222', productTitle: 'Lamb', configuredAt: '' },
    ];
    const set = buildSet(dtos);
    expect(set.has('111')).toBe(true);
    expect(set.has('222')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('empty DTO array → empty set', () => {
    const set = buildSet([]);
    expect(set.size).toBe(0);
  });

  it('duplicate productIds deduplicated by Set', () => {
    const dtos: LotProductDto[] = [
      { productId: '111', productTitle: 'Beef', configuredAt: '' },
      { productId: '111', productTitle: 'Beef duplicate', configuredAt: '' },
    ];
    const set = buildSet(dtos);
    expect(set.size).toBe(1);
  });
});
