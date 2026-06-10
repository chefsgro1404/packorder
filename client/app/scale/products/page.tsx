'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Pencil, Trash2, X, Check, AlertCircle, Package, RefreshCw } from 'lucide-react';
import { ProductLookup } from '@/lib/types';

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
  const [deletingItemNumber, setDeletingItemNumber] = useState<string | null>(null);

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

  const openAddForm = () => {
    setEditingItemNumber(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (p: ProductLookup) => {
    setEditingItemNumber(p.itemNumber);
    setForm({
      itemNumber: p.itemNumber,
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

  const handleDelete = async (itemNumber: string) => {
    setDeletingItemNumber(itemNumber);
    setError(null);
    try {
      const res = await fetch(`/api/scale/products?itemNumber=${encodeURIComponent(itemNumber)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      setProducts((prev) => prev.filter((p) => p.itemNumber !== itemNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingItemNumber(null);
    }
  };

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
          <h1 className="text-base font-bold text-slate-100 leading-tight">Manage Products</h1>
          <p className="text-xs text-slate-500 leading-tight">Item number → PLU / title / price-per-lb mapping</p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 transition-colors px-3 py-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> Add
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

        {/* Add/edit form */}
        {showForm && (
          <div className="border border-slate-800 rounded-2xl bg-slate-900 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">
                {editingItemNumber ? `Edit Item ${editingItemNumber}` : 'Add Product'}
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
                {editingItemNumber ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </div>
        )}

        {/* Product list */}
        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <RefreshCw className="w-5 h-5 text-slate-700 animate-spin" />
              <p className="text-sm text-slate-600">Loading products…</p>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Package className="w-5 h-5 text-slate-700" />
              <p className="text-sm text-slate-600">No products mapped yet</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-800/60">
              {products.map((p) => (
                <div key={p.itemNumber} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{p.productTitle}</p>
                    <p className="text-xs text-slate-500">
                      Item {p.itemNumber} · PLU {p.plu} · ${p.pricePerLb.toFixed(2)}/lb
                    </p>
                  </div>
                  <button
                    onClick={() => openEditForm(p)}
                    aria-label={`Edit ${p.productTitle}`}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(p.itemNumber)}
                    disabled={deletingItemNumber === p.itemNumber}
                    aria-label={`Delete ${p.productTitle}`}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors disabled:opacity-40"
                  >
                    {deletingItemNumber === p.itemNumber ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
