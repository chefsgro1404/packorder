'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  ListFilter,
  Bug,
  Settings,
  ClipboardList,
  Tag,
  X,
  Droplets,
  Zap,
  QrCode,
  ArrowRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useScale, type ParsedReading } from '@/hooks/useScale';
import { usePrintLabel } from '@/hooks/usePrintLabel';
import { PrintLabelPortal, type PrintPayload } from '@/components/PrintLabelPortal';
import { UnmappedItemModal } from '@/components/UnmappedItemModal';
import { generateSn, buildQrPayload } from '@/lib/scaleLabel';
import { encryptQrPayload, isEncryptedQr, decryptQrPayload } from '@/lib/qrEncryption';
import { fetchNextSn } from '@/lib/snBuilder';
import { formatEst } from '@/lib/dateFormat';
import { PrintedLabel, TextMapping, PurchaseOrder, PurchaseOrderLineItem, InventoryMappingInfo, PrintJob, PrintJobPayload, TransformationOption, WeightRangeRule } from '@/lib/types';
import { matchWeightRange, parseWeightToLbs } from '@/lib/weightCategory';
import { BulkPrintModal } from '@/components/BulkPrintModal';
import { BulkSessionHistoryPanel } from '@/components/BulkSessionHistoryPanel';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { ManualTransformModal } from '@/components/ManualTransformModal';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { usePrintQueue } from '@/hooks/usePrintQueue';
import { applyMappings } from '@/lib/textMappings';
import { LABEL_SIZE_OPTIONS, LABEL_SIZE_STORAGE_KEY, getLabelConfig, type LabelSizeKey } from '@/lib/labelSizes';

interface CurrentItem {
  itemNumber: string;
  itemName: string;
  itemWeight: string;
  plu: string;
  productTitle: string;
  variantTitle?: string | null;
  variantId?: string | null;
  found: boolean;
  // PO context — set when item was selected from a PO suggestion
  poId?: string | null;
  poLineItemId?: string | null;
  poQuantityOrdered?: number;
  vendorName?: string | null;
}

