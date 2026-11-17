import { runQueryAsObjects, tableGlob } from "./db";

// Date window helpers — all timestamps in Parquet are UTC TIMESTAMPTZ_NS;
// cast to TIMESTAMPTZ so comparisons against current_timestamp work.
function dateFilter(col: string, days: number): string {
  return `CAST(${col} AS TIMESTAMPTZ) >= current_timestamp - INTERVAL ${days} DAY AND CAST(${col} AS TIMESTAMPTZ) <= current_timestamp`;
}
function prevDateFilter(col: string, days: number): string {
  return `CAST(${col} AS TIMESTAMPTZ) >= current_timestamp - INTERVAL ${days * 2} DAY AND CAST(${col} AS TIMESTAMPTZ) < current_timestamp - INTERVAL ${days} DAY`;
}

// ── Summary tile: labels printed ─────────────────────────────────────────────

export interface LabelSummary {
  total: number;
  prev: number;
  pctChange: number | null;
  reprints: number;
  lotLabels: number;
}

export async function getLabelSummary(days: number): Promise<LabelSummary> {
  const glob = tableGlob("label_events");
  const rows = await runQueryAsObjects(`
    SELECT
      COUNT(*) FILTER (WHERE ${dateFilter("event_time", days)})                           AS total,
      COUNT(*) FILTER (WHERE ${prevDateFilter("event_time", days)})                       AS prev,
      COUNT(*) FILTER (WHERE ${dateFilter("event_time", days)} AND is_reprint = true)     AS reprints,
      COUNT(*) FILTER (WHERE ${dateFilter("event_time", days)} AND lot_no IS NOT NULL)    AS lot_labels
    FROM read_parquet('${glob}')
  `);
  const r = rows[0];
  const total   = Number(r.total   ?? 0);
  const prev    = Number(r.prev    ?? 0);
  const pctChange = prev === 0 ? null : Math.round(((total - prev) / prev) * 100);
  return { total, prev, pctChange, reprints: Number(r.reprints ?? 0), lotLabels: Number(r.lot_labels ?? 0) };
}

// ── Summary tile: PO fill rate ───────────────────────────────────────────────

export interface FillRateSummary {
  fillRate: number | null;    // 0–1
  prevFillRate: number | null;
  totalLineItems: number;
  discrepancyCount: number;
  discrepancyRate: number | null; // 0–1
}

export async function getFillRateSummary(days: number): Promise<FillRateSummary> {
  const glob = tableGlob("po_events");
  const rows = await runQueryAsObjects(`
    SELECT
      AVG(CASE WHEN ${dateFilter("event_time", days)}
               THEN CAST(qty_received AS DOUBLE) / NULLIF(qty_ordered, 0) END)             AS fill_rate,
      AVG(CASE WHEN ${prevDateFilter("event_time", days)}
               THEN CAST(qty_received AS DOUBLE) / NULLIF(qty_ordered, 0) END)             AS prev_fill_rate,
      COUNT(*) FILTER (WHERE event_type = 'line_item_approved'
                         AND ${dateFilter("event_time", days)})                            AS total_li,
      COUNT(*) FILTER (WHERE event_type = 'line_item_approved'
                         AND ${dateFilter("event_time", days)}
                         AND discrepancy_qty > 0)                                          AS disc_count
    FROM read_parquet('${glob}')
    WHERE event_type = 'line_item_approved'
  `);
  const r = rows[0];
  const fillRate       = r.fill_rate    != null ? Math.min(1, Number(r.fill_rate))      : null;
  const prevFillRate   = r.prev_fill_rate != null ? Math.min(1, Number(r.prev_fill_rate)) : null;
  const totalLineItems = Number(r.total_li  ?? 0);
  const discrepancyCount = Number(r.disc_count ?? 0);
  const discrepancyRate  = totalLineItems === 0 ? null : discrepancyCount / totalLineItems;
  return { fillRate, prevFillRate, totalLineItems, discrepancyCount, discrepancyRate };
}

// ── Summary tile: wastage ────────────────────────────────────────────────────

export interface WastageSummary {
  totalUnits: number;
  prevUnits: number;
  pctChange: number | null;
  byVendor: { vendor: string; units: number }[];
}

