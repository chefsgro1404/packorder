'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Tag,
  PackageCheck,
  Trash2,
  Shuffle,
  BarChart2,
  AlertTriangle,
  ClipboardList,
  ChevronDown,
} from 'lucide-react';

// ── Types mirrored from API responses ────────────────────────────────────────

interface LabelSummary   { total: number; prev: number; pctChange: number | null; reprints: number; lotLabels: number; }
interface FillRateSummary { fillRate: number | null; prevFillRate: number | null; totalLineItems: number; discrepancyCount: number; discrepancyRate: number | null; }
interface WastageSummary  { totalUnits: number; prevUnits: number; pctChange: number | null; byVendor: { vendor: string; units: number }[]; }
interface TransformSummary { inputUnits: number; outputUnits: number; yield: number | null; sessionCount: number; }
interface TopProduct       { product_title: string; labels: number; pct: number; }

interface SummaryData {
  labels: LabelSummary;
  fillRate: FillRateSummary;
  wastage: WastageSummary;
  transformation: TransformSummary;
  topProducts: TopProduct[];
}

interface DayTrend { date: string; labels: number; inv_in: number; inv_out: number; wastage: number; }

interface VendorRow { vendor: string; total_ordered: number; total_received: number; fill_rate: number | null; discrepancy_count: number; discrepancy_rate: number | null; wastage_units: number; label_count: number; }
interface LotRow    { product_title: string; lot_no: string; vendor: string; po_name: string; labels: number; is_auto_lot: boolean; expiry_date: string | null; }
interface DiscRow   { po_name: string; vendor: string; product_title: string; qty_ordered: number; qty_received: number; discrepancy_qty: number; discrepancy_type: string; event_time: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}
function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${Math.round(v * 100)}%`;
}
function fmtNum(n: number): string {
  return n.toLocaleString();
}

function TrendBadge({ change }: { change: number | null }) {
  if (change === null) return <span className="text-[var(--text-muted)] text-xs">vs prev</span>;
  const up = change > 0;
  const flat = change === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${flat ? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]' : up ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
      {flat ? <Minus size={10} /> : up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {pct(change)}
    </span>
  );
}

// ── SVG Trend Chart ───────────────────────────────────────────────────────────

interface ChartProps { data: DayTrend[]; height?: number; }

function TrendChart({ data, height = 160 }: ChartProps) {
  const W = 800;
  const H = height;
  const PAD = { top: 10, right: 20, bottom: 24, left: 40 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  if (!data.length) return <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">No trend data</div>;

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.labels, d.inv_in, d.wastage)));
  const xs = data.map((_, i) => PAD.left + (i / (data.length - 1 || 1)) * iW);
  const y  = (v: number) => PAD.top + iH - (v / maxVal) * iH;

  function polyline(vals: number[], color: string, dashed = false) {
    const pts = vals.map((v, i) => `${xs[i]},${y(v)}`).join(' ');
    return <polyline key={color} points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />;
  }

  // X-axis labels — show up to 7
  const step = Math.ceil(data.length / 7);
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxVal));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {/* grid */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border-color)" strokeWidth={0.5} />
          <text x={PAD.left - 4} y={y(t) + 3.5} textAnchor="end" fontSize={9} fill="var(--text-muted)">{t.toLocaleString()}</text>
        </g>
      ))}
      {/* series */}
      {polyline(data.map((d) => d.labels), 'var(--accent-color)')}
      {polyline(data.map((d) => d.inv_in), '#16a34a')}
      {polyline(data.map((d) => d.wastage), '#dc2626', true)}
      {/* x labels */}
      {xLabels.map((d) => {
        const i = data.indexOf(d);
        return <text key={d.date} x={xs[i]} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{d.date.slice(5)}</text>;
      })}
    </svg>
  );
}

// ── Skeleton / spinner ────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[var(--bg-elevated)] ${className}`} />;
}

// ── Stat Tile ─────────────────────────────────────────────────────────────────

interface TileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  change?: number | null;
  loading?: boolean;
}

