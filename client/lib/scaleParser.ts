export interface ParseResult {
  success: boolean;
  itemName?: string;
  itemNumber?: string;
  itemWeight?: string;
  qrPayload?: string;
  error?: 'NO_ITEM' | 'OVERLOAD' | 'PARSE_ERROR';
}

export function parseScaleBuffer(buffer: string): ParseResult {
  if (buffer.includes('OVERLOAD')) {
    return { success: false, error: 'OVERLOAD' };
  }

  const lines = buffer
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes('ITEM'));

  if (lines.length === 0) {
    return { success: false, error: 'NO_ITEM' };
  }

  const line = lines[0];

  const itemNameMatch = line.match(/(ITEM\s+(\d+))/);
  if (!itemNameMatch) return { success: false, error: 'PARSE_ERROR' };
  const itemName = itemNameMatch[1].trim();
  const itemNumber = itemNameMatch[2];

  const weightMatch = line.match(/([\d]+\.[\d]+\s*lb)/);
  if (!weightMatch) return { success: false, error: 'PARSE_ERROR' };
  const itemWeight = weightMatch[1].trim();

  return {
    success: true,
    itemName,
    itemNumber,
    itemWeight,
    qrPayload: `${itemName} | ${itemWeight}`,
  };
}