export async function getWastageSummary(days: number): Promise<WastageSummary> {
  const glob = tableGlob("inventory_events");

  const totals = await runQueryAsObjects(`
    SELECT
      ABS(SUM(delta) FILTER (WHERE event_type = 'wastage' AND ${dateFilter("event_time", days)}))      AS total,
      ABS(SUM(delta) FILTER (WHERE event_type = 'wastage' AND ${prevDateFilter("event_time", days)}))  AS prev
    FROM read_parquet('${glob}')
    WHERE event_type = 'wastage'
  `);
  const t = totals[0];
  const totalUnits = Number(t.total ?? 0);
  const prevUnits  = Number(t.prev  ?? 0);
  const pctChange  = prevUnits === 0 ? null : Math.round(((totalUnits - prevUnits) / prevUnits) * 100);

  // Wastage by vendor — join via po_id against po_events
  const poGlob = tableGlob("po_events");
  const vendorRows = await runQueryAsObjects(`
    SELECT p.vendor, ABS(SUM(ie.delta)) AS units
    FROM read_parquet('${glob}') AS ie
    JOIN (
      SELECT DISTINCT po_id, vendor FROM read_parquet('${poGlob}')
    ) p ON ie.po_id = p.po_id
    WHERE ie.event_type = 'wastage'
      AND ${dateFilter("ie.event_time", days)}
      AND ie.po_id IS NOT NULL
    GROUP BY p.vendor
    ORDER BY 2 DESC
    LIMIT 5
  `);
  const byVendor = vendorRows.map((r) => ({
    vendor: String(r.vendor),
    units:  Number(r.units ?? 0),
  }));

  return { totalUnits, prevUnits, pctChange, byVendor };
}

// ── Summary tile: transformation yield ──────────────────────────────────────

export interface TransformationSummary {
  inputUnits: number;
  outputUnits: number;
  yield: number | null;        // outputUnits / inputUnits (0–1)
  sessionCount: number;
}

export async function getTransformationSummary(days: number): Promise<TransformationSummary> {
  const glob = tableGlob("inventory_events");
  const rows = await runQueryAsObjects(`
    SELECT
      ABS(SUM(delta) FILTER (WHERE delta < 0 AND ${dateFilter("event_time", days)})) AS input_units,
      SUM(delta)     FILTER (WHERE delta > 0 AND ${dateFilter("event_time", days)})  AS output_units,
      COUNT(DISTINCT event_id) FILTER (WHERE delta < 0 AND ${dateFilter("event_time", days)}) AS sessions
    FROM read_parquet('${glob}')
    WHERE event_type = 'transformation'
  `);
  const r = rows[0];
  const inputUnits   = Number(r.input_units  ?? 0);
  const outputUnits  = Number(r.output_units ?? 0);
  const yieldRate    = inputUnits === 0 ? null : outputUnits / inputUnits;
  return { inputUnits, outputUnits, yield: yieldRate, sessionCount: Number(r.sessions ?? 0) };
}

// ── Summary tile: top products ───────────────────────────────────────────────

export interface TopProduct {
  product_title: string;
  labels: number;
  pct: number;
}