function StatTile({ icon, label, value, sub, change, loading }: TileProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="text-[var(--accent-color)] opacity-70">{icon}</span>
      </div>
      {loading ? (
        <>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-16" />
        </>
      ) : (
        <>
          <div className="text-2xl font-bold text-[var(--text-primary)] truncate">{value}</div>
          <div className="flex items-center gap-2 flex-wrap">
            {sub && <span className="text-[var(--text-muted)] text-xs">{sub}</span>}
            {change !== undefined && <TrendBadge change={change ?? null} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = 'vendors' | 'lots' | 'discrepancies';

export default function AnalyticsPage() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<TabKey>('vendors');
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [trends, setTrends]   = useState<DayTrend[]>([]);
  const [tableData, setTableData] = useState<{ vendors: VendorRow[]; lots: LotRow[]; discrepancies: DiscRow[] }>({ vendors: [], lots: [], discrepancies: [] });

  const [loadingSum, setLoadingSum] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingTable, setLoadingTable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoadingSum(true);
    setLoadingTrend(true);
    setLoadingTable(true);
    setError(null);

    try {
      const [sumRes, trendRes, vendorRes, lotRes, discRes] = await Promise.all([
        fetch(`/api/analytics/summary?days=${days}`),
        fetch(`/api/analytics/trends?days=${Math.min(days, 90)}`),
        fetch(`/api/analytics/vendors?days=${days}&view=vendors`),
        fetch(`/api/analytics/vendors?days=${days}&view=lots`),
        fetch(`/api/analytics/vendors?days=${days}&view=discrepancies`),
      ]);

      const [sumJson, trendJson, vendorJson, lotJson, discJson] = await Promise.all([
        sumRes.json(), trendRes.json(), vendorRes.json(), lotRes.json(), discRes.json(),
      ]);

      if (sumJson.ok) {
        setSummary({ labels: sumJson.labels, fillRate: sumJson.fillRate, wastage: sumJson.wastage, transformation: sumJson.transformation, topProducts: sumJson.topProducts });
      }
      if (trendJson.ok) setTrends(trendJson.trends ?? []);
      setTableData({
        vendors:       vendorJson.ok ? vendorJson.rows : [],
        lots:          lotJson.ok    ? lotJson.rows    : [],
        discrepancies: discJson.ok   ? discJson.rows   : [],
      });

      if (!sumJson.ok) setError(sumJson.error ?? 'Summary error');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingSum(false);
      setLoadingTrend(false);
      setLoadingTable(false);
    }
  }, [days, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const s = summary;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-base font-semibold text-[var(--text-primary)] flex-1">Analytics</h1>

        {/* Date range */}
        <div className="flex items-center gap-1 bg-[var(--bg-elevated)] rounded-lg p-0.5">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${days === d ? 'bg-[var(--accent-color)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {d === 365 ? '1Y' : `${d}D`}
            </button>
          ))}
        </div>

        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loadingSum}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] disabled:opacity-40"
        >
          <RefreshCw size={16} className={loadingSum ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-5 space-y-5">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="font-medium">Query error:</span> {error}
          </div>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatTile
            icon={<Tag size={16} />}
            label="Labels Printed"
            value={s ? fmtNum(s.labels.total) : '—'}
            sub={s ? `${fmtNum(s.labels.reprints)} reprints` : undefined}
            change={s?.labels.pctChange}
            loading={loadingSum}
          />
          <StatTile
            icon={<PackageCheck size={16} />}
            label="PO Fill Rate"
            value={s ? fmtPct(s.fillRate.fillRate) : '—'}
            sub={s ? `${fmtNum(s.fillRate.totalLineItems)} lines` : undefined}
            change={s && s.fillRate.fillRate !== null && s.fillRate.prevFillRate !== null
              ? Math.round((s.fillRate.fillRate - s.fillRate.prevFillRate) * 100)
              : null}
            loading={loadingSum}
          />
          <StatTile
            icon={<Trash2 size={16} />}
            label="Wastage Units"
            value={s ? fmtNum(s.wastage.totalUnits) : '—'}
            sub={s?.wastage.byVendor[0] ? `Top: ${s.wastage.byVendor[0].vendor}` : undefined}
            change={s?.wastage.pctChange}
            loading={loadingSum}
          />
          <StatTile
            icon={<Shuffle size={16} />}
            label="Transform Yield"
            value={s ? fmtPct(s.transformation.yield) : '—'}
            sub={s ? `${fmtNum(s.transformation.sessionCount)} sessions` : undefined}
            loading={loadingSum}
          />
          <StatTile
            icon={<BarChart2 size={16} />}
            label="Discrepancies"
            value={s ? fmtNum(s.fillRate.discrepancyCount) : '—'}
            sub={s ? `${fmtPct(s.fillRate.discrepancyRate)} rate` : undefined}
            loading={loadingSum}
          />
        </div>

        {/* Trend chart + Top Products */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Chart */}
          <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Daily Activity</h2>
              <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--accent-color)]" /> Labels</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-600" /> Inv In</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-red-600 opacity-70 border-dashed border-t border-red-600" /> Wastage</span>
              </div>
            </div>
            {loadingTrend ? (
              <div className="space-y-2">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <TrendChart data={trends} height={160} />
            )}
          </div>

          {/* Top Products */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Top Products</h2>
            {loadingSum ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : !s?.topProducts.length ? (
              <p className="text-[var(--text-muted)] text-sm">No data</p>
            ) : (
              <div className="space-y-2">
                {s.topProducts.map((p) => (
                  <div key={p.product_title}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-[var(--text-secondary)] truncate pr-2" title={p.product_title}>{p.product_title}</span>
                      <span className="text-[var(--text-muted)] shrink-0">{p.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent-color)] rounded-full transition-all" style={{ width: `${p.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabbed bottom section */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden">

          {/* Tabs */}
          <div className="flex border-b border-[var(--border-color)] overflow-x-auto">
            {([
              { key: 'vendors',       label: 'Vendor Comparison',  icon: <PackageCheck size={14} /> },
              { key: 'lots',          label: 'Lot Compliance',      icon: <ClipboardList size={14} /> },
              { key: 'discrepancies', label: 'Discrepancies',       icon: <AlertTriangle size={14} /> },
            ] as const).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${tab === key ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                {icon} {label}
                {key === 'discrepancies' && summary && summary.fillRate.discrepancyCount > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px leading-none">
                    {summary.fillRate.discrepancyCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            {loadingTable ? (
              <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (

              /* Vendor table */
              tab === 'vendors' && (
                tableData.vendors.length === 0 ? (
                  <p className="p-6 text-center text-[var(--text-muted)] text-sm">No vendor data for this period</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
                        {['Vendor', 'Ordered', 'Received', 'Fill Rate', 'Discrepancies', 'Disc Rate', 'Wastage', 'Labels'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.vendors.map((v) => (
                        <tr key={v.vendor} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-elevated)]/50 transition-colors">
                          <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{v.vendor}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(v.total_ordered)}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(v.total_received)}</td>
                          <td className="px-3 py-2">
                            <span className={`font-medium ${v.fill_rate !== null && v.fill_rate >= 0.95 ? 'text-green-600 dark:text-green-400' : v.fill_rate !== null && v.fill_rate < 0.8 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-secondary)]'}`}>
                              {fmtPct(v.fill_rate)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(v.discrepancy_count)}</td>
                          <td className="px-3 py-2">
                            <span className={v.discrepancy_rate !== null && v.discrepancy_rate > 0.1 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-secondary)]'}>
                              {fmtPct(v.discrepancy_rate)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(v.wastage_units)}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(v.label_count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )
            )}

            {/* Lot compliance */}
            {!loadingTable && tab === 'lots' && (
              tableData.lots.length === 0 ? (
                <p className="p-6 text-center text-[var(--text-muted)] text-sm">No lot data for this period</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
                      {['Product', 'Lot #', 'Vendor', 'PO', 'Labels', 'Expiry', 'Type'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.lots.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-elevated)]/50 transition-colors">
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)] max-w-[160px] truncate" title={r.product_title}>{r.product_title}</td>
                        <td className="px-3 py-2 font-mono text-[var(--text-secondary)] max-w-[120px] truncate" title={r.lot_no}>{r.lot_no}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.vendor || '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.po_name || '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(r.labels)}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.expiry_date ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${r.is_auto_lot ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
                            {r.is_auto_lot ? 'Auto' : 'Manual'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {/* Discrepancies */}
            {!loadingTable && tab === 'discrepancies' && (
              tableData.discrepancies.length === 0 ? (
                <p className="p-6 text-center text-[var(--text-muted)] text-sm">No discrepancies for this period 🎉</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] bg-[var(--bg-elevated)]">
                      {['PO', 'Vendor', 'Product', 'Ordered', 'Received', 'Discrepancy', 'Type', 'Date'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.discrepancies.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-elevated)]/50 transition-colors">
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.po_name}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{r.vendor}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] max-w-[140px] truncate" title={r.product_title}>{r.product_title}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(r.qty_ordered)}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{fmtNum(r.qty_received)}</td>
                        <td className="px-3 py-2 font-semibold text-red-600 dark:text-red-400">{r.discrepancy_qty > 0 ? '+' : ''}{fmtNum(r.discrepancy_qty)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 text-[10px] font-medium capitalize">
                            {r.discrepancy_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{r.event_time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        </div>

        {/* Wastage by vendor mini breakdown */}
        {!loadingSum && s && s.wastage.byVendor.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Wastage by Vendor</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {s.wastage.byVendor.map((v) => (
                <div key={v.vendor} className="bg-[var(--bg-elevated)] rounded-lg p-3">
                  <div className="text-[var(--text-muted)] text-xs truncate" title={v.vendor}>{v.vendor}</div>
                  <div className="text-lg font-bold text-[var(--text-primary)] mt-1">{fmtNum(v.units)}</div>
                  <div className="text-[var(--text-muted)] text-xs">units</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[var(--text-muted)] text-xs">
          Showing last {days} days · Synthetic data · DuckDB {days <= 90 ? 'in-memory' : 'full scan'}
        </p>
      </div>
    </div>
  );
}
