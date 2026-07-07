import { useCallback, useEffect, useRef, useState } from 'react';
import { generateSn, buildQrPayload } from '@/lib/scaleLabel';
import { formatEst } from '@/lib/dateFormat';
import { getLabelWindowCSS, type LabelSizeKey } from '@/lib/labelSizes';
import type { PrintPayload } from '@/components/PrintLabelPortal';

export function usePrintLabel(labelSizeKey: LabelSizeKey = '3x2') {
  const [printPayload, setPrintPayload] = useState<PrintPayload | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  // Ref so the effect always reads the latest size without re-registering on size change.
  const labelSizeKeyRef = useRef(labelSizeKey);
  labelSizeKeyRef.current = labelSizeKey;

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

  const triggerPrint = useCallback(
    (item: { plu: string | null; productTitle: string; variantTitle?: string | null; itemWeight?: string | null }, sn?: string) => {
      const printedAtEst = formatEst(new Date());
      const finalSn = sn ?? generateSn();
      const qrPayload = buildQrPayload(item, printedAtEst, finalSn);
      const payload: PrintPayload = { productTitle: item.productTitle, variantTitle: item.variantTitle, qrPayload, itemWeight: item.itemWeight, printedAtEst, sn: finalSn };
      setPrintPayload(payload);
      setPrintRequestId((n) => n + 1);
      setPrintedAt(new Date());
      return { payload, sn: finalSn, printedAtEst, qrPayload };
    },
    []
  );

  const printVerbatim = useCallback((payload: PrintPayload) => {
    setPrintPayload(payload);
    setPrintRequestId((n) => n + 1);
    setPrintedAt(new Date());
  }, []);

  const reset = useCallback(() => setPrintedAt(null), []);

  return { printPayload, printedAt, triggerPrint, printVerbatim, reset };
}
