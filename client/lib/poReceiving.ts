export interface PoReceivingInput {
  /** Quantity on the PO line. */
  orderedQty: number;
  /** Labels that actually printed in the bulk print. */
  printedCount: number;
  /** Qty Received typed by staff in the bulk print modal (standard receiving). */
  receivedQty?: number;
  /** Total weight typed in lot receiving — the PO qty for these products is in lbs. */
  lotTotalWeightLbs?: number;
}

export interface PoReceivingPlan {
  /** The counted quantity. Used for the PO approval, the Shopify adjustment and the processing session. */
  receivedQty: number;
  discrepancyQty: number | null;
  discrepancyType: 'short' | 'over' | null;
}

// What staff counted always wins over the PO quantity. A mismatch is recorded as a
// discrepancy, but never replaces the counted quantity — not for lot products either.
// Barcodes printed only decide how many labels exist, never how much stock was received.
export function planPoReceiving({ orderedQty, printedCount, receivedQty, lotTotalWeightLbs }: PoReceivingInput): PoReceivingPlan {
  const counted = lotTotalWeightLbs !== undefined
    // The approval endpoint takes whole units; keep any real weight at least 1
    ? Math.max(1, Math.round(lotTotalWeightLbs))
    : (receivedQty ?? printedCount);
  const diff = counted - orderedQty;
  return {
    receivedQty: counted,
    discrepancyQty: diff === 0 ? null : Math.abs(diff),
    discrepancyType: diff === 0 ? null : diff < 0 ? 'short' : 'over',
  };
}

/** Quantity a processing session works through: what was received, or the PO qty before receiving. */
export function sessionQtyBasis(li: { quantityOrdered: number; quantityReceived?: number | null } | undefined): number {
  if (!li) return 0;
  return li.quantityReceived && li.quantityReceived > 0 ? li.quantityReceived : li.quantityOrdered;
}
