import { describe, it, expect } from 'vitest';
import { planPoReceiving, sessionQtyBasis } from './poReceiving';

// Simulates accepting a PO line in the bulk print modal. planPoReceiving().receivedQty is what
// the page sends to /purchase-orders/approve (quantityReceived), to /scale/inventory-adjust
// (delta) and uses as the processing session's qty.

describe('planPoReceiving — counted qty always wins over the PO qty', () => {
  it('beef: PO 10, counted 100, 1 barcode → 100 received, over by 90', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 1, receivedQty: 100 }))
      .toEqual({ receivedQty: 100, discrepancyQty: 90, discrepancyType: 'over' });
  });

  it('beef: PO 10, counted 90 → 90 received, over by 80', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 1, receivedQty: 90 }))
      .toEqual({ receivedQty: 90, discrepancyQty: 80, discrepancyType: 'over' });
  });

  it('PO 10, counted 5 → 5 received, short by 5', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 1, receivedQty: 5 }))
      .toEqual({ receivedQty: 5, discrepancyQty: 5, discrepancyType: 'short' });
  });

  it('counted equals PO → no discrepancy', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 10, receivedQty: 10 }))
      .toEqual({ receivedQty: 10, discrepancyQty: null, discrepancyType: null });
  });

  it('barcode count never changes the received qty (lot: 3 labels for 100 counted)', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 3, receivedQty: 100 }).receivedQty).toBe(100);
  });

  it('no counted qty given → falls back to labels printed', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 8 }))
      .toEqual({ receivedQty: 8, discrepancyQty: 2, discrepancyType: 'short' });
  });
});

describe('planPoReceiving — lot receiving by total weight', () => {
  it('total weight is the received qty, compared against the PO qty in lbs', () => {
    expect(planPoReceiving({ orderedQty: 400, printedCount: 1, lotTotalWeightLbs: 420 }))
      .toEqual({ receivedQty: 420, discrepancyQty: 20, discrepancyType: 'over' });
  });

  it('decimal weight is rounded to whole units (the approve API takes an int)', () => {
    expect(planPoReceiving({ orderedQty: 400, printedCount: 2, lotTotalWeightLbs: 400.5 }).receivedQty).toBe(401);
    expect(planPoReceiving({ orderedQty: 400, printedCount: 2, lotTotalWeightLbs: 399.4 }).receivedQty).toBe(399);
  });

  it('barcode count is not compared against the PO (was "short 9" for 1 label on a PO of 10)', () => {
    expect(planPoReceiving({ orderedQty: 10, printedCount: 1, lotTotalWeightLbs: 10 }))
      .toEqual({ receivedQty: 10, discrepancyQty: null, discrepancyType: null });
  });

  it('a tiny real weight still counts as 1, so the approval is not rejected as 0', () => {
    expect(planPoReceiving({ orderedQty: 1, printedCount: 1, lotTotalWeightLbs: 0.3 }).receivedQty).toBe(1);
  });
});

describe('sessionQtyBasis — processing works through what was received', () => {
  it('uses the received qty once the line is accepted', () => {
    expect(sessionQtyBasis({ quantityOrdered: 10, quantityReceived: 100 })).toBe(100);
    expect(sessionQtyBasis({ quantityOrdered: 10, quantityReceived: 5 })).toBe(5);
  });

  it('falls back to the PO qty before anything is received', () => {
    expect(sessionQtyBasis({ quantityOrdered: 10, quantityReceived: 0 })).toBe(10);
  });

  it('no line item → 0', () => {
    expect(sessionQtyBasis(undefined)).toBe(0);
  });
});

// End-to-end simulation of accept → process against an in-memory PO line and Shopify stock,
// applying each call with the same semantics as the backend (approve is additive; Shopify
// inventoryAdjustQuantities adds the delta to available).
describe('simulation: accept beef PO with a discrepancy, then process it', () => {
  function simulate(counted: number, labels: number) {
    const line = { quantityOrdered: 10, quantityReceived: 0, discrepancyQty: null as number | null, discrepancyType: null as string | null };
    let shopifyAvailable = 0;

    // Accept in the bulk print modal
    const plan = planPoReceiving({ orderedQty: line.quantityOrdered, printedCount: labels, receivedQty: counted });
    line.quantityReceived += plan.receivedQty;               // POST /purchase-orders/approve
    line.discrepancyQty = plan.discrepancyQty;
    line.discrepancyType = plan.discrepancyType;
    shopifyAvailable += plan.receivedQty;                    // POST /scale/inventory-adjust (reason: received)

    // Later: scan the batch barcode, session works through the received qty
    const sessionQty = sessionQtyBasis(line);
    return { line, shopifyAvailable, sessionQty };
  }

  it('counted 100 on a PO of 10: PO shows 100 received (over 90), Shopify +100, session of 100', () => {
    expect(simulate(100, 1)).toEqual({
      line: { quantityOrdered: 10, quantityReceived: 100, discrepancyQty: 90, discrepancyType: 'over' },
      shopifyAvailable: 100,
      sessionQty: 100,
    });
  });

  it('counted 5 on a PO of 10: PO shows 5 received (short 5), Shopify +5, session of 5', () => {
    const r = simulate(5, 1);
    expect(r.line).toMatchObject({ quantityReceived: 5, discrepancyQty: 5, discrepancyType: 'short' });
    expect(r.shopifyAvailable).toBe(5);
    expect(r.sessionQty).toBe(5);
  });
});
