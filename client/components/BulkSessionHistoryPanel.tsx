'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, ChevronDown, ChevronUp, RefreshCw, RotateCcw, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface SessionLabelResult {
  index: number;
  sn: string;
  qrPayload: string;
  printedAtEst: string;
  status: string;
  error?: string | null;
}

interface BulkSession {
  id: string;
  productTitle: string;
  variantTitle?: string | null;
  poId?: string | null;
  vendorName?: string | null;
  lotNo?: string | null;
  expiryDate?: string | null;
  quantityOrdered: number;
  quantityPrinted: number;
  results: string; // JSON string
  sessionDateEst: string;
}

interface ParsedBulkSession extends Omit<BulkSession, 'results'> {
  parsedResults: SessionLabelResult[];
}

interface BulkSessionHistoryPanelProps {
  onReprintLabel: (qrPayload: string, sn: string, productTitle: string, variantTitle: string | null) => void;
}

export function BulkSessionHistoryPanel({ onReprintLabel }: BulkSessionHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ParsedBulkSession[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fetchedOnce, setFetchedOnce] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/scale/bulk-sessions?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      const raw: BulkSession[] = data.sessions ?? [];
      setSessions(raw.map(s => ({
        ...s,
        parsedResults: (() => {
          try { return JSON.parse(s.results) as SessionLabelResult[]; }
          catch { return []; }
        })(),
      })));
      setFetchedOnce(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Load when panel opens for the first time
  useEffect(() => {
    if (open && !fetchedOnce) load();
  }, [open, fetchedOnce, load]);

  const handleToggle = () => {
    setOpen(v => !v);
  };

  return (
    <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Bulk Session History</span>
          {sessions.length > 0 && (
            <span className="text-xs text-slate-500">— {sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <button
              onClick={e => { e.stopPropagation(); load(); }}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading sessions…</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Package className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No bulk sessions recorded yet</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60">
              {sessions.map(s => {
                const isExpanded = expandedId === s.id;
                const failed = s.parsedResults.filter(r => r.status !== 'printed');
                const printed = s.parsedResults.filter(r => r.status === 'printed');

                return (
                  <div key={s.id}>
                    {/* Session row */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-900/40 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 leading-snug">{s.productTitle}</p>
                        {s.variantTitle && s.variantTitle !== 'Default Title' && (
                          <p className="text-xs text-slate-400">{s.variantTitle}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          <p className="text-xs text-slate-500">{s.sessionDateEst}</p>
                          {s.vendorName && <p className="text-xs text-blue-400">{s.vendorName}</p>}
                          {s.lotNo && <p className="text-xs text-slate-500 font-mono">Lot {s.lotNo}</p>}
                          {s.expiryDate && <p className="text-xs text-slate-500">Exp {s.expiryDate}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-200">{s.quantityPrinted}/{s.quantityOrdered}</p>
                          <p className="text-[10px] text-slate-500">printed</p>
                        </div>
                        {failed.length > 0 ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-900 font-semibold">
                            {failed.length} failed
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-900 font-semibold">
                            OK
                          </span>
                        )}
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                          : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                      </div>
                    </button>

                    {/* Expanded label list */}
                    {isExpanded && (
                      <div className="px-4 pb-3 flex flex-col gap-1.5">
                        {/* Failed labels first */}
                        {failed.length > 0 && (
                          <div className="flex flex-col gap-1 mb-1">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-semibold text-rose-400 uppercase tracking-widest">Failed — tap to reprint</p>
                              <button
                                onClick={() => {
                                  failed.forEach(r => {
                                    if (r.qrPayload) onReprintLabel(r.qrPayload, r.sn, s.productTitle, s.variantTitle ?? null);
                                  });
                                }}
                                className="text-[10px] text-rose-400 hover:text-rose-200 px-2 py-1 rounded-lg hover:bg-rose-950/40 transition-colors"
                              >
                                Reprint all failed
                              </button>
                            </div>
                            {failed.map(r => (
                              <div key={r.index} className="flex items-center gap-2 bg-rose-950/30 border border-rose-900/40 rounded-xl px-3 py-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                                <span className="text-[10px] text-slate-500 font-bold w-5">#{r.index}</span>
                                <p className="text-xs text-rose-300 flex-1 min-w-0 truncate">{r.error ?? 'Print failed'}</p>
                                <button
                                  onClick={() => r.qrPayload && onReprintLabel(r.qrPayload, r.sn, s.productTitle, s.variantTitle ?? null)}
                                  disabled={!r.qrPayload}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30"
                                >
                                  <RotateCcw className="w-3 h-3" /> Reprint
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Printed labels */}
                        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                          {printed.map(r => (
                            <div key={r.index} className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-3 py-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                              <span className="text-[10px] text-slate-500 font-bold w-5">#{r.index}</span>
                              <div className="flex-shrink-0 bg-white rounded p-0.5">
                                <QRCodeSVG value={r.qrPayload || 'N/A'} size={20} level="M" bgColor="#ffffff" fgColor="#0f172a" />
                              </div>
                              <p className="text-xs text-slate-400 font-mono flex-1 min-w-0 truncate">{r.sn}</p>
                              <button
                                onClick={() => r.qrPayload && onReprintLabel(r.qrPayload, r.sn, s.productTitle, s.variantTitle ?? null)}
                                disabled={!r.qrPayload}
                                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-30"
                              >
                                <RotateCcw className="w-3 h-3" /> Reprint
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
