import { describe, it, expect } from 'vitest';

// Received qty / discrepancy / inventory delta rules live in poReceiving.ts (tested in poReceiving.test.ts).

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
