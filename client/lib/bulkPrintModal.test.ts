import { describe, it, expect } from 'vitest';

// ─── Mirror BulkPrintModal derived state ─────────────────────────────────────
// These helpers mirror the computed values inside BulkPrintModal exactly so we
// can test every branch without mounting a React component.

function computeModalState(opts: {
  orderedQuantity: number;
  receivedQty: string;
  barcodesToPrint: string;
  isLotProduct?: boolean;
}) {
  const { orderedQuantity, receivedQty, barcodesToPrint, isLotProduct = false } = opts;
  const parsedReceived  = parseInt(receivedQty, 10);
  const parsedBarcodes  = parseInt(barcodesToPrint, 10);
  const receivedValid   = !isNaN(parsedReceived) && parsedReceived > 0;
  const barcodesValid   = !isNaN(parsedBarcodes) && parsedBarcodes > 0;
  const barcodesExceedReceived = receivedValid && barcodesValid && parsedBarcodes > parsedReceived;
  const isAutoLot       = isLotProduct || (receivedValid && barcodesValid && parsedBarcodes !== parsedReceived);
  const hasDiscrepancy  = receivedValid && parsedReceived !== orderedQuantity;
  const isValid         = receivedValid && barcodesValid;
  const showFullQty     = !hasDiscrepancy && receivedValid && !isLotProduct
                          && parsedReceived === orderedQuantity && parsedBarcodes === parsedReceived;
  return { parsedReceived, parsedBarcodes, receivedValid, barcodesValid, barcodesExceedReceived, isAutoLot, hasDiscrepancy, isValid, showFullQty };
}

// ─── Validation ───────────────────────────────────────────────────────────────

describe('BulkPrintModal — validation', () => {
  it('isValid true when both inputs are positive integers', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '50', barcodesToPrint: '50' });
    expect(s.isValid).toBe(true);
  });

  it('isValid false when receivedQty is empty', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '', barcodesToPrint: '50' });
    expect(s.isValid).toBe(false);
  });

  it('isValid false when barcodesToPrint is empty', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '50', barcodesToPrint: '' });
    expect(s.isValid).toBe(false);
  });

  it('isValid false when receivedQty is 0', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '0', barcodesToPrint: '10' });
    expect(s.isValid).toBe(false);
  });

  it('isValid false when barcodesToPrint is 0', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '50', barcodesToPrint: '0' });
    expect(s.isValid).toBe(false);
  });

  it('isValid false for non-numeric input', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: 'abc', barcodesToPrint: '50' });
    expect(s.isValid).toBe(false);
  });

  it('isValid false for negative received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '-5', barcodesToPrint: '10' });
    expect(s.isValid).toBe(false);
  });
});

// ─── Barcode overage — warning not block ─────────────────────────────────────

describe('BulkPrintModal — barcode overage (warning, not block)', () => {
  it('barcodesExceedReceived true when barcodes > received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '10', barcodesToPrint: '15' });
    expect(s.barcodesExceedReceived).toBe(true);
  });

  it('isValid remains true when barcodes exceed received (warning, not error)', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '10', barcodesToPrint: '15' });
    expect(s.barcodesExceedReceived).toBe(true);
    expect(s.isValid).toBe(true); // can still submit
  });

  it('barcodesExceedReceived false when barcodes = received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '10', barcodesToPrint: '10' });
    expect(s.barcodesExceedReceived).toBe(false);
  });

  it('barcodesExceedReceived false when barcodes < received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '10', barcodesToPrint: '7' });
    expect(s.barcodesExceedReceived).toBe(false);
  });

  it('barcodesExceedReceived false when receivedQty is invalid', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: 'abc', barcodesToPrint: '99' });
    expect(s.barcodesExceedReceived).toBe(false);
  });
});

// ─── isAutoLot ────────────────────────────────────────────────────────────────

