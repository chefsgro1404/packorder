'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Check,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Pin,
  PinOff,
  Radio,
  CheckCircle2,
  Lock,
  Printer,
  ChevronDown,
  ChevronUp,
  Bug,
} from 'lucide-react';
import { useScale, type ParsedReading } from '@/hooks/useScale';
import { usePrintLabel } from '@/hooks/usePrintLabel';
import { PrintLabelPortal } from '@/components/PrintLabelPortal';
import { buildQrPayload, stripGid } from '@/lib/scaleLabel';
import { formatEst } from '@/lib/dateFormat';
import { ScaleProduct, ProductLookupResult } from '@/lib/types';
import { LABEL_SIZE_OPTIONS, LABEL_SIZE_STORAGE_KEY, type LabelSizeKey } from '@/lib/labelSizes';

// "0" (or "00", etc.) recalled on the scale is a reserved placeholder meaning "ignore the
// item number — use whatever product page is currently open." Real mappings can never use it
// (enforced server-side too), so any other numeric/blank value is either unmapped or a genuine
// conflict to resolve against.
function isPlaceholderItemNumber(itemNumber: string): boolean {
  const trimmed = itemNumber.trim();
  if (trimmed === '') return true;
  return /^0+$/.test(trimmed);
}

interface ItemConflict {
  itemNumber: string;
  weight: string;
  mappedPlu: string;
  mappedTitle: string;
}

