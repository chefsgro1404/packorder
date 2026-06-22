import { useCallback, useEffect, useState } from 'react';
import { generateSn, buildQrPayload } from '@/lib/scaleLabel';
import { formatEst } from '@/lib/dateFormat';
import type { PrintPayload } from '@/components/PrintLabelPortal';

export function usePrintLabel() {
  const [printPayload, setPrintPayload] = useState<PrintPayload | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (printRequestId === 0) return;
    // Wait a frame for React to render #print-label with the QR SVG, then open a clean print window.
    const id = requestAnimationFrame(() => {
      const el = document.getElementById('print-label');
      if (!el) return;
      const win = window.open('', '_blank', `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`);
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head><style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @page { size: 3in 2in; margin: 0; }
        html, body { width: 3in; height: 2in; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-label-inner { width: 3in; height: 2in; display: flex; align-items: center; justify-content: center; }
        .print-label-content { width: 2in; display: flex; flex-direction: column; align-items: flex-start; padding: 0.15in; gap: 0.06in; }
        .print-label-text { width: 100%; display: flex; flex-direction: column; gap: 0.03in; }
        .print-label-product { font-size: 10pt; font-weight: 700; line-height: 1.2; color: #000; word-break: break-word; margin-bottom: 0.04in; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .print-label-line { font-size: 8pt; line-height: 1.3; color: #000; }
        .print-label-field { font-weight: 700; color: #000; }
        .print-label-sn { font-family: monospace; color: #000; }
        .print-label-qr { display: flex; justify-content: center; width: 100%; }
        .print-label-qr svg { width: 0.85in !important; height: 0.85in !important; }
      </style></head><body>${el.innerHTML}</body></html>`);
      win.document.close();
      win.focus();
      win.onafterprint = () => win.close();
      win.print();
    });
    return () => cancelAnimationFrame(id);
  }, [printRequestId]);

  /** Builds a QR payload from the given product/weight context, opens the print window,
   * and returns the payload + sn so callers can log a printed-label audit entry. */
  const triggerPrint = useCallback(
    (item: { plu: string | null; productTitle: string; itemWeight: string }, sn?: string) => {
      const printedAtEst = formatEst(new Date());
      const finalSn = sn ?? generateSn();
      const qrPayload = buildQrPayload(item, printedAtEst, finalSn);
      const payload: PrintPayload = { productTitle: item.productTitle, qrPayload, itemWeight: item.itemWeight, printedAtEst, sn: finalSn };
      setPrintPayload(payload);
      setPrintRequestId((n) => n + 1);
      setPrintedAt(new Date());
      return { payload, sn: finalSn, printedAtEst, qrPayload };
    },
    []
  );

  /** Re-sends an exact, previously-built payload (e.g. for "Reprint") without
   * regenerating the QR payload — preserves the original sn so duplicate-scan
   * detection in Ship mode still recognizes it as the same physical label. */
  const printVerbatim = useCallback((payload: PrintPayload) => {
    setPrintPayload(payload);
    setPrintRequestId((n) => n + 1);
    setPrintedAt(new Date());
  }, []);

  const reset = useCallback(() => setPrintedAt(null), []);

  return { printPayload, printedAt, triggerPrint, printVerbatim, reset };
}
