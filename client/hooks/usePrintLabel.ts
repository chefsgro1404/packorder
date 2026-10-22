import { useCallback, useEffect, useRef, useState } from 'react';
import { generateSn, buildQrPayload } from '@/lib/scaleLabel';
import { formatEst } from '@/lib/dateFormat';
import { getLabelWindowCSS, getBatchLabelWindowCSS, type LabelSizeKey } from '@/lib/labelSizes';
import type { PrintPayload } from '@/components/PrintLabelPortal';

export function usePrintLabel(labelSizeKey: LabelSizeKey = '3x2') {
  const [printPayload, setPrintPayload] = useState<PrintPayload | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const [batchPrintPayloads, setBatchPrintPayloads] = useState<PrintPayload[] | null>(null);

  // Ref so the effect always reads the latest size without re-registering on size change.
  const labelSizeKeyRef = useRef(labelSizeKey);
  labelSizeKeyRef.current = labelSizeKey;

  // Pre-opened window passed in from bulk-print flows where window.open must fire
  // before async work begins (user gesture activation expires after ~5 s).
  const preOpenedBatchWin = useRef<Window | null>(null);

  // Tracks how many times each base SN has been reprinted this session.
  const reprintCounts = useRef(new Map<string, number>());

  useEffect(() => {
    if (printRequestId === 0) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById('print-label');
      if (!el) return;

      // Try a dedicated popup window first — cleaner experience, auto-closes after print.
      // This only works when called from a direct user gesture (click/keydown). Scale
      // auto-print comes from a Web Serial data callback, which browsers treat as
      // non-user-gesture, so window.open is silently blocked and returns null.
      // In that case fall back to window.print() on the main window; the @media print
      // CSS from PrintLabelPortal already hides the app and shows only #print-label.
      const win = window.open('', '_blank', `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`);
      if (win) {
        const css = getLabelWindowCSS(labelSizeKeyRef.current);
        win.document.write(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${el.innerHTML}</body></html>`);
        win.document.close();
        win.focus();
        win.onafterprint = () => win.close();
        win.print();
      } else {
        window.print();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [printRequestId]);

  // Callers pass a pre-encrypted qrPayload; this hook just renders it.
  // If prebuiltQrPayload is omitted the plaintext payload is built here as a fallback
  // (used only when the caller cannot do async encryption, e.g. preview).
  const triggerPrint = useCallback(
    (
      item: { plu: string | null; productTitle: string; variantTitle?: string | null; itemWeight?: string | null },
      sn?: string,
      prebuiltQrPayload?: string
    ) => {
      const printedAtEst = formatEst(new Date());
      const finalSn = sn ?? generateSn();
      const qrPayload = prebuiltQrPayload ?? buildQrPayload(item, finalSn);
      const payload: PrintPayload = { productTitle: item.productTitle, variantTitle: item.variantTitle, qrPayload, itemWeight: item.itemWeight, printedAtEst, sn: finalSn };
      setPrintPayload(payload);
      setPrintRequestId((n) => n + 1);
      setPrintedAt(new Date());
      return { payload, sn: finalSn, printedAtEst, qrPayload };
    },
    []
  );

  // Computes the next reprint SN (incrementing the session counter) WITHOUT triggering
  // a print. Callers use this to know the SN before encrypting the new payload, then
  // pass the result to printVerbatim.
  const buildReprintSn = useCallback((sn: string) => {
    const baseSn = sn.replace(/-r\d+$/, '');
    const n = (reprintCounts.current.get(baseSn) ?? 0) + 1;
    reprintCounts.current.set(baseSn, n);
    return `${baseSn}-r${String(n).padStart(3, '0')}`;
  }, []);

  // Batch print: opens a single popup window with all labels on separate pages.
  // Falls back to single-label print when only one payload is given.
  useEffect(() => {
    if (!batchPrintPayloads || batchPrintPayloads.length === 0) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById('batch-print-labels');
      if (!el) return;
      const css = getBatchLabelWindowCSS(labelSizeKeyRef.current);
      // Use a pre-opened window when available (avoids popup-block after long async work).
      const win = preOpenedBatchWin.current ?? window.open('', '_blank', `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`);
      preOpenedBatchWin.current = null;
      if (win) {
        win.document.write(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${el.innerHTML}</body></html>`);
        win.document.close();
        win.focus();
        win.onafterprint = () => win.close();
        win.print();
      } else {
        window.print();
      }
      setBatchPrintPayloads(null);
    });
    return () => cancelAnimationFrame(id);
  }, [batchPrintPayloads]);

  // Renders a fully-assembled payload directly. Callers are responsible for building
  // the reprint SN (via buildReprintSn) and re-encrypting the QR payload before calling.
  const printVerbatim = useCallback((payload: PrintPayload) => {
    setPrintPayload(payload);
    setPrintRequestId((n) => n + 1);
    setPrintedAt(new Date());
  }, []);

  const batchPrint = useCallback((payloads: PrintPayload[], preOpened?: Window | null) => {
    if (payloads.length === 0) return;
    if (preOpened) preOpenedBatchWin.current = preOpened;
    if (payloads.length === 1) { printVerbatim(payloads[0]); return; }
    setBatchPrintPayloads(payloads);
  }, [printVerbatim]);

  const reset = useCallback(() => setPrintedAt(null), []);

  return { printPayload, batchPrintPayloads, printedAt, triggerPrint, printVerbatim, batchPrint, buildReprintSn, reset };
}
