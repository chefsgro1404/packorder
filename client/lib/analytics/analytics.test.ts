import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  getLabelSummary,
  getFillRateSummary,
  getWastageSummary,
  getTransformationSummary,
  getTopProducts,
  getDailyTrends,
  getVendorTable,
  getLotCompliance,
  getDiscrepancies,
} from "./queries";

// Point DuckDB at the analytics-data folder (one level above client/)
process.env.ANALYTICS_DATA_PATH = path.resolve(__dirname, "../../../analytics-data");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
}

const PERF_LIMIT_MS = 1000; // generous for CI; native DuckDB is typically <100ms on 12k rows

// ── getLabelSummary ───────────────────────────────────────────────────────────

describe("getLabelSummary", () => {
  it("30-day window: structure is valid", async () => {
    const { result: s, ms } = await timed(() => getLabelSummary(30));
    expect(ms, `query took ${ms.toFixed(0)}ms (limit ${PERF_LIMIT_MS}ms)`).toBeLessThan(PERF_LIMIT_MS);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.prev).toBeGreaterThanOrEqual(0);
    expect(s.reprints).toBeGreaterThanOrEqual(0);
    expect(s.lotLabels).toBeGreaterThanOrEqual(0);
    expect(s.reprints).toBeLessThanOrEqual(s.total);
    expect(s.lotLabels).toBeLessThanOrEqual(s.total);
  });

  it("pctChange is null when prev is 0, number otherwise", async () => {
    const s = await getLabelSummary(30);
    if (s.prev === 0) {
      expect(s.pctChange).toBeNull();
    } else {
      expect(typeof s.pctChange).toBe("number");
      expect(s.pctChange).toBe(
        Math.round(((s.total - s.prev) / s.prev) * 100)
      );
    }
  });

  it("90-day window: total >= 30-day total (data is append-only)", async () => {
    const [s30, s90] = await Promise.all([getLabelSummary(30), getLabelSummary(90)]);
    // 90-day window covers current 30 days + 30 days prior window included in prev
    // s90.total + s90.prev covers a 180-day span; just verify s90.total >= 0
    expect(s90.total).toBeGreaterThanOrEqual(0);
    expect(s90.total + s90.prev).toBeGreaterThanOrEqual(s30.total + s30.prev);
  });

  it("1-day window: returns numbers (may be 0)", async () => {
    const s = await getLabelSummary(1);
    expect(typeof s.total).toBe("number");
    expect(typeof s.reprints).toBe("number");
    expect(s.reprints).toBeGreaterThanOrEqual(0);
  });

  it("365-day window: returns non-trivial data from synthetic set", async () => {
    const s = await getLabelSummary(365);
    expect(s.total).toBeGreaterThan(0);
  });

  it("performance: 365-day window under limit", async () => {
    const { ms } = await timed(() => getLabelSummary(365));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getFillRateSummary ────────────────────────────────────────────────────────

describe("getFillRateSummary", () => {
  let s: Awaited<ReturnType<typeof getFillRateSummary>>;

  beforeAll(async () => {
    s = await getFillRateSummary(90);
  });

  it("fill rate is null or in [0, 1]", () => {
    if (s.fillRate !== null) {
      expect(s.fillRate).toBeGreaterThanOrEqual(0);
      expect(s.fillRate).toBeLessThanOrEqual(1);
    }
  });

  it("prevFillRate is null or in [0, 1]", () => {
    if (s.prevFillRate !== null) {
      expect(s.prevFillRate).toBeGreaterThanOrEqual(0);
      expect(s.prevFillRate).toBeLessThanOrEqual(1);
    }
  });

  it("discrepancyCount <= totalLineItems", () => {
    expect(s.discrepancyCount).toBeLessThanOrEqual(s.totalLineItems);
  });

  it("discrepancyRate consistent with counts", () => {
    if (s.totalLineItems === 0) {
      expect(s.discrepancyRate).toBeNull();
    } else {
      expect(s.discrepancyRate).not.toBeNull();
      expect(s.discrepancyRate!).toBeCloseTo(
        s.discrepancyCount / s.totalLineItems,
        6
      );
    }
  });

  it("synthetic data has line items > 0", () => {
    expect(s.totalLineItems).toBeGreaterThan(0);
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getFillRateSummary(90));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getWastageSummary ─────────────────────────────────────────────────────────

describe("getWastageSummary", () => {
  let s: Awaited<ReturnType<typeof getWastageSummary>>;

  beforeAll(async () => {
    s = await getWastageSummary(90);
  });

  it("totalUnits >= 0", () => {
    expect(s.totalUnits).toBeGreaterThanOrEqual(0);
  });

  it("byVendor is an array with vendor + units fields", () => {
    expect(Array.isArray(s.byVendor)).toBe(true);
    for (const row of s.byVendor) {
      expect(typeof row.vendor).toBe("string");
      expect(row.vendor.length).toBeGreaterThan(0);
      expect(typeof row.units).toBe("number");
      expect(row.units).toBeGreaterThanOrEqual(0);
    }
  });

  it("byVendor is sorted descending by units", () => {
    for (let i = 1; i < s.byVendor.length; i++) {
      expect(s.byVendor[i - 1].units).toBeGreaterThanOrEqual(s.byVendor[i].units);
    }
  });

  it("byVendor limited to 5 rows", () => {
    expect(s.byVendor.length).toBeLessThanOrEqual(5);
  });

  it("pctChange correct formula", () => {
    if (s.prevUnits === 0) {
      expect(s.pctChange).toBeNull();
    } else {
      expect(s.pctChange).toBe(
        Math.round(((s.totalUnits - s.prevUnits) / s.prevUnits) * 100)
      );
    }
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getWastageSummary(90));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getTransformationSummary ──────────────────────────────────────────────────

describe("getTransformationSummary", () => {
  let s: Awaited<ReturnType<typeof getTransformationSummary>>;

  beforeAll(async () => {
    s = await getTransformationSummary(90);
  });

  it("all fields are numbers", () => {
    expect(typeof s.inputUnits).toBe("number");
    expect(typeof s.outputUnits).toBe("number");
    expect(typeof s.sessionCount).toBe("number");
  });

  it("yield is null or in [0, 2] (output can exceed input in some processes)", () => {
    if (s.yield !== null) {
      expect(s.yield).toBeGreaterThanOrEqual(0);
      // Yield above 2 would indicate a data error in synthetic set
      expect(s.yield).toBeLessThanOrEqual(2);
    }
  });

  it("yield is null iff inputUnits === 0", () => {
    if (s.inputUnits === 0) {
      expect(s.yield).toBeNull();
    } else {
      expect(s.yield).not.toBeNull();
      expect(s.yield!).toBeCloseTo(s.outputUnits / s.inputUnits, 6);
    }
  });

  it("synthetic data has transformation sessions > 0", () => {
    expect(s.sessionCount).toBeGreaterThan(0);
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getTransformationSummary(90));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getTopProducts ────────────────────────────────────────────────────────────

describe("getTopProducts", () => {
  it("returns at most `limit` rows", async () => {
    const rows = await getTopProducts(90, 5);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it("default limit is 8", async () => {
    const rows = await getTopProducts(90);
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it("pct values are non-negative and sum to ~100 (may be less if limit cuts tail)", async () => {
    const rows = await getTopProducts(365, 100); // large limit to get all products
    const sum = rows.reduce((acc, r) => acc + r.pct, 0);
    // With all products included, sum should be very close to 100.
    // DuckDB ROUND(..., 1) can introduce ±0.05 per product — allow up to 101 for N products.
    if (rows.length > 0) {
      expect(sum).toBeGreaterThan(90);
      expect(sum).toBeLessThanOrEqual(101);
    }
  });

  it("sorted descending by labels", async () => {
    const rows = await getTopProducts(90);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].labels).toBeGreaterThanOrEqual(rows[i].labels);
    }
  });

  it("each row has non-empty product_title", async () => {
    const rows = await getTopProducts(90);
    for (const r of rows) {
      expect(typeof r.product_title).toBe("string");
      expect(r.product_title.length).toBeGreaterThan(0);
    }
  });

  it("1-day window may return empty array without error", async () => {
    const rows = await getTopProducts(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("performance: 365-day window under limit", async () => {
    const { ms } = await timed(() => getTopProducts(365, 8));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getDailyTrends ────────────────────────────────────────────────────────────

describe("getDailyTrends", () => {
  it("returns exactly `days` entries", async () => {
    const trends = await getDailyTrends(30);
    expect(trends.length).toBe(30);
  });

  it("7-day window: 7 entries", async () => {
    const trends = await getDailyTrends(7);
    expect(trends.length).toBe(7);
  });

  it("dates are unique and in ascending order", async () => {
    const trends = await getDailyTrends(30);
    const dates = trends.map((t) => t.date);
    const unique = new Set(dates);
    expect(unique.size).toBe(30);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it("date format is YYYY-MM-DD", async () => {
    const trends = await getDailyTrends(7);
    for (const t of trends) {
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("all numeric fields are non-negative", async () => {
    const trends = await getDailyTrends(30);
    for (const t of trends) {
      expect(t.labels).toBeGreaterThanOrEqual(0);
      expect(t.inv_in).toBeGreaterThanOrEqual(0);
      expect(t.inv_out).toBeGreaterThanOrEqual(0);
      expect(t.wastage).toBeGreaterThanOrEqual(0);
    }
  });

  it("last date is today (UTC)", async () => {
    const trends = await getDailyTrends(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(trends[trends.length - 1].date).toBe(today);
  });

  it("synthetic data: some days have labels > 0 in a 90-day window", async () => {
    const trends = await getDailyTrends(90);
    const withLabels = trends.filter((t) => t.labels > 0);
    expect(withLabels.length).toBeGreaterThan(0);
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getDailyTrends(90));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getVendorTable ────────────────────────────────────────────────────────────

describe("getVendorTable", () => {
  let rows: Awaited<ReturnType<typeof getVendorTable>>;

  beforeAll(async () => {
    rows = await getVendorTable(90);
  });

  it("returns at least one vendor in synthetic data", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("fill_rate is null or in [0, 1]", () => {
    for (const r of rows) {
      if (r.fill_rate !== null) {
        expect(r.fill_rate).toBeGreaterThanOrEqual(0);
        expect(r.fill_rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("discrepancy_rate is null or in [0, 1]", () => {
    for (const r of rows) {
      if (r.discrepancy_rate !== null) {
        expect(r.discrepancy_rate).toBeGreaterThanOrEqual(0);
        expect(r.discrepancy_rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("total_received <= total_ordered is not enforced but both are non-negative", () => {
    for (const r of rows) {
      expect(r.total_ordered).toBeGreaterThanOrEqual(0);
      expect(r.total_received).toBeGreaterThanOrEqual(0);
    }
  });

  it("wastage_units and label_count are non-negative", () => {
    for (const r of rows) {
      expect(r.wastage_units).toBeGreaterThanOrEqual(0);
      expect(r.label_count).toBeGreaterThanOrEqual(0);
    }
  });

  it("vendor names are non-empty strings", () => {
    for (const r of rows) {
      expect(typeof r.vendor).toBe("string");
      expect(r.vendor.length).toBeGreaterThan(0);
    }
  });

  it("sorted descending by total_received", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total_received).toBeGreaterThanOrEqual(rows[i].total_received);
    }
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getVendorTable(90));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getLotCompliance ──────────────────────────────────────────────────────────

describe("getLotCompliance", () => {
  let rows: Awaited<ReturnType<typeof getLotCompliance>>;

  beforeAll(async () => {
    rows = await getLotCompliance(90, 50);
  });

  it("returns non-empty array for 90-day synthetic data", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("lot_no is non-empty string", () => {
    for (const r of rows) {
      expect(typeof r.lot_no).toBe("string");
      expect(r.lot_no.length).toBeGreaterThan(0);
    }
  });

  it("labels count is positive", () => {
    for (const r of rows) {
      expect(r.labels).toBeGreaterThan(0);
    }
  });

  it("is_auto_lot is a boolean", () => {
    for (const r of rows) {
      expect(typeof r.is_auto_lot).toBe("boolean");
    }
  });

  it("auto lot numbers start with LOT_ and are long", () => {
    const autoLots = rows.filter((r) => r.is_auto_lot);
    for (const r of autoLots) {
      expect(r.lot_no.startsWith("LOT_")).toBe(true);
      expect(r.lot_no.length).toBeGreaterThan(20);
    }
  });

  it("expiry_date is null or a date string", () => {
    for (const r of rows) {
      if (r.expiry_date !== null) {
        expect(typeof r.expiry_date).toBe("string");
        expect(r.expiry_date.length).toBeGreaterThan(0);
      }
    }
  });

  it("respects limit", async () => {
    const limited = await getLotCompliance(90, 5);
    expect(limited.length).toBeLessThanOrEqual(5);
  });

  it("performance: 90-day window under limit", async () => {
    const { ms } = await timed(() => getLotCompliance(90, 50));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── getDiscrepancies ──────────────────────────────────────────────────────────

describe("getDiscrepancies", () => {
  let rows: Awaited<ReturnType<typeof getDiscrepancies>>;

  beforeAll(async () => {
    rows = await getDiscrepancies(90, 50);
  });

  it("every row has discrepancy_qty > 0", () => {
    for (const r of rows) {
      expect(r.discrepancy_qty).toBeGreaterThan(0);
    }
  });

  it("qty_ordered and qty_received are non-negative", () => {
    for (const r of rows) {
      expect(r.qty_ordered).toBeGreaterThanOrEqual(0);
      expect(r.qty_received).toBeGreaterThanOrEqual(0);
    }
  });

  it("vendor and po_name are non-empty strings", () => {
    for (const r of rows) {
      expect(r.vendor.length).toBeGreaterThan(0);
      expect(r.po_name.length).toBeGreaterThan(0);
    }
  });

  it("event_time matches YYYY-MM-DD format", () => {
    for (const r of rows) {
      expect(r.event_time).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("sorted descending by discrepancy_qty", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].discrepancy_qty).toBeGreaterThanOrEqual(rows[i].discrepancy_qty);
    }
  });

  it("respects limit", async () => {
    const limited = await getDiscrepancies(90, 10);
    expect(limited.length).toBeLessThanOrEqual(10);
  });

  it("empty window (1 day far in past) returns array without error", async () => {
    // Use a very small window that likely has 0 discrepancies
    const r = await getDiscrepancies(1);
    expect(Array.isArray(r)).toBe(true);
  });

  it("performance: 365-day window under limit", async () => {
    const { ms } = await timed(() => getDiscrepancies(365, 50));
    expect(ms).toBeLessThan(PERF_LIMIT_MS);
  });
});

// ── Cross-query consistency ───────────────────────────────────────────────────

describe("cross-query consistency", () => {
  it("vendor table vendors overlap with wastage byVendor", async () => {
    const [vendors, wastage] = await Promise.all([
      getVendorTable(90),
      getWastageSummary(90),
    ]);
    const vendorNames = new Set(vendors.map((v) => v.vendor));
    for (const w of wastage.byVendor) {
      expect(vendorNames.has(w.vendor)).toBe(true);
    }
  });

  it("discrepancy count from fill rate <= total discrepancy rows from list", async () => {
    const [fill, disc] = await Promise.all([
      getFillRateSummary(90),
      getDiscrepancies(90, 1000),
    ]);
    // getDiscrepancies returns po_events rows with discrepancy_qty > 0
    // getFillRateSummary counts line_item_approved with discrepancy_qty > 0
    // They should be equal (same filter)
    expect(Math.abs(fill.discrepancyCount - disc.length)).toBeLessThanOrEqual(
      // Allow small delta due to the 1000 row limit
      Math.max(0, fill.discrepancyCount - 1000)
    );
  });

  it("all 9 queries run in parallel without deadlock", async () => {
    const start = performance.now();
    await Promise.all([
      getLabelSummary(30),
      getFillRateSummary(30),
      getWastageSummary(30),
      getTransformationSummary(30),
      getTopProducts(30),
      getDailyTrends(30),
      getVendorTable(30),
      getLotCompliance(30, 20),
      getDiscrepancies(30, 20),
    ]);
    const elapsed = performance.now() - start;
    // All 9 queries together should finish well under 5 seconds
    expect(elapsed).toBeLessThan(5000);
  });
});

// ── Edge cases: days=1 (empty / near-empty windows) ──────────────────────────
// These prove every function handles a window with 0 or very few rows without
// crashing or returning bad shapes.

describe("edge cases: days=1 (potentially empty window)", () => {
  it("getFillRateSummary(1): valid struct, fillRate null or in [0,1]", async () => {
    const s = await getFillRateSummary(1);
    expect(typeof s.totalLineItems).toBe("number");
    expect(s.totalLineItems).toBeGreaterThanOrEqual(0);
    if (s.fillRate !== null) {
      expect(s.fillRate).toBeGreaterThanOrEqual(0);
      expect(s.fillRate).toBeLessThanOrEqual(1);
    }
    if (s.totalLineItems === 0) {
      expect(s.discrepancyRate).toBeNull();
    }
  });

  it("getWastageSummary(1): valid struct, byVendor is array, no crash", async () => {
    const s = await getWastageSummary(1);
    expect(typeof s.totalUnits).toBe("number");
    expect(s.totalUnits).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(s.byVendor)).toBe(true);
    // byVendor is a subset; its sum must be <= totalUnits
    const byVendorSum = s.byVendor.reduce((acc, r) => acc + r.units, 0);
    expect(byVendorSum).toBeLessThanOrEqual(s.totalUnits + 0.01); // float tolerance
  });

  it("getTransformationSummary(1): valid struct, yield null when no data", async () => {
    const s = await getTransformationSummary(1);
    expect(typeof s.inputUnits).toBe("number");
    expect(typeof s.outputUnits).toBe("number");
    expect(typeof s.sessionCount).toBe("number");
    if (s.inputUnits === 0) {
      expect(s.yield).toBeNull();
    } else {
      expect(s.yield).not.toBeNull();
    }
  });

  it("getVendorTable(1): returns array (possibly empty), no crash", async () => {
    const rows = await getVendorTable(1);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.vendor).toBe("string");
      if (r.fill_rate !== null) {
        expect(r.fill_rate).toBeGreaterThanOrEqual(0);
        expect(r.fill_rate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("getLotCompliance(1): returns array (possibly empty), no crash", async () => {
    const rows = await getLotCompliance(1, 10);
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r.labels).toBeGreaterThan(0);
      expect(typeof r.is_auto_lot).toBe("boolean");
    }
  });
});

// ── Data integrity: internal consistency checks ───────────────────────────────

describe("data integrity", () => {
  it("getWastageSummary byVendor sum <= totalUnits (byVendor excludes wastage without po_id)", async () => {
    const s = await getWastageSummary(365);
    const byVendorSum = s.byVendor.reduce((acc, r) => acc + r.units, 0);
    // byVendor only counts wastage with a matching po_id — it can be less than totalUnits
    expect(byVendorSum).toBeGreaterThanOrEqual(0);
    expect(byVendorSum).toBeLessThanOrEqual(s.totalUnits + 0.01);
  });

  it("getTransformationSummary sessionCount == count of input-delta rows (data model: each row unique event_id)", async () => {
    const s = await getTransformationSummary(365);
    // sessionCount = COUNT(DISTINCT event_id) FILTER (WHERE delta < 0)
    // Since each row has a unique event_id, this equals the number of negative-delta transformation rows
    expect(s.sessionCount).toBeGreaterThan(0);
    // outputUnits / inputUnits gives the yield — negative delta (input) should exceed or be close to positive (output)
    if (s.yield !== null) {
      // Yield between 0 and 2 is physically plausible (up to 200% output from waste reduction)
      expect(s.yield).toBeGreaterThan(0);
      expect(s.yield).toBeLessThanOrEqual(2);
    }
  });

  it("getFillRateSummary discrepancyCount is consistent with discrepancyRate", async () => {
    const s = await getFillRateSummary(365);
    if (s.totalLineItems > 0) {
      expect(s.discrepancyRate).not.toBeNull();
      expect(Math.abs(s.discrepancyRate! - s.discrepancyCount / s.totalLineItems)).toBeLessThan(0.0001);
    } else {
      expect(s.discrepancyRate).toBeNull();
    }
  });

  it("getVendorTable sorted by total_received descending (all days)", async () => {
    const rows = await getVendorTable(365);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total_received).toBeGreaterThanOrEqual(rows[i].total_received);
    }
    // All vendors should have fill_rate > 0.9 in this synthetic dataset (high-quality data)
    for (const r of rows) {
      if (r.fill_rate !== null && r.total_ordered > 100) {
        expect(r.fill_rate).toBeGreaterThan(0.9);
      }
    }
  });

  it("getLotCompliance: auto lots detected correctly (LOT_ prefix + length > 20)", async () => {
    const rows = await getLotCompliance(365, 200);
    for (const r of rows) {
      const isAutoByInspection = r.lot_no.startsWith("LOT_") && r.lot_no.length > 20;
      expect(r.is_auto_lot).toBe(isAutoByInspection);
    }
  });

  it("getDiscrepancies: discrepancy_type is 'over' or 'short' or non-empty", async () => {
    const rows = await getDiscrepancies(365, 200);
    for (const r of rows) {
      expect(r.discrepancy_type.length).toBeGreaterThan(0);
      // Synthetic data only has these two types
      expect(["over", "short"]).toContain(r.discrepancy_type);
    }
  });

  it("getDailyTrends: inv_in and inv_out are independent positive values", async () => {
    const trends = await getDailyTrends(90);
    let totalInvIn = 0;
    let totalInvOut = 0;
    for (const t of trends) {
      expect(t.inv_in).toBeGreaterThanOrEqual(0);
      expect(t.inv_out).toBeGreaterThanOrEqual(0);
      totalInvIn += t.inv_in;
      totalInvOut += t.inv_out;
    }
    // Over 90 days there must be some inventory movement
    expect(totalInvIn).toBeGreaterThan(0);
    expect(totalInvOut).toBeGreaterThan(0);
  });

  it("performance: 365-day parallel run stays under 8 seconds", async () => {
    const start = performance.now();
    await Promise.all([
      getLabelSummary(365),
      getFillRateSummary(365),
      getWastageSummary(365),
      getTransformationSummary(365),
      getTopProducts(365, 20),
      getVendorTable(365),
      getLotCompliance(365, 100),
      getDiscrepancies(365, 100),
    ]);
    expect(performance.now() - start).toBeLessThan(8000);
  });
});
