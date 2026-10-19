'use client';

import { useState } from 'react';
import { Weight, X } from 'lucide-react';

export interface LotReceivingModalProps {
  productTitle: string;
  variantTitle: string | null;
  vendorName?: string | null;
  onConfirm: (totalWeightLbs: number, barcodeCount: number, lotNo: string, expiryDate: string) => void;
  onClose: () => void;
}

export function LotReceivingModal({
  productTitle,
  variantTitle,
  vendorName,
  onConfirm,
  onClose,
}: LotReceivingModalProps) {
  const [totalWeight, setTotalWeight] = useState('');
  const [barcodeCount, setBarcodeCount] = useState(1);
  const [lotNo, setLotNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const parsedWeight = parseFloat(totalWeight);
  const isValid = !isNaN(parsedWeight) && parsedWeight > 0;
  const weightPerLabel = isValid ? (parsedWeight / barcodeCount).toFixed(2) : null;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(parsedWeight, barcodeCount, lotNo.trim(), expiryDate.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl px-5 py-6 flex flex-col gap-4 z-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-900/60 border border-amber-800 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Weight className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-widest mb-0.5">Lot Receiving</p>
              <p className="text-sm font-bold text-slate-100 leading-snug">{productTitle}</p>
              {variantTitle && variantTitle !== 'Default Title' && (
                <p className="text-xs text-slate-400 mt-0.5">{variantTitle}</p>
              )}
              {vendorName && (
                <p className="text-xs text-amber-400 font-medium mt-0.5">{vendorName}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Total weight */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Total Weight (lbs) <span className="text-rose-500">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            placeholder="e.g. 400"
            value={totalWeight}
            onChange={e => setTotalWeight(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            autoFocus
            className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-base font-semibold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
          />
        </div>

        {/* Barcode count */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Number of Barcodes <span className="text-rose-500">*</span>
          </label>
          <div className="flex gap-2">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setBarcodeCount(n)}
                className={`flex-1 h-11 rounded-xl text-sm font-bold transition-colors ${
                  barcodeCount === n
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-amber-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {isValid && weightPerLabel && (
            <p className="text-xs text-slate-500">≈ {weightPerLabel} lbs per label</p>
          )}
        </div>

        {/* Lot No + Expiry */}
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
              className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
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
              className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
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
            className="flex-1 h-11 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm text-white font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Weight className="w-4 h-4" />
            Print {barcodeCount} Lot Label{barcodeCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
