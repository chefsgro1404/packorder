export function generateSn(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export function buildQrPayload(
  item: { plu: string | null; productTitle: string; itemWeight: string },
  printedAtEst: string,
  sn: string
): string {
  const plu = item.plu || 'N/A';
  return `${plu} | ${item.productTitle} | ${item.itemWeight} | ${printedAtEst} | SN:${sn}`;
}