export default function ScaleProductDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  // Bare numeric ID from the URL — used only for lookup query params. Never put a full
  // Shopify GID in a URL path segment: its slashes get percent-encoded, but edge routing
  // (Azure SWA, CDNs) often decodes %2F before matching routes, splitting the path into
  // segments that no longer match this single [id] dynamic route, causing a 404.
  const routeVariantId = decodeURIComponent(params.id);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Full GIDs, populated from the lookup responses — required by the Shopify mutation
  // when saving, so the bare route ID above is never sent in a request body.
  const [variantId, setVariantId] = useState('');
  const [productId, setProductId] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [variantTitle, setVariantTitle] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [itemNumber, setItemNumber] = useState('');
  const [plu, setPlu] = useState('');
  const [pricePerLb, setPricePerLb] = useState('');
  const [pinned, setPinned] = useState(false);

  const [printCount, setPrintCount] = useState(0);
  const [manualWeight, setManualWeight] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [conflict, setConflict] = useState<ItemConflict | null>(null);
  const [labelSizeKey, setLabelSizeKey] = useState<LabelSizeKey>(() => {
    if (typeof window === 'undefined') return '3x2';
    return (localStorage.getItem(LABEL_SIZE_STORAGE_KEY) as LabelSizeKey) ?? '3x2';
  });
  const handleSizeChange = (key: LabelSizeKey) => {
    setLabelSizeKey(key);
    localStorage.setItem(LABEL_SIZE_STORAGE_KEY, key);
  };
  const { printPayload, triggerPrint } = usePrintLabel(labelSizeKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const savedRes = await fetch(`/api/scale/products/by-variant?variantId=${encodeURIComponent(routeVariantId)}`);
        const saved: ScaleProduct = await savedRes.json();

        if (saved.found) {
          if (cancelled) return;
          setProductId(saved.productId ?? '');
          setVariantId(saved.variantId ?? routeVariantId);
          setProductTitle(saved.productTitle ?? '');
          setVariantTitle(saved.variantTitle ?? null);
          setImageUrl(saved.imageUrl ?? null);
          setItemNumber(saved.itemNumber ?? '');
          setPlu(saved.plu ?? '');
          setPricePerLb(saved.pricePerLb != null ? String(saved.pricePerLb) : '');
          setPinned(!!saved.pinned);
          return;
        }

        // Not saved yet — fall back to the live synced Shopify variant so the page
        // is still print-ready immediately, with nothing persisted until Save is pressed.
        const liveRes = await fetch(`/api/products/variant?variantId=${encodeURIComponent(routeVariantId)}`);
        const live = await liveRes.json();
        if (cancelled) return;
        if (!live.found) {
          setError('Product variant not found.');
          return;
        }
        setProductId(live.productId ?? '');
        setVariantId(live.variantId ?? routeVariantId);
        setProductTitle(live.productTitle ?? '');
        setVariantTitle(live.variantTitle && live.variantTitle !== 'Default Title' ? live.variantTitle : null);
        setImageUrl(live.imageUrl ?? null);
        setItemNumber('');
        setPlu(live.barcode ?? '');
        setPricePerLb('');
        setPinned(false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load product');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [routeVariantId]);

  const displayTitle = variantTitle ? `${productTitle} - ${variantTitle}` : productTitle;

  const handleSave = useCallback(async (overridePinned?: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/scale/products/by-variant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          productTitle,
          variantTitle,
          imageUrl,
          itemNumber: itemNumber.trim() || null,
          plu: plu.trim(),
          pricePerLb: parseFloat(pricePerLb) || 0,
          pinned: overridePinned ?? pinned,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      if (overridePinned !== undefined) setPinned(overridePinned);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [productId, variantId, productTitle, variantTitle, imageUrl, itemNumber, plu, pricePerLb, pinned]);

  const logPrintedLabel = useCallback(async (logItemNumber: string, logPlu: string, logTitle: string, weight: string, qrPayload: string, printedAtEst: string, sn: string) => {
    try {
      await fetch('/api/scale/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: logItemNumber,
          plu: logPlu || 'N/A',
          productTitle: logTitle,
          itemWeight: weight,
          printedAtEst,
          qrPayload,
          sn,
        }),
      });
    } catch (err) {
      console.error('[scale/products] failed to log printed label:', err);
    }
  }, []);

  // override lets a conflict resolution print a *different* product's PLU/title (the one
  // mapped to the recalled item number) instead of this page's own opened product.
  const printForWeight = useCallback(
    async (weight: string, override?: { itemNumber: string; plu: string | null; productTitle: string }) => {
      const { sn, printedAtEst, qrPayload } = triggerPrint({
        plu: override?.plu ?? (plu || null),
        productTitle: override?.productTitle ?? productTitle,
        variantTitle: override ? null : variantTitle,
        itemWeight: weight,
      });
      setPrintCount((n) => n + 1);
      await logPrintedLabel(override?.itemNumber ?? (itemNumber || ''), override?.plu ?? plu, override?.productTitle ?? displayTitle, weight, qrPayload, printedAtEst, sn);
    },
    [triggerPrint, plu, productTitle, variantTitle, displayTitle, itemNumber, logPrintedLabel]
  );

  // Locked-and-auto-print: any weight reading while this page is open prints a label for this
  // product immediately — UNLESS the scale recalled a non-placeholder item number that's
  // actually mapped to a *different* product, in which case we pause and ask which to print.
  const handleReading = useCallback(
    async (reading: ParsedReading) => {
      const recalled = reading.itemNumber || '';
      if (isPlaceholderItemNumber(recalled)) {
        await printForWeight(reading.itemWeight);
        return;
      }
      try {
        const res = await fetch(`/api/scale/lookup?itemNumber=${encodeURIComponent(recalled)}`);
        const data: ProductLookupResult = await res.json();
        if (data.found && data.variantId && stripGid(data.variantId) !== stripGid(variantId || routeVariantId)) {
          setConflict({
            itemNumber: recalled,
            weight: reading.itemWeight,
            mappedPlu: data.plu || '',
            mappedTitle: data.productTitle || `Item ${recalled}`,
          });
          return;
        }
      } catch (err) {
        console.error('[scale/products] lookup for recalled item failed:', err);
      }
      // Not mapped (or mapped to this same product) — same as the placeholder case.
      await printForWeight(reading.itemWeight);
    },
    [printForWeight, variantId, routeVariantId]
  );

  const scale = useScale(handleReading);

  // Fallback for when the scale's auto-print doesn't fire the print dialog on its own
  // (e.g. the browser blocked the popup, or staff just wants to reprint without re-weighing).
  // Uses the last weight the scale reported this session, or a manually typed one.
  const previewWeight = scale.lastReading?.itemWeight || manualWeight;
  const handleManualPrint = useCallback(async () => {
    if (!previewWeight.trim()) return;
    await printForWeight(previewWeight.trim());
  }, [previewWeight, printForWeight]);

  const resolveConflictAsMapped = useCallback(async () => {
    if (!conflict) return;
    await printForWeight(conflict.weight, {
      itemNumber: conflict.itemNumber,
      plu: conflict.mappedPlu || null,
      productTitle: conflict.mappedTitle,
    });
    setConflict(null);
  }, [conflict, printForWeight]);

  const resolveConflictAsOpened = useCallback(async () => {
    if (!conflict) return;
    await printForWeight(conflict.weight);
    setConflict(null);
  }, [conflict, printForWeight]);

  useEffect(() => {
    scale.autoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scaleStatus =
    scale.state === 'receiving' || scale.state === 'processing'
      ? 'busy'
      : scale.state === 'connected'
      ? 'ok'
      : 'off';

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 text-slate-700 animate-spin" />
      </main>
    );
  }

  return (
    <>
      <main className="min-h-screen bg-slate-950 pb-safe">
        <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push('/scale/products')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors flex-shrink-0"
            aria-label="Back to product list"
          >
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-100 leading-tight truncate">{displayTitle || 'Product'}</h1>
            <p className="text-xs text-slate-500 leading-tight">Scale mapping &amp; print</p>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                scaleStatus === 'ok' ? 'bg-emerald-500' : scaleStatus === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-xs text-slate-400 font-medium">Scale</span>
          </div>
        </div>

        <div className="px-4 py-5 flex flex-col gap-4">
          {error && (
            <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-300 flex-1">{error}</p>
            </div>
          )}

          {/* Lock banner */}
          <div className="flex items-center gap-2 bg-blue-950/40 border border-blue-900 rounded-xl px-3 py-2.5">
            <Lock className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <p className="text-xs text-blue-300">
              This product is locked in. Any weight signal from the scale prints a label for it immediately — no confirmation needed.
            </p>
          </div>

          {/* Label preview — lets you see and print without waiting on a scale signal */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center gap-2">
              <span className="w-1 h-4 bg-emerald-500 rounded-full" />
              <h2 className="text-sm font-semibold text-slate-200">Label Preview</h2>
            </div>
            <div className="px-4 pb-4 flex flex-col gap-3">
              <div className="mx-auto w-full max-w-[220px]">
                <div className="relative bg-white rounded-xl overflow-hidden shadow-lg ring-1 ring-slate-700" style={{ aspectRatio: '3/2' }}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-[66.6%] flex flex-col items-start gap-1 px-2 py-2">
                      <p className="text-[8px] font-bold text-slate-900 leading-tight line-clamp-3 break-words w-full">{displayTitle || 'Product'}</p>
                      <p className="text-[7px] text-slate-700 leading-tight"><span className="font-bold">Weight:</span> {previewWeight || '—'}</p>
                      <p className="text-[7px] text-slate-700 leading-tight"><span className="font-bold">Packing Date:</span> {formatEst(new Date())}</p>
                      <div className="flex justify-center w-full mt-0.5">
                        <QRCodeSVG
                          value={buildQrPayload({ plu: plu || null, productTitle: productTitle || 'Product', variantTitle, itemWeight: previewWeight || '0.00 lb' }, formatEst(new Date()), 'preview')}
                          size={48}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#0f172a"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">Weight</label>
                <input
                  type="text"
                  value={manualWeight}
                  onChange={(e) => setManualWeight(e.target.value)}
                  placeholder={scale.lastReading?.itemWeight ? `Last reading: ${scale.lastReading.itemWeight}` : 'e.g. 1.23 lb'}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-600 mt-1">
                  Auto-fills from the scale's last reading. Type a weight here to preview/print without waiting on the scale.
                </p>
              </div>

              <button
                onClick={handleManualPrint}
                disabled={!previewWeight.trim()}
                className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl text-sm font-bold transition-all"
              >
                <Printer className="w-4 h-4" /> Print Label
              </button>
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
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
            </div>
          </div>

          {/* Scale waiting indicator */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <div className="relative">
                <div
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                    scaleStatus === 'ok' || scaleStatus === 'busy' ? 'bg-emerald-950/60 border-emerald-800' : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${scaleStatus === 'ok' || scaleStatus === 'busy' ? 'text-emerald-400' : 'text-slate-500'}`} />
                </div>
                {(scaleStatus === 'ok' || scaleStatus === 'busy') && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 animate-pulse" />
                )}
              </div>
              <p className="text-sm font-semibold text-slate-200">
                {scaleStatus === 'ok' ? 'Waiting for weight…' : scaleStatus === 'busy' ? 'Receiving signal…' : 'Scale not connected'}
              </p>
              {printCount > 0 && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {printCount} label{printCount !== 1 ? 's' : ''} printed this session
                </p>
              )}
            </div>
          </div>

          {/* Editable mapping */}
          <div className="border border-slate-800 rounded-2xl bg-slate-900 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Mapping</h2>
              <button
                onClick={() => handleSave(!pinned)}
                disabled={saving}
                aria-label={pinned ? 'Unpin' : 'Pin'}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                  pinned ? 'text-amber-400 bg-amber-950/30' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                {pinned ? 'Pinned' : 'Pin'}
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Scale Item Number (optional)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={itemNumber}
                onChange={(e) => setItemNumber(e.target.value)}
                placeholder="No slot assigned"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                PLU (Shopify barcode)
              </label>
              <input
                type="text"
                value={plu}
                onChange={(e) => setPlu(e.target.value)}
                placeholder="e.g. 4011"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-600 mt-1">Changing this also updates the variant&apos;s barcode in Shopify.</p>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Price per lb ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={pricePerLb}
                onChange={(e) => setPricePerLb(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {savedAt && (
              <p className="text-xs text-emerald-400">Saved at {formatEst(savedAt)} EST</p>
            )}

            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-all"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save
            </button>
          </div>

          {/* Diagnostics — verify connection/listener/last-signal state directly instead of guessing */}
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
                <p>lastReading.timestamp: <span className="text-slate-200">{scale.lastReading?.timestamp ? formatEst(scale.lastReading.timestamp) : '(none)'}</span></p>
                <p className="break-all">lastRawBuffer: <span className="text-slate-200">{scale.lastRawBuffer ? JSON.stringify(scale.lastRawBuffer) : '(none)'}</span></p>
                <p className="text-slate-600 mt-1">Also check the browser console for [scale] log lines — every connect, chunk, parse, and stall is logged there.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {conflict && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <h2 className="text-sm font-semibold text-slate-200">Item {conflict.itemNumber} is mapped elsewhere</h2>
            </div>
            <p className="text-xs text-slate-400">
              The scale recalled item {conflict.itemNumber}, which is mapped to a different product. Which one should this label be for?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={resolveConflictAsMapped}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 transition-colors"
              >
                <p className="text-sm font-medium text-slate-200 truncate">{conflict.mappedTitle}</p>
                <p className="text-xs text-slate-500">Item {conflict.itemNumber} · PLU {conflict.mappedPlu || 'N/A'}</p>
              </button>
              <button
                onClick={resolveConflictAsOpened}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-950 hover:bg-slate-800 transition-colors"
              >
                <p className="text-sm font-medium text-slate-200 truncate">{displayTitle || 'Product'}</p>
                <p className="text-xs text-slate-500">Currently open on this page · PLU {plu || 'N/A'}</p>
              </button>
            </div>
            <button
              onClick={() => setConflict(null)}
              className="w-full h-10 flex items-center justify-center text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel — don&apos;t print
            </button>
          </div>
        </div>
      )}

      <PrintLabelPortal payload={printPayload} labelSizeKey={labelSizeKey} />
    </>
  );
}
