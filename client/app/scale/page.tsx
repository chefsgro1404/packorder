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
  AlertCircle,
  Plug,
  PlugZap,
  Scale,
  ChevronDown,
  ChevronUp,
  Package,
  Copy,
  Check,
  History,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useScale, type ParsedReading } from '@/hooks/useScale';
import { usePrinter } from '@/hooks/usePrinter';

interface PrintRecord {
  id: string;
  itemName: string;
  itemWeight: string;
  qrPayload: string;
  printedAt: Date;
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
  reading,
  isPrinting,
}: {
  reading: ParsedReading | null;
  isPrinting: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!reading) return;
    await navigator.clipboard.writeText(reading.qrPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!reading) {
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
      {/* 57×38mm label preview */}
      <div className="mx-auto w-full max-w-[260px]">
        <div
          className={`relative bg-white rounded-xl overflow-hidden shadow-lg transition-all duration-300 ${
            isPrinting ? 'ring-2 ring-blue-500 shadow-blue-900/40' : 'ring-1 ring-slate-700'
          }`}
          style={{ aspectRatio: '57/38' }}
        >
          <div className="absolute inset-0 flex items-center justify-between px-3 py-2.5">
            <div className="flex flex-col justify-between h-full py-0.5 flex-1 pr-2">
              <div>
                <p className="text-[7px] font-semibold text-slate-400 uppercase tracking-widest">Item</p>
                <p className="text-sm font-bold text-slate-900 leading-tight">{reading.itemName}</p>
              </div>
              <div>
                <p className="text-[7px] font-semibold text-slate-400 uppercase tracking-widest">Weight</p>
                <p className="text-xs font-semibold text-slate-800">{reading.itemWeight}</p>
              </div>
              <p className="text-[6px] text-slate-400 font-mono">ChefsRHere</p>
            </div>
            <div className="flex-shrink-0 bg-white p-0.5 rounded border border-slate-200">
              <QRCodeSVG
                value={reading.qrPayload}
                size={60}
                level="M"
                bgColor="#ffffff"
                fgColor="#0f172a"
              />
            </div>
          </div>
          {isPrinting && (
            <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center">
              <span className="bg-white/95 rounded-lg px-2.5 py-1 text-xs font-semibold text-blue-600 border border-blue-200">
                Printing…
              </span>
            </div>
          )}
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-1.5">57 mm × 38 mm · Godex DT2x</p>
      </div>

      {/* QR payload row */}
      <div className="flex items-center justify-between gap-2 bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-800">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">QR Payload</p>
          <p className="text-xs font-mono text-slate-300 truncate mt-0.5">{reading.qrPayload}</p>
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

      <p className="text-center text-xs text-slate-600">
        Scanned at {reading.timestamp.toLocaleTimeString()}
      </p>
    </div>
  );
}

// ─── Device setup panel ──────────────────────────────────────────────────────

