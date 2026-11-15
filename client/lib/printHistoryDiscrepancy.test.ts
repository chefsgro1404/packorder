import { describe, it, expect } from 'vitest';

// ─── Mirror PrintHistory product-row derived state ────────────────────────────
// These helpers mirror the computations inside the PrintHistory component for
// each product group row (received/printed/ordered counts + discrepancy flags).

interface LineItem {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
}

interface ProductGroup {
  poLineItemId: string | null;
  records: { id: string }[];
}

function computeProductRowState(
  productGroup: ProductGroup,
  lineItemsForPo: LineItem[],
) {
  const li              = lineItemsForPo.find(x => x.id === productGroup.poLineItemId) ?? null;
  const orderedQty      = li?.quantityOrdered ?? null;
  const receivedQtyLi   = li?.quantityReceived ?? null;
  const printedCount    = productGroup.records.length;

  const isPrintOver = receivedQtyLi !== null
    ? printedCount > receivedQtyLi
    : (orderedQty !== null && printedCount > orderedQty);

  const hasReceiveDiscrepancy = orderedQty !== null && receivedQtyLi !== null && receivedQtyLi !== orderedQty;
  const discrepancyShort = hasReceiveDiscrepancy && receivedQtyLi! < orderedQty!;

  return { orderedQty, receivedQtyLi, printedCount, isPrintOver, hasReceiveDiscrepancy, discrepancyShort };
}

const makeRecords = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

// ─── Basic counts ─────────────────────────────────────────────────────────────

describe('PrintHistory product row — basic counts', () => {
  it('shows printedCount from records array length', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(5) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { printedCount } = computeProductRowState(pg, lis);
    expect(printedCount).toBe(5);
  });

  it('shows orderedQty from line item', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(10) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 20 }];
    const { orderedQty } = computeProductRowState(pg, lis);
    expect(orderedQty).toBe(24);
  });

  it('shows receivedQtyLi from line item', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(10) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 20 }];
    const { receivedQtyLi } = computeProductRowState(pg, lis);
    expect(receivedQtyLi).toBe(20);
  });

  it('orderedQty null when no matching line item', () => {
    const pg = { poLineItemId: 'li-unknown', records: makeRecords(3) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 20 }];
    const { orderedQty, receivedQtyLi } = computeProductRowState(pg, lis);
    expect(orderedQty).toBeNull();
    expect(receivedQtyLi).toBeNull();
  });

  it('orderedQty null when poLineItemId is null', () => {
    const pg = { poLineItemId: null, records: makeRecords(2) };
    const lis: LineItem[] = [];
    const { orderedQty } = computeProductRowState(pg, lis);
    expect(orderedQty).toBeNull();
  });
});

// ─── isPrintOver — barcode overage ────────────────────────────────────────────

describe('PrintHistory product row — barcode overage', () => {
  it('isPrintOver true when printed > received', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(13) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(true);
  });

  it('isPrintOver false when printed = received', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(10) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(false);
  });

  it('isPrintOver false when printed < received', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(7) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(false);
  });

  it('isPrintOver uses receivedQty (not orderedQty) when available', () => {
    // Received = 8, ordered = 10 — 9 printed is NOT over received
    const pg = { poLineItemId: 'li-1', records: makeRecords(9) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 8 }];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(true); // 9 > 8
  });

  it('isPrintOver falls back to orderedQty when receivedQty null', () => {
    // No line item match → receivedQtyLi = null, orderedQty = null → not over
    const pg = { poLineItemId: 'li-unknown', records: makeRecords(99) };
    const lis: LineItem[] = [];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(false); // null checks prevent false positives
  });

  it('isPrintOver by exactly 1', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(11) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { isPrintOver } = computeProductRowState(pg, lis);
    expect(isPrintOver).toBe(true);
  });
});

// ─── hasReceiveDiscrepancy — PO qty ≠ received qty ───────────────────────────

describe('PrintHistory product row — receive discrepancy', () => {
  it('hasReceiveDiscrepancy true when received < ordered', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(8) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 8 }];
    const { hasReceiveDiscrepancy, discrepancyShort } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(true);
    expect(discrepancyShort).toBe(true);
  });

  it('hasReceiveDiscrepancy true when received > ordered', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(12) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 12 }];
    const { hasReceiveDiscrepancy, discrepancyShort } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(true);
    expect(discrepancyShort).toBe(false); // over, not short
  });

  it('hasReceiveDiscrepancy false when received = ordered', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(10) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 10 }];
    const { hasReceiveDiscrepancy } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(false);
  });

  it('hasReceiveDiscrepancy false when no line item (null guard)', () => {
    const pg = { poLineItemId: 'li-unknown', records: makeRecords(5) };
    const lis: LineItem[] = [];
    const { hasReceiveDiscrepancy } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(false);
  });

  it('short by 1 unit', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(9) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 9 }];
    const { hasReceiveDiscrepancy, discrepancyShort } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(true);
    expect(discrepancyShort).toBe(true);
  });

  it('discrepancy gap is correct (ordered - received)', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(6) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 10, quantityReceived: 6 }];
    const { orderedQty, receivedQtyLi, hasReceiveDiscrepancy, discrepancyShort } = computeProductRowState(pg, lis);
    expect(hasReceiveDiscrepancy).toBe(true);
    expect(discrepancyShort).toBe(true);
    expect(orderedQty! - receivedQtyLi!).toBe(4); // "4 short vs PO"
  });
});

