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
      const win = window.open('', '_blank', `width=${screen.availWidth},height=${screen.availHeight},left=0,top=0`);
      if (!win) return;
      const css = getLabelWindowCSS(labelSizeKeyRef.current);
      win.document.write(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${el.innerHTML}</body></html>`);
      win.document.close();
      win.focus();
      win.onafterprint = () => win.close();
      win.print();
    });
    return () => cancelAnimationFrame(id);
  }, [printRequestId]);

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

  const printVerbatim = useCallback((payload: PrintPayload) => {
    setPrintPayload(payload);
    setPrintRequestId((n) => n + 1);
    setPrintedAt(new Date());
  }, []);

  const reset = useCallback(() => setPrintedAt(null), []);

  return { printPayload, printedAt, triggerPrint, printVerbatim, reset };
}