export async function getTopProducts(days: number, limit = 8): Promise<TopProduct[]> {
  const glob = tableGlob("label_events");
  const rows = await runQueryAsObjects(`
    WITH totals AS (
      SELECT product_title, COUNT(*) AS cnt
      FROM read_parquet('${glob}')
      WHERE ${dateFilter("event_time", days)}
      GROUP BY 1
    ), grand AS (SELECT SUM(cnt) AS total FROM totals)
    SELECT t.product_title, t.cnt AS labels, ROUND(100.0 * t.cnt / g.total, 1) AS pct
    FROM totals t, grand g
    ORDER BY t.cnt DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    product_title: String(r.product_title),
    labels:        Number(r.labels ?? 0),
    pct:           Number(r.pct    ?? 0),
  }));
}

// ── Trends chart: daily labels + inventory in/out ────────────────────────────

export interface DayTrend {
  date: string;        // YYYY-MM-DD
  labels: number;
  inv_in: number;
  inv_out: number;
  wastage: number;
}

export async function getDailyTrends(days: number): Promise<DayTrend[]> {
  const labGlob = tableGlob("label_events");
  const invGlob = tableGlob("inventory_events");

  const labRows = await runQueryAsObjects(`
    SELECT strftime(event_time, '%Y-%m-%d') AS d, COUNT(*) AS labels
    FROM read_parquet('${labGlob}')
    WHERE ${dateFilter("event_time", days)}
    GROUP BY 1
  `);

  const invRows = await runQueryAsObjects(`
    SELECT
      strftime(event_time, '%Y-%m-%d') AS d,
      SUM(delta) FILTER (WHERE delta > 0 AND event_type != 'transformation') AS inv_in,
      ABS(SUM(delta) FILTER (WHERE delta < 0 AND event_type NOT IN ('transformation','wastage'))) AS inv_out,
      ABS(SUM(delta) FILTER (WHERE event_type = 'wastage')) AS wastage
    FROM read_parquet('${invGlob}')
    WHERE ${dateFilter("event_time", days)}
    GROUP BY 1
  `);

  // Merge by date
  const labMap  = Object.fromEntries(labRows.map((r) => [r.d as string, Number(r.labels ?? 0)]));
  const invMap  = Object.fromEntries(invRows.map((r) => [
    r.d as string,
    { inv_in: Number(r.inv_in ?? 0), inv_out: Number(r.inv_out ?? 0), wastage: Number(r.wastage ?? 0) },
  ]));

  // Build complete date series
  const result: DayTrend[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
      .toISOString()
      .slice(0, 10);
    result.push({
      date:    d,
      labels:  labMap[d]        ?? 0,
      inv_in:  invMap[d]?.inv_in  ?? 0,
      inv_out: invMap[d]?.inv_out ?? 0,
      wastage: invMap[d]?.wastage ?? 0,
    });
  }
  return result;
}

// ── Vendor comparison table ──────────────────────────────────────────────────

export interface VendorRow {
  vendor: string;
  total_ordered: number;
  total_received: number;
  fill_rate: number | null;
  discrepancy_count: number;
  discrepancy_rate: number | null;
  wastage_units: number;
  label_count: number;
}

export async function getVendorTable(days: number): Promise<VendorRow[]> {
  const poGlob  = tableGlob("po_events");
  const invGlob = tableGlob("inventory_events");
  const labGlob = tableGlob("label_events");

  const poRows = await runQueryAsObjects(`
    SELECT
      vendor,
      SUM(qty_ordered)                                            AS total_ordered,
      SUM(qty_received)                                           AS total_received,
      AVG(CAST(qty_received AS DOUBLE) / NULLIF(qty_ordered, 0)) AS fill_rate,
      COUNT(*) FILTER (WHERE discrepancy_qty > 0)                 AS disc_count,
      COUNT(*)                                                    AS li_count
    FROM read_parquet('${poGlob}')
    WHERE event_type = 'line_item_approved'
      AND ${dateFilter("event_time", days)}
    GROUP BY vendor
  `);

  // Wastage per vendor (via po_id join)
  const wastRows = await runQueryAsObjects(`
    SELECT p.vendor, ABS(SUM(ie.delta)) AS wastage_units
    FROM read_parquet('${invGlob}') ie
    JOIN (SELECT DISTINCT po_id, vendor FROM read_parquet('${poGlob}')) p
      ON ie.po_id = p.po_id
    WHERE ie.event_type = 'wastage'
      AND ${dateFilter("ie.event_time", days)}
      AND ie.po_id IS NOT NULL
    GROUP BY p.vendor
  `);
  const wastMap = Object.fromEntries(wastRows.map((r) => [r.vendor as string, Number(r.wastage_units ?? 0)]));

  // Label count per vendor — join label_events po_id → po vendor
  const labRows = await runQueryAsObjects(`
    SELECT p.vendor, COUNT(*) AS label_count
    FROM read_parquet('${labGlob}') le
    JOIN (SELECT DISTINCT po_id, vendor FROM read_parquet('${poGlob}')) p
      ON le.po_id = p.po_id
    WHERE ${dateFilter("le.event_time", days)}
      AND le.po_id IS NOT NULL
    GROUP BY p.vendor
  `);
  const labMap = Object.fromEntries(labRows.map((r) => [r.vendor as string, Number(r.label_count ?? 0)]));

  return poRows.map((r) => {
    const liCount = Number(r.li_count ?? 0);
    const discCount = Number(r.disc_count ?? 0);
    return {
      vendor:            String(r.vendor),
      total_ordered:     Number(r.total_ordered  ?? 0),
      total_received:    Number(r.total_received ?? 0),
      fill_rate:         r.fill_rate != null ? Math.min(1, Number(r.fill_rate)) : null,
      discrepancy_count: discCount,
      discrepancy_rate:  liCount === 0 ? null : discCount / liCount,
      wastage_units:     wastMap[String(r.vendor)] ?? 0,
      label_count:       labMap[String(r.vendor)]  ?? 0,
    };
  }).sort((a, b) => (b.total_received ?? 0) - (a.total_received ?? 0));
}

// ── Lot compliance ───────────────────────────────────────────────────────────

export interface LotComplianceRow {
  product_title: string;
  lot_no: string;
  vendor: string;
  po_name: string;
  labels: number;
  is_auto_lot: boolean;
  expiry_date: string | null;
}

export async function getLotCompliance(days: number, limit = 50): Promise<LotComplianceRow[]> {
  const labGlob = tableGlob("label_events");
  const poGlob  = tableGlob("po_events");
  const rows = await runQueryAsObjects(`
    SELECT
      le.product_title,
      le.lot_no,
      p.vendor,
      p.po_name,
      COUNT(*)           AS labels,
      MAX(le.expiry_date) AS expiry_date,
      (le.lot_no LIKE 'LOT_%' AND LENGTH(le.lot_no) > 20) AS is_auto_lot
    FROM read_parquet('${labGlob}') le
    LEFT JOIN (SELECT DISTINCT po_id, vendor, po_name FROM read_parquet('${poGlob}')) p
      ON le.po_id = p.po_id
    WHERE le.lot_no IS NOT NULL
      AND ${dateFilter("le.event_time", days)}
    GROUP BY le.product_title, le.lot_no, p.vendor, p.po_name, is_auto_lot
    ORDER BY labels DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    product_title: String(r.product_title ?? ""),
    lot_no:        String(r.lot_no        ?? ""),
    vendor:        String(r.vendor        ?? "Unknown"),
    po_name:       String(r.po_name       ?? ""),
    labels:        Number(r.labels        ?? 0),
    is_auto_lot:   Boolean(r.is_auto_lot),
    expiry_date:   r.expiry_date ? String(r.expiry_date) : null,
  }));
}