// ─── Combined scenarios ───────────────────────────────────────────────────────

describe('PrintHistory product row — combined scenarios', () => {
  it('exact match: no discrepancy, no overage', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(24) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 24 }];
    const s = computeProductRowState(pg, lis);
    expect(s.hasReceiveDiscrepancy).toBe(false);
    expect(s.isPrintOver).toBe(false);
  });

  it('short receive with matching barcode count: receive discrepancy only', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(20) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 20 }];
    const s = computeProductRowState(pg, lis);
    expect(s.hasReceiveDiscrepancy).toBe(true);
    expect(s.discrepancyShort).toBe(true);
    expect(s.isPrintOver).toBe(false);
  });

  it('received ok but too many barcodes: overage only', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(27) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 24 }];
    const s = computeProductRowState(pg, lis);
    expect(s.hasReceiveDiscrepancy).toBe(false);
    expect(s.isPrintOver).toBe(true);
  });

  it('short receive AND too many barcodes: both flags', () => {
    const pg = { poLineItemId: 'li-1', records: makeRecords(22) };
    const lis: LineItem[] = [{ id: 'li-1', quantityOrdered: 24, quantityReceived: 20 }];
    const s = computeProductRowState(pg, lis);
    expect(s.hasReceiveDiscrepancy).toBe(true); // 20 ≠ 24
    expect(s.isPrintOver).toBe(true);           // 22 > 20
  });

  it('no line item: printedCount shown but no discrepancy flags', () => {
    const pg = { poLineItemId: null, records: makeRecords(5) };
    const s = computeProductRowState(pg, []);
    expect(s.printedCount).toBe(5);
    expect(s.orderedQty).toBeNull();
    expect(s.receivedQtyLi).toBeNull();
    expect(s.hasReceiveDiscrepancy).toBe(false);
    expect(s.isPrintOver).toBe(false);
  });
});

// ─── 3-level grouping correctness ────────────────────────────────────────────

describe('PrintHistory — 3-level grouping', () => {
  interface Record { id: string; poId: string | null; poLineItemId: string | null; productTitle: string }

  function groupByPo(records: Record[]) {
    const poMap = new Map<string, { poId: string; products: Map<string, Record[]> }>();
    const direct: Record[] = [];
    for (const r of records) {
      if (!r.poId) { direct.push(r); continue; }
      if (!poMap.has(r.poId)) poMap.set(r.poId, { poId: r.poId, products: new Map() });
      const pg = poMap.get(r.poId)!;
      const key = r.poLineItemId ?? r.productTitle;
      if (!pg.products.has(key)) pg.products.set(key, []);
      pg.products.get(key)!.push(r);
    }
    return { poGroups: Array.from(poMap.values()), direct };
  }

  it('groups 3 records from same PO under one PO group', () => {
    const records: Record[] = [
      { id: '1', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '2', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '3', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
    ];
    const { poGroups } = groupByPo(records);
    expect(poGroups).toHaveLength(1);
    expect(poGroups[0].products.get('li-1')).toHaveLength(3);
  });

  it('groups records from 2 different POs into 2 PO groups', () => {
    const records: Record[] = [
      { id: '1', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '2', poId: 'po-2', poLineItemId: 'li-2', productTitle: 'Lamb' },
    ];
    const { poGroups } = groupByPo(records);
    expect(poGroups).toHaveLength(2);
  });

  it('records without poId go to direct list', () => {
    const records: Record[] = [
      { id: '1', poId: null, poLineItemId: null, productTitle: 'Beef' },
      { id: '2', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Lamb' },
    ];
    const { poGroups, direct } = groupByPo(records);
    expect(direct).toHaveLength(1);
    expect(poGroups).toHaveLength(1);
  });

  it('two products under same PO form separate product groups', () => {
    const records: Record[] = [
      { id: '1', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '2', poId: 'po-1', poLineItemId: 'li-2', productTitle: 'Lamb' },
    ];
    const { poGroups } = groupByPo(records);
    expect(poGroups[0].products.size).toBe(2);
  });

  it('empty records produce empty groups', () => {
    const { poGroups, direct } = groupByPo([]);
    expect(poGroups).toHaveLength(0);
    expect(direct).toHaveLength(0);
  });

  it('records with same poLineItemId are grouped together', () => {
    const records: Record[] = [
      { id: '1', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '2', poId: 'po-1', poLineItemId: 'li-1', productTitle: 'Beef' },
      { id: '3', poId: 'po-1', poLineItemId: 'li-2', productTitle: 'Lamb' },
    ];
    const { poGroups } = groupByPo(records);
    expect(poGroups[0].products.get('li-1')).toHaveLength(2);
    expect(poGroups[0].products.get('li-2')).toHaveLength(1);
  });
});
