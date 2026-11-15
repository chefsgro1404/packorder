'use client';

import { useState } from 'react';
import { Printer, X, Package, Weight, AlertTriangle, Tag } from 'lucide-react';

export interface BulkPrintModalProps {
  productTitle: string;
  variantTitle: string | null;
  orderedQuantity: number;
  vendorName?: string | null;
  isLotReceiving?: boolean;
  isLotProduct?: boolean;
  onConfirm: (barcodesToPrint: number, weight: string, lotNo: string, expiryDate: string, mfgDate: string, lotTotalWeightLbs?: number, receivedQty?: number) => void;
  onClose: () => void;
}

export function BulkPrintModal({
  productTitle,
  variantTitle,
  orderedQuantity,
  vendorName,
  isLotReceiving = false,
  isLotProduct = false,
  onConfirm,
  onClose,
}: BulkPrintModalProps) {
  const [receivedQty, setReceivedQty] = useState(String(orderedQuantity));
  const [barcodesToPrint, setBarcodesToPrint] = useState(String(orderedQuantity));
  const [weight, setWeight] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [mfgDate, setMfgDate] = useState('');

  // Lot receiving state (weight-based products)
  const [totalWeightLbs, setTotalWeightLbs] = useState('');
  const [barcodeCount, setBarcodeCount] = useState(1);

  const parsedReceived = parseInt(receivedQty, 10);
  const parsedBarcodes = parseInt(barcodesToPrint, 10);
  const receivedValid = !isNaN(parsedReceived) && parsedReceived > 0;
  const barcodesValid = !isNaN(parsedBarcodes) && parsedBarcodes > 0;
  const barcodesExceedReceived = receivedValid && barcodesValid && parsedBarcodes > parsedReceived;
  const isAutoLot = isLotProduct || (receivedValid && barcodesValid && parsedBarcodes !== parsedReceived);
  const hasDiscrepancy = receivedValid && parsedReceived !== orderedQuantity;

  const parsedWeight = parseFloat(totalWeightLbs);
  const isWeightValid = !isNaN(parsedWeight) && parsedWeight > 0;
  const weightPerLabel = isWeightValid ? (parsedWeight / barcodeCount).toFixed(2) : null;

  const isValid = isLotReceiving ? isWeightValid : (receivedValid && barcodesValid);

  const handleConfirm = () => {
    if (!isValid) return;
    if (isLotReceiving) {
      const labelWeight = `${weightPerLabel} lbs (LOT)`;
      onConfirm(barcodeCount, labelWeight, lotNo.trim(), expiryDate.trim(), mfgDate.trim(), parsedWeight);
    } else {
      onConfirm(parsedBarcodes, weight.trim(), lotNo.trim(), expiryDate.trim(), mfgDate.trim(), undefined, parsedReceived);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-t-3xl sm:rounded-2xl shadow-2xl px-5 py-6 flex flex-col gap-4 z-10">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isLotReceiving ? 'bg-amber-100 border-amber-200 dark:bg-amber-900/60 dark:border-amber-800' : 'bg-blue-100 border-blue-200 dark:bg-blue-900/60 dark:border-blue-800'
            }`}>
              {isLotReceiving
                ? <Weight className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                : <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              }
            </div>
            <div className="min-w-0">
              {isLotReceiving && (
                <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-widest mb-0.5">Lot Receiving</p>
              )}
              <p className="text-sm font-bold text-[var(--text-primary)] leading-snug">{productTitle}</p>
              {variantTitle && variantTitle !== 'Default Title' && (
                <p className="text-xs text-slate-400 mt-0.5">{variantTitle}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {!isLotReceiving && (
                  <p className="text-xs text-slate-500">PO ordered: {orderedQuantity} units</p>
                )}
                {vendorName && (
                  <p className={`text-xs font-medium ${isLotReceiving ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>{vendorName}</p>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)] transition-colors flex-shrink-0"
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
                className="w-full h-11 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-base font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber-500 transition-colors"
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
                        : 'bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-amber-700'
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
          /* ── Standard receiving: qty received + barcodes to print ── */
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Qty Received
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={receivedQty}
                  onChange={e => setReceivedQty(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
                  autoFocus
                  className="w-full h-11 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-base font-semibold text-[var(--text-primary)] focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  Barcodes to Print
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={barcodesToPrint}
                  onChange={e => setBarcodesToPrint(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
                  className={`w-full h-11 bg-[var(--bg-input)] border rounded-xl px-3 text-base font-semibold text-[var(--text-primary)] focus:outline-none transition-colors ${
                    barcodesExceedReceived ? 'border-orange-400 focus:border-orange-400' : 'border-[var(--border-color)] focus:border-blue-500'
                  }`}
                />
              </div>
            </div>

            {/* Status hints */}
            {barcodesExceedReceived && (
              <div className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Barcodes exceed received — will be flagged for analytics review
              </div>
            )}
            {isAutoLot && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Tag className="w-3.5 h-3.5 flex-shrink-0" />
                {isLotProduct
                  ? 'Lot product — will always be marked as lot'
                  : `Will be marked as lot (${parsedBarcodes} barcodes for ${parsedReceived} received)`}
              </div>
            )}
            {hasDiscrepancy && receivedValid && (
              <div className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {parsedReceived < orderedQuantity
                  ? `${orderedQuantity - parsedReceived} short vs PO — will be recorded as discrepancy`
                  : `${parsedReceived - orderedQuantity} over PO — will be recorded as discrepancy`}
              </div>
            )}
            {!hasDiscrepancy && receivedValid && !barcodesExceedReceived && parsedReceived === orderedQuantity && parsedBarcodes === parsedReceived && !isLotProduct && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 inline-block" />
                Full quantity received
              </div>
            )}
          </div>
        )}

        {/* Lot + date fields */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Lot No <span className="text-slate-600 normal-case font-normal">(optional — auto-generated if blank)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. LOT-2024-01"
              value={lotNo}
              onChange={e => setLotNo(e.target.value)}
              className={`w-full h-10 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors ${
                isLotReceiving ? 'focus:border-amber-500' : 'focus:border-blue-500'
              }`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                Mfg Date <span className="text-slate-600 normal-case font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={mfgDate}
                onChange={e => setMfgDate(e.target.value)}
                className={`w-full h-10 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-sm text-[var(--text-primary)] focus:outline-none transition-colors dark:[color-scheme:dark] ${
                  isLotReceiving ? 'focus:border-amber-500' : 'focus:border-blue-500'
                }`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                Expiry
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                className={`w-full h-10 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-sm text-[var(--text-primary)] focus:outline-none transition-colors dark:[color-scheme:dark] ${
                  isLotReceiving ? 'focus:border-amber-500' : 'focus:border-blue-500'
                }`}
              />
            </div>
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
              className="w-full h-10 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 transition-colors"
            />
            <p className="text-[11px] text-slate-600">Applied to all labels in this batch</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-11 bg-[var(--bg-input)] hover:bg-[var(--bg-elevated)] rounded-xl text-sm text-[var(--text-secondary)] font-medium transition-colors"
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
                Print {barcodesValid ? parsedBarcodes : '—'} Label{barcodesValid && parsedBarcodes !== 1 ? 's' : ''}
                {isAutoLot ? ' (Lot)' : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
