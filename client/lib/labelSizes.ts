export type LabelSizeKey = '3x2' | '2.5x2' | '2.5x1.5' | '2.5x1';

export const LABEL_SIZE_OPTIONS: { key: LabelSizeKey; label: string }[] = [
  { key: '3x2',     label: '3" × 2"' },
  { key: '2.5x2',   label: '2.5" × 2"' },
  { key: '2.5x1.5', label: '2.5" × 1.5"' },
  { key: '2.5x1',   label: '2.5" × 1"' },
];

interface SizeCfg {
  pageW: number; pageH: number;
  layout: 'row' | 'col-center';
  padding: number; qrIn: number;
  titlePt: number; linePt: number;
  gap: number; textGap: number;
}

const CFGS: Record<LabelSizeKey, SizeCfg> = {
  '3x2':     { pageW: 3,   pageH: 2,   layout: 'col-center', padding: 0.15, qrIn: 0.85, titlePt: 10, linePt: 8,   gap: 0.06, textGap: 0.03 },
  '2.5x2':   { pageW: 2.5, pageH: 2,   layout: 'row',        padding: 0.12, qrIn: 1.1,  titlePt: 8,  linePt: 6.5, gap: 0.08, textGap: 0.03 },
  '2.5x1.5': { pageW: 2.5, pageH: 1.5, layout: 'row',        padding: 0.1,  qrIn: 1.0,  titlePt: 7,  linePt: 6,   gap: 0.06, textGap: 0.025 },
  '2.5x1':   { pageW: 2.5, pageH: 1,   layout: 'row',        padding: 0.08, qrIn: 0.65, titlePt: 6,  linePt: 5,   gap: 0.05, textGap: 0.02 },
};

export function getLabelConfig(key: LabelSizeKey): SizeCfg {
  return CFGS[key];
}

function layoutCSS(c: SizeCfg): string {
  if (c.layout === 'row') {
    return `
      .print-label-content { width: ${c.pageW}in; height: ${c.pageH}in; display: flex; flex-direction: row; align-items: center; padding: ${c.padding}in; gap: ${c.gap}in; }
      .print-label-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${c.textGap}in; }
      .print-label-qr { flex-shrink: 0; display: flex; align-items: center; }
      .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
    `;
  }
  const contentW = +(c.pageW * 2 / 3).toFixed(2);
  return `
    .print-label-content { width: ${contentW}in; display: flex; flex-direction: column; align-items: flex-start; padding: ${c.padding}in; gap: ${c.gap}in; }
    .print-label-text { width: 100%; display: flex; flex-direction: column; gap: ${c.textGap}in; }
    .print-label-qr { display: flex; justify-content: center; width: 100%; }
    .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
  `;
}

/** CSS for the isolated new-window print approach. */
export function getLabelWindowCSS(key: LabelSizeKey): string {
  const c = CFGS[key];
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
    html, body { width: ${c.pageW}in; height: ${c.pageH}in; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-label-inner { width: ${c.pageW}in; height: ${c.pageH}in; display: flex; align-items: center; justify-content: center; }
    .print-label-product { font-size: ${c.titlePt}pt; font-weight: 700; line-height: 1.2; color: #000; word-break: break-word; margin-bottom: ${c.textGap}in; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .print-label-line { font-size: ${c.linePt}pt; line-height: 1.25; color: #000; }
    .print-label-field { font-weight: 700; color: #000; }
    .print-label-sn { font-family: monospace; color: #000; }
    ${layoutCSS(c)}
  `;
}

/** CSS injected into the page for the @media print fallback. */
export function getLabelPrintMediaCSS(key: LabelSizeKey): string {
  const c = CFGS[key];
  return `
    #print-label { display: none; }
    @media print {
      @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
      main { display: none !important; }
      #print-label {
        display: block; position: fixed; top: 0; left: 0;
        width: ${c.pageW}in; height: ${c.pageH}in;
        overflow: hidden; background: #fff;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .print-label-inner { width: ${c.pageW}in; height: ${c.pageH}in; box-sizing: border-box; display: flex; align-items: center; justify-content: center; background: #fff; }
      .print-label-product { font-size: ${c.titlePt}pt; font-weight: 700; line-height: 1.2; color: #000; word-break: break-word; margin: 0 0 ${c.textGap}in 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .print-label-line { font-size: ${c.linePt}pt; line-height: 1.25; margin: 0; color: #000; }
      .print-label-field { font-weight: 700; color: #000; }
      .print-label-sn { font-family: monospace; color: #000; }
      ${layoutCSS(c)}
    }
  `;
}

export const LABEL_SIZE_STORAGE_KEY = 'shipscan-label-size';
