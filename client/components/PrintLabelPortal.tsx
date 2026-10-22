'use client';

import { QRCodeSVG } from 'qrcode.react';
import { getLabelPrintMediaCSS, getBatchLabelPrintMediaCSS, getQrPixelSize, type LabelSizeKey } from '@/lib/labelSizes';

export interface PrintPayload {
  productTitle: string;
  variantTitle?: string | null;
  qrPayload: string;
  itemWeight?: string | null;
  printedAtEst: string;
  sn: string;
}

function LabelContent({ payload, labelSizeKey }: { payload: PrintPayload; labelSizeKey: LabelSizeKey }) {
  return (
    <div className="print-label-content">
      <div className="print-label-text">
        <p className="print-label-title">
          {payload.productTitle}
          {payload.variantTitle && payload.variantTitle !== 'Default Title'
            ? ` - ${payload.variantTitle}`
            : ''}
        </p>
        {payload.itemWeight && <p className="print-label-line"><span className="print-label-field">Weight:</span> {payload.itemWeight}</p>}
        <p className="print-label-line print-label-sn"><span className="print-label-field">SN:</span> {payload.sn}</p>
      </div>
      <div className="print-label-qr">
        <QRCodeSVG value={payload.qrPayload} size={getQrPixelSize(labelSizeKey)} level="M" bgColor="#ffffff" fgColor="#000000" />
      </div>
    </div>
  );
}

export function PrintLabelPortal({
  payload,
  batchPayloads,
  labelSizeKey = '3x2',
}: {
  payload: PrintPayload | null;
  batchPayloads?: PrintPayload[] | null;
  labelSizeKey?: LabelSizeKey;
}) {
  return (
    <>
      {payload && (
        <>
          <div id="print-label" aria-hidden="true">
            <div className="print-label-inner">
              <LabelContent payload={payload} labelSizeKey={labelSizeKey} />
            </div>
          </div>
          <style dangerouslySetInnerHTML={{ __html: getLabelPrintMediaCSS(labelSizeKey) }} />
        </>
      )}
      {batchPayloads && batchPayloads.length > 0 && (
        <>
          <div id="batch-print-labels" aria-hidden="true" style={{ display: 'none' }}>
            {batchPayloads.map((p, i) => (
              <div key={i} className="print-label-inner">
                <LabelContent payload={p} labelSizeKey={labelSizeKey} />
              </div>
            ))}
          </div>
          <style dangerouslySetInnerHTML={{ __html: getBatchLabelPrintMediaCSS(labelSizeKey) }} />
        </>
      )}
    </>
  );
}