// ── PO discrepancy list ──────────────────────────────────────────────────────

export interface DiscrepancyRow {
  po_name: string;
  vendor: string;
  product_title: string;
  qty_ordered: number;
  qty_received: number;
  discrepancy_qty: number;
  discrepancy_type: string;
  event_time: string;
}

export async function getDiscrepancies(days: number, limit = 50): Promise<DiscrepancyRow[]> {
  const glob = tableGlob("po_events");
  const rows = await runQueryAsObjects(`
    SELECT po_name, vendor, product_title, qty_ordered, qty_received,
           discrepancy_qty, discrepancy_type,
           strftime(event_time, '%Y-%m-%d') AS event_time
    FROM read_parquet('${glob}')
    WHERE event_type = 'line_item_approved'
      AND discrepancy_qty > 0
      AND ${dateFilter("event_time", days)}
    ORDER BY discrepancy_qty DESC, event_time DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    po_name:          String(r.po_name          ?? ""),
    vendor:           String(r.vendor           ?? ""),
    product_title:    String(r.product_title    ?? ""),
    qty_ordered:      Number(r.qty_ordered      ?? 0),
    qty_received:     Number(r.qty_received     ?? 0),
    discrepancy_qty:  Number(r.discrepancy_qty  ?? 0),
    discrepancy_type: String(r.discrepancy_type ?? ""),
    event_time:       String(r.event_time       ?? ""),
  }));
}
