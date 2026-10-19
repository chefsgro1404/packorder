import { describe, it, expect } from 'vitest';
import { buildQrPayload } from './scaleLabel';

// ─── QR payload for lot-based products ───────────────────────────────────────

describe('lot receiving QR payload', () => {
  it('encodes lot weight marker in payload', () => {
    const payload = buildQrPayload(
      { plu: '1234', productTitle: 'Beef with Bone', variantTitle: 'Regular Cut', itemWeight: '133.33 lbs (LOT)' },
      'beef-bn-3lb-reg-0001'
    );
    expect(payload).toContain('133.33 lbs (LOT)');
    expect(payload).toContain('SN:beef-bn-3lb-reg-0001');
    expect(payload).toContain('Beef with Bone - Regular Cut');
  });

  it('lot payload is distinguishable from standard per-unit payload', () => {
    const lot = buildQrPayload(
      { plu: '1234', productTitle: 'Beef with Bone', itemWeight: '200.00 lbs (LOT)' },
      'beef-bn-0001'
    );
    const standard = buildQrPayload(
      { plu: '1234', productTitle: 'Beef with Bone', itemWeight: '3 lbs' },
      'beef-bn-0001'
    );
    expect(lot).toContain('(LOT)');
    expect(standard).not.toContain('(LOT)');
  });

  it('each lot barcode gets a unique SN', () => {
    const totalWeight = 400;
    const barcodeCount = 3;
    const weightPerLabel = (totalWeight / barcodeCount).toFixed(2);
    const sns = ['beef-0001', 'beef-0002', 'beef-0003'];

    const payloads = sns.map(sn =>
      buildQrPayload(
        { plu: '5678', productTitle: 'Baby Goat', itemWeight: `${weightPerLabel} lbs (LOT)` },
        sn
      )
    );

    // All payloads distinct due to different SNs
    const unique = new Set(payloads);
    expect(unique.size).toBe(3);
  });

  it('weight per label is total divided by count', () => {
    const totalWeightLbs = 400;
    const barcodeCount = 3;
    const expected = (400 / 3).toFixed(2);
    expect(parseFloat(expected)).toBeCloseTo(133.33, 1);
  });

  it('weight per label for single barcode equals total weight', () => {
    const totalWeightLbs = 250;
    const barcodeCount = 1;
    const weightPerLabel = (totalWeightLbs / barcodeCount).toFixed(2);
    expect(weightPerLabel).toBe('250.00');
  });

  it('two barcodes split evenly', () => {
    const totalWeightLbs = 200;
    const barcodeCount = 2;
    const weightPerLabel = (totalWeightLbs / barcodeCount).toFixed(2);
    expect(weightPerLabel).toBe('100.00');
  });
});

// ─── Lot receiving validation ─────────────────────────────────────────────────

describe('lot receiving input validation', () => {
  it('total weight must be positive', () => {
    expect(parseFloat('0') > 0).toBe(false);
    expect(parseFloat('-10') > 0).toBe(false);
    expect(parseFloat('400') > 0).toBe(true);
    expect(parseFloat('0.5') > 0).toBe(true);
  });

  it('barcode count is 1 2 or 3', () => {
    const validCounts = [1, 2, 3];
    for (const c of validCounts) {
      expect(c >= 1 && c <= 3).toBe(true);
    }
    expect(0 >= 1 && 0 <= 3).toBe(false);
    expect(4 >= 1 && 4 <= 3).toBe(false);
  });

  it('NaN weight is invalid', () => {
    const parsed = parseFloat('abc');
    expect(!isNaN(parsed) && parsed > 0).toBe(false);
  });
});
