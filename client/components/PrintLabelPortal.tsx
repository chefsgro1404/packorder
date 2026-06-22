'use client';

import { QRCodeSVG } from 'qrcode.react';

export interface PrintPayload {
  productTitle: string;
  qrPayload: string;
  itemWeight: string;
  printedAtEst: string;
  sn: string;
}

/** Hidden DOM rendered as a sibling of the page's main content, made visible only
 * by the @media print rules below — kept this way (rather than a print-time portal)
 * so it can be styled identically whether triggered from /scale or /scale/products/[id]. */
export function PrintLabelPortal({ payload }: { payload: PrintPayload | null }) {
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
      <style jsx global>{`
        #print-label {
          display: none;
        }
        @media print {
          @page {
            size: 3in 2in;
            margin: 0;
          }
          main {
            display: none !important;
          }
          #print-label {
            display: block;
            position: fixed;
            top: 0;
            left: 0;
            width: 3in;
            height: 2in;
            overflow: hidden;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-label-inner {
            width: 3in;
            height: 2in;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #fff;
          }
          .print-label-content {
            width: 2in;
            box-sizing: border-box;
            padding: 0.15in;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.06in;
          }
          .print-label-text {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 0.03in;
          }
          .print-label-product {
            font-size: 10pt;
            font-weight: 700;
            line-height: 1.2;
            margin: 0 0 0.04in 0;
            color: #000;
            word-break: break-word;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .print-label-line {
            font-size: 8pt;
            line-height: 1.3;
            margin: 0;
            color: #000;
          }
          .print-label-field {
            font-weight: 700;
            color: #000;
          }
          .print-label-sn {
            font-family: monospace;
            color: #000;
          }
          .print-label-qr {
            display: flex;
            justify-content: center;
            width: 100%;
          }
          .print-label-qr svg {
            width: 0.85in !important;
            height: 0.85in !important;
          }
        }
      `}</style>
    </>
  );
}
