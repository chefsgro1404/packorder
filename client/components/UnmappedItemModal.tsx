'use client';

import { useState, useRef, useCallback } from 'react';
import { Search, AlertTriangle, X, Check, RefreshCw } from 'lucide-react';
import { AssignProduct, AssignVariant } from '@/lib/types';

interface ChosenVariant {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string | null;
  imageUrl: string | null;
  plu: string;
}

export interface UnmappedItemModalProps {
  itemNumber: string;
  weight: string;
  onClose: () => void;
  onResolved: (chosen: ChosenVariant, mapping: { save: boolean; pricePerLb: number }) => void;
  /** When true: hides the "save mapping" option — used for item-0 reads with no current product */
  hideSave?: boolean;
}

export function UnmappedItemModal({ itemNumber, weight, onClose, onResolved, hideSave = false }: UnmappedItemModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssignProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<{ product: AssignProduct; variant: AssignVariant } | null>(null);
  const [pricePerLb, setPricePerLb] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(q.trim())}&pageSize=10`);
      const data = await res.json();
      setResults(data.products ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const chosenVariant: ChosenVariant | null = chosen
    ? {
        productId: chosen.product.productId,
        productTitle: chosen.product.productTitle,
        variantId: chosen.variant.variantId,
        variantTitle: chosen.variant.variantTitle !== 'Default Title' ? chosen.variant.variantTitle : null,
        imageUrl: chosen.product.imageUrl,
        plu: chosen.variant.barcode || '',
      }
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-slate-200">
              {hideSave ? 'No product loaded' : <>Item {itemNumber} isn&apos;t mapped</>}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {hideSave
            ? <>Scale weight is <span className="text-slate-300 font-medium">{weight}</span>. Search the catalog to find the product and print a label.</>
            : <>The scale recalled item {itemNumber} ({weight}), but it has no product mapped. Search the catalog to find it.</>
          }
        </p>

        {!chosenVariant && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search by product title or SKU…"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {searching && <p className="text-xs text-slate-500 text-center py-4">Searching…</p>}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">No matches</p>
              )}
              {results.map((p) => (
                <div key={p.productId} className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                  <p className="text-xs font-medium text-slate-300 px-1 pb-1">{p.productTitle}</p>
                  {p.variants.map((v) => (
                    <button
                      key={v.variantId}
                      onClick={() => setChosen({ product: p, variant: v })}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-900 text-left"
                    >
                      <span className="text-xs text-slate-400 truncate">{v.variantTitle}</span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">{v.barcode || 'no barcode'}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {chosenVariant && (
          <div className="flex flex-col gap-3">
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5">
              <p className="text-sm font-medium text-slate-200 truncate">{chosenVariant.productTitle}</p>
              <p className="text-xs text-slate-500">{chosenVariant.variantTitle || 'Default'} · PLU {chosenVariant.plu || 'N/A'}</p>
            </div>
            {!hideSave && (
              <div>
                <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                  Price per lb ($) — optional, only used if you save this mapping
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
            )}
            <div className="flex flex-col gap-2">
              {hideSave ? (
                <button
                  onClick={() => onResolved(chosenVariant, { save: false, pricePerLb: 0 })}
                  className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-bold transition-all"
                >
                  <Check className="w-4 h-4" /> Print Label
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onResolved(chosenVariant, { save: true, pricePerLb: parseFloat(pricePerLb) || 0 })}
                    className="w-full h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-bold transition-all"
                  >
                    <Check className="w-4 h-4" /> Map Item {itemNumber} &amp; Print
                  </button>
                  <button
                    onClick={() => onResolved(chosenVariant, { save: false, pricePerLb: 0 })}
                    className="w-full h-10 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 transition-all"
                  >
                    Print Only (don&apos;t save mapping)
                  </button>
                </>
              )}
              <button
                onClick={() => setChosen(null)}
                className="w-full h-9 flex items-center justify-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Choose a different product
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full h-9 flex items-center justify-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel — don&apos;t print
        </button>
      </div>
    </div>
  );
}
