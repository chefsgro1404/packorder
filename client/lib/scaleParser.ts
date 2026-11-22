export interface ParseResult {
  success: boolean;
  itemWeight?: string;
  error?: 'NO_WEIGHT' | 'OVERLOAD';
}

const WEIGHT_RE = /([\d]+\.[\d]+\s*lb)/;

// Only the weight is kept. The Torrey also sends "ITEM <n>" (the PLU slot recalled on the
// scale) and a price — both are thrown away, so the scale can never choose or change the
// product. The product is always whatever staff loaded on the page.
export function parseScaleBuffer(buffer: string): ParseResult {
  if (buffer.includes('OVERLOAD')) {
    return { success: false, error: 'OVERLOAD' };
  }

  // Prefer the weight on the ITEM line (the weighed item) over any other weight in the buffer.
  // A weight-only signal (no ITEM line) is just as valid.
  const itemLine = buffer
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.includes('ITEM') && WEIGHT_RE.test(l));
  const weightMatch = (itemLine ?? buffer).match(WEIGHT_RE);
  if (weightMatch) {
    return { success: true, itemWeight: weightMatch[1].trim() };
  }

  return { success: false, error: 'NO_WEIGHT' };
}
