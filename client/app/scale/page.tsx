'use client';

import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Radio,
  Wifi,
  RefreshCw,
  Printer,
  RotateCcw,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Plug,
  PlugZap,
  Scale,
  ChevronDown,
  ChevronUp,
  Package,
  Copy,
  Check,
  History,
  Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useScale, type ParsedReading } from '@/hooks/useScale';
import { formatEst } from '@/lib/dateFormat';
import { PrintedLabel } from '@/lib/types';

interface CurrentItem {
  itemNumber: string;
  itemName: string;
  itemWeight: string;
  plu: string;
  productTitle: string;
  found: boolean;
}

function generateSn(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

function buildQrPayload(item: CurrentItem, printedAtEst: string, sn: string): string {
  const plu = item.found ? item.plu : 'N/A';
  return `${plu} | ${item.productTitle} | ${item.itemWeight} | ${printedAtEst} | SN:${sn}`;
}

// ─── Status indicator dot ────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'ok' | 'off' | 'busy' }) {
  return (
    <span
      className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${
        status === 'ok'
          ? 'bg-emerald-500'
          : status === 'busy'
          ? 'bg-amber-400 animate-pulse'
          : 'bg-rose-500'
      }`}
    />
  );
}

// ─── Scale monitor panel ─────────────────────────────────────────────────────

function ScaleMonitor({
  state,
  chunkCount,
  error,
}: {
  state: string;
  chunkCount: number;
  error: string | null;
}) {
  if (state === 'disconnected') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center">
          <Wifi className="w-5 h-5 text-slate-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Scale not connected</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect the scale in Device Setup below</p>
        </div>
        {error && (
          <p className="text-xs text-rose-400 bg-rose-950/50 border border-rose-900 rounded-lg px-3 py-2 max-w-xs">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (state === 'connected') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-emerald-950/60 border-2 border-emerald-800 flex items-center justify-center">
            <Radio className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-950 animate-pulse" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Waiting for scale trigger…</p>
          <p className="text-xs text-slate-500 mt-0.5">RCL → 01 → M+ on the scale</p>
        </div>
        {error && (
          <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2 max-w-xs">
            {error}
          </p>
        )}
      </div>
    );
  }

  // 'receiving' with no chunks = idle listening state; with chunks = actively getting data
  if (state === 'receiving' && chunkCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-emerald-950/60 border-2 border-emerald-800 flex items-center justify-center">
            <Radio className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-950 animate-pulse" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Waiting for scale trigger…</p>
          <p className="text-xs text-slate-500 mt-0.5">RCL → 01 → M+ on the scale</p>
        </div>
        {error && (
          <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900 rounded-lg px-3 py-2 max-w-xs">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (state === 'receiving') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping [animation-delay:150ms]" />
          <div className="relative w-12 h-12 rounded-full bg-blue-950/60 border-2 border-blue-700 flex items-center justify-center">
            <Radio className="w-5 h-5 text-blue-400" />
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Receiving data…</p>
          <p className="text-xs text-slate-500">
            {chunkCount} chunk{chunkCount !== 1 ? 's' : ''} received
          </p>
        </div>
        <div className="flex gap-1 items-end h-5">
          {Array.from({ length: Math.min(chunkCount, 8) }).map((_, i) => (
            <div
              key={i}
              className="w-1.5 bg-blue-500 rounded-full"
              style={{ height: `${40 + (i / 8) * 60}%`, opacity: 0.4 + (i / 8) * 0.6 }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="w-12 h-12 rounded-full bg-violet-950/60 border-2 border-violet-700 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-200">Processing…</p>
        <p className="text-xs text-slate-500">Parsing scale data</p>
      </div>
    </div>
  );
}

// ─── Label preview panel ─────────────────────────────────────────────────────

function LabelPreview({
  item,
  lookupLoading,
}: {
  item: CurrentItem | null;
  lookupLoading: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const previewQrPayload = item ? buildQrPayload(item, formatEst(new Date()), 'preview') : '';

  const handleCopy = async () => {
    if (!item) return;
    await navigator.clipboard.writeText(previewQrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!item) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="w-20 h-14 rounded-xl border-2 border-dashed border-slate-700 flex items-center justify-center bg-slate-900/50">
          <Package className="w-5 h-5 text-slate-600" />
        </div>
        <p className="text-sm text-slate-500">No label yet — trigger the scale</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!item.found && (
        <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-300">
            Item {item.itemNumber} isn&apos;t in the product lookup table. Printing with a placeholder PLU —
            add it under Manage Products.
          </p>
        </div>
      )}

      {/* 1.25"×2.25" portrait label preview */}
      <div className="mx-auto w-full max-w-[126px]">
        <div
          className="relative bg-white rounded-xl overflow-hidden shadow-lg ring-1 ring-slate-700"
          style={{ aspectRatio: '1.25/2.25' }}
        >
          <div className="absolute inset-0 flex flex-col items-start justify-start gap-1 px-2.5 py-2.5">
            <div className="flex flex-col gap-0.5 w-full">
              <p className="text-[7px] font-bold text-slate-900 leading-tight break-words">{item.productTitle}</p>
              <p className="text-[6px] text-slate-700 leading-tight"><span className="font-bold">Weight:</span> {item.itemWeight}</p>
              <p className="text-[6px] text-slate-700 leading-tight"><span className="font-bold">Packing Date:</span> {formatEst(new Date())}</p>
              <p className="text-[6px] text-slate-500 leading-tight font-mono"><span className="font-bold not-italic">SN:</span> preview</p>
            </div>
            <div className="flex justify-center w-full pt-1">
              <QRCodeSVG
                value={previewQrPayload}
                size={56}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
          </div>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-1.5">1.25&quot; × 2.25&quot; portrait · Godex DT2x</p>
      </div>

      {/* Item details */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-800">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">PLU</p>
          <p className="text-sm font-mono text-slate-200 mt-0.5">
            {lookupLoading ? '…' : item.found ? item.plu : 'N/A'}
          </p>
        </div>
        <div className="bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-800">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Weight</p>
          <p className="text-sm font-mono text-slate-200 mt-0.5">{item.itemWeight}</p>
        </div>
      </div>

      {/* QR payload row */}
      <div className="flex items-center justify-between gap-2 bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-800">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">QR Payload (preview)</p>
          <p className="text-xs font-mono text-slate-300 truncate mt-0.5">{previewQrPayload}</p>
        </div>
        <button
          onClick={handleCopy}
          aria-label="Copy QR payload"
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-slate-500" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Device setup panel ──────────────────────────────────────────────────────

function DeviceSetup({
  scaleState,
  scaleError,
  onConnectScale,
  onDisconnectScale,
}: {
  scaleState: string;
  scaleError: string | null;
  onConnectScale: () => void;
  onDisconnectScale: () => void;
}) {
  const [open, setOpen] = useState(scaleState === 'disconnected');
  const isSerialSupported =
    typeof navigator !== 'undefined' && 'serial' in navigator;

  return (
    <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Device Setup</span>
          <span className="text-xs text-slate-500">
            {scaleState !== 'disconnected' ? '— scale connected' : '— action needed'}
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-4 flex flex-col gap-4">
          {!isSerialSupported && (
            <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2">
              Web Serial API not supported. Please use Chrome or Edge on a desktop.
            </p>
          )}

          {/* Scale row */}
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                scaleState !== 'disconnected'
                  ? 'bg-emerald-950/60 text-emerald-400'
                  : 'bg-slate-900 text-slate-500'
              }`}
            >
              <Scale className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-200">Torrey Scale</p>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    scaleState !== 'disconnected'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                      : 'bg-slate-900 text-slate-500 border border-slate-800'
                  }`}
                >
                  {scaleState !== 'disconnected' ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-600">9600 baud · 8N1 · no flow control</p>
              {scaleError && (
                <p className="text-xs text-rose-400 mt-0.5">{scaleError}</p>
              )}
            </div>
            {scaleState !== 'disconnected' ? (
              <button
                onClick={onDisconnectScale}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-rose-950/30"
              >
                <PlugZap className="w-3 h-3" /> Disconnect
              </button>
            ) : (
              <button
                onClick={onConnectScale}
                disabled={!isSerialSupported}
                className="flex items-center gap-1 text-xs text-slate-900 bg-slate-100 hover:bg-white transition-colors px-2.5 py-1.5 rounded-lg font-semibold disabled:opacity-40"
              >
                <Plug className="w-3 h-3" /> Connect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Print history panel ─────────────────────────────────────────────────────

function PrintHistory({
  records,
  loading,
  canPrint,
  onReprint,
}: {
  records: PrintedLabel[];
  loading: boolean;
  canPrint: boolean;
  onReprint: (r: PrintedLabel) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Print History</span>
          {records.length > 0 && (
            <span className="text-xs text-slate-500">— recent {records.length}</span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {open && (
        <div className="border-t border-slate-800">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <RefreshCw className="w-5 h-5 text-slate-700 animate-spin" />
              <p className="text-sm text-slate-600">Loading history…</p>
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <History className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No prints yet</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
              {records.map((r, idx) => (
                <div
                  key={`${r.id}-${idx}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-900/40 group transition-colors"
                >
                  <div className="flex-shrink-0 bg-white rounded-md p-0.5">
                    <QRCodeSVG
                      value={r.qrPayload}
                      size={30}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0f172a"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{r.productTitle}</p>
                    <p className="text-xs text-slate-500">
                      PLU {r.plu} · {r.itemWeight} · {r.printedAtEst} EST
                    </p>
                  </div>
                  <button
                    disabled={!canPrint}
                    onClick={() => onReprint(r)}
                    aria-label={`Reprint ${r.productTitle}`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ScalePage() {
  const router = useRouter();
  const [printHistory, setPrintHistory] = useState<PrintedLabel[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [currentItem, setCurrentItem] = useState<CurrentItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const [printPayload, setPrintPayload] = useState<{
    productTitle: string;
    qrPayload: string;
    itemWeight: string;
    printedAtEst: string;
    sn: string;
  } | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/scale/print-log');
      if (res.ok) {
        const data = await res.json();
        setPrintHistory((data.labels ?? []).slice(0, 10));
      } else {
        console.error('[scale] failed to fetch print history:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[scale] failed to fetch print history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const lookupProduct = useCallback(async (reading: ParsedReading): Promise<CurrentItem> => {
    const fallback: CurrentItem = {
      itemNumber: reading.itemNumber ?? '',
      itemName: reading.itemName,
      itemWeight: reading.itemWeight,
      plu: '',
      productTitle: reading.itemName,
      found: false,
    };

    if (!reading.itemNumber) {
      console.warn('[scale] reading has no item number, skipping product lookup:', reading.itemName);
      return fallback;
    }

    try {
      const res = await fetch(`/api/scale/lookup?itemNumber=${encodeURIComponent(reading.itemNumber)}`);
      if (!res.ok) {
        console.error('[scale] product lookup request failed:', res.status, await res.text().catch(() => ''));
        return fallback;
      }
      const data = await res.json();
      if (!data.found) {
        console.warn('[scale] no product mapping for item number', reading.itemNumber, '— printing with placeholder PLU');
        return fallback;
      }
      console.log('[scale] product lookup hit:', reading.itemNumber, '->', data.plu, data.productTitle);
      return {
        ...fallback,
        plu: data.plu,
        productTitle: data.productTitle,
        found: true,
      };
    } catch (err) {
      console.error('[scale] product lookup errored:', err);
      return fallback;
    }
  }, []);

  const logPrintedLabel = useCallback(async (item: CurrentItem, qrPayload: string, printedAtEst: string, sn: string) => {
    try {
      const res = await fetch('/api/scale/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: item.itemNumber,
          plu: item.found ? item.plu : 'N/A',
          productTitle: item.productTitle,
          itemWeight: item.itemWeight,
          printedAtEst,
          qrPayload,
          sn,
        }),
      });
      if (res.ok) {
        fetchHistory();
      } else {
        console.error('[scale] failed to log printed label:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      // printing already happened, audit log failure shouldn't block the user — but make sure it's visible
      console.error('[scale] failed to log printed label:', err, '| item:', item.itemNumber, '| qr:', qrPayload);
    }
  }, [fetchHistory]);

  // ─── Browser-native print: render the label off-screen, then trigger window.print() ──
  const printItem = useCallback(async (item: CurrentItem) => {
    const printedAtEst = formatEst(new Date());
    const sn = generateSn();
    const qrPayload = buildQrPayload(item, printedAtEst, sn);
    setPrintPayload({ productTitle: item.productTitle, qrPayload, itemWeight: item.itemWeight, printedAtEst, sn });
    setPrintRequestId((n) => n + 1);
    setPrintedAt(new Date());
    await logPrintedLabel(item, qrPayload, printedAtEst, sn);
  }, [logPrintedLabel]);

  useEffect(() => {
    if (printRequestId === 0) return;
    // Wait a tick for the print-only label to render before opening the print dialog.
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, [printRequestId]);

  const handleReading = useCallback(
    async (reading: ParsedReading) => {
      setPrintedAt(null);
      setLookupLoading(true);
      const item = await lookupProduct(reading);
      setCurrentItem(item);
      setLookupLoading(false);
      await printItem(item);
    },
    [lookupProduct, printItem]
  );

  const scale = useScale(handleReading);

  useEffect(() => {
    scale.autoConnect();
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualPrint = async () => {
    if (!currentItem) {
      console.warn('[scale] manual print requested with no current item');
      return;
    }
    await printItem(currentItem);
  };

  const handleReprint = async (record: PrintedLabel) => {
    console.log('[scale] reprinting:', record.productTitle, record.printedAtEst);
    const printedAtEst = formatEst(new Date());
    setPrintPayload({ productTitle: record.productTitle, qrPayload: record.qrPayload, itemWeight: record.itemWeight, printedAtEst, sn: record.sn ?? generateSn() });
    setPrintRequestId((n) => n + 1);
    await logPrintedLabel(
      {
        itemNumber: record.itemNumber,
        itemName: record.productTitle,
        itemWeight: record.itemWeight,
        plu: record.plu,
        productTitle: record.productTitle,
        found: true,
      },
      record.qrPayload,
      printedAtEst,
      record.sn ?? generateSn()
    );
  };

  const scaleStatus =
    scale.state === 'receiving' || scale.state === 'processing'
      ? 'busy'
      : scale.state === 'connected'
      ? 'ok'
      : 'off';
  const canPrint = !!currentItem;

  return (
    <main className="min-h-screen bg-slate-950 pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors flex-shrink-0"
          aria-label="Back to home"
        >
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-100 leading-tight">Scale &amp; Print</h1>
          <p className="text-xs text-slate-500 leading-tight">Scale-to-printer label generation</p>
        </div>
        {/* Live status chips */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <StatusDot status={scaleStatus} />
            <span className="text-xs text-slate-400 font-medium">Scale</span>
          </div>
          <button
            onClick={() => router.push('/scale/products')}
            aria-label="Manage products"
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-4">
        {/* Scale monitor card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-1 flex items-center gap-2">
            <span className="w-1 h-4 bg-blue-500 rounded-full" />
            <h2 className="text-sm font-semibold text-slate-200">Scale Monitor</h2>
          </div>
          <ScaleMonitor
            state={scale.state}
            chunkCount={scale.chunkCount}
            error={scale.error}
          />
        </div>

        {/* Label preview card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 bg-emerald-500 rounded-full" />
              <h2 className="text-sm font-semibold text-slate-200">Label Preview</h2>
            </div>
            {currentItem && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {printedAt ? 'Printed' : 'Ready'}
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <LabelPreview item={currentItem} lookupLoading={lookupLoading} />

            {currentItem && (
              <>
                <div className="border-t border-slate-800 my-4" />

                {/* Feedback banners */}
                {printedAt && (
                  <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-900 rounded-xl px-3 py-2.5 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-300 font-medium">
                      Sent to print dialog at {formatEst(printedAt)} EST
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleManualPrint}
                    disabled={!canPrint}
                    className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                  >
                    <Printer className="w-4 h-4" />
                    {printedAt ? 'Print Again' : 'Print Label'}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentItem(null);
                      setPrintedAt(null);
                    }}
                    className="w-full h-10 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 transition-all active:scale-[0.98]"
                  >
                    <ScanLine className="w-4 h-4" /> New Scan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Device setup */}
        <DeviceSetup
          scaleState={scale.state}
          scaleError={scale.error}
          onConnectScale={scale.connect}
          onDisconnectScale={scale.disconnect}
        />

        {/* Print history */}
        <PrintHistory
          records={printHistory}
          loading={historyLoading}
          canPrint={true}
          onReprint={handleReprint}
        />
      </div>

      {/* Print-only label — visibility:hidden keeps DOM in flow so visibility:visible on this works */}
      {printPayload && (
        <div id="print-label" aria-hidden="true">
          <div className="print-label-inner">
            <div className="print-label-text">
              <p className="print-label-product">{printPayload.productTitle}</p>
              <p className="print-label-line"><span className="print-label-field">Weight:</span> {printPayload.itemWeight}</p>
              <p className="print-label-line"><span className="print-label-field">Packing Date:</span> {printPayload.printedAtEst}</p>
              <p className="print-label-line print-label-sn"><span className="print-label-field">SN:</span> {printPayload.sn}</p>
            </div>
            <div className="print-label-qr">
              <QRCodeSVG value={printPayload.qrPayload} size={256} level="M" bgColor="#ffffff" fgColor="#000000" />
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        #print-label {
          display: none;
        }
        @media print {
          @page {
            size: 1.25in 2.25in;
            margin: 0;
          }
          #print-label {
            display: block;
            position: fixed;
            top: 0;
            left: 0;
            width: 1.25in;
            height: 2.25in;
            overflow: hidden;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-label-inner {
            width: 1.25in;
            height: 2.25in;
            box-sizing: border-box;
            padding: 0.12in 0.1in;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 0.1in;
            background: #fff;
          }
          .print-label-text {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 0.03in;
          }
          .print-label-product {
            font-size: 8pt;
            font-weight: 700;
            line-height: 1.2;
            margin: 0 0 0.04in 0;
            color: #000;
            word-break: break-word;
          }
          .print-label-line {
            font-size: 7pt;
            line-height: 1.3;
            margin: 0;
            color: #000;
          }
          .print-label-field {
            font-weight: 700;
            color: #000;
          }
          .print-label-sn {
            font-family: monospace;
            color: #000;
          }
          .print-label-qr {
            display: flex;
            justify-content: center;
            width: 100%;
          }
          .print-label-qr svg {
            width: 0.85in !important;
            height: 0.85in !important;
          }
        }
      `}</style>
    </main>
  );
}
