import { describe, it, expect } from 'vitest';

// ─── Mirror auto lot number generation from handleBulkPrint ──────────────────
// Format: LOT_{VENDOR_CLEAN}_{POREF_CLEAN}_{YYYYMMDD}_{4-digit ms suffix}

function generateAutoLotNo(vendor: string, poName: string, poId: string, nowMs: number): string {
  const vendorClean = vendor.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'VND';
  const poRefClean  = poName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase()
                      || poId.slice(-6).toUpperCase();
  const date = new Date(nowMs);
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const uniqueSuffix = String(nowMs).slice(-4);
  return `LOT_${vendorClean}_${poRefClean}_${dateStr}_${uniqueSuffix}`;
}

// ─── Format ───────────────────────────────────────────────────────────────────

describe('auto lot number — format', () => {
  it('starts with LOT_', () => {
    const lot = generateAutoLotNo('Fresh Farms', 'PO-2024-001', 'po-123', 1731700000000);
    expect(lot).toMatch(/^LOT_/);
  });

  it('has at least 5 underscore-separated parts', () => {
    const lot = generateAutoLotNo('Fresh Farms', 'PO2024001', 'po-123', 1731700000000);
    expect(lot.split('_').length).toBeGreaterThanOrEqual(5);
  });

  it('ends with a 4-digit numeric suffix', () => {
    const lot = generateAutoLotNo('Fresh Farms', 'PO2024001', 'po-123', 1731700000000);
    const parts = lot.split('_');
    const suffix = parts[parts.length - 1];
    expect(suffix).toMatch(/^\d{4}$/);
  });

  it('is entirely uppercase', () => {
    const lot = generateAutoLotNo('Fresh Farms', 'PO2024001', 'po-123', 1731700000000);
    expect(lot).toBe(lot.toUpperCase());
  });

  it('contains a date segment in YYYYMMDD format', () => {
    // 1731700000000 → 2024-11-15 (UTC)
    const lot = generateAutoLotNo('VND', 'PO001', 'po-1', 1731700000000);
    expect(lot).toMatch(/\d{8}/);
  });
});

// ─── Vendor sanitization ──────────────────────────────────────────────────────

describe('auto lot number — vendor sanitization', () => {
  it('replaces spaces with underscores', () => {
    const lot = generateAutoLotNo('Fresh Farms Inc', 'PO001', 'po-1', 1731700000000);
    expect(lot).toContain('FRESH_FARMS_INC');
  });

  it('removes leading/trailing underscores from vendor', () => {
    const lot = generateAutoLotNo(' Fresh ', 'PO001', 'po-1', 1731700000000);
    expect(lot).not.toMatch(/LOT__/);
  });

  it('uppercases vendor name', () => {
    const lot = generateAutoLotNo('freshfarms', 'PO001', 'po-1', 1731700000000);
    expect(lot).toContain('FRESHFARMS');
  });

  it('removes special characters from vendor', () => {
    const lot = generateAutoLotNo('Farm & Sons, LLC.', 'PO001', 'po-1', 1731700000000);
    expect(lot).not.toContain('&');
    expect(lot).not.toContain(',');
    expect(lot).not.toContain('.');
  });

  it('falls back to VND when vendor is empty', () => {
    const lot = generateAutoLotNo('', 'PO001', 'po-1', 1731700000000);
    expect(lot).toContain('LOT_VND_');
  });

  it('falls back to VND when vendor is only special characters', () => {
    const lot = generateAutoLotNo('!!!', 'PO001', 'po-1', 1731700000000);
    expect(lot).toContain('LOT_VND_');
  });

  it('preserves alphanumeric vendor name fully', () => {
    const lot = generateAutoLotNo('GREENVALLEY', 'PO001', 'po-1', 1731700000000);
    expect(lot).toContain('GREENVALLEY');
  });
});

// ─── PO name sanitization ─────────────────────────────────────────────────────

describe('auto lot number — PO name sanitization', () => {
  it('replaces dashes and spaces in PO name with underscores', () => {
    const lot = generateAutoLotNo('Farm', 'PO-2024-001', 'po-1', 1731700000000);
    expect(lot).toContain('PO_2024_001');
  });

  it('uppercases PO name', () => {
    const lot = generateAutoLotNo('Farm', 'po-001', 'po-1', 1731700000000);
    expect(lot).toContain('PO_001');
  });

  it('falls back to poId slice when PO name is empty', () => {
    const lot = generateAutoLotNo('Farm', '', 'abcdef123456', 1731700000000);
    expect(lot).toContain('123456');
  });

  it('removes special characters from PO name', () => {
    const lot = generateAutoLotNo('Farm', 'PO #001 (Nov)', 'po-1', 1731700000000);
    expect(lot).not.toContain('#');
    expect(lot).not.toContain('(');
  });
});

// ─── Uniqueness ───────────────────────────────────────────────────────────────

describe('auto lot number — uniqueness', () => {
  it('different ms timestamps produce different suffixes', () => {
    const lot1 = generateAutoLotNo('Farm', 'PO001', 'po-1', 1731700000000);
    const lot2 = generateAutoLotNo('Farm', 'PO001', 'po-1', 1731700001234);
    // Suffixes differ when last 4 ms digits differ
    expect(lot1).not.toBe(lot2);
  });

  it('same timestamp produces same lot no (deterministic)', () => {
    const ts = 1731700005678;
    const lot1 = generateAutoLotNo('Farm', 'PO001', 'po-1', ts);
    const lot2 = generateAutoLotNo('Farm', 'PO001', 'po-1', ts);
    expect(lot1).toBe(lot2);
  });

  it('different vendors produce different lot numbers', () => {
    const ts = 1731700000000;
    const lot1 = generateAutoLotNo('VendorA', 'PO001', 'po-1', ts);
    const lot2 = generateAutoLotNo('VendorB', 'PO001', 'po-1', ts);
    expect(lot1).not.toBe(lot2);
  });

  it('different PO names produce different lot numbers', () => {
    const ts = 1731700000000;
    const lot1 = generateAutoLotNo('Farm', 'PO001', 'po-1', ts);
    const lot2 = generateAutoLotNo('Farm', 'PO002', 'po-1', ts);
    expect(lot1).not.toBe(lot2);
  });
});

// ─── Manual lot — not overridden ──────────────────────────────────────────────

describe('auto lot number — manual lot takes priority', () => {
  it('non-empty lotNo is used as-is (no generation)', () => {
    const manualLot = 'BATCH-NOV-2024';
    // Mirrors: const effectiveLotNo = lotNo.trim() || generateAutoLotNo(...)
    const lotNo = 'BATCH-NOV-2024';
    const effectiveLotNo = lotNo.trim() || generateAutoLotNo('Farm', 'PO001', 'po-1', Date.now());
    expect(effectiveLotNo).toBe(manualLot);
  });

  it('whitespace-only lotNo triggers auto-generation', () => {
    const lotNo = '   ';
    const effectiveLotNo = lotNo.trim() || generateAutoLotNo('Farm', 'PO001', 'po-1', 1731700000000);
    expect(effectiveLotNo).toMatch(/^LOT_/);
  });

  it('empty lotNo triggers auto-generation', () => {
    const lotNo = '';
    const effectiveLotNo = lotNo.trim() || generateAutoLotNo('Farm', 'PO001', 'po-1', 1731700000000);
    expect(effectiveLotNo).toMatch(/^LOT_/);
  });
});
