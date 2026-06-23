export interface ParseResult {
  success: boolean;
  itemName?: string;
  itemNumber?: string;
  itemWeight?: string;
  qrPayload?: string;
  error?: 'NO_ITEM' | 'OVERLOAD' | 'PARSE_ERROR';
}

const WEIGHT_RE = /([\d]+\.[\d]+\s*lb)/;

export function parseScaleBuffer(buffer: string): ParseResult {
  if (buffer.includes('OVERLOAD')) {
    return { success: false, error: 'OVERLOAD' };
  }

  const itemLines = buffer
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('ITEM'));

  if (itemLines.length > 0) {
    const line = itemLines[0];

    const itemNameMatch = line.match(/(ITEM\s+(\d+))/);
    const weightMatch = line.match(WEIGHT_RE);

    if (itemNameMatch && weightMatch) {
      const itemName = itemNameMatch[1].trim();
      const itemNumber = itemNameMatch[2];
      const itemWeight = weightMatch[1].trim();
      return {
        success: true,
        itemName,
        itemNumber,
        itemWeight,
        qrPayload: `${itemName} | ${itemWeight}`,
      };
    }
  }

  // No "ITEM N" recall line — happens when staff just weighs and sends the signal
  // directly (e.g. from /scale/products/[id], where the product is already known and
  // there's no need to recall a PLU slot first). Fall back to a weight-only reading
  // as long as a weight pattern shows up anywhere in the buffer.
  const weightOnlyMatch = buffer.match(WEIGHT_RE);
  if (weightOnlyMatch) {
    const itemWeight = weightOnlyMatch[1].trim();
    return {
      success: true,
      itemName: '',
      itemNumber: '',
      itemWeight,
      qrPayload: itemWeight,
    };
  }

  return { success: false, error: 'NO_ITEM' };
}
