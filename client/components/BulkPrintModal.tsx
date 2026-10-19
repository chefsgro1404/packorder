'use client';

import { useState } from 'react';
import { Printer, X, Package } from 'lucide-react';

export interface BulkPrintModalProps {
  productTitle: string;
  variantTitle: string | null;
  orderedQuantity: number;
  vendorName?: string | null;
  onConfirm: (quantity: number, weight: string, lotNo: string, expiryDate: string) => void;
  onClose: () => void;
}

export function BulkPrintModal({ productTitle, variantTitle, orderedQuantity, vendorName, onConfirm, onClose }: BulkPrintModalProps) {
  const [quantity, setQuantity] = useState(String(orderedQuantity));
  const [weight, setWeight] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const parsedQty = parseInt(quantity, 10);
  const isValid = !isNaN(parsedQty) && parsedQty > 0;
  const delta = isValid ? orderedQuantity - parsedQty : 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(parsedQty, weight.trim(), lotNo.trim(), expiryDate.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl px-5 py-6 flex flex-col gap-4 z-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-900/60 border border-blue-800 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Package className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-100 leading-snug">{productTitle}</p>
              {variantTitle && variantTitle !== 'Default Title' && (
                <p className="text-xs text-slate-400 mt-0.5">{variantTitle}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                <p className="text-xs text-slate-500">PO ordered: {orderedQuantity} units</p>
                {vendorName && (
                  <p className="text-xs text-blue-400 font-medium">{vendorName}</p>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quantity */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            How many received?
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            autoFocus
            className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-base font-semibold text-slate-100 focus:outline-none focus:border-blue-500 transition-colors"
          />
          {isValid && delta > 0 && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              {delta} unit{delta !== 1 ? 's' : ''} short — Shopify inventory will be adjusted by −{delta}
            </p>
          )}
          {isValid && delta < 0 && (
            <p className="text-xs text-violet-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
              {Math.abs(delta)} extra unit{Math.abs(delta) !== 1 ? 's' : ''} — Shopify inventory will be adjusted by +{Math.abs(delta)}
            </p>
          )}
          {isValid && delta === 0 && (
            <p className="text-xs text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Full quantity received
            </p>
          )}
        </div>

        {/* Optional fields row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Lot No <span className="text-slate-600 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. LOT-2024-01"
              value={lotNo}
              onChange={e => setLotNo(e.target.value)}
              className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Expiry <span className="text-slate-600 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 2025-06-30"
              value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Weight (optional) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Weight per label <span className="text-slate-600 normal-case font-normal">(optional)</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="e.g. 500g or 1.2 kg"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <p className="text-[11px] text-slate-600">Applied to all labels in this batch</p>
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
            disabled={!isValid}
            className="flex-1 h-11 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm text-white font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print {isValid ? parsedQty : '—'} Label{isValid && parsedQty !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
