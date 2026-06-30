export type LabelSizeKey = '3x2' | '2.25x2' | '2.25x1.25' | '2x1';

export const LABEL_SIZE_OPTIONS: { key: LabelSizeKey; label: string }[] = [
  { key: '3x2',       label: '3" × 2"' },
  { key: '2.25x2',    label: '2.25" × 2"' },
  { key: '2.25x1.25', label: '2.25" × 1.25"' },
  { key: '2x1',       label: '2" × 1"' },
];

interface SizeCfg {
  pageW: number;    // full page width in inches
  pageH: number;    // full page height in inches
  contentW: number; // content sub-box width — narrower than page, centered horizontally
  layout: 'row' | 'col';
  padding: number;  // padding inside content box
  qrIn: number;     // QR size in inches
  titlePt: number;
  linePt: number;
  gap: number;      // gap between text block and QR
  textGap: number;  // gap between text lines
}

// All sizes center a sub-box (contentW wide, height auto) inside the page.
// Horizontal margins = (pageW - contentW) / 2.
// Vertical centering is handled by flexbox on .print-label-inner.
// Row layout = text left, QR right. Col layout = text top, QR bottom.
// For row layouts, qrIn is kept to roughly 40-45% of contentW so the text
// column always gets the majority of the width (avoids 1-word-per-line wrap).
const CFGS: Record<LabelSizeKey, SizeCfg> = {
  '3x2':       { pageW: 3,    pageH: 2,    contentW: 2.0,  layout: 'col', padding: 0.15, qrIn: 0.85, titlePt: 10,  linePt: 8,   gap: 0.06, textGap: 0.03 },
  '2.25x2':    { pageW: 2.25, pageH: 2,    contentW: 2.05, layout: 'row', padding: 0.1,  qrIn: 0.9,  titlePt: 7,   linePt: 6,   gap: 0.06, textGap: 0.025 },
  '2.25x1.25': { pageW: 2.25, pageH: 1.25, contentW: 2.05, layout: 'row', padding: 0.07, qrIn: 0.75, titlePt: 6.5, linePt: 5.5, gap: 0.045, textGap: 0.02 },
  '2x1':       { pageW: 2,    pageH: 1,    contentW: 1.8,  layout: 'row', padding: 0.06, qrIn: 0.55, titlePt: 6,   linePt: 5,   gap: 0.04, textGap: 0.015 },
};

export function getLabelConfig(key: LabelSizeKey): SizeCfg {
  return CFGS[key];
}

function sharedRules(c: SizeCfg): string {
  return `
    .print-label-inner { width: ${c.pageW}in; height: ${c.pageH}in; display: flex; align-items: center; justify-content: center; }
    .print-label-product { font-size: ${c.titlePt}pt; font-weight: 700; line-height: 1.2; color: #000; word-break: break-word; margin-bottom: ${c.textGap}in; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .print-label-line { font-size: ${c.linePt}pt; line-height: 1.25; color: #000; }
    .print-label-field { font-weight: 700; color: #000; }
    .print-label-sn { font-family: monospace; color: #000; }
  `;
}

function layoutRules(c: SizeCfg): string {
  if (c.layout === 'row') {
    return `
      .print-label-content { width: ${c.contentW}in; display: flex; flex-direction: row; align-items: center; padding: ${c.padding}in; gap: ${c.gap}in; }
      .print-label-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${c.textGap}in; }
      .print-label-qr { flex-shrink: 0; display: flex; align-items: center; }
      .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
    `;
  }
  return `
    .print-label-content { width: ${c.contentW}in; display: flex; flex-direction: column; align-items: flex-start; padding: ${c.padding}in; gap: ${c.gap}in; }
    .print-label-text { width: 100%; display: flex; flex-direction: column; gap: ${c.textGap}in; }
    .print-label-qr { display: flex; justify-content: center; width: 100%; }
    .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
  `;
}

export function getLabelWindowCSS(key: LabelSizeKey): string {
  const c = CFGS[key];
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
    html, body { width: ${c.pageW}in; height: ${c.pageH}in; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    ${sharedRules(c)}
    ${layoutRules(c)}
  `;
}

export function getLabelPrintMediaCSS(key: LabelSizeKey): string {
  const c = CFGS[key];
  return `
    #print-label { display: none; }
    @media print {
      @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
      main { display: none !important; }
      #print-label { display: block; position: fixed; top: 0; left: 0; width: ${c.pageW}in; height: ${c.pageH}in; overflow: hidden; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      ${sharedRules(c)}
      ${layoutRules(c)}
    }
  `;
}

export const LABEL_SIZE_STORAGE_KEY = 'shipscan-label-size';
