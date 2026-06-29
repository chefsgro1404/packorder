'use client';

import { QRCodeSVG } from 'qrcode.react';
import { getLabelPrintMediaCSS, type LabelSizeKey } from '@/lib/labelSizes';

export interface PrintPayload {
  productTitle: string;
  qrPayload: string;
  itemWeight: string;
  printedAtEst: string;
  sn: string;
}

export function PrintLabelPortal({
  payload,
  labelSizeKey = '3x2',
}: {
  payload: PrintPayload | null;
  labelSizeKey?: LabelSizeKey;
}) {
  if (!payload) return null;

  return (
    <>
      <div id="print-label" aria-hidden="true">
        <div className="print-label-inner">
          <div className="print-label-content">
            <div className="print-label-text">
              <p className="print-label-product">{payload.productTitle}</p>
              <p className="print-label-line"><span className="print-label-field">Weight:</span> {payload.itemWeight}</p>
              <p className="print-label-line"><span className="print-label-field">Packing Date:</span> {payload.printedAtEst}</p>
              <p className="print-label-line print-label-sn"><span className="print-label-field">SN:</span> {payload.sn}</p>
            </div>
            <div className="print-label-qr">
              <QRCodeSVG value={payload.qrPayload} size={388} level="M" bgColor="#ffffff" fgColor="#000000" />
            </div>
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: getLabelPrintMediaCSS(labelSizeKey) }} />
    </>
  );
}