function isPlaceholderItemNumber(itemNumber: string): boolean {
  const trimmed = itemNumber.trim();
  return trimmed === '' || /^0+$/.test(trimmed);
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
  labelSizeKey,
  textMappings,
}: {
  item: CurrentItem | null;
  lookupLoading: boolean;
  labelSizeKey: LabelSizeKey;
  textMappings: TextMapping[];
}) {
  const [copied, setCopied] = useState(false);
  const cfg = getLabelConfig(labelSizeKey);
  const sizeLabel = LABEL_SIZE_OPTIONS.find(o => o.key === labelSizeKey)?.label ?? labelSizeKey;

  const mappedProductTitle = item ? applyMappings(item.productTitle, textMappings) : '';
  const mappedVariantTitle = item?.variantTitle ? applyMappings(item.variantTitle, textMappings) : item?.variantTitle;

  const previewQrPayload = item
    ? buildQrPayload({ plu: item.found ? item.plu : null, productTitle: mappedProductTitle, variantTitle: mappedVariantTitle, itemWeight: item.itemWeight }, 'preview')
    : '';

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

  const isRow = cfg.layout === 'row';
  const maxW = isRow ? Math.round(cfg.pageW * 90) : Math.round(cfg.pageW * 80);

  return (
    <div className="flex flex-col gap-4">
      {!item.found && (
        <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-900 rounded-xl px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-300">
            Item {item.itemNumber} isn&apos;t mapped. Printed with a placeholder PLU — map it under Select Product, or open that product directly next time to print from there.
          </p>
        </div>
      )}

      {/* Label preview — aspect ratio and layout driven by selected size */}
      <div className="mx-auto w-full" style={{ maxWidth: `${maxW}px` }}>
        <div
          className="relative bg-white rounded-xl overflow-hidden shadow-lg ring-1 ring-slate-700"
          style={{ aspectRatio: `${cfg.pageW}/${cfg.pageH}` }}
        >
          <div className={`absolute inset-0 flex ${isRow ? 'flex-row items-center' : 'items-center justify-center'}`}>
            {isRow ? (
              /* Row: text left, QR right */
              <>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5 px-2 py-1.5">
                  <p className="font-bold text-slate-900 leading-tight line-clamp-2 break-words w-full" style={{ fontSize: `${cfg.titlePt * 0.72}px` }}>{mappedProductTitle}</p>
                  {mappedVariantTitle && mappedVariantTitle !== 'Default Title' && (
                    <p className="font-semibold text-slate-600 leading-tight line-clamp-2 break-words w-full" style={{ fontSize: `${cfg.linePt * 0.72}px` }}>{mappedVariantTitle}</p>
                  )}
                  <p className="text-slate-700 leading-tight" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold">Weight:</span> {item.itemWeight}</p>
                  {/* <p className="text-slate-700 leading-tight" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold">Packing Date:</span> {formatEst(new Date())}</p> */}
                  <p className="text-slate-500 leading-tight font-mono" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold not-italic">SN:</span> preview</p>
                </div>
                <div className="flex-shrink-0 px-1.5">
                  <QRCodeSVG value="PREVIEW" size={Math.round(cfg.qrIn * 60)} level="M" bgColor="#ffffff" fgColor="#0f172a" />
                </div>
              </>
            ) : (
              /* Col-center: text top, QR bottom */
              <div className="w-[66.6%] flex flex-col items-start gap-1 px-2 py-2">
                <p className="font-bold text-slate-900 leading-tight line-clamp-2 break-words w-full" style={{ fontSize: `${cfg.titlePt * 0.72}px` }}>{mappedProductTitle}</p>
                {mappedVariantTitle && mappedVariantTitle !== 'Default Title' && (
                  <p className="font-semibold text-slate-600 leading-tight line-clamp-2 break-words w-full" style={{ fontSize: `${cfg.linePt * 0.72}px` }}>{mappedVariantTitle}</p>
                )}
                <p className="text-slate-700 leading-tight" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold">Weight:</span> {item.itemWeight}</p>
                {/* <p className="text-slate-700 leading-tight" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold">Packing Date:</span> {formatEst(new Date())}</p> */}
                <p className="text-slate-500 leading-tight font-mono" style={{ fontSize: `${cfg.linePt * 0.72}px` }}><span className="font-bold not-italic">SN:</span> preview</p>
                <div className="flex justify-center w-full mt-0.5">
                  <QRCodeSVG value="PREVIEW" size={Math.round(cfg.qrIn * 60)} level="M" bgColor="#ffffff" fgColor="#0f172a" />
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-1.5">{sizeLabel} · Godex DT2x</p>
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
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">QR Payload — unencrypted format (printed QR will be encrypted)</p>
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
  isPrinterDevice,
  onTogglePrinterDevice,
}: {
  scaleState: string;
  scaleError: string | null;
  onConnectScale: () => void;
  onDisconnectScale: () => void;
  isPrinterDevice: boolean;
  onTogglePrinterDevice: (enabled: boolean) => void;
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

          {/* Printer device toggle */}
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isPrinterDevice ? 'bg-violet-950/60 text-violet-400' : 'bg-slate-900 text-slate-500'
            }`}>
              <Printer className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-slate-200">Printer Device</p>
                {isPrinterDevice && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-950 text-violet-400 border border-violet-900">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                {isPrinterDevice
                  ? 'This device will claim and execute remote print jobs'
                  : 'Enable to receive prints from other devices on this account'}
              </p>
            </div>
            <button
              onClick={() => onTogglePrinterDevice(!isPrinterDevice)}
              className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors ${
                isPrinterDevice
                  ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-950/30'
                  : 'text-slate-900 bg-slate-100 hover:bg-white'
              }`}
            >
              {isPrinterDevice ? 'Disable' : 'Enable'}
            </button>
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

// ─── PO status badge ─────────────────────────────────────────────────────────

function PoStatusBadge({ status }: { status: string }) {
  if (status === 'approved')
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-emerald-950 text-emerald-400 border border-emerald-900">Approved</span>;
  if (status === 'partial')
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-950 text-amber-400 border border-amber-900">Partial</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-slate-800 text-slate-400 border border-slate-700">Pending</span>;
}

// ─── PO suggestions panel ────────────────────────────────────────────────────

function PoSuggestions({
  orders,
  loading,
  error,
  lineItemsCache,
  expandedPoId,
  onToggleExpand,
  onSelectItem,
}: {
  orders: PurchaseOrder[];
  loading: boolean;
  error: string | null;
  lineItemsCache: Record<string, PurchaseOrderLineItem[]>;
  expandedPoId: string | null;
  onToggleExpand: (id: string) => void;
  onSelectItem: (po: PurchaseOrder, li: PurchaseOrderLineItem) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(true);

  const pendingCount = orders.reduce((acc, o) => {
    const items = lineItemsCache[o.id] ?? [];
    return acc + items.filter(li => li.status !== 'approved').length;
  }, 0);

  return (
    <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
      <button
        className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
        onClick={() => setPanelOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">PO Suggestions</span>
          {pendingCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-blue-900 text-blue-300 border border-blue-800">
              {pendingCount} pending
            </span>
          )}
        </div>
        {panelOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {panelOpen && (
        <div className="border-t border-slate-800">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-5 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading open POs…</span>
            </div>
          ) : error ? (
            <p className="px-4 py-4 text-sm text-rose-400">{error}</p>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ClipboardList className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No open purchase orders</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60 max-h-72 overflow-y-auto lg:max-h-none">
              {orders.map(po => {
                const isExpanded = expandedPoId === po.id;
                const items = lineItemsCache[po.id] ?? [];
                const pendingItems = items.filter(li => li.status !== 'approved');
                const approvedItems = items.filter(li => li.status === 'approved');

                return (
                  <div key={po.id}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-900/40 transition-colors text-left"
                      onClick={() => onToggleExpand(po.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-200">{po.poName}</span>
                          {po.vendor && <span className="text-xs text-slate-500">{po.vendor}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
                            po.status === 'partial'
                              ? 'bg-amber-950 text-amber-400 border-amber-900'
                              : 'bg-blue-950 text-blue-400 border-blue-900'
                          }`}>{po.status}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {po.approvedLineItems}/{po.totalLineItems} items received
                        </p>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                    </button>

                    {isExpanded && items.length === 0 && (
                      <div className="px-4 pb-3">
                        <p className="text-xs text-slate-500">No line items loaded — tap to expand</p>
                      </div>
                    )}

                    {isExpanded && items.length > 0 && (
                      <div className="px-4 pb-3 flex flex-col gap-2">
                        {pendingItems.map(li => (
                          <button
                            key={li.id}
                            onClick={() => onSelectItem(po, li)}
                            className="flex items-start gap-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl px-3 py-2.5 text-left transition-colors active:scale-[0.99]"
                          >
                            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Tag className="w-3.5 h-3.5 text-slate-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-200 leading-snug">{li.productTitle}</p>
                                  {li.variantTitle && li.variantTitle !== 'Default Title' && (
                                    <p className="text-xs text-slate-400">{li.variantTitle}</p>
                                  )}
                                  {li.sku && <p className="text-xs text-slate-500 font-mono">SKU: {li.sku}</p>}
                                </div>
                                <PoStatusBadge status={li.status} />
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {li.quantityReceived}/{li.quantityOrdered} received
                              </p>
                            </div>
                          </button>
                        ))}
                        {approvedItems.length > 0 && (
                          <div className="flex flex-col gap-1.5">
                            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-0.5">Completed</p>
                            {approvedItems.map(li => (
                              <div
                                key={li.id}
                                className="flex items-center gap-3 bg-slate-900/40 border border-slate-800/50 rounded-xl px-3 py-2 opacity-50"
                              >
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-slate-400 leading-snug line-through">{li.productTitle}</p>
                                  <p className="text-xs text-slate-600">{li.quantityReceived}/{li.quantityOrdered} received</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
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

// ─── Bulk print label result ──────────────────────────────────────────────────

interface BulkPrintLabelResult {
  index: number;
  sn: string;
  qrPayload: string;
  printedAtEst: string;
  status: 'printed' | 'failed';
  error?: string;
}

function BulkPrintResultPanel({
  results,
  poQuantityOrdered,
  inventoryAdjusted,
  pendingPrintCount,
  pendingAdjustDelta,
  onReprint,
  onPrintAll,
  onConfirmAdjust,
  onDismiss,
}: {
  results: BulkPrintLabelResult[];
  poQuantityOrdered: number;
  inventoryAdjusted: number | null;
  pendingPrintCount: number;
  pendingAdjustDelta: number | null;
  onReprint: (r: BulkPrintLabelResult) => void;
  onPrintAll: () => void;
  onConfirmAdjust: () => void;
  onDismiss: () => void;
}) {
  const [applyAdjust, setApplyAdjust] = useState(false);
  const printed = results.filter(r => r.status === 'printed').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return (
    <div className="flex flex-col gap-2 bg-slate-900/80 border border-slate-700 rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {failed === 0 ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-slate-200">
            {printed}/{results.length} labels printed
            {poQuantityOrdered > printed && ` · ${poQuantityOrdered - printed} short vs PO`}
          </span>
        </div>
        <button
          onClick={() => { if (applyAdjust && pendingAdjustDelta !== null) onConfirmAdjust(); onDismiss(); }}
          className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {pendingPrintCount > 0 && (
        <button
          onClick={onPrintAll}
          className="w-full h-10 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
        >
          <Printer className="w-4 h-4" />
          Print {pendingPrintCount} label{pendingPrintCount !== 1 ? 's' : ''}
        </button>
      )}
      {pendingAdjustDelta !== null && (
        <label className="flex items-center gap-2.5 cursor-pointer select-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2">
          <input
            type="checkbox"
            checked={applyAdjust}
            onChange={e => setApplyAdjust(e.target.checked)}
            className="w-4 h-4 rounded accent-violet-500 flex-shrink-0 cursor-pointer"
          />
          <span className="text-xs text-slate-300">
            Adjust Shopify inventory by{' '}
            <span className={pendingAdjustDelta < 0 ? 'text-amber-300' : 'text-emerald-300'}>
              {pendingAdjustDelta > 0 ? `+${pendingAdjustDelta}` : pendingAdjustDelta}
            </span>
            {' '}({Math.abs(pendingAdjustDelta)}-unit {pendingAdjustDelta < 0 ? 'shortfall' : 'overage'})
          </span>
        </label>
      )}
      {inventoryAdjusted !== null && inventoryAdjusted < 0 && (
        <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/40 rounded-lg px-2.5 py-1.5">
          Shopify inventory adjusted by {inventoryAdjusted} for the {Math.abs(inventoryAdjusted)} unit shortfall
        </p>
      )}
      {inventoryAdjusted !== null && inventoryAdjusted > 0 && (
        <p className="text-xs text-violet-300 bg-violet-950/40 border border-violet-900/40 rounded-lg px-2.5 py-1.5">
          Shopify inventory adjusted by +{inventoryAdjusted} for the {inventoryAdjusted} unit overage
        </p>
      )}
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {results.map(r => (
          <div
            key={r.index}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${
              r.status === 'printed' ? 'bg-slate-800/60' : 'bg-rose-950/40 border border-rose-900/40'
            }`}
          >
            <span className={`text-[10px] font-bold w-5 text-center ${r.status === 'printed' ? 'text-slate-500' : 'text-rose-400'}`}>
              #{r.index}
            </span>
            <div className="flex-1 min-w-0">
              {r.status === 'printed' ? (
                <p className="text-xs text-slate-300 font-mono truncate">{r.sn}</p>
              ) : (
                <p className="text-xs text-rose-300">{r.error ?? 'Print failed'}</p>
              )}
            </div>
            <button
              onClick={() => onReprint(r)}
              className="flex-shrink-0 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reprint
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Transformation panel (two-panel FROM → TO) ────────────────────────────────

function TransformationPanel({
  options,
  currentItem,
  onSelect,
  onManualTransform,
}: {
  options: TransformationOption[];
  currentItem: CurrentItem;
  onSelect: (opt: TransformationOption) => void;
  onManualTransform?: () => void;
}) {
  const [toIdx, setToIdx] = useState(0);
  const toOpt = options.length > 0 ? options[Math.min(toIdx, options.length - 1)] : null;

  return (
    <div className="flex flex-col gap-2.5 bg-violet-950/30 border border-violet-900/50 rounded-xl px-3 py-3">
      <div className="flex items-center gap-1.5">
        <Droplets className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
        <p className="text-xs font-semibold text-violet-300">Transformation Ready</p>
      </div>

      <div className="flex items-stretch gap-2">
        {/* FROM panel */}
        <div className="flex-1 bg-violet-900/20 rounded-lg px-2.5 py-2 min-w-0">
          <p className="text-[10px] font-semibold text-violet-400/60 uppercase tracking-wider mb-1">Source</p>
          <p className="text-xs font-semibold text-violet-200 leading-tight truncate">{currentItem.productTitle}</p>
          {currentItem.plu && currentItem.plu !== 'N/A' && (
            <p className="text-[10px] text-violet-400/50 mt-0.5">{currentItem.plu}</p>
          )}
        </div>

        <div className="flex items-center text-violet-500 flex-shrink-0">
          <ArrowRight className="w-4 h-4" />
        </div>

        {/* TO panel */}
        <div className="flex-1 bg-violet-900/20 rounded-lg px-2.5 py-2 min-w-0">
          <p className="text-[10px] font-semibold text-violet-400/60 uppercase tracking-wider mb-1">Output</p>
          {toOpt ? (
            <>
              {options.length > 1 ? (
                <select
                  value={toIdx}
                  onChange={e => setToIdx(Number(e.target.value))}
                  className="w-full bg-transparent text-xs font-semibold text-violet-200 outline-none cursor-pointer leading-tight"
                >
                  {options.map((opt, i) => (
                    <option key={opt.variantId} value={i} className="bg-violet-950 text-violet-200">
                      {opt.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-semibold text-violet-200 leading-tight truncate">{toOpt.title}</p>
              )}
              {(toOpt.weightPerUnit ?? 0) > 0 && (
                <p className="text-[10px] text-violet-400/50 mt-0.5">
                  {toOpt.weightPerUnit} unit{(toOpt.weightPerUnit ?? 1) !== 1 ? 's' : ''} → 1 label
                </p>
              )}
            </>
          ) : (
            // No configured children — default to same product (A→A), allow searching
            <>
              <p className="text-xs font-semibold text-violet-200 leading-tight truncate">{currentItem.productTitle}</p>
              <p className="text-[10px] text-violet-400/50 mt-0.5">same product</p>
            </>
          )}
        </div>
      </div>

      {toOpt ? (
        <button
          onClick={() => onSelect(toOpt)}
          className="w-full text-xs font-semibold bg-violet-700/50 hover:bg-violet-600/60 active:bg-violet-600/80 text-violet-200 rounded-lg py-2 transition-colors"
        >
          Apply →
        </button>
      ) : (
        // A→A: open manual search so staff can confirm ratio or switch product
        <button
          onClick={onManualTransform}
          className="w-full text-xs font-semibold bg-violet-700/50 hover:bg-violet-600/60 active:bg-violet-600/80 text-violet-200 rounded-lg py-2 transition-colors"
        >
          Set ratio / change product →
        </button>
      )}

      {options.length > 0 && onManualTransform && (
        <button
          onClick={onManualTransform}
          className="w-full text-[11px] text-violet-500 hover:text-violet-300 transition-colors"
        >
          Use different product
        </button>
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
  const [debugOpen, setDebugOpen] = useState(false);
  const [devTapCount, setDevTapCount] = useState(0);
  const [devModeUnlocked, setDevModeUnlocked] = useState(false);
  const devTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unmappedPrompt, setUnmappedPrompt] = useState<{ itemNumber: string; weight: string } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [textMappings, setTextMappings] = useState<TextMapping[]>([]);
  const [manualWeight, setManualWeight] = useState('');
  const [inventoryMapping, setInventoryMapping] = useState<InventoryMappingInfo | null>(null);
  const [inventoryMappingOverride, setInventoryMappingOverride] = useState<InventoryMappingInfo | null>(null);
  const skipNextInventoryFetch = useRef(false);
  const [lastAdjustment, setLastAdjustment] = useState<{ delta: number; parentTitle: string } | null>(null);
  const [manualTransformModal, setManualTransformModal] = useState(false);
  const [remotePrintJob, setRemotePrintJob] = useState<PrintJob | null>(null);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [weightRanges, setWeightRanges] = useState<WeightRangeRule[]>([]);
  const [autoDetect, setAutoDetect] = useState<{ matched: WeightRangeRule | null; noMatch: boolean; weightLbs: number } | null>(null);
  const [bulkPrintModal, setBulkPrintModal] = useState<{ item: CurrentItem; po: PurchaseOrder; li: PurchaseOrderLineItem; isLotReceiving?: boolean } | null>(null);
  const [bulkPrintResults, setBulkPrintResults] = useState<BulkPrintLabelResult[] | null>(null);
  const [bulkInventoryAdjusted, setBulkInventoryAdjusted] = useState<number | null>(null);
  const [pendingBulkPayloads, setPendingBulkPayloads] = useState<PrintPayload[] | null>(null);
  const [pendingInventoryAdjust, setPendingInventoryAdjust] = useState<{ delta: number; inventoryItemId: string; locationId: string } | null>(null);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const [transformationOptions, setTransformationOptions] = useState<TransformationOption[] | null>(null);
  const [wasQrScanned, setWasQrScanned] = useState(false);
  const { isPrinterDevice, togglePrinterDevice, createJob, getJob, listQueuedJobs, claimJob, completeJob, failJob } = usePrintQueue();
  const { orders: poOrders, loading: poLoading, error: poError, fetchLineItems, refreshLineItems, approve: approvePoItem } = usePurchaseOrders();
  const [poLineItemsCache, setPoLineItemsCache] = useState<Record<string, PurchaseOrderLineItem[]>>({});
  const isPrinting = useRef(false);
  const [labelSizeKey, setLabelSizeKey] = useState<LabelSizeKey>(() => {
    if (typeof window === 'undefined') return '3x2';
    return (localStorage.getItem(LABEL_SIZE_STORAGE_KEY) as LabelSizeKey) ?? '3x2';
  });
  const { printPayload, batchPrintPayloads, printedAt, triggerPrint, printVerbatim, batchPrint, buildReprintSn, reset: resetPrinted } = usePrintLabel(labelSizeKey);

  const handleSizeChange = (key: LabelSizeKey) => {
    setLabelSizeKey(key);
    localStorage.setItem(LABEL_SIZE_STORAGE_KEY, key);
  };

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
        variantTitle: data.variantTitle && data.variantTitle !== 'Default Title' ? data.variantTitle : null,
        variantId: data.variantId ?? null,
        found: true,
      };
    } catch (err) {
      console.error('[scale] product lookup errored:', err);
      return fallback;
    }
  }, []);

  // Fetch inventory mapping whenever the selected variant changes
  useEffect(() => {
    const variantId = currentItem?.variantId;
    setLastAdjustment(null);
    if (!variantId) {
      setInventoryMapping(null);
      return;
    }
    // Skip fetch when a manual transform override was just set
    if (skipNextInventoryFetch.current) {
      skipNextInventoryFetch.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scale/inventory-mapping?variantId=${encodeURIComponent(variantId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setInventoryMapping(data ?? null);
      } catch {
        if (!cancelled) setInventoryMapping(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentItem?.variantId]);

  // Fetch transformation options (source → output) when variant changes.
  // After a QR scan, always show the panel (even with empty options) so staff
  // can search for an output product manually, including A→A transformations.
  useEffect(() => {
    const variantId = currentItem?.variantId;
    if (!variantId) { setTransformationOptions(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scale/transformation-options?variantId=${encodeURIComponent(variantId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          const opts = data?.options;
          if (Array.isArray(opts) && opts.length > 0) {
            // Only show after a QR scan — not when a PO item is selected
            setTransformationOptions(wasQrScanned ? opts : null);
          } else {
            // Keep panel visible after a QR scan even with no configured children
            setTransformationOptions(wasQrScanned ? [] : null);
          }
        }
      } catch {
        if (!cancelled) setTransformationOptions(wasQrScanned ? [] : null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentItem?.variantId, wasQrScanned]);

  // Reset auto-detect whenever the loaded variant changes (new product, transformation, clear)
  useEffect(() => {
    setAutoDetect(null);
  }, [currentItem?.variantId]);

  // Run auto-detection when weight is available and ranges are loaded
  useEffect(() => {
    if (weightRanges.length === 0 || !currentItem?.itemWeight) {
      if (weightRanges.length > 0 && !currentItem?.itemWeight) {
        // Product has ranges but no weight yet — wait
      }
      return;
    }
    const lbs = parseWeightToLbs(currentItem.itemWeight);
    if (lbs === null) return;
    const matched = matchWeightRange(weightRanges, lbs);
    setAutoDetect({ matched, noMatch: matched === null, weightLbs: lbs });
  }, [weightRanges, currentItem?.itemWeight]);

  // Poll status of an in-progress remote print job (non-printer device watching its queued job)
  useEffect(() => {
    if (!remotePrintJob) return;
    if (remotePrintJob.status === 'completed' || remotePrintJob.status === 'failed') return;
    const poll = setInterval(async () => {
      const fresh = await getJob(remotePrintJob.id);
      if (fresh) setRemotePrintJob(fresh);
    }, 2000);
    return () => clearInterval(poll);
  }, [remotePrintJob, getJob]);

  // Printer device background poll — claims and executes jobs from other devices
  useEffect(() => {
    if (!isPrinterDevice) return;
    const poll = setInterval(async () => {
      const jobs = await listQueuedJobs();
      for (const job of jobs) {
        const claimed = await claimJob(job.id);
        if (!claimed) continue;
        try {
          const payload = JSON.parse(job.payload) as PrintJobPayload;
          triggerPrint(
            {
              plu: payload.plu,
              productTitle: payload.productTitle,
              variantTitle: payload.variantTitle,
              itemWeight: payload.itemWeight,
            },
            payload.sn,
            payload.qrPayload
          );
          await completeJob(job.id);
        } catch (err) {
          console.error('[scale] remote job execution failed:', err);
          await failJob(job.id, err instanceof Error ? err.message : 'execution failed');
        }
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [isPrinterDevice, listQueuedJobs, claimJob, completeJob, failJob, triggerPrint]);

  const logPrintedLabel = useCallback(async (
    item: CurrentItem,
    qrPayload: string,
    printedAtEst: string,
    sn: string,
    mapping?: InventoryMappingInfo | null,
    skipPoApproval?: boolean,
    lotNo?: string | null,
    expiryDate?: string | null,
  ) => {
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
          variantId: item.variantId ?? null,
          poId: item.poId ?? null,
          poLineItemId: item.poLineItemId ?? null,
          vendorName: item.vendorName ?? null,
          lotNo: lotNo ?? null,
          expiryDate: expiryDate ?? null,
        }),
      });
      if (res.ok) {
        fetchHistory();
      } else {
        console.error('[scale] failed to log printed label:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[scale] failed to log printed label:', err, '| item:', item.itemNumber, '| qr:', qrPayload);
    }

    // Auto-approve PO line item if this print was for one (skipped during bulk print — approved in bulk after)
    if (!skipPoApproval && item.poId && item.poLineItemId) {
      try {
        await approvePoItem(item.poId, item.poLineItemId, 1);
        const fresh = await refreshLineItems(item.poId);
        setPoLineItemsCache(prev => ({ ...prev, [item.poId!]: fresh }));
      } catch (err) {
        console.error('[scale] PO approval failed:', err);
      }
    }

    // Adjust parent product inventory for wet/transformation products, then increase child inventory
    if (mapping?.found && mapping.parentInventoryId && mapping.parentLocationId) {
      const rawWeight = parseFloat(item.itemWeight?.replace(/[^0-9.]/g, '') ?? '0') || 0;
      let parentDelta = 0;
      let childDelta = 0;

      if (mapping.isWeighted) {
        // Weight-based: derive from measured weight
        if (rawWeight > 0 && mapping.weightPerUnit > 0) {
          const consumed = Math.round(rawWeight / mapping.weightPerUnit);
          parentDelta = -consumed;
          childDelta = consumed;
        }
      } else {
        // Count-based: per label, source decreases by weightPerUnit, output increases by 1
        parentDelta = -(mapping.weightPerUnit || mapping.parentUnits || 1);
        childDelta = 1;
      }

      if (parentDelta !== 0) {
        try {
          await fetch('/api/scale/inventory-adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inventoryItemId: mapping.parentInventoryId,
              locationId: mapping.parentLocationId,
              delta: parentDelta,
              reason: 'correction',
            }),
          });
          setLastAdjustment({ delta: parentDelta, parentTitle: mapping.parentProductTitle });
        } catch (err) {
          console.error('[scale] inventory adjustment failed:', err);
        }

        // Increase child (transformation output) inventory
        if (mapping.childInventoryItemId && childDelta > 0) {
          try {
            await fetch('/api/scale/inventory-adjust', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inventoryItemId: mapping.childInventoryItemId,
                locationId: mapping.parentLocationId,
                delta: childDelta,
                reason: 'correction',
              }),
            });
          } catch (err) {
            console.error('[scale] child inventory increase failed:', err);
          }
        }
      }
    }
  }, [fetchHistory, approvePoItem, refreshLineItems]);

  const handlePoToggle = useCallback(async (poId: string) => {
    setExpandedPoId(prev => (prev === poId ? null : poId));
    if (!poLineItemsCache[poId]) {
      const items = await fetchLineItems(poId);
      setPoLineItemsCache(prev => ({ ...prev, [poId]: items }));
    }
  }, [fetchLineItems, poLineItemsCache]);

  const handlePoItemSelect = useCallback(async (po: PurchaseOrder, li: PurchaseOrderLineItem) => {
    setLookupLoading(true);
    setBulkPrintResults(null);
    setBulkInventoryAdjusted(null);
    setPendingBulkPayloads(null);
    setPendingInventoryAdjust(null);
    setWeightRanges([]);
    setAutoDetect(null);

    let plu = '';
    let productTitle = li.productTitle;
    let variantTitle = li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null;
    let found = false;
    let isLotReceiving = false;
    let ranges: WeightRangeRule[] = [];

    // Try to find a mapped PLU and receiving mode for this variant
    if (li.variantId) {
      try {
        const numericVariantId = li.variantId.includes('/') ? li.variantId.split('/').pop() ?? '' : li.variantId;
        const res = await fetch(`/api/scale/products/by-variant?variantId=${encodeURIComponent(numericVariantId)}`);
        if (res.ok) {
          const data = await res.json();
          isLotReceiving = !!data?.isLotReceiving;
          ranges = Array.isArray(data?.weightRanges) ? data.weightRanges : [];
          if (data?.found) {
            plu = data.plu ?? '';
            productTitle = data.productTitle ?? li.productTitle;
            variantTitle = (data.variantTitle && data.variantTitle !== 'Default Title')
              ? data.variantTitle : variantTitle;
            found = true;
          }
        }
      } catch {
        // ignore lookup failure — still load item with PO title
      }
    }

    const resolvedItem: CurrentItem = {
      itemNumber: '',
      itemName: productTitle,
      itemWeight: '',
      plu,
      productTitle,
      variantTitle,
      variantId: li.variantId,
      found,
      poId: po.id,
      poLineItemId: li.id,
      poQuantityOrdered: li.quantityOrdered,
      vendorName: po.vendor ?? null,
    };

    // For categorical products (weight ranges), skip BulkPrintModal and enter per-item weighing mode
    if (ranges.length > 0 && !isLotReceiving) {
      setWeightRanges(ranges);
      setCurrentItem(resolvedItem);
      setLookupLoading(false);
      return;
    }

    setBulkPrintModal({ item: resolvedItem, po, li, isLotReceiving });
    setLookupLoading(false);
  }, []);

  const handleBulkPrint = useCallback(async (
    modalState: { item: CurrentItem; po: PurchaseOrder; li: PurchaseOrderLineItem },
    quantity: number,
    weight: string,
    lotNo: string,
    expiryDate: string,
    lotTotalWeightLbs?: number,
  ) => {
    const { item: baseItem, po, li } = modalState;
    const item = weight ? { ...baseItem, itemWeight: weight } : baseItem;

    setBulkPrintModal(null);
    resetPrinted();
    setCurrentItem(item);
    setBulkPrintResults([]);
    setBulkInventoryAdjusted(null);
    setPrintError(null);

    const mappedTitle   = applyMappings(item.productTitle, textMappings);
    const mappedVariant = item.variantTitle ? applyMappings(item.variantTitle, textMappings) : item.variantTitle;

    const results: BulkPrintLabelResult[] = [];
    const batchPayloads: PrintPayload[] = [];

    for (let i = 0; i < quantity; i++) {
      try {
        const sn = await fetchNextSn(item.variantId, item.found ? item.plu : null, mappedTitle, mappedVariant);
        const plainPayload = buildQrPayload({
          plu: item.found ? item.plu : null,
          productTitle: mappedTitle,
          variantTitle: mappedVariant,
          itemWeight: item.itemWeight,
        }, sn);

        let encryptedPayload: string;
        try {
          encryptedPayload = await encryptQrPayload(plainPayload);
        } catch {
          results.push({ index: i + 1, sn, qrPayload: '', printedAtEst: '', status: 'failed', error: 'Encryption failed' });
          setBulkPrintResults([...results]);
          continue;
        }

        const printedAtEst = formatEst(new Date());
        if (isPrinterDevice) {
          // Collect for a single batch-print popup after the loop instead of opening one popup per label
          batchPayloads.push({ productTitle: mappedTitle, variantTitle: mappedVariant ?? null, qrPayload: encryptedPayload, itemWeight: item.itemWeight, printedAtEst, sn });
        } else {
          await createJob({ plu: item.found ? item.plu : null, productTitle: mappedTitle, variantTitle: mappedVariant ?? null, itemWeight: item.itemWeight, qrPayload: encryptedPayload, sn, labelSizeKey, printedAtEst }, 'label');
        }
        // Log each label; skip PO approval (done once after the full batch)
        await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, null, true, lotNo || null, expiryDate || null);
        results.push({ index: i + 1, sn, qrPayload: encryptedPayload, printedAtEst, status: 'printed' });
      } catch (err) {
        results.push({ index: i + 1, sn: '', qrPayload: '', printedAtEst: '', status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
      }
      setBulkPrintResults([...results]);
    }

    // Store payloads for the user to trigger printing with a button click.
    // window.open is popup-blocked after long async work, so printing must
    // happen from a fresh gesture — the "Print X labels" button provides that.
    if (batchPayloads.length > 0) {
      setPendingBulkPayloads(batchPayloads);
    }

    // Approve PO line item: weight-based (lot) uses total lbs, count-based uses printed count.
    // forceApprove=true so a short session (e.g. 13/15) is marked approved, not partial.
    const printedCount = results.filter(r => r.status === 'printed').length;
    const approvalQty = lotTotalWeightLbs !== undefined ? lotTotalWeightLbs : printedCount;
    if (printedCount > 0) {
      try {
        await approvePoItem(po.id, li.id, approvalQty, true);
        const fresh = await refreshLineItems(po.id);
        setPoLineItemsCache(prev => ({ ...prev, [po.id]: fresh }));
      } catch (err) {
        console.error('[scale] PO bulk approval failed:', err);
      }
    }

    // Shopify inventory adjustment: prompt the user when received ≠ ordered.
    // count-based only — lot/weight products have no unit qty to correct.
    const qtyDelta = li.quantityOrdered - printedCount; // positive = short, negative = over
    if (qtyDelta !== 0 && item.variantId && lotTotalWeightLbs === undefined) {
      try {
        const invRes = await fetch(`/api/scale/variant-inventory?variantId=${encodeURIComponent(item.variantId)}`);
        if (invRes.ok) {
          const invData = await invRes.json();
          const { inventoryItemId, locationId: rawLocationId } = invData.data ?? {};
          const locationId = rawLocationId || 'gid://shopify/Location/82125062435';
          console.log('[scale] inventory lookup:', { inventoryItemId, locationId, qtyDelta });
          if (inventoryItemId) {
            // Store pending — user must confirm before Shopify is touched
            setPendingInventoryAdjust({ delta: -qtyDelta, inventoryItemId, locationId });
          }
        }
      } catch (err) {
        console.error('[scale] PO inventory lookup failed:', err);
      }
    }

    // Save bulk session history
    if (printedCount > 0) {
      try {
        const sessionDateEst = formatEst(new Date());
        await fetch('/api/scale/bulk-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            poId: item.poId ?? null,
            poLineItemId: item.poLineItemId ?? null,
            vendorName: item.vendorName ?? null,
            lotNo: lotNo || null,
            expiryDate: expiryDate || null,
            quantityOrdered: li.quantityOrdered,
            quantityPrinted: printedCount,
            results: results.map(r => ({
              index: r.index,
              sn: r.sn,
              qrPayload: r.qrPayload,
              printedAtEst: r.printedAtEst,
              status: r.status,
              error: r.error ?? null,
            })),
            sessionDateEst,
          }),
        });
      } catch (err) {
        console.error('[scale] failed to save bulk session:', err);
      }
    }
  }, [textMappings, isPrinterDevice, batchPrint, createJob, logPrintedLabel, approvePoItem, refreshLineItems, labelSizeKey, resetPrinted]);

  const handleTransformationSelect = useCallback((opt: TransformationOption) => {
    if (!currentItem) return;

    const DEFAULT_LOCATION = 'gid://shopify/Location/82125062435';
    const locId = opt.locationId || DEFAULT_LOCATION;

    // Build an inventory mapping override from the child option's metafield data.
    // The parent's inventoryItemId, isWeighted, and weightPerUnit all come from
    // the child variant's metafield (returned by the transformation-options endpoint).
    // We must capture this now — once currentItem.variantId switches to the child,
    // the inventory-mapping effect would re-fetch for the child (which has no parent
    // metafield) and overwrite inventoryMapping with { found: false }.
    const override: InventoryMappingInfo = {
      found: true,
      isWeighted: opt.isWeighted ?? false,
      weightPerUnit: opt.weightPerUnit ?? 0,
      parentInventoryId: opt.parentInventoryItemId || '',
      parentProductHandle: '',
      parentProductTitle: currentItem.productTitle,
      parentLocationId: locId,
      childInventoryItemId: opt.inventoryItemId || '',
      parentUnits: opt.parentUnits ?? 1,
      childUnits: opt.childUnits ?? 1,
    };

    skipNextInventoryFetch.current = true;
    setWasQrScanned(false);  // transformation applied — suppress panel re-appearing for the output product
    setInventoryMappingOverride(override);
    setInventoryMapping(override);
    setCurrentItem({
      ...currentItem,
      variantId: opt.variantId,
      variantTitle: opt.title !== 'Default Title' ? opt.title : null,
    });
    setTransformationOptions(null);
    resetPrinted();
  }, [currentItem, resetPrinted]);

  const handleManualTransformConfirm = useCallback(async (
    childVariant: { variantId: string; productTitle: string; variantTitle: string | null; inventoryItemId: string },
    parentUnits: number,
    childUnits: number,
  ) => {
    if (!currentItem?.variantId) return;
    setManualTransformModal(false);

    // Resolve parent and child inventory concurrently
    const toNumeric = (id: string) => id.includes('/') ? id.split('/').pop() ?? id : id;
    const [parentInv, childInv] = await Promise.allSettled([
      fetch(`/api/scale/variant-inventory?variantId=${encodeURIComponent(toNumeric(currentItem.variantId))}`).then(r => r.ok ? r.json() : null),
      childVariant.variantId
        ? fetch(`/api/scale/variant-inventory?variantId=${encodeURIComponent(toNumeric(childVariant.variantId))}`).then(r => r.ok ? r.json() : null)
        : Promise.resolve(null),
    ]);
    const parentData = parentInv.status === 'fulfilled' ? parentInv.value : null;
    const childData  = childInv.status === 'fulfilled'  ? childInv.value  : null;

    const override: InventoryMappingInfo = {
      found: true,
      isWeighted: false,
      weightPerUnit: 0,
      parentInventoryId:    parentData?.data?.inventoryItemId ?? '',
      parentProductHandle:  '',
      parentProductTitle:   currentItem.productTitle,
      parentLocationId:     parentData?.data?.locationId || 'gid://shopify/Location/82125062435',
      childInventoryItemId: childData?.data?.inventoryItemId || childVariant.inventoryItemId || '',
      parentUnits,
      childUnits,
    };

    skipNextInventoryFetch.current = true;
    setWasQrScanned(false);
    setInventoryMappingOverride(override);
    setInventoryMapping(override);
    setCurrentItem({
      ...currentItem,
      variantId: childVariant.variantId,
      productTitle: childVariant.productTitle,
      variantTitle: childVariant.variantTitle,
      itemName: childVariant.productTitle,
      found: true,
    });
    setTransformationOptions(null);
    resetPrinted();
  }, [currentItem, resetPrinted]);

  const handleBulkReprint = useCallback((r: BulkPrintLabelResult) => {
    if (!currentItem) return;
    const reprintSn = buildReprintSn(r.sn || generateSn());
    const printedAtEst = formatEst(new Date());
    if (!r.qrPayload) return;
    let newQrPayload: string;
    if (isEncryptedQr(r.qrPayload)) {
      // Reuse the existing encrypted payload for simplicity (same SN swap approach as handleReprint)
      // Async decrypt/re-encrypt is avoided here — just use the existing payload as-is
      newQrPayload = r.qrPayload;
    } else {
      newQrPayload = r.qrPayload;
    }
    printVerbatim({ productTitle: currentItem.productTitle, variantTitle: currentItem.variantTitle ?? null, qrPayload: newQrPayload, itemWeight: currentItem.itemWeight, printedAtEst, sn: reprintSn });
  }, [currentItem, buildReprintSn, printVerbatim]);

  const printItem = useCallback(async (item: CurrentItem, { forceDialog = false }: { forceDialog?: boolean } = {}) => {
    if (isPrinting.current) return;
    isPrinting.current = true;
    setPrintError(null);
    try {
      const mappedTitle   = applyMappings(item.productTitle, textMappings);
      const mappedVariant = item.variantTitle ? applyMappings(item.variantTitle, textMappings) : item.variantTitle;
      const sn = await fetchNextSn(item.variantId, item.found ? item.plu : null, mappedTitle, mappedVariant);
      const plainPayload = buildQrPayload({
        plu: item.found ? item.plu : null,
        productTitle: mappedTitle,
        variantTitle: mappedVariant,
        itemWeight: item.itemWeight,
      }, sn);
      let encryptedPayload: string;
      try {
        encryptedPayload = await encryptQrPayload(plainPayload);
      } catch {
        setPrintError('Encryption failed — label not printed. Check your connection and try again.');
        return;
      }

      const effectiveMapping = inventoryMappingOverride ?? inventoryMapping;
      if (isPrinterDevice || forceDialog) {
        const { printedAtEst } = triggerPrint({
          plu: item.found ? item.plu : null,
          productTitle: mappedTitle,
          variantTitle: mappedVariant,
          itemWeight: item.itemWeight,
        }, sn, encryptedPayload);
        await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, effectiveMapping);
      } else {
        const printedAtEst = formatEst(new Date());
        const jobPayload: PrintJobPayload = {
          plu: item.found ? item.plu : null,
          productTitle: mappedTitle,
          variantTitle: mappedVariant ?? null,
          itemWeight: item.itemWeight,
          qrPayload: encryptedPayload,
          sn,
          labelSizeKey,
          printedAtEst,
        };
        const job = await createJob(jobPayload, 'label');
        if (job) {
          setRemotePrintJob(job);
          await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, effectiveMapping);
        } else {
          setPrintError('Failed to queue print job — check your connection and try again.');
        }
      }
    } finally {
      isPrinting.current = false;
    }
  }, [triggerPrint, logPrintedLabel, textMappings, inventoryMapping, inventoryMappingOverride, isPrinterDevice, createJob, labelSizeKey]);

  const handleReading = useCallback(
    async (reading: ParsedReading) => {
      // Item 0 (or 00, 000 …) means "same product, new weight".
      // If a product is already loaded, reuse it with the new weight.
      // If nothing is loaded, prompt staff to search and pick a product.
      if (isPlaceholderItemNumber(reading.itemNumber ?? '')) {
        if (currentItem) {
          // Preserve PO context when scale fires with placeholder item number
          const updated = { ...currentItem, itemWeight: reading.itemWeight };
          setCurrentItem(updated);
          setManualWeight('');
          // Categorical mode: new weight triggers the auto-detect effect — don't print yet,
          // let staff confirm the matched tier in the banner before pressing Print.
          if (weightRanges.length > 0) return;
          await printItem(updated);
        } else {
          setUnmappedPrompt({ itemNumber: reading.itemNumber ?? '0', weight: reading.itemWeight });
        }
        return;
      }
      resetPrinted();
      setLookupLoading(true);
      const item = await lookupProduct(reading);
      setLookupLoading(false);
      // Unmapped item number — pause instead of silently printing a placeholder. Staff get a
      // prompt to search the catalog and, if useful, map this item number on the spot.
      if (!item.found && item.itemNumber) {
        setUnmappedPrompt({ itemNumber: item.itemNumber, weight: item.itemWeight });
        return;
      }
      setCurrentItem(item);
      // If the product has weight ranges (categorical), fetch them and run auto-detection
      // before printing. In categorical mode we show confirmation UI instead of auto-printing.
      if (item.found && item.variantId) {
        try {
          const numericId = item.variantId.includes('/') ? item.variantId.split('/').pop()! : item.variantId;
          const rangesRes = await fetch(`/api/scale/weight-category?productId=${encodeURIComponent(numericId)}&weightLbs=${encodeURIComponent('0')}`);
          // We use the weight-ranges endpoint for the full rules list
          const rulesRes = await fetch(`/api/scale/weight-ranges?productId=${encodeURIComponent(numericId)}`);
          if (rulesRes.ok) {
            const rulesData = await rulesRes.json();
            const rules: WeightRangeRule[] = Array.isArray(rulesData.data?.rules) ? rulesData.data.rules : [];
            if (rules.length > 0) {
              setWeightRanges(rules);
              // Don't auto-print — show confirmation UI
              return;
            }
          }
          void rangesRes; // unused if no ranges
        } catch {
          // ignore — proceed with normal print
        }
      }
      await printItem(item);
    },
    [lookupProduct, printItem, resetPrinted, currentItem]
  );

  const handleUnmappedResolved = useCallback(
    async (
      chosen: { productId: string; productTitle: string; variantId: string; variantTitle: string | null; imageUrl: string | null; plu: string },
      mapping: { save: boolean; pricePerLb: number }
    ) => {
      if (!unmappedPrompt) return;
      if (mapping.save) {
        try {
          const res = await fetch('/api/scale/products/by-variant', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: chosen.productId,
              variantId: chosen.variantId,
              productTitle: chosen.productTitle,
              variantTitle: chosen.variantTitle,
              imageUrl: chosen.imageUrl,
              itemNumber: unmappedPrompt.itemNumber,
              plu: chosen.plu,
              pricePerLb: mapping.pricePerLb,
              pinned: false,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error('[scale] failed to save item mapping:', data.error || res.status);
          }
        } catch (err) {
          console.error('[scale] failed to save item mapping:', err);
        }
      }

      const item: CurrentItem = {
        itemNumber: unmappedPrompt.itemNumber,
        itemName: chosen.productTitle,
        itemWeight: unmappedPrompt.weight,
        plu: chosen.plu,
        productTitle: chosen.productTitle,
        variantTitle: chosen.variantTitle && chosen.variantTitle !== 'Default Title' ? chosen.variantTitle : null,
        variantId: chosen.variantId ?? null,
        found: true,
      };
      setUnmappedPrompt(null);
      setCurrentItem(item);
      await printItem(item);
    },
    [unmappedPrompt, printItem]
  );

  const scale = useScale(handleReading);

  useEffect(() => {
    fetch('/api/auth').then(r => { if (r.status === 401) router.replace('/'); });
    scale.autoConnect();
    fetchHistory();
    fetch('/api/scale/text-mappings')
      .then(r => r.json())
      .then(d => setTextMappings(d.mappings ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-print on printer devices: when payloads are ready, trigger batchPrint
  // automatically. window.open will be blocked (no gesture) so it falls back to
  // window.print() on the main window — which works because PrintLabelPortal
  // now injects @media print CSS that shows #batch-print-labels.
  useEffect(() => {
    if (!isPrinterDevice || !pendingBulkPayloads || pendingBulkPayloads.length === 0) return;
    batchPrint(pendingBulkPayloads);
    setPendingBulkPayloads(null);
  }, [isPrinterDevice, pendingBulkPayloads, batchPrint]);

  const handleManualPrint = async () => {
    if (!currentItem) {
      console.warn('[scale] manual print requested with no current item');
      return;
    }
    // Merge manual weight if the user typed one before clicking Print
    const item = manualWeight.trim() ? { ...currentItem, itemWeight: manualWeight.trim() } : currentItem;
    if (manualWeight.trim()) {
      setCurrentItem(item);
      setManualWeight('');
    }
    // When auto-detect has a match, apply the matched variant before printing
    if (autoDetect?.matched && item.variantId !== autoDetect.matched.variantId) {
      const itemWithVariant = { ...item, variantId: autoDetect.matched.variantId, variantTitle: autoDetect.matched.label };
      setCurrentItem(itemWithVariant);
      await printItem(itemWithVariant, { forceDialog: true });
      // Reset for next item (staff places next chicken)
      setAutoDetect(null);
      setWeightRanges(prev => prev); // keep ranges for next weigh
      return;
    }
    await printItem(item, { forceDialog: true });
    if (weightRanges.length > 0) {
      // Reset detection for next item in sequence
      setAutoDetect(null);
    }
  };

  const handleReprint = async (record: PrintedLabel) => {
    console.log('[scale] reprinting:', record.productTitle, record.printedAtEst);
    const baseSn = record.sn ?? generateSn();
    const reprintSn = buildReprintSn(baseSn);
    const printedAtEst = formatEst(new Date());

    // For encrypted labels: decrypt → swap SN in plaintext → re-encrypt with new SN.
    // For old unencrypted labels: plain string replace (backward compat).
    setPrintError(null);
    let newQrPayload: string;
    if (isEncryptedQr(record.qrPayload)) {
      try {
        const plaintext = await decryptQrPayload(record.qrPayload);
        const updatedPlaintext = plaintext.replace(`SN:${baseSn}`, `SN:${reprintSn}`);
        newQrPayload = await encryptQrPayload(updatedPlaintext);
      } catch {
        setPrintError('Encryption failed during reprint — label not printed. Try again.');
        return;
      }
    } else {
      newQrPayload = record.qrPayload.replace(`SN:${baseSn}`, `SN:${reprintSn}`);
    }

    printVerbatim({ productTitle: record.productTitle, variantTitle: null, qrPayload: newQrPayload, itemWeight: record.itemWeight, printedAtEst, sn: reprintSn });
  };

  const handleHistoryReprint = useCallback((items: import('@/components/BulkSessionHistoryPanel').ReprintItem[]) => {
    const payloads = items.map(item => {
      const reprintSn = buildReprintSn(item.sn || generateSn());
      const printedAtEst = formatEst(new Date());
      return { productTitle: item.productTitle, variantTitle: item.variantTitle, qrPayload: item.qrPayload, itemWeight: '', printedAtEst, sn: reprintSn };
    });
    batchPrint(payloads);
  }, [buildReprintSn, batchPrint]);

  const handleQrScan = useCallback(async (scanned: string) => {
    setQrScanOpen(false);
    setQrScanError(null);
    setLookupLoading(true);

    let plaintext = scanned;
    if (isEncryptedQr(scanned)) {
      try {
        plaintext = await decryptQrPayload(scanned);
      } catch {
        setQrScanError('Failed to decrypt label — was it printed by ShipScan?');
        setLookupLoading(false);
        setQrScanOpen(true);
        return;
      }
    }

    // Payload: "PLU | Title | weight | SN:xxx" or "PLU | Title | SN:xxx"
    const parts = plaintext.split(' | ');
    if (parts.length < 2) {
      setQrScanError('Unrecognized label format — only ShipScan labels can be processed here');
      setLookupLoading(false);
      setQrScanOpen(true);
      return;
    }

    const plu = parts[0].trim();
    const titlePart = parts[1].trim();
    const weightPart = parts.slice(2).find(p => !p.startsWith('SN:')) ?? '';
    const snPart = parts.find(p => p.startsWith('SN:'));
    const sn = snPart ? snPart.replace('SN:', '').trim() : null;

    let item = await lookupProduct({
      itemNumber: plu !== 'N/A' ? plu : '',
      itemName: titlePart,
      itemWeight: weightPart,
      qrPayload: '',
      rawBuffer: '',
      timestamp: new Date(),
    });

    // Primary: SN-based lookup — resolves variantId from the original print log entry.
    // This works for both mapped and unmapped products, including PLU "N/A" items.
    if (!item.variantId && sn) {
      try {
        const snRes = await fetch(`/api/scale/lookup-by-sn?sn=${encodeURIComponent(sn)}`);
        if (snRes.ok) {
          const snData = await snRes.json();
          if (snData.data?.found && snData.data?.variantId) {
            item = { ...item, variantId: snData.data.variantId };
          }
        }
      } catch {
        // non-fatal
      }
    }

    // Tertiary fallback: title-based lookup for unmapped products without a logged SN variantId
    if (!item.variantId && titlePart) {
      try {
        const titleRes = await fetch(`/api/scale/lookup-by-title?title=${encodeURIComponent(titlePart)}`);
        if (titleRes.ok) {
          const titleData = await titleRes.json();
          if (titleData.data?.found && titleData.data?.variantId) {
            item = {
              ...item,
              variantId: titleData.data.variantId,
              variantTitle: titleData.data.variantTitle && titleData.data.variantTitle !== 'Default Title'
                ? titleData.data.variantTitle : null,
            };
          }
        }
      } catch {
        // non-fatal — item still loads without variantId
      }
    }

    setWasQrScanned(true);
    setCurrentItem(item);
    setLookupLoading(false);
  }, [lookupProduct]);

  const scaleStatus =
    scale.state === 'receiving' || scale.state === 'processing'
      ? 'busy'
      : scale.state === 'connected'
      ? 'ok'
      : 'off';
  const canPrint = !!currentItem;

  const clearCurrentItem = () => {
    setCurrentItem(null);
    setManualWeight('');
    setBulkPrintResults(null);
    setBulkInventoryAdjusted(null);
    setPendingBulkPayloads(null);
    setPendingInventoryAdjust(null);
    setTransformationOptions(null);
    setInventoryMappingOverride(null);
    setManualTransformModal(false);
    setWeightRanges([]);
    setAutoDetect(null);
    setWasQrScanned(false);
    resetPrinted();
  };

  // 5-tap unlock on the scale status chip reveals the Diagnostics panel
  const handleDevTap = () => {
    if (devTapTimer.current) clearTimeout(devTapTimer.current);
    const next = devTapCount + 1;
    if (next >= 5) {
      setDevModeUnlocked(v => !v);
      setDevTapCount(0);
    } else {
      setDevTapCount(next);
      devTapTimer.current = setTimeout(() => setDevTapCount(0), 1500);
    }
  };

  return (
    <>
      <main className="min-h-screen bg-slate-950 pb-safe">

        {/* ── Sticky header ─────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors flex-shrink-0"
            aria-label="Back to home"
          >
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-100 leading-tight">Scale &amp; Print</h1>
            <p className="text-xs text-slate-500 leading-tight hidden sm:block">Barcode creation &amp; PO receiving</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDevTap}
              className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 select-none"
              aria-label="Scale status"
            >
              <StatusDot status={scaleStatus} />
              <span className="text-xs text-slate-400 font-medium">Scale</span>
              {devModeUnlocked && <span className="text-[9px] text-violet-400 font-bold">DEV</span>}
            </button>
            <button
              onClick={() => router.push('/scale/settings')}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors"
              aria-label="Scale settings"
            >
              <Settings className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* ── Two-column responsive body ─────────────────────────────────────── */}
        {/* On mobile: active zone first (order-first), PO suggestions below (order-last).
            On lg+: two columns — PO suggestions fixed left, work area right. */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 px-4 py-5 items-start">

          {/* ── LEFT (lg) / TOP (mobile): PO suggestions sidebar ────────── */}
          <div className="order-first lg:sticky lg:top-[61px] lg:overflow-y-auto lg:max-h-[calc(100vh-81px)]">
            <PoSuggestions
              orders={poOrders}
              loading={poLoading}
              error={poError}
              lineItemsCache={poLineItemsCache}
              expandedPoId={expandedPoId}
              onToggleExpand={handlePoToggle}
              onSelectItem={handlePoItemSelect}
            />
          </div>

          {/* ── RIGHT (lg) / BOTTOM (mobile): Main work area ──────────────── */}
          <div className="order-last lg:order-last flex flex-col gap-4">

            {/* ── ACTIVE WORK ZONE ─────────────────────────────────────────── */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">

              {/* Zone header */}
              <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <span className="w-1 h-4 bg-blue-500 rounded-full flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {currentItem ? (
                      <>
                        <p className="text-sm font-bold text-slate-100 leading-snug">
                          {applyMappings(currentItem.productTitle, textMappings)}
                        </p>
                        {currentItem.variantTitle && currentItem.variantTitle !== 'Default Title' && (
                          <p className="text-xs text-slate-400 leading-tight mt-0.5">
                            {applyMappings(currentItem.variantTitle, textMappings)}
                          </p>
                        )}
                        {currentItem.poId && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-900 font-semibold">PO</span>
                            <span className="text-[10px] text-slate-500">{currentItem.poQuantityOrdered} ordered</span>
                            {currentItem.vendorName && (
                              <span className="text-[10px] text-blue-400 font-medium">{currentItem.vendorName}</span>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-slate-300">Active Print Zone</p>
                        <p className="text-xs text-slate-500 mt-0.5">Scan from scale or select a product</p>
                      </div>
                    )}
                  </div>
                </div>

                {currentItem && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {printedAt && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-900 font-semibold">
                        Printed
                      </span>
                    )}
                    <button
                      onClick={clearCurrentItem}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      aria-label="Clear item"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800" />

              {/* ── Empty state: step guide + CTA ── */}
              {!currentItem ? (
                <div className="px-4 py-5 flex flex-col gap-5">

                  {/* 3-step guide */}
                  <div className="flex flex-col gap-3">
                    {/* Step 1 */}
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-slate-400">1</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 leading-tight">Open a Purchase Order</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">Tap a PO below to expand it, then select the item you&apos;re weighing</p>
                      </div>
                    </div>

                    {/* connector line */}
                    <div className="ml-3.5 w-px h-3 bg-slate-700 self-start" style={{marginLeft: '13px'}} />

                    {/* Step 2 */}
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-slate-400">2</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 leading-tight">Place item on the scale</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                          {scale.state === 'connected'
                            ? 'Scale connected — trigger a reading to get the weight'
                            : scale.state === 'receiving' || scale.state === 'processing'
                            ? 'Receiving weight…'
                            : 'Connect the scale or enter weight manually'}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <StatusDot status={scaleStatus} />
                      </div>
                    </div>

                    {/* connector line */}
                    <div className="ml-3.5 w-px h-3 bg-slate-700 self-start" style={{marginLeft: '13px'}} />

                    {/* Step 3 */}
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-slate-400">3</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 leading-tight">Print the label</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">The correct size is selected automatically — tap Print to finish</p>
                      </div>
                    </div>
                  </div>

                  {/* Select Product CTA */}
                  <button
                    onClick={() => router.push('/scale/products')}
                    className="w-full flex items-center gap-3 bg-blue-600 hover:bg-blue-500 rounded-xl px-4 py-3 transition-colors active:scale-[0.99]"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-500/40 flex items-center justify-center flex-shrink-0">
                      <ListFilter className="w-4 h-4 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-white leading-tight">Select Product</p>
                      <p className="text-xs text-blue-100 leading-tight">Browse or search the catalog</p>
                    </div>
                  </button>

                  {/* Process Label CTA — scan a previously printed label to reprocess/transform */}
                  {!qrScanOpen ? (
                    <button
                      onClick={() => { setQrScanError(null); setQrScanOpen(true); }}
                      className="w-full flex items-center gap-3 bg-amber-950/60 hover:bg-amber-900/50 border border-amber-800/40 rounded-xl px-4 py-3 transition-colors active:scale-[0.99]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                        <QrCode className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-amber-200 leading-tight">Process Label</p>
                        <p className="text-xs text-amber-400/70 leading-tight">Scan a printed label to transform or reprocess</p>
                      </div>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 rounded-xl border border-amber-800/40 bg-amber-950/30 px-3 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <QrCode className="w-3.5 h-3.5 text-amber-400" />
                          <p className="text-sm font-semibold text-amber-200">Scan the label QR code</p>
                        </div>
                        <button
                          onClick={() => { setQrScanOpen(false); setQrScanError(null); }}
                          className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {qrScanError && (
                        <p className="text-xs text-rose-400 bg-rose-950/40 rounded-lg px-2 py-1.5">{qrScanError}</p>
                      )}
                      <BarcodeScanner onScan={handleQrScan} active={qrScanOpen} />
                    </div>
                  )}
                </div>
              ) : (
                /* ── Product loaded state ── */
                <div className="px-4 pb-4 pt-3 flex flex-col gap-3">

                  {/* Compact scale status when product is loaded */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <StatusDot status={scaleStatus} />
                      <span>
                        {scale.state === 'receiving'
                          ? 'Receiving scale data…'
                          : scale.state === 'processing'
                          ? 'Processing…'
                          : scale.state === 'connected'
                          ? 'Scale ready — trigger to update weight'
                          : 'Scale not connected'}
                      </span>
                    </div>
                    <button
                      onClick={() => router.push('/scale/products')}
                      className="text-xs text-slate-500 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      <ListFilter className="w-3 h-3" /> Switch
                    </button>
                  </div>

                  {/* Label size selector */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {LABEL_SIZE_OPTIONS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => handleSizeChange(key)}
                        className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
                          labelSizeKey === key
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Label preview */}
                  <LabelPreview
                    item={currentItem}
                    lookupLoading={lookupLoading}
                    labelSizeKey={labelSizeKey}
                    textMappings={textMappings}
                  />

                  <div className="border-t border-slate-800" />

                  {/* ── Weight auto-detection banner ── */}
                  {autoDetect && (
                    <div className={`flex flex-col gap-2 rounded-xl px-3 py-2.5 border ${
                      autoDetect.noMatch
                        ? 'bg-rose-950/40 border-rose-800/60'
                        : 'bg-emerald-950/40 border-emerald-800/60'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Zap className={`w-4 h-4 flex-shrink-0 ${autoDetect.noMatch ? 'text-rose-400' : 'text-emerald-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold ${autoDetect.noMatch ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {autoDetect.noMatch
                              ? `No match — ${autoDetect.weightLbs.toFixed(2)} lbs falls outside all configured ranges`
                              : `Auto-detected: ${autoDetect.matched!.label} — ${autoDetect.weightLbs.toFixed(2)} lbs`}
                          </p>
                          {!autoDetect.noMatch && autoDetect.matched && (
                            <p className="text-[11px] text-emerald-400/70 mt-0.5">
                              Range: ≥{autoDetect.matched.minLbs} lbs{autoDetect.matched.maxLbs != null ? ` · <${autoDetect.matched.maxLbs} lbs` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Override buttons for other tiers */}
                      {weightRanges.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-[10px] text-slate-500 self-center">Override:</span>
                          {weightRanges.map(r => (
                            <button
                              key={r.variantId}
                              onClick={() => {
                                setAutoDetect({ matched: r, noMatch: false, weightLbs: autoDetect.weightLbs });
                                if (currentItem) setCurrentItem({ ...currentItem, variantId: r.variantId, variantTitle: r.label });
                              }}
                              className={`text-[11px] px-2 py-0.5 rounded-lg font-medium transition-colors ${
                                autoDetect.matched?.variantId === r.variantId
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Feedback banners ── */}

                  {!isPrinterDevice && remotePrintJob && (
                    <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 border text-sm ${
                      remotePrintJob.status === 'completed'
                        ? 'bg-emerald-950/50 border-emerald-900 text-emerald-300'
                        : remotePrintJob.status === 'failed'
                        ? 'bg-rose-950/50 border-rose-900 text-rose-300'
                        : remotePrintJob.status === 'claimed'
                        ? 'bg-blue-950/50 border-blue-900 text-blue-300'
                        : 'bg-amber-950/50 border-amber-900 text-amber-300'
                    }`}>
                      <Printer className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1 min-w-0 font-medium">
                        {remotePrintJob.status === 'queued' && 'Waiting for printer device…'}
                        {remotePrintJob.status === 'claimed' && `Printing on ${remotePrintJob.claimedBy ?? 'another device'}…`}
                        {remotePrintJob.status === 'completed' && 'Printed successfully on remote device'}
                        {remotePrintJob.status === 'failed' && `Print failed: ${remotePrintJob.failedReason ?? 'unknown error'}`}
                      </span>
                      {(remotePrintJob.status === 'completed' || remotePrintJob.status === 'failed') && (
                        <button onClick={() => setRemotePrintJob(null)} className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-current opacity-60 hover:opacity-100 transition-opacity">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {printError && (
                    <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2.5">
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <p className="text-sm text-rose-300 font-medium">{printError}</p>
                    </div>
                  )}

                  {printedAt && (
                    <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-900 rounded-xl px-3 py-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <p className="text-sm text-emerald-300 font-medium">
                        Sent to print at {formatEst(printedAt)} EST
                      </p>
                    </div>
                  )}

                  {/* Transformation options (auto-detected or manual fallback) */}
                  {(transformationOptions !== null) && (
                    <TransformationPanel
                      options={transformationOptions}
                      currentItem={currentItem}
                      onSelect={handleTransformationSelect}
                      onManualTransform={() => setManualTransformModal(true)}
                    />
                  )}

                  {/* Wet product / inventory mapping */}
                  {(() => {
                    const m = inventoryMappingOverride ?? inventoryMapping;
                    if (!m?.found) return null;
                    const pUnits = m.parentUnits ?? 1;
                    const cUnits = m.childUnits ?? 1;
                    const ratioLabel = (pUnits !== 1 || cUnits !== 1) ? ` (${pUnits}:${cUnits} ratio)` : '';
                    return (
                      <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border ${
                        lastAdjustment ? 'bg-emerald-950/40 border-emerald-800/60' : 'bg-amber-950/40 border-amber-800/60'
                      }`}>
                        <Droplets className={`w-4 h-4 flex-shrink-0 mt-0.5 ${lastAdjustment ? 'text-emerald-400' : 'text-amber-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold leading-tight ${lastAdjustment ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {inventoryMappingOverride ? 'Manual Transformation' : 'Wet Product'}
                          </p>
                          {lastAdjustment ? (
                            <p className="text-xs text-emerald-400/80 leading-tight mt-0.5">
                              {Math.abs(lastAdjustment.delta)} unit{Math.abs(lastAdjustment.delta) !== 1 ? 's' : ''} deducted from {lastAdjustment.parentTitle}
                            </p>
                          ) : m.isWeighted ? (
                            <p className="text-xs text-amber-400/80 leading-tight mt-0.5">
                              {currentItem.itemWeight
                                ? `~${Math.round(parseFloat(currentItem.itemWeight.replace(/[^0-9.]/g, '')) / m.weightPerUnit)} unit${Math.round(parseFloat(currentItem.itemWeight.replace(/[^0-9.]/g, '')) / m.weightPerUnit) !== 1 ? 's' : ''} of ${m.parentProductTitle} will be deducted`
                                : `Deducts from ${m.parentProductTitle} · ${m.weightPerUnit} lbs/unit`}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-400/80 leading-tight mt-0.5">
                              {pUnits} unit{pUnits !== 1 ? 's' : ''} of {m.parentProductTitle} → {cUnits} child unit{cUnits !== 1 ? 's' : ''}{ratioLabel}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Manual weight input — optional for PO items */}
                  {currentItem.poId && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs text-slate-500">Weight <span className="text-slate-600">(optional — or trigger scale)</span></p>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 1.25 kg"
                        value={manualWeight}
                        onChange={e => setManualWeight(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleManualPrint(); }}
                        className="h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  )}

                  {/* Bulk print results */}
                  {bulkPrintResults && bulkPrintResults.length > 0 && (
                    <BulkPrintResultPanel
                      results={bulkPrintResults}
                      poQuantityOrdered={currentItem.poQuantityOrdered ?? bulkPrintResults.length}
                      inventoryAdjusted={bulkInventoryAdjusted}
                      pendingPrintCount={pendingBulkPayloads?.length ?? 0}
                      pendingAdjustDelta={pendingInventoryAdjust?.delta ?? null}
                      onReprint={handleBulkReprint}
                      onPrintAll={() => { if (pendingBulkPayloads) { batchPrint(pendingBulkPayloads); setPendingBulkPayloads(null); } }}
                      onConfirmAdjust={async () => {
                        if (!pendingInventoryAdjust) return;
                        const { delta, inventoryItemId, locationId } = pendingInventoryAdjust;
                        setPendingInventoryAdjust(null);
                        try {
                          await fetch('/api/scale/inventory-adjust', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ inventoryItemId, locationId, delta, reason: 'correction' }),
                          });
                          setBulkInventoryAdjusted(delta);
                        } catch (err) {
                          console.error('[scale] inventory adjust failed:', err);
                        }
                      }}
                      onDismiss={() => { setBulkPrintResults(null); setBulkInventoryAdjusted(null); setPendingBulkPayloads(null); setPendingInventoryAdjust(null); }}
                    />
                  )}

                  {/* Primary action buttons */}
                  <div className="flex flex-col gap-2">
                    {!bulkPrintResults && (
                      <>
                        {autoDetect?.noMatch && (
                          <p className="text-[11px] text-rose-400 text-center">
                            Select a size above before printing
                          </p>
                        )}
                        <button
                          onClick={handleManualPrint}
                          disabled={!canPrint || autoDetect?.noMatch === true}
                          className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                        >
                          <Printer className="w-4 h-4" />
                          {autoDetect?.matched
                            ? `Print as ${autoDetect.matched.label}`
                            : printedAt ? 'Print Again' : 'Print Label'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={clearCurrentItem}
                      className="w-full h-10 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 transition-all active:scale-[0.98]"
                    >
                      <ScanLine className="w-4 h-4" /> New Scan
                    </button>
                  </div>

                </div>
              )}
            </div>
            {/* end active work zone */}

            {/* ── Bulk session history ──────────────────────────────────────── */}
            <BulkSessionHistoryPanel onReprintLabel={handleHistoryReprint} />

            {/* ── Print history ─────────────────────────────────────────────── */}
            <PrintHistory
              records={printHistory}
              loading={historyLoading}
              canPrint={true}
              onReprint={handleReprint}
            />

            {/* ── Device setup ──────────────────────────────────────────────── */}
            <DeviceSetup
              scaleState={scale.state}
              scaleError={scale.error}
              onConnectScale={scale.connect}
              onDisconnectScale={scale.disconnect}
              isPrinterDevice={isPrinterDevice}
              onTogglePrinterDevice={togglePrinterDevice}
            />

            {/* ── Diagnostics — dev mode only (tap Scale chip 5× to unlock) ── */}
            {devModeUnlocked && (
              <div className="border border-violet-900/50 rounded-2xl overflow-hidden bg-slate-950">
                <button
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
                  onClick={() => setDebugOpen(v => !v)}
                >
                  <div className="flex items-center gap-2">
                    <Bug className="w-4 h-4 text-violet-500" />
                    <span className="text-sm font-semibold text-violet-300">Diagnostics</span>
                    <span className="text-[10px] text-violet-500">dev</span>
                  </div>
                  {debugOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </button>
                {debugOpen && (
                  <div className="border-t border-violet-900/40 px-4 py-3 flex flex-col gap-1.5 text-xs font-mono text-slate-400">
                    <p>state: <span className="text-slate-200">{scale.state}</span></p>
                    <p>listenerActive: <span className="text-slate-200">{String(scale.listenerActive)}</span></p>
                    <p>portLabel: <span className="text-slate-200">{scale.portLabel ?? 'null'}</span></p>
                    <p>chunkCount: <span className="text-slate-200">{scale.chunkCount}</span></p>
                    <p>error: <span className="text-slate-200">{scale.error ?? 'null'}</span></p>
                    <p>lastReading.itemNumber: <span className="text-slate-200">{scale.lastReading?.itemNumber || '(none)'}</span></p>
                    <p>lastReading.itemWeight: <span className="text-slate-200">{scale.lastReading?.itemWeight || '(none)'}</span></p>
                    <p className="break-all">lastRawBuffer: <span className="text-slate-200">{scale.lastRawBuffer ? JSON.stringify(scale.lastRawBuffer) : '(none)'}</span></p>
                  </div>
                )}
              </div>
            )}

          </div>
          {/* end right column */}

        </div>
        {/* end two-column grid */}

      </main>

      {unmappedPrompt && (
        <UnmappedItemModal
          itemNumber={unmappedPrompt.itemNumber}
          weight={unmappedPrompt.weight}
          hideSave={isPlaceholderItemNumber(unmappedPrompt.itemNumber)}
          onClose={() => setUnmappedPrompt(null)}
          onResolved={handleUnmappedResolved}
        />
      )}

      {manualTransformModal && currentItem && (
        <ManualTransformModal
          parentProductTitle={currentItem.productTitle}
          onConfirm={handleManualTransformConfirm}
          onClose={() => setManualTransformModal(false)}
        />
      )}

      {bulkPrintModal && (
        <BulkPrintModal
          productTitle={bulkPrintModal.item.productTitle}
          variantTitle={bulkPrintModal.item.variantTitle ?? null}
          orderedQuantity={bulkPrintModal.li.quantityOrdered}
          vendorName={bulkPrintModal.item.vendorName}
          isLotReceiving={bulkPrintModal.isLotReceiving}
          onConfirm={(qty, wt, lotNo, expiryDate, lotTotalWeightLbs) =>
            handleBulkPrint(bulkPrintModal, qty, wt, lotNo, expiryDate, lotTotalWeightLbs)
          }
          onClose={() => setBulkPrintModal(null)}
        />
      )}

      <PrintLabelPortal payload={printPayload} batchPayloads={batchPrintPayloads} labelSizeKey={labelSizeKey} />
    </>
  );
}
