/** Strips a Shopify GID (e.g. "gid://shopify/ProductVariant/123") down to its
 * bare numeric ID. Used when building URLs — a raw GID contains slashes that
 * get percent-encoded, but edge routing (Azure SWA, CDNs) often decodes %2F
 * before matching routes, splitting the path into segments that no longer
 * match a single Next.js dynamic route and 404ing. */
export function stripGid(gid: string): string {
  return gid.includes('/') ? gid.split('/').pop()! : gid;
}

export function generateSn(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export function buildQrPayload(
  item: { plu: string | null; productTitle: string; variantTitle?: string | null; itemWeight: string },
  printedAtEst: string,
  sn: string
): string {
  const plu = item.plu || 'N/A';
  const effectiveVariant = item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : null;
  const title = effectiveVariant ? `${item.productTitle} - ${effectiveVariant}` : item.productTitle;
  return `${plu} | ${title} | ${item.itemWeight} | ${printedAtEst} | SN:${sn}`;
}
