'use client';

import { useState, useRef, useCallback } from 'react';
import { Search, X, ArrowRight, RefreshCw } from 'lucide-react';
import { AssignProduct, AssignVariant } from '@/lib/types';

interface ChosenChild {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  inventoryItemId: string;
}

interface ManualTransformModalProps {
  parentProductTitle: string;
  onConfirm: (child: ChosenChild, parentUnits: number, childUnits: number) => void;
  onClose: () => void;
}

export function ManualTransformModal({ parentProductTitle, onConfirm, onClose }: ManualTransformModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssignProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<{ product: AssignProduct; variant: AssignVariant } | null>(null);
  const [parentUnits, setParentUnits] = useState('1');
  const [childUnits, setChildUnits] = useState('1');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(q.trim())}&pageSize=10`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.products ?? []);
      }
    } catch { /* silent */ }
    finally { setSearching(false); }
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setChosen(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 350);
  };

  const handleConfirm = () => {
    if (!chosen) return;
    const pUnits = Math.max(1, parseInt(parentUnits, 10) || 1);
    const cUnits = Math.max(1, parseInt(childUnits, 10) || 1);
    // inventoryItemId isn't available from the search endpoint — pass empty and resolve in page
    onConfirm(
      {
        variantId: chosen.variant.variantId,
        productTitle: chosen.product.productTitle,
        variantTitle: chosen.variant.variantTitle && chosen.variant.variantTitle !== 'Default Title'
          ? chosen.variant.variantTitle : null,
        inventoryItemId: '',
      },
      pUnits,
      cUnits,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl px-5 py-6 flex flex-col gap-4 z-10 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-100">Manual Transformation</p>
            <p className="text-xs text-slate-400 mt-0.5">
              From: <span className="text-violet-300">{parentProductTitle}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Search target product
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Product name or SKU…"
              value={query}
              onChange={handleQueryChange}
              autoFocus
              className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
            {searching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 animate-spin" />}
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && !chosen && (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {results.map(p => (
              <div key={p.productId}>
                {(p.variants ?? []).map(v => (
                  <button
                    key={v.variantId}
                    onClick={() => { setChosen({ product: p, variant: v }); setResults([]); }}
                    className="w-full flex items-start gap-2.5 text-left bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 rounded-xl px-3 py-2 mb-1 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 leading-snug">{p.productTitle}</p>
                      {v.variantTitle && v.variantTitle !== 'Default Title' && (
                        <p className="text-xs text-slate-400">{v.variantTitle}</p>
                      )}
                      {v.sku && <p className="text-xs text-slate-500 font-mono">SKU: {v.sku}</p>}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Chosen product */}
        {chosen && (
          <div className="flex items-center gap-2 bg-violet-950/40 border border-violet-800/60 rounded-xl px-3 py-2.5">
            <ArrowRight className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-violet-200 leading-snug">{chosen.product.productTitle}</p>
              {chosen.variant.variantTitle && chosen.variant.variantTitle !== 'Default Title' && (
                <p className="text-xs text-violet-400">{chosen.variant.variantTitle}</p>
              )}
            </div>
            <button onClick={() => setChosen(null)} className="w-6 h-6 flex items-center justify-center rounded text-violet-500 hover:text-violet-200 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Ratio */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Conversion ratio
          </label>
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <p className="text-[10px] text-slate-500">Parent units consumed</p>
              <input
                type="number"
                min={1}
                value={parentUnits}
                onChange={e => setParentUnits(e.target.value)}
                className="h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm font-semibold text-slate-100 text-center focus:outline-none focus:border-violet-500 transition-colors"
              />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0 mt-4" />
            <div className="flex flex-col gap-1 flex-1">
              <p className="text-[10px] text-slate-500">Child units created</p>
              <input
                type="number"
                min={1}
                value={childUnits}
                onChange={e => setChildUnits(e.target.value)}
                className="h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm font-semibold text-slate-100 text-center focus:outline-none focus:border-violet-500 transition-colors"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            e.g. 1 → 2 means 1 parent unit yields 2 child units (splitting)
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-11 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!chosen}
            className="flex-1 h-11 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm text-white font-bold transition-colors"
          >
            Apply Transform
          </button>
        </div>
      </div>
    </div>
  );
}
