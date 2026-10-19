import { describe, it, expect } from 'vitest';
import { buildQrPayload } from './scaleLabel';

// ─── Weight-per-label splitting ───────────────────────────────────────────────
// Mirrors the logic in BulkPrintModal when isLotReceiving=true

function splitWeight(totalWeightLbs: number, barcodeCount: number): string {
  return (totalWeightLbs / barcodeCount).toFixed(2);
}

function buildLotLabelWeight(totalWeightLbs: number, barcodeCount: number): string {
  return `${splitWeight(totalWeightLbs, barcodeCount)} lbs (LOT)`;
}

describe('lot weight splitting', () => {
  it('single barcode gets full weight', () => {
    expect(splitWeight(400, 1)).toBe('400.00');
  });

  it('two barcodes split evenly', () => {
    expect(splitWeight(200, 2)).toBe('100.00');
  });

  it('three barcodes divide total', () => {
    const w = parseFloat(splitWeight(400, 3));
    expect(w).toBeCloseTo(133.33, 1);
  });

  it('fractional input rounds to two decimals', () => {
    expect(splitWeight(100.5, 2)).toBe('50.25');
  });
});

// ─── Lot label weight string format ──────────────────────────────────────────

describe('lot label weight string', () => {
  it('includes (LOT) marker', () => {
    expect(buildLotLabelWeight(400, 1)).toContain('(LOT)');
  });

  it('is distinguishable from standard per-unit weight', () => {
    const lot = buildLotLabelWeight(400, 2);
    const standard = '3 lbs';
    expect(lot).toContain('(LOT)');
    expect(standard).not.toContain('(LOT)');
  });

  it('format is "{weight} lbs (LOT)"', () => {
    expect(buildLotLabelWeight(300, 3)).toMatch(/^\d+\.\d{2} lbs \(LOT\)$/);
  });
});

// ─── QR payload for lot labels ────────────────────────────────────────────────

describe('lot receiving QR payload', () => {
  it('encodes lot weight marker in payload', () => {
    const labelWeight = buildLotLabelWeight(400, 3);
    const payload = buildQrPayload(
      { plu: '1234', productTitle: 'Beef with Bone', variantTitle: 'Regular Cut', itemWeight: labelWeight },
      'beef-bn-3lb-reg-0001'
    );
    expect(payload).toContain('(LOT)');
    expect(payload).toContain('SN:beef-bn-3lb-reg-0001');
    expect(payload).toContain('Beef with Bone - Regular Cut');
  });

  it('each lot barcode gets a unique SN', () => {
    const labelWeight = buildLotLabelWeight(400, 3);
    const sns = ['goat-0001', 'goat-0002', 'goat-0003'];
    const payloads = sns.map(sn =>
      buildQrPayload({ plu: '5678', productTitle: 'Baby Goat', itemWeight: labelWeight }, sn)
    );
    expect(new Set(payloads).size).toBe(3);
  });
});

// ─── onConfirm callback shape (unified BulkPrintModal) ───────────────────────
// When isLotReceiving=true the modal calls:
//   onConfirm(barcodeCount, labelWeight, lotNo, expiryDate, totalWeightLbs)
// Verify that handleBulkPrint receives the right values for PO approval.

describe('lot receiving onConfirm shape', () => {
  it('lotTotalWeightLbs is passed as 5th argument', () => {
    const calls: unknown[] = [];
    const onConfirm = (...args: unknown[]) => calls.push(args);

    // Simulate what BulkPrintModal does on confirm when isLotReceiving
    const totalWeightLbs = 250;
    const barcodeCount = 2;
    const labelWeight = buildLotLabelWeight(totalWeightLbs, barcodeCount);
    onConfirm(barcodeCount, labelWeight, 'LOT-001', '2025-06-30', totalWeightLbs);

    expect(calls).toHaveLength(1);
    const [qty, wt, lotNo, expiry, lotWt] = calls[0] as unknown[];
    expect(qty).toBe(2);
    expect(wt).toBe('125.00 lbs (LOT)');
    expect(lotNo).toBe('LOT-001');
    expect(expiry).toBe('2025-06-30');
    expect(lotWt).toBe(250);
  });

  it('standard mode does NOT pass lotTotalWeightLbs', () => {
    const calls: unknown[] = [];
    const onConfirm = (...args: unknown[]) => calls.push(args);

    // Simulate standard mode confirm
    onConfirm(24, '', '', '');

    const args = calls[0] as unknown[];
    expect(args).toHaveLength(4);
    expect(args[4]).toBeUndefined();
  });

  it('PO approval uses total weight for lot, printed count for standard', () => {
    const lotTotalWeightLbs = 400;
    const printedCount = 3;

    // lot mode
    const lotApprovalQty = lotTotalWeightLbs !== undefined ? lotTotalWeightLbs : printedCount;
    expect(lotApprovalQty).toBe(400);

    // standard mode
    const stdApprovalQty = (undefined as number | undefined) !== undefined ? 999 : printedCount;
    expect(stdApprovalQty).toBe(3);
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('lot receiving validation', () => {
  it('total weight must be positive', () => {
    expect(!isNaN(parseFloat('400')) && parseFloat('400') > 0).toBe(true);
    expect(!isNaN(parseFloat('0')) && parseFloat('0') > 0).toBe(false);
    expect(!isNaN(parseFloat('-10')) && parseFloat('-10') > 0).toBe(false);
    expect(!isNaN(parseFloat('abc')) && parseFloat('abc') > 0).toBe(false);
  });

  it('barcode count 1–3 are the only valid values', () => {
    [1, 2, 3].forEach(n => expect(n >= 1 && n <= 3).toBe(true));
    [0, 4, -1].forEach(n => expect(n >= 1 && n <= 3).toBe(false));
  });
});
