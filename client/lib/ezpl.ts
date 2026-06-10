export function buildEZPL(productTitle: string, qrPayload: string): Uint8Array {
  const qrLen = qrPayload.length;
  const CR = '\r';

  const lines = [
    '^Q38,3',
    '^W57',
    '^H8',
    '^P1',
    '^S4',
    '^AD',
    '^C1',
    '^R0',
    '^O0',
    '^D0',
    '^E18',
    '^XSET,ROTATION,1',
    '^L',
    `AC,10,10,1,1,0,0,${productTitle}`,
    `W220,10,2,2,M,8,3,${qrLen},0`,
    qrPayload,
    'E',
  ];

  // CRITICAL: lines joined and terminated with \r ONLY — never \r\n
  const raw = lines.join(CR) + CR;
  return new TextEncoder().encode(raw);
}
