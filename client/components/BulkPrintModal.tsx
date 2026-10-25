'use client';

import { useState } from 'react';
import { Printer, X, Package, Weight } from 'lucide-react';

export interface BulkPrintModalProps {
  productTitle: string;
  variantTitle: string | null;
  orderedQuantity: number;
  vendorName?: string | null;
  isLotReceiving?: boolean;
  inventoryItemId?: string | null;
  onConfirm: (quantity: number, weight: string, lotNo: string, expiryDate: string, lotTotalWeightLbs?: number, applyAdjust?: boolean) => void;
  onClose: () => void;
}

export function BulkPrintModal({
  productTitle,
  variantTitle,
  orderedQuantity,
  vendorName,
  isLotReceiving = false,
  inventoryItemId,
  onConfirm,
  onClose,
}: BulkPrintModalProps) {
  const [quantity, setQuantity] = useState(String(orderedQuantity));
  const [weight, setWeight] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [applyAdjust, setApplyAdjust] = useState(false);

  // Lot receiving state (weight-based products: beef, goat, lamb)
  const [totalWeightLbs, setTotalWeightLbs] = useState('');
  const [barcodeCount, setBarcodeCount] = useState(1);

  const parsedQty = parseInt(quantity, 10);
  const isCountValid = !isNaN(parsedQty) && parsedQty > 0;
  const delta = isCountValid ? orderedQuantity - parsedQty : 0;

  const parsedWeight = parseFloat(totalWeightLbs);
  const isWeightValid = !isNaN(parsedWeight) && parsedWeight > 0;
  const weightPerLabel = isWeightValid ? (parsedWeight / barcodeCount).toFixed(2) : null;

  const isValid = isLotReceiving ? isWeightValid : isCountValid;

  const handleConfirm = () => {
    if (!isValid) return;
    if (isLotReceiving) {
      const labelWeight = `${weightPerLabel} lbs (LOT)`;
      onConfirm(barcodeCount, labelWeight, lotNo.trim(), expiryDate.trim(), parsedWeight, false);
    } else {
      onConfirm(parsedQty, weight.trim(), lotNo.trim(), expiryDate.trim(), undefined, applyAdjust);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-2xl shadow-2xl px-5 py-6 flex flex-col gap-4 z-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isLotReceiving ? 'bg-amber-900/60 border-amber-800' : 'bg-blue-900/60 border-blue-800'
            }`}>
              {isLotReceiving
                ? <Weight className="w-4 h-4 text-amber-400" />
                : <Package className="w-4 h-4 text-blue-400" />
              }
            </div>
            <div className="min-w-0">
              {isLotReceiving && (
                <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-widest mb-0.5">Lot Receiving</p>
              )}
              <p className="text-sm font-bold text-slate-100 leading-snug">{productTitle}</p>
              {variantTitle && variantTitle !== 'Default Title' && (
                <p className="text-xs text-slate-400 mt-0.5">{variantTitle}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {!isLotReceiving && (
                  <p className="text-xs text-slate-500">PO ordered: {orderedQuantity} units</p>
                )}
                {vendorName && (
                  <p className={`text-xs font-medium ${isLotReceiving ? 'text-amber-400' : 'text-blue-400'}`}>{vendorName}</p>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLotReceiving ? (
          /* ── Lot receiving: total weight + barcode count ── */
          <>
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
                value={totalWeightLbs}
                onChange={e => setTotalWeightLbs(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
                autoFocus
                className="w-full h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-base font-semibold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

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
              {weightPerLabel && (
                <p className="text-xs text-slate-500">≈ {weightPerLabel} lbs per label</p>
              )}
            </div>
          </>
        ) : (
          /* ── Standard receiving: unit count ── */
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
            {isCountValid && delta === 0 && (
              <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Full quantity received
              </p>
            )}
            {isCountValid && delta !== 0 && !inventoryItemId && (
              <p className={`text-xs flex items-center gap-1.5 ${delta > 0 ? 'text-amber-400' : 'text-violet-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${delta > 0 ? 'bg-amber-400' : 'bg-violet-400'}`} />
                {delta > 0
                  ? `${delta} unit${delta !== 1 ? 's' : ''} short vs PO`
                  : `${Math.abs(delta)} extra unit${Math.abs(delta) !== 1 ? 's' : ''} vs PO`}
              </p>
            )}
            {isCountValid && delta !== 0 && inventoryItemId && (
              <label className="flex items-center gap-2.5 cursor-pointer select-none bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 mt-1">
                <input
                  type="checkbox"
                  checked={applyAdjust}
                  onChange={e => setApplyAdjust(e.target.checked)}
                  className="w-4 h-4 rounded accent-violet-500 flex-shrink-0 cursor-pointer"
                />
                <span className="text-xs text-slate-300">
                  Adjust Shopify inventory by{' '}
                  <span className={delta > 0 ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                    {delta > 0 ? `−${delta}` : `+${Math.abs(delta)}`}
                  </span>
                  {' '}({delta > 0 ? `${delta}-unit shortfall` : `${Math.abs(delta)}-unit overage`})
                </span>
              </label>
            )}
          </div>
        )}

        {/* Optional lot + expiry fields (shared by both modes) */}
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
              className={`w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-colors ${
                isLotReceiving ? 'focus:border-amber-500' : 'focus:border-blue-500'
              }`}
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
              className={`w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-colors ${
                isLotReceiving ? 'focus:border-amber-500' : 'focus:border-blue-500'
              }`}
            />
          </div>
        </div>

        {/* Weight per label (standard mode only) */}
        {!isLotReceiving && (
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
        )}

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
            className={`flex-1 h-11 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm text-white font-bold flex items-center justify-center gap-2 transition-colors ${
              isLotReceiving
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {isLotReceiving ? (
              <>
                <Weight className="w-4 h-4" />
                Print {barcodeCount} Lot Label{barcodeCount !== 1 ? 's' : ''}
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                Print {isCountValid ? parsedQty : '—'} Label{isCountValid && parsedQty !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