describe('BulkPrintModal — isAutoLot', () => {
  it('isAutoLot true when barcodes < received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '50', barcodesToPrint: '30' });
    expect(s.isAutoLot).toBe(true);
  });

  it('isAutoLot true when barcodes > received (overage triggers lot too)', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '10', barcodesToPrint: '15' });
    expect(s.isAutoLot).toBe(true);
  });

  it('isAutoLot false when barcodes = received (and not a lot product)', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '50', barcodesToPrint: '50' });
    expect(s.isAutoLot).toBe(false);
  });

  it('isAutoLot true for lot product even when barcodes = received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '100', isLotProduct: true });
    expect(s.isAutoLot).toBe(true);
  });

  it('isAutoLot true for lot product regardless of qty mismatch', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '50', isLotProduct: true });
    expect(s.isAutoLot).toBe(true);
  });

  it('isAutoLot false when inputs are invalid', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: 'abc', barcodesToPrint: '50' });
    expect(s.isAutoLot).toBe(false);
  });
});

// ─── hasDiscrepancy (received vs PO qty) ─────────────────────────────────────

describe('BulkPrintModal — hasDiscrepancy (received ≠ PO qty)', () => {
  it('hasDiscrepancy true when received < ordered', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '90', barcodesToPrint: '90' });
    expect(s.hasDiscrepancy).toBe(true);
  });

  it('hasDiscrepancy true when received > ordered', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '110', barcodesToPrint: '110' });
    expect(s.hasDiscrepancy).toBe(true);
  });

  it('hasDiscrepancy false when received = ordered', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '100' });
    expect(s.hasDiscrepancy).toBe(false);
  });

  it('hasDiscrepancy independent of barcodes count', () => {
    // received matches PO but barcodes differ — discrepancy is about received vs PO, not barcodes
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '50' });
    expect(s.hasDiscrepancy).toBe(false);
  });

  it('hasDiscrepancy false when receivedQty invalid', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '', barcodesToPrint: '90' });
    expect(s.hasDiscrepancy).toBe(false);
  });
});

// ─── Full quantity hint ───────────────────────────────────────────────────────

describe('BulkPrintModal — full quantity hint', () => {
  it('showFullQty true when received = ordered = barcodes and not lot product', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '100' });
    expect(s.showFullQty).toBe(true);
  });

  it('showFullQty false for lot product even if quantities match', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '100', isLotProduct: true });
    expect(s.showFullQty).toBe(false);
  });

  it('showFullQty false when barcodes ≠ received', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '100', barcodesToPrint: '90' });
    expect(s.showFullQty).toBe(false);
  });

  it('showFullQty false when received ≠ ordered', () => {
    const s = computeModalState({ orderedQuantity: 100, receivedQty: '90', barcodesToPrint: '90' });
    expect(s.showFullQty).toBe(false);
  });
});

// ─── Combined scenarios ───────────────────────────────────────────────────────

describe('BulkPrintModal — combined real-world scenarios', () => {
  it('exact PO receive: no discrepancy, no lot, no overage', () => {
    const s = computeModalState({ orderedQuantity: 24, receivedQty: '24', barcodesToPrint: '24' });
    expect(s.hasDiscrepancy).toBe(false);
    expect(s.isAutoLot).toBe(false);
    expect(s.barcodesExceedReceived).toBe(false);
    expect(s.showFullQty).toBe(true);
  });

  it('short receive: discrepancy only, no lot', () => {
    const s = computeModalState({ orderedQuantity: 24, receivedQty: '20', barcodesToPrint: '20' });
    expect(s.hasDiscrepancy).toBe(true);
    expect(s.isAutoLot).toBe(false);
    expect(s.barcodesExceedReceived).toBe(false);
  });

  it('short receive with fewer barcodes than received: discrepancy + lot', () => {
    const s = computeModalState({ orderedQuantity: 24, receivedQty: '20', barcodesToPrint: '15' });
    expect(s.hasDiscrepancy).toBe(true);
    expect(s.isAutoLot).toBe(true);
    expect(s.barcodesExceedReceived).toBe(false);
  });

  it('received matches PO but barcodes exceed: overage warning + lot', () => {
    const s = computeModalState({ orderedQuantity: 24, receivedQty: '24', barcodesToPrint: '30' });
    expect(s.hasDiscrepancy).toBe(false);
    expect(s.barcodesExceedReceived).toBe(true);
    expect(s.isAutoLot).toBe(true);
    expect(s.isValid).toBe(true); // still allowed
  });

  it('lot product receiving: always lot regardless of counts', () => {
    const s = computeModalState({ orderedQuantity: 1, receivedQty: '1', barcodesToPrint: '1', isLotProduct: true });
    expect(s.isAutoLot).toBe(true);
    expect(s.showFullQty).toBe(false);
  });
});