function DeviceSetup({
  scaleState,
  printerState,
  scaleError,
  printerError,
  onConnectScale,
  onDisconnectScale,
  onConnectPrinter,
  onDisconnectPrinter,
}: {
  scaleState: string;
  printerState: string;
  scaleError: string | null;
  printerError: string | null;
  onConnectScale: () => void;
  onDisconnectScale: () => void;
  onConnectPrinter: () => void;
  onDisconnectPrinter: () => void;
}) {
  const bothConnected =
    scaleState !== 'disconnected' && printerState !== 'disconnected';
  const [open, setOpen] = useState(!bothConnected);
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
            {bothConnected ? '— both connected' : '— action needed'}
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

          <div className="border-t border-slate-800" />

          {/* Printer row */}
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                printerState !== 'disconnected'
                  ? 'bg-emerald-950/60 text-emerald-400'
                  : 'bg-slate-900 text-slate-500'
              }`}
            >
              <Printer className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-200">Godex DT2x</p>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    printerState !== 'disconnected'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-900'
                      : 'bg-slate-900 text-slate-500 border border-slate-800'
                  }`}
                >
                  {printerState !== 'disconnected' ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <p className="text-xs text-slate-600">57 mm × 38 mm · EZPL</p>
              {printerError && (
                <p className="text-xs text-rose-400 mt-0.5">{printerError}</p>
              )}
            </div>
            {printerState !== 'disconnected' ? (
              <button
                onClick={onDisconnectPrinter}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-400 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-rose-950/30"
              >
                <PlugZap className="w-3 h-3" /> Disconnect
              </button>
            ) : (
              <button
                onClick={onConnectPrinter}
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
  canPrint,
  onReprint,
}: {
  records: PrintRecord[];
  canPrint: boolean;
  onReprint: (r: PrintRecord) => void;
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
            <span className="text-xs text-slate-500">— {records.length} this session</span>
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
          {records.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <History className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No prints yet this session</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
              {records.map((r) => (
                <div
                  key={r.id}
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
                    <p className="text-sm font-medium text-slate-200 truncate">{r.itemName}</p>
                    <p className="text-xs text-slate-500">
                      {r.itemWeight} · {r.printedAt.toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    disabled={!canPrint}
                    onClick={() => onReprint(r)}
                    aria-label={`Reprint ${r.itemName}`}
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
  const [printHistory, setPrintHistory] = useState<PrintRecord[]>([]);
  const [currentReading, setCurrentReading] = useState<ParsedReading | null>(null);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  const printer = usePrinter();

  const handleReading = useCallback(
    async (reading: ParsedReading) => {
      setCurrentReading(reading);
      setPrintedAt(null);

      if (printer.state === 'connected') {
        await printer.print(reading.itemName, reading.itemWeight);
        const now = new Date();
        setPrintedAt(now);
        setPrintHistory((prev) => [
          {
            id: crypto.randomUUID(),
            itemName: reading.itemName,
            itemWeight: reading.itemWeight,
            qrPayload: reading.qrPayload,
            printedAt: now,
          },
          ...prev.slice(0, 9),
        ]);
      }
    },
    [printer]
  );

  const scale = useScale(handleReading);

  useEffect(() => {
    scale.autoConnect();
    printer.autoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualPrint = async () => {
    if (!currentReading) return;
    await printer.print(currentReading.itemName, currentReading.itemWeight);
    const now = new Date();
    setPrintedAt(now);
    setPrintHistory((prev) => [
      {
        id: crypto.randomUUID(),
        itemName: currentReading.itemName,
        itemWeight: currentReading.itemWeight,
        qrPayload: currentReading.qrPayload,
        printedAt: now,
      },
      ...prev.slice(0, 9),
    ]);
  };

  const handleReprint = async (record: PrintRecord) => {
    await printer.print(record.itemName, record.itemWeight);
    setPrintHistory((prev) => [
      { ...record, id: crypto.randomUUID(), printedAt: new Date() },
      ...prev.slice(0, 9),
    ]);
  };

  const scaleStatus =
    scale.state === 'receiving' || scale.state === 'processing'
      ? 'busy'
      : scale.state === 'connected'
      ? 'ok'
      : 'off';
  const printerStatus =
    printer.state === 'printing' ? 'busy' : printer.state === 'connected' ? 'ok' : 'off';
  const isPrinting = printer.state === 'printing';
  const canPrint = !!currentReading && printer.state === 'connected';

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
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <StatusDot status={printerStatus} />
            <span className="text-xs text-slate-400 font-medium">Print</span>
          </div>
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
            {currentReading && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {isPrinting ? 'Printing…' : printedAt ? 'Printed' : 'Ready'}
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <LabelPreview reading={currentReading} isPrinting={isPrinting} />

            {currentReading && (
              <>
                <div className="border-t border-slate-800 my-4" />

                {/* Feedback banners */}
                {printedAt && !isPrinting && (
                  <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-900 rounded-xl px-3 py-2.5 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-300 font-medium">
                      Printed at {printedAt.toLocaleTimeString()}
                    </p>
                  </div>
                )}
                {printer.error && (
                  <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2.5 mb-3">
                    <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <p className="text-sm text-rose-300">{printer.error}</p>
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
                    {isPrinting ? 'Printing…' : printedAt ? 'Print Again' : 'Print Label'}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentReading(null);
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
          printerState={printer.state}
          scaleError={scale.error}
          printerError={printer.error}
          onConnectScale={scale.connect}
          onDisconnectScale={scale.disconnect}
          onConnectPrinter={printer.connect}
          onDisconnectPrinter={printer.disconnect}
        />

        {/* Print history */}
        <PrintHistory
          records={printHistory}
          canPrint={printer.state === 'connected'}
          onReprint={handleReprint}
        />
      </div>
    </main>
  );
}
