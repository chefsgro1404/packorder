export type LabelSizeKey = '3x2' | '2.25x2' | '2.25x1.25' | '2x1';

export const LABEL_SIZE_OPTIONS: { key: LabelSizeKey; label: string; w: number; h: number }[] = [
  { key: '3x2',       label: '3" × 2"',       w: 3,    h: 2    },
  { key: '2.25x2',    label: '2.25" × 2"',    w: 2.25, h: 2    },
  { key: '2.25x1.25', label: '2.25" × 1.25"', w: 2.25, h: 1.25 },
  { key: '2x1',       label: '2" × 1"',        w: 2,    h: 1    },
];

interface SizeCfg {
  pageW: number;
  pageH: number;
  contentW: number;
  layout: 'row' | 'col';
  padding: number;
  qrIn: number;
  titlePt: number;
  linePt: number;
  gap: number;
  textGap: number;
}

function r(n: number): number { return Math.round(n * 1000) / 1000; }

// All sizing values derived from the label dimensions — no per-size manual tuning needed.
// col layout: text on top, QR below (used for large near-square labels like 3×2).
// row layout: text left, QR right (used for smaller/wider labels).
function computeCfg(pageW: number, pageH: number): SizeCfg {
  const layout: 'row' | 'col' = pageW >= 2.5 && pageH >= 1.8 ? 'col' : 'row';
  const minDim = Math.min(pageW, pageH);
  const padding  = r(minDim * 0.056);
  const contentW = r(pageW * (layout === 'col' ? 0.667 : 0.91));
  const availH   = pageH - 2 * padding;

  // QR: for row, bounded by available height and ~44% of content width.
  // For col, fills ~42% of page height, capped at 55% of content width.
  const qrIn = layout === 'col'
    ? r(Math.min(pageH * 0.425, contentW * 0.55))
    : r(Math.min(availH * 0.68, contentW * 0.44));

  // Font sizes: col scales with page height; row sized so title+variant+3 meta lines
  // fill ~80% of available height at worst case, capped at 8pt to stay legible.
  const titlePt = layout === 'col'
    ? r(Math.max(6, pageH * 5))
    : r(Math.max(5.5, Math.min(8, availH * 6.9)));
  const linePt  = r(Math.max(4.5, titlePt * 0.83));

  const gap     = r(contentW * 0.022);
  const textGap = r(pageH * 0.013);

  return { pageW, pageH, contentW, layout, padding, qrIn, titlePt, linePt, gap, textGap };
}

export function getLabelConfig(key: LabelSizeKey): SizeCfg {
  const opt = LABEL_SIZE_OPTIONS.find(o => o.key === key)!;
  return computeCfg(opt.w, opt.h);
}

// QR SVG pixel size for rendering quality — at 300 dpi, minimum 150 px.
export function getQrPixelSize(key: LabelSizeKey): number {
  return Math.max(150, Math.ceil(getLabelConfig(key).qrIn * 300));
}

function sharedRules(c: SizeCfg): string {
  return `
    .print-label-inner { width: ${c.pageW}in; height: ${c.pageH}in; display: flex; align-items: center; justify-content: center; }
    .print-label-product { font-size: ${c.titlePt}pt; font-weight: 700; line-height: 1.2; color: #000; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .print-label-variant { font-size: ${c.linePt}pt; font-weight: 600; line-height: 1.2; color: #333; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .print-label-line { font-size: ${c.linePt}pt; line-height: 1.25; color: #000; }
    .print-label-field { font-weight: 700; color: #000; }
    .print-label-sn { font-family: monospace; color: #000; }
  `;
}

function layoutRules(c: SizeCfg): string {
  if (c.layout === 'row') {
    return `
      .print-label-content { width: ${c.contentW}in; box-sizing: border-box; display: flex; flex-direction: row; align-items: center; padding: ${c.padding}in; gap: ${c.gap}in; }
      .print-label-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${c.textGap}in; }
      .print-label-qr { flex-shrink: 0; display: flex; align-items: center; }
      .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
    `;
  }
  return `
    .print-label-content { width: ${c.contentW}in; box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start; padding: ${c.padding}in; gap: ${c.gap}in; }
    .print-label-text { width: 100%; display: flex; flex-direction: column; gap: ${c.textGap}in; }
    .print-label-qr { display: flex; justify-content: center; width: 100%; }
    .print-label-qr svg { width: ${c.qrIn}in !important; height: ${c.qrIn}in !important; }
  `;
}

export function getLabelWindowCSS(key: LabelSizeKey): string {
  const c = getLabelConfig(key);
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
    html, body { width: ${c.pageW}in; height: ${c.pageH}in; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    ${sharedRules(c)}
    ${layoutRules(c)}
  `;
}

export function getLabelPrintMediaCSS(key: LabelSizeKey): string {
  const c = getLabelConfig(key);
  return `
    #print-label { display: none; }
    @media print {
      *, *::before, *::after { box-sizing: border-box; }
      @page { size: ${c.pageW}in ${c.pageH}in; margin: 0; }
      main { display: none !important; }
      #print-label { display: block; position: fixed; top: 0; left: 0; width: ${c.pageW}in; height: ${c.pageH}in; overflow: hidden; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      ${sharedRules(c)}
      ${layoutRules(c)}
    }
  `;
}

export const LABEL_SIZE_STORAGE_KEY = 'shipscan-label-size';
