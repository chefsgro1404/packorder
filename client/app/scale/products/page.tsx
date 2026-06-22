'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Pencil, Trash2, X, Check, AlertCircle, Package, RefreshCw, Search, Pin, PinOff } from 'lucide-react';
import { ProductLookup, AssignProduct } from '@/lib/types';

interface FormState {
  itemNumber: string;
  plu: string;
  productTitle: string;
  pricePerLb: string;
}

const emptyForm: FormState = { itemNumber: '', plu: '', productTitle: '', pricePerLb: '' };

export default function ScaleProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItemNumber, setEditingItemNumber] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pinningKey, setPinningKey] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssignProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scale/products');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load products');
      }
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(q.trim())}&pageSize=10`);
      const data = await res.json();
      setSearchResults(data.products ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const openAddForm = () => {
    setEditingItemNumber(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (p: ProductLookup) => {
    setEditingItemNumber(p.itemNumber);
    setForm({
      itemNumber: p.itemNumber ?? '',
      plu: p.plu,
      productTitle: p.productTitle,
      pricePerLb: String(p.pricePerLb),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingItemNumber(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.itemNumber.trim() || !form.plu.trim() || !form.productTitle.trim()) {
      setError('Item number, PLU, and product title are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/scale/products', {
        method: editingItemNumber ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: form.itemNumber.trim(),
          plu: form.plu.trim(),
          productTitle: form.productTitle.trim(),
          pricePerLb: parseFloat(form.pricePerLb) || 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      closeForm();
      await fetchProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: ProductLookup) => {
    const key = p.variantId ?? p.itemNumber ?? '';
    setDeletingKey(key);
    setError(null);
    try {
      const res = p.variantId
        ? await fetch(`/api/scale/products/by-variant?variantId=${encodeURIComponent(p.variantId)}`, { method: 'DELETE' })
        : await fetch(`/api/scale/products?itemNumber=${encodeURIComponent(p.itemNumber ?? '')}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      setProducts((prev) => prev.filter((x) => (x.variantId ?? x.itemNumber) !== key));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleTogglePin = async (p: ProductLookup) => {
    const key = p.variantId ?? p.itemNumber ?? '';
    setPinningKey(key);
    setError(null);
    try {
      if (p.variantId) {
        const res = await fetch('/api/scale/products/by-variant', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: p.productId,
            variantId: p.variantId,
            productTitle: p.productTitle,
            variantTitle: p.variantTitle,
            imageUrl: p.imageUrl,
            itemNumber: p.itemNumber,
            plu: p.plu,
            pricePerLb: p.pricePerLb,
            pinned: !p.pinned,
          }),
        });
        if (!res.ok) throw new Error('Failed to update pin');
      } else {
        const res = await fetch('/api/scale/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemNumber: p.itemNumber,
            plu: p.plu,
            productTitle: p.productTitle,
            pricePerLb: p.pricePerLb,
            pinned: !p.pinned,
          }),
        });
        if (!res.ok) throw new Error('Failed to update pin');
      }
      await fetchProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pin');
    } finally {
      setPinningKey(null);
    }
  };

  const sortedProducts = [...products].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <main className="min-h-screen bg-slate-950 pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/scale')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors flex-shrink-0"
          aria-label="Back to Scale & Print"
        >
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-100 leading-tight">Select Product</h1>
          <p className="text-xs text-slate-500 leading-tight">Search the catalog or pick a saved product</p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 transition-colors px-3 py-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> Slot Only
        </button>
      </div>

      <div className="px-4 py-5 flex flex-col gap-4">
        {error && (
          <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-900 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <p className="text-sm text-rose-300 flex-1">{error}</p>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X className="w-4 h-4 text-rose-400" />
            </button>
          </div>
        )}

        {/* Catalog search */}
        <div className="border border-slate-800 rounded-2xl bg-slate-900 p-4 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search the synced catalog by product title or SKU…"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          {(searchLoading || searchResults.length > 0 || query.trim().length >= 2) && (
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {searchLoading && <p className="text-xs text-slate-500 text-center py-4">Searching…</p>}
              {!searchLoading && query.trim().length >= 2 && searchResults.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">No matches</p>
              )}
              {searchResults.map((p) => (
                <div key={p.productId} className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                  <p className="text-xs font-medium text-slate-300 px-1 pb-1">{p.productTitle}</p>
                  {p.variants.map((v) => (
                    <button
                      key={v.variantId}
                      onClick={() => router.push(`/scale/products/${encodeURIComponent(v.variantId)}`)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-900 text-left"
                    >
                      <span className="text-xs text-slate-400 truncate">{v.variantTitle}</span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">{v.barcode || 'no barcode'}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Legacy slot-only add/edit form */}
        {showForm && (
          <div className="border border-slate-800 rounded-2xl bg-slate-900 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">
                {editingItemNumber ? `Edit Item ${editingItemNumber}` : 'Map a Scale Slot'}
              </h2>
              <button onClick={closeForm} aria-label="Cancel">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Scale Item Number
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.itemNumber}
                disabled={!!editingItemNumber}
                onChange={(e) => setForm((f) => ({ ...f, itemNumber: e.target.value }))}
                placeholder="e.g. 12345"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">PLU</label>
              <input
                type="text"
                value={form.plu}
                onChange={(e) => setForm((f) => ({ ...f, plu: e.target.value }))}
                placeholder="e.g. 4011"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Product Title
              </label>
              <input
                type="text"
                value={form.productTitle}
                onChange={(e) => setForm((f) => ({ ...f, productTitle: e.target.value }))}
                placeholder="e.g. Ground Beef 80/20"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wide">
                Price per lb ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.pricePerLb}
                onChange={(e) => setForm((f) => ({ ...f, pricePerLb: e.target.value }))}
                placeholder="0.00"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 mt-1">
              <button
                onClick={closeForm}
                className="flex-1 h-11 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm text-slate-300 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-11 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-sm font-bold transition-all"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingItemNumber ? 'Save Changes' : 'Save Slot'}
              </button>
            </div>
          </div>
        )}

        {/* Mapped/saved products */}
        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <RefreshCw className="w-5 h-5 text-slate-700 animate-spin" />
              <p className="text-sm text-slate-600">Loading products…</p>
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Package className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No products saved yet — search above to get started</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60">
              {sortedProducts.map((p) => {
                const key = p.variantId ?? p.itemNumber ?? '';
                return (
                  <div
                    key={key}
                    onClick={() => p.variantId && router.push(`/scale/products/${encodeURIComponent(p.variantId)}`)}
                    className={`flex items-center gap-3 px-4 py-3 ${p.variantId ? 'cursor-pointer hover:bg-slate-900/60' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{p.productTitle}</p>
                      <p className="text-xs text-slate-500">
                        {p.itemNumber ? `Item ${p.itemNumber} · ` : ''}PLU {p.plu} · ${p.pricePerLb.toFixed(2)}/lb
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePin(p); }}
                      disabled={pinningKey === key}
                      aria-label={p.pinned ? `Unpin ${p.productTitle}` : `Pin ${p.productTitle}`}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                        p.pinned ? 'text-amber-400 hover:bg-amber-950/30' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {p.pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                    </button>
                    {!p.variantId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(p); }}
                        aria-label={`Edit ${p.productTitle}`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                      disabled={deletingKey === key}
                      aria-label={`Delete ${p.productTitle}`}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors disabled:opacity-40"
                    >
                      {deletingKey === key ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
