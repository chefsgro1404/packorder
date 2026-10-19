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
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useScale, type ParsedReading } from '@/hooks/useScale';
import { usePrintLabel } from '@/hooks/usePrintLabel';
import { PrintLabelPortal } from '@/components/PrintLabelPortal';
import { UnmappedItemModal } from '@/components/UnmappedItemModal';
import { generateSn, buildQrPayload } from '@/lib/scaleLabel';
import { encryptQrPayload, isEncryptedQr, decryptQrPayload } from '@/lib/qrEncryption';
import { fetchNextSn } from '@/lib/snBuilder';
import { formatEst } from '@/lib/dateFormat';
import { PrintedLabel, TextMapping, PurchaseOrder, PurchaseOrderLineItem, InventoryMappingInfo, PrintJob, PrintJobPayload, TransformationOption } from '@/lib/types';
import { BulkPrintModal } from '@/components/BulkPrintModal';
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
            <div className="flex flex-col divide-y divide-slate-800/60">
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
  onReprint,
  onDismiss,
}: {
  results: BulkPrintLabelResult[];
  poQuantityOrdered: number;
  inventoryAdjusted: number | null;
  onReprint: (r: BulkPrintLabelResult) => void;
  onDismiss: () => void;
}) {
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
          onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {inventoryAdjusted !== null && inventoryAdjusted < 0 && (
        <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/40 rounded-lg px-2.5 py-1.5">
          Shopify inventory adjusted by {inventoryAdjusted} for the {Math.abs(inventoryAdjusted)} unit shortfall
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

// ─── Transformation options panel ─────────────────────────────────────────────

function TransformationPanel({
  options,
  onSelect,
}: {
  options: TransformationOption[];
  onSelect: (opt: TransformationOption) => void;
}) {
  return (
    <div className="flex flex-col gap-2 bg-violet-950/30 border border-violet-900/50 rounded-xl px-3 py-2.5 mb-2">
      <div className="flex items-center gap-2">
        <Droplets className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
        <p className="text-xs font-semibold text-violet-300">Transformation Options</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.variantId}
            onClick={() => onSelect(opt)}
            className="flex items-center gap-1.5 text-xs bg-violet-900/50 hover:bg-violet-800/60 border border-violet-800/60 text-violet-200 rounded-lg px-2.5 py-1.5 transition-colors font-medium"
          >
            Transform → {opt.title}
          </button>
        ))}
      </div>
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
  const [unmappedPrompt, setUnmappedPrompt] = useState<{ itemNumber: string; weight: string } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [textMappings, setTextMappings] = useState<TextMapping[]>([]);
  const [manualWeight, setManualWeight] = useState('');
  const [inventoryMapping, setInventoryMapping] = useState<InventoryMappingInfo | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<{ delta: number; parentTitle: string } | null>(null);
  const [remotePrintJob, setRemotePrintJob] = useState<PrintJob | null>(null);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [bulkPrintModal, setBulkPrintModal] = useState<{ item: CurrentItem; po: PurchaseOrder; li: PurchaseOrderLineItem } | null>(null);
  const [bulkPrintResults, setBulkPrintResults] = useState<BulkPrintLabelResult[] | null>(null);
  const [bulkInventoryAdjusted, setBulkInventoryAdjusted] = useState<number | null>(null);
  const [transformationOptions, setTransformationOptions] = useState<TransformationOption[] | null>(null);
  const { isPrinterDevice, createJob, getJob, listQueuedJobs, claimJob, completeJob, failJob } = usePrintQueue();
  const { orders: poOrders, loading: poLoading, error: poError, fetchLineItems, refreshLineItems, approve: approvePoItem } = usePurchaseOrders();
  const [poLineItemsCache, setPoLineItemsCache] = useState<Record<string, PurchaseOrderLineItem[]>>({});
  const isPrinting = useRef(false);
  const [labelSizeKey, setLabelSizeKey] = useState<LabelSizeKey>(() => {
    if (typeof window === 'undefined') return '3x2';
    return (localStorage.getItem(LABEL_SIZE_STORAGE_KEY) as LabelSizeKey) ?? '3x2';
  });
  const { printPayload, printedAt, triggerPrint, printVerbatim, buildReprintSn, reset: resetPrinted } = usePrintLabel(labelSizeKey);

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
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scale/inventory-mapping?variantId=${encodeURIComponent(variantId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setInventoryMapping(data.data ?? null);
      } catch {
        if (!cancelled) setInventoryMapping(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentItem?.variantId]);

  // Fetch transformation options (parent → children) when variant changes
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
          const opts = data.data?.options;
          setTransformationOptions(Array.isArray(opts) && opts.length > 0 ? opts : null);
        }
      } catch {
        if (!cancelled) setTransformationOptions(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentItem?.variantId]);

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

    // Adjust parent product inventory for wet products, then increase child inventory
    if (mapping?.found && mapping.parentInventoryId && mapping.parentLocationId) {
      const rawWeight = parseFloat(item.itemWeight?.replace(/[^0-9.]/g, '') ?? '0') || 0;
      let delta = 0;
      if (mapping.isWeighted) {
        if (rawWeight > 0 && mapping.weightPerUnit > 0)
          delta = -Math.round(rawWeight / mapping.weightPerUnit);
      } else {
        delta = -1;
      }
      if (delta !== 0) {
        try {
          await fetch('/api/scale/inventory-adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inventoryItemId: mapping.parentInventoryId,
              locationId: mapping.parentLocationId,
              delta,
              reason: 'correction',
            }),
          });
          setLastAdjustment({ delta, parentTitle: mapping.parentProductTitle });
        } catch (err) {
          console.error('[scale] inventory adjustment failed:', err);
        }

        // Increase child (transformation output) inventory by the same amount
        if (mapping.childInventoryItemId) {
          try {
            await fetch('/api/scale/inventory-adjust', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inventoryItemId: mapping.childInventoryItemId,
                locationId: mapping.parentLocationId,
                delta: Math.abs(delta),
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

    let plu = '';
    let productTitle = li.productTitle;
    let variantTitle = li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null;
    let found = false;

    // Try to find a mapped PLU for this variant
    if (li.variantId) {
      try {
        const numericVariantId = li.variantId.includes('/') ? li.variantId.split('/').pop() ?? '' : li.variantId;
        const res = await fetch(`/api/scale/products/by-variant?variantId=${encodeURIComponent(numericVariantId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.data?.found) {
            plu = data.data.plu ?? '';
            productTitle = data.data.productTitle ?? li.productTitle;
            variantTitle = (data.data.variantTitle && data.data.variantTitle !== 'Default Title')
              ? data.data.variantTitle : variantTitle;
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

    setBulkPrintModal({ item: resolvedItem, po, li });
    setLookupLoading(false);
  }, []);

  const handleBulkPrint = useCallback(async (
    modalState: { item: CurrentItem; po: PurchaseOrder; li: PurchaseOrderLineItem },
    quantity: number,
    weight: string,
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
          triggerPrint({ plu: item.found ? item.plu : null, productTitle: mappedTitle, variantTitle: mappedVariant, itemWeight: item.itemWeight }, sn, encryptedPayload);
        } else {
          await createJob({ plu: item.found ? item.plu : null, productTitle: mappedTitle, variantTitle: mappedVariant ?? null, itemWeight: item.itemWeight, qrPayload: encryptedPayload, sn, labelSizeKey, printedAtEst }, 'label');
        }
        // Log each label; skip PO approval (done once after the full batch)
        await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, null, true);
        results.push({ index: i + 1, sn, qrPayload: encryptedPayload, printedAtEst, status: 'printed' });
      } catch (err) {
        results.push({ index: i + 1, sn: '', qrPayload: '', printedAtEst: '', status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
      }
      setBulkPrintResults([...results]);
    }

    // Approve PO line item with the actual printed count
    const printedCount = results.filter(r => r.status === 'printed').length;
    if (printedCount > 0) {
      try {
        await approvePoItem(po.id, li.id, printedCount);
        const fresh = await refreshLineItems(po.id);
        setPoLineItemsCache(prev => ({ ...prev, [po.id]: fresh }));
      } catch (err) {
        console.error('[scale] PO bulk approval failed:', err);
      }
    }

    // Shopify inventory correction: if received fewer than ordered, adjust the delta
    const shortfall = li.quantityOrdered - printedCount;
    if (shortfall > 0 && item.variantId) {
      try {
        const invRes = await fetch(`/api/scale/variant-inventory?variantId=${encodeURIComponent(item.variantId)}`);
        if (invRes.ok) {
          const invData = await invRes.json();
          const { inventoryItemId, locationId } = invData.data ?? {};
          if (inventoryItemId && locationId) {
            const adjustDelta = -shortfall;
            await fetch('/api/scale/inventory-adjust', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inventoryItemId, locationId, delta: adjustDelta, reason: 'correction' }),
            });
            setBulkInventoryAdjusted(adjustDelta);
          }
        }
      } catch (err) {
        console.error('[scale] PO inventory correction failed:', err);
      }
    }
  }, [textMappings, isPrinterDevice, triggerPrint, createJob, logPrintedLabel, approvePoItem, refreshLineItems, labelSizeKey, resetPrinted]);

  const handleTransformationSelect = useCallback((opt: TransformationOption) => {
    if (!currentItem) return;
    setCurrentItem({
      ...currentItem,
      variantId: opt.variantId,
      variantTitle: opt.title !== 'Default Title' ? opt.title : null,
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

  const printItem = useCallback(async (item: CurrentItem) => {
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

      if (isPrinterDevice) {
        const { printedAtEst } = triggerPrint({
          plu: item.found ? item.plu : null,
          productTitle: mappedTitle,
          variantTitle: mappedVariant,
          itemWeight: item.itemWeight,
        }, sn, encryptedPayload);
        await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, inventoryMapping);
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
          await logPrintedLabel(item, encryptedPayload, printedAtEst, sn, inventoryMapping);
        } else {
          setPrintError('Failed to queue print job — check your connection and try again.');
        }
      }
    } finally {
      isPrinting.current = false;
    }
  }, [triggerPrint, logPrintedLabel, textMappings, inventoryMapping, isPrinterDevice, createJob, labelSizeKey]);

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
    scale.autoConnect();
    fetchHistory();
    fetch('/api/scale/text-mappings')
      .then(r => r.json())
      .then(d => setTextMappings(d.mappings ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualPrint = async () => {
    if (!currentItem) {
      console.warn('[scale] manual print requested with no current item');
      return;
    }
    await printItem(currentItem);
  };

  const handleManualWeightPrint = async () => {
    if (!currentItem || !manualWeight.trim()) return;
    const item = { ...currentItem, itemWeight: manualWeight.trim() };
    setCurrentItem(item);
    await printItem(item);
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
    await logPrintedLabel(
      {
        itemNumber: record.itemNumber,
        itemName: record.productTitle,
        itemWeight: record.itemWeight,
        plu: record.plu,
        productTitle: record.productTitle,
        found: true,
      },
      newQrPayload,
      printedAtEst,
      reprintSn
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
    <>
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
        {/* Live status chips + settings */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <StatusDot status={scaleStatus} />
            <span className="text-xs text-slate-400 font-medium">Scale</span>
          </div>
          <button
            onClick={() => router.push('/scale/settings')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors"
            aria-label="Scale settings"
          >
            <Settings className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-4">
        {/* PO Suggestions */}
        <PoSuggestions
          orders={poOrders}
          loading={poLoading}
          error={poError}
          lineItemsCache={poLineItemsCache}
          expandedPoId={expandedPoId}
          onToggleExpand={handlePoToggle}
          onSelectItem={handlePoItemSelect}
        />

        {/* Select Product entry point */}
        <button
          onClick={() => router.push('/scale/products')}
          className="w-full flex items-center gap-3 bg-blue-600 hover:bg-blue-500 rounded-2xl px-4 py-3.5 transition-colors active:scale-[0.99]"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-500/40 flex items-center justify-center flex-shrink-0">
            <ListFilter className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-bold text-white leading-tight">Select Product</p>
            <p className="text-xs text-blue-100 leading-tight">Browse or search the catalog to print labels for any product</p>
          </div>
        </button>

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
          {/* Label size selector */}
          <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
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
          <div className="px-4 pb-4">
            <LabelPreview item={currentItem} lookupLoading={lookupLoading} labelSizeKey={labelSizeKey} textMappings={textMappings} />

            {currentItem && (
              <>
                <div className="border-t border-slate-800 my-4" />

                {/* Feedback banners */}
                {!isPrinterDevice && remotePrintJob && (
                  <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-3 border text-sm ${
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
                      <button
                        onClick={() => setRemotePrintJob(null)}
                        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-current opacity-60 hover:opacity-100 transition-opacity"
                        aria-label="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
                {printError && (
                  <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2.5 mb-3">
                    <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <p className="text-sm text-rose-300 font-medium">{printError}</p>
                  </div>
                )}
                {printedAt && (
                  <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-900 rounded-xl px-3 py-2.5 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-300 font-medium">
                      Sent to print dialog at {formatEst(printedAt)} EST
                    </p>
                  </div>
                )}

                {/* PO context banner */}
                {currentItem.poId && (
                  <div className="flex items-center gap-2 bg-blue-950/40 border border-blue-900 rounded-xl px-3 py-2.5 mb-2">
                    <ClipboardList className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <p className="text-xs text-blue-300 flex-1 min-w-0">
                      From PO · {currentItem.poQuantityOrdered} units ordered
                      {!currentItem.itemWeight ? ' — enter weight below or weigh on scale' : ''}
                    </p>
                    <button
                      onClick={() => { setCurrentItem(null); setManualWeight(''); resetPrinted(); }}
                      className="w-5 h-5 flex items-center justify-center rounded text-blue-500 hover:text-blue-300 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Transformation options — shown when current variant has child transformation variants */}
                {transformationOptions && transformationOptions.length > 0 && (
                  <TransformationPanel options={transformationOptions} onSelect={handleTransformationSelect} />
                )}

                {/* Wet product / inventory mapping banner */}
                {inventoryMapping?.found && (
                  <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 mb-2 border ${
                    lastAdjustment
                      ? 'bg-emerald-950/40 border-emerald-800/60'
                      : 'bg-amber-950/40 border-amber-800/60'
                  }`}>
                    <Droplets className={`w-4 h-4 flex-shrink-0 mt-0.5 ${lastAdjustment ? 'text-emerald-400' : 'text-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold leading-tight ${lastAdjustment ? 'text-emerald-300' : 'text-amber-300'}`}>
                        Wet Product
                      </p>
                      {lastAdjustment ? (
                        <p className="text-xs text-emerald-400/80 leading-tight mt-0.5">
                          {Math.abs(lastAdjustment.delta)} unit{Math.abs(lastAdjustment.delta) !== 1 ? 's' : ''} deducted from {lastAdjustment.parentTitle}
                        </p>
                      ) : inventoryMapping.isWeighted ? (
                        <p className="text-xs text-amber-400/80 leading-tight mt-0.5">
                          {currentItem.itemWeight
                            ? `~${Math.round(parseFloat(currentItem.itemWeight.replace(/[^0-9.]/g, '')) / inventoryMapping.weightPerUnit)} unit${Math.round(parseFloat(currentItem.itemWeight.replace(/[^0-9.]/g, '')) / inventoryMapping.weightPerUnit) !== 1 ? 's' : ''} of ${inventoryMapping.parentProductTitle} will be deducted`
                            : `Deducts from ${inventoryMapping.parentProductTitle} · ${inventoryMapping.weightPerUnit} lbs/unit`}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-400/80 leading-tight mt-0.5">
                          1 unit of {inventoryMapping.parentProductTitle} will be deducted
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Manual weight input for PO items without a scale reading yet */}
                {currentItem.poId && !currentItem.itemWeight && (
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 1.25 kg"
                      value={manualWeight}
                      onChange={e => setManualWeight(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleManualWeightPrint(); }}
                      className="flex-1 h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                      onClick={handleManualWeightPrint}
                      disabled={!manualWeight.trim()}
                      className="h-10 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl font-semibold text-sm flex items-center gap-1.5 transition-colors active:scale-[0.98]"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                  </div>
                )}

                {/* Bulk print results — shown inline after bulk print completes */}
                {bulkPrintResults && bulkPrintResults.length > 0 && (
                  <BulkPrintResultPanel
                    results={bulkPrintResults}
                    poQuantityOrdered={currentItem.poQuantityOrdered ?? bulkPrintResults.length}
                    inventoryAdjusted={bulkInventoryAdjusted}
                    onReprint={handleBulkReprint}
                    onDismiss={() => { setBulkPrintResults(null); setBulkInventoryAdjusted(null); }}
                  />
                )}

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  {(!currentItem.poId || !!currentItem.itemWeight) && !bulkPrintResults && (
                    <button
                      onClick={handleManualPrint}
                      disabled={!canPrint}
                      className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                    >
                      <Printer className="w-4 h-4" />
                      {printedAt ? 'Print Again' : 'Print Label'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setCurrentItem(null);
                      setManualWeight('');
                      setBulkPrintResults(null);
                      setBulkInventoryAdjusted(null);
                      setTransformationOptions(null);
                      resetPrinted();
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

        {/* Diagnostics — same fields as /scale/products/[id], for direct comparison */}
        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
          <button
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-900/60 transition-colors"
            onClick={() => setDebugOpen((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-200">Diagnostics</span>
            </div>
            {debugOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {debugOpen && (
            <div className="border-t border-slate-800 px-4 py-3 flex flex-col gap-1.5 text-xs font-mono text-slate-400">
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
      </div>

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

      {bulkPrintModal && (
        <BulkPrintModal
          productTitle={bulkPrintModal.item.productTitle}
          variantTitle={bulkPrintModal.item.variantTitle ?? null}
          orderedQuantity={bulkPrintModal.li.quantityOrdered}
          onConfirm={(qty, wt) => handleBulkPrint(bulkPrintModal, qty, wt)}
          onClose={() => setBulkPrintModal(null)}
        />
      )}

      <PrintLabelPortal payload={printPayload} labelSizeKey={labelSizeKey} />
    </>
  );
}
