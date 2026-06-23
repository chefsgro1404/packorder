'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  RefreshCw,
  AlertCircle,
  Pin,
  PinOff,
  Radio,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { type ParsedReading } from '@/hooks/useScale';
import { useScaleContext } from '@/contexts/ScaleContext';
import { usePrintLabel } from '@/hooks/usePrintLabel';
import { PrintLabelPortal } from '@/components/PrintLabelPortal';
import { formatEst } from '@/lib/dateFormat';
import { ScaleProduct } from '@/lib/types';

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
  const { printPayload, triggerPrint } = usePrintLabel();

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

  const logPrintedLabel = useCallback(async (weight: string, qrPayload: string, printedAtEst: string, sn: string) => {
    try {
      await fetch('/api/scale/print-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: itemNumber || '',
          plu: plu || 'N/A',
          productTitle: displayTitle,
          itemWeight: weight,
          printedAtEst,
          qrPayload,
          sn,
        }),
      });
    } catch (err) {
      console.error('[scale/products] failed to log printed label:', err);
    }
  }, [itemNumber, plu, displayTitle]);

  // Locked-and-auto-print: any weight reading while this page is open prints a label
  // for this product immediately, regardless of what item number the scale reports.
  const handleReading = useCallback(
    async (reading: ParsedReading) => {
      const { sn, printedAtEst, qrPayload } = triggerPrint({
        plu: plu || null,
        productTitle: displayTitle,
        itemWeight: reading.itemWeight,
      });
      setPrintCount((n) => n + 1);
      await logPrintedLabel(reading.itemWeight, qrPayload, printedAtEst, sn);
    },
    [triggerPrint, plu, displayTitle, logPrintedLabel]
  );

  const scale = useScaleContext();

  useEffect(() => {
    scale.setReadingHandler(handleReading);
    return () => scale.setReadingHandler(null);
  }, [scale, handleReading]);

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

          {/* Scale waiting indicator */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <div className="relative">
                <div
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                    scaleStatus === 'ok' ? 'bg-emerald-950/60 border-emerald-800' : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${scaleStatus === 'ok' ? 'text-emerald-400' : 'text-slate-500'}`} />
                </div>
                {scaleStatus === 'ok' && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950 animate-pulse" />
                )}
              </div>
              <p className="text-sm font-semibold text-slate-200">
                {scaleStatus === 'ok' ? 'Waiting for weight…' : 'Scale not connected'}
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
        </div>
      </main>

      <PrintLabelPortal payload={printPayload} />
    </>
  );
}
