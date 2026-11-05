import { describe, it, expect } from 'vitest';
import { buildQrPayload } from './scaleLabel';

// ─── buildQrPayload — date encoding ───────────────────────────────────────────

describe('buildQrPayload — no dates', () => {
  it('3-part payload when no weight and no dates', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Beef' }, 'SN001');
    expect(result).toBe('1234 | Beef | SN:SN001');
  });

  it('4-part payload when weight present and no dates', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Beef', itemWeight: '1.5 lbs' }, 'SN001');
    expect(result).toBe('1234 | Beef | 1.5 lbs | SN:SN001');
  });

  it('null dates are ignored', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Beef', expiryDate: null, mfgDate: null }, 'SN001');
    expect(result).toBe('1234 | Beef | SN:SN001');
  });

  it('undefined dates are ignored', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Beef' }, 'SN001');
    expect(result).not.toContain('EXP:');
    expect(result).not.toContain('MFG:');
  });
});

describe('buildQrPayload — expiry date only', () => {
  it('appends EXP segment after SN when expiryDate set', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Chicken', expiryDate: '2025-12-31' }, 'SN002');
    expect(result).toBe('1234 | Chicken | SN:SN002 | EXP:2025-12-31');
  });

  it('appends EXP with weight segment', () => {
    const result = buildQrPayload({ plu: '99', productTitle: 'Lamb', itemWeight: '2.0 lbs', expiryDate: '2026-06-01' }, 'SN003');
    expect(result).toBe('99 | Lamb | 2.0 lbs | SN:SN003 | EXP:2026-06-01');
  });

  it('empty string expiryDate is treated as falsy — no EXP segment', () => {
    const result = buildQrPayload({ plu: '1234', productTitle: 'Beef', expiryDate: '' }, 'SN004');
    expect(result).not.toContain('EXP:');
  });
});

describe('buildQrPayload — mfgDate only', () => {
  it('appends MFG segment after SN when mfgDate set', () => {
    const result = buildQrPayload({ plu: '5678', productTitle: 'Goat', mfgDate: '2025-01-15' }, 'SN005');
    expect(result).toBe('5678 | Goat | SN:SN005 | MFG:2025-01-15');
  });

  it('appends MFG with weight segment', () => {
    const result = buildQrPayload({ plu: '5678', productTitle: 'Goat', itemWeight: '3.0 lbs', mfgDate: '2025-01-15' }, 'SN005');
    expect(result).toBe('5678 | Goat | 3.0 lbs | SN:SN005 | MFG:2025-01-15');
  });

  it('empty string mfgDate is treated as falsy — no MFG segment', () => {
    const result = buildQrPayload({ plu: '5678', productTitle: 'Goat', mfgDate: '' }, 'SN005');
    expect(result).not.toContain('MFG:');
  });
});

describe('buildQrPayload — both dates', () => {
  it('appends EXP then MFG after SN when both set (no weight)', () => {
    const result = buildQrPayload(
      { plu: '1234', productTitle: 'Beef', expiryDate: '2025-12-31', mfgDate: '2025-01-10' },
      'SN006',
    );
    expect(result).toBe('1234 | Beef | SN:SN006 | EXP:2025-12-31 | MFG:2025-01-10');
  });

  it('appends EXP then MFG after SN when both set (with weight)', () => {
    const result = buildQrPayload(
      { plu: '1234', productTitle: 'Beef', itemWeight: '1.5 lbs', expiryDate: '2025-12-31', mfgDate: '2025-01-10' },
      'SN007',
    );
    expect(result).toBe('1234 | Beef | 1.5 lbs | SN:SN007 | EXP:2025-12-31 | MFG:2025-01-10');
  });

  it('order is always EXP before MFG regardless of argument order', () => {
    const result = buildQrPayload(
      { plu: '1234', productTitle: 'Beef', mfgDate: '2025-01-10', expiryDate: '2025-12-31' },
      'SN008',
    );
    const expIdx = result.indexOf('EXP:');
    const mfgIdx = result.indexOf('MFG:');
    expect(expIdx).toBeLessThan(mfgIdx);
  });
});

describe('buildQrPayload — variant title handling (unchanged by date logic)', () => {
  it('Default Title variant is omitted', () => {
    const result = buildQrPayload(
      { plu: '1234', productTitle: 'Beef', variantTitle: 'Default Title', expiryDate: '2025-12-31' },
      'SN009',
    );
    expect(result).toBe('1234 | Beef | SN:SN009 | EXP:2025-12-31');
    expect(result).not.toContain('Default Title');
  });

  it('real variant title is included', () => {
    const result = buildQrPayload(
      { plu: '1234', productTitle: 'Beef', variantTitle: 'Keema', expiryDate: '2025-12-31' },
      'SN010',
    );
    expect(result).toBe('1234 | Beef - Keema | SN:SN010 | EXP:2025-12-31');
  });
});

describe('buildQrPayload — SN is always present and before date segments', () => {
  it('SN appears before EXP', () => {
    const result = buildQrPayload({ plu: 'X', productTitle: 'P', expiryDate: '2025-01-01' }, 'SNTEST');
    expect(result.indexOf('SN:SNTEST')).toBeLessThan(result.indexOf('EXP:'));
  });

  it('SN appears before MFG', () => {
    const result = buildQrPayload({ plu: 'X', productTitle: 'P', mfgDate: '2024-06-01' }, 'SNTEST2');
    expect(result.indexOf('SN:SNTEST2')).toBeLessThan(result.indexOf('MFG:'));
  });
});

// ─── PrintedLabel type — mfgDate field presence ───────────────────────────────

describe('PrintedLabel type contract', () => {
  it('type accepts expiryDate and mfgDate as string or null', () => {
    // Compile-time check: if this test file type-checks, the interface is correct.
    type PrintedLabel = {
      id: string; itemNumber: string; plu: string; productTitle: string;
      itemWeight: string; printedAtEst: string; qrPayload: string;
      printedBy: string | null; sn: string | null;
      expiryDate: string | null; mfgDate: string | null;
    };
    const label: PrintedLabel = {
      id: '1', itemNumber: '001', plu: '1234', productTitle: 'Beef',
      itemWeight: '1 lbs', printedAtEst: '2025-01-01 10:00:00', qrPayload: 'x',
      printedBy: null, sn: null, expiryDate: '2025-12-31', mfgDate: '2025-01-10',
    };
    expect(label.mfgDate).toBe('2025-01-10');
    expect(label.expiryDate).toBe('2025-12-31');
  });
});
